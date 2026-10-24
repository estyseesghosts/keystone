# 2026-10-24 — Composer outline-style none (third attempt) — agent

Branch: `main` (direct; owner follow-up, no plan slice).
Goal: kill the white focus ring that survived `outline-width: 0` and
`outline-color: transparent` on the inline composer textfield.

## Did

- New `src/components/Composer/noOutline.ts`: `NO_OUTLINE` =
  `{outlineStyle: 'none'}` on web, null on native. Rationale: width-only
  + transparent color demonstrably did not kill the UA's `auto`-style
  ring in production; no engine paints an outline whose style is `none`.
  RN's `TextStyle` omits the value but RNW passes it straight to CSS
  (verified against its style compiler: emits `outline-style: none`),
  hence the one contained cast. Spread into both composer inputs
  (inline + modal), replacing the weaker comments.
- Ruled out "our own border": the inline input has no border/outline/
  shadow anywhere near it; the only near-white (`borderStrong #ededed`)
  usage is suggestion chips, not the input. The ring is engine-painted
  focus indication, not our chrome.

## Decided

- No ADR. If `none` does not kill it either, the ring is not
  CSS-outline at all — next step is the user's browser identity + live
  DOM inspection (or a global `!important` rule as last resort).

## Tests / verification

- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` clean.
- `pnpm test` → **196 suites / 2484 tests green** (no test delta —
  style-only change).
- Web visual: `not verified` — no desktop browser attached to this
  session. Owner to confirm on desktop web.

## Deviations

- Touched only the two composer inputs + the new module.

## Next

- Owner: visual confirm; push `main`.
