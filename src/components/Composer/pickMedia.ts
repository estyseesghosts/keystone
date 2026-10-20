import type {UploadableFile} from '#/state/queries/composer'

// Media picking (slice 4.3). expo-image-picker is loaded lazily so tests
// and web bundles that never open the picker do not pull the native module.

/** Turn a picked asset into a `File` the Backend upload takes. */
export async function assetToFile(asset: {
  uri: string
  fileName?: string | null
  mimeType?: string | null
}): Promise<File> {
  const name = asset.fileName || asset.uri.split('/').pop() || 'upload'
  const res = await fetch(asset.uri)
  const blob = await res.blob()
  return new File([blob], name, {type: asset.mimeType || blob.type || 'application/octet-stream'})
}

export async function pickMedia(opts: {limit: number}): Promise<UploadableFile[]> {
  if (opts.limit <= 0) return []
  const Picker = await import('expo-image-picker')
  const result = await Picker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsMultipleSelection: opts.limit > 1,
    selectionLimit: opts.limit,
    quality: 1,
  })
  if (result.canceled) return []
  const out: UploadableFile[] = []
  for (const asset of result.assets) {
    out.push({
      file: await assetToFile(asset),
      name: asset.fileName || asset.uri.split('/').pop() || 'upload',
      previewUri: asset.uri,
    })
  }
  return out
}
