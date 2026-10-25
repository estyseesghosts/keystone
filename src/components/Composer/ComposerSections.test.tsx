import {fireEvent, render, screen, waitFor} from '@testing-library/react-native'
import {useState} from 'react'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'

import {ThemeProvider} from '#/alf/index'

import {asController, asControllerOptions} from '#/__tests__/factories'

import type {ComposerController} from './Composer'
import {
  DraftsSection,
  PollSection,
  RecipientSection,
  ScheduledListSection,
  ScheduleSection,
  ServerDraftsSection,
  UploadsSection,
} from './ComposerSections'

type FakeState = {
  visibilityRaw: string
  visibleUserIds: string[]
  scheduledAt: string | null
}

const MISSKEY_OPTIONS = asControllerOptions([
  {raw: 'public', kind: 'public', label: 'Public'},
  {raw: 'home', kind: 'quiet', label: 'Home'},
  {raw: 'followers', kind: 'followers', label: 'Followers'},
  {raw: 'specified', kind: 'direct', label: 'Specified users'},
])

const MASTODON_OPTIONS = asControllerOptions([
  {raw: 'public', kind: 'public', label: 'Public'},
  {raw: 'unlisted', kind: 'quiet', label: 'Unlisted'},
  {raw: 'private', kind: 'followers', label: 'Followers only'},
  {raw: 'direct', kind: 'direct', label: 'Mentioned people'},
])

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
  const c = asController({
    state,
    patch: (p: Partial<FakeState>) => setState(s => ({...s, ...p})),
    options,
    gates: {schedule: scheduleEnabled ? {enabled: true} : {enabled: false, reason: 'no'}},
    styles: {row: {}},
    backend,
  })
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
      'Could not resolve "bob".',
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

describe('UploadsSection', () => {
  function setupUploads({
    sensitiveEnabled = true,
    status = 'staged',
  }: {
    sensitiveEnabled?: boolean
    status?: 'staged' | 'done'
  } = {}) {
    const setSensitive = jest.fn()
    const c = asController({
      styles: {media: {}, row: {}, thumb: {}},
      gates: {
        mediaSensitive: sensitiveEnabled
          ? {enabled: true}
          : {
              enabled: false,
              reason: 'This server marks media sensitivity for the whole post, not per attachment.',
            },
        mediaDescription: {enabled: true},
      },
      uploads: {
        items: [
          {
            key: 'u1',
            name: 'cat.png',
            previewUri: null,
            status,
            mediaId: status === 'done' ? 'm1' : null,
            alt: '',
            sensitive: false,
            error: null,
          },
        ],
        setAlt: jest.fn(),
        setSensitive,
        remove: jest.fn(),
      },
    })
    render(
      <ThemeProvider>
        <UploadsSection c={c} />
      </ThemeProvider>,
    )
    return {setSensitive}
  }

  it('toggles per-file sensitivity before upload', () => {
    const {setSensitive} = setupUploads()
    fireEvent.press(screen.getByTestId('composer-upload-sensitive-u1'))
    expect(setSensitive).toHaveBeenCalledWith('u1', true)
  })

  it('disables the toggle after upload', () => {
    setupUploads({status: 'done'})
    expect(screen.getByTestId('composer-upload-sensitive-u1')).toBeDisabled()
  })

  it('disables the toggle with a visible reason where the family has no per-media field', () => {
    setupUploads({sensitiveEnabled: false})
    expect(screen.getByTestId('composer-upload-sensitive-u1')).toBeDisabled()
    expect(screen.getByTestId('composer-media-sensitive-reason')).toHaveTextContent(
      'This server marks media sensitivity for the whole post, not per attachment.',
    )
  })
})

describe('UploadsSection upload controls (X7.4)', () => {
  function setupControls({
    status = 'uploading',
    progress = null,
    keepOriginal = false,
    hadGps = null,
    videoNotice = null,
  }: {
    status?: 'staged' | 'uploading' | 'processing' | 'done' | 'error'
    progress?: {loaded: number; total: number | null} | null
    keepOriginal?: boolean
    hadGps?: boolean | null
    videoNotice?: string | null
  } = {}) {
    const cancel = jest.fn()
    const setKeepOriginal = jest.fn()
    const dismissVideoNotice = jest.fn()
    const c = asController({
      styles: {media: {}, row: {}, thumb: {}},
      gates: {
        mediaSensitive: {enabled: true},
        mediaDescription: {enabled: true},
      },
      uploads: {
        items: [
          {
            key: 'u1',
            name: 'cat.png',
            previewUri: null,
            status,
            mediaId: status === 'done' || status === 'processing' ? 'm1' : null,
            alt: '',
            sensitive: false,
            error: status === 'error' ? 'Upload failed.' : null,
            progress,
            mimeType: 'image/png',
            keepOriginal,
            hadGps,
          },
        ],
        setAlt: jest.fn(),
        setSensitive: jest.fn(),
        setKeepOriginal,
        remove: jest.fn(),
        cancel,
      },
      videoNotice,
      dismissVideoNotice,
    })
    render(
      <ThemeProvider>
        <UploadsSection c={c} />
      </ThemeProvider>,
    )
    return {cancel, setKeepOriginal, dismissVideoNotice}
  }

  it('shows a Cancel button only while uploading', () => {
    const {cancel} = setupControls({status: 'uploading'})
    fireEvent.press(screen.getByTestId('composer-upload-cancel-u1'))
    expect(cancel).toHaveBeenCalledWith('u1')
  })

  it('hides Cancel once the upload settled', () => {
    setupControls({status: 'done'})
    expect(screen.queryByTestId('composer-upload-cancel-u1')).toBeNull()
  })

  it('renders determinate progress as a percent and unknown totals as indeterminate', () => {
    setupControls({status: 'uploading', progress: {loaded: 1, total: 4}})
    expect(screen.getByText(/Uploading 25%/)).toBeTruthy()
  })

  it('renders the processing state honestly (never done with no URL)', () => {
    setupControls({status: 'processing'})
    expect(screen.getByText(/Still processing/)).toBeTruthy()
  })

  it('toggles Keep-original with a GPS-specific warning when location is known', () => {
    const {setKeepOriginal} = setupControls({status: 'staged', keepOriginal: true, hadGps: true})
    expect(screen.getByTestId('composer-upload-gps-u1')).toHaveTextContent(/location data/)
    fireEvent.press(screen.getByTestId('composer-upload-keep-u1'))
    expect(setKeepOriginal).toHaveBeenCalledWith('u1', false)
  })

  it('warns generically when the original may carry data (GPS unknown)', () => {
    setupControls({status: 'staged', keepOriginal: true, hadGps: null})
    expect(screen.getByTestId('composer-upload-gps-u1')).toHaveTextContent(/may include/)
  })

  it('shows the once-per-session video notice with a dismiss', () => {
    const {dismissVideoNotice} = setupControls({
      status: 'staged',
      videoNotice: 'Videos are sent unchanged.',
    })
    expect(screen.getByTestId('composer-video-notice')).toBeTruthy()
    fireEvent.press(screen.getByTestId('composer-video-notice-dismiss'))
    expect(dismissVideoNotice).toHaveBeenCalledTimes(1)
  })
})

describe('ScheduledListSection', () => {
  const session = {id: 'sess-1'}
  function scheduledBackend(list: unknown[]) {
    return {
      scheduled: {
        list: jest.fn(async () => list),
        delete: jest.fn(async () => undefined),
      },
    }
  }
  function listSetup(backend: unknown, scheduleEnabled = true) {
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    const c = asController({
      session,
      backend,
      family: 'misskey',
      gates: {schedule: scheduleEnabled ? {enabled: true} : {enabled: false, reason: 'no'}},
      styles: {row: {}},
    })
    return render(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ScheduledListSection c={c} />
        </ThemeProvider>
      </QueryClientProvider>,
    )
  }

  it('lists scheduled posts and cancels one', async () => {
    const backend = scheduledBackend([
      {id: 's1', scheduledAt: new Date(Date.now() + 3600_000).toISOString(), post: null, draft: {text: 'later'}},
    ])
    listSetup(backend)
    expect(await screen.findByTestId('composer-scheduled-s1')).toBeTruthy()
    fireEvent.press(screen.getByTestId('composer-scheduled-cancel-s1'))
    await waitFor(() => expect(backend.scheduled.delete).toHaveBeenCalledWith('s1'))
  })

  it('renders nothing without the scheduled sub-module', () => {
    listSetup({})
    expect(screen.queryByTestId('composer-scheduled-list')).toBeNull()
  })
})

describe('ServerDraftsSection', () => {
  const session = {id: 'sess-1'}
  const fullState = {
    text: 'hi',
    cw: '',
    cwEnabled: false,
    visibilityRaw: 'public',
    visibleUserIds: [],
    localOnly: false,
    poll: null,
    reactionAcceptance: null,
    scheduledAt: null,
    media: [],
    replyTo: null,
    quote: null,
  }
  function draftsBackend(list: unknown[]) {
    return {
      serverDrafts: {
        list: jest.fn(async () => list),
        create: jest.fn(async (d: unknown) => ({id: 'new-d', ...(d as object)})),
        update: jest.fn(async (_id: string, d: unknown) => ({id: _id, ...(d as object)})),
        delete: jest.fn(async () => undefined),
      },
    }
  }
  function draftsSetup(backend: unknown) {
    const qc = new QueryClient({defaultOptions: {queries: {retry: false}}})
    const patch = jest.fn()
    const setError = jest.fn()
    const attachTargets = jest.fn()
    const restoreServerDraft = jest.fn()
    const saveServerDraftNow = jest.fn(async () => ({id: 'new-d'}))
    const c = asController({
      session,
      backend,
      family: 'misskey',
      state: fullState,
      patch,
      setError,
      attachTargets,
      restoreServerDraft,
      saveServerDraftNow,
      gates: {
        poll: {enabled: false, reason: 'no'},
        pollMultiple: {enabled: false, reason: 'no'},
        localOnly: {enabled: false, reason: 'no'},
        reactionAcceptance: {enabled: false, reason: 'no'},
        noQuote: {enabled: false, reason: 'no'},
        mediaSensitive: {enabled: false, reason: 'no'},
        schedule: {enabled: true},
        quote: {enabled: true},
      },
      limits: {maxChars: 3000, maxMedia: 4, maxPollOptions: 4},
      styles: {row: {}},
    })
    render(
      <QueryClientProvider client={qc}>
        <ThemeProvider>
          <ServerDraftsSection c={c} />
        </ThemeProvider>
      </QueryClientProvider>,
    )
    return {patch, setError, restoreServerDraft, saveServerDraftNow, backend: backend as ReturnType<typeof draftsBackend>}
  }

  it('restores a server draft in place and deletes one', async () => {
    const {restoreServerDraft, backend} = draftsSetup(
      draftsBackend([
        {id: 'd1', text: 'hello draft', cw: 'warn', visibilityRaw: 'home', replyId: 'p1', renoteId: null},
      ]),
    )
    expect(await screen.findByTestId('composer-serverdraft-d1')).toBeTruthy()
    fireEvent.press(screen.getByTestId('composer-serverdraft-restore-d1'))
    // Edit-in-place threading lives in the controller: the section hands
    // over the whole row so the next save UPDATES it instead of duplicating.
    expect(restoreServerDraft).toHaveBeenCalledWith(
      expect.objectContaining({id: 'd1', text: 'hello draft'}),
    )
    fireEvent.press(screen.getByTestId('composer-serverdraft-del-d1'))
    await waitFor(() => expect(backend.serverDrafts.delete).toHaveBeenCalledWith('d1'))
  })

  it('saves the current composer state through the controller', async () => {
    const {saveServerDraftNow} = draftsSetup(draftsBackend([]))
    expect(await screen.findByText('No server drafts.')).toBeTruthy()
    fireEvent.press(screen.getByTestId('composer-serverdraft-save'))
    await waitFor(() => expect(saveServerDraftNow).toHaveBeenCalledTimes(1))
  })

  it('surfaces a failed save on the composer error line', async () => {
    const {saveServerDraftNow, setError} = draftsSetup(draftsBackend([]))
    saveServerDraftNow.mockRejectedValueOnce(new Error('nope'))
    expect(await screen.findByText('No server drafts.')).toBeTruthy()
    fireEvent.press(screen.getByTestId('composer-serverdraft-save'))
    await waitFor(() => expect(setError).toHaveBeenCalledWith('Could not save the draft.'))
  })

  it('renders nothing without the serverDrafts sub-module', () => {
    draftsSetup({})
    expect(screen.queryByTestId('composer-server-drafts')).toBeNull()
  })
})

describe('DraftsSection locations (slice 3)', () => {
  function localSetup({
    drafts,
    showDrafts = true,
    serverDrafts = false,
  }: {
    drafts: Array<{id: string; text: string}>
    showDrafts?: boolean
    serverDrafts?: boolean
  }) {
    const restore = jest.fn()
    const c = asController({
      drafts,
      showDrafts,
      restore,
      backend: serverDrafts ? {serverDrafts: {}} : {},
    })
    render(
      <ThemeProvider>
        <DraftsSection c={c} />
      </ThemeProvider>,
    )
    return {restore}
  }

  it('heads local rows "On this device" where server drafts are offered', () => {
    localSetup({drafts: [{id: 'd1', text: 'local words'}], serverDrafts: true})
    expect(screen.getByTestId('composer-drafts')).toBeTruthy()
    expect(screen.getByText('On this device')).toBeTruthy()
  })

  it('renders exactly the pre-slice list without server drafts (Mastodon)', () => {
    localSetup({drafts: [{id: 'd1', text: 'local words'}]})
    expect(screen.getByTestId('composer-drafts')).toBeTruthy()
    expect(screen.queryByText('On this device')).toBeNull()
  })

  it('restores a local row on press', () => {
    const {restore} = localSetup({drafts: [{id: 'd1', text: 'local words'}]})
    fireEvent.press(screen.getByText('local words'))
    expect(restore).toHaveBeenCalledWith(expect.objectContaining({id: 'd1'}))
  })

  it('names the empty state per location', () => {
    const {unmount} = render(
      <ThemeProvider>
        <DraftsSection
          c={asController({drafts: [], showDrafts: true, backend: {serverDrafts: {}}})}
        />
      </ThemeProvider>,
    )
    expect(screen.getByText('No drafts on this device.')).toBeTruthy()
    unmount()
    render(
      <ThemeProvider>
        <DraftsSection
          c={asController({drafts: [], showDrafts: true, backend: {}})}
        />
      </ThemeProvider>,
    )
    expect(screen.getByText('No saved drafts.')).toBeTruthy()
  })

  it('renders nothing when closed with no drafts', () => {
    render(
      <ThemeProvider>
        <DraftsSection
          c={asController({drafts: [], showDrafts: false, backend: {serverDrafts: {}}})}
        />
      </ThemeProvider>,
    )
    expect(screen.queryByTestId('composer-drafts')).toBeNull()
  })
})

// 1.6 — the composer poll row. "Hide totals" only exists on servers that
// store `poll[hide_totals]`; elsewhere it is a disabled chip carrying the
// reason, never inert.
describe('PollSection hide totals', () => {
  function pollSetup({
    hideTotalsEnabled,
    reason = 'This server does not support hiding poll totals.',
    hideTotals = false,
    multipleEnabled = true,
  }: {
    hideTotalsEnabled: boolean
    reason?: string
    hideTotals?: boolean
    multipleEnabled?: boolean
  }) {
    const patch = jest.fn()
    const c = asController({
      state: {
        text: 'vote',
        cw: '',
        cwEnabled: false,
        visibilityRaw: 'public',
        localOnly: false,
        replyTo: null,
        quote: null,
        media: [],
        poll: {choices: ['a', 'b'], multiple: false, durationSeconds: 86400, hideTotals},
        reactionAcceptance: null,
        noQuote: false,
        scheduledAt: null,
        visibleUserIds: [],
      },
      patch,
      gates: {
        poll: {enabled: true},
        pollMultiple: multipleEnabled ? {enabled: true} : {enabled: false, reason: 'single only'},
        pollHideTotals: hideTotalsEnabled ? {enabled: true} : {enabled: false, reason},
      },
      limits: {maxChars: 500, maxMedia: 4, maxPollOptions: 4},
      styles: {row: {}},
    })
    render(
      <ThemeProvider>
        <PollSection c={c} />
      </ThemeProvider>,
    )
    return {patch}
  }

  it('toggles hide totals where the server supports it', () => {
    const {patch} = pollSetup({hideTotalsEnabled: true})
    const chip = screen.getByTestId('composer-poll-hide-totals')
    expect(chip.props.accessibilityState.selected).toBe(false)
    fireEvent.press(chip)
    expect(patch).toHaveBeenCalledWith({
      poll: {choices: ['a', 'b'], multiple: false, durationSeconds: 86400, hideTotals: true},
    })
  })

  it('reflects an already-chosen hide totals', () => {
    pollSetup({hideTotalsEnabled: true, hideTotals: true})
    expect(
      screen.getByTestId('composer-poll-hide-totals').props.accessibilityState.selected,
    ).toBe(true)
  })

  it('disables the chip with the reason where the server lacks the field', () => {
    const {patch} = pollSetup({hideTotalsEnabled: false})
    const chip = screen.getByTestId('composer-poll-hide-totals')
    expect(chip.props.accessibilityState.disabled).toBe(true)
    expect(chip.props.accessibilityHint).toBe(
      'This server does not support hiding poll totals.',
    )
    fireEvent.press(chip)
    expect(patch).not.toHaveBeenCalled()
  })

  it('keeps multiple choice independent from hide totals', () => {
    pollSetup({hideTotalsEnabled: false, multipleEnabled: false})
    expect(
      screen.getByLabelText('Multiple choice').props.accessibilityState.disabled,
    ).toBe(true)
  })
})
