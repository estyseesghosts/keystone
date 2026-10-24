// Adaptive composer height: the text field grows and shrinks with its
// content between a floor (the resting box) and a ceiling (past it the
// field scrolls internally). Driven by `onContentSizeChange`, which
// fires on native and on web (RN Web reports `scrollHeight`). Values
// round up and clamp; identical heights bail out in state, so there is
// no feedback loop with layout.
//
// Web shrink caveat: once an explicit height is set, `scrollHeight`
// never drops below it, so after deleting text the contentSize event
// keeps reporting the old (large) box and the field would only ever
// grow. `remeasure` fixes it: called on every text change, it drops the
// inline height for one synchronous read (`height: auto` → `scrollHeight`
// → restore, no paint in between) and clamps the true content height.
// Native keeps the event path (its content size is content-based).

import {useCallback, useRef, useState} from 'react'
import {
  Platform,
  type NativeSyntheticEvent,
  type TextInput,
  type TextInputContentSizeChangeEventData,
} from 'react-native'

type WebMeasurableNode = {
  style: {height: string}
  scrollHeight: number
}

/** The web textarea behind the ref, or null (native, or an
 * unexpected node shape — never a crash, never a guess). */
function asWebNode(ref: unknown): WebMeasurableNode | null {
  if (Platform.OS !== 'web' || typeof ref !== 'object' || ref === null) return null
  const node = ref as Partial<WebMeasurableNode>
  if (typeof node.scrollHeight !== 'number' || typeof node.style?.height !== 'string') {
    return null
  }
  return node as WebMeasurableNode
}

export function useAutogrowInput(minHeight: number, maxHeight: number) {
  const [height, setHeight] = useState<number | null>(null)
  const inputRef = useRef<TextInput | null>(null)
  const clamp = useCallback(
    (h: number) => setHeight(Math.min(maxHeight, Math.max(minHeight, Math.ceil(h)))),
    [minHeight, maxHeight],
  )
  const onContentSizeChange = useCallback(
    (e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      clamp(e.nativeEvent.contentSize.height)
    },
    [clamp],
  )
  const remeasure = useCallback(() => {
    const node = asWebNode(inputRef.current)
    if (!node) return
    node.style.height = 'auto'
    const h = node.scrollHeight
    node.style.height = ''
    clamp(h)
  }, [clamp])
  return {height, onContentSizeChange, inputRef, remeasure}
}

/** Style slice applying the measured height (null = resting minHeight). */
export function autogrowStyle(height: number | null): {height: number} | null {
  return height === null ? null : {height}
}
