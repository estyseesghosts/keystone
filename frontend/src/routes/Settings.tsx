// Client settings, organized into pages like the reference client: the
// `/settings` index lists sections, each with its own detail route.
// Only sections that exist are listed — nothing inert, no stubs.
//
// - Your account (`/settings/account`): session info + sign out.
// - Accessibility and display (`/settings/display`): device-local
//   appearance (colour mode, text size), available signed out too.
// - Reactions and emoji (`/settings/reactions`): device-local like
//   emoji + favourites management (the picker right-click menu is the
//   main path; this page is the keyboard/touch equivalent).
//
// Profile editing lives ONLY on your own profile page ("Edit profile"
// button) — never in client settings.

import { For, Show } from "solid-js";
import { A, useNavigate } from "@solidjs/router";
import { useAuth } from "../state/auth";
import { TEXT_SCALE_MAX, TEXT_SCALE_MIN, useAppearance } from "../state/appearance";
import type { ColorMode } from "../state/appearance";
import { useEmojiPrefs } from "../state/emojiPrefs";
import { DEFAULT_LIKE_EMOJI } from "../api/emoji";
import { DisplayName, EmojiGlyph } from "../components/EmojiPicker";
import { BACKEND_URL } from "../api/backend";
import { displayNameOf, handleOf } from "../api/types";
import LoadingState from "../components/LoadingState";

const COLOR_MODES: Array<{ value: ColorMode; label: string; hint: string }> = [
  { value: "system", label: "Follow system", hint: "Matches your device setting" },
  { value: "light", label: "Light", hint: "Always light" },
  { value: "dark", label: "Dark", hint: "Always dark" },
];

const SECTIONS = [
  {
    href: "/settings/account",
    title: "Your account",
    hint: "Session info and sign out",
  },
  {
    href: "/settings/display",
    title: "Accessibility and display",
    hint: "Colour mode and text size",
  },
  {
    href: "/settings/reactions",
    title: "Reactions and emoji",
    hint: "Like emoji and favourites",
  },
];

/** Index: the section list. Static — no auth gate needed. */
export default function Settings() {
  return (
    <div>
      <div class="pagehead">
        <h1>Settings</h1>
      </div>
      <nav class="settings-list" aria-label="Settings sections">
        {SECTIONS.map((section) => (
          <A class="settings-row" href={section.href}>
            <span class="settings-row-text">
              <span class="settings-row-title">{section.title}</span>
              <span class="settings-row-hint">{section.hint}</span>
            </span>
            <span class="settings-row-chevron" aria-hidden="true">›</span>
          </A>
        ))}
      </nav>
    </div>
  );
}

function BackToSettings() {
  return <A class="action" href="/settings">Back to settings</A>;
}

export function AccountSettings() {
  const auth = useAuth();
  const navigate = useNavigate();

  const signout = () => {
    auth.signout();
    navigate("/login");
  };

  return (
    <Show when={auth.authReady()} fallback={<LoadingState />}>
      <div class="pagehead">
        <h1>Your account</h1>
        <BackToSettings />
      </div>
      <Show
        when={auth.me()}
        fallback={
          <div class="state">
            <p>You are signed out.</p>
            <A href="/login">Sign in</A>
          </div>
        }
      >
        {(user) => (
          <div class="settings-block">
            <p class="handle">
              {auth.isExternalActive()
                ? `External account on ${auth.activeExternalHost() ?? "unknown host"}`
                : `${auth.backendLabel} (${BACKEND_URL})`}
            </p>
            <p>
              <DisplayName name={displayNameOf(user())} packed={user().emojis} /> ({handleOf(user())})
            </p>
            <Show when={auth.isExternalActive()}>
              <p class="handle">
                Live updates are off for external accounts — timelines
                still load and refresh normally.
              </p>
            </Show>
            <p class="handle">
              To change accounts, use Switch account in the account menu.
            </p>
            <button type="button" onClick={signout}>
              Sign out
            </button>
          </div>
        )}
      </Show>
    </Show>
  );
}

function AppearanceBlock() {
  const appearance = useAppearance();

  return (
    <div class="settings-block appearance">
      <fieldset>
        <legend>Colour mode</legend>
        <div class="radio-rows">
          {COLOR_MODES.map((option) => (
            <label>
              <input
                type="radio"
                name="keystone-color-mode"
                value={option.value}
                checked={appearance.colorMode() === option.value}
                onChange={() => appearance.setColorMode(option.value)}
              />
              <span>
                {option.label}
                <span class="handle"> — {option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend>Text size</legend>
        <p class="handle">
          Scales all text across the app from 50% to 400%. Spacing,
          icons, and images stay fixed — only text changes size.
        </p>
        <div class="scale-row">
          <input
            type="range"
            id="keystone-text-scale"
            min={TEXT_SCALE_MIN}
            max={TEXT_SCALE_MAX}
            step={0.1}
            value={appearance.textScale()}
            onInput={(e) => appearance.setTextScale(parseFloat(e.currentTarget.value))}
            aria-describedby="keystone-text-scale-value"
          />
          <output id="keystone-text-scale-value" for="keystone-text-scale">
            {Math.round(appearance.textScale() * 100)}%
          </output>
        </div>
        <div class="scale-row">
          <span class="handle">{TEXT_SCALE_MIN * 100}%</span>
          <span class="spacer" aria-hidden="true" />
          <button
            type="button"
            onClick={() => appearance.setTextScale(1)}
            disabled={appearance.textScale() === 1}
          >
            Reset to 100%
          </button>
          <span class="spacer" aria-hidden="true" />
          <span class="handle">{TEXT_SCALE_MAX * 100}%</span>
        </div>
        <p class="settings-preview" aria-label="Text size preview">
          Preview: text looks like this at your chosen size.
        </p>
      </fieldset>
    </div>
  );
}

export function DisplaySettings() {
  return (
    <div>
      <div class="pagehead">
        <h1>Accessibility and display</h1>
        <BackToSettings />
      </div>
      <AppearanceBlock />
    </div>
  );
}

export function ReactionsSettings() {
  const prefs = useEmojiPrefs();
  const like = () => prefs.likeEmoji();
  const isDefault = () => like() === DEFAULT_LIKE_EMOJI;

  return (
    <div>
      <div class="pagehead">
        <h1>Reactions and emoji</h1>
        <BackToSettings />
      </div>
      <div class="settings-block">
        <h2>Like emoji</h2>
        <p class="handle">
          The like button reacts with this instead of the heart.
          Right-click any emoji in the picker to change it.
        </p>
        <p class="like-current">
          <EmojiGlyph emoji={like()} /> <span>{like()}</span>
        </p>
        <button
          type="button"
          disabled={isDefault()}
          onClick={() => prefs.resetLikeEmoji()}
        >
          Reset to heart
        </button>
      </div>
      <div class="settings-block">
        <h2>Favourites</h2>
        <p class="handle">
          Pinned at the top of the picker. Right-click any picker emoji
          to add it here.
        </p>
        <Show
          when={prefs.favourites().length > 0}
          fallback={<p class="handle">No favourites yet.</p>}
        >
          <div class="favlist">
            <For each={prefs.favourites()}>
              {(emoji) => (
                <span class="favrow">
                  <EmojiGlyph emoji={emoji} />
                  <button
                    type="button"
                    onClick={() => prefs.removeFavourite(emoji)}
                    aria-label={`Remove ${emoji} from favourites`}
                  >
                    Remove
                  </button>
                </span>
              )}
            </For>
          </div>
        </Show>
      </div>
    </div>
  );
}
