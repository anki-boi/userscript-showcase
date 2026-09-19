// ==UserScript==
// @name         RingCentral API Automation
// @namespace    jeyson-rc-api
// @version      0.1.0
// @author       Jeyson Dagondon
// @description  Agent API for RingCentral SMS: list, read, search, staged send.
// @match        https://app.ringcentral.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[RING API v0.1.0] boot');

// --- Script API (R18) — agent-facing status/trigger/output channel ---
window.__scripts = window.__scripts || {};
window.__scripts['RING'] = {
  name: 'RingCentral API Automation',
  version: '0.1.0',
  state: 'idle',
  message: '',
  progress: null,
  output: null,
  error: null,
  lastActivity: Date.now(),
  trigger: null
};

(function () {
  'use strict';
  const api = window.__scripts['RING'];

  // ── helpers ─────────────────────────────────────────────
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const log = (...a) => console.log('[RING API]', ...a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const byAt = (id, r) => $(`[data-test-automation-id="${id}"]`, r);
  const threadFromUrl = () => (location.pathname.match(/sms\/direct\/all\/([0-9a-f]+)/i) || [])[1] || '';
  // The OPEN conversation's display name (page title "RingCentral - Text - <Name>").
  const currentThreadName = () => {
    const m = document.title.match(/Text\s+-\s+(.+)$/i);
    return m ? m[1].trim() : '';
  };
  const currentThread = () => ({ threadId: threadFromUrl(), name: currentThreadName() });

  function apiSet(state, message, extra) {
    api.state = state;
    api.message = message || '';
    api.lastActivity = Date.now();
    if (extra) Object.assign(api, extra);
    if (state === 'error') api.error = message || '';
    if (state === 'done' || state === 'idle') api.error = null;
    console.info(`[RING API] ${state}${message ? ' — ' + message : ''}`);
  }

  // ── SMS surface guard (script is @match app.ringcentral.com/*) ──
  function onSmsSurface() {
    return !!$('[data-test-automation-id=direct-all], [data-test-automation-id=SMSDetail]');
  }

  // ── conversation list readers ───────────────────────────
  function convRows() {
    return $$('li[data-test-automation-class="sms-item"]');
  }
  // Row identity: the name/phone in aria-label; threadId from data-id ("inbox_sms_<hex>").
  function rowInfo(li) {
    const name = li.getAttribute('aria-label') || '';
    const id = (li.getAttribute('data-id') || '').replace(/^inbox_sms_/, '');
    return { name, threadId: id };
  }
  // Unread is SIGNALED BY THE BOLD NAME (computed font-weight 700); read rows are 400.
  // This is semantic, not a generated-class hash. The name element is MUI Typography —
  // rendered as a <p> or <div> depending on state, but always `.MuiTypography-root` whose
  // text equals the row's aria-label (matches its own canonical display name). Verified
  // 2026-08-23: the bold rows (228)239-9198/2, Verna/1, Annette/1 == 4, the "Text 4" badge.
  function rowNameEl(li) {
    const name = (li.getAttribute('aria-label') || '').trim();
    const all = Array.from(li.querySelectorAll('.MuiTypography-root'));
    return all.find((e) => (e.innerText || '').trim() === name) || all.find((e) => (e.innerText || '').trim() && isBold(e)) || all[0] || null;
  }
  function isBold(el) { return parseInt(getComputedStyle(el).fontWeight, 10) >= 600; }
  function rowIsUnread(li) {
    const n = rowNameEl(li);
    return n ? isBold(n) : false;
  }
  function rowUnreadCount(li) {
    // The count badge is a child whose text is a pure digit (falls back to 1).
    const badge = Array.from(li.querySelectorAll('span,div')).find(
      (e) => /^\d+$/.test((e.innerText || '').trim()) && e.children.length === 0
    );
    const v = badge ? parseInt((badge.innerText || '').trim(), 10) : 1;
    return isNaN(v) ? 1 : v;
  }
  function rowPreview(li) {
    const name = (li.getAttribute('aria-label') || '').trim();
    // Robust: the preview is the row text minus the leading name line. `no-search-highlight-text`
    // is inconsistent (sometimes the name, sometimes empty) — don't trust it alone.
    const txt = (li.innerText || '');
    return txt.split('\n').map((l) => l.trim()).filter((l) => l && l !== name && !/^\d+$/.test(l)).slice(0, 3).join(' ').trim();
  }
  function listConversations() {
    return convRows().map((li) => {
      const { name, threadId } = rowInfo(li);
      return {
        name, threadId,
        unread: rowIsUnread(li),
        unreadCount: rowIsUnread(li) ? rowUnreadCount(li) : 0,
        // Favorited/starred = "special care" conversations (needs follow-up; not resolved).
        // Favorited rows carry a filled star token: `span.star.icon` (outline = `star_border`).
        favorite: !!li.querySelector('span.star.icon'),
        preview: rowPreview(li)
      };
    }).filter((x) => x.name);
  }
  function findRowByName(name) {
    const target = (name || '').trim();
    if (!target) return null;
    return convRows().find((li) => {
      const n = li.getAttribute('aria-label') || '';
      return n === target || (target.length > 2 && n.toLowerCase().includes(target.toLowerCase()));
    }) || null;
  }
  function findRowByThreadId(threadId) {
    return convRows().find((li) => (li.getAttribute('data-id') || '') === `inbox_sms_${threadId}`) || null;
  }

  // ── message reader ──────────────────────────────────────
  // One `.conversation-card__right` per message group; the sender/tel live in the card
  // header, body(s) in `.SMSTextBodyWrapper`. Emits one message per body (handles grouping).
  function currentUserNumber() {
    const ed = $('.ql-editor[contenteditable]');
    if (!ed) return '';
    const ph = ed.getAttribute('data-placeholder') || '';
    const m = ph.match(/Text from (.+)/);
    return m ? m[1].trim() : '';
  }
  // The message pane mounts skeleton `.conversation-card__right` wrappers BEFORE the real
  // content arrives (the SPA fetches message data in the background). "Ready" = at least one
  // `.SMSTextBodyWrapper` actually has text — never trust the card count alone.
  function messagesReady() {
    return !!$$('.SMSTextBodyWrapper').find((b) => (b.innerText || '').trim());
  }
  function readMessages(limit) {
    const cards = $$('.conversation-card__right');
    const max = Math.min(limit || 50, cards.length);
    const out = [];
    const me = currentUserNumber();
    for (let i = 0; i < max; i++) {
      const c = cards[i];
      const sender = ($('[data-test-automation-id=sms-card-header-name]', c) || {}).innerText || '';
      const tel = ($('[data-test-automation-id=sms-card-header-tel]', c) || {}).innerText || '';
      const bodies = $$('.SMSTextBodyWrapper', c).map((b) => (b.innerText || '').trim());
      // skip empty skeleton wrappers (content hasn't rendered yet)
      const realBodies = bodies.filter((b) => b);
      if (!realBodies.length) continue;
      realBodies.forEach((body) => {
        out.push({
          sender: (sender || '').trim(),
          tel: (tel || '').trim(),
          body: body,
          direction: me && tel && tel.trim() === me ? 'out' : (tel ? 'in' : '')
        });
      });
    }
    return out;
  }

  // ── navigation (SPA — click the row; no reload) ─────────
  // Clicking a conversation row does client-side routing (verified: flag survives,
  // URL/thread change, no reload). The row's ARIA/dirty check is done by the caller.
  const rowWaitMs = 1600;
  async function openRow(li) {
    li.click();
    await sleep(rowWaitMs);
    // wait for the message content to arrive
    for (let i = 0; i < 20; i++) { if (messagesReady()) break; await sleep(300); }
    await sleep(200);
  }

  // ── ACTIONS ─────────────────────────────────────────────
  async function doListConversations() {
    const list = listConversations();
    api.output = { conversations: list, count: list.length };
    apiSet('done', `Found ${list.length} conversations`);
    return { ok: true };
  }

  async function doListUnread() {
    const list = listConversations().filter((c) => c.unread);
    api.output = { unread: list, count: list.length };
    apiSet('done', `${list.length} unread conversations`);
    return { ok: true };
  }

  // SAFETY: a read marks the conversation read. Refuse to open an UNREAD
  // conversation unless the caller passes {force:true} (or {send:true}, which is an
  // explicit intent to be active in it). Only non-unread rows are opened freely.
  async function doReadConversation(params) {
    params = params || {};
    const target = (params.name || params.threadId || '').trim();
    if (!target) return { ok: false, error: 'params.name or params.threadId required' };
    if (!onSmsSurface()) return { ok: false, error: 'not on the SMS surface (app.ringcentral.com/sms)' };

    const explicitForce = !!(params.force || params.send);
    let li = findRowByThreadId(target) || findRowByName(target);
    let resolvedName = '', resolvedThread = threadFromUrl();

    if (li) {
      const info = rowInfo(li);
      resolvedName = info.name; resolvedThread = info.threadId;
      // gate: never auto-open unread without explicit permission
      if (rowIsUnread(li) && !explicitForce) {
        return { ok: false, error: `"${info.name}" is unread — pass {force:true} (or {send:true}) to open+read it` };
      }
      // If the row is the currently-open thread, no nav needed (already active).
      if (resolvedThread !== threadFromUrl()) {
        apiSet('running', `Opening ${info.name}...`);
        await openRow(li);
      }
    } else {
      // Row not mounted (list is virtualized). Fall back to URL navigation, which
      // full-reloads — carry the intent in sessionStorage and let the boot hook read.
      if (explicitForce === false && /^[0-9a-f]{32}$/.test(target) === false) {
        return { ok: false, error: `conversation not found in the mounted list: ${target}` };
      }
      resolvedThread = /^[0-9a-f]{32}$/.test(target) ? target : resolvedThread;
      resolvedName = params.name || '';
      try { sessionStorage.setItem('RING:read', JSON.stringify({ threadId: resolvedThread, limit: params.limit || 50 })); } catch (e) { log('sessionStorage.setItem failed:', e.message); }
      apiSet('running', `Opening ${resolvedThread} by URL...`);
      location.href = `/sms/direct/all/${resolvedThread}`;
      return { ok: true };
    }

    // wait for the message pane to mount (covers the already-open path right after a
    // reload, where cards lag behind) — then settle briefly before reading.
    for (let i = 0; i < 24; i++) { if (messagesReady()) break; await sleep(300); }
    await sleep(350);

    const msgs = readMessages(params.limit || 50);
    api.output = {
      threadId: resolvedThread,
      name: resolvedName,
      favorite: openConversationFavorite(),
      messages: msgs,
      count: msgs.length
    };
    apiSet('done', `Read ${msgs.length} messages from ${resolvedName || resolvedThread}`);
    return { ok: true };
  }

  // navigate: same gate as read but only opens the conversation (no message dump).
  async function doNavigate(params) {
    params = params || {};
    const target = (params.name || params.threadId || '').trim();
    if (!target) return { ok: false, error: 'params.name or params.threadId required' };
    if (!onSmsSurface()) return { ok: false, error: 'not on the SMS surface' };
    const explicitForce = !!(params.force || params.send);
    const li = findRowByThreadId(target) || findRowByName(target);
    if (!li) {
      if (/^[0-9a-f]{32}$/.test(target)) {
        apiSet('running', `Opening ${target} by URL...`);
        location.href = `/sms/direct/all/${target}`;
        return { ok: true };
      }
      return { ok: false, error: `no row for "${target}"` };
    }
    const info = rowInfo(li);
    if (rowIsUnread(li) && !explicitForce) {
      return { ok: false, error: `"${info.name}" is unread — pass {force:true} (or {send:true}) to open it` };
    }
    if (info.threadId !== threadFromUrl()) {
      apiSet('running', `Opening ${info.name}...`);
      await openRow(li);
    }
    apiSet('done', `Opened ${info.name}`);
    return { ok: true };
  }

  // Search = the inline list filter beside ALL/UNREAD (NOT the global search dialog).
  // It filters the conversation list live (read-only; never opens a conversation).
  async function doSearch(params) {
    params = params || {};
    const q = (params.query || '').trim();
    if (!q) return { ok: false, error: 'params.query required' };
    if (!onSmsSurface()) return { ok: false, error: 'not on the SMS surface' };
    const toggle = $('button[aria-label="Search texts"]');
    const input = $('[data-test-automation-id=SMSTab__leftPanel] input[placeholder="Search texts"]');
    if (!toggle) return { ok: false, error: 'search toggle not found (button[aria-label="Search texts"])' };
    apiSet('running', `Searching "${q}"...`);
    // reveal the filter input if hidden
    if (!input || !input.offsetParent) { toggle.click(); await sleep(400); }
    const box = $('[data-test-automation-id=SMSTab__leftPanel] input[placeholder="Search texts"]');
    if (!box) return { ok: false, error: 'search input not found after toggle' };
    box.focus();
    box.value = '';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    // type via native setter so React/MUI sees the change
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(box, q);
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(700);
    const results = listConversations();
    api.output = { query: q, results, count: results.length };
    apiSet('done', `${results.length} conversations matching "${q}"`);
    return { ok: true };
  }

  // ── trusted-event staging (engine/controller split) ─────
  // RingCentral ignores synthetic events for the composer (typing) and send.
  // The script LOCATES the element + returns coordinates; the agent completes the
  // CDP Input. Nothing is ever auto-sent. Exposed as pendingTrusted for the agent.
  function center(el) {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  }
  // Is the OPEN conversation favorited? The header toggle button's aria flips
  // "Add to favorite texts" (not favorited) -> "Remove from favorite texts" (favorited).
  function openConversationFavorite() {
    const btn = Array.from($$('button')).find((b) => /favorite texts/i.test((b.getAttribute('aria-label') || '') + (b.getAttribute('title') || '')));
    if (!btn) return false;
    return /^Remove/i.test(btn.getAttribute('aria-label') || '');
  }
  function stageCompose() {
    const ed = $('.ql-editor[contenteditable]');
    if (!ed) return { ok: false, error: 'composer editor not found' };
    const c = center(ed);
    api.pendingTrusted = { action: 'focus-type', qa: 'ql-editor.contenteditable', x: c.x, y: c.y, thread: currentThread().name, threadId: currentThread().threadId, hint: `click to focus, then Input.insertText (in ${currentThread().name})` };
    apiSet('waiting_human', `Agent: click (${c.x},${c.y}) to focus composer in "${currentThread().name}", then type`);
    return { ok: true, target: api.pendingTrusted };
  }
  // Send is GATED: it requires params.send===true (permanent guard — staged, never auto-fired).
  function stageSend(params) {
    params = params || {};
    if (!params.send) return { ok: false, error: 'send requires params.send:true (safety gate)' };
    const ed = $('.ql-editor[contenteditable]');
    if (ed && (ed.innerText || '').trim() === '') return { ok: false, error: 'composer is empty — nothing to send' };
    const post = $('[data-test-automation-id=post-button]');
    if (post && post.disabled) return { ok: false, error: 'post-button is disabled (draft not ready)' };
    const btn = post || $('button[aria-label="Send (Enter key)"]');
    if (!btn) return { ok: false, error: 'post-button not found' };
    const c = center(btn);
    api.pendingTrusted = { action: 'click-send', qa: 'post-button', x: c.x, y: c.y, thread: currentThread().name, threadId: currentThread().threadId, hint: `trusted click to SEND in ${currentThread().name}` };
    apiSet('waiting_human', `Agent: trusted click (${c.x},${c.y}) to SEND in "${currentThread().name}"`);
    return { ok: true, target: api.pendingTrusted };
  }
  // Favorite/star = flag a conversation for "special care" (needs follow-up, unresolved).
  // Toggles via the header button of the OPEN conversation (trusted click; never auto-fired).
  function stageFavorite() {
    const btn = Array.from($$('button')).find((b) => /favorite texts/i.test((b.getAttribute('aria-label') || '') + (b.getAttribute('title') || '')));
    if (!btn) return { ok: false, error: 'favorite button not found (open a conversation first)' };
    const goingTo = /^Remove/i.test(btn.getAttribute('aria-label') || '') ? 'unfavorite' : 'favorite';
    const c = center(btn);
    api.pendingTrusted = { action: 'click-favorite', qa: 'favorite-texts-button', x: c.x, y: c.y, thread: currentThread().name, threadId: currentThread().threadId, hint: `trusted click to ${goingTo} ${currentThread().name}` };
    apiSet('waiting_human', `Agent: trusted click (${c.x},${c.y}) to ${goingTo} "${currentThread().name}"`);
    return { ok: true, target: api.pendingTrusted };
  }

  // ── trigger dispatcher (agent entry point) ──────────────
  // R12: async actions are awaited AND caught — a rejected promise must not
  // silently freeze state. Each returns {ok,error?}; errors surface via api.error.
  // CRITICAL: gated actions RETURN {ok:false, error} (not throw) — runAsync MUST
  // propagate that, else the state is left stuck at 'running' forever (a real bug:
  // the unread gate returned {ok:false} and runAsync dropped it, hanging the API).
  async function runAsync(fn, params, verb) {
    if (api.state === 'running') return { ok: false, error: 'already running' };
    apiSet('running', verb);
    try {
      const r = await fn(params);
      if (r && r.ok === false) {
        const msg = r.error || 'action failed';
        apiSet('error', msg);
        return { ok: false, error: msg };
      }
      return { ok: true };
    } catch (e) {
      apiSet('error', e.message || String(e));
      return { ok: false, error: e.message || String(e) };
    }
  }
  api.trigger = function (action, params) {
    switch (action) {
      case 'list-conversations': runAsync(doListConversations, params, 'Listing conversations...'); return { ok: true };
      case 'list-unread': runAsync(doListUnread, params, 'Reading unread...'); return { ok: true };
      case 'read-conversation': runAsync(doReadConversation, params, 'Reading conversation...'); return { ok: true };
      case 'navigate': runAsync(doNavigate, params, 'Navigating...'); return { ok: true };
      case 'search': runAsync(doSearch, params, 'Searching...'); return { ok: true };
      // Staged trusted-event actions — the agent completes the Input after staging.
      case 'stage-compose': return stageCompose();
      case 'stage-send': return stageSend(params);
      case 'stage-favorite': return stageFavorite();
      case 'reset': api.output = null; api.pendingTrusted = null; apiSet('idle'); return { ok: true };
      case 'status': apiSet('idle'); return { ok: true, ...api };
      default: return { ok: false, error: `unknown action: ${action}` };
    }
  };
  apiSet('idle', 'loaded');

  // ── Boot hook: carry a read intent across a full page reload. ──
  // A `read-conversation` by URL (row not mounted) sets sessionStorage['RING:read'],
  // then navigates — which reloads and wipes this trigger's setTimeout. The hook
  // reads the intent, extracts the messages, and clears it. Without it the reload
  // leaves state idle with no result.
  (function boot() {
    let intent = null;
    try { intent = JSON.parse(sessionStorage.getItem('RING:read') || 'null'); } catch (e) { log('read-intent parse failed:', e.message); }
    if (intent && intent.threadId && threadFromUrl() === intent.threadId) {
      (async () => {
        for (let i = 0; i < 24; i++) { if (messagesReady()) break; await sleep(300); }
        await sleep(400);
        const msgs = readMessages(intent.limit || 50);
        api.output = { threadId: threadFromUrl(), name: '', messages: msgs, count: msgs.length };
        apiSet('done', `Read ${msgs.length} messages from ${intent.threadId}`);
        try { sessionStorage.removeItem('RING:read'); } catch (e) { log('read-intent clear failed:', e.message); }
      })();
    }
  })();
})();
