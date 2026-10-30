import {z} from 'zod'

import type {KeyValueStore} from '@keystone/fedi'

// Versioned app storage schema (slice 2.5).
//
// Two scopes share one `KeyValueStore` (MMKV on device, the same seam
// `core/sessions` persists its envelope through):
// - device scope (`DEVICE_KEY`): the active-session pointer mirror +
//   device prefs. The core envelope's `active` stays the source of truth
//   for session logic; this mirror exists so boot can recover the last
//   active account when the envelope pointer is missing (never the other
//   way around — see `resolveActiveId` in `state/session`).
// - per-account scope (`accountKeyFor(sessionId)`): per-account prefs,
//   keyed by the session id (`"${origin} ${accountId}"`).
//
// Invalid stored data → safe defaults (`parseOrFallback`, tested). The
// version literal rejects forward-incompatible payloads the same way.

export const STORAGE_VERSION = 2 as const

const devicePrefsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  // Device-local unicode-emoji art style (v1 `appearance.tsx` parity).
  // Default OpenMoji; anything unknown falls back to it on read.
  emojiStyle: z.enum(['openmoji', 'twemoji', 'noto', 'fluent', 'system']).default('openmoji'),
  // Device-local prose text scale, 0.5–4x (v1 `TEXT_SCALE_MIN/MAX`
  // parity). Out-of-range stored values fail validation and fall back
  // with the rest of the device state, never a half-prefs object.
  textScale: z.number().min(0.5).max(4).default(1),
  // Device-local post-content override (v1 `contentMode.tsx` parity, P3):
  // `auto` renders every post through its own source parser (current
  // behaviour); `plain` renders the plain-text projection everywhere.
  // One shared preference across every account, like text scale.
  contentMode: z.enum(['auto', 'plain']).default('auto'),
  // Device-local quote display policy (WS-A): `false` (default) renders
  // every quote card; `true` hides unauthorized quote cards behind a
  // tap-to-reveal row. One shared preference across every account.
  onlyAuthorizedQuotes: z.boolean().default(false),
  // Device-local data saver (E9 follow-up): `false` (default) auto-loads
  // link previews; `true` restores the tap-to-preview trigger. One shared
  // preference across every account. Repair X2.5 layers the `linkPreviews`
  // policy below on top: Data Saver forces `tap` unless previews are `off`.
  dataSaver: z.boolean().default(false),
  // Link-preview policy (repair X2.5, D5 default `tap`): `tap` shows a
  // tap-to-unfurl trigger and never fetches on its own; `auto-public`
  // fetches automatically for public posts only (never for
  // direct/followers/specified, regardless of pref); `off` shows no
  // unfurl affordance at all. Server-provided cards always render.
  linkPreviews: z.enum(['tap', 'auto-public', 'off']).default('tap'),
  // App-switcher privacy shield (repair X2.5, D6 default off): when on,
  // an opaque cover draws over the app on `inactive`/`background` so the
  // OS task-switcher snapshot shows nothing. Android `FLAG_SECURE`
  // needs a native module and is out of scope.
  privacyShield: z.boolean().default(false),
  // Page editor "show formatting" (P6.5 PG-2, default off): text blocks
  // render Raw source vs RichText while editing (ADR 0016 option B).
  // Device-local: no server field exists (sending one 400s on Sharkey).
  pageShowFormatting: z.boolean().default(false),
})

export const deviceStateSchema = z.object({
  version: z.literal(STORAGE_VERSION),
  activeSessionId: z.string().nullable(),
  prefs: devicePrefsSchema.default({}),
})

export type DeviceState = z.infer<typeof deviceStateSchema>

export const defaultDeviceState: DeviceState = {
  version: STORAGE_VERSION,
  activeSessionId: null,
  prefs: {theme: 'system', emojiStyle: 'openmoji', textScale: 1, contentMode: 'auto', onlyAuthorizedQuotes: false, dataSaver: false, linkPreviews: 'tap', privacyShield: false, pageShowFormatting: false},
}

// v1 device shape (frozen for migration): v1 had no `contentMode` and
// the version literal was 1. `migrateDeviceState` carries v1 prefs
// forward so upgrading never wipes theme/text-scale/emoji choices.
const deviceStateSchemaV1 = z.object({
  version: z.literal(1),
  activeSessionId: z.string().nullable(),
  prefs: z
    .object({
      theme: z.enum(['system', 'light', 'dark']).optional(),
      emojiStyle: z.enum(['openmoji', 'twemoji', 'noto', 'fluent', 'system']).optional(),
      textScale: z.number().min(0.5).max(4).optional(),
    })
    .default({}),
})

/** Parse stored device JSON across schema versions: current payloads
 * validate directly; v1 payloads migrate (prefs carried, `contentMode`
 * defaults to `auto`); forward-version payloads with a usable
 * active-session pointer keep the pointer (repair X1.3 S9 — never null
 * the mirror because prefs failed to parse) with default prefs;
 * anything else is the safe default. Never throws. */
export function migrateDeviceState(raw: string | null): DeviceState {
  if (!raw) return defaultDeviceState
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return defaultDeviceState
  }
  const current = deviceStateSchema.safeParse(parsed)
  if (current.success) return current.data
  const legacy = deviceStateSchemaV1.safeParse(parsed)
  if (legacy.success) {
    return {
      version: STORAGE_VERSION,
      activeSessionId: legacy.data.activeSessionId,
      prefs: {
        theme: legacy.data.prefs.theme ?? 'system',
        emojiStyle: legacy.data.prefs.emojiStyle ?? 'openmoji',
        textScale: legacy.data.prefs.textScale ?? 1,
        contentMode: 'auto',
        onlyAuthorizedQuotes: false,
        dataSaver: false,
        linkPreviews: 'tap',
        privacyShield: false,
        pageShowFormatting: false,
      },
    }
  }
  // Forward-version (or otherwise unknown-shape) payload with a usable
  // pointer: the prefs are unreadable but the mirror is not — keep it.
  // The pointer is only ever a boot fallback (`resolveActiveId`
  // validates it against stored sessions), so keeping it cannot conjure
  // a ghost session.
  if (typeof parsed === 'object' && parsed !== null) {
    const id = (parsed as {activeSessionId?: unknown}).activeSessionId
    if (typeof id === 'string' || id === null) {
      return {version: STORAGE_VERSION, activeSessionId: id, prefs: {...defaultDeviceState.prefs}}
    }
  }
  return defaultDeviceState
}

// Per-account prefs (v2): the v1 `contentMode` field was dead (never
// read) and content mode is device-local per v1 parity, so the account
// scope carries no prefs today. The scope and keying stay: future
// per-account prefs land here without a version bump.
const accountPrefsSchema = z.object({})

export const accountStateSchema = z.object({
  version: z.literal(STORAGE_VERSION),
  prefs: accountPrefsSchema.default({}),
})

export type AccountState = z.infer<typeof accountStateSchema>

export const defaultAccountState: AccountState = {
  version: STORAGE_VERSION,
  prefs: {},
}

export const DEVICE_KEY = 'keystone.device'

/** Forensic copy of the last unreadable-but-non-empty device blob (repair
 * X1.3 S9). Write-once: the first backup wins. Never read by the app. */
export const DEVICE_BAK_KEY = 'keystone.device.bak'

/** Per-account scope key. The session id already embeds the origin
 * (`"${origin} ${accountId}"`), so one account's prefs can never alias
 * another's — including same-user/different-origin pairs. */
export function accountKeyFor(sessionId: string): string {
  return `keystone.account.${sessionId}`
}

/** Backup of the last unreadable-but-non-empty per-account scope. A
 * separate prefix (never a suffix — repair X1.3 S11). Purged with the
 * session, never read by the app. */
export function accountBakKeyFor(sessionId: string): string {
  return `keystone.accountbak.${sessionId}`
}

/** Copy the live value of `key` to `bakKey` once (first backup wins; an
 * existing backup is kept even when the new bytes differ). Never throws —
 * forensics must never break the write they precede. */
export function ensureRawBackup(store: KeyValueStore, key: string, bakKey: string): void {
  let raw: string | null = null
  try {
    raw = store.getItem(key)
    if (!raw || store.getItem(bakKey) !== null) return
  } catch {
    return
  }
  try {
    store.setItem(bakKey, raw)
  } catch {
    // Forensics must never break the write they precede.
  }
}

/** True when `raw` parses as a current or v1 device payload. Anything
 * else non-empty must be backed up before overwriting (S9). */
export function isDevicePayloadReadable(raw: string | null): boolean {
  if (!raw) return true
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return false
  }
  return deviceStateSchema.safeParse(parsed).success || deviceStateSchemaV1.safeParse(parsed).success
}

/** True when `raw` parses as a current account payload. Anything else
 * non-empty must be backed up before overwriting (same rule as S9). */
export function isAccountPayloadReadable(raw: string | null): boolean {
  if (!raw) return true
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return false
  }
  return accountStateSchema.safeParse(parsed).success
}

/** Remove the per-account scope for a session (sign-out purge, X1.2),
 * including its forensic backup. The device scope (`DEVICE_KEY`) is
 * untouched. Never throws. */
export function purgeAccountScope(store: KeyValueStore, sessionId: string): void {
  if (!sessionId) return
  try {
    store.removeItem(accountKeyFor(sessionId))
  } catch {
    // Best-effort: local sign-out completes even on storage failure.
  }
  try {
    store.removeItem(accountBakKeyFor(sessionId))
  } catch {
    // Best-effort (see above).
  }
}

/** JSON-parse + schema-validate, falling back on ANY failure (missing
 * key, corrupt JSON, wrong version, partial/garbage shape). Never throws. */
export function parseOrFallback<S extends z.ZodTypeAny>(
  schema: S,
  raw: string | null,
  fallback: z.output<S>,
): z.output<S> {
  if (!raw) return fallback
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return fallback
  }
  const result = schema.safeParse(parsed)
  return result.success ? result.data : fallback
}
