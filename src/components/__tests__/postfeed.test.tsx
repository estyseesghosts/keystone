import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'
import {useState} from 'react'

import {createMemoryStore} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {postFeedQueryKey} from '#/components/PostFeed/index'
import {PostFeed} from '#/components/PostFeed/index'
import {SessionProvider} from '#/state/session/SessionProvider'
import {createSessionStore} from '#/state/session/store'

import {makePost} from './fixtures'

i18n.load('en', {})
i18n.activate('en')

const SESSION = 'sess-feed-1'

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

function renderFeed(ui: React.ReactElement, store = memoryStore()) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">
        <SessionProvider homeOrigin="https://example.social" store={store}>
          {ui}
        </SessionProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
}

describe('postFeedQueryKey', () => {
  it('includes the sessionId; different sessions key differently', () => {
    expect(postFeedQueryKey('a', 'timeline|home')).toEqual(['post-feed', 'a', 'timeline|home'])
    expect(postFeedQueryKey('a', 'timeline|home')).not.toEqual(postFeedQueryKey('b', 'timeline|home'))
  })
})

describe('PostFeed', () => {
  it('shows loading, then posts', () => {
    const {rerender} = renderFeed(<PostFeed sessionId={SESSION} descriptor="timeline|home" isLoading posts={[]} />)
    expect(screen.getByTestId('post-feed-loading')).toBeTruthy()
    rerender(
      <I18nProvider i18n={i18n}>
        <ThemeProvider theme="light">
          <SessionProvider homeOrigin="https://example.social" store={memoryStore()}>
            <PostFeed sessionId={SESSION} descriptor="timeline|home" posts={[makePost()]} />
          </SessionProvider>
        </ThemeProvider>
      </I18nProvider>,
    )
    expect(screen.getByTestId('post-p1')).toBeTruthy()
  })

  it('shows empty and error states with retry', () => {
    const onRefresh = jest.fn()
    const {unmount} = renderFeed(
      <PostFeed sessionId={SESSION} descriptor="timeline|home" posts={[]} />,
    )
    expect(screen.getByTestId('post-feed-empty')).toBeTruthy()
    unmount()
    renderFeed(
      <PostFeed sessionId={SESSION} descriptor="timeline|home" isError errorMessage="offline" onRefresh={onRefresh} />,
    )
    expect(screen.getByTestId('post-feed-error')).toBeTruthy()
    fireEvent.press(screen.getByTestId('post-feed-retry'))
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })

  it('shows the new-posts pill hook point', () => {
    const onSee = jest.fn()
    renderFeed(
      <PostFeed sessionId={SESSION} descriptor="timeline|home" posts={[makePost()]} hasNewPosts newPostsCount={3} onSeeNewPosts={onSee} />,
    )
    fireEvent.press(screen.getByTestId('new-posts-pill'))
    expect(onSee).toHaveBeenCalledTimes(1)
  })

  it('pull-to-refresh hook point wires onRefresh', () => {
    const onRefresh = jest.fn()
    renderFeed(<PostFeed sessionId={SESSION} descriptor="timeline|home" posts={[makePost()]} onRefresh={onRefresh} />)
    const list = screen.getByTestId('post-feed-list')
    const control = (list.props as {refreshControl?: {props: {onRefresh: () => void}}}).refreshControl
    expect(control).toBeTruthy()
    control?.props.onRefresh()
    expect(onRefresh).toHaveBeenCalledTimes(1)
  })
})

describe('feed regression guard (plan §3 lesson)', () => {
  it('renders an App tree with a fixture session asserting a post appears', () => {
    function Harness() {
      const [posts] = useState(() => [makePost({content: {mfm: 'guard post', plain: 'guard post'}})])
      return <PostFeed sessionId={SESSION} descriptor="timeline|home" posts={posts} />
    }
    renderFeed(<Harness />)
    // The provider tree (theme + session) must survive around the feed:
    // losing a provider killed every feed in the old app.
    expect(screen.getByText('guard post')).toBeTruthy()
  })
})
