// Shared still-image wrapper (repair X7.3, media M6/M7): every feed,
// avatar, banner and emoji image routes through here so cache policy,
// list recycling, reduce-motion transitions and blurhash placeholders
// stay uniform. Callers vet URLs with `safeHttpUrl` before passing
// `uri`; a null `uri` renders only the blurhash placeholder (the
// sensitive cover path — no fetch before reveal).
import {Image as ExpoImage, type ImageContentFit, type ImageProps as ExpoImageProps} from 'expo-image'

import {useReducedMotionSetting} from '#/lib/motion'

/** Settle cross-fade for images (skipped under reduce-motion). */
export const APP_IMAGE_TRANSITION_MS = 200

export type AppImageProps = Omit<ExpoImageProps, 'source' | 'placeholder' | 'transition' | 'cachePolicy'> & {
  /** Vetted http(s) URL, or null for a placeholder-only cover. */
  uri: string | null
  /** Server blurhash (`Media.blurhash`, `Account.avatarBlurhash`): blurred
   * placeholder behind (and instead of, when `uri` is null) the image. */
  blurhash?: string | null
  contentFit?: ImageContentFit
}

export function AppImage({uri, blurhash, contentFit = 'cover', recyclingKey, autoplay = true, ...rest}: AppImageProps) {
  const reduceMotion = useReducedMotionSetting()
  return (
    <ExpoImage
      {...rest}
      source={uri ? {uri} : null}
      placeholder={blurhash ? {blurhash} : undefined}
      placeholderContentFit={contentFit}
      contentFit={contentFit}
      cachePolicy="memory-disk"
      recyclingKey={recyclingKey}
      transition={reduceMotion ? 0 : APP_IMAGE_TRANSITION_MS}
      autoplay={autoplay}
      allowDownscaling
    />
  )
}
