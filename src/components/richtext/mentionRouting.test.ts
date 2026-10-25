// X2.3: `openExternal` vets every target (defence in depth — the AST is
// vetted at parse, but this helper never trusts its caller) and the
// failure toast never echoes the URL.
import {Linking} from 'react-native'

import {openExternal, vettedExternalUrl} from './mentionRouting'
import {showToast} from '#/lib/toast'

jest.mock('#/lib/toast', () => ({showToast: jest.fn()}))

const toast = showToast as unknown as jest.Mock

describe('vettedExternalUrl', () => {
  it('allows http(s) URLs', () => {
    expect(vettedExternalUrl('https://a.b/c')).toBe('https://a.b/c')
    expect(vettedExternalUrl('http://a.b/')).toBe('http://a.b/')
  })

  it('refuses javascript:, tel:, intent:, file:, and data: URLs', () => {
    for (const href of [
      'javascript:alert(1)',
      'tel:+123456',
      'intent://a.b/#Intent;scheme=https;end',
      'file:///etc/passwd',
      'data:text/html,<p>x</p>',
      'java\0script:alert(1)',
      '/local/path',
    ]) {
      expect(vettedExternalUrl(href)).toBeNull()
    }
  })

  it('refuses mailto: unless the caller allows it', () => {
    expect(vettedExternalUrl('mailto:x@y.z')).toBeNull()
    expect(vettedExternalUrl('mailto:x@y.z', {allowMailto: true})).toBe('mailto:x@y.z')
  })
})

describe('openExternal', () => {
  beforeEach(() => {
    toast.mockClear()
    jest.restoreAllMocks()
  })

  it('opens the vetted URL and never the raw string', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    openExternal('https://a.b/c')
    expect(open).toHaveBeenCalledTimes(1)
    expect(open).toHaveBeenCalledWith('https://a.b/c')
    expect(toast).not.toHaveBeenCalled()
  })

  it('refuses dangerous schemes without opening and toasts generically', () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined)
    for (const href of ['javascript:alert(1)', 'tel:+123', 'intent://x', 'file:///x', 'data:text/html,x']) {
      toast.mockClear()
      open.mockClear()
      openExternal(href)
      expect(open).not.toHaveBeenCalled()
      expect(toast).toHaveBeenCalledTimes(1)
      expect(toast).toHaveBeenCalledWith('Could not open this link.')
    }
  })

  it('toasts a generic message with no URL echo when the open fails', async () => {
    jest.spyOn(Linking, 'openURL').mockRejectedValue(new Error('boom'))
    openExternal('https://private.example/secret-path?token=abc')
    await Promise.resolve()
    await Promise.resolve()
    expect(toast).toHaveBeenCalledTimes(1)
    const message = String(toast.mock.calls[0]?.[0] ?? '')
    expect(message).toBe('Could not open this link.')
    expect(message).not.toContain('private.example')
    expect(message).not.toContain('token')
  })
})
