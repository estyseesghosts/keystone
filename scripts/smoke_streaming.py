#!/usr/bin/env python3
"""Keystone <-> Misskey/Sharkey streaming smoke test. No browser: exercises
the exact /streaming wire protocol the frontend client (src/api/stream.ts)
speaks, through Keystone's own Vite proxy WS forward (the same path the
browser's WebSocket takes). Stdlib only.

Backends are configurable (defaults are the local dev ports):
  KEYSTONE_MISSKEY_URL  Keystone in misskey mode (default http://127.0.0.1:5176)
  KEYSTONE_SHARKEY_URL  Keystone in sharkey mode (default http://127.0.0.1:5177)

Covers: anonymous + authenticated connect, channel subscribe/unsubscribe
(main, homeTimeline, localTimeline, hybridTimeline, globalTimeline,
antenna), note capture (subNote/unsubNote, noteUpdated reacted/pollVoted/
deleted), notification events, silent-ignore of unauthorized channels
(the client's ack-timeout path), bad-token rejection, reconnect
resubscribe. Browser rendering of these events stays not yet verified.
"""
import base64
import hashlib
import json
import os
import socket
import struct
import sys
import time
import urllib.request
import urllib.error
import uuid

MISSKEY = os.environ.get("KEYSTONE_MISSKEY_URL", "http://127.0.0.1:5176")
SHARKEY = os.environ.get("KEYSTONE_SHARKEY_URL", "http://127.0.0.1:5177")
PASS, FAIL = [], []

FULL_PERMS = ["read:account", "write:notes", "write:reactions",
              "write:following", "read:following", "read:notifications",
              "write:notifications", "read:drive", "write:drive",
              "write:account", "write:votes"]

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
            except Exception: return (e.code, {"_nonjson": body[:80]})
    return (-1, None)

def keystone_login(base, username, password, perms=FULL_PERMS, verify=True):
    s, flow = api(base, "signin-flow", {"username": username, "password": password})
    if s != 200 or not isinstance(flow, dict) or not flow.get("finished"):
        return None, f"signin-flow: {s} {str(flow)[:100]}"
    native = flow["i"]
    session = str(uuid.uuid4())
    s, g = api(base, "miauth/gen-token",
               {"i": native, "session": session, "name": "Keystone",
                "permission": perms})
    if s != 200 or not (g or {}).get("token"):
        return None, f"gen-token: {s} {str(g)[:100]}"
    s, c = api(base, f"miauth/{session}/check", {})
    if s != 200 or not (c or {}).get("ok") or not (c or {}).get("token"):
        return None, f"check: {s} {str(c)[:100]}"
    token = c["token"]
    if not verify:
        # Narrow-scope tokens cannot read `i` (needs read:account) — the
        # caller asserts capability behavior instead of identity.
        return {"token": token, "userId": None, "username": username}, ""
    s, me = api(base, "i", {"i": token})
    if s != 200 or (me or {}).get("username") != username:
        return None, f"i: {s} {str(me)[:100]}"
    return {"token": token, "userId": me["id"], "username": username}, ""

# ---------- minimal stdlib WebSocket client (text frames + ping/pong) ----------
GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

class WSClosed(Exception):
    pass

class WS:
    def __init__(self, http_base, token=None):
        host = http_base.split("://", 1)[1]
        self.host, _, port = host.partition(":")
        self.port = int(port or 80)
        path = "/streaming" + (f"?i={token}" if token else "")
        self.sock = socket.create_connection((self.host, self.port), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        self.sock.sendall(
            f"GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\n"
            f"Sec-WebSocket-Version: 13\r\n\r\n".encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise WSClosed("handshake: connection closed")
            head += chunk
        status = head.split(b"\r\n", 1)[0].decode("latin1")
        if " 101 " not in status:
            raise WSClosed(f"handshake: {status[:60]}")
        expect = base64.b64encode(
            hashlib.sha1((key + GUID).encode()).digest()).decode()
        if expect not in head.decode("latin1"):
            raise WSClosed("handshake: bad accept key")
        self.buf = b""
        self.closed = False

    def send(self, typ, body=None):
        payload = json.dumps({"type": typ} if body is None else
                             {"type": typ, "body": body}).encode()
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        hdr = bytes([0x81])
        if len(payload) < 126:
            hdr += bytes([0x80 | len(payload)])
        elif len(payload) < 65536:
            hdr += bytes([0x80 | 126]) + struct.pack(">H", len(payload))
        else:
            hdr += bytes([0x80 | 127]) + struct.pack(">Q", len(payload))
        self.sock.sendall(hdr + mask + masked)

    def _frame(self, deadline):
        while True:
            while len(self.buf) < 2:
                chunk = self.sock.recv(65536)
                if not chunk:
                    raise WSClosed("peer closed")
                self.buf += chunk
            b1, b2 = self.buf[0], self.buf[1]
            fin, op = b1 & 0x80, b1 & 0x0F
            ln = b2 & 0x7F
            off = 2
            if ln == 126:
                while len(self.buf) < 4:
                    self.buf += self.sock.recv(65536)
                ln = struct.unpack(">H", self.buf[2:4])[0]; off = 4
            elif ln == 127:
                while len(self.buf) < 10:
                    self.buf += self.sock.recv(65536)
                ln = struct.unpack(">Q", self.buf[2:10])[0]; off = 10
            if b2 & 0x80:  # server must not mask; skip mask key if present
                off += 4
            while len(self.buf) < off + ln:
                chunk = self.sock.recv(65536)
                if not chunk:
                    raise WSClosed("peer closed")
                self.buf += chunk
                if time.monotonic() > deadline:
                    raise TimeoutError("frame timeout")
            data = self.buf[off:off + ln]
            self.buf = self.buf[off + ln:]
            if op == 0x8:
                self.closed = True
                raise WSClosed("close frame")
            if op == 0x9:  # ping -> pong
                self.sock.sendall(b"\x8a\x00")
                continue
            if op == 0xA:
                continue
            return fin, op, data

    def recv(self, timeout=20):
        deadline = time.monotonic() + timeout
        parts, first_op = [], None
        while True:
            self.sock.settimeout(max(0.1, deadline - time.monotonic()))
            try:
                fin, op, data = self._frame(deadline)
            except socket.timeout:
                raise TimeoutError("message timeout")
            if op == 0x1:
                parts, first_op = [data], op
                if fin:
                    return json.loads(b"".join(parts).decode())
            elif op == 0x0 and parts:
                parts.append(data)
                if fin:
                    return json.loads(b"".join(parts).decode())
            if time.monotonic() > deadline:
                raise TimeoutError("message timeout")

    def wait_for(self, pred, timeout=20):
        deadline = time.monotonic() + timeout
        while True:
            msg = self.recv(max(0.1, deadline - time.monotonic()))
            if pred(msg):
                return msg

    def close(self):
        try:
            self.sock.sendall(b"\x88\x00")
        except OSError:
            pass
        try:
            self.sock.close()
        except OSError:
            pass

# ---------- helpers ----------
CLEANUP_NOTES = []   # (base, token, noteId)
CLEANUP_ANTENNAS = []  # (base, token, antennaId)

def post(base, token, text, **kw):
    body = {"i": token, "text": text}
    body.update(kw)
    s, c = api(base, "notes/create", body)
    nid = ((c or {}).get("createdNote") or {}).get("id")
    if s == 200 and nid:
        CLEANUP_NOTES.append((base, token, nid))
    return s, nid

def cleanup():
    for base, token, nid in CLEANUP_NOTES:
        try:
            api(base, "notes/delete", {"i": token, "noteId": nid})
        except Exception:
            pass
    for base, token, aid in CLEANUP_ANTENNAS:
        try:
            api(base, "antennas/delete", {"i": token, "antennaId": aid})
        except Exception:
            pass

def timeline_event(base, token, channel, params, text, timeout=20, visibility="public",
                   post_token=None):
    """Connect a channel, post a note, await its streamed `note` event.

    `token` authenticates the socket; `post_token` (default: same) posts
    the bait note — anonymous sockets still need an authed poster."""
    ws = WS(base, token)
    try:
        body = {"channel": channel, "id": "k1"}
        if params:
            body["params"] = params
        ws.send("connect", body)
        time.sleep(1.0)
        s, nid = post(base, post_token or token, text, visibility=visibility)
        if s != 200 or not nid:
            return ws, (False, f"post: {s}")
        try:
            msg = ws.wait_for(
                lambda m: m.get("type") == "channel"
                and (m.get("body") or {}).get("id") == "k1"
                and (m.get("body") or {}).get("type") == "note"
                and ((m.get("body") or {}).get("body") or {}).get("id") == nid,
                timeout)
            got = ((msg.get("body") or {}).get("body") or {}).get("text") == text
            return ws, (got, "" if got else "text mismatch")
        except (TimeoutError, WSClosed) as e:
            return ws, (False, str(e))
    except WSClosed as e:
        try:
            ws.close()
        except Exception:
            pass
        return None, (False, f"connect: {e}")

# ---------- MISSKEY via :5176 ----------
mk, err = keystone_login(MISSKEY, "mk1", "password123")
check("misskey: streaming login (mk1)", mk is not None, err)
if mk:
    t = mk["token"]
    tag = uuid.uuid4().hex[:8]

    ws, (ok, extra) = timeline_event(MISSKEY, None, "globalTimeline", None,
                                    f"streamprobe-global {tag}", post_token=t)
    try:
        check("misskey: anonymous globalTimeline note event", ok, extra)
    finally:
        if ws: ws.close()

    ws, (ok, extra) = timeline_event(MISSKEY, t, "homeTimeline", None,
                                    f"streamprobe-home {tag}")
    try:
        check("misskey: authed homeTimeline note event", ok, extra)
    finally:
        if ws: ws.close()

    # antenna channel (keyword feed matching is server-side + async)
    kw = f"streamant-{tag}"
    s, ant = api(MISSKEY, "antennas/create",
                 {"i": t, "name": f"streamprobe {kw}", "src": "all",
                  "keywords": [[kw]], "excludeKeywords": [], "users": [],
                  "caseSensitive": False, "withReplies": True, "withFile": False})
    aid = (ant or {}).get("id")
    check("misskey: streaming antenna created", s == 200 and aid, f"{s}")
    if aid:
        CLEANUP_ANTENNAS.append((MISSKEY, t, aid))
        ws, (ok, extra) = timeline_event(
            MISSKEY, t, "antenna", {"antennaId": aid},
            f"bait {kw} here", timeout=60, visibility="home")
        try:
            check("misskey: antenna channel note event", ok, extra)
        finally:
            if ws: ws.close()

    # note capture: reacted + pollVoted + unsub silence + deleted
    ws = WS(MISSKEY, t)
    try:
        s, nid = post(MISSKEY, t, f"streamprobe-subnote {tag}")
        check("misskey: capture note posted", s == 200 and nid, f"{s}")
        if nid:
            ws.send("subNote", {"id": nid})
            time.sleep(1.0)
            s, _ = api(MISSKEY, "notes/reactions/create",
                       {"i": t, "noteId": nid, "reaction": "❤"})
            check("misskey: capture react posted", s in (200, 204), f"{s}")
            try:
                msg = ws.wait_for(
                    lambda m: m.get("type") == "noteUpdated"
                    and (m.get("body") or {}).get("id") == nid
                    and (m.get("body") or {}).get("type") == "reacted", 20)
                check("misskey: subNote noteUpdated reacted",
                      ((msg.get("body") or {}).get("body") or {}).get("reaction") == "❤")
            except (TimeoutError, WSClosed) as e:
                check("misskey: subNote noteUpdated reacted", False, str(e))
            ws.send("unsubNote", {"id": nid})
            time.sleep(1.0)
            api(MISSKEY, "notes/reactions/delete", {"i": t, "noteId": nid})
            leaked = []
            try:
                ws.wait_for(
                    lambda m: (leaked.append(m) or True)
                    and m.get("type") == "noteUpdated"
                    and (m.get("body") or {}).get("id") == nid, 5)
            except (TimeoutError, WSClosed):
                pass
            check("misskey: unsubNote silences noteUpdated", not leaked,
                  f"leaked {str(leaked)[:120]}")
            ws.send("subNote", {"id": nid})
            time.sleep(1.0)
            s, _ = api(MISSKEY, "notes/delete", {"i": t, "noteId": nid})
            CLEANUP_NOTES[:] = [c for c in CLEANUP_NOTES if c[2] != nid]
            check("misskey: capture note deleted (204)", s == 204, f"{s}")
            try:
                ws.wait_for(
                    lambda m: m.get("type") == "noteUpdated"
                    and (m.get("body") or {}).get("id") == nid
                    and (m.get("body") or {}).get("type") == "deleted", 20)
                check("misskey: subNote noteUpdated deleted", True)
            except (TimeoutError, WSClosed) as e:
                check("misskey: subNote noteUpdated deleted", False, str(e))
    finally:
        ws.close()

    # poll vote event
    ws = WS(MISSKEY, t)
    try:
        s, c = api(MISSKEY, "notes/create",
                   {"i": t, "text": f"streamprobe-poll {tag}",
                    "poll": {"choices": ["alpha", "beta"], "multiple": False,
                             "expiredAfter": 86400}})
        pnid = ((c or {}).get("createdNote") or {}).get("id")
        check("misskey: poll note posted", s == 200 and pnid, f"{s}")
        if pnid:
            CLEANUP_NOTES.append((MISSKEY, t, pnid))
            ws.send("subNote", {"id": pnid})
            time.sleep(1.0)
            s, _ = api(MISSKEY, "notes/polls/vote",
                       {"i": t, "noteId": pnid, "choice": 0})
            check("misskey: poll vote posted", s in (200, 204), f"{s}")
            try:
                ws.wait_for(
                    lambda m: m.get("type") == "noteUpdated"
                    and (m.get("body") or {}).get("id") == pnid
                    and (m.get("body") or {}).get("type") == "pollVoted", 20)
                check("misskey: subNote noteUpdated pollVoted", True)
            except (TimeoutError, WSClosed) as e:
                check("misskey: subNote noteUpdated pollVoted", False, str(e))
    finally:
        ws.close()

    # unknown channel must not kill the connection
    ws = WS(MISSKEY, t)
    try:
        ws.send("connect", {"channel": "noSuchChannel", "id": "bad1"})
        time.sleep(2.0)
        ws.send("connect", {"channel": "globalTimeline", "id": "g2"})
        time.sleep(1.0)
        s, nid = post(MISSKEY, t, f"streamprobe-afterbad {tag}")
        try:
            ws.wait_for(
                lambda m: m.get("type") == "channel"
                and (m.get("body") or {}).get("id") == "g2"
                and ((m.get("body") or {}).get("body") or {}).get("id") == nid, 20)
            check("misskey: unknown channel does not kill connection", True)
        except (TimeoutError, WSClosed) as e:
            check("misskey: unknown channel does not kill connection", False, str(e))
    finally:
        ws.close()

# ---------- SHARKEY via :5177 ----------
sk1, err = keystone_login(SHARKEY, "sk1", "password123")
check("sharkey: streaming login (sk1)", sk1 is not None, err)
sk2, err = keystone_login(SHARKEY, "sk2", "password123")
check("sharkey: streaming login (sk2)", sk2 is not None, err)
if sk1 and sk2:
    t1, t2 = sk1["token"], sk2["token"]
    tag = uuid.uuid4().hex[:8]

    # main channel: sk2 mentions sk1 -> sk1 gets a `notification` event
    ws = WS(SHARKEY, t1)
    try:
        ws.send("connect", {"channel": "main", "id": "main1"})
        time.sleep(1.0)
        s, nid = post(SHARKEY, t2, f"streamprobe-mention {tag} @sk1")
        check("sharkey: mention note posted", s == 200 and nid, f"{s}")
        try:
            seen = {}
            def pred(m):
                if m.get("type") == "channel" and (m.get("body") or {}).get("id") == "main1":
                    seen[(m.get("body") or {}).get("type")] = True
                    return (m.get("body") or {}).get("type") == "notification"
                return False
            ws.wait_for(pred, 20)
            check("sharkey: main channel notification event", True,
                  f"also saw: {sorted(seen)}")
        except (TimeoutError, WSClosed) as e:
            check("sharkey: main channel notification event", False, str(e))
    finally:
        ws.close()

    ws, (ok, extra) = timeline_event(SHARKEY, t1, "hybridTimeline", None,
                                    f"streamprobe-hybrid {tag}")
    try:
        check("sharkey: authed hybridTimeline note event", ok, extra)
    finally:
        if ws: ws.close()

    ws, (ok, extra) = timeline_event(SHARKEY, None, "localTimeline", None,
                                    f"streamprobe-local {tag}", post_token=t1)
    try:
        check("sharkey: anonymous localTimeline note event", ok, extra)
    finally:
        if ws: ws.close()

    # narrow-scope token: the WS gate requires read:account, so the
    # handshake itself is refused (verified in StreamingApiServerService:
    # app tokens without read:account get HTTP 401, same on both servers).
    narrow, err = keystone_login(SHARKEY, "sk1", "password123",
                               perms=["write:notes"], verify=False)
    check("sharkey: narrow-scope token minted", narrow is not None, err)
    if narrow:
        try:
            ws = WS(SHARKEY, narrow["token"])
            ws.close()
            check("sharkey: token without read:account refused at WS handshake",
                  False, "handshake succeeded")
        except WSClosed as e:
            check("sharkey: token without read:account refused at WS handshake",
                  "401" in str(e), str(e)[:60])

    # stale subscription path: a channel the server won't serve (deleted /
    # bogus antenna) gets no `connected` ack but leaves the socket open.
    # The client turns this into its per-channel "unavailable" state.
    ws = WS(SHARKEY, t1)
    try:
        ws.send("connect", {"channel": "antenna",
                            "id": "bogus1",
                            "params": {"antennaId": "bogus-antenna-id"},
                            "pong": True})
        acked = []
        try:
            ws.wait_for(
                lambda m: (acked.append(m) or True)
                and m.get("type") == "connected"
                and (m.get("body") or {}).get("id") == "bogus1", 12)
        except (TimeoutError, WSClosed):
            pass
        check("sharkey: unservable channel gets no ack (stale path)",
              not acked, f"got {str(acked)[:120]}")
        check("sharkey: unservable channel leaves socket open", not ws.closed)
    finally:
        ws.close()

    # bad token rejected at handshake
    try:
        bad = WS(SHARKEY, "BADTOKEN")
        bad.close()
        check("sharkey: bad token rejected (401)", False, "handshake succeeded")
    except WSClosed as e:
        check("sharkey: bad token rejected (401)", "401" in str(e), str(e)[:60])

    # reconnect: fresh socket resubscribes cleanly
    ws = WS(SHARKEY, t1)
    try:
        ws.send("connect", {"channel": "globalTimeline", "id": "r1"})
        time.sleep(1.0)
        ws.close()
        time.sleep(0.5)
        ws = WS(SHARKEY, t1)
        ws.send("connect", {"channel": "globalTimeline", "id": "r1"})
        time.sleep(1.0)
        s, nid = post(SHARKEY, t1, f"streamprobe-reconnect {tag}")
        try:
            ws.wait_for(
                lambda m: m.get("type") == "channel"
                and (m.get("body") or {}).get("id") == "r1"
                and ((m.get("body") or {}).get("body") or {}).get("id") == nid, 20)
            check("sharkey: resubscribe after reconnect works", True)
        except (TimeoutError, WSClosed) as e:
            check("sharkey: resubscribe after reconnect works", False, str(e))
    finally:
        ws.close()

cleanup()
print(f"\n{len(PASS)} passed, {len(FAIL)} failed")
sys.exit(1 if FAIL else 0)
