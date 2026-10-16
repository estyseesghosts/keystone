// Inline SVG icons (monochrome, currentColor). No emoji in controls.
import type { JSX } from "solid-js";

function Base(props: { size?: number; children: JSX.Element }) {
  const size = () => props.size ?? 16;
  return (
    <svg
      width={size()}
      height={size()}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  );
}

export function HeartIcon(props: { filled?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={props.filled ? "currentColor" : "none"}
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z" />
    </svg>
  );
}

export function ReplyIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
    </svg>
  );
}

export function RepostIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </svg>
  );
}

export function SmileIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M8 14s1.5 2 4 2 4-2 4-2" />
      <line x1="9" x2="9.01" y1="9" y2="9" />
      <line x1="15" x2="15.01" y1="9" y2="9" />
    </svg>
  );
}

// --- Composer toolbar icons (same stroke style as the set above) ---

export function MediaIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.5-3.5a2 2 0 0 0-3 0L6 20" />
    </Base>
  );
}

export function PollIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <line x1="18" x2="18" y1="20" y2="10" />
      <line x1="12" x2="12" y1="20" y2="4" />
      <line x1="6" x2="6" y1="20" y2="14" />
    </Base>
  );
}

export function ScheduleIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" x2="16" y1="2" y2="6" />
      <line x1="8" x2="8" y1="2" y2="6" />
      <line x1="3" x2="21" y1="10" y2="10" />
      <circle cx="12" cy="16" r="1" />
    </Base>
  );
}

export function LockIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Base>
  );
}

export function AtIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <circle cx="12" cy="12" r="4" />
      <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-4 8" />
    </Base>
  );
}

export function PencilIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    </Base>
  );
}

// --- Sidebar navigation icons (stroke style matches the set above) ---

export function HomeIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <path d="M3 9.5 12 3l9 6.5V20a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      <path d="M9 22v-8h6v8" />
    </Base>
  );
}

export function LocalIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </Base>
  );
}

export function GlobalIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </Base>
  );
}

export function SearchIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </Base>
  );
}

export function DriveIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </Base>
  );
}

export function AntennaIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9" />
      <path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5" />
      <circle cx="12" cy="12" r="2" />
      <path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5" />
      <path d="M19.1 4.9C23 8.8 23 15.1 19.1 19" />
    </Base>
  );
}

export function BellIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
    </Base>
  );
}

export function LoginIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
      <path d="m10 17 5-5-5-5" />
      <path d="M15 12H3" />
    </Base>
  );
}

export function LogoutIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Base>
  );
}

export function CollapseIcon(props: { size?: number; expanded: boolean }) {
  return (
    <Base size={props.size ?? 18}>
      {props.expanded ? (
        <>
          <path d="m11 17-5-5 5-5" />
          <path d="m18 17-5-5 5-5" />
        </>
      ) : (
        <>
          <path d="m13 17 5-5-5-5" />
          <path d="m6 17 5-5-5-5" />
        </>
      )}
    </Base>
  );
}

// --- Account-menu icons (same stroke style as the set above) ---

export function ProfileIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </Base>
  );
}

export function SettingsIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </Base>
  );
}

export function SwitchIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <path d="M16 3h5v5" />
      <path d="M8 21H3v-5" />
      <path d="M21 3l-7 7" />
      <path d="M3 21l7-7" />
    </Base>
  );
}
