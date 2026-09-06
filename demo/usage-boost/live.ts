import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Utilization } from '../../src/services/api/usage.js'

/**
 * Live mode: read the OAuth token Claude Code saved when you logged in and
 * call the same usage endpoint the real /usage command calls. Read-only —
 * nothing here can change what Anthropic's servers allow.
 *
 * Token sources, in the order the CLI itself checks them:
 *   1. CLAUDE_CODE_OAUTH_TOKEN environment variable
 *   2. <config dir>/.credentials.json  (config dir = CLAUDE_CONFIG_DIR or ~/.claude)
 *   3. macOS keychain entry "Claude Code-credentials"
 */

// Mirrors src/constants/oauth.ts
export const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const OAUTH_BETA_HEADER = 'oauth-2025-04-20'

export type StoredCredentials = {
  claudeAiOauth?: {
    accessToken?: string
    expiresAt?: number
    subscriptionType?: string | null
  } | null
}

export type LiveToken = {
  accessToken: string
  /** Where the token came from, for the on-screen label. */
  source: 'env' | 'credentials-file' | 'keychain'
  subscriptionType: string | null
  expiresAt: number | null
}

export class LiveUsageError extends Error {
  constructor(
    message: string,
    /** One-line suggestion shown under the error. */
    readonly hint: string,
  ) {
    super(message)
    this.name = 'LiveUsageError'
  }
}

export function configDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

/** Pure parser so the file format can be unit-tested without touching disk. */
export function parseCredentials(
  json: string,
  source: LiveToken['source'],
  now = Date.now(),
): LiveToken {
  let data: StoredCredentials
  try {
    data = JSON.parse(json) as StoredCredentials
  } catch {
    throw new LiveUsageError(
      'Credentials file is not valid JSON.',
      'Run `claude` and log in again to rewrite it.',
    )
  }
  const oauth = data.claudeAiOauth
  if (!oauth?.accessToken) {
    throw new LiveUsageError(
      'No Claude.ai login found in the credentials file.',
      'Run `claude` and choose "Claude account with subscription" when logging in.',
    )
  }
  if (typeof oauth.expiresAt === 'number' && oauth.expiresAt <= now) {
    throw new LiveUsageError(
      'Your saved Claude Code login has expired.',
      'Run `claude` once so it refreshes the token, then try again.',
    )
  }
  return {
    accessToken: oauth.accessToken,
    source,
    subscriptionType: oauth.subscriptionType ?? null,
    expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null,
  }
}

function readKeychain(): string | null {
  if (process.platform !== 'darwin') return null
  try {
    return execFileSync(
      'security',
      ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()
  } catch {
    return null
  }
}

export function loadToken(): LiveToken {
  const fromEnv = process.env.CLAUDE_CODE_OAUTH_TOKEN
  if (fromEnv) {
    return { accessToken: fromEnv, source: 'env', subscriptionType: null, expiresAt: null }
  }

  const file = join(configDir(), '.credentials.json')
  if (existsSync(file)) {
    return parseCredentials(readFileSync(file, 'utf8'), 'credentials-file')
  }

  const keychain = readKeychain()
  if (keychain) return parseCredentials(keychain, 'keychain')

  throw new LiveUsageError(
    `No Claude Code login found (looked for ${file}).`,
    'Run `claude` and log in with your Claude.ai account first, or set CLAUDE_CODE_OAUTH_TOKEN.',
  )
}

export async function fetchLiveUtilization(token: LiveToken): Promise<Utilization> {
  let response: Response
  try {
    response = await fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        'anthropic-beta': OAUTH_BETA_HEADER,
        'Content-Type': 'application/json',
        'User-Agent': 'claude-code-usage-boost-demo',
      },
      signal: AbortSignal.timeout(8000),
    })
  } catch (err) {
    throw new LiveUsageError(
      `Could not reach ${USAGE_URL}: ${err instanceof Error ? err.message : String(err)}`,
      'Check your network connection or proxy settings.',
    )
  }

  if (response.status === 401 || response.status === 403) {
    throw new LiveUsageError(
      `Anthropic rejected the saved login (HTTP ${response.status}).`,
      'Run `claude` once so it refreshes the token, then try again.',
    )
  }
  if (!response.ok) {
    throw new LiveUsageError(
      `Usage endpoint returned HTTP ${response.status}.`,
      'Try again in a minute; if it persists, run /usage inside Claude Code to compare.',
    )
  }

  const data = (await response.json()) as Utilization
  if (!data.five_hour && !data.seven_day) {
    throw new LiveUsageError(
      'The account returned no plan limits.',
      '/usage is only available for Claude.ai subscription plans (Pro, Max, Team).',
    )
  }
  return data
}
