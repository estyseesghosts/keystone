# 2026-10-22 — Chips, titles, translated AST, newlines — agent

Branch: `p6.4-sidebar-reshuffle`
Trigger: owner k1k2 comparison (`docs/k1k2-20261022/`): v1 chips, page
titles, translated parity, newline gaps.

## Did

- Bare-URL chips (`RichText` + fedi `bareLinkLabel`/`shortenBareUrl`):
  shortened URL pills, unbreakable line units. Mastodon
  server-shortened links reuse the visible label.
- Mention chips resolve to avatar + display name
  (`useMentionedAccount`, per-session cached `backend.account`;
  handle + glyph fallback, no spinner, no dead chips). Unresolvable
  mentions stay plain text.
- Link chips prefer the embed's page title (capped 48); a lone bare
  link with its own embed card degrades to plain text
  (`collectBareLinkHrefs` + `hideLoneLinkChipFor`; count runs over
  unfolded nodes).
- Translated bodies re-parse to AST (`contentFromTranslatedText`:
  mentions, bare URLs, newlines) and render through the same
  pressable `RichText` — taps, chips, and formatting survive
  translation; the only delta is the text.
- Newlines: `fromHtml` drops whitespace-only text adjacent to block
  boundaries (no more phantom blank lines from pretty-printed HTML);
  `fromMfm` keeps leading breaks per text node + document-level trim,
  so chunking across nodes can no longer eat blank lines
  (chunking-invariant); `\r\n` normalized.
- LinkCard: untitled cards show host + full URL (v1 parity).

## Follow-ups (not built)

- Mention avatar resolution needs no new infra now (done), but
  hovercards (v1 profile preview popup) remain a separate slice;
  mention taps already route in-app to User.

## Tests / verification

- fedi content suites + `accounts` hook suite + richtext suites +
  post suites green; `pnpm run typecheck` + `lint` clean; full suite
  **192 / 2424 green**.
- Debug note: a mid-batch full-run failure in `NewsDiscussions`
  (`findByText` on a fragment string) was a test bug, not source —
  exact-match queries only hit host-element text.
- Device/web runs → `not verified` (owner visual pass).
