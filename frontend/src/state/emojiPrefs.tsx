// Emoji preferences: favourites, recently used, and the custom like
// emoji. Device-local (NOT per-backend like tokens/drafts): one shared
// set across the internal backend and every external account,
// persisted in localStorage. Per-account storage arrives with the
// Pinetree server work (owner decision 2026-10-16).
//
// List math itself is pure (`api/emoji.ts` — unit-checked); this
// module owns the signals + persistence only.

import { createContext, createSignal, useContext } from "solid-js";
import type { JSX } from "solid-js";
import {
  addFavourite as addFav,
  DEFAULT_LIKE_EMOJI,
  MAX_FAVOURITES,
  MAX_RECENTS,
  parseLikeEmoji,
  parseStoredList,
  removeFavourite as removeFav,
  touchRecent as touch,
} from "../api/emoji";

const FAVOURITES_KEY = "keystone_emoji_favs";
const RECENTS_KEY = "keystone_emoji_recents";
const LIKE_EMOJI_KEY = "keystone_like_emoji";

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function store(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the preference lasts for this session only.
  }
}

// Stored values land at module init (this module is imported by `App`
// via the provider, so before first paint — same pattern as
// `state/appearance.tsx`).
const initialFavourites = parseStoredList(
  readStored(FAVOURITES_KEY),
  MAX_FAVOURITES,
);
const initialRecents = parseStoredList(readStored(RECENTS_KEY), MAX_RECENTS);
const initialLikeEmoji = parseLikeEmoji(readStored(LIKE_EMOJI_KEY));

interface EmojiPrefsState {
  favourites: () => string[];
  recents: () => string[];
  likeEmoji: () => string;
  /** Toggle: adds when absent, removes when present. */
  toggleFavourite: (emoji: string) => void;
  removeFavourite: (emoji: string) => void;
  /** Record a successful pick (reaction or composer insert). */
  touchRecent: (emoji: string) => void;
  setLikeEmoji: (emoji: string) => void;
  resetLikeEmoji: () => void;
}

const EmojiPrefsContext = createContext<EmojiPrefsState>();

export function EmojiPrefsProvider(props: { children: JSX.Element }) {
  const [favourites, setFavourites] =
    createSignal<string[]>(initialFavourites);
  const [recents, setRecents] = createSignal<string[]>(initialRecents);
  const [likeEmoji, setLikeEmojiSignal] =
    createSignal<string>(initialLikeEmoji);

  const state: EmojiPrefsState = {
    favourites,
    recents,
    likeEmoji,
    toggleFavourite: (emoji) => {
      setFavourites((list) => {
        const next = list.includes(emoji)
          ? removeFav(list, emoji)
          : addFav(list, emoji);
        store(FAVOURITES_KEY, JSON.stringify(next));
        return next;
      });
    },
    removeFavourite: (emoji) => {
      setFavourites((list) => {
        const next = removeFav(list, emoji);
        store(FAVOURITES_KEY, JSON.stringify(next));
        return next;
      });
    },
    touchRecent: (emoji) => {
      setRecents((list) => {
        const next = touch(list, emoji);
        store(RECENTS_KEY, JSON.stringify(next));
        return next;
      });
    },
    setLikeEmoji: (emoji) => {
      const clean = emoji.trim();
      if (clean.length === 0) return;
      setLikeEmojiSignal(clean);
      store(LIKE_EMOJI_KEY, clean);
    },
    resetLikeEmoji: () => {
      setLikeEmojiSignal(DEFAULT_LIKE_EMOJI);
      store(LIKE_EMOJI_KEY, DEFAULT_LIKE_EMOJI);
    },
  };
  return (
    <EmojiPrefsContext.Provider value={state}>
      {props.children}
    </EmojiPrefsContext.Provider>
  );
}

export function useEmojiPrefs(): EmojiPrefsState {
  const state = useContext(EmojiPrefsContext);
  if (!state)
    throw new Error("useEmojiPrefs must be used inside EmojiPrefsProvider");
  return state;
}
