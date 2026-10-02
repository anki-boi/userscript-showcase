// ==UserScript==
// @name         EasyPost Tracking Copier
// @namespace    userscript-showcase
// @version      2.9
// @author       Jeyson Dagondon
// @run-at       document-idle
// @description  Auto-copy tracking details from EasyPost tracking pages
// @match        https://track.easypost.com/*
// @grant        none
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[EasyPost v2.9] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['EasyPost'] = {
  name: 'EasyPost Tracking Copier',
  version: '2.9',
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

    // v2.9: the ship date used to require the literal adjacency
    //   "status_detail":"label_created","datetime":"…"
    // so any package that was already in transit, out for delivery, or delivered
    // — the normal case for anyone pasting this into a note — silently produced
    // "Date Shipped: N/A" while still reporting a successful copy. Take the
    // datetime that sits in the same object as the tracking_code (nearest one,
    // either side), and fall back to the first datetime in the payload.
    let dateStr = null;
    const codeMatch = raw.match(/"tracking_code":"([^"]+)"/);
    if (codeMatch) {
      const around = raw.slice(Math.max(0, codeMatch.index - 800), codeMatch.index + 1600);
      dateStr = (around.match(/"datetime":"([^"]+)"/) || [])[1] || null;
    }
    if (!dateStr) dateStr = (raw.match(/"datetime":"([^"]+)"/) || [])[1] || null;

    // DOM fallback (FedEx etc.)
    if (!code || !carrier) {
      const imgDiv = document.querySelector('[role="img"][aria-label]');
      if (imgDiv) carrier = carrier || imgDiv.getAttribute('aria-label');
      const wrapper = imgDiv?.closest('[class*="VerticalStack"], [class*="verticalStack"]');
      // v2.9: this used to require the exact build-hashed classes
      // `_VerticalStack_ele7k_4` / `span._Text_4eopp_4`. Those hashes rotate on
      // every frontend build — the exact failure that took out the UPS copier on
      // 2026-09-11 (`mb-0` -> `pr-1`) — so match on the class STEM and then on
      // what the text actually looks like instead of on a class at all.
      if (wrapper && !code) {
        const spans = [...wrapper.querySelectorAll('[class*="Text"], span')];
        const numSpan = spans.find((s) => /^[A-Z0-9]{6,}$/.test((s.textContent || '').trim()));
        if (numSpan) code = numSpan.textContent.trim();
      }
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
      // v2.8 (Jeyson): no auto-close — the tab stays open; close it yourself.
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
