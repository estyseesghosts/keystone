import {createNavigationContainerRef} from '@react-navigation/native'

import type {RootParamList} from '#/routes'

// Root navigation ref, shared by the container (`#/Navigation`) and by
// components that navigate from outside a screen's own navigator
// (`SignInButton`). Lives in its own module — no expo-linking import here —
// so presentational trees can reference it without evaluating the deep-link
// table at import time.
export const navigationRef = createNavigationContainerRef<
  RootParamList & {Main: undefined}
>()
