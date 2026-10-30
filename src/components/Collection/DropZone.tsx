// DropZone (P6.6 slice 2, DC-11): native passthrough. The web
// implementation lives in `DropZone.web.tsx` (HTML5 DnD); on native
// there is no cross-platform DnD, so this renders children unchanged.

import type {ReactNode} from 'react';

export interface DropZoneProps {
  children: ReactNode;
  testID?: string;
}

export function DropZone({children}: DropZoneProps) {
  return <>{children}</>;
}
