# 2026-10-16 — Quote visual parity + auto translation (handoff)

Goal: execute `docs/quote-polish-translate-handoff.md` workstreams A (quote
looks like the competitor) + B (auto translation) in order. Owner handles
all live browser testing (signed in on dvd.chat); nothing below was seen in
a browser — browser QA stays **not yet verified**.

## Workstream A — quote posts

`frontend/src/components/NoteBody.tsx` + `frontend/src/styles/global.css`:

1. **Card shape:** `.renote-embed` is now 16px radius, 16px padding,
   1px `var(--border)` border, `overflow:hidden`. Palette untouched.
2. **Quoted header:** avatar (24px, existing `Avatar` fallback included) +
   display name + `@handle · time`. Time reuses the exact `formatTime`
   previously private to `NoteCard` — extracted verbatim to new
   `frontend/src/components/time.ts` (no second formatter; extraction also
   avoids a NoteCard↔NoteBody import cycle, `NoteCard` re-exports it).
3. **Quoted text truncates:** `.renote-embed .trans-text` line-clamps to 4
   (`-webkit-line-clamp` + standard `line-clamp`). Only the text wrapper
   clamps, so the translation toggle line above it never counts as a line;
   outer notes have no clamp rule. Full text stays one click away on the
   existing note-detail link.
4. **Quoted media edge-to-edge:** embedded media renders with the new
   `media media-quote` class (depth ≥ 1 never uses the interactive strip).
   CSS bleeds it full card width (`margin: 12px -16px -16px`, no chrome);
   card `overflow:hidden` clips the bottom corners to the 16px radius.
   **Multi-media decision (explicit, per handoff):** stacked flush
   treatment, not the strip — `media-quote` is `flex-direction:column`,
   `gap:0`, images/videos full-width `object-fit:cover`. Audio/file rows
   keep card padding (`margin: 8px 16px 16px`) since flush makes no sense
   for them.
5. **Outer media above quote:** verified already-correct — render order is
   text → media → poll → profile/link cards → quote. No change.
6. Kept: "Open quoted note" link, `quote-status` label, unavailable box.
   Added nothing the reference has that we lack (no badges/counts/colors).

## Workstream B — auto translation

New `frontend/src/api/translate.ts` + `frontend/src/components/TranslatableText.tsx`,
wired into `NoteBody` so **outer and quoted text share the path** (quoted
falls out naturally — one module-level id-keyed cache dedupes feeds; no
"why not" needed).

- Capability: `meta.translatorAvailable` read once per session, keyed by
  serving target (active external host or internal `BACKEND_ID`) so account
  switches re-probe. Uses `apiCall`, not `apiCallPublic`, so an external
  dvd.chat session probes dvd.chat (logged-out sessions send no credential
  — both endpoints are public, verified below). Falsy flag or 404 → never
  attempt, never retry.
- Fetch: public `notes/translate` `{noteId, targetLang}` with the viewer's
  primary subtag (`en-US` → `en`); completed + in-flight caches keyed by
  note id (failures cached too — no retry loops; the toggle never
  refetches). A 404 flips the session to unsupported.
- Display: original renders first, no skeleton/spinner; when a result
  arrives whose `sourceLang` differs from the viewer language, the view
  swaps to the translation with one monochrome line above the text:
  `Translated from {Language}  Show original` (toggles back and forth).
  Same-language results and failures show the original with no line and no
  error. CW-gated: the component mounts (and fires) only after reveal.

## Live probes (dvd.chat, real output — shape confirmed before coding)

- `POST /api/meta` → `translatorAvailable: True`, `version: 2025.4.7`.
- Bogus id → `{"error":{"message":"No such note.","code":"NO_SUCH_NOTE",…}}`
  (public — no 401).
- ZH note `ase70sz96n` → `{"sourceLang":"Chinese","text":"So excited to
  see everyone's \"box life\" from our Mo Tuan! This L2D is just so dynamic
  and stunning."}` — **sourceLang is an English display name, not a code**;
  same-language suppression therefore matches the viewer's English language
  name (`Intl.DisplayNames`) as well as the raw subtag.
- Missing `targetLang` → 400 `INVALID_PARAM` (required).
- targetLang sweep on the ZH note: `en`, `en-US` → English; `zh-CN`, `zh` →
  (reworded) Chinese; `ja` → Japanese; bogus `xx` → English fallback. The
  server is lenient, so the client sends the primary subtag with no
  allow-list. EN→EN still returns a result (`sourceLang: "English"`),
  hence client-side suppression.

## Verification

- `npx tsc --noEmit` → clean (exit 0).
- `npm run build` → green (`index-Cxt88CQi.css`, `index-Dwn0_b0o.js`).
- Solid checklist (`solidjs.md` §10): props read via accessors only;
  derived state in memos; `createResource(source, fetcher)` with null-guard
  source; `onMount` probe follows the `MentionLink`/composer cached-promise
  pattern; no React, no `innerHTML`, no accent colors.
- `docs/frontend-plan.md` scope checklist updated (new section).
- Browser pass **not yet verified** (owner): text-only quote, quoted-media
  quote, outer-media quote, translation on a non-English post + toggle,
  logged-out translation, server without the endpoint (no attempts/errors).

## Open questions for the owner pass

- Same-language suppression is exact-match (subtag or English name); a
  value like "Chinese (Simplified)" against a `zh` viewer would show the
  toggle — harmless but report if seen.
- `sourceLang` renders verbatim from the server ("Chinese"); no
  localization attempted.

Next: owner browser QA on dvd.chat; streaming Stage B / pinetree flips are
separate workstreams, untouched here.
