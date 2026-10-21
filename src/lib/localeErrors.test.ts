import {i18n} from '@lingui/core'

import {formatFediError, isKnownErrorCode} from './localeErrors'

i18n.load('en', {})
i18n.activate('en')

describe('localeErrors', () => {
  it('knows every FediError code the data layer throws', () => {
    const codes = [
      'errors.validation.hostRequired',
      'errors.validation.hostScheme',
      'errors.validation.hostInvalid',
      'errors.network.crossOrigin',
      'errors.network.badPath',
      'errors.network.unreachableBare',
      'errors.network.timeoutInstance',
      'errors.network.timeoutServer',
      'errors.network.unreachableInstance',
      'errors.network.unreachableOrigin',
      'errors.network.unreachableServer',
      'errors.network.badJson',
      'errors.network.apiError',
      'errors.auth.noKeystoneToken',
      'errors.auth.noCredentials',
      'errors.auth.signinFailed',
      'errors.auth.mfaRequired',
      'errors.auth.mfaFailed',
      'errors.auth.noVerifyAccount',
      'errors.auth.savePending',
      'errors.unsupported.pinned',
      'errors.unsupported.social',
      'errors.unsupported.reactions',
      'errors.unsupported.featured',
      'errors.unsupported.avatar',
      'errors.unsupported.noAccountRef',
      'errors.unsupported.noAccountFound',
      'errors.unsupported.boostVisibility',
      'errors.shape.createdPost',
      'errors.shape.createdList',
      'errors.shape.updatedList',
      'errors.shape.updatedProfile',
      'errors.shape.uploadedMedia',
      'errors.shape.noTranslation',
      'errors.shape.noScheduled',
      'errors.shape.noPoll',
      'errors.shape.relationships',
      'errors.shape.statusContext',
      'errors.shape.mediaLookup',
      'errors.shape.timeline',
      'errors.shape.account',
      'errors.shape.status',
      'errors.shape.trendingTags',
      'errors.shape.trendingStatuses',
      'errors.shape.trendingLinks',
      'errors.shape.suggestions',
      'errors.shape.expectedList',
      'errors.reactions.likeUnsupported',
      'errors.compose.fileTooLarge',
      'errors.filter.invalidRegex',
      'errors.feeds.invalidDescriptor',
    ]
    expect(codes).toHaveLength(51)
    for (const code of codes) expect(isKnownErrorCode(code)).toBe(true)
  })

  it('interpolates params and falls back for unknown codes', () => {
    expect(
      formatFediError(i18n, {code: 'errors.network.timeoutInstance', params: {target: 'GET /x', n: 10}}),
    ).toContain('10')
    expect(formatFediError(i18n, {code: 'errors.nope.unknown'})).toBe('Action failed.')
    expect(formatFediError(i18n, null)).toBe('Action failed.')
  })
})
