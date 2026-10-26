# Privacy audit — 2026-10-25

Scope: visibility handling, caches/logs/share/clipboard, third-party requests, multi-account bleed, logout cleanup, drafts, upload metadata, permissions. Static read only; nothing was run.

## Summary

Per-session scoping of query keys, drafts and post-shadow is well done, and the code makes no analytics, crash-reporting or third-party-font calls. The main gaps are at the storage and lifecycle level:

- Every query result, including DMs, is persisted in unencrypted MMKV.
- Sign-out deletes the token but nothing else.
- Session tokens also sit in plaintext MMKV, which Android backs up.
- Link previews fetch arbitrary third-party URLs automatically, from the user's own IP.
- New posts ignore the account's default visibility and always start as Public.

## Findings

### 1. HIGH — Entire React Query cache (including DMs and followers-only posts) persisted to plaintext MMKV for 24h
- `src/state/queries/Provider.tsx:46-88`, `src/state/queries/stale.ts:27`, `src/storage/mmkv.ts:51`
- `persistQueryClient` is called with no `dehydrateOptions.shouldDehydrateQuery`, so every successful query is serialized into `keystone-query-cache`. That covers conversations (`[sessionId,'conversations']`, `'conversation'`), Misskey chat rooms, notifications, followers/direct posts, the `me` query and scheduled/server drafts. `new MMKV({id:'keystone'})` has no `encryptionKey`.
- Scenario: a user opens DMs, then loses the device, or someone takes a backup or file-system dump. Up to 24h of private messages is readable from the app container. This also applies on web, where MMKV is backed by localStorage.
- Fix: filter dehydration to an allowlist of public data (feeds of public timelines, emoji, instance metadata). Exclude conversations, chat, notifications, and any post whose `visibility.kind` is direct or followers, using `meta:{persist:false}`. Alternatively encrypt MMKV with a key held in SecureStore.

### 2. HIGH — Sign-out / account removal leaves cached content and local data behind
- `src/state/session/store.ts:296-312, 457-480` (`remove`, `dropLocal`, `signOutEverywhere`); no `QueryClient` access anywhere in `src/state/session` or `AccountMenu`/`AccountSwitcher`.
- `store.remove` only revokes the token, removes the envelope entry, vault token and mirror. It does not run any of the following, and `rg` finds no non-test caller for the first:
  - `postShadowStore.clearSession` (defined at `src/state/cache/post-shadow.ts:57,112`, never called)
  - `queryClient.removeQueries` for that session's keys, or an in-memory/persisted `keystone-query-cache` purge
  - removal of `keystone.drafts.<sid>` and `.open`
  - removal of `keystone.emojirecents.<sid>`, `keystone.homeTab:<sid>`, or per-account scope state
- Scenario: a user signs out of account A on a shared or handed-on device. A's DMs, notifications, and the drafts (including specified/DM drafts) remain in MMKV. The query cache is restored on the next launch. When the same account is re-added, or `sessionId` is deterministic (origin+accountId), the old cached data reappears before any auth check.
- Fix: add a `purgeSession(sessionId)` invoked from the session store's remove paths. It should run `queryClient.removeQueries({predicate: q => q.queryKey[0]===sid})`, re-persist, `postShadow.clearSession`, delete the draft/recents/home-tab/account-scope keys, and on `signOutEverywhere` clear `QUERY_PERSIST_KEY`.

### 3. HIGH — Session token also stored in plaintext MMKV envelope, defeating SecureStore; Android `allowBackup=true`
- `packages/fedi/src/core/sessions.ts:162,200-230` (`saveSession` writes `token` into `SESSIONS_KEY`); `src/storage/tokens.ts:30-34` ("the envelope copy remains"); `android/app/src/main/AndroidManifest.xml:15` (`android:allowBackup="true"`); `app.config.js` sets no `android.allowBackup`.
- The SecureStore vault is a second copy. The bearer token is always in the unencrypted MMKV file. With Android auto-backup enabled, the MMKV file (token plus the cache from finding 1) goes into Google Drive backups and `adb backup`.
- Scenario: another device restoring the backup, or anyone with filesystem access, gets a valid long-lived Misskey/Mastodon token.
- Fix: persist the envelope without `token` (hydrate it from the vault, as `hydrate()` already half does), set `android.allowBackup:false` (or `fullBackupContent` excludes) in `app.config.js`, and set `NSURLIsExcludedFromBackupKey` for the MMKV dir on iOS. Web has no keychain, so document the localStorage-token risk; the code comments already call it "dev-grade".

### 4. MEDIUM — New posts always default to Public; account default privacy is ignored
- `src/components/Composer/Composer.tsx:301,441`, `src/screens/Note.tsx:353`, `packages/fedi/src/api/composer.ts:115-127,280`.
- `defaultVisibilityFor` has a `preferredRaw` parameter, but no caller passes it. `rg` finds no read of Mastodon `source.privacy` or Misskey `defaultNoteVisibility`/`defaultNoteLocalOnly`. A user whose server default is followers-only or unlisted posts publicly by accident. Replies correctly inherit the parent's visibility.
- Fix: seed from the account's server-side default (`/verify_credentials` `source.privacy`, Misskey `i` settings) and also from the `localOnly` default.

### 5. MEDIUM — Link previews fetched automatically from arbitrary hosts, with no SSRF/private-IP guard and unbounded body read
- `packages/fedi/src/api/linkpreview.ts:84-117,227-247`, `src/components/Post/PostCard.tsx:581,1065`, `src/components/Post/LinkCard.tsx:146-196,236-253`.
- With data saver off (default), every post that has a URL and no server card triggers a direct `fetch(pageUrl)` from the device on mount, with no user action. The destination server sees the reader's IP and UA. The preview image and icon from the fetched page are then loaded by `<Image>` directly from the third-party host. This applies to any visibility, including DMs and followers-only posts, so a link in a DM beacons the reader.
- A malicious post can also point at `http://192.168.x.x/...`, `localhost`, or a metadata endpoint, which makes the device probe the user's LAN.
- `direct.text()` reads the whole body before `.slice(PREVIEW_MAX_BYTES)`, and the timeout covers only the headers (`fetchWithTimeout` clears its timer on resolve). A huge response can exhaust memory.
- Positives: the proxy is opt-in and null by default, and the leg is single-flight and cached.
- Fix: default `auto` to off (tap-to-unfurl only), and never auto-unfurl direct/followers posts. Reject non-public hosts (RFC1918, loopback, link-local, `.local`). Stream-limit the body, and consider making the preview image tap-to-load.

### 6. MEDIUM — Server-controlled streaming origin receives the token
- `packages/fedi/src/mastodon/instance.ts:72-96` and `backend.ts:297-310,1431`. Mastodon `configuration.urls.streaming` can name a different host. Only the scheme is checked against the session origin; the host is not.
- Mastodon sends `["Bearer", token]` as the WebSocket subprotocol, so a compromised or malicious instance can redirect the stream to an attacker host and receive the token. This breaks the "requests never carry the token to another origin" rule in AGENTS.md §6.
- Fix: accept the advertised host only if it shares the session's registrable domain (or the user opts in). Also note that Misskey sends the token as `?i=` in the URL (`misskey/stream.ts:152-156`), which is the Misskey-standard way and may end up in server logs.

### 7. LOW/MEDIUM — Drafts persist cleartext, never expire, and survive logout
- `src/storage/drafts.ts:50-120`; `Composer.tsx:343,702,726`. Up to 25 drafts per session, including `visibleUserIds` and the text of direct posts, stored as plain JSON for an unlimited time. See finding 2 for logout. Consider a TTL and excluding direct-visibility drafts from autosave, or encrypting them.

### 8. LOW — No upload metadata stripping
- `src/components/Composer/pickMedia.ts:36-45`, `src/components/Profile/pickProfileImage.ts:27-32`. `quality:1` with the originals and no re-encode means EXIF (GPS, device) goes to the server untouched. Mastodon strips it server-side, but Misskey/Sharkey drive keeps the original file. Fix: re-encode via `expo-image-manipulator` or warn in the UI when the image has GPS. Pick-level `exif:false` does not remove it from the file.

### 9. LOW — No app-switcher / screenshot protection
- `rg` finds no `AppState`, privacy screen, or `FLAG_SECURE` handling anywhere in `src`. DM and followers-only content appears in the OS task switcher snapshot. Optional: blur on inactive when the active screen is DMs.

### 10. LOW — Share sheet and clipboard (user-initiated)
- `src/components/Post/PostCard.tsx:437-445`, `menuModel.ts:300-333`. The Share row sends the post's plain text plus link for any visibility, including direct and followers-only posts, with no warning. "Copy link" and "Copy contents" are likewise ungated. They are user-initiated, but a "this post is not public" interstitial is worthwhile. Clipboard use is write-only (`src/lib/clipboard.ts`) and never reads the clipboard.

### 11. LOW — Unused permissions / manifest
- `AndroidManifest.xml:4-5` requests `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW`, and `Info.plist` has `NSCameraUsageDescription` and `NSMicrophoneUsageDescription`, with generic text. `rg` finds no camera/record code. These come from the `expo-image-picker` and dev-client plugins. Add `expo-image-picker` plugin config with `cameraPermission:false, microphonePermission:false`, and verify release builds drop `SYSTEM_ALERT_WINDOW`. The `NSLocalNetworkUsageDescription` text is dev-launcher text and should be debug-only.

### 12. INFO — Auto-translation sends private note text to the server's translator
- `src/components/Post/useAutoTranslation.ts` has no visibility gate. Text goes to the user's own instance, which may call an external service (DeepL and similar). Suggest skipping auto-translate for direct/followers posts.

### 13. INFO — Dev API logs
- `packages/fedi/src/misskey/client.ts:221` and `mastodon/client.ts:42-46` log only method/path under `__DEV__`, with no bodies or tokens. `console.warn/error` in `Conversation.tsx:104` and `PostPoll.tsx:134` log error objects only.

## Looked solid
- Every query key goes through `createQueryKey(sessionId, ...)` (`src/state/queries/keys.ts`), which throws on an empty id. Literal keys are all `[sessionId, ...]`. The `'signed-out'` scope holds only guest data. `patchPostInCaches` filters by `queryKey[0]===sessionId`.
- The post shadow, drafts, emoji recents and token vault keys all embed the session id (and origin for tokens). Request builders are per-session, and the token is sent only to `session.origin`.
- Mastodon WebSocket auth uses a subprotocol, never the URL.
- No analytics, Sentry, crash reporting, or remote fonts, and there is no `innerHTML`/WebView. `NSAllowsArbitraryLoads=false`.
- Replies never widen the parent's audience (`defaultVisibilityFor`). `specified` recipients are ignored on Mastodon and `direct` is mapped from the mentions.
- The link-preview proxy is opt-in and defaults to null. Drafts store no attachments. Clipboard use is write-only.
- Camera and microphone are never invoked, and library access is requested explicitly with a typed denial path.
