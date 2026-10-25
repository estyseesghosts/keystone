// Drive upload panel (D3.7 split of `src/screens/Drive.tsx`): the staged
// file picker + comment + upload states. Moved verbatim.

import {View} from 'react-native'

import {atoms} from '#/alf/atoms'
import {Body, Caption} from '#/alf/typography'
import {Button} from '#/components/Button'
import {TextField} from '#/components/forms/TextField'
import type {UploadableFile} from '#/state/queries/composer'

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
            label="Description (optional)"
            value={comment}
            onChangeText={onCommentChange}
            placeholder="Alt text or caption"
            testID="drive-upload-comment"
          />
          <View style={[atoms.row, atoms.gap_sm]}>
            <Button
              label={uploading ? 'Uploading…' : 'Upload'}
              variant="primary"
              disabled={uploading}
              onPress={onUpload}
              testID="drive-upload-submit"
            />
            <Button
              label="Cancel"
              variant="secondary"
              disabled={uploading}
              onPress={onCancel}
              testID="drive-upload-cancel"
            />
          </View>
          {uploading ? (
            <Caption color="faint" testID="drive-upload-progress">
              {`Uploading “${staged.name}”…`}
            </Caption>
          ) : null}
        </View>
      ) : (
        <Button
          label="Choose file"
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
