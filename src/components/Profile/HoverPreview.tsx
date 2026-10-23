// Generic web-only profile-hover wrapper (P7): after ~400ms of hover the
// profile card floats above or below the anchor depending on viewport
// room. The card renders in a transparent Modal (never in-flow), so feed
// scroll containers can never clip it — in-tree absolute layers get cut
// off by list overflow. Native renders the children alone (no hover
// exists there); a null account renders the children alone everywhere
// (nothing to preview).

import {useEffect, useRef, useState, type ReactNode} from 'react'
import {Modal, Platform, StyleSheet, View, type View as ViewType} from 'react-native'

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
const CLOSE_DELAY_MS = 250

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

/** Fixed viewport coordinates for the floating card (the Modal covers
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
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (openTimer.current !== null) clearTimeout(openTimer.current)
      if (closeTimer.current !== null) clearTimeout(closeTimer.current)
    },
    [],
  )
  // The fixed coordinates go stale on scroll/resize — drop the card
  // instead of floating it somewhere wrong.
  useEffect(() => {
    if (!show) return
    const events = windowEvents()
    if (!events) return
    const close = () => setShow(false)
    events.addEventListener('scroll', close, true)
    events.addEventListener('resize', close)
    return () => {
      events.removeEventListener('scroll', close, true)
      events.removeEventListener('resize', close)
    }
  }, [show])
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
  // `onHoverIn`/`onHoverOut` exist on the web host view but are absent
  // from this RN version's `ViewProps` types — spread them in (spreads
  // skip excess-prop checks) so native trees never see the props.
  const hoverHandlers: {onHoverIn?: () => void; onHoverOut?: () => void} = {
    onHoverIn: () => {
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
      openTimer.current = setTimeout(() => setShow(true), OPEN_DELAY_MS)
    },
    onHoverOut: () => {
      if (openTimer.current !== null) {
        clearTimeout(openTimer.current)
        openTimer.current = null
      }
      scheduleClose()
    },
  }
  // The card keeps itself alive while hovered (moving from the anchor
  // onto the card crosses a hover-out gap); leaving the card closes it.
  // The Modal backdrop never intercepts (box-none) so the anchor keeps
  // its own hover state underneath.
  const cardHandlers: {onHoverIn?: () => void; onHoverOut?: () => void} = {
    onHoverIn: cancelClose,
    onHoverOut: scheduleClose,
  }
  return (
    <>
      <View ref={anchor} testID={testID ? `${testID}-anchor` : undefined} {...hoverHandlers}>
        {children}
      </View>
      {show && account ? (
        <Modal transparent visible animationType="none" onRequestClose={() => setShow(false)}>
          <View style={hoverStyles.backdrop} pointerEvents="box-none">
            <View style={[hoverStyles.card, pos ?? undefined]} {...cardHandlers}>
              <UserHoverCard
                account={account}
                sessionId={sessionId}
                onOpenProfile={onOpenProfile}
                testID={testID}
              />
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  )
}

const hoverStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
  },
  card: {
    position: 'absolute',
    zIndex: 50,
  },
})
