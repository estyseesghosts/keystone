#!/usr/bin/env python3
"""Keystone <-> Misskey/Sharkey smoke test. No browser: exercises every
Keystone user flow through Keystone's own Vite proxy transport (the exact
HTTP the browser performs), plus static checks on the frontend source.

Backends are configurable (defaults are the local dev ports):
  KEYSTONE_MISSKEY_URL  Keystone in misskey mode (default http://127.0.0.1:5176)
  KEYSTONE_SHARKEY_URL  Keystone in sharkey mode (default http://127.0.0.1:5177)
"""
import json, os, sys, urllib.request, urllib.error

MISSKEY = os.environ.get("KEYSTONE_MISSKEY_URL", "http://127.0.0.1:5176")
SHARKEY = os.environ.get("KEYSTONE_SHARKEY_URL", "http://127.0.0.1:5177")
PASS, FAIL = [], []

def check(name, cond, extra=""):
    (PASS if cond else FAIL).append(name)
    print(f"[{'PASS' if cond else 'FAIL'}] {name}" + (f" — {extra}" if extra and not cond else ""))

def api(base, endpoint, params=None, raw=False):
    req = urllib.request.Request(base + "/api/" + endpoint,
        data=json.dumps(params or {}).encode(),
        headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            body = r.read().decode()
            return (r.status, json.loads(body) if body else None)
    except urllib.error.HTTPError as e:
        body = e.read().decode()
        if raw: return (e.code, body)
        try: return (e.code, json.loads(body) if body else None)
        except Exception: return (e.code, {"_nonjson": body[:80]})

def get(base, path):
    req = urllib.request.Request(base + path, method="GET")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return (r.status, r.read()[:120])
    except urllib.error.HTTPError as e:
        return (e.code, e.read()[:120])

def keystone_login(base, username, password):
    """The exact Keystone-owned flow: signin-flow -> permission grant ->
    gen-token -> miauth check. All JSON POST, zero redirects."""
    import uuid
    s, flow = api(base, "signin-flow", {"username": username, "password": password})
    if s != 200 or not isinstance(flow, dict) or not flow.get("finished"):
        return None, f"signin-flow: {s} {str(flow)[:100]}"
    native = flow["i"]
    session = str(uuid.uuid4())
    perms = ["read:account", "write:notes", "write:reactions",
             "write:following", "read:notifications"]
    s, g = api(base, "miauth/gen-token",
               {"i": native, "session": session, "name": "Keystone",
                "permission": perms})
    if s != 200 or not g.get("token"):
        return None, f"gen-token: {s} {str(g)[:100]}"
    s, c = api(base, f"miauth/{session}/check", {})
    if s != 200 or not c.get("ok") or not c.get("token"):
        return None, f"check: {s} {str(c)[:100]}"
    token = c["token"]
    s, me = api(base, "i", {"i": token})
    if s != 200 or me.get("username") != username:
        return None, f"i: {s} {str(me)[:100]}"
    return {"token": token, "userId": me["id"], "username": username}, ""

# ---------- 1. backend-only mode ----------
for name, direct in [("misskey", "http://127.0.0.1:3101"),
                      ("sharkey", "http://127.0.0.1:3102")]:
    st, _ = get(direct, "/")
    check(f"{name}: built-in web UI disabled (GET / -> 404)", st == 404, f"got {st}")
    st, _ = get(direct, "/miauth/probe-session-123")
    check(f"{name}: hosted MiAuth page gone (-> 404)", st == 404, f"got {st}")
    st, _ = api(direct, "meta", {})
    check(f"{name}: API alive (POST /api/meta -> 200)", st == 200, f"got {st}")

# ---------- 2. Keystone login on both ----------
mk, err = keystone_login(MISSKEY, "mk1", "password123")
check("misskey: Keystone login (signin-flow->grant->gen-token->check->i)", mk is not None, err)
sk, err = keystone_login(SHARKEY, "sk1", "password123")
check("sharkey: Keystone login (signin-flow->grant->gen-token->check->i)", sk is not None, err)
if not mk or not sk:
    print(f"\n{len(PASS)} passed, {len(FAIL)} failed"); sys.exit(1)

# ---------- 3. session isolation ----------
s, _ = api(SHARKEY, "i", {"i": mk["token"]})
check("isolation: misskey token rejected by sharkey (401)", s == 401, f"got {s}")
s, _ = api(MISSKEY, "i", {"i": sk["token"]})
check("isolation: sharkey token rejected by misskey (401)", s == 401, f"got {s}")

# ---------- 4. read ops ----------
for label, base, sess in [("misskey", MISSKEY, mk), ("sharkey", SHARKEY, sk)]:
    t = sess["token"]
    s, tl = api(base, "notes/timeline", {"i": t, "limit": 5})
    check(f"{label}: home timeline", s == 200 and isinstance(tl, list), f"{s}")
    s, lt = api(base, "notes/local-timeline", {"limit": 5})
    check(f"{label}: local timeline (public)", s == 200 and isinstance(lt, list), f"{s}")
    s, gt = api(base, "notes/global-timeline", {"limit": 5})
    check(f"{label}: global timeline (public)", s == 200 and isinstance(gt, list), f"{s}")
    s, u = api(base, "users/show", {"userId": sess["userId"]})
    check(f"{label}: profile users/show", s == 200 and u.get("id") == sess["userId"], f"{s}")
    s, un = api(base, "users/notes", {"userId": sess["userId"], "limit": 5})
    check(f"{label}: profile notes users/notes", s == 200 and isinstance(un, list), f"{s}")
    s, nt = api(base, "i/notifications", {"i": t, "limit": 20})
    ok = s == 200 and isinstance(nt, list) and all("isRead" not in n for n in nt)
    check(f"{label}: notifications (no isRead field)", ok, f"{s}")

# ---------- 5. write ops ----------
for label, base, sess in [("misskey", MISSKEY, mk), ("sharkey", SHARKEY, sk)]:
    t = sess["token"]
    tag = "ksmoke-mk" if label == "misskey" else "ksmoke-sk"
    s, c = api(base, "notes/create",
               {"i": t, "text": f"hello from keystone smoke {tag}", "visibility": "public"})
    note = (c or {}).get("createdNote")
    check(f"{label}: post note", s == 200 and note and note.get("id"), f"{s}")
    nid = note["id"]
    s, sh = api(base, "notes/show", {"noteId": nid})
    check(f"{label}: open note shows posted text",
          s == 200 and sh.get("text", "").endswith(tag), f"{s}")
    s, r = api(base, "notes/create",
               {"i": t, "text": f"reply {tag}", "replyId": nid})
    rid = (r or {}).get("createdNote", {}).get("id")
    check(f"{label}: reply", s == 200 and rid, f"{s}")
    s, reps = api(base, "notes/replies", {"noteId": nid, "limit": 10})
    check(f"{label}: reply visible in notes/replies",
          s == 200 and any(n.get("id") == rid for n in reps), f"{s}")
    s, _ = api(base, "notes/reactions/create",
               {"i": t, "noteId": nid, "reaction": "❤️"})
    s2, sh2 = api(base, "notes/show", {"noteId": nid})
    check(f"{label}: react reflected by server",
          s == 200 and sh2.get("myReaction") == "❤️", f"{s}/{s2}")
    s, _ = api(base, "notes/reactions/delete", {"i": t, "noteId": nid})
    s2, sh3 = api(base, "notes/show", {"noteId": nid})
    check(f"{label}: unreact reflected by server",
          s == 200 and sh3.get("myReaction") is None, f"{s}/{s2}")
    s, rn = api(base, "notes/create", {"i": t, "renoteId": nid})
    rnid = (rn or {}).get("createdNote", {}).get("id")
    check(f"{label}: repost creates exactly one note", s == 200 and rnid, f"{s}")
    s, _ = api(base, "notes/delete", {"i": t, "noteId": rnid})
    s2, _ = api(base, "notes/show", {"noteId": rnid})
    check(f"{label}: delete repost (show then errors)", s == 200 and s2 != 200, f"{s}/{s2}")
    s, _ = api(base, "notes/delete", {"i": t, "noteId": rid})
    check(f"{label}: delete reply", s == 200, f"{s}")

# follow/unfollow on sharkey (sk1 -> sk2)
s, sk2 = api(SHARKEY, "users/show", {"username": "sk2"})
sk2id = (sk2 or {}).get("id")
s, f = api(SHARKEY, "following/create", {"i": sk["token"], "userId": sk2id})
s2, u2 = api(SHARKEY, "users/show", {"i": sk["token"], "userId": sk2id})
check("sharkey: follow (server reports isFollowing)",
      s == 200 and u2.get("isFollowing") is True, f"{s}/{s2}")
s, _ = api(SHARKEY, "following/delete", {"i": sk["token"], "userId": sk2id})
s2, u3 = api(SHARKEY, "users/show", {"i": sk["token"], "userId": sk2id})
check("sharkey: unfollow (server reports not following)",
      s == 200 and not u3.get("isFollowing"), f"{s}/{s2}")

# ---------- 6. media serving ----------
import io, mimetypes
BOUND = "----ksmokeboundary"
png = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452010100010108060000001f15c489"
    "0000000d49444154789c626001000000ffff0300000600050b0266000000"
    "0049454e44ae426082")
def upload(base, token):
    body = (f"--{BOUND}\r\nContent-Disposition: form-data; name=\"i\"\r\n\r\n{token}\r\n"
            f"--{BOUND}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"dot.png\"\r\n"
            f"Content-Type: image/png\r\n\r\n").encode() + png + f"\r\n--{BOUND}--\r\n".encode()
    req = urllib.request.Request(base + "/api/drive/files/create", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={BOUND}"}, method="POST")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())
try:
    f = upload(MISSKEY, mk["token"])
    url = f.get("url")
    req = urllib.request.Request(url, method="GET")
    with urllib.request.urlopen(req, timeout=15) as r:
        st = r.status
    check("misskey: drive upload + file URL loads", bool(url) and st == 200, url)
except Exception as e:
    check("misskey: drive upload + file URL loads", False, str(e)[:120])

print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
