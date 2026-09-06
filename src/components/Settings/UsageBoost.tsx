import * as React from 'react'
import { useState } from 'react'
import { Box, Text } from '../../ink.js'
import { useKeybinding } from '../../keybindings/useKeybinding.js'
import type { Utilization } from '../../services/api/usage.js'
import {
  applyUsageBoost,
  type UsageBoostQuote,
} from '../../services/api/usageBoost.js'
import { formatResetText } from '../../utils/format.js'
import { logError } from '../../utils/log.js'
import {
  clampBoostPercent,
  computeBoostPreview,
  suggestedBoostPercent,
} from '../../utils/usageBoost.js'
import { Byline } from '../design-system/Byline.js'
import { ProgressBar } from '../design-system/ProgressBar.js'
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js'

type Props = {
  quote: UsageBoostQuote
  utilization: Utilization
  maxWidth: number
  onApplied: (utilization: Utilization, summary: string) => void
  onCancel: () => void
}

function pct(n: number): string {
  return `${Math.round(n)}%`
}

type BeforeAfterBarProps = {
  title: string
  before: number
  after: number
  resetsAt: string | null | undefined
  width: number
  improves: boolean
}

function BeforeAfterBar({
  title,
  before,
  after,
  resetsAt,
  width,
  improves,
}: BeforeAfterBarProps): React.ReactNode {
  const delta = after - before
  const deltaText =
    Math.abs(delta) < 0.05
      ? 'no change'
      : `${delta > 0 ? '+' : '−'}${Math.abs(delta).toFixed(1)} pts`
  return (
    <Box flexDirection="column">
      <Text>
        <Text bold>{title}</Text>
        {resetsAt && (
          <Text dimColor> · Resets {formatResetText(resetsAt, true, true)}</Text>
        )}
      </Text>
      <Box flexDirection="row" gap={1}>
        <ProgressBar
          ratio={after / 100}
          width={width}
          fillColor={improves ? 'success' : 'rate_limit_fill'}
          emptyColor="rate_limit_empty"
        />
        <Text>
          <Text dimColor>{pct(before)} → </Text>
          <Text bold color={improves ? 'success' : 'warning'}>
            {pct(after)}
          </Text>
          <Text dimColor> used ({deltaText})</Text>
        </Text>
      </Box>
    </Box>
  )
}

/**
 * Interactive switcher that moves weekly (all models) headroom into the
 * current 5-hour session. ◂ ▸ adjust the amount, Enter applies, Esc backs
 * out to the plain usage view.
 */
export function UsageBoost({
  quote,
  utilization,
  maxWidth,
  onApplied,
  onCancel,
}: Props): React.ReactNode {
  const [sessionPercent, setSessionPercent] = useState(() =>
    suggestedBoostPercent(quote, utilization),
  )
  const [isApplying, setIsApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const preview = computeBoostPreview(quote, utilization, sessionPercent)
  const barWidth = Math.max(10, Math.min(40, maxWidth - 34))

  const adjust = (direction: 1 | -1) => {
    if (isApplying) return
    setError(null)
    setSessionPercent(prev =>
      clampBoostPercent(quote, prev + direction * quote.step_percent),
    )
  }

  const apply = async () => {
    if (isApplying || !preview.canApply) return
    setIsApplying(true)
    setError(null)
    try {
      const result = await applyUsageBoost(quote, utilization, sessionPercent)
      onApplied(
        result.utilization,
        `Boosted session by ${result.granted_session_percent}% using ${result.charged_weekly_percent}% of your weekly limit.`,
      )
    } catch (err) {
      logError(err as Error)
      setError(err instanceof Error ? err.message : 'Failed to apply boost')
    } finally {
      setIsApplying(false)
    }
  }

  const keyOpts = { context: 'Settings' as const, isActive: !isApplying }
  useKeybinding('usageBoost:increase', () => adjust(1), keyOpts)
  useKeybinding('usageBoost:decrease', () => adjust(-1), keyOpts)
  useKeybinding('settings:close', () => void apply(), {
    context: 'Settings',
    isActive: !isApplying && preview.canApply,
  })
  useKeybinding('confirm:no', onCancel, keyOpts)

  const atMin = sessionPercent <= quote.min_session_percent
  const atMax = sessionPercent >= quote.max_session_percent

  return (
    <Box flexDirection="column" gap={1} width="100%">
      <Box flexDirection="column">
        <Text bold>Boost current session</Text>
        <Text dimColor>
          Move part of your weekly (all models) limit into the 5-hour window.
          What you add here is charged to the week at{' '}
          {quote.exchange_rate.toFixed(2)} weekly pts per session pt.
        </Text>
      </Box>

      <Box flexDirection="row" gap={1}>
        <Text dimColor={atMin}>◂</Text>
        <Text bold color="rate_limit_fill">
          +{preview.sessionPercent}% session capacity
        </Text>
        <Text dimColor={atMax}>▸</Text>
        <Text dimColor>
          costs {preview.weeklyCost.toFixed(1)}% of weekly
        </Text>
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

      {preview.blockedReason && (
        <Text color="warning">{preview.blockedReason}</Text>
      )}
      {error && <Text color="error">Error: {error}</Text>}
      {isApplying && <Text dimColor>Applying boost…</Text>}

      <Text dimColor>
        <Byline>
          <ConfigurableShortcutHint
            action="usageBoost:decrease"
            context="Settings"
            fallback="←"
            description="less"
          />
          <ConfigurableShortcutHint
            action="usageBoost:increase"
            context="Settings"
            fallback="→"
            description="more"
          />
          <ConfigurableShortcutHint
            action="settings:close"
            context="Settings"
            fallback="Enter"
            description="apply"
          />
          <ConfigurableShortcutHint
            action="confirm:no"
            context="Settings"
            fallback="Esc"
            description="back"
          />
        </Byline>
      </Text>
    </Box>
  )
}
