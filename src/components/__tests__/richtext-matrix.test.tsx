// Matrix user-ID chips in the sole renderer: chip label, native
// tap-to-copy, and the hovercard content (web hover behavior itself
// lives in the shared HoverLayer, pinned by its own tests).
import {i18n} from '@lingui/core'
import {I18nProvider} from '@lingui/react'
import {act, fireEvent, render, screen} from '@testing-library/react-native'
import {Platform} from 'react-native'

import type {ContentNode} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {MatrixHovercard, RichText} from '#/components/RichText'
import {copyText} from '#/lib/clipboard'

jest.mock('#/lib/clipboard', () => ({
  canCopy: () => true,
  copyText: jest.fn(async () => {}),
}))

i18n.load('en', {})
i18n.activate('en')

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

const MATRIX_NODES: ContentNode[] = [
  {kind: 'text', text: 'chat '},
  {kind: 'matrix', userId: '@jm:nope.chat', children: [{kind: 'text', text: '@jm:nope.chat'}]},
  {kind: 'text', text: ' ok'},
]

describe('RichText matrix chips', () => {
  it('renders the [m] chip without the @, never a profile link', () => {
    renderWithProviders(<RichText nodes={MATRIX_NODES} />)
    expect(screen.getByTestId('richtext-matrix-chip')).toBeTruthy()
    expect(screen.getByText('[m] jm:nope.chat')).toBeTruthy()
    expect(screen.queryByTestId('richtext-mention-chip')).toBeNull()
  })

  it('copies the handle on tap (native: no hover)', async () => {
    renderWithProviders(<RichText nodes={MATRIX_NODES} />)
    fireEvent.press(screen.getByTestId('richtext-matrix-chip'))
    await Promise.resolve()
    expect(copyText).toHaveBeenCalledWith('@jm:nope.chat')
  })
})

describe('MatrixHovercard', () => {
  it('shows the exact handle, the description, and a working Copy handle', async () => {
    renderWithProviders(<MatrixHovercard userId="@jm:nope.chat" />)
    expect(screen.getByTestId('matrix-popup')).toBeTruthy()
    expect(screen.getByTestId('matrix-popup-handle')).toHaveTextContent('@jm:nope.chat')
    expect(screen.getByText(/secure and decentralized messaging protocol/)).toBeTruthy()
    fireEvent.press(screen.getByTestId('matrix-copy'))
    await Promise.resolve()
    expect(copyText).toHaveBeenCalledWith('@jm:nope.chat')
  })
})

describe('MatrixHover keyboard (X10.1, a11y 12)', () => {
  it('opens the hovercard on focus after the delay and closes on blur', () => {
    const restoreOs = jest.replaceProperty(Platform, 'OS', 'web')
    jest.useFakeTimers()
    try {
      const {unmount} = renderWithProviders(<RichText nodes={MATRIX_NODES} />)
      try {
        // The anchor wraps the chip; focus bubbles to it on web (in the
        // test renderer events do not bubble, so fire on the anchor — not
        // on the chip, whose own hover/focus props are RN pressability
        // plumbing).
        const anchor = screen.getByTestId('richtext-matrix-hover-anchor')
        expect(screen.queryByTestId('matrix-popup')).toBeNull()
        fireEvent(anchor, 'focus')
        act(() => {
          jest.advanceTimersByTime(399)
        })
        expect(screen.queryByTestId('matrix-popup')).toBeNull()
        act(() => {
          jest.advanceTimersByTime(1)
        })
        expect(screen.getByTestId('matrix-popup')).toBeTruthy()
        fireEvent(anchor, 'blur')
        act(() => {
          jest.advanceTimersByTime(551)
        })
        expect(screen.queryByTestId('matrix-popup')).toBeNull()
      } finally {
        unmount()
      }
    } finally {
      restoreOs.restore()
      jest.useRealTimers()
    }
  })
})
