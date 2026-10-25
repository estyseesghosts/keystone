// Explore Users tab (D3.7 split of `src/screens/Explore.tsx`): the
// account search results (`AccountsSearch`) + the trending-users tab
// (`UsersTab`). Moved verbatim — retry, auth, and unavailable states
// are unchanged.

import {useEffect, useState} from 'react'
import {FlatList, View} from 'react-native'
import {useNavigation, type NavigationProp} from '@react-navigation/native'

import {msg} from '@lingui/macro'

import {
  isUnsupportedError,
  type Account,
  type Backend,
  type ExploreUsers,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {SkeletonList} from '#/components/Skeleton'
import {SignInButton} from '#/components/SignInButton'
import {i18n} from '#/locale/i18n'
import type {RootParamList} from '#/routes'

import {AccountRow, RowSeparator, SectionTitle} from './rows'

function useOpenAccount() {
  const navigation = useNavigation<NavigationProp<RootParamList>>()
  return (id: string) => navigation.navigate('User', {id})
}

export function AccountsSearch({backend, query}: {backend: Backend; query: string}) {
  const openAccount = useOpenAccount()
  const [accounts, setAccounts] = useState<Account[] | null>(null)
  const [error, setError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let cancelled = false
    setAccounts(null)
    setError(false)
    void backend.search
      .accounts(query, {limit: 20})
      .then(page => {
        if (!cancelled) setAccounts(page.items)
      })
      .catch(() => {
        if (!cancelled) setError(true)
      })
    return () => {
      cancelled = true
    }
  }, [backend, query, attempt])
  if (error) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Body>{i18n._(msg`Could not search profiles.`)}</Body>
        <Button label={i18n._(msg`Retry`)} variant="secondary" onPress={() => setAttempt(a => a + 1)} testID="explore-accounts-retry" />
      </View>
    )
  }
  if (!accounts) {
    return <SkeletonList variant="account" testID="explore-accounts-loading" />
  }
  if (accounts.length === 0) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="explore-accounts-empty">
        <Body>{i18n._(msg`No profiles found.`)}</Body>
      </View>
    )
  }
  return (
    <FlatList
      data={accounts}
      keyExtractor={a => a.id}
      testID="explore-accounts"
      ItemSeparatorComponent={() => <RowSeparator testID="explore-accounts-sep" />}
      renderItem={({item}) => <AccountRow account={item} onOpen={() => openAccount(item.id)} />}
    />
  )
}

export function UsersTab({backend, submitted}: {backend: Backend; submitted: string | null}) {
  const openAccount = useOpenAccount()
  const [users, setUsers] = useState<ExploreUsers | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [auth, setAuth] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (submitted != null) return
    if (!backend.explore) return
    let cancelled = false
    setUsers(null)
    setError(null)
    setAuth(false)
    void backend.explore
      .users({limit: 10})
      .then(u => {
        if (!cancelled) setUsers(u)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (isUnsupportedError(err)) {
          setError('Trending users are not available on this server.')
        } else if (err instanceof Error && /401|403/.test(err.message)) {
          setAuth(true)
        } else {
          setError(err instanceof Error ? err.message : 'Could not load trending users.')
        }
      })
    return () => {
      cancelled = true
    }
  }, [backend, submitted, attempt])
  if (submitted != null) {
    const name = submitted.replace(/^@+/, '').trim()
    if (!name) {
      return (
        <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
          <Body>{i18n._(msg`Type a profile name to search.`)}</Body>
        </View>
      )
    }
    return <AccountsSearch backend={backend} query={name} />
  }
  if (!backend.explore) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="explore-users-unavailable">
        <Body>{i18n._(msg`Trending users are not available on this server.`)}</Body>
        <Caption color="faint">{i18n._(msg`Type a query above to search profiles.`)}</Caption>
      </View>
    )
  }
  if (auth) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
        <Body>{i18n._(msg`Sign in to see suggested users.`)}</Body>
        <SignInButton />
      </View>
    )
  }
  if (error) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Body>{error}</Body>
        <Button label={i18n._(msg`Retry`)} variant="secondary" onPress={() => setAttempt(a => a + 1)} testID="explore-users-retry" />
      </View>
    )
  }
  if (!users) {
    return <SkeletonList variant="account" testID="explore-users-loading" />
  }
  if (users.pinned.length === 0 && users.suggested.length === 0) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]}>
        <Body>{i18n._(msg`No trending users right now.`)}</Body>
      </View>
    )
  }
  return (
    <FlatList
      testID="explore-users"
      ItemSeparatorComponent={() => <RowSeparator testID="explore-users-sep" />}
      data={[
        ...(users.pinned.length > 0 ? [{key: 'pinned-label', label: 'Pinned'}] : []),
        ...users.pinned.map(a => ({key: `pinned-${a.id}`, account: a})),
        ...(users.suggested.length > 0 ? [{key: 'suggested-label', label: 'Suggested'}] : []),
        ...users.suggested.map(a => ({key: `suggested-${a.id}`, account: a})),
      ]}
      keyExtractor={row => row.key}
      renderItem={({item}) =>
        'label' in item ? (
          <SectionTitle label={item.label} />
        ) : (
          <AccountRow account={item.account} onOpen={() => openAccount(item.account.id)} />
        )
      }
    />
  )
}
