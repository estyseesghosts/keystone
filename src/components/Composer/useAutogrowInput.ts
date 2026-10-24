// Adaptive composer height: the text field grows and shrinks with its
// content between a floor (the resting box) and a ceiling (past it the
// field scrolls internally).
//
// Two cooperating paths, each owning one direction — they never fight
// because they converge on the same clamped value:
// - growth: `onContentSizeChange`. On web this only fires when content
//   outgrows the box, which is exactly the growth case, so the event is
//   authoritative there (and the sole path on native, where content
//   size is content-based).
// - shrink: imperative `remeasure` on web. RN Web reports
//   `scrollHeight`, which never drops below an explicit height, so the
//   contentSize event goes blind on shrink and only the unconstrained
//   read (`height: auto` → `scrollHeight` → restore, no paint in
//   between) sees the truth.
//
// `remeasure` runs unconditionally: before paint from `onChangeText`
// (zero-lag while typing) and after commit for every text change
// (covers drafts, restores, and suggestion picks, which bypass the text
// handler). Values round up and clamp; identical heights bail out in
// state, so there is no layout loop.
//
// The imperative restore matters: `remeasure` MUST write the measured
// height back onto the DOM node synchronously (`style.height = Npx`)
// instead of clearing it and waiting for React. When the measured value
// equals current state, React bails out of the re-render — a cleared
// node would then stay cleared (resting size) even though the state is
// correct, and the box would look frozen while every measurement reads
// correctly. Writing the DOM first makes the no-op re-render harmless.

import {useCallback, useEffect, useRef, useState} from 'react'
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

export function useAutogrowInput(minHeight: number, maxHeight: number, text: string) {
  const [height, setHeight] = useState<number | null>(null)
  const inputRef = useRef<TextInput | null>(null)
  const clampValue = useCallback(
    (h: number) => Math.min(maxHeight, Math.max(minHeight, Math.ceil(h))),
    [minHeight, maxHeight],
  )
  const clamp = useCallback((h: number) => setHeight(clampValue(h)), [clampValue])
  const onContentSizeChange = useCallback(
    (e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      // Growth lives here on every platform: the event fires exactly
      // when content outgrows the box. (It goes blind on shrink once an
      // explicit height is set — that half belongs to `remeasure`.)
      clamp(e.nativeEvent.contentSize.height)
    },
    [clamp],
  )
  const remeasure = useCallback(() => {
    const node = asWebNode(inputRef.current)
    if (!node) return
    node.style.height = 'auto'
    const next = clampValue(node.scrollHeight)
    // Synchronous restore: the DOM is correct even when the state update
    // below bails out as identical (the frozen-box bug — the node must
    // never be left cleared waiting on a re-render that never comes).
    node.style.height = `${next}px`
    setHeight(next)
  }, [clampValue])
  // Post-commit measure for every text change: covers typing (same
  // value the pre-paint call already set — a DOM no-op and a state
  // bail-out) and programmatic changes that bypass the text handler
  // (drafts, restores, picks).
  useEffect(() => {
    remeasure()
  }, [text, remeasure])
  return {height, onContentSizeChange, inputRef, remeasure}
}

/** Style slice applying the measured height (null = resting minHeight). */
export function autogrowStyle(height: number | null): {height: number} | null {
  return height === null ? null : {height}
}
