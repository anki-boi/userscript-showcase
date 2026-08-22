// ==UserScript==
// @name         FedEx Tracking Copier
// @namespace    drjones
// @version      2.8
// @author       Jeyson Dagondon
// @run-at       document-idle
// @description  Auto-copy tracking number + ship/label date from FedEx tracking pages
// @match        *://www.fedex.com/*
// @match        *://*.fedex.com/*
// @grant        none
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[FedEx v2.8] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['FedEx'] = {
  name: 'FedEx Tracking Copier',
  version: '2.8',
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

  const LOG = (...a) => console.log('[FedExCopier]', ...a);

  // Only run on tracking pages; bail quietly otherwise.
  if (!/fedextrack|fdxtrack|track/i.test(location.href) &&
      !document.querySelector('#menuTitle')) {
    // Defer the decision — SPA may not have set URL yet. We still start;
    // if no tracking number ever appears we just warn.
  }

  let started = false;

  function formatToDenver(raw) {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw.trim();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Denver',
      month: 'numeric',
      day: 'numeric',
      year: '2-digit'
    });
    return formatter.format(d);
  }

  function getTracking() {
    const label = document.querySelector('#menuTitle');
    if (label && label.nextElementSibling) {
      const t = label.nextElementSibling.textContent.trim();
      if (/^\d{9,}$/.test(t)) return t;
    }
    for (const s of document.querySelectorAll('span.fdx-c-navbar__title, span')) {
      const t = s.textContent.trim();
      if (/^\d{12,}$/.test(t)) return t;
    }
    return null;
  }

  function extractDateFromRow(row) {
    const dateEl = row.querySelector('.travel-history-table__scan-event-date span');
    const src = dateEl ? dateEl.textContent : row.textContent;
    const m = src.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
    return m ? formatToDenver(m[1]) : null;
  }

  function getShipDate() {
    const rows = [...document.querySelectorAll('tr.travel-history-table__row')];
    LOG('rows found:', rows.length);
    if (!rows.length) return null;

    // Prefer the origin scan ("Shipment information sent to FedEx").
    for (const r of rows) {
      if (/shipment information sent/i.test(r.textContent)) {
        const d = extractDateFromRow(r);
        if (d) { LOG('origin date:', d); return d; }
      }
    }
    // Fallback: oldest row (bottom of newest-first list).
    const d = extractDateFromRow(rows[rows.length - 1]);
    LOG('fallback (last row) date:', d);
    return d;
  }

  function clickViewHistory() {
    const link = [...document.querySelectorAll('a, button')].find(el => {
      const t = el.textContent.trim().toLowerCase();
      return t === 'view more details' ||
             t.includes('view more details') ||
             t.includes('view history') ||
             t.includes('travel history');
    });
    if (link) { LOG('clicking:', link.tagName); link.click(); return true; }
    return false;
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

  function copyAndClose(trackingNum, shipDate) {
    const text = `\nDate Shipped: ${shipDate}\nTN: FedEx - ${trackingNum}`;
    navigator.clipboard.writeText(text).then(() => {
      toast('✓ Tracking copied', true);
      // v2.7 (Jeyson): self-close DISABLED — this tab may be Tracking Bus's
      // reused one-tab-at-a-time carrier tab; closing it kills the run.
      // Manual opens now stay open (close the tab yourself when done).
    }).catch(() => toast('⚠ Copy failed', false));
  }

  function proceed(trackingNum) {
    if (started) return;
    started = true;
    LOG('proceed with TN:', trackingNum);

    let finished = false;
    let rowObserver = null;

    function finish() {
      if (finished) return;
      finished = true;
      if (rowObserver) rowObserver.disconnect();
      const shipDate = getShipDate();
      if (!trackingNum || !shipDate) {
        LOG('FAIL — tn:', trackingNum, 'date:', shipDate);
        toast('⚠ No tracking data found', false);
        return;
      }
      copyAndClose(trackingNum, shipDate);
    }

    function watchRows() {
      rowObserver = new MutationObserver(() => {
        const rows = document.querySelectorAll('tr.travel-history-table__row');
        if (!rows.length) return;
        const hasOrigin = [...rows].some(r =>
          /shipment information sent/i.test(r.textContent));
        if (hasOrigin) setTimeout(finish, 200);
      });
      rowObserver.observe(document.body, { childList: true, subtree: true });
      if (document.querySelector('tr.travel-history-table__row')) {
        setTimeout(finish, 400);
      }
    }

    // Poll for the "View more details" link; FedEx renders it seconds after load.
    const deadline = Date.now() + 25000;
    let clicked = false;
    const poll = setInterval(() => {
      if (finished) { clearInterval(poll); return; }

      if (document.querySelector('tr.travel-history-table__row')) {
        LOG('rows already present, no click needed');
        clearInterval(poll);
        watchRows();
        return;
      }
      if (!clicked && clickViewHistory()) {
        clicked = true;
        clearInterval(poll);
        watchRows();
        return;
      }
      if (Date.now() > deadline) {
        LOG('deadline hit, link never appeared');
        clearInterval(poll);
        watchRows();
        setTimeout(finish, 500);
      }
    }, 400);

    setTimeout(finish, 30000);
  }

  function waitForTracking() {
    LOG('init on', location.href);
    const tnNow = getTracking();
    if (tnNow) { proceed(tnNow); return; }

    const obs = new MutationObserver(() => {
      const tn = getTracking();
      if (tn) { obs.disconnect(); proceed(tn); }
    });
    obs.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => { obs.disconnect(); proceed(getTracking()); }, 8000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForTracking);
  } else {
    waitForTracking();
  }

  // R18: trigger dispatcher
  const api = window.__scripts['FedEx'];
  api.trigger = function (action) {
    if (action === 'extract') {
      const tn = getTracking();
      if (!tn) { api.state = 'error'; api.error = 'No tracking number found'; api.lastActivity = Date.now(); return { ok: false, error: api.error }; }
      const date = getShipDate();
      const text = '\nDate Shipped: ' + (date || 'N/A') + '\nTN: FedEx - ' + tn;
      api.output = text; api.state = 'done'; api.message = 'Extracted: ' + tn; api.lastActivity = Date.now();
      return { ok: true, output: text };
    }
    return { ok: false, error: 'unknown action: ' + action };
  };
})();
