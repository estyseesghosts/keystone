// URL redaction for logs (repair X2.3, networking L5).
//
// The Misskey WebSocket URL carries the token (`?i=`), and no debug
// output may ever carry it (proxy/server logs are bad enough). Any
// code that must name a URL in an error or log passes it through
// `redactUrl` first: origin + path survive, the query becomes a fixed
// marker, credentials and fragments are dropped.
//
// Pure TS: no `react`, `react-native`, `expo*`, `#/` imports, no
// `window`/`document`. `URL` is a language global, not a UI global.

/** Marker shown in place of a redacted query string. Fixed text: never a secret. */
export const REDACTED_QUERY = "[redacted]";

/**
 * Log-safe form of `raw`: `origin + pathname`, plus `?[redacted]` when a
 * query was present, with credentials and fragments always dropped.
 * Unparseable or missing input answers a fixed marker (never the input).
 * Pure.
 */
export function redactUrl(raw: string | null | undefined): string {
  if (typeof raw !== "string" || raw.length === 0) return "[no-url]";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "[unparseable-url]";
  }
  const base = url.origin === "null" ? `${url.protocol}${REDACTED_QUERY}` : url.origin;
  const path = url.pathname && url.pathname !== "/" ? url.pathname : "";
  const query = url.search ? `?${REDACTED_QUERY}` : "";
  return `${base}${path}${query}`;
}
