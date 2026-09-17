// ==UserScript==
// @name         EasyPost Tracking Copier
// @namespace    userscript-showcase
// @version      2.7
// @author       Jeyson Dagondon
// @run-at       document-idle
// @description  Auto-copy tracking details from EasyPost tracking pages
// @match        https://track.easypost.com/*
// @grant        none
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[EasyPost v2.7] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['EasyPost'] = {
  name: 'EasyPost Tracking Copier',
  version: '2.7',
  state: 'idle',
  message: '',
  output: null,
  error: null,
  lastActivity: Date.now(),
  trigger: null
};
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}';
  document.documentElement.appendChild(__dsStyle);

(function () {
  'use strict';

  function extract() {
    // Try script tags first
    let raw = '';
    document.querySelectorAll('script').forEach(s => (raw += s.textContent));
    raw = raw.replace(/\\"/g, '"');

    let code = raw.match(/"tracking_code":"([^"]+)"/)?.[1];
    let carrier = raw.match(/"carrier":"([^"]+)"/)?.[1];
    let dateStr = raw.match(/"status_detail":"label_created","datetime":"([^"]+)"/)?.[1];

    // DOM fallback (FedEx etc.)
    if (!code || !carrier) {
      const imgDiv = document.querySelector('[role="img"][aria-label]');
      if (imgDiv) carrier = carrier || imgDiv.getAttribute('aria-label');
      const wrapper = imgDiv?.closest('._VerticalStack_ele7k_4, [class*="VerticalStack"]');
      const numSpan = wrapper?.querySelector('span._Text_4eopp_4');
      if (numSpan) code = code || numSpan.textContent.trim();
    }

    if (!code || !carrier) return null;

    let shipped = 'N/A';
    if (dateStr) {
      const d = new Date(dateStr);
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Denver',
        month: 'numeric',
        day: 'numeric',
        year: '2-digit'
      });
      shipped = formatter.format(d);
    }

    return `\nDate Shipped: ${shipped}\nTN: ${carrier} - ${code}`;
  }

  function toast(msg, success) {
    const el = document.createElement('div');
    el.textContent = msg;
    Object.assign(el.style, {
      position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '999999', padding: '14px 28px', fontSize: '16px', fontWeight: '700',
      background: success ? 'var(--ds-success,#22c55e)' : 'var(--ds-danger,#ef4444)', color: '#fff',
      borderRadius: '10px', boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
      transition: 'opacity 0.3s', opacity: '1'
    });
    document.body.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, 400);
    setTimeout(() => el.remove(), 700);
  }

  function run() {
    const text = extract();
    if (!text) {
      toast('⚠ No tracking data found', false);
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      toast('✓ Tracking copied', true);
      setTimeout(() => window.close(), 700);
    }).catch(() => toast('⚠ Copy failed', false));
  }

  window.addEventListener('load', () => setTimeout(run, 300));

  // R18: trigger dispatcher
  const api = window.__scripts['EasyPost'];
  api.trigger = function (action) {
    if (action === 'extract') {
      const text = extract();
      if (!text) { api.state = 'error'; api.error = 'No tracking data found'; api.lastActivity = Date.now(); return { ok: false, error: api.error }; }
      api.output = text; api.state = 'done'; api.message = 'Extracted tracking data'; api.lastActivity = Date.now();
      return { ok: true, output: text };
    }
    return { ok: false, error: 'unknown action: ' + action };
  };
})();
