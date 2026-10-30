import {useMemo, useRef, useState} from 'react'
import {Image, View, type View as ViewType} from 'react-native'
import {useLingui} from '@lingui/react'
import {msg, t} from '@lingui/macro'

import {useTheme as useAlfTheme} from '#/alf'
import {Body, Caption} from '#/alf/typography'
import {AnchoredPopup, PopupDesc, PopupHead, PopupRadioDot, PopupRow, PopupSep} from '#/components/Popup'
import {Pressable} from '#/components/Pressable'
import {Tooltip} from '#/components/Tooltip'
import {errorText} from '#/lib/localeErrors'
import {navigationRef} from '#/navigationRef'
import {backendForSession} from '@keystone/fedi'
import {useOptionalActiveSession, useSessionStore, useSessions} from '#/state/session/SessionProvider'

import {goMainTab, goStackScreen} from './shellNav'

function AccountAvatar({size = 32}: {size?: number}) {
  const session = useOptionalActiveSession()
  const alf = useAlfTheme()
  const uri = session?.user?.avatarUrl ?? null
  const label = (session?.user?.displayName ?? session?.accountId ?? '?')
    .slice(0, 1)
    .toUpperCase()
  if (uri) {
    return (
      <Image
        source={{uri}}
        style={{width: size, height: size, borderRadius: size / 2}}
        accessibilityIgnoresInvertColors
      />
    )
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: alf.palette.raise,
      }}>
      <Body>{label}</Body>
    </View>
  )
}

// --- Account menu (N16) ------------------------------------------------------
// v1 `AccountCard` parity, shell-chrome edition: the sidebar footer avatar
// and the mobile strip avatar open the full account list — every stored
// session as a row (name + origin), the active account labelled (never an
// inert switch button), one-tap switch for inactive accounts, per-account
// sign-out, Add account, Profile shortcut, and Announcements. Everything
// else (Messages, collections, Drive, Settings) lives in the sidebar
// proper or its footer buttons, so the menu no longer duplicates them.
// Rendered in `AnchoredPopup` (above the sidebar trigger, below the strip
// trigger), which flips and clamps so the menu can never hang off-screen.
function AccountMenu({
  onClose,
  testPrefix,
  overflowActions,
}: {
  onClose: () => void
  testPrefix: string
  /** Rail overflow: the collapsed sidebar hides its Settings / My Uploads
   * footer buttons, so the profile menu carries them instead. Expanded
   * sidebar and mobile strip leave this off (footer owns them there). */
  overflowActions?: boolean
}) {
  const {i18n} = useLingui()
  const store = useSessionStore()
  const sessions = useSessions()
  const activeId = store.activeId()
  const active = sessions.find(s => s.id === activeId) ?? null
  const backend = useMemo(() => (active ? backendForSession(active) : null), [active])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const closeAnd = (fn: () => void) => {
    onClose()
    fn()
  }
  const signOut = (id: string) => {
    setBusyId(id)
    setError(null)
    void store
      .signOut(id)
      .catch((err: unknown) => {
        setError(errorText(i18n, err, i18n._(msg`Sign-out failed.`)))
      })
      .finally(() => setBusyId(null))
  }

  return (
    <>
      <PopupHead>{i18n._(msg`Accounts`)}</PopupHead>
      {sessions.map(session => {
        const name = session.user?.displayName ?? session.accountId
        const isActive = session.id === activeId
        return (
          <View key={session.id}>
            {isActive ? (
              <PopupRow
                testID={`${testPrefix}-current-${session.id}`}
                label={name}
                disabled
                reason={i18n._(msg`Current account`)}
                onPress={() => {}}
                right={<PopupRadioDot on />}
              >
                <PopupDesc>{`${name} · ${session.origin}`}</PopupDesc>
              </PopupRow>
            ) : (
              <PopupRow
                testID={`${testPrefix}-switch-${session.id}`}
                label={i18n._(msg`Switch to ${name}`)}
                onPress={() => closeAnd(() => store.switch(session.id))}
                right={<PopupRadioDot on={false} />}
              >
                <PopupDesc>{`${name} · ${session.origin}`}</PopupDesc>
              </PopupRow>
            )}
            <PopupRow
              testID={`${testPrefix}-signout-${session.id}`}
              label={i18n._(msg`Sign out ${name}`)}
              disabled={busyId === session.id}
              reason={busyId === session.id ? i18n._(msg`Working…`) : undefined}
              onPress={() => signOut(session.id)}
            />
          </View>
        )
      })}
      <PopupSep />
      <PopupRow
        testID={`${testPrefix}-add`}
        label={i18n._(msg`Add account`)}
        onPress={() => closeAnd(() => navigationRef.navigate('Login'))}
      />
      <PopupSep />
      <PopupRow
        testID={`${testPrefix}-profile`}
        label={i18n._(msg`Profile`)}
        onPress={() => closeAnd(() => goMainTab('User'))}
      />
      {/* Announcements is the only stack destination left in the menu:
          everything else has a first-class sidebar or footer entry. */}
      {backend?.capabilities.announcements === 'supported' && backend.announcements ? (
        <PopupRow
          testID={`${testPrefix}-announcements`}
          label={i18n._(msg`Announcements`)}
          onPress={() => closeAnd(() => goStackScreen('Announcements'))}
        />
      ) : null}
      {/* Rail overflow: the collapsed sidebar hides Settings + My Uploads
          (footer buttons), so they live here instead. Expanded sidebar
          owns them in the footer, so they stay out of this menu there. */}
      {overflowActions ? (
        <>
          <PopupRow
            testID={`${testPrefix}-settings`}
            label={i18n._(msg`Settings`)}
            onPress={() =>
              closeAnd(() => {
                if (navigationRef.isReady()) navigationRef.navigate('Settings')
              })
            }
          />
          {active?.family === 'misskey' ? (
            <PopupRow
              testID={`${testPrefix}-uploads`}
              label={i18n._(msg`My Uploads`)}
              onPress={() => closeAnd(() => goStackScreen('Drive'))}
            />
          ) : null}
        </>
      ) : null}
      {error ? <Caption testID={`${testPrefix}-error`}>{error}</Caption> : null}
    </>
  )
}

export function AccountButton({
  testPrefix,
  menuSide,
  overflowActions,
}: {
  testPrefix: string
  menuSide: 'below' | 'above'
  overflowActions?: boolean
}) {
  const [open, setOpen] = useState(false)
  const anchor = useRef<ViewType | null>(null)
  return (
    <>
      <View ref={anchor} collapsable={false}>
        <Tooltip label={t`Account menu`}>
          <Pressable
            onPress={() => setOpen(v => !v)}
            accessibilityRole="button"
            accessibilityLabel={t`Account menu`}
            accessibilityState={{expanded: open}}
            hitSlop={8}
            testID={testPrefix}>
            <AccountAvatar />
          </Pressable>
        </Tooltip>
      </View>
      {open ? (
        <AnchoredPopup
          anchor={anchor}
          onClose={() => setOpen(false)}
          side={menuSide}
          minWidth={240}
          testID={`${testPrefix}-menu`}>
          <AccountMenu
            onClose={() => setOpen(false)}
            testPrefix={`${testPrefix}-menu`}
            overflowActions={overflowActions}
          />
        </AnchoredPopup>
      ) : null}
    </>
  )
}

