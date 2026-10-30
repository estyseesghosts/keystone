// Page text block (P6.5 Pages, slice 2): MFM source rendered through
// the shared pipeline, plus URL previews honoring the link-preview
// preference (Misskey `page.text.vue` + `MkUrlPreview` parity).

import {View} from 'react-native'

import type {ContentNode} from '@keystone/fedi'
import {contentFromMfm} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {RichText} from '#/components/RichText'
import {UnfurledLinkCard} from '#/components/Post/LinkCard'
import {useLinkPreviewMode, shouldAutoUnfurl} from '#/state/privacyShield'

/** All link hrefs in a content tree, document order, deduped. Pure. */
export function collectLinkHrefs(nodes: readonly ContentNode[]): string[] {
  const out: string[] = []
  const walk = (list: readonly ContentNode[]): void => {
    for (const node of list) {
      if (node.kind === 'link') {
        if (typeof node.href === 'string' && node.href.length > 0 && !out.includes(node.href)) {
          out.push(node.href)
        }
        walk(node.children)
      } else if (node.kind === 'quote') {
        walk(node.children)
      } else if (node.kind === 'fn' || node.kind === 'mention' || node.kind === 'hashtag') {
        walk(node.children)
      }
    }
  }
  walk(nodes)
  return out
}

export function TextBlock({
  text,
  sessionId,
  testID,
}: {
  text: string
  sessionId: string | null
  testID?: string
}) {
  const mode = useLinkPreviewMode()
  const nodes = contentFromMfm(text)
  // Misskey renders at most one preview row per text block in practice;
  // cap at two so a link-heavy block cannot flood the page.
  const hrefs = collectLinkHrefs(nodes).slice(0, 2)
  return (
    <View testID={testID}>
      <RichText nodes={nodes} sessionId={sessionId} />
      {hrefs.length > 0 ? (
        <View style={atoms.gap_sm}>
          {hrefs.map(href => (
            <UnfurledLinkCard
              key={href}
              url={href}
              auto={shouldAutoUnfurl(mode, 'public')}
              testID={testID ? `${testID}-unfurl` : undefined}
            />
          ))}
        </View>
      ) : null}
    </View>
  )
}
