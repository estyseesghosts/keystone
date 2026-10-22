// F15/F16: card badges for pinned/edited/filtered/bookmarked posts
// and reaction-acceptance markers.
import {makePost} from '../__tests__/fixtures'
import {badgesFor} from './badges'

describe('badgesFor (F15/F16)', () => {
  it('returns no badges for a plain post', () => {
    expect(badgesFor(makePost())).toEqual([])
  })

  it('marks pinned, edited, and bookmarked posts', () => {
    const badges = badgesFor(
      makePost({pinned: true, editedAt: '2026-10-20T00:00:00.000Z', ext: {bookmarked: true}}),
    )
    expect(badges.map(b => b.key)).toEqual(['pinned', 'bookmarked', 'edited'])
  })

  it('names the first server filter and counts the rest', () => {
    const one = badgesFor(makePost({filtered: [{title: 'spoilers', action: 'hide'}]}))
    expect(one).toEqual([{key: 'filtered', label: 'Filtered: spoilers'}])
    const many = badgesFor(
      makePost({
        filtered: [
          {title: 'spoilers', action: 'hide'},
          {title: 'ads', action: 'hide'},
          {title: 'x', action: 'hide'},
        ],
      }),
    )
    expect(many).toEqual([{key: 'filtered', label: 'Filtered: spoilers +2'}])
  })

  it('labels reaction acceptance, never the default', () => {
    expect(badgesFor(makePost({ext: {reactionAcceptance: null}}))).toEqual([])
    const badges = badgesFor(makePost({ext: {reactionAcceptance: 'likeOnlyForRemote'}}))
    expect(badges).toEqual([{key: 'reactions', label: 'Like only (remote)'}])
  })

  it('passes unknown acceptance values through verbatim', () => {
    expect(badgesFor(makePost({ext: {reactionAcceptance: 'weird'}}))).toEqual([
      {key: 'reactions', label: 'weird'},
    ])
  })
})

// Soft-mute badge: the feeds drop soft-muted rows, so the badge exists
// for the surfaces that still render them (threads, profiles,
// notifications). Absent signal means no badge — never a guess.
describe('badgesFor soft mute', () => {
  it('never guesses: omitted and false both leave the badge off', () => {
    expect(badgesFor(makePost())).toEqual([])
    expect(badgesFor(makePost(), {})).toEqual([])
    expect(badgesFor(makePost(), {softMuted: false})).toEqual([])
  })

  it('marks a soft-muted note that is still on screen', () => {
    expect(badgesFor(makePost(), {softMuted: true})).toEqual([
      {key: 'softMuted', label: 'Soft-muted'},
    ])
  })

  it('sits right after the server filter, before reaction acceptance', () => {
    const badges = badgesFor(
      makePost({
        filtered: [{title: 'spoilers', action: 'hide'}],
        ext: {reactionAcceptance: 'likeOnlyForRemote'},
      }),
      {softMuted: true},
    )
    expect(badges.map(b => b.key)).toEqual(['filtered', 'softMuted', 'reactions'])
  })

  it('keeps the rest of the badge order intact', () => {
    const badges = badgesFor(
      makePost({pinned: true, editedAt: '2026-10-20T00:00:00.000Z', ext: {bookmarked: true}}),
      {softMuted: true},
    )
    expect(badges.map(b => b.key)).toEqual(['pinned', 'bookmarked', 'edited', 'softMuted'])
  })
})
