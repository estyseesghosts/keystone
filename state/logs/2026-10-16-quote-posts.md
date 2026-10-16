# 2026-10-16 — Quote posts (`docs/quote-posts.md` implementation)

Goal: implement the quote-posts guide into Keystone so quotes render
perfectly. Testing/cross-backend verification is the Pinetree
implementer's job; this session is Keystone implementation only.

## What changed (`frontend/` only)

- `src/api/quote.ts` (new): the single normalizer boundary.
  - `QuoteTarget` (`noteId`/`uri`/`targetUnavailable`/`source`/
    `authorizationStatus`) + `getQuoteTarget()`: structured
    `renote`/`renoteId` and Pinetree `quoteTargetUri` /
    `quoteTargetUnavailable` / `quoteAuthorizationStatus` first; terminal
    `RE:` fallback only when unstructured; pure reposts → null.
    Missing status stays missing (never mapped to rejected).
  - `parseTextualQuote()`: narrow terminal-`RE:` parse — end-anchored,
    exactly one URL, surrounding whitespace + ordinary trailing
    punctuation trimmed, credentials/non-web/relative/mid-sentence/
    multi-token/non-boundary `RE:` rejected, final suffix wins.
  - `resolveQuoteUri()`: authed `ap/show` via `apiCall`, `type: "Note"`
    + Note-like only; completed (incl. failures) + in-flight dedupe,
    bounded caches, seen-note reuse. Never fetches directly, never
    bypasses visibility.
  - `statusLabelFor()`: neutral labels; `approved`/missing → null.
- `src/api/types.ts`: `Note` gains optional `uri`/`url` (dup-suffix
  matching only) and Pinetree `quoteTargetUri`/`quoteTargetUnavailable`/
  `quoteAuthorizationStatus` (absent on Misskey/Sharkey).
- `src/components/NoteBody.tsx`: the single quote path. Packed `renote`
  embeds directly; URI targets resolve at depth 0 only (resolving
  indicator → card or stable unavailable box); depth ≥ 1 collapses to a
  link (no fetch, no recursion); failed textual lookups keep the original
  text; suffix suppression is view-only and duplicate-only; status label
  never gates. Compose untouched (structured `renoteId`, no `RE:`
  rewriting).
- `src/routes/Note.tsx`: removed the duplicate "Renoted" section (the
  embed already renders the one card); dropped the now-unused import.
- `src/styles/global.css`: `.quote-status` / `.quote-unavailable` /
  `.quote-resolving` in the grey palette.
- `docs/api-surface.md` (+`ap/show` row), `docs/frontend-plan.md` (quote
  slice) updated.

## Evidence (executed)

- `npm run build`: green (162.28 kB JS). `tsc --noEmit`: clean (caught
  and fixed a dropped `MfmRenderer` import).
- Normalizer/resolver checks (real `quote.ts`, stubbed transport):
  **64/64** (`/tmp/opencode/quote_test/`, esbuild bundle + node).
- Live probe vs Misskey `:3101` + Sharkey `:3102`: structured quotes
  pack `renoteId` + `renote` with no status field; `ap/show {uri}`
  authed → 200 `{type:"Note", object}` for canonical URLs; missing →
  400 `NO_SUCH_OBJECT` / 500 (client treats all errors as null);
  anonymous → 401 (fails closed, text kept). Local notes pack no
  `uri`/`url`, so local dup-suffix suppression stays conservative
  (text intact + one structured card), per the exact-duplicate rule.
- SolidJS `solidjs.md` §10 checklist applied to `NoteBody` (props read
  reactively, memos for derived state, `createResource` for the lookup,
  side-effect-only `createEffect` for the seen registry, no dep arrays,
  no React).

## Open / next

- Uncommitted (this slice + the earlier renote/quote slice both pending
  owner review): `git status` shows `M` on docs/api-surface.md,
  docs/frontend-plan.md, frontend/src/{api/types.ts,components/Note*.tsx,
  routes/Note.tsx,styles/global.css} plus new `src/api/quote.ts`,
  `docs/quote-posts.md`, `state/logs/2026-10-16-renote-quote.md`.
- Browser visuals (quote cards, resolving/unavailable states, status
  labels, menu flow, desktop + mobile): **not yet verified** — no browser
  in this environment; owner rig owns the QA pass.
- Pinetree `quoteTargetUri` / `quoteTargetUnavailable` /
  `quoteAuthorizationStatus` paths are implemented but unexercised
  against a live Pinetree (running binary predates them) — Pinetree
  implementer's cross-verification covers this.
