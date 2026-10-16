// Hosted custom emoji listing. `POST /api/emojis` returns
// `{emojis: [{name, category, url, aliases}]}` — verified live on Sharkey
// dvd.chat 2026-10-16 (public, no auth; 3,488 items / 51 categories).
// Misskey-family servers share this endpoint; Pinetree answers 404
// (unknown POST paths 404 non-JSON there) and the picker omits the
// Custom section instead of erroring.
//
// Session-cached with in-flight dedupe (translate.ts pattern): one
// network round-trip per session no matter how many pickers open.
// The URL map lives in a module-level signal so chips, the like
// button, and picker cells all re-render when it lands.

import { createSignal } from "solid-js";
import { apiCall } from "./client";
import { ApiError } from "./error";
import { BACKEND_ID } from "./backend";
import { getActiveExternal } from "./external";
import type { CustomEmoji } from "./emoji";
import { customEmojiNameFromReaction } from "./emoji";

interface EmojisResponse {
  emojis?: Array<{
    name?: unknown;
    category?: unknown;
    url?: unknown;
    aliases?: unknown;
  }>;
}

export type CustomEmojiState =
  | "idle"
  | "loading"
  | "ready"
  | "unavailable"
  | "error";

const [state, setState] = createSignal<CustomEmojiState>("idle");
const [emojiList, setEmojiList] = createSignal<CustomEmoji[]>([]);
const [urlByName, setUrlByName] = createSignal<Map<string, string>>(new Map());

let inflight: Promise<void> | null = null;
// Which target the cache was loaded from. Account switching (internal
// ↔ external) changes the emoji host, so a ready cache for another
// target does not satisfy a load.
let loadedKey: string | null = null;

function currentKey(): string {
  const ext = getActiveExternal();
  return ext ? `ext:${ext.host}` : `int:${BACKEND_ID}`;
}

/** Reactive load state for the Custom section. */
export function customEmojiState(): CustomEmojiState {
  return state();
}

/** Reactive hosted list (empty until loaded). */
export function customEmojis(): CustomEmoji[] {
  return emojiList();
}

/** Packed URL for a reaction key, or null when unknown (unicode,
 * unlisted, or not-yet-loaded). Accepts `:name:`, `:name@host:`, and
 * `:name@.:` (host reduces to the bare local name for the global
 * list). Reactive: re-evaluates when the listing lands. */
export function customEmojiUrl(reaction: string): string | null {
  const name = customEmojiNameFromReaction(reaction);
  if (name == null) return null;
  return urlByName().get(name) ?? null;
}

/** Fetch once per session. Routed via `apiCall` (not `apiCallPublic`)
 * so an active external account lists ITS instance's emoji — the
 * public helper only ever hits the internal proxy backend and fails
 * there with no local backend running. The injected `i` credential is
 * consumed by the Misskey-family auth framework and never reaches
 * endpoint validation (public timelines and `meta` already rely on
 * this). 404 → `unavailable` (no custom-emoji support on this
 * backend — the section is omitted, not an error). Any other failure
 * → `error` (the section offers a retry). */
export function loadCustomEmojis(): void {
  const key = currentKey();
  if (loadedKey === key && (state() === "ready" || state() === "unavailable")) {
    return;
  }
  if (state() === "loading" || inflight) return;
  setState("loading");
  inflight = apiCall<EmojisResponse>("emojis", {})
    .then((res) => {
      const list: CustomEmoji[] = [];
      const urls = new Map<string, string>();
      if (Array.isArray(res.emojis)) {
        for (const entry of res.emojis) {
          if (
            typeof entry?.name !== "string" ||
            typeof entry?.url !== "string" ||
            entry.name.length === 0 ||
            entry.url.length === 0
          ) {
            continue;
          }
          const aliases = Array.isArray(entry.aliases)
            ? entry.aliases.filter(
                (alias): alias is string => typeof alias === "string",
              )
            : [];
          list.push({
            name: entry.name,
            category:
              typeof entry.category === "string" ? entry.category : null,
            url: entry.url,
            aliases,
          });
          if (!urls.has(entry.name)) urls.set(entry.name, entry.url);
        }
      }
      setEmojiList(list);
      setUrlByName(urls);
      loadedKey = key;
      setState("ready");
    })
    .catch((err) => {
      // Unknown endpoint (Pinetree): honest omission, not an error.
      if (err instanceof ApiError && err.status === 404) {
        loadedKey = key;
        setState("unavailable");
      } else {
        setState("error");
      }
    })
    .finally(() => {
      inflight = null;
    });
}

/** Retry after an `error` state (no-op otherwise). */
export function retryCustomEmojis(): void {
  if (state() !== "error" || inflight) return;
  setState("idle");
  loadCustomEmojis();
}
