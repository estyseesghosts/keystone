import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {useState} from 'react'

import {ThemeProvider} from '#/alf/index'

import type {ComposerController} from './Composer'
import {RecipientSection, ScheduleSection} from './ComposerSections'

type FakeState = {
  visibilityRaw: string
  visibleUserIds: string[]
  scheduledAt: string | null
}

const MISSKEY_OPTIONS = [
  {raw: 'public', kind: 'public', label: 'Public'},
  {raw: 'home', kind: 'quiet', label: 'Home'},
  {raw: 'followers', kind: 'followers', label: 'Followers'},
  {raw: 'specified', kind: 'direct', label: 'Specified users'},
] as unknown as ComposerController['options']

const MASTODON_OPTIONS = [
  {raw: 'public', kind: 'public', label: 'Public'},
  {raw: 'unlisted', kind: 'quiet', label: 'Unlisted'},
  {raw: 'private', kind: 'followers', label: 'Followers only'},
  {raw: 'direct', kind: 'direct', label: 'Mentioned people'},
] as unknown as ComposerController['options']

function Harness({
  initial,
  options = MISSKEY_OPTIONS,
  backend,
  scheduleEnabled = true,
  section,
}: {
  initial: FakeState
  options?: ComposerController['options']
  backend?: unknown
  scheduleEnabled?: boolean
  section: 'recipients' | 'schedule'
}) {
  const [state, setState] = useState(initial)
  const c = {
    state,
    patch: (p: Partial<FakeState>) => setState(s => ({...s, ...p})),
    options,
    gates: {schedule: scheduleEnabled ? {enabled: true} : {enabled: false, reason: 'no'}},
    styles: {row: {}},
    backend,
  } as unknown as ComposerController
  return section === 'recipients' ? <RecipientSection c={c} /> : <ScheduleSection c={c} />
}

function setup(props: Parameters<typeof Harness>[0]) {
  return render(
    <ThemeProvider>
      <Harness {...props} />
    </ThemeProvider>,
  )
}

describe('RecipientSection', () => {
  it('is hidden unless the selected option reads as direct', () => {
    setup({initial: {visibilityRaw: 'public', visibleUserIds: [], scheduledAt: null}, section: 'recipients'})
    expect(screen.queryByTestId('composer-recipients')).toBeNull()
    expect(screen.queryByTestId('composer-recipient-input')).toBeNull()
  })

  it('renders for the misskey specified option and the mastodon direct option', () => {
    const {unmount} = setup({
      initial: {visibilityRaw: 'specified', visibleUserIds: [], scheduledAt: null},
      section: 'recipients',
    })
    expect(screen.getByTestId('composer-recipients')).toBeTruthy()
    expect(screen.getByTestId('composer-recipient-input')).toBeTruthy()
    expect(screen.getByTestId('composer-recipient-add')).toBeTruthy()
    unmount()
    setup({
      initial: {visibilityRaw: 'direct', visibleUserIds: [], scheduledAt: null},
      options: MASTODON_OPTIONS,
      section: 'recipients',
    })
    expect(screen.getByTestId('composer-recipients')).toBeTruthy()
  })

  it('adds/removes verbatim handles when the backend has no lookup', () => {
    setup({initial: {visibilityRaw: 'specified', visibleUserIds: [], scheduledAt: null}, section: 'recipients'})
    // Honest hint: no resolution happens on this server.
    expect(screen.getByText('IDs are sent verbatim on this server.')).toBeTruthy()
    fireEvent.changeText(screen.getByTestId('composer-recipient-input'), '@alice')
    fireEvent.press(screen.getByTestId('composer-recipient-add'))
    expect(screen.getByTestId('composer-recipient-del-@alice')).toBeTruthy()
    fireEvent.press(screen.getByTestId('composer-recipient-del-@alice'))
    expect(screen.queryByTestId('composer-recipient-del-@alice')).toBeNull()
  })

  it('resolves handles through backend.account and keeps raw text on failure', async () => {
    const backend = {
      account: jest.fn(async ({username}: {username: string}) => {
        if (username === 'alice') return {id: 'u1'}
        throw new Error('No account found for bob.')
      }),
      search: {},
    }
    setup({
      initial: {visibilityRaw: 'specified', visibleUserIds: [], scheduledAt: null},
      backend,
      section: 'recipients',
    })
    fireEvent.changeText(screen.getByTestId('composer-recipient-input'), '@alice@host.example')
    fireEvent.press(screen.getByTestId('composer-recipient-add'))
    await waitFor(() => expect(screen.getByTestId('composer-recipient-del-u1')).toBeTruthy())
    expect(backend.account).toHaveBeenCalledWith({username: 'alice', host: 'host.example'})

    fireEvent.changeText(screen.getByTestId('composer-recipient-input'), 'bob')
    fireEvent.press(screen.getByTestId('composer-recipient-add'))
    await waitFor(() => expect(screen.getByTestId('composer-recipient-error')).toBeTruthy())
    expect(screen.getByTestId('composer-recipient-error')).toHaveTextContent(
      'No account found for bob.',
    )
    // Raw text is kept for retry/edit.
    expect(screen.getByTestId('composer-recipient-input').props.value).toBe('bob')
    expect(screen.queryByTestId('composer-recipient-del-bob')).toBeNull()
  })
})

describe('ScheduleSection', () => {
  it('is hidden without scheduledAt and keeps the raw field', () => {
    setup({initial: {visibilityRaw: 'public', visibleUserIds: [], scheduledAt: null}, section: 'schedule'})
    expect(screen.queryByTestId('composer-schedule-at')).toBeNull()
  })

  it('quick chips set ISO strings (+1h / tomorrow 09:00 / +7d 09:00)', () => {
    setup({
      initial: {
        visibilityRaw: 'public',
        visibleUserIds: [],
        scheduledAt: new Date(Date.now() + 7200_000).toISOString(),
      },
      section: 'schedule',
    })
    const before = Date.now()
    fireEvent.press(screen.getByTestId('composer-schedule-in1h'))
    const in1h = Date.parse(screen.getByTestId('composer-schedule-at').props.value)
    expect(in1h).toBeGreaterThan(before + 3500_000)
    expect(in1h).toBeLessThanOrEqual(Date.now() + 3700_000)

    fireEvent.press(screen.getByTestId('composer-schedule-tomorrow'))
    const tomorrow = new Date(screen.getByTestId('composer-schedule-at').props.value)
    const expectedDay = new Date()
    expectedDay.setDate(expectedDay.getDate() + 1)
    expect(tomorrow.getHours()).toBe(9)
    expect(tomorrow.getDate()).toBe(expectedDay.getDate())
    expect(tomorrow.getTime()).toBeGreaterThan(Date.now())

    fireEvent.press(screen.getByTestId('composer-schedule-nextweek'))
    const nextWeek = new Date(screen.getByTestId('composer-schedule-at').props.value)
    const expectedWeek = new Date()
    expectedWeek.setDate(expectedWeek.getDate() + 7)
    expect(nextWeek.getHours()).toBe(9)
    expect(nextWeek.getDate()).toBe(expectedWeek.getDate())
  })

  it('shows an honest message for unparsable and past times, keeping the raw string', () => {
    const {unmount} = setup({
      initial: {visibilityRaw: 'public', visibleUserIds: [], scheduledAt: 'not-a-time'},
      section: 'schedule',
    })
    expect(screen.getByTestId('composer-schedule-invalid')).toHaveTextContent('Scheduled time must be in the future.')
    expect(screen.getByTestId('composer-schedule-at').props.value).toBe('not-a-time')
    unmount()

    setup({
      initial: {
        visibilityRaw: 'public',
        visibleUserIds: [],
        scheduledAt: new Date(Date.now() - 60_000).toISOString(),
      },
      section: 'schedule',
    })
    expect(screen.getByTestId('composer-schedule-invalid')).toHaveTextContent('Scheduled time must be in the future.')
  })

  it('shows no message for a future time', () => {
    setup({
      initial: {
        visibilityRaw: 'public',
        visibleUserIds: [],
        scheduledAt: new Date(Date.now() + 7200_000).toISOString(),
      },
      section: 'schedule',
    })
    expect(screen.queryByTestId('composer-schedule-invalid')).toBeNull()
  })
})
