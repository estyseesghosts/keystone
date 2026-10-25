// Outbound URL policy: one shared predicate deciding whether the device
// may fetch a server-influenced URL without user action.
//
// `isPublicHttpsUrl` answers that question. `https:` only (a dev-only
// `allowHttp` escape exists for rigs), no userinfo, no explicit
// non-default port, and a host that is not a loopback, private, link-local,
// CGNAT, multicast, or otherwise non-public address — in ANY encoding
// (dotted decimal, short forms like `127.1`, decimal `2130706433`, hex,
// octal, IPv6) — and not a local name (`localhost`, `*.localhost`,
// `*.local`, `*.internal`), with no trailing-dot form. Anything else
// returns false; callers degrade to their safe fallback (basic card, raw AP
// id), never an error.
//
// Pure TS: no imports, no network, no DNS. A hostname that is not an IP
// literal but resolves to a private address (DNS rebinding, split-horizon
// intranet DNS) cannot be detected here — that needs resolver support the
// device does not expose, so it stays out of scope.

export interface UrlPolicyOptions {
  /** Permit `http:` (dev rigs only). Every host rule still applies. */
  allowHttp?: boolean;
}

/** URLs longer than this are rejected outright (same bound as `safeUrl`). */
const MAX_URL_LENGTH = 2048;

/** Inner text of an IPv6 literal in URL form (`[::1]` -> `::1`). */
function stripBrackets(host: string): string | null {
  if (host.startsWith("[") && host.endsWith("]") && host.length >= 2) {
    return host.slice(1, -1);
  }
  return null;
}

/** Standard `inet_aton` part: decimal, octal (leading `0`), hex (`0x`). */
function parseIPv4Part(part: string): number | null {
  if (part.length === 0) return null;
  let digits = part;
  let base = 10;
  if (part.startsWith("0x") || part.startsWith("0X")) {
    base = 16;
    digits = part.slice(2);
    if (!/^[0-9a-fA-F]+$/.test(digits)) return null;
  } else if (part.length > 1 && part.startsWith("0")) {
    base = 8;
    if (!/^[0-7]+$/.test(part)) return null;
  } else if (!/^[0-9]+$/.test(part)) {
    return null;
  }
  const n = parseInt(digits, base);
  if (!Number.isSafeInteger(n) || n < 0 || n > 0xffffffff) return null;
  return n;
}

/**
 * Parse dotted/short/decimal/hex/octal IPv4 to a uint32, or null when the
 * host is not an IPv4 literal in any accepted encoding. Follows the
 * `inet_aton` shape browsers use: 1-4 parts, all but the last a single
 * byte, the last spanning the remaining bytes.
 */
function parseIPv4(host: string): number | null {
  const parts = host.split(".");
  if (parts.length < 1 || parts.length > 4) return null;
  const nums: number[] = [];
  for (const part of parts) {
    const n = parseIPv4Part(part);
    if (n === null) return null;
    nums.push(n >>> 0);
  }
  for (let i = 0; i < nums.length - 1; i++) {
    if (nums[i] > 255) return null;
  }
  const last = nums[nums.length - 1];
  const tailBytes = 5 - nums.length;
  let maxLast = 255;
  for (let i = 0; i < tailBytes; i++) maxLast = maxLast * 256 + 255;
  if (last > maxLast) return null;
  if (nums.length === 1) return nums[0] >>> 0;
  let n = nums[0];
  for (let i = 1; i < nums.length - 1; i++) n = n * 256 + nums[i];
  n = n * Math.pow(256, tailBytes) + last;
  return n >>> 0;
}

/** True for public unicast IPv4: none of the non-public ranges below. */
function isPublicIPv4(n: number): boolean {
  // [base, prefix bits]: this-net, RFC1918, CGNAT, loopback, link-local,
  // protocol assignments, TEST-NET-1/2/3, benchmarking, multicast, reserved.
  const blocked: Array<[number, number]> = [
    [0x00000000, 8],
    [0x0a000000, 8],
    [0x64400000, 10],
    [0x7f000000, 8],
    [0xa9fe0000, 16],
    [0xac100000, 12],
    [0xc0000000, 24],
    [0xc0000200, 24],
    [0xc0a80000, 16],
    [0xc6120000, 15],
    [0xc6336400, 24],
    [0xcb007100, 24],
    [0xe0000000, 4],
    [0xf0000000, 4],
  ];
  for (const [base, bits] of blocked) {
    const shift = 32 - bits;
    if (n >>> shift === base >>> shift) return false;
  }
  return true;
}

function packIPv6(groups: number[]): Uint8Array {
  const out = new Uint8Array(16);
  for (let i = 0; i < 8; i++) {
    out[i * 2] = (groups[i] >>> 8) & 0xff;
    out[i * 2 + 1] = groups[i] & 0xff;
  }
  return out;
}

/** Parse an IPv6 literal (with `::` compression and embedded IPv4). */
function parseIPv6(text: string): Uint8Array | null {
  if (text.length === 0 || text.includes("%")) return null;
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parseSide = (side: string): number[] | null => {
    if (side === "") return [];
    const groups = side.split(":");
    const out: number[] = [];
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      if (g.includes(".")) {
        // Embedded IPv4 is only valid as the final group.
        if (i !== groups.length - 1) return null;
        const v4 = parseIPv4(g);
        if (v4 === null) return null;
        out.push((v4 >>> 16) & 0xffff, v4 & 0xffff);
      } else {
        if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
        out.push(parseInt(g, 16));
      }
    }
    return out;
  };
  if (halves.length === 1) {
    const groups = parseSide(halves[0]);
    if (!groups || groups.length !== 8) return null;
    return packIPv6(groups);
  }
  const head = parseSide(halves[0]);
  const tail = parseSide(halves[1]);
  if (!head || !tail) return null;
  // `::` must compress at least one group.
  if (head.length + tail.length > 7) return null;
  const groups = [...head, ...new Array(8 - head.length - tail.length).fill(0), ...tail];
  return packIPv6(groups);
}

/** True for public unicast IPv6 (loopback, link-local, ULA, multicast out). */
function isPublicIPv6(bytes: Uint8Array): boolean {
  let allZero = true;
  for (const b of bytes) {
    if (b !== 0) {
      allZero = false;
      break;
    }
  }
  if (allZero) return false; // ::
  // ::1
  let isLoopback = true;
  for (let i = 0; i < 15; i++) {
    if (bytes[i] !== 0) {
      isLoopback = false;
      break;
    }
  }
  if (isLoopback && bytes[15] === 1) return false;
  // ::ffff:0:0/96 — IPv4-mapped: the embedded address decides.
  let mapped = true;
  for (let i = 0; i < 10; i++) {
    if (bytes[i] !== 0) {
      mapped = false;
      break;
    }
  }
  if (mapped && bytes[10] === 0xff && bytes[11] === 0xff) {
    const v4 = (bytes[12] * 0x1000000 + (bytes[13] << 16) + (bytes[14] << 8) + bytes[15]) >>> 0;
    return isPublicIPv4(v4);
  }
  if (bytes[0] === 0xff) return false; // ff00::/8 multicast
  if (bytes[0] === 0xfe && (bytes[1] & 0xc0) === 0x80) return false; // fe80::/10
  if ((bytes[0] & 0xfe) === 0xfc) return false; // fc00::/7 unique-local
  // 2001:db8::/32 documentation — never a real fetch target
  // (bytes are 20 01 0d b8: group 0x2001, group 0x0db8).
  if (bytes[0] === 0x20 && bytes[1] === 0x01 && bytes[2] === 0x0d && bytes[3] === 0xb8) return false;
  return true;
}

/**
 * True when the hostname is a public DNS name or a public IP literal.
 * Local names, IP literals in non-public ranges (any encoding), and
 * malformed numeric lookalikes are all false.
 */
function isPublicHost(host: string): boolean {
  if (host.length === 0) return false;
  const lower = host.toLowerCase();
  // Trailing dot (`example.com.`): reject the trick form outright rather
  // than normalizing it — public fetches never need it.
  if (lower.endsWith(".")) return false;
  if (lower === "localhost" || lower.endsWith(".localhost")) return false;
  if (lower === "local" || lower.endsWith(".local")) return false;
  if (lower === "internal" || lower.endsWith(".internal")) return false;
  const v6 = stripBrackets(lower);
  if (v6 !== null) {
    const bytes = parseIPv6(v6);
    if (bytes === null) return false;
    return isPublicIPv6(bytes);
  }
  // A colon outside brackets is never valid here (ports are split out by
  // URL already; zone ids have no business in a fetch target).
  if (lower.includes(":")) return false;
  const v4 = parseIPv4(lower);
  if (v4 !== null) return isPublicIPv4(v4);
  // Parses as neither v4 nor v6 but looks numeric (digits, dots, hex):
  // `999.1.1.1`, `1.2.3.4.5`, `0x1234567890123`, bare `1234`. Reject
  // rather than letting a resolver decide what it means.
  if (/[0-9]/.test(lower) && /^[0-9a-fx.]+$/i.test(lower)) return false;
  return true;
}

/**
 * Whether the device may fetch this server-influenced URL without user
 * action. `https:` only unless `allowHttp` is set (dev rigs), no userinfo,
 * no explicit non-default port, and a public host (see `isPublicHost`).
 * Pure; relative URLs, wrong schemes, and over-long inputs are false.
 */
export function isPublicHttpsUrl(raw: string | null | undefined, opts: UrlPolicyOptions = {}): boolean {
  if (typeof raw !== "string") return false;
  if (raw.length === 0 || raw.length > MAX_URL_LENGTH) return false;
  // Browsers strip ASCII whitespace/control when resolving, so a naive
  // prefix check can be tricked — reject up front.
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code <= 0x20 || code === 0x7f) return false;
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  const allowHttp = opts.allowHttp === true;
  if (url.protocol === "https:") {
    if (url.port !== "" && url.port !== "443") return false;
  } else if (allowHttp && url.protocol === "http:") {
    if (url.port !== "" && url.port !== "80") return false;
  } else {
    return false;
  }
  if (url.username !== "" || url.password !== "") return false;
  return isPublicHost(url.hostname);
}
