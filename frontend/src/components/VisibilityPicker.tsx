// Audience picker: a custom popup menu for post visibility, in the
// style of the reference client's reply-permission menu (icon + label
// rows, radio indicator) but monochrome and honest about Misskey
// semantics: `home` skips global timelines (unlisted), `specified`
// posts to named recipients only (direct, picked in the composer).

import { createEffect, createSignal, For, onCleanup, Show } from "solid-js";
import type { JSX } from "solid-js";
import type { NoteVisibility } from "../api/types";
import { AtIcon, GlobalIcon, HomeIcon, LockIcon } from "./icons";

interface VisibilityOption {
  value: NoteVisibility;
  label: string;
  desc: string;
  icon: JSX.Element;
}

const OPTIONS: VisibilityOption[] = [
  {
    value: "public",
    label: "Public",
    desc: "Shown everywhere",
    icon: <GlobalIcon size={18} />,
  },
  {
    value: "home",
    label: "Unlisted",
    desc: "Hidden from global timelines",
    icon: <HomeIcon size={18} />,
  },
  {
    value: "followers",
    label: "Followers only",
    desc: "Only your followers",
    icon: <LockIcon size={18} />,
  },
  {
    value: "specified",
    label: "Direct",
    desc: "Only people you name",
    icon: <AtIcon size={18} />,
  },
];

export function visibilityLabel(value: NoteVisibility): string {
  return OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function visibilityIcon(value: NoteVisibility): JSX.Element {
  return OPTIONS.find((o) => o.value === value)?.icon ?? <GlobalIcon size={18} />;
}

export default function VisibilityPicker(props: {
  value: NoteVisibility;
  onChange: (value: NoteVisibility) => void;
}) {
  const [open, setOpen] = createSignal(false);

  // The menu closes on outside click or Escape (renote-menu pattern).
  createEffect(() => {
    if (!open()) return;
    const onDocClick = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest?.(".vispick-wrap")) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("click", onDocClick);
    document.addEventListener("keydown", onKey);
    onCleanup(() => {
      document.removeEventListener("click", onDocClick);
      document.removeEventListener("keydown", onKey);
    });
  });

  const current = () => OPTIONS.find((o) => o.value === props.value) ?? OPTIONS[0];

  return (
    <span class="vispick-wrap">
      <button
        type="button"
        class="audience-pill"
        aria-haspopup="menu"
        aria-expanded={open()}
        onClick={() => setOpen((v) => !v)}
        aria-label={`Who can see this post: ${current().label}. Change audience.`}
        title={`Who can see this post: ${current().label}`}
      >
        {current().icon}
        <span>{current().label}</span>
      </button>
      <Show when={open()}>
        <div class="vispick-menu" role="menu" aria-label="Who can see this post">
          <For each={OPTIONS}>
            {(option) => (
              <button
                type="button"
                role="menuitemradio"
                aria-checked={option.value === props.value}
                class="vispick-item"
                onClick={() => {
                  props.onChange(option.value);
                  setOpen(false);
                }}
              >
                <span class="vispick-icon" aria-hidden="true">
                  {option.icon}
                </span>
                <span class="vispick-text">
                  <span class="vispick-label">{option.label}</span>
                  <span class="vispick-desc">{option.desc}</span>
                </span>
                <span
                  class={
                    option.value === props.value
                      ? "vispick-radio on"
                      : "vispick-radio"
                  }
                  aria-hidden="true"
                />
              </button>
            )}
          </For>
        </div>
      </Show>
    </span>
  );
}
