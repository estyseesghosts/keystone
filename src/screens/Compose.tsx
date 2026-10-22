import {useEffect, useRef, useState} from 'react'
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  View,
  type ViewStyle,
} from 'react-native'
import {
  CommonActions,
  useNavigation,
  useRoute,
  type RouteProp,
} from '@react-navigation/native'

import type {Post} from '@keystone/fedi'

import {useTheme as useAlfTheme} from '#/alf'
import {overlayChrome} from '#/alf/themes'
import {atoms} from '#/alf/atoms'
import {useShellLayout} from '#/alf/breakpoints'
import {Body} from '#/alf/typography'
import {Button} from '#/components/Button'
import {useOptionalSafeAreaInsets} from '#/components/insets'
import {CompactComposer} from '#/components/Composer/CompactComposer'
import {sheetKeyboardInset, sheetVisibleMaxHeight} from '#/components/Composer/Composer'
import {Loader} from '#/components/Loader'
import {Pressable} from '#/components/Pressable'
import {takeRedraftSeed, type RedraftSeed} from '#/lib/redraft'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'
import {appStorage} from '#/storage'

// Compose route (slice 4.3): floating overlay over the current screen
// (v1 `.postbox-overlay`): dimmed backdrop (tap = close) + centered card.
// Mobile goes full-bleed like the reference client; wider shells get the
// 600px card. Resolves reply/quote/edit targets through the ACTIVE session's
// backend. Params: replyToId, quoteId, draftId, editId.
export function ComposeScreen() {
  const route = useRoute<RouteProp<RootParamList, 'Compose'>>()
  const nav = useNavigation()
  const layout = useShellLayout()
  const alf = useAlfTheme()
  const {session, backend} = useActiveBackend()
  const {replyToId, quoteId, draftId, editId, redraftId} = route.params ?? {}
  const [targets, setTargets] = useState<{replyTo: Post | null; quote: Post | null; editing: Post | null} | null>(null)
  const [failed, setFailed] = useState<string | null>(null)
  // Delete-and-redraft seed (clickstone §1.7): read ONCE from the handoff
  // the delete flow filled. A missing seed means the route was reached
  // without a redraft (cold start/deep link) — that is its own honest
  // state, not an empty composer. The ref keeps the read out of a state
  // initializer that React could invoke twice.
  const seedRef = useRef<RedraftSeed | null | undefined>(undefined)
  if (seedRef.current === undefined) {
    seedRef.current = redraftId ? takeRedraftSeed(redraftId) : null
  }
  const redraftSeed = seedRef.current
  // Native keyboard tracking (C3): the KeyboardAvoidingView already offsets
  // on iOS, but the sheet card itself also caps to the visible area and (on
  // Android, where the KAV uses `height`) pads below the content so the
  // toolbar/input stay above the keyboard. Web needs neither (CSS).
  const {height: windowHeight} = useWindowDimensions()
  const [kbHeight, setKbHeight] = useState(0)
  useEffect(() => {
    if (Platform.OS === 'web') return
    const show = Keyboard.addListener('keyboardDidShow', e => {
      setKbHeight(e.endCoordinates?.height ?? 0)
    })
    const hide = Keyboard.addListener('keyboardDidHide', () => setKbHeight(0))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])
  const mobile = layout === 'mobile'
  const cappedMaxHeight = sheetVisibleMaxHeight(Platform.OS, layout, windowHeight, kbHeight)
  // iOS KAV `padding` already offsets; the manual pad is Android-only so the
  // toolbar does not sit exactly on the keyboard edge there either.
  const bottomPad = Platform.OS === 'android' ? sheetKeyboardInset(Platform.OS, kbHeight) : 0
  // Home-indicator clearance on the full-bleed mobile sheet (N21); the
  // desktop card is untouched (insets read 0 on web anyway).
  const insets = useOptionalSafeAreaInsets()

  const close = () => {
    if (nav.canGoBack()) nav.goBack()
    else nav.dispatch(CommonActions.reset({index: 0, routes: [{name: 'Main'}]}))
  }

  const shell = (content: React.ReactNode) => (
    <View style={styles.overlay} testID="compose-overlay">
      <Pressable
        style={styles.backdrop}
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel="Close composer"
        testID="compose-backdrop"
      />
      <View pointerEvents="box-none" style={styles.cardWrap}>
        <View
          testID="compose-card"
          style={[
            styles.card,
            mobile ? styles.cardMobile : styles.cardFloat,
            {backgroundColor: alf.palette.bg, borderColor: alf.palette.edge},
            cappedMaxHeight !== undefined ? {maxHeight: cappedMaxHeight} : null,
            {paddingBottom: bottomPad + (mobile ? insets.bottom : 0)},
          ]}>
          {mobile ? (
            <View testID="compose-grabber" style={styles.grabberWrap} pointerEvents="none">
              <View style={[styles.grabber, {backgroundColor: alf.palette.faint}]} />
            </View>
          ) : null}
          <KeyboardAvoidingView
            style={styles.kav}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
            keyboardVerticalOffset={0}>
            {/* Sheet content scrolls inside the card (never traps the page
                behind it): popups render in a Modal, so this ScrollView never
                nests a VirtualizedList. */}
            <ScrollView
              testID="compose-sheet-scroll"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.sheetScrollContent}>
              {content}
            </ScrollView>
          </KeyboardAvoidingView>
        </View>
      </View>
    </View>
  )

  useEffect(() => {
    if (!backend) return
    let cancelled = false
    setTargets(null)
    setFailed(null)
    Promise.all([
      replyToId ? backend.post(replyToId) : Promise.resolve(null),
      quoteId ? backend.post(quoteId) : Promise.resolve(null),
      editId ? backend.post(editId) : Promise.resolve(null),
    ]).then(
      ([replyTo, quote, editing]) => !cancelled && setTargets({replyTo, quote, editing}),
      err => !cancelled && setFailed(err instanceof Error ? err.message : 'Could not load the post.'),
    )
    return () => {
      cancelled = true
    }
  }, [backend, session?.id, replyToId, quoteId, editId])

  if (!session || !backend) {
    return shell(
      <View style={[atoms.centered, atoms.p_md, atoms.gap_md]}>
        <Body>Sign in to post.</Body>
        <Button label="Close" variant="secondary" onPress={close} />
      </View>,
    )
  }
  if (failed) {
    return shell(
      <View style={[atoms.centered, atoms.p_md, atoms.gap_md]}>
        <Body>{failed}</Body>
        <Button label="Close" variant="secondary" onPress={close} />
      </View>,
    )
  }
  if (redraftId && !redraftSeed) {
    return shell(
      <View style={[atoms.centered, atoms.p_md, atoms.gap_md]}>
        <Body>There is nothing to redraft here.</Body>
        <Button label="Close" variant="secondary" onPress={close} />
      </View>,
    )
  }
  if (!targets) {
    return shell(
      <View style={[atoms.centered, atoms.p_md]}>
        <Loader />
      </View>,
    )
  }
  return shell(
    <CompactComposer
      // Remount when the account or target changes: state never carries across.
      key={`${session.id}|${replyToId ?? ''}|${quoteId ?? ''}|${draftId ?? ''}|${editId ?? ''}|${redraftId ?? ''}`}
      session={session}
      backend={backend}
      store={appStorage()}
      replyTo={targets.replyTo}
      quote={targets.quote}
      editing={targets.editing}
      redraftSeed={redraftSeed}
      draftId={draftId ?? null}
      onClose={close}
    />,
  )
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    ...Platform.select({
      web: {position: 'fixed', inset: 0, zIndex: 100} as unknown as ViewStyle,
      default: {},
    }),
    // Fixed light-on-dark chrome (`overlayChrome`): the scrim stays black
    // in both themes, dimming whatever surface sits behind the sheet.
    // No foreground text ever renders on it — the card above carries its
    // own paired theme background.
    backgroundColor: overlayChrome.backdrop,
    opacity: 0.55,
  },
  cardWrap: {
    flex: 1,
    alignItems: 'center',
    ...Platform.select({
      web: {position: 'fixed', inset: 0, zIndex: 101, paddingTop: 48} as unknown as ViewStyle,
      default: {},
    }),
  },
  card: {
    width: '100%',
    maxWidth: 600,
    overflow: 'hidden',
  },
  kav: {
    flex: 1,
  },
  cardFloat: {
    maxHeight: '85%',
    borderWidth: 1,
    borderRadius: 16,
  },
  cardMobile: {
    flex: 1,
    marginTop: 0,
  },
  grabberWrap: {
    alignItems: 'center',
    paddingTop: 8,
    paddingBottom: 4,
  },
  grabber: {
    width: 40,
    height: 4,
    borderRadius: 2,
    opacity: 0.6,
  },
  sheetScrollContent: {
    flexGrow: 1,
  },
})
