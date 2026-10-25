// Matrix user-ID chips + hovercard (D3.5 split from `RichText.tsx`).
// `@local:server` IDs are never webfinger handles and never navigate:
// the chip reports up to the root-owned explain + copy popup. Web hovers
// the small hovercard; native has no hover, so a tap copies directly.

import {useCallback, useEffect, useRef, useState, type ReactNode} from 'react'
import {Platform, StyleSheet, Text, View, type View as ViewType} from 'react-native'

import {msg} from '@lingui/macro'
import {useLingui} from '@lingui/react'

import {useTheme} from '#/alf/index'
import {Body} from '#/alf/typography'
import {Button} from '#/components/Button'
import {HoverLayer, HOVER_CLOSE_DELAY_MS, HOVER_FADE_LEAD_MS, cardPosition, ensurePointerTracking, leaveTargetStaysInside, pointerRecentlyMoved, shouldReviveOnCardEnter} from '#/components/Profile/HoverPreview'
import {Pressable} from '#/components/Pressable'
import {canCopy, copyText} from '#/lib/clipboard'
import {showToast} from '#/lib/toast'

/** The slice of renderer context Matrix chips read: border, text, size.
 * The full `Ctx` in `RichText.tsx` satisfies this structurally. */
export type MatrixCtx = {size: number; textColor: string; edge: string}

// Copy action shared by the native chip tap and the hovercard button.
function useCopyMatrixId(userId: string) {
  const {i18n} = useLingui()
  return useCallback(async () => {
    try {
      await copyText(userId)
      showToast(i18n._(msg`Copied`))
    } catch {
      showToast(i18n._(msg`Clipboard is not available on this platform.`))
    }
  }, [i18n, userId])
}

// Small profile-style hovercard for a Matrix user ID: the exact
// written text (never re-derived), what Matrix is, and a copy action.
// Navigation never happens for Matrix IDs. Exported for tests.
export function MatrixHovercard({userId}: {userId: string}) {
  const theme = useTheme()
  const {i18n} = useLingui()
  const copy = useCopyMatrixId(userId)
  const copyable = canCopy()
  return (
    <View
      testID="matrix-popup"
      style={[
        matrixCardStyles.card,
        {backgroundColor: theme.palette.bg, borderColor: theme.palette.edge},
      ]}>
      <Body testID="matrix-popup-handle">{userId}</Body>
      <Body color="muted">
        {i18n._(
          msg`Matrix is a secure and decentralized messaging protocol. You can message this user from Element, or any other Matrix chat client.`,
        )}
      </Body>
      <Button
        label={i18n._(msg`Copy handle`)}
        onPress={() => void copy()}
        disabled={!copyable}
        disabledReason={
          copyable ? undefined : i18n._(msg`Clipboard is not available on this platform.`)
        }
        testID="matrix-copy"
      />
    </View>
  )
}

const matrixCardStyles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    gap: 8,
    width: 320,
  },
})

const MATRIX_OPEN_DELAY_MS = 400

type MatrixCardPos = {top?: number; bottom?: number; left?: number; right?: number}

// Viewport metrics on web; null anywhere they do not exist (native,
// tests without a DOM) — the card falls back to below/left.
function matrixViewportSize(): {width: number; height: number} | null {
  if (typeof window === 'undefined') return null
  const {innerWidth, innerHeight} = window as unknown as {
    innerWidth?: unknown
    innerHeight?: unknown
  }
  if (typeof innerWidth !== 'number' || typeof innerHeight !== 'number') return null
  return {width: innerWidth, height: innerHeight}
}

// Web-only hover wrapper around the chip (P7 pattern, mirroring
// HoverPreview): ~400ms of hover floats the card above or below the
// anchor in the click-through HoverLayer — never a Modal, never a
// fullscreen capture. Native never reaches here (no hover there).
function MatrixHover({
  userId,
  children,
}: {
  userId: string
  children: ReactNode
}) {
  const [show, setShow] = useState(false)
  const [faded, setFaded] = useState(false)
  const [pos, setPos] = useState<MatrixCardPos | null>(null)
  const anchor = useRef<ViewType | null>(null)
  const cardEl = useRef<HTMLElement | null>(null)
  const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // Last genuine anchor-or-card leave (same revive gate as
  // HoverPreview): stays-inside ghosts never stamp it.
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
  // All timers scheduled from pointer events, never chained (same rule
  // as HoverPreview).
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
    // Layout-shift ghost: without recent pointer movement this arrival
    // isn't the user — ignore it, or closed cards reopen by themselves.
    if (!pointerRecentlyMoved()) return
    cancelClose()
    if (show) {
      setFaded(true)
      return
    }
    clearOpenPair()
    const el = anchor.current as unknown as {getBoundingClientRect?: () => DOMRect} | null
    const rect = el?.getBoundingClientRect?.()
    const viewport = matrixViewportSize()
    if (rect && viewport) {
      setPos(
        cardPosition(
          {top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right},
          viewport,
        ).pos,
      )
    }
    openTimer.current = setTimeout(() => setShow(true), MATRIX_OPEN_DELAY_MS)
    fadeTimer.current = setTimeout(() => setFaded(true), MATRIX_OPEN_DELAY_MS + HOVER_FADE_LEAD_MS)
  }
  const handleLeave = () => {
    leaveAt.current = Date.now()
    setFaded(false)
    clearOpenPair()
    if (show) scheduleClose()
  }
  // This RN Web version drops `onHoverIn`/`onHoverOut` on plain Views
  // (only Pressable wires them) — but it DOES forward `onMouseEnter`/
  // `onMouseLeave`, so the anchor uses those (same as HoverPreview).
  const hoverHandlers = {
    onMouseEnter: handleEnter,
    onMouseLeave: (e?: {relatedTarget?: unknown}) => {
      if (leaveTargetStaysInside([anchor.current, cardEl.current], e?.relatedTarget)) return
      handleLeave()
    },
  }
  return (
    <>
      <View ref={anchor} {...hoverHandlers}>
        {children}
      </View>
      {show ? (
        <HoverLayer
          pos={pos}
          cardRef={cardEl}
          anchorRef={anchor}
          fade={faded}
          onEnterCard={(e?: {relatedTarget?: unknown}) => {
            // Same crossing-only revive as HoverPreview: certain
            // anchor→card crossings and fast gap crossings while the
            // card still fades resurrect it; a later revisit of the
            // corpse is ignored and the scheduled unmount proceeds.
            if (!shouldReviveOnCardEnter(anchor.current, e?.relatedTarget, leaveAt.current)) return
            cancelClose()
            setFaded(true)
          }}
          onLeaveCard={e => {
            if (leaveTargetStaysInside([anchor.current, cardEl.current], e?.relatedTarget)) return
            handleLeave()
          }}
          onDismiss={() => setShow(false)}>
          <MatrixHovercard userId={userId} />
        </HoverLayer>
      ) : null}
    </>
  )
}

// Matrix user-ID chip (`@local:server`, colon — never a webfinger
// handle). Web hovers the small hovercard above; native has no hover,
// so a tap copies the handle directly. Matrix IDs never navigate, on
// any target.
export function MatrixChip({
  userId,
  ctx,
}: {
  userId: string
  ctx: MatrixCtx
}) {
  const copy = useCopyMatrixId(userId)
  const {i18n} = useLingui()
  const short = userId.startsWith('@') ? userId.slice(1) : userId
  const chip = (
    <Pressable
      style={[styles.chip, {borderColor: ctx.edge}]}
      accessibilityRole="button"
      accessibilityLabel={
        Platform.OS === 'web'
          ? i18n._(msg`Matrix handle: ${userId}`)
          : i18n._(msg`Matrix handle: ${userId}. Tap to copy.`)
      }
      testID="richtext-matrix-chip"
      onPress={() => void copy()}>
      <Text style={{fontSize: ctx.size, color: ctx.textColor}} numberOfLines={1}>
        {`[m] ${short}`}
      </Text>
    </Pressable>
  )
  if (Platform.OS !== 'web') return chip
  return (
    <MatrixHover userId={userId}>
      {chip}
    </MatrixHover>
  )
}

const styles = StyleSheet.create({
  // Inline chips (v1 `.mchip` parity): an atomic pill the line-box never
  // splits mid-word, so long URLs and handles wrap as a unit instead of
  // chopping across lines. Mirrors the `chip` style in `RichText.tsx`
  // (StaticMentionChip + bare-link chips) — keep the two in sync.
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
})
