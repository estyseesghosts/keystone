# Keystone: UX and Correctness Fix Guide

**Purpose:** Give an implementation agent a prioritized, source-grounded plan for making Keystone feel reliable rather than merely changing its styling.

**Review date:** 2026-10-15  
**Review type:** Static source review of the repository's current `main` branch. The app was not run in a browser during this review, so responsive and interaction findings still require runtime verification.

## Most important finding: the frontend targets the wrong API contract

The product goal is to use Keystone against local Misskey and Sharkey instances. The checked-in frontend and agent instructions instead explicitly target Pinetree:

- [`frontend/src/api/client.ts`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/api/client.ts) hardcodes the request transport, authentication field, and expected error envelope.
- [`frontend/src/api/types.ts`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/api/types.ts) defines the wire types Keystone expects.
- [`AGENTS.md`](https://github.com/estyseesghosts/keystone/blob/main/AGENTS.md) says Pinetree's endpoint manifest is definitive and explicitly forbids several endpoints.
- [`README.md`](https://github.com/estyseesghosts/keystone/blob/main/README.md) calls Keystone a Pinetree web client.
- [`docs/api-surface.md`](https://github.com/estyseesghosts/keystone/blob/main/docs/api-surface.md) documents Pinetree-specific support and limitations.

This is a functional-scope mismatch, not a cosmetic issue. Do **not** assume that an endpoint, login flow, payload shape, or limitation documented for Pinetree also applies to Misskey and Sharkey. Equally, do not keep presenting an endpoint as unsupported merely because Pinetree lacks it.

### Required first step

Update the project brief and agent instructions to name the intended backend targets. Then build a small compatibility matrix for the local Misskey and Sharkey instances: sign-in/session restore, home/local/global timelines, note details and replies, create/quote/repost, reactions, profiles/following, notifications, and media. Verify each item against both servers' actual behavior before wiring the UI. If Pinetree remains a supported target, isolate server-specific transport and payload differences instead of pretending all three APIs are identical.

**Acceptance:** Both intended servers complete the supported user flows without unexpected 404s, payload-shape errors, or misleading “not supported” messages. Any genuinely unsupported feature is clearly unavailable rather than wired to an assumed endpoint.

## Prioritized fixes

### P1 — Keep successful repost feedback; prevent accidental duplicates

**Files:** [`TimelineFeed.tsx`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/components/TimelineFeed.tsx), [`Note.tsx`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/routes/Note.tsx), [`NoteCard.tsx`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/components/NoteCard.tsx)

Both timeline and note-detail views clear their `reposted` state after two seconds. The action has succeeded, but its visual state then disappears; a user can click again and create another repost. In the timeline, `repostedIds` is explicitly filtered after the timeout.

**Fix:** Remove the timeout. Keep a successful repost state on the affected original note for the lifetime of the current view, clearly expose it to assistive technology, and suppress another repost action for that note unless a real undo/repost API flow is implemented. Do not invent an undo action. Check whether the selected backend exposes the current user's repost state; only claim persistence across reloads if the API can confirm it.

**Acceptance:** After a successful repost, the state remains visible; a second click does not create another repost; a failed request never displays success; the note count remains consistent after refresh. Test in both timeline and note-detail views against each target backend.

### P1 — Make pagination finish cleanly and retry the action that failed

**File:** [`TimelineFeed.tsx`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/components/TimelineFeed.tsx)

The feed always renders **Load older** after displaying notes, even if a request returns no new notes. It appends pages without deduplicating IDs. Also, a failed older-page request shows **Try again**, but that button calls `load("refresh")` and replaces the feed with a fresh first page instead of retrying the older-page request.

**Fix:** Track whether older pages remain; mark the feed exhausted when a page returns no new note IDs; hide or disable **Load older** when exhausted; deduplicate merged pages by note ID. Preserve the failed operation mode and cursor so the retry action retries the older page, not a refresh. Keep already-loaded notes visible on pagination errors.

**Acceptance:** Loading to the end produces a clear end state and no repeated empty requests. Overlapping pages do not duplicate notes. A failed older-page request can be retried without losing the loaded feed or jumping back to the top.

### P1 — Make people discoverable from notes and notifications

**Files:** [`NoteCard.tsx`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/components/NoteCard.tsx), [`Notifications.tsx`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/routes/Notifications.tsx), [`MfmRenderer.tsx`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/components/MfmRenderer.tsx), [`Profile.tsx`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/routes/Profile.tsx)

The profile route exists, but note avatars, note author names/handles, and notification authors are plain content. Users cannot naturally reach those profiles from the feed. Mentions and hashtags are also rendered as styled text, not links.

**Fix:** Link each note's avatar/name/handle and each notification author to the corresponding profile route, using the user ID already present in the note/notification data. For MFM mentions, resolve usernames through an endpoint verified for the target backend and cache results; do not create dead links. Keep hashtags non-interactive until a note-search/tag route is actually supported.

**Acceptance:** A user can open an author's profile from a note or notification using mouse, touch, and keyboard. Profile links resolve correctly for local and remote users. Unsupported mention/tag navigation is not represented as a working link.

### P1 — Make the mobile navigation fit without mixing in account controls

**Files:** [`Layout.tsx`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/components/Layout.tsx), [`global.css`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/styles/global.css)

At widths under 720px, route links are placed in a fixed bottom bar, but the sign-in/sign-out control remains in the same row. The four main links plus account control can compete for width, especially on narrow phones and with longer labels. The fixed bar also needs to be checked against safe-area insets and focused controls.

**Fix:** Keep the bottom bar for route navigation. Move sign-in/sign-out into a separate account area or a compact menu instead of giving it space in the route row. Preserve the existing monochrome style; do not solve this by shrinking text until it is hard to read.

**Acceptance:** Check 320px, 360px, 390px, tablet, and desktop widths. No horizontal overflow; all destinations and account actions remain reachable; page content and focused controls are not obscured by the fixed bar; bottom safe-area padding works on iOS-style devices.

### P1 — Render media according to its actual type

**File:** [`NoteCard.tsx`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/components/NoteCard.tsx)

`MediaItem` displays images inline, but every non-image file—including video and audio—is reduced to a filename link. That makes video posts feel like file downloads rather than social posts. The composer is text-only, which is a separate capability limitation and should be stated honestly until upload support exists.

**Fix:** Branch by MIME type: render images as images, `video/*` with a native player and controls, and `audio/*` with a native audio player; keep unknown types as file links. Preserve the sensitive-media reveal gate before rendering any media. Use API-provided media URLs only. Handle load failures without leaving a broken blank area.

**Acceptance:** Image, video, audio, and unknown-file examples render appropriately. Sensitive media stays hidden until revealed. Video/audio controls work on mobile and desktop. No upload button should appear until upload is implemented end-to-end.

### P1 — Correct invalid nested interactive controls on logged-out screens

**Files:** [`Home.tsx`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/routes/Home.tsx), [`Notifications.tsx`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/routes/Notifications.tsx)

Both screens wrap a `<button>` inside a router `<A>` link for **Sign in**. Nesting interactive controls produces invalid interaction semantics and can cause confusing keyboard/focus behavior.

**Fix:** Use a styled `<A>` as the single interactive control, or a single button that navigates. Do not nest one interactive element inside another.

**Acceptance:** The sign-in action has one tab stop, one accessible name, and works with keyboard and touch.

### P2 — Fix quoted-note link structure and clarify reply results

**Files:** [`NoteCard.tsx`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/components/NoteCard.tsx), [`Note.tsx`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/routes/Note.tsx), [`MfmRenderer.tsx`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/components/MfmRenderer.tsx)

The quoted/renoted note is wrapped in one large `<A>` that also contains rendered note text. MFM text can itself contain external `<a>` elements, creating nested anchors. That is invalid markup and can make links behave unpredictably.

The note-detail reply composer reloads the parent note after posting but does not show the returned reply in a reply list. Whether a proper thread can be shown depends on the target backend's supported reply endpoint.

**Fix:** Replace the all-enclosing quote link with a non-interactive container and a distinct **Open quoted note** link; keep links inside the quoted body independently usable. For replies, use a verified replies endpoint when available; otherwise show clear post-success feedback and do not imply the page contains the full thread.

**Acceptance:** External links inside quoted notes open the external destination; the separate note link opens the quoted note. Posting a reply produces clear confirmation, and the UI accurately describes whether the full thread is available.

### P2 — Make notifications informative instead of raw API output

**File:** [`Notifications.tsx`](https://github.com/estyseesghosts/keystone/blob/main/frontend/src/routes/Notifications.tsx)

The view renders the raw notification type and note excerpt, but does not show the supplied `createdAt` or distinguish the supplied `isRead` state. It only fetches 20 notifications and exposes no older-page control.

**Fix:** Map known notification types to readable labels, show formatted timestamps, and visually distinguish unread items using `isRead`. Add pagination only after verifying the selected server's cursor parameters. Link authors as described above. Do not invent a mark-as-read API call.

**Acceptance:** Known types render human-readable labels; timestamps and unread/read states are distinguishable; older notifications are reachable if the endpoint supports pagination; unknown types have a readable fallback.

## Documentation and agent-workflow cleanup

**Files:** [`README.md`](https://github.com/estyseesghosts/keystone/blob/main/README.md), [`AGENTS.md`](https://github.com/estyseesghosts/keystone/blob/main/AGENTS.md), [`state/STATE.md`](https://github.com/estyseesghosts/keystone/blob/main/state/STATE.md), [`docs/frontend-plan.md`](https://github.com/estyseesghosts/keystone/blob/main/docs/frontend-plan.md)

The README and AGENTS instructions still say the frontend does not exist and describe the project as init/Phase 0, although `frontend/src/` is present and `state/STATE.md` records a built app. `state/STATE.md` also repeats headings and contains conflicting current-task/next-action sections. These stale instructions can send agents back to scaffolding or cause them to follow the wrong backend contract.

**Fix:** Update the README, AGENTS, frontend plan, and state pointer in one documentation pass. Keep one current phase/task, one next-actions list, and explicit links to append-only evidence logs. Make the selected backend target and verified support matrix authoritative; do not keep contradictory Pinetree-only and Misskey/Sharkey instructions.

**Acceptance:** A new agent can identify the actual app, intended backend(s), current task, supported API surface, build command, and remaining checks in under five minutes without following obsolete setup steps.

## Verification checklist

Do not close this work based only on TypeScript or build success. Run `npm run build`, then verify in a browser against **both local Misskey and Sharkey** instances.

- [ ] Sign in, reload to restore the session, sign out, and sign in again.
- [ ] Load home, local, and global feeds; verify empty, error, refresh, pagination, and end-of-feed behavior.
- [ ] Open a note, its author profile, a quoted note, and any available reply thread.
- [ ] Create a note and reply; test quote and repost; confirm one repost action creates only one repost.
- [ ] React and unreact; verify counts after refresh.
- [ ] Open notifications, profiles, follow/unfollow, and supported media types.
- [ ] Test at 320px, 360px, 390px, tablet, and desktop widths; check focus visibility, keyboard navigation, and bottom safe areas.
- [ ] Check browser console and network requests for runtime errors, repeated 404s, malformed payload assumptions, and accidental duplicate writes.
- [ ] Update the state pointer and append a dated log with actual command/test output; label anything not run as **not yet verified**.

## Suggested implementation order

1. Resolve the Misskey/Sharkey API-contract mismatch and update stale source-of-truth docs.
2. Fix persistent repost state and pagination/error retry behavior.
3. Fix profile navigation, mobile navigation, and invalid nested controls.
4. Improve media rendering and quoted-note/reply behavior.
5. Improve notification presentation, then complete the two-server browser pass.

Keep changes small and independently testable. Do not redesign the visual language or add dependencies to solve these behavioral problems.
