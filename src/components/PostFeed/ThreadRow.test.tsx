import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {render, screen} from '@testing-library/react-native'

import {createMemoryStore} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {PostFeed} from '#/components/PostFeed/index'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'

import {makePost} from '#/components/__tests__/fixtures'

i18n.load('en', {})
i18n.activate('en')

const SESSION = 'sess-thread-1'

function memoryStore() {
  return createSessionStore({
    storage: createMemoryStore(),
    vault: {
      getToken: async () => null,
      setToken: async () => {},
      removeToken: async () => {},
    },
    homeOrigin: 'https://example.social',
  })
}

function renderFeed(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <SessionProvider homeOrigin="https://example.social" store={memoryStore()}>
          {ui}
        </SessionProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
}

describe('ThreadRow connectors', () => {
  it('connects a reply to its adjacent parent, both rows carry the line', () => {
    const parent = makePost({id: 'parent-1'})
    const reply = makePost({id: 'reply-1', replyToId: parent.id})
    renderFeed(<PostFeed sessionId={SESSION} descriptor="timeline|home" posts={[reply, parent]} />)
    expect(screen.getByTestId('thread-connector-reply-1')).toBeTruthy()
    expect(screen.getByTestId('thread-connector-parent-1')).toBeTruthy()
  })

  it('renders no connector for standalone posts', () => {
    const a = makePost({id: 'solo-a'})
    const b = makePost({id: 'solo-b'})
    renderFeed(<PostFeed sessionId={SESSION} descriptor="timeline|home" posts={[a, b]} />)
    expect(screen.queryByTestId('thread-connector-solo-a')).toBeNull()
    expect(screen.queryByTestId('thread-connector-solo-b')).toBeNull()
  })

  it('renders no connector when the parent is not adjacent', () => {
    const parent = makePost({id: 'p-root'})
    const other = makePost({id: 'p-other'})
    const reply = makePost({id: 'p-reply', replyToId: parent.id})
    renderFeed(
      <PostFeed sessionId={SESSION} descriptor="timeline|home" posts={[reply, other, parent]} />,
    )
    expect(screen.queryByTestId('thread-connector-p-reply')).toBeNull()
    expect(screen.queryByTestId('thread-connector-p-other')).toBeNull()
    expect(screen.queryByTestId('thread-connector-p-root')).toBeNull()
  })
})

describe('ThreadRow separators (v1 feed rule)', () => {
  it('bounds standalone posts but not the first row', () => {
    const a = makePost({id: 'sep-a'})
    const b = makePost({id: 'sep-b'})
    renderFeed(<PostFeed sessionId={SESSION} descriptor="timeline|home" posts={[a, b]} />)
    expect(screen.queryByTestId('thread-separator-sep-a')).toBeNull()
    expect(screen.getByTestId('thread-separator-sep-b')).toBeTruthy()
  })

  it('draws no internal separators inside a connected reply run', () => {
    const parent = makePost({id: 'sep-parent'})
    const reply = makePost({id: 'sep-reply', replyToId: parent.id})
    const next = makePost({id: 'sep-next'})
    renderFeed(
      <PostFeed sessionId={SESSION} descriptor="timeline|home" posts={[reply, parent, next]} />,
    )
    // The thread line joins reply→parent; the next block starts clean.
    expect(screen.queryByTestId('thread-separator-sep-reply')).toBeNull()
    expect(screen.queryByTestId('thread-separator-sep-parent')).toBeNull()
    expect(screen.getByTestId('thread-separator-sep-next')).toBeTruthy()
  })
})
