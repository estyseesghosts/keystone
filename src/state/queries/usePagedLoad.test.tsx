// X3.3: the paging gate — burst latch, error guard, 429 cooldown with a
// visible countdown, and first-page trim for pull-to-refresh.
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {act, render} from '@testing-library/react-native'

import {ApiError} from '@keystone/fedi'

import {i18n} from '#/locale/i18n'

import {
  trimInfiniteDataToFirstPage,
  trimQueryToFirstPage,
  usePagedLoad,
  useRefreshFirstPage,
  type PagedLoad,
  type PagedLoadSource,
} from './usePagedLoad'

i18n.load('en', {})
i18n.activate('en')

function setup(source: PagedLoadSource) {
  let latest: PagedLoad | null = null
  function Probe({src}: {src: PagedLoadSource}) {
    latest = usePagedLoad(src)
    return null
  }
  const tree = render(<Probe src={source} />)
  const current = (): PagedLoad => {
    if (!latest) throw new Error('paging probe never rendered')
    return latest
  }
  const resend = (next: PagedLoadSource) => {
    tree.rerender(<Probe src={next} />)
  }
  return {current, resend, unmount: tree.unmount}
}

function okSource(over: Partial<PagedLoadSource> = {}): PagedLoadSource {
  return {
    hasNextPage: true,
    isFetchingNextPage: false,
    isFetchNextPageError: false,
    fetchNextPage: () => {},
    error: null,
    ...over,
  }
}

function throttled(ms: number): ApiError {
  return new ApiError('throttled', 429, 'errors.network.apiError', 'http', {
    retryAfter: String(ms / 1000),
    retryAfterMs: ms,
  })
}

describe('usePagedLoad gate', () => {
  it('fires once per fetch across burst events (latch)', () => {
    const fetchNextPage = jest.fn()
    const {current, resend} = setup(okSource({fetchNextPage}))
    act(() => {
      current().onEndReached()
      current().onEndReached()
      current().onEndReached()
    })
    expect(fetchNextPage).toHaveBeenCalledTimes(1)
    // Still latched while the fetch is in flight.
    resend(okSource({fetchNextPage, isFetchingNextPage: true}))
    act(() => {
      current().onEndReached()
    })
    expect(fetchNextPage).toHaveBeenCalledTimes(1)
    // Released after true -> false: the next burst fetches again.
    resend(okSource({fetchNextPage, isFetchingNextPage: false}))
    act(() => {
      current().onEndReached()
    })
    expect(fetchNextPage).toHaveBeenCalledTimes(2)
  })

  it('error state + 20 scroll events = 0 extra requests', () => {
    const fetchNextPage = jest.fn()
    const failed = okSource({fetchNextPage, isFetchNextPageError: true, error: new Error('flaky')})
    const {current, resend} = setup(failed)
    act(() => {
      for (let i = 0; i < 20; i++) current().onEndReached()
    })
    expect(fetchNextPage).not.toHaveBeenCalled()
    // End of feed and in-flight fetches stay silent too.
    resend(okSource({fetchNextPage, hasNextPage: false}))
    resend(okSource({fetchNextPage, isFetchingNextPage: true}))
    act(() => {
      current().onEndReached()
    })
    expect(fetchNextPage).not.toHaveBeenCalled()
  })

  it('non-429 failures arm no cooldown (error guard still holds)', () => {
    const fetchNextPage = jest.fn()
    const {current} = setup(
      okSource({fetchNextPage, isFetchNextPageError: true, error: new Error('offline')}),
    )
    expect(current().coolingDown).toBe(false)
    expect(current().cooldownRemainingMs).toBe(0)
    expect(current().cooldownLabel).toBeNull()
    act(() => {
      for (let i = 0; i < 20; i++) current().onEndReached()
    })
    expect(fetchNextPage).not.toHaveBeenCalled()
  })

  it('429 with Retry-After suppresses paging with a visible countdown', () => {
    jest.useFakeTimers()
    try {
      const fetchNextPage = jest.fn()
      const {current, resend} = setup(
        okSource({fetchNextPage, isFetchNextPageError: true, error: throttled(30_000)}),
      )
      expect(current().coolingDown).toBe(true)
      expect(current().cooldownLabel).toContain('30')
      act(() => {
        for (let i = 0; i < 20; i++) current().onEndReached()
      })
      expect(fetchNextPage).not.toHaveBeenCalled()
      // The countdown ticks down on a visible timer.
      act(() => {
        jest.advanceTimersByTime(1000)
      })
      expect(current().cooldownLabel).toContain('29')
      act(() => {
        jest.advanceTimersByTime(29_000)
      })
      expect(current().coolingDown).toBe(false)
      expect(current().cooldownLabel).toBeNull()
      // The deadline elapsed but the error flag is still set: only the
      // explicit Retry button may clear it — auto-paging stays silent.
      act(() => {
        current().onEndReached()
      })
      expect(fetchNextPage).not.toHaveBeenCalled()
      // Retry succeeded: the flag clears and auto-paging resumes.
      resend(okSource({fetchNextPage}))
      act(() => {
        current().onEndReached()
      })
      expect(fetchNextPage).toHaveBeenCalledTimes(1)
    } finally {
      jest.useRealTimers()
    }
  })
})

describe('trimInfiniteDataToFirstPage', () => {
  it('keeps only the first page and its param', () => {
    const trimmed = trimInfiniteDataToFirstPage({
      pages: [
        {items: [1], cursor: 'a'},
        {items: [2], cursor: 'b'},
        {items: [], cursor: null},
      ],
      pageParams: [null, 'a', 'b'],
    })
    expect(trimmed?.pages).toHaveLength(1)
    expect(trimmed?.pageParams).toHaveLength(1)
    expect(trimmed?.pages[0]).toEqual({items: [1], cursor: 'a'})
  })

  it('passes through missing and single-page data untouched', () => {
    expect(trimInfiniteDataToFirstPage(undefined)).toBeUndefined()
    const single = {pages: [{items: [1]}], pageParams: [null]}
    expect(trimInfiniteDataToFirstPage(single)).toBe(single)
  })
})

describe('trimQueryToFirstPage + useRefreshFirstPage', () => {
  it('trims a cached infinite query to its first page in place', () => {
    const client = new QueryClient()
    const key = ['sess-1', 'post-feed', 'timeline|home']
    client.setQueryData(key, {
      pages: [
        {items: [1], cursor: 'a'},
        {items: [2], cursor: null},
      ],
      pageParams: [null, 'a'],
    })
    trimQueryToFirstPage(client, key)
    const data = client.getQueryData<{pages: unknown[]; pageParams: unknown[]}>(key)
    expect(data?.pages).toHaveLength(1)
    expect(data?.pageParams).toHaveLength(1)
  })

  it('refresh trims first, then refetches (one request, not N)', () => {
    const client = new QueryClient()
    const key = ['sess-1', 'post-feed', 'timeline|home']
    client.setQueryData(key, {
      pages: [
        {items: [1], cursor: 'a'},
        {items: [2], cursor: null},
      ],
      pageParams: [null, 'a'],
    })
    const refetch = jest.fn()
    let latest: (() => void) | null = null
    function Probe() {
      latest = useRefreshFirstPage(key, refetch)
      return null
    }
    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    )
    if (!latest) throw new Error('refresh probe never rendered')
    act(() => {
      latest!()
    })
    const data = client.getQueryData<{pages: unknown[]; pageParams: unknown[]}>(key)
    expect(data?.pages).toHaveLength(1)
    expect(refetch).toHaveBeenCalledTimes(1)
  })
})
