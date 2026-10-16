# 2026-10-16 — Remote emoji: CORS failure was Cloudflare blocking the Referer

## Goal

Owner reports `:meow_bite_ones_lip:` (exact name on misskey.io, verified
in `POST https://misskey.io/api/emojis`) renders as literal text in
Keystone served from the Vite dev origin.

## Root cause (verified)

Browser console on `http://0.0.0.0:5173`:

    Access to fetch at 'https://misskey.io/api/emojis' from origin
    'http://0.0.0.0:5173' has been blocked by CORS policy: Response to
    preflight request doesn't pass access control check: No
    'Access-Control-Allow-Origin' header is present ...
    POST https://misskey.io/api/emojis net::ERR_FAILED

Curl replay (Origin set to the dev origin in every case):

    no Referer, preflight              -> 204, access-control-allow-origin: *
    no Referer, POST                   -> 200
    Referer: http://0.0.0.0:5173/      -> 403 (Cloudflare "Attention Required")
    Referer: http://localhost:5173/    -> 403
    Referer: https://keystone.example/ -> 200
    Referer: http://keystone.example:5173/ -> 200

The browser sends its default Referer on cross-origin fetches. Local
dev origins are rejected by misskey.io's Cloudflare with a 403 HTML
challenge that carries no CORS header, so the preflight fails. The
failure is then remembered per session by `deadHosts`
(`frontend/src/api/customEmoji.ts`), so every misskey.io code stays
literal until reload.

## What changed

- `frontend/src/api/customEmoji.ts` — `ensureHostEmojis` fetch sets
  `referrerPolicy: "no-referrer"` (with a comment). Also stops the app's
  origin leaking to remote instances.

## Evidence

- `npx tsc --noEmit` — exit 0 (`TSC_OK`).
- `npm run build` — `✓ built in 1.41s`, `dist/assets/index-DvPSn_8i.js`.
- Curl evidence above (no-Referer request reproduces 204/200).
- Browser re-check: **not yet verified** — needs reload of the dev tab
  and a misskey.io note with `:meow_bite_ones_lip:`.

## Open questions / follow-ups

- `deadHosts` is permanent for the session: a transient failure never
  retries. Consider a timed retry (separate slice).
- `<img>` loads of remote media also send a Referer; not affected by
  this fetch fix. Check whether any remote media host blocks the dev origin.

## Next step

Reload the Keystone dev tab; confirm `:meow_bite_ones_lip:` renders as
an image; then review and merge the worktree branch.
