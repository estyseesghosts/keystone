# 2026-10-16 — Remote emoji broken images (`docs/remote_emoji.png`)

## Goal

Owner reports remote custom emoji reactions still render as broken
images (screenshot: five `:name@misskey.io:` chips show the browser's
broken-image icon plus the literal code as alt text; one unicode/cat
chip renders fine) after the packed-maps + remote-listing work landed.

## Diagnosis

The screenshot shows `<img>` tags that loaded nothing: the code as
visible text is the image's `alt` text next to the broken icon, not
the literal-text fallback (which renders with no icon). So `EmojiGlyph`
resolved a URL for each failing chip, but the URL did not load.

Two defects combined to produce the stuck broken image:

1. **No fallback for dead URLs.** `EmojiGlyph` picked the first
   non-null source (packed `reactionEmojis` → remote listing → local
   listing) and rendered it with no `onError` handling. A packed URL
   that no longer resolves — stale remote file after the origin's
   media migration (`media.misskeyusercontent.com` packed vs `.jp`
   live, verified live 2026-10-16), deleted/renamed emoji on the
   origin, small-instance hotlink refusal — stayed a broken `<img>`
   forever, even though the origin's live `POST /api/emojis` listing
   (verified: all five screenshot names present, every probed URL
   HTTP 200) could have rescued it. `MfmRenderer`'s `emojiCode` path
   had the same flaw (raw `<img>`, no `onError`).
2. **Cross-host lookalike in the packed lookup.** `lookupPackedEmojis`
   fell back from the exact inner (`name@host`) to the bare name for
   every code. A packed bare key is a *local* emoji, so a remote
   `:name@host:` code could resolve to the wrong (local) image. Not
   the broken-icon cause, but the same "wrong URL wins" class — fixed
   in the same pass.

Verified live during diagnosis (dvd.chat + misskey.io, 2026-10-16):
`global-timeline` packs `reactionEmojis` as bare-inner → absolute-URL
(`ohayoo@misskey.io → https://media.misskeyusercontent.com/…`,
HTTP 200); `POST https://misskey.io/api/emojis` returns 200 with
CORS `*` and contains all five screenshot names (`.jp` URLs, all
HTTP 200); the screenshot note itself is not in the newest ~2000
global notes (likely an older/detail-view note with stale packed
URLs — consistent with defect 1).

## What changed

- `frontend/src/components/EmojiPicker.tsx` — `EmojiGlyph` now
  builds an ordered candidate list (packed → remote *or* local
  listing, never a local lookalike for a remote code) and advances
  past failures via `onError` into a per-mount dead-URL set, ending
  at the literal code. A listing that lands later still gets tried
  (its URL is not in the dead set).
- `frontend/src/components/MfmRenderer.tsx` — `emojiCode` renders
  through `EmojiGlyph` (same chain + fallback); dropped the now-unused
  `customEmojiUrl`/`lookupPackedEmojis` imports.
- `frontend/src/api/emoji.ts` — `lookupPackedEmojis` tries the bare
  name (and colon-wrapped bare) only for local codes; remote codes
  match the exact inner (plus colon-wrapped exact) and nothing else.
- `docs/mfm.md` — `emojiCode` + rule 4 updated to the packed →
  listing → literal chain with dead-URL fallthrough (the "remote stays
  literal" line was stale since the packed-maps slice).

## Evidence (real output)

- Pure checks (esbuild-bundle + node over the real module):
  **13/13 passed** — remote exact hit, colon-wrapped packed keys,
  local bare, local `:name@.:` vs bare key, misses, null/empty input,
  plus the new guards (remote vs bare-local key → null, remote vs
  other-host key → null, local `:name@.:` exact key still hits).
- `npx tsc --noEmit` (frontend): clean, no output.
- `npm run build`: green (`index-uGlFHV-7.js`, 321.22 kB;
  `index-DMGnEGmS.css`, 38.68 kB).
- Static: no `from "react"` matches; Solid checklist (`solidjs.md`
  §10) walked — props read at use (no destructuring), derived URLs in
  a `createMemo`, failure state in a `createSignal` updated via
  setter with a fresh `Set` (no silent mutation), `<Show>` branch
  only, `onError` advances to the next candidate or the literal
  fallback (at most ~3 sources, terminates; stale events guarded by
  the `has` check), no dep arrays, no `innerHTML`.
- No backends on this machine — API suites N/A. The dev proxy probe
  (`:5199` → dvd.chat, `meta` 200) confirmed transport only. Visual
  confirmation that the screenshot note's chips now render (or degrade
  to clean literal text with no broken icon) is **not yet verified**
  (owner browser pass).

## Open questions

- Follow-up (from `docs/remote_emoji_misskey.png`, same session):
  a remote user's *host-less* codes (`:_a3:` in a misskey.io user's
  display name) stay literal when neither the packed `user.emojis`
  map nor the local listing knows them — `_a3` exists on misskey.io
  (verified live) but the glyph has no host hint to query. The
  author's host (`user.host`) at `DisplayName` call sites is the
  natural hint; scoped as a separate slice, not this fix. The remote
  chip on the same note (`:kyuukei@misskey.io:`, also on misskey.io)
  resolves through the per-host listing path. Neither case produces
  a broken image after this fix.

## Next step

Owner browser pass on the screenshot note: remote chips as images
(or clean literal codes where the origin truly has no file), no
broken-image icons in either theme. Then commit the emoji work as one
slice.
