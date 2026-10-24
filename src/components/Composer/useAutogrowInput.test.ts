// useAutogrowInput: floor/ceiling clamping, one measuring path per
// platform, unconditional web remeasure on every text change.
import {act, renderHook} from '@testing-library/react-native'
import {Platform} from 'react-native'

import {useAutogrowInput} from './useAutogrowInput'

function sizeEvent(height: number) {
  return {nativeEvent: {contentSize: {height}}} as never
}

/** Fake web textarea: RNW sets height via class, so inline starts empty. */
function webNode(scrollHeight: number) {
  return {style: {height: ''}, scrollHeight}
}

function withWebOs(fn: () => void) {
  const prevOS = Platform.OS
  ;(Platform as {OS: string}).OS = 'web'
  try {
    fn()
  } finally {
    ;(Platform as {OS: string}).OS = prevOS
  }
}

describe('useAutogrowInput', () => {
  it('rests at null, clamps content height to [min, max], and contracts', () => {
    const {result} = renderHook(() => useAutogrowInput(72, 320, ''))
    expect(result.current.height).toBeNull()
    act(() => result.current.onContentSizeChange(sizeEvent(10)))
    expect(result.current.height).toBe(72)
    act(() => result.current.onContentSizeChange(sizeEvent(200.2)))
    expect(result.current.height).toBe(201)
    act(() => result.current.onContentSizeChange(sizeEvent(900)))
    expect(result.current.height).toBe(320)
    act(() => result.current.onContentSizeChange(sizeEvent(90)))
    expect(result.current.height).toBe(90)
  })

  it('ignores remeasure off web (native content size is content-based)', () => {
    const {result} = renderHook(() => useAutogrowInput(72, 320, 'hi'))
    const node = webNode(90)
    act(() => {
      ;(result.current.inputRef as {current: unknown}).current = node
      result.current.remeasure()
    })
    // iOS test env: no DOM node read, height untouched.
    expect(result.current.height).toBeNull()
    expect(node.style.height).toBe('')
  })

  it('measures on mount and on every text change, up and down', () => {
    withWebOs(() => {
      const hook = renderHook(({text}: {text: string}) => useAutogrowInput(72, 320, text), {
        initialProps: {text: 'hi'},
      })
      // Mount with text present: the post-commit measure sizes the box.
      const node = webNode(90)
      act(() => {
        ;(hook.result.current.inputRef as {current: unknown}).current = node
      })
      // Effect already ran on mount (empty node then); drive a text change.
      const grown = webNode(200)
      act(() => {
        ;(hook.result.current.inputRef as {current: unknown}).current = grown
      })
      hook.rerender({text: 'hi there, much longer now'})
      expect(hook.result.current.height).toBe(200)
      // The node keeps the measured height synchronously: a repeat
      // measure with the same value bails out of state but must not
      // leave the DOM cleared (the frozen-box regression).
      expect(grown.style.height).toBe('200px')
      // Deleting measures down — no stuck tall box, no snap.
      const shrunk = webNode(80)
      act(() => {
        ;(hook.result.current.inputRef as {current: unknown}).current = shrunk
      })
      hook.rerender({text: 'hi'})
      expect(hook.result.current.height).toBe(80)
      expect(shrunk.style.height).toBe('80px')
    })
  })

  it('leaves the DOM at the measured height when state bails out (no frozen box)', () => {
    withWebOs(() => {
      const hook = renderHook(({text}: {text: string}) => useAutogrowInput(72, 320, text), {
        initialProps: {text: 'x'},
      })
      const node = webNode(150)
      act(() => {
        ;(hook.result.current.inputRef as {current: unknown}).current = node
      })
      hook.rerender({text: 'y'})
      expect(hook.result.current.height).toBe(150)
      expect(node.style.height).toBe('150px')
      // Same content, new text key: the effect remeasures, state bails
      // out as identical, but the DOM must still show the measured box.
      hook.rerender({text: 'y!'})
      expect(node.style.height).toBe('150px')
      // And the pre-paint path is equally non-destructive on repeats.
      act(() => {
        hook.result.current.remeasure()
      })
      expect(node.style.height).toBe('150px')
      expect(hook.result.current.height).toBe(150)
    })
  })

  it('clamps the measured box to [min, max]', () => {
    withWebOs(() => {
      const hook = renderHook(({text}: {text: string}) => useAutogrowInput(72, 320, text), {
        initialProps: {text: 'x'},
      })
      const empty = webNode(0)
      act(() => {
        ;(hook.result.current.inputRef as {current: unknown}).current = empty
      })
      hook.rerender({text: 'y'})
      expect(hook.result.current.height).toBe(72)
      const tall = webNode(900)
      act(() => {
        ;(hook.result.current.inputRef as {current: unknown}).current = tall
      })
      hook.rerender({text: 'y!'})
      expect(hook.result.current.height).toBe(320)
    })
  })

  it('ignores a malformed node instead of crashing', () => {
    withWebOs(() => {
      const hook = renderHook(({text}: {text: string}) => useAutogrowInput(72, 320, text), {
        initialProps: {text: 'x'},
      })
      act(() => {
        ;(hook.result.current.inputRef as {current: unknown}).current = {
          style: {},
          scrollHeight: 'big',
        }
      })
      hook.rerender({text: 'y'})
      expect(hook.result.current.height).toBeNull()
    })
  })
})
