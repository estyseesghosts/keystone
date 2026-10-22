// Reports queue (`/admin/reports`, Wave 3 slice 3.2): the daily moderation
// surface. Queue list + one report detail with confirm-gated mutations.
//
// Two families (clickstone §3.2):
// - Mastodon: list/get/assign/unassign/reopen/resolve/recategorize. No
//   forward (forwarding happens at report time) and no moderator notes —
//   those actions stay hidden, never faked.
// - Misskey: list/resolve-with-verdict/note-update/forward. No detail
//   fetch (no show endpoint — detail renders the shared list row), no
//   reopen/assign/recategorize — hidden, never faked.
//
// Every mutation is two-step confirmed in the UI, then runs and refetches
// (confirm + refetch; optimistic updates are forbidden here). A 403 on a
// mutation disables the write actions with a reason — it never clears the
// session. Moderation-log/history entries are display-only where the API
// carries them (action outcome on Mastodon rows, resolution + note on
// Misskey rows); neither family's API exposes a per-report history
// endpoint (verified — web-admin-only), so none is rendered.

import {useState} from 'react'
import {FlatList, RefreshControl, ScrollView, TextInput, View} from 'react-native'
import {useNavigation, useRoute, type NavigationProp} from '@react-navigation/native'

import {
  REPORT_CATEGORIES,
  isPermissionError,
  type QueuedReport,
  type ReportCategory,
  type ReportResolution,
} from '@keystone/fedi'

import {useTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {Body, Caption, Heading} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {Pagehead} from '#/components/Pagehead'
import {Pressable} from '#/components/Pressable'
import {SignInButton} from '#/components/SignInButton'
import type {RootParamList} from '#/routes'
import {useActiveBackend} from '#/screens/HomeFeed'
import {useReportRules} from '#/state/queries/reports'
import {
  useAdminReport,
  useAdminReportsQueue,
  useAssignReport,
  useForwardReport,
  useRecategorizeReport,
  useReopenReport,
  useResolveReport,
  useUnassignReport,
  useUpdateReportNote,
  type AdminQueueFilter,
} from '#/state/queries/adminReports'

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

function IdList({label, ids, testID}: {label: string; ids: readonly string[]; testID: string}) {
  if (ids.length === 0) return null
  return (
    <View style={[atoms.gap_sm]} testID={testID}>
      <Caption color="faint">
        {label} ({ids.length})
      </Caption>
      {ids.slice(0, 10).map(id => (
        <Caption key={id}>{id}</Caption>
      ))}
      {ids.length > 10 ? <Caption color="faint">+{ids.length - 10} more</Caption> : null}
    </View>
  )
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

// --- Detail ------------------------------------------------------------------

type ConfirmAction =
  | 'assign'
  | 'unassign'
  | 'reopen'
  | 'resolve'
  | 'recategorize'
  | 'note'
  | 'forward'

function ConfirmShell({
  title,
  action,
  busy,
  confirmDisabled,
  error,
  onConfirm,
  onCancel,
  children,
}: {
  title: string
  action: ConfirmAction
  busy: boolean
  confirmDisabled?: boolean
  error: string | null
  onConfirm: () => void
  onCancel: () => void
  children?: React.ReactNode
}) {
  return (
    <View style={[atoms.gap_sm]} testID={`admin-report-confirm-${action}`}>
      <Body>{title}</Body>
      {children}
      {error ? <Caption testID={`admin-report-confirm-${action}-error`}>{error}</Caption> : null}
      <View style={[atoms.row, atoms.gap_sm]}>
        <Button
          label={busy ? 'Working…' : 'Confirm'}
          variant="primary"
          disabled={busy || confirmDisabled === true}
          onPress={onConfirm}
          testID={`admin-report-confirm-${action}-yes`}
        />
        <Button
          label="Cancel"
          variant="secondary"
          disabled={busy}
          onPress={onCancel}
          testID={`admin-report-confirm-${action}-no`}
        />
      </View>
    </View>
  )
}

export function AdminReportScreen() {
  const {session, backend} = useActiveBackend()
  const route = useRoute()
  const reportId = (route.params as {id?: string} | undefined)?.id ?? null
  const detail = useAdminReport(session?.id ?? null, reportId)
  const rules = useReportRules(session?.id ?? null)
  const [confirming, setConfirming] = useState<ConfirmAction | null>(null)
  const [writeDenied, setWriteDenied] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [verdict, setVerdict] = useState<ReportResolution | null>(null)
  const [category, setCategory] = useState<ReportCategory | null>(null)
  const [ruleSelection, setRuleSelection] = useState<readonly string[]>([])
  const [noteDraft, setNoteDraft] = useState<string | null>(null)

  const assign = useAssignReport(session?.id ?? null)
  const unassign = useUnassignReport(session?.id ?? null)
  const reopen = useReopenReport(session?.id ?? null)
  const resolve = useResolveReport(session?.id ?? null)
  const recategorize = useRecategorizeReport(session?.id ?? null)
  const updateNote = useUpdateReportNote(session?.id ?? null)
  const forward = useForwardReport(session?.id ?? null)

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="admin-report-screen">
        <Pagehead title="Report" />
        <Body>Sign in to moderate reports.</Body>
        <SignInButton />
      </View>
    )
  }

  const gate = detail.gate
  if (!gate.ok) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="admin-report-screen">
        <Pagehead title="Report" />
        {gate.reason === 'not-staff' ? (
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

  const queue = backend.reportsQueue ?? null
  const report = detail.report.data
  const busy =
    assign.isPending ||
    unassign.isPending ||
    reopen.isPending ||
    resolve.isPending ||
    recategorize.isPending ||
    updateNote.isPending ||
    forward.isPending
  const denyReason = 'Your account may not moderate reports on this server (missing scope or staff role).'
  const isMisskey = backend.family === 'misskey'

  const onMutationError = (e: unknown) => {
    if (isPermissionError(e)) {
      setWriteDenied(true)
      setActionError(denyReason)
    } else {
      setActionError(e instanceof Error ? e.message : 'Could not complete this action.')
    }
  }

  const onMutationSuccess = () => {
    setConfirming(null)
    setActionError(null)
  }

  return (
    <ScrollView style={[atoms.flex1]} testID="admin-report-screen">
      <View style={[atoms.p_md, atoms.gap_md]}>
      <Pagehead title="Report" />
      {detail.report.status === 'loading' || detail.report.status === 'gated' ? (
        <View style={[atoms.centered, atoms.py_sm]}>
          <Loader testID="admin-report-loading" />
        </View>
      ) : detail.report.status === 'denied' ? (
        <Caption color="faint" testID="admin-report-denied">
          Your account may not read this report on this server (missing scope or staff role).
        </Caption>
      ) : detail.report.status === 'absent' || detail.report.status === 'empty' ? (
        <Caption color="faint" testID="admin-report-absent">
          This report is not available. Open it from the queue list.
        </Caption>
      ) : detail.report.status === 'error' ? (
        <View style={[atoms.gap_sm]}>
          <Body>Could not load this report.</Body>
          <Button
            label="Retry"
            variant="secondary"
            onPress={detail.report.retry}
            testID="admin-report-retry"
          />
        </View>
      ) : report ? (
        <View style={[atoms.gap_md]}>
          <View style={[atoms.gap_sm]} testID="admin-report-summary">
            <Heading>
              {reportRowTitle(report)} · {reportStateLabel(report.state)}
            </Heading>
            {report.comment ? <Body>{report.comment}</Body> : null}
            <Caption color="faint">
              {reportCategoryLabel(report.category)}
              {report.forwarded ? ' · forwarded to remote server' : ' · not forwarded'}
            </Caption>
            <Caption color="faint">
              Assignee: {report.assignee ? reportActorLabel(report.assignee) : 'Unassigned'}
            </Caption>
            {report.resolution ? (
              <Caption color="faint">
                Verdict: {reportResolutionLabel(report.resolution)}
                {report.actionTakenBy ? ` by ${reportActorLabel(report.actionTakenBy)}` : ''}
                {report.actionTakenAt ? ` at ${report.actionTakenAt}` : ''}
              </Caption>
            ) : report.actionTakenBy ? (
              <Caption color="faint">
                Action by {reportActorLabel(report.actionTakenBy)}
                {report.actionTakenAt ? ` at ${report.actionTakenAt}` : ''}
              </Caption>
            ) : null}
            {report.moderationNote ? (
              <Caption color="faint" testID="admin-report-note">
                Moderator note: {report.moderationNote}
              </Caption>
            ) : null}
          </View>
          <IdList label="Status ids" ids={report.statusIds} testID="admin-report-status-ids" />
          <IdList label="Rule ids" ids={report.ruleIds} testID="admin-report-rule-ids" />
          {writeDenied ? (
            <Caption color="faint" testID="admin-report-write-denied">
              {denyReason}
            </Caption>
          ) : null}
          <View style={[atoms.gap_sm]} testID="admin-report-actions">
            {typeof queue?.assignToSelf === 'function' ? (
              <Button
                label="Claim for me"
                variant="secondary"
                disabled={busy || writeDenied}
                disabledReason={writeDenied ? denyReason : undefined}
                onPress={() => {
                  setActionError(null)
                  setConfirming('assign')
                }}
                testID="admin-report-assign"
              />
            ) : null}
            {typeof queue?.unassign === 'function' ? (
              <Button
                label="Release claim"
                variant="secondary"
                disabled={busy || writeDenied}
                disabledReason={writeDenied ? denyReason : undefined}
                onPress={() => {
                  setActionError(null)
                  setConfirming('unassign')
                }}
                testID="admin-report-unassign"
              />
            ) : null}
            <Button
              label="Resolve"
              variant="secondary"
              disabled={busy || writeDenied}
              disabledReason={writeDenied ? denyReason : undefined}
              onPress={() => {
                setActionError(null)
                setVerdict(null)
                setConfirming('resolve')
              }}
              testID="admin-report-resolve"
            />
            {typeof queue?.reopen === 'function' ? (
              <Button
                label="Reopen"
                variant="secondary"
                disabled={busy || writeDenied}
                disabledReason={writeDenied ? denyReason : undefined}
                onPress={() => {
                  setActionError(null)
                  setConfirming('reopen')
                }}
                testID="admin-report-reopen"
              />
            ) : null}
            {typeof queue?.recategorize === 'function' ? (
              <Button
                label="Change category"
                variant="secondary"
                disabled={busy || writeDenied}
                disabledReason={writeDenied ? denyReason : undefined}
                onPress={() => {
                  setActionError(null)
                  setCategory(report.category)
                  setRuleSelection(report.ruleIds)
                  setConfirming('recategorize')
                }}
                testID="admin-report-recategorize"
              />
            ) : null}
            {isMisskey ? (
              <View style={[atoms.gap_sm]}>
                <TextInput
                  style={{minHeight: 44}}
                  value={noteDraft ?? report.moderationNote ?? ''}
                  onChangeText={setNoteDraft}
                  placeholder="Moderator note (empty clears it)"
                  editable={!busy}
                  multiline
                  testID="admin-report-note-input"
                />
                <Button
                  label="Save note"
                  variant="secondary"
                  disabled={busy || writeDenied}
                  disabledReason={writeDenied ? denyReason : undefined}
                  onPress={() => {
                    setActionError(null)
                    setConfirming('note')
                  }}
                  testID="admin-report-note-save"
                />
              </View>
            ) : null}
            {typeof queue?.forward === 'function' ? (
              <Button
                label="Forward to remote server"
                variant="secondary"
                disabled={busy || writeDenied || report.forwarded}
                disabledReason={
                  writeDenied ? denyReason : report.forwarded ? 'Already forwarded.' : undefined
                }
                onPress={() => {
                  setActionError(null)
                  setConfirming('forward')
                }}
                testID="admin-report-forward"
              />
            ) : null}
          </View>
          {confirming === 'assign' ? (
            <ConfirmShell
              title="Claim this report for yourself?"
              action="assign"
              busy={assign.isPending}
              error={actionError}
              onCancel={() => setConfirming(null)}
              onConfirm={() =>
                assign.mutate(report.id, {
                  onError: onMutationError,
                  onSuccess: onMutationSuccess,
                })
              }
            />
          ) : null}
          {confirming === 'unassign' ? (
            <ConfirmShell
              title="Release your claim on this report?"
              action="unassign"
              busy={unassign.isPending}
              error={actionError}
              onCancel={() => setConfirming(null)}
              onConfirm={() =>
                unassign.mutate(report.id, {
                  onError: onMutationError,
                  onSuccess: onMutationSuccess,
                })
              }
            />
          ) : null}
          {confirming === 'resolve' ? (
            <ConfirmShell
              title="Resolve this report?"
              action="resolve"
              busy={resolve.isPending}
              error={actionError}
              onCancel={() => setConfirming(null)}
              onConfirm={() =>
                resolve.mutate(
                  {id: report.id, decision: verdict},
                  {onError: onMutationError, onSuccess: onMutationSuccess},
                )
              }>
              {isMisskey ? (
                <View style={[atoms.row, atoms.gap_sm]}>
                  {(['accept', 'reject', null] as const).map(v => (
                    <Button
                      key={String(v)}
                      label={v == null ? 'No verdict' : v === 'accept' ? 'Accept' : 'Reject'}
                      variant={verdict === v ? 'primary' : 'secondary'}
                      onPress={() => setVerdict(v)}
                      testID={`admin-report-verdict-${String(v)}`}
                    />
                  ))}
                </View>
              ) : null}
            </ConfirmShell>
          ) : null}
          {confirming === 'reopen' ? (
            <ConfirmShell
              title="Reopen this resolved report?"
              action="reopen"
              busy={reopen.isPending}
              error={actionError}
              onCancel={() => setConfirming(null)}
              onConfirm={() =>
                reopen.mutate(report.id, {
                  onError: onMutationError,
                  onSuccess: onMutationSuccess,
                })
              }
            />
          ) : null}
          {confirming === 'recategorize' ? (
            <ConfirmShell
              title="Change the category?"
              action="recategorize"
              busy={recategorize.isPending}
              confirmDisabled={
                category === report.category && sameIdSet(ruleSelection, report.ruleIds)
              }
              error={actionError}
              onCancel={() => setConfirming(null)}
              onConfirm={() =>
                recategorize.mutate(
                  {
                    id: report.id,
                    patch: {
                      ...(category != null ? {category} : {}),
                      ruleIds: [...ruleSelection],
                    },
                  },
                  {onError: onMutationError, onSuccess: onMutationSuccess},
                )
              }>
              <View style={[atoms.row, atoms.gap_sm]}>
                {REPORT_CATEGORIES.map(c => (
                  <Button
                    key={c}
                    label={reportCategoryLabel(c)}
                    variant={category === c ? 'primary' : 'secondary'}
                    onPress={() => setCategory(c)}
                    testID={`admin-report-category-${c}`}
                  />
                ))}
              </View>
              {rules.status === 'ready' && rules.rules.length > 0 ? (
                <View style={[atoms.gap_sm]}>
                  {rules.rules.map(r => {
                    const selected = ruleSelection.includes(r.id)
                    return (
                      <Button
                        key={r.id}
                        label={`${selected ? '✓ ' : ''}${r.text}`}
                        variant={selected ? 'primary' : 'secondary'}
                        onPress={() =>
                          setRuleSelection(
                            selected
                              ? ruleSelection.filter(x => x !== r.id)
                              : [...ruleSelection, r.id],
                          )
                        }
                        testID={`admin-report-rule-${r.id}`}
                      />
                    )
                  })}
                </View>
              ) : null}
            </ConfirmShell>
          ) : null}
          {confirming === 'note' ? (
            <ConfirmShell
              title={`Save this moderator note?${(noteDraft ?? report.moderationNote ?? '') === '' ? ' (Empty clears the note.)' : ''}`}
              action="note"
              busy={updateNote.isPending}
              error={actionError}
              onCancel={() => setConfirming(null)}
              onConfirm={() =>
                updateNote.mutate(
                  {id: report.id, note: noteDraft ?? report.moderationNote ?? ''},
                  {onError: onMutationError, onSuccess: onMutationSuccess},
                )
              }
            />
          ) : null}
          {confirming === 'forward' ? (
            <ConfirmShell
              title="Forward this report to the target's home server?"
              action="forward"
              busy={forward.isPending}
              error={actionError}
              onCancel={() => setConfirming(null)}
              onConfirm={() =>
                forward.mutate(report.id, {
                  onError: onMutationError,
                  onSuccess: onMutationSuccess,
                })
              }
            />
          ) : null}
        </View>
      ) : null}
      </View>
    </ScrollView>
  )
}
