// Drive upload panel (D3.7 split of `src/screens/Drive.tsx`): the staged
// file picker + comment + upload states. Moved verbatim.

import {View} from 'react-native'

import {msg} from '@lingui/macro'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {TextField} from '#/components/forms/TextField'
import type {UploadableFile} from '#/state/queries/composer'
import {i18n} from '#/locale/i18n'

export function UploadPanel({
  targetLabel,
  staged,
  comment,
  uploading,
  error,
  success,
  onChoose,
  onCommentChange,
  onUpload,
  onCancel,
}: {
  targetLabel: string
  staged: UploadableFile | null
  comment: string
  uploading: boolean
  error: string | null
  success: string | null
  onChoose: () => void
  onCommentChange: (value: string) => void
  onUpload: () => void
  onCancel: () => void
}) {
  return (
    <View style={[atoms.px_md, atoms.py_sm, atoms.gap_sm]} testID="drive-upload">
      <Caption color="faint">{targetLabel}</Caption>
      {staged ? (
        <View style={[atoms.gap_sm]}>
          <Body>{staged.name}</Body>
          <TextField
            label={i18n._(msg({message: 'Description (optional)', context: 'drive upload comment input'}))}
            value={comment}
            onChangeText={onCommentChange}
            placeholder={i18n._(msg({message: 'Alt text or caption', context: 'drive upload comment input'}))}
            testID="drive-upload-comment"
          />
          <View style={[atoms.row, atoms.gap_sm]}>
            <Button
              label={
                uploading
                  ? i18n._(msg({message: 'Uploading…', context: 'button'}))
                  : i18n._(msg({message: 'Upload', context: 'button'}))
              }
              variant="primary"
              disabled={uploading}
              onPress={onUpload}
              testID="drive-upload-submit"
            />
            <Button
              label={i18n._(msg({message: 'Cancel', context: 'button'}))}
              variant="secondary"
              disabled={uploading}
              onPress={onCancel}
              testID="drive-upload-cancel"
            />
          </View>
          {uploading ? (
            <Caption color="faint" testID="drive-upload-progress">
              {i18n._(msg`Uploading “${staged.name}”…`)}
            </Caption>
          ) : null}
        </View>
      ) : (
        <Button
          label={i18n._(msg({message: 'Choose file', context: 'button'}))}
          variant="secondary"
          disabled={uploading}
          onPress={onChoose}
          testID="drive-upload-choose"
        />
      )}
      {error ? (
        <Caption color="faint" testID="drive-upload-error">
          {error}
        </Caption>
      ) : null}
      {success ? (
        <Caption color="faint" testID="drive-upload-success">
          {success}
        </Caption>
      ) : null}
    </View>
  )
}
