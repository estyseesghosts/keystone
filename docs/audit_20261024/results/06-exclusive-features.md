# Exclusive Features Audit

Scope: Misskey-only + Mastodon-only screens, composer, and `packages/fedi` modules.
Method: full read of every file in scope; greps for `capabilit`, `unsupported`,
`inert`, `fake|mock|sample data`, `TODO|FIXME|HACK`. All line numbers verified
against the working tree on 2026-10-24.

## File sizes

Exact `wc -l` counts. Flag threshold: >650 LOC.

| File | LOC | >650? |
|---|---|---|
| `src/screens/Drive.tsx` | 1000 | YES |
| `src/components/Composer/Composer.tsx` | 758 | YES |
| `src/components/Composer/ComposerSections.tsx` | 689 | YES |
| `src/components/Composer/CompactComposer.tsx` | 552 | no |
| `src/screens/Lists.tsx` | 509 | no |
| `src/components/Settings/TransferSections.tsx` | 440 | no |
| `src/screens/Antennas.tsx` | 393 | no |
| `src/screens/Clips.tsx` | 384 | no |
| `packages/fedi/src/misskey/chat.ts` | 330 | no |
| `packages/fedi/src/mastodon/instance.ts` | 322 | no |
| `src/screens/Announcements.tsx` | 292 | no |
| `packages/fedi/src/misskey/importExport.ts` | 253 | no |
| `src/screens/Channels.tsx` | 244 | no |
| `src/screens/ChatRooms.tsx` | 220 | no |
| `src/screens/Conversation.tsx` | 220 | no |
| `src/screens/Conversations.tsx` | 216 | no |
| `src/screens/ChatThread.tsx` | 212 | no |
| `src/screens/FollowRequests.tsx` | 189 | no |
| `src/screens/Channel.tsx` | 184 | no |
| `src/components/Post/PostPoll.tsx` | 161 | no |
| `src/screens/ChatUser.tsx` | 160 | no |
| `src/screens/Antenna.tsx` | 156 | no |
| `packages/fedi/src/mastodon/conversations.ts` | 151 | no |
| `src/screens/NoteHistory.tsx` | 145 | no |
| `src/screens/ChatRoom.tsx` | 138 | no |
| `src/screens/List.tsx` | 135 | no |
| `src/screens/Clip.tsx` | 135 | no |
| `src/components/Composer/Autocomplete.tsx` | 114 | no |
| `src/components/Composer/useAutogrowInput.ts` | 96 | no |
| `packages/fedi/src/mastodon/domainBlocks.ts` | 92 | no |
| `packages/fedi/src/misskey/channels.ts` | 91 | no |
| `packages/fedi/src/misskey/clips.ts` | 88 | no |
| `packages/fedi/src/misskey/announcements.ts` | 88 | no |
| `packages/fedi/src/misskey/noteEdit.ts` | 79 | no |
| `src/screens/Favorites.tsx` | 65 | no |
| `src/screens/NewsDiscussions.tsx` | 64 | no |
| `packages/fedi/src/misskey/schedule.ts` | 54 | no |
| `packages/fedi/src/misskey/serverDrafts.ts` | 50 | no |
| `packages/fedi/src/mastodon/listMembership.ts` | 18 | no |

The three flagged files are all honest, well-commented code — but all three
are past the size where splitting pays. See "Condensed responsibility".

## Long-parameter functions

No free function takes a long positional parameter list; the codebase uses
props-object / opts-object throughout. The prop-object equivalents worth
noting (prop count, not a violation, but refactor signal when combined with
file size):

- `ChatThread` (`src/screens/ChatThread.tsx:99`) — **12 props**
  (`testPrefix`, `thread`, `emptyLabel`, `sendLabel`, `sending`,
  `sendError`, `onSend`, `viewerAccountId`, `deleteState`, `onDelete`,
  plus the two threaded through). Works, but it is a second public
  interface to keep in sync with `ChatThreadData`.
- `useComposerController` (`src/components/Composer/Composer.tsx:151`) —
  destructures **12 fields** from `ComposerProps`
  (`src/components/Composer/Composer.tsx:99`, 11 fields: `session`,
  `backend`, `store`, `replyTo`, `quote`, `editing`, `redraftSeed`,
  `draftId`, `uploadFolderId`, `onClose`, `onPosted`). Justified — one
  options object — but the controller return object
  (`Composer.tsx:530-538`) is 30+ fields consumed positionally by two
  chromes. Any rename breaks both; TypeScript covers it.
- `UploadPanel` (`src/screens/Drive.tsx:210`) — 11 props. Pure presentational,
  fine but a candidate for a small `upload: {...}` grouping if Drive splits.
- `FileRow` (`src/screens/Drive.tsx:291`) — 9 props (6 callbacks). Same note.
- `ChatThreadData` + `ClipRow` (`Clips.tsx:74`, 8 props), `AntennaRow`
  (`Antennas.tsx:110`, 7 props) — consistent, no action.
- `packages/fedi` modules: all functions take `(call|client, …)` + one opts
  object. No finding.

## Condensed responsibility

1. **`src/screens/Drive.tsx` (1000 LOC).** Five concerns in one file:
   file listing + pagination, folder CRUD + scope picker, upload panel,
   file detail dialog, attached-notes dialog. Each sub-component
   (`FolderRow`, `FolderScope`, `UploadPanel`, `FileRow`, `FileDetailDialog`)
   is coherent; the file is one more feature (e.g. bulk select, quota row)
   away from needing a `src/screens/Drive/` split. Not a bug today.
2. **`useComposerController` + `Composer` (758 LOC) + `ComposerSections`
   (689 LOC).** The controller owns: create / edit / redraft / local-draft
   restore / autosave / target re-attachment / media edits / uploads /
   quote-refusal retry. Sections own 10 render blocks (CW, reply/quote
   preview, poll, uploads, seeded media, schedule, recipients, drafts,
   scheduled list, server drafts, emoji). Sharing via one controller +
   shared sections means Compact/Full cannot drift (verified: no duplicated
   submit/validation logic). Condensation is managed, not accidental — but
   1447 LOC behind one `ComposerController` type means every composer change
   touches the same blast radius.
3. **`src/components/Settings/TransferSections.tsx` (440 LOC).** Import flow
   + export flow + export-completion cache watcher + both family-gated
   sections. Cohesive (one feature: portability), acceptable size.
4. **`src/screens/Lists.tsx` (509 LOC).** Index + create + rename + inline
   field-gate editors for two families. The `fieldGate` /
   `repliesPolicyGate` / `exclusiveGate` / `chosenListFields` helpers
   (`Lists.tsx:44-81`) are the reason it stays correct; size is justified.
5. **Antennas / Clips / Channels index screens (384-393 LOC each).** Same
   list/create/rename/delete shape repeated 3x with per-concept wording.
   Deliberate duplication (no shared generic CRUD component), each honestly
   gated. If a fourth collection screen appears, extract the pattern; until
   then, leave it.

## Suspected bugs (file:line)

Ordered by confidence. "Confirmed" = read both sides of the contract;
"Suspected" = one side read, needs a live-server check.

1. **Chat file attachments are invisible (confirmed).**
   `src/screens/ChatThread.tsx:50-53` — `ChatMessageRow` renders
   `message.text` only. The domain model carries `fileId`/`file`
   (`packages/fedi/src/misskey/chat.ts:158-172`, adapter populates both),
   and `sendParams` supports `fileId` (`chat.ts:276-288`), but no row, no
   thumbnail, no download link renders the attachment. A file-only message
   (`text: null`) renders as an author line with nothing under it. The send
   box is text-only by documented design (`ChatThread.tsx:9-10`), so
   receiving is the gap, not sending.
2. **Misskey multi-choice poll vote is non-atomic (confirmed code, live
   behavior suspected).** `packages/fedi/src/misskey/backend.ts:1023-1027`:
   `votePoll` loops `choices` with one `notes/polls/vote` POST per choice
   (the endpoint takes a single `choice`). If POST 2 of 3 fails, choices
   already recorded stay recorded; the UI (`PostPoll.tsx:89-104`) shows a
   generic error and leaves `selected` intact for retry — retrying
   re-submits already-counted choices (server may 400/ignore duplicates;
   unverified). Single-choice polls (the common case) are unaffected.
3. **`PostPoll` selection state never resyncs to new poll props (confirmed).**
   `src/components/Post/PostPoll.tsx:67-69`: `selected` is seeded from
   `poll.options[].voted` in a `useState` initializer. If the parent
   refetches (vote recorded elsewhere, poll closed remotely), the checkmarks
   and `voted` lock stay stale until remount. The `mine` derivation
   (`PostPoll.tsx:120`) mixing `selected` and `opt.voted` further suggests
   this was worked around rather than fixed. Low severity (feed rows remount
   often), but a `key={poll.id + poll.votesCount}` or an effect-sync would
   close it.
4. **Mastodon vote does a redundant GET before every POST (confirmed).**
   `packages/fedi/src/mastodon/endpoints.ts:906-920`: `voteInPoll` fetches
   the full status to resolve the poll id (the wire needs the POLL id, the
   domain `Poll` carries none) then POSTs votes. Correct, but doubles
   latency on every vote and opens a GET-then-POST race (poll closes or is
   deleted in between → raw shape error to the user). Improvement: resolve
   the poll id once at adapt time (stash on the domain model) or accept the
   GET and map its failure to "poll is gone".
5. **Drive file-delete confirm has no busy guard (confirmed).**
   `src/screens/Drive.tsx:403-408`: the confirm button calls
   `onDelete()` (the screen-level async delete in `Drive.tsx:841-852`)
   without disabling itself. `busy` in `FileRow` belongs to the rename
   flow; a double-tap fires two `deleteFile` calls. Second call likely 404s
   harmlessly and the row is already filtered optimistically — cosmetic at
   worst. One-line fix: local `deleting` state or reuse `busy`.
6. **Clip privacy is create-only (confirmed gap).**
   `packages/fedi/src/misskey/clips.ts:69-76` `updateClip` accepts
   `isPublic`, but `Clips.tsx:321-330` rename sends `{name}` only, and no
   UI exposes the flag after creation. A clip created private can never be
   made public (or vice versa) in-app. Small fix, real user impact.
7. **Antenna create pins 8 server fields to defaults (confirmed, documented).**
   `src/screens/Antennas.tsx:43-68`: `userListId: null` (no list-source
   picker — admitted in the header comment), `excludeKeywords: []`,
   `users: []`, `caseSensitive/localOnly/excludeBots/withReplies/withFile:
   false`. There is no notify/push toggle anywhere in the antenna surface
   (grep for `notify|push` in `Antenna.tsx` + misskey modules: only
   notification-*adapt* hits, no antenna-push control). Users who want
   "notify me on match" or list-scoped antennas must use the website.
   Partially intentional (small create form); the missing piece is recording
   it — no TODO/ADR marks the deferral.
8. **Conversation mark-read fires once and swallows failure
   (confirmed).** `src/screens/Conversation.tsx:91-101`: `markedRef`
   guarantees one attempt per thread; the `.catch(() => {})` means a failed
   mark never retries within the session — the inbox keeps the unread badge
   until refetch. Deliberate ("never blocks the thread"), acceptable, but
   the failure is also unlogged (no console, no caption). Add at minimum a
   `console.warn`.
9. **Conversation history assumes the DM chain is a reply chain
   (confirmed, honest but lossy).** `src/screens/Conversation.tsx:69-87`:
   history = `backend.thread(lastPost).ancestors`. The header comment
   (`Conversation.tsx:1-10`) admits neither server exposes a
   conversation-statuses endpoint. Group DMs and non-reply chains will show
   an incomplete thread with no "may be incomplete" caption — `thread()`
   returns `incomplete` (`Conversation.test.tsx:75` fixtures it) and the
   screen ignores that flag. Fix: surface `incomplete` as a caption.
10. **`fetchConversation` is an O(n) inbox scan (confirmed, documented).**
    `packages/fedi/src/mastodon/conversations.ts:98-124`: no show route on
    either server, so opening one thread pages the whole inbox. Terminates
    (repeat-continuation guard) and maps miss to typed 404 — correct, just
    slow on large inboxes. No fix available short of Akkoma's namespaced
    show route (explicitly rejected in the header comment). Not a bug;
    recorded so nobody "optimizes" it into a wrong single-fetch.

**Checked and cleared (no bug):**

- *Schedule timezone.* `ComposerSections.tsx:338-352` builds "tomorrow 9:00"
  with local `setHours` then `toISOString()` (correct local→UTC), validates
  with `Date.parse` future-check (`:336-337`), displays with
  `toLocaleString` (`:537`). `parseScheduledAt`
  (`packages/fedi/src/misskey/schedule.ts:42-47`) parses `datetime-local`
  as local → ISO. Round trip is consistent. No finding.
- *Transfer honesty (4 Misskey import kinds + 8 export kinds).*
  `TransferSections.tsx:44-76` defines 4 `IMPORT_ROWS` + 8 `EXPORT_ROWS`
  (12 rows total); Misskey family renders 12 live rows (with an additional
  Drive gate for imports, `:371-389`); without `backend.transfer`
  (Mastodon) **all 12** render as `PlaceholderRow` with the explicit reason
  "Needs a Misskey-family server. Mastodon has no import/export API — use
  the instance website." (`:339-340`, `:353-425`). The "5 vs 12" framing in
  the brief is off by one — it is 4+8=12 — but the honesty property holds:
  verified, no inert controls, fork-level gaps surface as action-time
  errors (`transferErrorMessage`, `:79-93`). `TRANSFER_EXPORT_ENTITY`
  (`packages/fedi/src/core/backend.ts:1476`) maps all 8 export kinds to
  verified processor tokens.
- *Antenna rename Sharkey-400 risk.* Cleared: `Antennas.tsx:348` passes
  `{...item, name}` but `antennaBody`
  (`packages/fedi/src/misskey/backend.ts:1525`) allow-lists 11 fields, so
  `id` never rides the wire. Same pattern as Drive folder update (explicit
  params). No finding.
- *Clip privacy leak.* Cleared: clip names resolve from the viewer's own
  `clips.list()` (`Clip.tsx:44-51`); another user's clip id reads as
  "does not exist", never their notes. `isPublic` renders honestly
  (`Clips.tsx:125`).
- *Channel follow on archived channels.* `Channel.tsx:162` labels archived;
  follow toggle stays enabled and lets the server refuse (error surfaces via
  `actionError`, `:173-175`). Acceptable — better than guessing the server
  rule. `isFollowing == null` disables WITH reason (`:44-47`). No finding.
- *Channel missing-state.* `channels/show` answers 400 `NO_SUCH_CHANNEL`,
  correctly mapped (`Channel.tsx:79-86`). No finding.

## Quality issues

- **Dead code: `POLL_DURATIONS` in `Composer.tsx:70-75`.** Identical const
  redeclared in `ComposerSections.tsx:44-49`, where the live `PollSection`
  actually uses it (`:205`). `Composer.tsx` never references its copy
  (grep: one definition hit, zero use hits). Delete the `Composer.tsx` copy.
- **No `unsupported-means-hidden` violations found.** Every exclusive screen
  gates on both module presence AND the matching capability flag, with
  `unknown` treated as locked (e.g. `Conversations.tsx:150-155`,
  `ChatRooms.tsx:125-126`, `Announcements.tsx:227-229`). Disabled controls
  carry reasons (`Channel.tsx:44-47`, `Lists.tsx:98-129`,
  `FollowRequests.tsx:66-82`, `Announcements.tsx:131-141`,
  `Composer.tsx:655-672`). Zero `TODO/FIXME/HACK` hits in scope; zero
  `fake/mock/placeholder-data/sample` hits outside the honest
  "never shows sample data" captions and the named `PlaceholderRow`
  component (which is the honest-disabled pattern itself, carrying a
  reason string).
- **No fake data found.** All exclusive screens render signed-out states
  with explicit "never show sample data" captions; `adaptChatRoom` /
  `adaptChannel` / `adaptAnnouncement` use empty-string/null, never invented
  content (`chat.ts:104-172`, `channels.ts:36-56`, `announcements.ts:54-72`).
- **No Compact/Full composer drift.** Both chromes consume the same
  `useComposerController` + section components with identical testIDs.
  Verified by read of both files end to end.
- **Domain-block vs mute separation verified, UX adjacency noted.**
  `MutesSection.tsx` keeps three distinct surfaces: word/instance filters
  (`mutedInstances` Misskey word-filter, `:41-91`), account mute/block
  search, and `DomainBlocksSection` (Mastodon-only `backend.domainBlocks`,
  `:438-456`, hidden entirely when the member is absent). No logic
  confusion. Minor UX note: `mutedInstances` (Misskey "hide instances"
  word filter) and domain blocks (Mastodon server blocks) are different
  mechanisms with similar names in adjacent rows — a one-line hint
  distinguishing "hide" from "block" would help cross-family users.
- **List membership sync is sound.** `listsContaining` / `addToList` /
  `removeFromList` (`listMembership.ts`, 18 LOC) are thin and correct;
  `ProfileActions` gates the "Add to list…" row with a reason and loads
  lists on dialog open. No finding.
- **Drive upload failure path is honest.** `uploadStaged`
  (`Drive.tsx:749-769`) keeps the staged file + surfaces the error, so retry
  is possible; per-file "Uploading…" state is documented as a transport
  limitation (`Drive.tsx:11-13`). Only nit: Cancel is disabled mid-upload
  (`Drive.tsx:258`) — in-flight requests cannot be aborted (no
  AbortController threading). Acceptable, note for a future slice.
- **`NoteHistory.tsx:131` count assumes `history[0]` is the original.**
  `(length - 1)` renders as the edit count. True for Mastodon's
  `statuses/:id/history` shape; a fork returning edits-only would read "0
  edits" on a 1-row list. Trivial; guard with `Math.max(0, …)` or derive
  from the `original` flag.
- **Chat live-reconnect is pool-level, invisible at the screen.**
  `useChatRoomLive`/`useChatUserLive` (`src/state/queries/chat.ts:309-360`)
  subscribe `chatRoom`/`chatUser` channels with id-deduped merge; reconnect
  with backoff lives in `packages/fedi/src/misskey/stream.ts:197-278`.
  No per-hook error/reconnect surfacing means a dead socket looks identical
  to a quiet thread (paging + refresh still work, per the header contract).
  Not a bug per the stated contract, but a "live" affordance with no
  connection indicator will eventually generate false "messages are broken"
  reports. Consider a stale/ reconnecting caption if the stream pool ever
  exposes status to UI.

## Top 5 fix priorities

1. **Render chat attachments in `ChatThread`** (bug 1 — visible data loss:
   file-only messages render empty). Add a file row (name + open/download
   via `file.url`) to `ChatMessageRow`; the domain data is already there.
2. **Make Misskey poll votes atomic-or-honest** (bug 2 — partial votes are
   silent corruption). Options: single `choice` fast path + sequential with
   stop-on-first-failure and "N of M recorded — retry records the rest"
   copy; verify duplicate-choice server behavior on the rig first.
3. **Expose clip `isPublic` editing** (bug 6 — privacy users cannot fix).
   Add the flag to the rename editor; `updateClip` already supports it.
4. **Delete dead `POLL_DURATIONS` in `Composer.tsx:70-75`** (quality —
   30-second fix, removes a future divergence trap where someone edits the
   wrong copy).
5. **Surface `thread().incomplete` + record the antenna deferral**
   (bugs 7/9 — honesty gaps, not crashes): a "some messages may be missing"
   caption in `Conversation.tsx` when `incomplete` is true, and an ADR/TODO
   scoping antenna notify + list-source + exclude-keywords (with the
   explicit "website for now" reason users already get on transfer rows).
