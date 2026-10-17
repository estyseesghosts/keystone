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

/** Three-dot "more options" trigger (composer toolbar). Stroke rings read
 * at small sizes without a fill dependency in either theme. */
export function MoreIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <circle cx="5" cy="12" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="19" cy="12" r="1" />
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

// Note "⋯" options menu (NoteMenu.tsx). Every glyph is distinct within
// a visible menu (tier 1 and the User submenu show together).

export function CopyContentsIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </Base>
  );
}

export function LinkIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Base>
  );
}

/** Chain link (upper left) with a globe in the lower right: a remote
 * identifier, distinct from the plain LinkIcon. */
export function RemoteLinkIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <path d="M9 9.5l-2.6 2.6a2.8 2.8 0 0 0 4 4L13 13.5" />
      <path d="M11 6.5l.9-.9a2.8 2.8 0 0 1 4 4L13.5 12" />
      <circle cx="17" cy="17" r="4" />
      <path d="M13 17h8" />
      <path d="M17 13c-1.4 1.3-1.4 6.7 0 8" />
    </Base>
  );
}

export function ExternalLinkIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <path d="M15 3h6v6" />
      <path d="M10 14L21 3" />
    </Base>
  );
}

export function ShareIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="M8.59 13.51l6.83 3.98" />
      <path d="M15.41 6.51l-6.82 3.98" />
    </Base>
  );
}

/** "文A" — a CJK glyph beside a Latin A, the translate convention. */
export function TranslateIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <path d="M3 6h7" />
      <path d="M6.5 3.5V6" />
      <path d="M4 10c1.5-.5 3.5-1.5 5-3" />
      <path d="M14 20l3.5-9 3.5 9" />
      <path d="M15.3 17h4.4" />
    </Base>
  );
}

export function BellOffIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      <path d="M18.63 13A17.9 17.9 0 0 1 18 8" />
      <path d="M6.26 6.26A5.86 5.86 0 0 0 6 8c0 7-3 9-3 9h14" />
      <path d="M18 8a6 6 0 0 0-9.33-5" />
      <path d="M1 1l22 22" />
    </Base>
  );
}

export function UserIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </Base>
  );
}

/** Person with a link chain: the profile URL (not the note link). */
export function ProfileLinkIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0 1 9-5.2" />
      <path d="M16 15.5l-1.5 1.5a2.1 2.1 0 0 0 3 3l1.5-1.5" />
      <path d="M18.5 12.5l1.5-1.5a2.1 2.1 0 0 0-3-3l-1.5 1.5" />
    </Base>
  );
}

/** Person with an outbound arrow in the lower right: a remote profile. */
export function RemoteUserIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <circle cx="9" cy="8" r="3.5" />
      <path d="M3 20a6 6 0 0 1 9-5.2" />
      <path d="M15 14h6v6" />
      <path d="M21 14l-7 7" />
    </Base>
  );
}

export function ReportIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </Base>
  );
}

export function DeleteIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </Base>
  );
}

export function StarIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </Base>
  );
}

export function ClipIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
    </Base>
  );
}

/** Crossed-out cloud: the thread/user mute glyph (cloud = Misskey's mute). */
export function MuteIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
      <path d="M3 3l18 18" />
    </Base>
  );
}

export function BlockIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <circle cx="12" cy="12" r="10" />
      <path d="M4.93 4.93l14.14 14.14" />
    </Base>
  );
}

export function RssIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <circle cx="5" cy="19" r="1" />
      <path d="M4 11a9 9 0 0 1 9 9" />
      <path d="M4 4a16 16 0 0 1 16 16" />
    </Base>
  );
}

export function ListIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <path d="M8 6h13" />
      <path d="M8 12h13" />
      <path d="M8 18h13" />
      <path d="M3 6h.01" />
      <path d="M3 12h.01" />
      <path d="M3 18h.01" />
    </Base>
  );
}

export function MailIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <rect x="2" y="4" width="20" height="16" rx="2" />
      <path d="M22 6l-10 7L2 6" />
    </Base>
  );
}

/** Pencil resting on a baseline: a memo, distinct from PencilIcon. */
export function MemoIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <path d="M4 20h16" />
      <path d="M14.5 4.5l5 5L9 20H4v-5L14.5 4.5z" />
    </Base>
  );
}

export function RefreshIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 18}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36L21 8" />
      <path d="M21 3v5h-5" />
    </Base>
  );
}

/** Submenu indicator. Secondary to the row glyph, so it may repeat. */
export function ChevRightIcon(props: { size?: number }) {
  return (
    <Base size={props.size ?? 14}>
      <path d="M9 6l6 6-6 6" />
    </Base>
  );
}
