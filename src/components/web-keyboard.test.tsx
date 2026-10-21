import {I18nProvider} from '@lingui/react'
import {act, fireEvent, render, screen} from '@testing-library/react-native'
import {Platform} from 'react-native'

import {ThemeProvider} from '#/alf/index'
import {i18n} from '#/locale/i18n'
import {Dialog} from '#/components/Dialog'
import {Menu, nextEnabledIndex} from '#/components/Menu'

i18n.load('en', {})
i18n.activate('en')

const realOS = Platform.OS

function setOS(os: string) {
  Object.defineProperty(Platform, 'OS', {value: os, configurable: true})
}

type Listener = (e: {
  key: string
  preventDefault: () => void
  stopPropagation: () => void
  target: {tagName: string}
}) => void
const listeners = new Set<Listener>()

function installDocument() {
  ;(globalThis as {document?: unknown}).document = {
    addEventListener: (_t: string, fn: Listener) => listeners.add(fn),
    removeEventListener: (_t: string, fn: Listener) => listeners.delete(fn),
  }
}

function key(keyName: string, tagName = 'DIV') {
  return {
    key: keyName,
    preventDefault: jest.fn(),
    stopPropagation: jest.fn(),
    target: {tagName},
  }
}

function pressKey(keyName: string, tagName = 'DIV') {
  act(() => {
    for (const fn of [...listeners]) fn(key(keyName, tagName))
  })
}

function renderWithProviders(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

beforeEach(() => {
  listeners.clear()
  installDocument()
  setOS('web')
})

afterEach(() => {
  setOS(realOS)
  delete (globalThis as {document?: unknown}).document
})

describe('nextEnabledIndex', () => {
  const items = [
    {key: 'a', label: 'A', onSelect: () => {}},
    {key: 'b', label: 'B', onSelect: () => {}, disabled: true, reason: 'No'},
    {key: 'c', label: 'C', onSelect: () => {}},
  ]
  it('skips disabled items and wraps around', () => {
    expect(nextEnabledIndex(items, 0, 1)).toBe(2)
    expect(nextEnabledIndex(items, 2, 1)).toBe(0)
    expect(nextEnabledIndex(items, 0, -1)).toBe(2)
    expect(nextEnabledIndex(items, 2, -1)).toBe(0)
  })
  it('stays put when everything is disabled', () => {
    const all = items.map(i => ({...i, disabled: true}))
    expect(nextEnabledIndex(all, 1, 1)).toBe(1)
  })
})

describe('Menu web keyboard', () => {
  it('arrows move focus, Enter selects, Escape closes; testIDs unchanged', () => {
    const onA = jest.fn()
    const onC = jest.fn()
    renderWithProviders(
      <Menu
        testID="m"
        label="Options"
        items={[
          {key: 'a', label: 'Copy link', onSelect: onA},
          {key: 'b', label: 'Schedule', onSelect: () => {}, disabled: true, reason: 'Nope'},
          {key: 'c', label: 'Share', onSelect: onC},
        ]}
      />,
    )
    fireEvent.press(screen.getByText('Options'))
    // Initial focus lands on the first enabled item.
    expect(screen.getByTestId('m-item-a').props.accessibilityState).toMatchObject({
      selected: true,
    })
    pressKey('ArrowDown')
    expect(screen.getByTestId('m-item-c').props.accessibilityState).toMatchObject({
      selected: true,
    })
    pressKey('ArrowDown')
    expect(screen.getByTestId('m-item-a').props.accessibilityState).toMatchObject({
      selected: true,
    })
    pressKey('ArrowUp')
    expect(screen.getByTestId('m-item-c').props.accessibilityState).toMatchObject({
      selected: true,
    })
    pressKey('Enter')
    expect(onC).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('m-item-c')).toBeNull()
    // Reopen, then Escape closes without selecting.
    fireEvent.press(screen.getByText('Options'))
    pressKey('Escape')
    expect(screen.queryByTestId('m-item-a')).toBeNull()
    expect(onA).not.toHaveBeenCalled()
  })

  it('ignores arrows/Enter while typing in a field', () => {
    const onA = jest.fn()
    renderWithProviders(
      <Menu testID="m" label="Options" items={[{key: 'a', label: 'Go', onSelect: onA}]} />,
    )
    fireEvent.press(screen.getByText('Options'))
    pressKey('Enter', 'INPUT')
    expect(onA).not.toHaveBeenCalled()
    expect(screen.getByTestId('m-item-a')).toBeTruthy()
  })
})

describe('Dialog web keyboard', () => {
  it('Escape closes the dialog', () => {
    const onClose = jest.fn()
    renderWithProviders(
      <Dialog testID="d" open onClose={onClose} title="Title">
        <></>
      </Dialog>,
    )
    pressKey('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
