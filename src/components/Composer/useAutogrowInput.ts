// Adaptive composer height: the text field grows and shrinks with its
// content between a floor (the resting box) and a ceiling (past it the
// field scrolls internally). Driven by `onContentSizeChange`, which
// fires on native and on web (RN Web reports `scrollHeight`). Values
// round up and clamp; identical heights bail out in state, so there is
// no feedback loop with layout.

import {useCallback, useState} from 'react'
import type {NativeSyntheticEvent, TextInputContentSizeChangeEventData} from 'react-native'

export function useAutogrowInput(minHeight: number, maxHeight: number) {
  const [height, setHeight] = useState<number | null>(null)
  const onContentSizeChange = useCallback(
    (e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      const h = e.nativeEvent.contentSize.height
      setHeight(Math.min(maxHeight, Math.max(minHeight, Math.ceil(h))))
    },
    [minHeight, maxHeight],
  )
  return {height, onContentSizeChange}
}

/** Style slice applying the measured height (null = resting minHeight). */
export function autogrowStyle(height: number | null): {height: number} | null {
  return height === null ? null : {height}
}
