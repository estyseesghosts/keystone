# Media handling audit (2026-10-25)

Scope: src/components/{Lightbox,MediaGrid,EmojiImage}.tsx, Post/PostMediaGrid.tsx, Composer/pickMedia.ts, Profile/*, state/queries/composer.ts, Drive upload, Mastodon/Misskey uploadMedia. Read-only; no tests run. Native/web behavior is inferred from code and not device-verified.

## Summary

The safety basics are good: URLs go through `safeHttpUrl`, sensitive media is gated per tile, the picker checks permissions, and over-cap files are refused before the fetch. The main problems are these:

- Lightbox ignores the tapped index on open.
- `expo-image` is a dependency but only the Lightbox and a legacy grid use it. Every feed, avatar, banner and emoji image uses RN `Image`.
- Video autoplay and lifecycle are only partly managed.
- The upload flow has no cancel and no progress.
- The 10 MB cap is applied to video as well.

## Findings

### M1 (High) Lightbox opens on the wrong frame
- Location: src/components/Lightbox.tsx:134-150
- The horizontal paging `ScrollView` has no `contentOffset` and no `scrollTo` for `index`. It always shows frame 0, while `active={i === safe}` marks frame `index` as the active frame.
- Scenario: a post has 3 images and the user taps the third. The viewer shows image 1, the counter says "3 / 3", the caption is image 3's alt text, and a video at index 2 plays off-screen. The same applies to a gifv.
- Fix: pass `contentOffset={{x: safe*width, y: 0}}` (or `scrollTo` in `onLayout`) and re-scroll when `width` changes.

### M2 (Medium) Lightbox pager breaks on rotation and has no web paging
- Location: src/components/Lightbox.tsx:114-146
- `width` comes from `useWindowDimensions`, but the scroll offset is not re-synced on resize. After a rotation or a window resize, the visible frame no longer matches `safe`. `onMomentumScrollEnd` also does not fire on desktop web wheel or trackpad paging.
- There are no previous/next buttons, no keyboard arrows, and no Escape handling beyond the Modal's `onRequestClose`.
- Fix: re-scroll to `safe` on width change, and add Prev/Next controls plus key handlers on web.

### M3 (Medium) Lightbox has no zoom, pan or swipe-to-dismiss
- Location: src/components/Lightbox.tsx:38-47
- Images use `contentFit="contain"` and nothing else. There is no pinch zoom, double-tap zoom, or swipe-down to close, and the only exit is the Close button. The lightbox cannot be used to read small text in screenshots, which is a core use case.
- Fix: add a gesture-handler pinch/pan wrapper, or `ScrollView` with `maximumZoomScale` on iOS.

### M4 (Medium) Lightbox mounts every frame and every video player at once
- Location: src/components/Lightbox.tsx:147-149
- `media.map` renders every frame. Each video frame calls `useVideoPlayer(url)`, which creates a player and starts buffering whether or not it is the active frame. Images are full-resolution (`item.url`), not previews, and nothing is virtualized.
- Scenario: a 4-video post creates 4 players and 4 network connections. This is a memory-pressure and bandwidth risk on low-end Android.
- Fix: render only active ±1 frames, or use a FlatList. Release the player when a frame is not near the active one.

### M5 (Medium) Video lifecycle in the feed: no pause on scroll-off, unmount or backgrounding
- Location: src/components/Post/PostMediaGrid.tsx:258-281 (PlayerTile), 292-325 (AudioPlayer), 227-256 (LoopTile)
- `PlayerTile` and `AudioPlayer` have no visibility, scroll-off or focus handling.
  - A user can start a video or audio clip, scroll away, and it keeps playing for as long as the row stays mounted.
  - Navigating to another screen leaves it playing until the row unmounts.
  - Starting a second one does not stop the first, so audio overlaps.
- `LoopTile` has only the static `autoplayIndex` gate. The code comment admits "Full feed-level viewability wiring is a follow-up". Because `PostCard` (line 1039) does not pass `autoplayIndex`, the default 0 means every gifv post in the feed autoplays whenever it is mounted. N visible gifv posts means N decoders, which the comment says the gate was meant to prevent.
- Nothing checks the reduce-motion setting before the autoplay in `LoopTile`, even though the Lightbox does check it for its fade.
- There is no `AppState` handling anywhere in the media components.
- Fix: a global "active player" store (one playing at a time), viewability-driven `active`, pause on blur or background, and honor reduce-motion and a data-saver preference.

### M6 (Medium) Feed images use RN `Image`, not expo-image
- Location: src/components/Post/PostMediaGrid.tsx:17,208; also PostCard.tsx:206, ProfileAvatar.tsx:4, ProfileBanner.tsx:3, EmojiImage.tsx:59/143, RichText.tsx:240, and others (full list: grep `<Image`).
- Only Lightbox.tsx and the legacy MediaGrid.tsx import `expo-image`. The consequences:
  - There is no `cachePolicy="memory-disk"`, no `recyclingKey`, no `transition`, and no blurhash placeholder. `Media.blurhash` is adapted at mastodon/adapt.ts:313 and misskey/adapt.ts:208, but no component reads it (grep for `blurhash` in src is empty apart from a test fixture). Loading tiles are blank.
  - There is no `priority` or `contentPosition`, and no reliable animated GIF/WebP. RN `Image` on iOS does not animate GIFs. `kind: 'image'` with a GIF would render static, and animated emoji/avatars are static too.
  - There is no downsampling control. Strip tiles fall back to the full URL when `previewUrl` is missing (PostMediaGrid.tsx:196), and a multi-MB original is decoded at 220px height.
- Fix: migrate the feed, avatar, banner and emoji images to expo-image with `cachePolicy`, `recyclingKey={item.id}` and `placeholder={{blurhash}}`.

### M7 (Medium) Image load and layout: aspect ratio is measured post-load, so layout shifts
- Location: src/components/Post/PostMediaGrid.tsx:191-205
- When `meta` has no width/height (Mastodon remote media often lacks `meta.original`, and Misskey `properties` may be missing), the frame renders at 16:10 and then jumps to the measured ratio in `onLoad`. This shifts the feed after scroll-anchoring. The `measured` state resets nothing on virtualized row recycling.
- Related: in strip mode (`single` false) `tileAspect` returns `metaAspect ?? 4/3` with no clamp, and `stripItem` has a fixed height of 220. A panorama with ratio 10:1 becomes a 2200px-wide tile, and a 1:10 portrait becomes a 22px-wide sliver. `displayAspect` is used only for singles (PostMediaGrid.tsx:110-115).
- Fix: clamp strip aspect (about 0.75..2), and use blurhash/placeholder space.

### M8 (Medium) Upload cap of 10 MB is applied to video and is not server-derived
- Location: src/state/queries/composer.ts:132-140, pickMedia.ts:54
- The hard-coded `MAX_MEDIA_BYTES = 10 MB` applies to everything, including video. Mastodon defaults to 99 MB for video and 16 MB for images, and Misskey defaults to far more than 10 MB. A normal phone video (about 50 MB for 30 seconds) can never be attached.
- The doc comment says "over-cap video is refused, not downscaled". This is a conscious choice, but the cap is not read from the instance (`/api/v1/instance` `media_attachments.video_size_limit`), and the error text hard-codes "over 10 MB" (Composer.tsx:617-619, Drive.tsx:166).
- Fix: use per-server limits, per-kind (image vs video), and consider compression via expo-image-manipulator or `videoExportPreset`.

### M9 (Medium) No upload cancel, no byte progress, and removal does not abort
- Location: src/state/queries/composer.ts:243-289, 340-346
- `uploadAll` takes no `AbortSignal`, so `backend.uploadMedia` cannot be aborted. `remove(key)` deletes the file from the map and the item from the list, but an in-flight upload keeps running and then calls `onUpdate` on a missing key (a no-op), leaving an orphaned server file.
- The Composer's busy state has no cancel button. Progress is per-file status only (the comment says "Neither transport reports bytes").
- A large video on a slow link gives the user an indefinite "uploading" state with no way out except closing the composer.
- Fix: thread an `AbortController` through `transport.upload` / `client.postFormData`, add an item-level Cancel, and use XHR `upload.onprogress` for bytes.

### M10 (Medium) Uploads are sequential and the whole file is read into JS memory
- Location: src/components/Composer/pickMedia.ts:15-22, 61
- `assetToFile` does `fetch(uri) → blob → new File`. This is the cause of the 10 MB guard. When `asset.fileSize` is undefined (web, some Android providers), the check is skipped (pickMedia.ts:54), so the whole large file is materialized before `attachmentSizeError` rejects it. The code comment claims an OOM guard the code cannot always provide.
- The `await assetToFile` runs inside the loop with no try/catch per asset. One failure (for example an iCloud-only photo that fails to download) throws the whole pick away, and the other selected files are lost. The error shown is the generic raw message from Composer.tsx:622.
- Fix: per-asset try/catch with an item-level rejected reason; use `FileSystem.getInfoAsync` for size on native; use RN's `{uri, name, type}` FormData form where possible.

### M11 (Low) Alt text and sensitive flag on uploads
- Location: src/state/queries/composer.ts:219-232, src/components/Composer/ComposerSections.tsx:215-310
- Alt text is sent with the upload and sensitive is sent only when true. Mastodon's `uploadMedia` ignores `opts.isSensitive` (mastodon/backend.ts:1137-1160, it only uses it for the adapted model), which is correct since sensitivity is status-level there.
- No alt-text reminder or required-alt setting. The user can post images with no alt and nothing flags it. Minor.

### M12 (Low) EXIF is not stripped client-side
- Location: src/components/Composer/pickMedia.ts:43-47
- `quality: 1` returns the original with GPS EXIF. Mastodon and Misskey strip EXIF on their side by default, but a pinetree or other fork may not. The comment says originals are deliberate. There is no client-side strip or opt-in notice. (Server behavior was not verified in this repo.)

### M13 (Low) Mastodon processing poll gives no feedback and can end with a null URL
- Location: packages/fedi/src/mastodon/backend.ts:1137-1162
- The poll waits up to 20 × 750 ms = 15 s, with no abort. If the video is still processing at that point, the function returns `media` with a null URL as if it succeeded. The composer then marks the item `done` with a thumbnail-less state, and the post is allowed while the media may still be processing (Mastodon then rejects the post with 422 on submit).
- Fix: surface a "still processing" status and re-poll on submit.

### M14 (Low) Sensitive media is hidden but not blurred, with no blurhash cover
- Location: src/components/Post/PostMediaGrid.tsx:360-387, 404-416
- A hidden sensitive tile is a text box. This is safe (nothing is fetched), but it is a generic grey box with no thumbnail blur, so users cannot tell what is hiding, and `Media.blurhash` goes unused. A single sensitive item shows only a caption with no frame, and the post height changes on reveal.
- There is no re-hide after reveal, and the reveal state is per grid instance, so it is lost on row recycle.
- The Lightbox and the quote-card media do not re-check `isSensitive`. This is fine as long as the Lightbox is only reachable after reveal, but it is not enforced in the Lightbox itself.

### M15 (Low) Accessibility and web
- Location: PostMediaGrid.tsx:208-219; Lightbox.tsx:128-146
- `Image` has `accessibilityLabel`, and the label falls back to `item.kind` ("image") when there is no description. This is less helpful than the generated "Image 2" text in `mediaAlt`.
- The Lightbox Modal has no focus trap or `accessibilityViewIsModal`, and on web the `alt` prop is passed to expo-image while a Caption repeats it.
- Audio `Play` uses unicode glyphs ("▶ Play") as text, and its control sits in a `Caption`, so the touch target is small (no `hitSlop`, no min size).
- `VideoView` has `nativeControls`, but the web fullscreen/PiP behavior is untested here.

### M16 (Low) Avatars, banners and emoji
- Location: src/components/Profile/ProfileAvatar.tsx:36-44; ProfileBanner.tsx:20-28; EmojiImage.tsx:131-150; Following.tsx:56
- `ProfileAvatar` and `ProfileBanner` have no `onError` fallback. A 404 avatar leaves an empty bordered circle, while `PostCard` handles it with a letter fallback. Whether callers pass `safeHttpUrl`-vetted URLs was not confirmed for every caller; Followers.tsx and Following.tsx were not read beyond the import.
- `CustomEmojiGlyph` keeps `index` state when `candidates` change, for example when the store listing lands later. After one failed candidate it skips later ones and falls back to the literal `:code:`.
- Emoji images use RN `Image` with no cache control. In a long timeline, hundreds of small remote emoji go through the default HTTP cache only.
- Profile images are picked with no crop and no resize (`quality: 1`, ProfileHeader), so an avatar upload can be a multi-MB original.

### M17 (Low) Legacy MediaGrid still exists
- Location: src/components/MediaGrid.tsx
- It is labeled LEGACY, has no importer, and is kept only for `mediaAlt` and tests. This is dead code and a source of drift (it is the only user of expo-image apart from the Lightbox). Move `mediaAlt` to a util and delete it.

## Looked solid

- Every image, video and audio source goes through `safeHttpUrl` (F4), so unsafe schemes never fetch (PostMediaGrid.tsx:195, 228, 259, 285; Lightbox.tsx:34).
- Single-image sizing follows docs/image-sizing.md: clamped ratio, height cap, left-justified, crop only for out-of-range shapes (PostMediaGrid.tsx:35-62, 156-166).
- Sensitive media is gated per tile, not per grid, and nothing is fetched while hidden.
- The picker requests permission explicitly and returns a typed result (`denied`, `cancelled`, `picked` with `rejected`), and the composer displays each case. The pre-fetch size check avoids reading known-oversize files.
- The Composer has a submit-in-progress ref guard (`submitRef`) that prevents double uploads, and `uploadAll` keeps successful items on retry and never re-sends them.
- The sensitive field is only sent when set, and `folderId` is omitted for the root (Sharkey 400 rule).
- Lightbox plays only the active frame and pauses the others (once M1 is fixed, this works as intended). The gifv loop is muted.
- Reduced motion is respected for the Lightbox transition.
- Unsupported attachment kinds degrade to an openable file card, with `Linking.openURL` errors toasted.
