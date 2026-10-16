# 2026-10-16 — Origin-host emoji hint + overlay opacity hardening

## Goal

Owner reports `docs/remote_emoji_misskey.png` and `docs/seethru2.png`
show the previous emoji fixes as incomplete. Cover both.

## Bug 1 — host-less codes in remote-authored content stay literal

`remote_emoji_misskey.png` (note by `@agk_cus021@misskey.io` on
dvd.chat): the display name (`:__a3::…`), the note text (`:kyuukei:`),
and host-less reaction keys on remote notes resolve only via the
packed map + the viewer's local listing. A `:code:` typed on instance
H means H's emoji, but the glyph had no host hint to query — and
neither the packed `user.emojis`/`emojis` maps (empty here) nor the
dvd.chat listing (origin-local names) know them. Verified live:
`kyuukei` and `_a3` both exist on misskey.io; the `:kyuukei@misskey.io:`
chip on the same note was already covered by the pushed per-host
listing path (exact packed → misskey.io listing).

Fix: `EmojiGlyph` takes an optional `host` (origin hint). Local-form
codes now resolve packed → origin-host listing → local listing →
literal; explicit `:name@host:` codes are unchanged (their own host
wins, never a lookalike). Threaded through `DisplayName`, `MfmRenderer`
(+ remote-in-text parts), `TranslatableText`, and every call site with
an author in scope: NoteCard (head, reply context, repost banner),
NoteBody (quote head, CW, poll choices, text), ReactionChips + like
button, mention chips (resolved user), NotificationRow (+grouped),
UserReactions (now also passes the note's packed map), FollowList,
Profile h2 + bio, hover card (name + detailed name + bio), unfurl
cards, Search, Settings account page.

## Bug 2 — rail flyout menu renders see-through (`seethru2.png`)

The account menu open as a rail flyout shows note content (repost
banner, counts, text, mention chip) straight through the panel;
`seethru.png` showed the same. From current code this is not
reproducible: `.accountmenu` is `position: fixed` (flyout) /
`absolute`, `z-index: 30`, `background: var(--bg)` with no override,
no opacity/filter/mask/animation path anywhere near it (prior session
reached the same conclusion in `2026-10-16-parity-implementation.md`).
Note content is static (no positioned/z-index layer), so no in-code
paint-order path exists either.

Shipped hardening, not a root-cause claim: every floating overlay
surface (`.accountmenu`, `.tagpop`, `.hovercard`, `.renotemenu`,
`.emojpick.popup`, `.vispick-menu`) now layers a solid `#fff`
under `var(--bg)`, so a failed variable resolution can never yield a
transparent menu. No visual change when vars resolve (same computed
value), no shadows added (monochrome guard stands), no z-index
changes (blind re-stacking risks hovercards sliding under the
sidebar). The fresh build also ships new hashed asset names, which
retires any stale-stylesheet mode on the rig. If bleed persists on a
fresh load, the next step is a computed-style capture
(`background-color` + stacking of `.accountmenu`), not another blind
edit.

## Evidence (real output)

- Pure checks (esbuild-bundle + node over the real module):
  **17/17 passed** (prior 13 + hint plumbing: host-less parse shape,
  `misskey.io` non-local, null/`.` local).
- `npx tsc --noEmit` (frontend): clean, no output.
- `npm run build`: green (`index-Crx96oH3.js`, 322.37 kB;
  `index-NIJ7GfU8.css`, 38.77 kB — new hashes, fresh assets).
- Static: no `from "react"` matches; Solid checklist (`solidjs.md`
  §10) walked — `host` read at use inside the memo (no
  destructuring), no new effects (`ensureHostEmojis` idempotent kick
  as before), `<Show>`/`<For>` throughout, no `innerHTML`.
- No backends on this machine — API suites N/A. Browser confirmation
  of both screenshots **not yet verified** (owner rig, fresh load).

## Open questions

- If the flyout still bleeds on a fresh load, capture the computed
  `background-color` of `.accountmenu` and report it — that decides
  between stylesheet delivery and something environmental.

## Next step

Owner browser pass (fresh load): misskey.png note shows images for
`:kyuukei:`/`:_a3:`-class codes, flyout menus fully opaque in both
themes. Then this slice is done.
