// Central app logger (repair X8.1: rn-ui M1; a11y 10, 14; privacy 13;
// storage S12 consumer).
//
// Levels, redaction, and an `addSink()` seam. No network sink is shipped:
// sinks are in-process only (tests, dev console, future crash-report
// wiring in its own slice). The dev console sink below holds the ONLY
// sanctioned `console.*` calls in `src/` — every other call site goes
// through this module so secrets are redacted at one boundary.
//
// Redaction rule (privacy 13): nothing logged here may carry a request
// body or a credential. `redactUrl` drops query strings (the Misskey
// `?i=` stream token lives there), credentials, and fragments;
// `stripTokens` scrubs bearer/`i`/secret shapes from free text. Both run
// on every record before any sink sees it.

import {onStorageWriteFailed} from '#/storage/storageEvents';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogRecord {
  level: LogLevel;
  /** Redacted at emit time (never a token, URL query, or body). */
  message: string;
  /** Redacted, truncated, circular-safe rendering of the detail, or null. */
  detail: string | null;
  /** `Date.now()` at emit. */
  at: number;
}

export type LogSink = (record: LogRecord) => void;

const sinks = new Set<LogSink>();

/** Add an in-process sink (tests, host wiring). Returns an unsubscribe. Never throws. */
export function addSink(sink: LogSink): () => void {
  if (typeof sink !== 'function') return () => undefined;
  sinks.add(sink);
  return () => {
    sinks.delete(sink);
  };
}

// --- Redaction ---------------------------------------------------------------

/** Marker shown in place of redacted material. Fixed text: never a secret. */
export const REDACTED = '[redacted]';

/**
 * Log-safe form of `raw`: `origin + pathname`, plus `?[redacted]` when a
 * query was present. Credentials and fragments are always dropped (the
 * `URL` origin never includes userinfo). Unparseable or missing input
 * answers a fixed marker, never the input. Pure.
 *
 * Mirrors `packages/fedi/src/core/redact.ts` on purpose: the transport
 * keeps its own dependency-free copy (fedi stays pure and barrel-untouched)
 * while this copy guards the app-side sink boundary. Both are pinned by
 * tests; keep their markers identical.
 */
export function redactUrl(raw: string | null | undefined): string {
  if (typeof raw !== 'string' || raw.length === 0) return '[no-url]';
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return '[unparseable-url]';
  }
  const base = url.origin === 'null' ? `${url.protocol}${REDACTED}` : url.origin;
  const path = url.pathname && url.pathname !== '/' ? url.pathname : '';
  const query = url.search ? `?${REDACTED}` : '';
  return `${base}${path}${query}`;
}

const TOKEN_PATTERNS: Array<{re: RegExp; replacement: string}> = [
  // `Authorization: Bearer <token>` / `Bearer <token>` (Mastodon family).
  {re: /\bBearer\s+[^\s"'{};,]+/g, replacement: `Bearer ${REDACTED}`},
  // Misskey-family `i` credential: `"i": "<token>"`, `?i=<token>`,
  // `&i=<token>`. The quoted-JSON and query forms are the only shapes the
  // transports ever print; bare prose is left alone.
  {re: /((?:["']i["']\s*[:=]\s*["']?)|(?:[?&]i=))[^"'&\s{};,]+/g, replacement: `$1${REDACTED}`},
  // OAuth/token assignments: `client_secret=…`, `"access_token": "…"`.
  // (`client_id` is public by design and stays readable.)
  {
    re: /\b(client_secret|access_token|refresh_token)\b(\s*[:=]\s*["']?)[^"'&\s{};,]+/gi,
    replacement: `$1$2${REDACTED}`,
  },
];

/**
 * Scrub credentials from free text: embedded URLs go through `redactUrl`
 * first (query tokens die there), then bearer/`i`/secret shapes are
 * masked. Never throws; never returns the input's secrets. Pure.
 */
export function stripTokens(text: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  const urlsRedacted = text.replace(/https?:\/\/[^\s"'<>]+/g, match => {
    const trail = match.match(/[.,;:!?)]+$/)?.[0] ?? '';
    const core = trail ? match.slice(0, -trail.length) : match;
    return `${redactUrl(core)}${trail}`;
  });
  return TOKEN_PATTERNS.reduce((acc, {re, replacement}) => acc.replace(re, replacement), urlsRedacted);
}

const MAX_DETAIL_CHARS = 2000;

function renderDetail(detail: unknown): string | null {
  if (detail === undefined || detail === null) return null;
  let raw: string;
  if (typeof detail === 'string') {
    raw = detail;
  } else if (detail instanceof Error) {
    raw = `${detail.name}: ${detail.message}${detail.stack ? `\n${detail.stack}` : ''}`;
  } else {
    try {
      raw = JSON.stringify(detail) ?? String(detail);
    } catch {
      raw = '[unserializable-detail]';
    }
  }
  const redacted = stripTokens(raw);
  return redacted.length > MAX_DETAIL_CHARS
    ? `${redacted.slice(0, MAX_DETAIL_CHARS)}…[truncated]`
    : redacted;
}

// --- Emit --------------------------------------------------------------------

function emit(level: LogLevel, message: string, detail?: unknown): void {
  const record: LogRecord = {
    level,
    message: stripTokens(message),
    detail: renderDetail(detail),
    at: Date.now(),
  };
  for (const sink of [...sinks]) {
    try {
      sink(record);
    } catch {
      // A failing sink must never break logging.
    }
  }
  devSink(record);
}

export function debug(message: string, detail?: unknown): void {
  emit('debug', message, detail);
}

export function info(message: string, detail?: unknown): void {
  emit('info', message, detail);
}

export function warn(message: string, detail?: unknown): void {
  emit('warn', message, detail);
}

export function error(message: string, detail?: unknown): void {
  emit('error', message, detail);
}

/** The singleton the app imports (`logger.warn(...)`). */
export const logger = {debug, info, warn, error, addSink};

// --- Dev console sink (the only sanctioned `console.*` in `src/`) ------------

function isTestEnv(): boolean {
  try {
    return typeof process !== 'undefined' && process.env.NODE_ENV === 'test';
  } catch {
    return false;
  }
}

function isDevHost(): boolean {
  try {
    return (globalThis as {__DEV__?: unknown}).__DEV__ === true;
  } catch {
    return false;
  }
}

/** Dev-only echo. Silent in tests and production. Never throws. */
function devSink(record: LogRecord): void {
  if (isTestEnv() || !isDevHost()) return;
  const line = `[keystone:${record.level}] ${record.message}`;
  const rest = record.detail ?? '';
  try {
    if (record.level === 'debug') console.debug(line, rest);
    else if (record.level === 'info') console.info(line, rest);
    else if (record.level === 'warn') console.warn(line, rest);
    else console.error(line, rest);
  } catch {
    // No console (or a throwing one) must never break the app.
  }
}

// --- X1.3 S12 consumer: storage write failures --------------------------------
//
// The `storageWriteFailed` event is wired to this logger at import time —
// importing the logger is enough to forward failures. Scope only, following
// the `storageEvents.ts` precedent (never keys, values, tokens, or bodies).

let storageWired = false;

function wireStorageFailures(): void {
  if (storageWired) return;
  storageWired = true;
  try {
    onStorageWriteFailed(failure => {
      try {
        warn('[storage] write failed', {scope: failure.scope});
      } catch {
        // Logging must never break storage.
      }
    });
  } catch {
    // Storage events unavailable: stay silent rather than crash.
  }
}

wireStorageFailures();

// --- Global handlers (wired once from `src/Root.tsx`) -------------------------

export type GlobalErrorHandler = (error: unknown, isFatal?: boolean) => void;

export interface GlobalHandlerDeps {
  errorUtils?: {
    getGlobalHandler?: () => GlobalErrorHandler | undefined;
    setGlobalHandler?: (handler: GlobalErrorHandler) => void;
  } | null;
  window?: {
    addEventListener: (type: string, listener: (event: unknown) => void) => void;
    removeEventListener: (type: string, listener: (event: unknown) => void) => void;
  } | null;
}

/** Last-resort capture shared by the global paths below. Never throws. */
export function reportGlobalError(err: unknown, fatal = false): void {
  try {
    emit('error', fatal ? '[app] fatal error' : '[app] uncaught error', err);
  } catch {
    // The global path must never throw.
  }
}

function readWindow(): GlobalHandlerDeps['window'] {
  try {
    const w = (globalThis as {window?: unknown}).window as {
      addEventListener?: unknown;
      removeEventListener?: unknown;
    } | null;
    if (
      w &&
      typeof w.addEventListener === 'function' &&
      typeof w.removeEventListener === 'function'
    ) {
      return w as GlobalHandlerDeps['window'];
    }
  } catch {
    // No window (native): the web path stays unwired.
  }
  return null;
}

/**
 * Forward `ErrorUtils` fatals (native + web JS errors) and web
 * `unhandledrejection`s to the logger. Previous handlers are called
 * through (RN's redbox/crash behaviour is preserved) and restored on
 * dispose. Pass `overrides` only in tests; production always reads the
 * real globals. Never throws.
 */
export function installGlobalErrorHandlers(overrides: GlobalHandlerDeps = {}): () => void {
  const undo: Array<() => void> = [];
  // `ErrorUtils` lives in `react-native`: require lazily so this module
  // never pulls the RN runtime into contexts that lack it.
  let errorUtils: GlobalHandlerDeps['errorUtils'] = null;
  if ('errorUtils' in overrides) {
    errorUtils = overrides.errorUtils ?? null;
  } else {
    try {
      const rn = require('react-native') as {
        ErrorUtils?: GlobalHandlerDeps['errorUtils'];
      };
      errorUtils = rn?.ErrorUtils ?? null;
    } catch {
      errorUtils = null;
    }
  }
  try {
    const set = errorUtils?.setGlobalHandler;
    if (typeof set === 'function') {
      const prev =
        typeof errorUtils?.getGlobalHandler === 'function'
          ? errorUtils.getGlobalHandler()
          : undefined;
      const handler: GlobalErrorHandler = (err, isFatal) => {
        reportGlobalError(err, isFatal === true);
        try {
          prev?.(err, isFatal);
        } catch {
          // The previous handler owns its errors.
        }
      };
      set(handler);
      undo.push(() => {
        try {
          errorUtils?.setGlobalHandler?.(prev ?? (() => undefined));
        } catch {
          // Restore is best-effort.
        }
      });
    }
  } catch {
    // ErrorUtils unavailable: skip the native path.
  }
  try {
    const win = 'window' in overrides ? (overrides.window ?? null) : readWindow();
    if (win) {
      const onRejection = (event: unknown) => {
        const reason =
          event !== null && typeof event === 'object' && 'reason' in event
            ? (event as {reason?: unknown}).reason
            : event;
        reportGlobalError(reason ?? event, false);
      };
      win.addEventListener('unhandledrejection', onRejection);
      undo.push(() => {
        try {
          win.removeEventListener('unhandledrejection', onRejection);
        } catch {
          // Remove is best-effort.
        }
      });
    }
  } catch {
    // No window (native): skip the web path.
  }
  return () => {
    for (const fn of undo) {
      try {
        fn();
      } catch {
        // Disposal never throws.
      }
    }
  };
}
