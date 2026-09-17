// ==UserScript==
// @name         Zoho CRM Auto-Expand Textareas on Focus
// @namespace    userscript-showcase
// @version      3.4
// @author       Jeyson Dagondon
// @description  Auto-expands textareas to full content height on focus, input, or value change
// @match        https://*.zoho.com/*
// @match        https://*.zohocrm.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[AutoExpand v3.4] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['AutoExpand'] = { name: 'Zoho CRM Auto-Expand Textareas on Focus', version: '3.4', state: 'idle', message: 'Loaded', output: null, error: null, lastActivity: Date.now(), trigger: null };

(function () {
  'use strict';

  const MIN_HEIGHT = 60;

  // Full measurement resize — uses height:auto to get true scrollHeight
  function resize(textarea) {
    textarea.style.transition = 'none';
    textarea.style.height = 'auto';
    const target = Math.max(textarea.scrollHeight + 4, MIN_HEIGHT);
    textarea.style.height = target + 'px';
    textarea.style.maxHeight = 'none';
    textarea.style.overflow = 'hidden';
    textarea.dataset.expandTarget = target; // cache for reapply

    const lyteInput = textarea.closest('lyte-input');
    if (lyteInput) {
      lyteInput.style.transition = 'none';
      lyteInput.style.height = 'auto';
    }
  }

  // Quick reapply — no height:auto step, so no flash
  function reapply(textarea) {
    const target = textarea.dataset.expandTarget;
    if (!target) return;
    textarea.style.height = target + 'px';
    textarea.style.maxHeight = 'none';
    textarea.style.overflow = 'hidden';
    const lyteInput = textarea.closest('lyte-input');
    if (lyteInput) lyteInput.style.height = 'auto';
  }

  // Focus — synchronous, same as your original
  document.addEventListener('focusin', (e) => {
    if (e.target.tagName === 'TEXTAREA') resize(e.target);
  }, true);

  // MutationObserver — catches Zoho resetting height on focused textareas
  // Only fires reapply (no flash) when height drifts from our target
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.attributeName !== 'style') continue;
      const el = m.target;

      // Textarea itself got resized by Zoho
      if (el.tagName === 'TEXTAREA' && el === document.activeElement && el.dataset.expandTarget) {
        const current = parseInt(el.style.height) || 0;
        const target = parseInt(el.dataset.expandTarget) || 0;
        if (Math.abs(current - target) > 2) reapply(el);
      }

      // Parent lyte-input container got its height reset
      if (el.localName === 'lyte-input') {
        const ta = el.querySelector('textarea');
        if (ta && ta === document.activeElement && ta.dataset.expandTarget) reapply(ta);
      }
    }
  });
  obs.observe(document.body, { attributes: true, attributeFilter: ['style'], subtree: true });

  // Input — covers typing
  document.addEventListener('input', (e) => {
    if (e.target.tagName === 'TEXTAREA') resize(e.target);
  }, true);

  // Programmatic .value = "..." — covers template insertion
  const desc = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  if (desc && desc.set) {
    Object.defineProperty(HTMLTextAreaElement.prototype, 'value', {
      get: desc.get,
      set: function (val) {
        desc.set.call(this, val);
        resize(this);
      },
      configurable: true,
    });
  }
})();