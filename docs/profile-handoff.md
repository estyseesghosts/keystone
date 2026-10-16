# Handoff: Profile pages (banner header, counters, bio links, Misskey tabs)

**Status:** Analysis + build brief for the next agent (2026-10-16).
Reference: `docs/keystone_profile.png` (current) vs
`docs/competitor_profile.png` (X profile). Goal: make Keystone profiles
look and behave like the competitor's, with tabs 1:1 matching Misskey's
own profile tabs.

## 0. Read first

- `frontend/src/routes/Profile.tsx` — current header (small avatar,
  plain-text bio, text stats, Followers/Following toggle buttons,
  single `users/notes` list), `FollowList` (reuse as-is).
- `frontend/src/components/MfmRenderer.tsx` — mention chips +
  hashtag links already built; takes `{ text }` only.
- `frontend/src/components/NoteCard.tsx` + `UserHoverCard.tsx` — the
  avatar-overlap-over-banner pattern already exists
  (`.hovercard-overlap`: avatar rides the banner's bottom edge).
- `docs/api-surface.md` — endpoint contract. `users/show`,
  `users/followers`, `users/following`, `users/notes` are all verified
  on Misskey + Sharkey.

## 1. Header: banner + big avatar (pure UI, no API risk)

- `UserDetailed` already packs `bannerUrl` + `avatarUrl`. Render a
  full-width banner strip (~200px; `var(--bg-soft)` grey when the user
  has no banner — exactly the competitor's grey strip, which is just a
  bannerless profile).
- Big avatar (~120–134px) overlapping the banner's bottom edge
  (negative-margin overlap, same trick as `.hovercard-overlap`).
  Monochrome; no new colors.
- Keep the existing follow/unfollow/pending/cancel + Edit-profile logic
  untouched, repositioned into the header row (follow/edit top-right,
  competitor-style). No behavior change to the follow state machine
  (server-reconciled, pending-aware).

## 2. Counters replace buttons (small routing + reuse)

- Delete the Followers/Following toggle buttons. The stats row becomes
  clickable numeric counters (`886 Following · 91 Followers`), notes
  count stays plain text.
- New sub-routes in `App.tsx`: `/users/:id/followers` and
  `/users/:id/following`, rendering the existing `FollowList` in full
  (it already pages + dedupes + exhausts). Counters link there with
  `<A>`.
- Permission (`if have permission to view`): attempt the fetch; on
  403/denied render an honest "not visible to you" state, never an
  empty page pretending otherwise. Follow the repo's 403 → re-sign-in
  hint where the cause is a pre-scope token.

## 3. Bio links (reuse, ~10 lines)

- Replace `<p class="bio">{description}</p>` with
  `<MfmRenderer text={current().description} />`. This is free:
  `@mentions` get the existing chip treatment (avatar + display name,
  cached `users/show` resolution, verbatim fallback), `#hashtags`
  become `/search?tag=` links (deliberately NOT chips — established
  repo rule, lone hashtags stay inline), bare URLs get safe external
  chips. No `innerHTML` anywhere.
- Known limits (do NOT work around): custom `:emoji:` codes render
  literally (`emojiCode` has no lookup — same as notes); add
  `white-space: pre-wrap` to the bio container so multi-line bios keep
  their breaks (check how `.notebody` does it and mirror it).
- Bio must never fetch anything except the mention resolutions
  MfmRenderer already performs.

## 4. Tabs, 1:1 with Misskey (the API analysis — read carefully)

Tabs left to right: **Featured · Posts · All posts · Media**.
`users/notes` semantics below are verified in Misskey `develop` source
(`packages/backend/src/server/api/endpoints/users/notes.ts`) — these
`with*` flags are core params, NOT Misskey-only extras, so they are
safe to send to Sharkey too. Paging stays `{limit, sinceId, untilId}`.

| Tab | Request params | Notes |
|---|---|---|
| Posts (top-level incl. quotes, no renotes, no replies) | `withReplies: false, withRenotes: false` | Server-exact. Quotes carry text so they stay; pure reposts excluded server-side. |
| All posts (replies + renotes included) | `withReplies: true` (`withRenotes` defaults true) | Server-exact. |
| Media (NOT exclusionary) | `withReplies: true, withRenotes: true` + client view-filter `files.length > 0` | The server 400s `withReplies + withFiles` together (`BOTH_WITH_REPLIES_AND_WITH_FILES` — verified in source), so a server-side media query would silently drop reply-media. Page the RAW items (cursor from the raw last id, exhaust on raw-empty/all-duplicate, same convergence pattern as `mergeNotes`), filter at render. Pure reposts carry no files so they drop out naturally; quotes with media stay. |
| Featured (pinned) | **UNVERIFIED — probe first** | No pinned field was confirmed in the endpoint source reviewed. Step 0: inspect a live `users/show` response for pinned-note fields and probe candidates before building. If no source exists, SHIP WITHOUT the Featured tab (hide it, note it as pending) — never fake it with most-reacted notes. Pinetree can add the source later as its own slice. |

- Tab UI: monochrome tab bar (text + underline indicator for active —
  no accent color), keyboard-accessible (`role=tablist`, buttons with
  `aria-selected`, visible focus). Default tab: Posts (Featured first
  only if its source lands).
- State: per-tab list state (extract a `ProfileNotesList`, mirroring
  the `ReplyList` per-branch pattern) or lift the tab into the loader
  with a full reset — never share cursors across tabs. Reset everything
  on `:id` change (same staleness discipline as `routes/Note.tsx`).
- Pinetree: `users/notes` is still 404 there — keep the existing honest
  unavailable state per tab, not one page-level error.

## 5. Acceptance

- Bannerless profile shows the grey strip; bannered profile shows the
  image; avatar is large and overlaps in both themes.
- No Followers/Following buttons anywhere; counters navigate to list
  pages; denied lists say so honestly.
- Bio `@jm@sharkey.world` renders the mention chip; `#photography`
  links to tag search; multi-line bios keep breaks; no console errors.
- Posts tab shows no replies and no pure reposts; All shows both;
  Media shows photo replies too (the photographer case) and no
  text-only notes; each tab pages to exhaustion independently and
  switching tabs never mixes cursors.
- Featured appears only with a real pinned source, or is absent with a
  note in this doc.
- `tsc --noEmit` clean, `npm run build` green; no React; no accent
  colors; mobile single-column usable.

## 6. Verification

- Build + (where backends exist) the `scripts/smoke_*.py` suites;
  browser pass is owner-handled — mark anything unobserved `not yet
  verified`, never imply otherwise.

## 7. Out of scope

- "You might like" / trends column; join-date/location rows (skip
  unless trivial); changing follow-state semantics; quote-post,
  streaming, or ranking work; a client-invented Featured list.
