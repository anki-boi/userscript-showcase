// ==UserScript==
// @name         Patient Connect API Automation
// @namespace    jeyson-pc-api
// @version      0.1.0
// @author       Jeyson Dagondon
// @description  Agent API for Patient Connect (Zoho-embedded): list, read conversations.
// @match        https://portal.exampleclinic.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[PC API v0.1.0] boot');

// --- Script API (R18) — agent-facing status/trigger/output channel ---
window.__scripts = window.__scripts || {};
window.__scripts['PC-API'] = {
  name: 'Patient Connect API Automation',
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
  const api = window.__scripts['PC-API'];

  // ── helpers ─────────────────────────────────────────────
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const log = (...a) => console.log('[PC API]', ...a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // The open conversation's patient name (chat header).
  const currentThreadName = () => {
    const el = $('.chat-header-info .chat-patient-name');
    return el ? el.textContent.trim() : '';
  };

  function apiSet(state, message, extra) {
    api.state = state;
    api.message = message || '';
    api.lastActivity = Date.now();
    if (extra) Object.assign(api, extra);
    if (state === 'error') api.error = message || '';
    if (state === 'done' || state === 'idle') api.error = null;
    console.info(`[PC API] ${state}${message ? ' — ' + message : ''}`);
  }

  // ── SMS/chat surface guard (script is @match portal.exampleclinic.com/*) ──
  function onPcSurface() {
    return !!$('.conversation-list') || !!$('.chat-area');
  }

  // ── conversation list readers ───────────────────────────
  function convRows() { return $$('.conversation-row'); }
  // Row identity: name from .conv-name; threadId from the .conv-item button's data-id.
  function rowInfo(li) {
    const nm = li.querySelector('.conv-name');
    const item = li.querySelector('.conv-item');
    return {
      name: (nm ? nm.innerText : '').trim(),
      threadId: item ? (item.getAttribute('data-id') || '') : ''
    };
  }
  // Unread badge: a `.badge.badge-green` carrying a digit (e.g. Juwana Thomas = 1).
  function rowUnreadCount(li) {
    const b = [...li.querySelectorAll('span,div')].find(
      (e) => /^\d+$/.test((e.innerText || '').trim()) && e.childElementCount === 0 && /badge/i.test((e.className || '').toString())
    );
    if (!b) return 0;
    const v = parseInt((b.innerText || '').trim(), 10);
    return isNaN(v) ? 1 : v;
  }
  function rowIsUnread(li) { return rowUnreadCount(li) > 0 || !!li.querySelector('.badge.badge-green'); }
  function rowPreview(li) {
    const item = li.querySelector('.conv-item');
    const name = (li.querySelector('.conv-name') || {}).textContent || '';
    const t = item ? item.innerText : (li.innerText || '');
    return t.split('\n').map((l) => l.trim()).filter((l) => l && l !== name && !/^\d+$/.test(l)).slice(0, 3).join(' ').trim();
  }
  function listConversations() {
    return convRows().map((li) => {
      const { name, threadId } = rowInfo(li);
      return {
        name, threadId,
        unread: rowIsUnread(li),
        unreadCount: rowIsUnread(li) ? rowUnreadCount(li) : 0,
        preview: rowPreview(li)
      };
    }).filter((x) => x.name);
  }
  function findRowByName(name) {
    const target = (name || '').trim();
    if (!target) return null;
    return convRows().find((li) => {
      const n = rowInfo(li).name;
      return n === target || (target.length > 2 && n.toLowerCase().includes(target.toLowerCase()));
    }) || null;
  }
  function findRowByThreadId(threadId) {
    return convRows().find((li) => rowInfo(li).threadId === threadId) || null;
  }

  // ── message reader ──────────────────────────────────────
  // Bubbles: `.messages-area .message-bubble`; `.outgoing` = clinic-sent, else patient.
  function messagesReady() {
    return !!$$('.messages-area .message-bubble').find((b) => (b.innerText || '').trim());
  }
  function readMessages(limit) {
    const cards = $$('.messages-area .message-bubble');
    const max = Math.min(limit || 50, cards.length);
    const out = [];
    for (let i = 0; i < max; i++) {
      const b = cards[i];
      const body = (b.innerText || '').trim();
      if (!body) continue;
      const outgoing = (b.className || '').toString().includes('outgoing');
      out.push({ sender: outgoing ? 'Medical Team' : currentThreadName() || 'Patient', direction: outgoing ? 'out' : 'in', body });
    }
    return out;
  }

  // ── navigation (SPA — click .conv-item; no reload) ──────
  const rowWaitMs = 1600;
  async function openRow(li) {
    const item = li.querySelector('.conv-item') || li;
    item.click();
    await sleep(rowWaitMs);
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

  // SAFETY: opening a conversation may clear its unread badge. Refuse to open an
  // UNREAD conversation unless the caller passes {force:true} (or {send:true}).
  async function doReadConversation(params) {
    params = params || {};
    const target = (params.name || params.threadId || '').trim();
    if (!target) return { ok: false, error: 'params.name or params.threadId required' };
    if (!onPcSurface()) return { ok: false, error: 'not on the Patient Connect chat surface' };

    const explicitForce = !!(params.force || params.send);
    const li = findRowByThreadId(target) || findRowByName(target);
    if (!li) return { ok: false, error: `conversation not found: ${target}` };

    const info = rowInfo(li);
    if (rowIsUnread(li) && !explicitForce) {
      return { ok: false, error: `"${info.name}" is unread — pass {force:true} (or {send:true}) to open+read it` };
    }

    // If the row is the currently-open thread, no nav needed.
    if (currentThreadName() !== info.name) {
      apiSet('running', `Opening ${info.name}...`);
      await openRow(li);
    }

    // wait for the message pane to mount, then settle before reading.
    for (let i = 0; i < 24; i++) { if (messagesReady()) break; await sleep(300); }
    await sleep(350);

    const msgs = readMessages(params.limit || 50);
    api.output = { threadId: info.threadId, name: currentThreadName() || info.name, messages: msgs, count: msgs.length };
    apiSet('done', `Read ${msgs.length} messages from ${info.name}`);
    return { ok: true };
  }

  async function doNavigate(params) {
    params = params || {};
    const target = (params.name || params.threadId || '').trim();
    if (!target) return { ok: false, error: 'params.name or params.threadId required' };
    if (!onPcSurface()) return { ok: false, error: 'not on the Patient Connect chat surface' };
    const explicitForce = !!(params.force || params.send);
    const li = findRowByThreadId(target) || findRowByName(target);
    if (!li) return { ok: false, error: `no row for "${target}"` };
    const info = rowInfo(li);
    if (rowIsUnread(li) && !explicitForce) {
      return { ok: false, error: `"${info.name}" is unread — pass {force:true} (or {send:true}) to open it` };
    }
    if (currentThreadName() !== info.name) {
      apiSet('running', `Opening ${info.name}...`);
      await openRow(li);
    }
    apiSet('done', `Opened ${info.name}`);
    return { ok: true };
  }

  // ── trigger dispatcher (agent entry point) ──────────────
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
      case 'reset': api.output = null; apiSet('idle'); return { ok: true };
      case 'status': apiSet('idle'); return { ok: true, ...api };
      default: return { ok: false, error: `unknown action: ${action}` };
    }
  };
  apiSet('idle', 'loaded');
})();
