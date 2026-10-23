// Generic web-only profile-hover wrapper (P7): after ~400ms of hover the
// profile card floats in an absolutely-positioned layer that never
// affects layout, above or below the anchor depending on viewport room.
// Native renders the children alone (no hover exists there); a null
// account renders the children alone everywhere (nothing to preview).

import {useRef, useState, type ReactNode} from 'react'
import {Platform, StyleSheet, View, type View as ViewType} from 'react-native'

import type {Account} from '@keystone/fedi'

import {UserHoverCard} from './UserHoverCard'

/** Where the card lands relative to its anchor: below by default, above
 * when the viewport has no room underneath, right-aligned when the
 * anchor sits too close to the right edge. Pure — pinned by unit tests. */
export type CardPlacement = {vertical: 'above' | 'below'; align: 'left' | 'right'}

export const HOVER_CARD_WIDTH = 320
export const HOVER_CARD_HEIGHT = 380

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
  const [placement, setPlacement] = useState<CardPlacement>({vertical: 'below', align: 'left'})
  const anchor = useRef<ViewType | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  if (Platform.OS !== 'web') return <>{children}</>
  const clearTimer = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }
  // `onHoverIn`/`onHoverOut` exist on the web host view but are absent
  // from this RN version's `ViewProps` types — spread them in (spreads
  // skip excess-prop checks) so native trees never see the props.
  const hoverHandlers: {onHoverIn?: () => void; onHoverOut?: () => void} = {
    onHoverIn: () => {
      clearTimer()
      const el = anchor.current as unknown as {getBoundingClientRect?: () => DOMRect} | null
      const rect = el?.getBoundingClientRect?.()
      const viewport = viewportSize()
      if (rect && viewport) {
        setPlacement(
          placementFor(
            {top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right},
            viewport,
          ),
        )
      }
      timer.current = setTimeout(() => setShow(true), 400)
    },
    onHoverOut: () => {
      clearTimer()
      setShow(false)
    },
  }
  const pos =
    placement.vertical === 'below'
      ? placement.align === 'left'
        ? hoverStyles.belowLeft
        : hoverStyles.belowRight
      : placement.align === 'left'
        ? hoverStyles.aboveLeft
        : hoverStyles.aboveRight
  return (
    <View ref={anchor} {...hoverHandlers}>
      {children}
      {show && account ? (
        <View style={[hoverStyles.card, pos]}>
          <UserHoverCard
            account={account}
            sessionId={sessionId}
            onOpenProfile={onOpenProfile}
            testID={testID}
          />
        </View>
      ) : null}
    </View>
  )
}

const hoverStyles = StyleSheet.create({
  card: {
    position: 'absolute',
    zIndex: 50,
  },
  belowLeft: {top: '100%', left: 0},
  belowRight: {top: '100%', right: 0},
  aboveLeft: {bottom: '100%', left: 0},
  aboveRight: {bottom: '100%', right: 0},
})
