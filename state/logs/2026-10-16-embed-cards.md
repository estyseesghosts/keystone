# 2026-10-16 — embedded link + profile cards

**Goal:** copy the competitor's embedded cards (`docs/linkcard.png`,
`docs/profilecard.png`) using only data we have.

## What changed

- `frontend/src/api/linkpreview.ts` (new): client-side OpenGraph fetch —
  direct first (CORS-open sites), then `api.allorigins.win` proxy, then
  null. Byte-capped (256 KiB), 10s timeout, in-memory per-URL cache,
  http(s)-only asset resolution, no `innerHTML` anywhere.
- `frontend/src/components/LinkCard.tsx` (new): bordered card (preview
  image, site icon + site/host, title, 3-line description) degrading to a
  basic host + URL card; skeleton while loading; always an outbound link.
- `frontend/src/components/ProfileCard.tsx` (new): pasted profile URLs
  (`/@user`, `/@user@home`, `/users/<id>`) resolve via `users/show`
  (local-vs-remote host handling) into a card with avatar, name, handle,
  bio, follower/following/note counts, lock/bot flags, follow/unfollow
  (server-reconciled, pending-aware), and Open-profile link.
- `frontend/src/components/NoteBody.tsx`: bare `url` MFM nodes partition
  into profile refs (all render) + first other URL (link card); URLs the
  quote card already covers are skipped. Cards render after the poll,
  before the quote embed, inside the CW gate.
- `docs/api-surface.md`: `url-preview` row — absent on Sharkey, client
  fetch as stopgap, Pinetree endpoint as the workstream.

## Verification notes (all real probes, this machine)

- `POST dvd.chat/api/url-preview` → 404, byte-identical shape to a bogus
  endpoint; `fetch-rss` on the same host returns a Misskey envelope —
  the route is genuinely unregistered, not an auth issue.
- Public proxies are flaky *right now*: allorigins + codetabs 522 on every
  URL (direct egress fine — example.com 200), corsproxy.io needs an API
  key. Hence direct-first ordering: CORS-open sites preview with no third
  party; everything else degrades honestly to the basic card.
- `npx tsc --noEmit` clean; `npm run build` green.
- **Not yet verified:** browser pass (owner rig) — rich vs basic card
  appearance, profile-card follow flow, cards inside quote embeds and CW
  gates, mobile widths. Labeled `[text](url)` links get no card (v1).

## For later (Pinetree workstream, per owner)

Implement a first-party preview endpoint (`url-preview`-compatible:
`{url}` → `{title?, description?, siteName?, image?, icon?}`) and swap
`fetchLinkPreview` for an `apiCall`. Kills the proxy-privacy tradeoff
and the flakiness in one move.
