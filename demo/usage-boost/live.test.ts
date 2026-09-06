import { expect, test } from 'bun:test'
import { LiveUsageError, parseCredentials } from './live.js'

const now = 1_800_000_000_000

test('parses a valid Claude.ai login', () => {
  const json = JSON.stringify({
    claudeAiOauth: {
      accessToken: 'sk-ant-oat01-example',
      refreshToken: 'sk-ant-ort01-example',
      expiresAt: now + 60_000,
      scopes: ['user:profile', 'user:inference'],
      subscriptionType: 'max',
    },
  })
  const token = parseCredentials(json, 'credentials-file', now)
  expect(token.accessToken).toBe('sk-ant-oat01-example')
  expect(token.subscriptionType).toBe('max')
  expect(token.source).toBe('credentials-file')
})

test('rejects an expired token with a refresh hint', () => {
  const json = JSON.stringify({
    claudeAiOauth: { accessToken: 'x', expiresAt: now - 1 },
  })
  expect(() => parseCredentials(json, 'credentials-file', now)).toThrow(LiveUsageError)
  try {
    parseCredentials(json, 'credentials-file', now)
  } catch (e) {
    expect((e as LiveUsageError).hint).toContain('refreshes the token')
  }
})

test('rejects a file with no Claude.ai login', () => {
  expect(() => parseCredentials('{}', 'credentials-file', now)).toThrow(/No Claude.ai login/)
})

test('rejects malformed JSON', () => {
  expect(() => parseCredentials('{not json', 'credentials-file', now)).toThrow(/not valid JSON/)
})
