// ==UserScript==
// @name         Gmail API Automation
// @namespace    jeyson-gmail-api
// @version      0.1.8
// @author       Jeyson Dagondon
// @description  Agent API for Gmail: list, search, read, compose/send, templates, unread.
// @match        https://mail.google.com/mail/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[GMAIL API v0.1.8] boot');

// --- Script API (R18) — agent-facing status/trigger/output channel ---
window.__scripts = window.__scripts || {};
window.__scripts['GMAIL'] = {
  name: 'Gmail API Automation',
  version: '0.1.8',
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
  const api = window.__scripts['GMAIL'];

  // ── helpers ─────────────────────────────────────────────
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const log = (...a) => console.log('[GMAIL API]', ...a);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const center = (el) => {
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
  };
  const txt = (el) => ((el && el.textContent) || '').trim();

  // Selector map (verified live 2026-08-24 on mail.google.com/mail/u/1):
  // rows are TRs — unread carry class zA, read carry yO; sender .yP, subject .bog,
  // snippet .y2, time .xW. Thread messages: div[data-message-id] (class adn ads),
  // sender span[email], body .a3s/.gs. Compose dialog: div[role=dialog]; To =
  // input[role=combobox][aria-label=To recipients]; subject input[name=subjectbox];
  // body textarea[aria-label="Message Body"]; Send div[aria-label="Send"];
  // ⋮ = div[role=dialog] [aria-label="More options"] (the T-I one — the Gemini
  // BUTTON.pYTkkf also has that aria; scope to the dialog and class T-I).
  const UX = {
    composeBtn: '.z0',
    searchInput: 'input[name="q"]',
    rows: 'tr.yO, tr.zA',
    // Row info lives in ONE .afn div (verified live 2026-08-24): sender
    // span.zF[email][name], subject span.bqe (carries data-thread-id /
    // data-legacy-thread-id), date span.bq3, snippet .y2.
    // sender span carries email+name attrs; class flips zF (inbox) vs yP
    // (search results) — match span[email] to cover both (verified 2026-08-24).
    rowSender: '.afn span[email]',
    rowSubject: '.afn .bqe, .afn [data-thread-id]',
    rowSnippet: '.y2',
    rowTime: '.afn .bq3',
    threadMsg: 'div[data-message-id]',
    // h2.hP = thread subject title (verified 2026-08-24; also [data-tooltip=Subject])
    threadSubject: 'h2.hP, [data-tooltip="Subject"], h2[data-tooltip="Subject"]',
    dialog: 'div[role="dialog"]',
    to: 'div[role="dialog"] input[role="combobox"][aria-label="To recipients"]',
    subject: 'div[role="dialog"] input[name="subjectbox"]',
    // ONLY the visible div (Am aiL Al editable) — the textarea mirror (Ak aiL,
    // display:none) comes first in DOM order and is ALWAYS empty (verified
    // 2026-08-24); querySelector returns DOM-order first, so list order is a trap.
    body: 'div[role="dialog"] div[role="textbox"][aria-label="Message Body"]',
    send: 'div[role="dialog"] [role="button"][aria-label="Send"]',
    more: 'div[role="dialog"] [aria-label="More options"]',
    discard: '[aria-label*="Discard draft"]',
    markUnread: '[aria-label="Mark as unread"]',
    markRead: '[aria-label="Mark as read"]',
    archive: '[aria-label="Archive"]'
  };

  function apiSet(state, message, extra) {
    api.state = state;
    api.message = message || '';
    api.lastActivity = Date.now();
    if (extra) Object.assign(api, extra);
    if (state === 'error') api.error = message || '';
    if (state === 'done' || state === 'idle') api.error = null;
    console.info(`[GMAIL API] ${state}${message ? ' — ' + message : ''}`);
  }
  function stage(qa, action, el, hint) {
    const c = center(el);
    api.pendingTrusted = { action, qa, x: c.x, y: c.y, hint };
    apiSet('waiting_human', `Agent: trusted click (${c.x},${c.y}) — ${hint}`);
    return { ok: true, target: api.pendingTrusted };
  }

  // ── surface guards ──────────────────────────────────────
  function onMail() { return location.hostname === 'mail.google.com'; }
  function composeOpen() { return !!$(UX.dialog); }
  function threadOpen() { return $$(UX.threadMsg).length > 0; }

  // ── list readers (inbox + search results share the same row table) ──
  function rowSenderInfo(tr) {
    const el = $(UX.rowSender, tr);
    if (!el) return { sender: '', email: '' };
    return { sender: el.getAttribute('name') || txt(el), email: el.getAttribute('email') || '' };
  }
  function rowThreadIds(tr) {
    const b = $(UX.rowSubject, tr);
    return {
      threadId: b ? b.getAttribute('data-thread-id') : '',
      legacyThreadId: b ? b.getAttribute('data-legacy-thread-id') : ''
    };
  }
  const rxEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // only MOUNTED + VISIBLE rows count (inbox and search lists can coexist in
  // the DOM, one hidden — hidden rows have offsetParent === null)
  function visibleRows() { return $$(UX.rows).filter((tr) => tr.offsetParent !== null); }
  // Unread detection (verified live 2026-08-24): UNREAD rows carry zA with NO
  // yO; READ rows carry BOTH zA+yO (this Gmail adds zA to read rows too);
  // search-result rows also carry both. So unread ⟺ zA present AND yO absent.
  function rowIsUnread(tr) {
    const c = String(tr.className || '');
    const hasZ = c.split(/\s+/).includes('zA');
    const hasY = c.split(/\s+/).includes('yO');
    if (hasZ && !hasY) return true;
    return false;
  }
  function readRows(limit) {
    return visibleRows().map((tr, idx) => {
      const { sender, email } = rowSenderInfo(tr);
      const { threadId, legacyThreadId } = rowThreadIds(tr);
      const subject = txt($(UX.rowSubject, tr));
      const unread = rowIsUnread(tr);
      // snippet: .y2 cell, else .afn text minus unread/read + sender + subject + time
      let snippet = txt($(UX.rowSnippet, tr));
      if (!snippet) {
        const afn = $(UX.rowSubject, tr) && $(UX.rowSubject, tr).parentElement;
        if (afn) {
          snippet = (afn.textContent || '')
            .replace(/^(unread|read),\s*/i, '')
            .replace(new RegExp('^' + rxEsc(sender) + ',\\s*'), '')
            .replace(new RegExp('^' + rxEsc(subject) + ',\\s*'), '')
            .split(', ').slice(1).join(', ').trim();
        }
      }
      return {
        idx,
        sender,
        email,
        subject,
        snippet,
        time: txt($(UX.rowTime, tr)),
        threadId,
        legacyThreadId,
        unread
      };
    }).slice(0, limit || 50);
  }
  function findRow(params) {
    params = params || {};
    const rows = visibleRows();
    if (typeof params.index === 'number') return rows[params.index] || null;
    const subj = (params.subject || '').trim();
    const sender = (params.sender || '').trim();
    const tid = (params.threadId || '').trim();
    if (subj || sender || tid) {
      return rows.find((tr) => {
        const s = txt($(UX.rowSubject, tr));
        const a = rowSenderInfo(tr).sender;
        const t = rowThreadIds(tr);
        return (subj && s.toLowerCase().includes(subj.toLowerCase())) ||
               (sender && a.toLowerCase().includes(sender.toLowerCase())) ||
               (tid && ((t.threadId || '').includes(tid) || (t.legacyThreadId || '').includes(tid)));
      }) || null;
    }
    return null;
  }

  // ── thread reader ───────────────────────────────────────
  // Verified 2026-08-24 (mirrors the Gmail AI Reply Assistant harvest):
  // each message = div[data-message-id]; sender = first span[email] that isn't
  // "me"; body = the .a3s/.gs block with quoted parts (.gmail_quote/.elided/
  // .gmail_extra/.yj6qo) stripped.
  function readThread(limit) {
    const msgs = [];
    for (const el of $$(UX.threadMsg).slice(0, limit || 50)) {
      let sender = '', email = '';
      for (const e of el.querySelectorAll('span[email]')) {
        const addr = (e.getAttribute('email') || '').trim();
        const label = (e.textContent || '').trim();
        if (addr && label.toLowerCase() !== 'me') { sender = label; email = addr; break; }
      }
      if (!sender) { const h = el.querySelector('.gD, [role="heading"]'); if (h) sender = h.textContent.trim(); }
      const dateEl = el.querySelector('.g3, [data-tooltip] span, table[role="presentation"] [dir="ltr"] span');
      const date = txt(dateEl).slice(0, 60);
      let bodyEl = el.querySelector('.a3s') || el.querySelector('.gs') || el.querySelector('div[dir="ltr"]');
      if (!bodyEl) continue;
      const quote = bodyEl.querySelector('.gmail_quote, .elided, .gmail_extra, .yj6qo');
      let text = (bodyEl.textContent || '')
        .replace(quote ? quote.textContent : '', '')
        .replace(/\s+/g, ' ').trim();
      if (!text) continue;
      msgs.push({ sender, email, date, body: text });
    }
    return msgs;
  }
  function openThreadSubject() {
    let s = txt($(UX.threadSubject));
    if (!s) { const m = $('meta[name="subject"]'); s = m ? (m.getAttribute('content') || '') : ''; }
    if (!s) s = (location.href.match(/#thread\/[\w-]+/) || [''])[0];
    return s;
  }

  // ── ACTIONS ─────────────────────────────────────────────
  async function doListInbox(params) {
    const rows = readRows(params && params.limit);
    api.output = { view: 'list', url: location.href, rows, count: rows.length };
    apiSet('done', `${rows.length} rows`);
    return { ok: true };
  }
  async function doListUnread(params) {
    const rows = readRows(params && params.limit).filter((r) => r.unread);
    api.output = { unread: rows, count: rows.length };
    apiSet('done', `${rows.length} unread rows`);
    return { ok: true };
  }
  async function doReadResults(params) { return doListInbox(params); }

  // Opening a thread marks it READ — gate unread rows behind {force:true}.
  // Engine LOCATES; the agent completes the trusted click (Gmail ignores
  // synthetic clicks for row navigation: rows are <tr> with a JS-trusted click).
  function doStageOpen(params) {
    const tr = findRow(params || {});
    if (!tr) return { ok: false, error: 'row not found (subject/sender/index required)' };
    const subject = txt($(UX.rowSubject, tr));
    const sender = rowSenderInfo(tr).sender;
    const unread = rowIsUnread(tr);
    if (unread === true && !((params || {}).force || (params || {}).open)) {
      return { ok: false, error: `"${subject}" is unread — pass {force:true} to open it (marks it read)` };
    }
    // staged qa: row unread -> zA-only; read/search rows carry both -> yO target
    return stage('tr.' + (unread === true ? 'zA' : 'yO'), 'click-open-thread', tr,
      `open "${subject}" (from ${sender})`);
  }

  async function doReadOpenThread(params) {
    if (!threadOpen()) return { ok: false, error: 'no thread open — stage-open first (then click)' };
    const msgs = readThread(params && params.limit);
    api.output = {
      subject: openThreadSubject(),
      url: location.href,
      messages: msgs,
      count: msgs.length
    };
    apiSet('done', `Read ${msgs.length} messages — "${openThreadSubject()}"`);
    return { ok: true };
  }

  // Search: the agent focuses + types + Enter (trusted). Then read-results.
  function doStageSearch() {
    const el = $(UX.searchInput);
    if (!el) return { ok: false, error: 'search input not found (input[name=q])' };
    return stage('input[name="q"]', 'type-search', el,
      'click to focus, Input.insertText(query), then Enter');
  }

  // ── compose (staged — Gmail ignores synthetic events for compose) ─────
  function composeBtnEl() {
    const a = $(UX.composeBtn);
    if (a && a.offsetParent) return a;
    return $$('div.T-I').find((d) => (d.innerText || '').trim() === 'Compose' && d.offsetParent) || null;
  }
  function doStageCompose() {
    const el = composeBtnEl();
    if (!el) return { ok: false, error: 'Compose button not found (.z0)' };
    return stage('.z0', 'click-compose', el, 'open a new compose window');
  }
  function stageField(sel, qa, what) {
    const el = $(sel);
    if (!el) return { ok: false, error: `${what} field not found — is the compose window open? (stage-compose first)` };
    return stage(sel, 'focus-type-' + qa, el, `click to focus ${what}, then Input.insertText`);
  }
  function doStageTo() { return stageField(UX.to, 'to', 'the To field'); }
  function doStageSubject() { return stageField(UX.subject, 'subject', 'the Subject field'); }
  function doStageBody() { return stageField(UX.body, 'body', 'the Message Body'); }

  async function doDraftInfo() {
    const dlg = $(UX.dialog);
    if (!dlg) return { ok: false, error: 'no compose window open' };
    const to = $(UX.to, dlg);
    const subj = $(UX.subject, dlg);
    const body = $(UX.body, dlg);
    // To can hold tokenized chips (input value clears) — read the row text
    // too, plus any email attrs on the chips.
    const toRow = dlg.querySelector('div[aria-label="To"]');
    let toChips = '';
    let toEmails = [];
    if (toRow) {
      toChips = (toRow.innerText || '').trim();
      toEmails = [...toRow.querySelectorAll('[email], [data-email]')]
        .map((e) => e.getAttribute('email') || e.getAttribute('data-email') || '')
        .filter(Boolean);
    }
    api.output = {
      open: true,
      to: (to && (to.value || to.innerText || '').trim()) || toChips,
      toEmails: [...new Set(toEmails)],
      subject: subj ? subj.value || subj.innerText : '',
      body: body ? ((body.value == null ? '' : body.value) || body.innerText || '').slice(0, 6000) : '',
      menuOpen: !!$('[role="menu"]')
    };
    apiSet('done', 'draft state captured');
    return { ok: true };
  }

  // ⋮ (More options) in the COMPOSE window — NOT the Gemini button (also
  // aria-label="More options"; that one is BUTTON.pYTkkf). Pick the T-I one.
  function doStageComposeMenu() {
    const cands = $$(UX.more).filter((el) => el.className.includes('T-I'));
    const el = cands[0] || $(UX.more);
    if (!el) return { ok: false, error: 'compose ⋮ (More options) not found' };
    return stage('div[role="dialog"] [aria-label="More options"]', 'click-more-options', el,
      'open the compose ⋮ menu (Templates, signature, etc.)');
  }

  // Read the currently-open menu: menuitems with labels + class (Gemini menu
  // items carry aqdrmf classes — kept, so the agent can tell them apart).
  async function doReadComposeMenu() {
    const items = $$('[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemcheckbox"], [role="menu"] [role="menuitemradio"]')
      .map((el, i) => ({ i, label: (el.innerText || '').trim().replace(/\n/g, ' '), cls: String(el.className).slice(0, 40) }))
      .filter((x) => x.label);
    if (!items.length) return { ok: false, error: 'no menu open — stage-compose-menu (agent clicks) first' };
    api.output = { items, count: items.length };
    apiSet('done', `${items.length} menu items`);
    return { ok: true };
  }

  // Stage the menu item to click (exact label match first, then includes).
  // Works for: Templates ►, individual template names (submenu), "Insert
  // signature", "Save draft as template", etc. — the agent re-reads the menu
  // after each click to walk submenus.
  function doStageComposeMenuItem(params) {
    params = params || {};
    const items = $$('[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemcheckbox"], [role="menu"] [role="menuitemradio"]');
    let el = null;
    if (typeof params.index === 'number') el = items[params.index] || null;
    const label = (params.label || '').trim();
    if (!el && label) {
      el = items.find((m) => (m.innerText || '').trim() === label)
        || items.find((m) => (m.innerText || '').toLowerCase().includes(label.toLowerCase()))
        || null;
    }
    if (!el) return { ok: false, error: `menu item not found: ${label || params.index} — read-compose-menu first` };
    const l = (el.innerText || '').trim().replace(/\n/g, ' ');
    return stage('[role="menu"] [role="menuitem"]', 'click-menu-item', el,
      `click menu item "${l.slice(0, 40)}"`);
  }

  // SEND is GATED: never auto-sends. Requires params.send===true.
  function doStageSend(params) {
    params = params || {};
    if (!params.send) return { ok: false, error: 'send requires params.send:true (safety gate)' };
    const btn = $$('div[role="dialog"] [role="button"]').find((b) => b.getAttribute('aria-label') === 'Send');
    if (!btn) return { ok: false, error: 'Send button not found (no compose open?)' };
    return stage(UX.send, 'click-send', btn, 'SEND the email (verify recipient/body first)');
  }
  function doStageDiscard() {
    const el = $$(UX.discard).find((e) => e.offsetParent !== null) || null;
    if (!el) return { ok: false, error: 'Discard draft button not found' };
    return stage('[/discard/]', 'click-discard', el, 'discard the draft (+ confirm dialog if it appears)');
  }

  // mark-unread / mark-read / archive: thread toolbar buttons (verified live:
  // the open-thread toolbar exposes [aria-label="Mark as unread"],
  // "Mark as read", "Archive").
  function doStageToolbar(sel, action, what, label) {
    // Gmail keeps MULTIPLE toolbars in the DOM (list + thread); pick the
    // VISIBLE button — hidden ones return zero rects (staged clicks at 0,0).
    const el = $$(sel).find((e) => e.offsetParent !== null) || null;
    if (el) return stage(sel, action, el, what);
    // Fallback: threads opened from SEARCH use a collapsed toolbar — the
    // action hides in the ⋮ "More email options" menu (verified 2026-08-24).
    const label2 = label || what;
    const item = $$('[role="menu"] [role="menuitem"], [role="menu"] [role="menuitemcheckbox"]')
      .find((m) => m.offsetParent !== null && (m.innerText || '').trim() === label2);
    if (item) return stage('menu:' + label2, action, item, what + ' (via the open ⋮ menu)');
    return { ok: false, error: `${what} not visible — open the ⋮ menu (stage-more-menu) first` };
  }
  function doStageMoreMenu() {
    const el = $$('[aria-label="More email options"]').find((e) => e.offsetParent !== null) || null;
    if (!el) return { ok: false, error: 'visible ⋮ (More email options) button not found (need an open thread)' };
    return stage('[aria-label="More email options"]', 'click-more-email-options', el, 'open the thread ⋮ menu (Mark as unread, Archive, etc.)');
  }

  // ── trigger dispatcher ─────────────────────────────────
  async function runAsync(fn, params, verb) {
    if (api.state === 'running') return { ok: false, error: 'already running' };
    apiSet('running', verb);
    try {
      const r = await fn(params);
      if (r && r.ok === false) {
        apiSet('error', r.error || 'action failed');
        return r;
      }
      return r || { ok: true };
    } catch (e) {
      apiSet('error', e.message || String(e));
      return { ok: false, error: e.message || String(e) };
    }
  }
  api.trigger = function (action, params) {
    if (!onMail()) return { ok: false, error: 'not on mail.google.com' };
    switch (action) {
      case 'list-inbox': runAsync(doListInbox, params, 'Listing...'); return { ok: true };
      case 'list-unread': runAsync(doListUnread, params, 'Reading unread...'); return { ok: true };
      case 'read-results': runAsync(doReadResults, params, 'Reading rows...'); return { ok: true };
      case 'stage-open': return doStageOpen(params);
      case 'read-open-thread': runAsync(doReadOpenThread, params, 'Reading thread...'); return { ok: true };
      case 'stage-search': return doStageSearch();
      case 'stage-compose': return doStageCompose();
      case 'stage-to': return doStageTo();
      case 'stage-subject': return doStageSubject();
      case 'stage-body': return doStageBody();
      case 'draft-info': runAsync(doDraftInfo, params, 'Reading draft...'); return { ok: true };
      case 'stage-compose-menu': return doStageComposeMenu();
      case 'read-compose-menu': runAsync(doReadComposeMenu, params, 'Reading menu...'); return { ok: true };
      case 'stage-compose-menu-item': return doStageComposeMenuItem(params);
      case 'stage-send': return doStageSend(params);
      case 'stage-discard': return doStageDiscard();
      case 'stage-more-menu': return doStageMoreMenu();
      case 'stage-mark-unread': return doStageToolbar(UX.markUnread, 'click-mark-unread', 'Mark as unread', 'Mark as unread');
      case 'stage-mark-read': return doStageToolbar(UX.markRead, 'click-mark-read', 'Mark as read', 'Mark as read');
      case 'stage-archive': return doStageToolbar(UX.archive, 'click-archive', 'Archive', 'Archive');
      case 'reset': api.output = null; api.pendingTrusted = null; apiSet('idle'); return { ok: true };
      case 'status': apiSet('idle'); return { ok: true, ...api };
      default: return { ok: false, error: `unknown action: ${action}` };
    }
  };
  apiSet('idle', 'loaded');
})();
