import {useMemo, type ReactNode} from 'react'
import {Platform, Pressable, StyleSheet, View, type ViewStyle} from 'react-native'
import {useI18n} from '#/locale/i18n'
import {msg, t} from '@lingui/macro'

import {useTheme as useAlfTheme} from '#/alf'
import type {ShellLayout} from '#/alf/breakpoints'
import {butterflyPx} from '#/alf/tokens'
import {Body, Caption, Heading} from '#/alf/typography'
import {
  AntennaIcon,
  BellIcon,
  ChannelIcon,
  ClipIcon,
  CollapseIcon,
  DriveIcon,
  ExpandIcon,
  ListIcon,
  LoginIcon,
  MessageIcon,
  PageIcon,
  PencilIcon,
  SettingsIcon,
  StarIcon,
} from '#/components/icons'
import {navigationRef} from '#/navigationRef'
import {
  collapseSidebar,
  expandSidebar,
} from '#/state/sideNav'
import {useOptionalActiveSession} from '#/state/session/SessionProvider'
import {backendForSession, type Backend} from '@keystone/fedi'
import type {I18n} from '@lingui/core'

import {AccountButton} from './AccountMenu'
import {
  NotificationsUnreadBadge,
  TabIcon,
  goMainTab,
  goStackScreen,
  isTabFocused,
  type LeafState,
  type StackDestination,
  type TabParamList,
} from './shellNav'

// --- Sidebar collections + footer actions (sidebar reshuffle) --------------
// Groups are separated by padding space only (no divider lines). Feeds:
// Home / My Network / Explore. Channels: Misskey family only (Mastodon has
// no equivalent backend, so the group hides there). Collections: one row
// per concept with the platform's own name — Mastodon `Bookmarks` (opens
// the Favorites screen) + `Lists`; Misskey `Clips` + `Antennas`. Favourites
// on Misskey live inside Clips (a pinned entry to Favorites); Misskey
// lists live inside Antennas (a link to Lists) — see those screens.
// `Pages` is a Misskey-only stub (disabled with a reason) until it ships.
// Footer quick actions: Settings + Messages + Notifications everywhere,
// plus My Uploads (Drive) on Misskey only.
type CollectionTarget = 'Channels' | 'Clips' | 'Antennas' | 'Lists' | 'Favorites'

const COLLECTION_ICONS: Record<CollectionTarget, (p: {size?: number; color?: string}) => ReactNode> = {
  Channels: ChannelIcon,
  Clips: ClipIcon,
  Antennas: AntennaIcon,
  Lists: ListIcon,
  Favorites: StarIcon,
}

function collectionEntries(
  session: {family: string} | null,
  backend: Backend | null,
): CollectionTarget[] {
  if (!session) return []
  // Misskey: channels (capability + module gate), clips (capability +
  // module gate), antennas (family gate, as before).
  if (session.family === 'misskey') {
    const out: CollectionTarget[] = []
    if (backend?.capabilities.channels === 'supported' && backend.channels) {
      out.push('Channels')
    }
    if (backend?.capabilities.clips === 'supported' && backend.clips) {
      out.push('Clips')
    }
    out.push('Antennas')
    return out
  }
  // Mastodon: bookmarks (the Favorites screen, always present when signed
  // in) + lists (capability + module gate). No channels row — there is no
  // Communities backend yet, so the group hides instead of going inert.
  const out: CollectionTarget[] = ['Favorites']
  if (backend?.capabilities.lists === 'supported' && backend.lists) {
    out.push('Lists')
  }
  return out
}

function collectionEntryLabel(i18n: I18n, key: CollectionTarget): string {
  switch (key) {
    case 'Channels':
      return i18n._(msg`Channels`)
    case 'Clips':
      return i18n._(msg`Clips`)
    case 'Antennas':
      return i18n._(msg`Antennas`)
    case 'Lists':
      return i18n._(msg`Lists`)
    case 'Favorites':
      return i18n._(msg`Bookmarks`)
  }
}

/** Collection rows navigate to stack screens, except Misskey `Bookmarks`
 * which is the Favorites screen under its platform name. */
function collectionTarget(key: CollectionTarget): StackDestination {
  return key
}

/** Stable testIDs under the platform label (Bookmarks, not Favorites). */
function collectionTestID(key: CollectionTarget): string {
  if (key === 'Favorites') return 'sidebar-bookmarks'
  return `sidebar-${key.toLowerCase()}`
}

/** `@user@host` for the sidebar footer identity row. The username comes
 * from the session profile — `accountId` is the internal session key (a
 * server-side ID like `are3i8gsgn…`), never the login name. */
export function handleLine(session: {
  accountId: string
  origin: string
  user?: {username: string} | null
}): string {
  const username = session.user?.username ?? session.accountId
  try {
    return `@${username}@${new URL(session.origin).host}`
  } catch {
    return `@${username}@${session.origin}`
  }
}

/** Which message destination ships, if any: the DM inbox on mastodon +
 * akkoma, Misskey chat rooms on misskey + sharkey. Null hides the footer
 * entry instead of rendering an inert control. */
function messageTarget(backend: Backend | null): 'Conversations' | 'ChatRooms' | null {
  if (backend?.capabilities.direct_messages === 'supported' && backend.conversations) {
    return 'Conversations'
  }
  if (backend?.capabilities.direct_messages === 'supported' && backend.chat) {
    return 'ChatRooms'
  }
  return null
}

/** Misskey Pages stub reason (sidebar reshuffle: Pages ship later). */
function pagesStubReason(i18n: I18n): string {
  return i18n._(msg`Pages ship in a later slice.`)
}

// --- Sidebar (rail + full): feeds, channels, collections, footer actions.
// 220px with labels, 68px icon rail 721–1000px. Sticky full-height column.
// Groups are separated by padding space only (no divider lines). Feed
// entries go through `goMainTab` — the sidebar lives outside every
// navigator, so bare tab names would resolve nowhere.
export function Sidebar({layout, leaf}: {layout: ShellLayout; leaf: LeafState}) {
  const session = useOptionalActiveSession()
  const i18n = useI18n()
  const alf = useAlfTheme()
  const backend = useMemo(() => (session ? backendForSession(session) : null), [session])
  const rail = layout === 'rail'
  const isMisskey = session?.family === 'misskey'
  const entries: {key: keyof TabParamList; label: string}[] = [
    {key: 'Home', label: i18n._(msg`Home`)},
    {key: 'Network', label: i18n._(msg`My Network`)},
    {key: 'Explore', label: i18n._(msg`Explore`)},
  ]
  const allCollections = collectionEntries(session, backend)
  const channelRows = allCollections.filter(k => k === 'Channels')
  const collectionRows = allCollections.filter(k => k !== 'Channels')
  const msgTarget = messageTarget(backend)
  const quickActions: {
    key: string
    label: string
    testID: string
    Icon: (p: {size?: number; color?: string}) => ReactNode
    badge?: boolean
    onPress: () => void
  }[] = []
  if (session) {
    quickActions.push({
      key: 'settings',
      label: i18n._(msg`Settings`),
      testID: 'sidebar-settings',
      Icon: SettingsIcon,
      onPress: () => navigationRef.navigate('Settings'),
    })
    if (msgTarget) {
      quickActions.push({
        key: 'messages',
        label: i18n._(msg`Messages`),
        testID: 'sidebar-messages',
        Icon: MessageIcon,
        onPress: () => goStackScreen(msgTarget),
      })
    }
    if (isMisskey) {
      quickActions.push({
        key: 'uploads',
        label: i18n._(msg`My Uploads`),
        testID: 'sidebar-uploads',
        Icon: DriveIcon,
        onPress: () => goStackScreen('Drive'),
      })
    }
    quickActions.push({
      key: 'notifications',
      label: i18n._(msg`Notifications`),
      testID: 'sidebar-notifications',
      Icon: BellIcon,
      badge: true,
      onPress: () => goMainTab('Notifications'),
    })
  }
  const renderCollectionRow = (key: CollectionTarget) => {
    const Icon = COLLECTION_ICONS[key]
    const label = collectionEntryLabel(i18n, key)
    const target = collectionTarget(key)
    const active = leaf.name === target
    const fg = active ? alf.palette.bg : alf.palette.text
    return (
      <Pressable
        key={key}
        onPress={() => goStackScreen(target)}
        accessibilityRole="button"
        accessibilityState={{selected: active}}
        accessibilityLabel={label}
        testID={collectionTestID(key)}
        style={[
          styles.navlink,
          rail && styles.navlinkRail,
          active && {backgroundColor: alf.palette.text},
        ]}>
        <Icon size={20} color={fg} />
        {rail ? null : <Body style={{color: fg}}>{label}</Body>}
      </Pressable>
    )
  }
  // Signed out, the sidebar footer carries Sign in (v1) — no Login entry up
  // top. (The Login *tab* still exists for the mobile layout.)
  return (
    <View
      style={[
        styles.sidebar,
        rail ? styles.sidebarRail : styles.sidebarFull,
        {borderEndColor: alf.palette.border},
      ]}>
      {rail ? (
        <Pressable
          onPress={expandSidebar}
          accessibilityRole="button"
          accessibilityLabel={t`Expand sidebar`}
          testID="sidebar-expand"
          style={[styles.navlinkRail, styles.brandRail]}>
          <ExpandIcon size={20} color={alf.palette.text} />
        </Pressable>
      ) : (
        <View style={styles.brandRow}>
          <Heading style={styles.brand}>{t`Keystone`}</Heading>
          <Pressable
            onPress={collapseSidebar}
            accessibilityRole="button"
            accessibilityLabel={t`Collapse sidebar`}
            testID="sidebar-collapse"
            style={styles.brandToggle}>
            <CollapseIcon size={20} color={alf.palette.text} />
          </Pressable>
        </View>
      )}
      {entries.map(e => {
        const active = isTabFocused(leaf, e.key, session?.accountId ?? null)
        const fg = active ? alf.palette.bg : alf.palette.text
        return (
          <Pressable
            key={e.key}
            onPress={() => goMainTab(e.key)}
            accessibilityRole="button"
            accessibilityState={{selected: active}}
            accessibilityLabel={e.label}
            style={[
              styles.navlink,
              rail && styles.navlinkRail,
              active && {backgroundColor: alf.palette.text},
            ]}>
            <TabIcon name={e.key} color={fg} />
            {rail ? null : <Body style={{color: fg}}>{e.label}</Body>}
          </Pressable>
        )
      })}
      {isMisskey ? (
        <View style={styles.sideGroup}>
          {channelRows.map(renderCollectionRow)}
          <Pressable
            disabled
            accessibilityRole="button"
            accessibilityState={{disabled: true}}
            accessibilityLabel={`${i18n._(msg`Pages`)}. ${pagesStubReason(i18n)}`}
            testID="sidebar-pages"
            style={[styles.navlink, rail && styles.navlinkRail, {opacity: 0.55}]}>
            <PageIcon size={20} color={alf.palette.text} />
            {rail ? null : <Body>{i18n._(msg`Pages`)}</Body>}
          </Pressable>
        </View>
      ) : null}
      {collectionRows.length > 0 ? (
        <View style={styles.sideGroup}>{collectionRows.map(renderCollectionRow)}</View>
      ) : null}
      <View style={{flex: 1}} />
      <View style={styles.navuser}>
        {session ? (
          <>
            <View style={[styles.navlink, rail && styles.navlinkRail]}>
              <AccountButton
                testPrefix="sidebar-account"
                menuSide="above"
                overflowActions={rail}
              />
              {rail ? null : (
                <View style={{flex: 1, minWidth: 0}}>
                  <Body numberOfLines={1}>
                    {session.user?.displayName ?? session.accountId}
                  </Body>
                  <Caption color="faint" numberOfLines={1}>
                    {handleLine(session)}
                  </Caption>
                </View>
              )}
            </View>
            {/* Post sits below the profile, above the quick actions — in
                BOTH layouts, so the narrow sidebar never loses it. The
                outline + pencil mark it apart from the category tabs. */}
            <Pressable
              onPress={() => navigationRef.navigate('Compose')}
              accessibilityRole="button"
              accessibilityLabel={t`Write a post`}
              testID="sidebar-post"
              style={[
                styles.navlink,
                rail && styles.navlinkRail,
                styles.postButton,
                {borderColor: alf.palette.edge},
              ]}>
              <PencilIcon size={20} color={alf.palette.text} />
              {rail ? null : <Body>{t`Post`}</Body>}
            </Pressable>
            {rail ? (
              <View style={styles.quickRail}>
                {quickActions
                  .filter(a => a.key !== 'settings' && a.key !== 'uploads')
                  .map(a => (
                    <Pressable
                      key={a.key}
                      onPress={a.onPress}
                      accessibilityRole="button"
                      accessibilityLabel={a.label}
                      testID={a.testID}
                      style={styles.navlinkRail}>
                      <a.Icon size={20} color={alf.palette.text} />
                      {a.badge ? (
                        <NotificationsUnreadBadge sessionId={session.id} compact />
                      ) : null}
                    </Pressable>
                  ))}
              </View>
            ) : (
              <View style={[styles.quickGrid, isMisskey && styles.quickGridWrap]}>
                {quickActions.map(a => (
                  <Pressable
                    key={a.key}
                    onPress={a.onPress}
                    accessibilityRole="button"
                    accessibilityLabel={a.label}
                    testID={a.testID}
                    style={[styles.quickCell, isMisskey && styles.quickCellHalf]}>
                    <View style={styles.quickIconRow}>
                      <a.Icon size={20} color={alf.palette.text} />
                      {a.badge ? (
                        <NotificationsUnreadBadge sessionId={session.id} compact />
                      ) : null}
                    </View>
                    <Body style={[styles.tabLabel, {color: alf.palette.text}]} numberOfLines={1}>
                      {a.label}
                    </Body>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        ) : (
          <Pressable
            onPress={() => goMainTab('Login')}
            accessibilityRole="button"
            accessibilityLabel={t`Sign in`}
            style={[styles.navlink, rail && styles.navlinkRail]}>
            <LoginIcon size={20} color={alf.palette.text} />
            {rail ? null : <Body>{t`Sign in`}</Body>}
          </Pressable>
        )}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  sidebar: {
    flexShrink: 0,
    borderEndWidth: 1,
    padding: 16,
    gap: 4,
    ...Platform.select({
      web: {position: 'sticky', top: 0, height: '100vh'} as unknown as ViewStyle,
      default: {},
    }),
  },
  sidebarFull: {
    ...Platform.select({
      web: {width: 'max-content', minWidth: butterflyPx.sidebarMin, maxWidth: '40vw'} as unknown as ViewStyle,
      default: {width: butterflyPx.sidebarMin},
    }),
  },
  sidebarRail: {
    width: butterflyPx.railWidth,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  brand: {
    fontWeight: '700',
    fontSize: 20,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  brandRail: {
    alignItems: 'center',
    marginBottom: 12,
  },
  brandToggle: {
    padding: 4,
    borderRadius: 8,
  },
  navlink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 8,
  },
  navlinkRail: {
    justifyContent: 'center',
    minHeight: 40,
  },
  postButton: {
    borderWidth: 1,
    marginTop: 8,
  },
  navuser: {
    paddingTop: 12,
    gap: 4,
  },
  sideGroup: {
    marginTop: 28,
  },
  quickGrid: {
    flexDirection: 'row',
    marginTop: 8,
  },
  quickGridWrap: {
    flexWrap: 'wrap',
  },
  quickCell: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    borderRadius: 8,
  },
  quickCellHalf: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: '50%',
  },
  quickIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  quickRail: {
    alignItems: 'center',
    marginTop: 8,
  },
  tabLabel: {
    fontSize: 10,
    lineHeight: 12,
  },
})
