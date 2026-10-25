// F8: poll render + vote states.
import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'
import {i18n} from '@lingui/core'

import type {Poll} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {PostPoll, formatPollExpiry, isPollClosed} from '#/components/Post/PostPoll'

i18n.load('en', {})
i18n.activate('en')

function poll(over: Partial<Poll> = {}): Poll {
  return {
    id: 'poll1',
    multiple: false,
    expiresAt: null,
    expired: false,
    votesCount: 10,
    votersCount: 8,
    options: [
      {text: 'Alpha', votesCount: 7, voted: false},
      {text: 'Beta', votesCount: 3, voted: false},
    ],
    ...over,
  }
}

function renderPoll(ui: React.ReactElement) {
  return render(
    <I18nProvider i18n={i18n}>
      <ThemeProvider theme="light">{ui}</ThemeProvider>
    </I18nProvider>,
  )
}

describe('PostPoll (F8)', () => {
  it('renders options, counts, and the vote meta', () => {
    renderPoll(<PostPoll poll={poll()} onVote={jest.fn()} testID="poll" />)
    expect(screen.getByText('Alpha')).toBeTruthy()
    expect(screen.getByText('Beta')).toBeTruthy()
    expect(screen.getByTestId('poll-meta')).toBeTruthy()
    expect(screen.getByTestId('poll-vote')).toBeTruthy()
  })

  it('submits the selected option and locks', async () => {
    const onVote = jest.fn().mockResolvedValue(undefined)
    renderPoll(<PostPoll poll={poll()} onVote={onVote} testID="poll" />)
    fireEvent.press(screen.getByTestId('poll-option-1'))
    fireEvent.press(screen.getByTestId('poll-vote'))
    expect(onVote).toHaveBeenCalledWith([1])
    await screen.findByText('✓ Beta')
  })

  it('shows an honest error with a retry when voting fails', async () => {
    const onVote = jest.fn().mockRejectedValue(new Error('nope'))
    renderPoll(<PostPoll poll={poll()} onVote={onVote} testID="poll" />)
    fireEvent.press(screen.getByTestId('poll-option-0'))
    fireEvent.press(screen.getByTestId('poll-vote'))
    await screen.findByTestId('poll-error')
    // Still unlocked: retry is possible.
    expect(screen.getByTestId('poll-vote')).toBeTruthy()
  })

  it('renders read-only without onVote and marks voted options', () => {
    renderPoll(
      <PostPoll
        poll={poll({options: [
          {text: 'Alpha', votesCount: 7, voted: true},
          {text: 'Beta', votesCount: 3, voted: false},
        ]})}
        testID="poll"
      />,
    )
    expect(screen.getByText('✓ Alpha')).toBeTruthy()
    expect(screen.queryByTestId('poll-vote')).toBeNull()
  })

  it('supports multiple choice and closed states', () => {
    renderPoll(<PostPoll poll={poll({multiple: true, expired: true})} onVote={jest.fn()} testID="poll" />)
    expect(screen.queryByTestId('poll-vote')).toBeNull()
    expect(screen.getByTestId('poll-meta')).toBeTruthy()
  })

  it('resyncs when the server voted flags change after mount', () => {
    const {rerender} = renderPoll(<PostPoll poll={poll()} onVote={jest.fn()} testID="poll" />)
    expect(screen.queryByTestId('poll-vote')).toBeTruthy()
    expect(screen.queryByText('✓ Alpha')).toBeNull()
    rerender(
      <I18nProvider i18n={i18n}>
        <ThemeProvider theme="light">
          <PostPoll
            poll={poll({options: [
              {text: 'Alpha', votesCount: 8, voted: true},
              {text: 'Beta', votesCount: 3, voted: false},
            ]})}
            onVote={jest.fn()}
            testID="poll"
          />
        </ThemeProvider>
      </I18nProvider>,
    )
    // Server flags win: the vote locks and the checkmark follows the prop.
    expect(screen.getByText('✓ Alpha')).toBeTruthy()
    expect(screen.queryByTestId('poll-vote')).toBeNull()
  })

  it('keeps local picks across pure count updates', () => {
    const {rerender} = renderPoll(<PostPoll poll={poll()} onVote={jest.fn()} testID="poll" />)
    fireEvent.press(screen.getByTestId('poll-option-1'))
    rerender(
      <I18nProvider i18n={i18n}>
        <ThemeProvider theme="light">
          <PostPoll
            poll={poll({votesCount: 11, options: [
              {text: 'Alpha', votesCount: 7, voted: false},
              {text: 'Beta', votesCount: 4, voted: false},
            ]})}
            onVote={jest.fn()}
            testID="poll"
          />
        </ThemeProvider>
      </I18nProvider>,
    )
    // Still unlocked with the local pick intact — only a flags change resyncs.
    expect(screen.getByTestId('poll-vote')).toBeTruthy()
  })

  it('reports partial progress and retries only the rest', async () => {
    const partial = Object.assign(new Error('boom'), {
      code: 'errors.poll.partialVote',
      params: {recorded: [0], total: 2},
    })
    const onVote = jest.fn().mockRejectedValueOnce(partial).mockResolvedValue(undefined)
    renderPoll(<PostPoll poll={poll({multiple: true})} onVote={onVote} testID="poll" />)
    fireEvent.press(screen.getByTestId('poll-option-0'))
    fireEvent.press(screen.getByTestId('poll-option-1'))
    fireEvent.press(screen.getByTestId('poll-vote'))
    expect(onVote).toHaveBeenCalledWith([0, 1])
    await screen.findByText('Recorded 1 of 2 choices. Retry sends only the rest.')
    fireEvent.press(screen.getByTestId('poll-vote'))
    await waitFor(() => expect(onVote).toHaveBeenCalledWith([1]))
    await screen.findByText('✓ Beta')
  })
})

describe('formatPollExpiry (F8)', () => {
  it('is future-facing: never "now" for an open poll', () => {
    expect(formatPollExpiry(null)).toBeNull()
    expect(formatPollExpiry('not-a-date')).toBeNull()
    expect(formatPollExpiry(new Date(Date.now() - 1000).toISOString())).toBe('closing soon')
    expect(formatPollExpiry(new Date(Date.now() + 30 * 1000).toISOString())).toBe('in under a minute')
    expect(formatPollExpiry(new Date(Date.now() + 30 * 60 * 1000).toISOString())).toBe('in 30m')
    // 26h + 1m: `formatPollExpiry` floors to whole hours, so an exact 26h
    // flips to "in 25h" whenever a millisecond elapses between the two
    // `Date.now()` reads (flaky under load).
    expect(formatPollExpiry(new Date(Date.now() + 26 * 3600 * 1000 + 60_000).toISOString())).toBe('in 26h')
    expect(formatPollExpiry(new Date(Date.now() + 5 * 86400 * 1000).toISOString())).toMatch(/^on /)
  })
})

describe('isPollClosed (M16)', () => {
  it('the server flag wins; otherwise the deadline decides at render time', () => {
    const now = Date.now()
    expect(isPollClosed({expired: true, expiresAt: null}, now)).toBe(true)
    expect(isPollClosed({expired: true, expiresAt: new Date(now + 60_000).toISOString()}, now)).toBe(true)
    expect(isPollClosed({expired: false, expiresAt: new Date(now + 60_000).toISOString()}, now)).toBe(false)
    expect(isPollClosed({expired: false, expiresAt: new Date(now - 1000).toISOString()}, now)).toBe(true)
    expect(isPollClosed({expired: false, expiresAt: null}, now)).toBe(false)
    expect(isPollClosed({expired: false, expiresAt: 'not-a-date'}, now)).toBe(false)
  })
})

describe('PostPoll hidden totals (ADR 0013)', () => {
  function hidden(over: Partial<Poll> = {}): Poll {
    return poll({
      votesCount: null,
      votersCount: null,
      options: [
        {text: 'Alpha', votesCount: null, voted: false},
        {text: 'Beta', votesCount: null, voted: false},
      ],
      ...over,
    })
  }

  it('renders hidden totals with no bar and no fake zero', () => {
    renderPoll(<PostPoll poll={hidden()} onVote={jest.fn()} testID="poll" />)
    expect(screen.getAllByText('Hidden until closed').length).toBeGreaterThan(0)
    // No fabricated zeros anywhere: neither option counts nor the footer.
    expect(screen.queryByText('0')).toBeNull()
    expect(screen.getByTestId('poll-meta')).toHaveTextContent('Hidden until closed')
    // Voting is still offered: hidden totals are votable.
    expect(screen.getByTestId('poll-vote')).toBeTruthy()
    // The accessibility label is honest too.
    expect(screen.getByTestId('poll-option-0').props.accessibilityLabel).toMatch(/Hidden until closed/)
  })

  it('renders option-title emoji through the shared pipeline', () => {
    renderPoll(
      <PostPoll
        poll={poll({
          options: [
            {text: 'Yes :blobcat:', votesCount: 7, voted: false},
            {text: 'No', votesCount: 3, voted: false},
          ],
        })}
        emojis={{blobcat: 'https://m.example/emoji/blobcat.png'}}
        onVote={jest.fn()}
        testID="poll"
      />,
    )
    expect(screen.getByLabelText(':blobcat:').props.source?.uri).toBe(
      'https://m.example/emoji/blobcat.png',
    )
    expect(screen.queryByText('Yes :blobcat:')).toBeNull()
    // Unknown codes stay literal, never fabricated.
    renderPoll(
      <PostPoll
        poll={poll({
          options: [{text: 'Maybe :nosuchemoji:', votesCount: 7, voted: false}],
        })}
        emojis={{}}
        onVote={jest.fn()}
        testID="poll-unknown"
      />,
    )
    expect(screen.getByText(/:nosuchemoji:/)).toBeTruthy()
  })

  it('crosses to closed at the deadline without a refetch', () => {
    jest.useFakeTimers()
    try {
      const at = Date.now() + 60_000
      const {rerender} = renderPoll(
        <PostPoll poll={poll({expiresAt: new Date(at).toISOString()})} onVote={jest.fn()} testID="poll" />,
      )
      expect(screen.getByTestId('poll-vote')).toBeTruthy()
      jest.advanceTimersByTime(61_000)
      rerender(
        <I18nProvider i18n={i18n}>
          <ThemeProvider theme="light">
            <PostPoll
              poll={poll({expiresAt: new Date(at).toISOString()})}
              onVote={jest.fn()}
              testID="poll"
            />
          </ThemeProvider>
        </I18nProvider>,
      )
      expect(screen.queryByTestId('poll-vote')).toBeNull()
      expect(screen.getByTestId('poll-meta')).toHaveTextContent(/closed/)
    } finally {
      jest.useRealTimers()
    }
  })
})
