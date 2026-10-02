// ==UserScript==
// @name         Slack API Automation
// @namespace    jeyson-slack-api
// @version      0.1.3
// @author       Jeyson Dagondon
// @description  Agent API for Slack (Dr. Example): list, read, search, compose.
// @match        https://app.slack.com/client/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[Slack API Automation v0.1.3] boot');

// --- Script API (R18) — agent-facing status/trigger/output channel ---
window.__scripts = window.__scripts || {};
window.__scripts['SLACK'] = {
  name: 'Slack API Automation',
  version: '0.1.3',
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
  const api = window.__scripts['SLACK'];
  const TEAM = location.pathname.match(/client\/(T[A-Z0-9]+)/)?.[1] || '';
  function apiSet(state, message, extra) {
    api.state = state;
    api.message = message || '';
    api.lastActivity = Date.now();
    if (extra) Object.assign(api, extra);
    if (state === 'error') api.error = message || '';
    if (state === 'done' || state === 'idle') { api.error = null; }
    console.info(`[SLACK] API: ${state}${message ? ' — ' + message : ''}`);
  }
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const qaIn = (el, sub) => (el.getAttribute('data-qa') || '').includes(sub);
  const qaEq = (el, v) => (el.getAttribute('data-qa') || '') === v;

  // ---- rail / navigation (plain JS; no trusted events needed) ----
  function railTab(kind) {
    const sel = {
      home: 'tab_rail_home_button', dms: 'tab_rail_dms_button',
      activity: 'tab_rail_activity_button', files: 'tab_rail_files_button',
      later: 'tab_rail_later_button', browse: 'tab_rail_browse_button'
    }[kind];
    const b = sel ? $(`[data-qa=${sel}]`) : null;
    if (b) b.click();
    return !!b;
  }
  // Ensure the channel sidebar is mounted (collapsed rail shields it). Returns true if present.
  async function ensureSidebar() {
    if ($('[data-qa=channel-sidebar-channel]')) return true;
    const homeOk = railTab('home');
    if (homeOk) await sleep(900);
    return !!$('[data-qa=channel-sidebar-channel]');
  }
  // Click the sidebar row whose name matches AND is not unread. Returns the row if handled.
  // Navigation is path-based (no hash) — Slack routes via the row's React onClick handler,
  // which a synthetic .click() triggers (verified: D0AQ6QDS7TQ -> C0BJ4R0GSV6).
  function rowByName(name) {
    return $$('[data-qa=channel-sidebar-channel]').find((r) => {
      const n = $(`[data-qa^=channel_sidebar_name_]`, r);
      const txt = n ? n.innerText.trim() : '';
      return txt === name || (name.length > 2 && txt.includes(name));
    }) || null;
  }
  function rowIsUnread(row) {
    return !!row.querySelector('[class*=badge],[data-qa*=unread],[class*=unread]');
  }
  // Validate the URL we'd navigate to is a real Slack conversation path.
  function isConvPath(u) { return /^\/client\/T[A-Z0-9]+\/(C|D|G)[A-Z0-9]+$/.test(u); }
  function currentConvId() {
    const m = location.pathname.match(/\/client\/T[A-Z0-9]+\/([CDG][A-Z0-9]+)/);
    return m ? m[1] : '';
  }

  // ---- readers ----
  function listConversations() {
    const rows = $$('[data-qa=channel-sidebar-channel]');
    return rows.map((r) => {
      const n = $(`[data-qa^=channel_sidebar_name_]`, r);
      return {
        name: (n ? n.innerText : '').trim(),
        unread: rowIsUnread(r),
        href: r._href || ''
      };
    }).filter((x) => x.name);
  }
  function readMessages(limit) {
    const msgs = $$('[data-qa=message_container]');
    const max = Math.min(limit || 50, msgs.length);
    const out = [];
    for (let i = 0; i < max; i++) {
      const c = msgs[i];
      const lines = (c.innerText || '').split('\n');
      const tsEl = $(`[data-qa=timestamp_label]`, c);
      const bodyEl = $(`[data-qa=message_content],[data-qa=message-text]`, c);
      const fileEl = $(`[data-qa=file_name]`, c);
      out.push({
        sender: (lines[0] || '').trim(),
        ts: tsEl ? (tsEl.innerText || tsEl.getAttribute('data-ts') || '').trim() : '',
        body: (bodyEl ? bodyEl.innerText : c.innerText).trim(),
        file: fileEl ? fileEl.innerText.trim() : null,
        isUnread: !!c.querySelector('[class*=p-unread_dot]')
      });
    }
    return out;
  }

  // ---- ACTIONS ----
  async function doListConversations() {
    await ensureSidebar();
    const list = listConversations();
    api.output = { conversations: list, count: list.length };
    apiSet('done', `Found ${list.length} conversations`);
    return { ok: true };
  }

  async function doListUnread() {
    // unread from sidebar badges + Today dashboard items
    const unreadRows = listConversations().filter((c) => c.unread);
    const todayItems = $$('.listitem__iBnNh,.unreadItem__tavIP').map((e) => ({
      text: (e.innerText || '').split('\n').slice(0, 4).join(' | ').slice(0, 100)
    }));
    api.output = { unreadConversations: unreadRows, todayItems, count: unreadRows.length };
    apiSet('done', `${unreadRows.length} unread conversations`);
    return { ok: true };
  }

  async function doReadConversation(params) {
    params = params || {};
    const target = (params.channel || '').replace(/^#/, '');
    if (!target) return { ok: false, error: 'params.channel (name or C/D/G id) required' };
    let fullNav = false;
    let targetUrl = '';
    if (/^[CDG][A-Z0-9]{7,}$/.test(target)) {
      targetUrl = `/client/${TEAM}/${target}`;
      if (location.pathname !== targetUrl) { fullNav = true; }
    } else {
      await ensureSidebar();
      const row = rowByName(target);
      if (!row) return { ok: false, error: `conversation not found in sidebar: ${target}` };
      const rowUnread = rowIsUnread(row);
      if (rowUnread && !params.force) {
        return { ok: false, error: `"${target}" is unread — pass {force:true} to open+mark read` };
      }
      const nameEl = $(`[data-qa^=channel_sidebar_name_]`, row);
      apiSet('running', `Opening ${target}...`);
      nameEl.click();
      await sleep(1800);
    }
    if (fullNav) {
      apiSet('running', `Opening conversation by id (marks read)...`);
      location.href = targetUrl;
      await sleep(2200);
    }
    // wait for messages to mount
    for (let i = 0; i < 20; i++) {
      if ($('[data-qa=message_container]')) break;
      await sleep(250);
    }
    const msgs = readMessages(params.limit || 50);
    api.output = { channel: target, channelId: currentConvId(), messages: msgs, count: msgs.length };
    apiSet('done', `Read ${msgs.length} messages from ${target}`);
    return { ok: true };
  }

  async function doNavigate(params) {
    params = params || {};
    if (params.tab) { railTab(params.tab); return { ok: true }; }
    if (params.channel) {
      const target = (params.channel || '').replace(/^#/, '');
      await ensureSidebar();
      if (/^[CDG][A-Z0-9]{7,}$/.test(target) && isConvPath(`/client/${TEAM}/${target}`)) {
        // not an href route natively — find the row by id isn't possible; require name OR
        // drive the row if it matches the id in the row's clickable text is not available.
        // Fall back: click whichever row corresponds (ids aren't in DOM text). Ask for name.
        return { ok: false, error: 'navigate-by-id not resolvable to a row; use params.channel as the row NAME, or "params.tab"' };
      }
      const row = rowByName(target);
      if (!row) return { ok: false, error: `no row for "${target}"; use a tab (home/dms/activity/files/later/browse) or a sidebar name` };
      const nameEl = $(`[data-qa^=channel_sidebar_name_]`, row);
      nameEl.click();
      return { ok: true };
    }
    return { ok: false, error: 'params.tab or params.channel (name) required' };
  }

  function doSearch(params) {
    params = params || {};
    if (!params.query) return { ok: false, error: 'params.query required' };
    // Navigate to the search view (path-based). This full-loads the page; the
    // boot hook (on /search) reads the results into output once they mount.
    const q = encodeURIComponent(params.query);
    apiSet('running', `Searching "${params.query}"...`);
    location.href = `/client/${TEAM}/search?query=${q}`;
    return { ok: true };
  }

  // ---- trusted-event staging (engine/controller split) ----
  // Slack actions that need TRUSTED events (hover toolbar, composer typing, Enter)
  // cannot be completed by a synthetic-dispatch userscript. So the script LOCATES
  // the exact element + returns its coordinates/selector; the agent drives the
  // trusted CDP Input from that. Exposed as a field, not a trigger action, so the
  // agent reads it after calling the staged action.
  function stage(action, params) {
    params = params || {};
    const el = $(`[data-qa=${params.qa}]`);
    if (!el) return { ok: false, error: `target not found: [data-qa=${params.qa}]` };
    const r = el.getBoundingClientRect();
    api.pendingTrusted = {
      action: action === 'click' ? 'click' : 'hover-click',
      qa: params.qa,
      x: Math.round(r.left + r.width / 2),
      y: Math.round(r.top + r.height / 2),
      hint: params.hint || ''
    };
    apiSet('waiting_human', `Agent: Input.dispatchMouseEvent at (${api.pendingTrusted.x},${api.pendingTrusted.y}) to ${params.qa}`);
    return { ok: true, target: api.pendingTrusted };
  }

  // ===== trigger dispatcher (agent entry point) =====
  // R12: async actions are awaited AND caught — a rejected promise must not
  // silently freeze state. Each returns {ok,error?}; errors surface via api.error.
  async function runAsync(fn, params, verb) {
    if (api.state === 'running') return { ok: false, error: 'already running' };
    apiSet('running', verb);
    try {
      await fn(params);
      return { ok: true };
    } catch (e) {
      apiSet('error', e.message || String(e));
      return { ok: false, error: e.message || String(e) };
    }
  }
  api.trigger = function (action, params) {
    switch (action) {
      case 'list-conversations': { runAsync(doListConversations, params, 'Listing conversations...'); return { ok: true }; }
      case 'list-unread': { runAsync(doListUnread, params, 'Reading unread...'); return { ok: true }; }
      case 'read-conversation': { runAsync(doReadConversation, params, 'Reading conversation...'); return { ok: true }; }
      case 'search': { return doSearch(params); }
      case 'navigate': { return doNavigate(params); }
      // Staged trusted-event actions — the agent completes the Input after staging.
      case 'stage-click': { return stage('click', params); }
      case 'stage-reply-thread': { return stage('click', { qa: 'start_thread', hint: 'hover a message first' }); }
      case 'stage-mark-unread': { return stage('click', { qa: 'more_message_actions', hint: 'hover a message then open overflow' }); }
      case 'stage-search-open': { return stage('click', { qa: 'top_nav_search' }); }
      case 'reset': { api.output = null; api.pendingTrusted = null; apiSet('idle'); return { ok: true }; }
      case 'status': { apiSet('idle'); return { ok: true, ...api }; }
      default: return { ok: false, error: `unknown action: ${action}` };
    }
  };
  apiSet('idle', 'loaded');

  // --- Boot hook: if we land on a /search route (navigated here by a prior
  // 'search' trigger, which full-loads the page), auto-read the results into
  // output once they mount. Without this, the reload wipes the search action's
  // setTimeout() result. ---
  const searchRoute = location.pathname.match(/\/client\/T[A-Z0-9]+\/search/);
  if (searchRoute) {
    const q = new URLSearchParams(location.search).get('query') || '';
    (async () => {
      for (let i = 0; i < 20; i++) {
        if ($$('[data-qa=search_result]').length) break;
        await sleep(300);
      }
      await sleep(600);
      const results = $$('[data-qa=search_result]').map((r) => ({
        channel: $(`[data-qa=search_result_channel_name]`, r)?.innerText || '',
        text: (r.innerText || '').replace(/\n+/g, ' | ').slice(0, 200)
      }));
      api.output = { query: q, results, count: results.length };
      apiSet('done', `${results.length} search results for "${q}"`);
    })();
  }
})();
