// ==UserScript==
// @name         Gmail AI Reply Assistant
// @namespace    https://drjonesdc.com
// @version      1.2.1
// @author       Jeyson Dagondon
// @run-at       document-idle
// @description  Harvests a Gmail conversation thread and drafts AI email replies for Jones Medical Management — GLP-1s, peptides, metabolic health.
// @match        https://mail.google.com/mail/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_listValues
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @connect      api.anthropic.com
// @connect      api.openai.com
// @connect      api.deepseek.com
// @connect      generativelanguage.googleapis.com
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.


console.info('[Gmail AI v1.2.1] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['Gmail-AI'] = { name: 'Gmail AI Reply Assistant', version: '1.2.1', state: 'idle', message: 'Loaded', output: null, error: null, lastActivity: Date.now(), trigger: null };

(function () {
  'use strict';

  const DEBUG = true;
  const log = (...a) => { if (DEBUG) console.log('[Gmail AI]', ...a); };

  // Trusted-Types-safe innerHTML replacement (Gmail CSP requires TrustedHTML
  // for BOTH innerHTML= and DOMParser.parseFromString — verified 2026-08-17).
  // Gmail allows creating a Trusted Types policy; use it when available.
  let ttPolicy = null;
  try {
    ttPolicy = trustedTypes.createPolicy('gmail-ai-tt', { createHTML: (s) => s });
  } catch (e) {
    try { ttPolicy = trustedTypes.getPolicy('gmail-ai-tt'); } catch (e2) { ttPolicy = null; }
  }
  function setHTML(el, html) {
    if (ttPolicy) el.innerHTML = ttPolicy.createHTML(html);
    else el.innerHTML = html; // no Trusted Types enforcement on this page
  }

  // ── Providers — same five as RC-AI ────────────────────────────────────
  const PROVIDERS = [
    {
      key: 'deepseek', label: 'DeepSeek', color: '#4D6BFE',
      webUrl: 'https://chat.deepseek.com/',
      fields: [
        { id: 'key', label: 'API Key', type: 'password', placeholder: 'sk-...' },
        { id: 'model', label: 'Model', type: 'text', placeholder: 'e.g. deepseek-chat' },
      ],
      async call(prompt, cfg) {
        if (!cfg.key) throw new Error('Missing DeepSeek API key — add it in Settings.');
        if (!cfg.model) throw new Error('Missing DeepSeek model — add it in Settings.');
        const res = await gmRequest({
          method: 'POST',
          url: 'https://api.deepseek.com/v1/chat/completions',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.key}` },
          data: JSON.stringify({ model: cfg.model, reasoning_effort: 'low', messages: [{ role: 'user', content: prompt }] }),
        });
        const json = parseJson(res);
        if (json.error) throw new Error(json.error.message || 'DeepSeek API error');
        return (json.choices?.[0]?.message?.content || '').trim();
      },
    },
    {
      key: 'claude', label: 'Claude', color: '#D97706',
      webUrl: 'https://claude.ai/new',
      fields: [
        { id: 'key', label: 'API Key', type: 'password', placeholder: 'sk-ant-...' },
        { id: 'model', label: "Model", type: 'text', placeholder: 'e.g. claude-sonnet-4-5-20250929' },
      ],
      async call(prompt, cfg) {
        if (!cfg.key) throw new Error('Missing Claude API key — add it in Settings.');
        if (!cfg.model) throw new Error('Missing Claude model — add it in Settings.');
        const res = await gmRequest({
          method: 'POST',
          url: 'https://api.anthropic.com/v1/messages',
          headers: { 'Content-Type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          data: JSON.stringify({ model: cfg.model, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
        });
        const json = parseJson(res);
        if (json.error) throw new Error(json.error.message || 'Claude API error');
        return (json.content || []).map((c) => c.text || '').join('\n').trim();
      },
    },
    {
      key: 'openai', label: 'ChatGPT', color: '#10A37F',
      webUrl: 'https://chatgpt.com/',
      fields: [
        { id: 'key', label: 'API Key', type: 'password', placeholder: 'sk-...' },
        { id: 'model', label: "Model", type: 'text', placeholder: 'e.g. gpt-4.1' },
      ],
      async call(prompt, cfg) {
        if (!cfg.key) throw new Error('Missing ChatGPT API key — add it in Settings.');
        if (!cfg.model) throw new Error('Missing ChatGPT model — add it in Settings.');
        const res = await gmRequest({
          method: 'POST',
          url: 'https://api.openai.com/v1/chat/completions',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.key}` },
          data: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: prompt }] }),
        });
        const json = parseJson(res);
        if (json.error) throw new Error(json.error.message || 'ChatGPT API error');
        return (json.choices?.[0]?.message?.content || '').trim();
      },
    },
    {
      key: 'gemini', label: 'Gemini', color: '#4285F4',
      webUrl: 'https://aistudio.google.com/prompts/new_chat',
      fields: [
        { id: 'key', label: 'API Key', type: 'password', placeholder: 'AIza...' },
        { id: 'model', label: "Model", type: 'text', placeholder: 'e.g. gemini-2.5-flash' },
      ],
      async call(prompt, cfg) {
        if (!cfg.key) throw new Error('Missing Gemini API key — add it in Settings.');
        if (!cfg.model) throw new Error('Missing Gemini model — add it in Settings.');
        const res = await gmRequest({
          method: 'POST',
          url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.key)}`,
          headers: { 'Content-Type': 'application/json' },
          data: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
        });
        const json = parseJson(res);
        if (json.error) throw new Error(json.error.message || 'Gemini API error');
        const parts = json.candidates?.[0]?.content?.parts || [];
        return parts.map((p) => p.text || '').join('').trim();
      },
    },
    {
      key: 'llamacpp', label: 'Local (llama.cpp)', color: '#6F42C1',
      fields: [
        { id: 'baseUrl', label: 'Server URL', type: 'text', placeholder: 'http://127.0.0.1:8021' },
        { id: 'model', label: 'Model (optional)', type: 'text', placeholder: 'depends on your server config' },
        { id: 'key', label: 'API Key (optional)', type: 'password', placeholder: 'if needed' },
      ],
      async call(prompt, cfg) {
        const base = (cfg.baseUrl || 'http://127.0.0.1:8021').replace(/\/+$/, '');
        const headers = { 'Content-Type': 'application/json' };
        if (cfg.key) headers.Authorization = `Bearer ${cfg.key}`;
        const res = await gmRequest({
          method: 'POST', url: `${base}/v1/chat/completions`, headers,
          data: JSON.stringify({ model: cfg.model || 'local', messages: [{ role: 'user', content: prompt }] }),
        });
        const json = parseJson(res);
        if (json.error) throw new Error(json.error.message || 'llama.cpp server error');
        return (json.choices?.[0]?.message?.content || '').trim();
      },
    },
  ];

  function gmRequest(opts) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({ timeout: 90000, ...opts,
        onload: (res) => { if (res.status >= 200 && res.status < 300) resolve(res); else reject(new Error(`HTTP ${res.status}: ${res.responseText?.slice(0, 300) || res.statusText}`)); },
        onerror: () => reject(new Error('Network error reaching the API — check key and connection.')),
        ontimeout: () => reject(new Error('Request timed out.')),
      });
    });
  }

  function parseJson(res) {
    try { return JSON.parse(res.responseText); } catch { throw new Error('Could not parse API response as JSON.'); }
  }

  // ── Gmail theme CSS (material-ish, matches Gmail's own palette) ───────
  const STYLES = `
    #gmail-ai-root { font-family: Google Sans, Roboto, Arial, sans-serif; z-index: 100001; }
    #gmail-ai-fab {
      position: fixed; bottom: 28px; right: 28px; width: 56px; height: 56px;
      border-radius: 16px; background: #1a73e8; color: #fff; border: none;
      cursor: pointer; display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 8px rgba(26,115,232,0.35); transition: background 0.15s, box-shadow 0.15s;
      font-size: 24px; z-index: 100001;
    }
    #gmail-ai-fab:hover { background: #1765cc; box-shadow: 0 4px 16px rgba(26,115,232,0.45); }
    #gmail-ai-fab:active { background: #1558b0; }
    #gmail-ai-fab.disabled { opacity: 0.4; pointer-events: none; }

    #gmail-ai-panel {
      position: fixed; bottom: 96px; right: 28px; width: 380px; max-height: 75vh;
      background: #fff; color: #202124; border-radius: 16px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.18); display: none; flex-direction: column;
      overflow: hidden; z-index: 100001; font-size: 13px;
    }
    #gmail-ai-panel.open { display: flex; }

    .gmail-ai-header {
      padding: 14px 16px; background: #fff; border-bottom: 1px solid #e8eaed;
      font-weight: 500; font-size: 14px; display: flex; justify-content: space-between; align-items: center;
    }
    .gmail-ai-header-right { display: flex; align-items: center; gap: 10px; }
    .gmail-ai-subtitle { font-size: 11px; color: #5f6368; }

    .gmail-ai-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 12px; overflow-y: auto; }

    .gmail-ai-label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #5f6368; font-weight: 500; margin-bottom: 4px; }

    #gmail-ai-context {
      width: 100%; height: 80px; border: 1px solid #dadce0; border-radius: 8px; padding: 10px;
      font-size: 12px; resize: vertical; font-family: inherit; box-sizing: border-box;
    }
    #gmail-ai-context:focus { outline: none; border-color: #1a73e8; box-shadow: 0 0 0 2px rgba(26,115,232,0.2); }

    #gmail-ai-clear-btn {
      width: 100%; padding: 8px; background: #fff; color: #d93025; border: 1px solid #f5cccc;
      border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 500;
    }
    #gmail-ai-clear-btn:hover { background: #fce8e6; }

    .gmail-ai-divider { border: none; border-top: 1px solid #e8eaed; margin: 4px 0; }

    .gmail-ai-providers { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

    .gmail-ai-provider-btn {
      padding: 10px 6px; border: 1px solid #dadce0; border-radius: 8px; cursor: pointer;
      font-size: 12px; font-weight: 500; color: #3c4043; background: #fff; transition: all 0.15s;
      text-align: center; display: flex; flex-direction: column; gap: 2px;
    }
    .gmail-ai-provider-btn:hover { background: #f8f9fa; border-color: #dcdcdc; }
    .gmail-ai-provider-btn:active { background: #f1f3f4; }
    .gmail-ai-provider-btn.active { border-color: #1a73e8; background: #e8f0fe; }
    .gmail-ai-provider-mode { font-size: 9px; color: #5f6368; text-transform: uppercase; letter-spacing: 0.3px; }
    .gmail-ai-provider-mode.api-ready { color: #1e8e3e; }

    #gmail-ai-settings {
      display: none; flex-direction: column; gap: 10px; background: #f8f9fa; border: 1px solid #dadce0; border-radius: 8px; padding: 12px;
    }
    #gmail-ai-settings.open { display: flex; }
    .gmail-ai-sgroup { display: flex; flex-direction: column; gap: 4px; }
    .gmail-ai-sgroup-title { font-size: 12px; font-weight: 600; color: #1a73e8; }
    .gmail-ai-settings-field-label { font-size: 11px; color: #5f6368; }
    .gmail-ai-settings-field {
      width: 100%; padding: 7px 8px; border: 1px solid #dadce0; border-radius: 6px;
      font-size: 12px; box-sizing: border-box; font-family: inherit;
    }
    .gmail-ai-settings-field:focus { outline: none; border-color: #1a73e8; box-shadow: 0 0 0 2px rgba(26,115,232,0.2); }

    .gmail-ai-status { font-size: 11px; color: #1e8e3e; text-align: center; min-height: 16px; transition: opacity 0.3s; white-space: pre-line; }
    .gmail-ai-status.warn { color: #f9ab00; }
    .gmail-ai-status.error { color: #d93025; }

    /* Reply picker modal */
    #gmail-ai-modal-overlay {
      position: fixed; inset: 0; z-index: 100002; background: rgba(0,0,0,0.4);
      display: none; align-items: center; justify-content: center;
    }
    #gmail-ai-modal-overlay.open { display: flex; }
    #gmail-ai-modal {
      width: 460px; max-width: 92vw; max-height: 82vh; overflow: hidden; background: #fff;
      border-radius: 16px; box-shadow: 0 12px 48px rgba(0,0,0,0.25); display: flex; flex-direction: column;
    }
    #gmail-ai-modal-header {
      padding: 14px 16px; font-weight: 500; font-size: 15px; color: #202124;
      display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e8eaed;
    }
    #gmail-ai-modal-close { background: none; border: none; cursor: pointer; font-size: 18px; color: #5f6368; padding: 4px; }
    #gmail-ai-modal-close:hover { color: #202124; }

    .gmail-ai-tab-bar { display: flex; border-bottom: 1px solid #e8eaed; padding: 0 16px; gap: 0; }
    .gmail-ai-tab {
      padding: 10px 16px; cursor: pointer; font-size: 12px; font-weight: 500;
      color: #5f6368; border-bottom: 2px solid transparent; background: none; border-top: none; border-left: none; border-right: none; transition: all 0.15s;
    }
    .gmail-ai-tab:hover { color: #202124; }
    .gmail-ai-tab.active { color: #1a73e8; border-bottom-color: #1a73e8; }
    .gmail-ai-tab-badge { font-size: 10px; padding: 1px 6px; border-radius: 10px; background: #f1f3f4; color: #5f6368; margin-left: 4px; }
    .gmail-ai-tab.active .gmail-ai-tab-badge { background: #e8f0fe; color: #1a73e8; }

    .gmail-ai-modal-body { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; overflow-y: auto; flex: 1; }
    .gmail-ai-tab-panel { display: none; }
    .gmail-ai-tab-panel.active { display: flex; flex-direction: column; gap: 10px; }

    .gmail-ai-card { border: 1px solid #dadce0; border-radius: 12px; padding: 14px; cursor: pointer; transition: all 0.15s; }
    .gmail-ai-card:hover { border-color: #1a73e8; background: #f8fbff; }
    .gmail-ai-card-text { font-size: 12.5px; color: #202124; white-space: pre-wrap; max-height: 200px; overflow-y: auto; line-height: 1.6; margin-bottom: 8px; }
    .gmail-ai-card-actions { display: flex; gap: 8px; }
    .gmail-ai-card-actions button {
      flex: 1; padding: 8px; border-radius: 8px; cursor: pointer; font-size: 12px; font-weight: 500;
    }
    .gmail-ai-btn-copy { border: 1px solid #dadce0; background: #fff; color: #3c4043; }
    .gmail-ai-btn-copy:hover { background: #f8f9fa; }
    .gmail-ai-btn-use { border: 1px solid #8ab4f8; background: #e8f0fe; color: #1a73e8; }
    .gmail-ai-btn-use:hover { background: #d2e3fc; }

    .gmail-ai-email-card { border: 1px solid #fce8e6; border-radius: 12px; padding: 14px; background: #fef7f0; }
    .gmail-ai-email-header { font-size: 11px; font-weight: 600; color: #c5221f; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 8px; }
    .gmail-ai-email-text { font-size: 12px; color: #202124; white-space: pre-wrap; max-height: 260px; overflow-y: auto; line-height: 1.5; margin-bottom: 8px; }

    .gmail-ai-slack-card { border: 1px solid #dadce0; border-radius: 12px; padding: 14px; }
    .gmail-ai-slack-header { font-size: 11px; font-weight: 600; color: #8430ce; text-transform: uppercase; letter-spacing: 0.3px; margin-bottom: 8px; }
    .gmail-ai-slack-text { font-size: 12px; color: #202124; white-space: pre-wrap; max-height: 160px; overflow-y: auto; line-height: 1.5; margin-bottom: 8px; }

    .gmail-ai-empty { text-align: center; color: #9aa0a6; font-size: 13px; padding: 24px 0; }

    /* Tweak row */
    #gmail-ai-tweak-row { display: none; padding-top: 10px; border-top: 1px solid #e8eaed; margin-top: 6px; }
    .gmail-ai-tweak-label { font-size: 12px; color: #5f6368; margin-bottom: 6px; }
    .gmail-ai-tweak-inputs { display: flex; gap: 8px; }
    #gmail-ai-tweak-input {
      flex: 1; min-width: 0; padding: 8px 10px; border: 1px solid #dadce0; border-radius: 8px;
      font-size: 13px; background: #fff; color: #202124;
    }
    #gmail-ai-tweak-input:focus { outline: none; border-color: #1a73e8; box-shadow: 0 0 0 2px rgba(26,115,232,0.2); }
    #gmail-ai-tweak-btn { padding: 8px 14px; border: none; border-radius: 8px; background: #1a73e8; color: #fff; font-size: 13px; cursor: pointer; white-space: nowrap; }
    #gmail-ai-tweak-btn:hover { background: #1765cc; }
    #gmail-ai-tweak-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    #gmail-ai-tweak-undo { display: none; margin-top: 6px; font-size: 12px; color: #1a73e8; cursor: pointer; }

    /* Context warning */
    .gmail-ai-no-thread { text-align: center; color: #f9ab00; font-size: 12px; padding: 16px; background: #fef7e0; border-radius: 8px; }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = STYLES;
  document.head.appendChild(styleEl);

  // ── DOM elements ───────────────────────────────────────────────────────
  const root = document.createElement('div');
  root.id = 'gmail-ai-root';

  // Floating Action Button (FAB)
  const fab = document.createElement('button');
  fab.id = 'gmail-ai-fab';
  fab.textContent = '✦';
  fab.title = 'Gmail AI Reply Assistant — generate draft replies from thread context';

  // Panel
  const panel = document.createElement('div');
  panel.id = 'gmail-ai-panel';
  setHTML(panel, `
    <div class="gmail-ai-header">
      <span>AI Reply Assistant</span>
      <div class="gmail-ai-header-right">
        <span class="gmail-ai-subtitle" id="gmail-ai-info"></span>
        <button id="gmail-ai-settings-toggle" title="API settings" style="background:none;border:none;cursor:pointer;font-size:16px;color:#5f6368;">⚙</button>
      </div>
    </div>
    <div class="gmail-ai-body">
      <div id="gmail-ai-settings"></div>
      <div>
        <div class="gmail-ai-label">Extra Context (this thread only)</div>
        <textarea id="gmail-ai-context" placeholder="Paste patient care plan, Zoho notes, medication history, or any other context here... (cleared when you switch emails)"></textarea>
      </div>
      <button id="gmail-ai-clear-btn">🗑 CLEAR CONTEXT</button>
      <hr class="gmail-ai-divider">
      <div class="gmail-ai-label">Generate a draft — reads the email thread. With an API key it calls the model directly; without one it copies the prompt and opens the site (★ = last used)</div>
      <div class="gmail-ai-providers" id="gmail-ai-providers"></div>
      <div class="gmail-ai-status" id="gmail-ai-status"></div>
    </div>
  `);

  // Reply picker modal
  const overlay = document.createElement('div');
  overlay.id = 'gmail-ai-modal-overlay';
  setHTML(overlay, `
    <div id="gmail-ai-modal">
      <div id="gmail-ai-modal-header">
        <span>Draft Options</span>
        <button id="gmail-ai-modal-close" title="Close">✕</button>
      </div>
      <div class="gmail-ai-tab-bar">
        <button class="gmail-ai-tab active" data-tab="replies">💬 Drafts <span class="gmail-ai-tab-badge" id="gmail-ai-replies-count">0</span></button>
        <button class="gmail-ai-tab" data-tab="email">📧 Email <span class="gmail-ai-tab-badge" id="gmail-ai-email-badge" style="display:none">1</span></button>
        <button class="gmail-ai-tab" data-tab="slack">💬 Slack <span class="gmail-ai-tab-badge" id="gmail-ai-slack-count">0</span></button>
      </div>
      <div class="gmail-ai-modal-body" id="gmail-ai-modal-body"></div>
      <div id="gmail-ai-tweak-row">
        <div class="gmail-ai-tweak-label">✏️ Need tweaks? Describe what to change and the AI will redraft:</div>
        <div class="gmail-ai-tweak-inputs">
          <input id="gmail-ai-tweak-input" type="text" placeholder="e.g. shorter, less formal, add dosage info…">
          <button id="gmail-ai-tweak-btn" type="button">Redraft</button>
        </div>
        <div id="gmail-ai-tweak-undo">↩ Undo last revision</div>
      </div>
    </div>
  `);

  document.body.appendChild(root);
  root.appendChild(fab);
  document.body.appendChild(panel);
  document.body.appendChild(overlay);

  // DOM refs
  const infoEl = panel.querySelector('#gmail-ai-info');
  const settingsEl = panel.querySelector('#gmail-ai-settings');
  const settingsToggle = panel.querySelector('#gmail-ai-settings-toggle');
  const contextArea = panel.querySelector('#gmail-ai-context');
  const providersEl = panel.querySelector('#gmail-ai-providers');
  const statusEl = panel.querySelector('#gmail-ai-status');
  const modalBody = panel.querySelector('#gmail-ai-modal-body') || document.getElementById('gmail-ai-modal-body');
  const tabBtns = overlay.querySelectorAll('.gmail-ai-tab');

  // ── Status helpers ─────────────────────────────────────────────────────
  let statusTimer = null;
  function setStatus(msg, cls = '', sticky = false) {
    statusEl.textContent = msg;
    statusEl.className = 'gmail-ai-status' + (cls ? ` ${cls}` : '');
    clearTimeout(statusTimer);
    if (!sticky) statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 6000);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── Settings panel ─────────────────────────────────────────────────────
  function renderSettings() {
    settingsEl.replaceChildren();
    PROVIDERS.forEach((provider) => {
      const group = document.createElement('div');
      group.className = 'gmail-ai-sgroup';
      const title = document.createElement('div');
      title.className = 'gmail-ai-sgroup-title';
      title.textContent = provider.label;
      group.appendChild(title);

      provider.fields.forEach((f) => {
        const storageKey = `gmail_ai_cfg_${provider.key}_${f.id}`;
        const label = document.createElement('div');
        label.className = 'gmail-ai-settings-field-label';
        label.textContent = f.label;
        const input = document.createElement('input');
        input.className = 'gmail-ai-settings-field';
        input.type = f.type;
        input.placeholder = f.placeholder;
        input.value = GM_getValue(storageKey, '');
        input.addEventListener('input', () => {
          GM_setValue(storageKey, input.value);
          renderProviderButtons();
        });
        group.appendChild(label);
        group.appendChild(input);
      });
      settingsEl.appendChild(group);
    });
  }
  renderSettings();

  settingsToggle.addEventListener('click', () => settingsEl.classList.toggle('open'));

  // ── Conversation key for context isolation ─────────────────────────────
  function currentThreadKey() {
    const url = new URL(location.href);
    return 'th:' + (url.searchParams.get('th') || url.searchParams.get('q') || '');
  }
  let loadedThreadKey = null;

  function loadContextForCurrentThread() {
    const key = currentThreadKey();
    if (key === loadedThreadKey) return;
    loadedThreadKey = key;
    contextArea.value = GM_getValue('gmail_ai_context::' + key, '');
    const lastForConvo = GM_getValue('gmail_ai_last_draft::' + key, '');
    infoEl.textContent = lastForConvo ? `last: ${lastForConvo}` : '';
  }

  contextArea.addEventListener('input', () => {
    GM_setValue('gmail_ai_context::' + currentThreadKey(), contextArea.value);
  });

  panel.querySelector('#gmail-ai-clear-btn').addEventListener('click', () => {
    contextArea.value = '';
    GM_deleteValue('gmail_ai_context::' + currentThreadKey());
    setStatus('Context cleared.', '', true);
  });

  // ── Gmail mode detection (compose vs thread) ─────────────────────────
  function detectGmailMode() {
    // Fresh compose window = dialog with subject box / To field
    const dialogSubject = document.querySelector('div[role="dialog"] input[name="subjectbox"]');
    const dialogTo = document.querySelector('div[role="dialog"] textarea[name="to"], div[role="dialog"] div[role="combobox"]');
    if (dialogSubject || dialogTo) return 'compose';
    // In-thread reply box (not a dialog)
    const replyBox = document.querySelector('div[role="textbox"][contenteditable="true"]');
    if (replyBox) return 'reply';
    // Any conversation message visible
    const threadMsg = document.querySelector('div[jslog*="thread_message"], div[data-message-id]');
    if (threadMsg) return 'thread';
    return 'inbox';
  }

  function extractComposeInfo() {
    const dialog = document.querySelector('div[role="dialog"]');
    const toEl = dialog ? dialog.querySelector('textarea[name="to"]') : null;
    const subjectEl = dialog ? dialog.querySelector('input[name="subjectbox"]') : null;
    const bodyEl = dialog ? dialog.querySelector('div[role="textbox"][contenteditable="true"]') : null;
    return {
      to: toEl ? toEl.value.trim() : '',
      subject: subjectEl ? subjectEl.value.trim() : '',
      bodySeed: bodyEl ? bodyEl.innerText.trim().slice(0, 4000) : '',
    };
  }

  // ── Gmail thread harvesting ───────────────────────────────────────────
  function extractEmailSubject() {
    const subjectEl = document.querySelector('[data-tooltip="Subject"]');
    if (subjectEl) return subjectEl.textContent.trim();
    const subjectMeta = document.querySelector('meta[name="subject"]');
    return subjectMeta ? subjectMeta.getAttribute('content') : '';
  }

  function extractFromEmail() {
    const fromEls = document.querySelectorAll('[data-tooltip="From"], [data-email]');
    for (const el of fromEls) {
      const email = el.getAttribute('data-email');
      if (email && email.includes('@')) return email;
      const nameEl = el.querySelector('.aQs, .aD6');
      if (nameEl) return nameEl.textContent.trim();
    }
    return 'Unknown';
  }

  function extractThreadMessages() {
    const msgs = [];
    // VERIFIED against live Gmail 2026-08-17: each message is a
    // div[data-message-id] (class "adn ads"); sender in span[email];
    // body in .gs (strip quoted replies via .gmail_quote / .elided).
    let containerEls = [...document.querySelectorAll('div[data-message-id]')];
    if (containerEls.length === 0) {
      // Fallback: jslog-based containers
      containerEls = [...document.querySelectorAll('div[jslog*="thread_message"], div[role="listitem"]')];
    }

    for (const el of containerEls) {
      // Sender: first span[email] that isn't "me"
      let sender = '';
      const emailEls = [...el.querySelectorAll('span[email]')];
      for (const e of emailEls) {
        const addr = e.getAttribute('email') || '';
        const label = e.textContent.trim();
        if (addr && !/^me$/i.test(label)) {
          sender = `${label || addr} <${addr}>`;
          break;
        }
      }
      if (!sender) {
        const h = el.querySelector('.gD, [role="heading"]');
        if (h) sender = h.textContent.trim();
      }
      if (!sender) sender = 'Unknown';

      // Date: the .g3 / time-ish leaf
      let dateTime = '';
      const timeEl = el.querySelector('.g3, [data-tooltip] span, table[role="presentation"] [dir="ltr"] span');
      if (timeEl) dateTime = timeEl.textContent.trim();

      // Body: .gs container; drop quoted/hidden parts
      const bodyEl = el.querySelector('.gs') || el.querySelector('div[dir="ltr"]');
      if (!bodyEl) continue;
      const quote = bodyEl.querySelector('.gmail_quote, .elided, .gmail_extra, .yj6qo');
      const text = (bodyEl.textContent || '')
        .replace(quote ? quote.textContent : '', '')
        .replace(/\s+/g, ' ')
        .trim();
      if (!text || text.length < 3) continue;

      msgs.push({ sender, text, dateTime });
    }

    // Fallback: try the full thread body and split by known separators
    if (msgs.length < 1) {
      const threadBody = document.querySelector('div[role="presentation"], div.Am, div.x7');
      if (threadBody) {
        return extractFromThreadBody(threadBody);
      }
    }

    return msgs;
  }

  function extractFromThreadBody(body) {
    const msgs = [];
    // Gmail's inner thread body has nested message panes
    const messagePanes = body.querySelectorAll('div.Am, div.js-KC-Ma-IK, div[role="document"]');
    for (const pane of messagePanes) {
      const textEl = pane.querySelector('div[jsname="YPqjbf"]') || pane.querySelector('[data-tooltip="From"]')?.parentElement;
      if (!textEl) continue;
      const text = textEl.textContent?.trim();
      if (!text || text.length < 3) continue;

      let sender = '';
      const senderEl = pane.querySelector('[data-email]');
      if (senderEl) sender = senderEl.getAttribute('data-email') || senderEl.textContent?.trim() || '';

      let dateTime = '';
      const timeEl = pane.querySelector('[aria-label]');
      if (timeEl) dateTime = timeEl.getAttribute('aria-label') || '';

      msgs.push({ sender: sender || 'Unknown', text, dateTime });
    }
    return msgs;
  }

  function getThreadSubject() {
    // Subject is typically in the top bar or hidden meta
    const subjectText = extractEmailSubject();
    return subjectText || 'Email Thread';
  }

  function getPatientName() {
    // First line of the thread body usually has the sender name
    const fromEmail = extractFromEmail();
    if (fromEmail.includes('@')) {
      // Try to extract a display name — Gmail often shows "First Last <email>"
      return fromEmail;
    }
    return fromEmail || 'Unknown';
  }

  function buildPrompt() {
    // Fresh compose mode: draft a new email (no thread to harvest)
    if (detectGmailMode() === 'compose') {
      const info = extractComposeInfo();
      const context = contextArea.value.trim();
      const contextBlock = context ? `--- ADDITIONAL CONTEXT ---\n${context}\n--- END CONTEXT ---\n\n` : '';
      const threadKey = 'compose:' + (info.subject || info.to || 'draft');
      const prompt = PROMPT_TEMPLATE
        .replace(
          /--- PATIENT EMAIL THREAD ---\nSubject: \{\{EMAIL_SUBJECT\}\}\n\{\{MESSAGES\}\}\n--- END THREAD ---/,
          info.bodySeed
            ? `--- DRAFT IN PROGRESS ---\nTo: ${info.to}\nSubject: ${info.subject}\n${info.bodySeed}\n--- END DRAFT ---`
            : `--- NEW EMAIL REQUEST ---\nTo: ${info.to}\nSubject: ${info.subject}\n(no body written yet — draft the complete email from context)\n--- END REQUEST ---`
        )
        .replace('{{PATIENT_NAME}}', info.to || 'Patient')
        .replace('{{EMAIL_SUBJECT}}', info.subject || 'No subject')
        .replace('{{THREAD_KEY}}', threadKey)
        .replace('{{CONTEXT_BLOCK}}', contextBlock)
        .replace('Draft 3+ email reply options', 'Draft 3+ complete email options');
      return {
        prompt,
        count: info.bodySeed ? 1 : 0,
        patientName: info.to || 'New email',
        subject: info.subject || 'No subject',
      };
    }

    const msgs = extractThreadMessages();
    if (msgs.length === 0 && !contextArea.value.trim()) return null;

    // Sort by date if available
    msgs.sort((a, b) => {
      if (a.dateTime && b.dateTime) {
        try { return new Date(a.dateTime) - new Date(b.dateTime); } catch { return 0; }
      }
      return 0;
    });

    const lastSender = msgs[msgs.length - 1]?.sender || '';

    const lines = msgs.map((m, i) => {
      if (!m.sender) m.sender = i < msgs.length - 1 ? (msgs[i].sender || 'Unknown') : lastSender;
      const datePrefix = m.dateTime ? `${m.dateTime}, ` : '';
      return `[${(datePrefix + 'email').trim()}] ${m.sender}: ${m.text}`;
    });

    const fromName = getPatientName();
    const patientName = msgs.length === 0 && fromName === 'Unknown' ? 'Patient' : fromName;
    const subject = getThreadSubject();
    const context = contextArea.value.trim();
    const contextBlock = context ? `--- ADDITIONAL CONTEXT ---\n${context}\n--- END CONTEXT ---\n\n` : '';
    const threadKey = currentThreadKey();

    return {
      prompt: PROMPT_TEMPLATE
        .replace('{{PATIENT_NAME}}', patientName)
        .replace('{{EMAIL_SUBJECT}}', subject || 'No subject')
        .replace('{{THREAD_KEY}}', threadKey)
        .replace('{{MESSAGES}}', msgs.length ? lines.join('\n') : '(no email thread available — drafting from context only)')
        .replace('{{CONTEXT_BLOCK}}', contextBlock),
      count: msgs.length,
      patientName,
      subject: subject || 'No subject',
    };
  }

  // ── Gmail composer interaction ────────────────────────────────────────
  function findGmailComposer() {
    // Fresh compose dialog body (rich text)
    const dialogBody = document.querySelector('div[role="dialog"] div[role="textbox"][contenteditable="true"]');
    if (dialogBody) return { el: dialogBody, type: 'contenteditable' };

    // In-thread reply box
    const replyBox = document.querySelector('div[role="textbox"][contenteditable="true"]');
    if (replyBox) return { el: replyBox, type: 'contenteditable' };

    // Legacy / textarea fallbacks
    const textarea = document.querySelector('textarea.kR, textarea[name="body"]');
    if (textarea) return { el: textarea, type: 'textarea' };

    // Draft editor body
    const draftBody = document.querySelector('div#editable.editor-body[contenteditable="true"]');
    if (draftBody) return { el: draftBody, type: 'contenteditable' };

    return null;
  }

  function insertIntoGmailComposer(text) {
    const composer = findGmailComposer();
    if (!composer) return false;

    // Wait a tick for any Gmail transitions
    setTimeout(() => {
      if (composer.type === 'textarea') {
        composer.el.focus();
        composer.el.value += text;
        composer.el.dispatchEvent(new Event('input', { bubbles: true }));
      } else {
        composer.el.focus();
        document.execCommand('insertText', false, text);
      }
    }, 50);

    return true;
  }

  // ── FAB click handler ──────────────────────────────────────────────────
  let busy = false;

  fab.addEventListener('click', async () => {
    loadContextForCurrentThread();
    const mode = detectGmailMode();
    infoEl.textContent = mode === 'compose'
      ? '✍️ compose mode'
      : mode === 'reply'
        ? '📩 reply mode'
        : mode === 'thread'
          ? '📧 thread mode'
          : '⚠️ open a thread or compose';
    panel.classList.toggle('open');
  });

  // ── Reply picker modal ────────────────────────────────────────────────
  const replyTabBadge = overlay.querySelector('#gmail-ai-replies-count');
  const emailBadge = overlay.querySelector('#gmail-ai-email-badge');
  const slackBadge = overlay.querySelector('#gmail-ai-slack-count');

  let lastGen = null; // { providerKey, prompt, output } for redraft
  const LAST_PROVIDER_KEY = 'gmail_ai_last_provider';

  function closeReplyModal() {
    overlay.classList.remove('open');
  }

  function pasteReplyAndClose(text) {
    insertIntoGmailComposer(text);
    closeReplyModal();
    GM_setValue('gmail_ai_last_draft::' + currentThreadKey(), new Date().toLocaleString());
    setStatus('✅ Draft inserted into compose — review before sending.');
  }

  function showReplyModal(rawText) {
    // Tweak row state
    const tweakRow = overlay.querySelector('#gmail-ai-tweak-row');
    const tweakInput = overlay.querySelector('#gmail-ai-tweak-input');
    const tweakUndo = overlay.querySelector('#gmail-ai-tweak-undo');
    if (tweakRow) tweakRow.style.display = lastGen ? 'block' : 'none';
    if (tweakInput) tweakInput.value = '';
    if (tweakUndo) tweakUndo.style.display = 'none';

    const smsOptions = extractReplyOptions(rawText);
    const emailContent = extractEmailContent(rawText);
    const slackNotes = extractSlackNotes(rawText);

    replyTabBadge.textContent = smsOptions.length;
    emailBadge.style.display = emailContent ? 'inline' : 'none';
    slackBadge.textContent = slackNotes.length;

    let activeTab = 'replies';
    if (smsOptions.length === 0 && emailContent) activeTab = 'email';
    else if (smsOptions.length === 0 && slackNotes.length > 0) activeTab = 'slack';

    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === activeTab));

    buildModalPanels(smsOptions, emailContent, slackNotes, activeTab);
    overlay.classList.add('open');
  }

  function buildModalPanels(smsOptions, emailContent, slackNotes, activeTab) {
    modalBody.replaceChildren();

    // Replies tab
    const repliesPanel = document.createElement('div');
    repliesPanel.className = 'gmail-ai-tab-panel' + (activeTab === 'replies' ? ' active' : '');
    if (smsOptions.length === 0) {
      setHTML(repliesPanel, '<div class="gmail-ai-empty">No draft replies found.</div>');
    } else {
      smsOptions.forEach((opt, i) => {
        const card = document.createElement('div');
        card.className = 'gmail-ai-card';
        const textEl = document.createElement('div');
        textEl.className = 'gmail-ai-card-text';
        textEl.textContent = opt;
        const actions = document.createElement('div');
        actions.className = 'gmail-ai-card-actions';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'gmail-ai-btn-copy';
        copyBtn.textContent = '📋 Copy';
        copyBtn.addEventListener('click', (e) => { e.stopPropagation(); GM_setClipboard(opt, 'text'); setStatus(`✅ Draft ${i+1} copied.`); });

        const useBtn = document.createElement('button');
        useBtn.className = 'gmail-ai-btn-use';
        useBtn.textContent = '✍️ Use This';
        useBtn.addEventListener('click', (e) => { e.stopPropagation(); pasteReplyAndClose(opt); });

        actions.appendChild(copyBtn);
        actions.appendChild(useBtn);
        card.appendChild(textEl);
        card.appendChild(actions);
        card.addEventListener('click', () => pasteReplyAndClose(opt));
        repliesPanel.appendChild(card);
      });
    }
    modalBody.appendChild(repliesPanel);

    // Email tab
    const emailPanel = document.createElement('div');
    emailPanel.className = 'gmail-ai-tab-panel' + (activeTab === 'email' ? ' active' : '');
    if (!emailContent) {
      setHTML(emailPanel, '<div class="gmail-ai-empty">No escalation email in this response.</div>');
    } else {
      const card = document.createElement('div');
      card.className = 'gmail-ai-email-card';
      const header = document.createElement('div');
      header.className = 'gmail-ai-email-header';
      header.textContent = '📧 Escalation Email';
      const textEl = document.createElement('div');
      textEl.className = 'gmail-ai-email-text';
      textEl.textContent = emailContent;
      const actions = document.createElement('div');
      actions.className = 'gmail-ai-card-actions';

      const copyBtn = document.createElement('button');
      copyBtn.className = 'gmail-ai-btn-copy';
      copyBtn.style.color = '#c5221f';
      copyBtn.style.borderColor = '#fce8e6';
      copyBtn.textContent = '📋 Copy Email';
      copyBtn.addEventListener('click', (e) => { e.stopPropagation(); GM_setClipboard(emailContent, 'text'); setStatus('✅ Escalation email copied.'); });

      const openGmailBtn = document.createElement('button');
      openGmailBtn.className = 'gmail-ai-btn-copy';
      openGmailBtn.style.color = '#c5221f';
      openGmailBtn.style.borderColor = '#fce8e6';
      openGmailBtn.textContent = '📬 Open Compose';
      const subjectMatch = emailContent.match(/^Subject:\s*(.+)$/m);
      const subject = subjectMatch ? subjectMatch[1].trim() : 'Escalation';
      const body = emailContent.replace(/^Subject:.*\n?/m, '').trim();
      openGmailBtn.addEventListener('click', (e) => { e.stopPropagation(); GM_setClipboard(emailContent, 'text'); window.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank'); setStatus('✅ Email copied & compose opened.'); });

      actions.appendChild(copyBtn);
      actions.appendChild(openGmailBtn);
      card.appendChild(header);
      card.appendChild(textEl);
      card.appendChild(actions);
      emailPanel.appendChild(card);
    }
    modalBody.appendChild(emailPanel);

    // Slack tab
    const slackPanel = document.createElement('div');
    slackPanel.className = 'gmail-ai-tab-panel' + (activeTab === 'slack' ? ' active' : '');
    if (slackNotes.length === 0) {
      setHTML(slackPanel, '<div class="gmail-ai-empty">No Slack forwarding notes.</div>');
    } else {
      slackNotes.forEach((note) => {
        const card = document.createElement('div');
        card.className = 'gmail-ai-slack-card';
        const header = document.createElement('div');
        header.className = 'gmail-ai-slack-header';
        header.textContent = `💬 Slack Note to ${note.recipient}`;
        const textEl = document.createElement('div');
        textEl.className = 'gmail-ai-slack-text';
        textEl.textContent = note.content;
        const actions = document.createElement('div');
        actions.className = 'gmail-ai-card-actions';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'gmail-ai-btn-copy';
        copyBtn.textContent = '📋 Copy';
        copyBtn.addEventListener('click', (e) => { e.stopPropagation(); GM_setClipboard(note.content, 'text'); setStatus(`✅ Slack note to ${note.recipient} copied.`); });

        actions.appendChild(copyBtn);
        card.appendChild(header);
        card.appendChild(textEl);
        card.appendChild(actions);
        slackPanel.appendChild(card);
      });
    }
    modalBody.appendChild(slackPanel);

    // Tweak row event handlers (need to be re-wired after rebuild)
    const tweakBtn = overlay.querySelector('#gmail-ai-tweak-btn');
    const undoEl = overlay.querySelector('#gmail-ai-tweak-undo');
    if (tweakBtn && !tweakBtn.dataset.wired) {
      tweakBtn.addEventListener('click', handleRedraft);
      undoEl?.addEventListener('click', () => {
        if (lastGen && lastGen.prevOutput) {
          showChoiceModal(lastGen.prevOutput);
          setStatus('✅ Undo applied.');
        }
      });
      tweakBtn.dataset.wired = '1';
    }
  }

  // Tab switching
  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === btn.dataset.tab));
      modalBody.querySelectorAll('.gmail-ai-tab-panel').forEach(p => {
        p.classList.toggle('active', p.querySelector(`[data-tab="${btn.dataset.tab}"]`) || p.id === `gmail-ai-${btn.dataset.tab}` || true);
      });
    });
  });

  overlay.querySelector('#gmail-ai-modal-close').addEventListener('click', closeReplyModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeReplyModal(); });

  // ── Helper: extract reply options from AI output ──────────────────────
  function extractReplyOptions(text) {
    const codeBlockRegex = /```(?:\w*\n)?([\s\S]*?)```/g;
    const options = [];
    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
      const block = match[1].trim();
      if (block) options.push(block);
    }
    if (options.length === 0) {
      const trimmed = text.trim();
      if (trimmed) options.push(trimmed);
    }
    return options;
  }

  function extractEmailContent(text) {
    const re = /---\s*\n📧\s*PHARMACY ESCALATION EMAIL\s*\n([\s\S]*?)(?=\n---|\n💬|$)/;
    const m = text.match(re);
    return m ? m[1].trim() : '';
  }

  function extractSlackNotes(text) {
    const notes = [];
    const re = /---\s*\n💬\s*SLACK NOTE TO\s+(.+?)\s*\n([\s\S]*?)(?=\n---|\n📧|$)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      notes.push({ recipient: m[1].trim(), content: m[2].trim() });
    }
    return notes;
  }

  // ── Provider buttons ──────────────────────────────────────────────────
  function providerConfig(provider) {
    const cfg = {};
    provider.fields.forEach((f) => cfg[f.id] = GM_getValue(`gmail_ai_cfg_${provider.key}_${f.id}`, ''));
    return cfg;
  }

  function hasApiConfigured(provider) {
    if (provider.key === 'llamacpp') return true;
    const cfg = providerConfig(provider);
    return !!(cfg.key && cfg.model);
  }

  function renderProviderButtons() {
    const lastKey = GM_getValue(LAST_PROVIDER_KEY, '');
    const ordered = [...PROVIDERS].sort((a, b) => (a.key === lastKey ? -1 : b.key === lastKey ? 1 : 0));
    providersEl.replaceChildren();
    ordered.forEach((provider) => {
      const apiReady = hasApiConfigured(provider);
      const btn = document.createElement('button');
      btn.className = 'gmail-ai-provider-btn' + (provider.key === lastKey ? ' active' : '');
      if (provider.key === lastKey) btn.style.borderLeft = `3px solid ${provider.color}`;
      setHTML(btn, `${provider.label}<div class="gmail-ai-provider-mode${apiReady ? ' api-ready' : ''}">${apiReady ? 'API' : 'copy → site'}</div>`);

      btn.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        fab.classList.add('disabled');
        closeReplyModal();
        try {
          setStatus('Scanning thread…', '', true);
          await sleep(300); // let Gmail paint any lazy-loaded messages

          const context = contextArea.value.trim();
          if (context) {
            GM_setValue('gmail_ai_context::' + currentThreadKey(), context);
          }

          const result = buildPrompt();
          if (!result) {
            setStatus('⚠️ Nothing to draft from — open a thread or add context in the panel first.', 'error', true);
            return;
          }

          log('Built prompt with', result.count, 'messages from', result.patientName);

          const apiReady = hasApiConfigured(provider);
          if (apiReady) {
            setStatus(`Sending ${result.count} messages to ${provider.label}…`, '', true);
            const cfg = providerConfig(provider);
            const reply = await provider.call(result.prompt, cfg);
            if (!reply) throw new Error('Empty response from the API.');
            lastGen = { providerKey: provider.key, prompt: result.prompt, output: reply };
            showReplyModal(reply);
            setStatus(`✅ Draft ready from ${provider.label}.`);
          } else {
            GM_setClipboard(result.prompt, 'text');
            setStatus(`✅ Copied ${result.count} messages — opening ${provider.label}… (add an API key in ⚙ Settings for auto-reply)`);
            window.open(provider.webUrl, '_blank');
          }

          GM_setValue(LAST_PROVIDER_KEY, provider.key);
          renderProviderButtons();
        } catch (err) {
          console.error('[Gmail AI] error:', err);
          setStatus(`⚠️ ${err.message || 'Error — check console.'}`, 'error', true);
        } finally {
          busy = false;
          fab.classList.remove('disabled');
        }
      });

      providersEl.appendChild(btn);
    });
  }
  renderProviderButtons();

  // ── Redraft handler ───────────────────────────────────────────────────
  async function handleRedraft() {
    const tweakBtn = overlay.querySelector('#gmail-ai-tweak-btn');
    if (tweakBtn.disabled || !lastGen) return;
    const tweak = overlay.querySelector('#gmail-ai-tweak-input').value.trim();
    if (!tweak) { setStatus('⚠️ Type what you want changed first.', 'warn', true); return; }

    tweakBtn.disabled = true;
    tweakBtn.textContent = 'Redrafting…';
    try {
      const provider = PROVIDERS.find((p) => p.key === lastGen.providerKey);
      if (!provider) throw new Error(`Provider ${lastGen.providerKey} unavailable.`);

      // Save previous output for undo
      const prevOutput = lastGen.output;
      const revisedPrompt =
        lastGen.prompt +
        '\n\n<revision_request>\nThe medical team member reviewed the drafts and wants one revision before sending.\n\nRevision requested: ' +
        tweak +
        '\n\nPrevious drafts:\n' +
        lastGen.output +
        '\n\nRe-draft applying this revision. Follow ALL the same rules. Keep the same output structure. Only output revised drafts.\n</revision_request>';

      const cfg = providerConfig(provider);
      const reply = await provider.call(revisedPrompt, cfg);
      if (!reply) throw new Error('Empty response from the API.');

      lastGen.output = reply;
      lastGen.prevOutput = prevOutput;
      showReplyModal(reply);
      setStatus('✅ Redrafted — revision applied.');
    } catch (err) {
      console.error('[Gmail AI] redraft error:', err);
      setStatus(`⚠️ ${err.message}`, 'error', true);
    } finally {
      tweakBtn.disabled = false;
      tweakBtn.textContent = 'Redraft';
    }
  }

  // ── PROMPT_TEMPLATE — Jones Medical Management, GLP-1s & peptides ────
  const PROMPT_TEMPLATE = `You are a pharmacist medical team assistant for Jones Medical Management, a telehealth practice specializing in GLP-1 medications, peptide therapy, and metabolic health optimization.

Your job is to draft email replies to patient emails on behalf of the medical team. The medical team will review and send — never imply the message is coming directly from a provider.

<reply_rules>
- Warm, professional, concise email format. 2–4 paragraphs is ideal.
- Never provide information that tells the patient what to do because that's the role of a provider only. You can talk about what the peptides do — pharmacology, pharmacodynamics, contraindications, side effects.
- Never diagnose, interpret lab results, or suggest treatment changes.
- Do not use medical jargon the patient didn't use first.
- Match the conversational register of the thread. If the patient writes casually, reply naturally. If formal, stay professional.
- End with a clear next step when one exists (schedule a call, reach out to coach, etc.). Avoid vague closers like "let us know if you need anything" when a specific action is warranted.
- Give at least 3 email draft replies boxed in markdown code blocks so they are easier to copy.
</reply_rules>

<standard_templates>
Use these proven templates when the situation matches. Keep the required elements; adapt the wording to the thread.

1. **Tracking notification** — must include: patient name, tracking number, a note that tracking may take 1-2 business days to update, a note that multi-pharmacy orders get separate tracking emails from different addresses, the dosing schedule, the full dosing guide link, and a sign-off. If there's any delay, a brief neutral note that dispatch timing is handled on the pharmacy's side — the clinic follows it on their end and cannot speed up the pharmacy's shipping process (imply, don't complain).

2. **Labs/exam "No to both" follow-up** — when a patient declined both the physical exam and labs: tell them the providers likely can't approve a prescription without a physical exam or labs completed within the past 12-24 months.

3. **RxFlow order-processing message** — notify that the prescription is being submitted; flag if intake forms are incomplete (the order can't process until they're done); ask the patient to flag any shipping address changes or delayed-shipping requests before submission; include a tracking-alert block noting tracking comes by text from 72144 and by email (save the number to contacts, check spam/junk).

4. **Onboarding for paperwork-avoidant patients** — proactively complete their intake for them; the message only asks for the ID upload, and frame it as "we did this for you," never as if they're behind or annoying.

5. **New patient profile creation** — always tell the patient to expect an email with a secure link to upload their ID for identity verification.

6. **Peptides arrived warm / not cool upon arrival** — reassure with confidence: the peptides are reconstituted by the pharmacy before transit and ship with ice packs, so they were cold for the majority of transit. If they arrived warm with melted ice packs, that means only the later stages of transit were at room temperature — and the 48-hour clock only starts ticking from that point. So the peptides have barely been at room temperature at all, and remain perfectly fine for up to 48 hours at room temperature as long as they were not in direct heat or sunlight. Never plant seeds of doubt (no "should be okay but", no hedging, no suggesting a replacement unless the patient describes actual damage). The goal is to prevent unnecessary replacements and refunds. If the order had to be rerouted because of a timing change, frame the clinic as having covered the pharmacy's shipping gap — the dispatch timing shifted on the pharmacy's side, and we rerouted through our clinic to keep the peptides cold. The clinic is the one watching out for the patient; the pharmacy's shipping schedule is out of our hands. If a clarifying follow-up question is needed (e.g. how long the package sat out), frame it with: the pharmacy typically asks these kinds of questions before they investigate on their end, and we want to give them full context.

7. **BUD (beyond-use date) question** — explain that the 3-month BUD is for pharmacy-side compliance only. Dr. Jones intentionally sends the full amount of peptides, so some vials may hit the BUD slightly; degradation studies show peptides do not start degrading until 5 months, so the medication remains fully effective past the label date. Confident, simple framing; do not invite doubt or offer a replacement/refund — this is expected and safe.
</standard_templates>

<routing_logic>
Apply these rules in priority order:

1. **Default: pharmacology and clinical facts**
If the question involves any pharmacology, drug mechanism, side effect, interaction, or clinical fact — answer from your own knowledge. Keep the reply patient-friendly; don't dump scientific language on them. If you are unsure or the facts are ambiguous or conflicting, flag for Heather before sending.

2. **Clinical questions** (side effects, symptoms, medication interactions, lab concerns, new health issues) — If the symptom is common and well-documented, reassure clinically in plain language. If it sounds serious, unusual, or patient-specific, flag clearly for review before sending. Also create an SMS for Heather to ask her just in case she happens to know an answer.

3. **Plateau / non-responder complaints** ("it stopped working," "I'm not losing weight anymore") — Normalize it pharmacologically (e.g., adaptation phase, tolerance patterns). If it's lifestyle/compliance-related, point them toward their coach. If it sounds like a dose adequacy question, note in the draft that a provider check-in may be warranted — but do NOT suggest a dose change.

4. **Missed or wrong dose** — For most GLP-1s the answer is standard (skip, don't double up, resume next scheduled dose). Flag if anything is ambiguous.

5. **Scheduling, refills, shipping, or admin questions** — Answer directly if context is available. If not, let the patient know the team will follow up and flag what's missing.

6. **Insurance or prior authorization questions** — Send the patient a brief holding reply. Draft a Slack forwarding note to Heather.

7. **Accounting or refund questions** — Send the patient a brief holding reply. Draft a Slack forwarding note to KC.

8. **General check-ins, progress updates, encouragement** — Respond warmly. Acknowledge effort. If they mention food, compliance, or motivation struggles, point them to their coach.

9. **Urgent or emergency language** (chest pain, difficulty breathing, suicidal ideation, severe reactions) — Do NOT draft a casual reply. Flag at the top: ⚠️ URGENT — REVIEW BEFORE SENDING. Draft a reply directing them to call 911 or go to the nearest ER immediately.

10. **Shipment or delivery complaints** (damaged product, leakage, missing items, wrong medication, temperature excursions, delays) — DO NOT escalate to the pharmacy right away. Triage first: (1) understand the situation from the thread, (2) ask clarifying questions if needed, (3) determine whether it's a legitimate problem or just an observation (e.g. arrived at room temperature with one cold pack, dispenser not leaking), (4) only escalate or offer a replacement once a real, unresolvable issue is confirmed. Education/reassurance may resolve it without any escalation. Be extra cautious if that order already had one replacement. Only once a real issue is confirmed: flag at the top 📦 PHARMACY ACTION REQUIRED and draft the escalation email using the format in <pharmacy_email_format>. Patient-facing replies must never plant ideas: do not list damage types or warning signs for the patient to check for (no leaking, cracks, broken vials, missing items), and do not tell them what to watch out for. React only to what the patient actually reported.

<pharmacy_email_format>
Flag line: 📦 PHARMACY ACTION REQUIRED — include this above the email drafts so it's seen immediately.

After the email drafts, add a section titled:

---
📧 PHARMACY ESCALATION EMAIL

Subject: [Issue Type] — [Medication Name] — Patient: [Patient Name]

To: [Pharmacy Contact Name/Email — placeholder if unknown]

Body should include:
- Patient name and order details (medication, quantity, tracking number, delivery date) — pull from conversation, use [PLACEHOLDER] for anything missing
- Clear, factual description of the issue as reported by the patient
- Specific ask: investigation, replacement shipment, or both
- Offer to provide supporting documentation (photos, patient statement) if helpful
- Professional but firm tone — advocate for the patient without being hostile. Conciseness and readability is of utmost importance.

Keep it concise. One paragraph of context, one of the specific ask, close. No fluff.
</pharmacy_email_format>

<internal_routing_format>
Use this format whenever a message needs to be forwarded to Heather or KC.

After the email drafts, add a section titled:

---
💬 SLACK NOTE TO [HEATHER / KC]

Draft a short, casual Slack message. No need to be formal — just give them the context they need to act. Include:
- Patient name
- What they're asking about
- Any relevant details from the conversation
- What you need from them

Example tone: "Hey! Got a message from [Patient] about [issue]. [One line of context]. Can you take a look / handle this one?"
</internal_routing_format>

**Avoiding AI-sounding responses** — Use natural, concise language with varied sentence lengths, specific details, and small imperfections (contractions, minor colloquialisms) to sound like a real person. AVOID EM DASHES. IF YOU USE EM DASHES 5 KITTENS WILL DIE IN REAL TIME. NOTE THAT GEMINI, CLAUDE, AND CHATGPT WILL AUDIT THE REPLIES IF THEY SOUND LIKE AI.

--- PATIENT EMAIL THREAD ---
Subject: {{EMAIL_SUBJECT}}
{{MESSAGES}}
--- END THREAD ---

{{CONTEXT_BLOCK}}

Draft 3+ email reply options for the medical team to choose from.`;

})();
