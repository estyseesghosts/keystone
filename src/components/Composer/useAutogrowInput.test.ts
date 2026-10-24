// useAutogrowInput: floor/ceiling clamping for adaptive composer height,
// plus the web shrink path (scrollHeight sticks to the old box).
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

describe('useAutogrowInput', () => {
  it('rests at null, clamps content height to [min, max], and contracts', () => {
    const {result} = renderHook(() => useAutogrowInput(72, 320))
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
    const {result} = renderHook(() => useAutogrowInput(72, 320))
    act(() => result.current.onContentSizeChange(sizeEvent(200)))
    expect(result.current.height).toBe(200)
    const node = webNode(90)
    act(() => {
      ;(result.current.inputRef as {current: unknown}).current = node
      result.current.remeasure()
    })
    // iOS test env: no DOM node read, height untouched.
    expect(result.current.height).toBe(200)
    expect(node.style.height).toBe('')
  })

  it('contracts on web by measuring the unconstrained box', () => {
    const prevOS = Platform.OS
    ;(Platform as {OS: string}).OS = 'web'
    try {
      const {result} = renderHook(() => useAutogrowInput(72, 320))
      // Type the long post: the event reports the grown box.
      act(() => result.current.onContentSizeChange(sizeEvent(200)))
      expect(result.current.height).toBe(200)
      // Delete most of it: the stuck event would repeat 200, so the
      // caller remeasures — the reset exposes the true 90px content.
      const node = webNode(90)
      act(() => {
        ;(result.current.inputRef as {current: unknown}).current = node
        result.current.remeasure()
      })
      expect(result.current.height).toBe(90)
      // Inline height is restored (React state stays the source of truth).
      expect(node.style.height).toBe('')
      // Empty box clamps back to the floor.
      const empty = webNode(0)
      act(() => {
        ;(result.current.inputRef as {current: unknown}).current = empty
        result.current.remeasure()
      })
      expect(result.current.height).toBe(72)
      // Ceiling still holds on the way up.
      const tall = webNode(900)
      act(() => {
        ;(result.current.inputRef as {current: unknown}).current = tall
        result.current.remeasure()
      })
      expect(result.current.height).toBe(320)
    } finally {
      ;(Platform as {OS: string}).OS = prevOS
    }
  })

  it('ignores a malformed node instead of crashing', () => {
    const prevOS = Platform.OS
    ;(Platform as {OS: string}).OS = 'web'
    try {
      const {result} = renderHook(() => useAutogrowInput(72, 320))
      act(() => {
        ;(result.current.inputRef as {current: unknown}).current = {style: {}, scrollHeight: 'big'}
        result.current.remeasure()
      })
      expect(result.current.height).toBeNull()
    } finally {
      ;(Platform as {OS: string}).OS = prevOS
    }
  })
})
