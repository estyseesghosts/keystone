// F7: duplicate `RE:` markers strip when a structured quote card renders.
import {adaptNote, type Post} from '@keystone/fedi'

import {postBodyNodes} from './body'

type WireNote = Parameters<typeof adaptNote>[0]
type WireUser = WireNote['user']

function user(id: string): WireUser {
  return {
    id,
    name: null,
    username: 'a',
    host: null,
    avatarUrl: null,
    avatarBlurhash: null,
    isBot: false,
    isCat: false,
    emojis: {},
    onlineStatus: 'unknown',
  }
}

function wire(over: Partial<WireNote> & {id: string}): WireNote {
  return {
    createdAt: '2026-01-01T00:00:00.000Z',
    userId: 'u1',
    user: user('u1'),
    text: null,
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
    ...over,
  }
}

function textOf(nodes: ReturnType<typeof postBodyNodes>): string {
  return nodes
    .map(n => (n.kind === 'text' ? n.text : n.kind === 'link' ? `[${textOf(n.children)}]` : ''))
    .join('')
}

describe('postBodyNodes quote-marker stripping (F7)', () => {
  it('strips a suffix RE: marker duplicating the Misskey quote card', () => {
    const post = adaptNote(
      wire({
        id: 'q1',
        text: 'look at this\nRE: https://remote.example/notes/1',
        renoteId: 'r1',
        renote: wire({id: 'r1', text: 'original', uri: 'https://remote.example/notes/1'}),
      }),
    )
    expect(post.quote?.id).toBe('r1')
    expect(textOf(postBodyNodes(post))).toBe('look at this')
  })

  it('keeps a lone RE: marker with no structured target (never hidden text)', () => {
    const post = adaptNote(
      wire({id: 't1', text: 'look at this\nRE: https://remote.example/notes/9'}),
    )
    expect(post.quote).toBeNull()
    expect(textOf(postBodyNodes(post))).toContain('RE:')
  })

  it('keeps an RE: marker naming a different URL than the card', () => {
    const post = adaptNote(
      wire({
        id: 'q2',
        text: 'see https://other.example/notes/2',
        renoteId: 'r2',
        renote: wire({id: 'r2', text: 'original', uri: 'https://remote.example/notes/1'}),
      }),
    )
    expect(post.quote?.id).toBe('r2')
    expect(textOf(postBodyNodes(post))).toContain('https://other.example/notes/2')
  })

  it('strips a whole-body marker to an empty body (card carries the target)', () => {
    const post = adaptNote(
      wire({
        id: 'q3',
        text: 'RE: https://remote.example/notes/1',
        renoteId: 'r3',
        renote: wire({id: 'r3', text: 'original', uri: 'https://remote.example/notes/1'}),
      }),
    )
    expect(postBodyNodes(post)).toEqual([])
  })

  it('truncates the suffix marker, its link, and surrounding newlines', () => {
    const post = adaptNote(
      wire({
        id: 'q4',
        text: 'look at this\n\nRE: https://remote.example/notes/1\n\n',
        renoteId: 'r4',
        renote: wire({id: 'r4', text: 'original', uri: 'https://remote.example/notes/1'}),
      }),
    )
    expect(textOf(postBodyNodes(post))).toBe('look at this')
  })

  it('truncates a leading marker and the newlines after it', () => {
    const post = adaptNote(
      wire({
        id: 'q5',
        text: 'RE: https://remote.example/notes/1\n\nlook at this',
        renoteId: 'r5',
        renote: wire({id: 'r5', text: 'original', uri: 'https://remote.example/notes/1'}),
      }),
    )
    expect(textOf(postBodyNodes(post))).toBe('look at this')
  })

  it('truncates a leading marker behind blank lines', () => {
    const post = adaptNote(
      wire({
        id: 'q6',
        text: '\n\nRE: https://remote.example/notes/1\nbody here',
        renoteId: 'r6',
        renote: wire({id: 'r6', text: 'original', uri: 'https://remote.example/notes/1'}),
      }),
    )
    expect(textOf(postBodyNodes(post))).toBe('body here')
  })

  it('strips the Mastodon HTML marker duplicating the structured quote', () => {
    const quoted = adaptNote(wire({id: 'm1', text: 'quoted'}))
    const post: Post = {
      ...adaptNote(wire({id: 'm2'})),
      content: {
        html: '<p>commentary<br>RE: <a href="https://remote.example/notes/1">https://remote.example/notes/1</a></p>',
        plain: 'commentary RE: https://remote.example/notes/1',
      },
      quote: {...quoted, uri: 'https://remote.example/notes/1'},
    }
    expect(textOf(postBodyNodes(post))).not.toContain('RE:')
  })
})
