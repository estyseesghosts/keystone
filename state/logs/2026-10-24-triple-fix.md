# 2026-10-24 — Three-way fix: hover respawn, Bridgy truncation, Misskey matrix — agents

Branch: `main` (direct; standing owner instruction).
Goal: owner-ordered triple delegation (three subagents in parallel),
then integration + verification by the lead agent (me).

## 1. Hovercard respawn (subagent 1)

Owner diagnosis confirmed in code: after a genuine leave, the card
sits fading for the 550ms unmount window, and ANY pointer entering
the card div during it (cancel-close + fade-back-in, meant for
anchor→card crossings) resurrected it — moving back over the dying
card's area brought it back.

Fix: `shouldReviveCard(leaveAt, now, graceMs)` (pure, exported from
`HoverPreview.tsx`) — card `onMouseEnter` revives only inside the
400ms close grace after the last genuine leave (stays-inside ghosts
never stamp it). Later enters are ignored; the scheduled unmount
proceeds. Applied to `HoverPreview` and `MatrixHover`. Anchor
re-enters unchanged (pointer over the anchor = intent, plus the
existing pointer-freshness gate).

## 2. Bridgy mention truncation (subagent 2, live evidence)

`GET /api/v1/statuses/117488106059876736` (mstdn.ca, no auth,
2026-10-24): the mention anchor is
`<a href="https://bsky.brid.gy/r/https://bsky.app/profile/foxtails.me"
class="u-url mention">@<span>foxtails.me</span></a>` with
`mentions[]` carrying the full `foxtails.me@bsky.brid.gy`. Parser
innocent (label genuinely short). Root cause in `defaultMentionPress`:
host-less label → `acctFromProfileUrl` null (`r/…` path) →
`acctFromBskyAppUrl` null (bridge host, not `bsky.app`) → bare-label
fallback resolved LOCALLY to `@foxtails.me@mstdn.ca`. Misskey path
was unaffected (MFM keeps the full handle).

Fix: `acctFromBridgeUrl` + `isBridgeUrl` (`models.ts`) — unwrap the
embedded `bsky.app/profile/<handle>` (raw or encoded) plus `/@` +
`/users/` bridge shapes to `<handle>@bsky.brid.gy`; DIDs/unknown →
null. Tap chain tries it after the full-label branch (label-first
anti-hijack preserved); bridge hrefs that yield nothing return early
— no local flatten, no browser. The renderer shows the recovered
full handle on the chip (so resolution + hover target the real
actor); unresolvable bridge mentions render static text.

## 3. Misskey-view matrix misparse (subagent 3, live evidence)

`POST dvd.chat/api/users/show {ctr@mstdn.ca}` (2026-10-24): the
field arrives as `"@JM@mstdn.ca:nope.chat"` — Misskey's federation
rewrite hosted Mastodon's shredded `@JM` mention and left `:nope.chat`
dangling. `mergeMatrixMentions` only accepted bare-local mentions, and
the fields path never re-merged after expansion (MFM/HTML post paths
did).

Fix: `matrixMergeLocal` accepts hosted `@local@fedihost` labels
(returning bare `@local`; injected host dropped, result always bare
`@local:server`), and `contentFromFieldValue` runs the merge after
expansion. All existing guards unchanged (prose/timestamps pinned by
tests). No adapter change needed; matrix nodes carry no href so no
lookup can fire (the "Jake" chip in the screenshot was a real local
lookup for the fragment — now impossible).

## Integration (lead)

- Full `pnpm test` → **203 suites / 2647 tests green**;
  `pnpm typecheck` (ios+android+web) + `pnpm lint` clean, on the
  combined tree. RichText carries two agents' hunks in disjoint
  regions (verified by diff); no file needed conflict repair.
- Screenshots check out against the fixes: image-2's `[m]
  JM:nope.chat` (Mastodon view) was already right; image-1's
  mention-chip + dangling server (Misskey view) is what agent 3
  fixed; bridged `@foxtails.me` chips now carry the full handle.
- Not committed by agents; single commit below. Device hover feel +
  live bridged/matrix rendering: `not verified` (owner compares).

## Next

- Owner live check of all three; push `main`.
