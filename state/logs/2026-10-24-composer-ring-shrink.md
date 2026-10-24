# 2026-10-24 — Composer web focus ring + non-shrinking autogrow — agent

Branch: `main` (direct; owner drive-by fix, no plan slice).
Goal: kill the desktop/web focus outline on the composer textfield, and
make the autogrowing composer contract when text is deleted.

## Did

- **Focus ring** (`CompactComposer.tsx`, `Composer.tsx`): added
  `outlineColor: 'transparent'` next to the existing `outlineWidth: 0`.
  Width-only does not kill every UA's ring (Safari keeps painting `auto`);
  transparent color is invisible whatever style the UA insists on.
  `outlineStyle: 'none'` was tried first but RN's `TextStyle` omits it
  (type error) — transparent is type-clean and equally final. Verified
  the RNW compiler emits both rules (`outline-width: 0px`,
  `outline-color: rgba(0,0,0,0)`); no global CSS or RNW focus-ring code
  competes. Scoped to the two composer main inputs only (settings
  `TextField`s keep their rings).
- **Autogrow shrink** (`useAutogrowInput.ts`): root cause — on web, RNW
  reports `scrollHeight`, which never drops below an explicit height, so
  after deleting text the contentSize event keeps reporting the old box
  and the field only ever grew (hook-level contract was already correct;
  the event stream was stuck). Added web-only imperative `remeasure`:
  drop inline height to `auto`, read `scrollHeight`, restore (one sync
  block, no paint), clamp. Wired into both composers'
  `onChangeText` + `ref`. Native keeps the event path (works there).
- **Tests** (`useAutogrowInput.test.ts` +3): native no-op, web
  contract-to-90/floor/ceiling with inline-height restore, malformed
  node ignored.

## Decided

- No ADR (bug fixes; the chrome-free composer language predates this).
- Did not touch `TextField`: focus visibility there is a feature.

## Tests / verification

- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` clean.
- `pnpm test` → **196 suites / 2483 tests green** (+3).
- Web visual: `not verified` — no desktop browser attached to this
  session (built `dist/` + local server, but the browser tool has no
  connected pane; `localhost` unreachable from it by design). Owner to
  confirm the ring is gone on their desktop Safari/Chrome.

## Deviations

- Touched only the two composer inputs, the autogrow hook, and its test.
  Untracked owner drops (`docs/`, `ios/`, …) untouched.

## Next

- Owner: confirm ring gone + shrink works on desktop web; push `main`.
