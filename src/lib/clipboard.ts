// Clipboard adapter. Native uses expo-clipboard; web uses the browser
// Clipboard API (secure contexts only; absent => reported unavailable).

import {Platform} from 'react-native'

type ClipboardLike = {writeText(text: string): Promise<void>}

function webClip(): ClipboardLike | null {
  const nav = (globalThis as {navigator?: {clipboard?: ClipboardLike}}).navigator
  return nav?.clipboard ?? null
}

type NativeClipboard = {setStringAsync(text: string): Promise<boolean>}

function nativeClip(): NativeClipboard | null {
  if (Platform.OS === 'web') return null
  try {
    return require('expo-clipboard') as NativeClipboard
  } catch {
    return null
  }
}

export function canCopy(): boolean {
  return Platform.OS === 'web' ? webClip() !== null : nativeClip() !== null
}

export async function copyText(text: string): Promise<void> {
  if (Platform.OS === 'web') {
    const c = webClip()
    if (!c) throw new Error('Clipboard is not available on this platform.')
    await c.writeText(text)
    return
  }
  const n = nativeClip()
  if (!n) throw new Error('Clipboard is not available on this platform.')
  await n.setStringAsync(text)
}
