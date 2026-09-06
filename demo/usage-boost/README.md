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

Why not the real CLI: this snapshot's shared Ink wrapper pulls in the whole
tree (1,700+ files), including Anthropic-internal packages and native modules
that are not published, so the CLI itself cannot be built from here.
