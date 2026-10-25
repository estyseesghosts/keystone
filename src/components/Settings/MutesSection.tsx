import {useCallback, useEffect, useState} from 'react'
import {View} from 'react-native'

import {msg} from '@lingui/macro'

import type {Account} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {i18n} from '#/locale/i18n'
import {useActiveBackend} from '#/screens/HomeFeed'
import {useActiveSession} from '#/state/session/SessionProvider'

import {PlaceholderRow, SectionHint} from './rows'
import {WordField} from './WordFields'
import {MuteBlockSearch} from './MuteBlockSearch'
import {AccountList} from './AccountLists'
import {DomainBlocksSection} from './DomainBlocks'

// Mutes section (v1 `/settings/mutes` parity): word/instance filters,
// account search-to-mute/block, and the muted, blocked, and repost-muted
// account lists with unmute/unblock. Each block gates independently —
// unsupported backends render an honest placeholder, never an error.
//
// Split (D3.7): the blocks live in `./WordFields`, `./MuteBlockSearch`,
// `./AccountLists`, and `./DomainBlocks`. This file keeps the section
// shell: session gating, the `me` fetch, and the refresh key.
//
// Scope rule (plan §2.2): renote-mute LISTS render only when the backend
// exposes `renoteMutes` (Misskey family, when implemented); otherwise the
// honest placeholder stays. The search row below offers state-aware
// undo (Mute/Unmute, Mute reposts/Unmute, Block/Unblock per v1) by
// re-reading `relationships` after search and after every action.

export function MutesSection() {
  const session = useActiveSession()
  const {backend} = useActiveBackend()
  const [me, setMe] = useState<Account | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = useCallback(() => setRefreshKey(k => k + 1), [])

  // Account switch: drop the previous account's record immediately so the
  // word fields clear while the next account loads instead of seeding from
  // (and briefly displaying) stale data. Same-account refreshes do not
  // clear: refreshKey alone leaves me (and in-progress edits) intact.
  useEffect(() => {
    setMe(null)
  }, [backend])

  useEffect(() => {
    let cancelled = false
    if (!backend) return
    void backend
      .me()
      .then(account => {
        if (!cancelled) setMe(account)
      })
      .catch(() => {
        if (!cancelled) setMe(null)
      })
    return () => {
      cancelled = true
    }
  }, [backend, refreshKey])

  if (!session || !backend) {
    return (
      <View style={[atoms.gap_sm]} testID="settings-section-mutes">
        <SectionHint>{i18n._(msg`Sign in to manage mutes and blocks.`)}</SectionHint>
      </View>
    )
  }

  const isMisskey = backend.family === 'misskey'
  return (
    <View style={[atoms.gap_sm]} testID="settings-section-mutes">
      {isMisskey ? (
        <>
          <WordField
            backend={backend}
            me={me}
            onSaved={refresh}
            field="mutedWords"
            title={i18n._(msg`Word mutes`)}
            hint={i18n._(msg`One group per line; words on a line must all match. /regex/ lines stay verbatim.`)}
            placeholder={i18n._(
              msg({
                message: 'spoiler\n/^advertisement/i',
                comment: 'Example word-mute lines in the input placeholder; localize the words if they read better',
              }),
            )}
          />
          <WordField
            backend={backend}
            me={me}
            onSaved={refresh}
            field="hardMutedWords"
            title={i18n._(msg`Hard word mutes`)}
            hint={i18n._(msg`Like word mutes, but matching posts never load.`)}
            placeholder={i18n._(msg`one group per line…`)}
          />
          <WordField
            backend={backend}
            me={me}
            onSaved={refresh}
            field="mutedInstances"
            title={i18n._(msg`Muted servers`)}
            hint={i18n._(msg`One host per line. Matching is case-sensitive.`)}
            placeholder={i18n._(
              msg({
                message: 'example.com',
                comment: 'Example domain in the input placeholder; keep unless a localized example reads better',
              }),
            )}
          />
        </>
      ) : (
        <PlaceholderRow
          title={i18n._(msg`Word and server mutes`)}
          hint={i18n._(msg`Soft words, hard words, muted servers.`)}
          reason={i18n._(msg`Needs a Misskey-family server.`)}
          testID="placeholder-word-mutes"
        />
      )}
      <MuteBlockSearch backend={backend} onChanged={refresh} />
      <AccountList
        title={i18n._(msg`Muted accounts`)}
        hint={i18n._(msg`Unmute to see their posts again.`)}
        testID="muted-list"
        load={b => b.mutes().then(p => p.items)}
        action={i18n._(msg`Unmute`)}
        run={(b, id) => b.unmute(id)}
        refreshKey={refreshKey}
      />
      <AccountList
        title={i18n._(msg`Blocked accounts`)}
        hint={i18n._(msg`Unblock to interact again.`)}
        testID="blocked-list"
        load={b => b.blocks().then(p => p.items)}
        action={i18n._(msg`Unblock`)}
        run={(b, id) => b.unblock(id)}
        refreshKey={refreshKey}
      />
      <DomainBlocksSection backend={backend} />
      {backend.renoteMutes ? (
        <AccountList
          title={i18n._(msg`Repost-muted accounts`)}
          hint={i18n._(msg`Unmute reposts to see them again.`)}
          testID="renote-mutes-list"
          load={b => (b.renoteMutes ? b.renoteMutes().then(p => p.items) : Promise.resolve([]))}
          action={i18n._(msg`Unmute reposts`)}
          run={(b, id) => b.unmuteRenotes(id)}
          refreshKey={refreshKey}
        />
      ) : (
        <PlaceholderRow
          title={i18n._(msg`Repost-muted accounts`)}
          hint={i18n._(msg`Accounts whose reposts are hidden.`)}
          reason={i18n._(msg`This server has no repost-mute list.`)}
          testID="placeholder-renote-mutes"
        />
      )}
    </View>
  )
}
