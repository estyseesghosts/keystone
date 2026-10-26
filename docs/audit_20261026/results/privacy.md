# Privacy audit — Keystone v2 (2026-10-26)

Scope: persisted query cache (`src/state/queries/Provider.tsx`, `stale.ts`, `persistPolicy.ts`), per-account wipe on sign-out/remove (`src/state/session/store.ts`, `src/state/session/purge.ts`, post-shadow store), drafts persistence + expiry (`src/storage/drafts.ts`), link-preview fetching + private-IP guard (`packages/fedi/src/api/linkpreview.ts`, `packages/fedi/src/core/urlPolicy.ts`, `LinkCard.tsx`, `PostCard.tsx`), federated-post remote fetches (`packages/fedi/src/misskey/remotepost.ts`, `PostCard.tsx` `resolveRemotePostUrl`), default post visibility (`defaultVisibilityFor` / `composePrefsOf`), uploads EXIF handling (`src/state/queries/composer.ts`, `pickMedia.ts`, `pickProfileImage.ts`), app-switcher protection/screenshot flags (`src/state/privacyShield.ts`, `PrivacyShieldHost.tsx`), permissions (manifest + Info.plist + Expo config), auto-translation data flow (`useAutoTranslation.ts`), session/account scoping of cache keys (`src/state/queries/keys.ts`). Static code reading only (grep + file reads); nothing was run.

Prior report `docs/audit_20261025/results/privacy.md` was used as the checklist. Of its 13 items, 9 are now fully fixed in code, 2 partially (residuals below), and the 2 INFO items are resolved or confirmed.

## Summary

The privacy posture is substantially better than on 2026-10-25. The headline gaps all have landed repairs:

- The query cache is now default-deny persisted (allowlisted public kinds only, per-session split blobs, private rows stripped, mutations never persisted).
- Sign-out/remove now purges storage, memory, query cache, and stream stops through one enumerated key list with a ratchet test.
- Native session envelopes are secret-free (ADR 0011); tokens live in SecureStore. `android:allowBackup` is off.
- Composer seeds the server-side default visibility; direct drafts never autosave; drafts have a 30-day TTL.
- Link preview, remote-post resolution, and streaming-origin advertisement all pass a shared public-URL policy; unfurl and auto-translate never fire automatically for private posts; share/copy of non-public posts confirms first; uploads strip EXIF by default with honest warnings otherwise.

What remains is mostly defense-in-depth rather than open holes:

- **0 HIGH, 2 MEDIUM, 5 LOW, 2 INFO.** The two MEDIUMs are both "plaintext at rest": MMKV is still unencrypted (no `encryptionKey`), and the web vault keeps bearer tokens in localStorage-backed MMKV (already a documented release blocker).

## Findings

### 1. MEDIUM — Persisted data (query blobs, drafts, envelopes, prefs) still rests in unencrypted MMKV

- `src/storage/mmkv.ts:68` (`new MMKV({id:'keystone'})`, no `encryptionKey`), `src/state/queries/stale.ts:28` (`QUERY_PERSIST_MAX_AGE = 24h`), `src/state/queries/Provider.tsx:151-172,192-198`, `src/state/queries/persistPolicy.ts:54-105,158-161,206-260`.
- The 2026-10-25 HIGH is fixed as a *content* problem: `shouldDehydrateQuery` gates on `shouldPersistQueryKey` (allowlist: public feed descriptors, profiles, emoji, limits, `me`), `stripPrivateData` drops `direct`/`followers` rows, `filterPersistedState` empties mutations, and blobs are split per session (`perSessionPersistKey`) with a manifest. But the *container* is unchanged: anyone with filesystem access to the app container (lost unlocked device, forensic dump) reads up to 24h of home/public timelines, profiles, drafts (`keystone.drafts.*`, plaintext JSON), and session metadata in cleartext.
- Mitigations already in place: `allowBackup:false` (`app.config.js:55`) plus `withAndroidHardening` backup rules keep this out of cloud/adb backups, and per-session purge deletes exactly the removed account's blob. So the residual threat is local access only, hence MEDIUM not HIGH.
- Fix (optional, defense-in-depth): encrypt MMKV with a key held in SecureStore/Keychain, or narrow `QUERY_PERSIST_MAX_AGE` for the home-timeline descriptor. Device-check: confirm a release backup contains no `files/mmkv/` entries.

### 2. MEDIUM (web only) — Bearer token lives in localStorage-backed MMKV on web

- `src/storage/tokens.web.ts:7-13` ("dev-grade … a documented release blocker"), `src/storage/vault.ts:1-6`, `src/state/session/store.ts:846-848` (plain-vault path keeps the envelope token copy).
- Native is fixed (secret-free envelope via `sessionWithoutToken`, `store.ts:821-836`; vault-wins hydration `store.ts:485-570`). On web there is no keychain, so the token sits in the same store as everything else and survives in cleartext localStorage. The code already documents this as a release blocker; no new action beyond tracking it — do not ship web production without a scoped fix (httpOnly cookie session or explicit risk acceptance).

### 3. LOW — `auto-public` link previews still expose the reader's IP to arbitrary third-party hosts; DNS rebinding explicitly out of scope

- `src/state/privacyShield.ts:17-49,754-758` (default `tap`; `shouldAutoUnfurl` only for `kind === 'public'`), `packages/fedi/src/api/linkpreview.ts:200-276,409-414` (policy gate first, manual redirects with per-hop re-check, `credentials:'omit'`, capped streamed body, whole-fetch deadline), `src/components/Post/PostCard.tsx:757-759,1158-1160`, `src/components/Post/LinkCard.tsx:142-202`.
- The 2026-10-25 MEDIUM is fixed: no auto-fetch for direct/followers/specified, LAN/loopback/link-local/non-https/userinfo/port tricks rejected (`urlPolicy.ts:204-262`), preview-asset URLs re-gated (`linkpreview.ts:368-380`). Residuals: (a) a user who opts into `auto-public` still has their device fetch — and their IP/UA revealed to — any host linked from a *public* post, which is inherent to client-side unfurl; the proxy stays opt-in. (b) `urlPolicy.ts:14-17` documents that a public hostname resolving to a private address (DNS rebinding, split-horizon intranet DNS) cannot be detected without resolver support. Both are accepted tradeoffs, recorded here for completeness.

### 4. LOW — No OS-level screenshot/screen-recording block; shield is an in-app cover only

- `src/state/privacyShield.ts:14-15` ("Android `FLAG_SECURE` … needs a native module and is out of scope"), `src/state/PrivacyShieldHost.tsx:18-52`, `src/state/privacyShield.ts:61-74,138-180` (conversation-forced cover regardless of pref, otherwise opt-in on `inactive`/`background`).
- The 2026-10-25 LOW is fixed as far as the app layer goes: DM/chat/conversation screens force the opaque cover, and the pref covers the task-switcher snapshot path. Residual: screenshots, screen recordings, and (on some OEMs) switcher snapshots taken before `inactive` fires still capture content. No action required unless the threat model changes; that would need a native module.

### 5. LOW — `Keep original` uploads, all videos, and the profile-image fallback path ship EXIF/GPS unchanged

- `src/state/queries/composer.ts:361-406` (`stripImageForUpload`: JPEG q0.92 re-encode, default ON), `604-613` (opt-out via `keepOriginal`), `src/components/Composer/ComposerSections.tsx:351-359` (GPS-specific vs generic warning), `src/components/Composer/Composer.tsx:419-433,552-560` (once-per-session video notice: "Videos are sent unchanged"), `src/components/Profile/pickProfileImage.ts:82-118` (crop+resize+re-encode, `hadGps:false`) vs `119-148` (manipulator missing/failed → original bytes, `hadGps:null`).
- The 2026-10-25 LOW is fixed for the default path. Residuals are all warned-and-explicit: the user must tap `Keep original` (with the location caption when GPS is detected), videos are announced as unstripped, and only a failed manipulator silently falls back to originals. Consider logging the fallback (`hadGps:null` + `keepOriginal` effectively true) so a future audit can measure how often it happens.

### 6. LOW — Checked-in `Info.plist` / manifest still carry camera/mic/local-network entries; release stripping needs on-device verification

- `app.config.js:86-98` (`cameraPermission:false, microphonePermission:false`, `withAndroidHardening` listed last), `plugins/withAndroidHardening.js:33-38` (`RECORD_AUDIO` + `SYSTEM_ALERT_WINDOW` removal markers), `ios/Keystone/Info.plist:58-64` (still lists `NSCameraUsageDescription`, `NSMicrophoneUsageDescription`, dev-launcher `NSLocalNetworkUsageDescription`, `_expo._tcp` Bonjour), `ios/Keystone.xcodeproj/project.pbxproj:364` (build-phase script strips dev-launcher local-network keys from non-Debug builds).
- Config-side the 2026-10-25 LOW is addressed. But the checked-in `ios/` tree is a prebuild artifact and still contains the entries, so this cannot be closed statically. **Device-check needed**: after `expo prebuild`, confirm the generated manifest has no `RECORD_AUDIO`/`SYSTEM_ALERT_WINDOW` and the release `Info.plist` has no camera/mic keys; confirm photo-library-only prompt on first attach. `NSPhotoLibraryUsageDescription` (`Info.plist:64-65`) is legitimate and stays.

### 7. LOW — Explicitly saved direct/specified drafts persist as plaintext (TTL'd, purged on sign-out)

- `src/storage/drafts.ts:15-18,153-197` (30-day TTL in `listDrafts`, `sweepExpiredDrafts` at boot), `src/components/Composer/Composer.tsx:473-485,531-544` (autosave and unmount-flush both skip direct/specified, with an honest notice), `src/storage/drafts.ts:236-250` (`purgeDrafts` covers live + legacy + backup rows), `src/state/session/purge.ts:118-129`.
- The 2026-10-25 item is fixed: DMs are never written without an explicit Save, they expire, and sign-out deletes them. Residual: an explicit Save-and-close of a direct draft still writes cleartext (max 25 per session) readable from the container until TTL/purge. That is user-directed and consistent with the MEDIUM-1 container finding; noted, no separate fix.

### 8. INFO — Misskey streaming authenticates via `?i=` token in the URL

- `packages/fedi/src/misskey/stream.ts:36,105,181` (`${base}?i=${encodeURIComponent(token)}`, `credentials` n/a to sockets).
- This is the Misskey-standard mechanism (sockets cannot set headers; the Mastodon side correctly uses the `["Bearer", token]` subprotocol, `packages/fedi/src/mastodon/stream.ts:260-264`), but the token lands in the URL and may persist in server/proxy access logs. No app-side alternative exists; recorded for the threat model only.

### 9. INFO — `packages/fedi` now emits no console logging at all

- `grep console.(log|warn|error|info|debug) packages/fedi/src` → no matches (2026-10-25 noted `__DEV__` method/path logs and two UI-layer `console.warn/error` on error objects; both are gone).
- Nothing sensitive can leak through logs because there are no logs. No action.

## Looked solid

- **Persist policy** (`persistPolicy.ts:54-161,230-260,396-536`): default-deny allowlist, descriptor gate (`PERSISTED_FEED_DESCRIPTORS`), `stripPrivateData` for feeds/arrays/threads/singletons, mutations dropped, 2 MiB cap with largest-first shrink, per-session blobs with unchanged-session skip and stale-session pruning, legacy-blob restore filtered through the same policy. Wired as `dehydrateOptions.shouldDehydrateQuery` in `Provider.tsx:192-198`.
- **Session purge** (`purge.ts:46-129,134-142,215-260`, `store.ts:670-692,868-933`): single `sessionScopedKeys` enumeration (drafts, legacy `.open`, account, soft-mute, emoji recents/favs/like, home tab, per-session blob) with a ratchet test (`crossAccount.test.ts:237-264`), manifest pruning, `postShadowStore.clearSession` now has a non-test caller, cancel-before-remove query purger via registry, `signOutEverywhere` clears all blobs. Never throws.
- **Token hygiene (native)**: secret-free envelope + SecureStore vault + in-memory map (`store.ts:53-61,821-848`), vault-wins hydration with envelope-duplicate scrub and envelope→vault migration (`store.ts:472-570`), forensic `.bak` dropped when the envelope empties (`sessions.ts:388-393`), per-origin vault keys (`tokens.ts:31-34`).
- **Default visibility**: `composePrefsOf` reads Mastodon `source.privacy/sensitive/language` and Misskey `defaultNoteVisibility/defaultNoteLocalOnly` (`composer.ts:303-334`); Composer seeds from prefs at init and applies late-arriving `me` prefs only to a pristine composer (`Composer.tsx:385-397,547-582`); unknown `preferredRaw` narrows to followers, never public (`composer.ts:297-299`); replies still inherit the parent (`composer.ts:292-296`). (`Note.tsx:366` passes the focused post as `replyTo`, so no prefs are needed there.)
- **Outbound policy**: `isPublicHttpsUrl` (`urlPolicy.ts:204-262`) blocks non-https (dev-only `allowHttp` escape), userinfo, non-default ports, IP literals in decimal/octal/hex/short encodings, IPv6 non-public ranges, `localhost`/`.local`/`.internal`, trailing-dot and numeric-lookalike hosts; applied to page URL, every redirect hop, preview assets, and remote-post AP ids.
- **Remote-post resolution** (`remotepost.ts:88-149`): gated, `credentials:'omit'`, `redirect:'manual'`, `id === uri` trust check, 6 s timeout, single-flight, public-only shared cache with 5-min negative TTL; `PostCard.tsx:509-523` resolves lazily on tap (no mount-time warm).
- **Auto-translate**: never auto for direct/followers (`useAutoTranslation.ts:89-93`); first manual translate of a private post shows the server-handling notice (`PostCard.tsx:533-548`, `privacyShield.ts:51-56`); 403 breaker, same-language and tag/link-only skips.
- **Share/copy**: non-public posts gain a confirm on `copy-contents`/`copy-link`/`copy-remote-link`/`share` (`menuModel.ts:302-322`); clipboard is write-only (`lib/clipboard.ts`).
- **Cache scoping**: every key is `createQueryKey(sessionId, …)` and throws on empty id (`keys.ts:13-18`); `patchPostInCaches` filters on `queryKey[0]`; signed-out keys never persist (`persistPolicy.ts:128-135,141`).
- **Streaming origin**: `decideStreamingOrigin` (`instance.ts:125-182`) requires scheme pin plus equal/subdomain/qualified-sibling host, refuses foreign/IP-literal/credentialed/invalid advertisements (dial session origin instead); evidence persisted for UI.
- **Misc**: no analytics/Sentry/crash-reporting/remote fonts; `NSAllowsArbitraryLoads=false` (`Info.plist:47-53`); replies never widen audience; drafts store no attachments; camera/mic never invoked.
