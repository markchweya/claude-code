import { test, expect } from 'bun:test'
import * as b from './usageBoost.js'
const q = { available: true, exchange_rate: 0.15, min_session_percent: 10, max_session_percent: 100, step_percent: 10 }
const u = { five_hour: { utilization: 81, resets_at: null }, seven_day: { utilization: 21, resets_at: null } }
test('preview from screenshot numbers', () => {
  const p = b.computeBoostPreview(q, u, 50)
  expect(p.sessionAfter).toBe(54)
  expect(p.weeklyCost).toBe(7.5)
  expect(p.weeklyAfter).toBe(28.5)
  expect(p.canApply).toBe(true)
})
test('clamps and snaps', () => {
  expect(b.clampBoostPercent(q, 3)).toBe(10)
  expect(b.clampBoostPercent(q, 44)).toBe(40)
  expect(b.clampBoostPercent(q, 500)).toBe(100)
})
test('suggested boost targets 60%', () => {
  // 81/1.4 = 57.9 <= 60, 81/1.3 = 62.3 > 60 → 40
  expect(b.suggestedBoostPercent(q, u)).toBe(40)
})
test('blocked when week is nearly spent', () => {
  const p = b.computeBoostPreview(q, { ...u, seven_day: { utilization: 93, resets_at: null } }, 20)
  expect(p.canApply).toBe(false)
  expect(b.maxAffordableBoostPercent(q, 93)).toBe(10)
  expect(b.maxAffordableBoostPercent(q, 95)).toBe(0)
})
test('nudge logic', () => {
  expect(b.shouldSuggestUsageBoost(q, u)).toBe(true)
  expect(b.shouldSuggestUsageBoost(q, { ...u, seven_day: { utilization: 70, resets_at: null } })).toBe(false)
  expect(b.shouldSuggestUsageBoost(q, { ...u, five_hour: { utilization: 40, resets_at: null } })).toBe(false)
  expect(b.shouldSuggestUsageBoost({ ...q, available: false }, u)).toBe(false)
})
test('apply to utilization mutates both bars', () => {
  const next = b.applyBoostToUtilization(u, b.computeBoostPreview(q, u, 50))
  expect(next.five_hour!.utilization).toBe(54)
  expect(next.seven_day!.utilization).toBe(28.5)
})
