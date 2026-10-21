import {useSyncExternalStore} from 'react'

import {i18n, type Messages} from '@lingui/core'

import type {KeyValueStore} from '@keystone/fedi'

import {appStorage} from '#/storage'

import {messages as messagesDe} from './locales/de/messages'
import {messages as messagesEn} from './locales/en/messages'
import {messages as messagesFr} from './locales/fr/messages'
import {messages as messagesHi} from './locales/hi/messages'
import {messages as messagesJa} from './locales/ja/messages'
import {messages as messagesYueHk} from './locales/yue-HK/messages'
import {messages as messagesZhCn} from './locales/zh-CN/messages'
import {messages as messagesZhTw} from './locales/zh-TW/messages'

// App locale (P5): the 8 carried Keystone locales (v1
// `frontend/src/i18n` parity). Own-storage-key pref store following the
// `feedPrefs` pattern — device-local, validated parse, `'en'` fallback,
// subscriber notify. The catalog for every locale is statically imported
// (small: UI chrome only) so switching is synchronous with no loader UI.
//
// Re-render: `Root` already wraps the tree in `I18nProvider` bound to this
// same `i18n` singleton, and `I18nProvider` re-renders on `activate` — so
// no coordinator touch is needed in `Root.tsx` for switching to work.

export const SUPPORTED_LOCALES = [
  {code: 'en', nativeName: 'English'},
  {code: 'fr', nativeName: 'Français'},
  {code: 'de', nativeName: 'Deutsch'},
  {code: 'zh-CN', nativeName: '简体中文'},
  {code: 'zh-TW', nativeName: '繁體中文'},
  {code: 'yue-HK', nativeName: '廣東話'},
  {code: 'ja', nativeName: '日本語'},
  {code: 'hi', nativeName: 'हिन्दी'},
] as const

export type LocaleCode = (typeof SUPPORTED_LOCALES)[number]['code']

export function isLocaleCode(code: unknown): code is LocaleCode {
  return SUPPORTED_LOCALES.some(l => l.code === code)
}

const CATALOGS: Record<LocaleCode, Messages> = {
  en: messagesEn,
  fr: messagesFr,
  de: messagesDe,
  'zh-CN': messagesZhCn,
  'zh-TW': messagesZhTw,
  'yue-HK': messagesYueHk,
  ja: messagesJa,
  hi: messagesHi,
}

export const LOCALE_STORAGE_KEY = 'keystone.locale'
export const DEFAULT_LOCALE: LocaleCode = 'en'

/** Validated parse of the stored locale: anything unknown is `'en'`. Pure. */
export function parseLocale(raw: string | null): LocaleCode {
  if (!raw) return DEFAULT_LOCALE
  let code: unknown = raw
  try {
    code = JSON.parse(raw)
  } catch {
    // Bare (unquoted) codes from older builds still parse as themselves.
  }
  if (typeof code !== 'string') return DEFAULT_LOCALE
  const trimmed = code.trim()
  return isLocaleCode(trimmed) ? trimmed : DEFAULT_LOCALE
}

export interface LocaleStore {
  get(): LocaleCode
  set(code: LocaleCode): void
  subscribe(fn: () => void): () => void
}

export function createLocaleStore(
  storage: () => KeyValueStore = appStorage,
): LocaleStore {
  const listeners = new Set<() => void>()
  const emit = () => {
    for (const listener of [...listeners]) listener()
  }
  const read = (): LocaleCode => {
    try {
      return parseLocale(storage().getItem(LOCALE_STORAGE_KEY))
    } catch {
      return DEFAULT_LOCALE
    }
  }
  // Cached by reference: `useSyncExternalStore` needs a stable snapshot.
  let cached: LocaleCode | null = null
  const get = (): LocaleCode => {
    if (!cached) cached = read()
    return cached
  }
  const load = (code: LocaleCode): void => {
    try {
      i18n.load(code, CATALOGS[code] ?? {})
      i18n.activate(code)
    } catch {
      // A broken catalog never blanks the UI: stay on the current locale.
    }
  }
  return {
    get,
    set(code: LocaleCode): void {
      if (!isLocaleCode(code) || code === get()) return
      cached = code
      try {
        storage().setItem(LOCALE_STORAGE_KEY, JSON.stringify(code))
      } catch {
        // Storage unavailable: the locale lasts for this session only.
      }
      load(code)
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

export const localeStore: LocaleStore = createLocaleStore()

// Boot the stored locale synchronously at import: the first render already
// speaks the reader's language. Failures fall back to English, never blank.
try {
  const boot = localeStore.get()
  i18n.load(boot, CATALOGS[boot] ?? {})
  i18n.activate(boot)
} catch {
  try {
    i18n.load(DEFAULT_LOCALE, CATALOGS[DEFAULT_LOCALE] ?? {})
    i18n.activate(DEFAULT_LOCALE)
  } catch {
    // Last resort: the pre-existing empty-en behaviour.
  }
}

export function useLocale(store: LocaleStore = localeStore): LocaleCode {
  return useSyncExternalStore(store.subscribe, store.get)
}

/** Persist + activate a locale (drives `I18nProvider` re-render). */
export function setLocale(code: LocaleCode, store: LocaleStore = localeStore): void {
  store.set(code)
}

/** This BCP-47 tag is already what `Intl.*` wants (`yue-HK` included). */
export function localeTag(code: LocaleCode): string {
  return code
}

/** Locale-aware counter formatting; raw numerals on any failure. Pure. */
export function formatCount(locale: LocaleCode, n: number): string {
  try {
    return new Intl.NumberFormat(localeTag(locale)).format(n)
  } catch {
    return String(n)
  }
}

export {i18n}
