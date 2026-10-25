// Personal domain blocks (D3.7 split of `MutesSection.tsx`): the
// ACCOUNT's blocked domains, never the instance's admin blocks. A backend
// without the module keeps a disabled row with the reason — never a hidden
// row, never an inert one. Moved verbatim.

import {useCallback, useEffect, useState} from 'react'
import {View} from 'react-native'

import {msg} from '@lingui/macro'

import {
  isPermissionError,
  isUnsupportedError,
  normalizeDomainBlock,
  type Backend,
  type DomainBlocksApi,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {TextField} from '#/components/forms/TextField'
import {errorText} from '#/lib/localeErrors'
import {i18n} from '#/locale/i18n'

import {PlaceholderRow, SettingRow} from './rows'

/** Personal domain blocks (clickstone §1.4): the ACCOUNT's blocked
 * domains, never the instance's admin blocks. A backend without the module
 * keeps a disabled row with the reason — never a hidden row, never an
 * inert one. */
export function DomainBlocksSection({backend}: {backend: Backend}) {
  if (!backend.domainBlocks) {
    return (
      <PlaceholderRow
        title={i18n._(msg`Blocked domains`)}
        hint={i18n._(msg`Domains whose accounts and posts are hidden for you.`)}
        reason={
          backend.family === 'mastodon'
            ? i18n._(msg`This server has no personal domain blocks.`)
            : i18n._(msg`Needs a Mastodon-family server.`)
        }
        testID="placeholder-domain-blocks"
      />
    )
  }
  return <DomainBlockList api={backend.domainBlocks} />
}

function DomainBlockList({api}: {api: DomainBlocksApi}) {
  const [domains, setDomains] = useState<string[] | null>(null)
  /** The server caps a page (100); say so rather than implying the list
   * ends where the fetch did. */
  const [truncated, setTruncated] = useState(false)
  const [unavailable, setUnavailable] = useState<string | null>(null)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const page = await api.list({limit: 100})
      setDomains(page.items)
      setTruncated(!page.end)
      setUnavailable(null)
    } catch (err) {
      if (isUnsupportedError(err)) {
        // The endpoint exists on neither the server nor a proxy in front of
        // it: disable the row WITH the reason instead of erroring Settings.
        setUnavailable(i18n._(msg`This server has no personal domain blocks.`))
        setDomains([])
      } else {
        setError(errorText(i18n, err, i18n._(msg`Could not load.`)))
      }
    }
  }, [api])

  useEffect(() => {
    void load()
  }, [load])

  const block = async () => {
    if (busy) return
    const domain = normalizeDomainBlock(input)
    if (domain.length === 0) {
      setError(i18n._(msg`Enter a domain like example.com.`))
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.block(domain)
      setInput('')
      await load()
    } catch (err) {
      if (isUnsupportedError(err)) {
        setUnavailable(i18n._(msg`This server has no personal domain blocks.`))
      } else if (isPermissionError(err)) {
        setError(i18n._(msg`Your account cannot do that here.`))
      } else {
        setError(errorText(i18n, err, i18n._(msg`Action failed.`)))
      }
    } finally {
      setBusy(false)
    }
  }

  const unblock = async (domain: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await api.unblock(domain)
      setDomains(previous => (previous ?? []).filter(d => d !== domain))
      await load()
    } catch (err) {
      if (isUnsupportedError(err)) {
        setUnavailable(i18n._(msg`This server has no personal domain blocks.`))
      } else if (isPermissionError(err)) {
        setError(i18n._(msg`Your account cannot do that here.`))
      } else {
        setError(errorText(i18n, err, i18n._(msg`Action failed.`)))
      }
    } finally {
      setBusy(false)
    }
  }

  if (unavailable) {
    return (
      <PlaceholderRow
        title={i18n._(msg`Blocked domains`)}
        hint={i18n._(msg`Domains whose accounts and posts are hidden for you.`)}
        reason={unavailable}
        testID="placeholder-domain-blocks"
      />
    )
  }

  return (
    <SettingRow
      title={i18n._(msg`Blocked domains`)}
      hint={i18n._(
        msg`Domains whose accounts and posts are hidden for you. Personal blocks only.`,
      )}
      testID="domain-blocks">
      <TextField
        label={i18n._(msg`Block a domain`)}
        value={input}
        onChangeText={text => {
          setInput(text)
          setError(null)
        }}
        placeholder={i18n._(
          msg({
            message: 'example.com',
            comment: 'Example domain in the input placeholder; keep unless a localized example reads better',
          }),
        )}
        error={error ?? undefined}
        testID="domain-blocks-input"
      />
      <Button
        label={busy ? i18n._(msg`Saving…`) : i18n._(msg`Block domain`)}
        variant="secondary"
        disabled={busy || input.trim().length === 0}
        onPress={() => void block()}
        testID="domain-blocks-add"
      />
      {domains === null ? (
        <Caption color="faint">{i18n._(msg`Loading…`)}</Caption>
      ) : domains.length === 0 ? (
        <Caption color="faint">{i18n._(msg`None.`)}</Caption>
      ) : (
        <View style={[atoms.gap_sm]}>
          {domains.map(domain => (
            <View
              key={domain}
              style={[atoms.row, atoms.itemsCenter, atoms.gap_sm]}
              testID={`domain-block-${domain}`}>
              <View style={[atoms.flex1]}>
                <Body>{domain}</Body>
              </View>
              <Button
                label={i18n._(msg`Unblock`)}
                variant="secondary"
                disabled={busy}
                onPress={() => void unblock(domain)}
                testID={`domain-block-unblock-${domain}`}
              />
            </View>
          ))}
        </View>
      )}
      {truncated ? (
        <Caption color="faint">
          {i18n._(msg`Showing the first 100 blocked domains.`)}
        </Caption>
      ) : null}
    </SettingRow>
  )
}
