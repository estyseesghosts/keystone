# Pinetree Pages + Clips — Backend Audit + Misskey Diffs

Source: `/Users/terezi/Local Documents/Keystone/pinetree` (Rust server, no frontend)
Misskey baseline: `/Users/terezi/keystone2/docs/pages-clips.md` + `/Users/terezi/Local Documents/misskey`
Date: 2026-10-23
Status: **complete — all 4 audits landed (Pages Backend, Clips Backend, Pages client-consumption, Clips client-consumption)**

Pinetree is a pure Rust server (`src/`, `Cargo.toml`, redb storage). There is no `packages/frontend`. The two "frontend" audits were rescoped as client-consumption audits (what a hypothetical web/mobile client must call/render) and are still running — sections 4–5 below are placeholders.

---

## 1. Pages — Backend (COMPLETE)

### 1.1 Data model

`src/domain/page.rs:80-135`:

| Field | Type / bound | Notes |
|---|---|---|
| `id` | `String` (aidx) | PK |
| `owner_id` | `String` | local author **or cached remote author row** for materialized `Article`s |
| `title` | `1..=256` chars (`PAGE_TITLE_MAX`) | upstream `varchar(256)` |
| `name` | slug `1..=256`, rejects `\x00-\x20,\x7f` + `:/?#[]@!$&'()*+,;=%\`` | upstream `pageNameSchema` verbatim |
| `summary` | `Option<String>`, `<=256` | `""` → `None` on write |
| `content` | `Value` (array of objects with string `type`) | lenient: unknown types stored, skipped at render |
| `variables` | `Value` (must be array) | AiScript vars; passthrough on federation |
| `script` | `String`, `<=16384` | **local-only, never federated, never executed** (no AiScript engine) |
| `eye_catching_image_id` | `Option<String>` | must be caller's own file or `NO_SUCH_FILE` |
| `font` | `Serif \| SansSerif`, default `SansSerif` | |
| `align_center`, `hide_title_when_pinned` | `bool`, default `false` | |
| `tier` | `CollectionTier`, local default `Listed` | privacy tier; remote rows always `Listed` |
| `federate` | `bool`, default **`true`** when param absent | per-page opt-out |
| `approved_actor_uris` | `Vec<String>` | for `RemoteApproved` tier |
| `uri` | `Option<String>` | canonical remote `Article.id`; `None` = local |
| `remote_attachments` | `Vec<Value>` | origin `attachment`s, `http(s)` only, re-emitted verbatim |
| `liked_count` | `i64` | saturating `+1/-1` in-txn |
| `created_at_ms`, `updated_at_ms` | `i64` | explicit (Misskey derives `createdAt` from ID) |
| `visibility` | `Public\|Home\|Followers\|Specified`, default `Public` | **reuses note enum**; `Home` collapses to `Public` |
| `visible_user_ids` | `Vec<String>` (`<=100`) | only meaningful with `Specified` |
| `remote_published_ms`, `remote_updated_ms` | `Option<i64>` | origin stamps, served in place of row times |

`PageLike` (`src/domain/page.rs:219-226`): `{id, user_id, page_id, created_at_ms}`, unique pair.
`page_visible_to` (`:228-253`): owner always; moderators bypass; else `Public|Home→true`, `Followers→viewer follows owner`, `Specified→viewer ∈ visible_user_ids`.

redb tables (`src/persistence/redb/page_store.rs:6-21`): `PAGES` (`id → JSON`), `PAGES_BY_OWNER` (`(owner,page) → u8`), `PAGES_BY_OWNER_NAME` (`(owner,name) → page_id`, atomic uniqueness), `PAGES_BY_URI` (`uri → page_id`), `PAGE_LIKES` (`(page,user) → JSON`). No SQL migrations; `#[serde(default)]` keeps old rows decoding. Deletes remove indexes + range-delete likes in one txn. `featured_pages`: full scan, `liked_count>0`, sort `liked desc, id desc`, top 10.

Misskey schema deltas: Pinetree **adds** `tier, federate, approved_actor_uris, uri (+PAGES_BY_URI), remote_attachments, remote_published/updated_ms`; **enforces** `visibility + visible_user_ids` (Misskey write path hardcoded `'public'`, never enforced); explicit timestamps vs ID-derived; redb JSON + app-level cascade (no FK); no `pinnedPage` FK (stored on `Account.pinned_page_id`, validated `application/commands/accounts.rs:242-250`); **no `note.pageCount` / `collectReferencedNotes`** (note-blocks are quote-links only). Slug race atomic single-writer + `Conflict(NAME_ALREADY_EXISTS)`; remote ingest disambiguates per owner. `unlike` floors at 0 (Misskey could go negative).

### 1.2 Service logic

`PageBody` + validation (`src/application/commands/pages/write.rs:20-48`, `src/api/misskey/endpoints/parse/pages.rs:125-276`): `{title?, name?, summary? (null clears), content?, variables?, script?, eyeCatchingImageId? (null clears), font?, alignCenter?, hideTitleWhenPinned?, visibility?, pageVisibility? (public|home|followers|specified), visibleUserIds? (≤100), federate?, approvedActorUris?}`. Create requires `title,name,content,variables,script`; update is partial-merge. Eye-catch → `check_own_file`.

- `create_page`: require fields, `summary ""→None`, defaults `tier=Listed, visibility=Public, federate=true`, `uri=None`. If `page_federates` → enqueue `PageCreated` job (atomic with insert).
- `page_federates` (`write.rs:188-203`): `federate && tier==Listed && visibility!=Specified && instance.federate_pages`. Specified never fans out.
- `update_page`: owner lookup (`NO_SUCH_PAGE` on miss/foreign — moderators **cannot** update); partial merge; `updated_at=now`; re-evaluate → `PageUpdated` job.
- `delete_page`: owner **or** admin/moderator (else `ACCESS_DENIED`); moderator writes `DeletePage` log; enqueues `PageDeleted{page_id,author_id,page_uri={base}/pages/{id}}` if it federated; cascade likes atomically.
- `page_like_job` (`:239-275`): only when `page.uri.is_some()` (materialized remote) and owner remote with known inbox → `PageLiked{...}`. Co-located likes need no delivery.
- Read (`read.rs:10-157`): `check_page_visible` — anon + non-Public/Home → `NO_SUCH_PAGE`; else follow/visible checks. All gated failures `NO_SUCH_PAGE`-hiding. `show_page_by_id/by_name` (name form local-users-only). `like_page`: visibility gate → `YOUR_PAGE` → txn → `ALREADY_LIKED`; remote like enqueues `PageLiked`. `unlike_page`: no visibility gate, no federation (no `Undo(Like)` sent). `handle_inbound_page_like`: dedup idempotent. `ingest_remote_article` (see federation). `authorize_page_fetch`: tier discipline for AP GET.
- No `collectReferencedNotes` equivalent — only `collect_page_file_ids` (`src/api/misskey/packers/page.rs:44-66`) for `attachedFiles`; note blocks are quote links at federation time.

### 1.3 API endpoints

Base `POST /api/{endpoint}` JSON; unknown field → `400 UNSUPPORTED_FIELD`; 1 MiB cap → 413; `pages/create 10/h`, `pages/update 300/h`.

| Endpoint | Params | Auth | Returns | Notes |
|---|---|---|---|---|
| `pages/create` | `title!,name!,content!,variables!,script!,summary?,eyeCatchingImageId?,font?,alignCenter?,hideTitleWhenPinned?,visibility?,pageVisibility?,visibleUserIds?,federate?,approvedActorUris?` | authed, `write:pages`, 10/h | packed `Page` | `NAME_ALREADY_EXISTS` on clash; `NO_SUCH_FILE`; `federate` absent = true |
| `pages/update` | `pageId!` + same partial | owner only, `write:pages`, 300/h | 204 | null clears; foreign → `NO_SUCH_PAGE` (not `ACCESS_DENIED`) |
| `pages/delete` | `pageId!` | owner **or moderator** | 204 | moderator logs; fans out `Delete(Article)` |
| `pages/show` | `{pageId} \| {name,username}` | optional | packed | gated → `NO_SUCH_PAGE`-hiding; `isLiked` only authed |
| `pages/like` | `pageId!` | authed, `write:page-likes`, must satisfy visibility | 204 | `NO_SUCH_PAGE/YOUR_PAGE/ALREADY_LIKED`; remote enqueues `Like` |
| `pages/unlike` | `pageId!` | authed, `write:page-likes` | 204 | `NO_SUCH_PAGE/NOT_LIKED`; no gate, no federation |
| `pages/featured` | `{}` | optional | `Page[]` top-10 | `liked>0` + visible + double-guard `visibility==Public` |
| `users/pages` | `userId! + cursor(limit 1..100=10)` | optional | `Page[]` | **public-only**, newest-first, unknown user → `[]` |
| `i/update` (pin) | `pinnedPageId: id\|null` | authed | — | must exist + owned else `NO_SUCH_PAGE`; `null` clears |
| `GET /pages/{id}` | — | signed/anon fetch gate | `Article` JSON | 404 when switch off/ungated; `403` known-unauthorized, `404` anon |

Error UUIDs verbatim upstream (`errors/codes.rs:381-407`, `errors/social.rs:123-196`).

Pack (`packers/page.rs:67-148`): `{id,createdAt,updatedAt,userId,user:UserLite,content,variables,title,name,summary?,hideTitleWhenPinned,alignCenter,font,script,eyeCatchingImageId,eyeCatchingImage,attachedFiles,likedCount,isLiked? (authed only)}`. Does **not** emit `visibility/tier/federate/visibleUserIds` despite docs claim — read gate is hiding-only.

**Absent vs Misskey** (404 `UNKNOWN_API_ENDPOINT`): `i/pages`, `i/page-likes`, `page-push` (no AiScript engine, no `pageEvent` streaming), admin curation for featured (pure query both sides).

### 1.4 Federation (key)

Misskey: **zero AP surface** for pages. Pinetree: pinetree↔pinetree as **`Article`**; Misskey/Mastodon read as plain notes (graceful degrade). No Page actor; `attributedTo` = owner. Admin switch `federatePages` default OFF + per-page `federate` default ON; either off → 404 + no fan-out.

- Doc `GET /pages/{id}` (`federated_collections/pages.rs:161-249`): `{@context, id:{base}/pages/{id}, type:Article, attributedTo, to/cc, name:title, summary, content:sanitized HTML, url:id, published/updated, attachment:[eye-catch + remote verbatim], tag:[], source:{content, variables, presentation:{font,alignCenter,hideTitleWhenPinned}, slug:name, mediaType:json}}`. Audience: `Listed+Public/Home → to=[Public],cc=[followers]`; `Listed+Followers → to=[followers]`; `Listed+Specified → to=[resolved actor URIs]`; else `to=cc=[]`. `render_page_html` (`:55-159`): escapes text, whitelist `p/h2/section/figure/img/blockquote/a`; local drive images only; note blocks → quote link or dropped; unknown dropped. **`script` never federated** (unit-pinned `:437-480`). Serving (`:316-389`): switch check → fetch-auth → `page_visible_to` (remote Followers/Specified fail closed; anon→404, known→403), re-checked per request.
- Outbound (`federation/outbox/pages.rs`, `dispatch/execute.rs:380-476`, `deliver_collections.rs:52-71`): create/update with `page_federates()` commits `PageCreated/PageUpdated` in same txn → worker re-reads (must exist, still federate, still `Listed`, switch on) → render `Article` wrapped in `Create/Update` (audience copied) → fan out to `collect_recipient_inboxes_for_author` (inline-small / one-job-per-inbox-large + retry). Delete → `Delete{object:{id:page_uri,type:Article}}`. Remote-page like → `Like{object:page_uri,content:"❤"}` to origin inbox; local likes no job.
- Inbound (`inbox/create/notes.rs:72-86`, `update.rs:176-208`, `delete.rs:40-60`, `like.rs:17-86`): `Create` + embedded `Article` → `ingest_remote_article` → materialize (no note row); malformed falls through to note pipeline; URI-only `Create(Article)` not fetched. `Update(Article)`: local URLs ignored; else `get_page_by_uri` → signer must equal owner + not host-blocked → refresh. `Delete` matching `get_page_by_uri` (non-local): owner-signed → dedup + `delete_page`. `Like` on `/pages/{id}` or canonical `uri` → `PageLiked` notification. No `Announce` for pages; no `Undo(Like)` for pages.
- `ingest_remote_article` (`commands/pages/read.rs:216-447`): require `type==Article` + non-empty `id` → `uri`. `to/cc → visibility`: Public-in-`to`/`cc` → `Public`; `*/followers` → `Followers`; else `Specified` with best-effort `find_by_uri` (unresolvable dropped, fail-closed). Title: `name` else 40-char `sanitize_html_to_mfm(content)` snippet else `"Untitled"` (≤256). Summary trimmed ≤256. Content: `source.content` if valid else single text block from sanitized HTML. `script` **never stored** (remote `""`). Variables passthrough; `source.presentation` + `source.slug` round-trip with defaults. Attachments `http(s)` kept verbatim, never fetched. Refresh updates title/summary/content/variables/attachments/visibility/readers/presentation/timestamps; fresh slugifies (`lowercase alnum/-/_`, `page` fallback) + numeric disambiguation per owner, `tier=Listed, federate=false`. **Remote pages never re-federate.** Existing Article-notes stay notes.

### 1.5 Visibility, likes, tests

Two axes (`docs/federated-pages.md:18-26`): tier (`Private|LocalApproved|Unlisted|Listed|RemoteApproved`, default `Listed`) via `authorize_page_fetch` (off→404; `Private→Hidden`; `LocalApproved→Forbidden`; `Unlisted|Listed→Serve`; `RemoteApproved→approver-only`); read gate `public|home|followers|specified` (default `public`, `home≡public`) + `visible_user_ids≤100` enforced on show/like/users/featured/`GET /pages/{id}`. Failures `NO_SUCH_PAGE`/404/403 with **zero content bytes** (pinned `tests/federation/pages.rs:500-562`). Misskey diff: dead-legacy → enforced everywhere + `home` + Specified never fans out.

Likes: local same-txn counter, verbatim errors, `isLiked` authed-only. Federated: remote-materialized likes send `Like` to origin; inbound `Like`s record + notify `pageLiked` (Misskey never left instance). Replay converges via dedup. **Unlike local-only** (no `Undo(Like)`). Gated stranger `like` → `NO_SUCH_PAGE`; `featured` never lists gated.

Migrations: none SQL-side; redb auto-created; `#[serde(default)]` preserves old rows. Tests: `tests/federation/pages.rs:24-331` (round-trip fidelity, script exclusion, Update convergence, Like round-trip + replay, sanitize, no shadow note) + `:339-732` (gated lifecycle, 403/404 zero-bytes, hiding, notify, featured, convergence, origin timestamps); `tests/conformance/page_store.rs` (CRUD/slug race, likes/featured, URI rebind, visibility); `endpoints/tests_batch_n/clips_pages.rs:360-576` (REST parity, verbatim UUIDs); `federated_collections/pages.rs:391-481` (script exclusion); `domain/page.rs:255-279` (slug/font).

---

## 2. Clips — Backend (COMPLETE)

### 2.1 Data model

`src/domain/clip.rs:31-56`:

```rust
pub struct Clip {
  id, owner_id, name (1..=100), description (Option, <=2048, ''→null),
  is_public (default false), tier (default tier_from_is_public()),
  federate (default false OFF), approved_actor_uris,
  created_at_ms, last_clipped_at_ms (Option, add-only), updated_at_ms,
}
```

Limits: `CLIP_LIMIT_PER_OWNER=10`, `CLIP_NOTES_PER_CLIP=200` (`clip.rs:22-29`) — hard-coded constants, no role system (Misskey `RoleService.clipLimit/noteEachClipsLimit` defaults). `CollectionTier`: `Private → LocalApproved → Unlisted → Listed → RemoteApproved`; `tier_from_is_public(true)=Listed, false=Private`; `advertised()=Listed only`; `remotely_servable()=Unlisted|Listed|RemoteApproved`.

`ClipNote` `{id, clip_id, note_id, created_at_ms}` — pure join, unique `(clip,note)`, never packed (`clips/notes` packs `Note`s). `ClipFavorite` `{id, user_id, clip_id, created_at_ms}` — unique `(clip,user)`. **`ClipFollow` `{id, user_id, clip_id, created_at_ms}`** — pinetree-first, no Misskey equivalent; unique `(user,clip)`; drives `Update`/`Delete(Collection)` fan-out + notifications; "follows are cheap rows", no cap in v1.

Counters diverge: **no `note.clippedCount` column** (`grep` only hits comments saying it does NOT exist). `notesCount` derived via `count_clip_notes` (`range.count()`); `favoritedCount` via range count on `CLIP_FAVORITES`. `lastClippedAt` touched in `add_clip_note` txn; `updated_at_ms` on add AND remove.

Storage (`persistence/redb/clip_store.rs:6-27`): `CLIPS` (id→JSON), `CLIPS_BY_OWNER`, `CLIP_NOTES` ((clip,note)→JSON), `CLIP_FAVORITES` ((clip,user)→JSON), `CLIP_FOLLOWS` ((clip,user)→JSON), `CLIP_TOMBSTONES` (uri→deleted_at). Cap-check + insert + touches + job enqueue **atomically in one write txn** (port `application/ports/clip_store.rs:4-96`). `clips_by_owner` / `clip_note_ids` newest-first via id-desc. No FDB adapter for clips.

### 2.2 Service logic

`src/application/commands/clips.rs` — one op per Misskey endpoint; delivery in `federation/outbox/*`.

- `owner_clip`: `get_clip` + `owner_id==` else `NotFound(NO_SUCH_CLIP)`.
- `create_clip`: owner guard → validate (`''→null`) → `tier` from `visibility?` else `tier_from_is_public` → `federate/approvedActorUris` → atomic `create_clip` (race-safe, unlike Misskey `countBy` TOCTOU).
- `update_clip`: owner lookup → patch only `Some` fields (`description: Option<Option>` so omitted≠cleared — **fixes Misskey wipe bug**); `isPublic` re-derives tier unless explicit; `updated_at=now`; if still federates enqueue `ClipUpdated` + notify followers (skip owner); else if was-open → prune remote follows + enqueue `ClipDeleted`.
- `delete_clip`: owner lookup → if federates enqueue `ClipDeleted{clip_uri}` + notify followers + member-note authors → cascade delete in txn → always `record_clip_tombstone(uri,now)`.
- `clip_sync_federates`: `federate && tier==Listed && instance.federate_clips` (tightened vs membership: unlisted-with-flag loses broadcast).
- `follow_clip/unfollow`: `visible_clip` gate (anyone who can read may follow) → idempotent; `write:clip-favorite`. Inbound: signer==follower, read gate, host-block drop, dedup, `Conflict→Ok(true)`.
- `list_clips`: `clips_by_owner` + in-memory pagination + truncate.
- `visible_clip`: `is_public→Ok`; `viewer==owner→Ok`; else `NO_SUCH_CLIP` (covers show/notes/favorite; `unfavorite` deliberately bypasses).
- `clip_member_note_ids`: `visible_clip` → ids → note-time pagination → truncate; visibility/mute/block/search at endpoint pack layer.
- `add_clip_note`: `owner_clip` + `notes.get_note` else `NO_SUCH_NOTE`; **no note-visibility check** (upstream parity — any existing id, incl. others' followers/specified/remote; filtered at read); membership jobs + author `ClipUpdated` notify (followers NOT spammed — "quieter rule") → atomic add; `Conflict` passthrough.
- `remove_clip_note`: note URI resolved even if row gone; membership jobs + author notify; `remove→false` → `NO_SUCH_NOTE` (never-added + never-existed, upstream parity).
- `favorite/unfavorite`: favorite `visible_clip` gate → `ALREADY_FAVORITED`; unfavorite existence-only (no private gate — upstream asymmetry preserved) → `NOT_FAVORITED`.
- `clip_membership_jobs`: if `!clip_sync_federates→[]`; deleted notes never federate; inboxes = remote note-author + remote owner-followers + remote clip-followers (deduped); one `ClipMembershipChanged{activity_id,...}` per inbox sharing one id.
- `clip_favorites`: `clip_favorites_by_user` + skip deleted.
- `authorize_clip_fetch`: `!switch||!federate→Hidden`; `Private→Hidden`; `LocalApproved→Forbidden`; `Unlisted|Listed→Serve`; `RemoteApproved→approver-only` (anon/stranger → 404).

Errors are `PortError::NotFound/Conflict` mapped per-endpoint to verbatim UUIDs (`parse/errors.rs:123-138`).

### 2.3 API endpoints

Dispatcher `endpoints/mod.rs:403-444` (14 arms). Handlers `dispatch_social/clips.rs`. Packer `packers/clip.rs:46-106`. Pack shape (federation columns never packed, test-asserted): `{id, createdAt(=parse_time(id)), lastClippedAt|null, userId, user:UserLite, name, description|null, isPublic, favoritedCount, isFavorited? (authed), isFollowing? (authed, DIVERGENCE), notesCount? (owner only)}`.

| Endpoint | Auth / scope / rate | Params | Behavior |
|---|---|---|---|
| `clips/create` | cred + `write:account` | `name! 1..100, isPublic=false, description? ≤2048 (''→null), visibility?, federate=false, approvedActorUris?[]` (last 3 ext) | `TOO_MANY_CLIPS 920f7c2d-...`; rejects extras |
| `clips/update` | cred + `write:account` | `clipId!, name?, isPublic?, description? (Option<Option>: omitted untouched, ''→null, null clears), visibility?, federate?, approvedActorUris?` | `NO_SUCH_CLIP b4d92d70-...`. **Fixes Misskey wipe bug** |
| `clips/delete` | cred + `write:account` | `clipId!` | `NO_SUCH_CLIP 70ca08ba-...`; tombstone always written |
| `clips/list` | cred + `read:account` | `limit 1..100 d10, pagination` | own incl. private, newest-first |
| `clips/show` | optional cred | `clipId!` | `visible_clip`; `NO_SUCH_CLIP c3c5fe33-...`; anon gets no `isFavorited/isFollowing/notesCount` |
| `clips/notes` | optional cred | `clipId!, limit, pagination, search? 1..100` | `NO_SUCH_CLIP 1d7645e6-...` → per-note `is_visible` + mute/block both-directions + blocked-host → per-word lowercase text/cw substring (upstream `ILIKE` parity) |
| `clips/add-note` | cred + `write:account`, **20/h** | `clipId!, noteId!` | `NO_SUCH_CLIP d6e76cc0-...`, `NO_SUCH_NOTE fc8c0b49-...`, `ALREADY_CLIPPED 734806c4-...`, `TOO_MANY_CLIP_NOTES f0dba960-...` |
| `clips/remove-note` | cred + `write:account` | `clipId!, noteId!` | `NO_SUCH_CLIP b80525c6-...`, `NO_SUCH_NOTE aff017de-...` |
| `clips/favorite` | cred + `write:clip-favorite` | `clipId!` | `NO_SUCH_CLIP 4c2aaeae-...`, `ALREADY_FAVORITED 92658936-...` |
| `clips/unfavorite` | cred + `write:clip-favorite` | `clipId!` | `NO_SUCH_CLIP 2603966e-...` (no private gate), `NOT_FAVORITED 90c3a9e8-...` |
| `clips/my-favorites` | cred + `read:clip-favorite` | `{}` (no paging — unbounded, upstream parity) | `Clip[]` |
| `clips/follow` | cred + `write:clip-favorite` | `clipId!` | DIVERGENCE; `visible_clip` gate; idempotent 204; `NO_SUCH_CLIP ac078150-...` |
| `clips/unfollow` | cred + `write:clip-favorite` | `clipId!` | DIVERGENCE; existence-only; idempotent 204 |
| `clips/followers` | cred + `read:account` | `clipId!` | DIVERGENCE; `visible_clip` then **owner-only** else `403 ACCESS_DENIED 3edf8e54-...` → `UserLite[]` (limit 100) |
| `i/export-clips` | cred + `write:account`, **1/h** (pinetree normalizes all exports to 1/h; upstream 1/day) | `{}` | enqueue export → 204; progress + `exportCompleted` notif |
| `i/import-clips` | cred, 1/h | `fileId!` | Pinetree-only; consumes own export format; `NO_SUCH_FILE/EMPTY_FILE/TOO_BIG_FILE` |
| `notes/clips` | **NO arm** → `404 UNKNOWN_API_ENDPOINT` | — | manifest lists as no-arm; "do not call"; `clip_ids_for_note` exists for alias but no route. Call `clips/notes`. |
| `users/clips` | **NO arm** → `404` | — | Same. Workarounds: `clips/list` (own) or AP `GET /users/{id}/clips` index. |

Error UUIDs verbatim upstream (`errors/codes.rs:340-376`); follow trio pinetree-fixed `ac078150-...` + `3edf8e54-...`.

### 2.4 Federation (key)

Contract: `docs/federated-collections.md`, `docs/federated-clips.md`, `FEDERATION.md`, `docs/handoff-federated-clips-pages-phase2.md`, `docs/endpoint-manifest.md`. Gates: global `federateClips` default OFF + per-clip `federate` default OFF; either off → zero footprint (404s, actor `clips` omitted, no fan-out). `clip_sync_federates` additionally requires `tier==Listed` for `Update`/`Delete`/membership.

- AP representation — `OrderedCollection`, not custom type: `{base}/clips/{id}` → `OrderedCollection{attributedTo, name, summary(=description), totalItems, updated, first:{uri}?page=true}`; page `OrderedCollectionPage{partOf, totalItems, orderedItems:[note URIs]}` single full-state page, cap 200. Index `{base}/users/{id}/clips` → collection of listed+federate clip URIs (ungated). Actor doc `clips` ref iff switch on. Tombstone: deleted URI → `410 Tombstone{formerType:OrderedCollection}` while switch on; off → 404.
- Serving with fetch gate: `GET /clips/{id}[?page=true]` → lookup (miss → tombstone?→410 else 404; switch off → 404) → `authenticate_fetch_viewer` (sig verify, failure → anon, never 401) → `authorize_clip_fetch` (`Serve→200`, `Forbidden+identified→403`, `anon→404`, `Hidden→404`) → `render_clip_collection[_page]` with **per-item gate** (skip deleted; `ViewerContext{remote:true}`; per-author follow check; `is_visible`; remote so `local_only` withheld).
- Outbound (enqueue in same txn, deliver via `FederateDeliverPayload`): membership `Add`/`Remove` → fan out to **remote note-author inbox + remote owner-follower inboxes + remote clip-follower inboxes**, one job per inbox sharing one `activity_id` (`Add|Remove{actor:owner, target:collectionURI, object:noteURI}`); stale-job guard re-checks at delivery; deleted notes never federate. Metadata `Update(OrderedCollection)` on update (embedded full doc, one round trip) → owner followers + clip followers. `Delete(OrderedCollection)` on delete (URI carried though row gone) and on tier-restriction (with remote-follow pruning). Clip `Follow` outbound via normal `Follow{object:collectionURI}`. No `Move`, no relays.
- Inbound (all `202` on ignore; replay-gated): `Add`/`Remove` → `handle_clip_membership`: replay check; local `/clips/` target → ignore (remote never mutates ours); else `fetch_collection_owner` (signed GET `attributedTo`) must equal signer → `evict_remote_clip_cache`. Never creates/mutates local rows. `Update(OrderedCollection)` → verify → `ingest_remote_clip_doc` (cache `orderedItems` + `updated`, no refetch) + dedup. `Delete(OrderedCollection)` → embedded `id` must match wrapper; owner-verified → evict + record; **owner-fetch-failed → evict anyway** (stale worse; only different-owner naming rejected). `Follow{object:/clips/…}` → readable-clip gate, blocked-host drop, dedup. `Undo(Follow{collection})` → unfollow + `forget_activity` both ids.
- Remote caching (`remote_clips.rs`): process-memory `HashMap<uri,{fetched_at,note_uris,updated}>`, cap 100, TTL 600s. `resolve_remote_clip`: fresh → no I/O; else unsigned GET → `updated`-stamp fast path → else full-state (inline `orderedItems` or one `first` hop, cap 200, deduped). Embedded-Update fast path, eviction on inbound Add/Remove/Delete, signed owner fetch as system actor. Errors never cached.
- What does NOT federate: likes/favorites (**no AP for clip favorites**; `inbox/like.rs` page-target only; `favoritedCount` local). Notes inside clips NOT auto-fetched on sync (URI list; item fetch via note path). No `Move`, no relays/channels.

### 2.5 Visibility/auth, jobs, tests

Show/notes/favorite: `visible_clip` — public→anyone (incl. anon), private→owner-only else `NO_SUCH_CLIP`. Unfavorite existence-only (upstream asymmetry). `list` owner-only. `my-favorites` no re-check (stale private stays — upstream quirk preserved). `notes` per-note `is_visible` + mute/block both-directions + blocked-host at read; write imposes zero note-visibility check (any existing id, incl. remote; filtered at read). AP: tier gate + per-item note gate. Scopes: `write:account` (CRUD + membership), `read:account` (list/show/notes + followers), `write:clip-favorite` (favorite/unfavorite + follow/unfollow), `read:clip-favorite` (my-favorites). Rate: `add-note 20/h`; exports 1/h.

Jobs: `ExportEntity::Clips` serializes id-ASC `[{id,name,description,lastClippedAt,clipNotes:[{id,createdAt,note:{...full incl. uri/url/user}}}]}]` — upstream `serializeClip` shape; invisible/deleted skipped via real follow edge; tier/federate never exported. Import (`exports/clips.rs`): parse `[{name,description?,clipNotes?}]`, find-or-create by name, attach visible+existing, `(applied,skipped)` counts. `exportCompleted{exportedEntity:"clip"}` notif. **No `clippedCount` GC coupling** — remote GC can collect clipped notes (accepted divergence). Notifications: `NotificationKind::ClipUpdated→"clipUpdated"` (nullable `clip_id` + `note_id`); on add/remove (author), update (followers), delete/restrict (followers + authors); packed with embedded `clip`. Streaming: `clip` channel **exists** (`Clip{clip_id}`, public anon OK, private owner-only; `ClipUpdated/Deleted` events) BUT command-layer comment says "publishes no per-clip stream … no client subscribes" and endpoint-manifest says "notifications only" — treat channel as legacy/compat. No moved-account concept.

Migrations: none SQL-side; redb auto-created; description/favorite baked into v1; `clippedCount` intentionally omitted; tombstones/follows/tiers new. Tests: `endpoints/tests_batch_n/clips_pages.rs:17-350` (CRUD/caps/favorites/notes/search/remove, verbatim UUIDs) + `:578-746` (export/import round-trip, guards, malformed-quiet); `tests/conformance/clip_store.rs` (owner-scope, cap race, unique/cap/`lastClippedAt`, idempotent favorites, cascade); `tests/federation/clips.rs` (two-node tiers + sync, `updated` revalidation, Add/Remove converge, zero footprint, notifs); unit `domain/clip.rs`, `clips.rs:379-450` (authz matrix), `remote_clips.rs` (TTL/evict loopback); `tests/gaps_streaming.rs:687` (`ClipUpdated→Clip`).

Explicit Misskey diff table: AP none→full `OrderedCollection` + index + actor ref + `Add/Remove` + `Update/Delete(Collection)` + `Follow/Undo` + tombstone + TTL cache (default OFF); schema base + `tier/federate/approved/created/updated` + `ClipFollow` + tombstones, **no `clippedCount`, no roles** (consts 10/200); limits atomic-txn (race-safe) vs `countBy` TOCTOU; **update wipe bug fixed** (`Option<Option>`); counters derived in-txn vs fire-and-forget + stale; endpoints same 11 local + `follow/unfollow/followers` + `isFollowing` + real export + `import-clips`, **no `notes/clips`/`users/clips`** (404); pack + `isFollowing`, federation cols never packed; visibility same local + tier/AP gate, **no embed route** (no leak vector); events streaming-present-but-contract-notifications-only vs none; export same shape minus hidden-before + import added, no cleaner coupling; same scopes, no moved concept, export 1/h.

---

## 3. Key file index

Domain: `src/domain/clip.rs`, `src/domain/page.rs`, `src/domain/collection.rs`, `src/domain/notification.rs`
Ports: `src/application/ports/clip_store.rs`, `src/application/ports/job_queue.rs:456-523`
App: `src/application/commands/clips.rs`, `src/application/commands/pages/write.rs`, `src/application/commands/pages/read.rs`, `src/application/commands/exports/build.rs:190-270`, `src/application/commands/exports/clips.rs`, `src/application/commands/accounts.rs:242-250`
Store: `src/persistence/redb/clip_store.rs`, `src/persistence/redb/page_store.rs`
API: `src/api/misskey/endpoints/mod.rs`, `src/api/misskey/endpoints/dispatch_social/clips.rs`, `dispatch_social/pages.rs`, `dispatch_users.rs`, `dispatch_i/exports.rs`, `dispatch_i/imports.rs`, `src/api/misskey/packers/clip.rs`, `packers/page.rs`, `packers/notification.rs`, `src/api/misskey/errors/codes.rs`, `src/api/misskey/response/rate_limiter.rs`
AP: `src/activitypub/federated_collections/clips.rs`, `remote_clips.rs`, `serving.rs`, `src/activitypub/federated_collections/pages.rs`, `src/activitypub/actor/actor_document.rs:148-163`
Outbox: `src/federation/outbox/payload.rs`, `src/federation/outbox/clips.rs`, `src/federation/outbox/pages.rs`, `src/federation/outbox/dispatch/deliver_collections.rs`, `dispatch/execute.rs`
Inbox: `src/federation/inbox/mod.rs`, `inbox/follow/collection_membership.rs`, `inbox/update.rs`, `inbox/delete.rs`, `inbox/like.rs`, `inbox/follow/follow_requests.rs`, `inbox/follow/undo_block.rs`, `inbox/create/notes.rs`
Streaming: `src/streaming/server/subscribe.rs:41-45`, `src/streaming/hub.rs`, `streaming/events.rs`
Tests: `src/api/misskey/endpoints/tests_batch_n/clips_pages.rs`, `tests/conformance/clip_store.rs`, `tests/conformance/page_store.rs`, `tests/federation/clips.rs`, `tests/federation/pages.rs`
Docs: `docs/federated-collections.md`, `docs/federated-clips.md`, `docs/federated-pages.md`, `docs/handoff-federated-clips-pages-phase2.md`, `docs/endpoint-manifest.md`, `FEDERATION.md`

---

## 4. Pages — client-consumption audit (COMPLETE)

No OpenAPI/spec for pages (no `openapi`/`swagger` hits in `src/`; contracts are `docs/federated-pages.md`, `docs/federated-collections.md` §§2/4, `docs/endpoint-manifest.md` §§36/38/43.2). No web/SSR/OG HTML for pages (no `ClientServerService`, no `views/page.tsx`; only AP `GET /pages/{id}` serving an `Article`). No `packages/frontend`.

### 4.1 Endpoint table

Base `POST /api/<endpoint>` JSON. Unknown fields → `400 UNSUPPORTED_FIELD` (every pages arm). Auth = token (Bearer/body-`i`/cookie); suspended/deleted rejected. No pagination params on any `pages/*`. Mutations `204` **except** `create` → `200` + packed Page.

| Method+path | Params | Auth / scope / rate | Response | Notes |
|---|---|---|---|---|
| `POST /api/pages/create` | `title!` (1–256), `name!` (slug 1–256, no `:/?#[]@!$&'()*+,;=%` whitespace/control), `content!` (array; every element object with string `type`), `variables!` (array), `script!` (≤16384, empty OK), `summary?` (≤256; `null` clears), `eyeCatchingImageId?` (own drive file else `NO_SUCH_FILE`), `font?` (`serif`/`sans-serif`), `alignCenter?`, `hideTitleWhenPinned?`, `visibility?` (tier name, legacy set — NOT read gate), `pageVisibility?` (`public\|home\|followers\|specified`, default `public`), `visibleUserIds?` (≤100), `federate?` (default **true** when absent), `approvedActorUris?` | cred; `write:pages`; **10/hour** | `200` packed Page | Missing `title/name/content/variables/script` → `INVALID_PARAM` (`null` counts as missing). Duplicate `(owner,name)` → `NAME_ALREADY_EXISTS 4650348e-...` (atomic). Empty summary → `None`. Tier defaults `Listed` |
| `POST /api/pages/update` | `pageId!` + any subset (all optional; `summary:null` / `eyeCatchingImageId:null` clear; omitted = untouched) | cred (owner only; non-owner → `NO_SUCH_PAGE`, **not** `ACCESS_DENIED`); `write:pages`; **300/hour** | `204` empty | Partial merge; `updated_at=now`; rename clash → `NAME_ALREADY_EXISTS 2298a392-…`; foreign/unknown → `NO_SUCH_PAGE 21149b9e-...`. Federated → `Update(Article)` fan-out. Empty body accepted (bumps `updatedAt`, may federate) |
| `POST /api/pages/delete` | `pageId!` | cred; **owner OR moderator** (other → `403 ACCESS_DENIED 8b741b3e-...`); `write:pages`; no limit | `204` | Unknown → `NO_SUCH_PAGE eb0c6e1d-...`. Cascades likes; `Delete(Article)` if federated; moderator-on-other writes `deletePage` log |
| `POST /api/pages/show` | **either** `{pageId!}` **or** `{name! + username!}` (username lowercased, **local only**); else `INVALID_PARAM` | optional; no scope | `200` packed Page | Gate enforced; unauthorized/unknown/gated → `NO_SUCH_PAGE 222120c0-...`. `isLiked` iff authed |
| `POST /api/pages/like` | `pageId!` | cred; `write:page-likes` | `204` | `NO_SUCH_PAGE cc98a8a2-...` (also gated — must satisfy visibility); own → `YOUR_PAGE`; repeat → `ALREADY_LIKED`. Remote-materialized like enqueues federated `Like` to origin |
| `POST /api/pages/unlike` | `pageId!` | cred; `write:page-likes` | `204` | Missing → `NO_SUCH_PAGE a0d41e20-...`; no row → `NOT_LIKED`. Count floored at 0 |
| `POST /api/pages/featured` | `{}` (unknown fields rejected) | optional; **public-only** (gate + `visibility == Public`; Home excluded even though gate admits Home) | `200 Page[]` (≤10, `likedCount>0`, highest first) | Pure query, no curation (matches upstream) |
| `POST /api/users/pages` | `userId!` + cursor `limit?` (1–100, default 10), `sinceId/untilId/sinceDate/untilDate?` | optional; no scope | `200 Page[]` newest-first | **Public-read-gate only** (Home/Followers/Specified excluded). Unknown user → `[]`. Profile-tab + "recent posts" source |
| `POST /api/i/update` (pinned part) | `pinnedPageId` (id or null) | cred | `200` Account | Must exist **and belong to caller** else `NO_SUCH_PAGE`; `null` clears. Packed back as `pinnedPageId`; **`pinnedPage` always `null`** (`packers/user.rs:369`) — client must `pages/show` it |
| `GET /pages/{id}` (AP, not Misskey API) | path id | signed-fetch gate (anon→404, known-unauthorized→403) + tier + read gate | `Article` JSON / 404/403 | Federation surface, not web page |

**Deliberately absent (404 `UNKNOWN_API_ENDPOINT`):** `i/pages`, `i/page-likes`, `page-push`, `pages/search`, any pages export/import. `docs/federated-pages.md:94` tells clients not to call the first three.

### 4.2 Type shapes (wire)

Packed `Page` (actual — `packers/page.rs:74-148`):

```json
{
  "id": "string", "createdAt": "ISO (from id, not stored)",
  "updatedAt": "ISO (row updated_at_ms)",
  "userId": "string", "user": "UserLite",
  "content": "[block, ...]", "variables": "[...]",
  "title": "string", "name": "slug",
  "summary?": "string (omitted when null)",
  "hideTitleWhenPinned": "bool", "alignCenter": "bool", "font": "serif|sans-serif",
  "script": "string (local reads ONLY; never in any federated field)",
  "eyeCatchingImageId": "string|null", "eyeCatchingImage": "DriveFile|null",
  "attachedFiles": "DriveFile[] (from image-block fileIds, missing → dropped)",
  "likedCount": "uint",
  "isLiked?": "bool (ONLY when authed; absent for anon)"
}
```

Correction to `docs/federated-pages.md:32` (claims pack also carries `visibility`, `pageVisibility`, `visibleUserIds?`): **it does not** — packer emits none of `visibility`/`pageVisibility`/`visibleUserIds`/`tier`/`federate`/`uri`/remote fields. Consequence: **non-owner cannot read gate state from `show`**; observable only behaviorally (`NO_SUCH_PAGE` vs `200`) + `users/pages`/`featured` filtering. `summary` omitted (not `null`) when unset; `eyeCatchingImage` `null` when unset/unresolvable.

Domain `Page` (stored, superset): `id, owner_id, title, name, summary?, content (Value array), variables (Value array), script, eye_catching_image_id?, font, align_center, hide_title_when_pinned, tier (default Listed), federate (default true), approved_actor_uris, uri? (None = local), remote_attachments[] (http(s) only), liked_count, created_at_ms, updated_at_ms, visibility (default Public), visible_user_ids[], remote_published_ms?, remote_updated_ms?`.

Block types: server validation lenient by design — array elements must be objects with string `type`; **any type stored**, unknown skipped at render. Known: `text` (`{type,text}`), `section` (`{type,title?,children[]}` recursive), `image` (`{type,fileId}`), `note` (`{type,note: id|http(s) URL|{url|id|uri}}`). No `input`/`textarea`/`button`/AiScript-shape validation; legacy text/number-input migration no-op. `collect_page_file_ids` recurses only through `section.children` for `image.fileId`. `PageLike` unique `(user,page)`; counters same-txn saturating; `featured` = `liked_count>0` top 10.

### 4.3 Viewer needs

- **Resolve:** `pages/show {pageId}` for id links; `pages/show {name, username}` for `/@username/pages/slug`. `name` per-owner unique (atomic check+insert); slug rules client-validatable (1–256, reject whitespace/control + `:/?#[]@!$&'()*+,;=%\`). Handle renames: slug ≠ id; after `update`, re-resolve by id.
- **Gate:** treat `NO_SUCH_PAGE` (`222120c0-…`) as "not found or not visible" — never distinguish. Anon: no `isLiked` key (not `false`).
- **Attached files:** pack resolves `attachedFiles` + `eyeCatchingImage` as full DriveFiles — viewer needs file-URL construction + tolerate missing (stale `fileId` dropped; federated-side renders as nothing). Editor thumbnails need `drive/files/show {fileId}` separately.
- **Embedded notes:** pack does **not** resolve `note`-block targets. Client resolves each: local id → `notes/show`; `http(s)` → quote link (server renderer: local id → canonical URI, remote http(s) passthrough, else drop). Payload may be string or `{url|id|uri}`. **No `note.pageCount`/back-reference** (Misskey has it; pinetree dropped — no `pageCount` in domain/pack).
- **No web/OG:** no HTML page, no OG meta, no `/embed/`. Canonical share URL is client convention (`/@{username}/pages/{name}`); only server URL is AP `Article` at `/pages/{id}` (JSON, fetch-gated, not embeddable).
- **Author/pin:** `pinnedPageId` readable on packed user but `pinnedPage` always `null` — `pages/show` the pinned id separately. Profile tab from `users/pages` (public only); same for related/recent.
- **Remote pages:** materialized `Article`s pack identically (same blocks via `source.content`, `variables` passthrough, `script` always `""`, eye-catch `None` with origin `remote_attachments` re-served only over federation, not REST). No `uri` in pack — treat all packed pages the same; never execute `script`.

### 4.4 Editor needs

- **Create:** full body required (`title, name, content, variables, script` mandatory; `content: []` validates — only shape checked; `variables` typically `[]`, `script` typically `""`). Validate slug client-side. Pre-check uniqueness via `pages/show {name, username}` (own username) as hint only; server authoritative; clash → `NAME_ALREADY_EXISTS 4650348e-…`.
- **Update:** partial; `null` clears `summary`/`eyeCatchingImageId`; empty-string summary normalized to cleared. No read-modify-write except content-array edits. Non-owner → `NO_SUCH_PAGE` (owner-only; moderators cannot update). Success `204` no body — re-`show` or patch locally.
- **Delete:** `204`; owner or moderator. Client navigates away (server returns nothing).
- **Duplicate:** no endpoint — client `show` → tweak `title`/`name` (Misskey client appends `" - copy"`/`"-copy"`, collision → `NAME_ALREADY_EXISTS`) → `create`.
- **Eye-catch:** upload via `drive/files/create` first, then pass id; foreign/missing → `NO_SUCH_FILE` (create `b7b97489-…`, update `cfc23c7c-…`). Must be caller's **own** file.
- **Errors:** `INVALID_PARAM 3d81ceae-…` (length/shape/font/enum), `UNSUPPORTED_FIELD 9307f30c-…` (strict allow-list), `RATE_LIMIT_EXCEEDED d5826d14-…` + `Retry-After` (create 10/h, update 300/h), per-endpoint `NO_SUCH_PAGE`, `ACCESS_DENIED` delete-by-other `8b741b3e-…`, `YOUR_PAGE`/`ALREADY_LIKED`/`NOT_LIKED`. No drafts/versioning; no specified-without-ids guard (empty `visibleUserIds` + Specified = owner/mods only).
- **Limits:** title/name ≤256, summary ≤256, script ≤16384, `visibleUserIds` ≤100, `federate`/`pageVisibility` enums; no per-user page-count cap (unlike clips' `clipLimit`), no per-page block cap.
- **Uniqueness:** slug unique **per owner**, not global; two users may share slug; rename onto own other page's slug → `NAME_ALREADY_EXISTS 2298a392-…`; redb single-writer atomic (no TOCTOU).

### 4.5 Likes, pins, featured/recent

Likes `pages/like`/`unlike {pageId}` → `204`; self-like banned (`YOUR_PAGE`); repeat (`ALREADY_LIKED`/`NOT_LIKED`) → treat as toggle-state confirmation. `likedCount` transactional; `isLiked` authed only. Index `pages/featured` = global top-10 by `likedCount` (>0), public-only, no curation UI (matches upstream). Profile: `users/pages {userId, limit≤100 default 10, cursor}` — public only, newest-first, unknown → `[]`. **No `i/pages` (own incl. gated), no `i/page-likes` (liked)** — both 404: **no "my non-public pages" list, no "pages I liked" list**; own gated pages reachable only by id/`show`, liked pages undiscoverable after the fact. Pin: `i/update {pinnedPageId}` (own only); read back `pinnedPageId`, resolve via `show`.

### 4.6 Federation (client must know)

Local pages federate as AP `Article` at `GET /pages/{id}` (`name`=title, `summary`, `content`=sanitized HTML, `attachment`=[eye-catch + verbatim origin attachments for remote rows], `source`={content, variables, presentation{font,alignCenter,hideTitleWhenPinned}, slug, mediaType}). **`script` structurally excluded** — no serializer code path; client must never execute/forward `script`. Requires **both** instance `federatePages` (admin `admin/update-meta`, **default OFF**) and per-page `federate` (**default ON**) and `tier == Listed`; `Specified` never fans out. Client: expose `federate` (default ON) but warn admin switch gates delivery. `visibility` (tier) vs `pageVisibility` (read gate) separate — expose separately. Propagation: create/update → `Create`/`Update(Article)` to followers (+Specified); delete → `Delete(Article)`; remote-page likes → `Like{object: page URI}` back; co-located likes no delivery. Inbound `Like` arrives as **`pageLiked` notification** (`{pageId, page}` via `i/notifications` + `main:notification`; dedup `page-liked:{pageId}:{liker}:{activityId}`) — poll `i/notifications`, no new stream. Inbound well-formed `Article`s materialize as remote pages (canonical `uri`; derived slug + per-owner numeric disambiguation; `source.content` preferred else synthesized text block; `script` forced `""`; `to`/`cc` → visibility incl. Public-in-`cc`⇒Public collapse). Updates refresh by URI; owner-signed deletes retract (likes cascade). Remote ids/URIs (note links, like targets) may be foreign — pass through, don't rewrite. Non-pinetree readers see pages as plain notes (title ignored, summary→CW, content→body); block fidelity pinetree↔pinetree only via `source`.

### 4.7 Missing pieces vs full client

No search (no `pages/search`; `featured`/`users/pages` only discovery). No drafts; gate fields write-only (accepted, never packed — client tracks own settings; `users/pages`/`featured` silently exclude gated). No `i/pages`/`i/page-likes` → no "my pages incl. private", no "liked pages". No realtime: upstream `page-push`/`pageEvent` (AiScript interactivity) absent; streaming `server.rs` only *names* `pageEvent` in forwarded main-event list — zero producers; poll `show` re-fetch. No AiScript engine — `script`/`variables` inert blobs; Misskey dynamic-block interactivity has no server counterpart. No pages export/import (clips have it). No per-block note/file existence validation at write (stale ids accepted, dropped at read) — editor should pre-validate (`drive show`, `note show`). `pinnedPage` never packed (extra `show` per profile). `featured` hides `likedCount<=0`; unlike floors at 0.

### 4.8 Misskey diff

| # | Misskey client | Pinetree client |
|---|---|---|
| 1 | `show` needs no visibility thought (all public; no gate) | Gated reads everywhere: `show/like/featured/users/pages` hide non-visible as `NO_SUCH_PAGE`; name-form local-only; anon vs authed packs differ (`isLiked`) |
| 2 | Create sends only `title/name/summary/content/variables/script/eyeCatchingImageId/font/alignCenter/hideTitleWhenPinned`; `visibility` hardcoded `'public'` | Additionally `pageVisibility + visibleUserIds` (read gate), `federate` (default true), legacy `visibility` (= tier). `script:''/variables:[]` hardcode still valid |
| 3 | Lists: `i/pages {limit:5}` (own), `i/page-likes {limit:5}` (liked `{id,page}`), `pages/featured` (public top-10, no `isLiked`), `users/pages` (public) | `i/pages`, `i/page-likes` **don't exist** — own-gated/liked lists unimplementable; `users/pages` cursor-paged `limit 1..=100 =10`; `featured` same shape |
| 4 | Like/unlike fire-and-forget (can go negative); no page-like notifications; `page-push` lets anyone push `pageEvent` to anyone's page (no ownership check) | Transactional/floored counters; inbound remote likes → real `pageLiked` notification (`pageId+page`); **no `page-push`/`pageEvent`** — AiScript realtime gone; Misskey dynamic blocks render dead anyway |
| 5 | `script` executes client-side (AiScript); `collectPageVars` feeds it | `script` stored + packed on local reads but **never executed, never federated** (no engine); remote rows `script:""`. Never execute page scripts |
| 6 | Viewer resolves `note` blocks via `notes/show`, images via `attachedFiles` + `drive/files/show`; `note.pageCount` protects embedded notes from remote GC | Same resolution, but **no `pageCount`** — embedded-note lifetime: links may dangle; image-miss identical (dropped) |
| 7 | `i/update {pinnedPageId}` + packed `pinnedPage` (full Page); `hideTitleWhenPinned` consumed by viewer | Same set/clear, but `pinnedPage` **always null** — extra fetch; `hideTitleWhenPinned` stored, consumption client-defined |
| 8 | Errors: `NAME_ALREADY_EXISTS` create/update, `show NO_SUCH_PAGE`, like/unlike codes; delete owner-or-moderator + modlog; create 10/h + update 300/h | Identical IDs/semantics verbatim; same delete/modlog; same limits; plus `UNSUPPORTED_FIELD` strictness + `RATE_LIMIT_EXCEEDED`+`Retry-After` |
| 9 | Federation: none — never leaves except HTML/export; no `uri`, no activities | pinetree↔pinetree `Article` federation (CRUD fan-out, like-back, inbound materialization with `uri`, fetch-gated `GET /pages/{id}`). Client URI-tolerant (remote pages/attachments/actors) while REST hides it |
| 10 | SSR/OG: `GET /@:user/pages/:name` + OG tags (with `og:url` mismatch quirk); `/embed` leaks noted | No web surface — client owns routes, canonical URLs, share/copy-link, OG/meta, embed iframe |

**Bottom line for a hypothetical client:** implement the 7 write/read endpoints + `users/pages` + pinned-via-`i/update` per the table; render 4 block types natively with `notes/show` + `drive/files/show` resolution; treat `NO_SUCH_PAGE` as hidden; never execute `script`; poll instead of subscribing; and do not plan UI around `i/pages`, `i/page-likes`, page search, page export, or live `pageEvent` — the server has none.

## 5. Clips — client-consumption audit (COMPLETE)

No OpenAPI/spec file (`**/*openapi*`, `**/*swagger*` → zero hits). No `/embed/clips/:id`, no `GET /clips/:id` HTML, no SSR. Unknown `POST /api/*` → `UNKNOWN_API_ENDPOINT 404`; unknown JSON field → `UNSUPPORTED_FIELD 400`. Base: `POST /api/{endpoint}` with `{i: token, ...params}`; packed objects → `200`, mutations → `204`.

### 5.1 Endpoint table

| Method+Path | Params | Auth / scope + rate | Returns | Errors |
|---|---|---|---|---|
| `POST /api/clips/create` | `name! 1..100`, `isPublic=false`, `description? ≤2048` (`''`→`null`); ext `visibility? (private\|local_approved\|unlisted\|listed\|remote_approved)`, `federate?=false`, `approvedActorUris?[]` | auth, `write:account` | `200 Clip` | `TOO_MANY_CLIPS 920f7c2d-...` at 10/owner; `INVALID_PARAM` on bad name/desc/visibility |
| `POST /api/clips/update` | `clipId!`, `name?`, `isPublic?`, `description? (string\|null)` — `''`→`null`, absent untouched (≠ Misskey wipe), `visibility?`, `federate?`, `approvedActorUris?` | owner only, `write:account` | `200 Clip` | `NO_SUCH_CLIP b4d92d70-...` (foreign also maps here) |
| `POST /api/clips/delete` | `clipId!` | owner only, `write:account` | `204` | `NO_SUCH_CLIP 70ca08ba-...` |
| `POST /api/clips/list` | `limit? 1..100 d10`, `sinceId?/untilId?/sinceDate?/untilDate?` | auth, `read:account`; own newest-first | `200 Clip[]` | auth only |
| `POST /api/clips/show` | `clipId!` | optional; if authed `read:account` | `200 Clip` | `NO_SUCH_CLIP c3c5fe33-...` (private+anon/non-owner) |
| `POST /api/clips/notes` | `clipId!`, `limit? d10`, pagination, `search? 1..100` (whitespace-split AND, case-insensitive over `text+cw`) | optional; `read:account` if authed | `200 Note[]` | `NO_SUCH_CLIP 1d7645e6-...`; deleted/member-invisible silently dropped; per-note visibility/mute/block filtered |
| `POST /api/clips/add-note` | `clipId!`, `noteId!` | owner, `write:account`, **20/h** (`429` + `Retry-After`) | `204` | `NO_SUCH_CLIP d6e76cc0-…`, `NO_SUCH_NOTE fc8c0b49-…`, `ALREADY_CLIPPED 734806c4-…`, `TOO_MANY_CLIP_NOTES f0dba960-…` (200/clip) |
| `POST /api/clips/remove-note` | `clipId!`, `noteId!` | owner, `write:account` | `204` | `NO_SUCH_CLIP b80525c6-…`, `NO_SUCH_NOTE aff017de-…` (never-added + never-existed) |
| `POST /api/clips/favorite` | `clipId!` | auth, `write:clip-favorite` | `204` | `NO_SUCH_CLIP 4c2aaeae-…` (private hides), `ALREADY_FAVORITED 92658936-…` |
| `POST /api/clips/unfavorite` | `clipId!` | auth, `write:clip-favorite` | `204` | `NO_SUCH_CLIP 2603966e-…` (**no private gate** — asymmetry), `NOT_FAVORITED 90c3a9e8-…` |
| `POST /api/clips/my-favorites` | none (`{}`) | auth, `read:clip-favorite` | `200 Clip[]` (no paging; deleted skipped) | — |
| `POST /api/clips/follow` *(pinetree-only)* | `clipId!` | auth, `write:clip-favorite`; anyone who can read may follow | `204` idempotent | `NO_SUCH_CLIP ac078150-…` |
| `POST /api/clips/unfollow` *(pinetree-only)* | `clipId!` | auth, `write:clip-favorite` | `204` idempotent | `NO_SUCH_CLIP ac078150-…` |
| `POST /api/clips/followers` *(pinetree-only)* | `clipId!` | auth, `read:account` + **owner-only** | `200 UserLite[]` (newest-first, cap 100) | non-owner → `ACCESS_DENIED 3edf8e54-...` (403) |
| `POST /api/i/export-clips` | none | auth, `write:account`, **1/h** (pinetree normalizes all 13 exports to 1/h; upstream 1/day) | `204` (job; file + `exportCompleted` later) | `RATE_LIMIT_EXCEEDED 429` |
| `POST /api/i/import-clips` *(pinetree-only)* | `fileId!` (own Drive file; missing/foreign → `NO_SUCH_FILE 7c1d9e02-…`; empty → `EMPTY_FILE`; oversize → `TOO_BIG_FILE`) | auth, `write:account`, **1/h** | `204` (enqueues import) | file-guard errors above |

**NOT implemented (Misskey has; Pinetree 404s):** `users/clips` (zero arms), `notes/clips` (zero arms; only vestigial `clip_ids_for_note` default `[]` + doc "do not call"). Workarounds: `clips/list` (own) or AP `GET /users/{id}/clips` index (listed+federate URIs only, not packs).

### 5.2 Type shapes

Packed `Clip` (`packers/clip.rs:46-106`):

```json
{
  "id": "aidx", "createdAt": "ISO from id",
  "lastClippedAt": "ISO|null (add-only, never cleared on remove)",
  "userId": "owner", "user": "UserLite",
  "name": "string", "description": "string|null", "isPublic": "bool",
  "favoritedCount": "u64 always",
  "isFavorited?": "bool — authed only",
  "isFollowing?": "bool — authed only (pinetree ext)",
  "notesCount?": "u64 — viewer==owner only (even public hides from non-owners)"
}
```

Federation columns **never packed**: `tier`, `federate`, `approvedActorUris`, `updated_at_ms`. Domain rows never packed directly: `ClipNote` unique `(clip,note)`; `ClipFavorite` unique `(clip,user)`; `ClipFollow` unique, no cap; tombstones `uri → deleted_at` kept forever. No `note.clippedCount` (counts derive at read). Caps 10/owner, 200/clip enforced atomically in one redb txn.

AP wire (federation-only): collection `{@context, id:{base}/clips/{id}, type:OrderedCollection, attributedTo, name, summary, totalItems, updated, first:{id}?page=true}`; page `{type:OrderedCollectionPage, partOf, totalItems, orderedItems:[≤200 note URIs]}`; activities `Add/Remove{actor, target:collection, object:note}`, `Update{embedded full collection}`, `Delete{{id, type}}`, `Tombstone{formerType}`, `Follow{object:collection}` / `Undo`.

### 5.3 Per-screen client flows

- **A. List own:** `clips/list {limit,pagination}` newest-first, incl. private. `notesCount` present (owner) — render `name + notesCount/200`, `lastClippedAt`. No "X/10" counter endpoint; over-limit only as `TOO_MANY_CLIPS` on create. Owner cap is 10 (not Misskey submenu 30).
- **B. Show + timeline:** `clips/show {clipId}` (authed/owner gets `isFavorited/isFollowing/notesCount`) then `clips/notes {clipId, limit, cursors, search?}`. Timeline is `Note[]` — reuse note renderer. Deleted/invisible silently dropped (short pages — keep scrolling with cursors).
- **C. Create:** `name!` (trim, 1..100), `description?` (≤2048, `''`→null), `isPublic=false` + pinetree `federate?` + `visibility?` + `approvedActorUris?` — expose `federate` **separately** from `isPublic` (needs admin `federateClips` ON too). Clearing description via update `description:null/''`, not omission. `TOO_MANY_CLIPS` → limit dialog.
- **D. Update:** `clips/update {clipId, ...}` — absent untouched; `isPublic` re-derives tier unless `visibility` explicit; `Listed+federate+switch` edit fans out `Update(Collection)` + follower `clipUpdated` notifies. Returns updated `Clip` — replace local copy.
- **E. Delete:** `204`; cascades memberships/favorites/follows; federated fans out `Delete(Collection)` + tombstone + notifies followers + member-note authors. Client must navigate away + drop cache (AP `410`; REST `NO_SUCH_CLIP`).
- **F. Add note:** `204` (no body). No write-time note-visibility check — any existing id (own/others' followers/specified, remote cached) clips; read filters. Duplicate → `ALREADY_CLIPPED` → offer unclip toggle; full → `TOO_MANY_CLIP_NOTES`; missing → `NO_SUCH_NOTE`. Throttle `20/h` → `429+Retry-After` (queue/retry). Author gets `clipUpdated` (followers NOT spammed). Bumps `lastClippedAt` + `updated_at_ms` (AP `updated`).
- **G. Remove:** `204`; missing pair → `NO_SUCH_NOTE` either way. Federated → `Remove` to remote author inbox. `updated_at_ms` bumps; `lastClippedAt` untouched.
- **H. Favorite + list:** `favorite/unfavorite` → `204`; `my-favorites {}` → `Clip[]` no params/paging. `favorite` hides private as `NO_SUCH_CLIP`; `unfavorite` skips gate. Double-tap `ALREADY_FAVORITED`/`NOT_FAVORITED` → treat as success-sync. Scopes `write/read:clip-favorite` enforced server-side (client should disable without scope).
- **I. Follow (pinetree-only):** `follow/unfollow` → `204` idempotent; `isFollowing` from `show` for button state. `followers` **owner-only** (non-owner `403`) — never call for others' counts. Follow drives AP `Update/Delete` fan-out + `clipUpdated` on meta/delete/restrict.
- **J. Per-user clips — MISSING.** No `users/clips`. No profile tab; substitutes: `clips/list` (own) or AP `GET /users/{id}/clips` (listed+federate URIs only, not packs).
- **K. Clips-on-note — MISSING.** No `notes/clips`. Note-detail "in N clips" cannot be built; omit (do not fan out N `clips/notes`).
- **L. Export/import:** `i/export-clips {}` → `204` (`1/h`); completion via `exportCompleted` notif (`fileId`, `exportedEntity=clips`; poll `i/notifications`). Format `[{name, description?, clipNotes?}]`. `i/import-clips {fileId}` → `204`; find-or-create by name (first match), attach existing+visible+non-deleted; `(applied, skipped)` server-side. Import creates **private** (`isPublic=false, federate=false`).

### 5.4 Visibility (client must enforce/display)

- Private (`isPublic=false`, default tier `Private`): `show/notes/favorite` → `NO_SUCH_CLIP` for anon/non-owners (generic "not found"). `unfavorite` still works. `list` shows own privates; no public per-user listing.
- Public: anon can `show` + `notes` + WS `clip` channel; `isFavorited/isFollowing/notesCount` **absent** for anon (hide buttons/counts, don't default false).
- Owner-only: `notesCount` only `viewer==owner` (outsiders page `clips/notes` to learn size); `isFavorited/isFollowing` authed-only.
- Per-note gating in `clips/notes`: server `is_visible` + mute/block both-directions (authed) + follow edges; client still applies own mute/block/word filters; expect short pages.
- Embed/SSR: none. No `/clips/:id` HTML, no `/embed/clips/:id` (Misskey private-leak vector N/A). WS gate (`subscribe.rs:122-150`): `clip` needs `{clipId}`; public → anon OK; private → owner only; gone/foreign → silent refusal. Per-event recheck: none (connect-time only).

### 5.5 Federation (client + cross-instance)

- What federates: **all three** `tier==Listed` AND `federate==true` AND admin `federateClips==true` (via `admin/update-meta`). Default closed (`federate=false` even for `isPublic=true`). Either off → zero footprint: AP 404, actor doc omits `clips`.
- AP routes: `GET /clips/{id}[?page=true]` → collection/page (per-item note gate vs verified fetcher; `updated` = `updated_at_ms`); deleted → `410 Tombstone` (switch on) else `404`. `GET /users/{id}/clips[?page=true]` → advertised index (listed+federate only; itself ungated). Actor `clips` ref when switch on.
- Tiers: `Private`=never leaves; `LocalApproved`=remote 403; `Unlisted`=capability-URI fetch, never advertised; `Listed`=advertised + servable; `RemoteApproved`=signed-fetch approver-only. `isPublic=true⇔Listed`, `false⇔Private` by default; `visibility` overrides. `RemoteApproved` is fetch-gated, not copy-gated.
- Remote clips via REST? No — `show/notes/favorite/follow` take local ids only; remote membership is server-side (`resolve_remote_clip()` pulls full state with 10-min TTL + `updated` fast path, 100-entry cache; `Add/Remove` only **evict**; `Update` ingests embedded doc; `Delete` evicts + prune remote follows). Client must not build local timelines from AP.
- Remote notes as members? Yes — any existing (incl. cached remote) note id clips; remote-authored members trigger `Add` fan-out (one `activity_id`, deduped). Deleted notes never federate membership.
- Update/delete propagation: meta edit → `Update(Collection)` + follower `clipUpdated`; delete/restrict → `Delete(Collection)` + tombstone + notifies to followers **and** member authors. Inbound `Add/Remove` on local `/clips/` URI ignored (remote never mutates ours); on remote URI owner-verified via signed `attributedTo` fetch then evict. Inbound `Follow{collection}` → local follow row (readable-gate, signer==follower); `Undo` retracts; remote rows pruned on restrict/delete. Misskey/Mastodon ignore all gracefully.
- Client rule: on `clipUpdated` naming deleted/restricted clip, drop cache (receivers see `Tombstone`). Membership edits notify only note author — poll `i/notifications` with `includeTypes: [clipUpdated]`; don't poll per-clip.

### 5.6 Gaps vs full client

- No `users/clips`, no `notes/clips` → no profile tab, no "in these clips" on note detail (biggest gap).
- No pagination: `my-favorites` unbounded, `followers` cap 100 no cursor, `clip_ids_for_note` default `[]`. Only `list`/`notes` paginate (note-id cursors).
- No full-text search: only `clips/notes search` AND-substring over text+cw. No clip-name search, no global directory (unlisted never advertised by design).
- Rate limits: `add-note 20/h`, exports `1/h` (code wins over doc claim of 1/day parity), 1 MiB body → `413`, unknown field → `400 UNSUPPORTED_FIELD`.
- Realtime: `clip` WS exists (`connect {channel:'clip', params:{clipId}}` → `updated`/`deleted` + `null`) but **no producer publishes** (zero `publish` sites; only hub mapping + enum). Dead — poll `show/notes` + `i/notifications` (`clipUpdated` + packed `clip`). Docs already declare "REST-only, no clip stream".
- Counters: no `clippedCount` — badges from `notesCount` (owner only) or not at all.
- `update` fix: absent untouched; `''|null` clears (Misskey wipes on omitted — don't replicate; send only changed fields).
- Moderator path: `delete` owner-only in API; no client affordance.
- No version history, retro-conversion, clip-subscribe beyond follow, public unlisted directory, executable content.

### 5.7 Misskey diff (client view)

| Area | Misskey client | Pinetree client |
|---|---|---|
| Endpoints | 11 `clips/*` + `users/clips` + `notes/clips` + export | Same minus `users/clips`, `notes/clips`; plus `follow/unfollow/followers`, `import-clips`. Missing → `UNKNOWN_API_ENDPOINT 404`. |
| Pack | `isFavorited?` (authed), `notesCount?` (owner), `favoritedCount` always | Same **plus `isFollowing?` (authed)**; federation cols never packed. Same omission rules. |
| List own | `Paginator('clips/list')` | Same + cursors; cap 10 (not 30). |
| Per-user | `users/clips {userId, limit:20}` public-only (even owner) | **Absent** — AP index is URI-only, not packs. |
| On-note | `notes/clips {noteId}` gated, public-only | **Absent** — omit section. |
| Timeline | `clips/notes {limit:10, canSearch, clipId}` | Same + explicit cursors; identical search; both-directions mute/block + visibility server-filtered. |
| Add | `clipsCache (limit:30, 30min)`, duplicate → confirm-unclip, `TOO_MANY` alert, optimistic `±1` | Same IDs/UUIDs verbatim + `20/h` `429+Retry-After`; any existing id clips; author `clipUpdated`. Client owns caching. |
| Remove | in-timeline no-confirm vs submenu-toggle confirm | Single `remove-note`; missing → `NO_SUCH_NOTE` either way. |
| Fav | heart + count badge (never locally bumped), unfav confirm, `my-favorites {noPaging}` | Same + follow row (`isFollowing`); `followers` owner-only (`403` otherwise). Disable without scope. |
| Visibility | `isPublic` only; private via direct URL; `/embed` leaks private | `isPublic` **+ `federate` + `visibility` tier + `approvedActorUris`**; private → `NO_SUCH_CLIP` except `unfavorite`; **no embed/SSR/OG at all**. |
| Limits | `notesCount/policies.*`, role editor | Fixed `10`/`200`; same `1..100 / ≤2048`. |
| Export | 1/day → Drive JSON + `exportCompleted` | **1/h** + **`import-clips {fileId}`** (find-or-create by name). |
| Streaming | none (poll) | Same in practice (channel wired, never fires); use `clipUpdated` via `i/notifications`. |
| Federation | none (local; `clippedCount` + GC guard) | pinetree↔pinetree `OrderedCollection` sync (listed+federate+switch); tombstones `410`; 10-min cache; follows drive fan-out. Surface `federate` state + tombstone-drop; never build timelines from AP. |
| Error IDs | per-endpoint `NO_SUCH_CLIP` UUIDs, `ALREADY_CLIPPED`, `TOO_MANY`, etc. | **Verbatim same**; follow/import pinetree-fixed (`ac078150-…`, `3edf8e54-…`, `7c1d9e02-…`). |
| Quirks fixed | `update` wipes `description`; delete stale; fav count stale; 30-item truncation | True partial-merge; delete cascades + tombstone + notify; live derived counts; owner cap 10. |

**Bottom line:** Misskey clips UI minus `users/clips` and `notes/clips`, plus follow row (`isFollowing`, owner-only `followers`), plus separate `federate/visibility/approvers`, plus export+import, plus throttle + tombstone + `clipUpdated` handling. Packs, error IDs, gates, idempotency, pagination params, rate buckets otherwise Misskey-compatible by design.
