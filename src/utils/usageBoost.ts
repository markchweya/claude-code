import type { Utilization } from '../services/api/usage.js'

/**
 * Usage boost: shift part of the weekly (all models) allowance into the
 * current 5-hour session window.
 *
 * Everything in this module is pure so the numbers shown in the /usage
 * switcher are deterministic and easy to unit test. The exchange rate and
 * bounds come from the server quote (see services/api/usageBoost.ts) — the
 * client never guesses how big a session window is relative to a week.
 */

export type UsageBoostQuote = {
  /** Whether the current account can boost right now. */
  available: boolean
  /** Human-readable reason when `available` is false. */
  unavailable_reason?: string | null
  /**
   * Weekly percentage points consumed for every percentage point of extra
   * session capacity granted. A 5-hour window is a fraction of a week, so
   * this is normally well below 1 (e.g. 0.15 → +20% session costs 3% weekly).
   */
  exchange_rate: number
  /** Smallest boost that can be requested, in session percentage points. */
  min_session_percent: number
  /** Largest boost that can be requested, in session percentage points. */
  max_session_percent: number
  /** Granularity of the ◂ ▸ control, in session percentage points. */
  step_percent: number
}

export type UsageBoostPreview = {
  /** Requested extra session capacity, in percentage points of the window. */
  sessionPercent: number
  /** Weekly percentage points this boost consumes. */
  weeklyCost: number
  sessionBefore: number
  sessionAfter: number
  weeklyBefore: number
  weeklyAfter: number
  canApply: boolean
  blockedReason: string | null
}

/** Keep a reserve so a boost never pushes the weekly bar to the wall. */
export const WEEKLY_RESERVE_PERCENT = 5

/** Session utilization the auto-suggested boost aims for. */
const SUGGESTED_TARGET_SESSION_PERCENT = 60

/** Nudge the user once the session bar is this full… */
export const NUDGE_SESSION_THRESHOLD_PERCENT = 75
/** …as long as the weekly bar still has this much headroom or more. */
export const NUDGE_WEEKLY_MAX_PERCENT = 60

function roundTenth(n: number): number {
  return Math.round(n * 10) / 10
}

/** Snap a requested amount onto the quote's grid and bounds. */
export function clampBoostPercent(
  quote: UsageBoostQuote,
  requested: number,
): number {
  const step = quote.step_percent > 0 ? quote.step_percent : 1
  const snapped = Math.round(requested / step) * step
  return Math.min(
    quote.max_session_percent,
    Math.max(quote.min_session_percent, snapped),
  )
}

/**
 * Session utilization after growing the window by `sessionPercent` points.
 * The tokens already used stay fixed while the denominator grows, so
 * 81% used with a +50% boost becomes 81 / 1.5 = 54%.
 */
export function sessionUtilizationAfterBoost(
  sessionBefore: number,
  sessionPercent: number,
): number {
  return roundTenth((sessionBefore * 100) / (100 + sessionPercent))
}

export function weeklyCostForBoost(
  quote: UsageBoostQuote,
  sessionPercent: number,
): number {
  return roundTenth(sessionPercent * quote.exchange_rate)
}

export function computeBoostPreview(
  quote: UsageBoostQuote,
  utilization: Utilization,
  requestedSessionPercent: number,
): UsageBoostPreview {
  const sessionBefore = utilization.five_hour?.utilization ?? null
  const weeklyBefore = utilization.seven_day?.utilization ?? null
  const sessionPercent = clampBoostPercent(quote, requestedSessionPercent)
  const weeklyCost = weeklyCostForBoost(quote, sessionPercent)

  if (sessionBefore === null || weeklyBefore === null) {
    return {
      sessionPercent,
      weeklyCost,
      sessionBefore: sessionBefore ?? 0,
      sessionAfter: sessionBefore ?? 0,
      weeklyBefore: weeklyBefore ?? 0,
      weeklyAfter: weeklyBefore ?? 0,
      canApply: false,
      blockedReason: 'Session and weekly limits must both be known to boost.',
    }
  }

  const sessionAfter = sessionUtilizationAfterBoost(sessionBefore, sessionPercent)
  const weeklyAfter = roundTenth(weeklyBefore + weeklyCost)

  let blockedReason: string | null = null
  if (!quote.available) {
    blockedReason = quote.unavailable_reason ?? 'Boosting is not available right now.'
  } else if (weeklyAfter > 100 - WEEKLY_RESERVE_PERCENT) {
    blockedReason = `Not enough weekly headroom — this boost would use ${weeklyAfter.toFixed(0)}% of your week (limit ${100 - WEEKLY_RESERVE_PERCENT}%).`
  } else if (sessionPercent <= 0) {
    blockedReason = 'Pick a boost amount above zero.'
  }

  return {
    sessionPercent,
    weeklyCost,
    sessionBefore,
    sessionAfter,
    weeklyBefore,
    weeklyAfter,
    canApply: blockedReason === null,
    blockedReason,
  }
}

/**
 * Largest boost (on the quote grid) that leaves the weekly reserve intact.
 * Returns 0 when even the minimum boost is unaffordable.
 */
export function maxAffordableBoostPercent(
  quote: UsageBoostQuote,
  weeklyBefore: number,
): number {
  if (quote.exchange_rate <= 0) return quote.max_session_percent
  const headroom = 100 - WEEKLY_RESERVE_PERCENT - weeklyBefore
  if (headroom <= 0) return 0
  const step = quote.step_percent > 0 ? quote.step_percent : 1
  const raw = Math.floor(headroom / quote.exchange_rate / step) * step
  const capped = Math.min(raw, quote.max_session_percent)
  return capped >= quote.min_session_percent ? capped : 0
}

/**
 * Sensible default for the switcher: the smallest boost that brings the
 * session bar down to a comfortable level, bounded by what the week can pay
 * for. Falls back to the minimum boost when the session is already healthy.
 */
export function suggestedBoostPercent(
  quote: UsageBoostQuote,
  utilization: Utilization,
): number {
  const sessionBefore = utilization.five_hour?.utilization ?? 0
  const weeklyBefore = utilization.seven_day?.utilization ?? 0
  const affordable = maxAffordableBoostPercent(quote, weeklyBefore)
  if (affordable === 0) return quote.min_session_percent

  // sessionBefore / (1 + x/100) <= target  ⇒  x >= (sessionBefore/target − 1) · 100
  const needed =
    sessionBefore > SUGGESTED_TARGET_SESSION_PERCENT
      ? (sessionBefore / SUGGESTED_TARGET_SESSION_PERCENT - 1) * 100
      : quote.min_session_percent
  const snapped = clampBoostPercent(quote, Math.ceil(needed))
  return Math.min(snapped, affordable)
}

/**
 * Whether /usage should proactively point at the boost switcher: the
 * session is close to running out while the week still has plenty left,
 * and the minimum boost is actually affordable.
 */
export function shouldSuggestUsageBoost(
  quote: UsageBoostQuote | null,
  utilization: Utilization | null,
): boolean {
  if (!quote?.available || !utilization) return false
  const session = utilization.five_hour?.utilization
  const weekly = utilization.seven_day?.utilization
  if (session == null || weekly == null) return false
  if (session < NUDGE_SESSION_THRESHOLD_PERCENT) return false
  if (weekly > NUDGE_WEEKLY_MAX_PERCENT) return false
  return maxAffordableBoostPercent(quote, weekly) > 0
}

/** Apply a preview to a utilization snapshot (used by the mock backend). */
export function applyBoostToUtilization(
  utilization: Utilization,
  preview: UsageBoostPreview,
): Utilization {
  return {
    ...utilization,
    five_hour: utilization.five_hour
      ? { ...utilization.five_hour, utilization: preview.sessionAfter }
      : utilization.five_hour,
    seven_day: utilization.seven_day
      ? { ...utilization.seven_day, utilization: preview.weeklyAfter }
      : utilization.seven_day,
  }
}
