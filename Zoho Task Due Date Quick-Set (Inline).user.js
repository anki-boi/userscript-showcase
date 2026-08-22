// ==UserScript==
// @name         Zoho Task Due Date Quick-Set (Inline)
// @namespace    http://tampermonkey.net/
// @version      1.3
// @author       Jeyson Dagondon
// @description  Inline button beside the Due Date field to set N days/weeks ahead
// @match        https://crm.zoho.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[DueDateQS v1.3] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['DueDateQS'] = { name: 'Zoho Task Due Date Quick-Set (Inline)', version: '1.3', state: 'idle', message: 'Loaded', output: null, error: null, lastActivity: Date.now(), trigger: null };

(function () {
  'use strict';

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

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

  function formatZohoDate(d) {
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }

  function setDueDateField(field, dateStr) {
    field.focus();
    field.value = dateStr;
    field.setAttribute('aria-valuenow', dateStr);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  // ================================================================
  // MENU BUILDING
  // ================================================================
  function buildFlyout(field) {
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
        setDueDateField(field, formatZohoDate(computeDueDate(opt)));
        flyout.style.display = 'none';
      });
      flyout.appendChild(item);
    }

    return flyout;
  }

  function positionFlyout(flyout, anchor) {
    const rect = anchor.getBoundingClientRect();
    flyout.style.left = (rect.left + window.scrollX) + 'px';
    flyout.style.top = (rect.bottom + window.scrollY + 2) + 'px';
  }

  // ================================================================
  // INJECTION
  // ================================================================
  function injectButton(field) {
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

    const flyout = buildFlyout(field);
    document.body.appendChild(flyout);

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const showing = flyout.style.display === 'block';
      if (showing) {
        flyout.style.display = 'none';
      } else {
        positionFlyout(flyout, btn);
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
  }

  const observer = new MutationObserver(() => {
    document
      .querySelectorAll('#Crm_Tasks_DUEDATE')
      .forEach((field) => injectButton(field));
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  // Initial pass in case the field is already present
  document
    .querySelectorAll('#Crm_Tasks_DUEDATE')
    .forEach((field) => injectButton(field));
})();