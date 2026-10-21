// WS-B (F10): tag-block pruning in the body pipeline + the header-bubble
// view model (v1 `NoteCard`/`NoteBody` parity).
import {adaptNote, textOf, type Post} from '@keystone/fedi'

import {makePost} from '#/components/__tests__/fixtures'
import {
  postBodyNodes,
  postTagBubble,
  pruneHtmlTagBlocks,
  pruneMfmTagBlocks,
} from '#/components/Post/body'

function mfmPost(mfm: string): Post {
  return makePost({content: {mfm, plain: mfm}})
}

function htmlPost(html: string): Post {
  return makePost({content: {html, plain: 'plain'}})
}

function tagLink(tag: string): string {
  return `<a class="mention hashtag" href="https://example.social/tags/${tag}">#${tag}</a>`
}

describe('postTagBubble (F10 view model)', () => {
  it('MFM: bubbles the pruned block tags', () => {
    expect(postTagBubble(mfmPost('hello #a #b'))).toEqual({
      tags: ['a', 'b'],
      hasBlocks: true,
    })
  })

  it('MFM: lone tags stay inline-only (no bubble)', () => {
    expect(postTagBubble(mfmPost('#solo stays'))).toEqual({tags: [], hasBlocks: false})
    expect(postTagBubble(mfmPost('no tags here'))).toEqual({tags: [], hasBlocks: false})
  })

  it('HTML: bubbles every tag when a block was pruned', () => {
    const bubble = postTagBubble(htmlPost(`<p>post ${tagLink('a')} ${tagLink('b')} done</p>`))
    expect(bubble).toEqual({tags: ['a', 'b'], hasBlocks: true})
  })

  it('HTML: lone tags stay inline-only (no bubble)', () => {
    expect(postTagBubble(htmlPost(`<p>post ${tagLink('solo')} done</p>`))).toEqual({
      tags: ['solo'],
      hasBlocks: false,
    })
  })

  it('plain-only posts have no bubble', () => {
    expect(postTagBubble(makePost({content: {plain: 'just text'}}))).toEqual({
      tags: [],
      hasBlocks: false,
    })
  })
})

describe('postBodyNodes tag-block pruning (F10)', () => {
  it('MFM: prunes a trailing block from the body', () => {
    expect(textOf(postBodyNodes(mfmPost('hello #a #b')))).toBe('hello')
  })

  it('MFM: keeps lone tags inline', () => {
    expect(textOf(postBodyNodes(mfmPost('#solo stays')))).toBe('#solo stays')
  })

  it('MFM: a tag-only post prunes to an empty body', () => {
    expect(postBodyNodes(mfmPost('#a #b'))).toEqual([])
  })

  it('MFM: quote-strip and tag-prune compose', () => {
    const wire = {
      id: 'q1',
      createdAt: '2026-01-01T00:00:00.000Z',
      userId: 'u1',
      user: {
        id: 'u1',
        name: null,
        username: 'a',
        host: null,
        avatarUrl: null,
        avatarBlurhash: null,
        isBot: false,
        isCat: false,
        emojis: {},
        onlineStatus: 'unknown',
      },
      text: 'look #a #b\nRE: https://remote.example/notes/1',
      cw: null,
      visibility: 'public',
      localOnly: false,
      reactionAcceptance: null,
      renoteCount: 0,
      repliesCount: 0,
      reactionCount: 0,
      reactions: {},
      reactionEmojis: {},
      fileIds: [],
      files: [],
      replyId: null,
      renoteId: 'r1',
      reply: null,
      renote: {
        id: 'r1',
        createdAt: '2026-01-01T00:00:00.000Z',
        userId: 'u1',
        user: {
          id: 'u1',
          name: null,
          username: 'a',
          host: null,
          avatarUrl: null,
          avatarBlurhash: null,
          isBot: false,
          isCat: false,
          emojis: {},
          onlineStatus: 'unknown',
        },
        text: 'original',
        cw: null,
        visibility: 'public',
        localOnly: false,
        reactionAcceptance: null,
        renoteCount: 0,
        repliesCount: 0,
        reactionCount: 0,
        reactions: {},
        reactionEmojis: {},
        fileIds: [],
        files: [],
        replyId: null,
        renoteId: null,
        reply: null,
        renote: null,
        poll: null,
        mentions: [],
        tags: [],
        emojis: {},
        myReaction: null,
        uri: 'https://remote.example/notes/1',
      },
      poll: null,
      mentions: [],
      tags: [],
      emojis: {},
      myReaction: null,
    } as never
    const post = adaptNote(wire)
    expect(textOf(postBodyNodes(post))).toBe('look')
    expect(postTagBubble(post)).toEqual({tags: ['a', 'b'], hasBlocks: true})
  })

  it('HTML: prunes a block from the body', () => {
    const nodes = postBodyNodes(htmlPost(`<p>post ${tagLink('a')} ${tagLink('b')} done</p>`))
    expect(textOf(nodes)).toBe('post  done')
  })

  it('HTML: keeps lone tags inline', () => {
    const nodes = postBodyNodes(htmlPost(`<p>post ${tagLink('solo')} done</p>`))
    expect(textOf(nodes)).toBe('post #solo done')
  })
})

describe('prune helpers (F10)', () => {
  it('pruneMfmTagBlocks prunes blocks, identity otherwise', () => {
    expect(pruneMfmTagBlocks('hello #a #b')).toBe('hello')
    expect(pruneMfmTagBlocks('#solo stays')).toBe('#solo stays')
  })

  it('pruneHtmlTagBlocks prunes blocks, keeps lone tags', () => {
    const nodes = pruneHtmlTagBlocks([
      {kind: 'text', text: 'post '},
      {kind: 'hashtag', tag: 'a', href: null, children: [{kind: 'text', text: '#a'}]},
      {kind: 'text', text: ' '},
      {kind: 'hashtag', tag: 'b', href: null, children: [{kind: 'text', text: '#b'}]},
    ])
    expect(textOf(nodes)).toBe('post ')
  })
})
