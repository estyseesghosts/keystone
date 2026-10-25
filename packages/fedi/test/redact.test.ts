// `redactUrl` (repair X2.3, networking L5): debug output never carries
// credentials or query secrets (the Misskey `?i=` stream token).
import { redactUrl } from "../src/core/redact";

describe("redactUrl", () => {
  it("keeps origin + path, replacing the query with a fixed marker", () => {
    expect(redactUrl("wss://mk.example/streaming?i=tok")).toBe(
      "wss://mk.example/streaming?[redacted]",
    );
    expect(redactUrl("https://a.b/x?y=1&z=2")).toBe("https://a.b/x?[redacted]");
  });

  it("strips credentials, fragments, and trailing-slash roots", () => {
    expect(redactUrl("https://user:pass@a.b/x")).toBe("https://a.b/x");
    expect(redactUrl("https://a.b/x#frag")).toBe("https://a.b/x");
    expect(redactUrl("https://a.b/x?y=1#f")).toBe("https://a.b/x?[redacted]");
    expect(redactUrl("https://a.b")).toBe("https://a.b");
    expect(redactUrl("https://a.b/")).toBe("https://a.b");
    expect(redactUrl("ws://localhost:3000/streaming")).toBe(
      "ws://localhost:3000/streaming",
    );
  });

  it("answers fixed markers for missing or unparseable input", () => {
    expect(redactUrl(null)).toBe("[no-url]");
    expect(redactUrl(undefined)).toBe("[no-url]");
    expect(redactUrl("")).toBe("[no-url]");
    expect(redactUrl("not a url")).toBe("[unparseable-url]");
  });

  it("never leaks the token or userinfo", () => {
    const token = "tok-secret-123";
    const out = redactUrl(`wss://mk.example/streaming?i=${token}`);
    expect(out).not.toContain(token);
    expect(out).not.toContain("?i=");
    const cred = redactUrl("https://user:pass@a.b/");
    expect(cred).not.toContain("user");
    expect(cred).not.toContain("pass");
  });
});
