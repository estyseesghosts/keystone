import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {fireEvent, render, screen} from '@testing-library/react-native'

import {ThemeProvider} from '#/alf/index'
import {PostCard} from '#/components/Post/index'
import {navigationRef} from '#/navigationRef'

import {makePost} from './fixtures'

i18n.load('en', {})
i18n.activate('en')

const SESSION = 'sess-1'

function renderCard(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

describe('PostCard navigation (v1 parity)', () => {
  let navigateSpy: jest.SpyInstance
  beforeEach(() => {
    jest.spyOn(navigationRef, 'isReady').mockReturnValue(true)
    navigateSpy = jest.spyOn(navigationRef, 'navigate').mockImplementation(() => {})
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('tapping the avatar opens the author profile', () => {
    renderCard(<PostCard post={makePost()} sessionId={SESSION} />)
    fireEvent.press(screen.getByTestId('avatar-press-a1'))
    expect(navigateSpy).toHaveBeenCalledWith('Main', {
      screen: 'User',
      params: {id: 'a1'},
    })
  })

  it('tapping the name/handle header opens the author profile', () => {
    renderCard(<PostCard post={makePost()} sessionId={SESSION} />)
    fireEvent.press(screen.getByTestId('author-press-a1'))
    expect(navigateSpy).toHaveBeenCalledWith('Main', {
      screen: 'User',
      params: {id: 'a1'},
    })
  })

  it('tapping the body or the time opens the post detail', () => {
    renderCard(<PostCard post={makePost()} sessionId={SESSION} />)
    fireEvent.press(screen.getByTestId('post-open-p1'))
    expect(navigateSpy).toHaveBeenCalledWith('Note', {id: 'p1'})
    navigateSpy.mockClear()
    fireEvent.press(screen.getByTestId('post-time-p1'))
    expect(navigateSpy).toHaveBeenCalledWith('Note', {id: 'p1'})
  })

  it('does nothing without a mounted navigator (presentational trees)', () => {
    jest.restoreAllMocks()
    jest.spyOn(navigationRef, 'isReady').mockReturnValue(false)
    const quiet = jest.spyOn(navigationRef, 'navigate').mockImplementation(() => {})
    renderCard(<PostCard post={makePost()} sessionId={SESSION} />)
    fireEvent.press(screen.getByTestId('avatar-press-a1'))
    fireEvent.press(screen.getByTestId('post-open-p1'))
    expect(quiet).not.toHaveBeenCalled()
  })
})

describe('PostCard mention routing (F9)', () => {
  let navigateSpy: jest.SpyInstance
  beforeEach(() => {
    jest.spyOn(navigationRef, 'isReady').mockReturnValue(true)
    navigateSpy = jest.spyOn(navigationRef, 'navigate').mockImplementation(() => {})
  })
  afterEach(() => {
    jest.restoreAllMocks()
  })

  it('tapping an MFM mention opens the profile by handle', () => {
    renderCard(
      <PostCard post={makePost({content: {mfm: 'hi @bob@ex.ample', plain: 'hi @bob@ex.ample'}})} sessionId={SESSION} />,
    )
    fireEvent.press(screen.getByText('@bob@ex.ample'))
    expect(navigateSpy).toHaveBeenCalledWith('Main', {
      screen: 'User',
      params: {acct: 'bob@ex.ample'},
    })
  })

  it('tapping a local MFM mention omits the host', () => {
    renderCard(
      <PostCard post={makePost({content: {mfm: 'hi @alice', plain: 'hi @alice'}})} sessionId={SESSION} />,
    )
    fireEvent.press(screen.getByText('@alice'))
    expect(navigateSpy).toHaveBeenCalledWith('Main', {
      screen: 'User',
      params: {acct: 'alice'},
    })
  })
})
