#!/usr/bin/env node
// cdp-input.mjs — send TRUSTED keyboard/mouse input to a live Chrome tab (port 9222).
// Synthetic JS events (isTrusted=false) are ignored by Sheets' find bar, name box,
// and grid navigation — the Input domain delivers real OS-level events.
//
// Usage:
//   node cdp-input.mjs <url-substring> <action> [args...]
// Actions:
//   key <key>            press a key: Enter, Tab, Escape, Home, End, F, G, A...
//                        prefixes: ctrl+<key>, shift+<key>, ctrl+shift+<key> (e.g. ctrl+f)
//   type <text>          type text via Input.insertText (trusted)
//   nav <dir> [count]    arrow navigation: up|down|left|right (default 1)
//   click <css-selector> real mouse click at the element's center (Input.dispatchMouseEvent)
// Examples:
//   node cdp-input.mjs "1TCKJxeq8" key ctrl+f
//   node cdp-input.mjs "1TCKJxeq8" type "105513345"
//   node cdp-input.mjs "1TCKJxeq8" key Enter
//   node cdp-input.mjs "1TCKJxeq8" nav down 8
//   node cdp-input.mjs "1TCKJxeq8" click "#t-name-box"
const [, , urlSub, action, ...args] = process.argv;
if (!urlSub || !action) {
  console.error('Usage: node cdp-input.mjs <url-substring> <key|type|nav|click> [args...]');
  process.exit(1);
}

const VK = { ENTER: 13, TAB: 9, ESCAPE: 27, HOME: 36, END: 35, UP: 38, DOWN: 40, LEFT: 37, RIGHT: 39, F: 70, G: 71, A: 65, C: 67, V: 86, BACKSPACE: 8, DELETE: 46, PAGEDOWN: 34, PAGEUP: 33 };
const MOD = { ctrl: 2, shift: 4, alt: 1, meta: 8 };

const tabs = await (await fetch('http://localhost:9222/json/list')).json();
const tab = tabs.find((t) => t.type === 'page' && t.url.includes(urlSub));
if (!tab) { console.error(`No open tab matching "${urlSub}"`); process.exit(1); }
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((res) => (ws.onopen = res));

let msgId = 0;
const pending = new Map();
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) => new Promise((res) => {
  const id = ++msgId;
  pending.set(id, res);
  ws.send(JSON.stringify({ id, method, params }));
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function keyPress(key, modifiers = 0) {
  const code = VK[key.toUpperCase()];
  if (!code) { console.error(`unknown key: ${key}`); process.exit(1); }
  const base = { modifiers, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code };
  await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
  await sleep(120);
}

async function typeText(text) {
  await send('Input.insertText', { text });
  await sleep(100);
}

async function nav(dir, count) {
  const key = dir[0].toUpperCase() + dir.slice(1);
  for (let i = 0; i < count; i++) await keyPress(key);
}

async function clickSel(sel) {
  const r = await send('Runtime.evaluate', {
    expression: `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
    returnByValue: true,
  });
  const p = r.result?.result?.value;
  if (!p) { console.error(`element not found: ${sel}`); process.exit(1); }
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: p.x, y: p.y, button: 'left', clickCount: 1 });
  await sleep(300);
}

try {
  if (action === 'key') {
    const spec = args[0] || '';
    let modifiers = 0;
    let key = spec;
    if (spec.includes('+')) {
      const parts = spec.split('+');
      key = parts.pop();
      parts.forEach((m) => { modifiers |= MOD[m] || 0; });
    }
    await keyPress(key, modifiers);
  } else if (action === 'type') {
    await typeText(args.join(' '));
  } else if (action === 'nav') {
    await nav(args[0], parseInt(args[1] || '1', 10));
  } else if (action === 'click') {
    await clickSel(args[0]);
  } else {
    console.error(`unknown action: ${action}`);
    process.exit(1);
  }
  console.log('✓ done');
} finally {
  ws.close();
}
