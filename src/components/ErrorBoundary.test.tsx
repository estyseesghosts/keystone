// Error boundaries (repair X8.1): fallback rows, retry re-renders, logger
// capture, and the feed-row integration (throwing PostCard collapses to
// one fallback row while the list stays scrollable).

import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'
import {Text} from 'react-native'

import {createMemoryStore} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {ErrorBoundary} from '#/components/ErrorBoundary'
import {PostFeed} from '#/components/PostFeed/index'
import {makePost} from '#/components/__tests__/fixtures'
import {i18n as appI18n} from '#/locale/i18n'
import {addSink, type LogRecord} from '#/lib/logger'
import {createSessionStore} from '#/state/session/store'
import {SessionProvider} from '#/state/session/SessionProvider'

const SESSION = 'sess-boundary-1'

// Post ids whose card throws during render (a malformed server payload).
// Named `mock*` so the `jest.mock` factory below may reference it.
const mockThrowIds = new Set<string>()

jest.mock('#/components/Post/index', () => {
  const actual = jest.requireActual('#/components/Post/index')
  const React = require('react')
  return {
    ...actual,
    PostCard: (props: {post: {id: string}}) => {
      if (mockThrowIds.has(props.post.id)) {
        throw new Error(`boom ${props.post.id} Bearer secret-abc-123`)
      }
      return React.createElement(actual.PostCard, props)
    },
  }
})

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

function renderTree(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={appI18n}>
      <ThemeProvider theme="light">
        <SessionProvider homeOrigin="https://example.social" store={memoryStore()}>
          {ui}
        </SessionProvider>
      </ThemeProvider>
    </I18nProvider>,
  )
}

function failingTree(variant: 'root' | 'screen', fail: () => boolean, extra?: {onSignOut?: () => void}) {
  const Maybe = () => {
    if (fail()) throw new Error('screen boom Bearer s3cr3t-tok')
    return <Text>recovered</Text>
  }
  return (
    <ErrorBoundary variant={variant} onSignOut={extra?.onSignOut}>
      <Maybe />
    </ErrorBoundary>
  )
}

beforeEach(() => {
  mockThrowIds.clear()
})

describe('ErrorBoundary variants', () => {
  it('renders children when nothing throws', () => {
    renderTree(
      <ErrorBoundary variant="screen">
        <Text>fine</Text>
      </ErrorBoundary>,
    )
    expect(screen.getByText('fine')).toBeTruthy()
  })

  it('screen variant shows a retry UI and retry re-renders', () => {
    let fail = true
    renderTree(failingTree('screen', () => fail))
    expect(screen.getByTestId('screen-error')).toBeTruthy()
    fail = false
    fireEvent.press(screen.getByTestId('screen-error-retry'))
    expect(screen.queryByTestId('screen-error')).toBeNull()
    expect(screen.getByText('recovered')).toBeTruthy()
  })

  it('root variant offers try-again and sign-out', () => {
    let fail = true
    const onSignOut = jest.fn()
    renderTree(failingTree('root', () => fail, {onSignOut}))
    expect(screen.getByTestId('root-error')).toBeTruthy()
    fireEvent.press(screen.getByTestId('root-error-signout'))
    expect(onSignOut).toHaveBeenCalledTimes(1)
    fail = false
    fireEvent.press(screen.getByTestId('root-error-retry'))
    expect(screen.queryByTestId('root-error')).toBeNull()
    expect(screen.getByText('recovered')).toBeTruthy()
  })

  it('root variant omits sign-out when no handler is given', () => {
    renderTree(failingTree('root', () => true))
    expect(screen.getByTestId('root-error')).toBeTruthy()
    expect(screen.queryByTestId('root-error-signout')).toBeNull()
  })

  it('capture reaches the logger redacted (privacy 13)', () => {
    const seen: LogRecord[] = []
    const dispose = addSink(r => seen.push(r))
    try {
      renderTree(failingTree('screen', () => true))
      expect(screen.getByTestId('screen-error')).toBeTruthy()
      const records = seen.filter(r => r.level === 'error' && r.message.includes('boundary'))
      expect(records).toHaveLength(1)
      expect(records[0].detail).toContain('screen boom')
      expect(records[0].detail).not.toContain('s3cr3t-tok')
    } finally {
      dispose()
    }
  })
})

describe('ErrorBoundary row preset in a feed list', () => {
  function feedPosts() {
    return [
      makePost({id: 'good-1', content: {mfm: 'row one is fine', plain: 'row one is fine'}}),
      makePost({id: 'boom-1', content: {mfm: 'bad row', plain: 'bad row'}}),
      makePost({id: 'good-2', content: {mfm: 'row three is fine', plain: 'row three is fine'}}),
    ]
  }

  it('a throwing PostCard collapses to one fallback row; the list stays scrollable; the error reaches the logger', () => {
    mockThrowIds.add('boom-1')
    const seen: LogRecord[] = []
    const dispose = addSink(r => seen.push(r))
    try {
      renderTree(<PostFeed sessionId={SESSION} descriptor="timeline|home" posts={feedPosts()} />)
      // One fallback row with the translated message…
      expect(screen.getByTestId('post-row-error')).toBeTruthy()
      expect(screen.getByText("Couldn't show this post")).toBeTruthy()
      // …siblings intact…
      expect(screen.getByTestId('thread-row-good-1')).toBeTruthy()
      expect(screen.getByTestId('thread-row-good-2')).toBeTruthy()
      expect(screen.getByText(/row one is fine/)).toBeTruthy()
      expect(screen.getByText(/row three is fine/)).toBeTruthy()
      // …list mounted and still scrollable after a scroll event…
      const list = screen.getByTestId('post-feed-list')
      fireEvent.scroll(list, {
        nativeEvent: {
          contentOffset: {x: 0, y: 200},
          contentSize: {width: 400, height: 2000},
          layoutMeasurement: {width: 400, height: 800},
        },
      })
      expect(screen.getByTestId('post-row-error')).toBeTruthy()
      expect(screen.getByText(/row one is fine/)).toBeTruthy()
      // …and the error reached the logger, redacted.
      const records = seen.filter(r => r.level === 'error' && r.message.includes('boundary'))
      expect(records).toHaveLength(1)
      expect(records[0].message).toContain('boom-1')
      expect(records[0].detail).toContain('boom boom-1')
      expect(records[0].detail).not.toContain('secret-abc-123')
    } finally {
      dispose()
    }
  })

  it('row retry re-renders the post once it stops throwing', () => {
    mockThrowIds.add('boom-1')
    renderTree(
      <PostFeed
        sessionId={SESSION}
        descriptor="timeline|home"
        posts={[makePost({id: 'boom-1', content: {mfm: 'back soon', plain: 'back soon'}})]}
      />,
    )
    expect(screen.getByTestId('post-row-error')).toBeTruthy()
    mockThrowIds.delete('boom-1')
    fireEvent.press(screen.getByTestId('post-row-retry'))
    expect(screen.queryByTestId('post-row-error')).toBeNull()
    expect(screen.getByTestId('thread-row-boom-1')).toBeTruthy()
  })
})
