#!/usr/bin/env node
// cdp-eval.mjs — drive a Runtime.evaluate against a live Chrome tab (port 9222).
// Reusable probe/install helper for the userscripts dev loop (see AGENTS.md).
//
// Usage:
//   node cdp-eval.mjs <url-substring> --eval "<expression>"
//   node cdp-eval.mjs <url-substring> --file probe.js
//
// Connects to the first page tab whose URL contains <url-substring>, evaluates
// the expression with awaitPromise + returnByValue, and prints the JSON result.
// Non-zero exit + EXCEPTION dump when the expression throws.
const [, , urlSub, mode, arg] = process.argv;
const RELOAD = mode === '--reload';
if (!urlSub || (mode !== '--eval' && mode !== '--file' && mode !== '--reload')) {
  console.error('Usage: node cdp-eval.mjs <url-substring> --eval "<expr>" | --file <file.js> | --reload');
  process.exit(1);
}
const tabs = await (await fetch('http://localhost:9222/json/list')).json();
const tab = tabs.find((t) => t.type === 'page' && t.url.includes(urlSub));
if (!tab) {
  console.error(`No open tab matching "${urlSub}"`);
  process.exit(1);
}
const expr = RELOAD
  ? null
  : mode === '--file'
    ? await (await import('node:fs/promises')).readFile(arg, 'utf8')
    : arg;
const ws = new WebSocket(tab.webSocketDebuggerUrl);
const result = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('CDP evaluate timeout (30s)')), 30000);
  ws.onopen = () => {
    if (RELOAD) {
      ws.send(JSON.stringify({ id: 2, method: 'Page.reload', params: { ignoreCache: true } }));
      // Hard reload lands the tab in a fresh document; we can't easily await
      // load here, so resolve immediately and let the caller re-poll.
      setTimeout(() => { clearTimeout(timer); resolve({ reload: 'sent' }); }, 1500);
      return;
    }
    ws.send(JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: expr, awaitPromise: true, returnByValue: true }
    }));
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id === 1) { clearTimeout(timer); resolve(msg.result); }
  };
  ws.onerror = reject;
});
ws.close();
if (result.exceptionDetails) {
  console.error('EXCEPTION:');
  console.error(JSON.stringify(result.exceptionDetails, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(RELOAD ? result : result.result.value, null, 2));
