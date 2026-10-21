import {z} from 'zod'

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
  prefs: {theme: 'system', emojiStyle: 'openmoji', textScale: 1, contentMode: 'auto', onlyAuthorizedQuotes: false},
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
 * defaults to `auto`); anything else is the safe default. Never throws. */
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
      },
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

/** Per-account scope key. The session id already embeds the origin
 * (`"${origin} ${accountId}"`), so one account's prefs can never alias
 * another's — including same-user/different-origin pairs. */
export function accountKeyFor(sessionId: string): string {
  return `keystone.account.${sessionId}`
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
