#!/usr/bin/env python3
"""Keystone feature contract tests (roadmap P0-P4 slices).

Exercises every NEW capability through Keystone's own Vite proxy transport
(the exact HTTP the browser performs), using the full least-privilege
permission set from frontend/src/api/backend.ts. Self-cleaning: every note,
file, antenna, vote, and follow created here is removed afterwards.

Backends are configurable (defaults are the local dev ports):
  KEYSTONE_MISSKEY_URL  Keystone in misskey mode (default http://127.0.0.1:5176)
  KEYSTONE_SHARKEY_URL  Keystone in sharkey mode (default http://127.0.0.1:5177)

Exit non-zero on any failure.
"""
import json, os, sys, time, uuid, urllib.request, urllib.error

MISSKEY = os.environ.get("KEYSTONE_MISSKEY_URL", "http://127.0.0.1:5176")
SHARKEY = os.environ.get("KEYSTONE_SHARKEY_URL", "http://127.0.0.1:5177")
PASS, FAIL = [], []

# Mirror of KEYSTONE_PERMISSIONS in frontend/src/api/backend.ts.
FULL_PERMS = ["read:account", "write:notes", "write:reactions",
              "write:following", "read:following", "read:notifications",
              "write:notifications", "read:drive", "write:drive",
              "write:account", "write:votes"]
MIN_PERMS = ["read:account", "write:notes", "write:reactions",
             "write:following", "read:notifications"]

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
                time.sleep(3); continue
            body = e.read().decode()
            try: return (e.code, json.loads(body) if body else None)
            except Exception: return (e.code, {"_nonjson": body[:100]})
    return (-1, None)

def login(base, username, password, perms):
    s, flow = api(base, "signin-flow", {"username": username, "password": password})
    if s != 200 or not isinstance(flow, dict) or not flow.get("finished"):
        return None, None, f"signin-flow {s} {str(flow)[:100]}"
    native = flow["i"]
    session = str(uuid.uuid4())
    s, g = api(base, "miauth/gen-token",
               {"i": native, "session": session, "name": "Keystone", "permission": perms})
    if s != 200 or not (g or {}).get("token"):
        return None, None, f"gen-token {s} {str(g)[:100]}"
    s, c = api(base, f"miauth/{session}/check", {})
    if s != 200 or not (c or {}).get("ok") or not (c or {}).get("token"):
        return None, None, f"check {s} {str(c)[:100]}"
    return native, c["token"], ""

BOUND = "----kfeatboundary"
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452010100010108060000001f15c489"
    "0000000d49444154789c626001000000ffff0300000600050b0266000000"
    "0049454e44ae426082")

def upload(base, token, filename="dot.png"):
    body = (f"--{BOUND}\r\nContent-Disposition: form-data; name=\"i\"\r\n\r\n{token}\r\n"
            f"--{BOUND}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{filename}\"\r\n"
            f"Content-Type: image/png\r\n\r\n").encode() + PNG + f"\r\n--{BOUND}--\r\n".encode()
    req = urllib.request.Request(base + "/api/drive/files/create", data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={BOUND}"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return (r.status, json.loads(r.read().decode()))
    except urllib.error.HTTPError as e:
        b = e.read().decode()
        try: return (e.code, json.loads(b))
        except Exception: return (e.code, {"_nonjson": b[:100]})

# ---------- cleanup of earlier probe litter ----------
for label, base, user in [("misskey", MISSKEY, "mk1"), ("sharkey", SHARKEY, "sk1")]:
    native, tok, err = login(base, user, "password123", FULL_PERMS)
    if not tok:
        check(f"{label}: login with full permission set", False, err)
        continue
    check(f"{label}: login with full permission set", True)
    time.sleep(1)
    # users/notes needs a userId; resolve via i
    s, me = api(base, "i", {"i": tok})
    uid = (me or {}).get("id")
    s, notes = api(base, "users/notes", {"i": tok, "userId": uid, "limit": 50})
    if s == 200:
        for n in notes:
            if "pollprobe-should-not-post" in (n.get("text") or ""):
                api(base, "notes/delete", {"i": tok, "noteId": n["id"]})
                print(f"  cleaned probe note {n['id']} on {label}")

    # ---------- drive round-trip ----------
    st, f = upload(base, tok)
    fid = (f or {}).get("id") if isinstance(f, dict) else None
    check(f"{label}: drive upload with scoped token (write:drive)", st == 200 and fid, f"{st}")
    if fid:
        time.sleep(1)
        s, files = api(base, "drive/files", {"i": tok, "limit": 10})
        check(f"{label}: drive list contains upload",
              s == 200 and any(x.get("id") == fid for x in (files or [])), f"{s}")
        s, upd = api(base, "drive/files/update", {"i": tok, "fileId": fid, "isSensitive": True})
        check(f"{label}: drive mark sensitive", s == 200 and (upd or {}).get("isSensitive") is True, f"{s}")
        s, c = api(base, "notes/create", {"i": tok, "text": "drive attach probe", "visibility": "followers", "fileIds": [fid]})
        nid = ((c or {}).get("createdNote") or {}).get("id")
        ok = s == 200 and nid
        check(f"{label}: post with fileIds", ok, f"{s}")
        if ok:
            time.sleep(1)
            # Authenticated read: anonymous notes/show strips files on
            # followers-visible notes (misskey) or 403s (sharkey). The UI
            # always reads with the session token when signed in.
            s, sh = api(base, "notes/show", {"i": tok, "noteId": nid})
            check(f"{label}: attachment visible after reload",
                  s == 200 and any(x.get("id") == fid for x in (sh or {}).get("files", [])), f"{s}")
            api(base, "notes/delete", {"i": tok, "noteId": nid})
        s, _ = api(base, "drive/files/delete", {"i": tok, "fileId": fid})
        check(f"{label}: drive delete", s in (200, 204), f"{s}")

    # ---------- antennas CRUD + feed ----------
    s, alist = api(base, "antennas/list", {"i": tok})
    check(f"{label}: antennas/list with read:account", s == 200 and isinstance(alist, list), f"{s}")
    kw = f"kfeat-{uuid.uuid4().hex[:8]}"
    body = {"name": f"kfeat {kw}", "src": "all", "keywords": [[kw]],
            "excludeKeywords": [], "users": [], "caseSensitive": False,
            "withReplies": True, "withFile": False}
    s, ant = api(base, "antennas/create", {"i": tok, **body})
    aid = (ant or {}).get("id")
    check(f"{label}: antennas/create", s == 200 and aid, f"{s} {str(ant)[:120]}")
    if aid:
        s, upd = api(base, "antennas/update", {"i": tok, "antennaId": aid, **{**body, "name": f"kfeat-renamed {kw}"}})
        check(f"{label}: antennas/update reconciles",
              s == 200 and (upd or {}).get("name", "").startswith("kfeat-renamed"), f"{s}")
        s, c = api(base, "notes/create", {"i": tok, "text": f"antenna bait {kw}", "visibility": "home"})
        bait = ((c or {}).get("createdNote") or {}).get("id")
        found, anotes = False, []
        for _ in range(6):
            time.sleep(5)
            s, anotes = api(base, "antennas/notes", {"i": tok, "antennaId": aid, "limit": 20})
            if s == 200 and any(n.get("id") == bait for n in (anotes or [])):
                found = True
                break
        check(f"{label}: antenna feed matches keyword note", found, f"last={s}")
        if bait:
            api(base, "notes/delete", {"i": tok, "noteId": bait})
        s, _ = api(base, "antennas/delete", {"i": tok, "antennaId": aid})
        s2, alist2 = api(base, "antennas/list", {"i": tok})
        check(f"{label}: antennas/delete removes it",
              s in (200, 204) and not any(a.get("id") == aid for a in (alist2 or [])), f"{s}/{s2}")

    # ---------- polls ----------
    s, c = api(base, "notes/create", {"i": tok, "text": "poll probe", "visibility": "followers",
                                      "poll": {"choices": ["alpha", "beta"], "multiple": False, "expiredAfter": 86400}})
    pnid = ((c or {}).get("createdNote") or {}).get("id")
    check(f"{label}: create note with poll", s == 200 and pnid, f"{s} {str(c)[:150]}")
    if pnid:
        time.sleep(2)
        s, _ = api(base, "notes/polls/vote", {"i": tok, "noteId": pnid, "choice": 0})
        time.sleep(2)
        # Authenticated read: poll/isVoted are only packed with a credential
        # (same class as myReaction), so assert against an authed show.
        s2, sh = api(base, "notes/show", {"i": tok, "noteId": pnid})
        poll = (sh or {}).get("poll") or {}
        voted = any(ch.get("isVoted") for ch in poll.get("choices", []))
        check(f"{label}: poll vote reflected by server", s in (200, 204) and voted, f"{s}/{s2}")
        api(base, "notes/delete", {"i": tok, "noteId": pnid})

    # ---------- unrenote ----------
    s, c = api(base, "notes/create", {"i": tok, "text": "unrenote probe", "visibility": "followers"})
    onid = ((c or {}).get("createdNote") or {}).get("id")
    if onid:
        time.sleep(1)
        s, _ = api(base, "notes/create", {"i": tok, "renoteId": onid})
        time.sleep(2)
        s, _ = api(base, "notes/unrenote", {"i": tok, "noteId": onid})
        check(f"{label}: notes/unrenote", s in (200, 204), f"{s}")
        api(base, "notes/delete", {"i": tok, "noteId": onid})

    # ---------- search ----------
    s, u = api(base, "users/search", {"i": tok, "query": user, "limit": 5})
    check(f"{label}: users/search (authed)", s == 200 and isinstance(u, list), f"{s}")
    s, t = api(base, "notes/search-by-tag", {"tag": "x", "limit": 5})
    check(f"{label}: notes/search-by-tag", s == 200 and isinstance(t, list), f"{s}")
    s, r = api(base, "notes/search", {"i": tok, "query": "hello", "limit": 5})
    check(f"{label}: notes/search policy-disabled (400 UNAVAILABLE)",
          s == 400 and (r or {}).get("error", {}).get("code") == "UNAVAILABLE", f"{s} {str(r)[:100]}")

    # ---------- profile edit round-trip ----------
    s, me = api(base, "i", {"i": tok})
    orig_desc = (me or {}).get("description")
    marker = f"kfeat-bio-{uuid.uuid4().hex[:6]}"
    s, upd = api(base, "i/update", {"i": tok, "description": marker})
    check(f"{label}: i/update description",
          s == 200 and (upd or {}).get("description") == marker, f"{s}")
    api(base, "i/update", {"i": tok, "description": orig_desc})

    # ---------- mark all read ----------
    s, _ = api(base, "notifications/mark-all-as-read", {"i": tok})
    check(f"{label}: notifications/mark-all-as-read", s in (200, 204), f"{s}")

    # ---------- old-scope token gets an honest 403 ----------
    _, oldtok, _ = login(base, user, "password123", MIN_PERMS)
    if oldtok:
        s, r = api(base, "drive/files", {"i": oldtok, "limit": 1})
        check(f"{label}: pre-scope token denied drive (403, re-sign hint path)",
              s == 403, f"{s}")

# ---------- locked-account follow stays pending (sharkey: sk1 -> sk2) ----------
_, sk1, _ = login(SHARKEY, "sk1", "password123", FULL_PERMS)
native2, _, _ = login(SHARKEY, "sk2", "password123", FULL_PERMS)
if sk1 and native2:
    s, sk2u = api(SHARKEY, "users/show", {"username": "sk2"})
    sk2id = (sk2u or {}).get("id")
    api(SHARKEY, "i/update", {"i": native2, "isLocked": True})
    time.sleep(1)
    api(SHARKEY, "following/create", {"i": sk1, "userId": sk2id})
    time.sleep(1)
    s, after = api(SHARKEY, "users/show", {"i": sk1, "userId": sk2id})
    check("sharkey: locked follow is pending, not accepted",
          s == 200 and not after.get("isFollowing")
          and after.get("hasPendingFollowRequestFromYou") is True, f"{s} {str(after)[:200]}")
    api(SHARKEY, "following/requests/cancel", {"i": sk1, "userId": sk2id})
    time.sleep(1)
    s, after2 = api(SHARKEY, "users/show", {"i": sk1, "userId": sk2id})
    check("sharkey: cancel follow request clears pending",
          s == 200 and not after2.get("hasPendingFollowRequestFromYou"), f"{s}")
    api(SHARKEY, "i/update", {"i": native2, "isLocked": False})

print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
