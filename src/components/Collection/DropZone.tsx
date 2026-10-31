// DropZone (P6.6 slice 2, DC-11): native passthrough. The web
// implementation lives in `DropZone.web.tsx` (HTML5 DnD); on native
// there is no cross-platform DnD, so this renders children unchanged.

import type {ReactNode} from 'react';

export interface DropZoneProps {
  children: ReactNode;
  /** Current target folder id (null = root). Web-only; ignored on native. */
  targetKey?: string | null;
  targetName?: string;
  draggedKeys?: () => string[];
  onFiles?: (files: File[], targetKey: string | null) => void;
  onItems?: (keys: string[], targetKey: string | null) => void;
  testID?: string;
}

export function DropZone({children}: DropZoneProps) {
  return <>{children}</>;
}
