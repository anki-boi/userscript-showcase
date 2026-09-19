// ==UserScript==
// @name         UPS Tracking Copier
// @namespace    userscript-showcase
// @version      2.10
// @author       Jeyson Dagondon
// @run-at       document-idle
// @description  Auto-copy tracking details from UPS tracking pages
// @match        https://www.ups.com/track*
// @match        https://www.ups.com/WebTracking/*
// @grant        none
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[UPS v2.10] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['UPS'] = {
  name: 'UPS Tracking Copier',
  version: '2.10',
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

  // v2.10 (2026-09-11): UPS dropped the `mb-0` utility class from the
  // tracking-number span (it now ships `pr-1`, verified live), so the old
  // `span.mb-0.ups-txt-black...` selector matched NOTHING on every tracking
  // page and the copier reported "No tracking data found" for a perfectly
  // good page. Match the STABLE ups-txt-* classes only, then fall back to the
  // URL param (our own links use ?trackNums=, UPS email links ?tracknum=) and
  // finally to the rendered page text. Never put a margin/padding utility
  // class back into this selector — UPS rotates those without notice.
  function getTrackingNumber() {
    const cands = document.querySelectorAll(
      'span.ups-txt-black.ups-txt_size_md.ups-txt-weight_medium,' +
      'span[class*="ups-txt-weight_medium"].ups-txt-black');
    for (const el of cands) {
      const t = (el.textContent || '').trim();
      if (/^1Z[0-9A-Z]{16}$/i.test(t)) return t.toUpperCase();
    }
    const m = location.href.match(/[?&]trackNums?=([^&#]+)/i);
    if (m) {
      let u = m[1];
      try { u = decodeURIComponent(u); } catch (e) { /* keep the raw value */ }
      u = u.trim();
      if (/^1Z[0-9A-Z]{16}$/i.test(u)) return u.toUpperCase();
    }
    const b = (document.body ? document.body.innerText : '').match(/\b1Z[0-9A-Z]{16}\b/i);
    return b ? b[0].toUpperCase() : '';
  }

  // Same drift class as the tracking number: keep the id fast path, but fall
  // back to the "Shipped / Billed On" label's own date if the id ever rotates.
  function getShippedDate() {
    let raw = (document.querySelector('#stApp_txtAdditionalInfoBilledOn')?.textContent || '').trim();
    if (!raw) {
      for (const el of document.querySelectorAll('strong, span, p, div, label, dt, dd')) {
        if (el.children.length) continue;
        if (!/^shipped\s*\/?\s*billed\s*on$/i.test((el.textContent || '').trim())) continue;
        const scope = el.parentElement || el;
        const mm = (scope.innerText || scope.textContent || '').match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
        if (mm) { raw = mm[1]; break; }
      }
    }
    const p = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    if (!p) return '';
    return `${parseInt(p[1], 10)}/${parseInt(p[2], 10)}/${p[3].slice(-2)}`;
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
    const trackingNum = getTrackingNumber();
    const shipped = getShippedDate();
    const text = (trackingNum && shipped)
      ? `\nDate Shipped: ${shipped}\nTN: UPS - ${trackingNum}`
      : null;
    if (!text) {
      // v2.10: name the script AND the failing half — the old generic
      // "No tracking data found" forced a hunt through three scripts to find
      // which one was complaining (2026-09-11).
      const why = !trackingNum
        ? 'no tracking number found on this UPS page'
        : 'tracking number ' + trackingNum + ' found, but the shipped date did not render';
      api.state = 'error'; api.error = why; api.message = why; api.lastActivity = Date.now();
      toast('⚠ UPS copier: ' + why, false);
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
