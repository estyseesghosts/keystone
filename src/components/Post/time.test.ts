import {formatRelativeTime} from './time'

const NOW = Date.parse('2026-10-20T12:00:00.000Z')

describe('formatRelativeTime (v1 behavior)', () => {
  it('says now under a minute', () => {
    expect(formatRelativeTime('2026-10-20T11:59:30.000Z', NOW, 'en')).toBe('now')
  })

  it('uses narrow relative minutes and hours', () => {
    expect(formatRelativeTime('2026-10-20T11:55:00.000Z', NOW, 'en')).toBe('5m ago')
    expect(formatRelativeTime('2026-10-20T09:00:00.000Z', NOW, 'en')).toBe('3h ago')
  })

  it('falls back to the locale date past a day', () => {
    expect(formatRelativeTime('2026-10-18T12:00:00.000Z', NOW, 'en-US')).toBe(
      new Date('2026-10-18T12:00:00.000Z').toLocaleDateString('en-US'),
    )
  })

  it('echoes invalid input and blanks empty input', () => {
    expect(formatRelativeTime('not-a-date', NOW, 'en')).toBe('not-a-date')
    expect(formatRelativeTime(null, NOW, 'en')).toBe('')
  })
})
