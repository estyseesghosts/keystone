import type {NewsLink} from '@keystone/fedi'

import {mergeNewsLinks} from './news'

function link(url: string, title = url): NewsLink {
  return {url, title, description: null, providerName: null, image: null}
}

// R2.4: NewsTab load-more dedupes against the freshest list, so two
// overlapping page fetches can never append the same url twice.
describe('mergeNewsLinks', () => {
  it('appends fresh urls in order', () => {
    const prev = [link('https://n.example/1')]
    expect(mergeNewsLinks(prev, [link('https://n.example/2')]).map(l => l.url)).toEqual([
      'https://n.example/1',
      'https://n.example/2',
    ])
  })

  it('drops urls already on screen, even from a stale second page', () => {
    const first = [link('https://n.example/1'), link('https://n.example/2')]
    const overlap = [link('https://n.example/2'), link('https://n.example/3')]
    expect(mergeNewsLinks(first, overlap).map(l => l.url)).toEqual([
      'https://n.example/1',
      'https://n.example/2',
      'https://n.example/3',
    ])
  })

  it('never mutates the previous list', () => {
    const prev = [link('https://n.example/1')]
    mergeNewsLinks(prev, [link('https://n.example/1'), link('https://n.example/2')])
    expect(prev.map(l => l.url)).toEqual(['https://n.example/1'])
  })
})
