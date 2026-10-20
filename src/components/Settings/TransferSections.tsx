import {View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {useActiveBackend} from '#/screens/HomeFeed'
import {useActiveSession} from '#/state/session/SessionProvider'

import {PlaceholderRow, SectionHint} from './rows'

// Import / export sections (v1 `/settings/import` + `/settings/export`
// parity): Misskey-compatible following/blocking/mute/notes files first,
// then lists/antennas/clips/favorites. This build has no file-picker or
// file-sharing primitives (no document picker, no file system), so every
// row renders as an honest placeholder — the tree stays complete and
// nothing pretends to move data.

const IMPORT_ROWS = [
  {id: 'following', title: 'Import following', hint: 'A Misskey following export.'},
  {id: 'blocking', title: 'Import blocks', hint: 'A Misskey blocking export.'},
  {id: 'mute', title: 'Import mutes', hint: 'A Misskey mute export.'},
  {id: 'notes', title: 'Import notes', hint: 'A Misskey notes export.'},
]

const EXPORT_ROWS = [
  {id: 'following', title: 'Export following', hint: 'Download who you follow.'},
  {id: 'blocking', title: 'Export blocks', hint: 'Download who you block.'},
  {id: 'mute', title: 'Export mutes', hint: 'Download who you mute.'},
  {id: 'notes', title: 'Export notes', hint: 'Download your posts.'},
  {id: 'user-lists', title: 'Export lists', hint: 'Download your lists.'},
  {id: 'antennas', title: 'Export antennas', hint: 'Download your antennas.'},
  {id: 'clips', title: 'Export clips', hint: 'Download your clips.'},
  {id: 'favorites', title: 'Export favorites', hint: 'Download your favorites.'},
]

const REASON = 'Needs file import — not available in this build.'

export function ImportSection() {
  const session = useActiveSession()
  const {backend} = useActiveBackend()
  return (
    <View style={[atoms.gap_sm]} testID="settings-section-import">
      {!session || !backend ? <SectionHint>Sign in to move data in.</SectionHint> : null}
      {backend && backend.family !== 'misskey' ? (
        <PlaceholderRow
          title="Import"
          hint="Misskey-compatible files."
          reason="Needs a Misskey-family server."
          testID="placeholder-import-family"
        />
      ) : (
        IMPORT_ROWS.map(row => (
          <PlaceholderRow
            key={row.id}
            title={row.title}
            hint={row.hint}
            reason={REASON}
            testID={`placeholder-import-${row.id}`}
          />
        ))
      )}
    </View>
  )
}

export function ExportSection() {
  const session = useActiveSession()
  const {backend} = useActiveBackend()
  return (
    <View style={[atoms.gap_sm]} testID="settings-section-export">
      {!session || !backend ? <SectionHint>Sign in to move data out.</SectionHint> : null}
      {EXPORT_ROWS.map(row => (
        <PlaceholderRow
          key={row.id}
          title={row.title}
          hint={row.hint}
          reason="Needs file sharing — not available in this build."
          testID={`placeholder-export-${row.id}`}
        />
      ))}
    </View>
  )
}
