import {useEffect, useMemo, useState} from 'react'
import {StyleSheet, View} from 'react-native'
import {msg} from '@lingui/macro'
import {useI18n} from '#/locale/i18n'

import {
  autocompleteTriggerAt,
  type Account,
  type AutocompleteTrigger,
  type Backend,
  type CustomEmoji,
} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {radius, space} from '#/alf/tokens'
import {Caption} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'

// Mention / hashtag / custom-emoji suggestions (slice 4.3). Accounts and
// tags come from the owning session's backend (hidden when the server has
// no such search); emoji come from the session's own custom emoji list.

export interface Suggestion {
  key: string
  label: string
  /** Text inserted in place of the trigger token. */
  insert: string
}

export function useSuggestions(
  text: string,
  caret: number,
  backend: Backend | null,
  emojis: CustomEmoji[] | undefined,
): {trigger: AutocompleteTrigger; suggestions: Suggestion[]} {
  const trigger = useMemo(() => autocompleteTriggerAt(text, caret), [text, caret])
  const [remote, setRemote] = useState<{key: string; items: Suggestion[]}>({key: '', items: []})
  const tkey = trigger ? `${trigger.kind}:${trigger.query}` : ''

  useEffect(() => {
    if (!trigger || !backend || trigger.kind === 'emoji' || trigger.query.length === 0) return
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        let items: Suggestion[] = []
        if (trigger.kind === 'mention' && backend.search.suggestAccounts) {
          const page = await backend.search.suggestAccounts(trigger.query, {limit: 6})
          items = page.items.map((a: Account) => ({
            key: a.id,
            label: `@${a.acct}`,
            insert: `@${a.acct}`,
          }))
        } else if (trigger.kind === 'hashtag' && backend.search.suggestTags) {
          const tags = await backend.search.suggestTags(trigger.query, {limit: 6})
          items = tags.map(t => ({key: t, label: `#${t}`, insert: `#${t}`}))
        }
        if (!cancelled) setRemote({key: tkey, items})
      } catch {
        if (!cancelled) setRemote({key: tkey, items: []})
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [tkey, backend, trigger])

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!trigger) return []
    if (trigger.kind === 'emoji') {
      const q = trigger.query.toLowerCase()
      return (emojis ?? [])
        .filter(e => e.name.toLowerCase().includes(q))
        .slice(0, 8)
        .map(e => ({key: e.name, label: `:${e.name}:`, insert: `:${e.name}:`}))
    }
    return remote.key === tkey ? remote.items : []
  }, [trigger, emojis, remote, tkey])

  return {trigger, suggestions}
}

// Suggestion dropdown geometry (module scope): one stylesheet shared by
// every keystroke's list. Theme colors join inline below.
const suggestionLayout = StyleSheet.create({
  boxBase: {
    borderWidth: 1,
    borderRadius: radius.md,
    padding: space.xs,
  },
  row: {paddingHorizontal: space.sm, paddingVertical: space.sm},
})

export function SuggestionList({
  suggestions,
  onPick,
}: {
  suggestions: Suggestion[]
  onPick: (s: Suggestion) => void
}) {
  const theme = useTheme()
  const i18n = useI18n()
  // Theme colors join the hoisted layout here (memoized on the theme, so
  // typing never rebuilds the stylesheet identity mid-list). Hooks stay
  // above the empty-list early return (rules-of-hooks).
  const styles = useMemo(
    () => ({
      box: [
        suggestionLayout.boxBase,
        {borderColor: theme.palette.edge, backgroundColor: theme.palette.bgSoft},
      ],
      row: suggestionLayout.row,
    }),
    [theme],
  )
  if (suggestions.length === 0) return null
  return (
    <View style={styles.box} testID="composer-suggestions">
      {suggestions.map(s => (
        <Pressable
          key={s.key}
          style={styles.row}
          accessibilityRole="button"
          accessibilityLabel={i18n._(msg`Insert ${s.label}`)}
          onPress={() => onPick(s)}>
          <Caption>{s.label}</Caption>
        </Pressable>
      ))}
    </View>
  )
}
