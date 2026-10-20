// Clipboard adapter (slice 4.2). No native clipboard package is a
// dependency yet, so only the web Clipboard API is wired; native reports
// unavailable and the menu shows "Copy" rows disabled with that reason.
// Swap in expo-clipboard here when it lands (one place).

type ClipboardLike = {writeText(text: string): Promise<void>}

function clip(): ClipboardLike | null {
  const nav = (globalThis as {navigator?: {clipboard?: ClipboardLike}}).navigator
  return nav?.clipboard ?? null
}

export function canCopy(): boolean {
  return clip() !== null
}

export async function copyText(text: string): Promise<void> {
  const c = clip()
  if (!c) throw new Error('Clipboard is not available on this platform.')
  await c.writeText(text)
}
