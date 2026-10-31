// P6.5 Pages slice 5: toolbar — apply per control, link dialog,
// active state, focus-gated visibility. Icon row (owner 2026-10-31
// page-editor-cards): the nine controls render as vector icons; labels
// live in accessibilityLabel, testIDs are unchanged.

import {act, fireEvent, render, screen} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'

import {i18n} from '#/locale/i18n'
import {ThemeProvider} from '#/alf/index'
import {pageFormatPrefStore} from '#/state/pageFormatPref'

import {FormatToolbar, applyFormatControl} from './FormatToolbar'
import {TextBlockEditor} from './BlockEditors'
import type {BlockEditorContext} from './BlockList'

i18n.load('en', {})
i18n.activate('en')

function renderUi(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

function ctx(over: Partial<BlockEditorContext> = {}): BlockEditorContext {
  return {
    dispatch: jest.fn(),
    backend: null,
    sessionId: null,
    mediaById: new Map(),
    onPickMedia: jest.fn(),
    onOpenDrivePicker: jest.fn(),
    testID: 'ed',
    ...over,
  }
}

describe('applyFormatControl', () => {
  it('wraps the selection and returns the caret between markers', () => {
    expect(applyFormatControl('hello', {start: 1, end: 4}, 'bold')).toEqual({
      text: 'h**ell**o',
      selection: {start: 3, end: 6},
    })
  })

  it('toggles off when already wrapped', () => {
    expect(applyFormatControl('h**ell**o', {start: 3, end: 6}, 'bold')).toEqual({
      text: 'hello',
      selection: {start: 1, end: 4},
    })
  })

  it('empty selection inserts markers with the caret between', () => {
    const out = applyFormatControl('hi', {start: 1, end: 1}, 'italic')
    expect(out.text).toBe('h<i></i>i')
    expect(out.selection).toEqual({start: 4, end: 4})
  })

  it('quotes every selected line', () => {
    const out = applyFormatControl('a\nb', {start: 0, end: 3}, 'quote')
    expect(out.text).toBe('> a\n> b')
  })

  it('links with the given url', () => {
    const out = applyFormatControl('tap', {start: 0, end: 3}, 'link', 'https://a.example/x')
    expect(out.text).toBe('[tap](https://a.example/x)')
  })
})

describe('FormatToolbar', () => {
  it('shows all nine controls with active state', () => {
    const onApply = jest.fn()
    renderUi(
      <FormatToolbar text="h**ell**o" selection={{start: 3, end: 6}} onApply={onApply} testID="tb" />,
    )
    for (const c of ['bold', 'italic', 'strike', 'code', 'codeblock', 'quote', 'link', 'center', 'small']) {
      expect(screen.getByTestId(`tb-${c}`)).toBeTruthy()
    }
    expect(screen.getByTestId('tb-bold').props.accessibilityState.selected).toBe(true)
    expect(screen.getByTestId('tb-italic').props.accessibilityState.selected).toBe(false)
    fireEvent.press(screen.getByTestId('tb-strike'))
    expect(onApply).toHaveBeenCalledWith('strike')
  })

  it('link opens the dialog; junk URL errors, http URL applies', () => {
    const onApply = jest.fn()
    renderUi(
      <FormatToolbar text="tap here" selection={{start: 0, end: 3}} onApply={onApply} testID="tb" />,
    )
    fireEvent.press(screen.getByTestId('tb-link'))
    expect(screen.getByTestId('tb-link-url')).toBeTruthy()
    fireEvent.changeText(screen.getByTestId('tb-link-url'), 'javascript:alert(1)')
    fireEvent.press(screen.getByTestId('tb-link-insert'))
    expect(screen.getByText('Enter an http(s) URL.')).toBeTruthy()
    expect(onApply).not.toHaveBeenCalled()
    fireEvent.changeText(screen.getByTestId('tb-link-url'), 'https://a.example/x')
    fireEvent.press(screen.getByTestId('tb-link-insert'))
    expect(onApply).toHaveBeenCalledWith('link', 'https://a.example/x')
  })

  it('prefills the dialog when the selection is a URL', () => {
    renderUi(
      <FormatToolbar
        text="see https://a.example/x now"
        selection={{start: 4, end: 23}}
        onApply={jest.fn()}
        testID="tb"
      />,
    )
    fireEvent.press(screen.getByTestId('tb-link'))
    expect(screen.getByTestId('tb-link-url').props.value).toBe('https://a.example/x')
  })
})

describe('TextBlockEditor toolbar visibility', () => {
  afterEach(() => {
    act(() => pageFormatPrefStore.set(true))
  })

  it('rendered mode (default on): toolbar appears on tap, applies on press', () => {
    pageFormatPrefStore.set(true)
    const dispatch = jest.fn()
    renderUi(
      <TextBlockEditor block={{kind: 'text', id: 'b1', text: 'hello'}} ctx={ctx({dispatch})} testID="ed-block-b1" />,
    )
    // Unfocused: rendered RichText instead of the raw input; no toolbar.
    expect(screen.queryByTestId('ed-block-b1-toolbar')).toBeNull()
    expect(screen.getByTestId('ed-block-b1-rendered')).toBeTruthy()
    fireEvent.press(screen.getByTestId('ed-block-b1-rendered'))
    const input = screen.getByTestId('ed-block-b1')
    expect(screen.getByTestId('ed-block-b1-toolbar')).toBeTruthy()
    fireEvent(input, 'selectionChange', {nativeEvent: {selection: {start: 1, end: 4}}})
    fireEvent.press(screen.getByTestId('ed-block-b1-toolbar-bold'))
    expect(dispatch).toHaveBeenCalledWith({type: 'updateBlock', id: 'b1', patch: {text: 'h**ell**o'}})
    fireEvent(input, 'blur')
    expect(screen.queryByTestId('ed-block-b1-toolbar')).toBeNull()
  })

  it('raw mode (pref off): hides the toolbar until focused, applies on press', () => {
    pageFormatPrefStore.set(false)
    const dispatch = jest.fn()
    renderUi(
      <TextBlockEditor block={{kind: 'text', id: 'b1', text: 'hello'}} ctx={ctx({dispatch})} testID="ed-block-b1" />,
    )
    expect(screen.queryByTestId('ed-block-b1-toolbar')).toBeNull()
    const input = screen.getByTestId('ed-block-b1')
    fireEvent(input, 'focus')
    expect(screen.getByTestId('ed-block-b1-toolbar')).toBeTruthy()
    fireEvent(input, 'selectionChange', {nativeEvent: {selection: {start: 1, end: 4}}})
    fireEvent.press(screen.getByTestId('ed-block-b1-toolbar-bold'))
    expect(dispatch).toHaveBeenCalledWith({type: 'updateBlock', id: 'b1', patch: {text: 'h**ell**o'}})
    fireEvent(input, 'blur')
    expect(screen.queryByTestId('ed-block-b1-toolbar')).toBeNull()
  })
})
