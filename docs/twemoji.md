# Keystone: selectable emoji styles — implementation report

The main design decision is to support OpenMoji, Twemoji, Noto Emoji, and Microsoft Fluent Emoji without bundling their complete asset collections into Keystone.

These are not four interchangeable fonts. OpenMoji and Noto Emoji provide font distributions, while Twemoji and Microsoft's official Fluent Emoji repository primarily distribute individual emoji graphics. Keystone needs to account for both approaches rather than assuming every set can be selected with CSS `font-family`.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub

+3



My recommendation is to build one device-local emoji-style preference, a shared rendering layer, and a version-pinned remote asset loader. This avoids duplicating rendering logic throughout the SolidJS application and keeps the initial application bundle small.

## 1. Upstream sources and implementation details

The following versions and paths are suitable starting points, verified against upstream repositories as of October 18, 2026.

| Option                 | Recommended asset format | Version to pin                                    | License                                    |
| ---------------------- | ------------------------ | ------------------------------------------------- | ------------------------------------------ |
| OpenMoji               | Color SVG                | `17.0.0`                                          | CC BY-SA 4.0                               |
| Twemoji                | SVG                      | `v17.0.3`                                         | Graphics: CC BY 4.0; code: MIT             |
| Noto Emoji             | SVG                      | `v2026-09-24-unicode18_0`                         | SVG assets: Apache 2.0; fonts: SIL OFL 1.1 |
| Microsoft Fluent Emoji | Color SVG                | Commit `1ffb34c752ecf5d402f04cfb4b392c77f57c54bc` | MIT                                        |

OpenMoji 17.0 and Twemoji 17.0.3 both provide Unicode Emoji 17 coverage. Noto's September 2026 release adds Unicode 18 assets. Fluent does not have a corresponding latest GitHub release, so use a pinned commit and explicitly track its asset coverage.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub

+5



### OpenMoji

Upstream: [hfg-gmuend/openmoji](https://github.com/hfg-gmuend/openmoji?utm_source=chatgpt.com)

OpenMoji provides individual color and monochrome SVG files, PNG files, metadata, and experimental downloadable fonts. Its official release repository is suitable for production asset delivery.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub

+1



Example: grinning face.

```
https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji@17.0.0/color/svg/1F600.svg
```

The filename convention uses uppercase hexadecimal code points, joined with hyphens for sequences. However, implement a mapping derived from OpenMoji's release metadata rather than blindly converting arbitrary Unicode strings to filenames.

Alternative: OpenMoji also offers WOFF2 web fonts. Its font documentation recommends the COLRv0 format for websites because of its broader browser support.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub

+1



```
https://cdn.jsdelivr.net/gh/hfg-gmuend/openmoji@17.0.0/font/OpenMoji-color-glyf_colr_0/OpenMoji-color-glyf_colr_0.woff2
```

For Keystone, I recommend the SVG route instead. That means the complete font never needs to download, and each emoji is fetched individually.

Licensing: OpenMoji requires attribution and uses a ShareAlike license. Include its attribution in Keystone's About or acknowledgements section, retain the license information, and review the implications before distributing modified assets.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub

+1



### Twemoji

Upstream: [jdecked/twemoji](https://github.com/jdecked/twemoji?utm_source=chatgpt.com)

Use the maintained `jdecked/twemoji` repository and its SVG assets rather than relying on old Twitter-owned repository documentation. The current upstream release is `v17.0.3`.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub

+1



Example:

```
https://cdn.jsdelivr.net/gh/jdecked/twemoji@v17.0.3/assets/svg/1f600.svg
```

Twemoji filenames use lowercase hexadecimal code points joined by hyphens. The conversion must handle emoji sequences and variation selectors correctly.

The official package includes a parser that can replace emoji in text nodes with image elements. However, Keystone already has its own SolidJS rendering pipeline. Do not apply a whole-document DOM transformation: use the existing renderer to preserve component boundaries and event handlers.

Twemoji's JavaScript is MIT-licensed, but the artwork is CC BY 4.0. Include appropriate attribution. It supports Unicode emoji, not Misskey-style server-hosted custom emoji. Keystone should keep those two cases separate.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

jdecked/twemoji: Emoji for everyone. · GitHub

+1



### Noto Emoji

Upstream: [googlefonts/noto-emoji](https://github.com/googlefonts/noto-emoji?utm_source=chatgpt.com)

Noto is the strongest candidate when newer Unicode coverage matters: the upstream release dated September 24, 2026 is tagged `v2026-09-24-unicode18_0`. Its repository provides individual SVG graphics as well as font files.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://fuchsia.googlesource.com\&sz=32)

Git at Google

+1



Example:

```
https://cdn.jsdelivr.net/gh/googlefonts/noto-emoji@v2026-09-24-unicode18_0/2D/svg/emoji_u1f600.svg
```

Noto's SVG filenames have an `emoji_u` prefix and use lowercase hexadecimal code points separated by underscores.

The native color font is less suitable as Keystone's universal rendering mechanism. Noto Color Emoji uses CBDT/CBLC, a bitmap color-font format whose browser support varies by operating system and browser. Its monochrome font is a separate product and should not be confused with the color set.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub

+1



Use the SVG collection for consistent results. The SVG assets are Apache-licensed; the font files use SIL OFL 1.1. Preserve the applicable license notices.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://fuchsia.googlesource.com\&sz=32)

Git at Google

+1



### Microsoft Fluent Emoji

Upstream: [microsoft/fluentui-emoji](https://github.com/microsoft/fluentui-emoji?utm_source=chatgpt.com)

Microsoft's official repository supplies multiple representations of its artwork, including:

- `Color` — SVG
- `Flat` — SVG
- `High Contrast` — SVG
- `3D` — PNG

Individual emoji directories contain `metadata.json`, including fields such as the Unicode value, glyph, keywords, and text-to-speech description.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub

+2



Example:

```
https://cdn.jsdelivr.net/gh/microsoft/fluentui-emoji@1ffb34c752ecf5d402f04cfb4b392c77f57c54bc/assets/Grinning%20face/Color/grinning_face_color.svg
```

The commit is pinned instead of using `main`, so that a repository update cannot silently change Keystone's artwork.

Important: Fluent's asset paths are based on descriptive directory and filenames, not simply Unicode code points. Generate a Unicode-to-path manifest from the upstream metadata. Do not try to derive a path by turning an emoji's Unicode name into a slug.

I recommend starting with the official Color SVG assets to keep the implementation vector-based and relatively lightweight. A future sub-option could expose Fluent's 3D PNGs if that is the intended visual style.

Microsoft's official repository is MIT-licensed. Preserve the license and copyright notice.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://github.com\&sz=32)

GitHub

+1



## 2. How Keystone should load and cache emoji

Use immutable, version-pinned asset URLs. Never use `latest`, `main`, or an unversioned CDN URL at runtime. Keep the four asset versions in one configuration module.

Example configuration:

```
export type EmojiStyle =
  | "system"
  | "openmoji"
  | "twemoji"
  | "noto"
  | "fluent";
```

The default should remain `"system"` so existing behaviour is unchanged until the user chooses a style.

### Asset loading

The renderer should perform these steps:

1. Receive a complete Unicode emoji sequence.
2. Look up the correct remote asset for the selected style.
3. Render an inline image at approximately the size of the surrounding text.
4. If the asset is unsupported or fails to load, display the original Unicode sequence using the system font.

Use `loading="lazy"` on inline emoji images, and allow the browser's HTTP cache to handle repeat requests. Versioned asset URLs prevent an updated upstream file from accidentally replacing a previously cached file.

Do not download all emoji at startup, install a complete font pack, or bundle the SVG/PNG collections into Vite's JavaScript output.

For stronger offline guarantees, Keystone could later use Cache Storage. That requires deliberate cache population and eviction handling; Cache Storage is not automatically a replacement for the browser's normal image cache.&#x20;

[image](https://www.google.com/s2/favicons?domain=https://developer.mozilla.org\&sz=32)

MDN

+1



### Manifest generation

OpenMoji, Twemoji, and Noto have relatively predictable code-point filename conventions. Fluent requires metadata-based path resolution. I recommend generating manifests for all four sets so coverage and sequence handling remain consistent.

The generator should:

- Consume pinned upstream metadata or asset listings.
- Map complete Unicode sequences to relative paths.
- Record each set's supported sequences.
- Produce small JSON files containing paths only—not the artwork.
- Be reproducible without network access during an ordinary Keystone build.

Keep manifests as static files loaded only when needed, rather than importing every mapping into the initial application bundle.

This also makes coverage gaps explicit. For example, a Unicode 18 emoji absent from a set should fall back cleanly; it should not trigger repeated 404 requests.

## 3. Changes required in Keystone

I inspected Keystone's current `main` branch. The app already has a usable appearance-settings architecture, SolidJS components for emoji rendering, and device-local preferences. The implementation should extend those systems rather than introduce a new UI framework or replace the existing emoji pipeline.

### A. Add an emoji-style preference

Relevant files:

- `frontend/src/state/appearance.tsx`
- `frontend/src/routes/Settings.tsx`

The existing appearance state already persists theme, palette, text scale, and display-font preferences in `localStorage`. The existing font override can load remote fonts, but it changes the body typeface; it should remain completely independent of the emoji-style choice.

Add a validated `EmojiStyle` preference, defaulting to `system`, persisted under a new key such as `keystone_emoji_style`.

In the existing Accessibility and display settings page, add an Emoji appearance selector with these options:

| Option           | Behaviour                           |
| ---------------- | ----------------------------------- |
| System default   | Preserve existing Unicode rendering |
| OpenMoji         | Load OpenMoji SVGs                  |
| Twemoji          | Load Twemoji SVGs                   |
| Noto Emoji       | Load Noto SVGs                      |
| Microsoft Fluent | Load Fluent Color SVGs              |

Include a small live preview for each option. The choice must survive reloads and must not change the selected body font, theme, text scale, or emoji favourites.

### B. Create a shared Unicode emoji renderer

Recommended new files:

```
frontend/src/components/UnicodeEmoji.tsx
frontend/src/components/EmojiText.tsx
frontend/src/api/emojiAssets.ts
frontend/src/api/emojiAssets.generated.json
```

Responsibilities:

- `UnicodeEmoji.tsx`: render one complete Unicode sequence using the selected style.
- `EmojiText.tsx`: split ordinary text into text and emoji segments without disturbing surrounding content.
- `emojiAssets.ts`: resolve the selected style and return a safe, version-pinned URL, or indicate that the sequence is unsupported.
- The generated manifest: map supported sequences to paths without including the actual artwork.

Use Unicode-aware sequence matching. Skin-tone modifiers, flags, keycaps, variation selectors, and zero-width-joiner sequences must remain intact. Do not split a family emoji into individual people or a flag into two unrelated regional indicators.

Generate mappings from upstream data rather than building an incomplete hand-written regex. In particular, use Fluent's `metadata.json` files to map Unicode sequences to asset paths.

### C. Integrate the renderer into existing content

The following files are the important integration points:

| File                                      | Required change                                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `frontend/src/components/MfmRenderer.tsx` | Replace the current system-rendered `unicodeEmoji` span; process emoji in ordinary text nodes too.                     |
| `frontend/src/components/HtmlBody.tsx`    | Apply the renderer to ordinary text nodes in sanitized HTML output. Preserve the existing safe DOM rendering approach. |
| `frontend/src/components/EmojiPicker.tsx` | Update `EmojiGlyph`, `DisplayName`, and picker cells so Unicode emoji use the chosen style.                            |
| `frontend/src/components/ContentBody.tsx` | Verify both HTML and MFM content paths receive the preference through their existing renderers.                        |
| `frontend/src/styles/global.css`          | Add consistent inline-image sizing and alignment.                                                                      |
| `frontend/src/routes/Settings.tsx`        | Add the preference control and preview.                                                                                |

The shared rendering path should cover post text, profile names and biographies, content warnings, polls, reaction chips, picker entries, and other existing places that display Unicode emoji.

Do not replace Misskey custom emoji with Unicode assets. The existing `EmojiGlyph` implementation resolves hosted `:shortcode:` emoji through packed maps and URL lookups. Preserve that mechanism; only standard Unicode emoji should use the selected set.

Keep the existing rule against rendering arbitrary HTML with `innerHTML`.

## 4. Important limitations and deployment concerns

### Editable text fields

SVG-based rendering works in displayed content, but a native `<textarea>` cannot embed images inside its text. Unicode emoji typed into Keystone's composer will therefore continue to use the system's glyphs while editing, even though published content and previews can use the selected style.

Making all four styles appear inside the actual editable text would require a different editing strategy, such as a rich-text editor or a synchronized visual overlay. That should be treated as a separate scope decision, not hidden behind a font selector.

### CSP and CDN access

The remote SVG approach requires the deployed app's Content Security Policy, if present, to permit the asset host in `img-src`. If Keystone fetches manifests at runtime, that host must also be permitted in `connect-src`.

I did not find a checked-in Content Security Policy in the inspected repository. Check the actual production response headers and reverse-proxy configuration before deployment.

Direct image embedding does not require loading third-party JavaScript. Remote assets nevertheless reveal requests to the CDN, including the viewer's IP address.

### Error handling and caching

- Render the original Unicode sequence if the manifest lacks an asset.
- On image-load failure, replace the failed image with the original Unicode sequence; do not show a broken-image icon.
- Deduplicate or memoize asset lookups to avoid repeatedly resolving the same sequence.
- Use lazy image loading and immutable, version-pinned URLs.
- Do not cache error responses as successful assets.
- Avoid downloading the entire collection when the user selects a style.
- Keep automatic cache eviction and offline support out of the initial implementation unless Keystone explicitly adopts a broader offline asset strategy.&#x20;

  [image](https://www.google.com/s2/favicons?domain=https://developer.mozilla.org\&sz=32)

  MDN

  +1



## 5. Tests and deliverables

The implementing agent should deliver the following in one scoped feature.

### Implementation checklist

Preference and settings

Persist and validate the style; add accessible selection controls and previews.

Asset manifests

Generate mappings from pinned versions; include no image packs in the app bundle.

Shared rendering

Implement UnicodeEmoji and EmojiText with unsupported-sequence and network-failure fallbacks.

Existing UI integration

Cover HTML, MFM, names, bios, content warnings, picker and reactions without breaking custom emoji.

Tests

Cover ZWJ sequences, flags, skin tones, keycaps, variation selectors, unavailable assets and invalid preferences.

Visual verification

Check alignment, line wrapping, text scaling, dark/light themes and emoji-heavy posts.

Documentation

Record source versions, licenses, attribution, CDN configuration and the update procedure.

The automated tests should explicitly verify the same emoji sequence across all four mappings, fallback for sequences a particular set does not support, and preservation of server-hosted custom emoji. Run the existing frontend tests, typecheck, and production build, then visually verify the rendered content.

## Final recommendation

Implement this as emoji appearance, not as a generic font upload feature. Use remotely loaded SVG artwork for all four styles, a small generated manifest, the existing appearance-settings UI, and a shared SolidJS renderer.

This produces the most consistent result across supported browsers, avoids large downloads, keeps Twemoji and Fluent official rather than relying on unofficial font conversions, and leaves Keystone's existing typography and custom-emoji behaviour intact.
