// F8: poll render + vote states.
import {fireEvent, render, screen} from '@testing-library/react-native'
import {I18nProvider} from '@lingui/react'
import {i18n} from '@lingui/core'

import type {Poll} from '@keystone/fedi'

import {ThemeProvider} from '#/alf/index'
import {PostPoll, formatPollExpiry} from '#/components/Post/PostPoll'

i18n.load('en', {})
i18n.activate('en')

function poll(over: Partial<Poll> = {}): Poll {
  return {
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
})

describe('formatPollExpiry (F8)', () => {
  it('is future-facing: never "now" for an open poll', () => {
    expect(formatPollExpiry(null)).toBeNull()
    expect(formatPollExpiry('not-a-date')).toBeNull()
    expect(formatPollExpiry(new Date(Date.now() - 1000).toISOString())).toBe('closing soon')
    expect(formatPollExpiry(new Date(Date.now() + 30 * 1000).toISOString())).toBe('in under a minute')
    expect(formatPollExpiry(new Date(Date.now() + 30 * 60 * 1000).toISOString())).toBe('in 30m')
    expect(formatPollExpiry(new Date(Date.now() + 26 * 3600 * 1000).toISOString())).toBe('in 26h')
    expect(formatPollExpiry(new Date(Date.now() + 5 * 86400 * 1000).toISOString())).toMatch(/^on /)
  })
})
