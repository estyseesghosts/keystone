// Document picking for the import UI (clickstone §2.3, ADR-0004).
// `expo-document-picker` is loaded lazily so tests and bundles that never
// open the picker do not pull the native module.

export interface PickedTransferFile {
  file: File
  name: string
}

/**
 * Let the viewer choose one local file for an import row. Returns null on
 * cancel (a cancel is never an error and never reaches the backend), and
 * throws when the picker itself fails (the row shows the message).
 *
 * The filter is deliberately permissive (match-all): pickers report
 * `application/octet-stream` for valid CSVs, so a strict `text/csv`
 * filter could hide a valid file on some Android file managers. The
 * server owns the file-type verdict (`UNEXPECTED_FILE_TYPE` /
 * `TOO_BIG_FILE` surface as honest errors) and the 10 MB size guard runs
 * before any upload.
 */
export async function pickTransferFile(): Promise<PickedTransferFile | null> {
  const Picker = await import('expo-document-picker')
  const result = await Picker.getDocumentAsync({type: '*/*', copyToCacheDirectory: true})
  if (result.canceled) return null
  const asset = result.assets?.[0]
  if (!asset) return null
  const res = await fetch(asset.uri)
  const blob = await res.blob()
  const name = asset.name ?? asset.uri.split('/').pop() ?? 'import'
  return {
    file: new File([blob], name, {
      type: asset.mimeType ?? blob.type ?? 'application/octet-stream',
    }),
    name,
  }
}
