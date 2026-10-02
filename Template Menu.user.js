// ==UserScript==
// @name         Template Menu
// @namespace    http://tampermonkey.net/
// @version      6.33
// @description  Cascading template quick-insert menu: live preview, search, recent tracking
// @author       Jeyson Dagondon
// FROZEN GOLDEN REFERENCE (2026-09-27) — do not reinstall, do not maintain.
//   The unified menu now vendors its chrome from src/zoho/unified-menu/chrome.js
//   (SPEC Wave 6), so this file is no longer a build dependency. It stays in the
//   repo because the golden gate needs the ORIGINAL literals to diff rendered text
//   against, and harvest/extract.js re-reads them to audit the bank. Its own v6.33
//   fixes live in the vendored chrome; this file keeps them only as provenance.
//   It still carries the sandboxed-window __scripts limitation the unified script
//   documents in chrome.js — harmless, because it is never installed.
// @match        https://crm.zoho.com/crm/*/tab/Contacts/*
// @match        https://crm.zoho.com/crm/*/tab/CustomModule27/*
// @match        https://crm.zoho.com/crm/*/tab/Tasks/*
// @match        https://crm.zoho.com/crm/*/tab/CustomModule32/*
// @grant        GM_addStyle
// @grant        GM_setClipboard
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// v6.33: @all_frames REMOVED. init() and createSearchBox() both bailed on
//   `window !== window.top`, so every iframe copy of this script did nothing
//   except parse the 170KB tree literal, deep-clone it, and park three
//   document-wide MutationObservers. Top-frame-only is what the code already
//   did; now it is also what Tampermonkey injects.
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[TMenu v6.33] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['TMenu'] = { name: 'Template Menu', version: '6.33', state: 'idle', message: 'Loaded', output: null, error: null, lastActivity: Date.now(), trigger: null };
// v6.33 (2026-09-27) — IDLE COST, not behavior. Zoho detail pages emit mutation
//   batches constantly and the tab count is high, so the tax was:
//   - top-frame gate + @all_frames removed (iframes built the whole tree for nothing)
//   - rebuildTemplates() no longer deep-clones the tree when there are no overrides
//   - isRecentPath(): one cached GM read instead of one per leaf rendered
//   - the search index stores lowercase label/text once instead of lower-casing
//     every leaf's whole block on every keystroke (~1 MB of churn per keystroke)
//   - search input re-renders at most once per frame, and not at all when the
//     trimmed query did not change
//   - the FAB and anchor observers are debounced (250ms trailing) and their idle
//     path is an O(1) isConnected / URL check instead of document-wide selectors
//     (the anchor one also bails on non-anchor pages, where there is no field)
//   - mouseover/mousedown document listeners exist only while the menu is open
//   - createSearchBox() no longer stacks a resize listener every time it rebuilds
//   Menu behavior, DOM, and every template string are unchanged.
// v6.32 (2026-09-25) — the Pharmacy K branch's order blocks DROP the "Order #"
//   placeholder line (Jeyson). It was dead weight: the order number is typed
//   into the Zoho order, and no parser reads the line (RxSMS keys off
//   "Products Ordered:" + "Medication:"). Template text only — every drug,
//   dose, frequency and duration line is byte-identical to v6.31.
// v6.31 (2026-09-25) — Pharmacy L MOTS-C + NAD+ (both in the Pharmacy L branch only):
//   - "[BLRX] MOTS-C injectable (20 mg/mL)" DELETED (Pharmacy L retired the
//     concentration) and the surviving 10 mg/mL product renamed
//     "[BLRX] MOTS-C injectable" — 2 vials = 2.5 months, 4 vials = 5 months.
//   - "[BLRX] NAD+ injectable" is 200 mg/mL in a 5 mL vial at 40 units
//     (0.4 mL = 80 mg): same 80 mg dose, same 1000 mg per vial, so the
//     1/2/3 Month tiers are unchanged. Pharmacy A + Greenwich NAD+ stay 100 mg/mL.

// The Claude prompt used to audit/rebalance peptide stack order templates is
// maintained outside this repo (not part of this script).

(function () {
  'use strict';
  try {
  // v6.33 perf: one frame, one copy of this script. Everything below (the
  // ~1,200-leaf tree literal, its override clone, the GM storage reads, the
  // three observers, the document listeners) is top-frame work only — the
  // entry points already refused to run in iframes; this stops them being
  // built there at all.
  if (window !== window.top) return;

function getCurrentDate() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver',
    month: 'numeric',
    day: 'numeric',
    year: '2-digit'
  }).formatToParts(now);
  const month = parts.find(p => p.type === 'month').value;
  const day = parts.find(p => p.type === 'day').value;
  const year = parts.find(p => p.type === 'year').value;
  return `${month}/${day}/${year}`;
}

function getOrPromptInitials() {
  let initials = GM_getValue('userInitials', null);
  if (!initials) {
    initials = prompt('Enter your initials (e.g. -JD, -HH):');
    if (initials) GM_setValue('userInitials', initials.trim().toUpperCase());
  }
  return initials || '';
}

function changeInitials() {
  const current = GM_getValue('userInitials', '');
  const newVal = prompt('Enter your initials with hyphen (e.g. -JD, -HH):', current);
  if (newVal) {
    GM_setValue('userInitials', newVal.trim());
    if (typeof showToast === 'function') {
      showToast('✅ Initials saved: ' + GM_getValue('userInitials', ''));
    } else {
      alert('Initials saved: ' + GM_getValue('userInitials', ''));
    }
  }
}

// Register in the Tampermonkey dropdown (click the extension icon → this script)
GM_registerMenuCommand('Change My Initials', changeInitials);

// ============================================================
// DATE & INITIALS REPLACER
// Merged from the standalone "Date & Initials Replacer" script
// (2026-08-04). The buttons live in a row under the anchored
// search box on Tasks/CustomModule32; template inserts already
// replace [date]/[initials] tokens themselves (see
// handleTemplateClick) — these actions cover the MANUAL case.
// Single source of truth for initials = the same GM 'userInitials'
// value the insert path uses (may include a leading hyphen).
// ============================================================

function getBareInitials() {
  const stored = (GM_getValue('userInitials', '') || '').trim();
  return stored.replace(/^-/, '');
}

function insertAtCaret(el, text) {
  const start = el.selectionStart, end = el.selectionEnd;
  el.value = el.value.substring(0, start) + text + el.value.substring(end);
  const pos = start + text.length;
  el.setSelectionRange(pos, pos);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function replaceToken(el, token, replacement) {
  if (!el.value.includes(token)) return false;
  el.value = el.value.split(token).join(replacement);
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

function applyReplacerAction(kind) {
  const el = findFieldEl();
  if (!el || !document.body.contains(el)) { showToast('⚠️ No target field found'); return; }
  const isText = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && el.type === 'text');
  if (!isText) { showToast('⚠️ Target field is not a text field'); return; }
  el.focus();
  if (kind === 'date') {
    if (el.value.includes('[date]')) replaceToken(el, '[date]', getCurrentDate());
    else insertAtCaret(el, getCurrentDate());
  } else if (kind === 'initials') {
    const bare = getBareInitials();
    if (!bare) { showToast('⚠️ Set your initials first: Tampermonkey menu → Change My Initials'); return; }
    if (el.value.includes('[initials]')) replaceToken(el, '[initials]', bare);
    else insertAtCaret(el, ' -' + bare);
  } else if (kind === 'linebreak') {
    insertAtCaret(el, '\n\n');
  }
}

  // ============================================================
  // SECTION 1: TEMPLATE DATA
  // ============================================================
const DEFAULT_TEMPLATES = {
    // ================================================================
    // PHARMACY J
    // ================================================================
    "Pharmacy J": {
      "Tesofensine Pill +L +C": {
        "1 Month / 30 pills":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 30 Tesofensine 500mcg
Dosing: 1 pill
Frequency: Daily
Estimated Duration: 4 weeks`,
        "3 Months / 90 pills":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 90 Tesofensine 500mcg
Dosing: 1 pill
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      "5-Amino-1MQ Pill +L": {
        "1 Month / 30 pills":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 30 5-Amino-1MQ 50mg
Dosing: 1 pill (can increase to 2-3/day)
Frequency: Daily
Estimated Duration: 4 weeks`,
        "3 Months / 90 pills":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 90 5-Amino-1MQ 50mg
Dosing: 1 pill (can increase to 2-3/day)
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      "BPC Pill": {
        "1 Month / 30 pills":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 30 BPC 500mcg
Dosing: 1 pill on empty stomach
Frequency: Daily
Estimated Duration: 4 weeks`,
        "3 Months / 90 pills":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 90 BPC 500mcg
Dosing: 1 pill on empty stomach
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      "BPC/KPV Pill": {
        "1 Month / 30 pills":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 30 BPC/KPV 500/500mcg
Dosing: 1 pill on empty stomach
Frequency: Daily
Estimated Duration: 4 weeks`,
        "2 Months / 60 pills":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 60 BPC/KPV 500/500mcg
Dosing: 2 pills on empty stomach
Frequency: Daily
Estimated Duration: 4 weeks`,
        "3 Months / 90 pills (1/day)":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 90 BPC/KPV 500/500mcg
Dosing: 1 pill on empty stomach
Frequency: Daily
Estimated Duration: 12 weeks`,
        "3 Months / 180 pills (2/day)":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 180 BPC/KPV 500/500mcg
Dosing: 2 pills on empty stomach
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      "Dihexa Pill": {
        "1 Month / 30 pills":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 30 Dihexa 20mg
Dosing: 1 pill
Frequency: Daily
Estimated Duration: 4 weeks`,
        "3 Months / 90 pills":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 90 Dihexa 20mg
Dosing: 1 pill
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      "GHK-Cu Cream": {
        "1 Month / 1 bottle":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 1 bottle GHK-Cu cream
Dosing: 1 pea-sized amount for face, 1 pea-sized amount for neck
Frequency: Daily
Estimated Duration: 4 weeks`,
        "3 Months / 3 bottles":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 3 bottles GHK-Cu cream
Dosing: 1 pea-sized amount for face, 1 pea-sized amount for neck
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      "GHK-Cu / Argireline / Leuphasyl Cream": {
        "1 Month / 1 bottle (30gm)":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 1 bottle GHK-Cu/Argireline/Leuphasyl 0.2%/0.5%/3% cream 30gm
Dosing: 1 pea-sized amount for face, 1 pea-sized amount for neck (not for full body use)
Frequency: Morning and/or evening, daily
Estimated Duration: 4 weeks`,
        "3 Months / 3 bottles (30gm each)":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 3 bottles GHK-Cu/Argireline/Leuphasyl 0.2%/0.5%/3% cream 30gm each
Dosing: 1 pea-sized amount for face, 1 pea-sized amount for neck (not for full body use)
Frequency: Morning and/or evening, daily
Estimated Duration: 12 weeks`,
      },
      "Semax Nasal Spray": {
        "1 Month / 1 bottle":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 1 Semax Nasal Spray 7.5mg/ml 6mL
Dosing: 1 spray per nostril
Frequency: Daily up to 3x/day
Estimated Duration: 4 weeks`,
        "3 Months / 3 bottles":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 3 Semax Nasal Spray 7.5mg/ml 6mL
Dosing: 1 spray per nostril
Frequency: Daily up to 3x/day
Estimated Duration: 12 weeks`,
      },
      "Selank Nasal Spray": {
        "1 Month / 1 bottle":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 1 Selank Nasal Spray 7.5mg/ml 6mL
Dosing: 1 spray per nostril
Frequency: Daily up to 3x/day
Estimated Duration: 4 weeks`,
        "3 Months / 3 bottles":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 3 Selank Nasal Spray 7.5mg/ml 6mL
Dosing: 1 spray per nostril
Frequency: Daily up to 3x/day
Estimated Duration: 12 weeks`,
      },
"SLU-PP-332": {
        "New Patient - 1 Month / 14x100mcg + 18x200mcg":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 14 SLU-PP-332 100mcg
Dosing: 1 capsule
Frequency: Once daily
Estimated Duration: 2 weeks

[date] (Pharmacy J) [initials]
Medication: 18 SLU-PP-332 200mcg
Dosing:
- After finishing 100mcg: 1 capsule for 2 weeks
- Onwards: 2 capsules (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: Rest of 1 month`,
        "New Patient - 6 Weeks / 14x100mcg + 42x200mcg":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 14 SLU-PP-332 100mcg
Dosing: 1 capsule
Frequency: Once daily
Estimated Duration: 2 weeks

[date] (Pharmacy J) [initials]
Medication: 42 SLU-PP-332 200mcg
Dosing:
- After finishing 100mcg: 1 capsule for 2 weeks
- Onwards: 2 capsules (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: Rest of 6 weeks`,
        "New Patient - 2 Months / 14x100mcg + 78x200mcg":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 14 SLU-PP-332 100mcg
Dosing: 1 capsule
Frequency: Once daily
Estimated Duration: 2 weeks

[date] (Pharmacy J) [initials]
Medication: 78 SLU-PP-332 200mcg
Dosing:
- After finishing 100mcg: 1 capsule for 2 weeks
- Onwards: 2 capsules (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: Rest of 2 months`,
        "New Patient - 3 Months / 14x100mcg + 138x200mcg":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 14 SLU-PP-332 100mcg
Dosing: 1 capsule
Frequency: Once daily
Estimated Duration: 2 weeks

[date] (Pharmacy J) [initials]
Medication: 138 SLU-PP-332 200mcg
Dosing:
- After finishing 100mcg: 1 capsule for 2 weeks
- Onwards: 2 capsules (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: Rest of 3 months`,
        "New Patient - 6 Months / 14x100mcg + 318x200mcg":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 14 SLU-PP-332 100mcg
Dosing: 1 capsule
Frequency: Once daily
Estimated Duration: 2 weeks

[date] (Pharmacy J) [initials]
Medication: 318 SLU-PP-332 200mcg
Dosing:
- After finishing 100mcg: 1 capsule for 2 weeks
- Onwards: 2 capsules (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: Rest of 6 months`,
        "Refill - 1 Month / 60x200mcg (2/day)":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 60 SLU-PP-332 200mcg
Dosing: 2 capsules (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 4 weeks`,
        "Refill - 3 Months / 180x200mcg (2/day)":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 180 SLU-PP-332 200mcg
Dosing: 2 capsules (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      "AOD Troche": {
        "6 Weeks / 42 troches":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 42 AOD 600mcg
Dosing: Dissolve 1 troche between cheek and gum. No food 2 hours before or after.
Frequency: Daily
Estimated Duration: 6 weeks`,
        "1 Month / 30 troches":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 30 AOD 600mcg
Dosing: Dissolve 1 troche between cheek and gum. No food 2 hours before or after.
Frequency: Daily
Estimated Duration: 4 weeks`,
        "2 Months / 60 troches":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 60 AOD 600mcg
Dosing: Dissolve 1 troche between cheek and gum. No food 2 hours before or after.
Frequency: Daily
Estimated Duration: 8 weeks`,
        "3 Months / 90 troches":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 90 AOD 600mcg
Dosing: Dissolve 1 troche between cheek and gum. No food 2 hours before or after.
Frequency: Daily
Estimated Duration: 12 weeks`,
        "6 Months / 180 troches":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 180 AOD 600mcg
Dosing: Dissolve 1 troche between cheek and gum. No food 2 hours before or after.
Frequency: Daily
Estimated Duration: 6 months`,
      },
      "O-304": {
        "New Patient - 1 Month / 53 caps":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 53 O-304 50mg
Dosing:
- First 7 days: 1 cap (50mg)
- Day 8 & on: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 4 weeks`,
        "New Patient - 6 Weeks / 77 caps":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 77 O-304 50mg
Dosing:
- First 7 days: 1 cap (50mg)
- Day 8 & on: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 6 weeks`,
        "New Patient - 2 Months / 113 caps":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 113 O-304 50mg
Dosing:
- First 7 days: 1 cap (50mg)
- Day 8 & on: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 8 weeks`,
        "New Patient - 3 Months / 173 caps":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 173 O-304 50mg
Dosing:
- First 7 days: 1 cap (50mg)
- Day 8 & on: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 12 weeks`,
        "New Patient - 6 Months / 353 caps":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 353 O-304 50mg
Dosing:
- First 7 days: 1 cap (50mg)
- Day 8 & on: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 6 months`,
        "Refill - 1 Month / 60 caps":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 60 O-304 50mg
Dosing: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 4 weeks`,
        "Refill - 3 Months / 180 caps":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 180 O-304 50mg
Dosing: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
    },
// ================================================================
// ================================================================
    // PHARMACY A
    // ================================================================
    "Pharmacy A": {
// --------------------------------------------------------------
      "CJC/IPA Injection +L": {
        "2 Months / 1 vial":
`Products Ordered:
[date] (Pharmacy A) [initials]
Order #
Medication: 1 vial of 6mL CJC/IPA 1.5mg/2.5mg/mL
Dosing: (7 units)
Frequency: Twice a day, 5 days on and 2 days off
Estimated Duration: 8 weeks

*we will order another vial in 6 weeks`,
      },
      "Tesa Injection +L (+C if with GLP)": {
        "4 Weeks / 2 vials":
`Products Ordered:
[date] (Pharmacy A) [initials]
Order #
Medication: 2 vials of 5mL of Tesa 2mg/mL
Dosing: (50 units) (1mg) SubQ
Frequency: 5 days on, 2 days off
Estimated Duration: 4 Weeks

*we will order another 2 vials in 3 weeks`,
        "3 Months / 6 vials":
`Products Ordered:
[date] (Pharmacy A) [initials]
Order #
Medication: 4 vials of 5mL of Tesa 2mg/mL
Dosing: (50 units) (1mg) SubQ
Frequency: 5 days on, 2 days off
Estimated Duration: 8 weeks

*we will order another 2 vials in 6 weeks`,
      },
      "BPC-157 Injection": {
        "1 Month / 1 vial":
`Products Ordered:
[date] (Pharmacy A) [initials]
Order #
Medication: 1 vial of 5mL BPC-157 3mg/mL
Dosing: (17 units)
Frequency: Daily
Estimated Duration: 4 weeks

*we will order another vial in 3 weeks`,
        "3 Months / 3 vials":
`Products Ordered:
[date] (Pharmacy A) [initials]
Order #
Medication: 2 vials of 5mL BPC-157 3mg/mL
Dosing: (17 units)
Frequency: Daily
Estimated Duration: 8 weeks

*we will order another vial in 6 weeks`,
      },
      "GHK-Cu Injection": {
        "6 weeks / 1 vial":
`Products Ordered:
[date] (Pharmacy A) [initials]
Order #
Medication: 1 vial of 5mL GHK-Cu 10mg/mL
Dosing: (12 units) (1.2mg)
Frequency: Once daily
Estimated Duration: 6 weeks`,
        "3 Months / 2 vials":
`Products Ordered:
[date] (Pharmacy A) [initials]
Order #
Medication: 2 vials of 5mL GHK-Cu 10mg/mL
Dosing: (12 units) (1.2mg)
Frequency: Once daily
Estimated Duration: 12 weeks`,
      },
      "TB-500 Injection": {
        "1 Month / 3 vials":
`Products Ordered:
[date] (Pharmacy A) [initials]
Order #
Medication: 3 vials of 3mL TB-500 3.33mg/ml
Dosing: (30 units)
Frequency: Daily
Estimated Duration: 4 weeks

*we will order another 3 vials in 3 weeks`,
      },
      "NAD+ Injection": {
        "Light / 1 vial":
`Products Ordered:
[date] (Pharmacy A) [initials]
Order #
Medication: 1 vial of 10mL NAD+ 100mg/mL
Dosing: (50 units) 50 mg
Frequency: 3 times a week
Estimated Duration: 6.7 weeks`,
        "Medium / 2 vials":
`Products Ordered:
[date] (Pharmacy A) [initials]
Order #
Medication: 2 vials of 10mL NAD+ 100mg/mL
Dosing: (100 units) 100 mg
Frequency: 3 times a week
Estimated Duration: 6.7 weeks`,
        "Strong / 4 vials":
`Products Ordered:
[date] (Pharmacy A) [initials]
Order #
Medication: 4 vials of 10mL NAD+ 100mg/mL
Dosing: (200 units) 200 mg
Frequency: 3 times a week
Estimated Duration: 6.7 weeks`,
        "Strong / 4 vials (alt. dosing)":
`Products Ordered:
[date] (Pharmacy A) [initials]
Order #
Medication: 4 vials of 10mL NAD+ 100mg/mL
Dosing: (85 units) 85 mg
Frequency: Once a day
Estimated Duration: 6.7 weeks`,
      },
      "Wolverine Blend (BPC/TB500)": {
        "Light / 1 Month / 2 vials":
`Products Ordered:
[date] (Pharmacy A) [initials]
Order #
Medication: 2 vials of 3mL BPC/TB500 1.66mg/3.33mg/mL
Dosing: (20 units)
Frequency: Daily
Estimated Duration: 4 weeks

*we will order another 2 vials in 3 weeks`,
        "Standard / 1 Month / 3 vials":
`Products Ordered:
[date] (Pharmacy A) [initials]
Order #
Medication: 3 vials of 3mL BPC/TB500 1.66mg/3.33mg/mL
Dosing: (30 units)
Frequency: Daily
Estimated Duration: 4 weeks

*we will order another 3 vials in 3 weeks`,
        "Strong / 1 Month / 6 vials":
`Products Ordered:
[date] (Pharmacy A) [initials]
Order #
Medication: 6 vials of 3mL BPC/TB500 1.66mg/3.33mg/mL
Dosing: (60 units)
Frequency: Daily
Estimated Duration: 4 weeks

*we will order another 6 vials in 3 weeks`,
        "Light / 3 Months / 6 vials":
`Products Ordered:
[date] (Pharmacy A) [initials]
Order #
Medication: 4 vials of 3mL BPC/TB500 1.66mg/3.33mg/mL
Dosing: (20 units)
Frequency: Daily
Estimated Duration: 8 weeks

*we will order another 2 vials in 6 weeks`,
        "Standard / 3 Months / 9 vials":
`Products Ordered:
[date] (Pharmacy A) [initials]
Order #
Medication: 6 vials of 3mL BPC/TB500 1.66mg/3.33mg/mL
Dosing: (30 units)
Frequency: Daily
Estimated Duration: 8 weeks

*we will order another 3 vials in 6 weeks`,
        "Strong / 3 Months / 18 vials":
`Products Ordered:
[date] (Pharmacy A) [initials]
Order #
Medication: 12 vials of 3mL BPC/TB500 1.66mg/3.33mg/mL
Dosing: (60 units)
Frequency: Daily
Estimated Duration: 8 weeks

*we will order another 6 vials in 6 weeks`,
      },
      "Glow Blend (BPC/GHK/TB)": {
        "1 Month / 3 vials":
`Products Ordered:
[date] (Pharmacy A) [initials]
Order #
Medication: 3 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL
Dosing: (30 units)
Frequency: Daily
Estimated Duration: 4 weeks

*we will order another 3 vials in 3 weeks`,
        "Strong / 1 Month / 6 vials":
`Products Ordered:
[date] (Pharmacy A) [initials]
Order #
Medication: 6 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL
Dosing: (60 units)
Frequency: Daily
Estimated Duration: 4 weeks

*we will order another 6 vials in 3 weeks`,
      },
      "TESO": {
        "Order":
`Products Ordered:
[date] (Pharmacy A) [initials]
Order #
Medication: TESO
Estimated Duration:`,
      },
    },
// ================================================================
    // PHARMACY C
    // ================================================================
    "Pharmacy C": {
      "Phentermine +L +C": {
        "1 Month / 30 pills":
`Products Ordered:
[date] (Pharmacy C) [initials]
Order #
Medication: 30 Phentermine 37.5mg
Dosing: 15-37.5mg
Frequency: Daily
Estimated Duration: 4 weeks`,
        "3 Months / 90 pills":
`Products Ordered:
[date] (Pharmacy C) [initials]
Order #
Medication: 90 Phentermine 37.5mg
Dosing: 15-37.5mg
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      "MOTS-c (CB4211)": {
        "2 Months / 8 kits":
`Products Ordered:
[date] (Pharmacy C) [initials]
Order #
Medication: 8 kits of 10mg CB4211
Dosing: Reconstitute with 1mL bacteriostatic water then inject 0.5mL (50 units) subcutaneously
Frequency: Twice weekly
Estimated Duration: 8 weeks`,
      },
      "Thymosin Alpha-1 Injection": {
        "1 Month / 1 vial":
`Products Ordered:
[date] (Pharmacy C) [initials]
Order #
Medication: 1 vial of 15mg Thymosin Alpha-1
Directions: Reconstitute with 3 mL BAC water
Dosing: 0.50mg (10 units)
Frequency: Daily
Estimated Duration: 4 weeks`,
        "3 Months / 3 vials":
`Products Ordered:
[date] (Pharmacy C) [initials]
Order #
Medication: 3 vials of 15mg Thymosin Alpha-1
Directions: Reconstitute with 3 mL BAC water
Dosing: 0.50mg (10 units)
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      "Methylene Blue Pill 10mg": {
        "1 Month / 30 pills":
`Products Ordered:
[date] (Pharmacy C) [initials]
Order #
Medication: 30 Methylene Blue 10mg
Dosing: Start with 10mg
Frequency: Daily
Estimated Duration: 4 weeks`,
        "3 Months / 90 pills":
`Products Ordered:
[date] (Pharmacy C) [initials]
Order #
Medication: 90 Methylene Blue 10mg
Dosing: Start with 10mg
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      "Methylene Blue Pill 15mg": {
        "1 Month / 30 pills":
`Products Ordered:
[date] (Pharmacy C) [initials]
Order #
Medication: 30 Methylene Blue 15mg
Dosing: 15mg
Frequency: Daily
Estimated Duration: 4 weeks`,
        "3 Months / 90 pills":
`Products Ordered:
[date] (Pharmacy C) [initials]
Order #
Medication: 90 Methylene Blue 15mg
Dosing: 15mg
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      "Sermorelin Injection": {
        "2 Weeks / 1 vial":
`Products Ordered:
[date] (Pharmacy C) [initials]
Order #
Medication: 1 vial Sermorelin 15mg
Dosing: Inject 10 units (0.10mL) SQ
Frequency: 2x per day. 5 days on, 2 days off.
Estimated Duration: 2 weeks`,
        "4 Weeks / 2 vials":
`Products Ordered:
[date] (Pharmacy C) [initials]
Order #
Medication: 2 vials Sermorelin 15mg
Dosing: Inject 10 units (0.10mL) SQ
Frequency: 2x per day. 5 days on, 2 days off.
Estimated Duration: 4 weeks`,
        "3 Months / 6 vials":
`Products Ordered:
[date] (Pharmacy C) [initials]
Order #
Medication: 6 vials Sermorelin 15mg
Dosing: Inject 10 units (0.10mL) SQ
Frequency: 2x per day. 5 days on, 2 days off.
Estimated Duration: 12 weeks`,
      },
      "Synapsin Nasal Spray (RG3/Nicotinamide Ribose)": {
        "2 Months / 1 vial 15mL":
`Products Ordered:
[date] (Pharmacy C) [initials]
Order #
Medication: 1 vial of 15mL Synapsin 2/50 mg/mL
Dosing: 1 spray per nostril
Frequency: Once a day
Estimated Duration: 8 weeks`,
        "4 Months / 1 vial 30mL":
`Products Ordered:
[date] (Pharmacy C) [initials]
Order #
Medication: 1 vial of 30mL Synapsin 2/50 mg/mL
Dosing: 1 spray per nostril
Frequency: Once a day
Estimated Duration: 4 months`,
      },
      "Wolverine Light (Separate powdered vials)": {
        "1 Month / 1 vial each":
`Products Ordered:
[date] (Pharmacy C) [initials]
Order #
Medication: 1 vial of 15mg BPC-157
Directions: Reconstitute with 7.5mL BAC water
Dosing: Inject 25 units subcutaneously
Frequency: Daily
Estimated Duration: 4 weeks

Medication: 1 vial of 15mg TB-500
Directions: Reconstitute with 7.5mL BAC water
Dosing: Inject 25 units subcutaneously
Frequency: Daily
Estimated Duration: 4 weeks`,
        "2 Months / 2 vials each":
`Products Ordered:
[date] (Pharmacy C) [initials]
Order #
Medication: 2 vials of 15mg BPC-157
Directions: Reconstitute with 7.5mL BAC water
Dosing: Inject 25 units subcutaneously
Frequency: Daily
Estimated Duration: 8 weeks

Medication: 2 vials of 15mg TB-500
Directions: Reconstitute with 7.5mL BAC water
Dosing: Inject 25 units subcutaneously
Frequency: Daily
Estimated Duration: 8 weeks`,
        "3 Months / 3 vials each":
`Products Ordered:
[date] (Pharmacy C) [initials]
Order #
Medication: 3 vials of 15mg BPC-157
Directions: Reconstitute with 7.5mL BAC water
Dosing: Inject 25 units subcutaneously
Frequency: Daily
Estimated Duration: 12 weeks

Medication: 3 vials of 15mg TB-500
Directions: Reconstitute with 7.5mL BAC water
Dosing: Inject 25 units subcutaneously
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      // Pharmacy C (2026-09-21): reconstituted 5mL vial at 4mg/mL = 20mg total.
      // The clinic's 25 units is 1mg, so one vial is exactly 20 injection days
      // (5mL / 0.25mL), then cycle off - hence ONE tier for the sheet's 1 mth.
      "Pinealon": {
        "1 Month / 1 vial":
`Products Ordered:
[date] (Pharmacy C) [initials]
Order #
Medication: 1 vial of 5mL Pinealon
Concentration: 4mg/mL
Dosing: 25 units (1mg) subcutaneously
Frequency: Once daily for 20 days, then cycle off
Estimated Duration: 4 weeks`,
      },
    },
    // ================================================================
    // PHARMACY D
    // ================================================================
    "Pharmacy D": {
      "Phentermine +L +C": {
        "1 Month / 30 pills":
`Products Ordered:
[date] (Pharmacy D) [initials]
Order #
Medication: 30 Phentermine 37.5mg
Dosing: 15-37.5mg
Frequency: Daily
Estimated Duration: 4 weeks`,
        "3 Months / 90 pills":
`Products Ordered:
[date] (Pharmacy D) [initials]
Order #
Medication: 90 Phentermine 37.5mg
Dosing: 15-37.5mg
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      "DSIP Troches 300mcg": {
        "1 Month / 30 troches":
`Products Ordered:
[date] (Pharmacy D) [initials]
Order #
Medication: 30 DSIP troches 300mcg
Dosing: 1 troche, taken 30-60 minutes before bed
Frequency: Nightly
Estimated Duration: 4 weeks`,
        "3 Months / 90 troches":
`Products Ordered:
[date] (Pharmacy D) [initials]
Order #
Medication: 90 DSIP troches 300mcg
Dosing: 1 troche, taken 30-60 minutes before bed
Frequency: Nightly
Estimated Duration: 12 weeks`,
      },
      "Methylene Blue Pill 10mg": {
        "1 Month / 30 pills":
`Products Ordered:
[date] (Pharmacy D) [initials]
Order #
Medication: 30 Methylene Blue 10mg
Dosing: Start with 10mg
Frequency: Daily
Estimated Duration: 4 weeks`,
        "3 Months / 90 pills":
`Products Ordered:
[date] (Pharmacy D) [initials]
Order #
Medication: 90 Methylene Blue 10mg
Dosing: Start with 10mg
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      "Methylene Blue Pill 15mg": {
        "1 Month / 30 pills":
`Products Ordered:
[date] (Pharmacy D) [initials]
Order #
Medication: 30 Methylene Blue 15mg
Dosing: 15mg
Frequency: Daily
Estimated Duration: 4 weeks`,
        "3 Months / 90 pills":
`Products Ordered:
[date] (Pharmacy D) [initials]
Order #
Medication: 90 Methylene Blue 15mg
Dosing: 15mg
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      "Sermorelin Injection": {
        "2 Weeks / 1 vial":
`Products Ordered:
[date] (Pharmacy D) [initials]
Order #
Medication: 1 vial Sermorelin 15mg
Dosing: Inject 10 units (0.10mL) SQ
Frequency: 2x per day. 5 days on, 2 days off.
Estimated Duration: 2 weeks`,
        "4 Weeks / 2 vials":
`Products Ordered:
[date] (Pharmacy D) [initials]
Order #
Medication: 2 vials Sermorelin 15mg
Dosing: Inject 10 units (0.10mL) SQ
Frequency: 2x per day. 5 days on, 2 days off.
Estimated Duration: 4 weeks`,
        "3 Months / 6 vials":
`Products Ordered:
[date] (Pharmacy D) [initials]
Order #
Medication: 6 vials Sermorelin 15mg
Dosing: Inject 10 units (0.10mL) SQ
Frequency: 2x per day. 5 days on, 2 days off.
Estimated Duration: 12 weeks`,
      },
      "Synapsin Nasal Spray (RG3/Nicotinamide Ribose)": {
        "2 Months / 1 vial 15mL":
`Products Ordered:
[date] (Pharmacy D) [initials]
Order #
Medication: 1 vial of 15mL Synapsin 2/50 mg/mL
Dosing: 1 spray per nostril
Frequency: Once a day
Estimated Duration: 8 weeks`,
        "4 Months / 1 vial 30mL":
`Products Ordered:
[date] (Pharmacy D) [initials]
Order #
Medication: 1 vial of 30mL Synapsin 2/50 mg/mL
Dosing: 1 spray per nostril
Frequency: Once a day
Estimated Duration: 4 months`,
      },
    },
// ================================================================
    // Pharmacy B
    // ================================================================
    "Pharmacy B": {
      "Tesa +L (+C if with GLP)[GO TO PHARMACY A!]": {
        "1 Vial / 3mL":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 1 vial of 3mL Tesa 8mg/mL
Dosing: Inject SubQ at bedtime (12 units)
Frequency: 6 nights/week
Estimated Duration: 4 Weeks

*we will order 1 vial every 3 weeks`,
      },
      "Pregnyl HCG Injectable +L +C": {
        "1 Vial / 10mL":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 1 vial of 10mL Pregnyl HCG 10,000 Units
Dosing:
- TRT: 250-500 IU (25-50 units)
- Fertility: 1000-2000 IU (100-200 units) (short-term)
Frequency: 2x/week
Estimated Duration: `,
      },
      "CJC-1295/Ipamorelin Troche 2mg/2mg": {
        "1 Month / 30 troches":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 30 CJC-1295/Ipamorelin Troches 2mg/2mg
Dosing: Dissolve 1 troche under the tongue
Frequency: Daily
Estimated Duration: 4 weeks`,
        "2 Months / 60 troches":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 60 CJC-1295/Ipamorelin Troches 2mg/2mg
Dosing: Dissolve 1 troche under the tongue
Frequency: Daily
Estimated Duration: 8 weeks`,
        "3 Months / 90 troches":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 90 CJC-1295/Ipamorelin Troches 2mg/2mg
Dosing: Dissolve 1 troche under the tongue
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      "Methylene Blue Pill 10mg": {
        "1 Month / 30 pills":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 30 Methylene Blue 10mg
Dosing: 1 pill
Frequency: Daily
Estimated Duration: 4 weeks`,
        "3 Months / 90 pills":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 90 Methylene Blue 10mg
Dosing: 1 pill
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      "Methylene Blue Pill 15mg": {
        "1 Month / 30 pills":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 30 Methylene Blue 15mg
Dosing: 1 pill
Frequency: Daily
Estimated Duration: 4 weeks`,
        "3 Months / 90 pills":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 90 Methylene Blue 15mg
Dosing: 1 pill
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      "Methylene Blue Pill 25mg": {
        "1 Month / 30 pills":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 30 Methylene Blue 25mg
Dosing: 1 pill
Frequency: Daily
Estimated Duration: 4 weeks`,
        "3 Months / 90 pills":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 90 Methylene Blue 25mg
Dosing: 1 pill
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      "NAD Nasal Spray": {
        "1 Bottle / 15mL":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 1 bottle of 15mL NAD Nasal Spray 30mg/mL
Dosing: 1 spray per nostril
Frequency: Daily up to 2x/day
Estimated Duration: 22-45 days`,
      },
      "Nicotine Troches": {
        "1 Month / 30 troches":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 30 Nicotine Troches 1mg
Dosing: 1 troche
Frequency: As needed
Estimated Duration: 4 weeks`,
      },
      "NMN/Apigenin Capsule": {
        "1 Month / 30 capsules":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 30 NMN/Apigenin 250mg/150mg
Dosing: 1 capsule without food
Frequency: Daily
Estimated Duration: 4 weeks`,
        "3 Months / 90 capsules":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 90 NMN/Apigenin 250mg/150mg
Dosing: 1 capsule without food
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      "PT-141 Injection": {
        "1 Vial / 2mL":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 1 vial of 2mL PT-141 10mg/mL
Dosing: Inject SQ (5-15 units) 45–60 min before sexual activity
Frequency: Every 3 days
Estimated Duration: 28 days`,
      },
      "PT-141 Nasal Spray": {
        "1 Bottle / 3mL":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 1 bottle of 3mL PT-141 Nasal 2.5mg/0.1mL
Dosing: 1-3 sprays intranasally 45–60 min before sexual activity
Frequency: Up to 3 sprays per day
Estimated Duration: 4 weeks`,
      },
      "SS-31 Injection": {
        "7 Weeks / 1 vial":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 1 vial of 6mL SS-31 50mg/mL
Dosing: 20mg (40 units)
Frequency: 2x/week
Estimated Duration: 7 weeks`,
      },
      "Thymosin Alpha-1 Injection": {
        "1 Month / 1 vial":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 1 vial of 5mL Thymosin Alpha-1 3mg/mL
Dosing: 0.45mg (15 units)
Frequency: Daily
Estimated Duration: 4 weeks`,
        "3 Months / 3 vials":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 3 vials of 5mL Thymosin Alpha-1 3mg/mL
Dosing: 0.45mg (15 units)
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      "Thymosin Alpha-1 Nasal Spray": {
        "1 Month / 1 vial":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 1 vial of 6mL Thymosin Alpha-1 3mg/mL Nasal
Dosing: 1 spray per nostril
Frequency: Daily up to 2x/day
Estimated Duration: 4 weeks`,
        "3 Months / 3 vials":
`Products Ordered:
[date] (Pharmacy B) [initials]
Order #
Medication: 3 vials of 6mL Thymosin Alpha-1 3mg/mL Nasal
Dosing: 1 spray per nostril
Frequency: Daily up to 2x/day
Estimated Duration: 12 weeks`,
      },
    },
// ================================================================
    // PHARMACY K
    // ================================================================
    "Pharmacy K": {
      "Melanotan II +C": {
        "1 Vial / 5mL":
`Products Ordered:
[date] (Pharmacy K) [initials]
Medication: 1 vial of 5mL Melanotan II 2mg/mL
Dosing: 250mcg (12.5 units)
Frequency: Daily until desired color, then 2x/week to maintain
Estimated Duration: Varies`,
      },
      "DSIP (Deep Sleep Induced Peptide)": {
        "1 Vial / 5mL":
`Products Ordered:
[date] (Pharmacy K) [initials]
Medication: 1 vial of 5mL DSIP 1mg/mL
Dosing: 200mcg (20 units)
Frequency: Daily
Estimated Duration: Varies`,
      },
      "Epithalon": {
        "1 Vial / 5mL":
`Products Ordered:
[date] (Pharmacy K) [initials]
Medication: 1 vial of 5mL Epithalon 10mg/mL
Dosing: 1.7mg (17 units)
Frequency: Daily
Estimated Duration: 4 weeks`,
      },
      "Larazotide": {
        "1 Month / 60 capsules":
`Products Ordered:
[date] (Pharmacy K) [initials]
Medication: 60 capsules Larazotide 500mcg
Dosing: 2 capsules
Frequency: Daily
Estimated Duration: 4 weeks`,
        "3 Months / 180 capsules":
`Products Ordered:
[date] (Pharmacy K) [initials]
Medication: 180 capsules Larazotide 500mcg
Dosing: 2 capsules
Frequency: Daily
Estimated Duration: 12 weeks`,
      },
      "LL-37": {
        "1 Vial / 5mL":
`Products Ordered:
[date] (Pharmacy K) [initials]
Medication: 1 vial of 5mL LL-37 5mg/mL
Dosing: Inject daily, 1 month on, 1 month off
Frequency: Daily
Estimated Duration: 25 days`,
      },
      // Lyophilized powder: 10mg Tesa + 5mg Ipa per vial, reconstituted to 2mL
      // with BAC water (= 5mg/2.5mg per mL). 20 units = 1mg / 0.5mg nightly
      // Mon-Fri, so one vial lasts 10 injection days = 2 weeks: the 4/8/12-week
      // presets are 2/4/6 vials. The Medication line says "Lyophilized" on
      // purpose - it is what keeps the RxSMS parser on this product's own rule.
      "Tesamorelin / Ipamorelin": {
        "1 Month / 2 vials":
`Products Ordered:
[date] (Pharmacy K) [initials]
Medication: 2 vials of 2mL Lyophilized Tesamorelin / Ipamorelin
Concentration: 5mg / 2.5mg per mL
Directions: Reconstitute each vial with 2 mL of bacteriostatic water
Dosing: 20 units (0.2 mL = 1 mg Tesamorelin / 0.5 mg Ipamorelin) subcutaneously
Frequency: Every night at bedtime, Monday through Friday
Estimated Duration: 4 weeks`,
        "2 Months / 4 vials":
`Products Ordered:
[date] (Pharmacy K) [initials]
Medication: 4 vials of 2mL Lyophilized Tesamorelin / Ipamorelin
Concentration: 5mg / 2.5mg per mL
Directions: Reconstitute each vial with 2 mL of bacteriostatic water
Dosing: 20 units (0.2 mL = 1 mg Tesamorelin / 0.5 mg Ipamorelin) subcutaneously
Frequency: Every night at bedtime, Monday through Friday
Estimated Duration: 8 weeks`,
        "3 Months / 6 vials":
`Products Ordered:
[date] (Pharmacy K) [initials]
Medication: 6 vials of 2mL Lyophilized Tesamorelin / Ipamorelin
Concentration: 5mg / 2.5mg per mL
Directions: Reconstitute each vial with 2 mL of bacteriostatic water
Dosing: 20 units (0.2 mL = 1 mg Tesamorelin / 0.5 mg Ipamorelin) subcutaneously
Frequency: Every night at bedtime, Monday through Friday
Estimated Duration: 12 weeks`,
      },
      // Pharmacy K's GLOW + KLOW (2026-09-21; KLOW re-pinned to Jeyson's real
      // 9/23/26 order). Dosing lines are UNITS-ONLY on purpose: the RxSMS parser
      // passes a GIVEN mg through verbatim but only reads the FIRST value, so a
      // spelled-out blend split would degrade to "0.6 mg". Units +
      // Concentration let the engine compute every component (0.5/2.7/1 mg for
      // GLOW, 0.6/0.6/0.6/2 mg for KLOW) and render the full split. GLOW is the
      // same drug and concentration as Pharmacy A's Glow Blend (27mg/5mg/10mg per
      // 3mL vial = 1.66mg/9mg/3.33mg per mL), once daily for 30 days. KLOW is
      // Pharmacy K's OWN 10mL vial, NOT the Greenwich [GRE] KLOW above (that one is
      // 3/10/3/3 mg per mL in 5mL), and runs 5 days on / 2 days off (Mon-Fri)
      // for 14 weeks across 2 vials.
      "GLOW": {
        "1 Vial / 3mL":
`Products Ordered:
[date] (Pharmacy K) [initials]
Medication: 1 vial of 3mL Glow Blend (BPC-157 / GHK-Cu / TB-500)
Concentration: 1.66mg / 9mg / 3.33mg per mL
Dosing: (30 units)
Frequency: Daily
Estimated Duration: 30 days`,
      },
      "KLOW": {
        "2 vials / 14 weeks":
`Products Ordered:
[date] (Pharmacy K) [initials]
Medication: 2 vials of 10mL KLOW (BPC-157 / GHK-Cu / TB-500 / KPV)
Concentration: 3mg / 3mg / 3mg / 10mg per mL
Dosing: 20 units
Frequency: 5 days on and 2 days off (Mon-Fri)
Estimated Duration: 14 weeks`,
      },
      // Pharmacy K's OWN GHK-Cu (2026-09-23, re-pinned 2026-09-24 to the vial size
      // the pharmacy actually stocks: 25mg/mL, dispensed as 3 x 2mL vials =
      // 6 mL total, "10 units once a day" on 5 days on / 2 days off).
      // Pharmacy K called in the original 5mL-vial scripts: they only stock the
      // 2mL size (50mg/2mL = 25mg/mL), so ALL THREE scripts moved 25 units ->
      // 10 units for the SAME 2.5 mg per injection. The drug per vial is
      // unchanged (50 mg either way) even though the CONCENTRATION doubled.
      // Different concentration, dose and schedule from the Pharmacy A "GHK-Cu
      // Injection" row above: Pharmacy A's 10mg/mL vial is 12 units (1.2 mg) EVERY
      // day, Pharmacy K's is 10 units (0.10 mL = 2.5 mg) 5-on/2-off — the same
      // 2.5 mg/day the Pharmacy L 50mg/mL rows give at 5 units. The vial split
      // does not change the dose: 25mg/mL x 0.1 mL = 2.5 mg, and 3 x 2mL holds
      // the same 6 mL (= 60 doses of 0.10 mL = 12 weeks of 5-on/2-off) the
      // original 3 x 5mL held at 0.25 mL. Duration is UNCHANGED.
      // The Medication line therefore carries an "Pharmacy K" TOKEN ("3 vials of
      // 2mL Pharmacy K GHK-Cu"): the unified engine matches DOSE_RULES by drug
      // name, so a bare "GHK-Cu" would resolve to the Pharmacy A daily row and the
      // patient text would promise DAILY dosing for a 5-on/2-off schedule. A
      // parenthetical would NOT work — coreName() strips a trailing "(...)"
      // (that is why the Tesa/Ipamorelin row says "Lyophilized" instead).
      "GHK-Cu": {
        "3 vials / 90 days":
`Products Ordered:
[date] (Pharmacy K) [initials]
Medication: 3 vials of 2mL Pharmacy K GHK-Cu
Concentration: 25mg/mL
Dosing: 10 units
Frequency: 5 days on and 2 days off (Mon-Fri)
Estimated Duration: 90 days`,
      },
    },
    // ================================================================
    // PHARMACY F
    // ================================================================
    "Pharmacy F": {
      "LDN +C": {
        "Order":
`Products Ordered:
[date] (Pharmacy F) [initials]
Medication: LDN
Dosing: Per medical direction
Frequency: As directed
Estimated Duration: `,
      },
    },
// ================================================================
    // RXFLOW  (Greenwich + Pharmacy A consolidated)
    // ================================================================
    "RxFlow": {
      "Peptide": {

        // ---------------- Longevity ----------------
        "[GRE] Epithalon injectable": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x5mL Epithalon
Concentration: 2 mg/mL
Dosing: 20 units (0.2 mL = 0.4 mg) subcutaneously
Frequency: Once daily, Monday through Friday`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x5mL Epithalon
Concentration: 2 mg/mL
Dosing: 20 units (0.2 mL = 0.4 mg) subcutaneously
Frequency: Once daily, Monday through Friday`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x5mL Epithalon
Concentration: 2 mg/mL
Dosing: 20 units (0.2 mL = 0.4 mg) subcutaneously
Frequency: Once daily, Monday through Friday`,
        },
        "[GRE] GHK-Cu injectable": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x5mL GHK-Cu
Concentration: 10 mg/mL
Dosing: 20 units (0.2 mL = 2 mg) subcutaneously
Frequency: Once daily, Monday through Friday`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x5mL GHK-Cu
Concentration: 10 mg/mL
Dosing: 20 units (0.2 mL = 2 mg) subcutaneously
Frequency: Once daily, Monday through Friday`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x5mL GHK-Cu
Concentration: 10 mg/mL
Dosing: 20 units (0.2 mL = 2 mg) subcutaneously
Frequency: Once daily, Monday through Friday`,
        },
        "[GRE] Glutathione injection": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x10mL Glutathione
Concentration: 200 mg/mL
Dosing: 50 units (0.5 mL = 100 mg) intramuscularly
Frequency: Two times a week`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x10mL Glutathione
Concentration: 200 mg/mL
Dosing: 50 units (0.5 mL = 100 mg) intramuscularly
Frequency: Two times a week`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x10mL Glutathione
Concentration: 200 mg/mL
Dosing: 50 units (0.5 mL = 100 mg) intramuscularly
Frequency: Two times a week`,
        },
        "[GRE] GHK-Cu/Epithalon injectable": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x5mL GHK-Cu/Epithalon
Concentration: 10 mg / 2 mg per mL
Dosing:
Frequency:`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x5mL GHK-Cu/Epithalon
Concentration: 10 mg / 2 mg per mL
Dosing:
Frequency:`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x5mL GHK-Cu/Epithalon
Concentration: 10 mg / 2 mg per mL
Dosing:
Frequency:`,
        },

        // ---------------- Mitochondria / Metabolic ----------------
        "[GRE] 5-Amino 1MQ capsules": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x30 caps 5-Amino 1MQ Capsules
Concentration: 50 mg per capsule
Dosing: 1 capsule by mouth
Frequency: Once daily`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x30 caps 5-Amino 1MQ Capsules
Concentration: 50 mg per capsule
Dosing: 1 capsule by mouth
Frequency: Once daily`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x30 caps 5-Amino 1MQ Capsules
Concentration: 50 mg per capsule
Dosing: 1 capsule by mouth
Frequency: Once daily`,
        },
        "[GRE] MOTS-C injectable": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x5mL MOTS-C
Concentration: 2 mg/mL
Dosing: 75 units (1.5 mg) subcutaneously
Frequency: Mornings, 5 days on, 2 days off`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 6x5mL MOTS-C
Concentration: 2 mg/mL
Dosing: 75 units (1.5 mg) subcutaneously
Frequency: Mornings, 5 days on, 2 days off`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 9x5mL MOTS-C
Concentration: 2 mg/mL
Dosing: 75 units (1.5 mg) subcutaneously
Frequency: Mornings, 5 days on, 2 days off`,
        },
        "[GRE] MOTs-C/Tesa injectable": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x5mL MOTs-C/Tesa
Concentration: 2 mg / 3 mg per mL
Dosing: 20 units (0.2 mL = 0.4 mg MOTs-C / 0.6 mg Tesa) subcutaneously
Frequency: Once daily, Monday through Friday`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x5mL MOTs-C/Tesa
Concentration: 2 mg / 3 mg per mL
Dosing: 20 units (0.2 mL = 0.4 mg MOTs-C / 0.6 mg Tesa) subcutaneously
Frequency: Once daily, Monday through Friday`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x5mL MOTs-C/Tesa
Concentration: 2 mg / 3 mg per mL
Dosing: 20 units (0.2 mL = 0.4 mg MOTs-C / 0.6 mg Tesa) subcutaneously
Frequency: Once daily, Monday through Friday`,
        },

        // ---------------- Fat Loss ----------------
        "[GRE] AOD-9604/MOTs-C/Tesa injectable": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x5mL AOD-9604/MOTs-C/Tesa
Concentration: 1.2 mg / 2 mg / 3 mg per mL
Dosing:
Frequency:`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x5mL AOD-9604/MOTs-C/Tesa
Concentration: 1.2 mg / 2 mg / 3 mg per mL
Dosing:
Frequency:`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x5mL AOD-9604/MOTs-C/Tesa
Concentration: 1.2 mg / 2 mg / 3 mg per mL
Dosing:
Frequency:`,
        },

        // ---------------- Healing ----------------
        "[GRE] BPC-157 capsules": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x30 caps BPC-157 Capsules
Concentration: 500 mcg per capsule
Dosing: 1 capsule by mouth
Frequency: Every morning with water only`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x30 caps BPC-157 Capsules
Concentration: 500 mcg per capsule
Dosing: 1 capsule by mouth
Frequency: Every morning with water only`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x30 caps BPC-157 Capsules
Concentration: 500 mcg per capsule
Dosing: 1 capsule by mouth
Frequency: Every morning with water only`,
        },
        "[GRE] BPC-157 injectable": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x5mL BPC-157
Concentration: 3 mg/mL
Dosing: 20 units (0.2 mL = 0.6 mg) intramuscularly at the injury site
Frequency: Once daily`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x5mL BPC-157
Concentration: 3 mg/mL
Dosing: 20 units (0.2 mL = 0.6 mg) intramuscularly at the injury site
Frequency: Once daily`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x5mL BPC-157
Concentration: 3 mg/mL
Dosing: 20 units (0.2 mL = 0.6 mg) intramuscularly at the injury site
Frequency: Once daily`,
        },
        "[GRE] BPC-157/TB-500 capsules": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x30 caps BPC-157/TB-500 Capsules
Concentration:
Dosing:
Frequency:`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x30 caps BPC-157/TB-500 Capsules
Concentration:
Dosing:
Frequency:`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x30 caps BPC-157/TB-500 Capsules
Concentration:
Dosing:
Frequency:`,
        },
        "[GRE] GLOW": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x5mL GLOW (BPC-157/KPV/TB-500)
Concentration: 3 mg / 3 mg / 3 mg per mL
Dosing: 20 units (0.2 mL = 0.6 mg each) subcutaneously
Frequency: Mornings, Monday through Friday`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x5mL GLOW (BPC-157/KPV/TB-500)
Concentration: 3 mg / 3 mg / 3 mg per mL
Dosing: 20 units (0.2 mL = 0.6 mg each) subcutaneously
Frequency: Mornings, Monday through Friday`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x5mL GLOW (BPC-157/KPV/TB-500)
Concentration: 3 mg / 3 mg / 3 mg per mL
Dosing: 20 units (0.2 mL = 0.6 mg each) subcutaneously
Frequency: Mornings, Monday through Friday`,
        },
        "[GRE] KLOW": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x5mL KLOW (BPC-157/GHK-Cu/KPV/TB-500)
Concentration: 3 mg / 10 mg / 3 mg / 3 mg per mL
Dosing: 20 units (0.2 mL = 0.6 mg BPC-157 / 2 mg GHK-Cu / 0.6 mg KPV / 0.6 mg TB-500) subcutaneously
Frequency: Mornings, Monday through Friday`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x5mL KLOW (BPC-157/GHK-Cu/KPV/TB-500)
Concentration: 3 mg / 10 mg / 3 mg / 3 mg per mL
Dosing: 20 units (0.2 mL = 0.6 mg BPC-157 / 2 mg GHK-Cu / 0.6 mg KPV / 0.6 mg TB-500) subcutaneously
Frequency: Mornings, Monday through Friday`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x5mL KLOW (BPC-157/GHK-Cu/KPV/TB-500)
Concentration: 3 mg / 10 mg / 3 mg / 3 mg per mL
Dosing: 20 units (0.2 mL = 0.6 mg BPC-157 / 2 mg GHK-Cu / 0.6 mg KPV / 0.6 mg TB-500) subcutaneously
Frequency: Mornings, Monday through Friday`,
        },
        "[GRE] Wolverine": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x5mL Wolverine (BPC-157/TB-500)
Concentration: 3 mg / 3 mg per mL
Dosing: 20 units (0.2 mL = 0.6 mg each) subcutaneously at site of injury
Frequency: Mornings, Monday through Friday`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x5mL Wolverine (BPC-157/TB-500)
Concentration: 3 mg / 3 mg per mL
Dosing: 20 units (0.2 mL = 0.6 mg each) subcutaneously at site of injury
Frequency: Mornings, Monday through Friday`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x5mL Wolverine (BPC-157/TB-500)
Concentration: 3 mg / 3 mg per mL
Dosing: 20 units (0.2 mL = 0.6 mg each) subcutaneously at site of injury
Frequency: Mornings, Monday through Friday`,
        },

        // ---------------- Growth Hormone ----------------
        "[GRE] CJC/Ipamorelin injectable": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x5mL CJC/Ipamorelin
Concentration: 1.2 mg / 2 mg per mL
Dosing: 20 units (0.2 mL = 0.24 mg CJC / 0.4 mg Ipamorelin) subcutaneously
Frequency: Before bed, Monday through Friday, on an empty stomach`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x5mL CJC/Ipamorelin
Concentration: 1.2 mg / 2 mg per mL
Dosing: 20 units (0.2 mL = 0.24 mg CJC / 0.4 mg Ipamorelin) subcutaneously
Frequency: Before bed, Monday through Friday, on an empty stomach`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x5mL CJC/Ipamorelin
Concentration: 1.2 mg / 2 mg per mL
Dosing: 20 units (0.2 mL = 0.24 mg CJC / 0.4 mg Ipamorelin) subcutaneously
Frequency: Before bed, Monday through Friday, on an empty stomach`,
        },

        // ---------------- Sleep ----------------
        "[GRE] DSIP injectable": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x5mL DSIP
Concentration: 1 mg/mL
Dosing: 20 units (0.2 mL = 0.2 mg) subcutaneously
Frequency: Once nightly at bedtime, Monday through Friday`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x5mL DSIP
Concentration: 1 mg/mL
Dosing: 20 units (0.2 mL = 0.2 mg) subcutaneously
Frequency: Once nightly at bedtime, Monday through Friday`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x5mL DSIP
Concentration: 1 mg/mL
Dosing: 20 units (0.2 mL = 0.2 mg) subcutaneously
Frequency: Once nightly at bedtime, Monday through Friday`,
        },
        "[GRE] DSIP/BPC/CJC injectable": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x5mL DSIP/BPC/CJC
Concentration: 1 mg / 2 mg / 2 mg per mL
Dosing: 20 units (0.2 mL = 0.2 mg DSIP / 0.4 mg BPC / 0.4 mg CJC) subcutaneously
Frequency: Once nightly at bedtime, Monday through Friday`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x5mL DSIP/BPC/CJC
Concentration: 1 mg / 2 mg / 2 mg per mL
Dosing: 20 units (0.2 mL = 0.2 mg DSIP / 0.4 mg BPC / 0.4 mg CJC) subcutaneously
Frequency: Once nightly at bedtime, Monday through Friday`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x5mL DSIP/BPC/CJC
Concentration: 1 mg / 2 mg / 2 mg per mL
Dosing: 20 units (0.2 mL = 0.2 mg DSIP / 0.4 mg BPC / 0.4 mg CJC) subcutaneously
Frequency: Once nightly at bedtime, Monday through Friday`,
        },

        // ---------------- Libido ----------------
        "[GRE] PT-141 injectable": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x5mL PT-141
Concentration: 2 mg/mL
Dosing: 20 units (0.2 mL = 0.4 mg) subcutaneously
Frequency: Once daily, Monday through Friday`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x5mL PT-141
Concentration: 2 mg/mL
Dosing: 20 units (0.2 mL = 0.4 mg) subcutaneously
Frequency: Once daily, Monday through Friday`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x5mL PT-141
Concentration: 2 mg/mL
Dosing: 20 units (0.2 mL = 0.4 mg) subcutaneously
Frequency: Once daily, Monday through Friday`,
        },
        "[GRE] Kisspeptin injectable": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x5mL Kisspeptin
Concentration: 1 mg/mL
Dosing: 10 units (0.1 mL = 0.1 mg) subcutaneously
Frequency: Two times per week
Estimated Duration: 1 month`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x5mL Kisspeptin
Concentration: 1 mg/mL
Dosing: 10 units (0.1 mL = 0.1 mg) subcutaneously
Frequency: Two times per week
Estimated Duration: 2 months`,
        },
        "[GRE] LL-37 injectable": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x5mL LL-37
Concentration: 2 mg/mL
Dosing: 20 units (0.2 mL = 0.4 mg) subcutaneously
Frequency: Once daily, Monday through Friday`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x5mL LL-37
Concentration: 2 mg/mL
Dosing: 20 units (0.2 mL = 0.4 mg) subcutaneously
Frequency: Once daily, Monday through Friday`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x5mL LL-37
Concentration: 2 mg/mL
Dosing: 20 units (0.2 mL = 0.4 mg) subcutaneously
Frequency: Once daily, Monday through Friday`,
        },
        // ---------------- Cognitive ----------------
        "[GRE] Pinealon/PE22-28/Selank injectable": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x5mL Pinealon/PE22-28/Selank
Concentration: 2 mg / 2 mg / 2 mg per mL
Dosing: 20 units (0.2 mL = 0.4 mg each) subcutaneously
Frequency: Once daily, Monday through Friday`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x5mL Pinealon/PE22-28/Selank
Concentration: 2 mg / 2 mg / 2 mg per mL
Dosing: 20 units (0.2 mL = 0.4 mg each) subcutaneously
Frequency: Once daily, Monday through Friday`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x5mL Pinealon/PE22-28/Selank
Concentration: 2 mg / 2 mg / 2 mg per mL
Dosing: 20 units (0.2 mL = 0.4 mg each) subcutaneously
Frequency: Once daily, Monday through Friday`,
        },
        "[GRE] Semax/Selank injectable": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x5mL Semax/Selank
Concentration: 1 mg / 1 mg per mL
Dosing: 20 units (0.2 mL = 0.2 mg each) subcutaneously
Frequency: Every day, Monday through Friday`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x5mL Semax/Selank
Concentration: 1 mg / 1 mg per mL
Dosing: 20 units (0.2 mL = 0.2 mg each) subcutaneously
Frequency: Every day, Monday through Friday`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x5mL Semax/Selank
Concentration: 1 mg / 1 mg per mL
Dosing: 20 units (0.2 mL = 0.2 mg each) subcutaneously
Frequency: Every day, Monday through Friday`,
        },

        // ---------------- Fat Loss / Growth Hormone ----------------
        "[GRE] Tesa injectable": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x5mL Tesa
Concentration: 3 mg/mL
Dosing: 20 units (0.2 mL = 0.6 mg) subcutaneously
Frequency: Every night at bedtime, Monday through Friday`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x5mL Tesa
Concentration: 3 mg/mL
Dosing: 20 units (0.2 mL = 0.6 mg) subcutaneously
Frequency: Every night at bedtime, Monday through Friday`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x5mL Tesa
Concentration: 3 mg/mL
Dosing: 20 units (0.2 mL = 0.6 mg) subcutaneously
Frequency: Every night at bedtime, Monday through Friday`,
        },
        "[GRE] Tesa/Ipamorelin injectable": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x5mL Tesa/Ipamorelin
Concentration: 3 mg / 2 mg per mL
Dosing: 20 units (0.2 mL = 0.6 mg Tesa / 0.4 mg Ipamorelin) subcutaneously
Frequency: Every night at bedtime, Monday through Friday`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x5mL Tesa/Ipamorelin
Concentration: 3 mg / 2 mg per mL
Dosing: 20 units (0.2 mL = 0.6 mg Tesa / 0.4 mg Ipamorelin) subcutaneously
Frequency: Every night at bedtime, Monday through Friday`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x5mL Tesa/Ipamorelin
Concentration: 3 mg / 2 mg per mL
Dosing: 20 units (0.2 mL = 0.6 mg Tesa / 0.4 mg Ipamorelin) subcutaneously
Frequency: Every night at bedtime, Monday through Friday`,
        },
"[GRE] Thymosin A-1 injectable": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x5mL Thymosin A-1
Concentration: 5 mg/mL
Dosing: 20 units (0.2 mL = 1 mg) subcutaneously
Frequency: Every day, Monday through Friday`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x5mL Thymosin A-1
Concentration: 5 mg/mL
Dosing: 20 units (0.2 mL = 1 mg) subcutaneously
Frequency: Every day, Monday through Friday`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x5mL Thymosin A-1
Concentration: 5 mg/mL
Dosing: 20 units (0.2 mL = 1 mg) subcutaneously
Frequency: Every day, Monday through Friday`,
        },
        // ---------------- Mitochondria / Energy ----------------
        "[GRE] NAD+ injectable (50 units)": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x10mL NAD+
Concentration: 100 mg/mL
Dosing: 50 units (0.5 mL = 50 mg) subcutaneously
Frequency: Once daily, Monday through Friday`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x10mL NAD+
Concentration: 100 mg/mL
Dosing: 50 units (0.5 mL = 50 mg) subcutaneously
Frequency: Once daily, Monday through Friday`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x10mL NAD+
Concentration: 100 mg/mL
Dosing: 50 units (0.5 mL = 50 mg) subcutaneously
Frequency: Once daily, Monday through Friday`,
        },
        "[GRE] NAD+ injectable (20 units)": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x10mL NAD+
Concentration: 100 mg/mL
Dosing: 20 units (0.2 mL = 20 mg) subcutaneously
Frequency: Once daily, Monday through Friday`,
          "2 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 2x10mL NAD+
Concentration: 100 mg/mL
Dosing: 20 units (0.2 mL = 20 mg) subcutaneously
Frequency: Once daily, Monday through Friday`,
          "3 Months":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 3x10mL NAD+
Concentration: 100 mg/mL
Dosing: 20 units (0.2 mL = 20 mg) subcutaneously
Frequency: Once daily, Monday through Friday`,
        },
      },

      "GLP1": {

        // ---------------- Semaglutide ----------------
        "[GRE] Semaglutide/B12 0.25 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x1mL Semaglutide/B12
Concentration: 0.25 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },
        "[GRE] Semaglutide/B12 0.5 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x1mL Semaglutide/B12
Concentration: 0.5 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },
        "[GRE] Semaglutide/B12 1 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x1mL Semaglutide/B12
Concentration: 1 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },
        "[GRE] Semaglutide/B12 1.5 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x1mL Semaglutide/B12
Concentration: 1.5 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },
        "[GRE] Semaglutide/B12 2.5 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x1mL Semaglutide/B12
Concentration: 2.5 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },
        "[GRE] Semaglutide/Glycine 0.25 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x1mL Semaglutide/Glycine
Concentration: 0.25 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },
        "[GRE] Semaglutide/Glycine 0.5 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x1mL Semaglutide/Glycine
Concentration: 0.5 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },
        "[GRE] Semaglutide/Glycine 1 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x1mL Semaglutide/Glycine
Concentration: 1 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },
        "[GRE] Semaglutide/Glycine 1.5 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x1mL Semaglutide/Glycine
Concentration: 1.5 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },
        "[GRE] Semaglutide/Glycine 2.5 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x1mL Semaglutide/Glycine
Concentration: 2.5 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },

        // ---------------- Tirzepatide ----------------
        "[GRE] Tirzepatide/B12 2.5 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x2mL Tirzepatide/B12
Concentration: 2.5 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },
        "[GRE] Tirzepatide/B12 5 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x2mL Tirzepatide/B12
Concentration: 5 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },
        "[GRE] Tirzepatide/B12 7.5 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x2mL Tirzepatide/B12
Concentration: 7.5 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },
        "[GRE] Tirzepatide/B12 10 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x2mL Tirzepatide/B12
Concentration: 10 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },
        "[GRE] Tirzepatide/B12 12.5 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x2mL Tirzepatide/B12
Concentration: 12.5 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },
        "[GRE] Tirzepatide/B12 15 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x2mL Tirzepatide/B12
Concentration: 15 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },
        "[GRE] Tirzepatide/Glycine 2.5 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x2mL Tirzepatide/Glycine
Concentration: 2.5 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },
        "[GRE] Tirzepatide/Glycine 5 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x2mL Tirzepatide/Glycine
Concentration: 5 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },
        "[GRE] Tirzepatide/Glycine 7.5 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x2mL Tirzepatide/Glycine
Concentration: 7.5 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },
        "[GRE] Tirzepatide/Glycine 10 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x2mL Tirzepatide/Glycine
Concentration: 10 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },
        "[GRE] Tirzepatide/Glycine 12.5 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x2mL Tirzepatide/Glycine
Concentration: 12.5 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },
        "[GRE] Tirzepatide/Glycine 15 mg": {
          "1 Month":
`Products Ordered:
[date] (Greenwich) [initials]
Medication: 1x2mL Tirzepatide/Glycine
Concentration: 15 mg / 0.5 mg per mL
Dosing:
Frequency:`,
        },

        // ---------------- Retatrutide (Pharmacy A) ----------------
        "[Pharmacy A] Retatrutide 1 mg": {
          "1 Month":
`Products Ordered:
[date] (Pharmacy A) [initials]
Medication: 1x Retatrutide
Concentration: 1 mg
Dosing:
Frequency:`,
        },
        "[Pharmacy A] Retatrutide 2 mg": {
          "1 Month":
`Products Ordered:
[date] (Pharmacy A) [initials]
Medication: 1x Retatrutide
Concentration: 2 mg
Dosing:
Frequency:`,
        },
        "[Pharmacy A] Retatrutide 4 mg": {
          "1 Month":
`Products Ordered:
[date] (Pharmacy A) [initials]
Medication: 1x Retatrutide
Concentration: 4 mg
Dosing:
Frequency:`,
        },
        "[Pharmacy A] Retatrutide 8 mg": {
          "1 Month":
`Products Ordered:
[date] (Pharmacy A) [initials]
Medication: 1x Retatrutide
Concentration: 8 mg
Dosing:
Frequency:`,
        },
        "[Pharmacy A] Retatrutide 12 mg": {
          "1 Month":
`Products Ordered:
[date] (Pharmacy A) [initials]
Medication: 1x Retatrutide
Concentration: 12 mg
Dosing:
Frequency:`,
        },
      },
    },
    // ================================================================
    // PHARMACYL  (portal.pharmacyl.example — peptide catalog)
    //   Source of truth: Pharmacy L peptide sheet (2026-09). Pharmacy L is its
    //   OWN branch; the Greenwich copies of the same peptides stay under
    //   RxFlow on purpose — duplicate entries across pharmacies are
    //   intentional (per Jeyson 2026-09-11: pick the fulfilling pharmacy).
    //   v6.21 adds the rest of the sheet: TB-500, GHK-Cu, MOTS-C, NAD+
    //   injectable and NAD Nasal Spray (BPC-157 + Tesamorelin were v6.20).
    //   Tier labels mirror the sheet's Duration column = how long ONE vial
    //   lasts at the listed dose, so the vial count is the tier multiple.
    //   v6.22 adds the Estimated Duration line every other pharmacy's
    //   peptides already carry (Pharmacy A/Pharmacy J style, in weeks) to all 18
    //   Pharmacy L tiers. Value = the tier label = total supply across the
    //   vials, and the arithmetic checks out (GHK-Cu 3 mo = 12 units x
    //   2.5 mg x 12 weeks = one 150 mg vial; MOTS-C 2.5 mo = 10 weeks of
    //   5 mg twice weekly = one 100 mg vial).
    //   v6.23 (a) DROPS the pointless "Peptide" sub-branch: Pharmacy L only
    //   ever had that one subsection, so it was a pure extra click. Every
    //   Pharmacy L paste now sits directly under Pharmacy L.
    //   v6.31 (a) MOTS-C: Pharmacy L retired the 20 mg/mL sheet option
    //   (2026-09-25), so that product is DELETED and the surviving 10 mg/mL
    //   vial no longer spells its concentration in the name — 5 mL = 50 mg,
    //   50 units = 5 mg, 2 vials = 10 weeks / 2.5 months, 4 vials = 20
    //   weeks / 5 months.
    //   (b) NAD+ injectable moved to 200 mg/mL in a 5 mL vial: 40 units
    //   (0.4 mL) is the same 80 mg dose the 100 mg/mL / 10 mL vial gave at
    //   80 units, and 5 mL x 200 mg/mL = the same 1000 mg, so every tier
    //   keeps its 1/2/3 Month supply. The old "the sheet's 40 units (80 mg)
    //   is a units typo" note is therefore RETIRED — the sheet was right.
    //   Pharmacy A's "NAD+ Injection" and Greenwich's NAD+ stay 100 mg/mL.
    // ================================================================
    "Pharmacy L": {

      // ---------------- Healing ----------------
      "[BLRX] BPC-157 injectable": {
        "1 Month":
`Products Ordered:
[date] (Pharmacy L) [initials]
Medication: 1x5mL BPC-157
Concentration: 5 mg/mL
Dosing: 20 units (0.2 mL = 1 mg) intramuscularly at the injury site
Frequency: Once daily
Estimated Duration: 4 weeks`,
        "2 Months":
`Products Ordered:
[date] (Pharmacy L) [initials]
Medication: 2x5mL BPC-157
Concentration: 5 mg/mL
Dosing: 20 units (0.2 mL = 1 mg) intramuscularly at the injury site
Frequency: Once daily
Estimated Duration: 8 weeks`,
        "3 Months":
`Products Ordered:
[date] (Pharmacy L) [initials]
Medication: 3x5mL BPC-157
Concentration: 5 mg/mL
Dosing: 20 units (0.2 mL = 1 mg) intramuscularly at the injury site
Frequency: Once daily
Estimated Duration: 12 weeks`,
      },
      "[BLRX] TB-500 injectable": {
        "7 Weeks":
`Products Ordered:
[date] (Pharmacy L) [initials]
Medication: 1x5mL TB-500
Concentration: 10 mg/mL
Dosing: 10 units (0.1 mL = 1 mg) subcutaneously
Frequency: Once daily
Estimated Duration: 7 weeks`,
        "14 Weeks":
`Products Ordered:
[date] (Pharmacy L) [initials]
Medication: 2x5mL TB-500
Concentration: 10 mg/mL
Dosing: 10 units (0.1 mL = 1 mg) subcutaneously
Frequency: Once daily
Estimated Duration: 14 weeks`,
      },

      // ---------------- Skin ----------------
      "[BLRX] GHK-Cu injectable": {
        "3 Months":
`Products Ordered:
[date] (Pharmacy L) [initials]
Medication: 1x3mL GHK-Cu
Concentration: 50 mg/mL
Dosing: 5 units (0.05 mL = 2.5 mg) subcutaneously
Frequency: Once daily, Monday through Friday
Estimated Duration: 12 weeks`,
        "6 Months":
`Products Ordered:
[date] (Pharmacy L) [initials]
Medication: 2x3mL GHK-Cu
Concentration: 50 mg/mL
Dosing: 5 units (0.05 mL = 2.5 mg) subcutaneously
Frequency: Once daily, Monday through Friday
Estimated Duration: 24 weeks`,
        "9 Months":
`Products Ordered:
[date] (Pharmacy L) [initials]
Medication: 3x3mL GHK-Cu
Concentration: 50 mg/mL
Dosing: 5 units (0.05 mL = 2.5 mg) subcutaneously
Frequency: Once daily, Monday through Friday
Estimated Duration: 36 weeks`,
      },

      // ---------------- Mitochondria / Metabolic ----------------
      "[BLRX] MOTS-C injectable": {
        "2.5 Months":
`Products Ordered:
[date] (Pharmacy L) [initials]
Medication: 2x5mL MOTS-C
Concentration: 10 mg/mL
Dosing: 50 units (0.5 mL = 5 mg) subcutaneously
Frequency: Twice weekly, in the morning or before your workout
Estimated Duration: 10 weeks`,
        "5 Months":
`Products Ordered:
[date] (Pharmacy L) [initials]
Medication: 4x5mL MOTS-C
Concentration: 10 mg/mL
Dosing: 50 units (0.5 mL = 5 mg) subcutaneously
Frequency: Twice weekly, in the morning or before your workout
Estimated Duration: 20 weeks`,
      },
      "[BLRX] NAD+ injectable": {
        "1 Month":
`Products Ordered:
[date] (Pharmacy L) [initials]
Medication: 1x5mL NAD+
Concentration: 200 mg/mL
Dosing: 40 units (0.4 mL = 80 mg) subcutaneously
Frequency: Three times a week
Estimated Duration: 4 weeks`,
        "2 Months":
`Products Ordered:
[date] (Pharmacy L) [initials]
Medication: 2x5mL NAD+
Concentration: 200 mg/mL
Dosing: 40 units (0.4 mL = 80 mg) subcutaneously
Frequency: Three times a week
Estimated Duration: 8 weeks`,
        "3 Months":
`Products Ordered:
[date] (Pharmacy L) [initials]
Medication: 3x5mL NAD+
Concentration: 200 mg/mL
Dosing: 40 units (0.4 mL = 80 mg) subcutaneously
Frequency: Three times a week
Estimated Duration: 12 weeks`,
      },

      // ---------------- Cognitive ----------------
      "[BLRX] NAD Nasal Spray": {
        "2 Months":
`Products Ordered:
[date] (Pharmacy L) [initials]
Medication: 1x10mL NAD Nasal Spray
Concentration: 300 mg/mL
Dosing: 1 spray in each nostril every morning
Frequency: Daily, up to 2 times per day as directed
Estimated Duration: 8 weeks`,
        "4 Months":
`Products Ordered:
[date] (Pharmacy L) [initials]
Medication: 2x10mL NAD Nasal Spray
Concentration: 300 mg/mL
Dosing: 1 spray in each nostril every morning
Frequency: Daily, up to 2 times per day as directed
Estimated Duration: 16 weeks`,
      },

      // ---------------- Fat Loss / Growth Hormone ----------------
      "[BLRX] Tesamorelin injectable": {
        "1 Month":
`Products Ordered:
[date] (Pharmacy L) [initials]
Medication: 1x5mL Tesamorelin
Concentration: 5 mg/mL
Dosing: 20 units (0.2 mL = 1 mg) subcutaneously
Frequency: Every night at bedtime, Monday through Friday
Estimated Duration: 4 weeks`,
        "2 Months":
`Products Ordered:
[date] (Pharmacy L) [initials]
Medication: 2x5mL Tesamorelin
Concentration: 5 mg/mL
Dosing: 20 units (0.2 mL = 1 mg) subcutaneously
Frequency: Every night at bedtime, Monday through Friday
Estimated Duration: 8 weeks`,
        "3 Months":
`Products Ordered:
[date] (Pharmacy L) [initials]
Medication: 3x5mL Tesamorelin
Concentration: 5 mg/mL
Dosing: 20 units (0.2 mL = 1 mg) subcutaneously
Frequency: Every night at bedtime, Monday through Friday
Estimated Duration: 12 weeks`,
      },
    },
  "Stacks": {
    // ============================================================
    // WARRIOR STACK - 3 MONTHS (Phases: Wks 1-2 SLU-PP 100mcg, Wks 3-6 SLU-PP 200mcg, Wks 7-12 AOD + O-304)
    // ============================================================
    "Warrior Stack - 3 Months": {
      "Paid in Full":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 14 SLU-PP-332 100mcg
Timing: Weeks 1-2
Dosing: 1 pill
Frequency: Daily
Estimated Duration: 2 weeks

[date] (Pharmacy J) [initials]
Medication: 42 SLU-PP-332 200mcg
Timing: Weeks 3-6
Dosing:
- After finishing 100mcg: 1 capsule for 2 weeks
- Onwards: 2 capsules (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 4 weeks

[date] (Pharmacy J) [initials]
Medication: 42 AOD 600mcg
Timing: Weeks 7-12
Dosing: 1 troche
Frequency: Daily
Estimated Duration: 6 weeks

[date] (Pharmacy J) [initials]
Medication: 77 O-304 50mg
Timing: Weeks 7-12
Dosing:
- First 7 days: 1 cap (50mg)
- Day 8 & on: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 6 weeks`,
    },
// ============================================================
    // WARRIOR STACK - 6 MONTHS
    // ============================================================
"Warrior Stack - 6 Months": {
      "Paid in Full":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 14 SLU-PP-332 100mcg
Timing: Weeks 1-2
Dosing: 1 pill
Frequency: Daily
Estimated Duration: 2 weeks

[date] (Pharmacy J) [initials]
Medication: 70 SLU-PP-332 200mcg
Timing: Weeks 3-8
Dosing:
- After finishing 100mcg: 1 capsule for 2 weeks
- Onwards: 2 capsules (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 6 weeks

[date] (Pharmacy J) [initials]
Medication: 120 AOD 600mcg
Timing: Weeks 9-25
Dosing: 1 troche
Frequency: Daily
Estimated Duration: 17 weeks

[date] (Pharmacy J) [initials]
Medication: 233 O-304 50mg
Timing: Weeks 9-25
Dosing:
- First 7 days: 1 cap (50mg)
- Day 8 & on: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 17 weeks`,
      "1 of 2 Installments (Weeks 1-13)":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 14 SLU-PP-332 100mcg
Timing: Weeks 1-2
Dosing: 1 pill
Frequency: Daily
Estimated Duration: 2 weeks

[date] (Pharmacy J) [initials]
Medication: 70 SLU-PP-332 200mcg
Timing: Weeks 3-8
Dosing:
- After finishing 100mcg: 1 capsule for 2 weeks
- Onwards: 2 capsules (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 6 weeks

[date] (Pharmacy J) [initials]
Medication: 35 AOD 600mcg
Timing: Weeks 9-13
Dosing: 1 troche
Frequency: Daily
Estimated Duration: 5 weeks

[date] (Pharmacy J) [initials]
Medication: 63 O-304 50mg
Timing: Weeks 9-13
Dosing:
- First 7 days: 1 cap (50mg)
- Day 8 & on: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 5 weeks`,
      "2 of 2 Installments (Weeks 14-25)":
`[date] (Pharmacy J) [initials]
Medication: 85 AOD 600mcg
Timing: Weeks 14-25
Dosing: 1 troche
Frequency: Daily
Estimated Duration: 12 weeks

[date] (Pharmacy J) [initials]
Medication: 170 O-304 50mg
Timing: Weeks 14-25
Dosing: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 12 weeks`,
      "1 of 3 Installments (Weeks 1-8)":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 14 SLU-PP-332 100mcg
Timing: Weeks 1-2
Dosing: 1 pill
Frequency: Daily
Estimated Duration: 2 weeks

[date] (Pharmacy J) [initials]
Medication: 70 SLU-PP-332 200mcg
Timing: Weeks 3-8
Dosing:
- After finishing 100mcg: 1 capsule for 2 weeks
- Onwards: 2 capsules (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 6 weeks`,
      "2 of 3 Installments (Weeks 9-17)":
`[date] (Pharmacy J) [initials]
Medication: 63 AOD 600mcg
Timing: Weeks 9-17
Dosing: 1 troche
Frequency: Daily
Estimated Duration: 9 weeks

[date] (Pharmacy J) [initials]
Medication: 119 O-304 50mg
Timing: Weeks 9-17
Dosing:
- First 7 days: 1 cap (50mg)
- Day 8 & on: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 9 weeks`,
      "3 of 3 Installments (Weeks 18-25)":
`[date] (Pharmacy J) [initials]
Medication: 57 AOD 600mcg
Timing: Weeks 18-25
Dosing: 1 troche
Frequency: Daily
Estimated Duration: 8 weeks

[date] (Pharmacy J) [initials]
Medication: 114 O-304 50mg
Timing: Weeks 18-25
Dosing: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 8 weeks`,
      "1 of 4 Installments (Weeks 1-6)":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 14 SLU-PP-332 100mcg
Timing: Weeks 1-2
Dosing: 1 pill
Frequency: Daily
Estimated Duration: 2 weeks

[date] (Pharmacy J) [initials]
Medication: 42 SLU-PP-332 200mcg
Timing: Weeks 3-6
Dosing:
- After finishing 100mcg: 1 capsule for 2 weeks
- Onwards: 2 capsules (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 4 weeks`,
      "2 of 4 Installments (Weeks 7-13)":
`[date] (Pharmacy J) [initials]
Medication: 28 SLU-PP-332 200mcg
Timing: Weeks 7-8
Dosing: 2 pills (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 2 weeks

[date] (Pharmacy J) [initials]
Medication: 35 AOD 600mcg
Timing: Weeks 9-13
Dosing: 1 troche
Frequency: Daily
Estimated Duration: 5 weeks

[date] (Pharmacy J) [initials]
Medication: 63 O-304 50mg
Timing: Weeks 9-13
Dosing:
- First 7 days: 1 cap (50mg)
- Day 8 & on: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 5 weeks`,
      "3 of 4 Installments (Weeks 14-19)":
`[date] (Pharmacy J) [initials]
Medication: 42 AOD 600mcg
Timing: Weeks 14-19
Dosing: 1 troche
Frequency: Daily
Estimated Duration: 6 weeks

[date] (Pharmacy J) [initials]
Medication: 84 O-304 50mg
Timing: Weeks 14-19
Dosing: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 6 weeks`,
      "4 of 4 Installments (Weeks 20-25)":
`[date] (Pharmacy J) [initials]
Medication: 43 AOD 600mcg
Timing: Weeks 20-25
Dosing: 1 troche
Frequency: Daily
Estimated Duration: 6 weeks

[date] (Pharmacy J) [initials]
Medication: 86 O-304 50mg
Timing: Weeks 20-25
Dosing: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 6 weeks`,
    },
// ============================================================
    // WARRIOR STACK - 12 MONTHS
    // (Phases: Wks 1-2 SLU-PP 100mcg, Wks 3-8 SLU-PP 200mcg, Wks 9-52 AOD + O-304)
    // ============================================================
    "Warrior Stack - 12 Months": {
      "Paid in Full":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 14 SLU-PP-332 100mcg
Timing: Weeks 1-2
Dosing: 1 pill
Frequency: Daily
Estimated Duration: 2 weeks

[date] (Pharmacy J) [initials]
Medication: 70 SLU-PP-332 200mcg
Timing: Weeks 3-8
Dosing:
- After finishing 100mcg: 1 capsule for 2 weeks
- Onwards: 2 capsules (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 6 weeks

[date] (Pharmacy J) [initials]
Medication: 308 AOD 600mcg
Timing: Weeks 9-52
Dosing: 1 troche
Frequency: Daily
Estimated Duration: 44 weeks

[date] (Pharmacy J) [initials]
Medication: 609 O-304 50mg
Timing: Weeks 9-52
Dosing:
- First 7 days: 1 cap (50mg)
- Day 8 & on: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 44 weeks`,
      "1 of 2 Installments (Weeks 1-26)":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 14 SLU-PP-332 100mcg
Timing: Weeks 1-2
Dosing: 1 pill
Frequency: Daily
Estimated Duration: 2 weeks

[date] (Pharmacy J) [initials]
Medication: 70 SLU-PP-332 200mcg
Timing: Weeks 3-8
Dosing:
- After finishing 100mcg: 1 capsule for 2 weeks
- Onwards: 2 capsules (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 6 weeks

[date] (Pharmacy J) [initials]
Medication: 126 AOD 600mcg
Timing: Weeks 9-26
Dosing: 1 troche
Frequency: Daily
Estimated Duration: 18 weeks

[date] (Pharmacy J) [initials]
Medication: 245 O-304 50mg
Timing: Weeks 9-26
Dosing:
- First 7 days: 1 cap (50mg)
- Day 8 & on: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 18 weeks`,
      "2 of 2 Installments (Weeks 27-52)":
`[date] (Pharmacy J) [initials]
Medication: 182 AOD 600mcg
Timing: Weeks 27-52
Dosing: 1 troche
Frequency: Daily
Estimated Duration: 26 weeks

[date] (Pharmacy J) [initials]
Medication: 364 O-304 50mg
Timing: Weeks 27-52
Dosing: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 26 weeks`,
      "1 of 3 Installments (Weeks 1-17)":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 14 SLU-PP-332 100mcg
Timing: Weeks 1-2
Dosing: 1 pill
Frequency: Daily
Estimated Duration: 2 weeks

[date] (Pharmacy J) [initials]
Medication: 70 SLU-PP-332 200mcg
Timing: Weeks 3-8
Dosing:
- After finishing 100mcg: 1 capsule for 2 weeks
- Onwards: 2 capsules (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 6 weeks

[date] (Pharmacy J) [initials]
Medication: 63 AOD 600mcg
Timing: Weeks 9-17
Dosing: 1 troche
Frequency: Daily
Estimated Duration: 9 weeks

[date] (Pharmacy J) [initials]
Medication: 119 O-304 50mg
Timing: Weeks 9-17
Dosing:
- First 7 days: 1 cap (50mg)
- Day 8 & on: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 9 weeks`,
      "2 of 3 Installments (Weeks 18-35)":
`[date] (Pharmacy J) [initials]
Medication: 126 AOD 600mcg
Timing: Weeks 18-35
Dosing: 1 troche
Frequency: Daily
Estimated Duration: 18 weeks

[date] (Pharmacy J) [initials]
Medication: 252 O-304 50mg
Timing: Weeks 18-35
Dosing: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 18 weeks`,
      "3 of 3 Installments (Weeks 36-52)":
`[date] (Pharmacy J) [initials]
Medication: 119 AOD 600mcg
Timing: Weeks 36-52
Dosing: 1 troche
Frequency: Daily
Estimated Duration: 17 weeks

[date] (Pharmacy J) [initials]
Medication: 238 O-304 50mg
Timing: Weeks 36-52
Dosing: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 17 weeks`,
      "1 of 4 Installments (Weeks 1-8)":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 14 SLU-PP-332 100mcg
Timing: Weeks 1-2
Dosing: 1 pill
Frequency: Daily
Estimated Duration: 2 weeks

[date] (Pharmacy J) [initials]
Medication: 70 SLU-PP-332 200mcg
Timing: Weeks 3-8
Dosing:
- After finishing 100mcg: 1 capsule for 2 weeks
- Onwards: 2 capsules (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 6 weeks`,
      "2 of 4 Installments (Weeks 9-23)":
`[date] (Pharmacy J) [initials]
Medication: 105 AOD 600mcg
Timing: Weeks 9-23
Dosing: 1 troche
Frequency: Daily
Estimated Duration: 15 weeks

[date] (Pharmacy J) [initials]
Medication: 203 O-304 50mg
Timing: Weeks 9-23
Dosing:
- First 7 days: 1 cap (50mg)
- Day 8 & on: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 15 weeks`,
      "3 of 4 Installments (Weeks 24-38)":
`[date] (Pharmacy J) [initials]
Medication: 105 AOD 600mcg
Timing: Weeks 24-38
Dosing: 1 troche
Frequency: Daily
Estimated Duration: 15 weeks

[date] (Pharmacy J) [initials]
Medication: 210 O-304 50mg
Timing: Weeks 24-38
Dosing: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 15 weeks`,
      "4 of 4 Installments (Weeks 39-52)":
`[date] (Pharmacy J) [initials]
Medication: 98 AOD 600mcg
Timing: Weeks 39-52
Dosing: 1 troche
Frequency: Daily
Estimated Duration: 14 weeks

[date] (Pharmacy J) [initials]
Medication: 196 O-304 50mg
Timing: Weeks 39-52
Dosing: 2 capsules of 50mg
Frequency: Daily
Estimated Duration: 14 weeks`,
    },
// ============================================================
    // WL PEPTIDES - NEW PATIENTS (SLU-PP + AOD + O-304)
    // ============================================================
    "WL Peptides New Patient - 1 Month": {
      "Paid in Full":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 14 SLU-PP-332 100mcg
Timing: Weeks 1-2
Dosing: 1 pill
Frequency: Once Daily
Estimated Duration: 2 weeks

[date] (Pharmacy J) [initials]
Medication: 18 SLU-PP-332 200mcg
Timing: Weeks 3-4
Dosing:
- After finishing 100mcg: 1 capsule for 2 weeks
- Onwards: 2 capsules (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 2 weeks

[date] (Pharmacy J) [initials]
Medication: 30 AOD 600mcg
Timing: Daily
Dosing: 1 troche between cheek and gum. No food 2 hours before or after.
Frequency: Daily
Estimated Duration: 4 weeks

[date] (Pharmacy J) [initials]
Medication: 46 O-304 50mg
Timing: Weeks 1-4
Dosing:
- First 2 weeks: 1 pill
- Onwards: 2 pills (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 4 weeks`,
    },
    "WL Peptides New Patient - 3 Months": {
      "Paid in Full":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 14 SLU-PP-332 100mcg
Timing: Weeks 1-2
Dosing: 1 pill
Frequency: Once Daily
Estimated Duration: 2 weeks

[date] (Pharmacy J) [initials]
Medication: 138 SLU-PP-332 200mcg
Timing: Weeks 3 and on
Dosing:
- After finishing 100mcg: 1 capsule for 2 weeks
- Onwards: 2 capsules (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: Rest of 3 months

[date] (Pharmacy J) [initials]
Medication: 90 AOD 600mcg
Timing: Daily
Dosing: 1 troche between cheek and gum. No food 2 hours before or after.
Frequency: Daily
Estimated Duration: 12 weeks

[date] (Pharmacy J) [initials]
Medication: 166 O-304 50mg
Timing: Weeks 1 and on
Dosing:
- First 2 weeks: 1 pill
- Onwards: 2 pills (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 12 weeks`,
      "1 of 2 Installments (Wks 1-6)":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 14 SLU-PP-332 100mcg
Timing: Weeks 1-2
Dosing: 1 pill
Frequency: Once Daily
Estimated Duration: 2 weeks

[date] (Pharmacy J) [initials]
Medication: 42 SLU-PP-332 200mcg
Timing: Weeks 3-6
Dosing:
- After finishing 100mcg: 1 capsule for 2 weeks
- Onwards: 2 capsules (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 4 weeks

[date] (Pharmacy J) [initials]
Medication: 42 AOD 600mcg
Timing: Weeks 1-6
Dosing: 1 troche between cheek and gum. No food 2 hours before or after.
Frequency: Daily
Estimated Duration: 6 weeks

[date] (Pharmacy J) [initials]
Medication: 14 O-304 50mg
Timing: Weeks 1-2
Dosing: 1 cap in the morning
Frequency: Once Daily
Estimated Duration: 2 weeks

[date] (Pharmacy J) [initials]
Medication: 56 O-304 50mg
Timing: Weeks 3-6
Dosing: 2 caps (morning and early afternoon)
Frequency: Daily
Estimated Duration: 4 weeks`,
      "2 of 2 Installments (Wks 7-12)":
`[date] (Pharmacy J) [initials]
Medication: 96 SLU-PP-332 200mcg
Timing: Weeks 7-12
Dosing: 2 pills (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 6 weeks

[date] (Pharmacy J) [initials]
Medication: 48 AOD 600mcg
Timing: Weeks 7-12
Dosing: 1 troche between cheek and gum. No food 2 hours before or after.
Frequency: Daily
Estimated Duration: 6 weeks

[date] (Pharmacy J) [initials]
Medication: 96 O-304 50mg
Timing: Weeks 7-12
Dosing: 2 caps (morning and early afternoon)
Frequency: Daily
Estimated Duration: 6 weeks`,
    },
    "WL Peptides Existing Patient - 1 Month": {
      "Paid in Full":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 60 SLU-PP-332 200mcg
Timing: Daily
Dosing: 2 pills (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 4 weeks

[date] (Pharmacy J) [initials]
Medication: 30 AOD 600mcg
Timing: Daily
Dosing: 1 troche between cheek and gum. No food 2 hours before or after.
Frequency: Daily
Estimated Duration: 4 weeks

[date] (Pharmacy J) [initials]
Medication: 60 O-304 50mg
Timing: Daily
Dosing: 2 caps
Frequency: Daily
Estimated Duration: 4 weeks`,
    },
    "WL Peptides Existing Patient - 3 Months": {
      "Paid in Full":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 180 SLU-PP-332 200mcg
Timing: Daily
Dosing: 2 pills (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 12 weeks

[date] (Pharmacy J) [initials]
Medication: 90 AOD 600mcg
Timing: Daily
Dosing: 1 troche between cheek and gum. No food 2 hours before or after.
Frequency: Daily
Estimated Duration: 12 weeks

[date] (Pharmacy J) [initials]
Medication: 180 O-304 50mg
Timing: Daily
Dosing: 2 caps
Frequency: Daily
Estimated Duration: 12 weeks`,
      "1 of 2 Installments (Wks 1-6)":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 90 SLU-PP-332 200mcg
Timing: Weeks 1-6
Dosing: 2 pills (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 6 weeks

[date] (Pharmacy J) [initials]
Medication: 45 AOD 600mcg
Timing: Weeks 1-6
Dosing: 1 troche between cheek and gum. No food 2 hours before or after.
Frequency: Daily
Estimated Duration: 6 weeks

[date] (Pharmacy J) [initials]
Medication: 90 O-304 50mg
Timing: Weeks 1-6
Dosing: 2 caps
Frequency: Daily
Estimated Duration: 6 weeks`,
      "2 of 2 Installments (Wks 7-12)":
`[date] (Pharmacy J) [initials]
Medication: 90 SLU-PP-332 200mcg
Timing: Weeks 7-12
Dosing: 2 pills (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 6 weeks

[date] (Pharmacy J) [initials]
Medication: 45 AOD 600mcg
Timing: Weeks 7-12
Dosing: 1 troche between cheek and gum. No food 2 hours before or after.
Frequency: Daily
Estimated Duration: 6 weeks

[date] (Pharmacy J) [initials]
Medication: 90 O-304 50mg
Timing: Weeks 7-12
Dosing: 2 caps
Frequency: Daily
Estimated Duration: 6 weeks`,
      "1 of 3 Installments (Wks 1-4)":
`Products Ordered:
[date] (Pharmacy J) [initials]
Medication: 60 SLU-PP-332 200mcg
Timing: Weeks 1-4
Dosing: 2 pills (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 4 weeks

[date] (Pharmacy J) [initials]
Medication: 30 AOD 600mcg
Timing: Weeks 1-4
Dosing: 1 troche between cheek and gum. No food 2 hours before or after.
Frequency: Daily
Estimated Duration: 4 weeks

[date] (Pharmacy J) [initials]
Medication: 60 O-304 50mg
Timing: Weeks 1-4
Dosing: 2 caps
Frequency: Daily
Estimated Duration: 4 weeks`,
      "2 of 3 Installments (Wks 5-8)":
`[date] (Pharmacy J) [initials]
Medication: 60 SLU-PP-332 200mcg
Timing: Weeks 5-8
Dosing: 2 pills (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 4 weeks

[date] (Pharmacy J) [initials]
Medication: 30 AOD 600mcg
Timing: Weeks 5-8
Dosing: 1 troche between cheek and gum. No food 2 hours before or after.
Frequency: Daily
Estimated Duration: 4 weeks

[date] (Pharmacy J) [initials]
Medication: 60 O-304 50mg
Timing: Weeks 5-8
Dosing: 2 caps
Frequency: Daily
Estimated Duration: 4 weeks`,
      "3 of 3 Installments (Wks 9-12)":
`[date] (Pharmacy J) [initials]
Medication: 60 SLU-PP-332 200mcg
Timing: Weeks 9-12
Dosing: 2 pills (one in the morning & one in the early afternoon)
Frequency: Daily
Estimated Duration: 4 weeks

[date] (Pharmacy J) [initials]
Medication: 30 AOD 600mcg
Timing: Weeks 9-12
Dosing: 1 troche between cheek and gum. No food 2 hours before or after.
Frequency: Daily
Estimated Duration: 4 weeks

[date] (Pharmacy J) [initials]
Medication: 60 O-304 50mg
Timing: Weeks 9-12
Dosing: 2 caps
Frequency: Daily
Estimated Duration: 4 weeks`,
    },
  },
    // ============================================================
    // RARE ORDERS / BLENDS
    // ============================================================
    "Rare Orders/Blends": {
      // ============================================================
      // TITAN STANDARD (Glow Blend + BPC/KPV) - 3 Months
      // ============================================================
      "Titan Standard - 3 Months": {
        "Paid in Full":
`Products Ordered:
[date] 9 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]
Dosing: 30 units a day
Total Duration: 3 months

[date] 90 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 1 pill daily on empty stomach
Total Duration: 3 months`,
        "1 of 2 Installments (Wks 1-6)":
`Products Ordered:
[date] 5 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]
Dosing: 30 units a day
Total Duration: 6 weeks

[date] 42 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 1 pill daily on empty stomach
Total Duration: 6 weeks`,
        "2 of 2 Installments (Wks 7-12)":
`[date] 4 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]
Dosing: 30 units a day
Total Duration: 6 weeks

[date] 48 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 1 pill daily on empty stomach
Total Duration: 6 weeks`,
        "1 of 3 Installments (Wks 1-4)":
`Products Ordered:
[date] 3 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]
Dosing: 30 units a day
Total Duration: 1 month

[date] 30 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 1 pill daily on empty stomach
Total Duration: 1 month`,
        "2 of 3 Installments (Wks 5-8)":
`[date] 3 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]
Dosing: 30 units a day
Total Duration: 1 month

[date] 30 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 1 pill daily on empty stomach
Total Duration: 1 month`,
        "3 of 3 Installments (Wks 9-12)":
`[date] 3 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]
Dosing: 30 units a day
Total Duration: 1 month

[date] 30 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 1 pill daily on empty stomach
Total Duration: 1 month`,
        "1 of 4 Installments (Wks 1-3)":
`Products Ordered:
[date] 2 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]
Dosing: 30 units a day
Total Duration: 3 weeks

[date] 21 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 1 pill daily on empty stomach
Total Duration: 3 weeks`,
        "2 of 4 Installments (Wks 4-6)":
`[date] 3 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]
Dosing: 30 units a day
Total Duration: 3 weeks

[date] 21 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 1 pill daily on empty stomach
Total Duration: 3 weeks`,
        "3 of 4 Installments (Wks 7-9)":
`[date] 2 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]
Dosing: 30 units a day
Total Duration: 3 weeks

[date] 21 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 1 pill daily on empty stomach
Total Duration: 3 weeks`,
        "4 of 4 Installments (Wks 10-12)":
`[date] 2 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]
Dosing: 30 units a day
Total Duration: 3 weeks

[date] 27 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 1 pill daily on empty stomach
Total Duration: 3 weeks`,
      },
      // ============================================================
      // TITAN STRONG (Glow Blend Strong + BPC/KPV) - 3 Months
      // ============================================================
      "Titan Strong - 3 Months": {
        "Paid in Full":
`Products Ordered:
[date] 18 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]
Dosing: 60 units a day
Total Duration: 3 months

[date] 90 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 1 pill daily on empty stomach
Total Duration: 3 months`,
        "1 of 2 Installments (Wks 1-6)":
`Products Ordered:
[date] 9 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]
Dosing: 60 units a day
Total Duration: 6 weeks

[date] 42 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 1 pill daily on empty stomach
Total Duration: 6 weeks`,
        "2 of 2 Installments (Wks 7-12)":
`[date] 9 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]
Dosing: 60 units a day
Total Duration: 6 weeks

[date] 48 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 1 pill daily on empty stomach
Total Duration: 6 weeks`,
      },
      // ============================================================
      // RESTORE THE CORE (BPC/KPV + Larazotide) - 3 Months
      // ============================================================
      "Restore the Core - 3 Months": {
        "Paid in Full":
`Products Ordered:
[date] 180 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 2 pills daily on empty stomach
Total Duration: 3 months

[date] 180 capsules Larazotide 500mcg (Pharmacy K) [initials]
Dosing: 2 capsules daily
Total Duration: 3 months`,
        "1 of 2 Installments (Wks 1-6)":
`Products Ordered:
[date] 90 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 2 pills daily on empty stomach
Total Duration: 6 weeks

[date] 84 capsules Larazotide 500mcg (Pharmacy K) [initials]
Dosing: 2 capsules daily
Total Duration: 6 weeks`,
        "2 of 2 Installments (Wks 7-12)":
`[date] 90 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 2 pills daily on empty stomach
Total Duration: 6 weeks

[date] 96 capsules Larazotide 500mcg (Pharmacy K) [initials]
Dosing: 2 capsules daily
Total Duration: 6 weeks`,
        "1 of 3 Installments (Wks 1-4)":
`Products Ordered:
[date] 60 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 2 pills daily on empty stomach
Total Duration: 1 month

[date] 60 capsules Larazotide 500mcg (Pharmacy K) [initials]
Dosing: 2 capsules daily
Total Duration: 1 month`,
        "2 of 3 Installments (Wks 5-8)":
`[date] 60 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 2 pills daily on empty stomach
Total Duration: 1 month

[date] 60 capsules Larazotide 500mcg (Pharmacy K) [initials]
Dosing: 2 capsules daily
Total Duration: 1 month`,
        "3 of 3 Installments (Wks 9-12)":
`[date] 60 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 2 pills daily on empty stomach
Total Duration: 1 month

[date] 60 capsules Larazotide 500mcg (Pharmacy K) [initials]
Dosing: 2 capsules daily
Total Duration: 1 month`,
      },
      // ============================================================
      // HEAL & BLOOM (BPC/KPV + LDN) - 3 Months [MD Call Required]
      // ============================================================
      "Heal & Bloom - 3 Months [MD Call Required]": {
        "Paid in Full":
`Products Ordered:
[date] 180 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 2 pills daily on empty stomach
Total Duration: 3 months

[date] LDN (Pharmacy F) [initials]
Dosing: Per medical direction
Total Duration: 3 months`,
        "1 of 2 Installments (Wks 1-6)":
`Products Ordered:
[date] 90 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 2 pills daily on empty stomach
Total Duration: 6 weeks

[date] LDN (Pharmacy F) [initials]
Dosing: Per medical direction
Total Duration: 6 weeks`,
        "2 of 2 Installments (Wks 7-12)":
`[date] 90 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 2 pills daily on empty stomach
Total Duration: 6 weeks

[date] LDN (Pharmacy F) [initials]
Dosing: Per medical direction
Total Duration: 6 weeks`,
      },
      // ============================================================
      // CONTROL & CONQUER (BPC/KPV + LDN + TA-1) - 3 Months [MD Call Required]
      // ============================================================
      "Control & Conquer - 3 Months [MD Call Required]": {
        "Paid in Full":
`Products Ordered:
[date] 180 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 2 pills daily
Total Duration: 3 months

[date] LDN (Pharmacy F) [initials]
Dosing: Per medical direction
Total Duration: 3 months

[date] 3 vials of 5mL Thymosin Alpha-1 3mg/mL (Pharmacy B) [initials]
Dosing: 15 units (0.45mg) daily
Total Duration: 3 months`,
        "1 of 2 Installments (Wks 1-6)":
`Products Ordered:
[date] 90 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 2 pills daily
Total Duration: 6 weeks

[date] LDN (Pharmacy F) [initials]
Dosing: Per medical direction
Total Duration: 6 weeks

[date] 2 vials of 5mL Thymosin Alpha-1 3mg/mL (Pharmacy B) [initials]
Dosing: 15 units (0.45mg) daily
Total Duration: 6 weeks`,
        "2 of 2 Installments (Wks 7-12)":
`[date] 90 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 2 pills daily
Total Duration: 6 weeks

[date] LDN (Pharmacy F) [initials]
Dosing: Per medical direction
Total Duration: 6 weeks

[date] 1 vial of 5mL Thymosin Alpha-1 3mg/mL (Pharmacy B) [initials]
Dosing: 15 units (0.45mg) daily
Total Duration: 6 weeks`,
        "1 of 3 Installments (Wks 1-4)":
`Products Ordered:
[date] 60 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 2 pills daily
Total Duration: 1 month

[date] LDN (Pharmacy F) [initials]
Dosing: Per medical direction
Total Duration: 1 month

[date] 1 vial of 5mL Thymosin Alpha-1 3mg/mL (Pharmacy B) [initials]
Dosing: 15 units (0.45mg) daily
Total Duration: 1 month`,
        "2 of 3 Installments (Wks 5-8)":
`[date] 60 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 2 pills daily
Total Duration: 1 month

[date] LDN (Pharmacy F) [initials]
Dosing: Per medical direction
Total Duration: 1 month

[date] 1 vial of 5mL Thymosin Alpha-1 3mg/mL (Pharmacy B) [initials]
Dosing: 15 units (0.45mg) daily
Total Duration: 1 month`,
        "3 of 3 Installments (Wks 9-12)":
`[date] 60 BPC/KPV 500/500mcg (Pharmacy J) [initials]
Dosing: 2 pills daily
Total Duration: 1 month

[date] LDN (Pharmacy F) [initials]
Dosing: Per medical direction
Total Duration: 1 month

[date] 1 vial of 5mL Thymosin Alpha-1 3mg/mL (Pharmacy B) [initials]
Dosing: 15 units (0.45mg) daily
Total Duration: 1 month`,
      },
      // ============================================================
      // CLEAR & CONFIDENT (Semax + Selank) - 3 Months
      // ============================================================
      "Clear & Confident - 3 Months": {
        "Paid in Full":
`Products Ordered:
[date] 3 Semax Nasal Spray 7.5mg/ml 6mL (Pharmacy J) [initials]
Dosing: 1 spray per nostril/daily up to 3x day
Total Duration: 3 months

[date] 3 Selank Nasal Spray 7.5mg/ml 6mL (Pharmacy J) [initials]
Dosing: 1 spray per nostril/daily up to 3x day
Total Duration: 3 months`,
        "1 of 2 Installments (Wks 1-6)":
`Products Ordered:
[date] 2 Semax Nasal Spray 7.5mg/ml 6mL (Pharmacy J) [initials]
Dosing: 1 spray per nostril/daily up to 3x day
Total Duration: 6 weeks

[date] 2 Selank Nasal Spray 7.5mg/ml 6mL (Pharmacy J) [initials]
Dosing: 1 spray per nostril/daily up to 3x day
Total Duration: 6 weeks`,
        "2 of 2 Installments (Wks 7-12)":
`[date] 1 Semax Nasal Spray 7.5mg/ml 6mL (Pharmacy J) [initials]
Dosing: 1 spray per nostril/daily up to 3x day
Total Duration: 6 weeks

[date] 1 Selank Nasal Spray 7.5mg/ml 6mL (Pharmacy J) [initials]
Dosing: 1 spray per nostril/daily up to 3x day
Total Duration: 6 weeks`,
      },
      // ============================================================
      // SHARP FOR LIFE (Dihexa + Synapsin) - 3 Months
      // ============================================================
      "Sharp for Life - 3 Months": {
        "Paid in Full":
`Products Ordered:
[date] 90 Dihexa 20mg (Pharmacy J) [initials]
Dosing: 1 pill daily
Total Duration: 3 months

[date] 1 vial of 30mL Synapsin 2/50 mg/mL (Pharmacy C) [initials]
Dosing: 1 spray per nostril once a day
Total Duration: 4 months`,
        "1 of 2 Installments (Wks 1-6)":
`Products Ordered:
[date] 42 Dihexa 20mg (Pharmacy J) [initials]
Dosing: 1 pill daily
Total Duration: 6 weeks

[date] 1 vial of 15mL Synapsin 2/50 mg/mL (Pharmacy C) [initials]
Dosing: 1 spray per nostril once a day
Total Duration: 2 months`,
        "2 of 2 Installments (Wks 7-12)":
`[date] 48 Dihexa 20mg (Pharmacy J) [initials]
Dosing: 1 pill daily
Total Duration: 6 weeks

[date] 1 vial of 15mL Synapsin 2/50 mg/mL (Pharmacy C) [initials]
Dosing: 1 spray per nostril once a day
Total Duration: 2 months`,
      },
      // ============================================================
      // FORGE (MOTS-c + CJC/IPA) [Labs: IGF/Prolactin]
      // ============================================================
      "Forge [Labs: IGF/Prolactin]": {
        "Paid in Full (MOTS-c 2mo + CJC/IPA 4mo)":
`Products Ordered:
[date] 8 kits of 10mg CB4211 (Pharmacy C) [initials]
Dosing: Reconstitute with 1mL BAC water then inject 0.5mL (50 units) subcutaneously twice weekly
Total Duration: 2 months

[date] 2 vials of 6mL CJC/IPA 1.5mg/2.5mg/mL (Pharmacy A) [initials]
Dosing: 7 units 2x/day, 5 days on and 2 days off
Total Duration: 4 months
*we will order another vial in 6 weeks`,
        "1 of 2 Installments (MOTS-c)":
`Products Ordered:
[date] 8 kits of 10mg CB4211 (Pharmacy C) [initials]
Dosing: Reconstitute with 1mL BAC water then inject 0.5mL (50 units) subcutaneously twice weekly
Total Duration: 2 months`,
        "2 of 2 Installments (CJC/IPA)":
`[date] 2 vials of 6mL CJC/IPA 1.5mg/2.5mg/mL (Pharmacy A) [initials]
Dosing: 7 units 2x/day, 5 days on and 2 days off
Total Duration: 4 months
*we will order another vial in 6 weeks`,
      },
      // ============================================================
      // PHARMACY B (MOTS-c + Tesa) [Labs: IGF/Prolactin]
      // ============================================================
      "Pharmacy B [Labs: IGF/Prolactin] (+C if with GLP)": {
        "Paid in Full (MOTS-c 2mo + Tesa 3mo)":
`Products Ordered:
[date] 8 kits of 10mg CB4211 (Pharmacy C) [initials]
Dosing: Reconstitute with 1mL BAC water then inject 0.5mL (50 units) subcutaneously twice weekly
Total Duration: 2 months

[date] 3 vials of 3mL Tesa 8mg/mL (Pharmacy B) [initials]
Dosing: Inject 12 units subcutaneously, 5 days on, 2 days off
Total Duration: 3 months`,
        "1 of 2 Installments (MOTS-c)":
`Products Ordered:
[date] 8 kits of 10mg CB4211 (Pharmacy C) [initials]
Dosing: Reconstitute with 1mL BAC water then inject 0.5mL (50 units) subcutaneously twice weekly
Total Duration: 2 months`,
        "2 of 2 Installments (Tesa)":
`[date] 3 vials of 3mL Tesa 8mg/mL (Pharmacy B) [initials]
Dosing: Inject 12 units subcutaneously, 5 days on, 2 days off
Total Duration: 3 months`,
      },
    }, // END Rare Orders/Blends
  // ================================================================
  // HH/JD COMM LOGS
  // ================================================================
  "HH/JD Comm Logs": {
    "WL Approval": {
      "Retatrutide (2mg -> 4mg)":
`Pt is cleared for the WL program. No history of thyroid cancer or pancreatic issues. Pt has no active conditions and consents have been signed. Pt will be starting at the starting dose of 2mg, then titrating up to 4mg if needed per standing order. No Reta contraindications. [initials]

Allergies:
Medications:

CW:
GW:
Height:
BMI:

BP reading:`,
      "Semaglutide (0.25mg -> 0.5mg)":
`Pt is cleared for the WL program. No history of thyroid cancer or pancreatic issues. Pt has no active conditions and consents have been signed. Pt will be starting at the starting dose of 0.25mg, then titrating up to 0.5mg if needed per standing order. [initials]

Allergies:
Medications:

CW:
GW:
Height:
BMI:

BP reading:`,
      "Tirzepatide (2.5mg -> 5mg)":
`Pt is cleared for the WL program. No history of thyroid cancer or pancreatic issues. Pt has no active conditions and consents have been signed. Pt will be starting at the starting dose of 2.5mg, then titrating up to 5mg if needed per standing order. [initials]

Allergies:
Medications:

CW:
GW:
Height:
BMI:

BP reading:`,
    },
    "WL Continuation":
`Pt is cleared to continue with the WL program. No medical updates or changes. [initials]

Allergies:
Medications:

CW:
GW:
Height:
BMI:

Pt is currently injecting: ___ mg ___ units.`,
    "Patient Calls & Education": {
      "Tirzepatide Dosing Entry":
`The patient was verbally educated on proper dosing and administration technique for Tirzepatide. The patient demonstrated understanding of the prescribed dose and was able to identify the correct marking on the syringe corresponding to the dosing amount.

Instructions included:
- Drawing up the medication to the exact dose indicated by the directions given.
- Inject ____ mg ( ___ units)
- Ensuring to draw the medication slowly and avoid air bubbles in the syringe.
- Confirming the drawn volume against the syringe markings before injection.
- Storing medication as recommended and using proper injection technique to minimize discomfort.

The patient was given the opportunity to ask questions and verbalized understanding of the dosing instructions and syringe usage. No concerns were expressed at this time. Will continue to monitor adherence and technique at follow-up visits. [initials]`,
      "LDN Call":
`The patient presents today for the use of LDN alongside their program.

Allergies:
Alcohol:
Opioids:

Pt feels their inflammation stems from _______________________________________________.

Dosing instructions were provided to the patient, and all questions/concerns were addressed. [initials]`,
      "Peptides Call":
`Discussed current peptide regimen, recent dosing schedule, and reported effects. Reviewed possible adjustments and reinforced storage/administration instructions. Patient verbalized understanding and all questions/concerns have been answered. [initials]`,
    },
  },
  // ================================================================
  // UTILITIES
  // ================================================================
  "Utilities": {
    "Supplies":
`[date] xx pcs Syr xx cc + alcopads Supplies (Pharmacy A) [initials]`,
    "Care plan complete": "Care plan complete",
    "Date Shipped and Tracking Number":
`Date Shipped: [date]
TN: UPS - xxxxxxxxxxxxxxx`,
  },
  // ================================================================
  // TASK UPDATES
  // ================================================================
  "Task Updates": {
    "Payment & Admin": {
      "No payment yet":
`[date] no payment yet [initials]`,
      "PPW not yet signed":
`[date] PPW not yet signed [initials]`,
    },
    "Next Vial Confirmation": {
      "Sent SMS - can receive?":
`[date] sent sms if Pt can rcv [initials]`,
      "No reply from SMS yet":
`[date] no reply from sms yet [initials]`,
    },
    "Labs": {
      "No labs yet":
`[date] no labs yet [initials]`,
      "No labs yet - reminder triggered":
`[date] no labs yet, triggered the reminder automation [initials]`,
      "Still no labs":
`[date] still no labs [initials]`,
      "Partials are in":
`[date] partials are in [initials]`,
      "Labs on requisition ready":
`[date] labs still on requisition ready [initials]`,
      "Labs sent to Laura":
`[date] labs sent to Laura [initials]`,
      "Waiting for Laura's approval":
`[date] waiting for Laura's approval [initials]`,
      "Good to order":
`[date] Good to order [initials]`,
    },
    "Med Call": {
      "No show on med call":
`[date] no show on med call [initials]`,
      "Check for updates":
`[date] check sms, notes, GHL, email for updates [initials]`,
    },
    "Refills": {
      "LDN refill - eligible for new Rx":
`[date] sent sms if pt wants LDN refill, eligible for new rx [initials]`,
    },
    "Shipping": {
      "Ship on/within date range":
`[date] need to be ship on/within xx - xx [initials]`,
      "Pt out of town":
`[date] Pt will be out of town on xx [initials]`,
    },
  },
};
GM_addStyle(`
    :root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}
    #tmenu-fab, #tmenu-root, .tmenu-ul, .tmenu-li, .tmenu-item, .tmenu-toast, #tmenu-preview,
    .tmenu-search-input, .tmenu-section-header, .tmenu-recent-dot,
    #tmenu-searchbox, #tmenu-searchinput {
      all: initial; box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #tmenu-fab {
      display: inline-flex !important; align-items: center !important; justify-content: center !important;
      position: relative !important; top: auto !important; left: auto !important;
      width: 32px !important; height: 32px !important; border-radius: 8px !important;
      background: var(--ds-accent, #aecbfa) !important; color: var(--ds-accent-text, #174ea6) !important; font-size: 15px !important;
      line-height: 1 !important; cursor: pointer !important; z-index: 2147483646 !important;
      margin-left: 10px !important; flex-shrink: 0 !important;
      transition: background .15s ease !important;
      user-select: none !important; -webkit-user-select: none !important;
    }
    #tmenu-fab:hover { filter: brightness(0.95); }
    /* Fallback if the Zoho top panel isn't found: keep the old floating pill so
       the button is still reachable instead of vanishing into the page flow. */
    #tmenu-fab.tmenu-fab-fallback {
      position: fixed !important; top: 10px !important; left: 10px !important;
      width: 48px !important; height: 48px !important; border-radius: 100% !important;
      font-size: 20px !important; margin-left: 0 !important;
    }
    #tmenu-root { position: fixed !important; z-index: 2147483647 !important; }
    .tmenu-ul {
      display: block !important; list-style: none !important; margin: 0 !important; padding: 4px 0 !important;
      background: #fff !important; border: 1px solid rgba(0,0,0,.12) !important; border-radius: 8px !important;
      min-width: 220px !important; max-width: 340px !important;
      box-shadow: 0 4px 16px rgba(0,0,0,.18) !important;
    }
    .tmenu-li { position: relative !important; display: block !important; }
    .tmenu-li > .tmenu-ul {
      display: none !important; position: absolute !important; top: -4px; left: 100%;
    }
    .tmenu-li:hover > .tmenu-ul { display: block !important; }
    .tmenu-item {
      display: flex !important; align-items: center !important; justify-content: space-between !important;
      padding: 8px 14px !important; font-size: 13px !important; color: #202124 !important;
      cursor: pointer !important; white-space: nowrap !important; overflow: hidden !important;
      text-overflow: ellipsis !important; max-width: 100% !important;
    }
    .tmenu-item:hover {
      background: #f1f3f4 !important;
    }
    .tmenu-item.tmenu-back {
      color: #5f6368 !important; font-size: 12px !important;
    }
    .tmenu-item.tmenu-back:hover {
      color: #202124 !important;
    }
    .tmenu-ul.tmenu-drill {
      width: min(300px, calc(100vw - 20px)) !important;
      min-width: auto !important;
      max-height: min(70vh, 560px) !important;
      overflow-y: auto !important;
    }
    .tmenu-arrow { font-size: 10px !important; opacity: .5 !important; flex-shrink: 0 !important; margin-left: 8px !important; }
    .tmenu-sep { height: 1px !important; background: rgba(0,0,0,.08) !important; margin: 4px 0 !important; }
    .tmenu-toast {
      display: block !important; position: fixed !important; top: auto !important; left: auto !important;
      background: #323232 !important; color: #fff !important; font-size: 13px !important;
      padding: 10px 18px !important; border-radius: 6px !important; z-index: 2147483647 !important;
      opacity: 0 !important; pointer-events: none !important; max-width: calc(100vw - 24px) !important;
    }
    .tmenu-toast.visible { opacity: 1 !important; }
    #tmenu-preview {
      position: fixed !important; z-index: 2147483647 !important; background: #fff !important;
      border: 1px solid rgba(0,0,0,.12) !important; border-radius: 8px !important;
      padding: 12px !important; font-size: 12px !important; color: #202124 !important;
      max-width: min(90vw, 340px) !important; width: auto !important;
      height: auto !important; max-height: none !important; overflow: visible !important;
      white-space: pre-wrap !important; word-wrap: break-word !important;
      pointer-events: none !important; display: none !important; line-height: 1.4 !important;
      box-shadow: 0 4px 16px rgba(0,0,0,.18) !important;
    }
    #tmenu-preview.visible { display: block !important; }
    .tmenu-li.tmenu-kb-open > .tmenu-ul { display: block !important; }
    .tmenu-item.tmenu-kb-active { background: #aecbfa !important; }
    .tmenu-num {
      display: inline-block !important;
      flex-shrink: 0 !important;
      min-width: 1.4em !important;
      margin-right: 8px !important;
      text-align: right !important;
      color: #80868b !important;
      font-size: 11px !important;
      font-variant-numeric: tabular-nums !important;
    }
    .tmenu-search-row { padding: 4px 10px 6px !important; }
    .tmenu-search-input {
      display: block !important; width: 100% !important; box-sizing: border-box !important;
      padding: 6px 10px !important; font-size: 12px !important; border-radius: 4px !important;
      border: 1px solid rgba(0,0,0,.2) !important; outline: none !important; background: #fff !important;
      color: #202124 !important; cursor: text !important; line-height: 1.3 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    }
    .tmenu-search-input:focus { border-color: #1a73e8 !important; }
    .tmenu-section-header {
      display: block !important; padding: 4px 14px !important; font-size: 10px !important;
      text-transform: uppercase !important; letter-spacing: .04em !important;
      color: #80868b !important; cursor: default !important;
    }
    .tmenu-recent-dot {
      display: inline-block !important; color: #1a73e8 !important; font-size: 8px !important;
      margin-left: 6px !important; flex-shrink: 0 !important;
    }
    #tmenu-searchbox {
      display: block !important; box-sizing: border-box !important;
      width: 100% !important; margin: 8px 0 10px 0 !important; clear: both !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    }
    #tmenu-searchinput {
      box-sizing: border-box !important; display: block !important;
      width: 100% !important; padding: 8px 12px !important; font-size: 13px !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      color: #202124 !important; background: #fff !important; cursor: text !important;
      border: 1px solid #1a73e8 !important; border-radius: 8px !important; outline: none !important;
    }
    #tmenu-searchinput::placeholder { color: #80868b !important; }
    #tmenu-searchinput:focus { box-shadow: 0 0 0 2px rgba(26,115,232,.2) !important; }
    #tmenu-replacer-row {
      /* v6.6: Date & Initials Replacer row hidden per Jeyson — feature retired from
         the UI, but kept in the DOM (display:none only) so the manual button
         handlers and the [date]/[initials] insert-path token replacement stay
         intact and can be un-hidden later without a JS change. */
      display: none !important;
    }
    #tmenu-replacer-row button {
      border: none !important; background: none !important; padding: 2px 6px !important;
      font-size: 12px !important; color: #1a73e8 !important; cursor: pointer !important;
      border-radius: 4px !important; display: inline-flex !important; align-items: center !important;
      gap: 3px !important; font-family: inherit !important; line-height: 1.4 !important;
    }
    #tmenu-replacer-row button:hover { background: #e8f0fe !important; }
    #tmenu-replacer-row .tmenu-replacer-sep { color: #dadce0 !important; font-size: 12px !important; }
  `);
  // ============================================================
  // SECTION 2: TEMPLATE OVERRIDES (local edits persisted via GM storage)
  // ============================================================
  function loadOverrides() { return GM_getValue('templateOverrides', {}); }
  function saveOverrides(overrides) { GM_setValue('templateOverrides', overrides); }

  function applyOverrides(node, pathArr, overrides) {
    const out = {};
    Object.entries(node).forEach(([key, value]) => {
      const path = pathArr.concat(key);
      if (typeof value === 'string') {
        const pathKey = path.join('::');
        out[key] = Object.prototype.hasOwnProperty.call(overrides, pathKey) ? overrides[pathKey] : value;
      } else {
        out[key] = applyOverrides(value, path, overrides);
      }
    });
    return out;
  }

  let TEMPLATES;
  let flatIndexCache = null;
  // v6.33 perf: with no local edits there is nothing to apply, so take the
  // shared tree by reference. applyOverrides used to deep-clone all ~1,200
  // leaves (every string, every path array) on every tab load for nothing.
  function rebuildTemplates() {
    const overrides = loadOverrides();
    TEMPLATES = Object.keys(overrides).length
      ? applyOverrides(DEFAULT_TEMPLATES, [], overrides)
      : DEFAULT_TEMPLATES;
    flatIndexCache = null;
  }
  rebuildTemplates();

  function setTemplateOverride(path, text) {
    const overrides = loadOverrides();
    overrides[path.join('::')] = text;
    saveOverrides(overrides);
    rebuildTemplates();
    flatIndexCache = null;
  }
  function resetTemplateOverrides() {
    saveOverrides({});
    rebuildTemplates();
    flatIndexCache = null;
    showToast('✅ Template edits reset to defaults');
  }
  function exportTemplateOverrides() {
    const json = JSON.stringify(loadOverrides(), null, 2);
    try { GM_setClipboard(json, 'text'); showToast('✅ Overrides JSON copied to clipboard'); }
    catch (_) { prompt('Copy your template overrides JSON:', json); }
  }
  function importTemplateOverrides() {
    const input = prompt('Paste template overrides JSON to import (replaces current overrides):');
    if (!input) return;
    try {
      const parsed = JSON.parse(input);
      saveOverrides(parsed);
      rebuildTemplates();
      flatIndexCache = null;
      showToast('✅ Overrides imported');
    } catch (err) { alert('Invalid JSON: ' + err.message); }
  }

  function editTemplateLeaf(path, label, currentText) {
    const edited = prompt(`Edit template: ${label}\n\n(Cancel to leave unchanged. [date]/[initials] placeholders still work.)`, currentText);
    if (edited == null || edited === currentText) return;
    setTemplateOverride(path, edited);
    showToast('✅ Template updated locally');
    if (menuRoot) {
      if (drillDownMode) renderDrillLevel(TEMPLATES, null, false);
      else { while (menuRoot.firstChild) menuRoot.firstChild.remove(); menuRoot.appendChild(buildMenuList(TEMPLATES, true)); }
    }
  }

  // ============================================================
  // SECTION 2.5: RECENT TEMPLATES
  // ============================================================
  const RECENT_LIMIT = 10;
  // v6.33 perf: isRecentPath() read GM storage once PER LEAF rendered, so one
  // drill-down cost a dozen-plus synchronous storage round-trips. One cached
  // read, invalidated whenever the list is written.
  let recentCache = null; // { list, keys:Set }
  function getRecentList() {
    if (!recentCache) {
      const list = GM_getValue('recentTemplates', []);
      recentCache = { list, keys: new Set(list.map(r => r.pathKey)) };
    }
    return recentCache.list;
  }
  function trackRecent(path, text, isTaskUpdate) {
    if (!path || !path.length) return;
    const pathKey = path.join('::');
    const label = path.join(' › ');
    const recent = getRecentList().filter(r => r.pathKey !== pathKey);
    recent.unshift({ pathKey, path, label, text, isTaskUpdate });
    GM_setValue('recentTemplates', recent.slice(0, RECENT_LIMIT));
    recentCache = null;
  }
  function isRecentPath(path) {
    if (!path || !path.length) return false;
    getRecentList(); // ensure the cache exists
    return !!recentCache && recentCache.keys.has(path.join('::'));
  }
  function clearRecentHistory() {
    GM_setValue('recentTemplates', []);
    recentCache = null;
    showToast('✅ Recent history cleared');
  }

  // ============================================================
  // SECTION 2.7: SEARCH
  // ============================================================
  function flattenTemplates(node, pathArr, isTaskUpdate) {
    let out = [];
    Object.entries(node).forEach(([key, value]) => {
      const path = pathArr.concat(key);
      const nextTaskUpdate = isTaskUpdate || key === 'Task Updates';
      if (typeof value === 'string') {
        // v6.33 perf: the lowercase forms are computed once per index build.
        // getSearchMatches used to lower-case every leaf's label AND its whole
        // multi-hundred-character block on every keystroke (~1 MB of string
        // churn per keystroke) to arrive at the same answer each time.
        out.push({ path, label: path.join(' › '), text: value,
                   lcLabel: path.join(' › ').toLowerCase(), lcText: value.toLowerCase(),
                   isTaskUpdate: nextTaskUpdate });
      } else {
        out = out.concat(flattenTemplates(value, path, nextTaskUpdate));
      }
    });
    return out;
  }
  function getFlatIndex() {
    if (!flatIndexCache) flatIndexCache = flattenTemplates(TEMPLATES, [], false);
    return flatIndexCache;
  }
  function getSearchMatches(query) {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return getFlatIndex()
      .filter(entry => entry.lcLabel.includes(q) || entry.lcText.includes(q))
      .slice(0, 60);
  }

  // ============================================================
  // SECTION 3: STATE
  // ============================================================
  let menuRoot = null, fabEl = null, toastEl = null, toastTimer = null;
  let lastFocused = null, previewEl = null;
  let fabWatcher = null, fabWatcherTimer = null, fabHost = null, fabReinjectQueued = false;
  let menuStack = [], drillDownMode = false;
  let currentSearchQuery = '';
  // 'dynamic' = auto-switch at 1200 | 'drilldown' = always drill-down | 'flyout' = always flyout
  let menuMode = GM_getValue('menuMode', 'dynamic');

  // Anchored search box (embedded directly next to a known CRM field, e.g. Tasks
  // description / CustomModule32), separate from the FAB-opened dropdown's own
  // in-menu search row.
  let searchBoxEl = null, searchInputEl = null, anchorObserver = null, widthSourceEl = null;
  let anchorTimer = null, resizeBound = false, searchRenderFrame = null;
  let replacerRowEl = null;
  let anchorReinjectQueued = false;
  let searchBoxDriven = false; // true while the dropdown is being driven by the anchored box

  // ============================================================
  // SECTION 4: BUILD MENU DOM
  // ============================================================

  // --- Shared: numbering, leaf items, search row, recent list ---
  function renumberLevel(ul) {
    kbNavigableItems(ul).forEach((entry, i) => {
      const num = entry.item.querySelector('.tmenu-num');
      if (num) num.textContent = String(i + 1);
    });
  }

  function buildLeafItem(label, text, isTaskUpdate, path) {
    const li = document.createElement('li');
    li.className = 'tmenu-li';
    const item = document.createElement('div');
    item.className = 'tmenu-item';
    const num = document.createElement('span');
    num.className = 'tmenu-num';
    item.appendChild(num);
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    labelSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
    item.appendChild(labelSpan);
    if (path && path.length && isRecentPath(path)) {
      const dot = document.createElement('span');
      dot.className = 'tmenu-recent-dot';
      dot.textContent = '●';
      dot.title = 'Recently used';
      item.appendChild(dot);
    }
    item.dataset.tmenuText = text;
    item.addEventListener('mouseenter', (e) => showPreview(e, text));
    item.addEventListener('mouseleave', hidePreview);
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      hidePreview();
      if (path && path.length) trackRecent(path, text, isTaskUpdate);
      handleTemplateClick(text, isTaskUpdate);
    });
    if (path && path.length) {
      // Right-click to edit — a left dblclick would race with the single-click
      // insert-and-close-menu behavior above (the menu is gone before a 2nd click lands).
      item.addEventListener('contextmenu', (e) => {
        e.stopPropagation();
        e.preventDefault();
        editTemplateLeaf(path, label, text);
      });
    }
    li.appendChild(item);
    return li;
  }

  function buildSearchRow() {
    const li = document.createElement('li');
    li.className = 'tmenu-li tmenu-search-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'tmenu-search-input';
    input.placeholder = '🔍 Search templates…';
    input.value = currentSearchQuery;
    input.addEventListener('input', (e) => {
      const q = e.target.value.trim();
      const cursor = e.target.selectionStart;
      if (q === currentSearchQuery) return; // same query, same tree — no re-render
      currentSearchQuery = q;
      // v6.33 perf: one re-render per frame, not one per keystroke. A fast
      // typist used to pay a full menu teardown + rebuild per character.
      if (searchRenderFrame) cancelAnimationFrame(searchRenderFrame);
      searchRenderFrame = requestAnimationFrame(() => {
        searchRenderFrame = null;
        rerenderRootAfterSearch(cursor);
      });
    });
    li.appendChild(input);
    return li;
  }

  function appendRecentItems(ul) {
    const recent = getRecentList();
    if (!recent.length) return;
    const header = document.createElement('li');
    header.className = 'tmenu-li tmenu-section-header';
    header.textContent = '🕐 Recent';
    ul.appendChild(header);
    recent.forEach(r => ul.appendChild(buildLeafItem(r.label, r.text, r.isTaskUpdate, r.path)));
    const sep = document.createElement('li');
    sep.className = 'tmenu-sep';
    ul.appendChild(sep);
  }

  function renderFlatResults(ul, matches) {
    if (!matches.length) {
      const empty = document.createElement('li');
      empty.className = 'tmenu-li tmenu-section-header';
      empty.textContent = 'No matches';
      ul.appendChild(empty);
      return;
    }
    matches.forEach(m => ul.appendChild(buildLeafItem(m.label, m.text, m.isTaskUpdate, m.path)));
  }

  function rerenderRootAfterSearch(cursorPos) {
    if (!menuRoot) return;
    if (drillDownMode) {
      renderDrillLevel(TEMPLATES, null, false);
    } else {
      while (menuRoot.firstChild) menuRoot.firstChild.remove();
      menuRoot.appendChild(buildMenuList(TEMPLATES, true));
    }
    const newInput = menuRoot.querySelector('.tmenu-search-input');
    if (newInput) {
      newInput.focus();
      if (cursorPos != null) { try { newInput.setSelectionRange(cursorPos, cursorPos); } catch(_) { console.warn('[TMenu]', _); } }
    }
  }

  // --- Flyout mode (wide viewports), submenus are lazily built on first hover ---
  function buildMenuList(node, isRoot = false, isTaskUpdate = false, pathArr = []) {
    const ul = document.createElement('ul');
    ul.className = 'tmenu-ul';

    if (isRoot) {
      ul.appendChild(buildSearchRow());
      if (currentSearchQuery) {
        renderFlatResults(ul, getSearchMatches(currentSearchQuery));
        renumberLevel(ul);
        return ul;
      }
      appendRecentItems(ul);
    }

    Object.entries(node).forEach(([key, value]) => {
      const path = pathArr.concat(key);
      if (typeof value === 'object' && value !== null) {
        const li = document.createElement('li');
        li.className = 'tmenu-li';
        const item = document.createElement('div');
        item.className = 'tmenu-item';
        const num = document.createElement('span');
        num.className = 'tmenu-num';
        item.appendChild(num);
        const label = document.createElement('span');
        label.textContent = key;
        label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
        item.appendChild(label);
        const arrow = document.createElement('span');
        arrow.className = 'tmenu-arrow';
        arrow.textContent = '▶';
        item.appendChild(arrow);
        li.appendChild(item);

        const childIsTaskUpdate = isTaskUpdate || key === 'Task Updates';
        let subList = null;
        const ensureSubList = () => {
          if (!subList) {
            subList = buildMenuList(value, false, childIsTaskUpdate, path);
            li.appendChild(subList);
          }
          return subList;
        };
        li._tmenuEnsureSub = ensureSubList;
        li.addEventListener('mouseenter', () => repositionSubmenu(li, ensureSubList()));
        ul.appendChild(li);
      } else {
        ul.appendChild(buildLeafItem(key, String(value), isTaskUpdate, path));
      }
    });
    renumberLevel(ul);
    return ul;
  }

  function repositionSubmenu(li, subList) {
    // Reset to default right-side position for measurement
    subList.style.left = '100%';
    subList.style.right = 'auto';
    subList.style.top = '-4px';
    subList.style.bottom = 'auto';
    subList.style.display = 'block';

    const rect = subList.getBoundingClientRect();
    const liRect = li.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const pad = 8;
    const subWidth = rect.width;
    const subHeight = rect.height;

    // Horizontal: try right, then left, then pin to viewport edge
    if (rect.right > vw - pad) {
      const wouldBeLeft = liRect.left - subWidth;
      if (wouldBeLeft >= pad) {
        subList.style.left = 'auto';
        subList.style.right = '100%';
      } else {
        subList.style.right = 'auto';
        subList.style.left = `${vw - pad - subWidth - liRect.left}px`;
      }
    }

    // Vertical: clamp within viewport
    let desiredTop = liRect.top - 4;
    if (desiredTop + subHeight > vh - pad) {
      desiredTop = vh - pad - subHeight;
    }
    if (desiredTop < pad) {
      desiredTop = pad;
    }
    subList.style.top = `${desiredTop - liRect.top}px`;
    subList.style.bottom = 'auto';

    subList.style.display = '';
  }

  // --- Drill-down mode (narrow viewports) ---
  function positionDrillRoot(ul) {
    const rect = ul.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    let left = parseFloat(menuRoot.style.left) || 0;
    let top = parseFloat(menuRoot.style.top) || 0;
    if (left + rect.width > vw - 8) left = Math.max(0, vw - rect.width - 8);
    if (top + rect.height > vh - 8) top = Math.max(0, vh - rect.height - 8);
    menuRoot.style.left = `${left}px`;
    menuRoot.style.top = `${top}px`;
  }

  function renderDrillLevel(node, levelTitle, isTaskUpdate, pathArr = []) {
    hidePreview();
    while (menuRoot.firstChild) menuRoot.firstChild.remove();

    const ul = document.createElement('ul');
    ul.className = 'tmenu-ul tmenu-drill';
    const isRootLevel = menuStack.length === 0;

    if (menuStack.length > 0) {
      const prev = menuStack[menuStack.length - 1];
      const backLi = document.createElement('li');
      backLi.className = 'tmenu-li';
      const backItem = document.createElement('div');
      backItem.className = 'tmenu-item tmenu-back';
      const backLabel = document.createElement('span');
      backLabel.textContent = `\u2190 ${prev.title || 'Menu'}`;
      backLabel.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
      backItem.appendChild(backLabel);
      backItem.addEventListener('click', (e) => {
        e.stopPropagation();
        const goBack = menuStack.pop();
        renderDrillLevel(goBack.node, goBack.title, goBack.isTaskUpdate, goBack.path);
      });
      backLi.appendChild(backItem);
      ul.appendChild(backLi);

      const sep = document.createElement('li');
      sep.className = 'tmenu-sep';
      ul.appendChild(sep);
    }

    if (isRootLevel) {
      // The anchored box (if driving this render) already IS the search field —
      // don't show a second, redundant search input inside the dropdown too.
      if (!searchBoxDriven) ul.appendChild(buildSearchRow());
      if (currentSearchQuery) {
        renderFlatResults(ul, getSearchMatches(currentSearchQuery));
        menuRoot.appendChild(ul);
        renumberLevel(ul);
        positionDrillRoot(ul);
        return;
      }
      appendRecentItems(ul);
    }

    Object.entries(node).forEach(([key, value]) => {
      const path = pathArr.concat(key);
      if (typeof value === 'object' && value !== null) {
        const li = document.createElement('li');
        li.className = 'tmenu-li';
        const item = document.createElement('div');
        item.className = 'tmenu-item';
        const num = document.createElement('span');
        num.className = 'tmenu-num';
        item.appendChild(num);
        const label = document.createElement('span');
        label.textContent = key;
        label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
        item.appendChild(label);
        const arrow = document.createElement('span');
        arrow.className = 'tmenu-arrow';
        arrow.textContent = '▶';
        item.appendChild(arrow);
        const childIsTaskUpdate = isTaskUpdate || key === 'Task Updates';
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          menuStack.push({ node, title: levelTitle, isTaskUpdate, path: pathArr });
          renderDrillLevel(value, key, childIsTaskUpdate, path);
        });
        li.appendChild(item);
        ul.appendChild(li);
      } else {
        ul.appendChild(buildLeafItem(key, String(value), isTaskUpdate, path));
      }
    });

    menuRoot.appendChild(ul);
    renumberLevel(ul);
    positionDrillRoot(ul);
  }

  // ============================================================
  // SECTION 5: SHOW / HIDE MENU
  // ============================================================
  function openMenu(x, y) {
    lastFocused = document.activeElement;
    if (menuRoot) closeMenu();
    menuRoot = document.createElement('div');
    menuRoot.id = 'tmenu-root';
    document.body.appendChild(menuRoot);

    menuStack = [];
    currentSearchQuery = '';
    drillDownMode = menuMode === 'drilldown' || (menuMode === 'dynamic' && window.innerWidth < 1200);

    attachMenuListeners();

    if (drillDownMode) {
      // Drill-down: render first level, then position
      menuRoot.style.left = '0px';
      menuRoot.style.top = '0px';
      menuRoot.style.visibility = 'hidden';
      renderDrillLevel(TEMPLATES, null, false);
      requestAnimationFrame(() => {
        const rect = menuRoot.firstChild.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        let finalX = Math.max(0, Math.min(x, vw - rect.width - 8));
        let finalY = Math.max(0, Math.min(y, vh - rect.height - 8));
        menuRoot.style.left = `${finalX}px`;
        menuRoot.style.top = `${finalY}px`;
        menuRoot.style.visibility = '';
      });
    } else {
      // Flyout: existing behavior
      const list = buildMenuList(TEMPLATES, true);
      menuRoot.appendChild(list);
      menuRoot.style.left = '0px';
      menuRoot.style.top = '0px';
      menuRoot.style.visibility = 'hidden';
      requestAnimationFrame(() => {
        const rect = list.getBoundingClientRect();
        const vw = window.innerWidth, vh = window.innerHeight;
        let finalX = x, finalY = y;
        if (x + rect.width > vw) finalX = Math.max(0, x - rect.width);
        if (y + rect.height > vh) finalY = Math.max(0, y - rect.height);
        menuRoot.style.left = `${finalX}px`;
        menuRoot.style.top = `${finalY}px`;
        menuRoot.style.visibility = '';
      });
    }
  }

  function closeMenu() {
    detachMenuListeners();
    hidePreview();
    menuStack = [];
    currentSearchQuery = '';
    searchBoxDriven = false;
    kbStack = [];
    kbEngaged = false;
    if (menuRoot) { menuRoot.remove(); menuRoot = null; }
  }

  // ============================================================
  // SECTION 6: TEXT INSERTION
  // ============================================================
  function getLineBreakPrefix(el, isTaskUpdate) {
    if (!el) return '';

    let currentLineHasText = false;

    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
      const val = el.value || '';
      const pos = el.selectionStart ?? val.length;
      const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
      const lineText = val.slice(lineStart, pos);
      currentLineHasText = lineText.trim().length > 0;
    } else if (el.isContentEditable) {
      const sel = window.getSelection();
      if (sel && sel.rangeCount) {
        const range = sel.getRangeAt(0);
        const node = range.startContainer;
        const textBefore = node.nodeType === 3 ? node.textContent.slice(0, range.startOffset) : '';
        const lastLine = textBefore.split('\n').pop() || '';
        currentLineHasText = lastLine.trim().length > 0;
      }
    }

    if (!currentLineHasText) return '';
    return isTaskUpdate ? '\n' : '\n\n';
  }

function handleTemplateClick(text, isTaskUpdate = false) {
    text = text
      .replace(/\[date\]/g, getCurrentDate())
      .replace(/\[initials\]/g, getOrPromptInitials());

    // Prefer the known anchored field over "whatever last had focus" — while the
    // user is typing in the anchored search box, that box itself has focus, so
    // lastFocused/document.activeElement would point at the wrong element.
    let target = findFieldEl();
    if (!target || !document.body.contains(target)) {
      target = (lastFocused && document.body.contains(lastFocused) && lastFocused !== searchInputEl)
        ? lastFocused : document.activeElement;
    }

    // --- Deduplicate "Products Ordered:" line ---
    if (target) {
      let currentText = '';
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
        currentText = target.value || '';
      } else if (target.isContentEditable) {
        currentText = target.innerText || '';
      }
      if (currentText.includes('Products Ordered:')) {
        text = text.split('\n').filter(line => line.trim() !== 'Products Ordered:').join('\n');
      }
    }
    // --- End dedup ---

    closeMenu();
    if (searchInputEl) searchInputEl.value = '';
    let copied = false;
    try { GM_setClipboard(text, 'text'); copied = true; } catch(_) { console.warn('[TMenu]', _); }
    if (!copied) {
      navigator.clipboard.writeText(text).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch(_) { console.warn('[TMenu]', _); }
        ta.remove();
      });
    }
    showToast('✅ Copied! Press Ctrl+V to paste.');
    // Re-resolve target (same logic, but target is already set above)
    if (!target) return;
    const insertedViaCommand = (() => {
      try {
        target.focus();
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          const len = target.value.length;
          target.selectionStart = target.selectionEnd = len;
        } else if (target.isContentEditable) {
          const sel = window.getSelection();
          sel.selectAllChildren(target);
          sel.collapseToEnd();
        }
        const prefix = getLineBreakPrefix(target, isTaskUpdate);
        return document.execCommand('insertText', false, prefix + text);
      }
      catch (_) { return false; }
    })();
    if (!insertedViaCommand) tryReactInject(target, text, isTaskUpdate);

    // Some CRM widgets asynchronously steal focus/selection back right after we
    // insert; re-assert focus and put the cursor at the end shortly after.
    setTimeout(() => {
      if (target && document.body.contains(target)) {
        target.focus();
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
          const len = target.value.length;
          target.selectionStart = target.selectionEnd = len;
        }
      }
    }, 50);
  }

  function tryReactInject(el, text, isTaskUpdate = false) {
    try {
      const isContentEditable = el.isContentEditable;
      if (isContentEditable) {
        el.focus();
        const sel = window.getSelection();
        sel.selectAllChildren(el);
        sel.collapseToEnd();
        const prefix = getLineBreakPrefix(el, isTaskUpdate);
        const fullText = prefix + text;
        const range = sel.getRangeAt(0);
        range.deleteContents();
        range.insertNode(document.createTextNode(fullText));
        range.collapse(false);
        // Controlled contentEditable editors (React/Slate/Lexical-style) listen for
        // native InputEvents rather than the plain Event dispatched below.
        try {
          el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: fullText }));
        } catch(_) { console.warn('[TMenu]', _); }
      } else if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          el.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype, 'value')?.set;
        const start = el.value.length;
        const prefix = getLineBreakPrefix(el, isTaskUpdate);
        const fullText = prefix + text;
        if (nativeInputValueSetter) {
          const newValue = el.value.slice(0, start) + fullText;
          nativeInputValueSetter.call(el, newValue);
        } else { el.value += fullText; }
      } else { return; }
      ['beforeinput', 'input', 'change'].forEach(evtName => {
        el.dispatchEvent(new Event(evtName, { bubbles: true, cancelable: true }));
      });
    } catch (err) {
      console.debug('[TMenu] inject failed:', err.message);
      showToast('⚠️ Paste manually (Ctrl+V)');
    }
  }

  // ============================================================
  // SECTION 7: TOAST & PREVIEW
  // ============================================================
  function ensureToast() {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'tmenu-toast'; document.body.appendChild(toastEl); }
  }
  function showToast(msg, durationMs = 2500) {
    ensureToast(); toastEl.textContent = msg;
    if (fabEl && fabEl.isConnected && fabEl.getBoundingClientRect().width > 0) {
      // Toast hugs the docked top-panel button instead of the old top-left corner.
      const r = fabEl.getBoundingClientRect();
      toastEl.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 320))}px`;
      toastEl.style.top = `${r.bottom + 8}px`;
      toastEl.style.transform = 'none';
    } else {
      toastEl.style.left = '50%';
      toastEl.style.top = '12px';
      toastEl.style.transform = 'translateX(-50%)';
    }
    toastEl.classList.add('visible');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('visible'), durationMs);
  }

  function ensurePreview() {
    if (!previewEl) { previewEl = document.createElement('div'); previewEl.id = 'tmenu-preview'; document.body.appendChild(previewEl); }
  }
  function showPreview(e, text) {
    ensurePreview();
    document.body.appendChild(previewEl);
    previewEl.textContent = text;
    previewEl.classList.add('visible');

    previewEl.style.left = '0px';
    previewEl.style.top = '0px';

    const pRect = previewEl.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const menuBounds = { left: vw, top: vh, right: 0, bottom: 0 };
    if (menuRoot) {
      menuRoot.querySelectorAll('.tmenu-ul').forEach(ul => {
        if (ul.offsetParent !== null || ul.closest('.tmenu-li:hover')) {
          const r = ul.getBoundingClientRect();
          if (r.width === 0 && r.height === 0) return;
          menuBounds.left = Math.min(menuBounds.left, r.left);
          menuBounds.top = Math.min(menuBounds.top, r.top);
          menuBounds.right = Math.max(menuBounds.right, r.right);
          menuBounds.bottom = Math.max(menuBounds.bottom, r.bottom);
        }
      });
    }

    let left = menuBounds.right + 12;
    if (left + pRect.width > vw) {
      left = menuBounds.left - pRect.width - 12;
    }
    left = Math.max(10, left);

    const itemRect = e.currentTarget.getBoundingClientRect();
    let top;
    if (itemRect.top < vh / 2) {
      top = itemRect.top;
      if (top + pRect.height > vh - 10) top = vh - pRect.height - 10;
    } else {
      top = itemRect.bottom - pRect.height;
      if (top < 10) top = 10;
    }

    previewEl.style.left = `${left}px`;
    previewEl.style.top = `${top}px`;
  }
  function hidePreview() { if (previewEl) previewEl.classList.remove('visible'); }

  // ============================================================
  // SECTION 8: FLOATING ACTION BUTTON
  // ============================================================
  // Docks the trigger button inline in the CRM top panel, right after the
  // module title (e.g. "Care Plan"), instead of a free-floating draggable FAB.
  function findTopPanelHost() {
    return document.querySelector('#crmNextGenTopMenu [data-zcqa="appTopMenuTitle"]')
      || document.querySelector('#crmNextGenTopMenu .flexAlignCenter')
      || document.querySelector('#crmNextGenTopMenu');
  }

  function createFAB() {
    if (fabEl) return;
    fabEl = document.createElement('div');
    fabEl.id = 'tmenu-fab'; fabEl.title = 'Template Menu (Alt+T)'; fabEl.textContent = '📋';
    fabEl.setAttribute('role', 'button');
    fabEl.setAttribute('tabindex', '0');
    fabEl.setAttribute('aria-label', 'Template Menu');

    const attachToPanel = () => {
      const host = findTopPanelHost();
      if (!host) return false;
      fabHost = host;
      host.appendChild(fabEl);
      fabEl.classList.remove('tmenu-fab-fallback');
      return true;
    };

    if (!attachToPanel()) {
      // Zoho CRM is an SPA — the header may not be rendered yet. Keep a
      // floating fallback so the menu is still reachable, then dock once the
      // panel appears (appendChild moves it out of the fallback spot).
      document.body.appendChild(fabEl);
      fabEl.classList.add('tmenu-fab-fallback');
      const obs = new MutationObserver(() => {
        if (attachToPanel()) obs.disconnect();
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
      setTimeout(() => obs.disconnect(), 30000);
    }

    fabEl.addEventListener('click', (e) => {
      e.stopPropagation();
      if (menuRoot) { closeMenu(); return; } // toggle: click again to close
      const r = fabEl.getBoundingClientRect();
      openMenu(r.left, r.bottom + 6);
    });
    fabEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fabEl.click(); }
    });
  }

  // Re-dock the button if Zoho re-renders the top panel and drops it from the DOM.
  function watchFAB() {
    if (fabWatcher) return;
    // v6.33 perf: the idle path is now one O(1) `isConnected` read instead of
    // three document-wide querySelectors per mutation batch, debounced so a
    // Zoho re-render burst costs one check instead of dozens.
    fabWatcher = new MutationObserver(() => {
      if (fabWatcherTimer) return;
      fabWatcherTimer = setTimeout(() => {
        fabWatcherTimer = null;
        if (!fabEl || fabReinjectQueued) return;
        if (fabEl.isConnected && fabHost && fabHost.contains(fabEl)) return;
        const host = findTopPanelHost();
        if (!host) return;
        fabHost = host;
        fabReinjectQueued = true;
        requestAnimationFrame(() => { fabReinjectQueued = false; host.appendChild(fabEl); });
      }, 250);
    });
    fabWatcher.observe(document.body, { childList: true, subtree: true });
  }

  // ============================================================
  // SECTION 8.7: ANCHORED SEARCH BOX
  //   A persistent search input injected directly next to a known CRM field
  //   (Tasks description / CustomModule32), so you can search without opening
  //   the FAB menu first. Drives the same dropdown as the FAB, just anchored
  //   to the field and always in drilldown-style rendering.
  // ============================================================
  function findFieldEl() {
    const url = window.location.href;
    let el = null;
    if (url.includes('/tab/Tasks/')) el = document.getElementById('Crm_Tasks_DESCRIPTION');
    if (!el && url.includes('/tab/CustomModule32/')) el = document.getElementById('Crm_CustomModule32_COBJ32CF1');
    if (!el) return null;
    if (el.value === undefined && !el.isContentEditable) {
      const inner = el.querySelector('textarea, input, [contenteditable="true"]');
      if (inner) return inner;
    }
    return el;
  }

  function findRowContainer(fieldEl) {
    if (!fieldEl) return null;
    return fieldEl.closest('.tabDivCreate')
        || fieldEl.closest('.contInfoTab')
        || fieldEl.closest('.custabDivCreate')
        || fieldEl.closest('#mouseArea__COBJ32CF1')
        || fieldEl.closest('[id$="_FValue"]')
        || fieldEl.closest('[id^="ajaxEdit_"]')
        || fieldEl.parentElement;
  }

  function syncBoxWidth() {
    if (!searchBoxEl) return;
    const w = widthSourceEl ? widthSourceEl.getBoundingClientRect().width : 0;
    if (w > 160) searchBoxEl.style.setProperty('width', `${w}px`, 'important');
    else searchBoxEl.style.removeProperty('width');
  }

  function positionMenuNearBox() {
    if (!menuRoot || !searchBoxEl) return;
    const rect = searchBoxEl.getBoundingClientRect();
    const firstChild = menuRoot.firstChild;
    const menuRect = firstChild ? firstChild.getBoundingClientRect() : { width: 0, height: 0 };
    const vw = window.innerWidth, vh = window.innerHeight;
    let top = rect.bottom + 4;
    if (top + menuRect.height > vh - 8 && rect.top - 4 - menuRect.height >= 8) {
      top = rect.top - 4 - menuRect.height;
    }
    const left = Math.max(8, Math.min(rect.left, vw - menuRect.width - 8));
    menuRoot.style.left = `${left}px`;
    menuRoot.style.top = `${top}px`;
  }

  function openAnchoredMenu(query) {
    searchBoxDriven = true;
    currentSearchQuery = (query || '').trim();
    menuStack = [];
    drillDownMode = true;
    if (!menuRoot) {
      menuRoot = document.createElement('div');
      menuRoot.id = 'tmenu-root';
      document.body.appendChild(menuRoot);
      attachMenuListeners();
    }
    renderDrillLevel(TEMPLATES, null, false);
    positionMenuNearBox();
  }

  function buildReplacerRow() {
    const row = document.createElement('div');
    row.id = 'tmenu-replacer-row';
    const mk = (html, title, action) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.title = title;
      b.innerHTML = html;
      // preventDefault on mousedown keeps focus/selection on the field,
      // so the action always lands at the caret (never steals focus).
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', () => applyReplacerAction(action));
      return b;
    };
    const breaksSVG = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">'
      + '<path d="M4 2h7M4 7h7M4 12h4" stroke="#1a73e8" stroke-width="1.5" stroke-linecap="round"/>'
      + '<path d="M10 9l2 2-2 2" stroke="#1a73e8" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/></svg>';
    const sep = document.createElement('span');
    sep.className = 'tmenu-replacer-sep';
    sep.textContent = '|';
    row.append(
      mk(breaksSVG, 'Insert two line breaks at the cursor', 'linebreak'),
      sep,
      mk('📅 Date', 'Insert today\'s date, or replace [date]', 'date'),
      sep.cloneNode(),
      mk('✍ ' + (getBareInitials() || 'Initials'), 'Insert your initials, or replace [initials]', 'initials')
    );
    return row;
  }

  function createSearchBox() {
    if (window !== window.top) return;
    if (searchBoxEl && document.body.contains(searchBoxEl)) return;

    const fieldEl = findFieldEl();
    if (!fieldEl) return;

    const rowContainer = findRowContainer(fieldEl);
    if (!rowContainer || !rowContainer.parentNode) return;

    widthSourceEl =
      document.getElementById('Crm_CustomModule32_COBJ32CF1') ||
      document.getElementById('Crm_Tasks_DESCRIPTION') ||
      document.getElementById('ajaxEdit_COBJ32CF1') ||
      document.getElementById('value_COBJ32CF1') ||
      rowContainer;

    searchBoxEl = document.createElement('div');
    searchBoxEl.id = 'tmenu-searchbox';

    searchInputEl = document.createElement('input');
    searchInputEl.id = 'tmenu-searchinput';
    searchInputEl.type = 'text';
    searchInputEl.placeholder = '🔍 Search templates… (Alt+T)';
    searchInputEl.autocomplete = 'off';
    searchInputEl.spellcheck = false;
    searchBoxEl.appendChild(searchInputEl);

    rowContainer.parentNode.insertBefore(searchBoxEl, rowContainer.nextSibling);

    replacerRowEl = buildReplacerRow();
    searchBoxEl.parentNode.insertBefore(replacerRowEl, searchBoxEl.nextSibling);
    syncBoxWidth();
    // v6.33 fix: this ran once per box (re)creation, so every SPA navigation
    // that rebuilt the box stacked another resize listener on the window.
    if (!resizeBound) { resizeBound = true; window.addEventListener('resize', syncBoxWidth); }

    searchInputEl.addEventListener('focus', () => openAnchoredMenu(searchInputEl.value));
    searchInputEl.addEventListener('input', (e) => {
      const q = (e.target.value || '').trim();
      if (q === currentSearchQuery) return; // same query, same tree
      openAnchoredMenu(q);
    });
  }

  function watchAnchor() {
    if (anchorObserver) return;
    // v6.33 perf: debounced, and it bails on a URL string check instead of
    // getElementById + closest() on every mutation batch — on the Contacts tab
    // there is no anchor field at all, so the old callback paid that cost for
    // nothing on every single mutation Zoho emits.
    anchorObserver = new MutationObserver(() => {
      if (anchorTimer) return;
      anchorTimer = setTimeout(() => {
      anchorTimer = null;
      const u = window.location.href;
      if (!searchBoxEl && !u.includes('/tab/Tasks/') && !u.includes('/tab/CustomModule32/')) return;
      if (anchorReinjectQueued) return;
      const fieldEl = findFieldEl();
      if (!fieldEl && searchBoxEl && document.body.contains(searchBoxEl)) {
        searchBoxEl.remove();
        searchBoxEl = null;
        searchInputEl = null;
        if (replacerRowEl) { replacerRowEl.remove(); replacerRowEl = null; }
        return;
      }
      if (!searchBoxEl || !document.body.contains(searchBoxEl)) {
        anchorReinjectQueued = true;
        requestAnimationFrame(() => { anchorReinjectQueued = false; createSearchBox(); });
      } else {
        syncBoxWidth();
      }
      }, 250);
    });
    anchorObserver.observe(document.body, { childList: true, subtree: true });
  }

// ============================================================
  // SECTION 8.5: KEYBOARD NAVIGATION
  //   ← Left  = back / close submenu
  //   → Right = open submenu (branch deeper)
  //   ↑ ↓     = move between items
  //   Enter   = open submenu (branch) OR insert template (leaf)
  // ============================================================
  let kbStack = [];       // flyout mode: stack of { ul, index }
  let kbEngaged = false;  // true once arrow keys are in use

  function kbNavigableItems(ul) {
    return Array.from(ul.querySelectorAll(':scope > .tmenu-li'))
      .map(li => ({ li, item: li.querySelector(':scope > .tmenu-item') }))
      .filter(x => x.item && !x.item.classList.contains('tmenu-back'));
  }

  function kbClearActive() {
    if (!menuRoot) return;
    menuRoot.querySelectorAll('.tmenu-item.tmenu-kb-active')
      .forEach(el => el.classList.remove('tmenu-kb-active'));
  }
  function kbSetActive(item) {
    kbClearActive();
    if (item) item.classList.add('tmenu-kb-active');
  }

  function kbMaybePreview(entry) {
    if (!entry || entry.item.querySelector('.tmenu-arrow')) { hidePreview(); return; }
    const text = entry.item.dataset.tmenuText;
    if (text == null) { hidePreview(); return; }
    showPreview({ currentTarget: entry.item }, text);
  }

  // ---------- Flyout mode (wide viewports) ----------
  function kbFlyoutInit() {
    if (!menuRoot || kbStack.length) return;
    const rootUl = menuRoot.querySelector(':scope > .tmenu-ul');
    if (rootUl) kbStack.push({ ul: rootUl, index: -1 });
  }
  function kbFlyoutLevel() {
    if (!menuRoot || !kbStack.length) return null;
    return kbStack[kbStack.length - 1];
  }

  function kbFlyoutMove(dir) {
    kbFlyoutInit();
    const lvl = kbFlyoutLevel();
    if (!lvl) return;
    const items = kbNavigableItems(lvl.ul);
    if (!items.length) return;
    let idx = lvl.index < 0 ? (dir > 0 ? -1 : 0) : lvl.index;
    idx = (idx + dir + items.length) % items.length;
    lvl.index = idx;
    kbSetActive(items[idx].item);
    kbMaybePreview(items[idx]);
  }

  function kbFlyoutRight() {
    kbFlyoutInit();
    const lvl = kbFlyoutLevel();
    if (!lvl) return;
    const items = kbNavigableItems(lvl.ul);
    const entry = items[lvl.index];
    if (!entry) { kbFlyoutMove(1); return; }
    if (!entry.li._tmenuEnsureSub) return; // leaf — nothing to branch into
    const subUl = entry.li._tmenuEnsureSub();
    hidePreview();
    entry.li.classList.add('tmenu-kb-open');
    repositionSubmenu(entry.li, subUl);
    kbStack.push({ ul: subUl, index: 0 });
    const subItems = kbNavigableItems(subUl);
    if (subItems.length) { kbSetActive(subItems[0].item); kbMaybePreview(subItems[0]); }
  }

  function kbFlyoutLeft() {
    if (kbStack.length <= 1) return; // already at root
    const closing = kbStack.pop();
    const parentLi = closing.ul.closest('.tmenu-li');
    if (parentLi) parentLi.classList.remove('tmenu-kb-open');
    const lvl = kbFlyoutLevel();
    const entry = kbNavigableItems(lvl.ul)[lvl.index];
    if (entry) { kbSetActive(entry.item); kbMaybePreview(entry); }
  }

  function kbFlyoutEnter() {
    const lvl = kbFlyoutLevel();
    if (!lvl) { kbFlyoutMove(1); return; }
    const entry = kbNavigableItems(lvl.ul)[lvl.index];
    if (!entry) { kbFlyoutMove(1); return; }
    if (entry.li._tmenuEnsureSub) kbFlyoutRight();
    else entry.item.click();
  }

  // ---------- Drill-down mode (narrow viewports) ----------
  function kbDrillUl() { return menuRoot && menuRoot.querySelector('.tmenu-ul.tmenu-drill'); }

  function kbDrillMove(dir) {
    const ul = kbDrillUl();
    if (!ul) return;
    const items = kbNavigableItems(ul);
    if (!items.length) return;
    let idx = items.findIndex(x => x.item.classList.contains('tmenu-kb-active'));
    idx = idx < 0 ? (dir > 0 ? -1 : 0) : idx;
    idx = (idx + dir + items.length) % items.length;
    kbSetActive(items[idx].item);
    kbMaybePreview(items[idx]);
  }

  function kbDrillResetTop() {
    const ul = kbDrillUl();
    if (!ul) return;
    const items = kbNavigableItems(ul);
    if (items.length) { kbSetActive(items[0].item); kbMaybePreview(items[0]); }
  }

  function kbDrillRight() {
    const ul = kbDrillUl();
    if (!ul) return;
    const entry = kbNavigableItems(ul).find(x => x.item.classList.contains('tmenu-kb-active'));
    if (!entry) { kbDrillMove(1); return; }
    if (entry.item.querySelector('.tmenu-arrow')) { entry.item.click(); kbDrillResetTop(); }
  }

  function kbDrillLeft() {
    const back = menuRoot && menuRoot.querySelector('.tmenu-item.tmenu-back');
    if (!back) return; // at root
    back.click();
    kbDrillResetTop();
  }

  function kbDrillEnter() {
    const ul = kbDrillUl();
    if (!ul) return;
    const entry = kbNavigableItems(ul).find(x => x.item.classList.contains('tmenu-kb-active'));
    if (!entry) { kbDrillMove(1); return; }
    const isBranch = !!entry.item.querySelector('.tmenu-arrow');
    entry.item.click(); // branch → drills + re-renders; leaf → inserts + closes
    if (isBranch) kbDrillResetTop();
  }

  // Keep a single highlight: drop the keyboard highlight when the mouse takes over
  const onMenuMouseover = (e) => {
    if (!menuRoot || !kbEngaged) return;
    const overItem = e.target.closest && e.target.closest('.tmenu-item');
    if (overItem && menuRoot.contains(overItem) && !overItem.classList.contains('tmenu-kb-active')) {
      kbClearActive();
    }
  };
  const onMenuMousedown = (e) => {
    if (menuRoot && !menuRoot.contains(e.target) && e.target !== fabEl
        && e.target !== searchInputEl && e.target !== searchBoxEl) closeMenu();
  };
  // v6.33 perf: both listeners used to be attached for the life of the tab and
  // fired on every mouse event in the page while doing nothing at all unless
  // the menu was open. They now exist only while the menu is open.
  function attachMenuListeners() {
    document.addEventListener('mouseover', onMenuMouseover, true);
    document.addEventListener('mousedown', onMenuMousedown, true);
  }
  function detachMenuListeners() {
    document.removeEventListener('mouseover', onMenuMouseover, true);
    document.removeEventListener('mousedown', onMenuMousedown, true);
  }
  // ---------- Number quick-select (power user) ----------
  let kbNumBuffer = '';
  let kbNumTimer = null;

  function kbResetNumBuffer() {
    kbNumBuffer = '';
    if (kbNumTimer) { clearTimeout(kbNumTimer); kbNumTimer = null; }
  }

  function kbCurrentItems() {
    if (drillDownMode) {
      const ul = kbDrillUl();
      return ul ? kbNavigableItems(ul) : [];
    }
    kbFlyoutInit();
    const lvl = kbFlyoutLevel();
    return lvl ? kbNavigableItems(lvl.ul) : [];
  }

  function kbActivateIndex(n) { // n is 1-based
    const items = kbCurrentItems();
    const i = n - 1;
    if (i < 0 || i >= items.length) return; // out of range → ignore
    kbSetActive(items[i].item);
    if (drillDownMode) {
      kbDrillEnter();          // branch → drill; leaf → paste
    } else {
      kbFlyoutLevel().index = i;
      kbFlyoutEnter();         // branch → open submenu; leaf → paste
    }
  }

  function kbCommitNumBuffer() {
    const n = parseInt(kbNumBuffer, 10);
    kbResetNumBuffer();
    if (n > 0) kbActivateIndex(n);
  }

  function kbHandleDigit(d) { // d = '0'..'9'
    if (kbNumBuffer === '' && d === '0') return; // no leading zero, no item 0
    kbNumBuffer += d;
    showToast(`# ${kbNumBuffer}`, 600);
    if (kbNumTimer) { clearTimeout(kbNumTimer); kbNumTimer = null; }
    const val = parseInt(kbNumBuffer, 10);
    const count = kbCurrentItems().length;
    if (val * 10 > count) kbCommitNumBuffer();          // no longer number can be valid → fire now
    else kbNumTimer = setTimeout(kbCommitNumBuffer, 450); // ambiguous → brief wait for a 2nd digit
  }
  // ============================================================
  // SECTION 9: GLOBAL EVENT LISTENERS
  // ============================================================
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 't') {
      e.preventDefault();
      if (menuRoot) closeMenu();
      else if (searchInputEl && document.body.contains(searchInputEl)) { searchInputEl.focus(); searchInputEl.select(); }
      else openMenu(Math.round(window.innerWidth / 2 - 110), Math.round(window.innerHeight / 2 - 100));
      return;
    }
    if (e.key === 'Escape') { closeMenu(); return; }

    if (!menuRoot) return;

    // Either search input (the in-menu row, or the anchored box) — typing should
    // behave normally, but Up/Down/Enter should still drive dropdown navigation
    // without stealing focus away from the box (Left/Right keep editing the text).
    const inSearchInput = e.target === searchInputEl ||
      (e.target && e.target.classList && e.target.classList.contains('tmenu-search-input'));

    if (/^[0-9]$/.test(e.key)) {
      if (inSearchInput) return; // let digits type normally into the query
      e.preventDefault();
      e.stopPropagation();
      kbEngaged = true;
      kbHandleDigit(e.key);
      return;
    }

    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Enter'].includes(e.key)) return;
    if (inSearchInput && !['ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    kbEngaged = true;
    kbResetNumBuffer(); // arrows/Enter cancel any half-typed number

    if (drillDownMode) {
      if (e.key === 'ArrowDown') kbDrillMove(1);
      else if (e.key === 'ArrowUp') kbDrillMove(-1);
      else if (e.key === 'ArrowRight') kbDrillRight();
      else if (e.key === 'ArrowLeft') kbDrillLeft();
      else if (e.key === 'Enter') kbDrillEnter();
    } else {
      if (e.key === 'ArrowDown') kbFlyoutMove(1);
      else if (e.key === 'ArrowUp') kbFlyoutMove(-1);
      else if (e.key === 'ArrowRight') kbFlyoutRight();
      else if (e.key === 'ArrowLeft') kbFlyoutLeft();
      else if (e.key === 'Enter') kbFlyoutEnter();
    }
  }, true);
  window.addEventListener('resize', () => { if (menuRoot) closeMenu(); });

  // ============================================================
  // SECTION 9.5: SETTINGS MENU COMMANDS
  // ============================================================
  function cycleMenuMode() {
    const order = ['dynamic', 'drilldown', 'flyout'];
    menuMode = order[(order.indexOf(menuMode) + 1) % order.length];
    GM_setValue('menuMode', menuMode);
    showToast(`✅ Menu mode: ${menuMode}`);
  }
  GM_registerMenuCommand('Toggle Menu Mode (dynamic/drilldown/flyout)', cycleMenuMode);
  GM_registerMenuCommand('Clear Recent Template History', clearRecentHistory);
  GM_registerMenuCommand('Reset Template Edits to Defaults', () => {
    if (confirm('Reset all local template edits back to defaults? This cannot be undone.')) resetTemplateOverrides();
  });
  GM_registerMenuCommand('Export Template Edits (copy JSON)', exportTemplateOverrides);
  GM_registerMenuCommand('Import Template Edits (paste JSON)', importTemplateOverrides);

  // ============================================================
  // SECTION 10: INIT
  // ============================================================
  function init() {
    if (window !== window.top) return;
    createFAB();
    watchFAB();
    createSearchBox();
    watchAnchor();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  } catch (err) {
    console.error('[TMenu] Fatal error:', err);
  }
})();