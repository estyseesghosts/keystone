// Page editor block editors (P6.5 Pages, slice 4): per-kind editing UI
// plus the chrome-wrapped recursive node renderer. Each block renders
// as a self-contained card (BlockChrome). The text card's formatting
// toolbar is an icon row above the input, shown only while that text
// field is focused (owner page-editor-cards 2026-10-31).

import {useCallback, useEffect, useRef, useState} from 'react'
import {Platform, StyleSheet, TextInput, View} from 'react-native'
import {msg} from '@lingui/macro'

import type {PageBlock, FormatControl} from '@keystone/fedi'
import {contentFromMfm} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {AppImage} from '#/components/Image'
import {Button} from '#/components/Button'
import {TextField} from '#/components/forms/TextField'
import {EditorSwitchRow} from '#/components/Profile/ProfileEditorRows'
import {PostCard} from '#/components/Post/index'
import {SuggestionList, useSuggestions} from '#/components/Composer/Autocomplete'
import {autogrowStyle, useAutogrowInput} from '#/components/Composer/useAutogrowInput'
import {useTheme} from '#/alf/index'
import {space, typeSize} from '#/alf/tokens'
import {i18n} from '#/locale/i18n'

import {useDriveFile, usePageNote} from '#/state/queries/pages'
import {usePageShowFormatting} from '#/state/pageFormatPref'
import {RichText} from '#/components/RichText'
import {Pressable} from '#/components/Pressable'
import {FormatToolbar, applyFormatControl} from './FormatToolbar'

import {AddBlockMenu, BlockChrome, type BlockEditorContext, type BlockMoveState} from './BlockList'

function moveFor(index: number, count: number, hasSectionAbove: boolean, nested: boolean): BlockMoveState {
  return {
    canUp: index > 0,
    canDown: index < count - 1,
    canInto: index > 0 && hasSectionAbove,
    canOut: nested,
  }
}

export function TextBlockEditor({
  block,
  ctx,
  testID,
}: {
  block: Extract<PageBlock, {kind: 'text'}>
  ctx: BlockEditorContext
  testID?: string
}) {
  const theme = useTheme()
  const [caret, setCaret] = useState(block.text.length)
  const [selection, setSelection] = useState<{start: number; end: number}>({start: block.text.length, end: block.text.length})
  const [focused, setFocused] = useState(false)
  const selectionRef = useRef(selection)
  selectionRef.current = selection
  const showFormatting = usePageShowFormatting()
  const grow = useAutogrowInput(72, 320, block.text)
  const {suggestions} = useSuggestions(block.text, caret, ctx.backend, undefined)
  const styles = StyleSheet.create({
    input: {
      // Chrome-free prose inside the block card (composer pattern); the
      // card's border is the container, so no inner border here.
      borderWidth: 0,
      backgroundColor: theme.palette.bg,
      color: theme.palette.text,
      fontSize: typeSize.body,
      paddingHorizontal: space.sm,
      paddingVertical: space.sm,
      textAlignVertical: 'top',
    },
  })
  const apply = useCallback((control: FormatControl, url?: string) => {
    const sel = selectionRef.current
    const out = applyFormatControl(block.text, sel, control, url)
    ctx.dispatch({type: 'updateBlock', id: block.id, patch: {text: out.text}})
    const at = Math.min(out.selection.end, out.text.length)
    setCaret(at)
    setSelection({start: out.selection.start, end: out.selection.end})
  }, [block.text, block.id, ctx])
  const applyRef = useRef(apply)
  applyRef.current = apply
  const textRef = useRef(block.text)
  textRef.current = block.text

  // Web shortcuts while the block is focused (Ctrl/Cmd+B/I/K, Shift+Mod+X).
  useEffect(() => {
    if (Platform.OS !== 'web' || !focused) return
    const node = grow.inputRef.current as unknown as {
      addEventListener?: (type: string, fn: (e: KeyboardEvent) => void) => void
      removeEventListener?: (type: string, fn: (e: KeyboardEvent) => void) => void
    } | null
    if (!node || typeof node.addEventListener !== 'function') return
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      const key = e.key.toLowerCase()
      const map: Record<string, FormatControl> = {b: 'bold', i: 'italic', k: 'link'}
      if (e.shiftKey && (key === 'x' || key === 'X'.toLowerCase())) {
        e.preventDefault()
        applyRef.current('strike')
        return
      }
      if (!e.shiftKey && map[key]) {
        e.preventDefault()
        applyRef.current(map[key]!)
      }
    }
    node.addEventListener('keydown', onKey)
    return () => node.removeEventListener?.('keydown', onKey)
  }, [focused, grow.inputRef])

  const pick = (insert: string, at: number) => {
    const next = `${block.text.slice(0, at)}${insert} ${block.text.slice(at)}`
    ctx.dispatch({type: 'updateBlock', id: block.id, patch: {text: next}})
    setCaret(at + insert.length + 1)
  }
  // Render-on-blur (ADR 0016 option B): an unfocused text block shows
  // the RichText rendering in the input's box when the toggle is on;
  // tapping it focuses the raw input at the tapped end.
  if (showFormatting && !focused && block.text !== '') {
    return (
      <Pressable
        onPress={() => {
          // State is the source of truth (the ref may be null on first
          // mount); the imperative focus is a native nicety.
          setFocused(true)
          grow.inputRef.current?.focus()
        }}
        accessibilityRole="button"
        accessibilityLabel={i18n._(msg`Edit text block`)}
        testID={testID ? `${testID}-rendered` : undefined}
        style={[styles.input, autogrowStyle(grow.height), {minHeight: 72}]}>
        <RichText nodes={contentFromMfm(block.text)} sessionId={ctx.sessionId} />
      </Pressable>
    )
  }
  return (
    <View style={[atoms.gap_sm]}>
      {focused ? (
        <View>
          <FormatToolbar
            text={block.text}
            selection={selection}
            onApply={(control, url) => apply(control, url)}
            testID={testID ? `${testID}-toolbar` : undefined}
          />
          <View style={{height: 1, backgroundColor: theme.palette.border}} />
        </View>
      ) : null}
      <TextInput
        ref={grow.inputRef}
        value={block.text}
        onChangeText={text => {
          grow.remeasure()
          ctx.dispatch({type: 'updateBlock', id: block.id, patch: {text}})
        }}
        onSelectionChange={e => {
          setCaret(e.nativeEvent.selection.end)
          setSelection({start: e.nativeEvent.selection.start, end: e.nativeEvent.selection.end})
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onContentSizeChange={grow.onContentSizeChange}
        selection={selection}
        multiline
        placeholder={i18n._(msg`Write something…`)}
        style={[styles.input, autogrowStyle(grow.height)]}
        testID={testID}
      />
      {suggestions.length > 0 ? (
        <SuggestionList
          suggestions={suggestions}
          onPick={s => {
            const at = Math.min(caret, block.text.length)
            pick(s.insert, at)
          }}
        />
      ) : null}
    </View>
  )
}

function SectionBlockEditor({
  block,
  ctx,
  sessionOrigin,
  testID,
}: {
  block: Extract<PageBlock, {kind: 'section'}>
  ctx: BlockEditorContext
  sessionOrigin: string | null
  testID?: string
}) {
  return (
    <View style={[atoms.gap_sm]}>
      <TextField
        label={i18n._(msg`Section title`)}
        value={block.title}
        onChangeText={title => ctx.dispatch({type: 'updateBlock', id: block.id, patch: {title}})}
        placeholder={i18n._(msg`Section title`)}
        testID={testID ? `${testID}-title` : undefined}
      />
      <BlockNodes blocks={block.children} parentId={block.id} ctx={ctx} sessionOrigin={sessionOrigin} testID={testID} />
    </View>
  )
}

function ImageBlockEditor({
  block,
  ctx,
  testID,
}: {
  block: Extract<PageBlock, {kind: 'image'}>
  ctx: BlockEditorContext
  testID?: string
}) {
  const picked = block.fileId ? ctx.mediaById.get(block.fileId) ?? null : null
  const remote = useDriveFile(ctx.sessionId, !picked && block.fileId ? block.fileId : null, ctx.backend ? {backend: ctx.backend} : {})
  const media = picked ?? remote.data ?? null
  if (!block.fileId || !media?.url) {
    return (
      <View style={[atoms.centered, atoms.gap_sm, atoms.p_md]}>
        <Body>{i18n._(msg`No image selected`)}</Body>
        <Button
          label={i18n._(msg`Choose`)}
          variant="secondary"
          disabled={!ctx.backend?.drive}
          onPress={() => ctx.onOpenDrivePicker(block.id)}
          testID={testID ? `${testID}-choose` : undefined}
        />
        {!ctx.backend?.drive ? (
          <Caption color="faint">{i18n._(msg`Drive is not available on this server.`)}</Caption>
        ) : null}
      </View>
    )
  }
  return (
    <View style={[atoms.gap_sm]}>
      <AppImage
        uri={media.url}
        blurhash={media.blurhash}
        contentFit="contain"
        testID={testID ? `${testID}-thumb` : undefined}
        style={{width: '100%', minHeight: 160}}
      />
      <Button
        label={i18n._(msg`Change`)}
        variant="secondary"
        disabled={!ctx.backend?.drive}
        onPress={() => ctx.onOpenDrivePicker(block.id)}
        testID={testID ? `${testID}-change` : undefined}
      />
    </View>
  )
}

/** Parse a note input: bare id or `{origin}/notes/{id}` (same origin only). */
export function parseNoteInput(
  raw: string,
  sessionOrigin: string | null,
): {noteId: string} | {error: string} {
  const text = raw.trim().replace(/\/$/, '')
  if (/^[a-z0-9]+$/i.test(text)) return {noteId: text}
  const m = text.match(/^(https?:\/\/[^/]+)\/notes\/([a-zA-Z0-9]+)$/)
  if (!m) return {error: 'note-input-invalid'}
  if (sessionOrigin && m[1] !== sessionOrigin) return {error: 'note-input-foreign'}
  return {noteId: m[2]!}
}

function NoteBlockEditor({
  block,
  ctx,
  sessionOrigin,
  testID,
}: {
  block: Extract<PageBlock, {kind: 'note'}>
  ctx: BlockEditorContext
  sessionOrigin: string | null
  testID?: string
}) {
  const [raw, setRaw] = useState(block.noteId ?? '')
  const parsed = raw.trim() === '' ? null : parseNoteInput(raw, sessionOrigin)
  const noteId = parsed && 'noteId' in parsed ? parsed.noteId : null
  const preview = usePageNote(ctx.sessionId, block.noteId, ctx.backend ? {backend: ctx.backend} : {})
  const error =
    !parsed || 'noteId' in parsed
      ? null
      : parsed.error === 'note-input-foreign'
        ? i18n._(msg`Paste a link from ${sessionOrigin ?? ''}`)
        : i18n._(msg`Enter a note ID or a note link.`)
  return (
    <View style={[atoms.gap_sm]}>
      <TextField
        label={i18n._(msg`Note ID or link`)}
        value={raw}
        onChangeText={setRaw}
        placeholder={i18n._(msg`note id or https://…/notes/…`)}
        error={error ?? undefined}
        testID={testID ? `${testID}-input` : undefined}
      />
      {noteId && noteId !== block.noteId ? (
        <Button
          label={i18n._(msg`Attach`)}
          variant="secondary"
          onPress={() => ctx.dispatch({type: 'updateBlock', id: block.id, patch: {noteId}})}
          testID={testID ? `${testID}-attach` : undefined}
        />
      ) : null}
      {block.noteId ? (
        preview.isPending ? (
          <Caption color="faint">{i18n._(msg`Loading note…`)}</Caption>
        ) : preview.data && ctx.sessionId ? (
          <View>
            <PostCard post={preview.data} sessionId={ctx.sessionId} foldBody={!block.detailed} />
            <EditorSwitchRow
              label={i18n._(msg`Detailed view`)}
              value={block.detailed}
              onValueChange={detailed => ctx.dispatch({type: 'updateBlock', id: block.id, patch: {detailed}})}
              testID={testID ? `${testID}-detailed` : undefined}
            />
          </View>
        ) : (
          <Caption color="faint">{i18n._(msg`Note unavailable`)}</Caption>
        )
      ) : null}
    </View>
  )
}

function UnknownBlockEditor({
  block,
  testID,
}: {
  block: Extract<PageBlock, {kind: 'unknown'}>
  testID?: string
}) {
  return (
    <View style={[atoms.gap_sm, atoms.py_sm]} testID={testID}>
      <Body>{i18n._(msg`Legacy block (${block.type}) — kept as is`)}</Body>
    </View>
  )
}

function BlockNode({
  block,
  index,
  siblings,
  parentId,
  ctx,
  sessionOrigin,
  testID,
}: {
  block: PageBlock
  index: number
  siblings: PageBlock[]
  parentId: string | null
  ctx: BlockEditorContext
  sessionOrigin: string | null
  testID?: string
}) {
  const [collapsed, setCollapsed] = useState(false)
  const nodeId = testID ? `${testID}-block-${block.id}` : undefined
  const move = moveFor(index, siblings.length, siblings[index - 1]?.kind === 'section', parentId !== null)
  const onMove = (op: 'up' | 'down' | 'into' | 'out') => {
    if (op === 'up' || op === 'down') ctx.dispatch({type: 'moveBlock', id: block.id, dir: op})
    else if (op === 'into') ctx.dispatch({type: 'moveIntoSection', id: block.id})
    else ctx.dispatch({type: 'moveOutOfSection', id: block.id})
  }
  const warning =
    block.kind === 'section' && block.title.trim() === '' ? i18n._(msg`Untitled section`) : undefined
  return (
    <BlockChrome
      kind={block.kind}
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed(v => !v)}
      collapsible={block.kind === 'section'}
      move={move}
      onMove={onMove}
      onDelete={() => ctx.dispatch({type: 'removeBlock', id: block.id})}
      warning={warning}
      testID={nodeId}>
      {block.kind === 'text' ? (
        <TextBlockEditor block={block} ctx={ctx} testID={nodeId ? `${nodeId}-text` : undefined} />
      ) : block.kind === 'section' ? (
        <SectionBlockEditor block={block} ctx={ctx} sessionOrigin={sessionOrigin} testID={nodeId} />
      ) : block.kind === 'image' ? (
        <ImageBlockEditor block={block} ctx={ctx} testID={nodeId} />
      ) : block.kind === 'note' ? (
        <NoteBlockEditor block={block} ctx={ctx} sessionOrigin={sessionOrigin} testID={nodeId} />
      ) : (
        <UnknownBlockEditor block={block} testID={nodeId} />
      )}
    </BlockChrome>
  )
}

export function BlockNodes({
  blocks,
  parentId,
  ctx,
  sessionOrigin,
  testID,
}: {
  blocks: PageBlock[]
  parentId: string | null
  ctx: BlockEditorContext
  sessionOrigin: string | null
  testID?: string
}) {
  return (
    <View style={[atoms.gap_sm]} testID={testID ? `${testID}-list` : undefined}>
      {blocks.map((block, index) => (
        <BlockNode
          key={block.id}
          block={block}
          index={index}
          siblings={blocks}
          parentId={parentId}
          ctx={ctx}
          sessionOrigin={sessionOrigin}
          testID={testID}
        />
      ))}
      <AddBlockMenu
        onAdd={kind => ctx.dispatch({type: 'addBlock', kind, parentId})}
        testID={testID ? `${testID}-add` : undefined}
      />
    </View>
  )
}
