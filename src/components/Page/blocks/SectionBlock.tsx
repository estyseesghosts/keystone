// Page section block (P6.5 Pages, slice 2): title as a heading plus the
// nested blocks. Heading level = depth + 2, capped at 4
// (Misskey `page.section.vue` parity: `h2` at top, `h+1` per level).

import type {ReactNode} from 'react'
import {View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {Heading} from '#/alf/typography'

/** Heading level for a section at nesting depth (top-level = 2, cap 4). Pure. */
export function sectionLevel(depth: number): number {
  return Math.min(Math.max(depth, 0) + 2, 4)
}

export function SectionBlock({
  title,
  depth,
  children,
  testID,
}: {
  title: string
  depth: number
  children: ReactNode
  testID?: string
}) {
  return (
    <View testID={testID} style={atoms.gap_sm}>
      {title.length > 0 ? (
        <Heading level={sectionLevel(depth)} testID={testID ? `${testID}-title` : undefined}>
          {title}
        </Heading>
      ) : null}
      {children}
    </View>
  )
}
