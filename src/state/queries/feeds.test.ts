import {parseFeedDescriptor} from '@keystone/fedi'

import {
  countNewItems,
  defaultNetworkTab,
  descriptorForNetworkTab,
  profileTabDescriptor,
  supportsSocialTimeline,
  visibleNetworkTabs,
} from './feeds'
import {feedQueryKey} from './keys'

describe('feed-visibility rule (ported rule, own code)', () => {
  it('hides Local while Social exists on the Misskey family', () => {
    expect(supportsSocialTimeline('misskey')).toBe(true)
    expect(visibleNetworkTabs('misskey')).toEqual(['social', 'federated'])
  })

  it('keeps Local on the Mastodon family (no Social timeline there)', () => {
    expect(supportsSocialTimeline('mastodon')).toBe(false)
    expect(visibleNetworkTabs('mastodon')).toEqual(['local', 'federated'])
  })

  it('falls back to Local + Federated when the family is unknown', () => {
    expect(visibleNetworkTabs(null)).toEqual(['local', 'federated'])
    expect(visibleNetworkTabs(undefined)).toEqual(['local', 'federated'])
  })

  it('shows Local while Social exists when the reader turns it on', () => {
    expect(visibleNetworkTabs('misskey', {showLocal: true, showFederated: true})).toEqual([
      'social',
      'local',
      'federated',
    ])
  })

  it('hides Federated when the reader turns it off', () => {
    expect(visibleNetworkTabs('misskey', {showLocal: false, showFederated: false})).toEqual([
      'social',
    ])
    expect(visibleNetworkTabs('mastodon', {showLocal: false, showFederated: false})).toEqual([
      'local',
    ])
  })

  it('never defaults to Federated', () => {
    for (const family of ['misskey', 'mastodon', null, undefined] as const) {
      expect(defaultNetworkTab(family)).not.toBe('federated')
    }
    expect(defaultNetworkTab('misskey')).toBe('social')
    expect(defaultNetworkTab('mastodon')).toBe('local')
  })

  it('maps tabs to timeline descriptors (federated reuses the global source)', () => {
    expect(descriptorForNetworkTab('social')).toBe('timeline|social')
    expect(descriptorForNetworkTab('local')).toBe('timeline|local')
    expect(descriptorForNetworkTab('federated')).toBe('timeline|global')
  })

  it('aliases the pre-W1 global tab param to federated', async () => {
    const {networkTabFromParam} = await import('#/routes')
    expect(networkTabFromParam('global')).toBe('federated')
    expect(networkTabFromParam('federated')).toBe('federated')
    expect(networkTabFromParam('social')).toBe('social')
    expect(networkTabFromParam('local')).toBe('local')
    expect(networkTabFromParam('bogus')).toBeUndefined()
    expect(networkTabFromParam(undefined)).toBeUndefined()
  })
})

describe('feed descriptors', () => {
  it('round-trips timeline, user-tab, and tag descriptors', () => {
    expect(parseFeedDescriptor('timeline|home')).toEqual({kind: 'timeline', timeline: 'home'})
    expect(parseFeedDescriptor(profileTabDescriptor('abc', 'replies'))).toEqual({
      kind: 'user',
      id: 'abc',
      tab: 'replies',
    })
    expect(parseFeedDescriptor(profileTabDescriptor('abc', 'all'))).toEqual({
      kind: 'user',
      id: 'abc',
      tab: 'all',
    })
    expect(parseFeedDescriptor('tag|Solarpunk')).toEqual({kind: 'tag', tag: 'Solarpunk'})
    expect(() => parseFeedDescriptor('bogus')).toThrow()
  })

  it('keys every query by session id first (account switches never leak rows)', () => {
    const a = feedQueryKey('https://a.example alice', 'timeline|home')
    const b = feedQueryKey('https://b.example bob', 'timeline|home')
    expect(a).toEqual(['https://a.example alice', 'post-feed', 'timeline|home'])
    expect(a).not.toEqual(b)
    expect(() => feedQueryKey('', 'timeline|home')).toThrow()
  })
})

describe('countNewItems', () => {
  const items = [{id: '3'}, {id: '2'}, {id: '1'}]
  it('reports 0 on first load (the list is the baseline)', () => {
    expect(countNewItems(items, null)).toBe(0)
  })
  it('counts rows above the last-seen first id', () => {
    expect(countNewItems(items, '3')).toBe(0)
    expect(countNewItems([{id: '5'}, {id: '4'}, ...items], '3')).toBe(2)
  })
  it('treats an evicted baseline as all-unseen', () => {
    expect(countNewItems(items, 'gone')).toBe(3)
  })
})

