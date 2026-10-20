import {useEffect, useMemo, useRef} from 'react'

// Generic toggle mutation queue (slice 4.1).
//
// A toggle is a "desired value" the user keeps changing (a reaction key or
// null, a boolean for renote/bookmark/favourite). The queue:
//  - flips optimistically and synchronously (`onOptimistic`),
//  - runs at most ONE server mutation at a time per queue,
//  - coalesces changes made while one is in flight: when it lands, the
//    queue compares the confirmed value with the latest desired value and
//    only then runs the next mutation. like -> unlike in flight therefore
//    makes exactly create, delete -- never a third call; like -> unlike ->
//    like in flight makes only the create,
//  - on reject, rolls back to the last CONFIRMED value and rejects every
//    pending `queueToggle` promise with the error.

/**
 * Throw from `run` when a multi-step mutation partly succeeded: the server
 * now holds `confirmed`, which is neither `from` nor `to` (reaction change
 * on Misskey: the delete landed, the create failed -> confirmed is null).
 */
export class PartialToggleError<T> extends Error {
  readonly confirmed: T
  readonly cause: unknown
  constructor(confirmed: T, cause: unknown) {
    super(cause instanceof Error ? cause.message : 'Toggle partially applied')
    this.name = 'PartialToggleError'
    this.confirmed = confirmed
    this.cause = cause
  }
}

export interface ToggleQueueOptions<T> {
  /** The currently confirmed (server) value. */
  initial: T
  /** One mutation from the confirmed value to `to`. Reject = nothing applied
   * (or throw `PartialToggleError` for a partial apply). */
  run: (from: T, to: T) => Promise<void>
  /** Sync, called on every `queueToggle` before anything async. */
  onOptimistic?: (desired: T) => void
  /** A mutation landed. */
  onConfirmed?: (confirmed: T) => void
  /** A mutation failed; `confirmed` is what to show again. */
  onRollback?: (confirmed: T, error: unknown) => void
  /** The queue went idle (after success or rollback). */
  onSettled?: (confirmed: T) => void
  equals?: (a: T, b: T) => boolean
}

export interface ToggleQueue<T> {
  /** Set the desired value. Resolves when the queue has drained to it;
   * rejects (after rolling back) if a mutation fails. */
  queueToggle: (next: T) => Promise<void>
  /** Re-seed the confirmed value from fresh server data. No-op while busy. */
  reset: (confirmed: T) => void
  confirmed: () => T
  desired: () => T
  isBusy: () => boolean
}

export function createToggleQueue<T>(options: ToggleQueueOptions<T>): ToggleQueue<T> {
  const eq = options.equals ?? ((a: T, b: T) => Object.is(a, b))
  let confirmed = options.initial
  let desired = options.initial
  let running: Promise<void> | null = null

  async function drain(): Promise<void> {
    try {
      while (!eq(confirmed, desired)) {
        const target = desired
        try {
          await options.run(confirmed, target)
        } catch (error) {
          if (error instanceof PartialToggleError) confirmed = error.confirmed as T
          desired = confirmed
          options.onRollback?.(confirmed, error)
          throw error instanceof PartialToggleError ? error.cause : error
        }
        confirmed = target
        options.onConfirmed?.(confirmed)
      }
    } finally {
      running = null
      options.onSettled?.(confirmed)
    }
  }

  return {
    queueToggle(next) {
      desired = next
      options.onOptimistic?.(next)
      if (running) return running
      if (eq(confirmed, desired)) {
        options.onSettled?.(confirmed)
        return Promise.resolve()
      }
      running = drain()
      return running
    },
    reset(value) {
      if (running) return
      confirmed = value
      desired = value
    },
    confirmed: () => confirmed,
    desired: () => desired,
    isBusy: () => running !== null,
  }
}

/** React wrapper: one queue per mounted component; latest callbacks win. */
export function useToggleMutationQueue<T>(options: ToggleQueueOptions<T>): ToggleQueue<T> {
  const latest = useRef(options)
  latest.current = options
  const queue = useMemo(
    () =>
      createToggleQueue<T>({
        initial: options.initial,
        equals: (a, b) => (latest.current.equals ?? Object.is)(a, b),
        run: (from, to) => latest.current.run(from, to),
        onOptimistic: v => latest.current.onOptimistic?.(v),
        onConfirmed: v => latest.current.onConfirmed?.(v),
        onRollback: (v, e) => latest.current.onRollback?.(v, e),
        onSettled: v => latest.current.onSettled?.(v),
      }),
    [],
  )
  useEffect(() => {
    queue.reset(options.initial)
  }, [queue, options.initial])
  return queue
}
