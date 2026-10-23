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
import {Platform, View, type View as ViewType} from 'react-native'

import type {Account} from '@keystone/fedi'

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
 * React Native primitives — only the layer shell is raw DOM. */
function HoverLayer({
  pos,
  cardRef,
  onEnterCard,
  onLeaveCard,
  onDismiss,
  children,
}: {
  pos: CardPos | null
  cardRef: RefObject<HTMLElement | null>
  onEnterCard: () => void
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
          }}
          onMouseEnter={onEnterCard}
          onMouseLeave={onLeaveCard}>
          {children}
        </div>
      )
    }
    return null
  }
  const style: CSSProperties = fix
    ? {
        position: 'absolute',
        top: fix.top,
        left: fix.left,
        width: HOVER_CARD_WIDTH,
        pointerEvents: 'auto',
        fontFamily: HOVER_CARD_FONT_FAMILY,
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
  onOpenProfile,
  children,
  testID,
}: {
  account: Account | null
  sessionId: string
  onOpenProfile?: () => void
  children: ReactNode
  testID?: string
}) {
  const [show, setShow] = useState(false)
  const [pos, setPos] = useState<CardPos | null>(null)
  const anchor = useRef<ViewType | null>(null)
  const cardEl = useRef<HTMLElement | null>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (openTimer.current !== null) clearTimeout(openTimer.current)
      if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    },
    [],
  )
  // `relatedTarget` is where the pointer went. A leave whose target
  // is still inside the anchor-or-card subtree is a layout-shift ghost
  // (images loading, streamer banners moving boxes under a stationary
  // cursor) or the anchor→card crossing — never a real departure, so
  // it must not schedule a close.
  const leaveStaysInside = (e: {relatedTarget?: unknown} | undefined): boolean =>
    leaveTargetStaysInside([anchor.current, cardEl.current], e?.relatedTarget)
  if (Platform.OS !== 'web') return <>{children}</>
  const cancelClose = () => {
    if (closeTimer.current !== null) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }
  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = setTimeout(() => setShow(false), CLOSE_DELAY_MS)
  }
  // This RN Web version drops `onHoverIn`/`onHoverOut` on plain Views
  // (only Pressable wires them) — but it DOES forward `onMouseEnter`/
  // `onMouseLeave`, so the anchor uses those. Spread in (spreads skip
  // excess-prop checks) so native trees never see the props.
  const hoverHandlers: {
    onMouseEnter?: (e?: {relatedTarget?: unknown}) => void
    onMouseLeave?: (e?: {relatedTarget?: unknown}) => void
  } = {
    onMouseEnter: () => {
      cancelClose()
      if (openTimer.current !== null) clearTimeout(openTimer.current)
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
      openTimer.current = setTimeout(() => {
        setShow(true)
      }, OPEN_DELAY_MS)
    },
    onMouseLeave: e => {
      if (leaveStaysInside(e)) return
      if (openTimer.current !== null) {
        clearTimeout(openTimer.current)
        openTimer.current = null
      }
      scheduleClose()
    },
  }
  // The card keeps itself alive while hovered (moving from the anchor
  // onto the card crosses a hover-out gap); leaving the card closes it.
  // The layer is click-through, so the anchor keeps its own hover
  // state underneath while the card is open.
  const cardHandlers: {
    onMouseEnter?: () => void
    onMouseLeave?: (e?: {relatedTarget?: unknown}) => void
  } = {
    onMouseEnter: cancelClose,
    onMouseLeave: e => {
      if (leaveStaysInside(e)) return
      scheduleClose()
    },
  }
  return (
    <>
      <View ref={anchor} testID={testID ? `${testID}-anchor` : undefined} {...hoverHandlers}>
        {children}
      </View>
      {show && account ? (
        <HoverLayer
          pos={pos}
          cardRef={cardEl}
          onEnterCard={cardHandlers.onMouseEnter!}
          onLeaveCard={cardHandlers.onMouseLeave!}
          onDismiss={() => setShow(false)}>
          <UserHoverCard
            account={account}
            sessionId={sessionId}
            onOpenProfile={onOpenProfile}
            testID={testID}
          />
        </HoverLayer>
      ) : null}
    </>
  )
}
