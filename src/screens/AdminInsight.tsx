// Server insight (`/admin/insight`, Wave 3 slice 3.1): the ONE read-only
// admin screen. NO mutations anywhere on this screen — no confirm paths to
// build, no optimistic updates, no authoring controls.
//
// Two families (clickstone §3.1):
// - Mastodon family: staff metrics (measures/dimensions, admin:read + a
//   staff role) + public server info (rules, peers, extended description,
//   activity) as the non-admin fallback.
// - Misskey family: `admin/server-info` + `admin/meta` + `admin/queue/
//   stats` (moderator role + the matching `read:admin:*` grants;
//   `admin/meta` additionally needs the admin role) + the public online
//   count. A moderator without the admin role still renders everything
//   except the instance-settings section.
// A 403 on any section disables THAT section with a reason — it never
// clears the session. A 404 (forks without the endpoints) renders the
// honest absent reason.
//
// Every section degrades independently with retry; nothing here shows
// sample data when signed out, and an unknown fork gets the same honest
// unavailable state as a server without the endpoints.

import {useMemo} from 'react'
import {RefreshControl, ScrollView, View} from 'react-native'

import {
  contentFromHtml,
  type AdminDimension,
  type AdminMeasure,
  type InstanceActivityWeek,
  type MisskeyInstanceMeta,
  type MisskeyQueueCounts,
  type MisskeyQueueStats,
  type MisskeyServerInfo,
} from '@keystone/fedi'

import {useTheme} from '#/alf'
import {atoms} from '#/alf/atoms'
import {Body, Caption, Heading} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Loader} from '#/components/Loader'
import {Pagehead} from '#/components/Pagehead'
import {RichText} from '#/components/RichText'
import {SignInButton} from '#/components/SignInButton'
import {useActiveBackend} from '#/screens/HomeFeed'
import {useReportRules} from '#/state/queries/reports'
import {
  useAdminInsight,
  type AdminSection,
  type AdminSectionStatus,
} from '#/state/queries/adminInsight'

const MEASURE_LABELS: Record<string, string> = {
  active_users: 'Active users',
  new_users: 'New users',
  instance_accounts: 'Local accounts',
  instance_statuses: 'Local posts',
  opened_reports: 'Open reports',
  resolved_reports: 'Resolved reports',
}

const DIMENSION_LABELS: Record<string, string> = {
  sources: 'Posting apps',
  servers: 'Remote servers',
  languages: 'Languages',
  space_usage: 'Storage use',
}

/** Display label for a measure/dimension key (unknown keys render as-is —
 * never hidden, never guessed). Pure. */
export function insightKeyLabel(kind: 'measure' | 'dimension', key: string): string {
  const table = kind === 'measure' ? MEASURE_LABELS : DIMENSION_LABELS
  return table[key] ?? key
}

/** Byte counts the Misskey hardware snapshot reports, rendered as
 * GiB/MiB/KiB with one decimal (1024-based, matching the OS tools the
 * numbers come from). Non-finite or negative input reads '—', never a
 * fabricated zero. Pure. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

/** One queue counter for the queue-stats rows: the server's number, or
 * '—' when the server did not report it (null is "not reported", never
 * zero — zero is a real measurement). Pure. */
export function queueCountDisplay(value: number | null): string {
  return value == null ? '—' : String(value)
}

/** The number the screen shows for a measure: the server's human value
 * when it sent one, else the raw total. Pure. */
export function measureDisplayValue(measure: AdminMeasure): string {
  return measure.humanValue ?? measure.total
}

/** Peer domains to render: the first `limit`, plus how many remain hidden
 * behind the count (a peer list can be thousands long — truncating with
 * an honest count is not fake data). Pure. */
export function visiblePeers(peers: readonly string[], limit = 20): {
  shown: string[]
  remaining: number
} {
  return {shown: peers.slice(0, limit), remaining: Math.max(0, peers.length - limit)}
}

function SectionShell({
  title,
  testID,
  children,
}: {
  title: string
  testID: string
  children: React.ReactNode
}) {
  return (
    <View style={[atoms.gap_sm, atoms.py_sm]} testID={testID}>
      <Heading>{title}</Heading>
      {children}
    </View>
  )
}

function SectionState({
  status,
  error,
  retry,
  testID,
  deniedReason,
  absentReason,
}: {
  status: AdminSectionStatus
  error: unknown
  retry: () => void
  testID: string
  deniedReason: string
  absentReason: string
}) {
  if (status === 'loading' || status === 'gated') {
    return (
      <View style={[atoms.centered, atoms.py_sm]}>
        <Loader testID={`${testID}-loading`} />
      </View>
    )
  }
  if (status === 'denied') {
    return (
      <Caption color="faint" testID={`${testID}-denied`}>
        {deniedReason}
      </Caption>
    )
  }
  if (status === 'absent' || status === 'empty') {
    return (
      <Caption color="faint" testID={`${testID}-absent`}>
        {absentReason}
      </Caption>
    )
  }
  if (status === 'error') {
    return (
      <View style={[atoms.gap_sm]}>
        <Body>Could not load this section.</Body>
        {error instanceof Error && error.message ? (
          <Caption color="faint">{error.message}</Caption>
        ) : null}
        <Button
          label="Retry"
          variant="secondary"
          onPress={retry}
          testID={`${testID}-retry`}
        />
      </View>
    )
  }
  return null
}

function MeasuresSection({section}: {section: AdminSection<AdminMeasure[]>}) {
  if (section.status !== 'ready' || !section.data) {
    return (
      <SectionState
        status={section.status}
        error={section.error}
        retry={section.retry}
        testID="admin-insight-measures"
        deniedReason="Your account may not read admin metrics on this server (missing scope or staff role)."
        absentReason="This server does not provide admin metrics."
      />
    )
  }
  return (
    <View style={[atoms.gap_sm]} testID="admin-insight-measures">
      {section.data.map(m => (
        <View key={m.key} testID={`admin-insight-measure-${m.key}`}>
          <Body>{insightKeyLabel('measure', m.key)}</Body>
          <Caption color="faint">
            {measureDisplayValue(m)}
            {m.previousTotal ? ` (was ${m.previousTotal})` : ''}
          </Caption>
        </View>
      ))}
    </View>
  )
}

function DimensionsSection({section}: {section: AdminSection<AdminDimension[]>}) {
  if (section.status !== 'ready' || !section.data) {
    return (
      <SectionState
        status={section.status}
        error={section.error}
        retry={section.retry}
        testID="admin-insight-dimensions"
        deniedReason="Your account may not read admin breakdowns on this server."
        absentReason="This server does not provide admin breakdowns."
      />
    )
  }
  return (
    <View style={[atoms.gap_sm]} testID="admin-insight-dimensions">
      {section.data.map(d => (
        <View key={d.key} testID={`admin-insight-dimension-${d.key}`}>
          <Body>{insightKeyLabel('dimension', d.key)}</Body>
          {d.rows.slice(0, 8).map(r => (
            <Caption key={r.key} color="faint">
              {r.label ?? r.key}: {r.value}
            </Caption>
          ))}
        </View>
      ))}
    </View>
  )
}

function PeersSection({section}: {section: AdminSection<string[]>}) {
  if (section.status !== 'ready' || !section.data) {
    return (
      <SectionState
        status={section.status}
        error={section.error}
        retry={section.retry}
        testID="admin-insight-peers"
        deniedReason="Your account may not read the peer list on this server."
        absentReason="This server does not publish its peer list."
      />
    )
  }
  const {shown, remaining} = visiblePeers(section.data)
  return (
    <View style={[atoms.gap_sm]} testID="admin-insight-peers">
      <Caption color="faint">
        {section.data.length} peered {section.data.length === 1 ? 'domain' : 'domains'}
        {remaining > 0 ? ` (showing ${shown.length})` : ''}
      </Caption>
      {shown.map(domain => (
        <Caption key={domain}>{domain}</Caption>
      ))}
    </View>
  )
}

function DescriptionSection({
  section,
}: {
  section: AdminSection<{updatedAt: string | null; html: string}>
}) {
  if (section.status !== 'ready' || !section.data) {
    return (
      <SectionState
        status={section.status}
        error={section.error}
        retry={section.retry}
        testID="admin-insight-description"
        deniedReason="Your account may not read the extended description on this server."
        absentReason="This server publishes no extended description."
      />
    )
  }
  const nodes = useMemo(
    () => (section.data?.html ? contentFromHtml(section.data.html) : []),
    [section.data],
  )
  return (
    <View style={[atoms.gap_sm]} testID="admin-insight-description">
      {section.data.updatedAt ? (
        <Caption color="faint">Updated {section.data.updatedAt}</Caption>
      ) : null}
      {nodes.length > 0 ? <RichText nodes={nodes} /> : null}
    </View>
  )
}

function ActivitySection({section}: {section: AdminSection<InstanceActivityWeek[]>}) {
  if (section.status !== 'ready' || !section.data) {
    return (
      <SectionState
        status={section.status}
        error={section.error}
        retry={section.retry}
        testID="admin-insight-activity"
        deniedReason="Your account may not read server activity on this server."
        absentReason="This server publishes no activity counters."
      />
    )
  }
  return (
    <View style={[atoms.gap_sm]} testID="admin-insight-activity">
      {section.data.slice(0, 4).map(w => (
        <Caption key={w.week} color="faint">
          Week {w.week}: {w.statuses ?? '—'} posts
          {w.logins != null ? `, ${w.logins} logins` : ''}
          {w.registrations != null ? `, ${w.registrations} sign-ups` : ''}
        </Caption>
      ))}
    </View>
  )
}

function MisskeyServerInfoSection({
  section,
}: {
  section: AdminSection<MisskeyServerInfo> | null
}) {
  if (!section) return null
  if (section.status !== 'ready' || !section.data) {
    return (
      <SectionState
        status={section.status}
        error={section.error}
        retry={section.retry}
        testID="admin-insight-server-info"
        deniedReason="Your account may not read server hardware on this server (missing scope or staff role)."
        absentReason="This server does not provide a hardware snapshot."
      />
    )
  }
  const info = section.data
  return (
    <View style={[atoms.gap_sm]} testID="admin-insight-server-info">
      <Caption color="faint">Machine {info.machine || '—'}</Caption>
      <Caption color="faint">OS {info.os || '—'}</Caption>
      <Caption color="faint">Node {info.node || '—'}</Caption>
      <Caption color="faint">PostgreSQL {info.psql || '—'}</Caption>
      <Caption color="faint">
        CPU {info.cpu.model || '—'} × {info.cpu.cores}
      </Caption>
      <Caption color="faint">Memory {formatBytes(info.memTotal)}</Caption>
      <Caption color="faint">
        Disk {formatBytes(info.fsUsed)} of {formatBytes(info.fsTotal)}
      </Caption>
    </View>
  )
}

function MisskeyInstanceMetaSection({
  section,
}: {
  section: AdminSection<MisskeyInstanceMeta> | null
}) {
  if (!section) return null
  if (section.status !== 'ready' || !section.data) {
    return (
      <SectionState
        status={section.status}
        error={section.error}
        retry={section.retry}
        testID="admin-insight-instance-meta"
        deniedReason="Instance settings need an admin account on this server."
        absentReason="This server does not provide instance settings."
      />
    )
  }
  const meta = section.data
  return (
    <View style={[atoms.gap_sm]} testID="admin-insight-instance-meta">
      {meta.name ? <Body>{meta.name}</Body> : null}
      {meta.description ? <Caption color="faint">{meta.description}</Caption> : null}
      <Caption color="faint">Version {meta.version || '—'}</Caption>
      {meta.uri ? <Caption color="faint">{meta.uri}</Caption> : null}
      {meta.maintainerName ? (
        <Caption color="faint">Maintainer {meta.maintainerName}</Caption>
      ) : null}
      <Caption color="faint">
        Registration {meta.disableRegistration ? 'closed' : 'open'}
        {meta.emailRequiredForSignup ? ' (email required)' : ''}
      </Caption>
    </View>
  )
}

function MisskeyQueueStatsSection({
  section,
}: {
  section: AdminSection<MisskeyQueueStats> | null
}) {
  if (!section) return null
  if (section.status !== 'ready' || !section.data) {
    return (
      <SectionState
        status={section.status}
        error={section.error}
        retry={section.retry}
        testID="admin-insight-queue-stats"
        deniedReason="Your account may not read queue stats on this server (missing scope or staff role)."
        absentReason="This server does not provide queue stats."
      />
    )
  }
  const queues: Array<[string, MisskeyQueueCounts]> = [
    ['deliver', section.data.deliver],
    ['inbox', section.data.inbox],
    ['db', section.data.db],
    ['object storage', section.data.objectStorage],
  ]
  return (
    <View style={[atoms.gap_sm]} testID="admin-insight-queue-stats">
      {queues.map(([name, counts]) => (
        <View key={name} testID={`admin-insight-queue-${name.replace(/ /g, '-')}`}>
          <Body>{name}</Body>
          <Caption color="faint">
            {queueCountDisplay(counts.active)} active ·{' '}
            {queueCountDisplay(counts.waiting)} waiting ·{' '}
            {queueCountDisplay(counts.delayed)} delayed ·{' '}
            {queueCountDisplay(counts.failed)} failed
          </Caption>
        </View>
      ))}
    </View>
  )
}

function MisskeyOnlineCountSection({
  section,
}: {
  section: AdminSection<number> | null
}) {
  if (!section) return null
  if (section.status !== 'ready' || section.data == null) {
    return (
      <SectionState
        status={section.status}
        error={section.error}
        retry={section.retry}
        testID="admin-insight-online-count"
        deniedReason="Your account may not read the online count on this server."
        absentReason="This server does not publish an online count."
      />
    )
  }
  return (
    <View style={[atoms.gap_sm]} testID="admin-insight-online-count">
      <Body>
        {section.data} {section.data === 1 ? 'user' : 'users'} online now
      </Body>
    </View>
  )
}

export function AdminInsightScreen() {
  const theme = useTheme()
  const {session, backend} = useActiveBackend()
  const insight = useAdminInsight(session?.id ?? null)
  const rules = useReportRules(session?.id ?? null)

  if (!session || !backend) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="admin-insight-screen">
        <Pagehead title="Server insight" />
        <Body>Sign in to read server insight.</Body>
        <Caption color="faint">Server insight never shows sample data when signed out.</Caption>
        <SignInButton />
      </View>
    )
  }

  if (!insight.gate.ok) {
    return (
      <View style={[atoms.flex1, atoms.centered, atoms.p_md]} testID="admin-insight-screen">
        <Pagehead title="Server insight" />
        {insight.gate.reason === 'not-staff' ? (
          <>
            <Body>Requires an admin or moderator account.</Body>
            <Caption color="faint">
              This server reports your account as neither admin nor moderator.
            </Caption>
          </>
        ) : (
          <>
            <Body>Server insight is not available on this server.</Body>
            <Caption color="faint">
              Keystone reads Mastodon- and Misskey-family insight endpoints only.
            </Caption>
          </>
        )}
      </View>
    )
  }

  const isMisskey = backend.family === 'misskey'
  const refreshing =
    insight.measures.status === 'loading' ||
    insight.dimensions.status === 'loading' ||
    insight.peers.status === 'loading' ||
    insight.serverInfo?.status === 'loading' ||
    insight.queueStats?.status === 'loading'
  const refresh = () => {
    insight.measures.retry()
    insight.dimensions.retry()
    insight.peers.retry()
    insight.extendedDescription.retry()
    insight.activity.retry()
    insight.serverInfo?.retry()
    insight.instanceMeta?.retry()
    insight.queueStats?.retry()
    insight.onlineUsersCount?.retry()
  }

  return (
    <ScrollView
      style={atoms.flex1}
      testID="admin-insight-screen"
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={refresh}
          testID="admin-insight-refresh"
          tintColor={theme.palette.muted}
          colors={[theme.palette.muted]}
          progressBackgroundColor={theme.palette.bg}
        />
      }>
      <View style={[atoms.p_md, atoms.gap_md]}>
        <Pagehead title="Server insight" />
        {isMisskey ? (
          <>
            <SectionShell title="Server" testID="admin-insight-section-server-hw">
              <MisskeyServerInfoSection section={insight.serverInfo} />
              <MisskeyOnlineCountSection section={insight.onlineUsersCount} />
            </SectionShell>
            <SectionShell title="Instance" testID="admin-insight-section-instance">
              <MisskeyInstanceMetaSection section={insight.instanceMeta} />
            </SectionShell>
            <SectionShell title="Queues" testID="admin-insight-section-queues">
              <MisskeyQueueStatsSection section={insight.queueStats} />
            </SectionShell>
          </>
        ) : (
          <>
            <SectionShell title="Metrics" testID="admin-insight-section-metrics">
              <MeasuresSection section={insight.measures} />
              <DimensionsSection section={insight.dimensions} />
            </SectionShell>
            <SectionShell title="Server info" testID="admin-insight-section-server">
              <PeersSection section={insight.peers} />
              <DescriptionSection section={insight.extendedDescription} />
              <ActivitySection section={insight.activity} />
            </SectionShell>
          </>
        )}
        <SectionShell title="Server rules" testID="admin-insight-section-rules">
          {rules.status === 'ready' ? (
            <View style={[atoms.gap_sm]} testID="admin-insight-rules">
              {rules.rules.map(r => (
                <Caption key={r.id}>{r.text}</Caption>
              ))}
            </View>
          ) : rules.status === 'loading' ? (
            <Loader testID="admin-insight-rules-loading" />
          ) : (
            <Caption color="faint" testID="admin-insight-rules-absent">
              This server publishes no rule list.
            </Caption>
          )}
        </SectionShell>
      </View>
    </ScrollView>
  )
}
