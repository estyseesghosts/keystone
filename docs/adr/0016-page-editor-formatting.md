# ADR 0016 — Page editor formatting: render-on-blur (option B)

Date: 2026-10-30
Status: accepted (reversible — see O2 below)
Plan ref: `docs/p6.5-pages.md` §5 Slice 0 (which calls this "ADR 0014";
0014 is taken by the notification-unread ADR, so this is 0016)

## Context

Slice 6 needs formatted text while editing. Option A was
`@expensify/react-native-live-markdown` 0.1.364 with a custom MFM worklet
parser; option B renders `RichText` in the unfocused block and edits raw
source on focus. The spike (`p6.5-pages` branch, throwaway; evidence in
`state/logs/assets-p6.5-pages/`, log `2026-10-26-p6.5-pages-program.md`)
ran the vendor component on a physical OPPO (Android 17) against a dev
client.

## What the spike proved (and broke)

Works:

- Custom `parser` prop with exactly the needed range kinds; a
  self-contained worklet parser for the §1 subset renders correctly on
  the UI thread (bold/italic incl. the ASCII-only rule — `*日本語*`
  stays plain, strikethrough, code, pre, blockquote, link, dimmed
  `center`/`small` tags). Typing, `onChangeText`, `onSelectionChange`,
  and programmatic selection all verified on-device with screenshots.
- Web bundle compiles with the screen in it; jest renders via a manual
  mock (repo convention — the vendor mock's getter chain resolves
  `undefined` under this repo's CJS interop).

Blockers (each independently load-bearing):

1. **Import-time crash.** The package root unconditionally evaluates the
   default ExpensiMark parser module, which throws at import time on
   native dev builds unless `html-entities` (exact 2.5.3) is
   worklet-patched inside `node_modules` — i.e. patch-package plus a
   postinstall mutation for every contributor and CI. The only way
   around is a deep CJS import with no shipped types (`@ts-expect-error`)
   and per-path jest mocks. Verified by redbox on device.
2. **Install blocked by default.** pnpm 12 refuses the git-sourced
   transitive dep (`simply-deferred` via auto-installed `expensify-common`
   peer). No per-package opt-out exists; shipping A needs
   `blockExoticSubdeps: false` repo-wide — unacceptable under the X2.1 /
   X11.1 / ADR-0008 supply-chain posture for a UI nicety. `expensify-common`
   itself is dead weight at runtime (nothing in the native path imports it).
3. **Two parsers forever.** A worklet cannot import mfm-js, so the live
   ranges would be a hand-rolled regex fork of `mfmFormat.ts` (slice 1)
   drifting independently.
4. **Unverified remainder.** CJK IME composition is not agent-drivable
   (`adb input text` NPEs on CJK in the device shell); iOS never ran.
   The verified set (typing/selection/programmatic/web-bundle/jest) is
   necessary but not sufficient for a new-dependency decision.

## Decision

**Option B (render-on-blur)** per plan §6: unfocused text blocks render
`RichText`; tapping focuses the raw input; the Slice 5 toolbar works
while focused via the tested `mfmFormat` module. Zero new dependencies,
zero config changes, zero node_modules patches.

## Consequences

- Good: no supply-chain exception, no worklet parser fork, no deep-import
  type holes, no per-path jest mocks. Slice 6 is pure app code.
- Bad / accepted risk: no live styling while typing (matches v1's
  textarea). If a future live-markdown ships a side-effect-free entry
  point and a registry (not git) dep tree, re-spike — the worklet parser
  (`spike/mfmRanges.ts`, deleted with the spike) and these screenshots
  are the starting point.
- O2 (owner approval incl. new dep) is moot: no new dependency ships.
- O3 stands: keep `center` + `small` controls (both render and parse).
