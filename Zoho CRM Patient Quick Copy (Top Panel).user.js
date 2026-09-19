// ==UserScript==
// @name         Zoho CRM Patient Quick Copy (Top Panel)
// @namespace    http://tampermonkey.net/
// @version      1.7
// @description  Patient phone + address pills in the CRM top panel; red/green = address valid
// @author       Jeyson Dagondon
// @match        https://crm.zoho.com/crm/*/tab/Contacts/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[QuickCopy v1.7] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['QuickCopy'] = { name: 'Zoho CRM Patient Quick Copy (Top Panel)', version: '1.7', state: 'idle', message: 'Loaded', output: null, error: null, lastActivity: Date.now(), trigger: null };
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
    #qc-top-strip button.qc-ok { border: 2px solid var(--ds-success,#3d7a46) !important; color: var(--ds-success,#3d7a46) !important; background: #eef6ef !important; }
    #qc-top-strip button.qc-bad { border: 2px solid var(--ds-danger,#b3402e) !important; color: var(--ds-danger,#b3402e) !important; background: #fbeeeb !important; }
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

  // ============================================================
  // ADDRESS VALIDITY — merged from "Zoho CRM — Address Validator"
  // v1.10 (2026-09-18), simplified per Jeyson:
  //   * CITY IS IGNORED ENTIRELY — missing, aliased or mismatched city
  //     never fails the address.
  //   * only street presence, a real state code, and a ZIP that EXISTS
  //     and MATCHES the state can turn the pill red.
  //   * the Google Maps button + the Nominatim/OSM street lookup are gone
  //     (he never used them; Nominatim also cost seconds per record).
  //   * network failure = UNKNOWN (no outline), never red.
  // ============================================================
  const US_STATES = new Set([
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
    'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
    'VA','WA','WV','WI','WY','DC','AS','GU','MP','PR','VI'
  ]);
  const PLACEHOLDER = /^(test|n\/?a|unknown|none|tbd|asdf|xxx|0|\.|no address|not (?:provided|given|available)|address|street)$/i;

  // "505 Forest Valley Rd, Sandy Springs, GA 30342" -> parts. Ported verbatim
  // from Address Validator v1.10 (proven against live records): city is parsed
  // only to get it out of the way — it is never validated here.
  function parseAddress(raw) {
    const text = (raw || '').replace(/\s+/g, ' ').trim();
    const out = { street: '', city: '', state: '', zip: '', raw: text };
    if (!text) return out;
    const parts = text.split(',').map(s => s.trim());
    if (parts.length >= 3) {
      out.street = parts[0];
      const tail = parts[parts.length - 1];
      const m = tail.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
      if (m) {
        out.state = m[1].toUpperCase(); out.zip = m[2];
        out.city = parts.slice(1, -1).join(', ');
      } else if (/^\d{5}(?:-\d{4})?$/.test(tail)) {
        out.zip = tail;
        out.state = (parts[parts.length - 2] || '').toUpperCase();
        if (!US_STATES.has(out.state)) out.state = '';
        out.city = parts.slice(1, -2).join(', ');
      }
    } else if (parts.length === 2) {
      out.street = parts[0];
      const tail = parts[1];
      const m = tail.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
      if (m) { out.state = m[1].toUpperCase(); out.zip = m[2]; }
      else {
        // "Dutch Harbor AK 99692" (no comma before state) — real-world shape.
        const mc = tail.match(/^(.*?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
        if (mc && US_STATES.has(mc[2].toUpperCase())) {
          out.city = mc[1].trim(); out.state = mc[2].toUpperCase(); out.zip = mc[3];
        } else if (/^\d{5}(?:-\d{4})?$/.test(tail)) { out.zip = tail; }
        else out.city = tail;
      }
    } else {
      // One comma-less segment: "456 Oak Dr Miami FL 33101" / "... Miami, FL 33101".
      const m = text.match(/^(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
      if (m) { out.street = m[1].trim(); out.state = m[2].toUpperCase(); out.zip = m[3]; }
      else {
        const ms = text.match(/^(.*?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
        if (ms && US_STATES.has(ms[2].toUpperCase())) { out.street = ms[1].trim(); out.state = ms[2].toUpperCase(); out.zip = ms[3]; }
        else {
          const z = text.match(/^(.*?)\s+(\d{5}(?:-\d{4})?)$/);
          if (z) { out.street = z[1].trim(); out.zip = z[2]; } else out.street = text;
        }
      }
    }
    return out;
  }

  // ZIP -> states it belongs to. Keyless, no login. Unknown (network) is NOT
  // cached, so a transient failure re-tries instead of sticking.
  const zipCache = new Map();
  async function lookupZip(zip5) {
    if (zipCache.has(zip5)) return zipCache.get(zip5);
    let out;
    try {
      const r = await fetch('https://api.zippopotam.us/us/' + encodeURIComponent(zip5), { signal: AbortSignal.timeout(8000) });
      if (!r.ok) out = { missing: true };
      else {
        const j = await r.json();
        out = { states: [...new Set((j.places || []).map(p => (p['state abbreviation'] || '').toUpperCase()))] };
      }
    } catch (_) { return null; } // network -> unknown, never red
    zipCache.set(zip5, out);
    return out;
  }

  const verdictCache = new Map(); // cleaned address -> { v:'ok'|'bad', why }
  const pendingAddr = new Set();

  async function addressVerdict(addr) {
    const p = parseAddress(addr);
    const bad = why => ({ v: 'bad', why });
    if (!p.street || PLACEHOLDER.test(p.street)) return bad('street missing/placeholder');
    if (!US_STATES.has(p.state)) return bad(p.state ? `state "${p.state}" is not a US state` : 'state missing');
    if (!/^\d{5}(?:-\d{4})?$/.test(p.zip)) return bad(p.zip ? `bad ZIP "${p.zip}"` : 'ZIP missing');
    const z = await lookupZip(p.zip.slice(0, 5));
    if (!z) return { v: 'unknown', why: 'ZIP lookup failed (offline?)' };
    if (z.missing) return bad(`ZIP ${p.zip} not found`);
    if (!z.states.includes(p.state)) return bad(`ZIP ${p.zip} is ${z.states.join('/')}, not ${p.state}`);
    return { v: 'ok', why: `ZIP ${p.zip} matches ${p.state}` };
  }

  // Offline self-check of the parser (dev console: QuickCopy.selfTest(), or
  // `node _smoketest/verify-qc-address.mjs`). No network: only the field-level
  // rules the pill colors depend on.
  const SELF_TEST_CASES = [
    // [raw, expectState, expectZip, expectStreet]
    ['505 Forest Valley Rd, Sandy Springs, GA 30342', 'GA', '30342', '505 Forest Valley Rd'],
    ['88 Salmon Way, Dutch Harbor AK 99692', 'AK', '99692', '88 Salmon Way'],
    ['456 Oak Dr Miami FL 33101', 'FL', '33101', '456 Oak Dr Miami'],
    ['12 Main St, Apt 4, Boston, MA 02108', 'MA', '02108', '12 Main St'],
    ['PO Box 5, Boston, MA, 02108-1234', 'MA', '02108-1234', 'PO Box 5'],
    ['', '', '', '']
  ];
  function qcSelfTest(verbose) {
    let pass = 0;
    SELF_TEST_CASES.forEach(([raw, state, zip, street], i) => {
      const p = parseAddress(raw);
      const ok = p.state === state && p.zip === zip && p.street === street;
      if (!ok && verbose) console.error('[QuickCopy] selfTest ' + i + ' FAIL', raw, p);
      pass += ok ? 1 : 0;
    });
    if (verbose) console.log(`[QuickCopy] selfTest ${pass}/${SELF_TEST_CASES.length} parser cases pass`);
    return pass === SELF_TEST_CASES.length;
  }
  window.QuickCopy = Object.assign(window.QuickCopy || {}, { selfTest: () => qcSelfTest(true), parseAddress, addressVerdict });

  function paintAddrVerdict(r) {
    if (!addrPill) return;
    addrPill.classList.toggle('qc-ok', r.v === 'ok');
    addrPill.classList.toggle('qc-bad', r.v === 'bad');
    addrPill.title = 'Copy address' + (r.v === 'bad' ? ' — INVALID: ' + r.why : r.v === 'ok' ? ' — ' + r.why : '');
  }

  function applyAddrVerdict(addr) {
    if (!addrPill) return;
    if (!addr) {
      addrPill.classList.remove('qc-ok', 'qc-bad');
      addrPill.title = 'Copy address';
      return;
    }
    const cached = verdictCache.get(addr);
    if (cached) { paintAddrVerdict(cached); return; }
    if (pendingAddr.has(addr)) return;
    pendingAddr.add(addr);
    addressVerdict(addr).then(r => {
      pendingAddr.delete(addr);
      if (r.v !== 'unknown') verdictCache.set(addr, r);
      if (getAddress() === addr) paintAddrVerdict(r); // stale result for an old record -> drop
    }).catch(() => { pendingAddr.delete(addr); });
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
    applyAddrVerdict(address);
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
