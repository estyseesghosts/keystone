import {I18nProvider} from '@lingui/react'
import {act, fireEvent, render, screen} from '@testing-library/react-native'
import {Platform} from 'react-native'
import {useRef} from 'react'

import {ThemeProvider} from '#/alf/index'
import {i18n} from '#/locale/i18n'
import {Dialog} from '#/components/Dialog'
import {Menu, nextEnabledIndex} from '#/components/Menu'
import {keyboardLayerDepth, pushKeyboardLayer} from '#/components/keyboardLayer'
import {useModalFocus} from '#/components/modalFocus'

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

  it('carries dialog modal semantics', () => {
    const {unmount} = renderWithProviders(
      <Dialog testID="d" open onClose={() => {}} title="Title">
        <></>
      </Dialog>,
    )
    try {
      // Region semantics sit on the Modal content root (backdrop included),
      // so the dismiss backdrop stays queryable — never on the sheet
      // alone, which would hide its sibling backdrop from assistive tech.
      const region = screen.UNSAFE_getByProps({'aria-modal': true})
      expect(region.props.role).toBe('dialog')
      expect(region.props.accessibilityViewIsModal).toBe(true)
      expect(screen.getByTestId('d-backdrop')).toBeTruthy()
      // The title inherits the header role from Heading.
      expect(screen.getByText('Title').props.accessibilityRole).toBe('header')
    } finally {
      unmount()
    }
  })
})

describe('keyboard layer stack (X10.1)', () => {
  it('routes only to the top layer; popping restores the next', () => {
    const calls: Array<string> = []
    const popA = pushKeyboardLayer(() => calls.push('a'))
    const popB = pushKeyboardLayer(() => calls.push('b'))
    expect(keyboardLayerDepth()).toBe(2)
    try {
      pressKey('Escape')
      expect(calls).toEqual(['b'])
      popB()
      expect(keyboardLayerDepth()).toBe(1)
      pressKey('Escape')
      expect(calls).toEqual(['b', 'a'])
      // Popping twice is a no-op, never unbalances the stack.
      popB()
      expect(keyboardLayerDepth()).toBe(1)
    } finally {
      popA()
    }
    expect(keyboardLayerDepth()).toBe(0)
  })

  it('detaches the document listener when the stack empties', () => {
    const pop = pushKeyboardLayer(() => {})
    expect(listeners.size).toBe(1)
    pop()
    expect(listeners.size).toBe(0)
    expect(keyboardLayerDepth()).toBe(0)
  })

  it('Menu inside Dialog: first Escape closes the Menu, second the Dialog', () => {
    const onDialogClose = jest.fn()
    const onPick = jest.fn()
    const {unmount} = renderWithProviders(
      <Dialog testID="d" open onClose={onDialogClose} title="Title">
        <Menu
          testID="m"
          label="Options"
          items={[{key: 'a', label: 'Pick me', onSelect: onPick}]}
        />
      </Dialog>,
    )
    try {
      fireEvent.press(screen.getByText('Options'))
      expect(screen.getByTestId('m-item-a')).toBeTruthy()
      // First Escape: only the Menu (top layer) fires.
      pressKey('Escape')
      expect(screen.queryByTestId('m-item-a')).toBeNull()
      expect(onDialogClose).not.toHaveBeenCalled()
      expect(onPick).not.toHaveBeenCalled()
      // Second Escape: the Dialog is top now.
      pressKey('Escape')
      expect(onDialogClose).toHaveBeenCalledTimes(1)
    } finally {
      unmount()
    }
  })
})

describe('modal focus in/out (X10.1)', () => {
  function FocusHarness({active, container}: {active: boolean; container: unknown}) {
    const ref = useRef<unknown>(null)
    ref.current = container
    useModalFocus(active, ref)
    return null
  }

  function installFocusDocument(activeElement: unknown) {
    ;(globalThis as {document?: unknown}).document = {
      activeElement,
      addEventListener: (_t: string, fn: Listener) => listeners.add(fn),
      removeEventListener: (_t: string, fn: Listener) => listeners.delete(fn),
    }
  }

  it('focuses the first focusable on open and returns to the opener on close', () => {
    const first = {focus: jest.fn()}
    const second = {focus: jest.fn()}
    const prev = {focus: jest.fn()}
    installFocusDocument(prev)
    const container = {querySelectorAll: () => [first, second]}
    const {unmount} = renderWithProviders(<FocusHarness active container={container} />)
    expect(first.focus).toHaveBeenCalledTimes(1)
    expect(second.focus).not.toHaveBeenCalled()
    unmount()
    expect(prev.focus).toHaveBeenCalledTimes(1)
  })

  it('falls back to the container when nothing inside is focusable', () => {
    const containerFocus = jest.fn()
    installFocusDocument(null)
    const container = {querySelectorAll: () => [], focus: containerFocus}
    const {unmount} = renderWithProviders(<FocusHarness active container={container} />)
    try {
      expect(containerFocus).toHaveBeenCalledTimes(1)
    } finally {
      unmount()
    }
  })

  it('does nothing while inactive', () => {
    const first = {focus: jest.fn()}
    installFocusDocument(null)
    const container = {querySelectorAll: () => [first]}
    const {unmount} = renderWithProviders(<FocusHarness active={false} container={container} />)
    try {
      expect(first.focus).not.toHaveBeenCalled()
    } finally {
      unmount()
    }
  })
})
