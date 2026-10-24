# 2026-10-24 — Matrix user-ID chips + hovercard — agent

Branch: `main` (direct; standing owner instruction).
Goal: owner request with mock — `@handle:domain` Matrix IDs get
`[m]` chips (they were misread as local `@handle` mentions), hover
shows a small profile-style card (exact text, what-Matrix-is copy,
Copy handle), and chips render in profile additional fields.

## Did (fedi, pure)

- `core/content/ast.ts`: new `matrix` node (`userId` + exact-text
  children). New `parseMatrixUserId` (single validity gate: `@local`
  alphabet, DNS-dot server, optional `:port`, case verbatim),
  `matrixLabelOf` (lone-label mirror), `splitMatrixMatch`
  (lead/id/trail splitter for the scanners). `mentionLabelOf`
  explicitly rejects colon labels. Mention scanners
  (translated-text, fields) match the matrix shape FIRST so `@local`
  can never win with `:server` trailing. Readers need no change
  (children flow through `default`); translated hashtags untouched.
- `core/content/fromMfm.ts`: `mergeMatrixMentions` rejoins the
  mfm-js split (local mention + `:server` text) into one matrix node
  — DNS-dot + no-space required, so `@user: hello` and `@3:30` never
  merge. `link`-label matrix/markdown also normalizes (href dropped).
- `core/content/fromHtml.ts`: unclassed matrix-labelled anchors
  become matrix nodes (classed mention/hashtag anchors untouched).
- `core/content/fields.ts`: bare + markdown-label matrix IDs chip
  (web URL dropped — the chip never navigates).
- `mastodon/presentation.ts`: matrix is fold-atomic (never cut,
  never ellipsis-extended, like hashtags).

## Did (app)

- `RichText.tsx`: `case 'matrix'` → `[m] handle` chip (no `@`,
  per mock). Web wraps the chip in a hover shell (~400ms, mirroring
  HoverPreview) floating the card in the click-through `HoverLayer`
  (exported for this; never a Modal, never fullscreen) — Escape /
  scroll / leave dismiss. Native has no hover: tap copies + toast.
  `MatrixHovercard` (exported): exact written text, the Matrix
  description, Copy handle (capability-gated with reason, never
  inert). Taps never navigate, on any target. Popup shows on hover
  only — no tap-to-open on web beyond keyboard/a11y press.
- HoverPreview.tsx: `HoverLayer` exported (additive, no behavior
  change). Mid-session course correction: the first pass used a
  fullscreen `Dialog` — replaced per owner feedback before commit.

## Tests

- fedi: `parseMatrixUserId` / `matrixLabelOf` units (+ mention
  rejection), translated matrix + timestamp guard, MFM merge +
  non-merge + markdown, HTML anchor, field bare/markdown/HTML,
  fold atomicity + reader projection.
- app: `richtext-matrix.test.tsx` (chip label, no mention chip,
  native tap copies, hovercard content + copy), field chip test
  (matrix chip present, mention chip absent).
- `pnpm typecheck` (ios+android+web) clean; `pnpm lint` clean.
- `pnpm test` → **199 suites / 2599 tests green**.
- Device/web visual + live-server fields: `not verified` (owner
  compares against the mock).

## Next

- Owner hover + fields visual check; push `main`.
