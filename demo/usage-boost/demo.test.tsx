import { expect, test } from 'bun:test'
import { render } from 'ink-testing-library'
import React from 'react'
import { App } from './UsageBoostDemo.js'

const tick = (ms = 30) => new Promise(r => setTimeout(r, ms))
const ESC = '\u001B'
const RIGHT = `${ESC}[C`
const LEFT = `${ESC}[D`
const ENTER = '\r'

test('screenshot scenario: nudge, open, adjust, apply', async () => {
  const { lastFrame, stdin } = render(<App scenario="screenshot" columns={100} />)
  await tick()
  expect(lastFrame()).toContain('81% used')
  expect(lastFrame()).toContain('21% used')
  expect(lastFrame()).toContain('nearly used up')
  expect(lastFrame()).toContain('b to boost session')

  stdin.write('b')
  await tick()
  expect(lastFrame()).toContain('Boost current session')
  expect(lastFrame()).toContain('+40% session capacity')
  expect(lastFrame()).toContain('costs 6.0% of weekly')
  expect(lastFrame()).toContain('81% → 58%')

  stdin.write(RIGHT)
  await tick()
  expect(lastFrame()).toContain('+50% session capacity')
  expect(lastFrame()).toContain('costs 7.5% of weekly')
  expect(lastFrame()).toContain('81% → 54%')
  expect(lastFrame()).toContain('21% → 29%')

  stdin.write(ENTER)
  await tick(450)
  expect(lastFrame()).toContain('Boosted session by 50% using 7.5% of your weekly limit.')
  expect(lastFrame()).toContain('54% used')
  expect(lastFrame()).toContain('28% used')
  expect(lastFrame()).not.toContain('nearly used up')
})

test('tight scenario: boost is blocked and Enter does nothing', async () => {
  const { lastFrame, stdin } = render(<App scenario="tight" columns={100} />)
  await tick()
  expect(lastFrame()).not.toContain('nearly used up')
  stdin.write('b')
  await tick()
  expect(lastFrame()).toContain('Not enough weekly headroom')
  stdin.write(ENTER)
  await tick(450)
  expect(lastFrame()).toContain('Boost current session')
  stdin.write(LEFT)
  await tick()
  expect(lastFrame()).toContain('+10% session capacity')
  stdin.write(ESC)
  await tick()
  expect(lastFrame()).toContain('94% used')
})
