// ==UserScript==
// @name         Zoho CRM Patient Quick Copy (Top Panel)
// @namespace    http://tampermonkey.net/
// @version      1.5
// @description  Always-visible patient phone + address pills in the CRM top panel; click to copy
// @author       Jeyson Dagondon
// @match        https://crm.zoho.com/crm/*/tab/Contacts/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[QuickCopy v1.5] boot');
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}';
  document.documentElement.appendChild(__dsStyle);

(function () {
  'use strict';
  try {

  // ============================================================
  // CSS — slim strip docked in the top panel, next to the module
  // title (same anchor the Template Menu FAB uses).
  // ============================================================
  GM_addStyle(`
    #qc-top-strip {
      display: inline-flex !important; align-items: center !important; gap: 4px !important;
      margin-left: 10px !important; vertical-align: middle !important;
    }
    #qc-top-strip button {
      border: 1px solid var(--ds-border,#dadce0) !important; background: #fff !important;
      border-radius: 999px !important; padding: 1px 10px !important;
      font-size: 12px !important; line-height: 1.7 !important; color: var(--ds-text,#202124) !important;
      cursor: pointer !important; max-width: 280px !important;
      overflow: hidden !important; text-overflow: ellipsis !important; white-space: nowrap !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    }
    #qc-top-strip button:hover { border-color: var(--ds-accent,var(--ds-accent,#1a73e8)) !important; color: var(--ds-accent,#1a73e8) !important; }
    #qc-top-strip button.qc-dim { opacity: 0.45 !important; }
    #qc-top-strip.qc-hidden { display: none !important; }
    #qc-top-strip.qc-fallback { position: fixed !important; top: 8px !important; right: 8px !important; z-index: 2147483647 !important; }
    #qc-toast {
      position: fixed !important; bottom: 24px !important; left: 50% !important;
      transform: translateX(-50%) !important; background: var(--ds-surface,#202124) !important; color: var(--ds-text,#fff) !important;
      padding: 6px 14px !important; border-radius: 6px !important; font-size: 12px !important;
      z-index: 2147483647 !important; opacity: 0 !important; transition: opacity .2s !important;
      pointer-events: none !important; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    }
    #qc-toast.qc-show { opacity: 0.95 !important; }
  `);

  // ============================================================
  // EXTRACTION — selectors referenced from "CC Custom Build -
  // Zoho CRM Patient Data Extractor" (verified live 2026-08-04).
  // ============================================================

  // Phone: the selector appears in several places (detail field,
  // related-list previews). Zoho can show masked copies in some
  // views, so only accept values that look like a real phone:
  // ≥10 digits, nothing but digits/+/space/parens/dashes. Never
  // surface or copy a masked value.
  function getPhone() {
    const els = document.querySelectorAll('span.cxPhoneViewValue.lvPhFld');
    const seen = new Set();
    const phones = [];
    for (const el of els) {
      const t = el.textContent.trim();
      if (!t || seen.has(t)) continue;
      seen.add(t);
      phones.push(t);
    }
    return phones.find(p => {
      const digits = p.replace(/\D/g, '');
      return digits.length >= 10 && /^\+?[\d\s()\-]+$/.test(p);
    }) || '';
  }

  // Address: the field whose text ends in a ZIP code. Cleaned to a
  // single comma-separated line (matches the extractor's parse).
  function getAddress() {
    const wraps = document.querySelectorAll('span.cxElemCompViewWrap');
    for (const el of wraps) {
      const t = el.textContent.trim();
      if (/\b\d{5}(?:-\d{4})?\b$/.test(t)) {
        return t.replace(/\n/g, ', ').replace(/\s{2,}/g, ' ').trim()
                .replace(/,\s*,/g, ',').replace(/,\s*$/, '').trim();
      }
    }
    return '';
  }

  function getPatientName() {
    const w = document.querySelector('span.cxElemCompViewWrap');
    return w ? w.textContent.trim() : '';
  }

  // 10-digit bare numbers render as (XXX) XXX-XXXX for display/copy.
  function formatPhone(raw) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    if (digits.length === 11 && digits.startsWith('1')) {
      const d = digits.slice(1);
      return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    }
    return raw;
  }

  // ============================================================
  // CLIPBOARD + TOAST
  // ============================================================
  let toastEl = null, toastTimer = null;

  function showToast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.id = 'qc-toast';
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('qc-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('qc-show'), 1600);
  }

  function copyText(text, what) {
    if (!text) return;
    let copied = false;
    try { GM_setClipboard(text, 'text'); copied = true; } catch(_) { console.warn('[QuickCopy]', _); }
    if (!copied) {
      navigator.clipboard.writeText(text).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch(_) { console.warn('[QuickCopy]', _); }
        ta.remove();
      });
    }
    showToast(`${what} copied`);
  }

  // ============================================================
  // STRIP UI
  // ============================================================
  let stripEl = null, phonePill = null, addrPill = null, renderQueued = false;

  function findTopPanelHost() {
    return document.querySelector('#crmNextGenTopMenu [data-zcqa="appTopMenuTitle"]')
      || document.querySelector('#crmNextGenTopMenu .flexAlignCenter')
      || document.querySelector('#crmNextGenTopMenu');
  }

  // Only touch the DOM when a value actually changed — Zoho's SPA
  // mutates constantly, and needless textContent writes flicker.
  function setPill(pill, text, dim) {
    if (pill.textContent !== text) pill.textContent = text;
    if (pill.title !== text) pill.title = text;
    pill.classList.toggle('qc-dim', dim);
  }

  function render() {
    if (!stripEl || !stripEl.isConnected) return;
    const onContact = /\/tab\/Contacts\/\d+/.test(location.href);
    if (!onContact) { stripEl.classList.add('qc-hidden'); return; }
    stripEl.classList.remove('qc-hidden');
    const phone = getPhone();
    const address = getAddress();
    const phoneText = phone ? '📞 ' + formatPhone(phone) : '📞 —';
    const addrText = address ? '📍 ' + address : '📍 —';
    setPill(phonePill, phoneText, !phone);
    setPill(addrPill, addrText, !address);
  }

  function queueRender() {
    if (renderQueued) return;
    renderQueued = true;
    setTimeout(() => { renderQueued = false; render(); }, 500);
  }

  function createStrip() {
    if (stripEl && stripEl.isConnected) return;
    stripEl = document.createElement('div');
    stripEl.id = 'qc-top-strip';
    phonePill = document.createElement('button');
    phonePill.type = 'button';
    phonePill.title = 'Copy phone';
    phonePill.addEventListener('click', () => {
      const p = getPhone();
      copyText(p ? formatPhone(p) : '', '📞 Phone');
    });
    addrPill = document.createElement('button');
    addrPill.type = 'button';
    addrPill.title = 'Copy address';
    addrPill.addEventListener('click', () => copyText(getAddress(), '📍 Address'));
    stripEl.append(phonePill, addrPill);

    const attach = () => {
      const host = findTopPanelHost();
      if (!host) return false;
      host.appendChild(stripEl);
      stripEl.classList.remove('qc-fallback');
      render();
      return true;
    };
    if (!attach()) {
      // Header not rendered yet (SPA) — float until it appears, then dock.
      document.body.appendChild(stripEl);
      stripEl.classList.add('qc-fallback');
      const obs = new MutationObserver(() => { if (attach()) obs.disconnect(); });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => obs.disconnect(), 30000);
    }
  }

  // ============================================================
  // SPA PATIENT-SWITCH WATCHER
  //   Zoho's router doesn't reliably fire popstate on record
  //   switch, so poll the URL contact ID (cheap) and re-render.
  // ============================================================
  let lastContactId = '';

  function watchUrl() {
    const m = location.href.match(/\/tab\/Contacts\/(\d+)/);
    const id = m ? m[1] : '';
    if (id !== lastContactId) {
      lastContactId = id;
      if (id) {
        createStrip();
        // The detail view re-renders shortly after the URL changes;
        // re-read after a beat (both passes are no-ops if unchanged).
        setTimeout(render, 900);
        setTimeout(render, 2500);
      } else if (stripEl) {
        stripEl.classList.add('qc-hidden');
      }
    }
  }

  watchUrl();
  setInterval(watchUrl, 1500);
  // Fallback: re-render once content settles after any big DOM change.
  const domObs = new MutationObserver(queueRender);
  domObs.observe(document.documentElement, { childList: true, subtree: true });

  } catch (err) {
    console.error('[QC] init failed:', err);
  }
})();
