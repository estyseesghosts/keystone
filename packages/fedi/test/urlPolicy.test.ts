// X2.4 outbound URL policy: exhaustive table. Every case pins the exact
// contract — public https passes; private/loopback hosts in ANY encoding,
// local names, userinfo, non-default ports, and non-https schemes fail.
import { isPublicHttpsUrl } from "../src/core/urlPolicy";

describe("isPublicHttpsUrl (X2.4)", () => {
  const cases: Array<{ url: string; want: boolean; allowHttp?: boolean }> = [
    // Public https passes.
    { url: "https://example.com/", want: true },
    { url: "https://example.com:443/x", want: true },
    { url: "https://sub.example.com/a/b?c=d#f", want: true },
    { url: "https://EXAMPLE.com/", want: true },
    { url: "https://8.8.8.8/", want: true },
    { url: "https://1.1.1.1/", want: true },
    { url: "https://172.15.0.1/", want: true },
    { url: "https://172.32.0.1/", want: true },
    { url: "https://100.63.255.255/", want: true },
    { url: "https://[2606:4700:4700::1111]/", want: true },
    { url: "https://[::ffff:8.8.8.8]/", want: true },
    { url: "https://evil.com#@example.com/", want: true },
    // Scheme: https only by default.
    { url: "http://example.com/", want: false },
    { url: "ftp://example.com/", want: false },
    { url: "javascript:alert(1)", want: false },
    { url: "data:text/html,hi", want: false },
    { url: "notaurl", want: false },
    { url: "//example.com/x", want: false },
    // Dev escape: http allowed for public hosts only.
    { url: "http://example.com/", want: true, allowHttp: true },
    { url: "http://example.com:80/", want: true, allowHttp: true },
    { url: "http://example.com:8080/", want: false, allowHttp: true },
    { url: "http://192.168.1.1/x", want: false, allowHttp: true },
    { url: "http://localhost/", want: false, allowHttp: true },
    // Ports: default only.
    { url: "https://example.com:8443/", want: false },
    { url: "https://example.com:80/", want: false },
    // Userinfo tricks.
    { url: "https://user@example.com/", want: false },
    { url: "https://user:pass@example.com/", want: false },
    { url: "https://example.com@evil.com/", want: false },
    // Trailing dot.
    { url: "https://example.com./", want: false },
    // Local names.
    { url: "https://localhost/", want: false },
    { url: "http://localhost/", want: false },
    { url: "https://foo.localhost/", want: false },
    { url: "https://foo.local/", want: false },
    { url: "https://local/", want: false },
    { url: "https://foo.internal/", want: false },
    { url: "https://internal/", want: false },
    // IPv4 dotted loopback / private / link-local / CGNAT / special.
    { url: "https://127.0.0.1/", want: false },
    { url: "https://127.1/", want: false },
    { url: "https://10.0.0.1/", want: false },
    { url: "https://192.168.1.1/", want: false },
    { url: "https://192.168.1.1/x", want: false },
    { url: "https://172.16.5.4/", want: false },
    { url: "https://172.31.255.255/", want: false },
    { url: "https://169.254.169.254/", want: false },
    { url: "https://100.64.0.1/", want: false },
    { url: "https://100.127.255.255/", want: false },
    { url: "https://0.0.0.0/", want: false },
    { url: "https://224.0.0.1/", want: false },
    { url: "https://255.255.255.255/", want: false },
    { url: "https://192.0.2.1/", want: false },
    { url: "https://198.51.100.9/", want: false },
    { url: "https://203.0.113.7/", want: false },
    // Alternate IPv4 encodings of the same private hosts.
    { url: "https://2130706433/", want: false },
    { url: "http://2130706433/", want: false },
    { url: "https://0x7f000001/", want: false },
    { url: "https://0x7f.0x0.0x0.0x1/", want: false },
    { url: "https://0x7f.1/", want: false },
    { url: "https://0177.0.0.1/", want: false },
    // Malformed numerics: neither valid IP nor valid public DNS.
    { url: "https://999.999.999.999/", want: false },
    { url: "https://1.2.3.4.5/", want: false },
    // IPv6.
    { url: "https://[::1]/", want: false },
    { url: "http://[::1]/", want: false },
    { url: "https://[::]/", want: false },
    { url: "https://[fe80::1]/", want: false },
    { url: "https://[fc00::1]/", want: false },
    { url: "https://[fd12:3456::1]/", want: false },
    { url: "https://[ff02::1]/", want: false },
    { url: "https://[2001:db8::1]/", want: false },
    { url: "https://[::ffff:192.168.1.1]/", want: false },
    { url: "https://[::ffff:10.0.0.1]/", want: false },
    // Whitespace/control smuggling and over-long input.
    { url: "https://example.com/ has space", want: false },
    { url: "https://example.com/\n", want: false },
    { url: `https://example.com/${"a".repeat(2030)}`, want: false },
  ];

  it.each(cases.map(c => [c.url, c.want, c.allowHttp ?? false] as [string, boolean, boolean]))(
    "url %s (allowHttp=%s) -> %s",
    (url, want, allowHttp) => {
      expect(isPublicHttpsUrl(url, { allowHttp })).toBe(want);
    },
  );

  it("rejects empty, null, and undefined", () => {
    expect(isPublicHttpsUrl("")).toBe(false);
    expect(isPublicHttpsUrl(null)).toBe(false);
    expect(isPublicHttpsUrl(undefined)).toBe(false);
  });
});
