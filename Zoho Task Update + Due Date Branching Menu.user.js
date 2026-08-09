// ==UserScript==
// @name         Zoho Task Update + Due Date Branching Menu
// @namespace    http://tampermonkey.net/
// @version      2.6
// @author       Jeyson Dagondon
// @description  Adds Task Update and Set Due Date branching menus to the Zoho task 3-dot popover
// @match        https://crm.zoho.com/*
// @grant        GM_getValue
// @grant        GM_setValue
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[TaskMenu v2.6] boot');
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}';
  document.documentElement.appendChild(__dsStyle);

(function () {
  'use strict';

  // ================================================================
  // BASIC HELPERS
  // ================================================================
  function getCurrentDate() {
    const now = new Date();
    return `${now.getMonth() + 1}/${now.getDate()}/${String(now.getFullYear()).slice(-2)}`;
  }

  function getOrPromptInitials() {
    let initials = GM_getValue('userInitials', null);
    if (!initials) {
      initials = prompt('Enter your initials (e.g. -JD, -HH):');
      if (initials) GM_setValue('userInitials', initials.trim().toUpperCase());
    }
    return initials || '';
  }

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function formatZohoDate(d) {
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }

  function isWeekend(d) {
    const day = d.getDay();
    return day === 0 || day === 6;
  }

  function rollForwardToWeekday(d) {
    while (isWeekend(d)) d.setDate(d.getDate() + 1);
    return d;
  }

  function computeDueDate(option) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    if (option.type === 'business') {
      let added = 0;
      while (added < option.n) {
        d.setDate(d.getDate() + 1);
        if (!isWeekend(d)) added++;
      }
    } else {
      d.setDate(d.getDate() + option.n);
      rollForwardToWeekday(d);
    }
    return d;
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

  // ================================================================
  // TASK UPDATE TEMPLATES
  // ================================================================
  const TASK_UPDATE_TEMPLATES = {
    "Payment & Admin": {
      "No payment yet": { tpl: `[date] no payment yet [initials]` },
      "No Nth payment yet": { tpl: `[date] no [ordinal] payment yet [initials]` },
      "PPW not yet signed": { tpl: `[date] PPW not yet signed [initials]` },
    },
    "Next Vial Confirmation": {
      "Sent SMS - can receive?": { tpl: `[date] sent sms if Pt can rcv [initials]` },
      "No reply from SMS yet": { tpl: `[date] no reply from sms yet [initials]` },
    },
    "Labs": {
      "No labs yet": { tpl: `[date] no labs yet [initials]` },
      "No labs yet - reminder triggered": { tpl: `[date] no labs yet, triggered the reminder automation [initials]` },
      "Still no labs": { tpl: `[date] still no labs [initials]` },
      "Partials are in": { tpl: `[date] partials are in [initials]` },
      "Labs on requisition ready": { tpl: `[date] labs still on requisition ready [initials]` },
      "Labs sent to Laura": { tpl: `[date] labs sent to Laura [initials]` },
      "Waiting for Laura's approval": { tpl: `[date] waiting for Laura's approval [initials]` },
      "Good to order": { tpl: `[date] Good to order [initials]` },
    },
    "Med Call": {
      "No show on med call": { tpl: `[date] no show on med call [initials]` },
      "Check for updates": { tpl: `[date] check sms, notes, GHL, email for updates [initials]` },
    },
    "Refills": {
      "Refill - sent SMS": { tpl: `[date] sent sms if pt wants a refill [initials]` },
      "Refill - with management plan": { tpl: `[date] sent sms if pt wants a refill, with management plan [initials]` },
      "Refill - eligible for new Rx": { tpl: `[date] sent sms if pt wants a refill, eligible for new rx [initials]` },
      "Continue - needs new plan": { tpl: `[date] sent sms if pt wants to continue, pt need to purchase new plan [initials]` },
    },
    "Shipping": {
      "Ship on/within date range": {
        tpl: `[date] need to be ship on/within [daterange] [initials]`,
        rangeTitle: 'Ship on/within',
      },
      "Pt out of town": {
        tpl: `[date] Pt will be out of town on [daterange] [initials]`,
        rangeTitle: 'Patient out of town',
      },
    },
  };

  // ================================================================
  // DUE DATE OPTIONS
  // ================================================================
  const DUE_DATE_OPTIONS = {
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
  // FLOW: click Edit -> prompt -> paste -> save
  // ================================================================
  async function pasteAndSave(text) {
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

    await new Promise((r) => setTimeout(r, 600));
    saveBtn.click();
    if (typeof showToast === 'function') showToast('✅ Task update saved');
  }

  async function triggerEditAndPaste(entry, editAnchor) {
    const oldBox = document.querySelector('#Crm_Tasks_DESCRIPTION');
    if (oldBox) oldBox.id = 'Crm_Tasks_DESCRIPTION_stale';

    editAnchor.click();

    try {
      await waitForElement('#saveTasksBtn');
    } catch (e) {
      alert('Edit form did not load. Try again.');
      return;
    }
    await new Promise((r) => setTimeout(r, 2400));

    const text = await fillTemplate(entry.tpl, entry);
    if (text === null) return; // cancelled; form stays open for manual close

    await pasteAndSave(text);
  }

  // ================================================================
  // FLOW: set due date -> save
  // ================================================================
  async function setDueDateAndSave(option) {
    const dateStr = formatZohoDate(computeDueDate(option));

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

    field.focus();
    field.value = dateStr;
    field.setAttribute('aria-valuenow', dateStr);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.dispatchEvent(new Event('blur', { bubbles: true }));

    await new Promise((r) => setTimeout(r, 600));
    saveBtn.click();
    if (typeof showToast === 'function') showToast('✅ Due date set: ' + dateStr);
  }

  function triggerEditAndSetDate(option, editAnchor) {
    const oldField = document.querySelector('#Crm_Tasks_DUEDATE');
    if (oldField) oldField.id = 'Crm_Tasks_DUEDATE_stale';
    editAnchor.click();
    setTimeout(() => setDueDateAndSave(option), 2400);
  }

  // ================================================================
  // MENU BUILDERS
  // ================================================================
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

  // Categorized submenu (Task Updates)
  function buildSubmenu(groupObj, onPick) {
    const wrap = document.createElement('li');
    wrap.className = 'moreOptValueList';
    wrap.style.position = 'relative';
    wrap.style.cursor = 'pointer';
    wrap.textContent = 'Task Update ▸';

    const flyout = document.createElement('ul');
    styleFlyout(flyout, '260px');

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
        opt.textContent = label;
        styleOption(opt, '20px');
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          onPick(entry);
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

  // ================================================================
  // INJECTION
  // ================================================================
  function injectIntoPopover(popoverUl) {
    if (popoverUl.dataset.taskUpdateInjected) return;
    popoverUl.dataset.taskUpdateInjected = '1';

    const editAnchor = popoverUl.querySelector('a[data-cid="editbtn"]');
    if (!editAnchor) return;

    const submenu = buildSubmenu(TASK_UPDATE_TEMPLATES, (entry) => {
      triggerEditAndPaste(entry, editAnchor);
    });
    editAnchor.after(submenu);

    const dateMenu = buildDueDateSubmenu(DUE_DATE_OPTIONS, (opt) => {
      triggerEditAndSetDate(opt, editAnchor);
    });
    submenu.after(dateMenu);
  }

  const popoverObserver = new MutationObserver(() => {
    document
      .querySelectorAll('ul.moreOptValues')
      .forEach((ul) => injectIntoPopover(ul));
  });
  popoverObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });
})();