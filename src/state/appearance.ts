import {useSyncExternalStore} from 'react'

import {DEFAULT_EMOJI_STYLE, parseEmojiStyle, type EmojiStyle, type KeyValueStore} from '@keystone/fedi'

import {appStorage, readDeviceState, writeDeviceState} from '#/storage'

// Device appearance prefs (Settings slice): colour mode, text size, and the
// unicode-emoji art style.
//
// Device scope, NOT per account — one choice follows the device across
// every signed-in account, matching v1 (`frontend/src/state/appearance.tsx`:
// localStorage-backed, default OpenMoji / system mode / 1x scale).
// Persisted through the app `KeyValueStore` (MMKV) inside the versioned
// device state, so a fresh install reads the defaults and an unknown stored
// value falls back to them.

export type ColorMode = 'system' | 'light' | 'dark'

export const TEXT_SCALE_MIN = 0.5
export const TEXT_SCALE_MAX = 4
export const TEXT_SCALE_DEFAULT = 1

/** Validated colour-mode parse: anything unknown falls back to system. Pure. */
export function parseColorMode(raw: string | null | undefined): ColorMode {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

/** Clamp a scale into the 0.5–4x band; non-finite input resets to 1x. Pure. */
export function clampTextScale(n: number): number {
  if (!Number.isFinite(n)) return TEXT_SCALE_DEFAULT
  return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, n))
}

export interface AppearanceStore {
  getEmojiStyle(): EmojiStyle
  setEmojiStyle(style: EmojiStyle): void
  getColorMode(): ColorMode
  setColorMode(mode: ColorMode): void
  getTextScale(): number
  setTextScale(scale: number): void
  subscribe(fn: () => void): () => void
}

export function createAppearanceStore(
  storage: () => KeyValueStore = appStorage,
): AppearanceStore {
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of [...listeners]) listener()
  }
  return {
    getEmojiStyle(): EmojiStyle {
      return parseEmojiStyle(readDeviceState(storage()).prefs.emojiStyle ?? null)
    },
    setEmojiStyle(style: EmojiStyle): void {
      // Validated on write: garbage never persists, and subscribers only
      // fire when the stored value actually changes.
      const validated = parseEmojiStyle(style)
      const state = readDeviceState(storage())
      if (state.prefs.emojiStyle === validated) return
      writeDeviceState(storage(), {
        ...state,
        prefs: {...state.prefs, emojiStyle: validated},
      })
      emit()
    },
    getColorMode(): ColorMode {
      return parseColorMode(readDeviceState(storage()).prefs.theme ?? null)
    },
    setColorMode(mode: ColorMode): void {
      const validated = parseColorMode(mode)
      const state = readDeviceState(storage())
      if (state.prefs.theme === validated) return
      writeDeviceState(storage(), {
        ...state,
        prefs: {...state.prefs, theme: validated},
      })
      emit()
    },
    getTextScale(): number {
      return clampTextScale(readDeviceState(storage()).prefs.textScale ?? TEXT_SCALE_DEFAULT)
    },
    setTextScale(scale: number): void {
      const clamped = clampTextScale(scale)
      const state = readDeviceState(storage())
      if (state.prefs.textScale === clamped) return
      writeDeviceState(storage(), {
        ...state,
        prefs: {...state.prefs, textScale: clamped},
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

export const appearanceStore: AppearanceStore = createAppearanceStore()

export function useEmojiStyle(store: AppearanceStore = appearanceStore): EmojiStyle {
  return useSyncExternalStore(store.subscribe, store.getEmojiStyle)
}

export function useColorMode(store: AppearanceStore = appearanceStore): ColorMode {
  return useSyncExternalStore(store.subscribe, store.getColorMode)
}

export function useTextScale(store: AppearanceStore = appearanceStore): number {
  return useSyncExternalStore(store.subscribe, store.getTextScale)
}

export {DEFAULT_EMOJI_STYLE}
export type {EmojiStyle}
