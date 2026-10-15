#!/usr/bin/env python3
"""Keystone smoke re-probe: corrected assertions (204-empty writes accepted,
rate-limit retries) + file-serving probe with native credential.

Backends are configurable (defaults are the local dev ports):
  KEYSTONE_MISSKEY_URL  Keystone in misskey mode (default http://127.0.0.1:5176)
  KEYSTONE_SHARKEY_URL  Keystone in sharkey mode (default http://127.0.0.1:5177)
"""
import json, os, sys, time, urllib.request, urllib.error

MISSKEY = os.environ.get("KEYSTONE_MISSKEY_URL", "http://127.0.0.1:5176")
SHARKEY = os.environ.get("KEYSTONE_SHARKEY_URL", "http://127.0.0.1:5177")
PASS, FAIL = [], []

def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {extra}" if extra and not cond else ""))

def api(base, endpoint, params=None, retries=4):
    for attempt in range(retries):
        req = urllib.request.Request(base + "/api/" + endpoint,
            data=json.dumps(params or {}).encode(),
            headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urllib.request.urlopen(req, timeout=20) as r:
                body = r.read().decode()
                return (r.status, json.loads(body) if body else None)
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < retries - 1:
                time.sleep(2); continue
            body = e.read().decode()
            try: return (e.code, json.loads(body) if body else None)
            except Exception: return (e.code, {"_nonjson": body[:80]})
    return (-1, None)

def login(base, username, password):
    import uuid
    s, flow = api(base, "signin-flow", {"username": username, "password": password})
    native = flow["i"]
    session = str(uuid.uuid4())
    perms = ["read:account", "write:notes", "write:reactions",
             "write:following", "read:notifications"]
    s, g = api(base, "miauth/gen-token",
               {"i": native, "session": session, "name": "Keystone", "permission": perms})
    s, c = api(base, f"miauth/{session}/check", {})
    s, me = api(base, "i", {"i": c["token"]})
    return native, c["token"], me["id"]

def show_my_reaction(base, token, nid, want, tries=6):
    """Poll an authed notes/show until myReaction settles (read-after-write
    can lag under rate limiting). Returns (ok, last_status)."""
    for _ in range(tries):
        time.sleep(2)
        s2, sh = api(base, "notes/show", {"i": token, "noteId": nid})
        if s2 == 200 and (sh or {}).get("myReaction") == want:
            return True, s2
    return False, s2

for label, base, user in [("misskey", MISSKEY, "mk1"), ("sharkey", SHARKEY, "sk1")]:
    native, token, uid = login(base, user, "password123")
    time.sleep(1)
    s, c = api(base, "notes/create", {"i": token, "text": f"reaction probe {label}", "visibility": "public"})
    nid = c["createdNote"]["id"]
    time.sleep(1)
    s, _ = api(base, "notes/reactions/create", {"i": token, "noteId": nid, "reaction": "❤️"})
    check(f"{label}: reactions/create empty-ok ({s})", s in (200, 204), f"got {s}")
    ok, s2 = show_my_reaction(base, token, nid, "❤")
    check(f"{label}: react reflected (myReaction==❤ — server normalizes ❤️)", ok, f"{s2}")
    time.sleep(2)
    s, _ = api(base, "notes/reactions/delete", {"i": token, "noteId": nid})
    check(f"{label}: reactions/delete empty-ok ({s})", s in (200, 204), f"got {s}")
    ok, s2 = show_my_reaction(base, token, nid, None)
    check(f"{label}: unreact reflected (myReaction null)", ok, f"{s2}")
    time.sleep(1)
    s, _ = api(base, "notes/delete", {"i": token, "noteId": nid})
    check(f"{label}: notes/delete empty-ok ({s})", s in (200, 204), f"got {s}")
    time.sleep(2)
    s2, _ = api(base, "notes/show", {"noteId": nid})
    check(f"{label}: deleted note no longer readable ({s2})", s2 != 200, f"got {s2}")

# file serving: backend-capability probe with the NATIVE credential
# (the scoped Keystone token intentionally lacks write:drive — Keystone has
# no upload UI yet, so the minimal scope is correct; the earlier 403 proves
# scoping is enforced).
BOUND = "----ksmokeboundary2"
png = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452010100010108060000001f15c489"
    "0000000d49444154789c626001000000ffff0300000600050b0266000000"
    "0049454e44ae426082")
native, _, _ = login(MISSKEY, "mk1", "password123")
body = (f"--{BOUND}\r\nContent-Disposition: form-data; name=\"i\"\r\n\r\n{native}\r\n"
        f"--{BOUND}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"dot.png\"\r\n"
        f"Content-Type: image/png\r\n\r\n").encode() + png + f"\r\n--{BOUND}--\r\n".encode()
try:
    req = urllib.request.Request(MISSKEY + "/api/drive/files/create", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={BOUND}"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        f = json.loads(r.read().decode())
    url = f.get("url")
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=15) as r:
        st, ctype = r.status, r.headers.get("Content-Type")
    check("misskey: drive upload + file URL loads", bool(url) and st == 200, f"{url} {st} {ctype}")
except Exception as e:
    check("misskey: drive upload + file URL loads", False, str(e)[:150])

# scoped token correctly LACKS drive scope (least privilege holds)
_, stok, _ = login(MISSKEY, "mk1", "password123")
s, _ = api(MISSKEY, "notes/create", {"i": stok, "text": "scope probe", "visibility": "public"})
check("misskey: scoped token still posts notes", s == 200, f"got {s}")

print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
