// Minimal CDP driver for Helium. No deps — global WebSocket + fetch.
// Usage: node scripts/helium.mjs <command> [args]   (CDP_PORT env overrides 9222)
//   new-tab <url>            -> prints target id
//   goto <targetId> <url>    -> navigate + wait for load
//   shot <targetId> <out> [w] [h] [mobile] -> viewport screenshot to file
//   eval <targetId> <js...>  -> print JSON of Runtime.evaluate result
//   close <targetId>
const CDP = process.env.CDP_PORT
  ? `http://127.0.0.1:${process.env.CDP_PORT}`
  : 'http://127.0.0.1:9222';

async function rpc(id, method, params = {}) {
  const r = await fetch(`${CDP}/json`);
  if (!r.ok) throw new Error(`CDP http ${r.status}`);
  return r;
}

async function targets() {
  return rpc(0).then(r => r.json());
}

function send(ws, id, method, params = {}) {
  return new Promise((resolve, reject) => {
    const onMsg = e => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.id === id) {
        ws.removeEventListener('message', onMsg);
        if (m.error) reject(new Error(JSON.stringify(m.error)));
        else resolve(m.result);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({id, method, params}));
  });
}

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, {maxPayload: 256 * 1024 * 1024});
    ws.addEventListener('open', () => resolve(ws));
    ws.addEventListener('error', reject);
  });
}

async function withPage(targetId, fn) {
  const ts = await targets();
  const t = ts.find(t => t.id === targetId && (t.type === 'page' || t.url));
  if (!t) throw new Error(`no such target ${targetId}`);
  const ws = await connect(t.webSocketDebuggerUrl);
  try {
    return await fn((method, params, id) => send(ws, id ?? 1, method, params));
  } finally {
    ws.close();
  }
}

let seq = 1;
async function call(targetId, method, params) {
  return withPage(targetId, sendFn => sendFn(method, params, seq++));
}

async function waitForLoad(targetId, timeoutMs = 45000) {
  const ws = await connect((await targets()).find(t => t.id === targetId).webSocketDebuggerUrl);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.close(); reject(new Error('load timeout')); }, timeoutMs);
    ws.addEventListener('message', e => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.method === 'Page.loadEventFired') { clearTimeout(timer); ws.close(); resolve(); }
    });
    ws.send(JSON.stringify({id: 9999, method: 'Page.enable'}));
  });
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'new-tab') {
  const r = await fetch(`${CDP}/json/new?${encodeURIComponent(args[0] ?? 'about:blank')}`, {method: 'PUT'});
  console.log((await r.json()).id);
} else if (cmd === 'goto') {
  const [targetId, url] = args;
  const p = waitForLoad(targetId).catch(e => { throw e; });
  await call(targetId, 'Page.navigate', {url});
  await p;
  console.log('loaded');
} else if (cmd === 'shot') {
  const [targetId, out, w, h, mobile] = args;
  // One connection for the whole flow: some embeds drop emulation state
  // when the last CDP client disconnects.
  const ts = await targets();
  const t = ts.find(t => t.id === targetId);
  if (!t) throw new Error(`no such target ${targetId}`);
  const ws = await connect(t.webSocketDebuggerUrl);
  let id = 1;
  const sessionCall = (method, params) => send(ws, id++, method, params);
  await sessionCall('Emulation.clearDeviceMetricsOverride');
  await sessionCall('Emulation.setDeviceMetricsOverride', {
    width: Number(w ?? 1280), height: Number(h ?? 900),
    deviceScaleFactor: 1, mobile: mobile === '1',
  });
  await new Promise(r => setTimeout(r, 1500));
  const {data} = await sessionCall('Page.captureScreenshot', {format: 'png'});
  ws.close();
  await (await import('node:fs')).promises.writeFile(out, Buffer.from(data, 'base64'));
  console.log(`wrote ${out}`);
} else if (cmd === 'eval') {
  const [targetId, ...js] = args;
  const res = await call(targetId, 'Runtime.evaluate', {
    expression: js.join(' '), returnByValue: true, awaitPromise: true,
  });
  console.log(JSON.stringify(res.result?.result?.value ?? res.result, null, 1).slice(0, 4000));
} else if (cmd === 'close') {
  await fetch(`${CDP}/json/close/${args[0]}`);
  console.log('closed');
} else if (cmd === 'typeText') {
  // typeText <targetId> <text...> — types into the focused element
  const [targetId, ...rest] = args;
  const text = rest.join(' ');
  for (const ch of text) {
    await call(targetId, 'Input.insertText', {text: ch});
  }
  console.log('typed');
} else if (cmd === 'clickText') {
  // clickText <targetId> <text> — clicks the first [role=button] whose text matches
  const [targetId, ...rest] = args;
  const want = rest.join(' ');
  const res = await call(targetId, 'Runtime.evaluate', {
    expression: `(() => { const b = Array.from(document.querySelectorAll('[role="button"]')).find(e => (e.textContent||'').trim() === ${JSON.stringify(want)}); if (!b) return 'no-btn'; const r = b.getBoundingClientRect(); return JSON.stringify({x: r.x + r.width/2, y: r.y + r.height/2}); })()`,
    returnByValue: true,
  });
  const v = res.result?.value;
  if (v === 'no-btn' || !v) { console.error('no such button'); process.exit(1); }
  const {x, y} = JSON.parse(v);
  await call(targetId, 'Input.dispatchMouseEvent', {type: 'mousePressed', x, y, button: 'left', clickCount: 1});
  await call(targetId, 'Input.dispatchMouseEvent', {type: 'mouseReleased', x, y, button: 'left', clickCount: 1});
  console.log('clicked');
} else if (cmd === 'fillInput') {
  // fillInput <targetId> <aria-label> <text> — focuses the input, selects all, types
  const [targetId, label, ...rest] = args;
  const text = rest.join(' ');
  await call(targetId, 'Runtime.evaluate', {
    expression: `(() => { const inp = document.querySelector(${JSON.stringify(`input[aria-label="${label}"]`)}); if (!inp) return 'no-input'; inp.focus(); inp.select(); return 'focused'; })()`,
    returnByValue: true,
  }).then(r => { if (r.result?.value !== 'focused') { console.error('no such input'); process.exit(1); } });
  for (const ch of text) {
    await call(targetId, 'Input.insertText', {text: ch});
  }
  console.log('typed');
} else {
  console.error('unknown command');
  process.exit(1);
}
