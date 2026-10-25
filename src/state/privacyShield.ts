import {useSyncExternalStore} from 'react'

import type {KeyValueStore, VisibilityKind} from '@keystone/fedi'

import {appStorage, readDeviceState, writeDeviceState} from '#/storage'

// Privacy defaults (repair X2.5, D5/D6 defaults): link-preview policy
// plus the app-switcher shield, and the pure predicates the post UI
// shares (never auto for direct/followers/specified).
//
// Device scope, NOT per account — one choice follows the device across
// every signed-in account, matching the appearance prefs. Persisted
// through the app `KeyValueStore` inside the versioned device state.
// Android `FLAG_SECURE` (OS-level screenshot blocking) needs a native
// module and is out of scope; the shield is an in-app opaque cover.

/** Link-preview policy: `tap` (default) shows a tap-to-unfurl trigger
 * and never fetches on its own; `auto-public` fetches automatically for
 * public posts only; `off` shows no unfurl affordance at all. */
export type LinkPreviewMode = 'tap' | 'auto-public' | 'off'

/** Validated preview-mode parse: anything unknown falls back to `tap`. Pure. */
export function parseLinkPreviewMode(raw: string | null | undefined): LinkPreviewMode {
  return raw === 'auto-public' || raw === 'off' || raw === 'tap' ? raw : 'tap'
}

/** Visibility kinds that must never beacon: no auto-unfurl, no
 * auto-translate, share/copy behind a confirm. `specified` maps to
 * `direct` at the model layer, so both spellings are covered. Pure. */
export function isPrivateVisibility(kind: VisibilityKind): boolean {
  return kind === 'direct' || kind === 'followers'
}

/** Auto-unfurl only for public posts under the opt-in pref (D5: auto
 * only on public posts and only if the user opts in). Pure. */
export function shouldAutoUnfurl(mode: LinkPreviewMode, kind: VisibilityKind): boolean {
  return mode === 'auto-public' && kind === 'public'
}

/** Data Saver suppresses automatic loads on top of the pref (an explicit
 * `off` stays `off`): saver on + `auto-public` degrades to `tap`.
 * Pure. */
export function effectivePreviewMode(
  pref: LinkPreviewMode,
  dataSaver: boolean,
): LinkPreviewMode {
  if (pref === 'off') return 'off'
  return dataSaver ? 'tap' : pref
}

/** Manual translate of a private post sends its text to the user's own
 * server (which may call an external translator): show the one-line
 * notice first, once. Public posts are already world-readable. Pure. */
export function needsTranslateNotice(kind: VisibilityKind, noticeShown: boolean): boolean {
  return isPrivateVisibility(kind) && !noticeShown
}

/** App states where the OS may snapshot the screen (task switcher). */
export type ShieldAppState = 'active' | 'background' | 'inactive' | 'unknown' | 'extension'

/** The opaque cover shows while a DM/chat/conversation screen is focused
 * (forced by the screen, regardless of pref or app state), otherwise
 * only when the user opted in AND the app is backgrounded/inactive.
 * Pure — the host component owns the `AppState` subscription. */
export function shieldVisible(opts: {
  prefEnabled: boolean
  forced: boolean
  appState: ShieldAppState | string
}): boolean {
  if (opts.forced) return true
  return (
    opts.prefEnabled && (opts.appState === 'inactive' || opts.appState === 'background')
  )
}

export interface PrivacyStore {
  getLinkPreviewMode(): LinkPreviewMode
  setLinkPreviewMode(mode: LinkPreviewMode): void
  /** App-switcher shield (D6, default off). */
  getPrivacyShield(): boolean
  setPrivacyShield(value: boolean): void
  subscribe(fn: () => void): () => void
}

export function createPrivacyStore(
  storage: () => KeyValueStore = appStorage,
): PrivacyStore {
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of [...listeners]) listener()
  }
  return {
    getLinkPreviewMode(): LinkPreviewMode {
      return parseLinkPreviewMode(readDeviceState(storage()).prefs.linkPreviews ?? null)
    },
    setLinkPreviewMode(mode: LinkPreviewMode): void {
      const validated = parseLinkPreviewMode(mode)
      const state = readDeviceState(storage())
      if ((state.prefs.linkPreviews ?? 'tap') === validated) return
      writeDeviceState(storage(), {
        ...state,
        prefs: {...state.prefs, linkPreviews: validated},
      })
      emit()
    },
    getPrivacyShield(): boolean {
      return readDeviceState(storage()).prefs.privacyShield ?? false
    },
    setPrivacyShield(value: boolean): void {
      const next = value === true
      const state = readDeviceState(storage())
      if ((state.prefs.privacyShield ?? false) === next) return
      writeDeviceState(storage(), {
        ...state,
        prefs: {...state.prefs, privacyShield: next},
      })
      emit()
    },
    subscribe(fn: () => void): () => void {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}

export const privacyStore: PrivacyStore = createPrivacyStore()

export function useLinkPreviewMode(store: PrivacyStore = privacyStore): LinkPreviewMode {
  return useSyncExternalStore(store.subscribe, store.getLinkPreviewMode)
}

export function usePrivacyShield(store: PrivacyStore = privacyStore): boolean {
  return useSyncExternalStore(store.subscribe, store.getPrivacyShield)
}

// --- Conversation-forced shield -------------------------------------------------
// DM/chat/conversation screens set this while focused (via
// `useFocusEffect` or the focus/blur equivalent) so the cover is always
// on there, regardless of the user pref. Screens own the wiring; this
// module owns the flag. Never persisted: focus is per-launch state.

let conversationShield = false
const conversationListeners = new Set<() => void>()

function emitConversation() {
  for (const listener of [...conversationListeners]) listener()
}

/** Called by DM/chat/conversation screens on focus (`true`) and blur
 * (`false`). The cover takes over while any such screen is focused. */
export function setConversationShieldActive(active: boolean): void {
  const next = active === true
  if (conversationShield === next) return
  conversationShield = next
  emitConversation()
}

export function isConversationShieldActive(): boolean {
  return conversationShield
}

/** Test seam: reset the focus flag between tests. */
export function resetConversationShieldForTests(): void {
  conversationShield = false
  emitConversation()
}

export function useConversationShield(): boolean {
  return useSyncExternalStore(
    fn => {
      conversationListeners.add(fn)
      return () => {
        conversationListeners.delete(fn)
      }
    },
    isConversationShieldActive,
  )
}
