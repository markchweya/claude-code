import axios from 'axios'
import { getOauthConfig } from '../../constants/oauth.js'
import {
  getClaudeAIOAuthTokens,
  getSubscriptionType,
  hasProfileScope,
  isClaudeAISubscriber,
} from '../../utils/auth.js'
import { isEnvTruthy } from '../../utils/envUtils.js'
import { getAuthHeaders } from '../../utils/http.js'
import {
  applyBoostToUtilization,
  computeBoostPreview,
  type UsageBoostQuote,
} from '../../utils/usageBoost.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'
import { isOAuthTokenExpired } from '../oauth/client.js'
import type { Utilization } from './usage.js'

export type { UsageBoostQuote }

export type UsageBoostResult = {
  /** Fresh utilization after the boost was applied. */
  utilization: Utilization
  /** Session percentage points actually granted (server may round). */
  granted_session_percent: number
  /** Weekly percentage points actually charged. */
  charged_weekly_percent: number
}

/**
 * Dev/demo switch. With CLAUDE_CODE_USAGE_BOOST_MOCK=1 the quote and apply
 * calls are served locally so the /usage switcher can be exercised without
 * a backend that implements the boost endpoint yet.
 */
export function isUsageBoostMockEnabled(): boolean {
  return isEnvTruthy(process.env.CLAUDE_CODE_USAGE_BOOST_MOCK)
}

/**
 * Whether the boost switcher should be offered at all. The server quote is
 * the final word on availability; this only avoids pointless requests.
 */
export function isUsageBoostAvailable(): boolean {
  if (isEnvTruthy(process.env.DISABLE_USAGE_BOOST)) return false
  if (isUsageBoostMockEnabled()) return true
  if (!isClaudeAISubscriber() || !hasProfileScope()) return false
  const subscriptionType = getSubscriptionType()
  // Team/Enterprise budgets are owned by the org admin, not the seat.
  return subscriptionType === 'pro' || subscriptionType === 'max'
}

const MOCK_QUOTE: UsageBoostQuote = {
  available: true,
  exchange_rate: 0.15,
  min_session_percent: 10,
  max_session_percent: 100,
  step_percent: 10,
}

/** Sample numbers matching the /usage screenshot that motivated the feature. */
const MOCK_UTILIZATION: Utilization = {
  five_hour: {
    utilization: 81,
    resets_at: new Date(Date.now() + 3.95 * 60 * 60 * 1000).toISOString(),
  },
  seven_day: {
    utilization: 21,
    resets_at: new Date(Date.now() + 6.8 * 60 * 60 * 1000).toISOString(),
  },
  seven_day_sonnet: {
    utilization: 36,
    resets_at: new Date(Date.now() + 6.8 * 60 * 60 * 1000).toISOString(),
  },
}

// In-memory ledger so repeated mock boosts within one session accumulate.
let mockUtilizationState: Utilization | null = null

/**
 * In mock mode, fill in sample utilization when the real endpoint returned
 * nothing (e.g. not logged in as a subscriber) so the panel has bars to show.
 */
export function withMockUsageBoostUtilization(
  data: Utilization | null,
): Utilization | null {
  if (!isUsageBoostMockEnabled()) return data
  if (data?.five_hour && data.seven_day) return data
  mockUtilizationState ??= MOCK_UTILIZATION
  return mockUtilizationState
}

function buildHeaders(): Record<string, string> {
  const authResult = getAuthHeaders()
  if (authResult.error) {
    throw new Error(`Auth error: ${authResult.error}`)
  }
  return {
    'Content-Type': 'application/json',
    'User-Agent': getClaudeCodeUserAgent(),
    ...authResult.headers,
  }
}

function boostUrl(): string {
  return `${getOauthConfig().BASE_API_URL}/api/oauth/usage/boost`
}

/**
 * Ask the server what a boost costs and how much can be moved.
 * Returns null when the account can't be quoted (no auth, expired token).
 */
export async function fetchUsageBoostQuote(): Promise<UsageBoostQuote | null> {
  if (isUsageBoostMockEnabled()) return MOCK_QUOTE
  if (!isUsageBoostAvailable()) return null

  const tokens = getClaudeAIOAuthTokens()
  if (tokens && isOAuthTokenExpired(tokens.expiresAt)) return null

  try {
    const response = await axios.get<UsageBoostQuote>(boostUrl(), {
      headers: buildHeaders(),
      timeout: 5000,
    })
    return response.data
  } catch (error) {
    // A 404 means the backend doesn't offer boosting (yet) — treat as
    // unavailable rather than an error so /usage still renders normally.
    if (axios.isAxiosError(error) && error.response?.status === 404) {
      return {
        ...MOCK_QUOTE,
        available: false,
        unavailable_reason: 'Session boosting is not available on this account yet.',
      }
    }
    throw error
  }
}

/**
 * Move `sessionPercent` points of capacity into the current 5-hour window,
 * charging the weekly (all models) allowance at the quoted exchange rate.
 */
export async function applyUsageBoost(
  quote: UsageBoostQuote,
  current: Utilization,
  sessionPercent: number,
): Promise<UsageBoostResult> {
  const preview = computeBoostPreview(quote, current, sessionPercent)
  if (!preview.canApply) {
    throw new Error(preview.blockedReason ?? 'Boost cannot be applied.')
  }

  if (isUsageBoostMockEnabled()) {
    const next = applyBoostToUtilization(current, preview)
    mockUtilizationState = next
    return {
      utilization: next,
      granted_session_percent: preview.sessionPercent,
      charged_weekly_percent: preview.weeklyCost,
    }
  }

  const response = await axios.post<UsageBoostResult>(
    boostUrl(),
    {
      session_percent: preview.sessionPercent,
      // Echo the quote so the server can reject a stale exchange rate.
      expected_weekly_percent: preview.weeklyCost,
    },
    { headers: buildHeaders(), timeout: 10000 },
  )
  return response.data
}
