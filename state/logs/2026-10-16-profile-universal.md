# 2026-10-16 — universal profile cards (never-stuck)

**Report:** `https://dvd.chat/@jm` in a post showed a permanent skeleton —
no card, no fallback.

**Findings (all probed live):**
- MFM parses the text cleanly (single `url` node, full URL) — not a
  parse bug.
- `POST dvd.chat/api/users/show {"username":"jm"}` works even
  **unauthenticated** and jm exists — the lookup itself is fine, so the
  stuck skeleton was the loader never settling on some path (the old
  `apiCall` chain had no timeout, and total failure rendered nothing).
  Fix: bound every leg, always render a state.
- Mastodon `/api/v1/accounts/lookup` sends `access-control-allow-origin:
  *` (verified) — direct browser lookup works for Mastodon/Pleroma.

## What changed (`ProfileCard.tsx` rewrite)

- URL shapes: `/@user`, `/@user@home` (Misskey/Sharkey/Pinetree/Mastodon),
  `/users/<id-or-nick>`, `/user/<nick>` (Pleroma), `/u/<nick>` (Lemmy).
- Three resolution legs: (1) `users/show` via our backend — full card +
  follow; (2) Mastodon-compatible lookup direct to the profile host
  (field-validated; bio HTML → text) — details card, no follow button;
  (3) basic chip (handle + working Open-profile link). 12s overall
  timeout; the skeleton always settles.
- Lemmy detail lookup needs an authed software-specific API — basic chip
  for now (honest "details unavailable", link works).

## Evidence

- `npx tsc --noEmit` clean; `npm run build` green.
- **Not yet verified:** browser pass (owner) — the exact `@jm` post
  should now show jules' full card. If anything still sticks, send the
  browser console output: with the timeout it should be impossible, and
  the visible state (full / remote / basic) will say which leg resolved.
