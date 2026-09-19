// ==UserScript==
// @name         Zoho CRM — Subject Template Branching Menu
// @namespace    jeyson.rx.tools
// @version      1.1.11
// @author       Jeyson Dagondon
// @description  Click the glowing "Subject" label to insert order/lab subject lines
// @match        *://crm.zoho.com/*
// @match        *://*.zoho.com/crm/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[SubjectBranch v1.1.11] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['SubjectBranch'] = { name: 'Zoho CRM — Subject Template Branching Menu', version: '1.1.10', state: 'idle', message: 'Loaded', output: null, error: null, lastActivity: Date.now(), trigger: null };
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}';
  document.documentElement.appendChild(__dsStyle);

(function () {
  'use strict';

  /* ============================================================
     TEMPLATE TREE
     Pharmacy -> Medication -> [Variant Label, Subject String]
     Output format: Order [Medication] (Quantity / Duration)
     ============================================================ */
  const TEMPLATES = {
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

  /* Subject lines that also stamp a due date on the create form.
     Value: 'followingMonday' (next Monday strictly after today — FU BPR only)
     or { weeks: N } → the EXACT date N weeks from today (no Monday snap). */
  const SUBJECT_DUE_DATES = {
    'FU BPR': 'followingMonday',
    'Order CJC/IPA (1 vial / 2 months)': { weeks: 6 },
    'Order RxFlow-Specific Labs for Tesa/IPA': { weeks: 12 },
    'Order 3 months Tesa/IPA': { weeks: 12 }
  };

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function formatZohoDate(d) {
    return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
  }

  // The next Monday strictly after `from` (if `from` is a Monday → +7).
  function followingMonday(from) {
    const d = from ? new Date(from.getTime()) : new Date();
    d.setHours(0, 0, 0, 0);
    let delta = (1 - d.getDay() + 7) % 7; // 0 when today is Monday
    if (delta === 0) delta = 7;
    d.setDate(d.getDate() + delta);
    return d;
  }



  // Same injection technique as Zoho Task Due Date Quick-Set (Inline):
  // the 'change' event fires the field's inline quickTask.handleDuedateChange().
  function setDueDateField(field, dateStr) {
    field.focus();
    field.value = dateStr;
    field.setAttribute('aria-valuenow', dateStr);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('change', { bubbles: true }));
    field.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  /* ============================================================
     STYLES — light theme
     ============================================================ */
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
  function insertSubject(text) {
    const input = document.getElementById('task_subject');
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
    try { input.setSelectionRange(text.length, text.length); } catch(e) { console.warn('[SubjectBranch]', e); }

    const due = SUBJECT_DUE_DATES[text];
    if (due) {
      const dueField = document.getElementById('Crm_Tasks_DUEDATE');
      let dueDate;
      if (due && typeof due === 'object') {
        dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + (due.weeks || 0) * 7);
      } else {
        dueDate = followingMonday();
      }
      if (dueField) {
        setDueDateField(dueField, formatZohoDate(dueDate));
      } else {
        toast('Due date field not found', true);
      }
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(function (e) { console.warn('[SubjectBranch]', e); });
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
  function bindLabel() {
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

  const observer = new MutationObserver(function () { bindLabel(); });
  observer.observe(document.documentElement, { childList: true, subtree: true });

  bindLabel();
  setInterval(bindLabel, 1500);
})();