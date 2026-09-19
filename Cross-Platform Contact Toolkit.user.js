// ==UserScript==
// @name         Cross-Platform Contact Toolkit
// @namespace    http://tampermonkey.net/
// @version      7.30
// @author       Jeyson Dagondon
// @description  Unified toolbar: copy name+link, cross-platform search, LifeFile order check
// @match        https://app.gohighlevel.com/*
// @match        https://*.gohighlevel.com/*
// @match        https://*.highlevel.com/*
// @match        https://app.ringcentral.com/*
// @match        https://crm.zoho.com/*
// @match        https://crm.zoho.eu/*
// @match        https://crm.zoho.in/*
// @match        https://crm.zoho.com.au/*
// @match        https://crm.zoho.com.cn/*
// @match        https://crm.zoho.jp/*
// @match        https://portal.labx.example.com/*
// @match        https://staff.exampleclinic.com/*
// @match        https://portal.exampleclinic.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[Toolkit v7.30] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['ContactKit'] = { name: 'Cross-Platform Contact Toolkit', version: '7.30', state: 'idle', message: 'Loaded', output: null, error: null, lastActivity: Date.now(), trigger: null };
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}';
  document.documentElement.appendChild(__dsStyle);

(function () {
  'use strict';

  /* ============================================================
     HANDOFF CAPTURE — MUST BE FIRST (before GHL router wipes hash)
     ============================================================ */
  const PENDING = (function () {
    const m = location.hash.match(/[#&]xplat=([^&]+)/);
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch { return null; }
  })();

  /* ============================================================
     CONFIG
     ============================================================ */
  const ZOHO_ORG = 'org000000000';
  const GHL_LOCATION = 'EGjxftUoKevhGYtuS10X';
  const BAR_ID = 'xplat-toolkit-bar';
  const IDBAR_CLASS = 'xplat-idcopy-bar';

  const ZOHO_URL = (name) =>
    `https://crm.zoho.com/crm/${ZOHO_ORG}/search?searchword=${encodeURIComponent(name)}&isRelevance=false`;
  const GHL_URL = `https://app.gohighlevel.com/v2/location/${GHL_LOCATION}/dashboard`;
  const RC_URL = 'https://app.ringcentral.com/sms/direct/all/';
  const LABX_URL = 'https://portal.labx.example.com/Laborder/LabXLink';
  const RXFLOW_URL = 'https://staff.exampleclinic.com/patients';
  // Patient Connect is a Zoho WebTab (WebTab5) that embeds the external app; from
  // another platform, jump straight to that Zoho tab.
  const PC_URL = `https://crm.zoho.com/crm/${ZOHO_ORG}/tab/WebTab5`;

  const host = location.hostname;
  const IS_GHL = /gohighlevel\.com$|highlevel\.com$/.test(host);
  const IS_RC = host === 'app.ringcentral.com';
  const IS_ZOHO = /crm\.zoho\./.test(host);
  const IS_LABX = host === 'portal.labx.example.com';
  const IS_RXFLOW = host === 'staff.exampleclinic.com';
  const IS_PC = host === 'portal.exampleclinic.com';

  function openWithHandoff(url, name) {
    window.open(url + '#xplat=' + encodeURIComponent(cleanNameForSearch(name)), '_blank');
  }

  /* ============================================================
     UTILITIES
     ============================================================ */
  function waitFor(selectorFn, timeout = 15000, interval = 100) {
    return new Promise((resolve) => {
      const t0 = Date.now();
      (function poll() {
        let el = null;
        try { el = selectorFn(); } catch { el = null; }
        if (el) return resolve(el);
        if (Date.now() - t0 > timeout) return resolve(null);
        setTimeout(poll, interval);
      })();
    });
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function setNativeValue(el, value) {
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    nativeSetter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function lastNameOf(fullName) {
    const parts = fullName.trim().replace(/\s+/g, ' ').split(' ');
    if (parts.length === 1) return parts[0];
    const suffixes = ['jr', 'jr.', 'sr', 'sr.', 'ii', 'iii', 'iv', 'v', 'md', 'phd'];
    let i = parts.length - 1;
    while (i > 0 && suffixes.includes(parts[i].toLowerCase().replace(/,$/, ''))) i--;
    return parts[i].replace(/,$/, '');
  }

  function firstNameOf(fullName) {
    return fullName.trim().replace(/\s+/g, ' ').split(' ')[0];
  }

  function cleanNameForSearch(name) {
    const s = name.trim();
    // If it's a phone number (primarily digits / + / spaces / dashes / dots / parens), return as-is
    if (/^[\d\s\-\+\(\)\.]+$/.test(s) && /\d/.test(s)) return s;
    // Remove parentheses and everything inside them, collapse whitespace
    return s.replace(/\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  }

  // True when a scraped value looks like REAL data. RxFlow renders
  // asynchronously and shows placeholders ("--", "-", "Non Reported", "N/A")
  // before the real value loads — treat those as "not yet loaded".
  function isRealValue(v) {
    if (!v) return false;
    const t = String(v).trim();
    if (!t) return false;
    if (/^[-–—\s]*$/.test(t)) return false; // "--", "-", "–", "—"
    if (/^(non\s*reported|n\/a|not\s*on\s*file)$/i.test(t)) return false;
    return true;
  }

  /* ============================================================
     CLIPBOARD — rich text copy (name + link)
     ============================================================ */
  function copyRichText(name, onSuccess) {
    const url = location.href;
    const esc = (s) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const html = `<a href="${esc(url)}">${esc(name)}</a>`;

    const legacyRichCopy = () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      div.innerHTML = html;
      document.body.appendChild(div);
      const range = document.createRange();
      range.selectNodeContents(div);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch(_) { console.warn('[Toolkit]', _); }
      sel.removeAllRanges();
      div.remove();
      if (ok && onSuccess) onSuccess();
      else if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(name, 'text');
        if (onSuccess) onSuccess();
      }
    };

    if (navigator.clipboard && window.ClipboardItem) {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([name], { type: 'text/plain' })
      });
      navigator.clipboard.write([item]).then(onSuccess).catch(legacyRichCopy);
    } else {
      legacyRichCopy();
    }
  }

  /* ============================================================
     CLIPBOARD — rich text copy with Patient ID prefix
     ============================================================ */
  function copyRichTextWithId(patientId, name, onSuccess) {
    const url = location.href;
    const esc = (s) =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const plain = patientId + '\n' + name;
    const html = `<a href="${esc(url)}">${esc(patientId)}</a><br><a href="${esc(url)}">${esc(name)}</a>`;

    const legacyRichCopy = () => {
      const div = document.createElement('div');
      div.contentEditable = 'true';
      div.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0;';
      div.innerHTML = html;
      document.body.appendChild(div);
      const range = document.createRange();
      range.selectNodeContents(div);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      let ok = false;
      try { ok = document.execCommand('copy'); } catch(_) { console.warn('[Toolkit]', _); }
      sel.removeAllRanges();
      div.remove();
      if (ok && onSuccess) onSuccess();
      else if (typeof GM_setClipboard === 'function') {
        GM_setClipboard(plain, 'text');
        if (onSuccess) onSuccess();
      }
    };

    if (navigator.clipboard && window.ClipboardItem) {
      const item = new ClipboardItem({
        'text/html': new Blob([html], { type: 'text/html' }),
        'text/plain': new Blob([plain], { type: 'text/plain' })
      });
      navigator.clipboard.write([item]).then(onSuccess).catch(legacyRichCopy);
    } else {
      legacyRichCopy();
    }
  }

  /* ============================================================
     UI COMPONENTS
     ============================================================ */

  // SVG icons
  const ICON_COPY = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
  const ICON_CHECK = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
  const ICON_SEARCH = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
  const ICON_FLASK = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3h6v5l4 8.5V21H5v-4.5L9 8V3z"></path><line x1="7" y1="21" x2="17" y2="21"></line></svg>`;
  const ICON_ORDERS = `<svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2h9l4 4v16H6z"></path><path d="M14 2v4h4"></path><path d="M9 12h6M9 16h6"></path></svg>`;

  const LINK_STYLE = `
    font-size:12px;font-weight:500;color:#2d7ff9;text-decoration:none;cursor:pointer;
    line-height:1;white-space:nowrap;display:inline-flex;align-items:center;gap:4px;
    padding:4px 8px;border-radius:4px;transition:background-color 0.12s,color 0.12s;
  `;

  function makeActionButton(label, icon, onClick) {
    const a = document.createElement('a');
    a.href = '#';
    a.innerHTML = `${icon}<span>${label}</span>`;
    a.style.cssText = LINK_STYLE;
    a.addEventListener('mouseenter', () => { a.style.backgroundColor = '#eff6ff'; });
    a.addEventListener('mouseleave', () => { a.style.backgroundColor = 'transparent'; });
    a.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      onClick();
    });
    return a;
  }

  function makeCopyButton(name) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Copy name + link (rich text)';
    btn.innerHTML = `${ICON_COPY}<span>Copy</span>`;
    btn.style.cssText = `
      font-size:12px;font-weight:500;color:var(--ds-text,#374151);cursor:pointer;line-height:1;
      white-space:nowrap;display:inline-flex;align-items:center;gap:4px;
      padding:4px 8px;border-radius:4px;border:1px solid #d5d9e0;
      background:#fff;font-family:inherit;
      transition:background-color 0.12s,border-color 0.12s,color 0.12s;
    `;
    btn.addEventListener('mouseenter', () => {
      btn.style.backgroundColor = '#f5f7fa';
      btn.style.borderColor = '#b9c0ca';
      btn.style.color = '#111827';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.backgroundColor = '#fff';
      btn.style.borderColor = '#d5d9e0';
      btn.style.color = 'var(--ds-text,#374151)';
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      copyRichText(name, () => {
        btn.innerHTML = `${ICON_CHECK}<span>Copied</span>`;
        btn.style.backgroundColor = '#ecfdf5';
        btn.style.borderColor = '#6ee7b7';
        btn.style.color = '#047857';
        setTimeout(() => {
          btn.innerHTML = `${ICON_COPY}<span>Copy</span>`;
          btn.style.backgroundColor = '#fff';
          btn.style.borderColor = '#d5d9e0';
          btn.style.color = 'var(--ds-text,#374151)';
        }, 1500);
      });
    });
    return btn;
  }

  function makeIdCopyButton(patientId, name) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = 'Copy Patient ID + Name + link (rich text)';
    btn.innerHTML = `${ICON_COPY}<span>Copy ID</span>`;
    btn.style.cssText = `
      font-size:12px;font-weight:500;color:var(--ds-accent,#1d4ed8);cursor:pointer;line-height:1;
      white-space:nowrap;display:inline-flex;align-items:center;gap:4px;
      padding:4px 8px;border-radius:4px;border:1px solid #93c5fd;
      background:#eff6ff;font-family:inherit;
      transition:background-color 0.12s,border-color 0.12s,color 0.12s;
    `;
    btn.addEventListener('mouseenter', () => {
      btn.style.backgroundColor = '#dbeafe';
      btn.style.borderColor = '#60a5fa';
      btn.style.color = '#1e3a5f';
    });
    btn.addEventListener('mouseleave', () => {
      btn.style.backgroundColor = '#eff6ff';
      btn.style.borderColor = '#93c5fd';
      btn.style.color = 'var(--ds-accent,#1d4ed8)';
    });

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      copyRichTextWithId(patientId, name, () => {
        btn.innerHTML = `${ICON_CHECK}<span>Copied ID</span>`;
        btn.style.backgroundColor = '#ecfdf5';
        btn.style.borderColor = '#6ee7b7';
        btn.style.color = '#047857';
        setTimeout(() => {
          btn.innerHTML = `${ICON_COPY}<span>Copy ID</span>`;
          btn.style.backgroundColor = '#eff6ff';
          btn.style.borderColor = '#93c5fd';
          btn.style.color = 'var(--ds-accent,#1d4ed8)';
        }, 1500);
      });
    });
    return btn;
  }

  function buildBar(name) {
    const clean = cleanNameForSearch(name);

    const bar = document.createElement('div');
    bar.id = BAR_ID;
    bar.dataset.forName = name;
    Object.assign(bar.style, {
      display: 'flex',
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: '4px',
    });

    // Copy name button — always present
    bar.appendChild(makeCopyButton(name));

    // Separator
    const sep = document.createElement('span');
    sep.style.cssText = 'width:1px;height:14px;background:var(--ds-border,#d5d9e0);margin:0 2px;display:inline-block;';
    bar.appendChild(sep);

    // Search links — skip the current platform
    if (!IS_ZOHO) {
      bar.appendChild(makeActionButton('Zoho', ICON_SEARCH, () => window.open(ZOHO_URL(clean), '_blank')));
    }
    if (!IS_GHL) {
      bar.appendChild(makeActionButton('GHL', ICON_SEARCH, () => openWithHandoff(GHL_URL, clean)));
    }
    if (!IS_RC) {
      bar.appendChild(makeActionButton('RingCentral', ICON_SEARCH, () => {
        // Prefer the contact's phone number; fall back to the name.
        const phone = getPhone();
        const term = phone ? toPhoneDigits(phone) : clean;
        openWithHandoff(RC_URL, term);
      }));
    }
    if (!IS_PC) {
      // Jump to the Patient Connect WebTab in Zoho.
      bar.appendChild(makeActionButton('Patient Connect', ICON_SEARCH, () => window.open(PC_URL, '_blank')));
    }
    if (!IS_LABX) {
      bar.appendChild(makeActionButton('Labs', ICON_FLASK, () => openWithHandoff(LABX_URL, clean)));
    }
    // LifeFile pharmacy order check (always available — LifeFile is never the
    // current platform in this toolkit).
    bar.appendChild(makeActionButton('Search Orders', ICON_ORDERS, () => runOrders(name)));

    return bar;
  }

  /* ============================================================
     NAME DETECTION — per platform
     ============================================================ */
  function getNameEl() {
    if (IS_PC) {
      // Open conversation's patient name in the chat header.
      return document.querySelector('.chat-header-info .chat-patient-name');
    }
    if (IS_GHL) {
      // Highrise contact header
      const el = document.querySelector(
        '[data-v-acef85d8] .hr-ellipsis#hr-ellipsis-id, [data-v-acef85d8] span.hr-ellipsis'
      );
      if (el) return el;
      return document.querySelector('[data-testid="CENTRALPANEL_NAME"]');
    }
    if (IS_RC) {
      return document.querySelector('.left-wrapper .RcInlineEditable-label');
    }
    if (IS_ZOHO) {
      // Zoho drifted the detail-view name field wrapper from LASTNAME to
      // FULLNAME (2026-08-04) — try both, then any name-ish titlecard, then
      // the layout-agnostic first wrap as last resort.
      const el = document.querySelector('#tc_mouseArea__LASTNAME .cxElemCompViewWrap')
        || document.querySelector('#tc_mouseArea__FULLNAME .cxElemCompViewWrap');
      if (el) return el;
      const crux = document.querySelector('#titlecard_LASTNAME')
        || document.querySelector('#titlecard_FULLNAME');
      if (crux) return crux;
      return document.querySelector('span.cxElemCompViewWrap') || null;
    }
    if (IS_LABX) {
      // Try common patient name selectors on LabX
      return (
        document.querySelector('.patient-name') ||
        document.querySelector('h1') ||
        document.querySelector('.member-name') ||
        document.querySelector('[class*="patient"][class*="name"]')
      );
    }
    if (IS_RXFLOW) {
      // Find the show_pat_content div that contains "Patient Name :" label
      return [...document.querySelectorAll('.show_pat_content')].find((el) => {
        const label = el.querySelector('.title_color');
        return label && /Patient\s*Name\s*:/.test(label.textContent || '');
      }) || null;
    }
    return null;
  }

  function readName(el) {
    if (IS_ZOHO) {
      const crux = document.querySelector('#titlecard_LASTNAME') || document.querySelector('#titlecard_FULLNAME');
      const v = crux && crux.getAttribute('cx-prop-value');
      if (v && v.trim()) return v.trim();
    }
    if (IS_RXFLOW) {
      // On RxFlow, el is the .show_pat_content div; name is in non-label spans
      const spans = [...el.querySelectorAll('span')].filter(
        (s) => !s.classList.contains('title_color')
      );
      const name = spans.map((s) => s.textContent.trim()).filter(Boolean).join(' ');
      return name;
    }
    return (el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // RC conversation labels append the patient's coach in parens —
  // "Jeyson Dagondon (Nicole)". Strip it so copies carry only the patient.
  // Phone-shaped labels (unknown contacts, e.g. "(716) 807-4316") must stay
  // intact — a 7+ digit run means it's a number, not a name.
  function stripCoachSuffix(n) {
    const digits = (n.match(/\d/g) || []).length;
    if (digits >= 7) return n;
    return n.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function getPatientIdEl() {
    if (IS_RXFLOW) {
      return [...document.querySelectorAll('.show_pat_content')].find((el) => {
        const label = el.querySelector('.title_color');
        return label && /Patient\s*ID\s*:/.test(label.textContent || '');
      }) || null;
    }
    return null;
  }

  function readPatientId(el) {
    if (!el) return null;
    const span = [...el.querySelectorAll('span')].find(
      (s) => !s.classList.contains('title_color')
    );
    return span ? span.textContent.trim() : null;
  }

  /* ============================================================
     PHONE DETECTION — per platform (for RingCentral phone search)
     ============================================================ */
  // Reduce a phone to bare 10-digit form (drops +1, parens, spaces, dashes).
  function toPhoneDigits(s) {
    const d = String(s || '').replace(/\D/g, '');
    return d.length > 10 ? d.slice(-10) : d;
  }

  function getPhone() {
    if (IS_GHL) {
      // Contact detail editable form: an .hr-form-item whose label is Phone/Mobile/Cell.
      // VERIFIED live: label .hr-form-item-label__text, value in its <input>.
      for (const it of document.querySelectorAll('.hr-form-item')) {
        const lbl = (it.querySelector('.hr-form-item-label__text') || {}).textContent || '';
        if (/phone|mobile|cell/i.test(lbl.trim())) {
          const input = it.querySelector('input');
          if (input && input.value && input.value.trim()) return input.value.trim();
          const m = (it.textContent || '').match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
          if (m) return m[0];
        }
      }
      return null;
    }
    if (IS_ZOHO) {
      // VERIFIED live: span.cxPhoneViewValue.lvPhFld holds the phone number.
      const el = document.querySelector('span.cxPhoneViewValue.lvPhFld');
      return el ? el.textContent.trim() : null;
    }
    if (IS_RXFLOW) {
      // Patient detail .show_pat_content whose label is Phone/Mobile/Cell.
      const el = [...document.querySelectorAll('.show_pat_content')].find((e) => {
        const lbl = (e.querySelector('.title_color') || {}).textContent || '';
        return /phone|mobile|cell/i.test(lbl);
      });
      if (!el) return null;
      const span = [...el.querySelectorAll('span')].find((s) => !s.classList.contains('title_color'));
      if (span && span.textContent.trim()) return span.textContent.trim();
      const m = (el.textContent || '').match(/(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/);
      return m ? m[0] : null;
    }
    if (IS_LABX) {
      const el = document.querySelector('.patient-phone') || document.querySelector('[class*="phone"]');
      return el ? el.textContent.trim() : null;
    }
    if (IS_PC) {
      const info = document.querySelector('.chat-header-info');
      if (info) {
        // Phone appears as "phone +1 (760) 237-9469" in the header info.
        const m = /phone\s*\+?[\d\s()-]{7,}/i.exec(info.textContent || '');
        if (m) return m[0].replace(/^phone/i, '').trim();
      }
      return null;
    }
    return null;
  }

  /* ============================================================
     BAR INJECTION — per platform
     ============================================================ */
  function injectBar() {
    const nameEl = getNameEl();
    if (!nameEl) return;

    const rawName = readName(nameEl);
    if (!rawName) return;
    // RC labels carry the coach in parens ("Patient (Coach)") — strip for
    // copy/search parity with the other platforms' buttons.
    const name = IS_RC ? stripCoachSuffix(rawName) : rawName;

    // Read Patient ID on RxFlow
    let patientId = null;
    if (IS_RXFLOW) {
      const idEl = getPatientIdEl();
      patientId = idEl ? readPatientId(idEl) : null;
    }

    // RxFlow renders everything asynchronously — placeholder values like
    // "--"/"-"/"Non Reported" appear before the real data. Don't inject, and
    // clear any earlier partial injection, until real values are present so the
    // toolbar / Copy ID button can never capture placeholder data.
    if (IS_RXFLOW && (!isRealValue(name) || !isRealValue(patientId))) {
      const staleToolbar = document.getElementById(BAR_ID);
      if (staleToolbar) staleToolbar.remove();
      document.querySelectorAll('.' + IDBAR_CLASS).forEach((b) => b.remove());
      return;
    }

    // Deduplicate: also track by patientId on RxFlow
    const dedupKey = IS_RXFLOW ? name + '|' + (patientId || '') : name;

    // RxFlow: keep the Patient ID copy button in sync BEFORE the toolbar
    // dedup early-return below, so it's rebuilt (never left stale) whenever the
    // patient values change or the button goes missing.
    if (IS_RXFLOW && patientId) {
      const idEl = getPatientIdEl();
      const idParent = idEl ? idEl.parentElement : null;
      const existingIdBar = idParent ? idParent.querySelector('.' + IDBAR_CLASS) : null;
      if (existingIdBar && existingIdBar.dataset.key !== dedupKey) {
        existingIdBar.remove();
      }
      if (idEl && idParent && !idParent.querySelector('.' + IDBAR_CLASS)) {
        const idBar = document.createElement('div');
        idBar.className = IDBAR_CLASS;
        idBar.dataset.key = dedupKey;
        idBar.style.cssText = 'display:flex;align-items:center;gap:4px;padding-top:4px;';
        idBar.appendChild(makeIdCopyButton(patientId, name));
        idParent.insertBefore(idBar, idEl.nextSibling);
      }
    }

    const existing = document.getElementById(BAR_ID);
    if (existing) {
      if (existing.dataset.forName === dedupKey) return;
      existing.remove();
    }

    const bar = buildBar(name);
    bar.dataset.forName = dedupKey;

    /* --- GHL: full-width row below the header --- */
    if (IS_GHL) {
      const headerRow = nameEl.closest('.flex.items-center.justify-between');
      if (!headerRow || !headerRow.parentElement) return;
      Object.assign(bar.style, {
        width: '100%',
        marginTop: '6px',
        paddingTop: '8px',
        borderTop: '1px solid #e5e7eb',
        gap: '4px',
      });
      headerRow.parentElement.insertBefore(bar, headerRow.nextSibling);
      return;
    }

    /* --- RxFlow: insert toolbar above DOB (the ID copy button is handled
       in the sync block above the toolbar dedup) --- */
    if (IS_RXFLOW) {
      // Main toolbar: right after the name row (above DOB)
      const toolbarWrap = document.createElement('div');
      toolbarWrap.className = 'col-md-12 show_pat_content pl-0';
      toolbarWrap.style.cssText = 'padding-top:4px;padding-bottom:4px;border-bottom:1px solid var(--ds-border,#e5e7eb)';
      toolbarWrap.appendChild(bar);
      nameEl.parentElement.insertBefore(toolbarWrap, nameEl.nextSibling);
      return;
    }

    /* --- Patient Connect: full-width row under the chat header --- */
    if (IS_PC) {
      const header = nameEl.closest('.chat-header') || document.querySelector('.chat-header');
      const left = header ? header.querySelector('.chat-header-left') : null;
      const anchor = left || header;
      if (!anchor || !anchor.parentElement) return;
      Object.assign(bar.style, {
        width: '100%', marginTop: '4px', paddingTop: '6px',
        borderTop: '1px solid var(--ds-border,#e5e7eb)', gap: '4px', flexWrap: 'wrap',
      });
      anchor.parentElement.insertBefore(bar, anchor.nextSibling);
      return;
    }

    /* --- Zoho / RingCentral / LabX: flex-col wrap below the name --- */
    let anchor = nameEl;
    if (IS_ZOHO) {
      anchor = document.querySelector('#tc_mouseArea__LASTNAME')
        || document.querySelector('#tc_mouseArea__FULLNAME')
        || nameEl;
    }

    const wrap = document.createElement('div');
    Object.assign(wrap.style, { display: 'flex', flexDirection: 'column', minWidth: '0' });

    const parent = anchor.parentElement;
    if (!parent) return;
    parent.insertBefore(wrap, anchor);
    wrap.appendChild(anchor);
    wrap.appendChild(bar);
  }

  /* ============================================================
     ZOHO: auto-open single search result
     ============================================================ */
  function zohoAutoOpen() {
    if (!/[?&]searchword=/.test(location.search)) return;

    let handled = false;
    function tryAutoOpen() {
      if (handled) return;
      const anchors = Array.from(
        document.querySelectorAll('a.cxLookupViewWrapper[href*="/tab/Contacts/"]')
      );
      if (anchors.length === 0) return;

      const byRecord = new Map();
      anchors.forEach((a) => {
        const m = a.getAttribute('href').match(/\/tab\/Contacts\/(\d+)/);
        if (m) byRecord.set(m[1], a.getAttribute('href'));
      });

      handled = true;
      if (byRecord.size === 1) {
        const href = byRecord.values().next().value;
        location.href = href.startsWith('http') ? href : location.origin + href;
      }
    }

    const obs = new MutationObserver(tryAutoOpen);
    obs.observe(document.body, { childList: true, subtree: true });
    tryAutoOpen();
    setTimeout(() => obs.disconnect(), 10000);
  }

  /* ============================================================
     GHL: open global search, type, auto-open single fresh hit
     ============================================================ */
  let ghlAutoPasteBound = false;

  function ghlSnapshotResults() {
    const list = document.getElementById('global-search-list');
    if (!list) return new Set();
    return new Set(
      [...list.querySelectorAll('.search-item.cursor-pointer')].map((el) => el.outerHTML)
    );
  }

  function ghlFreshResults(oldResults) {
    const list = document.getElementById('global-search-list');
    if (!list) return null;
    const candidates = [...list.querySelectorAll('.search-item.cursor-pointer')].filter(
      (el) => !oldResults.has(el.outerHTML)
    );
    return candidates.length ? candidates : null;
  }

  function ghlReadTotal() {
    const el = Array.from(document.querySelectorAll('span')).find((s) =>
      /^TOTAL:\s*\d+/i.test((s.textContent || '').trim())
    );
    if (!el) return null;
    const m = (el.textContent || '').match(/TOTAL:\s*(\d+)/i);
    return m ? parseInt(m[1], 10) : null;
  }

  async function ghlOpenPanel() {
    for (let i = 0; i < 15; i++) {
      const opener = document.getElementById('globalSearchOpener');
      if (opener) {
        ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((t) =>
          opener.dispatchEvent(
            new MouseEvent(t, { bubbles: true, cancelable: true })
          )
        );
      }
      const input = await waitFor(() => document.getElementById('global-search-input'), 600, 100);
      if (input) return input;
      await sleep(300);
    }
    return null;
  }

  async function ghlRunSearch(name) {
    // Wait for the opener to appear — GHL's SPA can take many seconds after DOMContentLoaded
    const opener = await waitFor(() => document.getElementById('globalSearchOpener'), 60000, 200);
    if (!opener) return;

    const input = await ghlOpenPanel();
    if (!input) return;

    const oldResults = ghlSnapshotResults();

    input.click();
    input.focus();
    setNativeValue(input, name);
    input.focus();

    const fresh = await waitFor(() => ghlFreshResults(oldResults), 8000);
    await sleep(1000);
    if (!fresh) return;

    if (ghlReadTotal() !== 1) return;

    const latest = ghlFreshResults(oldResults);
    if (latest && latest.length) latest[0].click();
  }

  // Manual auto-paste: when the user clicks GHL's search icon,
  // read clipboard and auto-search (separate from handoff path)
  function ghlSetupAutoPaste() {
    if (ghlAutoPasteBound) return;

    const bind = (opener) => {
      if (opener.dataset.xplatAutoPaste) return;
      opener.dataset.xplatAutoPaste = 'true';
      ghlAutoPasteBound = true;
      opener.addEventListener('click', () => {
        navigator.clipboard.readText().then((text) => {
          if (!text || !text.trim()) return;
          const trimmed = text.trim();
          const input = document.getElementById('global-search-input');
          if (!input) {
            setTimeout(() => {
              const retry = document.getElementById('global-search-input');
              if (!retry) return;
              setNativeValue(retry, trimmed);
              retry.focus();
            }, 300);
            return;
          }
          setNativeValue(input, trimmed);
          input.focus();
        }).catch((e) => { console.warn('[Toolkit]', e); });
      });
    };

    const observer = new MutationObserver(() => {
      const opener = document.getElementById('globalSearchOpener');
      if (opener) { bind(opener); observer.disconnect(); }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    const opener = document.getElementById('globalSearchOpener');
    if (opener) { bind(opener); observer.disconnect(); }
  }

  /* ============================================================
     RINGCENTRAL: focus search box, paste term (phone or name), hit Enter,
     click the matching conversation. RC labels SMS threads by phone number in
     the item aria-label, so a phone search compares normalized digits.
     ============================================================ */
  async function rcRunSearch(term) {
    const input = await waitFor(
      () => document.querySelector('input[placeholder="Search texts"]'),
      20000
    );
    if (!input) return;

    input.click();
    input.focus();
    setNativeValue(input, term);
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));

    const termDigits = (term || '').replace(/\D/g, '');
    const termLower = (term || '').toLowerCase();
    const isPhone = termDigits.length >= 7;

    const pick = (list) => {
      for (const item of list) {
        const label = (item.getAttribute('aria-label') || '');
        const text = (item.textContent || '');
        if (isPhone) {
          const labelDigits = label.replace(/\D/g, '');
          const textDigits = text.replace(/\D/g, '');
          if (labelDigits === termDigits || labelDigits.includes(termDigits) || textDigits.includes(termDigits)) {
            item.click();
            return true;
          }
        } else {
          const hay = (label + ' ' + text).toLowerCase();
          if (hay.includes(termLower)) {
            item.click();
            return true;
          }
        }
      }
      return false;
    };

    // Wait for the filtered list to render, then match.
    const got = await waitFor(() => {
      const all = document.querySelectorAll('[data-test-automation-class="sms-item"]');
      return all.length ? all : null;
    }, 8000);
    await sleep(500);
    if (!got) return;

    if (pick(got)) return;
    // The list may still be re-rendering — re-query and try once more.
    await sleep(800);
    const fresh = document.querySelectorAll('[data-test-automation-class="sms-item"]');
    if (pick(fresh)) return;
    if (fresh.length) fresh[0].click();
  }

  /* ============================================================
     LABX: search by last name, auto-open closest first-name match
     ============================================================ */
  async function labxRunSearch(fullName) {
    const lastName = lastNameOf(fullName);
    const firstName = firstNameOf(fullName).toLowerCase();

    const input = await waitFor(() => document.querySelector('#LName'), 20000);
    if (!input) return;

    input.click();
    input.focus();
    setNativeValue(input, lastName);

    const btn =
      input.closest('.input-group')?.querySelector('button[type="submit"]') ||
      document.querySelector('.labx-form-group-btn');
    if (btn) btn.click();
    else input.form?.submit();

    const rows = await waitFor(() => {
      const r = document.querySelectorAll('table.dataTable tbody tr a[href*="PatientID="]');
      return r.length ? r : null;
    }, 10000);

    await sleep(1000);
    if (!rows) return;

    // Single result: auto-open
    if (rows.length === 1) {
      location.href = rows[0].getAttribute('href');
      return;
    }

    // Multiple results: find closest first-name match
    // LabX format: "LASTNAME, FIRSTNAME"
    for (const row of rows) {
      const text = (row.textContent || '').trim();
      const match = text.match(/,\s*(\S+)/);
      if (match && match[1].toLowerCase() === firstName) {
        location.href = row.getAttribute('href');
        return;
      }
    }

    // Fallback: partial match
    for (const row of rows) {
      const text = (row.textContent || '').trim().toLowerCase();
      if (text.includes(firstName)) {
        location.href = row.getAttribute('href');
        return;
      }
    }
  }

  /* ============================================================
     LIFEFILE ORDER CHECK — check a patient's pharmacy orders
     (opens the LifeFile portal, logs in if needed; the portal-side
     Session Handler + Order Status Extractor auto-search the patient)
     ============================================================ */
  const LF_PHARMACY_URL_MAP = [
    { key: 'pharmacya',   name: 'Pharmacy A',              host: 'hostB',      url: 'https://hostB.pharmalink.example/application_main_zfw/login/login/vendor_name/vendorA/frm/stdlogin/access/doctor' },
    { key: 'progress',  name: 'Pharmacy B', host: 'hostC:8443', url: 'https://hostC.pharmalink.example:8443/application_main_zfw/login/login/vendor_name/vendorB/frm/stdlogin/access/doctor' },
    { key: 'pharmacyc', name: 'Pharmacy C',           host: 'hostA',      url: 'https://hostA.pharmalink.example/application_main_zfw/login/login/vendor_name/vendorC/access/doctor' },
    { key: 'pharmacyd', name: 'Pharmacy D',            host: 'hostA',      url: 'https://hostA.pharmalink.example/application_main_zfw/login/login/vendor_name/pharmacyd/frm/stdlogin/access/doctor' },
    { key: 'pharmacye', name: 'Pharmacy E',       host: 'hostB',      url: 'https://hostB.pharmalink.example/application_main_zfw/login/login/access/doctor/vendor_name/vendorE/logout/1' },
    { key: 'pharmacyf',  name: 'Pharmacy F',            host: 'hostD',      url: 'https://hostD.pharmalink.example/application_main_zfw/login/login/vendor_name/vendorF/access/doctor' },
    { key: 'pharmacyg',  name: 'Pharmacy G (LDN)',      host: 'hostD',      url: 'https://hostD.pharmalink.example/application_main_zfw/login/login/vendor_name/vendorG/access/doctor' }
  ];

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // Reuse ONE LifeFile tab (WindowProxy reference) so checking orders never piles
  // up tabs. Cross-origin navigation via the proxy is allowed.
  let lfPortalWin = null;
  function openLfPortalTab(url) {
    if (lfPortalWin && !lfPortalWin.closed) {
      try { lfPortalWin.location.href = url; lfPortalWin.focus(); return 'reused'; } catch(e) { console.warn('[Toolkit]', e); }
    }
    const w = window.open(url, '_blank');
    if (w) { lfPortalWin = w; return 'opened'; }
    return 'failed';
  }

  function lfChooser(name, onPick) {
    const existing = document.getElementById('xplat-lf-chooser');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'xplat-lf-chooser';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '9999999',
      background: 'rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    });
    const card = document.createElement('div');
    Object.assign(card.style, {
      background: 'white', borderRadius: '10px', padding: '18px 16px',
      boxShadow: '0 8px 28px rgba(0,0,0,0.25)', maxWidth: '380px', width: '92%'
    });
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <strong style="color:#0f766e;font-size:14px;">🔎 Check Orders</strong>
        <button id="xplat-lf-chooser-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#999;line-height:1;">✕</button>
      </div>
      <div style="color:#555;font-size:12px;margin-bottom:12px;line-height:1.5;">
        <b>${escapeHtml(name)}</b><br>Pick the pharmacy to check this patient's orders.
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;" id="xplat-lf-chooser-list"></div>
      <div style="margin-top:10px;color:#999;font-size:11px;">Esc to cancel</div>
    `;
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const list = card.querySelector('#xplat-lf-chooser-list');
    for (const pharm of LF_PHARMACY_URL_MAP) {
      const btn = document.createElement('button');
      Object.assign(btn.style, {
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        padding: '10px 12px', border: '1px solid #e0e0e0', borderRadius: '6px',
        background: '#fafafa', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left'
      });
      btn.innerHTML = `<span style="font-weight:600;color:#1f1f1f;font-size:13px;">${pharm.name} <span style="color:#999;font-weight:400;font-size:11px;"> (${pharm.host})</span></span>`;
      btn.addEventListener('mouseenter', () => { btn.style.background = '#eef2f7'; });
      btn.addEventListener('mouseleave', () => { btn.style.background = '#fafafa'; });
      btn.addEventListener('click', () => { overlay.remove(); onPick(pharm); });
      list.appendChild(btn);
    }

    const close = () => overlay.remove();
    card.querySelector('#xplat-lf-chooser-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  }

  function runOrderCheck(fullName) {
    const firstName = firstNameOf(fullName);
    const lastName = lastNameOf(fullName);
    if (!firstName && !lastName) return;
    lfChooser(fullName, (pharmacy) => {
      const statusUrl = `https://${new URL(pharmacy.url).host}/application_main_zfw/poeerx/providerrxstatusbk`;
      const intent = {};
      if (firstName) intent.firstName = firstName;
      if (lastName) intent.lastName = lastName;
      intent._lf = { pharmacy: pharmacy.key, name: pharmacy.name, portalUrl: statusUrl, loginUrl: pharmacy.url, step: 'orders' };
      const json = JSON.stringify(intent);
      // Carry the intent in the URL (GM storage is per-script): enter via the
      // pharmacy LOGIN (proven reliable — direct status-page hits while logged out
      // trigger ACCESS DENIED), then the Session Handler routes to order status and
      // the Order Status Extractor auto-searches the patient name.
      const b64 = btoa(encodeURIComponent(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const sep = pharmacy.url.includes('?') ? '&' : '?';
      const target = pharmacy.url + sep + 'lfSale=' + b64;
      openLfPortalTab(target);
    });
  }

  /* ============================================================
     SEARCH ORDERS — single button = RxFlow Rx + LifeFile pharmacy
     (Rx/RxFlow auto-search flow is planned for when the site is back;
     for now it opens RxFlow via the handoff.)
     ============================================================ */
  function runOrders(fullName) {
    const existing = document.getElementById('xplat-orders-chooser');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.id = 'xplat-orders-chooser';
    Object.assign(overlay.style, {
      position: 'fixed', inset: '0', zIndex: '9999999',
      background: 'rgba(0,0,0,0.35)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif'
    });
    const card = document.createElement('div');
    Object.assign(card.style, {
      background: 'white', borderRadius: '10px', padding: '18px 16px',
      boxShadow: '0 8px 28px rgba(0,0,0,0.25)', maxWidth: '360px', width: '92%'
    });
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
        <strong style="color:#0f766e;font-size:14px;">🔎 Search Orders</strong>
        <button id="xplat-orders-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#999;line-height:1;">✕</button>
      </div>
      <div style="color:#555;font-size:12px;margin-bottom:12px;line-height:1.5;">
        <b>${escapeHtml(fullName)}</b><br>Where do you want to look?
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;" id="xplat-orders-list"></div>
      <div style="margin-top:10px;color:#999;font-size:11px;">Esc to cancel</div>
    `;
    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const list = card.querySelector('#xplat-orders-list');
    const addOpt = (label, sub, onClick) => {
      const b = document.createElement('button');
      Object.assign(b.style, {
        display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: '2px',
        padding: '10px 12px', border: '1px solid #e0e0e0', borderRadius: '6px',
        background: '#fafafa', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left'
      });
      b.innerHTML = `<span style="font-weight:600;color:#1f1f1f;font-size:13px;">${label}</span><span style="color:#888;font-size:11px;">${sub}</span>`;
      b.addEventListener('mouseenter', () => { b.style.background = '#eef2f7'; });
      b.addEventListener('mouseleave', () => { b.style.background = '#fafafa'; });
      b.addEventListener('click', () => { overlay.remove(); onClick(); });
      list.appendChild(b);
    };
    addOpt('RxFlow Order Status', 'Open the patient in RxFlow and check Rx order status + tracking', () => runRxFlowOrderCheck(fullName));
    addOpt('LifeFile pharmacy', 'Check order status + tracking in LifeFile', () => runOrderCheck(fullName));

    const close = () => overlay.remove();
    card.querySelector('#xplat-orders-close').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', function esc(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc); } });
  }

  /* ============================================================
     RXFLOW RX ORDER STATUS — auto-check a patient's Rx order status
     Flow (the RxFlow counterpart to the LifeFile order check):
       Patients search -> patient profile -> Prescriptions tab ->
       Action > Order Tracking -> extract status. The intent travels
       across page loads via the #xplatOrder= URL hash.
     ============================================================ */
  function encodeOrderIntent(obj) {
    return btoa(encodeURIComponent(JSON.stringify(obj))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeOrderIntent(str) {
    if (!str) return null;
    try { return JSON.parse(decodeURIComponent(atob(str.replace(/-/g, '+').replace(/_/g, '/')))); }
    catch (e) { return null; }
  }
  function readOrderIntent() {
    const m = location.hash.match(/[#&]xplatOrder=([^&]+)/);
    if (m) {
      const it = decodeOrderIntent(m[1]);
      if (it) { persistOrderIntent(it); return it; }
    }
    return loadOrderIntent();
  }
  function orderIntentUrl(pathname, intent) {
    return pathname + '#xplatOrder=' + encodeOrderIntent(intent);
  }
  // Persist the intent in localStorage too (same origin, like the Sale
  // Automator's job) so the flow survives a manual navigation where the hash
  // is lost between the patients list and the profile/prescriptions pages.
  const ORDER_INTENT_KEY = 'xplat-order-intent';
  function persistOrderIntent(intent) {
    try { localStorage.setItem(ORDER_INTENT_KEY, JSON.stringify({ ...intent, _ts: Date.now() })); } catch(e) { console.warn('[Toolkit]', e); }
  }
  function loadOrderIntent() {
    try {
      const s = localStorage.getItem(ORDER_INTENT_KEY);
      if (!s) return null;
      const it = JSON.parse(s);
      if (!it || !it._ts || Date.now() - it._ts > 10 * 60 * 1000) return null; // 10-min TTL
      return it;
    } catch (e) { return null; }
  }
  function clearOrderIntent() {
    try { localStorage.removeItem(ORDER_INTENT_KEY); } catch(e) { console.warn('[Toolkit]', e); }
    try { history.replaceState(null, '', location.pathname + location.search); } catch(e) { console.warn('[Toolkit]', e); }
  }
  function rxflowPatientIdFromUrl() {
    const m = location.pathname.match(/\/(?:patient-details|patient-prescriptions|patient-sales)\/(\d+)/);
    return m ? m[1] : null;
  }

  // Scoped window.open interceptor (same trick as the Sale Automator): the app
  // opens patient profiles and order tracking via window.open, which synthetic
  // clicks can't open (popup-blocked). We capture the URL while WE are driving
  // a click and navigate the current tab via location.href instead. Only active
  // around the automation's own clicks, so manual popups pass through.
  let xplatNavCaptureActive = false;
  function installOrderNavInterceptor() {
    if (window.__xplat_navInstalled) return;
    window.__xplat_navInstalled = true;
    window.__xplat_lastNav = null;
    const origOpen = window.open;
    window.open = function (url, name, features) {
      if (xplatNavCaptureActive && typeof url === 'string' &&
          (url.indexOf('/patient-details/') === 0 || url.indexOf('/patient-sales') !== -1)) {
        window.__xplat_lastNav = url;
        return null;
      }
      return origOpen.apply(this, arguments);
    };
  }
  function realClick(el) {
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'].forEach((type) => {
      el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    });
  }
  async function waitForNavCapture(timeoutMs = 8000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (window.__xplat_lastNav) return window.__xplat_lastNav;
      await sleep(150);
    }
    return null;
  }
  async function clickAndFollowNav(clickFn) {
    window.__xplat_lastNav = null;
    xplatNavCaptureActive = true;
    try {
      clickFn();
      return await waitForNavCapture();
    } finally {
      xplatNavCaptureActive = false;
    }
  }

  // ---- Patients-list search helpers (RxFlow) ----
  function setNativeInputValue(input, value) {
    const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    desc.set.call(input, value);
  }
  async function typeIntoSearchBox(searchBox, value) {
    searchBox.focus();
    await sleep(300);
    setNativeInputValue(searchBox, '');
    searchBox.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(100);
    setNativeInputValue(searchBox, value);
    searchBox.dispatchEvent(new Event('input', { bubbles: true }));
    searchBox.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
    searchBox.dispatchEvent(new Event('change', { bubbles: true }));
  }
  function getSearchRows() {
    const actionBtns = [...document.querySelectorAll('button')].filter((b) => b.textContent.trim().toLowerCase().includes('action'));
    const rows = new Set();
    for (const btn of actionBtns) {
      let el = btn.parentElement;
      for (let i = 0; i < 6 && el; i++) {
        const t = el.textContent ? el.textContent.trim() : '';
        if ((el.classList && el.classList.contains('grid-content')) || t.length > 60) { rows.add(el); break; }
        el = el.parentElement;
      }
    }
    if (rows.size > 0) return [...rows];
    return [...document.querySelectorAll('table tr')].filter((r) => r.querySelectorAll('td, [role=cell]').length > 0);
  }
  // The list rows render each name part in its own cell, so a row's text is
  // "Bridget\nDonohue", not "Bridget Donohue" — normalize whitespace before
  // matching or a spaced name ("Bridget Donohue") never matches.
  function rowText(r) { return (r.textContent || '').replace(/\s+/g, ' '); }
  async function waitForSearchMatches(query, timeoutMs = 6000, pollMs = 300) {
    const q = String(query).trim().replace(/\s+/g, ' ');
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const matches = getSearchRows().filter((r) => rowText(r).toLowerCase().includes(q.toLowerCase()));
      if (matches.length > 0) return matches;
      await sleep(pollMs);
    }
    return [];
  }
  function rxflowPickBestMatch(matches, name) {
    if (!name) return matches[0];
    const full = name.toLowerCase().replace(/\s+/g, ' ');
    return matches.find((r) => rowText(r).toLowerCase().includes(full)) || matches[0];
  }
  function clickVisibleViewPatient() {
    const vp = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase().includes('view patient') && b.offsetParent !== null);
    if (!vp) return false;
    realClick(vp);
    return true;
  }
  async function openPatientRow(row) {
    const actionBtn = [...row.querySelectorAll('button, [role=button]')].find((b) => b.textContent.trim().toLowerCase().includes('action'));
    if (!actionBtn) return false;
    // Buttons load async here — a click can land before the Vue handler is
    // attached (silently does nothing), so click + check and retry patiently.
    for (let attempt = 0; attempt < 8; attempt++) {
      realClick(actionBtn);
      for (let i = 0; i < 12; i++) {
        const viewBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase().includes('view patient'));
        if (viewBtn && viewBtn.offsetParent !== null) return true;
        await sleep(150);
      }
    }
    return false;
  }

  // ---- RxFlow order-status entry point ----
  function runRxFlowOrderCheck(fullName) {
    const patId = rxflowPatientIdFromUrl();
    if (patId) {
      // Already on this patient's page — go straight to their Rx order status.
      const intent = { name: fullName, step: 'prescriptions' };
      persistOrderIntent(intent);
      location.href = orderIntentUrl('/patient-prescriptions/' + patId, intent);
      return;
    }
    // From another platform: open RxFlow's Patients list and search there.
    const intent = { name: fullName, phone: getPhone() || '', step: 'search' };
    persistOrderIntent(intent);
    window.open(RXFLOW_URL + '#xplatOrder=' + encodeOrderIntent(intent), '_blank');
  }

  async function rxflowSearchPatient(intent) {
    // The search box loads asynchronously (this site renders everything late),
    // so wait generously for it before typing.
    const searchBox = await waitFor(
      () => document.querySelector('input[placeholder="Search by record ID, name, dob or mobile"]'),
      30000
    );
    if (!searchBox) { showOrderToast('RxFlow search box did not load.'); clearOrderIntent(); return; }

    // Name first: it's always present and (with whitespace-normalized matching)
    // reliably finds the row; phone is a fallback when it's known.
    const candidates = [];
    if (intent.name) candidates.push({ label: 'name', value: intent.name });
    if (intent.phone) {
      candidates.push({ label: 'phone', value: intent.phone });
      const bare = intent.phone.replace(/\D/g, '');
      if (bare && bare !== intent.phone) candidates.push({ label: 'phone digits', value: bare });
    }

    for (const c of candidates) {
      await typeIntoSearchBox(searchBox, c.value);
      const searchBtn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().toLowerCase() === 'search');
      if (searchBtn) { searchBtn.click(); await sleep(400); }

      const matches = await waitForSearchMatches(c.value);
      if (!matches.length) continue;

      const row = rxflowPickBestMatch(matches, intent.name);
      const menuOpened = await openPatientRow(row);
      if (menuOpened) {
        const nav = await clickAndFollowNav(() => clickVisibleViewPatient());
        if (nav) {
          const next = { ...intent, step: 'profile' };
          persistOrderIntent(next);
          location.href = orderIntentUrl(nav, next);
          return;
        }
      }
      showOrderToast(`Patient found via ${c.label} — open its Action > View Patient to continue.`);
      clearOrderIntent();
      return;
    }

    showOrderToast('No RxFlow patient found by phone or name.');
    clearOrderIntent();
  }

  // The flow's last stop. A patient can have MANY prescriptions, so we stop
  // here and let the user review them — no status summary is shown, and the
  // intent is cleared so nothing re-triggers on later navigation.
  async function rxflowStopAtPrescriptions() {
    clearOrderIntent();
    showOrderNote('Prescriptions', 'Stopped at this patient\'s prescriptions — review them here.');
  }

  // ---- RxFlow order-status UI ----
  function showOrderToast(msg) {
    let t = document.getElementById('xplat-order-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'xplat-order-toast';
      Object.assign(t.style, {
        position: 'fixed', top: '70px', right: '16px', zIndex: '9999999',
        background: '#1f2937', color: '#fff', padding: '10px 14px', borderRadius: '8px',
        fontSize: '12px', fontFamily: 'system-ui, sans-serif', boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
        maxWidth: '340px', lineHeight: '1.4'
      });
      document.body.appendChild(t);
    }
    t.textContent = msg;
    clearTimeout(t._h);
    t._h = setTimeout(() => t.remove(), 6000);
  }

  // Persistent, dismissible floating note (used when the flow stops and hands
  // off, e.g. on the Prescriptions page where the user picks the right order).
  function showOrderNote(title, message) {
    const existing = document.getElementById('xplat-order-note');
    if (existing) existing.remove();
    const note = document.createElement('div');
    note.id = 'xplat-order-note';
    Object.assign(note.style, {
      position: 'fixed', top: '70px', right: '16px', zIndex: '9999999',
      background: '#ffffff', border: '1px solid #fbbf24', borderRadius: '10px',
      boxShadow: '0 8px 28px rgba(0,0,0,0.2)', width: '340px', maxWidth: '92vw',
      fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: '13px'
    });
    note.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;border-bottom:1px solid #fef3c7;background:#fffbeb;border-radius:10px 10px 0 0;">
        <strong style="color:#92400e;">ℹ️ ${title}</strong>
        <button id="xplat-order-note-close" style="background:none;border:none;font-size:16px;cursor:pointer;color:#b45309;line-height:1;">✕</button>
      </div>
      <div style="padding:12px;color:#334155;line-height:1.5;">${message}</div>`;
    document.body.appendChild(note);
    note.querySelector('#xplat-order-note-close').addEventListener('click', () => note.remove());
  }

  async function runRxFlowOrderFlow(intent) {
    const path = location.pathname;

    if (path === '/patients' || path === '/patients/') {
      await rxflowSearchPatient(intent);
      return;
    }
    const patId = rxflowPatientIdFromUrl();
    if (patId) {
      if (path.indexOf('/patient-prescriptions/') === 0 && intent.step === 'prescriptions') {
        await rxflowStopAtPrescriptions();
      } else {
        location.href = orderIntentUrl('/patient-prescriptions/' + patId, { ...intent, step: 'prescriptions' });
      }
    }
  }

  /* ============================================================
     BOOT
     ============================================================ */
  function startObserver() {
    const observer = new MutationObserver(() => injectBar());
    observer.observe(document.body, { childList: true, subtree: true });
    try { injectBar(); } catch (e) { console.error('[xplat] injectBar failed:', e); }
  }

  function run() {
    // RxFlow Rx order-status flow FIRST — independent of toolbar injection,
    // so a toolbar-injection error can never block the order check. This site's
    // controls only respond once the page has fully settled (the Sale Automator
    // proved this by running at document-idle), so wait for load before driving
    // the flow — a click fired earlier silently does nothing.
    if (IS_RXFLOW) {
      installOrderNavInterceptor();
      const orderIntent = readOrderIntent();
      if (orderIntent) {
        if (!IS_LABX) startObserver();
        const startFlow = () => setTimeout(() => runRxFlowOrderFlow(orderIntent), 800);
        if (document.readyState === 'complete') startFlow();
        else window.addEventListener('load', startFlow, { once: true });
        return;
      }
    }

    // Always set up toolbar injection (needed even during handoff)
    if (!IS_LABX) startObserver();

    // GHL: always set up the auto-paste handler (works for both manual & handoff)
    if (IS_GHL) ghlSetupAutoPaste();

    // Handoff: arrived with a name to search
    if (PENDING) {
      if (IS_GHL) return ghlRunSearch(PENDING);
      if (IS_RC) return rcRunSearch(PENDING);
      if (IS_LABX) return labxRunSearch(PENDING);
    }

    // Zoho auto-open (from direct Zoho search link)
    if (IS_ZOHO) zohoAutoOpen();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
