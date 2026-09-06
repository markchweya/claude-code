import React, { useState } from 'react'
import { Box, Text, useApp, useInput } from 'ink'
import type { Utilization } from '../../src/services/api/usage.js'
import {
  applyBoostToUtilization,
  clampBoostPercent,
  computeBoostPreview,
  shouldSuggestUsageBoost,
  suggestedBoostPercent,
  type UsageBoostQuote,
} from '../../src/utils/usageBoost.js'
import { ProgressBar } from './ProgressBar.js'
import { theme } from './theme.js'

/**
 * Standalone, runnable twin of the /usage panel + boost switcher.
 *
 * Layout, copy and colours mirror src/components/Settings/Usage.tsx and
 * UsageBoost.tsx line for line. The math is not mirrored — it IS the shipped
 * module (src/utils/usageBoost.ts). Only the plumbing differs: plain Ink
 * useInput instead of the CLI's keybinding contexts, and a local quote and
 * utilization instead of the OAuth usage endpoints.
 */

// Same quote the CLI serves under CLAUDE_CODE_USAGE_BOOST_MOCK=1.
export const DEMO_QUOTE: UsageBoostQuote = {
  available: true,
  exchange_rate: 0.15,
  min_session_percent: 10,
  max_session_percent: 100,
  step_percent: 10,
}

export type ScenarioName = 'screenshot' | 'tight' | 'healthy'

const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString()

export function scenarioUtilization(name: ScenarioName): Utilization {
  const week = hours(6.78)
  switch (name) {
    case 'tight':
      return {
        five_hour: { utilization: 81, resets_at: hours(3.95) },
        seven_day: { utilization: 94, resets_at: week },
        seven_day_sonnet: { utilization: 88, resets_at: week },
      }
    case 'healthy':
      return {
        five_hour: { utilization: 40, resets_at: hours(4.2) },
        seven_day: { utilization: 21, resets_at: week },
        seven_day_sonnet: { utilization: 36, resets_at: week },
      }
    default:
      return {
        five_hour: { utilization: 81, resets_at: hours(3.95) },
        seven_day: { utilization: 21, resets_at: week },
        seven_day_sonnet: { utilization: 36, resets_at: week },
      }
  }
}

/** Mirrors formatResetText(resetsAt, true, true): "8:30am (Africa/Nairobi)". */
function formatReset(iso: string): string {
  const d = new Date(iso)
  let h = d.getHours()
  const m = String(d.getMinutes()).padStart(2, '0')
  const ap = h >= 12 ? 'pm' : 'am'
  h = h % 12 || 12
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC'
  return `${h}:${m}${ap} (${tz})`
}

const pct = (n: number) => `${Math.round(n)}%`

// ---------------------------------------------------------------- Usage tab

function LimitBar({ title, limit }: { title: string; limit: Utilization['five_hour'] }) {
  if (!limit || limit.utilization === null) return null
  return (
    <Box flexDirection="column">
      <Text bold>{title}</Text>
      <Box flexDirection="row" gap={1}>
        <ProgressBar
          ratio={limit.utilization / 100}
          width={50}
          fillColor={theme.rate_limit_fill}
          emptyColor={theme.rate_limit_empty}
        />
        <Text>{Math.floor(limit.utilization)}% used</Text>
      </Box>
      {limit.resets_at && <Text dimColor>Resets {formatReset(limit.resets_at)}</Text>}
    </Box>
  )
}

type UsageViewProps = {
  utilization: Utilization
  quote: UsageBoostQuote
  summary: string | null
  onOpenBoost: () => void
  onExit: () => void
}

function UsageView({ utilization, quote, summary, onOpenBoost, onExit }: UsageViewProps) {
  const canBoost = quote.available && !!utilization.five_hour && !!utilization.seven_day
  const suggest = shouldSuggestUsageBoost(quote, utilization)

  useInput((input, key) => {
    if (input === 'b' && canBoost) onOpenBoost()
    else if (key.escape) onExit()
  })

  return (
    <Box flexDirection="column" gap={1} width="100%">
      <LimitBar title="Current session" limit={utilization.five_hour} />
      <LimitBar title="Current week (all models)" limit={utilization.seven_day} />
      <LimitBar title="Current week (Sonnet only)" limit={utilization.seven_day_sonnet} />

      {summary && <Text color={theme.success}>✓ {summary}</Text>}

      {suggest && !summary && (
        <Box flexDirection="column">
          <Text color={theme.warning}>
            Your session limit is nearly used up, but most of your week is still available.
          </Text>
          <Text dimColor>
            Press <Text bold>b</Text> to shift some weekly headroom into this session before it runs out.
          </Text>
        </Box>
      )}

      <Text dimColor>{canBoost ? 'b to boost session · ' : ''}Esc to cancel</Text>
    </Box>
  )
}

// ------------------------------------------------------------- Boost switcher

type BeforeAfterBarProps = {
  title: string
  before: number
  after: number
  resetsAt: string | null | undefined
  width: number
  improves: boolean
}

function BeforeAfterBar({ title, before, after, resetsAt, width, improves }: BeforeAfterBarProps) {
  const delta = after - before
  const deltaText =
    Math.abs(delta) < 0.05 ? 'no change' : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} pts`
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{title}</Text>
        {resetsAt && <Text dimColor> · Resets {formatReset(resetsAt)}</Text>}
      </Text>
      <Box flexDirection="row" gap={1}>
        <ProgressBar
          ratio={after / 100}
          width={width}
          fillColor={improves ? theme.success : theme.rate_limit_fill}
          emptyColor={theme.rate_limit_empty}
        />
        <Text>
          <Text dimColor>{pct(before)} → </Text>
          <Text bold color={improves ? theme.success : theme.warning}>
            {pct(after)}
          </Text>
          <Text dimColor> used ({deltaText})</Text>
        </Text>
      </Box>
    </Box>
  )
}

type BoostViewProps = {
  quote: UsageBoostQuote
  utilization: Utilization
  maxWidth: number
  /** Numbers are the user's real ones; make clear the boost is simulated. */
  live?: boolean
  onApplied: (utilization: Utilization, summary: string) => void
  onCancel: () => void
}

function BoostView({ quote, utilization, maxWidth, live = false, onApplied, onCancel }: BoostViewProps) {
  const [sessionPercent, setSessionPercent] = useState(() => suggestedBoostPercent(quote, utilization))
  const [isApplying, setIsApplying] = useState(false)

  const preview = computeBoostPreview(quote, utilization, sessionPercent)
  const barWidth = Math.max(10, Math.min(40, maxWidth - 34))
  const atMin = sessionPercent <= quote.min_session_percent
  const atMax = sessionPercent >= quote.max_session_percent

  const adjust = (direction: 1 | -1) =>
    setSessionPercent(prev => clampBoostPercent(quote, prev + direction * quote.step_percent))

  const apply = () => {
    if (!preview.canApply) return
    setIsApplying(true)
    // Stand-in for the POST; the CLI awaits applyUsageBoost() here.
    setTimeout(() => {
      onApplied(
        applyBoostToUtilization(utilization, preview),
        `Boosted session by ${preview.sessionPercent}% using ${preview.weeklyCost}% of your weekly limit.` +
          (live ? ' (simulated — your real limits are unchanged)' : ''),
      )
    }, 300)
  }

  useInput(
    (_input, key) => {
      if (key.leftArrow) adjust(-1)
      else if (key.rightArrow) adjust(1)
      else if (key.return) apply()
      else if (key.escape) onCancel()
    },
    { isActive: !isApplying },
  )

  return (
    <Box flexDirection="column" gap={1} width="100%">
      <Box flexDirection="column">
        <Text bold>Boost current session</Text>
        <Text dimColor>
          Move part of your weekly (all models) limit into the 5-hour window. What you add here is
          charged to the week at {quote.exchange_rate.toFixed(2)} weekly pts per session pt.
        </Text>
      </Box>

      <Box flexDirection="row" gap={1}>
        <Text dimColor={atMin}>◂</Text>
        <Text bold color={theme.rate_limit_fill}>
          +{preview.sessionPercent}% session capacity
        </Text>
        <Text dimColor={atMax}>▸</Text>
        <Text dimColor>costs {preview.weeklyCost.toFixed(1)}% of weekly</Text>
      </Box>

      <BeforeAfterBar
        title="Current session"
        before={preview.sessionBefore}
        after={preview.sessionAfter}
        resetsAt={utilization.five_hour?.resets_at}
        width={barWidth}
        improves
      />
      <BeforeAfterBar
        title="Current week (all models)"
        before={preview.weeklyBefore}
        after={preview.weeklyAfter}
        resetsAt={utilization.seven_day?.resets_at}
        width={barWidth}
        improves={false}
      />

      {preview.blockedReason && <Text color={theme.warning}>{preview.blockedReason}</Text>}
      {isApplying && <Text dimColor>Applying boost…</Text>}
      {live && (
        <Text dimColor>
          Live mode is read-only: applying only updates this screen. Anthropic&apos;s servers
          would need the boost endpoint from the PR for it to take effect.
        </Text>
      )}

      <Text dimColor>← less · → more · Enter apply · Esc back</Text>
    </Box>
  )
}

// ------------------------------------------------------------------- Shell

export type LiveInfo = {
  source: 'env' | 'credentials-file' | 'keychain'
  subscriptionType: string | null
}

type AppProps = {
  scenario?: ScenarioName
  /** Real numbers from the usage endpoint; overrides `scenario` when set. */
  initialUtilization?: Utilization
  /** Present when the numbers came from the user's own account. */
  live?: LiveInfo
  /** Terminal columns; defaults to the real width, capped like the CLI. */
  columns?: number
}

export function App({ scenario = 'screenshot', initialUtilization, live, columns }: AppProps) {
  const { exit } = useApp()
  const [utilization, setUtilization] = useState(
    () => initialUtilization ?? scenarioUtilization(scenario),
  )
  const [boostOpen, setBoostOpen] = useState(false)
  const [summary, setSummary] = useState<string | null>(null)
  const maxWidth = Math.min((columns ?? process.stdout.columns ?? 80) - 2, 80)

  const liveLabel = live
    ? `live · your account${live.subscriptionType ? ` · ${live.subscriptionType}` : ''}`
    : 'sample data'

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.permission} paddingX={1}>
      <Box gap={2} marginBottom={1}>
        <Text dimColor>Status</Text>
        <Text dimColor>Config</Text>
        <Text bold underline color={theme.permission}>
          Usage
        </Text>
        <Text dimColor>· {liveLabel}</Text>
      </Box>
      {boostOpen ? (
        <BoostView
          quote={DEMO_QUOTE}
          utilization={utilization}
          maxWidth={maxWidth}
          live={!!live}
          onApplied={(next, text) => {
            setUtilization(next)
            setSummary(text)
            setBoostOpen(false)
          }}
          onCancel={() => setBoostOpen(false)}
        />
      ) : (
        <UsageView
          utilization={utilization}
          quote={DEMO_QUOTE}
          summary={summary}
          onOpenBoost={() => {
            setSummary(null)
            setBoostOpen(true)
          }}
          onExit={exit}
        />
      )}
    </Box>
  )
}
