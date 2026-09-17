// ==UserScript==
// @name         Patient Timezone — Zoho + GHL (temp)
// @namespace    showcase.tools
// @version      2.1.6
// @author       Jeyson Dagondon
// @description  Patient timezone panel for Zoho + GHL: Denver offset, local time, copy/paste TZ
// @match        https://crm.zoho.com/*
// @match        https://crm.zoho.eu/*
// @match        https://crm.zoho.in/*
// @match        https://crm.zoho.com.au/*
// @match        https://crm.zoho.com.cn/*
// @match        https://crm.zoho.jp/*
// @match        https://crmsandbox.zoho.com/*
// @match        https://app.gohighlevel.com/*
// @match        https://*.gohighlevel.com/*
// @match        https://*.highlevel.com/*
// @grant        GM_registerMenuCommand
// @grant        GM_setValue
// @grant        GM_getValue
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[DJM-TZ v2.1.6] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['Tz'] = { name: 'Patient Timezone — Zoho + GHL (temp)', version: '2.1.6', state: 'idle', message: 'Loaded', output: null, error: null, lastActivity: Date.now(), trigger: null };
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}';
  document.documentElement.appendChild(__dsStyle);

(function () {
  'use strict';

  // ============================================================
  // CONFIG
  // ============================================================
  const CLINIC_TZ             = 'America/Denver';
  const PANEL_CLASS           = 'djm-tz-panel';
  const CTXMENU_ID            = 'djm-tz-ctx';
  const STORAGE_AUTOSCROLL    = 'djm-tz-autoscroll-coaches'; // 'on' | 'off' (default off)
  const STORAGE_COPIED_TZ     = 'djm-tz-copied-value';       // cross-tab clipboard via GM storage
  const TICK_MS               = 60 * 1000;

  const SCROLL_INITIAL_DELAY  = 1500;
  const SCROLL_RETRY_MS       = 800;
  const SCROLL_MAX_TRIES      = 60;

  const COPY_BTN_CLASS        = 'djm-tz-copy-btn';
  const PASTE_BTN_CLASS       = 'djm-tz-paste-btn';

  const DEBUG = true;

  const log = (...a) => DEBUG && console.log('[DJM-TZ]', ...a);
  const isAutoScrollOn = () => localStorage.getItem(STORAGE_AUTOSCROLL) === 'on';
  const setAutoScroll  = (on) => localStorage.setItem(STORAGE_AUTOSCROLL, on ? 'on' : 'off');

  // Anchor keys for the panels
  const ANCHOR_TZ_FIELD       = 'tz-field';
  const ANCHOR_COACHING_LAST  = 'coaching-last';
  const ANCHOR_GHL_CONTACT    = 'ghl-contact';

  // ============================================================
  // PLATFORM DETECTION
  // ============================================================
  const PLATFORM = (() => {
    const h = location.hostname;
    if (h.includes('zoho')) return 'zoho';
    if (h.includes('gohighlevel') || h.includes('highlevel')) return 'ghl';
    return null;
  })();

  function detectPlatformLazy() {
    if (PLATFORM) return PLATFORM;
    if (document.querySelector('#contact\\.timezone') ||
        document.querySelector('[data-v-9f2e6b4a]') ||
        document.querySelector('.hr-form')) return 'ghl';
    if (document.querySelector('crux-picklist-component')) return 'zoho';
    return null;
  }

  log('Platform hint:', PLATFORM || 'unknown (will detect lazily)');

  // ============================================================
  // CROSS-TAB TZ CLIPBOARD (GM_setValue for Tampermonkey storage)
  // Falls back to localStorage if GM_ functions unavailable
  // ============================================================
  function saveCopiedTz(value) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(STORAGE_COPIED_TZ, value);
      } else {
        localStorage.setItem(STORAGE_COPIED_TZ, value);
      }
    } catch (e) {
      localStorage.setItem(STORAGE_COPIED_TZ, value);
    }
  }

  function loadCopiedTz() {
    try {
      if (typeof GM_getValue === 'function') {
        return GM_getValue(STORAGE_COPIED_TZ, null);
      }
      return localStorage.getItem(STORAGE_COPIED_TZ);
    } catch (e) {
      return localStorage.getItem(STORAGE_COPIED_TZ);
    }
  }

  // ============================================================
  // IANA EXTRACTION & ALIAS MAPPING — shared between platforms
  // ============================================================

  /**
   * Legacy IANA aliases → canonical IANA zones.
   * GHL uses legacy US/* and Etc/* zones; Zoho uses canonical America/* zones.
   * This map lets us match across platforms.
   */
  const IANA_ALIASES = {
    // US legacy → canonical
    'US/Eastern':    'America/New_York',
    'US/Central':    'America/Chicago',
    'US/Mountain':   'America/Denver',
    'US/Pacific':    'America/Los_Angeles',
    'US/Alaska':     'America/Anchorage',
    'US/Arizona':    'America/Phoenix',
    'US/Hawaii':     'Pacific/Honolulu',
    'US/Aleutian':   'America/Adak',
    'US/East-Indiana':'America/Indiana/Indianapolis',
    'US/Indiana-Starke':'America/Indiana/Knox',
    'US/Michigan':   'America/Detroit',
    'US/Samoa':      'Pacific/Pago_Pago',
    // Canada legacy
    'Canada/Eastern':    'America/Toronto',
    'Canada/Central':    'America/Winnipeg',
    'Canada/Mountain':   'America/Edmonton',
    'Canada/Pacific':    'America/Vancouver',
    'Canada/Atlantic':   'America/Halifax',
    'Canada/Newfoundland':'America/St_Johns',
    'Canada/Saskatchewan':'America/Regina',
    'Canada/Yukon':      'America/Whitehorse',
    // Other common legacy
    'Mexico/General':    'America/Mexico_City',
    'Mexico/BajaNorte':  'America/Tijuana',
    'Mexico/BajaSur':    'America/Mazatlan',
    'Brazil/East':       'America/Sao_Paulo',
    'Pacific/Samoa':     'Pacific/Pago_Pago',
    'Etc/GMT':           'Etc/GMT',
  };

  // Build reverse map too (canonical → legacy) for completeness
  const IANA_REVERSE = {};
  for (const [legacy, canonical] of Object.entries(IANA_ALIASES)) {
    if (!IANA_REVERSE[canonical]) IANA_REVERSE[canonical] = [];
    IANA_REVERSE[canonical].push(legacy);
  }

  /**
   * Get all equivalent IANA identifiers for a given zone.
   * Returns array: [original, canonical (if alias), all aliases (if canonical)]
   */
  function getIANAEquivalents(iana) {
    const results = new Set([iana]);
    // If it's a legacy alias, add the canonical
    if (IANA_ALIASES[iana]) results.add(IANA_ALIASES[iana]);
    // If it's a canonical zone, add all legacy aliases
    if (IANA_REVERSE[iana]) IANA_REVERSE[iana].forEach(a => results.add(a));
    // If it's an alias, also check if the canonical has other aliases
    const canonical = IANA_ALIASES[iana] || iana;
    if (IANA_REVERSE[canonical]) IANA_REVERSE[canonical].forEach(a => results.add(a));
    return [...results];
  }

  /**
   * Extract IANA timezone from a string like:
   *   "GMT-04:00 US/Eastern (EDT)"
   *   "GMT -07:00 America/Los_Angeles (PDT)"
   * Returns e.g. "US/Eastern" or "America/Los_Angeles"
   */
  function extractIANA(str) {
    if (!str) return null;
    const match = str.match(/([A-Za-z_]+\/[A-Za-z_\/]+)/);
    return match ? match[1] : null;
  }

  // ============================================================
  // TIME HELPERS (shared)
  // ============================================================
  function tzParts(tz, date) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
      weekday: 'long', timeZoneName: 'short'
    }).formatToParts(date);
    const m = {};
    parts.forEach(p => (m[p.type] = p.value));
    return m;
  }
  const tzAbbr = (tz, d) => tzParts(tz, d).timeZoneName || '';
  const US_TZ_SIMPLIFY = {};
  const simplifyAbbr = (a) => US_TZ_SIMPLIFY[a] || a;
  function offsetFromClinic(tz, date) {
    const a = tzParts(tz, date), b = tzParts(CLINIC_TZ, date);
    const msA = Date.UTC(+a.year, +a.month - 1, +a.day, +a.hour, +a.minute, +a.second);
    const msB = Date.UTC(+b.year, +b.month - 1, +b.day, +b.hour, +b.minute, +b.second);
    return Math.round((msA - msB) / 3600000);
  }

  const fmtTime = (tz, d) => new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true
  }).format(d);

  const fmtDay = (tz, d) => new Intl.DateTimeFormat('en-US', {
    timeZone: tz, weekday: 'long'
  }).format(d);

  // ============================================================
  // ZOHO: DOM locators
  // ============================================================
  function getZohoPicklist() {
    // Try all known selector patterns for the Patient Timezone picklist
    return document.querySelector('crux-picklist-component[id="subvalue_CONTACTCF186"]')
        || document.querySelector('crux-picklist-component[cx-prop-zcqa="Timezone"]')
        || document.querySelector('crux-picklist-component[data-zcqa="value_Timezone"]')
        || document.querySelector('crux-picklist-component[data-zcqa="value_Time Zone"]')
        || document.querySelector('crux-picklist-component[cx-prop-zcqa="Time Zone"]')
        || document.querySelector('#mouseArea__CONTACTCF186 crux-picklist-component');
  }

  function getZohoSelectedTz() {
    const pk = getZohoPicklist();
    if (pk) {
      const candidates = [pk.getAttribute('cx-prop-value'), pk.getAttribute('view-value')];
      for (const v of candidates) {
        if (v && v !== '-None-' && v.trim()) return v.trim();
      }
      const lt = pk.querySelector('lyte-text[lt-prop-value]');
      if (lt) {
        const v = lt.getAttribute('lt-prop-value');
        if (v && v !== '-None-' && v.trim()) return v.trim();
      }
      // Fallback: lyte-text textContent
      const ltAny = pk.querySelector('lyte-text');
      if (ltAny) {
        const v = (ltAny.textContent || '').trim();
        if (v && v !== '-None-' && v.length < 80) return v;
      }
      const txt = (pk.textContent || '').trim();
      if (txt && txt !== '-None-' && txt.length < 80) return txt;
    } else {
      log('getZohoPicklist() returned null — trying broader selectors');
    }

    // Fallback: look for the value div inside the Patient Timezone row
    const tzRow = document.getElementById('mouseArea__CONTACTCF186');
    if (tzRow) {
      // The value text sits in .dv_info_value area
      const valueEl = tzRow.querySelector('lyte-text.cxElemCompViewValue');
      if (valueEl) {
        const v = valueEl.getAttribute('lt-prop-value') || (valueEl.textContent || '').trim();
        if (v && v !== '-None-' && v.trim()) {
          log('Got TZ from fallback lyte-text:', v);
          return v.trim();
        }
      }
      // Even broader: any crux-picklist-component in the row
      const anyPk = tzRow.querySelector('crux-picklist-component');
      if (anyPk) {
        const v = anyPk.getAttribute('cx-prop-value') || anyPk.getAttribute('view-value');
        if (v && v !== '-None-' && v.trim()) {
          log('Got TZ from fallback crux-picklist:', v);
          return v.trim();
        }
      }
    }

    const sel = document.querySelector(
      'lyte-drop-item[data-zcqa^="Patient Timezone_"][selected="true"], ' +
      'lyte-drop-item[data-zcqa^="Patient Timezone_"][aria-selected="true"]'
    );
    if (sel) {
      const v = sel.getAttribute('data-value');
      if (v && v !== '-None-') return v;
    }
    return null;
  }

  function getZohoTzFieldRow() {
    // Primary: find the mouseArea div for the Patient Timezone field
    const row = document.getElementById('mouseArea__CONTACTCF186');
    if (row) return row;

    const pk = getZohoPicklist();
    if (!pk) return null;
    let el = pk;
    for (let i = 0; i < 15 && el; i++) {
      if (el.id && el.id.startsWith('mouseArea__')) return el;
      el = el.parentElement;
    }
    el = pk;
    for (let i = 0; i < 15 && el; i++) {
      if (el.classList && el.classList.contains('mB10')) return el;
      el = el.parentElement;
    }
    return pk.closest('div');
  }

  function getZohoCoachingLastRow() {
    const labels = document.querySelectorAll('div.dv_info_label');
    for (const l of labels) {
      if ((l.textContent || '').trim() === 'Weekly Weight Reminder when Missed') {
        let el = l;
        for (let i = 0; i < 10 && el; i++) {
          if (el.id && el.id.startsWith('mouseArea__')) return el;
          el = el.parentElement;
        }
        return l.closest('.mB10') || l.parentElement;
      }
    }
    return null;
  }

  // ============================================================
  // ZOHO: Paste timezone by matching IANA in the picklist
  // ============================================================

  /**
   * Scroll the lyte-drop-body to the very bottom in steps,
   * forcing Zoho to lazy-render all picklist items.
   * Returns a promise that resolves once fully scrolled.
   */
  function scrollDropdownToLoadAll(dropBody) {
    return new Promise((resolve) => {
      const SCROLL_STEP = 500;    // px per step
      const STEP_DELAY  = 60;     // ms between steps
      let lastHeight = 0;
      let staleCount = 0;

      const step = () => {
        dropBody.scrollTop += SCROLL_STEP;
        const currentHeight = dropBody.scrollHeight;

        if (dropBody.scrollTop + dropBody.clientHeight >= currentHeight - 5) {
          // We're at the bottom — but check if more items loaded
          if (currentHeight === lastHeight) {
            staleCount++;
            if (staleCount >= 3) {
              // Fully scrolled, all items loaded
              // Scroll back to top so the dropdown is in a clean state
              dropBody.scrollTop = 0;
              resolve();
              return;
            }
          } else {
            staleCount = 0;
          }
          lastHeight = currentHeight;
        }

        setTimeout(step, STEP_DELAY);
      };

      step();
    });
  }

  function zohoSetTimezone(ianaZone) {
    const editIcon = document.getElementById('edit_icon_CONTACTCF186');
    const ajaxEditDiv = document.getElementById('ajaxEdit_CONTACTCF186');

    if (!ajaxEditDiv && !editIcon) {
      toast('Cannot find timezone field to edit');
      return false;
    }

    // Click to enter edit mode
    if (ajaxEditDiv) ajaxEditDiv.click();

    // Phase 1: Wait for the dropdown to appear in the DOM
    let waitAttempts = 0;
    const waitForDropdown = setInterval(() => {
      waitAttempts++;
      if (waitAttempts > 40) {
        clearInterval(waitForDropdown);
        toast('Timed out waiting for dropdown to open');
        return;
      }

      const dropBody = document.getElementById('Patient_Timezone');
      if (!dropBody) return; // Dropdown not open yet

      clearInterval(waitForDropdown);
      log('Dropdown found, scrolling to load all items...');
      toast('Loading timezone list...');

      // Phase 2: Scroll through the entire dropdown to force all items to render
      scrollDropdownToLoadAll(dropBody).then(() => {
        // Phase 3: Now all items should be in the DOM — match and click
        const items = document.querySelectorAll('lyte-drop-item[data-zcqa^="Patient Timezone_"]');
        log('Loaded', items.length, 'picklist items after scroll');

        const equivalents = getIANAEquivalents(ianaZone);
        log('Matching TZ:', ianaZone, '→ equivalents:', equivalents);

        let matched = null;
        for (const item of items) {
          const val = item.getAttribute('data-value') || '';
          const itemIANA = extractIANA(val);
          if (itemIANA && equivalents.includes(itemIANA)) {
            matched = item;
            break;
          }
        }

        if (!matched) {
          toast('No match for ' + ianaZone + ' in Zoho picklist (' + items.length + ' items checked)');
          log('Failed to match. Tried equivalents:', equivalents);
          const cancelBtn = document.getElementById('cancelAjaxEdit_view_CONTACTCF186');
          if (cancelBtn) cancelBtn.click();
          return;
        }

        // Scroll the matched item into view and click it
        matched.scrollIntoView({ block: 'center' });
        setTimeout(() => {
          matched.click();
          log('Clicked match:', matched.getAttribute('data-value'));

          // Save after click registers
          setTimeout(() => {
            const saveBtn = document.getElementById('saveAjaxEdit_view_CONTACTCF186');
            if (saveBtn) {
              saveBtn.click();
              toast('Timezone set: ' + ianaZone);
              log('Pasted timezone:', ianaZone, '→', matched.getAttribute('data-value'));
            }
          }, 400);
        }, 150);
      });

    }, 200);

    return true;
  }

  // ============================================================
  // GHL: DOM locators
  // ============================================================
  function getGHLSelectedTz() {
    const sel = document.querySelector('#contact\\.timezone');
    if (!sel) return null;

    const wrappers = sel.querySelectorAll(
      '.hr-base-selection-overlay__wrapper, ' +
      '.hr-base-selection-label__render-label .hr-base-selection-overlay__wrapper'
    );
    for (const w of wrappers) {
      const txt = (w.textContent || '').trim();
      if (txt && txt !== '--') return txt;
    }

    const label = sel.querySelector('.hr-base-selection-label');
    if (label) {
      const title = label.getAttribute('title');
      if (title && title !== '--') return title;
    }

    return null;
  }

  function parseGHLTzString(str) {
    return extractIANA(str);
  }

  function getGHLContactCard() {
    const nameEls = document.querySelectorAll('.hr-ellipsis--line-clamp');
    for (const el of nameEls) {
      let card = el.closest('.border.border-gray-200.rounded-md.bg-white');
      if (card) return card;
      card = el.closest('[data-v-9f2e6b4a]');
      if (card) return card;
    }
    const avatars = document.querySelectorAll('.record-avatar');
    for (const a of avatars) {
      const card = a.closest('.border.rounded-md.bg-white');
      if (card) return card;
    }
    return null;
  }

  function getGHLNameRow() {
    const card = getGHLContactCard();
    if (!card) return null;
    for (const child of card.children) {
      if (child.querySelector && child.querySelector('.record-avatar')) {
        return child;
      }
    }
    return card.children[0] || null;
  }

  /**
   * Find the GHL timezone field container (the #field-container div
   * that contains #contact\.timezone)
   */
  function getGHLTzFieldContainer() {
    const sel = document.querySelector('#contact\\.timezone');
    if (!sel) return null;
    // Walk up to the #field-container
    let el = sel;
    for (let i = 0; i < 10 && el; i++) {
      if (el.id === 'field-container') return el;
      el = el.parentElement;
    }
    return sel.closest('#field-container') || sel.closest('[data-v-31f00dab]');
  }

  // ============================================================
  // UNIFIED: get selected timezone for current platform
  // ============================================================
  function getSelectedTz() {
    const p = detectPlatformLazy();
    if (p === 'ghl') return getGHLSelectedTz();
    if (p === 'zoho') return getZohoSelectedTz();
    return getGHLSelectedTz() || getZohoSelectedTz();
  }

  // ============================================================
  // TOAST
  // ============================================================
  function toast(msg) {
    let t = document.getElementById('djm-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'djm-toast';
      t.style.cssText = `
        position: fixed; bottom: 20px; right: 20px; z-index: 99999;
        background: var(--ds-surface,#1f2d3d); color: var(--ds-text,#fff); padding: 10px 14px;
        border-radius: 6px; font: 13px -apple-system,sans-serif;
        box-shadow: 0 4px 12px rgba(0,0,0,0.2); opacity: 0;
        transition: opacity 0.2s; pointer-events: none;
      `;
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._hide);
    t._hide = setTimeout(() => (t.style.opacity = '0'), 2500);
  }

  // ============================================================
  // SHARED BUTTON STYLES
  // ============================================================
  const BTN_BASE_STYLE = `
    display: inline-flex; align-items: center; justify-content: center;
    cursor: pointer; border: none; border-radius: 4px;
    font: 11px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    padding: 3px 8px; gap: 4px;
    transition: background 0.15s, transform 0.1s;
    user-select: none; white-space: nowrap;
  `;

  const COPY_SVG = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="5" width="9" height="9" rx="1.5"/><path d="M5 11H3.5A1.5 1.5 0 012 9.5v-7A1.5 1.5 0 013.5 1h7A1.5 1.5 0 0112 2.5V5"/></svg>`;
  const PASTE_SVG = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="10" height="11" rx="1.5"/><path d="M6 1h4a1 1 0 011 1v1H5V2a1 1 0 011-1z"/></svg>`;
  const CHECK_SVG = `<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 8l4 4 6-7"/></svg>`;

  // ============================================================
  // GHL: COPY BUTTON
  // ============================================================
  function installGHLCopyButton() {
    if (document.querySelector('.' + COPY_BTN_CLASS)) return;

    const tzContainer = getGHLTzFieldContainer();
    if (!tzContainer) return;

    // Find the label row for the timezone field
    const label = tzContainer.querySelector('.hr-form-item-label');
    if (!label) return;

    const btn = document.createElement('button');
    btn.className = COPY_BTN_CLASS;
    btn.title = 'Copy timezone to Zoho clipboard';
    btn.style.cssText = BTN_BASE_STYLE + `
      background: #eef2ff; color: var(--ds-info,#2f6ad1);
      margin-left: 6px; vertical-align: middle;
    `;
    btn.innerHTML = COPY_SVG + '<span>Copy TZ</span>';

    btn.addEventListener('mouseenter', () => btn.style.background = '#dbe4ff');
    btn.addEventListener('mouseleave', () => btn.style.background = '#eef2ff');

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const rawTz = getGHLSelectedTz();
      if (!rawTz || rawTz === '--') {
        toast('No timezone set on this contact');
        return;
      }
      const iana = extractIANA(rawTz);
      if (!iana) {
        toast('Could not parse timezone: ' + rawTz);
        return;
      }
      // Store both the raw string and the IANA
      saveCopiedTz(JSON.stringify({ raw: rawTz, iana: iana, ts: Date.now() }));
      // Also copy to system clipboard
      navigator.clipboard.writeText(rawTz).catch((e) => { console.warn('[DJM-TZ]', e); });

      // Visual feedback
      btn.innerHTML = CHECK_SVG + '<span>Copied!</span>';
      btn.style.background = '#d4edda';
      btn.style.color = 'var(--ds-success,#0a8754)';
      setTimeout(() => {
        btn.innerHTML = COPY_SVG + '<span>Copy TZ</span>';
        btn.style.background = '#eef2ff';
        btn.style.color = '#2f6ad1';
      }, 1500);

      toast('Copied: ' + iana);
      log('Copied TZ from GHL:', rawTz, '→', iana);
    });

    // Insert after the label text
    const labelText = label.querySelector('.hr-form-item-label__text');
    if (labelText) {
      labelText.appendChild(btn);
    } else {
      label.appendChild(btn);
    }
  }

  // ============================================================
  // ZOHO: PASTE BUTTON
  // ============================================================
  function installZohoPasteButton() {
    if (document.querySelector('.' + PASTE_BTN_CLASS)) return;

    const tzRow = getZohoTzFieldRow();
    if (!tzRow) return;

    // Find the label div
    const labelDiv = tzRow.querySelector('.dv_info_label');
    if (!labelDiv) return;

    const btn = document.createElement('button');
    btn.className = PASTE_BTN_CLASS;
    btn.title = 'Paste timezone from GHL';
    btn.style.cssText = BTN_BASE_STYLE + `
      background: #eef2ff; color: var(--ds-info,#2f6ad1);
      margin-left: 6px; vertical-align: middle;
      position: relative; top: -1px;
    `;
    btn.innerHTML = PASTE_SVG + '<span>Paste TZ</span>';

    btn.addEventListener('mouseenter', () => btn.style.background = '#dbe4ff');
    btn.addEventListener('mouseleave', () => btn.style.background = '#eef2ff');

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const stored = loadCopiedTz();
      if (!stored) {
        toast('No timezone copied. Copy from GHL first.');
        return;
      }

      let data;
      try {
        data = JSON.parse(stored);
      } catch {
        toast('Invalid clipboard data');
        return;
      }

      if (!data.iana) {
        toast('No IANA timezone in clipboard');
        return;
      }

      // Check age — warn if older than 1 hour
      const ageMin = Math.round((Date.now() - (data.ts || 0)) / 60000);
      if (ageMin > 60) {
        if (!confirm(`Copied timezone is ${ageMin} minutes old.\n\n${data.iana}\n\nPaste anyway?`)) return;
      }

      log('Pasting TZ to Zoho:', data.iana, 'from raw:', data.raw);

      // Visual feedback
      btn.innerHTML = '<span>Pasting...</span>';
      btn.style.background = '#fff3cd';
      btn.style.color = '#856404';

      const ok = zohoSetTimezone(data.iana);
      if (!ok) {
        btn.innerHTML = PASTE_SVG + '<span>Paste TZ</span>';
        btn.style.background = '#eef2ff';
        btn.style.color = '#2f6ad1';
      } else {
        // Reset button after the operation completes
        setTimeout(() => {
          btn.innerHTML = CHECK_SVG + '<span>Pasted!</span>';
          btn.style.background = '#d4edda';
          btn.style.color = 'var(--ds-success,#0a8754)';
          setTimeout(() => {
            btn.innerHTML = PASTE_SVG + '<span>Paste TZ</span>';
            btn.style.background = '#eef2ff';
            btn.style.color = '#2f6ad1';
          }, 2000);
        }, 1500);
      }
    });

    labelDiv.appendChild(btn);
  }

  // ============================================================
  // ZOHO: Scroll-to-Coaching (unchanged, Zoho-only)
  // ============================================================
  function findCoachingHeader() {
    const headers = document.querySelectorAll('span.crmFormSubHeader');
    for (const s of headers) {
      if ((s.textContent || '').trim() === 'Coaching') return s;
    }
    return null;
  }

  function jumpToCoaching(silent = false) {
    const t = findCoachingHeader();
    if (t) {
      t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      setTimeout(() => window.scrollBy({ top: -80, behavior: 'smooth' }), 350);
      return true;
    }
    if (!silent) toast('Could not find "Coaching" section.');
    return false;
  }

  const scrolledUrls = new Set();

  function tryScrollOnce(reason) {
    if (!isAutoScrollOn()) return true;
    if (scrolledUrls.has(location.href)) return true;
    const ok = jumpToCoaching(true);
    if (ok) {
      scrolledUrls.add(location.href);
      log('Scrolled to Coaching (', reason, ')');
    }
    return ok;
  }

  function startScrollCampaign(reason, initialDelay) {
    if (detectPlatformLazy() !== 'zoho') return;
    if (!isAutoScrollOn()) { log('Auto-scroll disabled, skipping', reason); return; }
    if (scrolledUrls.has(location.href)) return;
    log('Scroll campaign:', reason, 'delay', initialDelay + 'ms');

    setTimeout(() => {
      if (!isAutoScrollOn() || scrolledUrls.has(location.href)) return;
      if (tryScrollOnce(reason + '-first')) return;

      const startedForUrl = location.href;
      let tries = 0;
      const iv = setInterval(() => {
        tries++;
        if (!isAutoScrollOn()
            || location.href !== startedForUrl
            || scrolledUrls.has(location.href)
            || tries > SCROLL_MAX_TRIES) {
          clearInterval(iv);
          return;
        }
        tryScrollOnce(reason + '-retry#' + tries);
      }, SCROLL_RETRY_MS);
    }, initialDelay);
  }

  function forceRescroll(reason) {
    scrolledUrls.delete(location.href);
    startScrollCampaign(reason, 100);
  }

  // ============================================================
  // RIGHT-CLICK CONTEXT MENU (Zoho panels only)
  // ============================================================
  function hideContextMenu() {
    document.getElementById(CTXMENU_ID)?.remove();
  }

  function showContextMenu(x, y) {
    hideContextMenu();
    const on = isAutoScrollOn();
    const menu = document.createElement('div');
    menu.id = CTXMENU_ID;
    menu.style.cssText = `
      position: fixed; top: ${y}px; left: ${x}px;
      z-index: 99999;
      background: #fff; border: 1px solid #c4cdd9;
      border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,.15);
      font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-width: 220px; padding: 4px 0;
      color: var(--ds-text,#1f2d3d);
    `;

    const addItem = (label, onClick, active = false) => {
      const row = document.createElement('div');
      row.style.cssText = `
        padding: 7px 14px 7px 30px; cursor: pointer; position: relative;
        ${active ? 'font-weight:600;background:#f0f4fa;' : ''}
      `;
      if (active) {
        const check = document.createElement('span');
        check.textContent = '\u2713';
        check.style.cssText = 'position:absolute;left:12px;color:#2f6ad1;';
        row.appendChild(check);
      }
      row.appendChild(document.createTextNode(label));
      row.addEventListener('mouseenter', () => row.style.background = '#e8eef7');
      row.addEventListener('mouseleave', () => row.style.background = active ? '#f0f4fa' : '');
      row.addEventListener('click', () => { onClick(); hideContextMenu(); });
      menu.appendChild(row);
    };
    const addSep = () => {
      const hr = document.createElement('div');
      hr.style.cssText = 'height:1px;background:var(--ds-border,#e5e8ec);margin:4px 0;';
      menu.appendChild(hr);
    };

    addItem('Auto-scroll to Coaching', () => {
      const next = !on;
      setAutoScroll(next);
      refreshAllPanels();
      if (next) {
        toast('Auto-scroll: ON');
        forceRescroll('toggle-on');
      } else {
        toast('Auto-scroll: OFF');
      }
    }, on);

    addSep();

    addItem('Jump to Coaching now', () => {
      jumpToCoaching();
    });

    document.body.appendChild(menu);

    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth)  menu.style.left = (window.innerWidth - rect.width - 8) + 'px';
    if (rect.bottom > window.innerHeight) menu.style.top = (window.innerHeight - rect.height - 8) + 'px';

    setTimeout(() => {
      const onClick = (e) => { if (!menu.contains(e.target)) cleanup(); };
      const onKey   = (e) => { if (e.key === 'Escape') cleanup(); };
      const onScroll= () => cleanup();
      function cleanup() {
        hideContextMenu();
        document.removeEventListener('mousedown', onClick, true);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('scroll', onScroll, true);
      }
      document.addEventListener('mousedown', onClick, true);
      document.addEventListener('keydown', onKey, true);
      window.addEventListener('scroll', onScroll, true);
    }, 0);
  }

  // ============================================================
  // PANEL BUILDER
  // ============================================================
  function buildPanel(anchorKey) {
    const p = detectPlatformLazy();
    const isGHL = (p === 'ghl');

    const wrap = document.createElement('div');
    wrap.className = PANEL_CLASS;
    wrap.setAttribute('data-djm-anchor', anchorKey);

    if (isGHL) {
      wrap.style.cssText = `
        margin: 0;
        padding: 10px 12px;
        background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
        border-top: 1px solid var(--ds-border,#e5e7eb);
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 12px;
        color: #344054;
        line-height: 1.55;
        user-select: none;
      `;
    } else {
      wrap.style.cssText = `
        margin: 10px 0 14px 0;
        padding: 12px 14px;
        background: linear-gradient(180deg, #f4f7fb 0%, #edf1f7 100%);
        border: 1px solid #c4d0e0;
        border-left: 3px solid #2f6ad1;
        border-radius: 6px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        color: var(--ds-text,#1f2d3d);
        line-height: 1.6;
        max-width: 460px;
        box-shadow: 0 1px 3px rgba(0,0,0,0.06);
        user-select: none;
      `;
    }

    const footerHTML = isGHL ? '' : `
      <div data-role="mode-footer"
        style="margin-top:8px;padding-top:8px;border-top:1px dashed #c4d0e0;font-size:11px;color:#8893a6;">
      </div>
    `;

    wrap.innerHTML = `
      <div data-role="tz-body">Loading timezone\u2026</div>
      ${footerHTML}
    `;

    if (!isGHL) {
      wrap.addEventListener('contextmenu', (e) => {
        e.preventDefault(); e.stopPropagation();
        showContextMenu(e.clientX, e.clientY);
      });
    }

    return wrap;
  }

  // ============================================================
  // PANEL RENDERING
  // ============================================================
  function renderBody(wrap) {
    if (!wrap) return;
    const body   = wrap.querySelector('[data-role="tz-body"]');
    const footer = wrap.querySelector('[data-role="mode-footer"]');
    if (!body) return;

    const p = detectPlatformLazy();
    const isGHL = (p === 'ghl');
    const rawTz = getSelectedTz();
    const tz = rawTz ? extractIANA(rawTz) : null;

    if (!tz) {
      body.innerHTML = `<span style="color:#8893a6;font-size:${isGHL ? '11px' : '13px'};">No patient timezone set</span>`;
    } else {
      const now = new Date();
      try {
        const abbr       = simplifyAbbr(tzAbbr(tz, now));
        const offset     = offsetFromClinic(tz, now);
        const ptTime     = fmtTime(tz, now);
        const ptDay      = fmtDay(tz, now);
        const clinicTime = fmtTime(CLINIC_TZ, now);
        const signed = offset > 0 ? `+${offset}` : `${offset}`;
        const color  = offset === 0 ? 'var(--ds-info,#2f6ad1)' : (offset > 0 ? 'var(--ds-success,#0a8754)' : 'var(--ds-warn,#c76a00)');

        if (isGHL) {
          body.innerHTML = `
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:2px 12px;">
              <div><span style="color:#667085;">TZ:</span> <b>${abbr}</b></div>
              <div><span style="color:#667085;">Offset:</span>
                <span style="color:${color};font-weight:600;">${signed} hr</span>
              </div>
              <div><span style="color:#667085;">Patient:</span> ${ptTime} \u00B7 ${ptDay}</div>
              <div><span style="color:#667085;">Clinic:</span> ${clinicTime}</div>
            </div>
          `;
        } else {
          body.innerHTML = `
            <div><b>Timezone:</b> ${abbr}
              <span style="color:#8893a6;font-size:12px;">(${String(tz).replace(/_/g, ' ')})</span>
            </div>
            <div><b>Time Difference:</b>
              <span style="color:${color};font-weight:600;">${signed} hr</span>
              <span style="color:#8893a6;font-size:12px;">from clinic</span>
            </div>
            <div><b>Patient Local Time:</b> ${ptTime} \u00B7 ${ptDay}</div>
            <div><b>Clinic Time:</b>        ${clinicTime}</div>
          `;
        }
      } catch (err) {
        body.innerHTML = `<span style="color:#c03;">Invalid timezone: ${tz}</span>`;
        log('Intl error:', err);
      }
    }

    if (footer) {
      const state = isAutoScrollOn() ? 'ON' : 'OFF';
      const clr   = isAutoScrollOn() ? '#0a8754' : '#8893a6';
      footer.innerHTML =
        `Auto-scroll to Coaching: <b style="color:${clr};">${state}</b> \u00B7 right-click to toggle`;
    }
  }

  function refreshAllPanels() {
    document.querySelectorAll('.' + PANEL_CLASS).forEach(renderBody);
  }

  // ============================================================
  // PANEL MOUNT HELPERS
  // ============================================================
  function mountPanelAfter(row, anchorKey) {
    if (!row) return false;
    const selector = `.${PANEL_CLASS}[data-djm-anchor="${anchorKey}"]`;
    const existing = document.querySelector(selector);
    if (existing && row.nextElementSibling === existing) {
      renderBody(existing);
      return true;
    }
    if (existing) existing.remove();
    const panel = buildPanel(anchorKey);
    row.insertAdjacentElement('afterend', panel);
    renderBody(panel);
    log('Panel mounted (', anchorKey, ') after:', row.id || row.className || row.tagName);
    return true;
  }

  // ============================================================
  // INSTALL: platform-specific
  // ============================================================
  function installZohoPanels() {
    let any = false;
    any = mountPanelAfter(getZohoTzFieldRow(), ANCHOR_TZ_FIELD) || any;
    any = mountPanelAfter(getZohoCoachingLastRow(), ANCHOR_COACHING_LAST) || any;
    return any;
  }

  function installGHLPanel() {
    const nameRow = getGHLNameRow();
    if (!nameRow) return false;
    return mountPanelAfter(nameRow, ANCHOR_GHL_CONTACT);
  }

  function installAllPanels() {
    const p = detectPlatformLazy();
    if (p === 'ghl') {
      installGHLCopyButton();
      return installGHLPanel();
    }
    if (p === 'zoho') {
      installZohoPasteButton();
      return installZohoPanels();
    }
    return installGHLPanel() || installZohoPanels();
  }

  // ============================================================
  // TICK
  // ============================================================
  function tick() {
    const p = detectPlatformLazy();

    // Ensure copy/paste buttons exist
    if (p === 'ghl') installGHLCopyButton();
    if (p === 'zoho') installZohoPasteButton();

    if (document.querySelectorAll('.' + PANEL_CLASS).length === 0) {
      installAllPanels();
    } else {
      refreshAllPanels();

      if (p === 'ghl') {
        if (!document.querySelector(`.${PANEL_CLASS}[data-djm-anchor="${ANCHOR_GHL_CONTACT}"]`)) {
          installGHLPanel();
        }
      } else if (p === 'zoho') {
        if (!document.querySelector(`.${PANEL_CLASS}[data-djm-anchor="${ANCHOR_TZ_FIELD}"]`)) {
          mountPanelAfter(getZohoTzFieldRow(), ANCHOR_TZ_FIELD);
        }
        if (!document.querySelector(`.${PANEL_CLASS}[data-djm-anchor="${ANCHOR_COACHING_LAST}"]`)) {
          mountPanelAfter(getZohoCoachingLastRow(), ANCHOR_COACHING_LAST);
        }
      }
    }
  }

  // ============================================================
  // MUTATION OBSERVER
  // ============================================================
  let moDebounce = null;
  new MutationObserver(() => {
    if (moDebounce) return;
    moDebounce = setTimeout(() => {
      moDebounce = null;
      const p = detectPlatformLazy();
      if (p === 'zoho' && isAutoScrollOn() && !scrolledUrls.has(location.href)) {
        tryScrollOnce('mutation');
      }
      tick();
    }, 250);
  }).observe(document.body, { childList: true, subtree: true });

  // Zoho: re-render panels on timezone edit
  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest(
      'lyte-drop-item[data-zcqa^="Patient Timezone_"]'
    )) {
      setTimeout(tick, 200);
    }
  }, true);

  // GHL: re-render panels when timezone select changes
  document.addEventListener('click', (e) => {
    const tzSelect = document.querySelector('#contact\\.timezone');
    if (tzSelect && tzSelect.contains(e.target)) {
      setTimeout(tick, 300);
      setTimeout(tick, 800);
    }
  }, true);

  // ============================================================
  // URL WATCHER
  // ============================================================
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      document.querySelectorAll('.' + PANEL_CLASS).forEach(p => p.remove());
      // Also remove copy/paste buttons on nav
      document.querySelectorAll('.' + COPY_BTN_CLASS).forEach(b => b.remove());
      document.querySelectorAll('.' + PASTE_BTN_CLASS).forEach(b => b.remove());
      if (detectPlatformLazy() === 'zoho') {
        startScrollCampaign('url-change', 800);
      }
    }
  }, 400);

  // ============================================================
  // ZOHO: Scroll boot
  // ============================================================
  startScrollCampaign('boot', SCROLL_INITIAL_DELAY);

  // ============================================================
  // TAMPERMONKEY MENU
  // ============================================================
  if (typeof GM_registerMenuCommand !== 'undefined') {
    GM_registerMenuCommand('Toggle auto-scroll to Coaching', () => {
      const next = !isAutoScrollOn();
      setAutoScroll(next);
      refreshAllPanels();
      toast('Auto-scroll: ' + (next ? 'ON' : 'OFF'));
      if (next) forceRescroll('tm-toggle');
    });
    GM_registerMenuCommand('Jump to Coaching now', () => {
      jumpToCoaching();
    });
    GM_registerMenuCommand('Copy TZ from this page', () => {
      const rawTz = getSelectedTz();
      if (!rawTz) { toast('No timezone found'); return; }
      const iana = extractIANA(rawTz);
      if (!iana) { toast('Could not parse: ' + rawTz); return; }
      saveCopiedTz(JSON.stringify({ raw: rawTz, iana: iana, ts: Date.now() }));
      toast('Copied: ' + iana);
    });
    GM_registerMenuCommand('Paste TZ to Zoho', () => {
      if (detectPlatformLazy() !== 'zoho') { toast('Only works on Zoho'); return; }
      const stored = loadCopiedTz();
      if (!stored) { toast('Nothing copied'); return; }
      try {
        const data = JSON.parse(stored);
        if (data.iana) zohoSetTimezone(data.iana);
      } catch { toast('Invalid clipboard'); }
    });
  }

  // ============================================================
  // BOOT
  // ============================================================
  let tries = 0;
  const bootInterval = setInterval(() => {
    tries++;
    const ok = installAllPanels();
    if ((ok && tries > 6) || tries > 40) clearInterval(bootInterval);
  }, 500);

  setInterval(tick, TICK_MS);

  log('userscript v2.1 loaded. Platform:', PLATFORM || 'detecting\u2026',
      'Auto-scroll:', isAutoScrollOn() ? 'ON' : 'OFF');
})();