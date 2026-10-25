// Account reactions block: the unsupported state renders through the
// catalog (translated chrome), and reacted rows render server data as-is.

import {render, screen} from '@testing-library/react-native'

import {ThemeProvider} from '#/alf/index'
import {makePost} from '#/components/__tests__/fixtures'
import {i18n} from '#/locale/i18n'

import {AccountReactionsBlock} from './AccountReactions'

function setup(backend: any, locale: 'en' | 'fr' = 'en') {
  i18n.load('en', {})
  i18n.activate(locale)
  return render(
    <ThemeProvider theme="light">
      <AccountReactionsBlock backend={backend} accountId="u1" />
    </ThemeProvider>,
  )
}

describe('AccountReactionsBlock', () => {
  it('renders the honest unsupported state without an accountReactions member', async () => {
    const {unmount} = setup({})
    try {
      expect(await screen.findByTestId('account-reactions-unavailable')).toBeTruthy()
      expect(screen.getByText('Reactions are not available on this server.')).toBeTruthy()
    } finally {
      unmount()
    }
  })

  it('renders the unsupported state through the catalog (translated)', async () => {
    i18n.load('fr', {'accountReactions.unsupported': 'FR_NO_REACTIONS'})
    const {unmount} = setup({}, 'fr')
    try {
      expect(await screen.findByText('FR_NO_REACTIONS')).toBeTruthy()
    } finally {
      i18n.activate('en')
      unmount()
    }
  })

  it('renders reacted rows with server data as-is', async () => {
    const post = makePost({id: 'n1', content: {mfm: 'hello', plain: 'hello'}})
    const backend = {
      accountReactions: jest.fn(async () => ({
        items: [{id: 'r1', createdAt: '2026-10-20T00:00:00.000Z', reaction: '❤', post}],
        cursor: null,
        end: true,
      })),
    }
    const {unmount} = setup(backend)
    try {
      expect(await screen.findByText('Recent reactions')).toBeTruthy()
      expect(screen.getByText('❤')).toBeTruthy()
      expect(screen.getByText('hello')).toBeTruthy()
    } finally {
      unmount()
    }
  })
})
