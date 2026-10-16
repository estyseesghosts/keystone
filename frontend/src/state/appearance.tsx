// Appearance settings: colour mode + text size. Device-local (NOT
// per-backend like tokens/drafts): one shared preference across the
// internal backend and every external account, persisted in localStorage.
//
// - Colour mode: "light" | "dark" | "system". Applied as `data-theme`
//   on <html>: explicit light/dark beats the `prefers-color-scheme`
//   media query by specificity; "system" removes the attribute so the
//   media query governs again. Applied at module init so the stored
//   theme lands before first paint.
// - Text size: a 0.5–4x multiplier on `--text-scale`. Only prose
//   scales (note bodies, bios, composer text — see the scaled-prose
//   rule in global.css); chrome, nav, buttons, and timestamps stay
//   fixed, so this is never a full-UI zoom.

import { createContext, createSignal, useContext } from "solid-js";
import type { JSX } from "solid-js";

export type ColorMode = "light" | "dark" | "system";

export const TEXT_SCALE_MIN = 0.5;
export const TEXT_SCALE_MAX = 4;
export const TEXT_SCALE_DEFAULT = 1;

const COLOR_MODE_KEY = "keystone_color_mode";
const TEXT_SCALE_KEY = "keystone_text_scale";

/** Validated colour-mode parse: anything unknown falls back to system. Pure. */
export function parseColorMode(raw: string | null): ColorMode {
  return raw === "light" || raw === "dark" || raw === "system"
    ? raw
    : "system";
}

/** Clamp a scale into the 0.5–4x band; non-finite input resets to 1x. Pure. */
export function clampTextScale(n: number): number {
  if (!Number.isFinite(n)) return TEXT_SCALE_DEFAULT;
  return Math.min(TEXT_SCALE_MAX, Math.max(TEXT_SCALE_MIN, n));
}

/** Validated scale parse: missing/invalid storage falls back to 1x. Pure. */
export function parseTextScale(raw: string | null): number {
  if (raw == null || raw.length === 0) return TEXT_SCALE_DEFAULT;
  return clampTextScale(parseFloat(raw));
}

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

function applyAppearance(mode: ColorMode, scale: number): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (mode === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", mode);
  root.style.setProperty("--text-scale", String(scale));
}

// Stored values land before first paint: this module is imported by
// `App`, so it runs before `render()`.
const initialMode = parseColorMode(readStored(COLOR_MODE_KEY));
const initialScale = parseTextScale(readStored(TEXT_SCALE_KEY));
applyAppearance(initialMode, initialScale);

interface AppearanceState {
  colorMode: () => ColorMode;
  setColorMode: (mode: ColorMode) => void;
  textScale: () => number;
  setTextScale: (scale: number) => void;
}

const AppearanceContext = createContext<AppearanceState>();

export function AppearanceProvider(props: { children: JSX.Element }) {
  const [colorMode, setColorModeSignal] = createSignal<ColorMode>(initialMode);
  const [textScale, setTextScaleSignal] = createSignal<number>(initialScale);

  const state: AppearanceState = {
    colorMode,
    setColorMode: (mode: ColorMode) => {
      setColorModeSignal(mode);
      store(COLOR_MODE_KEY, mode);
      applyAppearance(mode, textScale());
    },
    textScale,
    setTextScale: (scale: number) => {
      const clamped = clampTextScale(scale);
      setTextScaleSignal(clamped);
      store(TEXT_SCALE_KEY, String(clamped));
      applyAppearance(colorMode(), clamped);
    },
  };
  return (
    <AppearanceContext.Provider value={state}>
      {props.children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance(): AppearanceState {
  const state = useContext(AppearanceContext);
  if (!state) throw new Error("useAppearance must be used inside AppearanceProvider");
  return state;
}
