import {Platform} from 'react-native'

// Web focus-ring kill for composer text inputs. `outlineWidth: 0` plus a
// transparent color do NOT kill every UA's `auto`-style ring (one
// survived both in production), so the style itself must go: no engine
// paints an outline whose style is `none`. RN's `TextStyle` omits the
// value but RNW passes it straight to CSS (verified against its style
// compiler), hence the one cast, kept here so call sites stay honest.
// Native gets null (a no-op spread) — text inputs there show no ring.
export const NO_OUTLINE =
  Platform.OS === 'web'
    ? ({outlineStyle: 'none'} as unknown as {outlineStyle: 'solid'})
    : null
