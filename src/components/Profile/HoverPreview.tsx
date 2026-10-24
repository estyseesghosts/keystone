// Generic web-only profile-hover wrapper (P7): after ~400ms of hover the
// profile card floats above or below the anchor depending on viewport
// room. The card portals into an owned click-through div on
// document.body (never in-flow), so feed scroll containers can never
// clip it — in-tree absolute layers get cut off by list overflow.
// Native renders the children alone (no hover exists there); a null
// account renders the children alone everywhere (nothing to preview).
//
// Why not RN Web's Modal: Modal wraps content in two full-viewport
// pointer-events:auto layers (ModalAnimation's fixed inset-0 z9999 div
// plus the ModalContent root). The topmost layer sits above the anchor
// and steals its hover the same frame the card opens — anchor
// mouseleave → close timer → unmount → anchor re-hovered → reopen, a
// self-sustaining blink no leave-guard or scroll-grace can fix
// (relatedTarget is the overlay, outside both subtrees, and no scroll
// fires). The owned layer below is pointer-events:none end to end
// except the card itself, so the anchor keeps hover while open.

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react'
import {Platform, StyleSheet, View, type View as ViewType, type ViewStyle, type StyleProp} from 'react-native'

import type {Account, Backend} from '@keystone/fedi'

import {UserHoverCard} from './UserHoverCard'

/** Where the card lands relative to its anchor: below by default, above
 * when the viewport has no room underneath, right-aligned when the
 * anchor sits too close to the right edge. Pure — pinned by unit tests. */
export type CardPlacement = {vertical: 'above' | 'below'; align: 'left' | 'right'}

export const HOVER_CARD_WIDTH = 320
export const HOVER_CARD_HEIGHT = 380
const HOVER_GAP = 6
const HOVER_EDGE = 8
const OPEN_DELAY_MS = 400
const CLOSE_DELAY_MS = 400
/** Fade duration for card appear/disappear (opacity transition on the
 * card box — shared by profile and Matrix hovercards). */
export const HOVER_FADE_MS = 150
/** Lead after mount before fading in (lets the transparent mount paint
 * first so the transition animates instead of appearing). */
export const HOVER_FADE_LEAD_MS = 20
/** Unmount delay after a leave: the close grace plus the fade-out, as
 * one event-scheduled timer (no chained timers). */
export const HOVER_CLOSE_DELAY_MS = CLOSE_DELAY_MS + HOVER_FADE_MS
/** How far the anchor may drift (streaming inserts, image loads)
 * before the card is stale and dismisses. */
const ANCHOR_MOVE_PX = 8
const ANCHOR_POLL_MS = 500
/** A hover arrival counts as genuine only with pointer movement this
 * recent: layout shifts slide anchors under a stationary pointer and
 * browsers fire a real `mouseEnter` for it, which would reopen just-
 * closed cards by itself. */
const POINTER_FRESH_MS = 1000

// Last real pointer movement (web only). One shared timestamp: the
// listener registration is idempotent (identical type/fn/capture
// registers once), so every hover owner just ensures it on mount.
let lastPointerMoveAt = 0
let pointerTrackingOn = false

/** Attach the shared pointer-movement tracker (web only, idempotent).
 * Call from hover-owner mount. No-ops where there is no window or no
 * listener API (native, DOM-less renderers) — there every enter is
 * allowed. */
export function ensurePointerTracking(): void {
  if (pointerTrackingOn || typeof window === 'undefined') return
  const add = (window as unknown as {addEventListener?: unknown}).addEventListener
  if (typeof add !== 'function') return
  pointerTrackingOn = true
  ;(window as unknown as {addEventListener: (t: string, fn: () => void, o?: object) => void}).addEventListener(
    'mousemove',
    () => {
      lastPointerMoveAt = Date.now()
    },
    {passive: true, capture: true},
  )
}

/** True when the pointer moved recently — i.e. a hover arrival is the
 * user arriving, not a layout shift sliding an anchor underneath a
 * stationary pointer. Always true where movement is unmeasurable
 * (native, DOM-less tests): nothing to gate on there. Pure modulo the
 * shared timestamp. */
export function pointerRecentlyMoved(now: number = Date.now()): boolean {
  if (typeof window === 'undefined' || !pointerTrackingOn) return true
  return now - lastPointerMoveAt <= POINTER_FRESH_MS
}
// Scrolls/resizes in this window after open are treated as mount/layout
// settle (images loading, streamer banners) rather than a real user
// scroll — the card survives them.
const SCROLL_SETTLE_MS = 500

/** System sans stack (matches RN Web's default `font:` shorthand). Set
 * explicitly on the card root so portal rendering can't diverge from
 * app text (Safari serif bug: portal-subtree shorthand parse failure). */
export const HOVER_CARD_FONT_FAMILY =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif'

export function placementFor(
  anchor: {top: number; bottom: number; left: number; right: number},
  viewport: {width: number; height: number},
  card: {width: number; height: number} = {width: HOVER_CARD_WIDTH, height: HOVER_CARD_HEIGHT},
): CardPlacement {
  const below = viewport.height - anchor.bottom
  const above = anchor.top
  return {
    vertical: below >= card.height || below >= above ? 'below' : 'above',
    align: anchor.left + card.width <= viewport.width ? 'left' : 'right',
  }
}

// Viewport metrics on web; null anywhere they do not exist (native,
// tests without a DOM) — callers fall back to below/left.
function viewportSize(): {width: number; height: number} | null {
  if (typeof window === 'undefined') return null
  const {innerWidth, innerHeight} = window as unknown as {
    innerWidth?: unknown
    innerHeight?: unknown
  }
  if (typeof innerWidth !== 'number' || typeof innerHeight !== 'number') return null
  return {width: innerWidth, height: innerHeight}
}

function windowEvents(): {
  addEventListener: (type: string, listener: () => void, opts?: boolean) => void
  removeEventListener: (type: string, listener: () => void, opts?: boolean) => void
} | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    addEventListener?: unknown
    removeEventListener?: unknown
  }
  if (typeof w.addEventListener !== 'function' || typeof w.removeEventListener !== 'function') {
    return null
  }
  return w as {
    addEventListener: (type: string, listener: () => void, opts?: boolean) => void
    removeEventListener: (type: string, listener: () => void, opts?: boolean) => void
  }
}

type CardPos = {top?: number; bottom?: number; left?: number; right?: number}

/** Fixed viewport coordinates for the floating card (the layer covers
 * the viewport, so in-flow percentages would resolve against the
 * wrong box). Pure — same test coverage as `placementFor`. */
export function cardPosition(
  anchor: {top: number; bottom: number; left: number; right: number},
  viewport: {width: number; height: number},
): {pos: CardPos; placement: CardPlacement} {
  const placement = placementFor(anchor, viewport)
  const pos: CardPos = {}
  if (placement.vertical === 'below') {
    pos.top = anchor.bottom + HOVER_GAP
  } else {
    pos.bottom = viewport.height - anchor.top + HOVER_GAP
  }
  if (placement.align === 'left') {
    pos.left = Math.min(
      Math.max(HOVER_EDGE, anchor.left),
      Math.max(HOVER_EDGE, viewport.width - HOVER_EDGE - HOVER_CARD_WIDTH),
    )
  } else {
    pos.right = Math.max(HOVER_EDGE, viewport.width - anchor.right)
  }
  return {pos, placement}
}

/** Shift a measured card box fully inside the viewport with an edge
 * margin, or null when it already fits. Pure — pinned by unit tests. */
export function clampToViewport(
  rect: {top: number; bottom: number; left: number; right: number},
  viewport: {width: number; height: number},
  edge = HOVER_EDGE,
): {top: number; left: number} | null {
  const overBottom = rect.bottom - (viewport.height - edge)
  const underTop = edge - rect.top
  const overRight = rect.right - (viewport.width - edge)
  const underLeft = edge - rect.left
  const top =
    overBottom > 0 ? rect.top - overBottom : underTop > 0 ? rect.top + underTop : null
  const left =
    overRight > 0 ? rect.left - overRight : underLeft > 0 ? rect.left + underLeft : null
  return top === null && left === null ? null : {top: top ?? rect.top, left: left ?? rect.left}
}

/** True when the pointer's leave target is still inside one of the
 * hosts (identity or DOM `contains`). Pure — pinned by unit tests.
 * A leave that stays inside is a layout-shift ghost or the
 * anchor→card crossing, never a real departure. */
export function leaveTargetStaysInside(hosts: ReadonlyArray<unknown>, target: unknown): boolean {
  if (!target || typeof target !== 'object') return false
  return hosts.some(
    host =>
      host !== null &&
      host !== undefined &&
      (host === target ||
        (typeof (host as {contains?: unknown}).contains === 'function' &&
          (host as unknown as {contains: (n: object) => boolean}).contains(target as object))),
  )
}

/** True when a card-enter may revive a closing card: only inside the
 * given grace window after the last genuine anchor-or-card leave. Null
 * (no departure recorded yet) always revives. Pure. Callers pass the
 * window that fits the crossing they accept (the fade length for fast
 * gap crossings); the default is the full close grace. */
export function shouldReviveCard(
  leaveAt: number | null,
  now: number = Date.now(),
  graceMs: number = CLOSE_DELAY_MS,
): boolean {
  if (leaveAt === null) return true
  return now - leaveAt <= graceMs
}

/** Card-enter revive rule (crossing-only): true IFF (a) the enter's
 * `relatedTarget` is inside the anchor subtree — a certain direct
 * anchor→card crossing (its anchor-leave was skipped as stays-inside,
 * so no timestamp exists) — or (b) the enter lands within the fade
 * window after the last genuine leave (a fast gap crossing while the
 * card is still visibly fading). Anything later is a revisit of a
 * corpse: the caller must cancel nothing, refade nothing, and let the
 * scheduled unmount proceed. Pure — pinned by unit tests. */
export function shouldReviveOnCardEnter(
  anchor: unknown,
  relatedTarget: unknown,
  leaveAt: number | null,
  now: number = Date.now(),
): boolean {
  return (
    leaveTargetStaysInside([anchor], relatedTarget) ||
    shouldReviveCard(leaveAt, now, HOVER_FADE_MS)
  )
}

/** True when the anchor drifted out from under the pointer (streaming
 * inserts, late image loads): the open card points at stale
 * coordinates and must dismiss. Pure — pinned by unit tests. */
export function anchorMoved(
  baseline: {top: number; left: number} | null,
  rect: {top: number; left: number},
  px = ANCHOR_MOVE_PX,
): boolean {
  if (!baseline) return false
  return Math.abs(rect.top - baseline.top) > px || Math.abs(rect.left - baseline.left) > px
}

// react-dom is web-only: resolved lazily so native bundles never
// evaluate it (this call is the only runtime path, and it only runs
// where `document` exists — i.e. inside `HoverLayer` on web).
function webPortal(children: ReactNode, host: Element): ReactNode {
  const {createPortal} = require('react-dom') as typeof import('react-dom')
  return createPortal(children, host)
}

/** Click-through floating layer for exactly one open card. Owns the
 * body-appended host div (fixed inset-0, pointer-events:none, so the
 * anchor underneath keeps its hover), the card box (the only
 * pointer-events:auto node, carrying the explicit font stack), and
 * dismiss-on-Escape/scroll/resize with mount-settle grace. Content stays
 * React Native primitives — only the layer shell is raw DOM.
 *
 * Exported for non-profile hovercards (Matrix IDs): same layer, custom
 * card content. */
export function HoverLayer({
  pos,
  cardRef,
  anchorRef,
  fade,
  onEnterCard,
  onLeaveCard,
  onDismiss,
  children,
}: {
  pos: CardPos | null
  cardRef: RefObject<HTMLElement | null>
  /** Anchor for move-dismissal: feed inserts can shift the anchor out
   * from under a stationary pointer (no mouse events fire), leaving
   * the card stuck at stale coordinates. Omit where unmeasurable. */
  anchorRef?: RefObject<ViewType | null>
  /** Opacity state from `useHoverFade` (mounts transparent, eases in;
   * eases out before the owner unmounts). */
  fade: boolean
  onEnterCard: (e?: {relatedTarget?: unknown}) => void
  onLeaveCard: (e?: {relatedTarget?: unknown}) => void
  onDismiss: () => void
  children: ReactNode
}) {
  const [host, setHost] = useState<HTMLElement | null>(null)
  // Measured correction so a taller-than-estimate card never leaves the
  // viewport: explicit top/left replacing the anchor-derived pos. Reset
  // whenever pos changes, re-measured after mount and whenever card
  // content (banner/avatar) resizes it.
  const [fix, setFix] = useState<{top: number; left: number} | null>(null)
  useEffect(() => {
    setFix(null)
  }, [pos])
  useEffect(() => {
    if (typeof document === 'undefined') return
    const el = document.createElement('div')
    el.setAttribute('data-hovercard-layer', 'true')
    el.style.position = 'fixed'
    el.style.left = '0'
    el.style.top = '0'
    el.style.width = '100%'
    el.style.height = '100%'
    el.style.zIndex = '60'
    el.style.pointerEvents = 'none'
    document.body.appendChild(el)
    setHost(el)
    return () => {
      el.remove()
      setHost(null)
    }
  }, [])
  const openedAt = useRef(0)
  useEffect(() => {
    if (host) openedAt.current = Date.now()
  }, [host])
  // Anchor-drift dismissal: layout shifts without scroll (streaming
  // inserts, late media) move the anchor without firing mouse events,
  // which strands the card. Polls the anchor box on a slow cadence and
  // dismisses past a small drift. Settle-guarded like scroll (mount and
  // image-load shifts are not departures); skipped entirely where
  // there is no window to measure in.
  const baseline = useRef<{top: number; left: number} | null>(null)
  useEffect(() => {
    if (!anchorRef || typeof window === 'undefined') return
    const id = setInterval(() => {
      const el = anchorRef.current as unknown as {getBoundingClientRect?: () => DOMRect} | null
      const rect = el?.getBoundingClientRect?.()
      if (!rect) return
      if (Date.now() - openedAt.current < SCROLL_SETTLE_MS) {
        baseline.current = null
        return
      }
      if (!baseline.current) {
        baseline.current = {top: rect.top, left: rect.left}
        return
      }
      if (anchorMoved(baseline.current, rect)) onDismiss()
    }, ANCHOR_POLL_MS)
    return () => clearInterval(id)
  }, [anchorRef, host, onDismiss])
  useEffect(() => {
    if (!host || typeof window === 'undefined') return
    const events = windowEvents()
    if (!events) return
    const dismiss = () => {
      if (Date.now() - openedAt.current < SCROLL_SETTLE_MS) return
      onDismiss()
    }
    const onKeyUp = (e: {key?: unknown}) => {
      if (e.key === 'Escape') onDismiss()
    }
    events.addEventListener('scroll', dismiss, true)
    events.addEventListener('resize', dismiss)
    events.addEventListener('keyup', onKeyUp as () => void)
    return () => {
      events.removeEventListener('scroll', dismiss, true)
      events.removeEventListener('resize', dismiss)
      events.removeEventListener('keyup', onKeyUp as () => void)
    }
  }, [host, onDismiss])
  // Keep the whole card inside the viewport: the flip estimate assumes
  // a fixed card height, but bios make real cards taller or shorter, so
  // near the top/bottom edges the estimate can overflow. Measure the
  // mounted box (viewport-relative already — the layer is fixed) and
  // shift it in with an edge margin; re-run when card content resizes
  // (banner/avatar loads changing its height).
  useEffect(() => {
    if (!host || fix !== null || typeof document === 'undefined') return
    const el = cardRef.current
    if (!el || typeof el.getBoundingClientRect !== 'function') return
    if (typeof window === 'undefined') return
    const clamp = () => {
      const r = el.getBoundingClientRect()
      const fixed = clampToViewport(
        {top: r.top, bottom: r.bottom, left: r.left, right: r.right},
        {width: window.innerWidth, height: window.innerHeight},
      )
      if (fixed) setFix(fixed)
    }
    clamp()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setFix(null))
    ro.observe(el)
    return () => ro.disconnect()
  }, [host, pos, fix])
  if (!host) {
    // No DOM (native test renderer) — portaling is impossible, so render
    // the card box inline. Production native never reaches here (the
    // Platform guard above returns earlier); this path exists for tests.
    if (typeof document === 'undefined') {
      return (
        <div
          data-hovercard-card="true"
          style={{
            position: 'absolute',
            width: HOVER_CARD_WIDTH,
            pointerEvents: 'auto',
            fontFamily: HOVER_CARD_FONT_FAMILY,
            opacity: fade ? 1 : 0,
            transition: `opacity ${HOVER_FADE_MS}ms ease`,
          }}
          onMouseEnter={onEnterCard}
          onMouseLeave={onLeaveCard}>
          {children}
        </div>
      )
    }
    return null
  }
  const fadeStyle: CSSProperties = {
    opacity: fade ? 1 : 0,
    transition: `opacity ${HOVER_FADE_MS}ms ease`,
  }
  const style: CSSProperties = fix
    ? {
        position: 'absolute',
        top: fix.top,
        left: fix.left,
        width: HOVER_CARD_WIDTH,
        pointerEvents: 'auto',
        fontFamily: HOVER_CARD_FONT_FAMILY,
        ...fadeStyle,
      }
    : {
        position: 'absolute',
        top: pos?.top,
        bottom: pos?.bottom,
        left: pos?.left,
        right: pos?.right,
        width: HOVER_CARD_WIDTH,
        pointerEvents: 'auto',
        fontFamily: HOVER_CARD_FONT_FAMILY,
        ...fadeStyle,
      }
  return webPortal(
    <div
      data-hovercard-card="true"
      ref={el => {
        cardRef.current = el
      }}
      style={style}
      onMouseEnter={onEnterCard}
      onMouseLeave={onLeaveCard}>
      {children}
    </div>,
    host,
  )
}

export function HoverPreview({
  account,
  sessionId,
  backend,
  onOpenProfile,
  children,
  testID,
  style,
}: {
  account: Account | null
  sessionId: string
  /** Session backend: bio mention chips resolve and lite embedded
   * authors upgrade to the full account. Absent → static chips,
   * embedded data as-is. */
  backend?: Backend | null
  onOpenProfile?: () => void
  children: ReactNode
  testID?: string
  /** Anchor layout: the hover zone is exactly this box, so callers
   * shrink it to the interactive content (a full-width anchor opens
   * the card from empty space beside the content). */
  style?: StyleProp<ViewStyle>
}) {
  const [show, setShow] = useState(false)
  const [faded, setFaded] = useState(false)
  const [pos, setPos] = useState<CardPos | null>(null)
  const anchor = useRef<ViewType | null>(null)
  const cardEl = useRef<HTMLElement | null>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Last genuine anchor-or-card leave (stays-inside ghosts never reach
  // `handleLeave`, so never stamp it): gates card-enter revives.
  const leaveAt = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (openTimer.current !== null) clearTimeout(openTimer.current)
      if (fadeTimer.current !== null) clearTimeout(fadeTimer.current)
      if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    },
    [],
  )
  useEffect(() => {
    ensurePointerTracking()
  }, [])
  // `relatedTarget` is where the pointer went. A leave whose target
  // is still inside the anchor-or-card subtree is a layout-shift ghost
  // (images loading, streamer banners moving boxes under a stationary
  // cursor) or the anchor→card crossing — never a real departure, so
  // it must not schedule a close.
  const leaveStaysInside = (e: {relatedTarget?: unknown} | undefined): boolean =>
    leaveTargetStaysInside([anchor.current, cardEl.current], e?.relatedTarget)
  if (Platform.OS !== 'web') return <>{children}</>
  // Every timer below is scheduled from a pointer event, never from
  // another timer: each fires in any covering time advance (no chained
  // timers that single-chunk advancement can strand).
  const clearOpenPair = () => {
    if (openTimer.current !== null) {
      clearTimeout(openTimer.current)
      openTimer.current = null
    }
    if (fadeTimer.current !== null) {
      clearTimeout(fadeTimer.current)
      fadeTimer.current = null
    }
  }
  const cancelClose = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setShow(false), HOVER_CLOSE_DELAY_MS)
  }
  const handleEnter = () => {
    // Layout-shift ghost (streaming inserts / image loads sliding the
    // anchor under a stationary pointer): without recent pointer
    // movement this arrival isn't the user — ignore it, or closed
    // cards reopen by themselves.
    if (!pointerRecentlyMoved()) return
    cancelClose()
    // Still mounted (mid-fade or open): fade back in, no reopen delay.
    if (show) {
      setFaded(true)
      return
    }
    clearOpenPair()
    const el = anchor.current as unknown as {getBoundingClientRect?: () => DOMRect} | null
    const rect = el?.getBoundingClientRect?.()
    const viewport = viewportSize()
    if (rect && viewport) {
      setPos(
        cardPosition(
          {top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right},
          viewport,
        ).pos,
      )
    }
    openTimer.current = setTimeout(() => setShow(true), OPEN_DELAY_MS)
    fadeTimer.current = setTimeout(() => setFaded(true), OPEN_DELAY_MS + HOVER_FADE_LEAD_MS)
  }
  const handleLeave = () => {
    // Fade starts at once; the unmount follows after the grace window
    // (re-entering cancels it and fades back in).
    leaveAt.current = Date.now()
    setFaded(false)
    clearOpenPair()
    if (show) scheduleClose()
  }
  // This RN Web version drops `onHoverIn`/`onHoverOut` on plain Views
  // (only Pressable wires them) — but it DOES forward `onMouseEnter`/
  // `onMouseLeave`, so the anchor uses those. Spread in (spreads skip
  // excess-prop checks) so native trees never see the props.
  const hoverHandlers: {
    onMouseEnter?: (e?: {relatedTarget?: unknown}) => void
    onMouseLeave?: (e?: {relatedTarget?: unknown}) => void
  } = {
    onMouseEnter: handleEnter,
    onMouseLeave: e => {
      if (leaveStaysInside(e)) return
      handleLeave()
    },
  }
  // The card keeps itself alive while hovered (moving from the anchor
  // onto the card crosses a hover-out gap); leaving the card closes it.
  // The layer is click-through, so the anchor keeps its own hover
  // state underneath while the card is open.
  const cardHandlers: {
    onMouseEnter?: (e?: {relatedTarget?: unknown}) => void
    onMouseLeave?: (e?: {relatedTarget?: unknown}) => void
  } = {
    onMouseEnter: e => {
      // Crossing-only revive (`shouldReviveOnCardEnter`): certain
      // anchor→card crossings and fast gap crossings while the card
      // still fades resurrect it; a later revisit of the corpse is
      // ignored — no close cancel, no refade, the scheduled unmount
      // proceeds. Slow crossers recover with one anchor wiggle (anchor
      // re-enter refades instantly).
      if (!shouldReviveOnCardEnter(anchor.current, e?.relatedTarget, leaveAt.current)) return
      cancelClose()
      setFaded(true)
    },
    onMouseLeave: e => {
      if (leaveStaysInside(e)) return
      handleLeave()
    },
  }
  return (
    <>
      <View
        ref={anchor}
        testID={testID ? `${testID}-anchor` : undefined}
        style={style}
        {...hoverHandlers}>
        {children}
      </View>
      {show && account ? (
        <HoverLayer
          pos={pos}
          cardRef={cardEl}
          anchorRef={anchor}
          fade={faded}
          onEnterCard={cardHandlers.onMouseEnter!}
          onLeaveCard={cardHandlers.onMouseLeave!}
          onDismiss={() => setShow(false)}>
          <UserHoverCard
            account={account}
            sessionId={sessionId}
            backend={backend}
            onOpenProfile={onOpenProfile}
            testID={testID}
          />
        </HoverLayer>
      ) : null}
    </>
  )
}
