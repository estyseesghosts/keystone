// Static loading skeletons: grey placeholder blocks shaped like the content
// they stand in for (note cards, tiles, rows). Deliberately unanimated —
// the product palette allows no decorative motion. Each group carries
// role="status" with a screen-reader label; the blocks themselves are
// aria-hidden.

import { For } from "solid-js";
import type { JSX } from "solid-js";

function Status(props: { label: string; children: JSX.Element }) {
  return (
    <div role="status" aria-label={props.label}>
      <span class="sr-only">{props.label}</span>
      <div aria-hidden="true">{props.children}</div>
    </div>
  );
}

function repeat(count: number): undefined[] {
  return Array.from({ length: Math.max(1, count) });
}

/** A feed of note-card placeholders shaped like `.note` rows. */
export function NoteSkeletonList(props: { count?: number; label?: string }) {
  return (
    <Status label={props.label ?? "Loading notes…"}>
      <div class="feed">
        <For each={repeat(props.count ?? 3)}>
          {() => (
            <div class="note">
              <span class="skel skel-circle" style={{ width: "40px", height: "40px", "flex-shrink": "0" }} />
              <div class="note-main">
                <span class="skel" style={{ width: "42%", height: "14px", "margin-bottom": "8px" }} />
                <span class="skel" style={{ width: "96%", height: "12px", "margin-bottom": "6px" }} />
                <span class="skel" style={{ width: "72%", height: "12px", "margin-bottom": "10px" }} />
                <span class="skel" style={{ width: "48%", height: "12px" }} />
              </div>
            </div>
          )}
        </For>
      </div>
    </Status>
  );
}

/** Profile header placeholder (avatar + name + bio lines). */
export function ProfileSkeleton(props: { label?: string }) {
  return (
    <Status label={props.label ?? "Loading profile…"}>
      <div class="note">
        <span class="skel skel-circle" style={{ width: "64px", height: "64px", "flex-shrink": "0" }} />
        <div class="note-main">
          <span class="skel" style={{ width: "38%", height: "16px", "margin-bottom": "8px" }} />
          <span class="skel" style={{ width: "60%", height: "12px", "margin-bottom": "6px" }} />
          <span class="skel" style={{ width: "85%", height: "12px" }} />
        </div>
      </div>
    </Status>
  );
}

/** Notification-row placeholders. */
export function NotificationSkeletonList(props: { count?: number; label?: string }) {
  return (
    <Status label={props.label ?? "Loading notifications…"}>
      <div class="feed">
        <For each={repeat(props.count ?? 4)}>
          {() => (
            <div class="note">
              <span class="skel skel-circle" style={{ width: "40px", height: "40px", "flex-shrink": "0" }} />
              <div class="note-main">
                <span class="skel" style={{ width: "55%", height: "12px", "margin-bottom": "6px" }} />
                <span class="skel" style={{ width: "80%", height: "12px" }} />
              </div>
            </div>
          )}
        </For>
      </div>
    </Status>
  );
}

/** Generic `.drivefile`-style row placeholders (users, antennas, files). */
export function RowSkeletonList(props: { count?: number; label?: string }) {
  return (
    <Status label={props.label ?? "Loading…"}>
      <div class="feed">
        <For each={repeat(props.count ?? 3)}>
          {() => (
            <div class="drivefile">
              <span class="skel" style={{ width: "48px", height: "48px", "flex-shrink": "0" }} />
              <div style={{ flex: 1 }}>
                <span class="skel" style={{ width: "45%", height: "13px", "margin-bottom": "6px" }} />
                <span class="skel" style={{ width: "70%", height: "12px" }} />
              </div>
            </div>
          )}
        </For>
      </div>
    </Status>
  );
}

/** Mosaic-grid placeholders for image/video sections. */
export function MosaicSkeleton(props: { count?: number; label?: string }) {
  return (
    <Status label={props.label ?? "Loading media…"}>
      <div class="mosaic" style={{ padding: "0.27em 1.07em 0.53em" }}>
        <For each={repeat(props.count ?? 6)}>
          {() => <span class="skel" style={{ width: "100%", "aspect-ratio": "1" }} />}
        </For>
      </div>
    </Status>
  );
}

/** Miniplayer-row placeholders for the audio section. */
export function AudioSkeletonList(props: { count?: number; label?: string }) {
  return (
    <Status label={props.label ?? "Loading audio…"}>
      <div style={{ padding: "0.27em 1.07em 0.53em" }}>
        <For each={repeat(props.count ?? 2)}>
          {() => (
            <div class="audiorow">
              <div class="audio-main">
                <span class="skel" style={{ width: "50%", height: "14px", "margin-bottom": "6px" }} />
                <span class="skel" style={{ width: "75%", height: "12px", "margin-bottom": "8px" }} />
                <span class="skel" style={{ width: "100%", height: "32px" }} />
              </div>
            </div>
          )}
        </For>
      </div>
    </Status>
  );
}

/** Category-box placeholders for the Drive landing view. */
export function DriveBoxesSkeleton() {
  return (
    <div class="drivecats" aria-hidden="true">
      <For each={repeat(3)}>
        {() => <span class="skel" style={{ height: "76px", "border-radius": "6px" }} />}
      </For>
    </div>
  );
}
