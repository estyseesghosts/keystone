import {StyleSheet, TextInput, View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf/index'
import {radius, space, typeSize} from '#/alf/tokens'
import {Button} from '#/components/Button'

// The Explore search field: text input plus submit, with a clear button
// while a query is active. Submitting is the caller's job (`onSubmit`);
// this component never fetches.
export function ExploreSearchBar({
  value,
  onChangeText,
  onSubmit,
  onClear,
  busy,
  testID = 'explore-search',
}: {
  value: string
  onChangeText: (text: string) => void
  onSubmit: () => void
  onClear: () => void
  busy?: boolean
  testID?: string
}) {
  const theme = useTheme()
  const styles = StyleSheet.create({
    input: {
      flex: 1,
      borderWidth: 1,
      borderColor: theme.palette.edge,
      borderRadius: radius.md,
      backgroundColor: theme.palette.bg,
      color: theme.palette.text,
      fontSize: typeSize.body,
      paddingHorizontal: space.md,
      paddingVertical: space.sm,
    },
  })
  const active = value.trim().length > 0
  return (
    <View style={[atoms.row, atoms.gap_sm, atoms.px_md, atoms.py_sm]} testID={testID}>
      <TextInput
        testID="explore-search-input"
        value={value}
        onChangeText={onChangeText}
        placeholder="Search users, tags, and posts"
        placeholderTextColor={theme.palette.faint}
        accessibilityLabel="Search"
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        style={styles.input}
      />
      {active ? (
        <Button label="Clear" variant="secondary" onPress={onClear} testID="explore-search-clear" />
      ) : null}
      <Button
        label={busy ? 'Searching…' : 'Search'}
        variant="primary"
        disabled={busy || !active}
        onPress={onSubmit}
        testID="explore-search-submit"
      />
    </View>
  )
}
