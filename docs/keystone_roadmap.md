# Keystone Roadmap: A Useful Misskey Client and a Reusable Pinetree Frontend

**Review snapshot:** 2026-10-15  
**Repositories:** [Keystone](https://github.com/estyseesghosts/keystone), [Pinetree](https://github.com/estyseesghosts/pinetree), [Misskey](https://github.com/misskey-dev/misskey), [Sharkey](https://github.com/DDVD233/sharkey)

## 1. Product direction

Keystone should become a small, reliable client for the everyday Misskey-family experience—not an attempt to recreate every screen in the official Misskey web client. Its architecture should also make it a useful client for Pinetree as Pinetree implements a deliberately chosen Misskey-compatible API subset.

That leads to three priorities:

1. **Make current workflows correct and testable.** A clicked button is not proof that a server-side action succeeded; state must reconcile with the backend, errors must remain visible, and interactions must survive refreshes.
2. **Invest in features that serve both backends.** Drive/media management and Antennas deserve first-class scope because implementing their contracts for Misskey/Sharkey gives Keystone reusable UI and concrete compatibility targets for Pinetree.
3. **Keep the feature set intentionally bounded.** Prefer complete, well-tested vertical slices over a broad menu of half-implemented Misskey features. A feature is “supported” only when its UI, permissions, API contract, failure states, and tests are in place.

The architecture should not require identical backend internals. It should require a documented, tested **common behavior** for each feature Keystone promises across backends.

## 2. Current baseline and verified gaps

Keystone is a SolidJS/Vite SPA with Pinetree, Misskey, and Sharkey target modes. Its current baseline includes sign-in/session restoration, home/local/global timelines, cursor paging, note detail and replies, basic text composition, reactions, reposts, delete-own-note, profile timelines, follow/unfollow, notifications, media display by MIME type, and an allow-listed MFM renderer.

The current verification record reports a green frontend build/typecheck and local API-transport smoke tests against Misskey and Sharkey. However, the smoke scripts described by the repository are in `/tmp`, not checked into the repository; the work log explicitly says browser visual/console/media-playback checks were not performed. Treat current status as **API-smoke-verified, browser QA pending**, not fully end-to-end verified. See [Keystone’s current state](https://github.com/estyseesghosts/keystone/blob/main/state/STATE.md), [verification log](https://github.com/estyseesghosts/keystone/blob/main/state/logs/2026-10-15-stonekey.md), and [API surface](https://github.com/estyseesghosts/keystone/blob/main/docs/api-surface.md).

The most consequential gaps identified in the source and docs are:

- Media can be displayed, but Keystone does not yet provide upload or a usable Drive browser. Its scoped Misskey/Sharkey token currently lacks `read:drive` and `write:drive`.
- The app has no Antennas UI. Pinetree explicitly lists Antennas as unsupported; this needs to be a planned compatibility feature, not an accidental omission.
- Composer support is text-centric: no CW authoring, recipient picker for `specified` visibility, media attachment flow, or polls; the character limit is hard-coded to 3,000.
- The reaction control is effectively a fixed-heart experience; unrenote/repost undo and broader reaction selection need a deliberate interaction contract.
- Follow-state handling needs to distinguish an accepted follow from a pending request for locked accounts.
- A nested renote/quote embed renders its embedded text directly. It must not bypass the embedded note’s content warning or sensitive-media controls.
- The Misskey-family sign-in path returns `i: user.token!` from `SigninService.ts`. Keystone keeps the value in module memory instead of local storage, but the source does **not** prove it is a short-lived or narrowly scoped credential. Do not call it “temporary” without validating its lifetime and authority. Treat it as a high-sensitivity credential and audit the flow before expanding authentication.
- The login path reports an extra sign-in step but tells the user to finish it in an instance UI; that contradicts the Keystone-owned/no-redirect goal. Implement supported second-step flows or show an accurate, explicit unsupported-state message without implying that the flow has been completed.
- `docs/api-surface.md` says note search has “no endpoint.” Current Misskey and Sharkey source trees contain `notes/search` and `notes/search-by-tag`; access may be disabled by server policy, so the documentation should say **implemented but policy-dependent**, not unavailable by definition.
- Note and profile route parameter changes should be tested without a full page reload. If the router reuses the component, reload the relevant data when the `id` changes rather than relying only on mount-time loading.

These are a mix of confirmed feature gaps and targeted regression checks. Do not turn a plausible route-reuse concern into a declared bug until the behavior is reproduced.

## 3. Priority 0 — Correctness, security, and repeatable evidence

Do this as a short hardening slice before or alongside larger feature work. It reduces the chance of building new features on an unreliable foundation.

### 3.1 Establish repeatable tests in the repository

- Check in the useful API smoke tests currently living under `/tmp`, with configuration for local Misskey, Sharkey, and Pinetree URLs rather than hard-coded machine paths.
- Add tests for API error envelopes, HTTP 204 responses, unsupported endpoints, expired tokens, upload responses, pagination, and backend-specific capability differences.
- Add browser-level coverage for login, session restore, sign-out, timeline paging, post/reply, reaction/unreaction, repost/undo, follow/pending follow, note/profile route changes, CW reveal, and media display.
- Run the browser checks at narrow mobile widths and desktop widths, including keyboard focus and console-error inspection. Verify actual audio/video playback, not merely the presence of an `<audio>` or `<video>` element.
- Keep live federation checks separate from frontend component/API tests, but run the relevant cross-server interaction tests when a feature touches delivery or remote state.

### 3.2 Audit the Keystone-owned authentication flow

- Trace the exact origin, lifetime, scope, and revocation behavior of the `user.token` returned by Misskey/Sharkey `signin-flow`. Do not assume it is a disposable one-shot token just because Keystone does not persist it.
- Ensure that a failed token exchange or failed `/api/i` verification does not leave an unusable scoped token saved as the active session.
- Implement supported extra sign-in steps, or present a clear limitation. Do not tell users to leave Keystone for an instance UI when the product requirement is no redirects.
- Verify token revocation support and required permission before using it during sign-out. Regardless of server support or revocation failure, local sign-out must always clear Keystone session state.
- As features arrive, request least-privilege scopes deliberately: Antennas use account permissions on Misskey-family servers; Drive listing and upload require Drive read/write permissions. Do not give the client a wider permission set just to make a request stop failing.

### 3.3 Correct interaction state and note rendering

- Model locked-account follows as `not following`, `request pending`, and `following` where the backend exposes enough information. Do not optimistically mark a follow as accepted merely because the create request succeeded.
- Implement repost undo using the target backend’s supported `notes/unrenote` contract; verify exact parameters on Misskey and Sharkey rather than assuming every fork has identical options.
- After writes, reconcile important state from the response or a targeted refresh. Avoid state that is only “correct” until the next reload.
- Render embedded/quoted notes through a reusable note-body path that applies their CW and sensitive-media rules too. Hiding the outer note must not be the only protection for embedded content.
- Exercise direct navigation from `/notes/a` to `/notes/b` and `/users/a` to `/users/b` without a reload. Refresh data and reset page-specific loading/error/pagination state when the parameter changes.

### Exit criteria

The smoke tests are checked in and reproducible; auth risks are resolved or documented with a clear mitigation; high-impact UI state is server-backed; embedded content respects CW/media controls; and browser verification is recorded as passed or not yet verified. Update `state/STATE.md` and append a dated work log per `AGENTS.md`.

## 4. Priority 1 — Make Drive useful, not merely upload-capable

Drive is a core feature, not optional polish. It supports both everyday media posting and the longer-term Pinetree compatibility target. Treat it as one vertical feature with two milestones: **attachments in the composer** and a **usable Drive manager**.

### 4.1 Milestone A: upload and attach media while composing

Implement the shortest complete path first:

- Choose one or more local files; upload them to the backend.
- Show progress or a clear busy state, per-file errors, retry behavior, and a way to remove an attachment before posting.
- Attach the returned Drive file IDs through `notes/create` using `fileIds` (or the verified common field for the supported backend contract).
- Support image, video, audio, and generic-file attachments. Reuse existing MIME-aware rendering in notes and test real file URLs.
- Expose the essential metadata users need before posting, including filename/type and sensitive-media status. Preserve the server’s returned `isSensitive` and related fields instead of inventing client-only semantics.
- Handle partial multi-file upload failure without silently losing successful uploads or posting references to files that never uploaded.
- Keep URL handling and file serving aligned with the same-origin proxy/security rules; do not synthesize file URLs from user-controlled input.

**Transport detail:** Misskey’s `drive/files/create` uses `multipart/form-data`, not the JSON request helper. Use `FormData` and let the browser set the multipart boundary; do not set `Content-Type: application/json` for this request. Confirm the common authentication mechanism against all three backends. Misskey/Sharkey document this endpoint with the `write:drive` permission. Sources: [Misskey `drive/files/create`](https://github.com/misskey-dev/misskey/blob/develop/packages/backend/src/server/api/endpoints/drive/files/create.ts), [Misskey API token usage](https://misskey-hub.net/en/docs/for-developers/api/token/).

### 4.2 Milestone B: browse and reuse files from Drive

A posting-only upload button is not a functional Drive experience. Add a minimal Drive view/picker that lets users:

- List their files with cursor paging and loading/empty/error states.
- Filter by basic media type and select an existing file to attach to a note.
- Preview supported file types and display filename, size, and sensitive status.
- Navigate folders once folder support exists across the chosen backends.
- Create and manage folders as a subsequent bounded slice, after the file list and picker work reliably.

Deletion, renaming, moving files, advanced sorting, search, and bulk management are secondary. Do not make them prerequisites for being able to attach existing files.

### 4.3 Make Drive a Pinetree compatibility contract

Pinetree currently documents `drive/files/create` and `GET /files/{id}`, but not Drive listing or folder endpoints. Therefore, completing Keystone’s Drive UI only against Misskey/Sharkey is not enough for the intended product direction.

Define a small explicit shared contract and implement it on Pinetree as part of this roadmap:

- `drive/files/create`: multipart upload returning the stable DriveFile fields Keystone needs.
- `drive/files`: authenticated, paginated listing of the caller’s files, with a documented initial-folder/type filter if supported.
- File URL serving with correct content type and safe access behavior.
- Contract tests for the existing `notes/create` attachment path (`fileIds` / `mediaIds` as supported) and returned file metadata, aligning the shared fields without regressing Pinetree’s current upload/serve flow.
- Folder APIs only once the minimal upload/list/select path is sound. At that point, select the exact common subset for Misskey/Sharkey/Pinetree rather than copying every backend-specific Drive feature.

Update Pinetree’s frozen endpoint manifest/contracts and add conformance tests. Implement explicit unsupported responses for any fields that are not implemented; do not silently accept and ignore them.

### Drive acceptance criteria

A user can upload an image/audio/video/file, attach it to a post, see it after posting and after reload, open it successfully, browse existing uploads, and attach a pre-existing file. The same promised path works against Misskey, Sharkey, and Pinetree. Permission-denied, too-large, failed-upload, missing-file, and partial-upload cases are tested.

## 5. Priority 2 — Functional Antennas with a deliberately bounded first version

Antennas are another first-class feature for both the Keystone UI and Pinetree’s Misskey-compatible API. They are saved, user-configured filters that expose a separate note feed—not just a search form. Misskey and Sharkey have endpoint families for listing, creating, updating, deleting, and retrieving antenna notes. Their current endpoint shapes and permission requirements must be rechecked against the local versions used by the project.

Relevant Misskey endpoints include `antennas/list`, `antennas/create`, `antennas/update`, `antennas/delete`, and `antennas/notes`. The current Misskey source declares `read:account` for list/notes and `write:account` for create/update/delete. See [Misskey antenna creation](https://github.com/misskey-dev/misskey/blob/develop/packages/backend/src/server/api/endpoints/antennas/create.ts), [listing](https://github.com/misskey-dev/misskey/blob/develop/packages/backend/src/server/api/endpoints/antennas/list.ts), [notes feed](https://github.com/misskey-dev/misskey/blob/develop/packages/backend/src/server/api/endpoints/antennas/notes.ts), [update](https://github.com/misskey-dev/misskey/blob/develop/packages/backend/src/server/api/endpoints/antennas/update.ts), and [delete](https://github.com/misskey-dev/misskey/blob/develop/packages/backend/src/server/api/endpoints/antennas/delete.ts). Pinetree currently lists Antennas as unsupported.

### 5.1 Keystone Antennas UI

Build a focused feature with these screens/states:

1. **Antenna list:** list saved antennas, open a feed, create one, edit one, and delete with confirmation.
2. **Create/edit form:** make the name, source, keyword rules, excluded keyword rules, selected users (where applicable), case sensitivity, local-only filtering, bot exclusion, replies, and file filters understandable and editable.
3. **Antenna feed:** reuse the existing note card and timeline pagination/error components, use `antennas/notes` with `antennaId`, and provide refresh/paging. Until streaming exists, use manual refresh or modest polling with cancellation and backoff; do not make working Antennas dependent on live updates.
4. **State reconciliation:** after create/update/delete, use the returned server state or reload the antenna list. If an antenna is missing or permission is denied, show an actionable error rather than a blank feed.

### 5.2 Bound the first supported filter set

Do not expose controls that cannot work on every target. A practical first cut supports `home`, `all`, `users`, and `users_blacklist` sources, plus keyword include/exclude groups and the common flags available on both backends. Preserve the API’s nested arrays for keyword rules and validate their semantics against Misskey/Sharkey; do not flatten groups into a string or guess whether grouping means AND/OR.

The `list` source depends on user-list support. Either implement the small user-list API/UI subset that Antennas need, or mark list-backed Antennas unavailable until that dependency lands. Do not show a list-source option that cannot be configured. More specialized flags can be added only after the common behavior is verified.

### 5.3 Make Antennas work on Pinetree too

Pinetree needs a documented compatible subset, implemented as a server feature—not a client-side filter over whatever notes happen to be loaded in the browser. Its current endpoint manifest explicitly excludes Antennas.

Define and test the shared contract for:

- Persisted per-user antenna definitions with stable IDs.
- List/create/update/delete operations with validation and clear errors.
- A paginated antenna-notes endpoint returning normal Misskey-compatible Note objects.
- Matching semantics for the first supported source types and rule fields.
- Visibility and access filtering before returning results. Antenna matching must never expose a note the requesting user cannot otherwise see.
- Stable cursor ordering, duplicate-free paging, deletion/update correctness, and durable behavior across server restart.

Start with correctness and contract tests; do not copy Misskey’s internal fan-out architecture just to claim compatibility. Optimize matching only when measured workload warrants it. If a rule or field is not implemented, reject it explicitly rather than silently returning a broader or narrower feed than requested.

### Antennas acceptance criteria

On Misskey, Sharkey, and Pinetree, the user can create an antenna, restart or refresh, open its feed, page older results, edit it, and delete it. Test fixtures verify matching and exclusion behavior, account isolation, private/follower-only note visibility, stable paging, and persistence. UI behavior degrades clearly when a backend has not yet implemented the promised contract.

## 6. Priority 3 — Complete the ordinary posting and interaction loop

Once Drive attachment flow is working, round out the everyday composition and interaction features. This is still core-client work, not a mandate to replicate every Misskey subsystem.

### Composer

- Content warning (`cw`) creation and editing before submission.
- Correct visibility, including `specified` recipients (`visibleUserIds`) only where the target contract supports it.
- `localOnly` as a real note-create field when supported; do not show a fake toggle.
- Poll creation/voting with validation, expiry/options as supported, and results refreshed from the server.
- Mention autocomplete and clear account selection; do not require users to type a raw identifier for common replies.
- Use server metadata for the applicable text limit when reliably available; retain a safe fallback and validate server errors. Avoid a universal hard-coded 3,000-character assumption.
- Preserve text, settings, and completed uploads after recoverable posting errors.

MFM support should remain safe and progressive: render the allow-listed subset, escape unknown nodes safely, and add interactive constructs only with focused tests. Custom emoji display should be improved as a small, high-value content-rendering task rather than expanded into an elaborate editor immediately.

### Interactions and profiles

- Provide a reaction picker and display the server’s reaction counts/custom emoji metadata when present. Keep the initial picker simple; do not build a complex reaction browser before note reactions and unreact work reliably.
- Add repost undo and test quote/repost differences per backend.
- Make follow/pending-follow/unfollow state accurate. Add a basic followers/following view only after the common endpoint contract is verified.
- Add profile editing only for the verified common fields; do not imply support for profile features that a backend cannot save.

### Notifications

- Link notifications to the relevant note/profile and use real event labels/timestamps.
- Support “mark all read” only where the endpoint and permission are verified. Do not fabricate unread indicators for Misskey/Sharkey responses that do not provide `isRead`; keep backend-specific fields optional in shared types.

## 7. Priority 4 — Search, streaming, and polish

### Search

- Add basic user search and, where available, note and hashtag search.
- Misskey and Sharkey source trees include `notes/search` and `notes/search-by-tag`, but note search may be disabled by instance role policy. Model this as **supported by the API, possibly unavailable on this instance**; do not infer lack of support from an ordinary policy-denied response.
- Pinetree does not currently expose note search. Add it only when the endpoint contract, query semantics, visibility rules, and pagination are specified and tested.

### Streaming

Streaming is worthwhile for timelines, notification updates, and Antennas, but it should not block usable Drive or Antennas feeds. Pinetree explicitly has no streaming route yet; its Phase 3 scope includes client compatibility and streaming. Until a given backend has a verified streaming implementation:

- Keep cursor paging and manual refresh fully functional.
- Use conservative polling only where useful, with cancellation, backoff, and deduplication.
- Do not optimistically insert a streamed event twice when reconciling it with a pending API response.
- Implement reconnect/error states and tests for stale connections before presenting streaming as reliable.

Treat streaming as a shared infrastructure slice across Keystone and Pinetree, not as a reason to delay other complete workflows.

## 8. Intentionally out of scope for now

Do **not** treat the following as near-term commitments merely because Misskey has endpoints or screens for them:

- Full replication of the official Misskey web interface.
- Channels, Clips, Pages, Flash, Gallery, advanced account settings, server administration, direct messaging, and every notification subtype.
- A comprehensive user-list management suite beyond the subset required for list-backed Antennas.
- A full Drive administration suite (bulk moves, advanced search/sorting, every folder operation) before upload/list/select is sound.
- A fully featured custom-emoji/MFM authoring environment.
- Streaming-only UX that leaves the feeds unusable when a websocket is unavailable.

Revisit these after core user journeys have measurable completion and test coverage. Add a feature only when there is a concrete use case, an agreed API contract, and a clear acceptance test.

## 9. Backend capability contract

Maintain a concise, version-aware capability table in `docs/api-surface.md`. For each feature, record the backend’s status as `implemented and tested`, `implemented but policy-dependent`, `not implemented`, or `not yet verified`.

| Capability | Misskey | Sharkey | Pinetree target |
|---|---|---|---|
| Basic timelines, notes, replies, reactions, follows | Existing API smoke evidence; browser QA still needed | Existing API smoke evidence; browser QA still needed | Existing subset; run Keystone journey tests against current checkout |
| Drive upload + serve | Supported; multipart upload | Supported; multipart upload | Upload + file serving exist; list/picker contract still needed |
| Drive listing/folders | Verify the exact shared endpoints/fields against local versions | Verify the exact shared endpoints/fields against local versions | Not currently documented as implemented; add the chosen common subset |
| Antennas list/config/feed | Endpoints in source; verify local behavior and permissions | Endpoints in source; verify local behavior and permissions | Not implemented; add the chosen common subset |
| Note search | Endpoint exists; policy may disable it | Endpoint exists; policy may disable it | Not implemented |
| Streaming | Proxy configured; verify channels and client implementation separately | Proxy configured; verify channels and client implementation separately | No streaming route yet |

Do not let this table become a generic list of every upstream endpoint. It should contain features Keystone actually intends to use. Any divergence in parameter names, required permissions, response shape, pagination, or unsupported fields belongs in a contract test and this table.

## 10. Recommended implementation order

Keep each row as a separately reviewable slice with its own commit, tests, and state-log entry.

1. **Reliability/security pass:** check in smoke tests, correct the native-token description, handle auth edge cases, fix high-impact interaction/rendering state, and run the first browser QA pass.
2. **Drive contract + composer attachments:** extend the permission flow correctly, implement multipart upload, attach `fileIds`, and verify reload/serving on Misskey and Sharkey. In the same workstream, reuse and contract-test Pinetree’s existing upload/serve/attach path, then implement its compatible listing/picker contract.
3. **Drive browser/picker:** list and reuse existing files; add minimal folder navigation only after list/select works across targets.
4. **Antennas contract + UI:** implement list/create/edit/delete/feed and the bounded common filter set on Misskey/Sharkey; then implement the matching Pinetree subset and server-side visibility filtering. Add list-backed sources only with the required user-list subset.
5. **Finish core composition/interactions:** CW, recipients, local-only where supported, polls, reaction picker, repost undo, accurate follow requests, and notification deep links.
6. **Discovery and streaming:** policy-aware search, reliable polling fallback, then shared live updates with Pinetree’s streaming implementation.
7. **Reassess optional features** from actual use rather than upstream feature counts.

If a task grows beyond one coherent slice, split it. Do not mix a Drive rewrite, Antennas, streaming, and a design overhaul in one mega-PR.

## 11. Definition of done for every slice

A slice is done only when all applicable statements are true:

- The user journey works from the visible Keystone UI, not only by direct API calls.
- The request matches the verified target contract and asks only for required permissions.
- Loading, empty, error, retry, permission-denied, and unsupported-capability states are deliberate.
- After refresh/reload, the UI shows the server’s actual persisted state.
- Pagination is stable and deduplicated; sensitive/visibility rules are respected.
- Tests are checked in and reproducible. API success alone is not treated as proof of browser behavior.
- The feature’s backend support status is updated in `docs/api-surface.md`.
- `state/STATE.md` and a dated append-only work log are updated according to `AGENTS.md`.

The guiding principle is simple: **build a small set of dependable, shared workflows—especially Drive and Antennas—rather than a broad but shallow imitation of Misskey.**
