import React from 'react'
import { render } from 'ink'
import { App, type ScenarioName } from './UsageBoostDemo.js'

const arg = process.argv.find(a => a.startsWith('--scenario='))?.split('=')[1]
const scenario: ScenarioName =
  arg === 'tight' || arg === 'healthy' || arg === 'screenshot' ? arg : 'screenshot'

render(<App scenario={scenario} />)
