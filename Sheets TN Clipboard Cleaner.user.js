// ==UserScript==
// @name         Sheets TN Clipboard Cleaner
// @namespace    jeyson.pharmacy.tools
// @version      1.6
// @author       Jeyson Dagondon
// @description  Strips TSV quote-wrapping from copied cells containing TN: for clean pastes
// @match        https://docs.google.com/spreadsheets/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[SheetsClean v1.6] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['SheetsClean'] = { name: 'Sheets TN Clipboard Cleaner', version: '1.6', state: 'idle', message: 'Loaded', output: null, error: null, lastActivity: Date.now(), trigger: null };
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}';
  document.documentElement.appendChild(__dsStyle);

(function () {
  'use strict';

  function cleanTSV(text) {
    let t = text.replace(/\r\n/g, '\n');

    // Sheets sometimes appends a single trailing newline on a single-cell copy
    if (t.endsWith('\n')) t = t.slice(0, -1);

    // Unwrap TSV field quoting: "..." with internal "" -> "
    if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
      t = t.slice(1, -1).replace(/""/g, '"');
    }
    return t;
  }

  function toast(msg) {
    const el = document.createElement('div');
    el.textContent = msg;
    el.style.cssText = [
      'position:fixed', 'bottom:24px', 'right:24px', 'z-index:999999',
      'background:var(--ds-success,#1e7e34)', 'color:#fff', 'padding:8px 14px',
      'border-radius:6px', 'font:13px/1.4 Arial,sans-serif',
      'box-shadow:0 2px 8px rgba(0,0,0,.25)', 'opacity:0',
      'transition:opacity .15s ease'
    ].join(';');
    document.body.appendChild(el);
    requestAnimationFrame(() => { el.style.opacity = '1'; });
    setTimeout(() => {
      el.style.opacity = '0';
      setTimeout(() => el.remove(), 200);
    }, 900);
  }

  document.addEventListener('copy', () => {
    // Let Sheets finish writing its own clipboard payload first
    setTimeout(async () => {
      try {
        const raw = await navigator.clipboard.readText();
        if (!raw || raw.indexOf('TN:') === -1) return;

        const cleaned = cleanTSV(raw);
        if (cleaned !== raw) {
          await navigator.clipboard.writeText(cleaned);
          toast('✓ Copied clean (no quotes)');
        }
      } catch (err) {
        // readText/writeText can throw if focus/permission is off; fail silently
        // so normal copying is never broken.
        console.debug('[TN Cleaner] skipped:', err.message);
      }
    }, 50);
  }, true);

})();