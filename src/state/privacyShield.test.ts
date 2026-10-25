// Repair X2.5: privacy defaults — prefs, pure policy predicates, the
// conversation-forced shield flag, and the logger/token redaction test
// (privacy 13, via the session redact helper).
import {createMemoryStore, sessionWithoutToken, type Session} from '@keystone/fedi'

import {readDeviceState, writeDeviceState} from '#/storage'
import {emitStorageWriteFailed} from '#/storage/storageEvents'

import {
  createPrivacyStore,
  effectivePreviewMode,
  isConversationShieldActive,
  isPrivateVisibility,
  needsTranslateNotice,
  parseLinkPreviewMode,
  resetConversationShieldForTests,
  setConversationShieldActive,
  shieldVisible,
  shouldAutoUnfurl,
} from './privacyShield'

function setup() {
  const storage = createMemoryStore()
  return {storage, store: createPrivacyStore(() => storage)}
}

function sessionWithToken(token: string): Session {
  return {
    id: 'https://secret.example u1',
    origin: 'https://secret.example',
    family: 'misskey',
    flavor: 'misskey',
    accountId: 'u1',
    token,
    grant: 'miauth',
    hosting: 'first-party',
  }
}

describe('privacy prefs (repair X2.5)', () => {
  it('defaults to tap-to-unfurl with the shield off on a fresh install', () => {
    const {store} = setup()
    expect(store.getLinkPreviewMode()).toBe('tap')
    expect(store.getPrivacyShield()).toBe(false)
  })

  it('round-trips both prefs through device state', () => {
    const {storage, store} = setup()
    const listener = jest.fn()
    store.subscribe(listener)
    store.setLinkPreviewMode('auto-public')
    store.setPrivacyShield(true)
    expect(store.getLinkPreviewMode()).toBe('auto-public')
    expect(store.getPrivacyShield()).toBe(true)
    expect(readDeviceState(storage).prefs.linkPreviews).toBe('auto-public')
    expect(readDeviceState(storage).prefs.privacyShield).toBe(true)
    expect(listener).toHaveBeenCalled()
  })

  it('does not notify when the value is unchanged', () => {
    const {store} = setup()
    const listener = jest.fn()
    store.subscribe(listener)
    store.setLinkPreviewMode('tap')
    store.setPrivacyShield(false)
    expect(listener).not.toHaveBeenCalled()
  })

  it('falls back to tap on an unknown stored mode', () => {
    expect(parseLinkPreviewMode('auto-always')).toBe('tap')
    expect(parseLinkPreviewMode(null)).toBe('tap')
    expect(parseLinkPreviewMode(undefined)).toBe('tap')
  })

  it('fills defaults for stored payloads written before X2.5', () => {
    const {storage, store} = setup()
    writeDeviceState(storage, {
      ...readDeviceState(storage),
      prefs: {
        theme: 'dark',
        emojiStyle: 'openmoji',
        textScale: 1,
        contentMode: 'auto',
        onlyAuthorizedQuotes: false,
        dataSaver: false,
        linkPreviews: 'tap',
        privacyShield: false,
      },
    })
    expect(store.getLinkPreviewMode()).toBe('tap')
    expect(store.getPrivacyShield()).toBe(false)
  })
})

describe('preview policy predicates (repair X2.5, D5)', () => {
  it.each(['direct', 'followers'] as const)('treats %s as private', kind => {
    expect(isPrivateVisibility(kind)).toBe(true)
  })

  it.each(['public', 'quiet'] as const)('treats %s as non-private', kind => {
    expect(isPrivateVisibility(kind)).toBe(false)
  })

  it('auto-unfurls only for public posts under the opt-in pref', () => {
    expect(shouldAutoUnfurl('auto-public', 'public')).toBe(true)
    // The pref matrix: tap/off never auto, for any visibility.
    for (const mode of ['tap', 'off'] as const) {
      for (const kind of ['public', 'quiet', 'followers', 'direct'] as const) {
        expect(shouldAutoUnfurl(mode, kind)).toBe(false)
      }
    }
    // No auto for direct/followers/specified even when opted in.
    expect(shouldAutoUnfurl('auto-public', 'followers')).toBe(false)
    expect(shouldAutoUnfurl('auto-public', 'direct')).toBe(false)
    expect(shouldAutoUnfurl('auto-public', 'quiet')).toBe(false)
  })

  it('layers Data Saver on top of the pref (saver forces tap, off stays off)', () => {
    expect(effectivePreviewMode('tap', false)).toBe('tap')
    expect(effectivePreviewMode('auto-public', false)).toBe('auto-public')
    expect(effectivePreviewMode('auto-public', true)).toBe('tap')
    expect(effectivePreviewMode('off', false)).toBe('off')
    expect(effectivePreviewMode('off', true)).toBe('off')
  })

  it('asks for the translate notice only for private posts, once', () => {
    expect(needsTranslateNotice('direct', false)).toBe(true)
    expect(needsTranslateNotice('followers', false)).toBe(true)
    expect(needsTranslateNotice('direct', true)).toBe(false)
    expect(needsTranslateNotice('public', false)).toBe(false)
    expect(needsTranslateNotice('quiet', false)).toBe(false)
  })
})

describe('shield visibility (repair X2.5, D6)', () => {
  it('is off by default, even backgrounded', () => {
    expect(
      shieldVisible({prefEnabled: false, forced: false, appState: 'background'}),
    ).toBe(false)
    expect(shieldVisible({prefEnabled: false, forced: false, appState: 'active'})).toBe(false)
  })

  it('covers on inactive/background only when the user opted in', () => {
    expect(shieldVisible({prefEnabled: true, forced: false, appState: 'active'})).toBe(false)
    expect(
      shieldVisible({prefEnabled: true, forced: false, appState: 'inactive'}),
    ).toBe(true)
    expect(
      shieldVisible({prefEnabled: true, forced: false, appState: 'background'}),
    ).toBe(true)
  })

  it('is always on while a conversation screen is focused', () => {
    expect(shieldVisible({prefEnabled: false, forced: true, appState: 'active'})).toBe(true)
    expect(shieldVisible({prefEnabled: true, forced: true, appState: 'active'})).toBe(true)
  })
})

describe('conversation shield flag (repair X2.5)', () => {
  beforeEach(() => {
    resetConversationShieldForTests()
  })

  it('starts unfocused and toggles with focus/blur', () => {
    expect(isConversationShieldActive()).toBe(false)
    setConversationShieldActive(true)
    expect(isConversationShieldActive()).toBe(true)
    setConversationShieldActive(false)
    expect(isConversationShieldActive()).toBe(false)
  })
})

describe('logger redaction (privacy 13)', () => {
  it('the session redact helper strips the bearer token (nothing to log)', () => {
    const redacted = sessionWithoutToken(sessionWithToken('SECRET-TOKEN-abc123'))
    expect(redacted.token).toBe('')
    expect(JSON.stringify(redacted)).not.toContain('SECRET-TOKEN-abc123')
  })

  it('a redacted envelope round-trips without the token', () => {
    const redacted = sessionWithoutToken(sessionWithToken('tok-live-xyz'))
    expect({...redacted, token: 'tok-live-xyz'}).toEqual(sessionWithToken('tok-live-xyz'))
    expect(JSON.stringify(redacted)).not.toMatch(/tok-live-xyz/)
  })

  it('storage write failures log scope only (never keys, values, or tokens)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      emitStorageWriteFailed('keystone_sessions')
      expect(warn).toHaveBeenCalled()
      const logged = warn.mock.calls.map(call => JSON.stringify(call)).join('\n')
      // Scope words only — no key material, no values, no bearer.
      expect(logged).not.toContain('keystone_sessions')
      expect(logged).not.toContain('SECRET')
      expect(logged).not.toContain('tok-live')
    } finally {
      warn.mockRestore()
    }
  })
})
