# 2026-10-21 — Contrast sweep — coordinator

Branch: `main` (owner direction: main only)
Goal: eliminate every hardcoded/unthemed foreground app-wide; add a lint
rule so it cannot recur.

## Why piecemeal failed

The reported symptom (black display names) had several independent
causes, and each earlier fix only covered one surface. The exhaustive
pass found the big one: `RichText` post bodies/bios/code blocks were raw
RN `Text` (defaults to black) — every post body in dark mode.

## Did (three disjoint subagents + coordinator close-out)

- **Stream A (feed content):** `RichText` flow/code/inline-fallback now
  `palette.text` (nested styles inherit); `EmojiImage` fallbacks themed +
  `textStyle` override; `ReactionChips`/`ActionBar` mine-state fallbacks
  drawn in `palette.bg`; `PendingEmoji` `#888` → `palette.muted`;
  `MediaGrid`/`PostPoll`/`PostQuote`/`LinkCard` get explicit paired
  `palette.bg`. New `EmojiImage`/`PendingEmoji`/`Post/contrast` suites
  assert both themes.
- **Stream B (chrome + lint rule):** `Dialog` scrim + `Lightbox` chrome
  literals moved to new sanctioned `overlayChrome` constant in
  `src/alf/themes.ts`; `NotificationRow` avatar fallback gets explicit
  `bgSoft`. New `keystone/no-hardcoded-color` ESLint rule (hex, black/
  white, rgb/hsl; allowlists `themes.ts` + fixtures), wired in
  `eslint.config.mjs`, 13 rule tests, planted-literal proof.
- **Stream C (screens + shell):** `Compose`/`ProfileEditor` scrims →
  `overlayChrome.backdrop` + opacity; ten `RefreshControl` spinners
  themed (`tintColor`/`colors`/`progressBackgroundColor`) across feeds;
  raw-`Text` test probes → `Body`. `packages/fedi` grep: zero literals.
  New `shell-contrast.test.tsx` (both themes).
- **Coordinator:** fixed the 4 leftover rule hits in test files
  (palette refs instead of literals), verified `TextField` + `SysDebug`
  clean (unowned paths), ran the FULL suite.

## Tests / verification

- Full: **127 suites / 1521 tests pass** (was 119/1425 at W8).
- `tsc` ios + android + web: clean. `eslint src lint-rules`: clean
  (new rule green on whole tree). `oxlint`: clean.
- Device/web visual runs → `not verified`.

## Commits on `main`

- `38f9ba7` contrast sweep (all three streams + coordinator close-out)

## Next

1. Owner visual pass, both themes, phone + rail.
2. Full `pnpm typecheck && pnpm lint && pnpm test` on a pnpm rig.

STATUS: complete.
