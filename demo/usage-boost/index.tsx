import React from 'react'
import { render } from 'ink'
import { fetchLiveUtilization, loadToken, LiveUsageError } from './live.js'
import { App, type ScenarioName } from './UsageBoostDemo.js'

const args = process.argv.slice(2)
const live = args.includes('--live')
const scenarioArg = args.find(a => a.startsWith('--scenario='))?.split('=')[1]
const scenario: ScenarioName =
  scenarioArg === 'tight' || scenarioArg === 'healthy' || scenarioArg === 'screenshot'
    ? scenarioArg
    : 'screenshot'

if (!live) {
  render(<App scenario={scenario} />)
} else {
  process.stdout.write('Reading your Claude Code login and fetching usage…\n')
  try {
    const token = loadToken()
    const utilization = await fetchLiveUtilization(token)
    render(
      <App
        initialUtilization={utilization}
        live={{ source: token.source, subscriptionType: token.subscriptionType }}
      />,
    )
  } catch (err) {
    if (err instanceof LiveUsageError) {
      process.stderr.write(`\n${err.message}\n  → ${err.hint}\n\n`)
    } else {
      process.stderr.write(`\nUnexpected error: ${err instanceof Error ? err.message : String(err)}\n\n`)
    }
    process.exit(1)
  }
}
