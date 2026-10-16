# Frontend parity plan (Keystone)

Status: Draft (2026-10-16; no code changed — plan only)

Backend companion: `../../pinetree/docs/misskey-parity-plan.md` (Draft).
Do not duplicate the backend contract here — endpoint params, shapes, and
errors live there and in `docs/api-surface.md`. This doc is Keystone-side UI
work only, gated on that backend plan landing slice by slice.

Rule: match Misskey/Sharkey UI semantics by default. Where the backend
diverges (server-injected CW, per-user default emoji, literal
followed-replies home), the UI follows the backend plan. Until a backend
slice lands, controls stay hidden or disabled with a reason
(`isUnsupportedError(404)` path) — no inert controls, no faked lists.

Current base (verified 2026-10-16, see `docs/frontend-plan.md`,
`docs/api-surface.md`): 17 routes in `frontend/src/App.tsx`, `TimelineFeed`
(Home/Local/Global + antennas), `Note` detail with `notes/conversation` +
`ReplyList`, `Profile` (banner/avatar/counters/`FollowList`/Posts/All/Media;
Featured shipped absent), `Notifications` (paging + mark-all-read, no
`isRead`), `Composer` + `FloatingComposer` (text/CW/visibility/recipients/
`localOnly`/`fileIds`/polls Misskey-family-only; scheduling disabled with
reason), `DriveBrowser`, `EmojiPicker` + device-local like emoji
(`keystone_like_emoji`), bounded `ProfileEditor`
(`name/description/location/birthday/isLocked/isBot`).

## 0. Shared groundwork (do first)

- `FollowRequest` type exists (`api/types.ts`) with no list UI. Add an
  approval queue route/component when `following/requests/list|accept|reject`
  is usable against private lists.
- No `blocking/muting/renote-mute` calls anywhere (only CSS `--muted`).
  Add `api/mutes.ts`-style helpers + `users/relation` lookups once backend §0A
  lands; every surface below reuses them.
- `ProfileEditor.tsx` is explicitly a "bounded subset". Grow it in place
  (same component, same own-profile entry in `routes/Profile.tsx`) rather
  than forking a second editor.

## 1. Full profile edit

`ProfileEditor.tsx:30-73` today sends 6 fields. Expand to the full `i/update`
set as backend §0B lands: `followedMessage, lang, fields[16]` editor,
`avatarDecorations[16]`, `hideOnlineStatus, publicReactions, carefulBot,
autoAcceptFollowed, followApproval*Seconds, noCrawle, preventAiLearning,
requireSigninToViewContents, makeNotes*Before, injectFeaturedNote,
receiveAnnouncementEmail, alwaysMarkNsfw, autoSensitive, chatScope,
pinnedPageId, mutedWords, hardMutedWords, mutedInstances,
notificationRecieveConfig, emailNotificationTypes, alsoKnownAs`.
- Avatar/banner: wire `avatarId/bannerId` through `DriveBrowser` select mode
  (upload → select → `i/update`); keep `bannerUrl/avatarUrl` display in
  `Profile.tsx:140-154` unchanged.
- Keep the Misskey trims/empties semantics server-side; client validates
  lengths only, shows server errors verbatim.
- Until backend accepts a field, leave its control out (not disabled —
  the current bounded editor already sets this precedent).

## 2. Private followers / following

`FollowList.tsx` + `FollowersPage/FollowingPage` (`Profile.tsx:266-307`)
already page to exhaustion with `denied` vs `permissionDenied` states.
- Add the Misskey gates to the UI copy: `private` → "Only the account owner
  can see this" (self-only); `followers` → "Only followers can see this"
  with a follow prompt; keep the moderator path invisible (no client role).
- Mask counts on `Profile.tsx:191-196` the same way the endpoint does
  (don't show a number the API won't return).
- No change to paging itself (`limit/untilId` already matches).

## 3. Private reactions

`Note.reactionAcceptance` is typed (`api/types.ts:90`) but never read.
- Add the per-note visibility picker in `Composer.tsx:227-247` when the
  backend stores it, plus a small badge in `NoteCard.tsx:222-225`.
- Add a `users/reactions`-backed list (profile tab or dialog) with the
  Misskey states: `REACTIONS_NOT_PUBLIC` notice, remote-user notice,
  blocked-viewer empty state.
- Keep chips like-only exclusion (`api/emoji.ts:37-55`) as-is.

## 4. Quote-disable toggle (Sharkey parity)

No `noQuote` field anywhere today; `NoteBody.tsx` always renders the quote
path; `Settings.tsx` has only account/display/reactions.
- Add a settings switch (account section) bound to `rejectQuotes`, and a
  per-note override in the composer if the backend supports one.
- Composer behavior on `QUOTE_DISABLED_FOR_USER`: keep the text, drop the
  `renoteId`, show the server reason (mirror the existing poll/scheduling
  "disabled with reason" pattern in `Composer.tsx:433-483`).
- Inbound: stripped quotes render as plain notes (no client repair).

## 5. Polls

Mostly done: create in `Composer.tsx:350-456` (`IS_MISSKEY_FAMILY` gate),
vote in `NoteBody.tsx:121-170` (`notes/polls/vote`, `total/voted`).
- Work is un-gating: remove the Pinetree hide (`Composer.tsx:433-445`)
  once backend §4 is live; keep `POLL_EXPIRIES:49-54` as-is.
- No new UI beyond error copy for `CANNOT_CREATE_ALREADY_EXPIRED_POLL`,
  `ALREADY_VOTED/EXPIRED`, `YOU_HAVE_BEEN_BLOCKED`.

## 6. Scheduling + 7. Drafts (one UI surface)

Scheduling is a disabled stub (`Composer.tsx:475-483`, `frontend-plan.md:281-284`).
Drafts are floating-composer-only and lossy
(`FloatingComposer.tsx:21-163`, `api/drafts.ts:10-15` — text/cw/visibility/
localOnly only; no attachments/poll/recipients/`renoteId`; no inline entry).
- Extend the draft payload to the full composer state (attachments, poll,
  recipients, `replyId/renoteId`, `scheduledAt/isActuallyScheduled`).
- Add schedule controls (date/time + actually-scheduled flag) with the
  backend errors (`TOO_MANY_SCHEDULED_NOTES/SCHEDULED_AT_REQUIRED/
  MUST_BE_IN_FUTURE`).
- Add server drafts CRUD (`notes/drafts/create|list|update|delete|count`)
  alongside the local store: local stays as the offline cache, server as
  the source of truth once signed in; keep `MAX_DRAFTS=20` locally.
- Add inline-composer drafts entry (same `Drafts (n)` pattern) and a
  scheduled filter in the drafts list.

## 8. Default like emoji → server-persisted

Today device-local (`state/emojiPrefs.tsx`, `keystone_like_emoji`,
`Settings.tsx:209-267`, picker ctx menu `EmojiPicker.tsx:216-237`,
`LikeButton ReactionPicker.tsx:92-152`).
- Persist per-account once the backend offers a field (see backend §6
  decision); fall back to localStorage when the server 404s.
- Keep the heart→emoji upgrade-on-click and chips-exclude-like behavior.

## 9. Pins / featured

`ProfileNotesList.tsx:20-27` + `Profile.tsx:24-28` deliberately ship without
Featured (no pinned source; never faked). Tabs are Posts/All/Media.
- Add `i/pin|unpin` to the note menu (own notes only) with
  `PIN_LIMIT_EXCEEDED/ALREADY_PINNED` copy; `pinLimit:5`.
- Add the Featured tab backed by `pinnedNoteIds/pinnedNotes`, plus
  `notes/featured` and `users/featured-notes` ranking views.
- Keep the "ship absent until the source exists" rule — no placeholders.

## 10. Edit + delete-and-redraft

Delete exists (`routes/Note.tsx:301-319,431-442`, `notes/delete`, owner
gate). No edit call, no edit button, no redraft affordance.
- Delete-and-redraft (no backend needed): "Delete and edit" copies the note
  into the composer (`initialNote`/reply/renote context preserved) then
  deletes; keep the Misskey data-loss warning (reactions/renotes/replies
  go with it).
- True edit waits on the backend `notes/edit` decision (Sharkey shape +
  federated `Update(Note)`). UI is an edit form on the same composer
  surface, not a second editor.

## 11. Full follower list

Done for paging (cursor to exhaustion, retry-remembered cursor,
skeletons). Only work is the §2 privacy copy. No search-within-list
(Misskey parity doesn't need it).

## 12. Notifications: grouping + filtering

`Notifications.tsx:17-39,89-155,196-205` pages (`limit:20/untilId`),
`TYPE_LABELS`, mark-all-read, `N new — Refresh` on `main`-channel events.
No type filter, no grouping; request is `{limit,sinceId?,untilId?}` only.
- Grouping: render `reaction:grouped{reactions:[{userId,reaction}]}` and
  `renote:grouped{userIds[]}` rows from `i/notifications-grouped`; keep
  the same paging + mark-all-read.
- Filtering: add a filter bar (`includeTypes/excludeTypes`) now (works on
  all backends), then per-user `notificationRecieveConfig` editors
  (`never|following|follower|mutualFollow|followingOrFollower|list`) +
  mute/block management once backend §11 lands. Requested presets map to
  existing machinery (blacklist = mutes, whitelist = empty
  `followingOrFollower|list`, mutuals = `mutualFollow`, followed =
  `following`) — no second list UI.

## 13. Timelines: replies, blocks, mutes

`TimelineFeed.tsx:98-101` sends `{limit,sinceId,untilId}` only; cross-backend
rule bans `includeMyRenotes*` (`api-surface.md:94-101`). Reply context is
display-only (`NoteCard.tsx:170-198`, `TimelineFeed.tsx:302-331`); CW is a
binary hide (`NoteBody.tsx:390-397`). No block/mute calls, no word-mute
lists, no soft-mute dim.
- Reply defaults: follow the backend fix (home hides non-self replies;
  local/hybrid keep self-replies + replies-to-you with
  `withReplies=false`). If the backend ships literal "replies from
  followed only" in home as an extension, add a timeline setting for it —
  don't silently change home.
- Blocked/hard-muted: drop rows the backend would exclude (blocked,
  muted author/reply/renote, instance-mute, host-block, suspended) once
  `api-surface.md` lists the endpoints; keep feeds socket-independent.
- Soft-mute: add `mutedWords/hardMutedWords/mutedInstances` editors (part
  of §1), then forced-CW rendering (muted-word match → injected CW, body
  kept; hard match → hidden/dropped). Upstream web does this client-side;
  Keystone follows the backend's server-CW decision so API clients agree.

## 14. Import / export

No routes/components (`App.tsx:40-58`, `Settings.tsx:33-49` has 3 sections
only); no `i/import|export` in `api-surface.md:108-110`.
- Add `/settings/import` + `/settings/export` pages: following/blocking/
  mute/notes first (Misskey-compatible files), then lists/antennas/clips/
  favorites.
- Upload with the `import-blocking.ts` guards (size/type, per-row report);
  download from the export job; surface `exportCompleted` notifications
  in the Notifications route.

## Order + verification

1. §0 + §1 (editor + mute/block helpers) — unblocks §§2–3, 12–13.
2. §§2–3, 9 (privacy + pins — small, high value).
3. §§5–7 (polls un-gate, scheduling, drafts).
4. §§12–13 (grouping, filtering, timeline rules, CW).
5. §4 (quote-disable), §10 edit (needs backend `Update(Note)` call).
6. §14 import/export last; §8 persistence rides with §1.

Per slice: `tsc --noEmit` + `npm run build` green; extend the smoke suites
(`scripts/smoke_{flows,writes,features,streaming}.py`) where the contract
grew; browser visuals stay owner-verified ("not yet verified" when not run).
Update `docs/api-surface.md` capability table as backend slices land; never
call an endpoint it doesn't list.
