// Mutes word fields (D3.7 split of `MutesSection.tsx`): the seeded word/
// server-mute text fields. R0.1 wiring is preserved verbatim — the
// account-identity reseed (never an edit, never across accounts) lives
// here, and the R0.1 account-switch test pins it.

import {useEffect, useRef, useState} from 'react'
import {View} from 'react-native'

import {msg} from '@lingui/macro'

import {
  formatWordFilters,
  isPermissionError,
  parseMutedInstances,
  parseWordFilters,
  type Account,
  type Backend,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {TextField} from '#/components/forms/TextField'
import {errorText} from '#/lib/localeErrors'
import {i18n} from '#/locale/i18n'

import {SettingRow} from './rows'

export type WordFieldName = 'mutedWords' | 'hardMutedWords' | 'mutedInstances'

function fieldValues(me: Account | null, field: WordFieldName): string {
  const bag = me?.ext.me as Record<string, unknown> | undefined
  if (field === 'mutedInstances') {
    const raw = bag?.[field]
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string').join('\n') : ''
  }
  return formatWordFilters(bag?.[field] as Array<string | string[]> | undefined)
}

export function WordField({
  backend,
  me,
  onSaved,
  field,
  title,
  hint,
  placeholder,
}: {
  backend: Backend
  me: Account | null
  onSaved: () => void
  field: WordFieldName
  title: string
  hint: string
  placeholder: string
}) {
  const [value, setValue] = useState(() => fieldValues(me, field))
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  // The account record can arrive after the user starts typing: seed from
  // it at most once per account, and never over an edit (refs, so no
  // stale closures). When the account identity changes — including to null
  // while the next account loads — drop the old text AND old edits (R0.1):
  // account A's draft must never seed, and save onto, account B.
  const seeded = useRef(false)
  const edited = useRef(false)
  const lastAccountId = useRef<string | null | undefined>(undefined)

  useEffect(() => {
    const id = me?.id ?? null
    if (lastAccountId.current != null && lastAccountId.current !== id) {
      lastAccountId.current = id
      edited.current = false
      seeded.current = me != null
      setValue(me ? fieldValues(me, field) : '')
      return
    }
    lastAccountId.current = id
    if (!seeded.current && me) {
      seeded.current = true
      if (!edited.current) setValue(fieldValues(me, field))
    }
  }, [me, field])

  const save = async () => {
    if (busy) return
    setError(null)
    setNotice(null)
    let parsed: Array<string | string[]> | string[]
    try {
      parsed = field === 'mutedInstances' ? parseMutedInstances(value) : parseWordFilters(value)
    } catch (err) {
      // A bad `/regex/` line renders its localized code (`{line}` carried
      // in params); anything else the contextual fallback — never raw text.
      setError(errorText(i18n, err, i18n._(msg`Could not save.`)))
      return
    }
    setBusy(true)
    try {
      await backend.updateProfile({ext: {[field]: parsed}})
      setNotice(i18n._(msg`Saved.`))
      onSaved()
    } catch (err) {
      if (isPermissionError(err)) setError(i18n._(msg`Your account cannot change this setting.`))
      else setError(errorText(i18n, err, i18n._(msg`Could not save.`)))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingRow title={title} hint={hint} testID={`wordfield-${field}`}>
      <TextField
        label={title}
        value={value}
        onChangeText={text => {
          setValue(text)
          edited.current = true
          setNotice(null)
        }}
        placeholder={placeholder}
        error={error ?? undefined}
        testID={`wordfield-${field}-input`}
      />
      <View style={[atoms.row, atoms.itemsCenter, atoms.gap_sm]}>
        <Button
          label={busy ? i18n._(msg`Saving…`) : i18n._(msg`Save`)}
          variant="primary"
          disabled={busy}
          onPress={() => void save()}
          testID={`wordfield-${field}-save`}
        />
        {notice ? <Caption color="faint">{notice}</Caption> : null}
      </View>
    </SettingRow>
  )
}
