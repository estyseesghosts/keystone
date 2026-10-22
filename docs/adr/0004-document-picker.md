# ADR 0004 — Document picker module for import files

Date: 2026-10-22
Status: accepted
Plan ref: `docs/clickstone.md` §2.3 (Wave 2 transfer UI)

## Problem

The import UI (clickstone §2.3) must let the viewer choose a local file
(a Misskey CSV export) and hand it to `Backend.transfer.importFile` as a
`File`, which the Misskey family uploads to Drive and then imports by
`{fileId}` (0.6 shape — read-only reference). This build has no
file-choice primitive: `TransferSections.tsx` renders twelve honest
placeholders because of it. The decision is which Expo module provides
the file choice, with no new native dependency unless justified.

## Options considered

1. **`expo-image-picker` (already in `package.json`).** Rejected: it
   opens the photo library / camera and returns images and videos only.
   A CSV picked through it is impossible, and coercing the import flow
   through a media picker would be a fake affordance.
2. **`expo-document-picker`.** The Expo SDK module for generic file
   choice (iOS `UIDocumentPickerViewController`, Android Storage Access
   Framework, web `<input type=file>`). `getDocumentAsync` returns
   `{canceled, assets: [{uri, name, mimeType, size}]}`; with
   `copyToCacheDirectory: true` the asset URI is `fetch()`-able, so the
   existing `assetToFile` pattern (`fetch` → `blob` → `new File`,
   already used by `pickMedia.ts`) applies unchanged. No config plugin
   is required (`app.config.js` `plugins` stays `[]`); no entitlement
   is required for local-file import (iCloud Drive browsing works
   without extra entitlements for reading user-chosen files). Version
   pins to the SDK-57 line (`~57.0.3`), matching every other `expo-*`
   dependency.
3. **`react-native-document-picker` (community).** Rejected: the
   upstream project is deprecated in favour of Expo's module, it would
   add a third-party native dependency with its own release cadence,
   and it offers nothing `expo-document-picker` lacks for a
   single-CSV choice.
4. **Web-only `<input type=file>`.** Rejected: this is a native app
   (Expo dev-client build); a DOM input does not exist on iOS/Android.

## Decision

Use **`expo-document-picker`** (`~57.0.3`), loaded lazily behind the
`src/lib/documentPicker.ts` seam (`pickTransferFile`), mirroring the
`pickMedia.ts` pattern: lazy `await import('expo-document-picker')`
so tests and bundles that never open the picker do not pull the native
module, and tests mock the seam instead of the native module.

The picker filter is permissive (`*/*`): pickers report
`application/octet-stream` for valid CSVs, so a strict `text/csv`
filter could hide a valid file on some Android file managers. The
server owns the file-type verdict (`UNEXPECTED_FILE_TYPE` /
`TOO_BIG_FILE` surface as honest errors) and the 10 MB size guard runs
before any upload — exactly the 0.6 discipline.

## Consequences

- Good: one official SDK dependency, no config plugin, no new
  permission prompt; the import rows become real with the same
  fetch-to-`File` construction the composer already uses.
- Good: cancel stays a silent no-op (`{canceled: true}` → `null`,
  never an error, never a backend call); picker throws surface as
  honest row errors.
- Bad / accepted risk: the native module ships in the next dev-client
  rebuild; until then the import rows call a module that is not linked
  (the row catches the load failure and says so — never a crash).
- Follow-ups: antenna / user-list imports (`i/import-antennas`,
  `i/import-user-lists`, both stock upstream) need new `ImportKind`
  values plus rows — a later slice, not this one.
