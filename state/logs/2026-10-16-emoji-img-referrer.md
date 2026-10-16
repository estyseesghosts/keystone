# 2026-10-16 — Remote emoji images: the Referer also blocks `<img>` loads

## Goal

Remote emoji (misskey.io, misskey.gg, mistyreverie.org, …) still show
as `:shortcodes:` on the Vite dev origin after the host-listing fetch
was fixed (`2026-10-16-emoji-referrer.md`).

## Evidence (real output)

Browser debug (temporary `[emoji-debug]` logs, since removed):

    [emoji-debug] ok misskey.io 13970 true
    [emoji-debug] ok misskey.gg 2995 true
    [emoji-debug] ok mistyreverie.org 322 false
    [emoji-debug] glyph :ohayoo: host= misskey.io cands= 1 … cands= 3
    (every misskey.io glyph had cands >= 1, so a URL was found)

The URLs were found, but the images did not render. The image host
rejects the localhost Referer the browser sends on `<img>` requests:

    $ curl -o /dev/null -w 'http=%{http_code}' -H 'Referer: http://127.0.0.1:5174/' https://media.misskeyusercontent.jp/misskey/a8dbc938-….png
    http=403 type=text/html; charset=UTF-8
    $ curl … (no Referer)                       -> http=200 type=image/png
    $ curl … -H 'Referer: https://keystone.example/' -> http=200 type=image/png

Both candidates fail, `EmojiGlyph` moves past them via `onError`, and
with no candidate left it renders the literal shortcode.

## What changed

- `frontend/src/components/EmojiPicker.tsx` — `EmojiGlyph`'s `<img>`
  sets `referrerPolicy="no-referrer"` (same as the listing fetch in
  `customEmoji.ts`, which is already committed).
- Temporary `[emoji-debug]` logging was added and reverted; it is not in
  this commit.

## Evidence (checks run)

- `npx tsc --noEmit` — `TSC_OK`.
- `npm run build` — `✓ built in 1.31s`.
- Curl evidence above.
- Browser re-check on 127.0.0.1:5174: **not yet verified** — needs a
  hard reload and a look at a misskey.io note with shortcodes.

## Follow-ups (not done)

- Other remote `<img>` loads (avatars, media, link-card thumbnails) send
  the same Referer and may hit the same 403. Option: set
  `<meta name="referrer" content="no-referrer">` in `index.html` to cover
  all outbound requests, or set the policy per element.
- `deadHosts` is still permanent for the session on any fetch failure.
