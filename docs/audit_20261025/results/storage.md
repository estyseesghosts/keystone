# Storage audit (2026-10-25)

Scope: `src/storage/*`, `src/state/session/store.ts`, `packages/fedi/src/core/sessions.ts`, `src/state/queries/Provider.tsx` and `stale.ts`, and the prefs and draft stores. Source files were not modified. Everything below was verified by reading code; nothing was run on a device.

## Summary

Parsing is defensive everywhere I looked. Reads of corrupt JSON fall back to defaults and never throw, and the schemas are versioned with a v1 to v2 device migration. Keys carry the sessionId, so accounts do not alias each other.

The serious problems are about secrets and lifecycle:

- The "OS-secured" native token vault cannot work, because its key format is rejected by `expo-secure-store`.
- Tokens, and Mastodon `client_secret`s, therefore live only in plaintext, unencrypted MMKV.
- Sign-out does not purge the persisted query cache or any per-account keys.
- A corrupt or version-mismatched session envelope is silently overwritten with an empty one.

## Findings

### S1 (High): native SecureStore vault rejects every key, so it is a silent no-op
- Location: `src/storage/tokens.ts:24-26` (key), `:29-35` (swallowed errors); `node_modules/expo-secure-store/src/SecureStore.ts:229-239` (validation).
- `tokenKeyFor` returns `keystone.vault.${origin} ${sessionId}`. That string contains `:`, `/` and spaces, for example `keystone.vault.https://a.b https://a.b 123`.
- expo-secure-store 57.0.4 validates keys with `/^[\w.-]+$/` and throws otherwise.
- `getToken`, `setToken` and `removeToken` all wrap the call in `try/catch` that swallows the error. The vault therefore never stores or returns anything on native.
- Scenario: a user signs in on iOS. `store.add` calls `vault.setToken`, which throws internally and is swallowed. The token exists only in the MMKV envelope `keystone_sessions`. The "tokens in secure storage" design in `store.ts:29-38` and the doc comments is not what runs.
- The tests likely use a fake vault, so nothing catches this.
- Fix: encode the key to `[A-Za-z0-9._-]`, for example `keystone.vault.` plus a hex or base64url of the session id. Add a test that runs the real `isValidKey` regex against `tokenKeyFor`. Stop swallowing errors silently in `setToken`; return a boolean or log, so the envelope can decide whether to keep a plaintext copy.

### S2 (High): tokens and OAuth app secrets sit in plaintext, unencrypted MMKV
- Location: `src/storage/mmkv.ts:51` (`new MMKV({id: 'keystone'})`, no `encryptionKey`); the envelope `keystone_sessions` holds `token` (`sessions.ts:60`); `keystone_apps` holds `client_secret` (`mastodon/oauth.ts:257`).
- The envelope is by design the sync source of truth and carries the token copy. Even once S1 is fixed, the secret still exists in plaintext, so the vault adds no protection.
- On web, the react-native-mmkv web shim uses `localStorage` (this is react-native-mmkv's documented behaviour; I did not read the shim). `tokens.web.ts` is openly dev-grade, but if web is a shipped target, any XSS reads every account's token.
- Scenario: a device backup, a rooted device, or a file-system dump exposes tokens for all accounts.
- Fix: keep only non-secret session metadata in the envelope. Fetch the token from SecureStore (async, hydrated at boot) into an in-memory map used by request building. Alternatively, give MMKV an `encryptionKey` generated once and held in SecureStore. Treat `client_secret` the same way.

### S3 (High): sign-out and account removal leave all per-account data on disk
- Location: `src/state/session/store.ts:309-317` (`dropLocal`), `:453-468` (`remove`), `:470-483` (`signOutEverywhere`).
- These remove only the envelope entry, the vault token and the device mirror. A repo-wide grep found no `queryClient.clear`/`removeQueries`, no removal of the persisted query cache, and no removal of the following keys:
  - `keystone.drafts.<sid>` and `keystone.drafts.<sid>.open` (`drafts.ts:53-68`)
  - `keystone.account.<sid>` (`schema.ts:127`)
  - `keystone.softmute.<sid>` (`graph.ts:101`)
  - `keystone.emojirecents.<sid>` (`recents.ts:13`)
  - `keystone.emojifavs.*` and `keystone.likeemoji.*`
  - `keystone.homeTab:<sid>` (`Home.tsx:39,97`)
- The persisted query cache (`Provider.tsx:26`, key `keystone-query-cache`) is a single blob holding every account's feeds, notifications and DMs, for up to 24h (`stale.ts` `QUERY_PERSIST_MAX_AGE`).
- Scenario: a user signs out of a shared or lent device. Drafts (possibly private or DM-visibility text) and 24h of cached timelines and notifications remain readable in MMKV. In memory, the `QueryClient` still holds the data until the app restarts.
- Fix: on `remove`, `dropLocal` and `signOutEverywhere`, call `queryClient.removeQueries({predicate: q => q.queryKey[0] === id})`, which the persister then re-saves. Also delete the per-account key prefixes above. `signOutEverywhere` should also run `queryClient.clear()` plus `persister.removeClient()`.

### S4 (Medium): corrupt, partial or version-mismatched session envelope is overwritten and all sessions are lost
- Location: `packages/fedi/src/core/sessions.ts:176-196` (`readStore` returns null on bad JSON or a version other than 1), `:207-216` (`update`), `:391-395` and `:523` (migration writes an empty envelope).
- Any invalid envelope is treated as absent. The next `loadSessions` runs migration, finds no legacy keys, and calls `writeStore` with an empty envelope. This also happens on read, not only on write, so the raw bad blob is destroyed immediately.
- Related: `normalizeSession` drops individual malformed entries, and the next `saveSession` persists the shrunk list.
- Scenario: a future build bumps `STORE_VERSION` and the user downgrades. Or a partial write from a crash corrupts the JSON. All accounts are signed out with no backup and no prompt.
- Fix: before overwriting, copy the raw value to `keystone_sessions.bak`. Do not write an empty envelope when a non-empty unreadable value exists. Version-mismatched payloads should be migrated or preserved, not discarded.

### S5 (Medium): `hydrate()` can resurrect a removed session, and a stale vault token can override a newer envelope token
- Location: `src/state/session/store.ts:485-495`.
- `hydrate` snapshots `readSessions()`, awaits `vault.getToken` per session, then calls `saveSession({...session, token: vaultToken})` using the stale snapshot object.
  - If the user removes that session (or signs out) during the await, `saveSession` re-inserts it at the front of the list, so a signed-out account comes back.
  - `saveSession` also reorders the list.
- Separate issue: vault wins on mismatch. `setToken` failures are swallowed (`tokens.ts:37-43`). After a re-sign-in whose vault write failed, the old token stays in the vault and the next `hydrate` overwrites the fresh envelope token with the dead one. Today this is masked by S1, but it appears once S1 is fixed.
- Fix: in `hydrate`, re-read the session by id right before writing. Skip it if it is gone or its token changed. Have `setToken` report failure and clear or overwrite stale vault entries, for example by calling `removeToken` when `setToken` fails.

### S6 (Medium): `signOutEverywhere` can wipe a session added during its awaits
- Location: `src/state/session/store.ts:470-483`.
- It takes a snapshot, then awaits up to 8s per revoke (`sessions.ts` default `timeoutMs`), sequentially. After the loop it unconditionally runs `setActiveSessionId(storage, null)` and `writeMirror(null)`.
- Scenario: an account is added while revokes are in flight (an OAuth callback landing). The new session stays in the envelope but loses its active pointer. The active session is cleared, and the UI shows signed out while a session remains stored.
- Fix: clear the pointer only if the active id is one of the removed ids. Run the revokes in parallel with `Promise.allSettled`.

### S7 (Medium): query cache persists as one unbounded JSON string with no eviction other than 24h age
- Location: `src/state/queries/Provider.tsx:42-60` (adapter), `:75-80` (`persistQueryClient`, default `shouldDehydrateQuery`, no size cap).
- `createAsyncStoragePersister` has `throttleTime` 1000ms by default. It runs `JSON.stringify` of the whole dehydrated client on the JS thread and `mmkv.set` of one value, after every cache change in the 1s window.
- Everything successful is dehydrated: all accounts, infinite-query pages, notifications, search. Nothing limits entries, pages or bytes, and there is no `retry` callback to shrink the payload.
- MMKV growth: MMKV does not shrink its file after a large value is replaced until a trim.
- Scenario: a heavy deck-column user with multiple accounts accumulates multi-MB blobs, causing frame drops on every feed update and slow cold-start `JSON.parse`. If `set` throws (the adapter swallows it), persistence silently stops with no retry.
- Fix:
  - Add `shouldDehydrateQuery` to whitelist feeds and profiles and exclude search, notifications, DMs and private data.
  - Cap infinite pages persisted (for example, the first page only).
  - Use a `retry` that drops the largest queries.
  - Consider a per-session key rather than one blob.

### S8 (Low): persisted-cache buster is independent of storage and session schema
- Location: `src/state/queries/stale.ts` `QUERY_BUSTER = "keystone-queries-v1"`.
- Wire-to-domain shape changes need a manual bump, and nothing ties them to the code. Stale shapes restored into new selectors could crash.
- Fix: bump on any domain-model change, or derive from a schema version constant covered by a test.

### S9 (Low): downgrade or forward-version handling discards device prefs and drafts
- Location: `schema.ts:76-101`, `drafts.ts:48-52,87-91`.
- A device state with an unknown version (3+) returns defaults, and the next pref write overwrites the stored one. The same applies to drafts: a list whose `version` is not 1 reads as empty, and the next `saveDraft` writes over it.
- The device blob also carries `activeSessionId`, so a prefs write after a failed parse nulls the mirror.
- Fix: do not write over an unreadable-but-non-empty value without a backup.

### S10 (Low): orphaned MiAuth pending rows
- Location: `src/screens/LoginFlows.ts:316`.
- `keystone_pending_miauth_<session>` rows are removed only when taken. Abandoned logins leave them forever. They hold only host, scheme and session (no token). Nothing sweeps rows older than the 15 minute max age.
- Fix: sweep stale rows at boot.

### S11 (Low): draft key suffix collision theoretically possible
- Location: `drafts.ts:53-68`.
- `keystone.drafts.<sid>` versus `keystone.drafts.<sid>.open` would collide if a session id ended in `.open`. Real account ids are numeric or alphanumeric, so this is a design smell only. Use a separate prefix, for example `keystone.draftopen.`.

### S12 (Low): inconsistent write error handling in prefs stores
- Location: `recents.ts:52` and `emojiPrefs.ts` have no try/catch of their own, but the MMKV adapter swallows exceptions, so there is no crash.
- Net effect: any storage write failure (quota or native) is invisible app-wide. Users believe prefs, drafts or tokens persisted when they did not.
- Fix: let `createMmkvStore.setItem` report failure, for example via a dev log or telemetry hook, and have draft autosave surface the failure.

## Things that looked solid

- Every JSON read (`parseOrFallback`, `migrateDeviceState`, `parseFeedPrefs`, `readStore`, emoji lists, `cachedAppScopes`) is wrapped in try/catch with a validated fallback. Zod schemas reject wrong shapes and out-of-range values.
- `normalizeSession` rebuilds the object from known fields, so unknown junk is not trusted. Unknown flavor, grant or hosting values degrade safely.
- Legacy migration is idempotent and does not resurrect removed sessions. Corrupt legacy entries are dropped individually.
- Device v1 to v2 migration carries prefs forward (`schema.ts:61-102`).
- Account scoping:
  - Session ids embed the origin.
  - Query keys require a non-empty sessionId first (`keys.ts:13-17`).
  - Vault, draft and account keys all include the session id. Same user on different origins cannot alias.
- Token-origin binding: requests are built from the session object, so tokens are not shared across origins.
- Persisted cache restore failures are caught and the cache is discarded, so a corrupt cache boots cold (`Provider.tsx:75-83`). The persister also uses `maxAge` and `buster`.
- Drafts:
  - Capped at 25, validated per row, and a bad row is dropped without affecting the others.
  - Attachments are not stored.
  - Read-modify-write on the sync MMKV seam is atomic on the JS thread.
- Device-state and session-envelope read-modify-write is synchronous, so single-call updates cannot interleave. The races found (S5, S6) are the ones that cross `await`s.
- The lazy MMKV singleton avoids native access at import time.
- `dropLocal` on 401 clears the envelope, vault and mirror together.
