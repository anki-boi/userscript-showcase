// ==UserScript==
// @name         Zoho Task Toolkit
// @namespace    http://tampermonkey.net/
// @version      3.3
// @author       Jeyson Dagondon
// @description  Task Update menus, inline due-date quick-set, subject templates, bulk-open task contacts
// @match        https://crm.zoho.com/*
// @match        *://*.zoho.com/crm/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[TaskTK v3.3] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['TaskTK'] = { name: 'Zoho Task Toolkit', version: '3.3', state: 'idle', message: 'Loaded', output: null, error: null, lastActivity: Date.now(), trigger: null };

// ============================================================================
// MERGE (2026-09-25, v3.0) — this file replaces three scripts:
//   Zoho Task Update + Due Date Branching Menu  v2.16   (popover menus)
//   Zoho Task Due Date Quick-Set (Inline)       v1.4    (📅▾ button)
//   Zoho CRM — Subject Template Branching Menu  v1.1.14 (subject menu)
// The three widgets behave exactly as before. What merged is the DATE ENGINE
// and the DATA TABLES: offsets now live in exactly ONE table (TASK_ACTIONS),
// so changing a due date — or adding an option — is a one-line edit here
// instead of edits in three files in three different dialects. The single
// source is enforced by _smoketest/verify-autoduedate.js (R23).
// Also: one MutationObserver with a guarded injector per widget, so a throw in
// one widget cannot take the other two down; @grant none (initials moved from
// GM storage to localStorage) keeps every widget in page context.
// ============================================================================

(function () {
  'use strict';

  // Design-system tokens (a top-level block in the pre-merge scripts; now where
  // it belongs, inside the IIFE — same effect, one scope).
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}';
  document.documentElement.appendChild(__dsStyle);

  // ================================================================
  // BASIC HELPERS
  // ================================================================
  function getCurrentDate() {
    const now = new Date();
    return `${now.getMonth() + 1}/${now.getDate()}/${String(now.getFullYear()).slice(-2)}`;
  }

  // Initials: was GM_getValue/GM_setValue (needed @grant + a sandbox). Now
  // localStorage — same per-browser scope, no grant, so all three widgets keep
  // running in page context (see the merge note above).
  const INITIALS_KEY = 'ttkUserInitials';

  function getOrPromptInitials() {
    let initials = null;
    try { initials = localStorage.getItem(INITIALS_KEY); } catch (e) { /* private mode */ }
    if (!initials) {
      initials = prompt('Enter your initials (e.g. -JD, -HH):');
      if (initials) {
        initials = initials.trim().toUpperCase();
        try { localStorage.setItem(INITIALS_KEY, initials); } catch (e) { /* not persisted */ }
      }
    }
    return initials || '';
  }

  // ================================================================
  // DATE ENGINE — one copy for all three widgets
  // ================================================================
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const MONTHS_LONG = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  // Zoho validates a date field strictly against the signed-in user's OWN date
  // pattern (`Crm.userDetails.DATE_PATTERN`, e.g. "MMM d, yyyy" or "M/d/yy") and
  // pops a blocking "check the date format" alert otherwise — so a hardcoded
  // "Sep 24, 2026" only works on accounts configured with that pattern (that is
  // why the pre-merge scripts broke for coworkers). Read the pattern from the
  // page; fall back to the field's own placeholder, which Zoho renders from the
  // same setting (verified live 2026-09-25: placeholder "MMM d, yyyy" ==
  // DATE_PATTERN). See SCRIPT-BEST-PRACTICES R22.
  function userDatePattern(field) {
    try {
      const w = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      const p = w.Crm && w.Crm.userDetails && w.Crm.userDetails.DATE_PATTERN;
      if (p) return p;
    } catch (e) { /* fall through to the DOM fallback */ }
    if (field && field.placeholder && /^[yYmMdD\s,./-]+$/.test(field.placeholder)) return field.placeholder;
    return 'MMM d, yyyy';
  }

  // Formats in the user's pattern — matches what Zoho's own validator
  // (`CrmDateUtils.isValidDate`) accepts for every allowed pattern.
  function formatZohoDate(d, field) {
    const pad = (n) => String(n).padStart(2, '0');
    const tok = {
      YYYY: String(d.getFullYear()),
      YY: pad(d.getFullYear() % 100),
      MMMM: MONTHS_LONG[d.getMonth()],
      MMM: MONTHS[d.getMonth()],
      MM: pad(d.getMonth() + 1),
      M: String(d.getMonth() + 1),
      DD: pad(d.getDate()),
      D: String(d.getDate()),
    };
    return userDatePattern(field).replace(/YYYY|YY|MMMM|MMM|MM|M|DD|D/gi, (t) => tok[t.toUpperCase()]);
  }

  function isWeekend(d) {
    const day = d.getDay();
    return day === 0 || day === 6;
  }

  function rollForwardToWeekday(d) {
    while (isWeekend(d)) d.setDate(d.getDate() + 1);
    return d;
  }

  // UNIFIED 2026-09-25 (Jeyson: "push to next weekday is always safest").
  // Before the merge the subject menu's { weeks: N } offsets did NOT roll off
  // the weekend while the other two widgets did — the same offset could land on
  // a Saturday depending on which menu you clicked. Now every calendar offset
  // rolls forward. The one deliberate exception is `today`: the option is
  // labelled "Today", so it stamps today even if today is a Saturday.
  //
  // Types:
  //   today            → today's date, no roll (label is literal)
  //   business   { n } → n weekdays ahead (weekends skipped)
  //   calendar   { n } → n days ahead, then rolled to the next weekday
  //   followingMonday  → the next Monday strictly after today (never today)
  function computeDueDate(option, from) {
    const d = from ? new Date(from.getTime()) : new Date();
    d.setHours(0, 0, 0, 0);
    if (option.type === 'today') return d;
    if (option.type === 'followingMonday') {
      let delta = (1 - d.getDay() + 7) % 7; // 0 when today is Monday
      if (delta === 0) delta = 7;
      d.setDate(d.getDate() + delta);
      return d;
    }
    if (option.type === 'business') {
      let added = 0;
      while (added < option.n) {
        d.setDate(d.getDate() + 1);
        if (!isWeekend(d)) added++;
      }
      return d;
    }
    d.setDate(d.getDate() + option.n);
    return rollForwardToWeekday(d);
  }

  function ordinal(n) {
    const num = parseInt(n, 10);
    if (isNaN(num)) return String(n);
    const s = ['th', 'st', 'nd', 'rd'];
    const v = num % 100;
    return num + (s[(v - 20) % 10] || s[v] || s[0]);
  }

  function promptOrdinal() {
    const n = prompt('Which payment number? (e.g. 2, 7)');
    if (n === null || !n.trim()) return null;
    return ordinal(n.trim());
  }

  function promptDateRange(title) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      Object.assign(overlay.style, {
        position: 'fixed', inset: '0', background: 'rgba(0,0,0,0.35)',
        zIndex: '999999', display: 'flex', alignItems: 'center', justifyContent: 'center',
      });

      const box = document.createElement('div');
      Object.assign(box.style, {
        background: '#fff', padding: '18px 20px', borderRadius: '6px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.25)', fontSize: '13px',
        fontFamily: 'inherit', minWidth: '260px',
      });

      box.innerHTML = `
        <div style="font-weight:bold;margin-bottom:12px;"></div>
        <label style="display:block;margin-bottom:8px;">From
          <input type="date" id="__drFrom" style="display:block;width:100%;margin-top:3px;padding:4px;">
        </label>
        <label style="display:block;margin-bottom:14px;">To
          <input type="date" id="__drTo" style="display:block;width:100%;margin-top:3px;padding:4px;">
        </label>
        <div style="text-align:right;">
          <button id="__drCancel" style="padding:5px 12px;margin-right:6px;cursor:pointer;">Cancel</button>
          <button id="__drOk" style="padding:5px 12px;cursor:pointer;background:var(--ds-accent,#1a73e8);color:var(--ds-accent-text,#fff);border:none;border-radius:3px;">OK</button>
        </div>
      `;
      box.firstElementChild.textContent = title || 'Pick a date range';

      overlay.appendChild(box);
      document.body.appendChild(overlay);

      const fromEl = box.querySelector('#__drFrom');
      const toEl = box.querySelector('#__drTo');
      fromEl.focus();

      const close = (val) => { overlay.remove(); resolve(val); };

      box.querySelector('#__drCancel').addEventListener('click', () => close(null));
      box.querySelector('#__drOk').addEventListener('click', () => {
        if (!fromEl.value || !toEl.value) { alert('Pick both dates.'); return; }
        const fmt = (v) => {
          const [y, m, d] = v.split('-');
          return `${parseInt(m, 10)}/${parseInt(d, 10)}`;
        };
        close(`${fmt(fromEl.value)} - ${fmt(toEl.value)}`);
      });
      overlay.addEventListener('click', (e) => { if (e.target === overlay) close(null); });
      box.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') box.querySelector('#__drOk').click();
        if (e.key === 'Escape') close(null);
      });
    });
  }

  async function fillTemplate(text, meta) {
    let out = text;

    if (out.includes('[ordinal]')) {
      const ord = promptOrdinal();
      if (ord === null) return null;
      out = out.replace(/\[ordinal\]/g, ord);
    }

    if (out.includes('[daterange]')) {
      const range = await promptDateRange((meta && meta.rangeTitle) || 'Pick a date range');
      if (range === null) return null;
      out = out.replace(/\[daterange\]/g, range);
    }

    return out
      .replace(/\[date\]/g, getCurrentDate())
      .replace(/\[initials\]/g, getOrPromptInitials());
  }

  function waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing) return resolve(existing);
      const obs = new MutationObserver(() => {
        const el = document.querySelector(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => {
        obs.disconnect();
        reject(new Error('Timed out waiting for ' + selector));
      }, timeout);
    });
  }

  function setFieldValue(el, value) {
    el.focus();
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true }));
  }

  // Same injection technique the due-date widgets all share: the 'change' event
  // fires the field's inline quickTask.handleDuedateChange().
  function setDueDateField(field, dateStr) {
    field.focus();
    field.value = dateStr;
    field.setAttribute('aria-valuenow', dateStr);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // ================================================================
  // TASK UPDATE OPTIONS — the ONE place an offset is declared.
  // Category -> Label -> { tpl, due?, rangeTitle? }
  //   tpl        task-update text; [date] / [initials] / [ordinal] / [daterange]
  //   due        auto due date applied on save: { type, n } (see computeDueDate)
  //              n: 0 stamps today's date (no move) — no ⚡ badge is shown
  //   rangeTitle title of the [daterange] prompt
  // To add an option: add ONE line here. To change an offset: edit its `due`.
  // ================================================================
  const TASK_ACTIONS = {
    "Payment & Admin": {
      "No payment yet": { tpl: `[date] no payment yet [initials]`, due: { type: 'business', n: 1 } },
      "No Nth payment yet": { tpl: `[date] no [ordinal] payment yet [initials]`, due: { type: 'business', n: 2 } },
      "PPW not yet signed": { tpl: `[date] PPW not yet signed [initials]`, due: { type: 'business', n: 1 } },
      "Questionnaire sent to patient": { tpl: `[date] questionnaire sent to patient [initials]`, due: { type: 'business', n: 1 } },
    },
    "Next Vial Confirmation": {
      "Sent SMS - can receive?": { tpl: `[date] sent sms if Pt can rcv [initials]`, due: { type: 'business', n: 1 } },
    },
    "Labs": {
      "No labs yet": { tpl: `[date] no labs yet [initials]`, due: { type: 'calendar', n: 7 } },
      "No labs yet - reminder triggered": { tpl: `[date] no labs yet, triggered the reminder automation [initials]`, due: { type: 'calendar', n: 7 } },
      "Partials are in": { tpl: `[date] partials are in [initials]`, due: { type: 'business', n: 3 } },
      "Labs on requisition ready": { tpl: `[date] labs still on requisition ready [initials]`, due: { type: 'calendar', n: 14 } },
      "Labs sent to Laura": { tpl: `[date] labs sent to Laura [initials]`, due: { type: 'business', n: 0 } },
      "Good to order": { tpl: `[date] Good to order [initials]`, due: { type: 'business', n: 0 } },
    },
    "Med Call": {
      "No show on med call": { tpl: `[date] no show on med call [initials]`, due: { type: 'business', n: 0 } },
      "Check for updates": { tpl: `[date] check sms, notes, GHL, email for updates [initials]`, due: { type: 'business', n: 0 } },
    },
    "Refills": {
      "Refill - sent SMS": { tpl: `[date] sent sms if pt wants a refill [initials]`, due: { type: 'business', n: 1 } },
      "Refill - with management plan": { tpl: `[date] sent sms if pt wants a refill, with management plan [initials]`, due: { type: 'business', n: 1 } },
      "Refill - eligible for new Rx": { tpl: `[date] sent sms if pt wants a refill, eligible for new rx [initials]`, due: { type: 'business', n: 1 } },
      "Continue - needs new plan": { tpl: `[date] sent sms if pt wants to continue, pt need to purchase new plan [initials]`, due: { type: 'business', n: 1 } },
      "Does not need refill yet": { tpl: `[date] does not need refill yet [initials]`, due: { type: 'calendar', n: 28 } },
    },
    "Shipping": {
      "Ship on/within date range": {
        tpl: `[date] need to be ship on/within [daterange] [initials]`,
        rangeTitle: 'Ship on/within',
        due: { type: 'business', n: 1 },
      },
      "Pt out of town": {
        tpl: `[date] Pt will be out of town on [daterange] [initials]`,
        rangeTitle: 'Patient out of town',
        due: { type: 'business', n: 1 },
      },
    },
  };

  // ================================================================
  // DUE DATE OPTIONS — one table, used by BOTH entry points (the task
  // popover's "Set Due Date ▸" flyout and the inline 📅▾ button).
  // ================================================================
  const DUE_DATE_OPTIONS = {
    "Today":            { type: 'today' },
    "+1 business day":  { type: 'business', n: 1 },
    "+2 business day":  { type: 'business', n: 2 },
    "+3 business days": { type: 'business', n: 3 },
    "+4 business days": { type: 'business', n: 4 },
    "+5 business days": { type: 'business', n: 5 },
    "1 week":   { type: 'calendar', n: 7 },
    "2 weeks":  { type: 'calendar', n: 14 },
    "3 weeks":  { type: 'calendar', n: 21 },
    "4 weeks":  { type: 'calendar', n: 28 },
    "5 weeks":  { type: 'calendar', n: 35 },
    "6 weeks":  { type: 'calendar', n: 42 },
    "7 weeks":  { type: 'calendar', n: 49 },
    "8 weeks":  { type: 'calendar', n: 56 },
    "9 weeks":  { type: 'calendar', n: 63 },
    "10 weeks": { type: 'calendar', n: 70 },
    "11 weeks": { type: 'calendar', n: 77 },
    "12 weeks": { type: 'calendar', n: 84 },
  };

  // ================================================================
  // SUBJECT TEMPLATE TREE (widget C data)
  // Pharmacy -> Medication -> [Variant Label, Subject String]
  // A medication maps directly to a string when it has no variants.
  // ================================================================
  const TEMPLATES = {
    "Pharmacy K": {
      "Tracking # Follow up Please": "Pharmacy K Tracking # Follow up Please"
    },

    "Pharmacy A": {
      "CJC/IPA Injection": {
        "2 Months / 1 vial": "Order CJC/IPA (1 vial / 2 months)"
      },
      "Tesamorelin Injection": {
        "4 Weeks / 2 vials": "Order Tesamorelin (2 vials / 4 weeks)",
        "3 Months / 6 vials": "Order Tesamorelin (6 vials / 3 months)"
      },
      "BPC-157 Injection": {
        "1 Month / 1 vial": "Order BPC-157 (1 vial / 1 month)",
        "3 Months / 3 vials": "Order BPC-157 (3 vials / 3 months)"
      },
      "GHK-Cu Injection": {
        "6 Weeks / 1 vial": "Order GHK-Cu (1 vial / 6 weeks)",
        "3 Months / 2 vials": "Order GHK-Cu (2 vials / 3 months)"
      },
      "TB-500 Injection": {
        "1 Month / 3 vials": "Order TB-500 (3 vials / 1 month)"
      },
      "NAD+ Injection": {
        "Light / 1 vial": "Order NAD+ Light (1 vial / 6.7 weeks)",
        "Medium / 2 vials": "Order NAD+ Medium (2 vials / 6.7 weeks)",
        "Strong / 4 vials": "Order NAD+ Strong (4 vials / 6.7 weeks)",
        "Strong / 4 vials (alt. dosing)": "Order NAD+ Strong Alt Dosing (4 vials / 6.7 weeks)"
      },
      "Wolverine Blend (BPC/TB500)": {
        "Light / 1 Month / 2 vials": "Order Wolverine Light (2 vials / 1 month)",
        "Standard / 1 Month / 3 vials": "Order Wolverine Standard (3 vials / 1 month)",
        "Strong / 1 Month / 6 vials": "Order Wolverine Strong (6 vials / 1 month)",
        "Light / 3 Months / 6 vials": "Order Wolverine Light (6 vials / 3 months)",
        "Standard / 3 Months / 9 vials": "Order Wolverine Standard (9 vials / 3 months)",
        "Strong / 3 Months / 18 vials": "Order Wolverine Strong (18 vials / 3 months)"
      },
      "Glow Blend (BPC/GHK/TB)": {
        "1 Month / 3 vials": "Order Glow (3 vials / 1 month)",
        "Strong / 1 Month / 6 vials": "Order Glow Strong (6 vials / 1 month)"
      }
    },

    "Pharmacy J": {
      "Tesofensine Pill": {
        "1 Month / 30 pills": "Order Tesofensine (30 pills / 1 month)",
        "3 Months / 90 pills": "Order Tesofensine (90 pills / 3 months)"
      },
      "5-Amino-1MQ Pill": {
        "1 Month / 30 pills": "Order 5-Amino-1MQ (30 pills / 1 month)",
        "3 Months / 90 pills": "Order 5-Amino-1MQ (90 pills / 3 months)"
      },
      "BPC Pill": {
        "1 Month / 30 pills": "Order BPC Pill (30 pills / 1 month)",
        "3 Months / 90 pills": "Order BPC Pill (90 pills / 3 months)"
      },
      "BPC/KPV Pill": {
        "1 Month / 30 pills": "Order BPC/KPV (30 pills / 1 month)",
        "2 Months / 60 pills": "Order BPC/KPV (60 pills / 2 months)",
        "3 Months / 90 pills (1/day)": "Order BPC/KPV (90 pills / 3 months)",
        "3 Months / 180 pills (2/day)": "Order BPC/KPV (180 pills / 3 months)"
      },
      "Dihexa Pill": {
        "1 Month / 30 pills": "Order Dihexa (30 pills / 1 month)",
        "3 Months / 90 pills": "Order Dihexa (90 pills / 3 months)"
      },
      "GHK-Cu Cream": {
        "1 Month / 1 bottle": "Order GHK-Cu Cream (1 bottle / 1 month)",
        "3 Months / 3 bottles": "Order GHK-Cu Cream (3 bottles / 3 months)"
      },
      "GHK-Cu / Argireline / Leuphasyl Cream": {
        "1 Month / 1 bottle (30gm)": "Order GHK-Cu/Argireline/Leuphasyl Cream (1 bottle / 1 month)",
        "3 Months / 3 bottles (30gm each)": "Order GHK-Cu/Argireline/Leuphasyl Cream (3 bottles / 3 months)"
      },
      "Semax Nasal Spray": {
        "1 Month / 1 bottle": "Order Semax Nasal Spray (1 bottle / 1 month)",
        "3 Months / 3 bottles": "Order Semax Nasal Spray (3 bottles / 3 months)"
      },
      "Selank Nasal Spray": {
        "1 Month / 1 bottle": "Order Selank Nasal Spray (1 bottle / 1 month)",
        "3 Months / 3 bottles": "Order Selank Nasal Spray (3 bottles / 3 months)"
      },
      "SLU-PP-332": {
        "New Patient - 1 Month": "Order SLU-PP-332 New Patient (14x100mcg + 18x200mcg / 1 month)",
        "New Patient - 6 Weeks": "Order SLU-PP-332 New Patient (14x100mcg + 42x200mcg / 6 weeks)",
        "New Patient - 2 Months": "Order SLU-PP-332 New Patient (14x100mcg + 78x200mcg / 2 months)",
        "New Patient - 3 Months": "Order SLU-PP-332 New Patient (14x100mcg + 138x200mcg / 3 months)",
        "New Patient - 6 Months": "Order SLU-PP-332 New Patient (14x100mcg + 318x200mcg / 6 months)",
        "Refill - 1 Month": "Order SLU-PP-332 Refill (60 caps / 1 month)",
        "Refill - 3 Months": "Order SLU-PP-332 Refill (180 caps / 3 months)"
      },
      "AOD Troche": {
        "1 Month / 30 troches": "Order AOD (30 troches / 1 month)",
        "6 Weeks / 42 troches": "Order AOD (42 troches / 6 weeks)",
        "2 Months / 60 troches": "Order AOD (60 troches / 2 months)",
        "3 Months / 90 troches": "Order AOD (90 troches / 3 months)",
        "6 Months / 180 troches": "Order AOD (180 troches / 6 months)"
      },
      "O-304": {
        "New Patient - 1 Month / 53 caps": "Order O-304 New Patient (53 caps / 1 month)",
        "New Patient - 6 Weeks / 77 caps": "Order O-304 New Patient (77 caps / 6 weeks)",
        "New Patient - 2 Months / 113 caps": "Order O-304 New Patient (113 caps / 2 months)",
        "New Patient - 3 Months / 173 caps": "Order O-304 New Patient (173 caps / 3 months)",
        "New Patient - 6 Months / 353 caps": "Order O-304 New Patient (353 caps / 6 months)",
        "Refill - 1 Month / 60 caps": "Order O-304 Refill (60 caps / 1 month)",
        "Refill - 3 Months / 180 caps": "Order O-304 Refill (180 caps / 3 months)"
      },
      "AOD + O-304 (Combined)": {
        "New Patient - 1 Month": "Order AOD + O-304 New Patient (30 troches + 53 caps / 1 month)",
        "New Patient - 6 Weeks": "Order AOD + O-304 New Patient (42 troches + 77 caps / 6 weeks)",
        "New Patient - 2 Months": "Order AOD + O-304 New Patient (60 troches + 113 caps / 2 months)",
        "New Patient - 3 Months": "Order AOD + O-304 New Patient (90 troches + 173 caps / 3 months)",
        "New Patient - 6 Months": "Order AOD + O-304 New Patient (180 troches + 353 caps / 6 months)",
        "Refill - 1 Month": "Order AOD + O-304 Refill (30 troches + 60 caps / 1 month)",
        "Refill - 3 Months": "Order AOD + O-304 Refill (90 troches + 180 caps / 3 months)"
      }
    },

    "Pharmacy D": {
      "Phentermine": {
        "1 Month / 30 pills": "Order Phentermine (30 pills / 1 month)",
        "3 Months / 90 pills": "Order Phentermine (90 pills / 3 months)"
      },
      "DSIP Troches 300mcg": {
        "1 Month / 30 troches": "Order DSIP (30 troches / 1 month)",
        "3 Months / 90 troches": "Order DSIP (90 troches / 3 months)"
      },
      "Synapsin Nasal Spray": {
        "2 Months / 1 vial 15mL": "Order Synapsin (1 vial 15mL / 2 months)",
        "4 Months / 1 vial 30mL": "Order Synapsin (1 vial 30mL / 4 months)"
      }
    },

    "Pharmacy B": {
      "PT-141 Injection": {
        "1 Vial / 2mL": "Order PT-141 Injection (1 vial 2mL / 4 weeks)"
      },
      "PT-141 Nasal Spray": {
        "1 Bottle / 3mL": "Order PT-141 Nasal Spray (1 bottle 3mL / 4 weeks)"
      },
      "SS-31 Injection": {
        "7 Weeks / 1 vial": "Order SS-31 (1 vial / 7 weeks)"
      }
    },

    "RxFlow": {
      "Labs": {
        "Tesa/IPA - RxFlow-Specific": "Order RxFlow-Specific Labs for Tesa/IPA"
      },
      "Tesa/IPA Injection": {
        "3 Months": "Order 3 months Tesa/IPA"
      },
      "KLOW Blend": {
        "3 Months": "Order 3 months KLOW"
      }
    },

    "Labs": {
      "WL Labs": {
        "Default": "Check if WL labs are in",
        "NJ Patient": "Check if WL labs are in - NJ patient",
        "NY Patient": "Check if WL labs are in - NY patient",
        "RI Patient": "Check if WL labs are in - RI patient"
      },
      "GH Labs": {
        "Default": "Check if GH labs are in",
        "NJ Patient": "Check if GH labs are in - NJ patient",
        "NY Patient": "Check if GH labs are in - NY patient",
        "RI Patient": "Check if GH labs are in - RI patient"
      },
      "BHRT Labs": {
        "Default": "Check if BHRT labs are in",
        "NJ Patient": "Check if BHRT labs are in - NJ patient",
        "NY Patient": "Check if BHRT labs are in - NY patient",
        "RI Patient": "Check if BHRT labs are in - RI patient"
      },
      "Thyroid Labs": {
        "Default": "Check if Thyroid labs are in",
        "NJ Patient": "Check if Thyroid labs are in - NJ patient",
        "NY Patient": "Check if Thyroid labs are in - NY patient",
        "RI Patient": "Check if Thyroid labs are in - RI patient"
      },
      "FU BPR": "FU BPR"
    }
  };

  // Subject lines that also stamp a due date on the form. Same { type, n }
  // dialect as everything else (was { weeks } / { businessDays } / 'followingMonday'
  // before the merge). All calendar offsets now roll off the weekend.
  const SUBJECT_DUE_DATES = {
    'FU BPR': { type: 'followingMonday' },
    'Pharmacy K Tracking # Follow up Please': { type: 'business', n: 3 },
    'Order CJC/IPA (1 vial / 2 months)': { type: 'calendar', n: 42 },
    'Order RxFlow-Specific Labs for Tesa/IPA': { type: 'calendar', n: 84 },
    'Order 3 months Tesa/IPA': { type: 'calendar', n: 84 },
  };

  // ================================================================
  // CROSS-TAB INTENT (Zoho opens task edit in a NEW TAB, 2026-09)
  // ================================================================
  // The pick (template text + auto due date, or a due-date option) is stored
  // in localStorage BEFORE clicking Zoho's Edit. If Zoho opens the edit inline
  // (popup in this tab), this tab clears the intent and runs the old flow. If
  // Zoho opens a NEW TAB (/tab/Tasks/<id>/edit), the intent stays pending and
  // the new tab's script instance consumes it at boot (consumePendingIntent).
  const INTENT_KEY = 'tmTaskEditIntent';
  const INTENT_TTL_MS = 90 * 1000;

  function readPendingIntent() {
    try {
      const raw = localStorage.getItem(INTENT_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || !o.id || Date.now() - o.ts > INTENT_TTL_MS) {
        localStorage.removeItem(INTENT_KEY);
        return null;
      }
      return o;
    } catch (e) {
      return null;
    }
  }

  function writePendingIntent(intent) {
    const rec = Object.assign({}, intent);
    if (!rec.id) rec.id = 'tm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    if (!rec.ts) rec.ts = Date.now();
    // v3.1: the write is the handoff. If it throws (quota, partitioned or
    // disabled storage) the recipient tab never sees the intent, so a silent
    // catch meant "I clicked and nothing happened" with no reason anywhere.
    try { localStorage.setItem(INTENT_KEY, JSON.stringify(rec)); }
    catch (e) { console.warn('[TaskTK] pending intent not stored — the target tab will not receive it:', e); }
    return rec;
  }

  function clearPendingIntent() {
    // A failed clear leaves a stale intent that the next tab load will consume.
    try { localStorage.removeItem(INTENT_KEY); }
    catch (e) { console.warn('[TaskTK] could not clear the pending intent — it may fire again on the next load:', e); }
  }

  // ================================================================
  // WIDGET A — task 3-dot popover: Task Update ▸ / Set Due Date ▸
  // ================================================================
  // FLOW: click Edit -> prompt -> paste -> save
  async function pasteAndSave(text, autoDate) {
    const saveBtn = document.querySelector('#saveTasksBtn');
    if (!saveBtn) {
      alert('Save button disappeared. Try again.');
      return;
    }

    const descBox = document.querySelector('#Crm_Tasks_DESCRIPTION');
    if (!descBox) {
      alert('Could not find the Description field.');
      return;
    }

    const existing = descBox.value || '';
    const prefix = existing.length ? existing.replace(/\s*$/, '') + '\n' : '';
    setFieldValue(descBox, prefix + text);

    let dueStr = null;
    if (autoDate) {
      const field = document.querySelector('#Crm_Tasks_DUEDATE');
      if (field) {
        dueStr = formatZohoDate(computeDueDate(autoDate), field);
        setDueDateField(field, dueStr);
      } else {
        console.warn('[TaskTK] auto due-date requested but #Crm_Tasks_DUEDATE not found');
      }
    }

    await new Promise((r) => setTimeout(r, 600));
    saveBtn.click();
    // legacy: showToast() never existed in any of the three pre-merge scripts,
    // so this guard has always been a no-op (flagged 2026-09-25, left as-is).
    if (typeof showToast === 'function') showToast(dueStr ? '✅ Task update saved · due ' + dueStr : '✅ Task update saved');
  }

  // Applies a Task Update pick once the edit form is confirmed in THIS tab
  // (inline path). The old triggerEditAndPaste body, minus click/wait/settle.
  async function runInlineUpdate(entry, autoDate) {
    const text = await fillTemplate(entry.tpl, entry);
    if (text === null) return; // cancelled; form stays open for manual close
    await pasteAndSave(text, autoDate);
  }

  // Stores the pick as a pending intent, clicks Zoho's Edit anchor, then
  // dispatches: inline form in this tab -> run here; no inline form -> the
  // edit was opened in a NEW TAB (Zoho 2026-09) and the intent is consumed
  // there at boot. (Verified 2026-09: the probe userscript wrapper never saw
  // page-context window.open calls.)
  async function dispatchEditPick(intent, editAnchor, runInline) {
    const oldBox = document.querySelector('#Crm_Tasks_DESCRIPTION');
    if (oldBox) oldBox.id = 'Crm_Tasks_DESCRIPTION_stale';
    const oldField = document.querySelector('#Crm_Tasks_DUEDATE');
    if (oldField) oldField.id = 'Crm_Tasks_DUEDATE_stale';

    let taskId = null;
    try { taskId = JSON.parse(editAnchor.getAttribute('data-params') || '{}').id || null; } catch (e) { /* keep null */ }
    const rec = writePendingIntent(Object.assign({ taskId }, intent));

    editAnchor.click();

    let inline = null;
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline && !inline) {
      await new Promise((r) => setTimeout(r, 250));
      if (!inline) inline = document.getElementById('saveTasksBtn');
    }

    if (inline) {
      clearPendingIntent(); // this tab owns the pick; a parallel new tab must not double-run
      await new Promise((r) => setTimeout(r, 2400)); // let Zoho hydrate the edit form
      await runInline();
      return;
    }

    // No inline form in this tab -> Zoho opened the edit in a NEW TAB: leave
    // the intent pending for that tab's boot consumer. Drop it if nothing
    // claims it within 50s (tab closed early / script error) so it can't
    // hijack a later manual edit of the same task.
    console.info('[TaskTK] no inline edit form; intent left for new-tab consumer', intent.kind);
    setTimeout(() => {
      const cur = readPendingIntent();
      if (cur && cur.id === rec.id && cur.status !== 'claimed') clearPendingIntent();
    }, 50 * 1000);
  }

  async function triggerEditAndPaste(entry, editAnchor, autoDate) {
    await dispatchEditPick(
      { kind: 'update', tpl: entry.tpl, rangeTitle: entry.rangeTitle || null, autoDate: autoDate || null },
      editAnchor,
      () => runInlineUpdate(entry, autoDate)
    );
  }

  // FLOW: set due date -> save
  async function setDueDateAndSave(option) {
    let saveBtn;
    try {
      saveBtn = await waitForElement('#saveTasksBtn');
    } catch (e) {
      alert('Edit form did not load. Try again.');
      return;
    }

    const field = document.querySelector('#Crm_Tasks_DUEDATE');
    if (!field) {
      alert('Could not find the Due Date field.');
      return;
    }

    const dateStr = formatZohoDate(computeDueDate(option), field);
    setDueDateField(field, dateStr);

    await new Promise((r) => setTimeout(r, 600));
    saveBtn.click();
    if (typeof showToast === 'function') showToast('✅ Due date set: ' + dateStr);
  }

  async function triggerEditAndSetDate(option, editAnchor) {
    await dispatchEditPick(
      { kind: 'dueDate', option: option },
      editAnchor,
      () => setDueDateAndSave(option)
    );
  }

  // Boot-time consumer: if THIS page hosts the pending task edit (i.e. Zoho
  // opened the edit in this new tab), apply the stored pick and save it.
  async function consumePendingIntent() {
    // Top frame only: Zoho mirrors the route in same-origin ghost iframes and
    // TM injects into each — a ghost frame with its own #saveTasksBtn must not
    // claim/apply the intent (verified 2026-09: 3 v2.13 boots across 2 frames).
    if (window.self !== window.top) return;
    const first = readPendingIntent();
    if (!first || first.status === 'claimed') return;
    // Only wait for the form when an intent is actually pending (new-tab case).
    let host = null;
    try { host = await waitForElement('#saveTasksBtn', 8000); } catch (e) { /* not an edit host */ }
    if (!host) return;
    const intent = readPendingIntent(); // re-read: may have been claimed/cleared meanwhile
    if (!intent || intent.status === 'claimed' || intent.id !== first.id) return;
    const m = /\/tab\/Tasks\/(\d+)/.exec(location.pathname);
    if (intent.taskId && m && m[1] !== String(intent.taskId)) return; // different task's edit page
    writePendingIntent(Object.assign({}, intent, { status: 'claimed' }));
    await new Promise((r) => setTimeout(r, 2400));
    if (intent.kind === 'update') {
      const text = await fillTemplate(intent.tpl, { rangeTitle: intent.rangeTitle || null });
      if (text !== null) await pasteAndSave(text, intent.autoDate || null);
    } else if (intent.kind === 'dueDate') {
      await setDueDateAndSave(intent.option);
    }
    clearPendingIntent();
  }

  // ---- popover menu builders ----
  function styleFlyout(flyout, minWidth) {
    Object.assign(flyout.style, {
      position: 'absolute',
      left: '100%',
      top: '0',
      display: 'none',
      background: '#fff',
      border: '1px solid #ddd',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      listStyle: 'none',
      margin: '0',
      padding: '4px 0',
      minWidth: minWidth,
      zIndex: '99999',
      maxHeight: '400px',
      overflowY: 'auto',
    });
  }

  function styleOption(el, leftPad) {
    Object.assign(el.style, {
      padding: `5px 14px 5px ${leftPad}`,
      fontSize: '13px',
      cursor: 'pointer',
      whiteSpace: 'nowrap',
    });
    el.addEventListener('mouseenter', () => (el.style.background = 'var(--ds-surface2,#f0f4ff)'));
    el.addEventListener('mouseleave', () => (el.style.background = ''));
  }

  // v2.12: pulsing amber glow for Task Update options whose due-date bump is
  // >= 1 day (see `due` in TASK_ACTIONS) — the clicker sees the day count
  // BEFORE clicking.
  function ensureAutoDateStyle() {
    if (document.getElementById('tm-auto-date-style')) return;
    const st = document.createElement('style');
    st.id = 'tm-auto-date-style';
    st.textContent = `
      .tm-auto-date {
        color: var(--ds-warn,#a16207);
        font-weight: 700;
        font-size: 11px;
        margin-left: 5px;
        animation: tmAutoGlow 1.6s ease-in-out infinite;
      }
      @keyframes tmAutoGlow {
        0%, 100% { text-shadow: 0 0 2px rgba(161,98,7,0.25); }
        50%      { text-shadow: 0 0 8px rgba(161,98,7,0.85); }
      }
    `;
    document.head.appendChild(st);
  }

  // Categorized submenu (Task Updates)
  function buildSubmenu(groupObj, onPick) {
    const wrap = document.createElement('li');
    wrap.className = 'moreOptValueList';
    wrap.style.position = 'relative';
    wrap.style.cursor = 'pointer';
    wrap.textContent = 'Task Update ▸';

    const flyout = document.createElement('ul');
    styleFlyout(flyout, '260px');
    ensureAutoDateStyle();

    for (const [category, items] of Object.entries(groupObj)) {
      const header = document.createElement('li');
      header.textContent = category;
      Object.assign(header.style, {
        padding: '4px 12px',
        fontWeight: 'bold',
        fontSize: '11px',
        color: '#888',
        textTransform: 'uppercase',
        cursor: 'default',
      });
      flyout.appendChild(header);

      for (const [label, entry] of Object.entries(items)) {
        const opt = document.createElement('li');
        const due = entry.due || null;
        // v2.12: show HOW MANY DAYS the due date moves (+N), not a generic
        // "auto-date" word. n=0 entries are skipped — the date doesn't actually
        // move, so a hint would make no sense (Jeyson 2026-08-25).
        if (due && due.n >= 1) {
          const dueStr = formatZohoDate(computeDueDate(due), document.querySelector('#Crm_Tasks_DUEDATE'));
          const unit = due.type === 'business' ? 'business day' : 'day';
          const badge = `⚡ +${due.n} ${unit}${due.n > 1 ? 's' : ''}`;
          opt.innerHTML = `<span style="color:var(--ds-warn,#a16207);">${label}</span><span class="tm-auto-date" title="Auto-sets due date to ${dueStr}">${badge}</span>`;
        } else {
          opt.textContent = label;
        }
        styleOption(opt, '20px');
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          onPick(entry, category, label);
        });
        flyout.appendChild(opt);
      }
    }

    wrap.appendChild(flyout);
    wrap.addEventListener('mouseenter', () => (flyout.style.display = 'block'));
    wrap.addEventListener('mouseleave', () => (flyout.style.display = 'none'));
    return wrap;
  }

  // Flat submenu (Due Date)
  function buildDueDateSubmenu(optionsObj, onPick) {
    const wrap = document.createElement('li');
    wrap.className = 'moreOptValueList';
    wrap.style.position = 'relative';
    wrap.style.cursor = 'pointer';
    wrap.textContent = 'Set Due Date ▸';

    const flyout = document.createElement('ul');
    styleFlyout(flyout, '160px');

    for (const [label, opt] of Object.entries(optionsObj)) {
      const item = document.createElement('li');
      item.textContent = label;
      styleOption(item, '14px');
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        onPick(opt);
      });
      flyout.appendChild(item);
    }

    wrap.appendChild(flyout);
    wrap.addEventListener('mouseenter', () => (flyout.style.display = 'block'));
    wrap.addEventListener('mouseleave', () => (flyout.style.display = 'none'));
    return wrap;
  }

  function injectPopoverMenus() {
    document.querySelectorAll('ul.moreOptValues').forEach((popoverUl) => {
      if (popoverUl.dataset.taskUpdateInjected) return;
      popoverUl.dataset.taskUpdateInjected = '1';

      const editAnchor = popoverUl.querySelector('a[data-cid="editbtn"]');
      if (!editAnchor) return;

      const submenu = buildSubmenu(TASK_ACTIONS, (entry, category, label) => {
        triggerEditAndPaste(entry, editAnchor, entry.due || null);
      });
      editAnchor.after(submenu);

      const dateMenu = buildDueDateSubmenu(DUE_DATE_OPTIONS, (opt) => {
        triggerEditAndSetDate(opt, editAnchor);
      });
      submenu.after(dateMenu);
    });
  }

  // ================================================================
  // WIDGET B — inline 📅▾ button beside the Due Date field
  // ================================================================
  function buildDueQuickFlyout(field) {
    const flyout = document.createElement('ul');
    Object.assign(flyout.style, {
      position: 'absolute',
      display: 'none',
      background: '#fff',
      border: '1px solid #ddd',
      boxShadow: '0 2px 8px rgba(0,0,0,0.15)',
      listStyle: 'none',
      margin: '0',
      padding: '4px 0',
      minWidth: '150px',
      zIndex: '99999',
      borderRadius: '4px',
    });

    for (const [label, opt] of Object.entries(DUE_DATE_OPTIONS)) {
      const item = document.createElement('li');
      item.textContent = label;
      Object.assign(item.style, {
        padding: '5px 14px',
        fontSize: '13px',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      });
      item.addEventListener('mouseenter', () => (item.style.background = '#f0f4ff'));
      item.addEventListener('mouseleave', () => (item.style.background = ''));
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        setDueDateField(field, formatZohoDate(computeDueDate(opt), field));
        flyout.style.display = 'none';
      });
      flyout.appendChild(item);
    }

    return flyout;
  }

  function positionDueQuickFlyout(flyout, anchor) {
    const rect = anchor.getBoundingClientRect();
    flyout.style.left = (rect.left + window.scrollX) + 'px';
    flyout.style.top = (rect.bottom + window.scrollY + 2) + 'px';
  }

  function injectDueQuickSet() {
    document.querySelectorAll('#Crm_Tasks_DUEDATE').forEach((field) => {
      if (field.dataset.dueQuickInjected) return;
      field.dataset.dueQuickInjected = '1';

      const btn = document.createElement('span');
      btn.textContent = '📅▾';
      btn.title = 'Quick-set due date';
      Object.assign(btn.style, {
        display: 'inline-block',
        verticalAlign: 'middle',
        marginLeft: '6px',
        padding: '1px 5px',
        fontSize: '12px',
        lineHeight: '17px',
        cursor: 'pointer',
        border: '1px solid #ccc',
        borderRadius: '3px',
        background: '#f7f7f7',
        userSelect: 'none',
      });
      btn.addEventListener('mouseenter', () => (btn.style.background = '#e9eefb'));
      btn.addEventListener('mouseleave', () => (btn.style.background = '#f7f7f7'));

      const flyout = buildDueQuickFlyout(field);
      document.body.appendChild(flyout);

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const showing = flyout.style.display === 'block';
        if (showing) {
          flyout.style.display = 'none';
        } else {
          positionDueQuickFlyout(flyout, btn);
          flyout.style.display = 'block';
        }
      });

      // Close on outside click
      document.addEventListener('click', (e) => {
        if (!flyout.contains(e.target) && e.target !== btn) {
          flyout.style.display = 'none';
        }
      });

      // Insert right after the field (mirrors the task_lookup icon pattern)
      field.parentNode.insertBefore(btn, field.nextSibling);
    });
  }

  // ================================================================
  // WIDGET C — subject template menu (glowing "Subject" label)
  // ================================================================
  function injectStyles() {
    if (document.getElementById('jx-subject-menu-styles')) return;
    const style = document.createElement('style');
    style.id = 'jx-subject-menu-styles';
    style.textContent = `
      .jx-subject-trigger {
        cursor: pointer !important;
        color: var(--ds-accent,var(--ds-accent,#1a73e8)) !important;
        text-shadow: 0 0 6px rgba(26,115,232,0.35);
        animation: jxPulse 1.8s ease-in-out infinite;
        border-bottom: 1px dashed rgba(26,115,232,0.6);
        transition: color .15s ease;
      }
      .jx-subject-trigger:hover {
        color: #0b47a1 !important;
        text-shadow: none;
      }
      @keyframes jxPulse {
        0%,100% { text-shadow: 0 0 3px rgba(26,115,232,0.25); }
        50%     { text-shadow: 0 0 8px rgba(26,115,232,0.55); }
      }

      .jx-menu-root {
        position: fixed;
        top: 0; left: 0;
        width: 0; height: 0;
        z-index: 2147483647;
        font-family: "Segoe UI", Roboto, Arial, sans-serif;
        font-size: 13px;
      }
      .jx-col {
        position: fixed;
        background: var(--ds-surface,#ffffff);
        border: 1px solid var(--ds-border,#dadce0);
        border-radius: 8px;
        box-shadow: 0 4px 18px rgba(60,64,67,0.20), 0 1px 3px rgba(60,64,67,0.12);
        max-height: 62vh;
        overflow-y: auto;
        min-width: 200px;
        max-width: 340px;
        padding: 4px 0;
      }
      .jx-col::-webkit-scrollbar { width: 8px; }
      .jx-col::-webkit-scrollbar-thumb { background: #c8ccd2; border-radius: 4px; }
      .jx-item {
        position: relative;
        padding: 7px 26px 7px 14px;
        color: var(--ds-text,#3c4043);
        cursor: pointer;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        border-left: 3px solid transparent;
      }
      .jx-item:not(.jx-leaf)::after {
        content: '\\203A';
        position: absolute;
        right: 11px;
        top: 50%;
        transform: translateY(-52%);
        color: #9aa0a6;
        font-size: 15px;
        line-height: 1;
      }
      .jx-item:hover, .jx-item.jx-active {
        background: #e8f0fe;
        color: #174ea6;
        border-left-color: var(--ds-accent,#1a73e8);
      }
      .jx-item:hover::after, .jx-item.jx-active::after { color: var(--ds-accent,#1a73e8); }
      .jx-item.jx-leaf { padding-right: 14px; }
      .jx-item.jx-leaf:hover, .jx-item.jx-leaf.jx-active {
        background: #e6f4ea;
        color: var(--ds-success,#137333);
        border-left-color: var(--ds-success,#1e8e3e);
      }
      .jx-header {
        padding: 6px 14px 8px;
        color: #80868b;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: .6px;
        border-bottom: 1px solid var(--ds-border,#e8eaed);
        margin-bottom: 4px;
      }
      .jx-toast {
        position: fixed;
        bottom: 24px; right: 24px;
        background: var(--ds-success,#1e8e3e);
        color: #fff;
        padding: 10px 16px;
        border-radius: 6px;
        font-family: "Segoe UI", Roboto, Arial, sans-serif;
        font-size: 13px;
        z-index: 2147483647;
        box-shadow: 0 6px 20px rgba(0,0,0,0.25);
        opacity: 0;
        transition: opacity .2s ease;
      }
      .jx-toast.jx-show { opacity: 1; }
    `;
    document.head.appendChild(style);
  }

  /* ============================================================
     MENU RENDERING
     ============================================================ */
  let menuRoot = null;

  function closeMenu() {
    if (menuRoot) {
      menuRoot.remove();
      menuRoot = null;
      document.removeEventListener('mousedown', outsideClick, true);
      document.removeEventListener('keydown', escClose, true);
      window.removeEventListener('scroll', closeMenu, true);
    }
  }

  function outsideClick(e) {
    if (menuRoot && !menuRoot.contains(e.target)) closeMenu();
  }

  function escClose(e) {
    if (e.key === 'Escape') closeMenu();
  }

  function buildColumn(headerText, entries, onPick, leaf) {
    const col = document.createElement('div');
    col.className = 'jx-col';

    const hdr = document.createElement('div');
    hdr.className = 'jx-header';
    hdr.textContent = headerText;
    col.appendChild(hdr);

    entries.forEach(function (label) {
      const isLeaf = typeof leaf === 'function' ? leaf(label) : !!leaf;
      const item = document.createElement('div');
      item.className = 'jx-item' + (isLeaf ? ' jx-leaf' : '');
      item.textContent = label;
      item.title = label;
      item.addEventListener('mouseenter', function () {
        Array.prototype.forEach.call(col.querySelectorAll('.jx-item'), function (n) {
          n.classList.remove('jx-active');
        });
        item.classList.add('jx-active');
        if (!isLeaf) onPick(label, item);
      });
      item.addEventListener('click', function (e) {
        e.stopPropagation();
        onPick(label, item);
      });
      col.appendChild(item);
    });

    return col;
  }

  function trimColumnsAfter(index) {
    while (menuRoot.children.length > index + 1) {
      menuRoot.removeChild(menuRoot.lastChild);
    }
  }

  /* ---- positioning: each column anchors to what spawned it ---- */

  function clampVertical(col, desiredTop) {
    const h = col.offsetHeight;
    let top = desiredTop;
    if (top + h > window.innerHeight - 12) top = window.innerHeight - h - 12;
    if (top < 8) top = 8;
    return top;
  }

  function positionRootColumn(col, anchorEl) {
    const r = anchorEl.getBoundingClientRect();
    const w = col.offsetWidth;
    let left = r.left;
    if (left + w > window.innerWidth - 12) left = Math.max(8, window.innerWidth - w - 12);
    col.style.left = left + 'px';
    col.style.top = clampVertical(col, r.bottom + 6) + 'px';
  }

  function positionSubColumn(col, parentCol, parentItem) {
    const pRect = parentCol.getBoundingClientRect();
    const iRect = parentItem.getBoundingClientRect();
    const hdr = col.querySelector('.jx-header');
    const hdrOffset = (hdr ? hdr.offsetHeight : 0) + 4;
    const w = col.offsetWidth;

    let left = pRect.right + 4;
    if (left + w > window.innerWidth - 12) {
      const flipped = pRect.left - w - 4;
      left = flipped >= 8 ? flipped : Math.max(8, window.innerWidth - w - 12);
    }

    col.style.left = left + 'px';
    col.style.top = clampVertical(col, iRect.top - hdrOffset) + 'px';
  }

  function openMenu(anchorEl) {
    closeMenu();
    injectStyles();

    menuRoot = document.createElement('div');
    menuRoot.className = 'jx-menu-root';
    document.body.appendChild(menuRoot);

    const pharmCol = buildColumn(
      'Pharmacy',
      Object.keys(TEMPLATES),
      function (pharmacy, pharmItem) {
        trimColumnsAfter(0);
        const medCol = buildColumn(
          pharmacy,
          Object.keys(TEMPLATES[pharmacy]),
          function (med, medItem) {
            const node = TEMPLATES[pharmacy][med];
            if (typeof node === 'string') {   // directly-clickable leaf
              insertSubject(node);
              closeMenu();
              return;
            }
            trimColumnsAfter(1);
            const varCol = buildColumn(
              med,
              Object.keys(node),
              function (variant) {
                insertSubject(node[variant]);
                closeMenu();
              },
              true
            );
            menuRoot.appendChild(varCol);
            positionSubColumn(varCol, medCol, medItem);
          },
          function (med) { return typeof TEMPLATES[pharmacy][med] === 'string'; }
        );
        menuRoot.appendChild(medCol);
        positionSubColumn(medCol, pharmCol, pharmItem);
      },
      false
    );

    menuRoot.appendChild(pharmCol);
    positionRootColumn(pharmCol, anchorEl);

    setTimeout(function () {
      document.addEventListener('mousedown', outsideClick, true);
      document.addEventListener('keydown', escClose, true);
      window.addEventListener('scroll', closeMenu, true);
    }, 0);
  }

  /* ============================================================
     INSERTION
     ============================================================ */
  // The subject input is exposed under different ids depending on the form
  // variant: #Crm_Tasks_SUBJECT on the Tasks-tab create page, #task_subject on
  // the older/quick-create panels. Resolve it from the field row the glowing
  // label lives in, then fall back to the known ids. (Clicking "Pharmacy K" used
  // to toast "Subject field not found" on the Tasks create page because only
  // #task_subject was queried — the field row is the reliable lookup.)
  function findSubjectInput() {
    const label = document.getElementById('Crm_Tasks_SUBJECT_label');
    const row = label && label.closest('[id^="Tasks_fldRow_SUBJECT"]');
    return (row && row.querySelector('input:not([type=hidden]), textarea'))
      || document.getElementById('Crm_Tasks_SUBJECT')
      || document.getElementById('task_subject');
  }

  function insertSubject(text) {
    const input = findSubjectInput();
    if (!input) {
      toast('Subject field not found', true);
      return;
    }

    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    setter.call(input, text);

    ['input', 'change', 'keyup', 'blur'].forEach(function (evt) {
      input.dispatchEvent(new Event(evt, { bubbles: true }));
    });

    input.focus();
    try { input.setSelectionRange(text.length, text.length); } catch(e) { console.warn('[TaskTK]', e); }

    const due = SUBJECT_DUE_DATES[text];
    if (due) {
      const dueField = document.getElementById('Crm_Tasks_DUEDATE');
      if (dueField) {
        setDueDateField(dueField, formatZohoDate(computeDueDate(due), dueField));
      } else {
        toast('Due date field not found', true);
      }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function (e) { console.warn('[TaskTK]', e); });
    }

    toast('Inserted: ' + text);
  }

  function toast(msg, isError) {
    const t = document.createElement('div');
    t.className = 'jx-toast';
    if (isError) t.style.background = 'var(--ds-danger,#c5221f)';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(function () { t.classList.add('jx-show'); });
    setTimeout(function () {
      t.classList.remove('jx-show');
      setTimeout(function () { t.remove(); }, 250);
    }, 2200);
  }

  /* ============================================================
     LABEL BINDING (handles Zoho's dynamic DOM)
     ============================================================ */
  function bindSubjectLabel() {
    const label = document.getElementById('Crm_Tasks_SUBJECT_label');
    if (!label || label.dataset.jxBound === '1') return;

    injectStyles();
    label.dataset.jxBound = '1';
    label.classList.add('jx-subject-trigger');
    label.title = 'Click to insert an order subject template';

    label.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (menuRoot) { closeMenu(); return; }
      openMenu(label);
    }, true);
  }

  // ================================================================
  // WIDGET D — Tasks LIST page: bulk-open the related Contacts (v3.2)
  // Two buttons docked in the top menu: "👥 Contacts" opens every unique
  // contact linked from the task rows on screen; "📝 No-desc" opens only the
  // contacts whose task Description cell is empty. Deduped by contact URL.
  // ponytail: harvests only RENDERED rows — if Zoho ever virtualizes long
  // lists, scroll/paginate first or switch to the CRM list API.
  // ================================================================
  const LIST_BAR_ID = 'ttkListBar';

  function isTaskListPage() {
    return /\/tab\/Tasks\/(custom-view\/\d+\/)?list\b/.test(location.pathname);
  }

  function harvestListRows() {
    const rows = [];
    document.querySelectorAll('lyte-exptable-tr[role=row]').forEach((r) => {
      const a = r.querySelector('a[href*="/tab/Contacts/"]');
      if (!a || !a.href) return; // header row, or a task with no related contact
      const cell = r.querySelector('.lv_data_desc');
      const desc = cell ? (cell.textContent || '').trim() : '';
      rows.push({ href: a.href, hasDesc: desc !== '' && desc !== '--' });
    });
    return rows;
  }

  function openContacts(rows) {
    const seen = new Set();
    let opened = 0, blocked = 0;
    for (const r of rows) {
      if (seen.has(r.href)) continue;
      seen.add(r.href);
      // synchronous window.open inside the click handler keeps the user gesture;
      // without the site popup permission, extras return null (blocked).
      if (window.open(r.href, '_blank')) opened++; else blocked++;
    }
    const uniq = seen.size;
    toast(
      blocked
        ? `Opened ${opened}/${uniq} — ${blocked} blocked. Allow pop-ups for crm.zoho.com (address-bar icon), then click again.`
        : `Opened ${opened} contact tab${opened === 1 ? '' : 's'} (${uniq} unique)`,
      blocked > 0
    );
  }

  function makeListBtn(id, label, title, onClick) {
    const b = document.createElement('button');
    b.id = id;
    b.textContent = label;
    b.title = title;
    Object.assign(b.style, {
      cursor: 'pointer', fontSize: '12px', fontWeight: 600,
      padding: '4px 10px', marginRight: '6px', borderRadius: '6px',
      border: '1px solid var(--ds-border,#ccc)',
      background: 'var(--ds-surface,#fff)', color: 'var(--ds-text,#333)',
    });
    b.addEventListener('mouseenter', () => (b.style.background = 'var(--ds-surface2,#eef3fb)'));
    b.addEventListener('mouseleave', () => (b.style.background = 'var(--ds-surface,#fff)'));
    b.addEventListener('click', onClick);
    return b;
  }

  function injectListButtons() {
    const existing = document.getElementById(LIST_BAR_ID);
    if (!isTaskListPage()) { if (existing) existing.remove(); return; }
    const host = document.querySelector('#crmNextGenTopMenu [data-zcqa="appTopMenuTitle"]')
      || document.querySelector('#crmNextGenTopMenu .flexAlignCenter')
      || document.querySelector('#crmNextGenTopMenu');
    if (!host) return;

    const rows = harvestListRows();
    const uniqAll = new Set(rows.map((r) => r.href)).size;
    const uniqNoDesc = new Set(rows.filter((r) => !r.hasDesc).map((r) => r.href)).size;

    if (!existing) {
      const bar = document.createElement('span');
      bar.id = LIST_BAR_ID;
      Object.assign(bar.style, { marginLeft: '14px', display: 'inline-flex', alignItems: 'center' });
      bar.appendChild(makeListBtn('ttkOpenAllContacts', '', 'Open one tab per unique contact linked from the visible task rows', function () {
        openContacts(harvestListRows());
      }));
      bar.appendChild(makeListBtn('ttkOpenNoDescContacts', '', 'Open only contacts whose task Description is empty', function () {
        openContacts(harvestListRows().filter((r) => !r.hasDesc));
      }));
      host.appendChild(bar);
    }
    // Change-guarded: assigning textContent ALWAYS mutates the DOM (replaces
    // the text node) even when the string is identical — unguarded, the
    // MutationObserver re-fires the injector forever and FREEZES the tab
    // (v3.2 live hang, 2026-07-29). Only write when the label actually changed.
    const all = document.getElementById('ttkOpenAllContacts');
    const nd = document.getElementById('ttkOpenNoDescContacts');
    const allLabel = `👥 Contacts (${uniqAll})`;
    const ndLabel = `📝 No-desc (${uniqNoDesc})`;
    if (all && all.textContent !== allLabel) all.textContent = allLabel;
    if (nd && nd.textContent !== ndLabel) nd.textContent = ndLabel;
  }

  // ================================================================
  // INJECTION — ONE observer, one guarded injector per widget, so a throw
  // in one widget cannot disable the other two.
  // ================================================================
  function runInjectors() {
    try { injectPopoverMenus(); } catch (e) { console.warn('[TaskTK] popover menus', e); }
    try { injectDueQuickSet(); } catch (e) { console.warn('[TaskTK] due quick-set', e); }
    try { bindSubjectLabel(); } catch (e) { console.warn('[TaskTK] subject label', e); }
    try { injectListButtons(); } catch (e) { console.warn('[TaskTK] list buttons', e); }
  }

  const observer = new MutationObserver(runInjectors);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Initial pass in case the elements are already present.
  runInjectors();
  // The subject label is re-rendered on route changes without childList
  // mutations on documentElement in some views — cheap poll as a backstop.
  setInterval(bindSubjectLabel, 1500);

  // New-tab host consumer: Zoho (2026-09) opens task edits in a new tab
  // (/tab/Tasks/<id>/edit); if this page is that host, apply the pending pick.
  consumePendingIntent();
})();
