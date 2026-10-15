#!/usr/bin/env python3
"""Capability probe for roadmap features: drive/antennas/search/polls/etc.
Read-only where possible; writes use throwaway notes/files and clean up."""
import json, sys, time, uuid, urllib.request, urllib.error

BASES = {
    "misskey": "http://127.0.0.1:5176",
    "sharkey": "http://127.0.0.1:5177",
    "pinetree": "http://127.0.0.1:5173",
}

def api(base, endpoint, params=None, retries=3):
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
            except Exception: return (e.code, {"_nonjson": body[:100]})
    return (-1, None)

def login(base, username, password):
    s, flow = api(base, "signin-flow", {"username": username, "password": password})
    if s != 200 or not isinstance(flow, dict) or not flow.get("finished"):
        return None, None, f"signin-flow {s} {str(flow)[:120]}"
    native = flow["i"]
    session = str(uuid.uuid4())
    perms = ["read:account", "write:notes", "write:reactions",
             "write:following", "read:notifications"]
    s, g = api(base, "miauth/gen-token",
               {"i": native, "session": session, "name": "Keystone", "permission": perms})
    if s != 200 or not (g or {}).get("token"):
        return None, None, f"gen-token {s} {str(g)[:120]}"
    s, c = api(base, f"miauth/{session}/check", {})
    tok = (c or {}).get("token")
    if s != 200 or not (c or {}).get("ok") or not tok:
        return None, None, f"check {s} {str(c)[:120]}"
    return native, tok, ""

PINETREE_CREDS = None
def plogin():
    global PINETREE_CREDS
    if PINETREE_CREDS: return PINETREE_CREDS
    s, r = api("http://127.0.0.1:5173", "signin", {"username": "alice", "password": "password123"})
    if s != 200:
        # try discovering a user
        s, r = api("http://127.0.0.1:5173", "signin", {"username": "test", "password": "password123"})
    print("pinetree signin:", s, str(r)[:200])
    PINETREE_CREDS = (s, r)
    return PINETREE_CREDS

tokens = {}
for label, base, user in [("misskey", BASES["misskey"], "mk1"), ("sharkey", BASES["sharkey"], "sk1")]:
    native, tok, err = login(base, user, "password123")
    print(f"{label}: login {'OK' if tok else 'FAIL ' + err} native_len={len(native) if native else 0}")
    tokens[label] = (native, tok)

def show(label, endpoint, base_label, params, note=""):
    base = BASES[base_label]
    s, r = api(base, endpoint, params)
    body = json.dumps(r)[:220] if r is not None else "empty"
    print(f"[{base_label}] {endpoint} -> {s} {body} {note}")

for label in ["misskey", "sharkey"]:
    native, tok = tokens[label]
    print(f"===== {label} (scoped token) =====")
    show("meta?", "meta", label, {})
    show("instance?", "instance", label, {})
    show("drive/files", "drive/files", label, {"i": tok, "limit": 5})
    show("drive/folders", "drive/folders", label, {"i": tok, "limit": 5})
    show("antennas/list", "antennas/list", label, {"i": tok})
    show("notes/search", "notes/search", label, {"i": tok, "query": "hello", "limit": 5})
    show("search-by-tag", "notes/search-by-tag", label, {"tag": "x", "limit": 5})
    show("users/search", "users/search", label, {"query": "sk", "limit": 5})
    show("users/followers", "users/followers", label, {"userId": "x", "limit": 5})
    show("users/following", "users/following", label, {"userId": "x", "limit": 5})
    show("following/requests/list", "following/requests/list", label, {"i": tok})
    show("notifications/mark-all", "notifications/mark-all-as-read", label, {"i": tok})
    show("i/read-all-notifications", "i/read-all-notifications", label, {"i": tok})
    show("notes/unrenote", "notes/unrenote", label, {"i": tok, "noteId": "000000000000000000000000"})
    show("notes/polls/vote", "notes/polls/vote", label, {"i": tok, "noteId": "000000000000000000000000", "choice": 0})
    show("i/update probe", "i/update", label, {"i": tok})
    show("notes/create poll?", "notes/create", label, {"i": tok, "text": "pollprobe-should-not-post", "visibility": "followers", "poll": {"choices": ["a", "b"]}})
    print(f"===== {label} (native token, drive scope) =====")
    show("drive/files native", "drive/files", label, {"i": native, "limit": 3})
    show("antennas/list native", "antennas/list", label, {"i": native})

print("===== pinetree =====")
spt, rpt = plogin()
ptok = (rpt or {}).get("token") if isinstance(rpt, dict) else None
print("pinetree token:", bool(ptok))
if ptok:
    for ep, p in [("drive/files", {"limit": 5}), ("antennas/list", {}),
                  ("notes/search", {"query": "hello", "limit": 5}),
                  ("users/search", {"query": "a", "limit": 5}),
                  ("notes/unrenote", {"noteId": "x"}),
                  ("instance", {}), ("meta", {})]:
        show(ep, ep, "pinetree", {"i": ptok, **p})
