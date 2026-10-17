# 2026-10-17 — Remote post link (note menu)

## Goal

Owner note: a remote post's web link is carried in its ActivityPub object
as `url`, and the native Misskey client can reach it. Find out whether
Keystone can too, and wire it into "View on remote instance" and "Copy
remote link".

## Probe (real output, public instances, no credentials)

dvd.chat was returning `502` during this session, so the probe used
misskey.io and the instances its timeline surfaced.

```
$ POST https://misskey.io/api/notes/global-timeline {"limit":20}  -> http 200
  notes 20, with uri 17
  uri: https://voskey.icalo.net/notes/asg9k8ke57     url: None
  uri: https://discordian.social/users/.../activity  url: None
```

Packed remote notes carry `uri` but no `url` key at all (checked the key
list of a remote note: `['uri']`).

AP objects, fetched with `Accept: application/activity+json`:

```
voskey (Misskey)   200  ACAO: *            keys: no 'url'    -> HTML at uri for text/html
pullopen (Pleroma) 200  no ACAO            url: https://pullopen.xyz/@flyover/...
mastodon.social    200  no ACAO            url: https://mastodon.social/@Gargron/1
text/html at uri:  mastodon & pullopen 301 -> the post page; voskey 200 text/html
```

## Conclusions

- Misskey-family objects have no `url`; their `uri` serves the post page to
  a browser, so opening the `uri` works.
- Mastodon and Pleroma objects do carry `url`, but send no CORS header, so
  Keystone cannot read it from the browser. Opening the `uri` reaches the
  same page through a 301.
- Reading the object's `url` works only where the remote sends
  `Access-Control-Allow-Origin` (the Misskey-family objects probed here).
  That helps Misskey-family posts that do carry a `url`; for the rest the
  `uri` fallback already reaches the page.
- A server-side proxy would reach every object, but it would send every
  remote post address to a third party. Not added; needs an owner decision.

## What changed

- `frontend/src/api/remotepost.ts` (new): `resolveRemotePostUrl(uri)` fetches
  the AP object with the AP Accept header, trusts it only when `id === uri`,
  reads `url` (string, Link object, or array), accepts http(s) only, times
  out at 6s, and caches once per session. `cachedRemotePostUrl(uri)` is the
  synchronous read for click handlers.
- `frontend/src/components/NoteMenu.tsx`
  - Opening the menu starts resolution for remote notes (so the click can be
    synchronous; opening a window after an `await` can be popup-blocked).
  - Web link order: packed `url`, cached resolved `url`, then the `uri`.
  - "Copy remote link" copies the web link when known, else the `uri`
    (previously always the `uri`).
  - "View on remote instance" opens the same web link.

## Evidence

```
$ npx tsc --noEmit -p tsconfig.json   exit 0
$ npm run build                        ✓ built in 1.33s
```

## Not yet verified

- In a browser: the cross-origin AP fetch succeeds on a CORS-open remote
  and the menu opens the resolved page. The probe above used curl, which
  ignores CORS, so the CORS behavior itself is inferred from the headers.
- Copy from the menu on a live remote note.
- The `uri` fallback for a Misskey-family note in a browser tab.

## Open questions

- A proxy for Mastodon/Pleroma `url` (privacy trade-off above)? Owner
  decision.
- "View on remote instance" for a remote profile (`UserLite` carries no
  profile URL). Could the actor object be resolved the same way from the
  user's `uri`? Not in `UserLite` yet; needs the user's `uri` field.
