// Document picking for the import UI (clickstone §2.3, ADR-0004).
// `expo-document-picker` is loaded lazily so tests and bundles that never
// open the picker do not pull the native module.

export interface PickedTransferFile {
  file: File
  name: string
}

/** Client-side import bound (R2.3): files over this size are refused with
 * an honest error before any upload — never read into the Hermes heap.
 * The server may accept larger files; this bound is about not OOMing the
 * client on `fetch(uri) → blob → File`, not about the server's limit. */
export const MAX_TRANSFER_FILE_BYTES = 10 * 1024 * 1024

/** Honest refusal text for an over-cap import file, or null when it fits.
 * Unknown sizes (non-finite, zero) pass — the server stays the verdict.
 * Pure. */
export function transferSizeError(name: string, size: number): string | null {
  if (!Number.isFinite(size) || size <= MAX_TRANSFER_FILE_BYTES) return null
  return `"${name}" is too large to import (over 10 MB).`
}

/**
 * Let the viewer choose one local file for an import row. Returns null on
 * cancel (a cancel is never an error and never reaches the backend), and
 * throws when the picker itself fails (the row shows the message) or when
 * the file is over the client size cap (an honest refusal, never a
 * Hermes OOM from reading a multi-hundred-MB file into memory).
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
  const tooBig = transferSizeError(name, blob.size)
  if (tooBig) throw new Error(tooBig)
  return {
    file: new File([blob], name, {
      type: asset.mimeType ?? blob.type ?? 'application/octet-stream',
    }),
    name,
  }
}

export interface PickedTransferFiles {
  file: File
  name: string
  size: number
  mimeType: string
}

/**
 * Multi-file variant of `pickTransferFile` for the Drive upload queue
 * (P6.6 slice 7): `multiple: true` where the platform picker supports
 * it, single file otherwise. Returns [] on cancel (never an error).
 * Throws when the picker itself fails. Whole-file reads apply per file
 * (same Hermes guard as the single-file path).
 */
export async function pickTransferFiles(): Promise<PickedTransferFiles[]> {
  const Picker = await import('expo-document-picker')
  const result = await Picker.getDocumentAsync({
    type: '*/*',
    copyToCacheDirectory: true,
    multiple: true,
  })
  if (result.canceled || !result.assets || result.assets.length === 0) return []
  const out: PickedTransferFiles[] = []
  for (const asset of result.assets) {
    // Web exposes the File directly (no blob round-trip).
    const webFile = (asset as {file?: unknown}).file
    if (typeof File !== 'undefined' && webFile instanceof File) {
      out.push({file: webFile, name: asset.name ?? webFile.name, size: webFile.size, mimeType: asset.mimeType ?? webFile.type})
      continue
    }
    const res = await fetch(asset.uri)
    const blob = await res.blob()
    const name = asset.name ?? asset.uri.split('/').pop() ?? 'import'
    out.push({
      file: new File([blob], name, {type: asset.mimeType ?? blob.type ?? 'application/octet-stream'}),
      name,
      size: blob.size,
      mimeType: asset.mimeType ?? blob.type ?? 'application/octet-stream',
    })
  }
  return out
}
