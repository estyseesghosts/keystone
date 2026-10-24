# Repair plan — audit 2026-10-24

Agent-ready slices for the bugs and decompositions in
`docs/audit_20261024/report.md` and `docs/audit_20261024/results/01`–`10`.
Source of truth for *what is wrong* is those files. This document is the
source of truth for *what to do next, in what order, and what “done” is*.

Do not re-litigate items listed under **Verified sound** at the bottom.
Do not reopen the closed V2 E6/E7 program or Wave 3.3+ product work from
`state/STATE.md` inside these slices. This program is repair + decomposition
only.

## How to run a slice

1. Read `AGENTS.md`, then this file’s slice, then the cited result sections.
   Do not re-read the whole audit.
2. One slice per session. Branch `repair-<id>-<topic>` from current `main`.
   Do not merge until the slice acceptance box is green and the owner says so.
3. Touch only the files the slice lists. Anything else is a deviation: stop
   if major, otherwise do it and record why in the session log.
4. Never claim a live-server or device check you did not run. Rig Misskey
   `:3101` / Sharkey `:3102` are refused; write `not verified (owner
   live-tests externally)` for those. Device checks the same.
5. End of session: `state/logs/YYYY-MM-DD-repair-<id>.md` (template in
   `AGENTS.md` §2), update the status line on this slice, paste
   `pnpm typecheck && pnpm lint && pnpm test` output. Load-bearing
   reversals (model nullability, SDK pin, cache key shape) get an ADR
   under `docs/adr/` plus a one-line `docs/DECISIONS.md` entry *before*
   the code lands.
6. Patterns, not Bluesky source (`docs/adr/0001-patterns-not-code.md`).
   UI sees only `packages/fedi` domain models. `packages/fedi` stays pure
   TS. Every query key stays `sessionId`-first. No fake data. No inert
   controls.

## Sequencing

Waves are ordered. Slices inside a wave are file-disjoint and may run in
parallel. A later wave must not start on a file a prior wave still owns.

| Wave | Intent | Slices | Parallel? |
|---|---|---|---|
| 0 | P0 + rules-of-hooks + double-submit / double-keyboard. Land before any split of those files. | R0.1–R0.3 | yes |
| 1 | Adapter and cache correctness. Must finish before backend splits. | R1.1–R1.4 | yes |
| 2 | Remaining user-visible P1 (content, exclusive features, media, surface honesty). | R2.1–R2.4 | yes, except R2.1 waits on R1.2 if both touch `ast.ts` (they do not) |
| 3 | Decomposition. Behavior-preserving. Start only after the wave that owns the file is merged. | D3.1–D3.8 | mostly; see conflicts |
| 4 | Perf + coverage on the post-split tree. | P4.1–P4.2 | P4.1 after D3.5/D3.6; P4.2 after D3.4 |

Conflict table (do not schedule together):

- `packages/fedi/src/misskey/backend.ts`: R1.1 then D3.1. Nothing else.
- `packages/fedi/src/mastodon/{backend,endpoints,adapt,stream,oauth,admin}.ts`: R1.3 then D3.3.
- `packages/fedi/src/core/{backend,models}.ts`: R1.3 owns the `Notification.createdAt` widening; D3.2 starts after R1.3.
- `src/components/RichText.tsx`: R0.2 then D3.5. R2.1 does not edit RichText.
- `src/components/Post/PostCard.tsx`: R2.4 then D3.6 then P4.1.
- `src/components/Composer/*` + `src/screens/Compose.tsx`: R0.3 then (optional) D3.7 does not split Composer.
- `src/Navigation.tsx`: D3.4 only.
- `src/components/Settings/MutesSection.tsx`: R0.1 then D3.7.

---

## Wave 0 — stop the bleeding

### R0.1 — Word-mute fields must not cross accounts

Status: done (2026-10-24, Wave 0 commit; log `state/logs/2026-10-24-repair-r0.1.md`)
Branch: `repair-r0.1-wordfield-reseed`
Audit: `results/07` bug 1 (report P0)

**Goal.** Saving muted-words / hard-muted-words / muted-instances after an
account switch must write the *current* account’s text, never the previous
account’s seeded text.

**Read first.**

- `src/components/Settings/MutesSection.tsx` (the `WordField` seed refs ~75–83 and the three call sites ~642–668)
- `src/components/Settings/MutesSection.test.tsx` if present; otherwise the nearest settings section test for the harness pattern

**In scope.** `MutesSection.tsx` and its test only.

**Steps.**

1. Make `WordField` reseed when the account identity changes. Preferred fix:
   `key={session.id}` (or `me.id`) on each of the three `WordField`s so the
   `seeded` ref cannot survive a switch. Alternative (only if keying breaks
   focus tests): reset `seeded` and `edited` when `me?.id` changes.
2. Do not “fix” this by copying text across accounts. The bug is the seed
   surviving; the server write is already the active session’s backend.
3. Add a regression test: mount with account A’s `me`, switch the session /
   `me` prop to account B with different mute text, assert the textarea
   value is B’s, then invoke save and assert the payload is B’s strings.

**Deliverables.**

- [ ] Reseed cannot survive an account switch
- [ ] Regression test named so a future reader sees “account switch”
- [ ] No other settings behavior changed

**Acceptance.**

- [ ] `pnpm typecheck && pnpm lint && pnpm test` green; paste in the log
- [ ] Test fails if the key/reset is removed (spot-check by reading the assertion, not by leaving the tree broken)

**Out of scope.** Splitting `MutesSection` (D3.7). Domain-block vs mute copy. i18n.

---

### R0.2 — RichText rules-of-hooks

Status: done (2026-10-24, Wave 0 commit; log `state/logs/2026-10-24-repair-r0.2.md`)
Branch: `repair-r0.2-richtext-hooks`
Audit: `results/09` hook finding 1 (report P1)

**Goal.** `RichText` calls the same hooks in the same order on every render,
including when `contentMode` flips between `plain` and rich.

**Read first.** `src/components/RichText.tsx` around the `contentMode === 'plain'` early return (~1031) and the `hasBlock` `useMemo` (~1045). `useTheme`, `useContentMode`, and the `ctx` memo above the return are already correct — do not move them.

**In scope.** `src/components/RichText.tsx` and an existing RichText test if one can host a two-render assertion. Do not extract modules (that is D3.5).

**Steps.**

1. Hoist `hasBlock` above the `contentMode` early return. Compute it unconditionally. The plain branch may ignore the value.
2. Do not add a new early return above any hook.
3. If a test harness can render `RichText` twice with different `contentMode` without throwing, add that test. If the component cannot be rendered in the existing Jest setup without a large new harness, say `not verified` for the visual and rely on typecheck + a comment-free code fix. Do not build a new renderer harness in this slice.

**Deliverables.**

- [ ] No hook call after a conditional return in `RichText`
- [ ] Plain-mode output unchanged (same nodes as before the hoist)

**Acceptance.** `pnpm typecheck && pnpm lint && pnpm test` green.

**Out of scope.** Matrix hover extraction, mention routing, style helpers, memoization, dotted-handle scanners.

---

### R0.3 — Composer double-submit and nested keyboard avoidance

Status: done (2026-10-24, Wave 0 commit; log `state/logs/2026-10-24-repair-r0.3.md`)
Branch: `repair-r0.3-composer-races`
Audit: `results/09` state finding 2; `results/10` D1

**Goal.** One submit cannot run twice before `busy` commits. The compose sheet offsets for the keyboard exactly once on iOS and Android.

**Read first.**

- `src/components/Composer/Composer.tsx` `submit` (~352–482) and the button `disabled` (~569)
- `src/components/Composer/CompactComposer.tsx` KAV (~177–181) and its submit button (~347)
- `src/screens/Compose.tsx` sheet KAV (~116–129) and `sheetKeyboardInset` (~79–82)
- `src/screens/Home.tsx` (~72) — standalone `CompactComposer`, must stay single-KAV

**In scope.** Those three files plus composer tests that already cover submit.

**Steps.**

1. At the top of `submit`, return immediately if a ref-mirrored busy flag is set. Set the ref *before* any `await`, clear it in `finally`. Do not trust React state alone — the bug is the gap before `setBusy(true)` commits. Both chromes must share this guard (they share `useComposerController`; put the guard there, not in each button).
2. Remove exactly one `KeyboardAvoidingView` layer on the compose-sheet path. The sheet in `Compose.tsx` owns `sheetVisibleMaxHeight` / `sheetKeyboardInset`, so it is the natural owner — remove the KAV inside `CompactComposer` **only when it is already wrapped**, or remove the sheet-level KAV and keep the composer’s. Pick one and document the choice in the log. `Home.tsx`’s standalone composer must still avoid the keyboard.
3. Search for other screens that wrap a component which already owns a KAV. Fix siblings in this slice only if the same double-offset shape is obvious; otherwise list them under Next and stop.
4. Delete the dead `POLL_DURATIONS` copy in `Composer.tsx` (~70–75). The live copy is `ComposerSections.tsx` (~44–49). Do not edit durations.

**Deliverables.**

- [ ] `submit` is single-flight even if called twice synchronously
- [ ] Compose sheet has one keyboard-offset owner; Home composer still has one
- [ ] Dead `POLL_DURATIONS` in `Composer.tsx` gone
- [ ] Device keyboard check: `not verified` unless you actually ran iOS/Android

**Acceptance.** `pnpm typecheck && pnpm lint && pnpm test` green. Add or extend a unit test that calls `submit` twice without an intervening state flush and asserts a single `create` / mutate. If the controller is not unit-testable without a huge harness, extract only the busy-ref guard into a 5-line helper and test that — do not rewrite the controller.

**Out of scope.** Composer file split, poll vote atomicity (R2.2), media size caps (R2.3).

---

## Wave 1 — data-layer correctness

### R1.1 — Misskey wire bugs in `backend.ts` and its direct helpers

Status: not started
Branch: `repair-r1.1-misskey-wire`
Audit: `results/01` B1, B2, B5, B7, B8, B10, B11, B14

**Goal.** The main Misskey relationship call uses the upstream field name; missing user packs do not throw; bookmarks honor the caller’s limit; empty account refs and empty chat text fail locally with `FediError`; antenna bodies omit nulls; server-info does not invent `0`.

**Read first.** `results/01` suspected-bugs B1–B14 (skip B3, B4, B6, B9, B12, B13 — other slices or Wave 3). Then the cited lines only.

**In scope.**

- `packages/fedi/src/misskey/backend.ts`
- `packages/fedi/src/misskey/favorites.ts` (thread `limit`)
- `packages/fedi/src/misskey/renoteMutes.ts`
- `packages/fedi/src/misskey/admin.ts` (`fetchServerInfo` only)
- `packages/fedi/src/misskey/chat.ts` (empty-text guards only)
- Matching tests under `packages/fedi/test/misskey-*.test.ts`. Add a param-shape test; do not create a new suite file unless none of the existing ones can host it.

**Steps.**

1. **B1.** `backend.ts` `relationships` body: `userIds` → `userId` (singular array), matching `mutes.ts` and upstream `users/relation`. Add a test that the call params contain `userId` and do not contain `userIds`.
2. **B2 / B14.** Before `adaptAccount`, skip rows whose user/mutee id is not a string. Same guard shape as `chat.ts` (`typeof id === "string"`). Do not adapt the muting row as a fallback.
3. **B7.** Pass the caller’s `limit` into `listFavorites`. `pageOf` must compare against the limit that was actually requested. Test: `limit: 50` does not set `end` solely because the helper fetched 20; `limit: 5` does not adapt 20 rows.
4. **B8.** If an account ref has neither `id` nor `username`, throw `FediError` before I/O. Do not POST `{}`.
5. **B5.** `antennaBody` must omit null and empty fields the way neighboring call sites do (`...(x != null ? {x} : {})`). Do not send `userListId: null`. Keep the existing allow-list (do not start forwarding `ext`).
6. **B10.** Empty chat text throws `FediError` with a stable code, not `Error`.
7. **B11.** `fetchServerInfo` uses null (or omits) for missing machine/os/cpu/mem/fs, matching `fetchQueueStats`. `0` is a measurement, not a fallback.
8. Do not fix B4 (`updateProfile` ext allow-list) here unless it falls out of a helper you already touched. If you touch it, allow-list known `i/update` fields and drop unknown keys; update the test at `misskey-backend.test.ts` that currently pins verbatim forward. Record the rule in the log.

**Deliverables.**

- [ ] Param-shape test for `relationships`
- [ ] Tests for bookmark limit, missing-user skip, empty account ref, antenna omit-null, server-info nulls
- [ ] No drive/antenna/note-body file split (D3.1)

**Acceptance.** `pnpm typecheck && pnpm lint && pnpm test` green. Live Sharkey check: `not verified (owner live-tests externally)`.

**Out of scope.** Module-global caches (R1.2). Stream token param (D3.1 or a note in the log, not a behavior change unless you are already in `stream.ts` — you are not). `explore.users` `Promise.all` (batch into R1.4 only if you are not; leave it — R1.4 does not own `backend.ts`. File it as a one-line follow-up in the log under Next, owned by a later touch of that function).

---

### R1.2 — Per-session translate and quote caches

Status: not started
Branch: `repair-r1.2-session-caches`
Audit: `results/01` B3

**Goal.** Account B cannot read account A’s translation, failure suppression, or a followers-only quote `Post` resolved with A’s credentials.

**Read first.**

- `packages/fedi/src/misskey/translate.ts` maps at ~201–208 and ~407–408; `requestTranslation` / `retryTranslation`
- `packages/fedi/src/misskey/quote.ts` `seenByUri` / `seenById` / `completedLookups` / `inflightLookups`; `resolveQuoteUri`
- `packages/fedi/src/misskey/remotepost.ts` (public URL cache — lower severity; still stop sharing if the fix is the same shape)
- How a translator / quote resolver is constructed (search `createTranslator` / `resolveQuoteUri` call sites). Do not invent a new session type.

**In scope.** Those three modules, their tests, and the factory call sites that must pass a cache or that already hold per-session state. If the only way to key a cache is to thread an object from `createMisskeyBackend`, that edit to `backend.ts` is allowed **only** as a constructor argument — do not mix with R1.1. Schedule this slice after R1.1 merges, or restrict the `backend.ts` edit to the factory wiring lines and rebase carefully. Prefer holding the maps inside the translator instance and a per-backend quote cache object so `backend.ts` changes stay a few lines.

**Steps.**

1. Move `completed`, `inflight`, `failedAt`, `outcomes`, `retries` onto the translator instance (or key them by origin + account id held by that instance). Two instances must not share entries.
2. Move quote seen/lookup maps onto a per-session (or per-backend) object. `resolveQuoteUri` must not return a cached `Post` resolved under a different credential. Failed lookups get a TTL and may retry; do not cache failure-null forever.
3. `remotepost` public URL cache: key by origin or document that it is public-only and add a short TTL. Do not treat it as the visibility bug.
4. `softMute.ts` `regexCache`: cap or key per session if you are already in the file; otherwise leave it and note it. Unbounded regex cache is not this slice’s goal.
5. Tests: two translator instances, same note id, different results — B must not observe A’s hit or A’s failure suppression. Two quote resolvers, same URI — B must not receive A’s resolved `Post`. A failed lookup must be retryable after TTL (fake timers).

**Deliverables.**

- [ ] No module-global translation or quote `Post` cache
- [ ] Tests named for cross-account isolation
- [ ] Log states the key shape (instance-owned vs `${origin}\0${accountId}`)

**Acceptance.** `pnpm typecheck && pnpm lint && pnpm test` green.

**Out of scope.** Dedupe of `decideTranslation` (D3.8). Mastodon quote caches (already origin+token keyed — verified sound, do not rewrite).

---

### R1.3 — Mastodon honesty: quotes, dates, predicates, OAuth fallback, admin PATCH, stream gap

Status: not started
Branch: `repair-r1.3-mastodon-honesty`
Audit: `results/02` bugs 1–8; report P1 fabricated timestamps

**Goal.** One quote matcher. Notification dates are never invented. Absence checks accept both error classes. Scope fallback does not retry forbidden registration. Empty admin report PATCH does not hit the server. Conversation stream events are either routed or explicitly documented as poll-only — pick routing if it is a small listener add, otherwise document and stop.

**Read first.** `results/02` suspected bugs 1–8 and the “Verified OK” list. `packages/fedi/src/core/models.ts` `Notification.createdAt` and `Account.createdAt` (the nullability precedent).

**In scope.**

- `packages/fedi/src/mastodon/endpoints.ts` (delete dead quote copy ~598–646; absence helper ~179–187; `accountLookupFailure` ~262; shape-swallow at `fetchStatusHistory` / `fetchCustomEmojis`)
- `packages/fedi/src/mastodon/backend.ts` (quote resolution ~1635–1687 must become the only copy, using `urisMatch` from `quoteMarker.ts`; absence predicate ~204)
- `packages/fedi/src/mastodon/quoteMarker.ts` (reuse, do not fork a third matcher)
- `packages/fedi/src/mastodon/adapt.ts` (notification dates; the four `as any` casts only if you are already editing those functions)
- `packages/fedi/src/mastodon/tags.ts` (point absence check at the shared helper)
- `packages/fedi/src/mastodon/oauth.ts` (scope fallback ~392–404)
- `packages/fedi/src/mastodon/admin.ts` (empty PATCH ~455–473)
- `packages/fedi/src/mastodon/stream.ts` + `conversations.ts` (conversation event)
- `packages/fedi/src/core/models.ts` **only** `Notification.createdAt` and any type that is forced by that change
- UI call sites that assume `createdAt` is a non-null string — fix them to render dateless / sort last. Search `notification.createdAt` and `.createdAt` on notification rows. Do not restyle screens.

**Steps.**

1. Delete `resolveTextualQuote`, `searchQuotedStatus`, `quoteLookups`, and `QUOTE_MISS_TTL_MS` from `endpoints.ts` if they have zero callers after you rewire. Make `backend.ts` quote picking use `urisMatch` (`quoteMarker.ts`). One TTL constant, next to the surviving cache.
2. **ADR before code.** Widen `Notification.createdAt` to `string | null`, matching `Account.createdAt`. Remove `new Date().toISOString()` fallbacks in `adaptV2Notification` and `adaptV2Group`. Sort null dates last. Render them as dateless, not “now”. Update fixtures.
3. Export one `isAbsent` (name it after the existing endpoints helper) that accepts `MastoHttpError | ApiError`. Point `tags.ts` and `backend.ts` at it. Delete `accountLookupFailure` or make it accept both classes and add a caller — prefer delete if still unused after the unify.
4. `registerApp` fallback: retry `FALLBACK_SCOPES` only on scope-shaped rejection (422 or body indicating invalid scope). 401/403 must surface immediately.
5. `updateAdminReport`: if the body would be `{}`, throw a local `FediError` (or no-op with a typed reason). Do not PATCH `{}`.
6. `fetchStatusHistory` / `fetchCustomEmojis`: non-array 200 throws `FediError(errors.shape.*)`, consistent with other listings. Do not return `[]`.
7. Conversation stream: add a `conversation` branch in `routeMessage` that notifies a listener set the DM inbox can subscribe to, **or** if that requires a new app subscription (out of this slice’s files), write the poll-only contract into the `conversations.ts` header and stop. Do not half-route events into a void.
8. While editing `adapt.ts` grouped-notification casts: replace `as any` with a narrowing guard. If that expands the diff past the date fix, leave the casts and note them for D3.3.

**Deliverables.**

- [ ] ADR for nullable `Notification.createdAt`
- [ ] Dead quote copy gone; one matcher (`urisMatch`)
- [ ] Tests: omitted `created_at` → null, not a fresh timestamp; 403 registration does not fall back; empty report PATCH does not call the client; non-array history throws
- [ ] `conversation` either routed or documented poll-only in the module header

**Acceptance.** `pnpm typecheck && pnpm lint && pnpm test` green.

**Out of scope.** Splitting `backend.ts` / `endpoints.ts`. Quote-cache sharing with Misskey. `voteInPoll` GET-then-POST (R2.2). Streaming-origin host trust (document-only; one line in the existing contract comment if you are in `stream.ts`, no behavior change).

---

### R1.4 — Session plumbing: DOMException, revoke, family guard, shadow, delete

Status: not started
Branch: `repair-r1.4-session-plumbing`
Audit: `results/04` bugs 1–4 and the DOMException note

**Goal.** A missing `DOMException` global cannot crash the timeout catch path. Mastodon external sign-out either revokes or records an explicit skip. `uploadDriveFile` refuses non-Misskey sessions the same way `apiCall` does. Optimistic favourite renders when `favourite` is null. Deleting a post removes or tombstones it in single-post queries, not only in infinite lists.

**Read first.**

- `packages/fedi/src/core/http.ts` ~257
- `packages/fedi/src/misskey/external.ts` ~171 and `revokeExternalToken` ~321–342
- `packages/fedi/src/core/sessions.ts` `revokeSessionToken` ~592
- `packages/fedi/src/api/client.ts` `apiCall` ~276–292 and `uploadDriveFile` ~321–332
- `src/state/cache/post-shadow.ts` ~178–184
- `src/state/cache/patch.ts` ~73–77
- `src/state/cache/postActions.ts` delete-settle ~276 and favourite toggle ~240

**In scope.** Those files and their tests. `external.ts` mid-file import move is allowed (quality, same file) — move imports to the top, do not rename keys unless the log records it.

**Steps.**

1. Replace `err instanceof DOMException` with a check that cannot throw if the global is missing: `typeof DOMException !== "undefined" && err instanceof DOMException`, or `err?.name === "AbortError"`. Apply at both sites. Add a regression that evaluates the catch with `DOMException` deleted from the global (or a stub realm). The test must fail if the `instanceof` is bare.
2. Mastodon external revoke: thread the `KeyValueStore` into `revokeExternalToken` so `cachedAppFor` can find `client_id`, **or** if the store is genuinely unavailable on that path, do not return silently — surface a documented skip (return value or `FediError` the caller already handles). Silent `return` is the bug. Test the store-present path actually POSTs revocation; test the skip path is observable.
3. `uploadDriveFile`: if the active session is not Misskey-family, throw the same `UNSUPPORTED_FAMILY` `apiCall` throws. Do not POST. Test both families.
4. Favourite shadow: if the shadow says favourited and `post.favourite` is null, synthesize a `FavouriteState` (mirror `withFavourite` count logic) so the optimistic tap renders. Do not invent a count you were not given — if you cannot synthesize honestly, gate the control off when `favourite` is null and say so in the log. Prefer synthesize-from-shadow.
5. Delete settle: when the patch function returns null, single-post queries must not keep the old `data`. Invalidate or write a tombstone that `usePostShadow` / the detail screen already understands. Infinite lists already drop the row — do not regress that. Test both shapes.

**Deliverables.**

- [ ] DOMException regression
- [ ] Revoke test (POST or explicit skip — not both silent)
- [ ] Family-guard test for `uploadDriveFile`
- [ ] Shadow + single-post delete tests

**Acceptance.** `pnpm typecheck && pnpm lint && pnpm test` green.

**Out of scope.** Legacy migration multi-token warning (`sessions.ts` ~401). `saveExternalSession` one-per-host (documented legacy; do not “fix” multi-account on that path here). `createLiveRegistry` deletion (D3.8). `File` global port gap (note only, no interface change).

---

## Wave 2 — remaining user-visible P1

### R2.1 — Content scanners and bare-link unfurl

Status: not started
Branch: `repair-r2.1-content-scanners`
Audit: `results/03` B1, B2, B3, B4

**Goal.** Dotted bridged handles survive translated-text, field, and `plainFromMfm` scans. Mastodon server-shortened links (text + invisible children) count as bare links for unfurl. Non-ASCII `data-tag` is accepted on the fast path.

**Read first.** `results/03` B1–B4 and the verified-sound Matrix section. Do not change Matrix merge.

**In scope.**

- `packages/fedi/src/core/content/ast.ts` (`TRANSLATED_TOKEN_PATTERN`, `hashtagTagOf`)
- `packages/fedi/src/core/content/fields.ts` (`FIELD_TOKEN_PATTERN`)
- `packages/fedi/src/core/models.ts` `plainFromMfm` only (~48–82)
- `src/components/Post/LinkCard.tsx` `firstBareUrl` (~106–138)
- Tests: `packages/fedi/test/content-*.test.ts`, `content-html` if a shortened-link fixture already exists, plus a LinkCard test if the harness can render or if `firstBareUrl` is exported. If `firstBareUrl` is not exported, export it for the test or test via the public unfurl decision — do not duplicate the predicate in the test.

**Steps.**

1. Widen the username class in both token patterns from `[\w-]+` to `[\w-]+(?:\.[\w-]+)*`, keeping the `@host` tail. Mirror `parseAcct`. Do the same in `plainFromMfm` mention and hashtag strips (hashtag class must accept what `hashtagLabelOf` accepts, including non-ASCII).
2. `hashtagTagOf` `data-tag` fast path: `/^[^\s/#?]{1,64}$/` (or the same class the href-tail validator uses). Do not loosen to raw HTML.
3. `firstBareUrl`: bare iff `bareLinkLabel(node) !== null`. Delete the stricter `children.length === 1 && children[0].text === node.href` predicate.
4. Tests (required): `@foxtails.me@bsky.brid.gy` through translated scanner, field scanner, and `plainFromMfm`; unicode `data-tag`; shortened link (text + invisible) is bare. Differential: `plainFromMfm(x)` vs `textOf(contentFromMfm(x))` on that corpus — they must agree on the handle and the tag.
5. Do not extract `fromTranslated.ts` or a shared scanner here (D3.5 / D3.8). Fix both patterns in place so the next extraction cannot preserve the bug.

**Deliverables.**

- [ ] Four tests above, in existing suites
- [ ] No Matrix merge change
- [ ] No new parser module

**Acceptance.** `pnpm typecheck && pnpm lint && pnpm test` green. XSS suite (`content-html`) still green — do not weaken `safeUrl`.

**Out of scope.** RichText split. Translation-policy dedupe. Emoji `alt` fallback.

---

### R2.2 — Exclusive-feature honesty

Status: not started
Branch: `repair-r2.2-exclusive-honesty`
Audit: `results/06` bugs 1, 2, 3, 5, 6, 9; `results/05` B9 (same PostPoll bug)

**Goal.** File-only chat messages show the file. Multi-choice Misskey votes do not silently half-apply. Poll UI resyncs when props change. Clip privacy is editable after create. Conversation history says when it is incomplete. Drive delete cannot double-fire.

**Read first.** `results/06` bugs 1–6 and 9. `packages/fedi/src/misskey/chat.ts` file fields. `packages/fedi/src/misskey/clips.ts` `updateClip`. `packages/fedi/src/misskey/backend.ts` `votePoll` — **this is a small, isolated function**. If R1.1 has not merged, do not take this slice (same file). If it has merged, touch only `votePoll` plus tests.

**In scope.**

- `src/screens/ChatThread.tsx` (render attachment; do not add send-attachment UI)
- `packages/fedi/src/misskey/backend.ts` `votePoll` only, after R1.1
- `src/components/Post/PostPoll.tsx`
- `src/screens/Clips.tsx` (privacy toggle on the existing editor)
- `src/screens/Conversation.tsx` (`incomplete` caption; mark-read `console.warn` on failure is allowed)
- `src/screens/Drive.tsx` delete-confirm busy guard only (~403–408). Do not split the file.

**Steps.**

1. `ChatMessageRow`: if `file` / `fileId` is present, render name + open/download via the existing URL field. A text-null message must not be an empty author line. No upload button.
2. `votePoll`: on multi-choice, stop at the first failure. Return enough information for the UI to say how many choices were recorded and that retry sends only the rest — or catch duplicate-choice errors and continue. Do not claim atomicity the endpoint does not have. Single-choice path stays one POST. Copy must be honest. Live server duplicate behavior: `not verified` unless tested.
3. `PostPoll`: resync `selected` / `voted` when `poll.options` voted flags or a poll version change. Do not leave the `useState` initializer as the only source. A `key` on the parent is acceptable if you control the parent and it remounts cleanly; an effect is fine. One approach, tested.
4. Clip editor: send `isPublic` through `updateClip`. Create-only is the bug. Do not invent a new screen.
5. `Conversation`: if `thread().incomplete`, show a caption that some messages may be missing. Do not invent messages. Mark-read failure: `console.warn` at minimum; do not block the thread.
6. Drive delete confirm: disable while the delete promise is in flight.

**Deliverables.**

- [ ] Chat row test or screenshot note: file-only message is not blank (`not verified` visually if no harness — then a pure render test)
- [ ] Poll resync test
- [ ] Clip update payload includes `isPublic`
- [ ] Incomplete conversation caption test (the fixture already exists per `Conversation.test.tsx`)

**Acceptance.** `pnpm typecheck && pnpm lint && pnpm test` green.

**Out of scope.** Antenna notify / list-source UI (record a `docs/DECISIONS.md` line: deferred, website for now — do not build it). Mastodon `voteInPoll` poll-id-on-model (model change; ADR + separate slice if you start it — default is leave it and note the GET-then-POST in the log). Chat live-status indicator. Drive file split (D3.7).

---

### R2.3 — Media bounds, visible video, SDK pin decision

Status: not started
Branch: `repair-r2.3-media-native`
Audit: `results/10` F1, M1, M2, M3, M4, D2, D7, H3

**Goal.** Picker and import cannot silently OOM or skip a denied permission. Off-screen video does not all play. SDK override vs SDK 57 is an explicit decision, not an accident. Dead `MediaGrid` cannot be mistaken for the live grid.

**Read first.** `results/10` top 5 and M1–M5. `docs/DECISIONS.md` around the reanimated/worklets/screens override (~170) and gesture-handler notes. `src/lib/documentPicker.ts` header. `src/components/Composer/pickMedia.ts`, `src/components/Profile/pickProfileImage.ts`.

**In scope.**

- `src/components/Composer/pickMedia.ts`
- `src/lib/documentPicker.ts`
- `src/components/Settings/TransferSections.tsx` only where it calls the picker (guard before upload)
- `src/state/queries/composer.ts` only to refuse an over-cap `File` before upload starts
- `src/components/Post/PostMediaGrid.tsx` (viewability gate for gifv autoplay)
- `src/components/Lightbox.tsx` (play only the focused page)
- `src/components/MediaGrid.tsx` (mark legacy or delete if truly unimported — confirm importers first)
- `src/components/RichText.tsx` **one line**: Matrix chip `copy()` on web too (`~710`). If R0.2 / D3.5 owns the file, land this inside whichever of those is in progress, or wait. Do not take a conflicting branch.
- `package.json` / `pnpm-workspace.yaml` **only after an ADR**

**Steps.**

1. **ADR first for F1.** Options: (a) drop the pnpm overrides and pin the `expo install --check` SDK 57 versions, because `src/` has zero reanimated/worklets imports; (b) keep the Bluesky-mirror overrides and record them as intentional, with the crash-suspect note. Default recommendation: (a), then `pnpm android` / `ios` bundle if a device is available, else `not verified` for native bundle. Do not flip the pin and also refactor media in a way that hides a red native build — if you choose (a), that commit is the whole slice’s native-deps change; media fixes can share the branch but must be separable commits.
2. `pickMedia`: request permission the way `pickProfileImage` does, and return a typed `denied | cancelled | picked`. Composer must show denied, not a silent cancel.
3. Implement the size guard `documentPicker.ts` already claims (10 MB, or the constant the comment names — if the comment is wrong, fix the comment to the constant you implement). Same guard before composer `uploads.add`. Over-cap is an honest error, not a throw from Hermes. Reconsider `quality: 1` — for non-original attachments, set a documented quality/resize. Do not silently recompress video if you cannot do it safely; a size refusal is enough.
4. Lightbox: play/pause from the pager index. Feed gifv: do not `play()` every mounted tile; gate on viewability. If viewability wiring is larger than the slice, pause all but the first visible tile and say so — do not leave N audio tracks as the shipped behavior in Lightbox.
5. `MediaGrid.tsx`: if the only importers are the barrel and tests, stop exporting it from the barrel and add a file-header `legacy — live grid is PostMediaGrid`. Delete only if tests can move to `PostMediaGrid` without a behavior argument. Do not let both stay as equal public APIs.
6. Web Matrix chip: call the existing `copy()` helper. One-line parity fix.
7. iOS MiAuth inline completion: thread `openAuthSessionAsync`’s return URL through `startMisskeyMiAuth` and complete like `finishOAuthCallbackUrl`. If that touches `Login.tsx` while another slice has it, defer H3 to the log and do not collide. Polling must keep working as fallback.

**Deliverables.**

- [ ] ADR for the SDK pin choice
- [ ] Permission-denied path tested or explicitly `not verified` on device with a unit test of the typed outcome
- [ ] Size-guard test (over-cap does not call upload)
- [ ] Lightbox does not start every frame’s audio on open (code-level assertion or `not verified` device note plus the index-driven play/pause in code)
- [ ] `MediaGrid` marked legacy or removed from the public barrel

**Acceptance.** `pnpm typecheck && pnpm lint && pnpm test` green. Native bundle: paste output or `not verified`.

**Out of scope.** `expo-image` swap on the feed grid (measure later; note in log). Watchman onboarding doc. `StatusBar` web guard. Scene-lifecycle plugin rewrite. Deleting `react-responsive` is in scope if it is a one-line `package.json` removal with zero imports — do it in the SDK commit.

---

### R2.4 — Surface honesty (feeds, profile, explore, note)

Status: not started
Branch: `repair-r2.4-surface-honesty`
Audit: `results/05` B1–B5, B7, B8; `results/05` Q5; `results/09` Note keyExtractor / empty parent id

**Goal.** Deck columns resolve emoji with the column’s session. 429 is not “deleted”. Profile tabs reset per profile. News load-more does not duplicate or swallow errors. Tag descriptors cannot inject `|`. Background images are http(s) only. Recommendations use the session backend’s capabilities. Note list keys include `sessionId`.

**Read first.** `results/05` B1–B8 and Q5. `User.tsx` 429 branch (~140) as the pattern to copy. `Explore.tsx` `safeDescriptorArg` (~59).

**In scope.**

- `src/components/Post/PostCard.tsx` — thread `sessionId` and `authorHost` into `ReactionChips` and `PostQuote` only. No hook extraction.
- `src/screens/Note.tsx` — 429 copy; `keyExtractor` prefix; confirm `useThreadRepliesQuery` is disabled when id is `''` (it is, per audit — add a test or a one-line assertion comment only if the disable is not already obvious in the hook)
- `src/screens/User.tsx` — reset tab on `targetId`
- `src/screens/Explore.tsx` — NewsTab load-more; export or share `safeDescriptorArg`
- `src/screens/Tag.tsx` — use that sanitizer
- `src/components/Profile/ProfileHeader.tsx` and/or `packages/fedi/src/misskey/adapt.ts` `backgroundUrlOf` — `safeHttpUrl` at the adapter so every consumer is covered. Also gate `UserHoverCard` avatar if it skips the helper.
- `src/components/Recommendations/RecommendationsFeed.tsx` — `useBackendForSessionId` when the prop is absent, matching `FeedView`
- `src/screens/HomeFeed.tsx` only if the 429 feed-error path is a two-line copy of Note’s fix

**Steps.**

1. PostCard: pass `sessionId={sessionId}` and `authorHost={effective.author.host}` into both call sites the audit names (~1132, ~1182). Confirm `PostQuote` forwards `sid` to nested RichText (audit says it does — do not re-plumb if true).
2. NoteScreen: branch `ApiError` status 429 the way `User.tsx` does. Other errors keep the existing deleted/private copy.
3. `useEffect(() => setTab('posts'), [targetId])` on User. Do not preserve a tab that the new profile hides.
4. NewsTab: dedupe inside the functional `setLinks` updater; keep an in-flight ref so two `onEndReached` calls cannot share a stale `seen` set. If `links.length > 0` and load-more fails, show a footer retry. Do not clear the list.
5. Move `safeDescriptorArg` to a module both `Explore.tsx` and `Tag.tsx` can import (`src/screens/explore/safeDescriptor.ts` or next to feed descriptors — prefer the existing helper’s home if one exists in `feedDescriptor`). Tag screen must not build `` `tag|${tag}` `` from a raw param.
6. `backgroundUrlOf` returns null unless `safeHttpUrl` accepts the string. Render sites then need no second gate. Add a unit test: `javascript:` and scheme-relative values become null; `https:` passes.
7. RecommendationsFeed capabilities: same resolution as `FeedView`.

**Deliverables.**

- [ ] Tests for descriptor sanitizer, background URL scheme, NewsTab dedupe (pure helper if the screen is hard to mount), 429 note copy if the screen test harness exists
- [ ] PostCard prop threading (reviewable in a 4-line diff plus tests if you add a render test)

**Acceptance.** `pnpm typecheck && pnpm lint && pnpm test` green.

**Out of scope.** `React.memo`, FlatList tuning (P4.1). Explore tab extraction (D3.7). Suggest keyboard nav (B6 — optional one-liner: drop the dead `activeIndex` if you are in the file; do not build keyboard nav). Followers/Following dedupe (D3.8).

---

## Wave 3 — decompose (behavior-preserving)

Start a D slice only after every R slice that lists the same files has merged.
Each D slice’s acceptance is: public behavior unchanged, tests green, LOC of the old file down, no new `any`, barrel re-exports so callers do not churn unless the slice says they move.

### D3.1 — Split Misskey `backend.ts`

Status: not started
Branch: `repair-d3.1-misskey-backend-split`
Audit: `results/01` condensed responsibility; report god-file #3
Depends: R1.1, R1.2 merged

**Goal.** `createMisskeyBackend` stays the method table, but note-body building, drive, and antennas live in modules with omit-null semantics tested once.

**In scope.**

- New: `packages/fedi/src/misskey/noteBody.ts`, `drive.ts`, `antennas.ts` (names may match existing files — if `drive.ts` / `antennas.ts` already exist, extend them, do not fork)
- `packages/fedi/src/misskey/backend.ts` (shrink)
- Tests that already cover create/edit/scheduled/drafts/drive/antennas

**Steps.**

1. Extract `wireVisibility`, `createNoteBody`, and the three other copies of poll/visibility/body building (`backend.ts` ~218, ~698–711, ~729–751, ~942–979) into one builder. Omit null/empty fields. Scheduled, drafts, create, and edit call it.
2. Move the drive block into `drive.ts`. Move the antennas block into `antennas.ts`. `antennaBody` stays the allow-list from R1.1.
3. Export `adaptClipSummary` from `clips.ts` and use it at the four hand-spread sites in `backend.ts` (~383–438).
4. Extract `isValidEmojiEntry` and use it at the three emoji-validation sites (`backend.ts` customEmojis, `customEmoji.ts` load, `customEmoji.ts` remote). If `customEmoji.ts` is untouched otherwise, this is still in scope — it is the duplication the split is supposed to kill.
5. Optional, same slice if small: `pickDefined()` helper used by the new builder. Do not boil the ocean of ~40 call sites. Convert the sites you moved.
6. Do not change request shapes except where omit-null removes fields R1.1 already forbade.

**Deliverables.**

- [ ] `backend.ts` under ~1100 LOC (record `wc -l` before/after in the log)
- [ ] One note-body test that pins omit-null for create and edit
- [ ] No caller outside `packages/fedi` imports the new modules unless `index.ts` already exported those symbols (it should not start to)

**Acceptance.** `pnpm typecheck && pnpm lint && pnpm test` green. Diff must be mostly moves. If a test count drops, stop and justify.

**Out of scope.** `stream.ts` split (audit said no). `translate.ts` split. Mastodon.

---

### D3.2 — Split `core/backend.ts` types

Status: not started
Branch: `repair-d3.2-core-backend-types`
Audit: `results/04` top 5 #5; `results/08` god-file #1
Depends: R1.3 merged (models/notification types stable)

**Goal.** The `Backend` interface stays in `core/backend.ts`. Reports-queue, admin-insight, and transfer types move to sibling modules and are re-exported so no importer changes.

**In scope.**

- New: `packages/fedi/src/core/reportsQueue.ts`, `adminInsight.ts`, `transfer.ts` (types + the pure helpers that already live next to those types, e.g. `normalizeReportOptions` / `normalizeDomainBlock` only if they are purely those domains)
- `packages/fedi/src/core/backend.ts` re-exports
- `packages/fedi/src/index.ts` only if a symbol’s export path must stay stable — prefer re-export from `backend.ts` so `index.ts` does not change

**Steps.**

1. Move types. No behavior. No field renames.
2. Record before/after `wc -l`. Target: `backend.ts` loses the three blocks the audit names. Do not also split notifications/trending in this slice unless the file is still over 1400 after the three moves — then do notifications types as a second commit on the same branch.
3. `arg()` dead `kind` param in `feedDescriptor.ts`: remove it in this slice only if you do not need to touch call sites outside `core/`. Otherwise leave it.

**Deliverables.**

- [ ] Re-export shim so existing imports keep compiling without a repo-wide rewrite
- [ ] LOC before/after in the log

**Acceptance.** `pnpm typecheck && pnpm lint && pnpm test` green.

**Out of scope.** `detect.ts` split. Implementation modules. `models.ts` split.

---

### D3.3 — Mastodon backend helper extract (not an endpoint split)

Status: not started
Branch: `repair-d3.3-mastodon-helpers`
Audit: `results/02` condensed responsibility; `results/08` god-file #2
Depends: R1.3 merged

**Goal.** Filter adaptation and list helpers leave `mastodon/backend.ts`. `endpoints.ts` stays one file.

**In scope.**

- New: `packages/fedi/src/mastodon/filters.ts`, `lists.ts` (or names that do not collide)
- `backend.ts` call sites
- Do **not** split `endpoints.ts`, `oauth.ts`, `wire.ts`, `stream.ts`, `adapt.ts`

**Steps.**

1. Move v1/v2 filter adaptation + `withFilterFallback` (~294–369) and list helpers `knownRepliesPolicy` / `adaptListRow` / `listFieldsBody` (~373–415).
2. While moving, do not “improve” filter semantics. Tests that already pin v1 fallback must stay green.
3. If the six prod `as any` casts are still in `adapt.ts` / search-page maps, narrow them in this slice only if the move does not already fill the diff. Otherwise a follow-up commit on this branch is allowed — still no feature change.

**Deliverables.**

- [ ] `endpoints.ts` line count unchanged except the R1.3 deletion already merged
- [ ] `backend.ts` LOC before/after in the log

**Acceptance.** `pnpm typecheck && pnpm lint && pnpm test` green.

**Out of scope.** Per-resource endpoint files. OAuth comment trim.

---

### D3.4 — Split `Navigation.tsx` shell chrome

Status: not started
Branch: `repair-d3.4-nav-shell`
Audit: `results/07` condensed responsibility; `results/08` god-file #4

**Goal.** `Navigation.tsx` assembles the navigator. Linking helpers, sidebar, tab bar, and account menu live in `src/shell/` (or `src/components/shell/` — match the nearer existing folder; do not invent both).

**In scope.**

- `src/Navigation.tsx`
- New modules: `linking.ts` (`normalizeShellBase`, `stripShellBase`, `getStateFromPathWithBase`, `linkingPrefixesForBase`), `Sidebar.tsx`, `TabBar.tsx` + `MobileStrip.tsx`, `AccountMenu.tsx`
- `src/__tests__/nav.test.tsx` — update imports; add unit tests for the pure linking helpers when you move them
- Fix `linkingPrefixesForBase` returning a bare path (`results/07` bug 4) **as part of the move**: return `[root, Linking.createURL(b)]` or drop the inert second entry. This is the one behavior-adjacent fix allowed. Test it.

**Steps.**

1. Move code. No gating changes. Capability-gated rows must render the same set.
2. Pure helper tests: base strip, prefix shape, `getStateFromPathWithBase` on a sub-path base.
3. Do not gate `SysDebug` here (D3.8).

**Deliverables.**

- [ ] `Navigation.tsx` under ~700 LOC (record `wc -l`)
- [ ] Linking helper tests
- [ ] Existing `nav.test.tsx` green

**Acceptance.** `pnpm typecheck && pnpm lint && pnpm test` green. Web/native nav: `not verified` unless you ran it.

**Out of scope.** Widgets. Route table changes. Login split.

---

### D3.5 — Split RichText and the translated-text scanner

Status: not started
Branch: `repair-d3.5-richtext-ast`
Audit: `results/03` responsibility 1–2; `results/08` god-file #5; `results/09` memo is P4.1
Depends: R0.2 merged; R2.1 merged (scanner fixes must move, not be reimplemented)

**Goal.** `RichText.tsx` is `Inline` / `Flow` / props. Matrix hover and mention-tap routing are siblings. Translated-text scanning leaves `ast.ts`.

**In scope.**

- `src/components/RichText.tsx` → `src/components/richtext/` (`MatrixHover.tsx`, `mentionRouting.ts`, `fnStyle.ts` for `safeHexColor` / `safeFontFamily` / `fnArg`)
- `packages/fedi/src/core/content/fromTranslated.ts` — move `contentFromTranslatedText`, `TRANSLATED_TOKEN_PATTERN`, and the helpers that exist only for that scanner
- Re-export from `ast.ts` so existing test imports keep working for one release, or update test imports in the same slice. Prefer updating imports (the tests are the only consumers).

**Steps.**

1. Move functions. Do not change match rules (R2.1 already widened classes).
2. `labelOf` duplication vs readers: leave it unless the move makes a single import obvious. Do not redesign chips.
3. Renderer tests: add cases for mention press, hashtag press, and one `fn` color allow / reject — the audit’s coverage gap. Use the existing richtext test harness (`richtext-wsb` or similar). Do not snapshot entire trees.

**Deliverables.**

- [ ] `RichText.tsx` under ~700 LOC or a thin re-export plus modules (record `wc -l`)
- [ ] `ast.ts` no longer contains the translated-text mini-parser
- [ ] New renderer tests listed above

**Acceptance.** `pnpm typecheck && pnpm lint && pnpm test` green. `content-ast` / `content-html` counts must not drop.

**Out of scope.** `memo()` on Inline/Flow (P4.1 may do that after this lands). Shared scanner with `fields.ts` (D3.8).

---

### D3.6 — Split PostCard view hooks

Status: not started
Branch: `repair-d3.6-postcard-hooks`
Audit: `results/05` condensed responsibility
Depends: R2.4 merged

**Goal.** `PostCardView` shrinks by extracting quote resolution and auto-translate into hooks. No behavior change.

**In scope.**

- New: `src/components/Post/useQuoteTarget.ts`, `useAutoTranslation.ts`
- `src/components/Post/PostCard.tsx`
- Existing post tests

**Steps.**

1. Move the quote-resolution block (~569–698) and the auto-translate block (~755–859) verbatim into hooks. Dependencies become arguments. Session id threading from R2.4 stays at the JSX call sites.
2. Optional same slice: `quoteCardProps()` helper for the three near-identical `PostQuote` call sites. Do not change which quote wins.
3. Do not add `memo` here.

**Deliverables.**

- [ ] `PostCard.tsx` LOC before/after
- [ ] Hook files have no JSX except what the hook must not have — hooks return data, the view still renders

**Acceptance.** `pnpm typecheck && pnpm lint && pnpm test` green. Existing post/quote/translation tests unchanged in assertions.

**Out of scope.** Menu model changes. Unfurl viewport gating (P4.1).

---

### D3.7 — Screen splits: Explore, Mutes, AdminReports, Drive, Login completion dedupe

Status: not started
Branch: `repair-d3.7-screen-splits`
Audit: `results/05` Explore; `results/06` Drive; `results/07` Login, Mutes, AdminReports
Depends: R0.1 merged (Mutes). Login dedupe does not depend on a prior R slice.

This slice is large. If context runs out, stop after Explore + Mutes and write `STATUS: interrupted — resume at AdminReports`. Do not start Drive and Login in a partial session.

**Goal.** Files over ~700 LOC become directories of coherent screens. Login OAuth completion has one implementation.

**In scope.**

- `src/screens/Explore.tsx` → `src/screens/explore/` (`NewsTab`, `UsersTab` + `AccountsSearch`). Screen file composes them.
- `src/components/Settings/MutesSection.tsx` → `WordFields.tsx`, `MuteBlockSearch.tsx`, `DomainBlocks.tsx`. `AccountList` may move next to `rows.tsx`.
- `src/screens/AdminReports.tsx` → list + detail. Table-drive the seven `ConfirmShell` branches if that is a mechanical map of existing strings. Do not change confirm copy or mutation set.
- `src/screens/Drive.tsx` → `src/screens/Drive/` (listing, folders, upload panel, detail dialogs). Only if the three above are done.
- `src/screens/Login.tsx` + `src/screens/AuthCallback.tsx`: extract `completeMastodonCallback` used by both `finishOAuthCallbackUrl` and the link path. Do not extract `usePasswordSignin` unless the callback extract is done and the file is still over 650.

**Steps.**

1. Move, then fix imports. Behavior tests for Mutes (including the R0.1 account-switch test) must still pass.
2. `SectionShell` Back stacking (`results/07` quality): if you touch settings navigation, switch Back to `goBack` / `popTo` so section→back does not push a second Settings route. Test if a nav test exists; otherwise note `not verified`.
3. Do not add features (antenna fields, clip flags, new admin actions).

**Deliverables.**

- [ ] Each moved file’s old path is gone or is a re-export shim with a deletion note
- [ ] LOC of the former god files in the log
- [ ] One shared Mastodon callback helper; the two call sites are wrappers

**Acceptance.** `pnpm typecheck && pnpm lint && pnpm test` green.

**Out of scope.** Settings `RadioRow` primitives (D3.8). `SysDebug` gate (D3.8). i18n.

---

### D3.8 — Shared helpers, lint, dead code, i18n ticket

Status: not started
Branch: `repair-d3.8-shared-helpers`
Audit: `results/03` quality 1–2; `results/07` lint gaps + i18n + SysDebug; `results/08` 8-param helpers; `results/01` dead code

**Goal.** The next two-place scanner bug is structurally harder. Lint catches the seams the audit named. Dead code the audits proved unused is gone. English-only error keys are ticketed, not machine-translated.

**In scope.**

- `packages/fedi/src/core/content/` shared `scanInlineTokens` used by `fromTranslated.ts` (after D3.5) and `fields.ts`. If D3.5 has not merged, skip the scanner and do the rest.
- `decideTranslation` family: `packages/fedi/src/misskey/translate.ts` owns it; `src/components/Post/translationPolicy.ts` imports it. Reconcile the length-gap short-circuit deliberately (keep the fedi one; port it to the app path or delete the app copy). App must not import a wire type.
- `lint-rules/no-wire-in-app.js`: ban `wire` path segments, not only trailing `wire`. Update the rule test.
- `lint-rules/no-ui-in-fedi.js`: ban `globalThis`, `navigator`, `self`, `fetch` as identifiers in fedi. Confirm no current fedi file breaks; if one does, that file is a real violation — fix it or narrow the rule with a comment in the rule test. Do not weaken the rule to stay green.
- `src/sys` or the route that mounts `SysDebug`: `__DEV__` gate. Production linking must not expose `/sys/debug`.
- Dead code, delete only with a grep proving zero callers: `isTranslateResult`, `ACTIVE_KEY` in `external.ts`, `createLiveRegistry` if still unreferenced, `ExploreSearchBar` `busy` if still unwired (remove the prop), `accountLookupFailure` if R1.3 left it.
- Options bags for `boolToggle`, `infinitePages`, `toggle`, `queueFor` (`results/08`). Same files only. Call sites in those files. No behavior change.
- i18n: do **not** invent translations. Add a short note to `docs/tasks/` or the log listing the 8 English-only keys (`savePending`, `badPath`, `unreachableBare`, `profileField`, `likeUnsupported`, `invalidDescriptor`, `createdList`, `updatedList`) and delete `errors.unsupported.avatar` plus its test line and locale entries (the string is false). Deleting a false string is in scope; translating the 8 is not.

**Deliverables.**

- [ ] Lint rule tests updated and failing on the old patterns (the rule tests are the proof)
- [ ] `SysDebug` absent from production route config when `__DEV__` is false — assert in a test if the routes module can be imported that way; otherwise gate the screen component and note it
- [ ] Avatar error key gone from code and catalogs
- [ ] 8-key list written where the i18n sweep will see it (`state` log + a line in this file’s slice status)

**Acceptance.** `pnpm typecheck && pnpm lint && pnpm test` green.

**Out of scope.** Translating fr+7. New locale tooling. Followers/Following hook extract — allowed as a last commit if time remains (`useFollowList`), not required.

---

## Wave 4 — performance and coverage

### P4.1 — Feed render cascade

Status: not started
Branch: `repair-p4.1-feed-memo`
Audit: `results/09` top 5 #2 and #4; `results/05` Q3
Depends: D3.5 and D3.6 merged (memoize the post-split components)

**Goal.** A feed scroll does not rebuild every row’s actions, menu, and RichText context. Lists window their work. Measure before/after; do not ship tuning numbers you did not look at.

**Read first.** `results/09` re-render findings 1–4 and hook finding 7.

**In scope.**

- `src/state/cache/postActions.ts` — memoize `usePostActions` return
- `src/components/Post/PostCard.tsx` — `useMemo` around `buildPostMenu`; `useCallback` for link/mention/hashtag/open handlers that feed RichText `ctx`
- `memo()` on `ThreadRow`, `PostCardView`, and RichText `Inline` / `Flow` after the split
- `StyleSheet.create` hoisted out of `useComposerController` (~493), `UserHoverCardView`, `Autocomplete` `SuggestionList`, `Chip`
- FlatList props on `FeedView`, `PostFeed`, Explore lists: `windowSize`, `initialNumToRender`, `maxToRenderPerBatch`, `removeClippedSubviews`. `getItemLayout` only if row height is actually stable — variable post heights must not get a lying layout. If height is variable, skip `getItemLayout` and say so.
- Unfurl: do not fire `fetchLinkPreview` for every bare URL on mount when a viewport gate is a small change; if it is not small, note it and stop. Video viewability belongs to R2.3 — do not redo it.

**Steps.**

1. Before changing lists, write down the current props (there are none) and the intended values. Prefer conservative windowing (`windowSize={7}`, `initialNumToRender={6}`, `maxToRenderPerBatch={8}`) over aggressive clipping. `removeClippedSubviews` on Android has historically blanked rows — if you cannot verify Android, set it only for Android behind a comment that says `not verified` and prefer leaving it off.
2. Stabilize handlers before adding `memo`, or `memo` does nothing.
3. `useScopeHealth` / `scopeHealthSnapshot`: if a fresh object is returned per call, `useSyncExternalStore` will loop. Check and cache the snapshot reference if unstable. This is in scope because it is a re-render storm, not a feature.
4. Touch targets below 44pt (`results/09` list finding 3): add `minHeight: 44` or `hitSlop` on the hovercard follow button, Discussions pill, and PostCard caption taps **if** you are in those files. Do not open a new a11y sweep. Extend `touch-targets.test.tsx` only for components you changed.
5. Link-open failures: `PostCard` / `RichText` currently swallow; `LinkCard` toasts. Pick toast, using the existing toast helper. One behavior.

**Deliverables.**

- [ ] Log records the FlatList props chosen and whether a 200-post scroll was measured (`not verified` if not)
- [ ] `usePostActions` identity stable across a render that does not change session/post/backend (test with a render counter or referential assertion)
- [ ] No `getItemLayout` on variable-height feeds

**Acceptance.** `pnpm typecheck && pnpm lint && pnpm test` green.

**Out of scope.** Rewriting the session store. Virtualizing thread reply branches (audit said the outer FlatList is correct).

---

### P4.2 — Coverage for the untested high-value modules

Status: not started
Branch: `repair-p4.2-coverage`
Audit: `results/08` test coverage gaps
Depends: D3.4 merged for Navigation helpers (those tests may already exist). Endpoints tests do not depend on a split.

**Goal.** The modules the audit named as genuine gaps have characterization tests. Not 100% coverage. Not snapshots of whole screens.

**In scope (pick all that still lack a suite; skip any D-slice already covered).**

- `packages/fedi/src/mastodon/endpoints.ts` — param shape and paging for the highest-traffic GETs (timelines, notifications, account, status). One file `packages/fedi/test/mastodon-endpoints.test.ts`. Mock the client. Do not hit the network.
- `packages/fedi/src/misskey/external.ts` — MiAuth check response shape, empty-body `postDirect` must not `adaptMe(undefined)`, revoke path if R1.4 did not already test it.
- `src/state/cache/postActions.ts` — queue ordering if not already pinned.
- `packages/fedi/src/mastodon/quoteMarker.ts` and `presentation.ts` — pure function tests for `urisMatch` / `isPureReblog` edge cases not already in a suite.
- `packages/fedi/src/core/content/fromHtml.ts` — only gaps not already in `content-html.test.ts`. Do not duplicate the XSS suite.

**Steps.**

1. Read the existing suite before adding a file. Extend, don’t fork.
2. Each new test names the contract (param name, empty body, pure reblog). No “renders without crashing” tests.
3. Record suite count before/after in the log (`pnpm test` summary line).

**Deliverables.**

- [ ] New or extended tests for each in-scope file that was still uncovered
- [ ] No production behavior change. If a test reveals a bug, fix it only when it is the same class as an audit finding already in this plan; otherwise log it and stop.

**Acceptance.** `pnpm typecheck && pnpm lint && pnpm test` green.

**Out of scope.** E2E. Device. Raising coverage percentages for `wire.ts`.

---

## Explicitly not in this program

Do not schedule slices for these. The audits verified them or deferred them on purpose.

- WebSocket-not-SSE, per-origin tokens, 204 handling, OAuth scope history, reblog mapping, pagination end rule, thread cycle guards, query-key `sessionId` prefix, 429 retry ban, 403 session breaker, stream backoff, Matrix shredding, Bridgy tap-time unwrap, XSS/entity/folding, schedule timezone, transfer 12-row honesty, antenna rename allow-list, clip privacy scoping (read path), composer autogrow, hover ghost/drift/revive, gesture-handler root (no gesture code), SafeArea, native hosting prober, OAuth callback hygiene, keystore gitignore.
- Building antenna notify, list-source, exclude-keywords, or chat file *sending*.
- Splitting `models.ts`, `detect.ts`, `endpoints.ts`, `oauth.ts`, `wire.ts`, `misskey/stream.ts`.
- Translating the 7 non-en catalogs (ticket only, D3.8).
- Replacing RN `Image` with `expo-image` without a measurement.
- Same-host multi-account on the legacy external session store.
- Wave 3.3 user moderation and later product waves in `state/STATE.md`.

## Slice status board

Update the status line on the slice **and** this table when a session ends.

| Slice | Status | Branch | Blocked by |
|---|---|---|---|
| R0.1 WordField | done | `repair-r0.1-wordfield-reseed` | — |
| R0.2 RichText hooks | done | `repair-r0.2-richtext-hooks` | — |
| R0.3 Composer races | done | `repair-r0.3-composer-races` | — |
| R1.1 Misskey wire | not started | `repair-r1.1-misskey-wire` | — |
| R1.2 Session caches | not started | `repair-r1.2-session-caches` | R1.1 if both edit `backend.ts` factory |
| R1.3 Mastodon honesty | not started | `repair-r1.3-mastodon-honesty` | — |
| R1.4 Session plumbing | not started | `repair-r1.4-session-plumbing` | — |
| R2.1 Content scanners | not started | `repair-r2.1-content-scanners` | — |
| R2.2 Exclusive honesty | not started | `repair-r2.2-exclusive-honesty` | R1.1 (`votePoll` in `misskey/backend.ts`) |
| R2.3 Media / native | not started | `repair-r2.3-media-native` | RichText one-liner waits if R0.2/D3.5 in flight |
| R2.4 Surface honesty | not started | `repair-r2.4-surface-honesty` | — |
| D3.1 Misskey backend split | not started | `repair-d3.1-misskey-backend-split` | R1.1, R1.2 |
| D3.2 Core type split | not started | `repair-d3.2-core-backend-types` | R1.3 |
| D3.3 Mastodon helper split | not started | `repair-d3.3-mastodon-helpers` | R1.3 |
| D3.4 Nav shell split | not started | `repair-d3.4-nav-shell` | — |
| D3.5 RichText / ast split | not started | `repair-d3.5-richtext-ast` | R0.2, R2.1 |
| D3.6 PostCard hooks | not started | `repair-d3.6-postcard-hooks` | R2.4 |
| D3.7 Screen splits | not started | `repair-d3.7-screen-splits` | R0.1 |
| D3.8 Shared helpers / lint | not started | `repair-d3.8-shared-helpers` | D3.5 for the scanner only |
| P4.1 Feed memo | not started | `repair-p4.1-feed-memo` | D3.5, D3.6 |
| P4.2 Coverage | not started | `repair-p4.2-coverage` | D3.4 for nav helper tests |

First parallel batch a coordinator can hand out today: **R0.1, R0.2, R0.3, R1.1, R1.3, R1.4, R2.1, R2.4**. Hold R1.2 until R1.1’s `backend.ts` diff is known. Hold R2.2’s poll vote until R1.1 merges. Hold every D slice until its Depends line is merged.
