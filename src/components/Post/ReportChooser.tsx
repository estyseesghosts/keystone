import {useState} from 'react'
import {StyleSheet, View} from 'react-native'

import {msg} from '@lingui/macro'
import {useLingui} from '@lingui/react'

import {
  REPORT_CATEGORIES,
  type ReportCategory,
  type ServerFamily,
} from '@keystone/fedi'

import {atoms} from '#/alf/atoms'
import {useTheme} from '#/alf/index'
import {radius, space} from '#/alf/tokens'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Divider} from '#/components/Divider'
import {Pressable} from '#/components/Pressable'
import {TextField} from '#/components/forms/TextField'
import type {ReportChooserValues} from '#/components/Post/menuModel'
import {useReportRules} from '#/state/queries/reports'
import {reportPrefsStore, useLastReportCategory} from '#/state/reportPrefs'

// Report chooser (clickstone §1.5): category, the server's published rules
// when it has any, forwarding for a remote account, and an optional
// comment. Replaces the single required-comment dialog that made every
// report useless to a moderator.
//
// Honesty rules:
// - Mastodon-family only fields (category/rules/forward) are never shown on
//   Misskey; the Misskey sheet says the comment IS the report. The backend
//   still reports those fields as unsupported if a caller passes them.
// - Rules come from `GET /api/v1/instance/rules`. 404/405 (Akkoma, forks
//   without the endpoint) hides the step and shows the reason; it is not an
//   error and never blocks the report.
// - The required reason survives where the server requires it: Misskey's
//   `users/report-abuse` rejects an empty comment, so Send stays disabled
//   with that reason.

const CATEGORY_MESSAGES: Record<
  ReportCategory,
  {label: ReturnType<typeof msg>; hint: ReturnType<typeof msg>}
> = {
  spam: {label: msg`Spam`, hint: msg`Malicious links, fake engagement, or repetitive replies`},
  legal: {label: msg`Illegal content`, hint: msg`You believe it breaks the law`},
  violation: {label: msg`Violates server rules`, hint: msg`You are aware it breaks specific rules`},
  other: {label: msg`Something else`, hint: msg`The issue does not fit another category`},
}

export function ReportChooser({
  title,
  action,
  family,
  remoteHost,
  sessionId,
  onSubmit,
  onCancel,
}: {
  title: string
  action: string
  family: ServerFamily
  remoteHost: string | null
  sessionId: string | null
  onSubmit: (values: ReportChooserValues) => void
  onCancel: () => void
}) {
  const {i18n} = useLingui()
  const theme = useTheme()
  const lastCategory = useLastReportCategory()
  const [category, setCategory] = useState<ReportCategory>(lastCategory ?? 'other')
  const [ruleIds, setRuleIds] = useState<string[]>([])
  const [forward, setForward] = useState(false)
  const [comment, setComment] = useState('')
  const rules = useReportRules(family === 'mastodon' ? sessionId : null)
  // Category/rules/forward are Mastodon-family fields. Misskey's report is
  // one message; showing the controls would pretend otherwise.
  const richChooser = family === 'mastodon'
  const hasRules = richChooser && rules.status === 'ready'
  const showForward = richChooser && remoteHost !== null
  const rulesReason = rulesReasonFor(rules.status, i18n)

  const toggleRule = (id: string) => {
    setRuleIds(ids => {
      const next = ids.includes(id) ? ids.filter(x => x !== id) : [...ids, id]
      // The server forces category `violation` when rule_ids is present
      // (`ReportService#call`); reflect that here so the wire and the label
      // never disagree.
      if (next.length > 0) setCategory('violation')
      return next
    })
  }

  const missingReason = !richChooser && comment.trim() === ''
  const submit = () => {
    reportPrefsStore.set(category)
    onSubmit({comment: comment.trim(), category, ruleIds, forward: showForward && forward})
  }

  return (
    <View style={[atoms.gap_sm]} testID="report-chooser">
      <Body>{title}</Body>

      {richChooser ? (
        <>
          <Caption color="faint">{i18n._(msg`Why are you reporting this?`)}</Caption>
          <View style={atoms.gap_sm}>
            {REPORT_CATEGORIES.map(key => (
              <Pressable
                key={key}
                testID={`report-category-${key}`}
                accessibilityRole="radio"
                accessibilityState={{checked: category === key}}
                accessibilityLabel={i18n._(CATEGORY_MESSAGES[key].label)}
                onPress={() => setCategory(key)}
                style={[
                  styles.option,
                  {borderColor: category === key ? theme.palette.text : theme.palette.edge},
                ]}>
                <Body>{i18n._(CATEGORY_MESSAGES[key].label)}</Body>
                <Caption color="faint">{i18n._(CATEGORY_MESSAGES[key].hint)}</Caption>
              </Pressable>
            ))}
          </View>

          {hasRules ? (
            <>
              <Divider />
              <Caption color="faint">{i18n._(msg`Which rules are being violated? Optional`)}</Caption>
              <View style={atoms.gap_sm}>
                {rules.rules.map(rule => (
                  <Pressable
                    key={rule.id}
                    testID={`report-rule-${rule.id}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{checked: ruleIds.includes(rule.id)}}
                    accessibilityLabel={rule.text}
                    onPress={() => toggleRule(rule.id)}
                    style={[
                      styles.option,
                      {borderColor: ruleIds.includes(rule.id) ? theme.palette.text : theme.palette.edge},
                    ]}>
                    <Body>{rule.text}</Body>
                  </Pressable>
                ))}
              </View>
            </>
          ) : rulesReason ? (
            <Caption color="faint" testID="report-rules-reason">
              {rulesReason}
            </Caption>
          ) : null}

          {showForward ? (
            <Pressable
              testID="report-forward"
              accessibilityRole="switch"
              accessibilityState={{checked: forward}}
              accessibilityLabel={i18n._(msg`Forward to ${remoteHost}`)}
              onPress={() => setForward(v => !v)}
              style={styles.row}>
              <Body>{forward ? i18n._(msg`Forward to ${remoteHost}: on`) : i18n._(msg`Forward to ${remoteHost}: off`)}</Body>
              <Caption color="faint">
                {i18n._(msg`Send an anonymized copy of this report to that server's moderators as well.`)}
              </Caption>
            </Pressable>
          ) : null}

          <Divider />
          <TextField
            label={i18n._(msg`Reason (optional)`)}
            value={comment}
            onChangeText={setComment}
            testID="report-comment"
          />
        </>
      ) : (
        <>
          <Caption color="faint">
            {i18n._(msg`Your comment is the whole report on this server — categories, rules, post selection and forwarding are Mastodon-only.`)}
          </Caption>
          <TextField
            label={i18n._(msg`Reason`)}
            value={comment}
            onChangeText={setComment}
            testID="report-comment"
          />
        </>
      )}

      <Button
        testID="report-submit"
        label={action}
        variant="secondary"
        disabled={missingReason}
        disabledReason={missingReason ? i18n._(msg`Add a reason for the report.`) : undefined}
        onPress={submit}
      />
      <Button
        testID="report-cancel"
        label={i18n._(msg`Cancel`)}
        variant="secondary"
        onPress={onCancel}
      />
    </View>
  )
}

function rulesReasonFor(
  status: ReturnType<typeof useReportRules>['status'],
  i18n: ReturnType<typeof useLingui>['i18n'],
): string | null {
  switch (status) {
    case 'loading':
      return i18n._(msg`Loading this server's rules…`)
    case 'absent':
      return i18n._(msg`This server does not publish a list of rules.`)
    case 'empty':
      return i18n._(msg`This server lists no rules.`)
    case 'error':
      return i18n._(msg`This server's rules could not be loaded. You can still send the report.`)
    case 'unavailable':
      return i18n._(msg`Sign in to load this server's rules.`)
    default:
      return null
  }
}

const styles = StyleSheet.create({
  option: {
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
  row: {
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    minHeight: 44,
    justifyContent: 'center',
  },
})
