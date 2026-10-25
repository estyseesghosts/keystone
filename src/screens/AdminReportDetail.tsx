// Report detail (D3.7 split of `src/screens/AdminReports.tsx`): one
// report with confirm-gated mutations (confirm + refetch; optimistic
// updates are forbidden here). A 403 on a mutation disables the write
// actions with a reason — it never clears the session.
// Moderation-log/history entries are display-only where the API carries
// them (action outcome on Mastodon rows, resolution + note on Misskey
// rows); neither family's API exposes a per-report history endpoint
// (verified — web-admin-only), so none is rendered.
//
// The seven `ConfirmShell` branches stay explicit (not table-driven):
// each action carries distinct children (verdict picker, category + rule
// pickers, dynamic note title) and a distinct mutation, so a table would
// hide the confirm copy the slice forbids changing.

import {useState} from 'react'
import {ScrollView, TextInput, View} from 'react-native'
import {useRoute} from '@react-navigation/native'
import {msg, plural} from '@lingui/macro'

import {
  REPORT_CATEGORIES,
  isPermissionError,
  type ReportCategory,
  type ReportResolution,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {Body, Caption, Heading} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {Pagehead} from '#/components/Pagehead'
import {SignInButton} from '#/components/SignInButton'
import {errorText} from '#/lib/localeErrors'
import {i18n} from '#/locale/i18n'
import {useActiveBackend} from '#/screens/HomeFeed'
import {useReportRules} from '#/state/queries/reports'
import {
  useAdminReport,
  useAssignReport,
  useForwardReport,
  useRecategorizeReport,
  useReopenReport,
  useResolveReport,
  useUnassignReport,
  useUpdateReportNote,
} from '#/state/queries/adminReports'

import {
  reportActorLabel,
  reportCategoryLabel,
  reportResolutionLabel,
  reportRowTitle,
  reportStateLabel,
  sameIdSet,
} from './AdminReportsList'

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
      {ids.length > 10 ? (
        <Caption color="faint">
          {i18n._(plural(ids.length - 10, {one: '+# more', other: '+# more'}))}
        </Caption>
      ) : null}
    </View>
  )
}

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
          label={busy ? i18n._(msg`Working…`) : i18n._(msg`Confirm`)}
          variant="primary"
          disabled={busy || confirmDisabled === true}
          onPress={onConfirm}
          testID={`admin-report-confirm-${action}-yes`}
        />
        <Button
          label={i18n._(msg`Cancel`)}
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
        <Pagehead title={i18n._(msg`Report`)} />
        <Body>{i18n._(msg`Sign in to moderate reports.`)}</Body>
        <SignInButton />
      </View>
    )
  }

  const gate = detail.gate
  if (!gate.ok) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="admin-report-screen">
        <Pagehead title={i18n._(msg`Report`)} />
        {gate.reason === 'not-staff' ? (
          <>
            <Body>{i18n._(msg`Requires an admin or moderator account.`)}</Body>
            <Caption color="faint">
              {i18n._(msg`This server reports your account as neither admin nor moderator.`)}
            </Caption>
          </>
        ) : (
          <>
            <Body>{i18n._(msg`Reports are not available on this server.`)}</Body>
            <Caption color="faint">
              {i18n._(msg`Keystone reads Mastodon- and Misskey-family report queues only.`)}
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
  const denyReason = i18n._(
    msg`Your account may not moderate reports on this server (missing scope or staff role).`,
  )
  const isMisskey = backend.family === 'misskey'

  const onMutationError = (e: unknown) => {
    if (isPermissionError(e)) {
      setWriteDenied(true)
      setActionError(denyReason)
    } else {
      setActionError(
        errorText(i18n, e, i18n._(msg`Could not complete this action.`))
      )
    }
  }

  const onMutationSuccess = () => {
    setConfirming(null)
    setActionError(null)
  }

  return (
    <ScrollView style={[atoms.flex1]} testID="admin-report-screen">
      <View style={[atoms.p_md, atoms.gap_md]}>
      <Pagehead title={i18n._(msg`Report`)} />
      {detail.report.status === 'loading' || detail.report.status === 'gated' ? (
        <View style={[atoms.centered, atoms.py_sm]}>
          <Loader testID="admin-report-loading" />
        </View>
      ) : detail.report.status === 'denied' ? (
        <Caption color="faint" testID="admin-report-denied">
          {i18n._(
            msg`Your account may not read this report on this server (missing scope or staff role).`,
          )}
        </Caption>
      ) : detail.report.status === 'absent' || detail.report.status === 'empty' ? (
        <Caption color="faint" testID="admin-report-absent">
          {i18n._(msg`This report is not available. Open it from the queue list.`)}
        </Caption>
      ) : detail.report.status === 'error' ? (
        <View style={[atoms.gap_sm]}>
          <Body>{i18n._(msg`Could not load this report.`)}</Body>
          <Button
            label={i18n._(msg`Retry`)}
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
              {report.forwarded
                ? i18n._(
                    msg`${reportCategoryLabel(report.category)} · forwarded to remote server`,
                  )
                : i18n._(msg`${reportCategoryLabel(report.category)} · not forwarded`)}
            </Caption>
            <Caption color="faint">
              {report.assignee
                ? i18n._(msg`Assignee: ${reportActorLabel(report.assignee)}`)
                : i18n._(msg`Assignee: Unassigned`)}
            </Caption>
            {report.resolution ? (
              <Caption color="faint">
                {i18n._(
                  msg`Verdict: ${reportResolutionLabel(report.resolution)}${report.actionTakenBy ? ` by ${reportActorLabel(report.actionTakenBy)}` : ''}${report.actionTakenAt ? ` at ${report.actionTakenAt}` : ''}`,
                )}
              </Caption>
            ) : report.actionTakenBy ? (
              <Caption color="faint">
                {i18n._(
                  msg`Action by ${reportActorLabel(report.actionTakenBy)}${report.actionTakenAt ? ` at ${report.actionTakenAt}` : ''}`,
                )}
              </Caption>
            ) : null}
            {report.moderationNote ? (
              <Caption color="faint" testID="admin-report-note">
                {i18n._(msg`Moderator note: ${report.moderationNote}`)}
              </Caption>
            ) : null}
          </View>
          <IdList
            label={i18n._(msg`Status ids`)}
            ids={report.statusIds}
            testID="admin-report-status-ids"
          />
          <IdList
            label={i18n._(msg`Rule ids`)}
            ids={report.ruleIds}
            testID="admin-report-rule-ids"
          />
          {writeDenied ? (
            <Caption color="faint" testID="admin-report-write-denied">
              {denyReason}
            </Caption>
          ) : null}
          <View style={[atoms.gap_sm]} testID="admin-report-actions">
            {typeof queue?.assignToSelf === 'function' ? (
              <Button
                label={i18n._(msg`Claim for me`)}
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
                label={i18n._(msg`Release claim`)}
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
              label={i18n._(msg`Resolve`)}
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
                label={i18n._(msg`Reopen`)}
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
                label={i18n._(msg`Change category`)}
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
                  placeholder={i18n._(msg`Moderator note (empty clears it)`)}
                  editable={!busy}
                  multiline
                  testID="admin-report-note-input"
                />
                <Button
                  label={i18n._(msg`Save note`)}
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
                label={i18n._(msg`Forward to remote server`)}
                variant="secondary"
                disabled={busy || writeDenied || report.forwarded}
                disabledReason={
                  writeDenied
                    ? denyReason
                    : report.forwarded
                      ? i18n._(msg`Already forwarded.`)
                      : undefined
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
              title={i18n._(msg`Claim this report for yourself?`)}
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
              title={i18n._(msg`Release your claim on this report?`)}
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
              title={i18n._(msg`Resolve this report?`)}
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
                      label={
                        v == null
                          ? reportResolutionLabel(null)
                          : v === 'accept'
                            ? i18n._(msg`Accept`)
                            : i18n._(msg`Reject`)
                      }
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
              title={i18n._(msg`Reopen this resolved report?`)}
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
              title={i18n._(msg`Change the category?`)}
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
              title={
                (noteDraft ?? report.moderationNote ?? '') === ''
                  ? i18n._(msg`Save this moderator note? (Empty clears the note.)`)
                  : i18n._(msg`Save this moderator note?`)
              }
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
              title={i18n._(msg`Forward this report to the target's home server?`)}
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
