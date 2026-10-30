// Shared page renderer (P6.5 Pages, slice 2): the reader and the editor
// preview mount the exact same component (PG-7) — only the image
// resolver and the action bar differ. Unknown blocks render the honest
// placeholder; legacy scripts never execute (PG-5).

import {StyleSheet, View} from 'react-native'
import {msg} from '@lingui/macro'

import type {Media, PageBlock as DomainBlock, PageModel} from '@keystone/fedi'

import {useTheme} from '#/alf/index'
import {atoms} from '#/alf/atoms'
import {Body, Caption, Heading} from '#/alf/typography'
import {AppImage} from '#/components/Image'
import {useLocale} from '#/locale/i18n'
import {formatDateTime} from '#/locale/format'
import {i18n} from '#/locale/i18n'
import {navigationRef} from '#/navigationRef'

import {ImageBlock, NoteBlock, UnknownBlock} from './blocks/MediaBlocks'
import {SectionBlock, sectionLevel} from './blocks/SectionBlock'
import {TextBlock} from './blocks/TextBlock'

const styles = StyleSheet.create({
  eyeCatch: {width: '100%', aspectRatio: 2, borderRadius: 8, overflow: 'hidden'},
  header: {gap: 8},
  authorRow: {flexDirection: 'row', alignItems: 'center', gap: 8},
  avatar: {width: 36, height: 36, borderRadius: 18},
  body: {gap: 12},
})

export type PageViewMode = 'read' | 'pinned'

/** Resolve an image-block `fileId` to media (reader: attachedFiles
 * lookup; preview: drive-file query). Null = the box, never blank. */
export type PageImageResolver = (fileId: string) => Media | null

/** Header title: `title || name`, unless the pinned card hides it. Pure. */
export function pageViewTitle(page: Pick<PageModel, 'title' | 'name' | 'hideTitleWhenPinned'>, mode: PageViewMode): string | null {
  if (mode === 'pinned' && page.hideTitleWhenPinned) return null
  return page.title || page.name
}

function BlockView({
  block,
  depth,
  sessionId,
  imageResolver,
  testID,
}: {
  block: DomainBlock
  depth: number
  sessionId: string | null
  imageResolver: PageImageResolver
  testID?: string
}) {
  const id = `${testID ?? 'page-block'}-${block.id}`
  switch (block.kind) {
    case 'text':
      return <TextBlock text={block.text} sessionId={sessionId} testID={id} />
    case 'section':
      return (
        <SectionBlock title={block.title} depth={depth} testID={id}>
          {block.children.map(child => (
            <BlockView
              key={child.id}
              block={child}
              depth={depth + 1}
              sessionId={sessionId}
              imageResolver={imageResolver}
              testID={testID}
            />
          ))}
        </SectionBlock>
      )
    case 'image':
      return <ImageBlock fileId={block.fileId} image={block.fileId ? imageResolver(block.fileId) : null} testID={id} />
    case 'note':
      return <NoteBlock noteId={block.noteId} detailed={block.detailed} sessionId={sessionId} testID={id} />
    case 'unknown':
      return <UnknownBlock blockType={block.type} testID={id} />
  }
}

export function PageView({
  page,
  sessionId,
  mode = 'read',
  imageResolver,
  testID,
}: {
  page: PageModel
  /** Owning session (null = signed out: no like, embeds unavailable). */
  sessionId: string | null
  mode?: PageViewMode
  /** Defaults to the reader's attachedFiles lookup. */
  imageResolver?: PageImageResolver
  testID?: string
}) {
  const theme = useTheme()
  const locale = useLocale()
  const title = pageViewTitle(page, mode)
  const resolveImage: PageImageResolver =
    imageResolver ?? (fileId => page.attachedFiles.find(f => f.id === fileId) ?? null)
  const openAuthor = () => {
    navigationRef.navigate('Main', {screen: 'User', params: {id: page.author.id}} as never)
  }
  return (
    <View testID={testID} style={[atoms.gap_md]}>
      {page.eyeCatchingImage?.url ? (
        <View style={styles.eyeCatch}>
          <AppImage
            uri={page.eyeCatchingImage.url}
            blurhash={page.eyeCatchingImage.blurhash}
            contentFit="cover"
            alt={page.eyeCatchingImage.description ?? undefined}
            testID={testID ? `${testID}-eyecatch` : undefined}
            style={{width: '100%', height: '100%'}}
          />
        </View>
      ) : null}
      <View style={styles.header}>
        {title !== null ? (
          <Heading level={1} testID={testID ? `${testID}-title` : undefined}>
            {title}
          </Heading>
        ) : null}
        <View style={styles.authorRow}>
          <AppImage
            uri={page.author.avatarUrl}
            contentFit="cover"
            alt={page.author.displayName}
            testID={testID ? `${testID}-avatar` : undefined}
            style={styles.avatar}
          />
          <View style={{flex: 1}}>
            <Body
              testID={testID ? `${testID}-author` : undefined}
              onPress={openAuthor}
              accessibilityRole="link">
              {page.author.displayName}
            </Body>
            <Caption color="faint" testID={testID ? `${testID}-time` : undefined}>
              {formatDateTime(page.createdAt, locale)}
            </Caption>
          </View>
        </View>
      </View>
      {page.hasLegacyScript ? (
        <View
          testID={testID ? `${testID}-script-banner` : undefined}
          style={[atoms.py_sm, {backgroundColor: theme.palette.bgSoft, borderRadius: 8}]}>
          <Caption color="faint">
            {i18n._(msg`This page has a script. Keystone does not run scripts.`)}
          </Caption>
        </View>
      ) : null}
      <View style={styles.body} testID={testID ? `${testID}-blocks` : undefined}>
        {page.blocks.map(block => (
          <BlockView
            key={block.id}
            block={block}
            depth={0}
            sessionId={sessionId}
            imageResolver={resolveImage}
            testID={testID}
          />
        ))}
      </View>
    </View>
  )
}

/** Section heading levels for tests/docs (top = h2, cap h4). */
export {sectionLevel}
