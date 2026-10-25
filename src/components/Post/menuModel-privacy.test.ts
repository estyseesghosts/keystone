// Repair X2.5: Share and Copy rows confirm first on non-public posts.
import {buildPostMenu, flatten} from '#/components/Post/menuModel'

import {makePost} from '../__tests__/fixtures'

function menuInput(visibility: 'public' | 'followers' | 'direct', post = makePost({visibility: {kind: visibility, localOnly: false, raw: visibility}})) {
  return {
    family: 'mastodon',
    capabilities: {},
    post,
    origin: 'https://example.social',
    isOwn: false,
    copyAvailable: true,
    bookmark: {gate: {enabled: false, reason: 'x'}, value: false, set: jest.fn()},
    del: {gate: {enabled: false, reason: 'x'}, run: jest.fn()},
    handlers: {
      copy: jest.fn(),
      share: jest.fn(),
      open: jest.fn(),
      translate: jest.fn(),
      muteThread: jest.fn(),
      togglePin: jest.fn(),
    },
  } as never
}

describe('share/copy confirm on non-public posts (repair X2.5)', () => {
  it.each(['followers', 'direct'] as const)(
    '%s posts: Share and Copy rows confirm before running',
    visibility => {
      const rows = flatten(buildPostMenu(menuInput(visibility)))
      for (const key of ['copy-contents', 'copy-link', 'share']) {
        const row = rows.find(i => i.key === key)!
        expect(row).toBeDefined()
        // The copy handlers exist in this fixture, so the rows run —
        // and only after the confirm.
        expect(row.run).toBeDefined()
        expect(row.confirm?.title).toMatch(/isn't public/)
        expect(row.confirm?.action).toBe(row.label)
      }
    },
  )

  it('public posts: Share and Copy rows run with no confirm', () => {
    const rows = flatten(buildPostMenu(menuInput('public')))
    for (const key of ['copy-contents', 'copy-link', 'share']) {
      const row = rows.find(i => i.key === key)!
      expect(row.run).toBeDefined()
      expect(row.confirm).toBeUndefined()
    }
  })

  it('disabled rows never gain a confirm (no inert confirms)', () => {
    const post = makePost({
      url: null,
      uri: null,
      visibility: {kind: 'direct', localOnly: false, raw: 'direct'},
    })
    const rows = flatten(buildPostMenu(menuInput('direct', post)))
    const share = rows.find(i => i.key === 'share')!
    expect(share.disabled).toBe(true)
    expect(share.confirm).toBeUndefined()
  })
})
