import {fireEvent, render, screen} from '@testing-library/react-native'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'

import {buildCapabilities, createMemoryStore, type Backend, type Session} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'

import {Composer} from './Composer'

jest.mock('./pickMedia', () => ({pickMedia: jest.fn(async () => [])}))
jest.mock('@keystone/fedi', () => ({
  ...jest.requireActual('@keystone/fedi'),
  fetchComposeLimits: jest.fn(async () => ({maxChars: 500, maxMedia: 4, maxPollOptions: 4})),
}))
jest.mock('#/components/EmojiPicker', () => {
  const {Pressable} = require('react-native')
  const {Body} = require('#/alf/typography')
  return {
    EmojiPicker: ({onPick}: {onPick: (e: {key: string; url: string | null}) => void}) => (
      <Pressable testID="fake-pick" onPress={() => onPick({key: ':blobcat:', url: 'u'})}>
        <Body>pick</Body>
      </Pressable>
    ),
  }
})

i18n.load('en', {})
i18n.activate('en')

it('emoji button opens the picker and inserts the key at the caret', () => {
  const session = {id: 's me', origin: 'https://s.example', family: 'misskey', flavor: 'sharkey', accountId: 'me', token: 't'} as unknown as Session
  const backend = {
    family: 'misskey',
    capabilities: buildCapabilities('sharkey'),
    customEmojis: jest.fn().mockResolvedValue([]),
    search: {},
  } as unknown as Backend
  render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <QueryClientProvider client={new QueryClient()}>
          <Composer session={session} backend={backend} store={createMemoryStore()} onClose={jest.fn()} />
        </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
  fireEvent.changeText(screen.getByTestId('composer-text'), 'hi ')
  fireEvent(screen.getByTestId('composer-text'), 'selectionChange', {nativeEvent: {selection: {start: 3, end: 3}}})
  fireEvent.press(screen.getByTestId('composer-emoji-button'))
  fireEvent.press(screen.getByTestId('fake-pick'))
  expect(screen.getByTestId('composer-text').props.value).toBe('hi :blobcat:')
  expect(screen.queryByTestId('fake-pick')).toBeNull()
})
