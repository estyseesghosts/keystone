// Page editor block chrome + list (P6.5 Pages, slice 4): card chrome
// (type icon + label, collapse chevron, move/delete menu per PG-6) and
// the recursive block list with an Add button opening AddBlockMenu.
// Move availability is computed from sibling position (up/down/into)
// and nesting (out only below top level).

import {useState, type ReactNode} from 'react'
import {View} from 'react-native'
import {msg} from '@lingui/macro'

import type {Backend, Media, PageBlock} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {ChevronIcon, MediaIcon, MessageIcon, MoreIcon, PencilIcon} from '#/components/icons'
import {Menu, type MenuItem} from '#/components/Menu'
import {Pressable} from '#/components/Pressable'
import {i18n} from '#/locale/i18n'

import type {PageBlockKind, PageEditorAction} from '#/state/pageEditor'
export type {PageBlockKind}

/** Shared editor context threaded through the recursive list. */
export interface BlockEditorContext {
  dispatch: (action: PageEditorAction) => void
  backend: Backend | null
  sessionId: string | null
  /** Media picked this session, by file id (editor thumbnails). */
  mediaById: Map<string, Media>
  onPickMedia: (blockId: string, file: Media) => void
  onOpenDrivePicker: (blockId: string) => void
  testID?: string
}

export function blockKindLabel(kind: PageBlockKind): string {
  switch (kind) {
    case 'text':
      return i18n._(msg`Text`)
    case 'section':
      return i18n._(msg`Section`)
    case 'image':
      return i18n._(msg`Image`)
    case 'note':
      return i18n._(msg`Embedded note`)
    case 'unknown':
      return i18n._(msg`Legacy block`)
  }
}

export function BlockKindIcon({kind}: {kind: PageBlockKind}) {
  const props = {size: 16}
  switch (kind) {
    case 'text':
      return <PencilIcon {...props} />
    case 'section':
      return <ChevronIcon {...props} direction="down" />
    case 'image':
      return <MediaIcon {...props} />
    case 'note':
      return <MessageIcon {...props} />
    case 'unknown':
      return <MoreIcon {...props} />
  }
}

export interface BlockMoveState {
  canUp: boolean
  canDown: boolean
  canInto: boolean
  canOut: boolean
}

export function BlockChrome({
  kind,
  collapsed,
  onToggleCollapse,
  collapsible,
  move,
  onMove,
  onDelete,
  warning,
  children,
  testID,
}: {
  kind: PageBlockKind
  collapsed: boolean
  onToggleCollapse: () => void
  collapsible: boolean
  move: BlockMoveState
  onMove: (op: 'up' | 'down' | 'into' | 'out') => void
  onDelete: () => void
  /** Inline warning under the header (e.g. untitled section). */
  warning?: string
  children: ReactNode
  testID?: string
}) {
  const items: MenuItem[] = [
    {key: 'up', label: i18n._(msg`Move up`), onSelect: () => onMove('up'), disabled: !move.canUp, reason: move.canUp ? undefined : i18n._(msg`Already at the top`)},
    {key: 'down', label: i18n._(msg`Move down`), onSelect: () => onMove('down'), disabled: !move.canDown, reason: move.canDown ? undefined : i18n._(msg`Already at the bottom`)},
    {key: 'into', label: i18n._(msg`Move into section above`), onSelect: () => onMove('into'), disabled: !move.canInto, reason: move.canInto ? undefined : i18n._(msg`No section above`)},
    {key: 'out', label: i18n._(msg`Move out of section`), onSelect: () => onMove('out'), disabled: !move.canOut, reason: move.canOut ? undefined : i18n._(msg`Already at the top level`)},
    {key: 'delete', label: i18n._(msg`Delete`), onSelect: onDelete},
  ]
  return (
    <View style={[atoms.gap_sm]} testID={testID}>
      <View style={[atoms.row, atoms.gap_sm]}>
        <BlockKindIcon kind={kind} />
        <Body>{blockKindLabel(kind)}</Body>
        <View style={atoms.flex1} />
        {collapsible ? (
          <Pressable
            onPress={onToggleCollapse}
            accessibilityRole="button"
            accessibilityLabel={collapsed ? i18n._(msg`Expand`) : i18n._(msg`Collapse`)}
            testID={testID ? `${testID}-collapse` : undefined}>
            <ChevronIcon size={16} direction={collapsed ? 'down' : 'up'} />
          </Pressable>
        ) : null}
        <Menu
          label={i18n._(msg`Block options`)}
          items={items}
          testID={testID ? `${testID}-menu` : undefined}
        />
      </View>
      {warning ? (
        <Caption color="faint" testID={testID ? `${testID}-warning` : undefined}>
          {warning}
        </Caption>
      ) : null}
      {collapsible && collapsed ? null : children}
    </View>
  )
}

const ADD_KINDS: PageBlockKind[] = ['text', 'section', 'image', 'note']

export function AddBlockMenu({
  onAdd,
  testID,
}: {
  onAdd: (kind: PageBlockKind) => void
  testID?: string
}) {
  return (
    <Menu
      label={i18n._(msg`Add block`)}
      items={ADD_KINDS.map(kind => ({
        key: kind,
        label: blockKindLabel(kind),
        onSelect: () => onAdd(kind),
      }))}
      testID={testID}
    />
  )
}
