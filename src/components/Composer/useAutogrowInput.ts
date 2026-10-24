// Adaptive composer height: the text field grows and shrinks with its
// content between a floor (the resting box) and a ceiling (past it the
// field scrolls internally).
//
// One measuring path per platform, one source of truth — the two paths
// must never disagree or the box visibly fights between sizes:
// - native: `onContentSizeChange` (content size is content-based there).
// - web: imperative `remeasure` — RN Web reports `scrollHeight`, which
//   never drops below an explicit height, so the contentSize event goes
//   blind on shrink and only the unconstrained read (`height: auto` →
//   `scrollHeight` → restore, no paint in between) sees the truth.
//
// `remeasure` runs unconditionally: before paint from `onChangeText`
// (zero-lag while typing) and after commit for every text change
// (covers drafts, restores, and suggestion picks, which bypass the text
// handler). All three compute the identical clamped value, so repeated
// calls converge instead of fighting. Values round up and clamp;
// identical heights bail out in state, so there is no layout loop.

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
  const clamp = useCallback(
    (h: number) => setHeight(Math.min(maxHeight, Math.max(minHeight, Math.ceil(h)))),
    [minHeight, maxHeight],
  )
  const onContentSizeChange = useCallback(
    (e: NativeSyntheticEvent<TextInputContentSizeChangeEventData>) => {
      // Native path. On web this stays attached but rarely fires (an
      // explicit height pins `scrollHeight`); when it does, it agrees
      // with `remeasure` below — same clamped value, never a fight.
      if (Platform.OS === 'web') return
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
  // Post-commit measure for every text change: covers typing (same
  // value the pre-paint call already set — a no-op) and programmatic
  // changes that bypass the text handler (drafts, restores, picks).
  useEffect(() => {
    remeasure()
  }, [text, remeasure])
  return {height, onContentSizeChange, inputRef, remeasure}
}

/** Style slice applying the measured height (null = resting minHeight). */
export function autogrowStyle(height: number | null): {height: number} | null {
  return height === null ? null : {height}
}
