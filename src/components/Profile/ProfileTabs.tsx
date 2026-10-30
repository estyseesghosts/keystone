// Underline tab bar for the profile (v1 pattern: Featured / Posts / All /
// Replies / Media as an underlined tablist, not pill buttons). All is
// v1's replies + renotes tab; Replies stays. The Featured tab only
// appears when the backend packed a source (pinnedPosts / pinnedPostIds)
// — it ships absent, never faked. Instant motion: no transitions; the
// active tab is a 2px underline.
import {useMemo} from 'react'

import {msg} from '@lingui/macro'

import {Tabs} from '#/components/Tabs'
import {i18n} from '#/locale/i18n'
import type {ProfileFeedTab} from '#/state/queries'

/** Profile content tabs: the post-feed tabs plus Pages (Misskey family). */
export type ProfileTab = ProfileFeedTab | 'pages'

// Profile tab labels, resolved at render time (a module constant would
// freeze the boot locale — the locale switches at runtime).
export function profileTabLabel(t: ProfileTab): string {
  switch (t) {
    case 'featured':
      return i18n._(msg`Featured`)
    case 'posts':
      return i18n._(msg`Posts`)
    case 'all':
      return i18n._(msg`All`)
    case 'replies':
      return i18n._(msg`Replies`)
    case 'media':
      return i18n._(msg`Media`)
    case 'pages':
      return i18n._(msg`Pages`)
  }
}

const ORDER: ProfileFeedTab[] = ['featured', 'posts', 'all', 'replies', 'media']

export function ProfileTabs({
  tab,
  onChange,
  hasFeatured,
  showPages,
}: {
  tab: ProfileTab
  onChange: (tab: ProfileTab) => void
  hasFeatured: boolean
  /** Show the Pages tab (Misskey family with the `pages` module). Defaults to hidden. */
  showPages?: boolean
}) {
  const visible: ProfileTab[] = useMemo(() => {
    const feed = ORDER.filter(t => t !== 'featured' || hasFeatured || tab === 'featured')
    return showPages || tab === 'pages' ? [...feed, 'pages'] : feed
  }, [hasFeatured, showPages, tab])
  return (
    <Tabs
      tabs={visible.map(t => ({key: t, label: profileTabLabel(t)}))}
      active={tab}
      onChange={onChange}
      testID="profile-tabs"
      testIDPrefix="profile-tab"
      accessibilityLabel={i18n._(msg`Profile posts`)}
    />
  )
}
