import {i18n} from '@lingui/core'
import {FEDI_ERROR_CODES} from '@keystone/fedi'

import {errorText, formatFediError, isKnownErrorCode, toCodedError} from './localeErrors'

i18n.load('en', {})
i18n.activate('en')

describe('localeErrors', () => {
  it('knows every FediError code the data layer throws (X9.7 union)', () => {
    // Single source of truth lives in `packages/fedi` (`FEDI_ERROR_CODES`):
    // a code added there fails typecheck until it has a descriptor here,
    // and this test fails if the table ever drops one.
    expect(FEDI_ERROR_CODES.length).toBeGreaterThan(0)
    for (const code of FEDI_ERROR_CODES) expect(isKnownErrorCode(code)).toBe(true)
  })

  it('interpolates params and falls back for unknown codes', () => {
    expect(
      formatFediError(i18n, {code: 'errors.network.timeoutInstance', params: {target: 'GET /x', n: 10}}),
    ).toContain('10')
    expect(formatFediError(i18n, {code: 'errors.nope.unknown'})).toBe('Action failed.')
    expect(formatFediError(i18n, null)).toBe('Action failed.')
  })

  it('toCodedError only passes known codes with object params', () => {
    expect(toCodedError({code: 'errors.shape.noPoll', params: {}})).toEqual({
      code: 'errors.shape.noPoll',
      params: {},
    })
    // Server wire codes are data, not UI codes — never passed through.
    expect(toCodedError({code: 'PERMISSION_DENIED'})).toBeNull()
    expect(toCodedError({code: 'QUOTE_DISABLED_FOR_USER'})).toBeNull()
    expect(toCodedError(new Error('boom'))).toBeNull()
    expect(toCodedError(null)).toBeNull()
    expect(toCodedError('errors.shape.noPoll')).toBeNull()
    // Non-object params are dropped rather than rendered.
    expect(toCodedError({code: 'errors.shape.tag', params: 'x'})).toEqual({
      code: 'errors.shape.tag',
    })
  })

  it('errorText localizes known codes and keeps the caller fallback otherwise', () => {
    expect(errorText(i18n, {code: 'errors.shape.tag', params: {name: 'cats'}}, 'fallback')).toContain(
      'cats',
    )
    expect(errorText(i18n, new Error('server said no'), 'Could not post.')).toBe('Could not post.')
    expect(errorText(i18n, {code: 'PERMISSION_DENIED'}, 'fallback')).toBe('fallback')
  })
})
