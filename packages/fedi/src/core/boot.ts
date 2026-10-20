// Boot-time hosting resolution. Runs once before the first render so every
// consumer reads a settled `getHosting()`. Never throws: any failure
// degrades to the defaults (third-party, nothing assumed about this origin)
// rather than blocking the app.
//
// Ported from old Keystone `frontend/src/core/boot.ts`, adapted for the
// pure-TS rule: no `import.meta.env`, no `location`, no build-time backend
// hint import — the host app injects `basePath`, `origin`, and the dev-only
// flavor hint explicitly.

import { loadRuntimeConfig, DEFAULT_RUNTIME_CONFIG } from "./config";
import { resolveHosting, setHosting, type HostingResolution } from "./hosting";
import type { ServerFlavor } from "./detect";

export interface BootOptions {
  /** App base path for the runtime-config lookup (`/` by default). */
  basePath?: string;
  /** This app's own origin (replaces `location.origin`). */
  origin: string;
  /** Dev-only flavor hint (replaces the old build-time `BACKEND_HINT`). */
  devFlavorHint?: ServerFlavor | null;
}

export async function bootHosting(opts: BootOptions): Promise<HostingResolution> {
  const base = opts.basePath ?? "/";
  let resolution: HostingResolution;
  try {
    const config = await loadRuntimeConfig({ base });
    resolution = await resolveHosting(config, {
      origin: opts.origin,
      devFlavorHint: opts.devFlavorHint ?? null,
    });
  } catch {
    resolution = await resolveHosting(
      { ...DEFAULT_RUNTIME_CONFIG, mode: "third-party" },
      { origin: opts.origin },
    );
  }
  setHosting(resolution);
  return resolution;
}
