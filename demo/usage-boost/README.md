# Usage boost switcher · terminal demo

Runs the `/usage` session boost switcher in a real terminal with the real Ink
renderer, outside the Claude Code binary.

The math is the shipped module (`src/utils/usageBoost.ts`). Layout, copy and
colours mirror `src/components/Settings/Usage.tsx` and `UsageBoost.tsx`. What
is swapped out is plumbing only: plain Ink `useInput` instead of the CLI's
keybinding contexts, and a local quote and utilization instead of the OAuth
usage endpoints.

```sh
cd demo/usage-boost
bun install
bun start                          # your screenshot: 81% session, 21% week
bun start --scenario=tight         # 81% / 94%: boost is blocked
bun start --scenario=healthy       # 40% / 21%: no nudge, b still works
bun test                           # drives the UI with real key presses
```

Keys: `b` opens the switcher, `←`/`→` adjust, `Enter` applies, `Esc` backs
out (and exits from the usage view).

## Live mode: your real usage

```sh
bun start --live
```

Reads the OAuth token Claude Code saved when you logged in and calls the
same endpoint the real `/usage` command calls, so the bars show your actual
5-hour, weekly and Sonnet percentages. Token sources, in order:

1. `CLAUDE_CODE_OAUTH_TOKEN` environment variable
2. `.credentials.json` in `CLAUDE_CONFIG_DIR` or `~/.claude`
   (`%USERPROFILE%\.claude\.credentials.json` on Windows)
3. the macOS keychain entry `Claude Code-credentials`

Live mode is **read-only**. The switcher still works on your real numbers,
but `Enter` only updates the screen: limits are enforced by Anthropic's
servers and there is no endpoint that moves weekly allowance into the 5-hour
window. The PR defines what that endpoint would look like.

Your token never leaves your machine except in the request to
`api.anthropic.com`, exactly as the CLI sends it. Don't commit or share the
credentials file.

Why not the real CLI: this snapshot's shared Ink wrapper pulls in the whole
tree (1,700+ files), including Anthropic-internal packages and native modules
that are not published, so the CLI itself cannot be built from here.
