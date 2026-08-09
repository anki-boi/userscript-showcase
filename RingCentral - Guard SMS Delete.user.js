// ==UserScript==
// @name         RingCentral - Guard SMS Delete
// @namespace    jeyson.rc.tools
// @version      1.3
// @author       Jeyson Dagondon
// @description  Confirm-gates or hides the per-conversation Delete in RingCentral's 3-dot menu
// @match        https://app.ringcentral.com/*
// @match        https://*.ringcentral.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[RC-Guard v1.3] boot');

(function () {
  'use strict';

  // ── SETTINGS ──────────────────────────────────────────────
  // 'hide'    = Delete item removed from the menu entirely (safest).
  // 'confirm' = Delete stays visible but asks before firing.
  const MODE = 'hide';
  // ──────────────────────────────────────────────────────────

  const DELETE_ID = 'sms-delete-button';

  if (MODE === 'hide') {
    const css = `
      li[data-test-automation-id="${DELETE_ID}"] {
        display: none !important;
      }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    // document-start means <head> may not exist yet; append when ready.
    (document.head || document.documentElement).appendChild(style);
  }

  if (MODE === 'confirm') {
    document.addEventListener(
      'click',
      function (e) {
        const item = e.target.closest(`li[data-test-automation-id="${DELETE_ID}"]`);
        if (!item) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (confirm('Delete this conversation? This cannot be undone.')) {
          // User confirmed: re-fire without the guard.
          item.removeAttribute('data-guarded');
          const clone = item.cloneNode(true);
          item.replaceWith(clone);
          clone.click();
        }
        return false;
      },
      true // capture phase — beats RC's own handler
    );
  }
})();