import {msg} from '@lingui/macro'

import {Body} from '#/alf/typography'
import {Button} from '#/components/Button'
import {Dialog} from '#/components/Dialog'
import {i18n} from '#/locale/i18n'

// Close-guard confirm (composer slice 2): Save / Discard / Keep writing.
// Rendered through the shared `Dialog` primitive — the composer already
// uses it (emoji picker), so no new modal style. The sheet itself is the
// discard confirm: no second confirm. Backdrop tap, Escape, and ✕ all
// dismiss = Keep writing (the draft is untouched).
export function CloseConfirmDialog({
  onSave,
  onDiscard,
  onKeep,
}: {
  onSave: () => void
  onDiscard: () => void
  onKeep: () => void
}) {
  return (
    <Dialog open onClose={onKeep} title={i18n._(msg`Unsaved draft`)} testID="composer-close-confirm">
      <Body>{i18n._(msg`Save this draft to finish it later, or discard it.`)}</Body>
      <Button label={i18n._(msg`Save draft`)} onPress={onSave} testID="composer-close-save" />
      <Button
        label={i18n._(msg`Discard`)}
        variant="secondary"
        onPress={onDiscard}
        testID="composer-close-discard"
      />
      <Button
        label={i18n._(msg`Keep writing`)}
        variant="secondary"
        onPress={onKeep}
        testID="composer-close-keep"
      />
    </Dialog>
  )
}
