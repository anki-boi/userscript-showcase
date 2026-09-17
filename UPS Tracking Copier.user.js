// ==UserScript==
// @name         UPS Tracking Copier
// @namespace    userscript-showcase
// @version      2.9
// @author       Jeyson Dagondon
// @run-at       document-idle
// @description  Auto-copy tracking details from UPS tracking pages
// @match        https://www.ups.com/track*
// @match        https://www.ups.com/WebTracking/*
// @grant        none
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[UPS v2.9] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['UPS'] = {
  name: 'UPS Tracking Copier',
  version: '2.9',
  state: 'idle',
  message: '',
  progress: null,
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
    const tnEl = document.querySelector('span.mb-0.ups-txt-black.ups-txt_size_md.ups-txt-weight_medium');
    const trackingNum = tnEl?.textContent?.trim();
    const billedEl = document.querySelector('#stApp_txtAdditionalInfoBilledOn');
    const billedRaw = billedEl?.textContent?.trim();
    if (!trackingNum || !billedRaw) return null;
    const parts = billedRaw.split('/');
    if (parts.length !== 3) return null;
    const shipped = `${parseInt(parts[0])}/${parseInt(parts[1])}/${parts[2].slice(-2)}`;
    return `\nDate Shipped: ${shipped}\nTN: UPS - ${trackingNum}`;
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
    const api = window.__scripts['UPS'];
    const text = extract();
    if (!text) {
      api.state = 'error'; api.error = 'No tracking data found'; api.message = 'No tracking data found'; api.lastActivity = Date.now();
      toast('⚠ No tracking data found', false);
      return;
    }
    api.output = text;
    api.state = 'done'; api.message = 'Tracking extracted'; api.lastActivity = Date.now();
    navigator.clipboard.writeText(text).then(() => {
      toast('✓ Tracking copied', true);
    }).catch(() => toast('⚠ Copy failed', false));
  }

  function waitAndInit() {
    const targetSelector = 'track-details-shipment-title';

    // 1. Check if element is already in the DOM
    if (document.querySelector(targetSelector)) {
      setTimeout(run, 300);
      return;
    }

    // 2. Watch for the element to be added
    const observer = new MutationObserver(() => {
      if (document.querySelector(targetSelector)) {
        observer.disconnect();
        // Small delay ensures Angular finishes rendering inner text
        setTimeout(run, 300);
      }
    });

    observer.observe(document.documentElement, { childList: true, subtree: true });

    // 3. Fallback timeout (UPS renders the billed element late on cold loads —
    //     seen >10s live 2026-08-05; 30s patience, keep the observer alive)
    setTimeout(() => {
      observer.disconnect();
      run();
    }, 30000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitAndInit);
  } else {
    waitAndInit();
  }

  // R18: trigger dispatcher
  window.__scripts['UPS'].trigger = function (action) {
    if (action === 'extract') { run(); return { ok: true }; }
    return { ok: false, error: `unknown action: ${action}` };
  };
})();
