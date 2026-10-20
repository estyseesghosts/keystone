// Tiny toast queue (slice 4.2). `showToast` is callable from anywhere
// (action errors, copy confirmations); `ToastHost` renders the head.

export type ToastItem = {id: number; message: string}

type Listener = () => void
let items: ToastItem[] = []
let nextId = 1
const listeners = new Set<Listener>()

function emit() {
  for (const l of listeners) l()
}

export function showToast(message: string): number {
  const id = nextId++
  items = [...items, {id, message}]
  emit()
  return id
}

export function dismissToast(id: number): void {
  items = items.filter(t => t.id !== id)
  emit()
}

export function clearToasts(): void {
  items = []
  emit()
}

export const toastStore = {
  subscribe(l: Listener): () => void {
    listeners.add(l)
    return () => {
      listeners.delete(l)
    }
  },
  getSnapshot(): ToastItem[] {
    return items
  },
}
