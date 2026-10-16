# Handoff: quote-post visual parity + auto translation

**Audience:** the next Keystone implementer agent. Execute both workstreams
in order, then verify, log, and commit per `AGENTS.md` §4.

**Before starting:** read `AGENTS.md`, `state/STATE.md`, the latest
`state/logs/` entry, `docs/quote-posts.md` (quote semantics — still
authoritative, do not regress it), and `solidjs.md` §10 checklist before
returning Solid code.

**References (in `docs/`):** `quote.png`, `quote_op_media.png`,
`quote_with_media.png`, `post_with_translation.png`. Note: the "Translate
with DeepL" link in `quote_with_media.png` is the owner's browser
extension — **ignore it**, it is not part of either UI.

---

## Workstream A — quote posts look exactly like the competitor's

Current code: `frontend/src/components/NoteBody.tsx` (quote embed under
`Show when={embeddedNote()}>`, classes `renote-embed`, `renote-head`,
`renote-foot`) + `frontend/src/styles/global.css` (`.renote-embed`,
`.media`, `.media-strip`). Live reference server: `dvd.chat`
(Sharkey 2025.4.7, public; sign in via the External-server tab).

Match these specifics from the screenshots:

1. **Card shape:** large corner radius (~16px, up from 6px), subtle grey
   border, generous inner padding (~16px). Same black/white/grey palette —
   radius and spacing change only.
2. **Quoted header:** avatar + display name + `@handle` + `· time`
   (`quote.png`: "profdeibert @RonDeibert · 19h"). Today's embed head has
   no avatar and no timestamp — add both (timestamp via the existing
   `formatTime`-style relative time; check what `NoteCard` uses and reuse
   it, don't invent a second formatter).
3. **Quoted text truncates:** ~4 lines + `…` (`quote.png` ends "targeted
   ads. …"). CSS line-clamp on the embedded text only; the full text
   lives one click away on the note-detail route the card already links.
4. **Quoted media is edge-to-edge** (`quote_op_media.png`): the image
   fills the card width with only the *bottom* corners rounded to the
   card radius — no padding, no gap, no strip chrome around it. Single
   media in a quote renders this way; decide explicitly (and note it in
   the log) what multi-media quotes do — closest match is the flush
   treatment, not the interactive strip.
5. **Outer media sits above the quote card** (`quote_with_media.png`):
   video/post media first, quote card below. Verify current order already
   does this (text → media → poll → cards → quote) and fix if not.
6. Keep the "Open quoted note" affordance and the quote-status /
   unavailable states from `docs/quote-posts.md` — visual restyle only,
   no semantic change.

**Do NOT copy:** blue mention/hyperlink colors (palette guard —
monochrome only), verified checkmarks (no such field), view counts,
bookmark icons, reply/repost/like counts inside the quote (the quoted
card carries no action bar in the reference). Anything we don't have is
omitted, not faked.

## Workstream B — translations load automatically when the server provides

Verified 2026-10-16 against `dvd.chat` (do not re-derive, do extend):

- `POST /api/notes/translate` is **public** (no credential): bogus id
  returns `{"error":{"message":"No such
  note.","code":"NO_SUCH_NOTE",…}}`, not 401. Real shape to confirm with
  a live note: params `{noteId, targetLang}`, result `{sourceLang,
  text}` (Misskey convention — verify field names against a real
  response before coding the type).
- `POST /api/meta` exposes `translatorAvailable: True` — read it once
  per session as the capability flag. Servers without the endpoint will
  404: remember that per session and never retry (same pattern as the
  existing `isUnsupportedError` probes).

Behavior (`post_with_translation.png`):

- Auto-request a translation per note when the capability flag is on;
  share one module-level cache keyed by note id (see `mentionCache` in
  `MfmRenderer.tsx` for the house pattern) so feeds don't refire.
- Show the translated text **only** when `sourceLang` differs from the
  viewer's language (`navigator.language`, e.g. `en-US` → `en`; verify
  which `targetLang` codes dvd.chat accepts — probe `en`, and note the
  accepted set in the log).
- Translated view gets one line under the header: `Translated from
  {Language}  Show original` (toggle back and forth; monochrome, no
  blue — the reference's blue link color stays behind). Original text is
  the default until the translation arrives (no layout jump, no
  skeleton swap mid-read if avoidable).
- Scope: outer note text first; quoted text via the same component if it
  falls out naturally, otherwise note why not in the log.
- CW gates translation display (translate the revealed text, not the
  warning), and translation never fires on servers lacking the endpoint.

## Verification (both workstreams)

- `npx tsc --noEmit` clean; `npm run build` green.
- Exercise against dvd.chat in a real browser: text-only quote, quote
  with quoted-media, quote with outer-media, translation on a
  non-English post + Show-original toggle, logged-out behavior (public
  endpoint — translation should still work), and a server without the
  endpoint (no attempts, no errors, no dead UI). No browser here means
  screenshots or it didn't happen — paste real output in the log.
- Update `state/STATE.md`, append one dated
  `state/logs/YYYY-MM-DD-<topic>.md` log, commit. Never rewrite past
  logs.

## Non-goals

New endpoints on Pinetree, video duration/mute badges, bookmark counts,
verified badges, accent colors, theme toggles, animation on the cards.
