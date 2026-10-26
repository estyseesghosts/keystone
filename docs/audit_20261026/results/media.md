# Media audit — Keystone v2 (2026-10-26)

Scope: `src/components/Lightbox.tsx` (initial index/pager, zoom/pan/swipe-dismiss, rotation, web paging, frame mounting), video/audio lifecycle (pause on scroll-off/unmount/background), gifv autoplay, `Image` vs `expo-image` usage + cache policy (grep `from 'react-native'` Image vs `expo-image`), `Media.blurhash` usage, sensitive-media blur, aspect-ratio measurement/layout shift, upload cap (10MB claim vs code), server limits, upload cancel/progress, mid-upload removal orphans, whole-file-into-memory reads, `quality`, media permissions flow. Follow-up to `docs/audit_20261025/results/media.md` (M-numbers kept parallel). Read-only; no tests run. Native/web behavior is inferred from code and not device-verified.

## Summary

Most of the 2026-10-25 findings are fixed: the Lightbox now opens at the tapped index, pages on web, zooms/pans/dismisses, mounts a ±1 window, and re-checks sensitivity per frame; feed playback is viewability + AppState + blur gated through a single-global-player store; stills/avatars/banners/emoji go through an `expo-image` wrapper with `memory-disk` cache, recycling keys, and blurhash placeholders; uploads have per-kind server caps, cancel, byte progress (web), per-asset error isolation, native reference uploads (no whole-file reads), and EXIF strip-by-default; the processing state is first-class; and the legacy `MediaGrid.tsx` is deleted.

- Areas reviewed: 17 (M1–M17, same as 2026-10-25). Fully fixed: 7 (M1, M3, M4, M11, M12, M13, M17). Fixed with low-severity residuals: 8 (M2, M5, M6, M8, M9, M10, M14, M16). Partly fixed: 2 (M7, M15).
- Highest residual severity: Medium (M7 Mastodon aspect-miss, M8 Misskey/audio caps without server basis, M6 unvetted-avatar call sites). No High residuals.
- Device-check needs: Lightbox gesture conflicts (pinch vs pager, swipe-dismiss), zoom transform on `VideoView`, `contentOffset` on web, background-with-viewer-open audio.

## Findings

### M1 (Fixed) Lightbox opens at the tapped index

- Location: `src/components/Lightbox.tsx:438-448` (re-sync effect), `:610` (`contentOffset`), `:59-68` (`frameOffset`/`frameIndexForOffset`).
- Initial offset plus `scrollTo` on every later `[safe, width]` change. The 2026-10-25 wrong-frame scenario (counter says 3/3, frame 1 visible) no longer applies statically.
- Residual nit (Low): programmatic moves (`goTo`, Prev/Next buttons) land via `scrollTo({animated: false})` — a jump-cut, not an animated page (`Lightbox.tsx:443, 456-459`). Device-check whether the jump is jarring.

### M2 (Low, residual) Rotation re-sync and web paging land; animation + wheel gaps remain

- Fixed: width-change re-sync (`Lightbox.tsx:438-448`), web Prev/Next buttons (`:685-708`), Arrow/Home/End/Escape handling with text-entry guard (`:472-529`), focus trap + focus return (`:501-543`).
- Residual 1: `onMomentumScrollEnd` (`:611-613`) is still the only swipe path — no `onScroll` fallback, so web wheel/trackpad horizontal paging depends on the buttons/keys. Acceptable, not a bug.
- Residual 2: see M1 — button/key moves are unanimated.
- Needs device check: `contentOffset` prop behavior for RN-web `ScrollView` on mount, and offset fidelity across rotation on Android.

### M3 (Fixed, device-check needed) Zoom, pan, swipe-dismiss implemented

- Location: `src/components/Lightbox.tsx:46-50` constants, `:81-138` pure helpers (`clampZoom`, `panBounds`, `clampPan`, `touchDistance`, `pinchScale`, `isDismissSwipe`), `:167-178` double-tap toggle, `:614-649` touch handlers, `:547-561` web ctrl+wheel zoom.
- Instant (unanimated) application honors reduced motion by construction; zoom resets per frame (`:450-454`).
- Needs device check: two-finger pinch racing the horizontal pager, swipe-down vs scroll-gesture conflicts, and `transform: scale` rendering on `VideoView` (expo-video) vs expo-image.

### M4 (Fixed, low residual) Windowed mounting; off-screen players still buffer

- Location: `src/components/Lightbox.tsx:70-79` (`windowFor`, `frameLayout`), `:583-588` window slice, `:650` leading spacer, `:651-665` windowed frames, `:281-284` pager-driven play/pause.
- At most 3 frames mount; non-active video pauses. Feed stills render the preview URL (`PostMediaGrid.tsx:301, 323-324`).
- Residual (Low): each windowed video frame still constructs its own `useVideoPlayer` and buffers (`LightboxVideo`, `Lightbox.tsx:274-276`) — up to 3 connections for a 3-video window. No release-on-distance beyond unmount-by-windowing.

### M5 (Low, residual) Feed lifecycle fixed except quote grids and backgrounded viewer

- Fixed: global single-player store with preemption (`src/state/activePlayer.ts:53-72`), viewability-driven `active` (`PostFeed.tsx:121-153`, `HomeFeed.tsx:258-290`, 50% threshold `:268`/`:131`), AppState foreground gate (`activePlayer.ts:92-152`), blur suspend (`:174-191`, wired `HomeFeed.tsx:165`, `PostFeed.tsx:90`), unmount release + pause (`PostMediaGrid.tsx:394-405, 480-490, 548-558`), reduce-motion + data-saver autoplay gates (`:374-385`), first-gifv-only rule (`:744, 751`).
- Residual 1 (Low): `PostQuote` renders `PostMediaGrid` without `active` (`PostQuote.tsx:343-349`), and `PostCard` never threads `mediaActive` into `quoteProps` (`PostCard.tsx:871-905`). A quoted gifv autoplays whenever mounted regardless of viewability (bounded only by the global 1-player slot + foreground gate).
- Residual 2 (Low): `LightboxVideo` has no AppState/background gate (`Lightbox.tsx:255-300`) — backgrounding the app with the viewer open leaves audio playing; unmount relies on expo-video disposal with no explicit pause. Needs device check.

### M6 (Medium, residual) Feed migrated to expo-image; ~15 peripheral RN `Image` sites remain, two unvetted

- Fixed: `AppImage` wrapper (`src/components/Image.tsx:23-38`: `cachePolicy="memory-disk"`, `recyclingKey`, reduce-motion transition, `allowDownscaling`, blurhash placeholder, GIF `autoplay`) now serves feed stills (`PostMediaGrid.tsx:323-327`), post avatars (`PostCard.tsx:218-228`), profile avatar/banner (`ProfileAvatar.tsx:56-66`, `ProfileBanner.tsx:44-53`), and all emoji (`EmojiImage.tsx:59-69, 175-185`).
- Residual 1 (Medium): `QuoteAvatar` passes `account.avatarUrl` straight to RN `Image` with only a truthiness check — no `safeHttpUrl` at the call site (`PostQuote.tsx:60-69`). Same pattern in explore rows (`src/screens/explore/rows.tsx:28-36`). (Whether adapters pre-vet these URLs was not verified; `NotificationRow.tsx:179` and `PostCard.tsx:207` vet at the call site, these do not.)
- Residual 2 (Low): remaining RN `Image` sites with no shared cache/recycling/blurhash policy — `LinkCard.tsx:76, 246, 263`, `PostQuote.tsx:129, 293` (thumbs; these two are `safeHttpUrl`-vetted via `thumbUrl`, `:83-86`), `ComposerSections.tsx:268, 408` (local preview URIs), `Note.tsx:473, 590`, `NotificationRow.tsx:196`, `UserHoverCard.tsx:235, 248`, `ProfileHeader.tsx:293`, `AccountMenu.tsx:25`, `Channel.tsx:166`, `RichText.tsx:312` (mention chip), `ActionBar.tsx:124` (reaction glyph — animated custom emoji renders static under RN `Image` on iOS). `Channel.tsx:166` and `Note.tsx:369, 473` also lack call-site vetting/`onError` fallback (broken-image hole on 404).

### M7 (Medium, residual) Strip clamp fixed; Mastodon aspect is systematically missed so singles still shift

- Fixed: strip tiles clamp through `displayAspect` (`PostMediaGrid.tsx:156-167`), `Still` instances are keyed by `item.id` so `measured` state cannot leak across recycled rows (`:748`).
- Residual 1 (Medium): `metaAspect` reads only top-level `meta.width/height` (`PostMediaGrid.tsx:147-154`), but Mastodon nests dimensions under `meta.original` (`packages/fedi/src/mastodon/wire.ts: MediaMeta.original`). Every Mastodon image therefore starts at the 16:10 default and jumps to the `onLoad`-measured ratio (`PostMediaGrid.tsx:315-316, 334-341`) — feed layout shift on every meta-bearing Mastodon post. Misskey `properties` are top-level and unaffected (`misskey/adapt.ts:223`).
- Residual 2 (Low): `SensitiveCover` reserves the meta-only aspect (`PostMediaGrid.tsx:735`) while the revealed `Still` settles to `measured` — reveal shifts post height whenever meta was absent. The "revealing never shifts" claim holds only when meta is present.

### M8 (Medium, residual) Per-kind server caps on Mastodon; Misskey/audio/Drive still heap-bound without server basis

- Fixed: caps read from `media_attachments.image_size_limit/video_size_limit` with `upload_limit` fallback (`packages/fedi/src/api/composer.ts:219-225`), `attachmentCapFor` per kind (`:791-795`), enforced at pick (`pickMedia.ts:177-194`), stage (`composer.ts:839-859`), and upload time (`:716-736`) with the real number in the message (`formatByteLimit`, `:800-812`).
- Residual 1 (Medium): the Misskey `meta` path reads only `maxNoteTextLength` (`api/composer.ts:235-254`) — `maxImageBytes/maxVideoBytes` are always null, so the 10 MB heap bound caps all Misskey attachments including video, even though native reference uploads carry no heap risk.
- Residual 2 (Low): kind `"other"` (audio, files) unconditionally takes `MAX_MEDIA_BYTES` on both families (`api/composer.ts:794`) — large audio is refused with no server basis.
- Residual 3 (Low): callers that never thread server caps — Drive `pickMedia({limit: 1})` (`Drive.tsx:173`) and the Note inline composer `useUploads(backend)` (`Note.tsx:347`) — always enforce the heap bound, even on Mastodon instances with higher limits.
- Nit: the `MAX_MEDIA_BYTES` comment still frames the bound around whole-file reads "until X7.4" (`api/composer.ts:781-786`) although the X7.4 native reference path has landed — stale rationale.

### M9 (Low, residual) Cancel, progress, and removal handling land; native progress + orphans remain

- Fixed: per-item `AbortSignal` (`composer.ts:811-820`), `cancel` chip (`ComposerSections.tsx:361-369`), `remove` aborts in-flight requests (`composer.ts:895-899`), web byte progress via XHR (`:438-526`, wired `:933-938`, rendered `:277-280`), unmount abort (`:825-837`), parallel uploads (`concurrency: 3`, `:701-772`), mid-submit removal skips cleanly (`:678-683`).
- Residual 1 (Low): native uploads report no bytes (`implFor` returns undefined for refs, `:937`) — progress stays honestly indeterminate ("Uploading…", `ComposerSections.tsx:277-280`).
- Residual 2 (Low): `remove` after `done` orphan on Mastodon — `drive?.deleteFile` is a no-op there (no `drive` on the Mastodon backend; `Backend.drive` optional, `core/backend.ts:1532`), as the code comment admits (`composer.ts:903-909`).
- Residual 3 (Low): abort-after-store race — cancelling after the server stored the file but before the id returns leaves an orphan with no cleanup handle. Unavoidable without a server listing; noted, not actionable.
- Drive has cancel (`Drive.tsx:81-92, 199-223`) but no byte progress and no strip step (admitted, `Drive.tsx:17-18`).

### M10 (Low, residual) Native whole-file reads gone; transitive FS dep + web reads remain

- Fixed: native uploads stage `{uri, name, type}` references, bytes never enter JS (`pickMedia.ts:195-212`); per-asset try/catch reports `unreadable` without discarding sibling picks (`:224-226`); known sizes are probed without reading (`:188-190`, `composer.ts:326-337`).
- Residual 1 (Low): `probeNativeFileSize` dynamically imports `expo-file-system`, which is not in `package.json` (verified — present in `node_modules` only as an expo transitive). Failure degrades gracefully to null (`composer.ts:334-336`), but a direct dep should be declared before the transitive path moves.
- Residual 2 (Low, inherent): web still does whole-file `fetch→blob→File` (`pickMedia.ts:17-26`) plus a second blob round-trip on the strip path (`composer.ts:398-400`) — required by the web `File` API; the upload-time guard re-checks the read bytes.

### M11 (Fixed) Alt text and sensitivity handling solid

- Alt rides with the upload and re-saves via `updateMedia` on submit (`composer.ts:614-622`, `pendingMediaUpdates` in fedi), per-file sensitivity only sent where the family takes it (`composer.ts:238-243, 615-617`; Mastodon correctly status-level), alt-reminder pref device-global default-off (`:528-550`). No change requested.

### M12 (Fixed) EXIF stripped by default; video notice covers the rest

- JPEG/HEIC/PNG strip + re-encode to JPEG q0.92 default-on (`composer.ts:302-311, 361-406`); `Keep original` opt-out frozen after upload with GPS-specific warning (`ComposerSections.tsx:331-359`); GIF/WebP/video/audio pass through deliberately (`composer.ts:302-306`); once-per-session video-metadata notice (`:552-568`); profile images center-cropped + resized (avatar 400px, banner 1500px) with EXIF dropped as a side effect (`pickProfileImage.ts:82-123`). No change requested.

### M13 (Fixed) Processing poll no longer silently succeeds

- Null URL is a first-class `processing` state end to end: `uploadOne` returns the flag (`composer.ts:624-625`), rows render "Still processing…" (`ComposerSections.tsx:281-282`), submit re-checks via `updateMedia` description write (`composer.ts:687-700`), poll honors cancel (`mastodon/backend.ts:1374-1388`). A row is never `done` with a null URL. No change requested.

### M14 (Low, residual) Sensitive blur covers land; Lightbox cover has no blur, reveal can shift

- Fixed: blurhash cover with no pre-reveal fetch (`PostMediaGrid.tsx:628-685`, placeholder-only `uri={null}`), per-tile id-keyed reveal surviving recycle (`:708-728`), re-hide affordance (`:690-706`), Lightbox per-frame re-check with tapped-frame seeding (`Lightbox.tsx:152-164`, `PostCard.tsx:1139`).
- Residual (Low): the Lightbox `SensitiveCover` is plain text + button with no blurhash (`Lightbox.tsx:180-195`); feed reveal can shift height when meta is absent (see M7 residual 2).

### M15 (Low, residual) Accessibility improved; audio-in-viewer is a dead end

- Fixed: `mediaAlt` fallback labels (`PostMediaGrid.tsx:318-320`), focus trap + focus return on web (`Lightbox.tsx:501-543`), 44pt audio/gifv targets with `hitSlop` (`PostMediaGrid.tsx:92-101, 419, 576`), vector play/pause glyphs (`:242-273`), `accessibilityViewIsModal` + live-region counter (`Lightbox.tsx:600, 677-683`).
- Residual 1 (Low): `AudioPlayer`'s "Open in viewer" (`PostMediaGrid.tsx:587-591`) opens a Lightbox audio frame that renders the caption-only fallback with no playback (`Lightbox.tsx:361-365`) — a dead end. Either wire audio playback into the viewer or drop the link.
- Residual 2 (Low): the viewer counter always announces "Image N of M" (`Lightbox.tsx:572-577`) even for video/gifv frames.

### M16 (Low, residual) Profile image flow fixed; peripheral RN `Image` sites folded into M6

- Fixed: crop-to-aspect + downsize before upload (`pickProfileImage.ts:28-59, 82-123`), explicit permission with `denied`/`canAskAgain` (`:67-70`), EXIF dropped via manipulator, avatar/banner fallbacks (`ProfileAvatar.tsx:41-54`, `ProfileBanner.tsx:34-42`, `PostCard.tsx:209-216`), stale-emoji-index reset on listing change (`EmojiImage.tsx:158-166`).
- Residual: hover cards, channel/explore/Note surfaces still on RN `Image` — tracked under M6 residual 2.

### M17 (Fixed) Legacy grid deleted

- `src/components/MediaGrid.tsx` no longer exists (verified); `mediaAlt` lives in `src/lib/mediaAlt.ts:22`. No drift source remains.

## Looked solid

- Every feed, Lightbox, and quote-thumb fetch goes through `safeHttpUrl` except the M6-noted avatar call sites (`PostMediaGrid.tsx:301-302, 352, 431, 506, 601`; `Lightbox.tsx:221-222, 333`; `PostQuote.tsx:83-86`).
- `Media.blurhash` is now consumed (feed stills `:325`, sensitive covers `:664`, avatars `PostCard.tsx:220`/`ProfileAvatar.tsx:58`/banners, `AppImage` placeholder `Image.tsx:29`) — the 2026-10-25 "adapted but never read" gap is closed except the Lightbox frames (M14 residual).
- Picker permission flow is explicit with typed `denied`/`cancelled`/`picked+rejected` outcomes everywhere media is picked (`pickMedia.ts:154-167`, `pickProfileImage.ts:67-76`, surfaced `Composer.tsx:878`, `Drive.tsx:175-182`, `ProfileEditor.tsx:293`).
- `quality: 1` originals are deliberate and safe: the size guard runs before any read, and the D9 strip owns downsizing at upload time rather than the picker.
- `submitRef`-style double-submit discipline, success-preserving retry (`uploadAll` keeps `done`/`processing` ids, `composer.ts:673-677`), and folder-`force`/`folderId` Drive rules (root omission for Sharkey 400s) are unchanged and correct.
- Viewability threshold (50%) is shared by both feed lists (`HomeFeed.tsx:268`, `PostFeed.tsx:131`) with stable callback identity, so `active` does not flap.
- Reduced motion is honored in three places: Lightbox fade (`Lightbox.tsx:419, 594`), image cross-fade (`Image.tsx:34`), gifv autoplay suppression with manual-play affordance (`PostMediaGrid.tsx:374-384, 409-424`).
