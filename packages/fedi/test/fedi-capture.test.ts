// X5.6 — capture redaction golden test + dry-run capture.
//
// The capture script (`scripts/fedi-capture.ts`) is the only X5.6 step that
// runs without the rig: `--dry-run` serves canned both-family responses from
// an in-process stub (no sockets, no network) into a memory filesystem.
// The stub bodies deliberately contain secrets (credential echoes, emails,
// IPs, Bearer strings) so this file proves the golden contract: no Bearer,
// token, or email-shaped string survives in recorded output — while
// structural reaction/emoji keys (`:name@host:`) survive verbatim.

import {
  createStubFetch,
  redactRecorded,
  runCapture,
  type CaptureFileSystem,
} from "../../../scripts/fedi-capture";

const TOKEN = "CAPTURE_S3CR3T_T0KEN";
const BEARER_PROBE = "STUB_BEARER_PROBE_123";
const EMAIL = "stub-owner@example.org";
const TEXT_EMAIL = "stub-contact@example.org";
const IP = "203.0.113.7";

function memoryFs(): CaptureFileSystem & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    mkdir: async () => undefined,
    writeFile: async (path, content) => {
      files.set(path, content);
    },
    readFile: async (path) => {
      const found = files.get(path);
      if (found === undefined) throw new Error(`missing ${path}`);
      return found;
    },
  };
}

describe("redactRecorded (golden)", () => {
  it("replaces every value under a sensitive key, keeps the key", () => {
    const out = redactRecorded(
      { i: "native-credential", token: "abc", access_token: "def", nested: { email: EMAIL } },
      [TOKEN],
    ) as Record<string, unknown>;
    expect(out).toEqual({
      i: "[redacted]",
      token: "[redacted]",
      access_token: "[redacted]",
      nested: { email: "[redacted]" },
    });
  });

  it("scrubs bearer credentials, emails, IPs, and the passed secrets from free text", () => {
    const out = redactRecorded(
      {
        text: `hello — Bearer ${BEARER_PROBE}, mail ${TEXT_EMAIL}, from ${IP}, key ${TOKEN}`,
        avatarUrl: `http://${IP}/avatar.png`,
      },
      [TOKEN],
    );
    const dumped = JSON.stringify(out);
    expect(dumped).not.toContain(BEARER_PROBE);
    expect(dumped).not.toContain(EMAIL);
    expect(dumped).not.toContain(TEXT_EMAIL);
    expect(dumped).not.toContain(IP);
    expect(dumped).not.toContain(TOKEN);
    expect(dumped).toContain("Bearer [redacted]");
    expect(dumped).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
  });

  it("leaves reaction/emoji codes (:name@host:) verbatim in keys and values", () => {
    const out = redactRecorded(
      {
        reactions: { ":cat@stub.example:": 3 },
        reactionEmojis: { "cat@stub.example": "https://stub.example/emoji/cat.png" },
        rows: [{ type: ":cat@stub.example:" }],
      },
      [TOKEN],
    ) as { reactions: Record<string, number>; rows: Array<{ type: string }> };
    expect(Object.keys(out.reactions)).toEqual([":cat@stub.example:"]);
    expect(out.rows[0].type).toBe(":cat@stub.example:");
  });

  it("passes numbers, booleans, and null through untouched", () => {
    expect(redactRecorded({ n: 3, b: false, z: null, a: [1, null] }, [TOKEN])).toEqual({
      n: 3,
      b: false,
      z: null,
      a: [1, null],
    });
  });
});

describe("runCapture dry-run (stub fetch + memory fs)", () => {
  const fixedNow = "2026-10-25T00:00:00.000Z";

  function leaked(dumped: string): string[] {
    return [TOKEN, BEARER_PROBE, EMAIL, TEXT_EMAIL, IP].filter((secret) => dumped.includes(secret));
  }

  it("records every misskey target with source/version/date and no secrets", async () => {
    const fs = memoryFs();
    const report = await runCapture({
      family: "misskey",
      origin: "http://stub.local",
      token: TOKEN,
      outDir: "/out",
      includeWrites: true,
      fetchImpl: createStubFetch(),
      fsImpl: fs,
      now: () => fixedNow,
    });
    expect(report.exitCode).toBe(0);
    expect(report.rows.filter((row) => row.status === "fail")).toEqual([]);
    for (const file of [
      "misskey/meta.json",
      "misskey/me.json",
      "misskey/note.json",
      "misskey/note-reactions.json",
      "misskey/followers.json",
      "misskey/following.json",
      "misskey/mutes.json",
      "misskey/blocks.json",
      "misskey/users-search-p1.json",
      "misskey/users-search-p2.json",
      "misskey/chat-history.json",
      "misskey/note-created.json",
      "misskey/note-edited.json",
    ]) {
      expect(report.files).toContain(file);
    }
    const manifest = JSON.parse(fs.files.get("/out/manifest.json") as string) as {
      fixtures: Record<string, { source: string; version: string; recordedAt: string; endpoint: string }>;
    };
    for (const file of report.files) {
      const entry = manifest.fixtures[file];
      expect(entry.source).toBe("recorded");
      expect(entry.version).toBe("stub-0.0.0-dryrun");
      expect(entry.recordedAt).toBe(fixedNow);
      expect(typeof entry.endpoint).toBe("string");
    }
    for (const [path, content] of fs.files) {
      if (!path.endsWith(".json") || path.endsWith("manifest.json")) continue;
      expect(`${path}: ${leaked(content).join(",")}`).toBe(`${path}: `);
    }
  });

  it("records every mastodon target with source/version/date and no secrets", async () => {
    const fs = memoryFs();
    const report = await runCapture({
      family: "mastodon",
      origin: "http://stub.local",
      token: TOKEN,
      outDir: "/out",
      includeWrites: true,
      pollStatusId: "4001",
      quoteStatusId: "4001",
      fetchImpl: createStubFetch(),
      fsImpl: fs,
      now: () => fixedNow,
    });
    expect(report.exitCode).toBe(0);
    expect(report.rows.filter((row) => row.status === "fail")).toEqual([]);
    for (const file of [
      "mastodon/instance-v2.json",
      "mastodon/me.json",
      "mastodon/status.json",
      "mastodon/status-context.json",
      "mastodon/status-poll.json",
      "mastodon/status-quote-recorded.json",
      "mastodon/notifications-recorded.json",
      "mastodon/notifications-grouped-recorded.json",
      "mastodon/markers.json",
      "mastodon/status-created.json",
    ]) {
      expect(report.files).toContain(file);
    }
    const manifest = JSON.parse(fs.files.get("/out/manifest.json") as string) as {
      fixtures: Record<string, { source: string; version: string; recordedAt: string }>;
    };
    for (const file of report.files) {
      expect(manifest.fixtures[file].source).toBe("recorded");
      expect(manifest.fixtures[file].version).toBe("stub-0.0.0-dryrun");
      expect(manifest.fixtures[file].recordedAt).toBe(fixedNow);
    }
    for (const [path, content] of fs.files) {
      if (!path.endsWith(".json") || path.endsWith("manifest.json")) continue;
      expect(`${path}: ${leaked(content).join(",")}`).toBe(`${path}: `);
    }
  });
});
