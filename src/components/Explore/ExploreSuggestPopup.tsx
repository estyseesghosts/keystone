import {View} from 'react-native'

import type {Account} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Pressable} from '#/components/Pressable'

// The `#`/`@` autocomplete popup under the Explore search field. Renders
// exactly one list: tag names when the backend offers `suggestTags`,
// accounts when it offers `suggestAccounts` — never an inert popup, so a
// null list renders nothing at all.
export function ExploreSuggestPopup({
  tags,
  accounts,
  activeIndex,
  onPick,
}: {
  tags: string[] | null
  accounts: Account[] | null
  activeIndex: number
  onPick: (index: number) => void
}) {
  if (!tags && !accounts) return null
  const tagCount = tags?.length ?? 0
  return (
    <View style={[atoms.px_md, atoms.py_sm]} testID="explore-suggest">
      {(tags ?? []).map((name, i) => (
        <SuggestOption
          key={`tag-${name}`}
          index={i}
          active={i === activeIndex}
          label={`#${name}`}
          onPick={onPick}
        />
      ))}
      {(accounts ?? []).map((account, i) => (
        <SuggestOption
          key={`account-${account.id}`}
          index={tagCount + i}
          active={tagCount + i === activeIndex}
          label={`@${account.acct || account.username}`}
          sub={account.name || undefined}
          onPick={onPick}
        />
      ))}
    </View>
  )
}

function SuggestOption({
  index,
  active,
  label,
  sub,
  onPick,
}: {
  index: number
  active: boolean
  label: string
  sub?: string
  onPick: (index: number) => void
}) {
  return (
    <Pressable
      onPress={() => onPick(index)}
      accessibilityRole="button"
      accessibilityState={{selected: active}}
      accessibilityLabel={label}
      testID={`explore-suggest-${index}`}>
      <View style={[atoms.py_sm, atoms.px_md]}>
        <Body>{label}</Body>
        {sub ? <Caption color="faint">{sub}</Caption> : null}
      </View>
    </Pressable>
  )
}
