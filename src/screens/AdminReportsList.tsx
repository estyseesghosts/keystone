// Reports queue list (D3.7 split of `src/screens/AdminReports.tsx`):
// the queue list screen plus the pure display helpers the detail screen
// and tests share. See `AdminReportDetail.tsx` for the detail half.
//
// Two families (clickstone §3.2):
// - Mastodon: list/get/assign/unassign/reopen/resolve/recategorize. No
//   forward (forwarding happens at report time) and no moderator notes —
//   those actions stay hidden, never faked.
// - Misskey: list/resolve-with-verdict/note-update/forward. No detail
//   fetch (no show endpoint — detail renders the shared list row), no
//   reopen/assign/recategorize — hidden, never faked.

import {useState} from 'react'
import {FlatList, RefreshControl, View} from 'react-native'
import {useNavigation, type NavigationProp} from '@react-navigation/native'

import {
  type QueuedReport,
  type ReportCategory,
  type ReportResolution,
} from '@keystone/fedi'

import {useTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {Pagehead} from '#/components/Pagehead'
import {Pressable} from '#/components/Pressable'
import {SignInButton} from '#/components/SignInButton'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'
import {useAdminReportsQueue, type AdminQueueFilter} from '#/state/queries/adminReports'

const QUEUE_FILTERS: readonly AdminQueueFilter[] = ['open', 'resolved', 'all']

/** Display label for the queue state. Pure. */
export function reportStateLabel(state: QueuedReport['state']): string {
  return state === 'resolved' ? 'Resolved' : 'Open'
}

/** Display label for the report category (`null` = none reported). Pure. */
export function reportCategoryLabel(category: ReportCategory | null): string {
  switch (category) {
    case 'spam':
      return 'Spam'
    case 'legal':
      return 'Legal'
    case 'violation':
      return 'Rule violation'
    case 'other':
      return 'Other'
    default:
      return 'No category'
  }
}

/** Display label for the recorded verdict (`null` = none). Pure. */
export function reportResolutionLabel(resolution: ReportResolution | null): string {
  switch (resolution) {
    case 'accept':
      return 'Accepted'
    case 'reject':
      return 'Rejected'
    default:
      return 'No verdict'
  }
}

/** Handle shown for a report participant (display name, else handle). Pure. */
export function reportActorLabel(account: QueuedReport['reporter']): string {
  if (!account) return 'Unknown account'
  const name = account.displayName?.trim()
  if (name) return name
  return account.acct ? `@${account.acct}` : 'Unknown account'
}

/** True when two id lists hold the same set (order-insensitive). Pure. */
export function sameIdSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const set = new Set(a)
  return b.every(x => set.has(x))
}

/** One-line reporter → target summary for a queue row. Pure. */
export function reportRowTitle(report: QueuedReport): string {
  return `${reportActorLabel(report.reporter)} → ${reportActorLabel(report.target)}`
}

function QueueRow({report, onOpen}: {report: QueuedReport; onOpen: () => void}) {
  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="link"
      accessibilityLabel={`${reportRowTitle(report)}. Open report.`}
      testID={`admin-reports-row-${report.id}`}>
      <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]}>
        <Body>{reportRowTitle(report)}</Body>
        {report.comment ? (
          <Caption color="faint" numberOfLines={2}>
            {report.comment}
          </Caption>
        ) : null}
        <Caption color="faint">
          {reportStateLabel(report.state)} · {reportCategoryLabel(report.category)}
          {report.forwarded ? ' · forwarded' : ''}
          {report.statusIds.length > 0 ? ` · ${report.statusIds.length} post${report.statusIds.length === 1 ? '' : 's'}` : ''}
          {report.ruleIds.length > 0 ? ` · ${report.ruleIds.length} rule${report.ruleIds.length === 1 ? '' : 's'}` : ''}
          {report.assignee ? ` · ${reportActorLabel(report.assignee)}` : ''}
        </Caption>
      </View>
    </Pressable>
  )
}

export function AdminReportsScreen() {
  const theme = useTheme()
  const navigation = useNavigation<NavigationProp<RootParamList>>()
  const {session, backend} = useActiveBackend()
  const [filter, setFilter] = useState<AdminQueueFilter>('open')
  const state = useAdminReportsQueue(session?.id ?? null, filter)

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="admin-reports-screen">
        <Pagehead title="Reports" />
        <Body>Sign in to moderate reports.</Body>
        <Caption color="faint">The queue never shows sample data when signed out.</Caption>
        <SignInButton />
      </View>
    )
  }

  if (!state.gate.ok) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="admin-reports-screen">
        <Pagehead title="Reports" />
        {state.gate.reason === 'not-staff' ? (
          <>
            <Body>Requires an admin or moderator account.</Body>
            <Caption color="faint">
              This server reports your account as neither admin nor moderator.
            </Caption>
          </>
        ) : (
          <>
            <Body>Reports are not available on this server.</Body>
            <Caption color="faint">
              Keystone reads Mastodon- and Misskey-family report queues only.
            </Caption>
          </>
        )}
      </View>
    )
  }

  const refreshing = state.queue.status === 'loading'
  return (
    <View style={[atoms.flex1, atoms.p_md, atoms.gap_md]} testID="admin-reports-screen">
      <Pagehead title="Reports" />
      <View style={[atoms.row, atoms.gap_sm]}>
        {QUEUE_FILTERS.map(f => (
          <Button
            key={f}
            label={f === 'all' ? 'All' : f === 'open' ? 'Open' : 'Resolved'}
            variant={filter === f ? 'primary' : 'secondary'}
            onPress={() => setFilter(f)}
            testID={`admin-reports-filter-${f}`}
          />
        ))}
      </View>
      {state.queue.status === 'loading' || state.queue.status === 'gated' ? (
        <View style={[atoms.centered, atoms.py_sm]}>
          <Loader testID="admin-reports-loading" />
        </View>
      ) : state.queue.status === 'denied' ? (
        <Caption color="faint" testID="admin-reports-denied">
          Your account may not read the reports queue on this server (missing scope or staff
          role).
        </Caption>
      ) : state.queue.status === 'absent' || state.queue.status === 'empty' ? (
        <Caption color="faint" testID="admin-reports-absent">
          No reports in this view.
        </Caption>
      ) : state.queue.status === 'error' ? (
        <View style={[atoms.gap_sm]}>
          <Body>Could not load the queue.</Body>
          <Button
            label="Retry"
            variant="secondary"
            onPress={state.queue.retry}
            testID="admin-reports-retry"
          />
        </View>
      ) : (
        <FlatList
          data={state.queue.data ?? []}
          keyExtractor={item => item.id}
          testID="admin-reports-list"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={state.queue.retry}
              testID="admin-reports-refresh"
              tintColor={theme.palette.muted}
              colors={[theme.palette.muted]}
              progressBackgroundColor={theme.palette.bg}
            />
          }
          renderItem={({item}) => (
            <QueueRow report={item} onOpen={() => navigation.navigate('AdminReport', {id: item.id})} />
          )}
        />
      )}
    </View>
  )
}
