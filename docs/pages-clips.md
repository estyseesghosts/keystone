# Misskey Pages + Clips — Frontend & Backend Audit

Source repo: `/Users/terezi/Local Documents/misskey` (Sharkey-fork of Misskey)
Date: 2026-10-23
Status: **complete — all 4 audits landed (Clips Frontend, Clips Backend, Pages Backend, Pages Frontend)**

This document is the running report for the Pages/Clips audit. Sections marked TODO will be filled as background subagents land.

---

## 1. Clips — Frontend (COMPLETE)

Scope: `packages/frontend/src/**` only for UI; `packages/misskey-js`, `locales/en-US.yml`, backend `clips/*` paramDefs cited only to explain frontend validation/error-IDs.

### 1.1 Files consulted

Core:
- `packages/frontend/src/pages/clip.vue` — clip detail (`/clips/:clipId`)
- `packages/frontend/src/pages/my-clips/index.vue` — own + favorites management (`/my/clips`)
- `packages/frontend/src/pages/user/clips.vue` — user profile tab content
- `packages/frontend/src/pages/user/index.vue` — profile tab router (`tab==='clips'`)
- `packages/frontend/src/pages/note.vue` — note detail `notes/clips` section
- `packages/frontend/src/components/MkClipPreview.vue` — clip card
- `packages/frontend/src/components/MkClipPreview.stories.impl.ts` — storybook
- `packages/frontend/src/utility/get-note-menu.ts` — `getNoteClipMenu()`, `getNoteMenu()` clip submenu + `unclip`
- `packages/frontend/src/composables/use-note.ts` — `clip()` action (`MkNote` logic)
- `packages/frontend/src/components/MkNote.vue` — footer `clipButton`, `currentClip` inject, `c` hotkey
- `packages/frontend/src/components/SkNote.vue` — Sharkey note variant, same clip wiring
- `packages/frontend/src/components/SkNoteSub.vue` — Sharkey sub-note clip wiring
- `packages/frontend/src/cache.ts` — `clipsCache`
- `packages/frontend/src/router.definition.ts` — routes
- `packages/frontend/src/navbar.ts` — `clips: { to: '/my/clips' }`
- `packages/frontend/src/server-context.ts` — SSR `clip?: Clip`
- `packages/frontend/src/utility/get-embed-code.ts` — `genEmbedCode('clips', id)`
- `packages/frontend/src/utility/copy-to-clipboard.ts` — copy URL
- `packages/frontend/src/utility/navigator.ts` — `isSupportShare()`
- `packages/frontend/src/preferences/def.ts` — `showClipButtonInNoteFooter`
- `packages/frontend/src/store.ts` — legacy same key (device, default `false`)
- `packages/frontend/src/pages/admin/roles.policy-editor.vue` — `noteEachClipsLimit` editor
- `packages/frontend/src/utility/achievements.ts` — `noteClipped1`
- `packages/frontend/src/tips.ts`, `packages/frontend/src/store.ts:205`, `packages/frontend/src/preferences/def.ts:194` — `'clips'` tip key
- `packages/frontend/.storybook/fakes.js` — `clip()` fake (story)

Locales / types:
- `locales/en-US.yml:790,793-795,834,1153,1351,1939,2146-2147,2550-2551,3430-3431`
- `packages/misskey-js/src/autogen/endpoint.ts:848-858` — 11 `clips/*` endpoints
- `packages/misskey-js/src/autogen/models.ts:37` — `Clip` entity
- Backend paramDefs read only for limits: `packages/backend/src/server/api/endpoints/clips/create.ts`, `clips/add-note.ts`

### 1.2 Route table + navigation flow

| Route | File | Auth | Params/tabs |
|---|---|---|---|
| `/clips/:clipId` | `pages/clip.vue` | public (no `loginRequired`) + SSR via `server-context.clip` | `props.clipId: string` |
| `/my/clips` | `pages/my-clips/index.vue` | `loginRequired: true` | internal `tab: 'my'\|'favorites'` (`PageWithHeader v-model:tab`, `swipable:true`) |
| `/@:acct/:page?` + `page=clips` | `pages/user/index.vue` → `pages/user/clips.vue` | public | `headerTabs[] {key:'clips', title:i18n.ts.clips, icon:'ti ti-paperclip'}` always shown (unlike `reactions` gated). `tab` is URL `:page?` param. |
| Note → clips | `pages/note.vue:25-30` | public | if `clips.length>0` renders header `i18n.ts.clip` + `MkClipPreview` list |

Navigation graph:
- `navbar.ts:126-131` `clips { title: i18n.ts.clip, icon: ti-paperclip, to: '/my/clips', show: $i!=null }` — only entry in default navbar; customizable.
- `MkClipPreview.vue:7` `<MkA to="/clips/:id">` — used in `my-clips/index.vue:16,21`, `note.vue:28`. `user/clips.vue:10` hand-rolls same link `<MkA to="/clips/:id" class="_panel _margin"><b>name</b><div description>`.
- `clip.vue:155,173` share URLs: `${url}/clips/${id}` for copy + `navigator.share`.
- Embed: `genEmbedCode('clips', id)` → `/embed/clips/:id` iframe (+ `MkEmbedCodeGenDialog` on desktop, direct copy on mobile `<500px`).
- No deep links for create/edit/delete — all `os.form`/`os.confirm`/`os.popupMenu` modals in place.

SSR:
- `server-context.ts:11` `clip?: Clip`. `clip.vue:53` `CTX_CLIP = !$i && assertServerContext(ctx,'clip') ? ctx.clip : null`. Same pattern for `user`, `note`. Logged-in always fetches via API.

### 1.3 Component breakdown

#### `pages/my-clips/index.vue` (manager)
- `PageWithHeader v-model:tab, tabs=[{my,myClips},{favorites,favorites}], swipable`.
- `MkTip k="clips": i18n.ts._clip.tip="Clip is a feature that allows you to organize your notes."`
- `my`: `MkButton primary rounded +` → `create()`; `MkPagination :paginator=Paginator('clips/list',{})` + `MkClipPreview(noUserInfo=true)`.
- `favorites`: `Paginator('clips/my-favorites',{noPaging:true})` + same preview. `noPaging` = no pagination support (single fetch).
- `headerActions=[]` (empty).

#### `pages/clip.vue` (detail)
- Layout: `_spacer 800px` → `_panel` with `.description` (`Mfm text=description :isNote=false` or `(noDescription)`), favorite heart `MkButton asLike rounded [primary if favorited]`, `favoritedCount` badge if `>0`; `.user` row `MkAvatar+MkUserName`; `MkNotesTimeline :paginator=Paginator('clips/notes',{limit:10,canSearch:true,computedParams:{clipId}}), :detail=true`.
- `provide('currentClip', clip)` — consumed by every `MkNote/SkNote` in timeline to show `Unclip` menu item.
- `headerActions` (only if `isOwned = $i && $i.id===clip.userId`):
  - `edit (ti-pencil)`: `os.form(name,{name:string label, description:string required:false multiline treatAsMfm label default, isPublic:boolean label default})` → `os.apiWithDialog('clips/update',{clipId,...result})`; `clipsCache.delete()`.
  - `share (ti-share)` only if `clip.isPublic`: popup `copyUrl / embed / native share (if isSupportShare)`.
  - `delete (ti-trash,danger)`: `os.confirm(warning, deleteAreYouSure(x=name))` → `os.apiWithDialog('clips/delete',{clipId})`; `clipsCache.delete()`.
- `definePage title=clip.name ?? i18n.ts.clip, icon=paperclip`.

#### `pages/user/clips.vue`
- Dumb list: `Paginator('users/clips',{limit:20,computedParams:{userId}})` + `MkPagination withControl`. Each item plain `_panel` with `name` + raw `description` (no MFM, no counts, no avatar — unlike `MkClipPreview`).

#### `components/MkClipPreview.vue`
- Props: `clip: Clip, noUserInfo=false`.
- Renders: `name (b)`, `description: <Mfm plain nowrap>`, `updatedAt: MkTime(lastClippedAt,detail)` if set, `notesCount: N / $i.policies.noteEachClipsLimit (remainingN(remaining))` where `remaining = policies.noteEachClipsLimit - notesCount ?? unknown`. Divider + `MkAvatar+MkUserName` unless `noUserInfo`.

#### `pages/note.vue:25-30,140-147`
- After `DynamicNoteDetailed`, if `clips?.length>0` shows `MkClipPreview` per clip.
- Fetch: only if `(appearNote.clippedCount>0 || createdAt < 2023-10-01)` → `misskeyApi('notes/clips',{noteId: appearNote.id})`. Comment: old notes didn't count `clippedCount` so force-fetch pre-2023-10-01.

#### Note-menu / footer clip entry points
- `use-note.ts:370-376 clip()`: `os.popupMenu(await getNoteClipMenu({note:rawNote,currentClip}), clipButton.value).then(focus)`.
- `MkNote.vue:154-156`: `<button v-if="prefer.s.showClipButtonInNoteFooter" ref=clipButton @mousedown.prevent=clip()><i paperclip></button>`. Same in `SkNote.vue:183`, `SkNoteSub.vue:430`. Hotkey `c` in `MkNote.vue:346-350` only if pref enabled.
- Pref: `preferences/def.ts:399-401` + `store.ts:351-354` `{where:device, default:false}`. Label `en-US:1161 showClipButtonInNoteFooter="Add \"Clip\" to note action menu"`. Otherwise clip lives under `...` menu → `Clip (ti-paperclip, type:parent, children:()=>getNoteClipMenu)` (`get-note-menu.ts:469-474`).
- `currentClip` plumbing: `clip.vue provide → MkNote.vue:244 inject('currentClip',null) → use-note options.currentClip → getNoteMenu({currentClip})`. Same in `SkNote.vue:288,754,765,780`, `SkNoteSub.vue:196`.

### 1.4 User flows step-by-step

#### A. Create clip (2 entry points, same `os.form`)
1. From `/my/clips` → `+ Add` → `my-clips/index.vue:50-77 create()`:
   `os.form(createNewClip,{name:{type:string,label:name} [required by default], description:{type:string,required:false,multiline,treatAsMfm,label}, isPublic:{type:boolean,label:public,default:false}})` → cancel aborts → `os.apiWithDialog('clips/create',result)` → `clipsCache.delete()` → `paginator.reload()`.
2. From any note `... → Clip → Create new`: `get-note-menu.ts:104-132`: same form (defaults `null`, `description multiline` but *no* `treatAsMfm` here — minor inconsistency vs other two), then `clips/create` → `clipsCache.delete()` → `claimAchievement('noteClipped1')` → immediate `os.apiWithDialog('clips/add-note',{clipId:new,noteId:appearNote.id})`.
3. Errors: `apiWithDialog` shows dialog; `TOO_MANY_CLIPS (920f7c2d-...)` surfaces if over `policies.clipLimit`. Frontend has no pre-check; `name 1-100 chars, description ≤2048` enforced backend (paramDef), frontend `os.form` only requires non-empty name.

#### B. Add note to clip
1. `... → Clip` submenu: `getNoteClipMenu()` first `await clipsCache.fetch()` (`clips/list limit:30`, TTL 30min).
2. Menu = `clips.map({text:getClipName, action}) + divider + Create new`.
   `getClipName`: own clips show `name (notesCount/policies.noteEachClipsLimit)`; others just `name`.
3. Click clip → `claimAchievement('noteClipped1')` → `os.promiseDialog(misskeyApi('clips/add-note',{clipId,noteId:appearNote.id}),null,errHandler)`:
   - `ALREADY_CLIPPED 734806c4-...`: `os.confirm(warning, confirmToUnclipAlreadyClippedNote(name))` → if confirmed `os.apiWithDialog('clips/remove-note')` + decrement cached `notesCount`.
   - `TOO_MANY_CLIP_NOTES f0dba960-...`: `os.alert(error, clipNoteLimitExceeded="No more notes can be added to this clip.")`.
   - else: `os.alert(error, message+\n+id)`.
   - success `.then`: increment cached `notesCount` for that clip.
4. Uses `getAppearNote(note) ?? note` — renotes clip the *renoted* target, not wrapper. Requires login (`$i` gate in `getNoteMenu`; logged-out menu has no clip parent).

#### C. Remove note from clip (2 variants)
1. Inside clip timeline (`/clips/:id`): note `...` menu top (if `currentClip.userId===$i.id`) shows `Unclip (ti-backspace,danger)` → `get-note-menu.ts:299-302 unclip()`: direct `os.apiWithDialog('clips/remove-note',{clipId:currentClip.id,noteId})` — **no confirm**.
2. From `Clip` submenu duplicate-add path (above): confirm-then-`remove-note` toggle. Both update `clipsCache` counts.

#### D. Edit clip (owner only, on `clip.vue`)
Header `pencil → os.form(clip.name,{name default, description default treatAsMfm, isPublic default})` → `clips/update {clipId,...result}`. Quirk: `clip.value` not patched locally; `clipsCache.delete()` only; visible change requires reload/re-fetch.

#### E. Delete clip (owner only)
Header `trash → os.confirm(warning, deleteAreYouSure(x=name))` → `os.apiWithDialog('clips/delete',{clipId})` → `clipsCache.delete()`. Quirk: **no router navigation** after delete — stays on `/clips/:id` with stale `clip.value`.

#### F. Favorite / unfavorite
- `clip.vue:17-18,88-107`: heart `MkButton`; `favorited = clip.isFavorited` after `clips/show`. `favorite()`: `clips/favorite` → `favorited=true`. `unfavorite()`: `os.confirm(warning, unfavoriteConfirm)` → `clips/unfavorite` → `favorited=false`. Count badge `favoritedCount` shown if `>0` but never locally incremented/decremented.
- List: `/my/clips tab=favorites` → `clips/my-favorites` (no paging). Scopes `read:clip-favorite / write:clip-favorite` (`en-US:2550-2551`) exist but frontend does not gate — backend enforces.

#### G. Visibility / share
- `isPublic:boolean default:false` in all three create/edit forms, label `i18n.ts.public`. No per-note visibility picker; clip itself is public/private.
- Private clips: no share header action; accessible via direct URL if you know id? (backend `clips/show` checks ownership/public; frontend just calls it).
- Public: `share → copyUrl (${url}/clips/:id) / embed (genEmbedCode) / navigator.share(title=name,text=description,url)`.

### 1.5 API usage mapping (frontend → endpoint)

| Frontend call site | Endpoint + params | Notes |
|---|---|---|
| `cache.ts:10` | `clips/list {limit:30}` | `clipsCache` TTL 30min; feeds note `Clip` submenu (truncated at 30) |
| `my-clips/index.vue:42` | `clips/list {}` via `Paginator` | own clips, paginated, `reload()` after create |
| `my-clips/index.vue:45` | `clips/my-favorites {}` `noPaging:true` | favorites tab |
| `clip.vue:61` | `clips/notes {clipId, limit:10, canSearch:true}` via `Paginator` | timeline + search |
| `clip.vue:77` | `clips/show {clipId}` on `clipId` change | + `isFavorited` → `favorited` ref; SSR seed if logged-out |
| `clip.vue:138` | `clips/update {clipId,name,description?,isPublic}` | from edit form |
| `clip.vue:194` | `clips/delete {clipId}` | after confirm |
| `clip.vue:89,102` | `clips/favorite / clips/unfavorite {clipId}` | unfav has confirm |
| `get-note-menu.ts:54,126-131,301` | `clips/add-note {clipId,noteId}` / `clips/remove-note {clipId,noteId}` | `add-note` via `promiseDialog`+custom err map; `remove-note` via `apiWithDialog` |
| `user/clips.vue:29` | `users/clips {userId, limit:20}` | public per-user list |
| `note.vue:142` | `notes/clips {noteId}` | clips containing this note; conditional |
| `MkClipPreview`, `getClipName` | reads `policies.noteEachClipsLimit`, `noteEachClipsLimit` | limits display only |

### 1.6 Notable UX quirks, validation, limits, permissions/errors

- **Limits messaging**: `MkClipPreview:13` + submenu labels show live `notesCount / policies.noteEachClipsLimit (remaining N)`. Role editor edits `noteEachClipsLimit`. No “you have X/Y clips” counter in `my-clips`; over-limit surfaces only as `TOO_MANY_CLIPS` dialog.
- **Validation**: name required (`minLength:1,maxLength:100` backend); description optional `maxLength:2048`; `isPublic` defaults `false`. Frontend `os.form` enforces non-empty name; length errors come back via `apiWithDialog` error dialog. `description` `treatAsMfm:true` in 2/3 forms (missing in note-menu create path).
- **Error IDs handled explicitly**: `734806c4-542c-463a-9311-15c512803965 ALREADY_CLIPPED → confirm-to-unclip`; `f0dba960-ff73-4615-8df4-d6ac5d9dc118 TOO_MANY_CLIP_NOTES → clipNoteLimitExceeded alert`. All other add-note errors generic `message+id`.
- **Permissions**: `isOwned` gates edit/delete header actions; `share` additionally requires `isPublic`. `Unclip` requires `currentClip.userId===$i.id`. Logged-out users get read-only detail + share/copy, no clip submenu, no `/my/clips` (loginRequired), but `/clips/:id` and profile `clips` tab remain visible.
- **Staleness quirks**: (1) edit does not patch `clip.value`; (2) delete does not navigate away; (3) favorite toggle does not update `favoritedCount`; (4) `clipsCache` 30-min TTL + `limit:30` means submenu may omit clips beyond 30 until cache deleted.
- **Optimistic counts**: add success `+1`, unclip-toggle `-1` (clamped `≥0`) on cached array only.
- **Footer clip button**: hidden by default (`showClipButtonInNoteFooter default:false`, device scope); keyboard `c` also gated on it. Tip `MkTip k=clips` shown every visit to `/my/clips`.
- **Achievement**: any successful add-note path claims `noteClipped1`.
- **Description rendering inconsistency**: `clip.vue` renders full MFM (`:isNote=false`), `MkClipPreview` renders `plain nowrap` single line, `user/clips.vue` renders raw text (no MFM).
- **Embed/share**: `EmbeddableEntity` includes `clips`; `embedRouteWithScrollbar` adds `maxHeight:700` for clips.

---

## 2. Clips — Backend (COMPLETE)

Base dir: `/Users/terezi/Local Documents/misskey`. All paths relative to repo root.

### 2.1 File inventory

**Data model / ORM**

| File | Purpose |
|---|---|
| `packages/backend/src/models/Clip.ts` | `MiClip` entity, table `clip` |
| `packages/backend/src/models/ClipNote.ts` | `MiClipNote` join entity, table `clip_note` |
| `packages/backend/src/models/ClipFavorite.ts` | `MiClipFavorite` entity, table `clip_favorite` |
| `packages/backend/src/models/json-schema/clip.ts` | `packedClipSchema` API shape |
| `packages/backend/src/models/_.ts` | Re-exports; `ClipsRepository`, `ClipNotesRepository`, `ClipFavoritesRepository` |
| `packages/backend/src/models/RepositoryModule.ts` | Nest providers `$clipsRepository`, `$clipNotesRepository`, `$clipFavoritesRepository` |
| `packages/backend/src/di-symbols.ts:63-64` | `clipsRepository`, `clipNotesRepository` symbols |
| `packages/backend/src/models/Note.ts:115` | `clippedCount smallint default 0` counter on `note` |
| `packages/backend/src/models/json-schema/note.ts:255` | `clippedCount` in packed Note |
| `packages/backend/src/models/json-schema/role.ts:271,275` | `clipLimit`, `noteEachClipsLimit` policy schema |
| `packages/backend/src/models/UserProfile.ts:336` | Achievement `'noteClipped1'` (dead string — no backend unlock found) |

**Service / pack layer**

| File | Purpose |
|---|---|
| `packages/backend/src/core/ClipService.ts` | CRUD + add/remove-note, limits, error classes |
| `packages/backend/src/core/entities/ClipEntityService.ts` | `pack` / `packMany` → `Packed<'Clip'>` |
| `packages/backend/src/core/RoleService.ts:60-61,102-103,430-431` | Policy types, `DEFAULT_POLICIES`, aggregation (`max`) |
| `packages/backend/src/core/QueueService.ts:299-312` | `createExportClipsJob(user)` → `dbQueue.add('exportClips', ...)` |
| `packages/backend/src/queue/processors/ExportClipsProcessorService.ts` | `exportClips` job: dump all clips+notes to Drive JSON + `exportCompleted` notification |
| `packages/backend/src/queue/processors/CleanRemoteNotesProcessorService.ts:99-110` | Remote-note GC guards on `clippedCount = 0` |

**API endpoints (13 total)**

| File | Endpoint |
|---|---|
| `packages/backend/src/server/api/endpoints/clips/create.ts` | `clips/create` |
| `packages/backend/src/server/api/endpoints/clips/update.ts` | `clips/update` |
| `packages/backend/src/server/api/endpoints/clips/delete.ts` | `clips/delete` |
| `packages/backend/src/server/api/endpoints/clips/list.ts` | `clips/list` (own clips, auth) |
| `packages/backend/src/server/api/endpoints/clips/show.ts` | `clips/show` |
| `packages/backend/src/server/api/endpoints/clips/notes.ts` | `clips/notes` (notes in a clip) |
| `packages/backend/src/server/api/endpoints/clips/add-note.ts` | `clips/add-note` |
| `packages/backend/src/server/api/endpoints/clips/remove-note.ts` | `clips/remove-note` |
| `packages/backend/src/server/api/endpoints/clips/favorite.ts` | `clips/favorite` |
| `packages/backend/src/server/api/endpoints/clips/unfavorite.ts` | `clips/unfavorite` |
| `packages/backend/src/server/api/endpoints/clips/my-favorites.ts` | `clips/my-favorites` |
| `packages/backend/src/server/api/endpoints/notes/clips.ts` | `notes/clips` (clips containing a note) |
| `packages/backend/src/server/api/endpoints/users/clips.ts` | `users/clips` (public clips by user) |
| `packages/backend/src/server/api/endpoints/i/export-clips.ts` | `i/export-clips` (enqueue export) |

**Web (SSR/OG)**

| File | Purpose |
|---|---|
| `packages/backend/src/server/web/ClientServerService.ts:686-710` | `GET /clips/:clip` → `ClipPage` if `isPublic`, else SPA fallback; `Cache-Control: public, max-age=15`; `preventAiLearning` → `X-Robots-Tag` |
| `packages/backend/src/server/web/ClientServerService.ts:855-874` | `GET /embed/clips/:clip` → embed HTML, **no `isPublic` check** (packs any clip by id) |
| `packages/backend/src/server/web/views/clip.tsx` | `ClipPage`: OG `article`, `og:title=name`, `og:description`, `og:url=/clips/:id`, `og:image=avatarUrl`, meta `misskey:user-username/id`, `misskey:clip-id` |

**Migrations**

| File | Change |
|---|---|
| `packages/backend/migration/1605408848373-clip-description.js` | `ADD description varchar(2048) DEFAULT null` |
| `packages/backend/migration/1607151207216-instance-pinned-clip.js` | `ADD pinnedClipId varchar(32)` — **orphaned**: zero references in `src` today. Legacy instance-pin removed. |
| `packages/backend/migration/1678953978856-clip-favorite.js` | Creates `clip_favorite` + FKs, `clip.lastClippedAt timestamptz` + index |
| `packages/backend/migration/1694915420864-clipped-count.js` | `ADD clippedCount smallint DEFAULT '0'` |

**Tests**

| File | Coverage |
|---|---|
| `packages/backend/test/e2e/clips.ts` | ~999 lines, exhaustive: create/update/delete/show/list/usersClips/favorites/add-remove/notes-visibility, limits, auth, validation. Japanese labels. Source of truth for intended semantics. |

No other hits: `grep -r Clip` in `server/api/stream`, `core/activitypub` → **zero matches**. No streaming channel, no AP handling.

### 2.2 DB schema

#### `clip` (`MiClip`)

```ts
@Entity('clip')
id: PK string (id())
lastClippedAt: timestamptz nullable, @Index()
userId: id(), @Index(), FK → user.id ON DELETE CASCADE
name: varchar(128) NOT NULL
isPublic: boolean NOT NULL DEFAULT false
description: varchar(2048) nullable
```

- No `createdAt` column — API `createdAt` is `IdService.parse(clip.id).date`.
- No `userHost` / remote flag; implicitly local-only (only `MiLocalUser` can create; no federation path).
- No counts stored; `favoritedCount`/`notesCount` computed live in pack.
- Pagination via `QueryService.makePaginationQuery` on `clip.id`.

#### `clip_note` (`MiClipNote`)

```ts
@Entity('clip_note')
@Index(['noteId','clipId'], {unique:true})
id: PK string
noteId: id(), @Index(), FK → note.id ON DELETE CASCADE
clipId: id(), @Index(), FK → clip.id ON DELETE CASCADE
```

- Pure join, no timestamps.
- Unique prevents double-add; violation → `AlreadyAddedError` via `isDuplicateKeyValueError`.
- No trigger maintains `note.clippedCount` on cascade-delete — count goes stale.

#### `clip_favorite` (`MiClipFavorite`)

```ts
@Entity('clip_favorite')
@Index(['userId','clipId'], {unique:true})
id: PK string
userId: id(), @Index(), FK → user.id ON DELETE CASCADE
clipId: id(), FK → clip.id ON DELETE CASCADE
```

- No `createdAt` in entity; `pack` never returns it.
- Unique `(userId, clipId)`; duplicate checked pre-insert via `exists()`.
- Cascade on user/clip delete.

#### `note.clippedCount` (`Note.ts:112-115`)

`smallint default 0`. Incremented/decremented in `ClipService.addNote/removeNote`. Read in `NoteEntityService.pack` and `CleanRemoteNotesProcessorService` (remote GC skips `clippedCount != 0`). Purely application-maintained.

#### Role policies (`RoleService.ts:102-103`)

```ts
clipLimit: 10,          // max clips per user
noteEachClipsLimit: 200 // max notes per single clip
```

Aggregation `Math.max` across roles, most permissive wins. Exposed as `noteEachClipsLimit`, `clipLimit`.

### 2.3 API endpoints

Convention: `format: misskey:id` validation; `requireCredential:false` passes `me=null` when unauthenticated; `kind` = token scope; `prohibitMoved:true` on all mutating clip endpoints → moved accounts rejected.

#### `clips/create`
- `requireCredential:true`, `prohibitMoved:true`, `kind:'write:account'`, res `Clip`.
- `paramDef`: `name 1..100 required`, `isPublic default false`, `description nullable max 2048 optional`.
- Flow: `ps.description || null` → `ClipService.create(me, name, isPublic, desc)` → `pack(clip, me)`.
- Errors: `TOO_MANY_CLIPS (920f7c2d-...)` when `count >= clipLimit`.
- E2E asserts fresh clip has `createdAt=ISO`, `lastClippedAt=null`, `description=null`, `isPublic=false`, `favoritedCount=0`, `isFavorited=false`; rejects `name>100`, `description>2049`, non-bool `isPublic`.

#### `clips/update`
- `requireCredential:true`, `prohibitMoved:true`, `kind:'write:account'`, res `Clip`.
- `paramDef`: `clipId required`, `name 1..100 optional`, `isPublic optional`, `description nullable max2048 optional`.
- Flow: `ClipService.update(me, clipId, ...)`; `NoSuchClipError` → `NO_SUCH_CLIP (b4d92d70-...)`; then `pack(clipId, me)`.
- Ownership: `findOneBy({id, userId:me.id})`; others' → `NO_SUCH_CLIP` (no leakage).
- **Quirk**: omitted `description` becomes `null` (`undefined || null`), so name-only update **wipes description**. `name`/`isPublic` omitted pass `undefined` into `repository.update` — relies on TypeORM ignoring `undefined`.

#### `clips/delete`
- `requireCredential:true`, `kind:'write:account'` (no `prohibitMoved` — inconsistent), no res (204).
- Flow: `ClipService.delete` → `findOneBy({id,userId})` else `NO_SUCH_CLIP (70ca08ba-...)` → `delete(clip.id)`. Cascades to joins/favorites. Does **not** decrement `note.clippedCount` → stale counts.

#### `clips/list`
- `requireCredential:true`, `kind:'read:account'`, res `Clip[]`.
- `paramDef`: `limit 1..100 default 10`, `sinceId/untilId/sinceDate/untilDate`.
- Flow: `makePaginationQuery(...).andWhere('clip.userId = :userId', me.id)` → `packMany`. Own clips including private, newest-first.

#### `clips/show`
- `requireCredential:false`, `kind:'read:account'`, res `Clip`.
- Flow: `findOneBy({id})` else `NO_SUCH_CLIP (c3c5fe33-...)`; if `!isPublic && (me==null || userId!=me.id)` → same error. Then `pack(clip, me)`.
- No blocking/mute/suspend checks — only owner gate.

#### `clips/notes` — most complex read
- `requireCredential:false`, `kind:'read:account'`, res `Note[]`.
- `paramDef`: `clipId required`, `limit 1..100 default 10`, pagination, `search 1..100 nullable`.
- Flow: load clip + private-gate (`NO_SUCH_CLIP 1d7645e6-...`); `innerJoin clipNote`, `innerJoinAndSelect user`, `leftJoin reply/renote`; `generateVisibilityQuery(query, me)`; `generateBlockedHostQueryForNote` always; muted/blocked filters only when `me`; optional `search`: split on space, each `AND (text ILIKE %w% OR cw ILIKE %w%)` with `sqlLikeEscape`; `limit.getMany()` → `packMany`.
- E2E: private rejects anon/other; own private notes visible to owner; others' `home` visible but `followers/specified` filtered; anon sees only public+home. Suspended-user filter commented out.

#### `clips/add-note`
- `requireCredential:true`, `prohibitMoved:true`, `kind:'write:account'`, rate limit `20/hour`.
- `paramDef`: `clipId, noteId` required.
- Service: (1) owner lookup else `NoSuchClipError`; (2) `countBy({clipId}) >= noteEachClipsLimit` → `TooManyClipNotesError`; (3) `insert({id:gen(), noteId, clipId})` — duplicate → `AlreadyAddedError`; FK-missing-note via substring `'is not present in table "note".'` → `NoSuchNoteError`; (4) fire-and-forget `update lastClippedAt`, `increment clippedCount`.
- Maps to `NO_SUCH_CLIP (d6e76cc0-...)`, `NO_SUCH_NOTE (fc8c0b49-...)`, `ALREADY_CLIPPED (734806c4-...)`, `TOO_MANY_CLIP_NOTES (f0dba960-...)`.
- **No visibility/ownership check on note at write**: e2e asserts you can clip others' `home/followers/specified`; filtering at read.

#### `clips/remove-note`
- `requireCredential:true`, `prohibitMoved:true`, `kind:'write:account'`.
- Flow: owner-gate else `NO_SUCH_CLIP (b80525c6-...)`; `delete({noteId, clipId})`; `affected===0` → `NO_SUCH_NOTE (aff017de-...)`. Else fire-and-forget `decrement clippedCount`.
- E2E verifies failed remove does **not** decrement.

#### `clips/favorite`
- `requireCredential:true`, `prohibitMoved:true`, `kind:'write:clip-favorite'`.
- Flow: `findOneBy({id})` else `NO_SUCH_CLIP (4c2aaeae-...)`; if `clip.userId!=me.id && !isPublic` → same error; `exists` → `ALREADY_FAVORITED (92658936-...)`; else `insert`.
- No block/mute/suspend check.

#### `clips/unfavorite`
- Same auth/kind. Flow: load clip (no private gate — only `NO_SUCH_CLIP 2603966e-...` if missing); `findOneBy({clipId,userId})` else `NOT_FAVORITED (90c3a9e8-...)`; `delete`. Asymmetry: unfavorite on now-private clip still works.

#### `clips/my-favorites`
- `requireCredential:true`, `kind:'read:clip-favorite'`, res `Clip[]`, **no params, no pagination**.
- Flow: `QB where userId=me.id leftJoinAndSelect clip` → `packMany`. Includes private clips; no re-check of current `isPublic`. E2E confirms 21 favorites returned at once.

#### `notes/clips`
- `requireCredential:false`, **no `kind`**, res `Clip[]`.
- `paramDef`: `noteId required`.
- Flow: `GetterService.getNote` (throws `9725d0ce-...` → `NO_SUCH_NOTE 47db1a1c-...`); `findBy({noteId})`; `findBy({id:In(...), isPublic:true})` → `packMany`. **Only public clips ever returned**. No pagination.

#### `users/clips`
- Public, no `kind`, desc `Show all clips this user owns.` (misleading — only public).
- `paramDef`: `userId required`, pagination `limit 1..100 default 10`.
- Flow: `makePaginationQuery(...).andWhere(userId).andWhere(isPublic=true)` → `packMany`. **Always public-only, even owner** (e2e asserts own private excluded; owner must use `clips/list`).

#### `i/export-clips`
- `secure:true, requireCredential:true`, rate limit `1/day`.
- Flow: `queueService.createExportClipsJob(me)` (fire-and-forget) → empty response. Progress via Bull % + notification.

### 2.4 Service layer

`ClipService` (`core/ClipService.ts:17-156`): error classes `NoSuchNoteError`, `NoSuchClipError`, `AlreadyAddedError`, `TooManyClipNotesError`, `TooManyClipsError` — mapped per-endpoint to `ApiError` with distinct UUIDs.

- `create(me: MiLocalUser, name, isPublic, description)`: `countBy({userId}) >= clipLimit` → `TooManyClipsError` (TOCTOU raceable); `insertOne` return row.
- `update(me, clipId, ...)`: owner lookup; `update(clip.id, {name, description, isPublic})` — no `lastClippedAt` touch.
- `delete(me, clipId)`: owner lookup; `delete`. FK cascades clear joins/favorites. No counter fixup.
- `addNote`/`removeNote`: as above. `lastClippedAt` + `clippedCount` un-awaited (floating promises).

`ClipEntityService.pack`:

```ts
id, createdAt=parse(id).date, lastClippedAt?.toISOString() ?? null,
userId, user=hint ?? pack(userId), name, description, isPublic,
favoritedCount=countBy({clipId}),
isFavorited=meId ? exists(...) : undefined,   // omitted when anon
notesCount=meId===userId ? countBy(...) : undefined  // owner-only!
```

- `packMany` batches user packs but counts still N+1 (×2 per clip).
- `notesCount` hidden from non-owners (even public) — outsiders page `clips/notes` to learn size.
- `isFavorited` omitted (not `false`) for anon — e2e asserts `'isFavorited' in clip === false`.

### 2.5 Visibility / auth / limits / pagination

**Visibility matrix**

| Endpoint | Private clip visible to |
|---|---|
| `clips/show`, `clips/notes` | owner only (`NO_SUCH_CLIP` otherwise) |
| `clips/favorite` | owner + anyone if `isPublic` |
| `users/clips`, `notes/clips` | public only, always (even owner via `users/clips`) |
| `clips/list` | owner only, includes private |
| `/clips/:clip` web | `isPublic` only; else SPA shell |
| `/embed/clips/:clip` | **any id, no gate** |

Note-content visibility inside `clips/notes` is per-note (`generateVisibilityQuery` + muted/blocked + blocked-host), independent of clip visibility. Write path imposes no note-visibility check.

**Auth / scopes (`kind`)**
- `write:account`: create/update/delete/add-note/remove-note.
- `read:account`: list/show/notes.
- `write:clip-favorite` / `read:clip-favorite`: favorite/unfavorite/my-favorites.
- `notes/clips`, `users/clips`: no `kind` (public).
- `prohibitMoved:true` on create/update/favorite/unfavorite/add-note/remove-note (delete missing it).
- Rate limits: `add-note 20/hr`; `i/export-clips 1/day`.

**Limits (role policies)**
- `clipLimit` default 10, `noteEachClipsLimit` default 200. Count-then-insert (raceable). E2E pins defaults.
- API caps: `name 1..100`, `description ≤2048 nullable`, `limit 1..100 default 10`, `search 1..100`.
- `my-favorites`, `notes/clips` have **no pagination** — unbounded.

**Pagination:** `clips/list`, `users/clips` on `clip.id` via `makePaginationQuery`; `clips/notes` on `note.id` (not join-row id). `my-favorites`/`notes/clips` unordered.

### 2.6 Federation, blocking/muting, jobs, notifications

- **Federation: none.** Zero AP code mentions Clip. Local-only; remote notes can be *contained* by id but clip object never leaves except via public HTML/export JSON. No `Delete`/`Create` AP activities.
- **Blocking/muting**: only honored inside `clips/notes` read (muted/blocked + renote columns + blocked hosts). CRUD, favorite, show, list, users/notes listings ignore blocks/mutes/suspensions.
- **Background jobs**:
  - `exportClips`: cursor-paginated (100/batch, `id ASC`), progress `exported/total`. Per clip `serializeClip`, per note visibility re-checked as owner + `makeNotesHiddenBefore` skip + poll fetch. Output `clips-YYYY-MM-DD-HH-mm-ss.json` via Drive + `exportCompleted` notification. Temp file cleanup in `finally`.
  - `CleanRemoteNotesProcessorService`: protects `clippedCount != 0` from remote GC. Stale positive count can pin remote note forever; crash between insert and increment can leave zero with live joins.
- **Notifications/achievements**: no `noteClipped` notification; `'noteClipped1'` in `UserProfile` unreferenced by backend — dead/aspirational.
- **Account deletion**: no explicit clip handling; relies on `user.id ON DELETE CASCADE` on physical delete.

### 2.7 Notable quirks (for porting)

1. **`clips/update` clears description when omitted** (`ps.description || null`; absent → `null`). Name-only update wipes description. `''` → `null` by design (comment `空文字列をnullにしたいので??は使わない`).
2. **`update` passes `undefined` for omitted `name`/`isPublic`** — depends on TypeORM ignoring `undefined`; naive port writing `NULL` would corrupt.
3. **Write allows clipping anything by id** — only clip ownership + note existence checked (FK message sniff). Any guessed id — including others' `followers/specified`, remote notes — can be added. Read filters. E2E documents as intended (`他人の非公開ノートも突っ込める`).
4. **Counters best-effort** — `lastClippedAt`, `clippedCount ±1` un-awaited; `delete clip` and cascades never adjust `clippedCount`. `CleanRemoteNotes` trusts counter.
5. **Asymmetric favorite gates** — `favorite` enforces public-or-owner; `unfavorite` doesn't. `my-favorites` returns without re-checking `isPublic`.
6. **`users/clips` never shows private, even to owner** — owner uses `clips/list`. `notes/clips` likewise public-only.
7. **`notesCount` owner-only; `isFavorited` auth-only** — public can't get size except paging; anon gets no `isFavorited` key.
8. **`notes/clips` / `my-favorites` no pagination** — unbounded; `clips/notes` search is `ILIKE %word%` per word (no FTS).
9. **Limit checks race** — `countBy >= limit` then insert; concurrent can exceed. Only unique indexes race-safe.
10. **Embed leaks private clips** — `/embed/clips/:clip` packs without `isPublic` check (vs `/clips/:clip` gated). Security-by-obscurity on id.
11. **Orphaned `meta.pinnedClipId`** — column likely in DB but unread — safe to ignore unless reviving instance-pinned clips.
12. **No events/streaming** — create/update/delete/add/remove/favorite emit no timeline/stream/global events. Clients must poll.
13. **`prohibitMoved` missing on `clips/delete`** — moved-account token can still delete.

## 3. Pages — Frontend (COMPLETE)

Repo: `/Users/terezi/Local Documents/misskey` (Sharkey fork). Scope: `packages/frontend/src/**` only. Request/response shapes from `packages/misskey-js/src/autogen/types.ts`.

### 3.1 File paths consulted

**Routing / navigation:**
- `packages/frontend/src/router.definition.ts` — lines 32-33, 324-334
- `packages/frontend/src/router.ts` — `createRouter()`, `mainRouter`, `useRouter()`
- `packages/frontend/src/lib/nirax.ts` — `Nirax` impl, `parsePath()`, wildcard `(*)`, `loginRequired` handling, `buildFullPath()` (`encodeURIComponent`), `safeURIDecode`
- `packages/frontend/src/navbar.ts` — `pages: { to: '/pages' }`
- `packages/frontend/src/filters/user.ts` — `userPage(user, path?)`
- `packages/frontend/src/components/MkPageWindow.vue` — generic popup window (not Pages-specific, but Pages render inside it)
- `packages/frontend/src/page.ts` — `definePage()` metadata (`title/avatar/path/share`)

**Viewer (public read path):**
- `packages/frontend/src/pages/page.vue` — `@:username/pages/:pageName(*)` viewer
- `packages/frontend/src/components/page/page.vue` — root renderer (`alignCenter`/`serif`)
- `packages/frontend/src/components/page/page.block.vue` — block dispatcher
- `packages/frontend/src/components/page/page.text.vue` — `text` renderer (MFM + URL preview)
- `packages/frontend/src/components/page/page.section.vue` — `section` renderer (recursive `h+1`)
- `packages/frontend/src/components/page/page.image.vue` — `image` renderer (from `page.attachedFiles`)
- `packages/frontend/src/components/page/page.note.vue` — `note` renderer (`notes/show`)
- `packages/frontend/src/components/page/page.dynamic.vue` — placeholder for abolished dynamic blocks
- `packages/frontend/src/components/MkPagePreview.vue` — card used in all lists

**Lists / entry points:**
- `packages/frontend/src/pages/pages.vue` — `/pages` index (featured/my/liked tabs)
- `packages/frontend/src/pages/user/index.vue` — profile `pages` tab
- `packages/frontend/src/pages/user/pages.vue` — profile tab content (`users/pages`)
- `packages/frontend/src/pages/user/home.vue` — confirms NO pinned-page render (only `pinnedNotes`)

**Editor:**
- `packages/frontend/src/pages/page-editor/page-editor.vue` — `/pages/new`, `/pages/edit/:initPageId`
- `packages/frontend/src/pages/page-editor/page-editor.blocks.vue` — `MkDraggable` list
- `packages/frontend/src/pages/page-editor/page-editor.container.vue` — block chrome
- `packages/frontend/src/pages/page-editor/els/page-editor.el.text.vue`
- `packages/frontend/src/pages/page-editor/els/page-editor.el.section.vue`
- `packages/frontend/src/pages/page-editor/els/page-editor.el.image.vue`
- `packages/frontend/src/pages/page-editor/els/page-editor.el.note.vue`
- `packages/frontend/src/pages/page-editor/common.ts` — `getPageBlockList()` (4 items only)

**State / utilities / types:**
- `packages/frontend/src/utility/paginator.ts` — `Paginator` class
- `packages/frontend/src/utility/misskey-api.js` + `os.ts` — `apiWithDialog()`, `confirm()`, `select()`, `inputText()`, `post()`, `popupMenu()`
- `packages/frontend/src/utility/drive.ts` — `selectFile()`, `chooseDriveFile()`
- `packages/frontend/src/utility/copy-to-clipboard.ts`, `utility/navigator.js` (`isSupportShare`), `utility/collect-page-vars.ts` (`collectPageVars` — **dead code, zero imports**), `utility/extract-url-from-mfm.js`, `utility/url-preview.js`, `utility/media-proxy.js`, `plugin.ts` (`page_view_interruptor`), `components/MkDraggable.vue`, `types/page-header.ts`
- `packages/misskey-js/src/autogen/types.ts` — `Page` (4963-4991), `PageBlock` (4992-5014), `pages___create/update/show/like/unlike/featured/delete`, `i___pages`, `i___page-likes`, `users___pages`
- `locales/en-US.yml` — `_pages:` strings (2796-2844)
- `packages/frontend/src/utility/autocomplete.js` — used in text block

**Explicitly absent:** no `ui/deck/*pages*` (no Deck column); no search UI; no visibility UI (schema has no `visibility`); `sk-static-pages.ts` unrelated; `MkPageWindow.vue` generic windowing.

### 3.2 Route table + navigation flow

| Path | Component | `loginRequired` | Props |
|---|---|---|---|
| `/@:username/pages/:pageName(*)` | `pages/page.vue` | no (public) | `username`, `pageName` (wildcard rest, `/`-joined) |
| `/pages` | `pages/pages.vue` | no | none |
| `/pages/new` | `page-editor.vue` | **yes** | none |
| `/pages/edit/:initPageId` | `page-editor.vue` | **yes** | `initPageId` |
| `/@:acct/:page?` (`name: 'user'`) | `user/index.vue` | no | `acct`, `page` — child tab `pages` → `user/pages.vue` |

Order matters: `/@:username/pages/:pageName(*)` declared **before** generic `/@:acct/:page?`, so `/@a/pages/foo` hits viewer, not profile.

Nirax details (`lib/nirax.ts`): `:pageName(*)` wildcard → `parts.join('/')` after `safeURIDecode`; `encodeURIComponent` on push. No query/hash mapping. `loginRequired` in `navigate()`: if logged-out, swaps to `notFoundPageComponent` + `showLoginPopup` (not redirect). Catch-all `/:(*)` → `not-found.vue`.

`page.vue` prop flow: `defineProps<{pageName, username}>()`, `path = username + '/' + pageName`, `watch(path, fetchPage, {immediate:true})`. `definePage()` sets header `title`, `avatar: page.user`, `path: /@${username}/pages/${name}`, `share`.

Navigation graph:
- Navbar: `Pages (ti-news) → /pages` — always visible.
- `/pages`: header `+` → `router.push('/pages/new')`. Cards (`MkPagePreview`) are `MkA :to="/@${user.username}/pages/${page.name}"`.
- Profile → tab `pages` → `user/pages.vue` → same preview links.
- Viewer: two pencils (banner + action row) only if `page.userId === $i?.id` → `/pages/edit/${page.id}`. `...` menu (if `$i`) → `router.push('/pages/edit/:initPageId')`. Editor `View your Pages` (only if `pageId && author`) → `/@${author.username}/pages/${currentName}` (last-saved name, not live input).
- Editor after create: `mainRouter.replace('/pages/edit/:initPageId')` (back skips `/pages/new`). After duplicate: `push` (back returns to source). After delete: `replace('/pages')`.
- Popup windows: isolated `createRouter(initialPath)`, Pages open correctly in detached windows.

### 3.3 Component breakdown + block types

#### Viewer stack

- `page.vue`: `<div :class="{ center: alignCenter, serif: font==='serif' }">` + `<XBlock v-for="child in page.content" :h="2">`. Only modifiers: `alignCenter`, `font`. `hideTitleWhenPinned` saved but **never read** by viewer.
- `page.block.vue` dispatcher:

| `block.type` | Viewer | Notes |
|---|---|---|
| `text` | `page.text.vue` | `Mfm :text isNote=false` + `MkUrlPreview` per URL via `mfm.parse` + `extractUrlFromMfm`, gated by `isEnabledUrlPreview` |
| `section` | `page.section.vue` | `<h2>` at `h=2`, recurses `h+1`; CSS `h2/h3/h4` only |
| `image` | `page.image.vue` | `page.attachedFiles.find(fileId)` → `MkMediaList`; missing → empty bordered box, no error |
| `note` | `page.note.vue` | `notes/show {noteId}` on mount → `MkNote` or `MkNoteDetailed` by `detailed`. Null → empty box |
| `button/if/textarea/post/canvas/numberInput/textInput/switch/radioButton/counter` | `page.dynamic.vue` | All map to placeholder: dice icon + `_pages.blocks.dynamic` + “abolished, use Play” + link to `/play`. Legacy AiScript blocks **render-dead** |

Backend type confirms only 4 live block shapes. Locale still ships strings for abolished blocks but editor no longer offers them.

- Viewer chrome: banner (eye-catch or instance banner blurred 20% + gradient, or `accentedBg` fallback), `<h1>{{ title || name }}</h1>`, author avatar/name, like/unlike + count, copy-link/share/`...`, author card (follow button commented out), created/updated times, ad (`MkAd horizontal`), “recent posts” (`users/pages` paginator `limit: 6`, same `userId`, as `MkPagePreview`).

#### Editor stack

- `page-editor.vue`: `PageWithHeader` tabs (`settings` default, `contents`). Actions: `View your Pages` (routerLink, if saved), `Save` (primary, hidden if `readonly`), `Duplicate` (if `pageId`), `Delete` (danger, if `pageId && !readonly`). Settings: `MkInput title/summary/name` (prefix `@{url}/@${author}/pages/`), `MkSwitch alignCenter`, `MkSelect font`, `MkSwitch hideTitleWhenPinned`, eye-catch block (Drive picker → preview + remove). Contents: `XBlocks v-model="content"` + round `+`.
- `page-editor.blocks.vue`: `MkDraggable v-model direction=vertical withGaps canNest manualDragStart group="pageBlocks"`. `getComponent(type)`: `section/text/image/note`, default `XText`. Immutable splice by `id`.
- `page-editor.container.vue`: card chrome — header/func slots, trash (`removable`), drag handle (`manualDragStart`), collapse chevron.
- `common.ts:getPageBlockList()`: exactly 4 entries (`section/text/image/note`). `page-editor.vue:add()` and `section.el:add()` duplicate same 4-branch creation (marked `TODO: 共通化`).
- `el.text.vue`: `XContainer` + `<textarea v-model="text">` (min-height 150px). `Autocomplete` on mount, `detach()` on unmount.
- `el.section.vue`: header shows `modelValue.title`. Pencil → `os.inputText`. Body: nested async `XBlocks v-model="children"` + `+`. `children = ref(deepClone(...))` + deep watcher. `onMounted`: if `title == null`, prompts rename. Recursive unbounded nesting; shared drag group so blocks drag across levels.
- `el.image.vue`: header + folder button. `MkDriveFileThumbnail fit=contain` (click re-opens picker). `onMounted`: if `fileId == null`, auto-opens `chooseDriveFile({multiple:false})`; else `drive/files/show`. Cancel leaves `fileId: null` block (no auto-remove).
- `el.note.vue`: `MkInput v-model="id"` (label `Note ID`, caption “paste URL OK”) + `MkSwitch detailed` (mutates prop directly) + live preview. `watch(id, immediate:true)`: strips trailing `/`, takes last segment if `http(s)://`; emits `update:modelValue({note: id})` + `notes/show`. Invalid/deleted → `null`, preview silently disappears.

#### Preview / list card

`MkPagePreview.vue`: `MkA :to="/@${user.username}/pages/${page.name}"` wrapping optional 200px eye-catch + `<article>` (title, summary truncated 85 chars + `…`, footer avatar + name). No like count/date/menu. Used by `pages.vue` (all tabs), `page.vue` related, `user/pages.vue`.

#### Plugin hook

`page.vue:152-160`: after `pages/show`, runs `getPluginHandlers('page_view_interruptor')` sequentially, `deepClone`-ing page. Registered via `Plugin:register:page_view_interruptor` (`plugin.ts:434`). Same pattern as notes.

### 3.4 Editor behavior step-by-step

1. **Entry.** `/pages/new` vs `/pages/edit/:initPageId`. Props also declare `initPageName`/`initUser` → `readonly=true`, but **no route passes them** (dead path; `readonly` always `false`). `provide('readonly', readonly.value)` provides raw boolean, never `inject`d — no read-only mode reachable.
2. **Init.** If `initPageId`: `pages/show {pageId}`. Else new: `content = [{id: genId(), type:'text', text:'Hello World!'}]`. If loaded: copies `author/user, pageId, title, name, currentName=name, summary, font, hideTitleWhenPinned, alignCenter, content (by reference), eyeCatchingImageId` (watcher → `drive/files/show`). Errors leave blank form with no error UI — no catch, unhandled rejection.
3. **Settings.** Local refs; nothing autosaves. `name` defaults to `Date.now().toString()` (numeric slug avoids collision). `title` trimmed on save; `summary` as-is; `font` via `useMkSelect`.
4. **Content.** `+` → `os.select({title: chooseBlock, items: getPageBlockList()})` → pushes skeleton (`text:''`, `title:''+children:[]`, `fileId:null`, `note:null+detailed:false`). Reorder via drag handle only; collapsible; trash removes immediately (no confirm). Section children own `+` with same picker. Textarea has MFM autocomplete; image auto-prompts file; note live-previews.
5. **Eye-catch.** `setEyeCatchingImage` → `selectFile({multiple:false})` (upload/from Drive/from URL) → sets ID. Watcher fetches `DriveFile` for preview. `removeEyeCatchingImage()` nulls ID.
6. **Save.** `getSaveOptions()` = `{title: trim, name: trim, summary, font, script:'', hideTitleWhenPinned, alignCenter, content, variables:[], eyeCatchingImageId}` — `script ''`, `variables []` hardcoded (AiScript removed; `collectPageVars.ts` orphaned). If `pageId`: `pages/update {pageId, ...}` with error map `2298a392-… → nameAlreadyExists` → `currentName = trim(name)`. Else `pages/create` with `4650348e-… → same` → `pageId/currentName`, `replace('/pages/edit/:initPageId')`.
7. **Duplicate.** Prefixes `title + ' - copy'`, `name + '-copy'` in local state, then `pages/create`, then `push('/pages/edit/:initPageId')`. No confirm; mutates form before create (on collision failure, form retains suffixed values).
8. **Delete.** `os.confirm({type: warning, text: removeAreYouSure(title.trim)})` → `pages/delete {pageId}` → `replace('/pages')`. No undo.
9. **Validation.** Only duplicate-name mapped to friendly text. All other failures (`INVALID_PARAM`, `ROLE_PERMISSION_DENIED`, `RATE_LIMIT`, etc.) generic `apiWithDialog` mapping. `invalidNameTitle/Text` locale strings **never referenced** in frontend.

### 3.5 API usage mapping

All via `misskeyApi` or `os.apiWithDialog`. No Vuex/Pinia; lists use `Paginator`.

| UI location | Action | Endpoint + params |
|---|---|---|
| `page.vue:fetchPage` | Open `/@u/pages/n` | `pages/show {name, username}` |
| `page-editor:init` | Open `/pages/edit/:id` | `pages/show {pageId}` |
| `page-editor:save` (new) | Save | `pages/create {title(trim), name(trim), summary, font, script:'', hideTitleWhenPinned, alignCenter, content, variables:[], eyeCatchingImageId}` |
| `page-editor:save` (edit) | Save | `pages/update {pageId, ...same}` |
| `page-editor:duplicate` | Duplicate | `pages/create {...getSaveOptions()}` (title/name pre-suffixed) |
| `page-editor:del` + `page.vue:showMenu` (mod) | Delete | `pages/delete {pageId}` |
| `page.vue:like/unlike` | Like/Unlike | `pages/like {pageId}` / `pages/unlike {pageId}` — optimistic flip + `likedCount++/--`; unlike has `os.confirm(unlikeConfirm)` |
| `page.vue:pin` | Pin/Unpin (owner `...`) | `i/update {pinnedPageId: pageId \| null}` (account setting, not Pages endpoint) |
| `pages.vue` featured | `/pages` tab | `pages/featured {noPaging:true}` (single fetch) |
| `pages.vue` my | `/pages` tab | `i/pages {limit:5}` (auth, paginated) |
| `pages.vue` liked | `/pages` tab | `i/page-likes {limit:5}` → items `{id, page}`, rendered as `like.page` |
| `page.vue` related | Viewer bottom | `users/pages {userId: page.user.id, limit:6}` (reactive `computedParams`) |
| `user/pages.vue` | Profile tab | `users/pages {userId, limit:20}` with `withControl` |
| editor image preview + `el.image` | Thumbnails | `drive/files/show {fileId}` |
| `el.note` edit + `page.note` view | Embed note | `notes/show {noteId}` |
| `page.vue:reportAbuse` | `...` → Report (non-owner) | `MkAbuseReportWindow {user: page.user, initialComment: 'Page: {url}/@{u}/pages/{n}\n-----\n'}` (user-report, not page-report) |

`Paginator`: `limit` as above, `sinceId/untilId` paging; `featured` uses `noPaging:true`.

### 3.6 Quirks, validation, limits, permissions, errors

- **No visibility / no federation.** No `visibility` in schema or editor. All Pages public-by-design; no draft state. No search UI.
- **No live preview / WYSIWYG.** Contents tab shows block editors only; must click `View your Pages` for rendered output. `viewSource`/`inspector`/`variables` locale strings vestigial.
- **Only 4 block types.** Legacy AiScript blocks render as `dynamic` placeholder linking to `/play`. `contentBlocks/inputBlocks/specialBlocks/selectType` locale keys dead.
- **`hideTitleWhenPinned` write-only** — saved/loaded but never consumed (profile doesn't render `pinnedPage` in this fork — only `page.vue` pin toggle + storybook fakes). Pinning updates `i/update` but has no visible surface except `Unpin` label toggle.
- **Owner vs visitor.** Pencils only for owner (`page.userId === $i?.id`); owner `...` = Edit + Pin/Unpin only (no Delete — editor only). Non-owner logged-in: Report + (if mod/admin) divider + Delete (`deleteConfirm`). Logged-out: no `...`, but like buttons render (click fails 401 dialog).
- **Sharing.** Banner + action-row share → `os.popupMenu`: `Share with Note` (always; `os.post({initialText: '{title or name}\n{canonical URL}', instant:true})`) + native `Share` (only if `isSupportShare()`). `Copy Link` copies `${url}/@${username}/pages/${name}` + toast. Canonical uses live `page.user.username`/`page.name`, not route params.
- **URL edge cases.** Wildcard preserves slashes; viewer refetches on param change. `copyLink`/share don't encode. Backend `name` uniqueness per-user (friendly error via `4650348e-…` create / `2298a392-…` update). `invalidNameTitle/Text` never shown.
- **Duplicate naming** appends ` - copy` / `-copy` blindly (can chain `-copy-copy`); on collision dialog shows `nameAlreadyExists` but form retains suffixes.
- **Note-embed parsing** accepts ID or URL (strips trailing `/`, last segment). Garbage → `notes/show` 400 unhandled, preview blank. `detailed` mutates prop directly; preview keyed `note.id + ':normal/:detail'`.
- **Image-embed fragility.** Viewer resolves `fileId` against `page.attachedFiles`; deleted/unattached → empty bordered box, no placeholder. Editor resolves via separate `drive/files/show`; cancel of auto-picker leaves empty block.
- **Text block** plain `<textarea>` (no toolbar/preview); autocomplete mentions/emojis only. Viewer MFM `isNote=false` + per-URL `MkUrlPreview` (user setting-gated).
- **Drag-drop.** `MkDraggable group="pageBlocks"` shared across nesting: blocks draggable into/out of sections (`canNest`, 30px zones), vertical reorder with accent line. Handle-only start; no keyboard reorder; no undo.
- **No caching.** Each viewer fetch independent `misskeyApi`; related paginator `computedParams` keyed to loaded `page.user.id`. Per-tab `Paginator` instances, no shared store.
- **Error surfaces.** Viewer: `MkError @retry="fetchPage()"` on `show` failure; `MkLoading` otherwise (125ms fade). Editor init failures silent (no catch). Save/duplicate/delete/like/unlike via `apiWithDialog`. `unlike` + editor `delete` require `os.confirm(warning)`; `like` does not.
- **Permissions.** `/pages/new|edit` login-required (else not-found + login popup). Viewer/lists public. Edit affordances check `$i.id === page.userId` client-side; true authz backend (`ROLE_PERMISSION_DENIED` → generic dialog). Moderator delete in viewer menu only role-gated UI (`isModerator || isAdmin`).
- **Legacy vs current.** Single `packages/frontend` SPA (`universal/deck/zen/...` shells share routes). AiScript Pages removed: editor hard-codes `script:''`, `variables:[]`; `collect-page-vars.ts` orphaned; old blocks render deprecation placeholder → Play. `MkPageWindow` name coincidental (generic window).
- **Limits in frontend.** Summary preview truncated 85 chars in cards only. `i/pages`/`i/page-likes` paginate at 5, `users/pages` at 6 (related) / 20 (profile), `featured` unpaged. No client-side length caps — server-side (`INVALID_PARAM` → generic dialog).

## 4. Pages — Backend (COMPLETE)

All paths relative to `/Users/terezi/Local Documents/misskey/` (`packages/backend/...`).

### 4.1 File paths consulted

**Data model / ORM:**
- `packages/backend/src/models/Page.ts` — `MiPage` entity + `pageNameSchema`
- `packages/backend/src/models/PageLike.ts` — `MiPageLike` entity
- `packages/backend/src/models/_.ts` — `PagesRepository`, `PageLikesRepository` type exports
- `packages/backend/src/models/RepositoryModule.ts` — DI providers `$pagesRepository`, `$pageLikesRepository`
- `packages/backend/src/models/UserProfile.ts` — `pinnedPageId` / `pinnedPage` relation
- `packages/backend/src/models/Note.ts` — `pageCount` column (referenced-note counter)
- `packages/backend/src/models/json-schema/page.ts` — `packedPageSchema`, `packedPageBlockSchema`
- `packages/backend/src/models/json-schema/user.ts` — `pinnedPageId` / `pinnedPage` in user schemas
- `packages/backend/src/postgres.ts` — registers `MiPage`, `MiPageLike` in DataSource

**Service layer:**
- `packages/backend/src/core/PageService.ts` — `create/update/delete`, `collectReferencedNotes`
- `packages/backend/src/core/entities/PageEntityService.ts` — `pack/packMany`
- `packages/backend/src/core/entities/PageLikeEntityService.ts` — `pack/packMany` for likes
- `packages/backend/src/core/entities/UserEntityService.ts` — packs `pinnedPage`
- `packages/backend/src/core/GlobalEventService.ts` — `pageEvent` payload type
- `packages/backend/src/core/ModerationLogService.ts` — `deletePage` log (called from `PageService.delete`)
- `packages/backend/src/queue/processors/DeleteAccountProcessorService.ts` — bulk page deletion on account delete

**API endpoints:**
- `packages/backend/src/server/api/endpoints/pages/create.ts`
- `packages/backend/src/server/api/endpoints/pages/update.ts`
- `packages/backend/src/server/api/endpoints/pages/delete.ts`
- `packages/backend/src/server/api/endpoints/pages/show.ts`
- `packages/backend/src/server/api/endpoints/pages/featured.ts`
- `packages/backend/src/server/api/endpoints/pages/like.ts`
- `packages/backend/src/server/api/endpoints/pages/unlike.ts`
- `packages/backend/src/server/api/endpoints/i/pages.ts` — own pages list
- `packages/backend/src/server/api/endpoints/i/page-likes.ts` — own likes list
- `packages/backend/src/server/api/endpoints/users/pages.ts` — per-user public pages
- `packages/backend/src/server/api/endpoints/page-push.ts` — realtime `pageEvent` push (AiScript Pages <-> streaming)
- `packages/backend/src/server/api/endpoints/i/update.ts` — `pinnedPageId` set/unset
- `packages/backend/src/server/api/endpoint-list.ts` — registration

**Web / federation-adjacent:**
- `packages/backend/src/server/web/ClientServerService.ts` — `GET /@:user/pages/:page` SSR route (line 624-659), visibility-dependent cache header (line 642)
- `packages/backend/src/server/web/views/page.tsx` — `PagePage` OG/meta view (note `og:url` mismatch, see quirks)
- `packages/backend/src/core/activitypub/ApRendererService.ts` — only generic `OrderedCollectionPage` (pagination), **no MiPage rendering**
- `packages/backend/src/core/activitypub/type.ts` — `Page` in `validPost`/`validDocumentTypes` refers to **ActivityPub object type `as:Page` for remote Notes**, not Misskey Pages feature.

**Migrations (schema history):**
- `packages/backend/migration/1556348509290-Pages.js` — creates `page` table + `page_visibility_enum`, indices, FKs
- `packages/backend/migration/1558072954435-PageLike.js` — creates `page_like` + `page.likedCount`
- `packages/backend/migration/1562444565093-PinnedPage.js` — `user_profile.pinnedPageId FK → page(id) ON DELETE SET NULL` + UNIQUE
- `packages/backend/migration/1562448332510-PageTitleHideOption.js` — adds `hideTitleWhenPinned`
- `packages/backend/migration/1586708940386-pageAiScript.js` — adds `script varchar(16384) NOT NULL DEFAULT ''`
- `packages/backend/migration/1697420555911-deleteCreatedAt.js` — drops `page.createdAt` + `page_like.createdAt` (createdAt now derived from ID via `IdService.parse`)
- `packages/backend/migration/1755168347001-PageCountInNote.js` — adds `note.pageCount`, backfills by counting `note`-type blocks inside `page.content` JSONB (including nested `section.children`)
- `packages/backend/migration/1756062689648-NonCascadingPageEyeCatching.js` — changes `eyeCatchingImageId` FK `ON DELETE CASCADE` → `SET NULL`
- `packages/backend/migration/1651224615271-foreign-key.js` — renames page FK constraint
- `packages/backend/migration/1605408971051-comments.js` — column comments

**Tests:** No dedicated `test/**/page*` backend unit tests. Indirect coverage: `test/utils.ts:200` uses `pages/create` as fixture helper; `test/e2e/move.ts:434` references `pages/create`; `test/unit/NoteCreateService.ts`, `test/unit/queue/processors/CleanRemoteNotesProcessorService.ts` assert `pageCount` behavior.

### 4.2 DB schema details

#### `page` table (`MiPage`)

```ts
@Entity('page')
@Index(['userId','name'], { unique: true })
export class MiPage {
  @PrimaryColumn(id()) id: string;
  @Index() updatedAt: timestamptz;
  title: varchar(256);
  @Index() name: varchar(256);   // slug within author's namespace
  summary: varchar(256) nullable;
  alignCenter: boolean;
  hideTitleWhenPinned: boolean default false;
  font: 'serif' | 'sans-serif';
  @Index() userId: varchar(32) FK user(id) ON DELETE CASCADE;
  eyeCatchingImageId: varchar(32) nullable FK drive_file(id) ON DELETE SET NULL;
  content: jsonb default [];
  variables: jsonb default [];
  script: varchar(16384) default '';
  visibility: enum('public','followers','specified'); // LEGACY — see §4.5
  @Index() visibleUserIds: varchar(32)[] default '{}';
  likedCount: integer default 0;
}
```

Indices: `PRIMARY KEY (id)`, `UNIQUE (userId, name)` (app-level check + DB constraint; race → `NAME_ALREADY_EXISTS`), `@Index() updatedAt/name/userId/visibleUserIds`.

`pageNameSchema` (`models/Page.ts:122`): `/^[^\s:\/?#\[\]@!$&'()*+,;=\\%\x00-\x20]{1,256}$/` — disallows whitespace, control chars, `: / ? # [ ] @ ! $ & ' ( ) * + , ; = % \`.

#### `page_like` table (`MiPageLike`)

```ts
@Entity('page_like')
@Index(['userId','pageId'], { unique: true })
export class MiPageLike {
  @PrimaryColumn(id()) id: string;
  @Index() userId FK user(id) CASCADE;
  pageId FK page(id) CASCADE;
}
```

Both FKs `ON DELETE CASCADE`. `likedCount` not reconciled on cascade — user-delete cascade leaves surviving pages' counters stale.

#### `user_profile.pinnedPageId`

`varchar(32) nullable, UNIQUE, FK page(id) ON DELETE SET NULL`. Set via `i/update`. Packed as full `Page` on user entities.

#### `note.pageCount`

`smallint default 0`. Counts distinct pages embedding a note via `content[]` blocks `{type:'note', note:<id>}` including inside `{type:'section', children:[]}`. Maintained by `PageService`; used by `CleanRemoteNotesProcessorService` to spare embedded notes.

### 4.3 API endpoints

Base: all `POST /api/<name>` (Misskey JSON-RPC style). `meta.kind` maps to role-policy permission.

| Endpoint | Auth | Kind / Limit | Params | Behavior |
|---|---|---|---|---|
| `pages/create` | required, `prohibitMoved: true` | `write:pages`, 10/hr | `title*, name* (pageNameSchema), content*[], variables*[], script*, summary?, eyeCatchingImageId?, font default sans-serif, alignCenter default false, hideTitleWhenPinned default false` | Validates eye-catch file belongs to caller else `NO_SUCH_FILE`; pre-checks `(userId,name)` uniqueness else `NAME_ALREADY_EXISTS`; delegates to `PageService.create` (re-checks + `visibility:'public'` hardcoded); returns packed `Page`. Race `1a79e38e...` → `NAME_ALREADY_EXISTS`. |
| `pages/update` | required, `prohibitMoved` | `write:pages`, 300/hr | `pageId*, + all create fields optional` | Resolves `eyeCatchingImageId` if non-null (must be caller's file; `null` clears, `undefined` leaves). `PageService.update` in transaction with `FOR NO KEY UPDATE` lock: `NO_SUCH_PAGE` / `ACCESS_DENIED` (not owner) / `NAME_ALREADY_EXISTS` (rename collision, excludes self). Returns void. |
| `pages/delete` | required (no `prohibitMoved`) | `write:pages`, no rate limit | `pageId*` | `PageService.delete`: `pessimistic_write` lock, `NO_SUCH_PAGE` if missing; owner **or moderator** else `ACCESS_DENIED`; `transaction.delete`; moderator-on-other → `moderationLogService.log(me,'deletePage',...)`; decrements `note.pageCount`. |
| `pages/show` | **not required** | no kind, no limit | `anyOf [{pageId*}, {name*, username*}]` | By ID, or by `(author usernameLower + host IS NULL, name)`. **Local users only**. **No visibility/block check**. Returns packed `Page`. |
| `pages/featured` | not required | no kind | `{}` | `WHERE visibility='public' AND likedCount>0 ORDER BY likedCount DESC LIMIT 10`; `packMany(pages, me)`. |
| `pages/like` | required, `prohibitMoved` | `write:page-likes` | `pageId*` | `NO_SUCH_PAGE`; `YOUR_PAGE` if own; `ALREADY_LIKED` via `exists`; `insert`; `increment likedCount` **not awaited**. No visibility check. |
| `pages/unlike` | required, `prohibitMoved` | `write:page-likes` | `pageId*` | `NO_SUCH_PAGE`; `NOT_LIKED` if no row; `delete`; `decrement` not awaited. Can drive counter negative on race. |
| `i/pages` | required | `read:pages` | pagination `limit 1-100 default 10` | Own pages only, **all visibilities**. `packMany` without `me` (so `isLiked` undefined). |
| `i/page-likes` | required | `read:page-likes` | same pagination | `like.userId=me.id` + join page; `PageLikeEntityService.packMany` → `[{id, page}]`. |
| `users/pages` | not required | none | `userId* + pagination` | `visibility='public'` only; `packMany` without `me`. No block/mute filtering. |
| `page-push` | required, `secure: true` | none | `pageId*, event*, var?` | Looks up page (any owner), `NO_SUCH_PAGE` if miss. **No ownership check** — anyone authed can push to anyone's page channel. Publishes `pageEvent` on author's main stream `{pageId, event, var, userId: me.id, user: packed me}`. |
| `i/update` (pinned part) | required | — | `pinnedPageId: id nullable` | If truthy: must exist **and** own else `NO_SUCH_PAGE`; sets profile. `null` clears. |

Error IDs: create `b7b97489...` (file), `4650348e...` (name); update `21149b9e.../3c15cd52.../cfc23c7c.../2298a392...`; delete `eb0c6e1d.../8b741b3e...`; show `222120c0...`; like `cc98a8a2.../28800466.../d4c1edbe...`; unlike `a0d41e20.../f5e586b0...`; page-push `4a13ad31...`.

### 4.4 Service-layer flow

#### `PageService.create(me, body)`

1. `findBy({userId: me.id, name})` → `1a79e38e...` if exists.
2. `insertOne(new MiPage({..., visibility: 'public', eyeCatchingImageId: file?.id ?? null}))`. `visibility`/`visibleUserIds` not in body — always public.
3. `collectReferencedNotes(content)` → `increment pageCount`. No validation note IDs exist/visible; `In([])` guarded.
4. Return entity; endpoint packs (no `me`, so `isLiked` undefined).

#### `PageService.update(me, pageId, body)`

1. `db.transaction` + `findOne({id}, lock FOR NO KEY UPDATE)` → `66aefd3c...` if null; not-owner → `d0017699...` (moderators cannot update).
2. If `body.name != null`: `findBy({id: Not(pageId), userId, name})` → collision error.
3. `transaction.update(id, {updatedAt: now, ..., eyeCatchingImageId: ...})`. Partial semantics rely on TypeORM skipping `undefined`.
4. If `body.content != null`: diff refs → decrement removed, increment added (transactional).

#### `PageService.delete(me, pageId)`

1. Transaction + `pessimistic_write` lock → `66aefd3c...` if null.
2. `!isModerator && not-owner` → `d0017699...`. Moderator path allowed + logged.
3. `transaction.delete` — cascades likes; profile pin SET NULL; eye-catch file untouched.
4. `decrement pageCount` for referenced notes.

#### `collectReferencedNotes(content)`

Recursive over top-level array + `section.children`: collects `type==='note' && typeof note==='string'`. Ignores image/text/unknown types.

#### `PageEntityService.pack(src, me?, hint?)`

1. Resolve entity; `meId = me?.id ?? null`.
2. `attachedFiles`: walk `content` (+children) for `type==='image'` → per-block `findOneBy({id: fileId, userId: page.userId})` (N+1; missing → filtered). Queries by page author's ID — correct.
3. Back-compat: `type==='input'` → `textInput`/`numberInput`, fire-and-forget `update`.
4. Returns `{id, createdAt: parse(id), updatedAt, userId, user: Lite, content, variables, title, name, summary, hideTitleWhenPinned, alignCenter, font, script, eyeCatchingImageId, eyeCatchingImage, attachedFiles, likedCount, isLiked: meId ? exists(...) : undefined}`. **No visibility/block/mute/follow check.**

`PageLikeEntityService.pack`: `{id, page: pack(page)}`. No timestamp (column dropped).

### 4.5 Federation / visibility / auth

- **No federation. `MiPage` is purely local.** No `uri`, no AP renderer/deliverer/resolver touches `MiPage`. `OrderedCollectionPage` is generic AP pagination, unrelated. `type.ts` `'Page'` = AP object type for remote Notes, not this feature.
- **Visibility vestigial/dead.** DB enum + `visibleUserIds` exist; read paths filter `visibility='public'` (`featured`, `users/pages`, web cache header), but **no write path sets non-public**: `create` hardcodes `'public'`; paramDefs have no visibility fields. `followers`/`specified` rows only from ancient versions; never enforced (`show`/`like`/`pack` ignore it; `i/pages` returns all own). `ClientServerService:642` single-element `['public']` check → public gets `Cache-Control: public, max-age=15`, else private.
- **Blocking/muting/follow: none.** Placeholder `import type {}` only. No checks in any endpoint or pack. Blocked user can still `show`/`like` your pages.
- **Auth:** `write:pages`, `write:page-likes`, `read:pages`, `read:page-likes`. `show`/`featured`/`users/pages` public. `create/like/unlike/update` have `prohibitMoved`; `delete` does not. `page-push` is `secure: true`.
- **Moderation asymmetry:** owner or moderator can delete (logged); only owner can update.
- **Pinned pages:** `i/update` only own existing page; unique + SET NULL on delete; packed as full `Page` on users.

### 4.6 Quirks / limits / edge cases

1. Update relies on `undefined`-skip in `transaction.update`; only `summary` has explicit preserve-old guard.
2. Eye-catch triple-state (update): `undefined` → unchanged; `null` → clear; owned file ID → set. No image-type check.
3. `og:url` vs route mismatch: `views/page.tsx:21` emits `{config.url}/pages/{id}`, actual route is `/@:user/pages/:name`.
4. Like counter races: increment/decrement not awaited; unlike has no floor (can go negative); `featured` hides `<=0`. User-delete cascade doesn't decrement survivors.
5. Like has no visibility gate beyond self-like ban.
6. `page-push` has no ownership check — any authed user can emit on anyone's channel (only `secure: true` restricts context).
7. `show` by `(name, username)` local-only, no visibility gate — leaks full content/script of legacy non-public pages by ID.
8. Limits: `script` ≤16384 (DB only, no app check); `title`/`name`/`summary` unbounded at API (DB 256 → 500 on overflow); `content`/`variables` no block-shape validation server-side. Rate limits: create 10/hr, update 300/hr.
9. `name` uniqueness per-user, not global; URL disambiguates via `/@:user/pages/:name`.
10. `attachedFiles` derived live from image-block IDs (stale IDs dropped), N+1. Eye-catch packed separately.
11. In-pack lazy migration writes — reads cause (un-awaited) writes.
12. `createdAt` derived from `IdService.parse(id)`, not stored.
13. Account deletion pages through own pages 100-at-a-time via `PageService.delete` (no modlog) to keep `pageCount` accurate.
14. `users/pages` and `featured` never pass `me` → `isLiked` undefined even when authed.
