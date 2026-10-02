// Vendored chrome for the Zoho Unified Template Menu.
// chrome-vendored-from: Template Menu 6.33 (vendored 2026-09-27, option A).
// This file is the BUILD INPUT for the artifact. Template Menu.user.js is now a
// frozen golden reference (the gate diffs rendered text against it) — not a
// build dependency, and not installed. Do not hand-edit the artifact: edit this
// file, then `node harvest/build-script.js`.
//
// ==UserScript==
// @name         Zoho Unified Template Menu
// @namespace    http://tampermonkey.net/
// @version      1.5.1
// @description  Unified template menu: order blocks + patient SMS from one bank (chrome from Template Menu 6.33 + Peptide SMS 5.28.1)
// @author       Jeyson Dagondon
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


console.info('[ZUnified v1.5.1] boot');

// --- Script API (R18) ---
// KNOWN LIMITATION (verified 2026-09-27 on TM/Edge 154): a script with GM grants
// runs in a Tampermonkey sandbox, and its writes to the page's window do NOT land
// — every script whose `__scripts` entry IS visible on Zoho pages uses
// `@grant none` (ContactKit, AutoExpand, GLP1, LDNDose, CPToolkit, TaskTK). This
// script needs GM_getValue/GM_setClipboard/GM_addStyle, so it cannot be
// `@grant none`, so its registry entry is not observable from the page. Writing
// through `unsafeWindow` is the correct intent and is what TM documents; the
// live gate therefore witnesses ownership via the DOM surface (`#zuni-fab`), not
// the registry. Do not add a gate that reads `window.__scripts.ZUnified`.
const __api = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
__api.__scripts = __api.__scripts || {};
__api.__scripts['ZUnified'] = { name: 'Zoho Unified Template Menu', version: '1.5.1', state: 'idle', message: 'Loaded', output: null, error: null, lastActivity: Date.now(), trigger: null };
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

const DEFAULT_TEMPLATES = {"Pharmacy J":{"Tesofensine Pill +L +C":{"1 Month / 30 pills":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 30 Tesofensine 500mcg\nDosing: 1 pill\nFrequency: Daily\nEstimated Duration: 4 weeks","3 Months / 90 pills":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 90 Tesofensine 500mcg\nDosing: 1 pill\nFrequency: Daily\nEstimated Duration: 12 weeks"},"5-Amino-1MQ Pill +L":{"1 Month / 30 pills":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 30 5-Amino-1MQ 50mg\nDosing: 1 pill (can increase to 2-3/day)\nFrequency: Daily\nEstimated Duration: 4 weeks","3 Months / 90 pills":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 90 5-Amino-1MQ 50mg\nDosing: 1 pill (can increase to 2-3/day)\nFrequency: Daily\nEstimated Duration: 12 weeks"},"BPC Pill":{"1 Month / 30 pills":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 30 BPC 500mcg\nDosing: 1 pill on empty stomach\nFrequency: Daily\nEstimated Duration: 4 weeks","3 Months / 90 pills":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 90 BPC 500mcg\nDosing: 1 pill on empty stomach\nFrequency: Daily\nEstimated Duration: 12 weeks"},"BPC/KPV Pill":{"1 Month / 30 pills":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 30 BPC/KPV 500/500mcg\nDosing: 1 pill on empty stomach\nFrequency: Daily\nEstimated Duration: 4 weeks","2 Months / 60 pills":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 60 BPC/KPV 500/500mcg\nDosing: 2 pills on empty stomach\nFrequency: Daily\nEstimated Duration: 4 weeks","3 Months / 90 pills (1/day)":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 90 BPC/KPV 500/500mcg\nDosing: 1 pill on empty stomach\nFrequency: Daily\nEstimated Duration: 12 weeks","3 Months / 180 pills (2/day)":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 180 BPC/KPV 500/500mcg\nDosing: 2 pills on empty stomach\nFrequency: Daily\nEstimated Duration: 12 weeks"},"Dihexa Pill":{"1 Month / 30 pills":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 30 Dihexa 20mg\nDosing: 1 pill\nFrequency: Daily\nEstimated Duration: 4 weeks","3 Months / 90 pills":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 90 Dihexa 20mg\nDosing: 1 pill\nFrequency: Daily\nEstimated Duration: 12 weeks"},"GHK-Cu Cream":{"1 Month / 1 bottle":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 1 bottle GHK-Cu cream\nDosing: 1 pea-sized amount for face, 1 pea-sized amount for neck\nFrequency: Daily\nEstimated Duration: 4 weeks","3 Months / 3 bottles":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 3 bottles GHK-Cu cream\nDosing: 1 pea-sized amount for face, 1 pea-sized amount for neck\nFrequency: Daily\nEstimated Duration: 12 weeks"},"GHK-Cu / Argireline / Leuphasyl Cream":{"1 Month / 1 bottle (30gm)":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 1 bottle GHK-Cu/Argireline/Leuphasyl 0.2%/0.5%/3% cream 30gm\nDosing: 1 pea-sized amount for face, 1 pea-sized amount for neck (not for full body use)\nFrequency: Morning and/or evening, daily\nEstimated Duration: 4 weeks","3 Months / 3 bottles (30gm each)":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 3 bottles GHK-Cu/Argireline/Leuphasyl 0.2%/0.5%/3% cream 30gm each\nDosing: 1 pea-sized amount for face, 1 pea-sized amount for neck (not for full body use)\nFrequency: Morning and/or evening, daily\nEstimated Duration: 12 weeks"},"Semax Nasal Spray":{"1 Month / 1 bottle":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 1 Semax Nasal Spray 7.5mg/ml 6mL\nDosing: 1 spray per nostril\nFrequency: Daily up to 3x/day\nEstimated Duration: 4 weeks","3 Months / 3 bottles":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 3 Semax Nasal Spray 7.5mg/ml 6mL\nDosing: 1 spray per nostril\nFrequency: Daily up to 3x/day\nEstimated Duration: 12 weeks"},"Selank Nasal Spray":{"1 Month / 1 bottle":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 1 Selank Nasal Spray 7.5mg/ml 6mL\nDosing: 1 spray per nostril\nFrequency: Daily up to 3x/day\nEstimated Duration: 4 weeks","3 Months / 3 bottles":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 3 Selank Nasal Spray 7.5mg/ml 6mL\nDosing: 1 spray per nostril\nFrequency: Daily up to 3x/day\nEstimated Duration: 12 weeks"},"SLU-PP-332":{"New Patient - 1 Month / 14x100mcg + 18x200mcg":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 14 SLU-PP-332 100mcg\nDosing: 1 capsule\nFrequency: Once daily\nEstimated Duration: 2 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 18 SLU-PP-332 200mcg\nDosing:\n- After finishing 100mcg: 1 capsule for 2 weeks\n- Onwards: 2 capsules (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: Rest of 1 month","New Patient - 6 Weeks / 14x100mcg + 42x200mcg":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 14 SLU-PP-332 100mcg\nDosing: 1 capsule\nFrequency: Once daily\nEstimated Duration: 2 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 42 SLU-PP-332 200mcg\nDosing:\n- After finishing 100mcg: 1 capsule for 2 weeks\n- Onwards: 2 capsules (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: Rest of 6 weeks","New Patient - 2 Months / 14x100mcg + 78x200mcg":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 14 SLU-PP-332 100mcg\nDosing: 1 capsule\nFrequency: Once daily\nEstimated Duration: 2 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 78 SLU-PP-332 200mcg\nDosing:\n- After finishing 100mcg: 1 capsule for 2 weeks\n- Onwards: 2 capsules (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: Rest of 2 months","New Patient - 3 Months / 14x100mcg + 138x200mcg":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 14 SLU-PP-332 100mcg\nDosing: 1 capsule\nFrequency: Once daily\nEstimated Duration: 2 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 138 SLU-PP-332 200mcg\nDosing:\n- After finishing 100mcg: 1 capsule for 2 weeks\n- Onwards: 2 capsules (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: Rest of 3 months","New Patient - 6 Months / 14x100mcg + 318x200mcg":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 14 SLU-PP-332 100mcg\nDosing: 1 capsule\nFrequency: Once daily\nEstimated Duration: 2 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 318 SLU-PP-332 200mcg\nDosing:\n- After finishing 100mcg: 1 capsule for 2 weeks\n- Onwards: 2 capsules (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: Rest of 6 months","Refill - 1 Month / 60x200mcg (2/day)":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 60 SLU-PP-332 200mcg\nDosing: 2 capsules (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 4 weeks","Refill - 3 Months / 180x200mcg (2/day)":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 180 SLU-PP-332 200mcg\nDosing: 2 capsules (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 12 weeks"},"AOD Troche":{"6 Weeks / 42 troches":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 42 AOD 600mcg\nDosing: Dissolve 1 troche between cheek and gum. No food 2 hours before or after.\nFrequency: Daily\nEstimated Duration: 6 weeks","1 Month / 30 troches":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 30 AOD 600mcg\nDosing: Dissolve 1 troche between cheek and gum. No food 2 hours before or after.\nFrequency: Daily\nEstimated Duration: 4 weeks","2 Months / 60 troches":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 60 AOD 600mcg\nDosing: Dissolve 1 troche between cheek and gum. No food 2 hours before or after.\nFrequency: Daily\nEstimated Duration: 8 weeks","3 Months / 90 troches":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 90 AOD 600mcg\nDosing: Dissolve 1 troche between cheek and gum. No food 2 hours before or after.\nFrequency: Daily\nEstimated Duration: 12 weeks","6 Months / 180 troches":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 180 AOD 600mcg\nDosing: Dissolve 1 troche between cheek and gum. No food 2 hours before or after.\nFrequency: Daily\nEstimated Duration: 6 months"},"O-304":{"New Patient - 1 Month / 53 caps":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 53 O-304 50mg\nDosing:\n- First 7 days: 1 cap (50mg)\n- Day 8 & on: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 4 weeks","New Patient - 6 Weeks / 77 caps":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 77 O-304 50mg\nDosing:\n- First 7 days: 1 cap (50mg)\n- Day 8 & on: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 6 weeks","New Patient - 2 Months / 113 caps":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 113 O-304 50mg\nDosing:\n- First 7 days: 1 cap (50mg)\n- Day 8 & on: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 8 weeks","New Patient - 3 Months / 173 caps":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 173 O-304 50mg\nDosing:\n- First 7 days: 1 cap (50mg)\n- Day 8 & on: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 12 weeks","New Patient - 6 Months / 353 caps":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 353 O-304 50mg\nDosing:\n- First 7 days: 1 cap (50mg)\n- Day 8 & on: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 6 months","Refill - 1 Month / 60 caps":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 60 O-304 50mg\nDosing: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 4 weeks","Refill - 3 Months / 180 caps":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 180 O-304 50mg\nDosing: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 12 weeks"}},"Pharmacy A":{"CJC/IPA Injection +L":{"2 Months / 1 vial":"Products Ordered:\n[date] (Pharmacy A) [initials]\nOrder #\nMedication: 1 vial of 6mL CJC/IPA 1.5mg/2.5mg/mL\nDosing: (7 units)\nFrequency: Twice a day, 5 days on and 2 days off\nEstimated Duration: 8 weeks"},"Tesa Injection +L (+C if with GLP)":{"4 Weeks / 2 vials":"Products Ordered:\n[date] (Pharmacy A) [initials]\nOrder #\nMedication: 2 vials of 5mL of Tesa 2mg/mL\nDosing: (50 units) (1mg) SubQ\nFrequency: 5 days on, 2 days off\nEstimated Duration: 4 Weeks","3 Months / 6 vials":"Products Ordered:\n[date] (Pharmacy A) [initials]\nOrder #\nMedication: 4 vials of 5mL of Tesa 2mg/mL\nDosing: (50 units) (1mg) SubQ\nFrequency: 5 days on, 2 days off\nEstimated Duration: 8 weeks"},"BPC-157 Injection":{"1 Month / 1 vial":"Products Ordered:\n[date] (Pharmacy A) [initials]\nOrder #\nMedication: 1 vial of 5mL BPC-157 3mg/mL\nDosing: (17 units)\nFrequency: Daily\nEstimated Duration: 4 weeks","3 Months / 3 vials":"Products Ordered:\n[date] (Pharmacy A) [initials]\nOrder #\nMedication: 2 vials of 5mL BPC-157 3mg/mL\nDosing: (17 units)\nFrequency: Daily\nEstimated Duration: 8 weeks"},"GHK-Cu Injection":{"6 weeks / 1 vial":"Products Ordered:\n[date] (Pharmacy A) [initials]\nOrder #\nMedication: 1 vial of 5mL GHK-Cu 10mg/mL\nDosing: (12 units) (1.2mg)\nFrequency: Once daily\nEstimated Duration: 6 weeks","3 Months / 2 vials":"Products Ordered:\n[date] (Pharmacy A) [initials]\nOrder #\nMedication: 2 vials of 5mL GHK-Cu 10mg/mL\nDosing: (12 units) (1.2mg)\nFrequency: Once daily\nEstimated Duration: 12 weeks"},"TB-500 Injection":{"1 Month / 3 vials":"Products Ordered:\n[date] (Pharmacy A) [initials]\nOrder #\nMedication: 3 vials of 3mL TB-500 3.33mg/ml\nDosing: (30 units)\nFrequency: Daily\nEstimated Duration: 4 weeks"},"NAD+ Injection":{"Light / 1 vial":"Products Ordered:\n[date] (Pharmacy A) [initials]\nOrder #\nMedication: 1 vial of 10mL NAD+ 100mg/mL\nDosing: (50 units) 50 mg\nFrequency: 3 times a week\nEstimated Duration: 6.7 weeks","Medium / 2 vials":"Products Ordered:\n[date] (Pharmacy A) [initials]\nOrder #\nMedication: 2 vials of 10mL NAD+ 100mg/mL\nDosing: (100 units) 100 mg\nFrequency: 3 times a week\nEstimated Duration: 6.7 weeks","Strong / 4 vials":"Products Ordered:\n[date] (Pharmacy A) [initials]\nOrder #\nMedication: 4 vials of 10mL NAD+ 100mg/mL\nDosing: (200 units) 200 mg\nFrequency: 3 times a week\nEstimated Duration: 6.7 weeks","Strong / 4 vials (alt. dosing)":"Products Ordered:\n[date] (Pharmacy A) [initials]\nOrder #\nMedication: 4 vials of 10mL NAD+ 100mg/mL\nDosing: (85 units) 85 mg\nFrequency: Once a day\nEstimated Duration: 6.7 weeks"},"Wolverine Blend (BPC/TB500)":{"Light / 1 Month / 2 vials":"Products Ordered:\n[date] (Pharmacy A) [initials]\nOrder #\nMedication: 2 vials of 3mL BPC/TB500 1.66mg/3.33mg/mL\nDosing: (20 units)\nFrequency: Daily\nEstimated Duration: 4 weeks","Standard / 1 Month / 3 vials":"Products Ordered:\n[date] (Pharmacy A) [initials]\nOrder #\nMedication: 3 vials of 3mL BPC/TB500 1.66mg/3.33mg/mL\nDosing: (30 units)\nFrequency: Daily\nEstimated Duration: 4 weeks","Strong / 1 Month / 6 vials":"Products Ordered:\n[date] (Pharmacy A) [initials]\nOrder #\nMedication: 6 vials of 3mL BPC/TB500 1.66mg/3.33mg/mL\nDosing: (60 units)\nFrequency: Daily\nEstimated Duration: 4 weeks","Light / 3 Months / 6 vials":"Products Ordered:\n[date] (Pharmacy A) [initials]\nOrder #\nMedication: 4 vials of 3mL BPC/TB500 1.66mg/3.33mg/mL\nDosing: (20 units)\nFrequency: Daily\nEstimated Duration: 8 weeks","Standard / 3 Months / 9 vials":"Products Ordered:\n[date] (Pharmacy A) [initials]\nOrder #\nMedication: 6 vials of 3mL BPC/TB500 1.66mg/3.33mg/mL\nDosing: (30 units)\nFrequency: Daily\nEstimated Duration: 8 weeks","Strong / 3 Months / 18 vials":"Products Ordered:\n[date] (Pharmacy A) [initials]\nOrder #\nMedication: 12 vials of 3mL BPC/TB500 1.66mg/3.33mg/mL\nDosing: (60 units)\nFrequency: Daily\nEstimated Duration: 8 weeks"},"Glow Blend (BPC/GHK/TB)":{"1 Month / 3 vials":"Products Ordered:\n[date] (Pharmacy A) [initials]\nOrder #\nMedication: 3 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL\nDosing: (30 units)\nFrequency: Daily\nEstimated Duration: 4 weeks","Strong / 1 Month / 6 vials":"Products Ordered:\n[date] (Pharmacy A) [initials]\nOrder #\nMedication: 6 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL\nDosing: (60 units)\nFrequency: Daily\nEstimated Duration: 4 weeks"},"TESO":{"Order":"Products Ordered:\n[date] (Pharmacy A) [initials]\nOrder #\nMedication: TESO\nEstimated Duration:"}},"Pharmacy C":{"Phentermine +L +C":{"1 Month / 30 pills":"Products Ordered:\n[date] (Pharmacy C) [initials]\nOrder #\nMedication: 30 Phentermine 37.5mg\nDosing: 15-37.5mg\nFrequency: Daily\nEstimated Duration: 4 weeks","3 Months / 90 pills":"Products Ordered:\n[date] (Pharmacy C) [initials]\nOrder #\nMedication: 90 Phentermine 37.5mg\nDosing: 15-37.5mg\nFrequency: Daily\nEstimated Duration: 12 weeks"},"MOTS-c (CB4211)":{"2 Months / 8 kits":"Products Ordered:\n[date] (Pharmacy C) [initials]\nOrder #\nMedication: 8 kits of 10mg CB4211\nDosing: Reconstitute with 1mL bacteriostatic water then inject 0.5mL (50 units) subcutaneously\nFrequency: Twice weekly\nEstimated Duration: 8 weeks"},"Thymosin Alpha-1 Injection":{"1 Month / 1 vial":"Products Ordered:\n[date] (Pharmacy C) [initials]\nOrder #\nMedication: 1 vial of 15mg Thymosin Alpha-1\nDirections: Reconstitute with 3 mL BAC water\nDosing: 0.50mg (10 units)\nFrequency: Daily\nEstimated Duration: 4 weeks","3 Months / 3 vials":"Products Ordered:\n[date] (Pharmacy C) [initials]\nOrder #\nMedication: 3 vials of 15mg Thymosin Alpha-1\nDirections: Reconstitute with 3 mL BAC water\nDosing: 0.50mg (10 units)\nFrequency: Daily\nEstimated Duration: 12 weeks"},"Methylene Blue Pill 10mg":{"1 Month / 30 pills":"Products Ordered:\n[date] (Pharmacy C) [initials]\nOrder #\nMedication: 30 Methylene Blue 10mg\nDosing: Start with 10mg\nFrequency: Daily\nEstimated Duration: 4 weeks","3 Months / 90 pills":"Products Ordered:\n[date] (Pharmacy C) [initials]\nOrder #\nMedication: 90 Methylene Blue 10mg\nDosing: Start with 10mg\nFrequency: Daily\nEstimated Duration: 12 weeks"},"Methylene Blue Pill 15mg":{"1 Month / 30 pills":"Products Ordered:\n[date] (Pharmacy C) [initials]\nOrder #\nMedication: 30 Methylene Blue 15mg\nDosing: 15mg\nFrequency: Daily\nEstimated Duration: 4 weeks","3 Months / 90 pills":"Products Ordered:\n[date] (Pharmacy C) [initials]\nOrder #\nMedication: 90 Methylene Blue 15mg\nDosing: 15mg\nFrequency: Daily\nEstimated Duration: 12 weeks"},"Sermorelin Injection":{"2 Weeks / 1 vial":"Products Ordered:\n[date] (Pharmacy C) [initials]\nOrder #\nMedication: 1 vial Sermorelin 15mg\nDosing: Inject 10 units (0.10mL) SQ\nFrequency: 2x per day. 5 days on, 2 days off.\nEstimated Duration: 2 weeks","4 Weeks / 2 vials":"Products Ordered:\n[date] (Pharmacy C) [initials]\nOrder #\nMedication: 2 vials Sermorelin 15mg\nDosing: Inject 10 units (0.10mL) SQ\nFrequency: 2x per day. 5 days on, 2 days off.\nEstimated Duration: 4 weeks","3 Months / 6 vials":"Products Ordered:\n[date] (Pharmacy C) [initials]\nOrder #\nMedication: 6 vials Sermorelin 15mg\nDosing: Inject 10 units (0.10mL) SQ\nFrequency: 2x per day. 5 days on, 2 days off.\nEstimated Duration: 12 weeks"},"Synapsin Nasal Spray (RG3/Nicotinamide Ribose)":{"2 Months / 1 vial 15mL":"Products Ordered:\n[date] (Pharmacy C) [initials]\nOrder #\nMedication: 1 vial of 15mL Synapsin 2/50 mg/mL\nDosing: 1 spray per nostril\nFrequency: Once a day\nEstimated Duration: 8 weeks","4 Months / 1 vial 30mL":"Products Ordered:\n[date] (Pharmacy C) [initials]\nOrder #\nMedication: 1 vial of 30mL Synapsin 2/50 mg/mL\nDosing: 1 spray per nostril\nFrequency: Once a day\nEstimated Duration: 4 months"},"Wolverine Light (Separate powdered vials)":{"1 Month / 1 vial each":"Products Ordered:\n[date] (Pharmacy C) [initials]\nOrder #\nMedication: 1 vial of 15mg BPC-157\nDirections: Reconstitute with 7.5mL BAC water\nDosing: Inject 25 units subcutaneously\nFrequency: Daily\nEstimated Duration: 4 weeks\n\nMedication: 1 vial of 15mg TB-500\nDirections: Reconstitute with 7.5mL BAC water\nDosing: Inject 25 units subcutaneously\nFrequency: Daily\nEstimated Duration: 4 weeks","2 Months / 2 vials each":"Products Ordered:\n[date] (Pharmacy C) [initials]\nOrder #\nMedication: 2 vials of 15mg BPC-157\nDirections: Reconstitute with 7.5mL BAC water\nDosing: Inject 25 units subcutaneously\nFrequency: Daily\nEstimated Duration: 8 weeks\n\nMedication: 2 vials of 15mg TB-500\nDirections: Reconstitute with 7.5mL BAC water\nDosing: Inject 25 units subcutaneously\nFrequency: Daily\nEstimated Duration: 8 weeks","3 Months / 3 vials each":"Products Ordered:\n[date] (Pharmacy C) [initials]\nOrder #\nMedication: 3 vials of 15mg BPC-157\nDirections: Reconstitute with 7.5mL BAC water\nDosing: Inject 25 units subcutaneously\nFrequency: Daily\nEstimated Duration: 12 weeks\n\nMedication: 3 vials of 15mg TB-500\nDirections: Reconstitute with 7.5mL BAC water\nDosing: Inject 25 units subcutaneously\nFrequency: Daily\nEstimated Duration: 12 weeks"},"Pinealon":{"1 Month / 1 vial":"Products Ordered:\n[date] (Pharmacy C) [initials]\nOrder #\nMedication: 1 vial of 5mL Pinealon\nConcentration: 4mg/mL\nDosing: 25 units (1mg) subcutaneously\nFrequency: Once daily for 20 days, then cycle off\nEstimated Duration: 4 weeks"}},"Pharmacy D":{"Phentermine +L +C":{"1 Month / 30 pills":"Products Ordered:\n[date] (Pharmacy D) [initials]\nOrder #\nMedication: 30 Phentermine 37.5mg\nDosing: 15-37.5mg\nFrequency: Daily\nEstimated Duration: 4 weeks","3 Months / 90 pills":"Products Ordered:\n[date] (Pharmacy D) [initials]\nOrder #\nMedication: 90 Phentermine 37.5mg\nDosing: 15-37.5mg\nFrequency: Daily\nEstimated Duration: 12 weeks"},"DSIP Troches 300mcg":{"1 Month / 30 troches":"Products Ordered:\n[date] (Pharmacy D) [initials]\nOrder #\nMedication: 30 DSIP troches 300mcg\nDosing: 1 troche, taken 30-60 minutes before bed\nFrequency: Nightly\nEstimated Duration: 4 weeks","3 Months / 90 troches":"Products Ordered:\n[date] (Pharmacy D) [initials]\nOrder #\nMedication: 90 DSIP troches 300mcg\nDosing: 1 troche, taken 30-60 minutes before bed\nFrequency: Nightly\nEstimated Duration: 12 weeks"},"Methylene Blue Pill 10mg":{"1 Month / 30 pills":"Products Ordered:\n[date] (Pharmacy D) [initials]\nOrder #\nMedication: 30 Methylene Blue 10mg\nDosing: Start with 10mg\nFrequency: Daily\nEstimated Duration: 4 weeks","3 Months / 90 pills":"Products Ordered:\n[date] (Pharmacy D) [initials]\nOrder #\nMedication: 90 Methylene Blue 10mg\nDosing: Start with 10mg\nFrequency: Daily\nEstimated Duration: 12 weeks"},"Methylene Blue Pill 15mg":{"1 Month / 30 pills":"Products Ordered:\n[date] (Pharmacy D) [initials]\nOrder #\nMedication: 30 Methylene Blue 15mg\nDosing: 15mg\nFrequency: Daily\nEstimated Duration: 4 weeks","3 Months / 90 pills":"Products Ordered:\n[date] (Pharmacy D) [initials]\nOrder #\nMedication: 90 Methylene Blue 15mg\nDosing: 15mg\nFrequency: Daily\nEstimated Duration: 12 weeks"},"Sermorelin Injection":{"2 Weeks / 1 vial":"Products Ordered:\n[date] (Pharmacy D) [initials]\nOrder #\nMedication: 1 vial Sermorelin 15mg\nDosing: Inject 10 units (0.10mL) SQ\nFrequency: 2x per day. 5 days on, 2 days off.\nEstimated Duration: 2 weeks","4 Weeks / 2 vials":"Products Ordered:\n[date] (Pharmacy D) [initials]\nOrder #\nMedication: 2 vials Sermorelin 15mg\nDosing: Inject 10 units (0.10mL) SQ\nFrequency: 2x per day. 5 days on, 2 days off.\nEstimated Duration: 4 weeks","3 Months / 6 vials":"Products Ordered:\n[date] (Pharmacy D) [initials]\nOrder #\nMedication: 6 vials Sermorelin 15mg\nDosing: Inject 10 units (0.10mL) SQ\nFrequency: 2x per day. 5 days on, 2 days off.\nEstimated Duration: 12 weeks"},"Synapsin Nasal Spray (RG3/Nicotinamide Ribose)":{"2 Months / 1 vial 15mL":"Products Ordered:\n[date] (Pharmacy D) [initials]\nOrder #\nMedication: 1 vial of 15mL Synapsin 2/50 mg/mL\nDosing: 1 spray per nostril\nFrequency: Once a day\nEstimated Duration: 8 weeks","4 Months / 1 vial 30mL":"Products Ordered:\n[date] (Pharmacy D) [initials]\nOrder #\nMedication: 1 vial of 30mL Synapsin 2/50 mg/mL\nDosing: 1 spray per nostril\nFrequency: Once a day\nEstimated Duration: 4 months"}},"Pharmacy B":{"Tesa +L (+C if with GLP)[GO TO PHARMACY A!]":{"1 Vial / 3mL":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 1 vial of 3mL Tesa 8mg/mL\nDosing: Inject SubQ at bedtime (12 units)\nFrequency: 6 nights/week\nEstimated Duration: 4 Weeks"},"Pregnyl HCG Injectable +L +C":{"1 Vial / 10mL":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 1 vial of 10mL Pregnyl HCG 10,000 Units\nDosing:\n- TRT: 250-500 IU (25-50 units)\n- Fertility: 1000-2000 IU (100-200 units) (short-term)\nFrequency: 2x/week\nEstimated Duration: "},"CJC-1295/Ipamorelin Troche 2mg/2mg":{"1 Month / 30 troches":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 30 CJC-1295/Ipamorelin Troches 2mg/2mg\nDosing: Dissolve 1 troche under the tongue\nFrequency: Daily\nEstimated Duration: 4 weeks","2 Months / 60 troches":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 60 CJC-1295/Ipamorelin Troches 2mg/2mg\nDosing: Dissolve 1 troche under the tongue\nFrequency: Daily\nEstimated Duration: 8 weeks","3 Months / 90 troches":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 90 CJC-1295/Ipamorelin Troches 2mg/2mg\nDosing: Dissolve 1 troche under the tongue\nFrequency: Daily\nEstimated Duration: 12 weeks"},"Methylene Blue Pill 10mg":{"1 Month / 30 pills":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 30 Methylene Blue 10mg\nDosing: 1 pill\nFrequency: Daily\nEstimated Duration: 4 weeks","3 Months / 90 pills":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 90 Methylene Blue 10mg\nDosing: 1 pill\nFrequency: Daily\nEstimated Duration: 12 weeks"},"Methylene Blue Pill 15mg":{"1 Month / 30 pills":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 30 Methylene Blue 15mg\nDosing: 1 pill\nFrequency: Daily\nEstimated Duration: 4 weeks","3 Months / 90 pills":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 90 Methylene Blue 15mg\nDosing: 1 pill\nFrequency: Daily\nEstimated Duration: 12 weeks"},"Methylene Blue Pill 25mg":{"1 Month / 30 pills":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 30 Methylene Blue 25mg\nDosing: 1 pill\nFrequency: Daily\nEstimated Duration: 4 weeks","3 Months / 90 pills":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 90 Methylene Blue 25mg\nDosing: 1 pill\nFrequency: Daily\nEstimated Duration: 12 weeks"},"NAD Nasal Spray":{"1 Bottle / 15mL":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 1 bottle of 15mL NAD Nasal Spray 30mg/mL\nDosing: 1 spray per nostril\nFrequency: Daily up to 2x/day\nEstimated Duration: 22-45 days"},"Nicotine Troches":{"1 Month / 30 troches":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 30 Nicotine Troches 1mg\nDosing: 1 troche\nFrequency: As needed\nEstimated Duration: 4 weeks"},"NMN/Apigenin Capsule":{"1 Month / 30 capsules":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 30 NMN/Apigenin 250mg/150mg\nDosing: 1 capsule without food\nFrequency: Daily\nEstimated Duration: 4 weeks","3 Months / 90 capsules":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 90 NMN/Apigenin 250mg/150mg\nDosing: 1 capsule without food\nFrequency: Daily\nEstimated Duration: 12 weeks"},"PT-141 Injection":{"1 Vial / 2mL":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 1 vial of 2mL PT-141 10mg/mL\nDosing: Inject SQ (5-15 units) 45–60 min before sexual activity\nFrequency: Every 3 days\nEstimated Duration: 28 days"},"PT-141 Nasal Spray":{"1 Bottle / 3mL":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 1 bottle of 3mL PT-141 Nasal 2.5mg/0.1mL\nDosing: 1-3 sprays intranasally 45–60 min before sexual activity\nFrequency: Up to 3 sprays per day\nEstimated Duration: 4 weeks"},"SS-31 Injection":{"7 Weeks / 1 vial":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 1 vial of 6mL SS-31 50mg/mL\nDosing: 20mg (40 units)\nFrequency: 2x/week\nEstimated Duration: 7 weeks"},"Thymosin Alpha-1 Injection":{"1 Month / 1 vial":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 1 vial of 5mL Thymosin Alpha-1 3mg/mL\nDosing: 0.45mg (15 units)\nFrequency: Daily\nEstimated Duration: 4 weeks","3 Months / 3 vials":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 3 vials of 5mL Thymosin Alpha-1 3mg/mL\nDosing: 0.45mg (15 units)\nFrequency: Daily\nEstimated Duration: 12 weeks"},"Thymosin Alpha-1 Nasal Spray":{"1 Month / 1 vial":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 1 vial of 6mL Thymosin Alpha-1 3mg/mL Nasal\nDosing: 1 spray per nostril\nFrequency: Daily up to 2x/day\nEstimated Duration: 4 weeks","3 Months / 3 vials":"Products Ordered:\n[date] (Pharmacy B) [initials]\nOrder #\nMedication: 3 vials of 6mL Thymosin Alpha-1 3mg/mL Nasal\nDosing: 1 spray per nostril\nFrequency: Daily up to 2x/day\nEstimated Duration: 12 weeks"}},"Pharmacy K":{"Melanotan II +C":{"1 Vial / 5mL":"Products Ordered:\n[date] (Pharmacy K) [initials]\nMedication: 1 vial of 5mL Melanotan II 2mg/mL\nDosing: 250mcg (12.5 units)\nFrequency: Daily until desired color, then 2x/week to maintain\nEstimated Duration: Varies"},"DSIP (Deep Sleep Induced Peptide)":{"1 Vial / 5mL":"Products Ordered:\n[date] (Pharmacy K) [initials]\nMedication: 1 vial of 5mL DSIP 1mg/mL\nDosing: 200mcg (20 units)\nFrequency: Daily\nEstimated Duration: Varies"},"Epithalon":{"1 Vial / 5mL":"Products Ordered:\n[date] (Pharmacy K) [initials]\nMedication: 1 vial of 5mL Epithalon 10mg/mL\nDosing: 1.7mg (17 units)\nFrequency: Daily\nEstimated Duration: 4 weeks"},"Larazotide":{"1 Month / 60 capsules":"Products Ordered:\n[date] (Pharmacy K) [initials]\nMedication: 60 capsules Larazotide 500mcg\nDosing: 2 capsules\nFrequency: Daily\nEstimated Duration: 4 weeks","3 Months / 180 capsules":"Products Ordered:\n[date] (Pharmacy K) [initials]\nMedication: 180 capsules Larazotide 500mcg\nDosing: 2 capsules\nFrequency: Daily\nEstimated Duration: 12 weeks"},"LL-37":{"1 Vial / 5mL":"Products Ordered:\n[date] (Pharmacy K) [initials]\nMedication: 1 vial of 5mL LL-37 5mg/mL\nDosing: Inject daily, 1 month on, 1 month off\nFrequency: Daily\nEstimated Duration: 25 days"},"Tesamorelin / Ipamorelin":{"1 Month / 2 vials":"Products Ordered:\n[date] (Pharmacy K) [initials]\nMedication: 2 vials of 2mL Lyophilized Tesamorelin / Ipamorelin\nConcentration: 5mg / 2.5mg per mL\nDirections: Reconstitute each vial with 2 mL of bacteriostatic water\nDosing: 20 units (0.2 mL = 1 mg Tesamorelin / 0.5 mg Ipamorelin) subcutaneously\nFrequency: Every night at bedtime, Monday through Friday\nEstimated Duration: 4 weeks","2 Months / 4 vials":"Products Ordered:\n[date] (Pharmacy K) [initials]\nMedication: 4 vials of 2mL Lyophilized Tesamorelin / Ipamorelin\nConcentration: 5mg / 2.5mg per mL\nDirections: Reconstitute each vial with 2 mL of bacteriostatic water\nDosing: 20 units (0.2 mL = 1 mg Tesamorelin / 0.5 mg Ipamorelin) subcutaneously\nFrequency: Every night at bedtime, Monday through Friday\nEstimated Duration: 8 weeks","3 Months / 6 vials":"Products Ordered:\n[date] (Pharmacy K) [initials]\nMedication: 6 vials of 2mL Lyophilized Tesamorelin / Ipamorelin\nConcentration: 5mg / 2.5mg per mL\nDirections: Reconstitute each vial with 2 mL of bacteriostatic water\nDosing: 20 units (0.2 mL = 1 mg Tesamorelin / 0.5 mg Ipamorelin) subcutaneously\nFrequency: Every night at bedtime, Monday through Friday\nEstimated Duration: 12 weeks"},"GLOW":{"1 Vial / 3mL":"Products Ordered:\n[date] (Pharmacy K) [initials]\nMedication: 1 vial of 3mL Glow Blend (BPC-157 / GHK-Cu / TB-500)\nConcentration: 1.66mg / 9mg / 3.33mg per mL\nDosing: (30 units)\nFrequency: Daily\nEstimated Duration: 30 days"},"KLOW":{"2 vials / 14 weeks":"Products Ordered:\n[date] (Pharmacy K) [initials]\nMedication: 2 vials of 10mL KLOW (BPC-157 / GHK-Cu / TB-500 / KPV)\nConcentration: 3mg / 3mg / 3mg / 10mg per mL\nDosing: 20 units\nFrequency: 5 days on and 2 days off (Mon-Fri)\nEstimated Duration: 14 weeks"},"GHK-Cu":{"3 vials / 90 days":"Products Ordered:\n[date] (Pharmacy K) [initials]\nMedication: 3 vials of 2mL Pharmacy K GHK-Cu\nConcentration: 25mg/mL\nDosing: 10 units\nFrequency: 5 days on and 2 days off (Mon-Fri)\nEstimated Duration: 90 days"}},"Pharmacy F":{"LDN +C":{"Order":"Products Ordered:\n[date] (Pharmacy F) [initials]\nMedication: LDN\nDosing: Per medical direction\nFrequency: As directed\nEstimated Duration: "}},"RxFlow":{"[GRE] Epithalon injectable":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x5mL Epithalon\nConcentration: 2 mg/mL\nDosing: 20 units (0.2 mL = 0.4 mg) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x5mL Epithalon\nConcentration: 2 mg/mL\nDosing: 20 units (0.2 mL = 0.4 mg) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x5mL Epithalon\nConcentration: 2 mg/mL\nDosing: 20 units (0.2 mL = 0.4 mg) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 12 weeks"},"[GRE] GHK-Cu injectable":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x5mL GHK-Cu\nConcentration: 10 mg/mL\nDosing: 20 units (0.2 mL = 2 mg) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x5mL GHK-Cu\nConcentration: 10 mg/mL\nDosing: 20 units (0.2 mL = 2 mg) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x5mL GHK-Cu\nConcentration: 10 mg/mL\nDosing: 20 units (0.2 mL = 2 mg) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 12 weeks"},"[GRE] Glutathione injection":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x10mL Glutathione\nConcentration: 200 mg/mL\nDosing: 50 units (0.5 mL = 100 mg) intramuscularly\nFrequency: Two times a week\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x10mL Glutathione\nConcentration: 200 mg/mL\nDosing: 50 units (0.5 mL = 100 mg) intramuscularly\nFrequency: Two times a week\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x10mL Glutathione\nConcentration: 200 mg/mL\nDosing: 50 units (0.5 mL = 100 mg) intramuscularly\nFrequency: Two times a week\nEstimated Duration: 12 weeks"},"[GRE] GHK-Cu/Epithalon injectable":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x5mL GHK-Cu/Epithalon\nConcentration: 10 mg / 2 mg per mL\nDosing:\nFrequency:\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x5mL GHK-Cu/Epithalon\nConcentration: 10 mg / 2 mg per mL\nDosing:\nFrequency:\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x5mL GHK-Cu/Epithalon\nConcentration: 10 mg / 2 mg per mL\nDosing:\nFrequency:\nEstimated Duration: 12 weeks"},"[GRE] 5-Amino 1MQ capsules":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x30 caps 5-Amino 1MQ Capsules\nConcentration: 50 mg per capsule\nDosing: 1 capsule by mouth\nFrequency: Once daily\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x30 caps 5-Amino 1MQ Capsules\nConcentration: 50 mg per capsule\nDosing: 1 capsule by mouth\nFrequency: Once daily\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x30 caps 5-Amino 1MQ Capsules\nConcentration: 50 mg per capsule\nDosing: 1 capsule by mouth\nFrequency: Once daily\nEstimated Duration: 12 weeks"},"[GRE] MOTS-C injectable":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x5mL MOTS-C\nConcentration: 2 mg/mL\nDosing: 75 units (1.5 mg) subcutaneously\nFrequency: Mornings, 5 days on, 2 days off\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 6x5mL MOTS-C\nConcentration: 2 mg/mL\nDosing: 75 units (1.5 mg) subcutaneously\nFrequency: Mornings, 5 days on, 2 days off\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 9x5mL MOTS-C\nConcentration: 2 mg/mL\nDosing: 75 units (1.5 mg) subcutaneously\nFrequency: Mornings, 5 days on, 2 days off\nEstimated Duration: 12 weeks"},"[GRE] MOTs-C/Tesa injectable":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x5mL MOTs-C/Tesa\nConcentration: 2 mg / 3 mg per mL\nDosing: 20 units (0.2 mL = 0.4 mg MOTs-C / 0.6 mg Tesa) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x5mL MOTs-C/Tesa\nConcentration: 2 mg / 3 mg per mL\nDosing: 20 units (0.2 mL = 0.4 mg MOTs-C / 0.6 mg Tesa) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x5mL MOTs-C/Tesa\nConcentration: 2 mg / 3 mg per mL\nDosing: 20 units (0.2 mL = 0.4 mg MOTs-C / 0.6 mg Tesa) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 12 weeks"},"[GRE] AOD-9604/MOTs-C/Tesa injectable":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x5mL AOD-9604/MOTs-C/Tesa\nConcentration: 1.2 mg / 2 mg / 3 mg per mL\nDosing:\nFrequency:\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x5mL AOD-9604/MOTs-C/Tesa\nConcentration: 1.2 mg / 2 mg / 3 mg per mL\nDosing:\nFrequency:\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x5mL AOD-9604/MOTs-C/Tesa\nConcentration: 1.2 mg / 2 mg / 3 mg per mL\nDosing:\nFrequency:\nEstimated Duration: 12 weeks"},"[GRE] BPC-157 capsules":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x30 caps BPC-157 Capsules\nConcentration: 500 mcg per capsule\nDosing: 1 capsule by mouth\nFrequency: Every morning with water only\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x30 caps BPC-157 Capsules\nConcentration: 500 mcg per capsule\nDosing: 1 capsule by mouth\nFrequency: Every morning with water only\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x30 caps BPC-157 Capsules\nConcentration: 500 mcg per capsule\nDosing: 1 capsule by mouth\nFrequency: Every morning with water only\nEstimated Duration: 12 weeks"},"[GRE] BPC-157 injectable":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x5mL BPC-157\nConcentration: 3 mg/mL\nDosing: 20 units (0.2 mL = 0.6 mg) intramuscularly at the injury site\nFrequency: Once daily\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x5mL BPC-157\nConcentration: 3 mg/mL\nDosing: 20 units (0.2 mL = 0.6 mg) intramuscularly at the injury site\nFrequency: Once daily\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x5mL BPC-157\nConcentration: 3 mg/mL\nDosing: 20 units (0.2 mL = 0.6 mg) intramuscularly at the injury site\nFrequency: Once daily\nEstimated Duration: 12 weeks"},"[GRE] BPC-157/TB-500 capsules":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x30 caps BPC-157/TB-500 Capsules\nConcentration:\nDosing:\nFrequency:\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x30 caps BPC-157/TB-500 Capsules\nConcentration:\nDosing:\nFrequency:\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x30 caps BPC-157/TB-500 Capsules\nConcentration:\nDosing:\nFrequency:\nEstimated Duration: 12 weeks"},"[GRE] GLOW":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x5mL GLOW (BPC-157/KPV/TB-500)\nConcentration: 3 mg / 3 mg / 3 mg per mL\nDosing: 20 units (0.2 mL = 0.6 mg each) subcutaneously\nFrequency: Mornings, Monday through Friday\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x5mL GLOW (BPC-157/KPV/TB-500)\nConcentration: 3 mg / 3 mg / 3 mg per mL\nDosing: 20 units (0.2 mL = 0.6 mg each) subcutaneously\nFrequency: Mornings, Monday through Friday\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x5mL GLOW (BPC-157/KPV/TB-500)\nConcentration: 3 mg / 3 mg / 3 mg per mL\nDosing: 20 units (0.2 mL = 0.6 mg each) subcutaneously\nFrequency: Mornings, Monday through Friday\nEstimated Duration: 12 weeks"},"[GRE] KLOW":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x5mL KLOW (BPC-157/GHK-Cu/KPV/TB-500)\nConcentration: 3 mg / 10 mg / 3 mg / 3 mg per mL\nDosing: 20 units (0.2 mL = 0.6 mg BPC-157 / 2 mg GHK-Cu / 0.6 mg KPV / 0.6 mg TB-500) subcutaneously\nFrequency: Mornings, Monday through Friday\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x5mL KLOW (BPC-157/GHK-Cu/KPV/TB-500)\nConcentration: 3 mg / 10 mg / 3 mg / 3 mg per mL\nDosing: 20 units (0.2 mL = 0.6 mg BPC-157 / 2 mg GHK-Cu / 0.6 mg KPV / 0.6 mg TB-500) subcutaneously\nFrequency: Mornings, Monday through Friday\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x5mL KLOW (BPC-157/GHK-Cu/KPV/TB-500)\nConcentration: 3 mg / 10 mg / 3 mg / 3 mg per mL\nDosing: 20 units (0.2 mL = 0.6 mg BPC-157 / 2 mg GHK-Cu / 0.6 mg KPV / 0.6 mg TB-500) subcutaneously\nFrequency: Mornings, Monday through Friday\nEstimated Duration: 12 weeks"},"[GRE] Wolverine":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x5mL Wolverine (BPC-157/TB-500)\nConcentration: 3 mg / 3 mg per mL\nDosing: 20 units (0.2 mL = 0.6 mg each) subcutaneously at site of injury\nFrequency: Mornings, Monday through Friday\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x5mL Wolverine (BPC-157/TB-500)\nConcentration: 3 mg / 3 mg per mL\nDosing: 20 units (0.2 mL = 0.6 mg each) subcutaneously at site of injury\nFrequency: Mornings, Monday through Friday\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x5mL Wolverine (BPC-157/TB-500)\nConcentration: 3 mg / 3 mg per mL\nDosing: 20 units (0.2 mL = 0.6 mg each) subcutaneously at site of injury\nFrequency: Mornings, Monday through Friday\nEstimated Duration: 12 weeks"},"[GRE] CJC/Ipamorelin injectable":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x5mL CJC/Ipamorelin\nConcentration: 1.2 mg / 2 mg per mL\nDosing: 20 units (0.2 mL = 0.24 mg CJC / 0.4 mg Ipamorelin) subcutaneously\nFrequency: Before bed, Monday through Friday, on an empty stomach\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x5mL CJC/Ipamorelin\nConcentration: 1.2 mg / 2 mg per mL\nDosing: 20 units (0.2 mL = 0.24 mg CJC / 0.4 mg Ipamorelin) subcutaneously\nFrequency: Before bed, Monday through Friday, on an empty stomach\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x5mL CJC/Ipamorelin\nConcentration: 1.2 mg / 2 mg per mL\nDosing: 20 units (0.2 mL = 0.24 mg CJC / 0.4 mg Ipamorelin) subcutaneously\nFrequency: Before bed, Monday through Friday, on an empty stomach\nEstimated Duration: 12 weeks"},"[GRE] DSIP injectable":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x5mL DSIP\nConcentration: 1 mg/mL\nDosing: 20 units (0.2 mL = 0.2 mg) subcutaneously\nFrequency: Once nightly at bedtime, Monday through Friday\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x5mL DSIP\nConcentration: 1 mg/mL\nDosing: 20 units (0.2 mL = 0.2 mg) subcutaneously\nFrequency: Once nightly at bedtime, Monday through Friday\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x5mL DSIP\nConcentration: 1 mg/mL\nDosing: 20 units (0.2 mL = 0.2 mg) subcutaneously\nFrequency: Once nightly at bedtime, Monday through Friday\nEstimated Duration: 12 weeks"},"[GRE] DSIP/BPC/CJC injectable":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x5mL DSIP/BPC/CJC\nConcentration: 1 mg / 2 mg / 2 mg per mL\nDosing: 20 units (0.2 mL = 0.2 mg DSIP / 0.4 mg BPC / 0.4 mg CJC) subcutaneously\nFrequency: Once nightly at bedtime, Monday through Friday\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x5mL DSIP/BPC/CJC\nConcentration: 1 mg / 2 mg / 2 mg per mL\nDosing: 20 units (0.2 mL = 0.2 mg DSIP / 0.4 mg BPC / 0.4 mg CJC) subcutaneously\nFrequency: Once nightly at bedtime, Monday through Friday\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x5mL DSIP/BPC/CJC\nConcentration: 1 mg / 2 mg / 2 mg per mL\nDosing: 20 units (0.2 mL = 0.2 mg DSIP / 0.4 mg BPC / 0.4 mg CJC) subcutaneously\nFrequency: Once nightly at bedtime, Monday through Friday\nEstimated Duration: 12 weeks"},"[GRE] PT-141 injectable":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x5mL PT-141\nConcentration: 2 mg/mL\nDosing: 20 units (0.2 mL = 0.4 mg) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x5mL PT-141\nConcentration: 2 mg/mL\nDosing: 20 units (0.2 mL = 0.4 mg) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x5mL PT-141\nConcentration: 2 mg/mL\nDosing: 20 units (0.2 mL = 0.4 mg) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 12 weeks"},"[GRE] Kisspeptin injectable":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x5mL Kisspeptin\nConcentration: 1 mg/mL\nDosing: 10 units (0.1 mL = 0.1 mg) subcutaneously\nFrequency: Two times per week\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x5mL Kisspeptin\nConcentration: 1 mg/mL\nDosing: 10 units (0.1 mL = 0.1 mg) subcutaneously\nFrequency: Two times per week\nEstimated Duration: 8 weeks"},"[GRE] LL-37 injectable":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x5mL LL-37\nConcentration: 2 mg/mL\nDosing: 20 units (0.2 mL = 0.4 mg) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x5mL LL-37\nConcentration: 2 mg/mL\nDosing: 20 units (0.2 mL = 0.4 mg) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x5mL LL-37\nConcentration: 2 mg/mL\nDosing: 20 units (0.2 mL = 0.4 mg) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 12 weeks"},"[GRE] Pinealon/PE22-28/Selank injectable":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x5mL Pinealon/PE22-28/Selank\nConcentration: 2 mg / 2 mg / 2 mg per mL\nDosing: 20 units (0.2 mL = 0.4 mg each) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x5mL Pinealon/PE22-28/Selank\nConcentration: 2 mg / 2 mg / 2 mg per mL\nDosing: 20 units (0.2 mL = 0.4 mg each) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x5mL Pinealon/PE22-28/Selank\nConcentration: 2 mg / 2 mg / 2 mg per mL\nDosing: 20 units (0.2 mL = 0.4 mg each) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 12 weeks"},"[GRE] Semax/Selank injectable":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x5mL Semax/Selank\nConcentration: 1 mg / 1 mg per mL\nDosing: 20 units (0.2 mL = 0.2 mg each) subcutaneously\nFrequency: Every day, Monday through Friday\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x5mL Semax/Selank\nConcentration: 1 mg / 1 mg per mL\nDosing: 20 units (0.2 mL = 0.2 mg each) subcutaneously\nFrequency: Every day, Monday through Friday\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x5mL Semax/Selank\nConcentration: 1 mg / 1 mg per mL\nDosing: 20 units (0.2 mL = 0.2 mg each) subcutaneously\nFrequency: Every day, Monday through Friday\nEstimated Duration: 12 weeks"},"[GRE] Tesa injectable":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x5mL Tesa\nConcentration: 3 mg/mL\nDosing: 20 units (0.2 mL = 0.6 mg) subcutaneously\nFrequency: Every night at bedtime, Monday through Friday\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x5mL Tesa\nConcentration: 3 mg/mL\nDosing: 20 units (0.2 mL = 0.6 mg) subcutaneously\nFrequency: Every night at bedtime, Monday through Friday\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x5mL Tesa\nConcentration: 3 mg/mL\nDosing: 20 units (0.2 mL = 0.6 mg) subcutaneously\nFrequency: Every night at bedtime, Monday through Friday\nEstimated Duration: 12 weeks"},"[GRE] Tesa/Ipamorelin injectable":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x5mL Tesa/Ipamorelin\nConcentration: 3 mg / 2 mg per mL\nDosing: 20 units (0.2 mL = 0.6 mg Tesa / 0.4 mg Ipamorelin) subcutaneously\nFrequency: Every night at bedtime, Monday through Friday\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x5mL Tesa/Ipamorelin\nConcentration: 3 mg / 2 mg per mL\nDosing: 20 units (0.2 mL = 0.6 mg Tesa / 0.4 mg Ipamorelin) subcutaneously\nFrequency: Every night at bedtime, Monday through Friday\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x5mL Tesa/Ipamorelin\nConcentration: 3 mg / 2 mg per mL\nDosing: 20 units (0.2 mL = 0.6 mg Tesa / 0.4 mg Ipamorelin) subcutaneously\nFrequency: Every night at bedtime, Monday through Friday\nEstimated Duration: 12 weeks"},"[GRE] Thymosin A-1 injectable":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x5mL Thymosin A-1\nConcentration: 5 mg/mL\nDosing: 20 units (0.2 mL = 1 mg) subcutaneously\nFrequency: Every day, Monday through Friday\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x5mL Thymosin A-1\nConcentration: 5 mg/mL\nDosing: 20 units (0.2 mL = 1 mg) subcutaneously\nFrequency: Every day, Monday through Friday\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x5mL Thymosin A-1\nConcentration: 5 mg/mL\nDosing: 20 units (0.2 mL = 1 mg) subcutaneously\nFrequency: Every day, Monday through Friday\nEstimated Duration: 12 weeks"},"[GRE] NAD+ injectable (50 units)":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x10mL NAD+\nConcentration: 100 mg/mL\nDosing: 50 units (0.5 mL = 50 mg) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x10mL NAD+\nConcentration: 100 mg/mL\nDosing: 50 units (0.5 mL = 50 mg) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x10mL NAD+\nConcentration: 100 mg/mL\nDosing: 50 units (0.5 mL = 50 mg) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 12 weeks"},"[GRE] NAD+ injectable (20 units)":{"1 Month":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 1x10mL NAD+\nConcentration: 100 mg/mL\nDosing: 20 units (0.2 mL = 20 mg) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 2x10mL NAD+\nConcentration: 100 mg/mL\nDosing: 20 units (0.2 mL = 20 mg) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Greenwich) [initials]\nMedication: 3x10mL NAD+\nConcentration: 100 mg/mL\nDosing: 20 units (0.2 mL = 20 mg) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 12 weeks"}},"Pharmacy L":{"[BLRX] BPC-157 injectable":{"1 Month":"Products Ordered:\n[date] (Pharmacy L) [initials]\nMedication: 1x5mL BPC-157\nConcentration: 5 mg/mL\nDosing: 20 units (0.2 mL = 1 mg) intramuscularly at the injury site\nFrequency: Once daily\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Pharmacy L) [initials]\nMedication: 2x5mL BPC-157\nConcentration: 5 mg/mL\nDosing: 20 units (0.2 mL = 1 mg) intramuscularly at the injury site\nFrequency: Once daily\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Pharmacy L) [initials]\nMedication: 3x5mL BPC-157\nConcentration: 5 mg/mL\nDosing: 20 units (0.2 mL = 1 mg) intramuscularly at the injury site\nFrequency: Once daily\nEstimated Duration: 12 weeks"},"[BLRX] TB-500 injectable":{"7 Weeks":"Products Ordered:\n[date] (Pharmacy L) [initials]\nMedication: 1x5mL TB-500\nConcentration: 10 mg/mL\nDosing: 10 units (0.1 mL = 1 mg) subcutaneously\nFrequency: Once daily\nEstimated Duration: 7 weeks","14 Weeks":"Products Ordered:\n[date] (Pharmacy L) [initials]\nMedication: 2x5mL TB-500\nConcentration: 10 mg/mL\nDosing: 10 units (0.1 mL = 1 mg) subcutaneously\nFrequency: Once daily\nEstimated Duration: 14 weeks"},"[BLRX] GHK-Cu injectable":{"3 Months":"Products Ordered:\n[date] (Pharmacy L) [initials]\nMedication: 1x3mL GHK-Cu\nConcentration: 50 mg/mL\nDosing: 5 units (0.05 mL = 2.5 mg) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 12 weeks","6 Months":"Products Ordered:\n[date] (Pharmacy L) [initials]\nMedication: 2x3mL GHK-Cu\nConcentration: 50 mg/mL\nDosing: 5 units (0.05 mL = 2.5 mg) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 24 weeks","9 Months":"Products Ordered:\n[date] (Pharmacy L) [initials]\nMedication: 3x3mL GHK-Cu\nConcentration: 50 mg/mL\nDosing: 5 units (0.05 mL = 2.5 mg) subcutaneously\nFrequency: Once daily, Monday through Friday\nEstimated Duration: 36 weeks"},"[BLRX] MOTS-C injectable":{"2.5 Months":"Products Ordered:\n[date] (Pharmacy L) [initials]\nMedication: 2x5mL MOTS-C\nConcentration: 10 mg/mL\nDosing: 50 units (0.5 mL = 5 mg) subcutaneously\nFrequency: Twice weekly, in the morning or before your workout\nEstimated Duration: 10 weeks","5 Months":"Products Ordered:\n[date] (Pharmacy L) [initials]\nMedication: 4x5mL MOTS-C\nConcentration: 10 mg/mL\nDosing: 50 units (0.5 mL = 5 mg) subcutaneously\nFrequency: Twice weekly, in the morning or before your workout\nEstimated Duration: 20 weeks"},"[BLRX] NAD+ injectable":{"1 Month":"Products Ordered:\n[date] (Pharmacy L) [initials]\nMedication: 1x5mL NAD+\nConcentration: 200 mg/mL\nDosing: 40 units (0.4 mL = 80 mg) subcutaneously\nFrequency: Three times a week\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Pharmacy L) [initials]\nMedication: 2x5mL NAD+\nConcentration: 200 mg/mL\nDosing: 40 units (0.4 mL = 80 mg) subcutaneously\nFrequency: Three times a week\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Pharmacy L) [initials]\nMedication: 3x5mL NAD+\nConcentration: 200 mg/mL\nDosing: 40 units (0.4 mL = 80 mg) subcutaneously\nFrequency: Three times a week\nEstimated Duration: 12 weeks"},"[BLRX] NAD Nasal Spray":{"2 Months":"Products Ordered:\n[date] (Pharmacy L) [initials]\nMedication: 1x10mL NAD Nasal Spray\nConcentration: 300 mg/mL\nDosing: 1 spray in each nostril every morning\nFrequency: Daily, up to 2 times per day as directed\nEstimated Duration: 8 weeks","4 Months":"Products Ordered:\n[date] (Pharmacy L) [initials]\nMedication: 2x10mL NAD Nasal Spray\nConcentration: 300 mg/mL\nDosing: 1 spray in each nostril every morning\nFrequency: Daily, up to 2 times per day as directed\nEstimated Duration: 16 weeks"},"[BLRX] Tesamorelin injectable":{"1 Month":"Products Ordered:\n[date] (Pharmacy L) [initials]\nMedication: 1x5mL Tesamorelin\nConcentration: 5 mg/mL\nDosing: 20 units (0.2 mL = 1 mg) subcutaneously\nFrequency: Every night at bedtime, Monday through Friday\nEstimated Duration: 4 weeks","2 Months":"Products Ordered:\n[date] (Pharmacy L) [initials]\nMedication: 2x5mL Tesamorelin\nConcentration: 5 mg/mL\nDosing: 20 units (0.2 mL = 1 mg) subcutaneously\nFrequency: Every night at bedtime, Monday through Friday\nEstimated Duration: 8 weeks","3 Months":"Products Ordered:\n[date] (Pharmacy L) [initials]\nMedication: 3x5mL Tesamorelin\nConcentration: 5 mg/mL\nDosing: 20 units (0.2 mL = 1 mg) subcutaneously\nFrequency: Every night at bedtime, Monday through Friday\nEstimated Duration: 12 weeks"}},"Stacks":{"Warrior Stack - 3 Months":{"Paid in Full":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 14 SLU-PP-332 100mcg\nTiming: Weeks 1-2\nDosing: 1 pill\nFrequency: Daily\nEstimated Duration: 2 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 42 SLU-PP-332 200mcg\nTiming: Weeks 3-6\nDosing:\n- After finishing 100mcg: 1 capsule for 2 weeks\n- Onwards: 2 capsules (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 4 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 42 AOD 600mcg\nTiming: Weeks 7-12\nDosing: 1 troche\nFrequency: Daily\nEstimated Duration: 6 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 77 O-304 50mg\nTiming: Weeks 7-12\nDosing:\n- First 7 days: 1 cap (50mg)\n- Day 8 & on: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 6 weeks"},"Warrior Stack - 6 Months":{"Paid in Full":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 14 SLU-PP-332 100mcg\nTiming: Weeks 1-2\nDosing: 1 pill\nFrequency: Daily\nEstimated Duration: 2 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 70 SLU-PP-332 200mcg\nTiming: Weeks 3-8\nDosing:\n- After finishing 100mcg: 1 capsule for 2 weeks\n- Onwards: 2 capsules (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 6 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 120 AOD 600mcg\nTiming: Weeks 9-25\nDosing: 1 troche\nFrequency: Daily\nEstimated Duration: 17 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 233 O-304 50mg\nTiming: Weeks 9-25\nDosing:\n- First 7 days: 1 cap (50mg)\n- Day 8 & on: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 17 weeks","1 of 2 Installments (Weeks 1-13)":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 14 SLU-PP-332 100mcg\nTiming: Weeks 1-2\nDosing: 1 pill\nFrequency: Daily\nEstimated Duration: 2 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 70 SLU-PP-332 200mcg\nTiming: Weeks 3-8\nDosing:\n- After finishing 100mcg: 1 capsule for 2 weeks\n- Onwards: 2 capsules (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 6 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 35 AOD 600mcg\nTiming: Weeks 9-13\nDosing: 1 troche\nFrequency: Daily\nEstimated Duration: 5 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 63 O-304 50mg\nTiming: Weeks 9-13\nDosing:\n- First 7 days: 1 cap (50mg)\n- Day 8 & on: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 5 weeks","2 of 2 Installments (Weeks 14-25)":"[date] (Pharmacy J) [initials]\nMedication: 85 AOD 600mcg\nTiming: Weeks 14-25\nDosing: 1 troche\nFrequency: Daily\nEstimated Duration: 12 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 170 O-304 50mg\nTiming: Weeks 14-25\nDosing: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 12 weeks","1 of 3 Installments (Weeks 1-8)":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 14 SLU-PP-332 100mcg\nTiming: Weeks 1-2\nDosing: 1 pill\nFrequency: Daily\nEstimated Duration: 2 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 70 SLU-PP-332 200mcg\nTiming: Weeks 3-8\nDosing:\n- After finishing 100mcg: 1 capsule for 2 weeks\n- Onwards: 2 capsules (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 6 weeks","2 of 3 Installments (Weeks 9-17)":"[date] (Pharmacy J) [initials]\nMedication: 63 AOD 600mcg\nTiming: Weeks 9-17\nDosing: 1 troche\nFrequency: Daily\nEstimated Duration: 9 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 119 O-304 50mg\nTiming: Weeks 9-17\nDosing:\n- First 7 days: 1 cap (50mg)\n- Day 8 & on: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 9 weeks","3 of 3 Installments (Weeks 18-25)":"[date] (Pharmacy J) [initials]\nMedication: 57 AOD 600mcg\nTiming: Weeks 18-25\nDosing: 1 troche\nFrequency: Daily\nEstimated Duration: 8 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 114 O-304 50mg\nTiming: Weeks 18-25\nDosing: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 8 weeks","1 of 4 Installments (Weeks 1-6)":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 14 SLU-PP-332 100mcg\nTiming: Weeks 1-2\nDosing: 1 pill\nFrequency: Daily\nEstimated Duration: 2 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 42 SLU-PP-332 200mcg\nTiming: Weeks 3-6\nDosing:\n- After finishing 100mcg: 1 capsule for 2 weeks\n- Onwards: 2 capsules (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 4 weeks","2 of 4 Installments (Weeks 7-13)":"[date] (Pharmacy J) [initials]\nMedication: 28 SLU-PP-332 200mcg\nTiming: Weeks 7-8\nDosing: 2 pills (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 2 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 35 AOD 600mcg\nTiming: Weeks 9-13\nDosing: 1 troche\nFrequency: Daily\nEstimated Duration: 5 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 63 O-304 50mg\nTiming: Weeks 9-13\nDosing:\n- First 7 days: 1 cap (50mg)\n- Day 8 & on: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 5 weeks","3 of 4 Installments (Weeks 14-19)":"[date] (Pharmacy J) [initials]\nMedication: 42 AOD 600mcg\nTiming: Weeks 14-19\nDosing: 1 troche\nFrequency: Daily\nEstimated Duration: 6 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 84 O-304 50mg\nTiming: Weeks 14-19\nDosing: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 6 weeks","4 of 4 Installments (Weeks 20-25)":"[date] (Pharmacy J) [initials]\nMedication: 43 AOD 600mcg\nTiming: Weeks 20-25\nDosing: 1 troche\nFrequency: Daily\nEstimated Duration: 6 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 86 O-304 50mg\nTiming: Weeks 20-25\nDosing: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 6 weeks"},"Warrior Stack - 12 Months":{"Paid in Full":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 14 SLU-PP-332 100mcg\nTiming: Weeks 1-2\nDosing: 1 pill\nFrequency: Daily\nEstimated Duration: 2 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 70 SLU-PP-332 200mcg\nTiming: Weeks 3-8\nDosing:\n- After finishing 100mcg: 1 capsule for 2 weeks\n- Onwards: 2 capsules (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 6 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 308 AOD 600mcg\nTiming: Weeks 9-52\nDosing: 1 troche\nFrequency: Daily\nEstimated Duration: 44 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 609 O-304 50mg\nTiming: Weeks 9-52\nDosing:\n- First 7 days: 1 cap (50mg)\n- Day 8 & on: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 44 weeks","1 of 2 Installments (Weeks 1-26)":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 14 SLU-PP-332 100mcg\nTiming: Weeks 1-2\nDosing: 1 pill\nFrequency: Daily\nEstimated Duration: 2 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 70 SLU-PP-332 200mcg\nTiming: Weeks 3-8\nDosing:\n- After finishing 100mcg: 1 capsule for 2 weeks\n- Onwards: 2 capsules (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 6 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 126 AOD 600mcg\nTiming: Weeks 9-26\nDosing: 1 troche\nFrequency: Daily\nEstimated Duration: 18 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 245 O-304 50mg\nTiming: Weeks 9-26\nDosing:\n- First 7 days: 1 cap (50mg)\n- Day 8 & on: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 18 weeks","2 of 2 Installments (Weeks 27-52)":"[date] (Pharmacy J) [initials]\nMedication: 182 AOD 600mcg\nTiming: Weeks 27-52\nDosing: 1 troche\nFrequency: Daily\nEstimated Duration: 26 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 364 O-304 50mg\nTiming: Weeks 27-52\nDosing: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 26 weeks","1 of 3 Installments (Weeks 1-17)":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 14 SLU-PP-332 100mcg\nTiming: Weeks 1-2\nDosing: 1 pill\nFrequency: Daily\nEstimated Duration: 2 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 70 SLU-PP-332 200mcg\nTiming: Weeks 3-8\nDosing:\n- After finishing 100mcg: 1 capsule for 2 weeks\n- Onwards: 2 capsules (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 6 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 63 AOD 600mcg\nTiming: Weeks 9-17\nDosing: 1 troche\nFrequency: Daily\nEstimated Duration: 9 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 119 O-304 50mg\nTiming: Weeks 9-17\nDosing:\n- First 7 days: 1 cap (50mg)\n- Day 8 & on: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 9 weeks","2 of 3 Installments (Weeks 18-35)":"[date] (Pharmacy J) [initials]\nMedication: 126 AOD 600mcg\nTiming: Weeks 18-35\nDosing: 1 troche\nFrequency: Daily\nEstimated Duration: 18 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 252 O-304 50mg\nTiming: Weeks 18-35\nDosing: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 18 weeks","3 of 3 Installments (Weeks 36-52)":"[date] (Pharmacy J) [initials]\nMedication: 119 AOD 600mcg\nTiming: Weeks 36-52\nDosing: 1 troche\nFrequency: Daily\nEstimated Duration: 17 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 238 O-304 50mg\nTiming: Weeks 36-52\nDosing: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 17 weeks","1 of 4 Installments (Weeks 1-8)":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 14 SLU-PP-332 100mcg\nTiming: Weeks 1-2\nDosing: 1 pill\nFrequency: Daily\nEstimated Duration: 2 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 70 SLU-PP-332 200mcg\nTiming: Weeks 3-8\nDosing:\n- After finishing 100mcg: 1 capsule for 2 weeks\n- Onwards: 2 capsules (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 6 weeks","2 of 4 Installments (Weeks 9-23)":"[date] (Pharmacy J) [initials]\nMedication: 105 AOD 600mcg\nTiming: Weeks 9-23\nDosing: 1 troche\nFrequency: Daily\nEstimated Duration: 15 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 203 O-304 50mg\nTiming: Weeks 9-23\nDosing:\n- First 7 days: 1 cap (50mg)\n- Day 8 & on: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 15 weeks","3 of 4 Installments (Weeks 24-38)":"[date] (Pharmacy J) [initials]\nMedication: 105 AOD 600mcg\nTiming: Weeks 24-38\nDosing: 1 troche\nFrequency: Daily\nEstimated Duration: 15 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 210 O-304 50mg\nTiming: Weeks 24-38\nDosing: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 15 weeks","4 of 4 Installments (Weeks 39-52)":"[date] (Pharmacy J) [initials]\nMedication: 98 AOD 600mcg\nTiming: Weeks 39-52\nDosing: 1 troche\nFrequency: Daily\nEstimated Duration: 14 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 196 O-304 50mg\nTiming: Weeks 39-52\nDosing: 2 capsules of 50mg\nFrequency: Daily\nEstimated Duration: 14 weeks"},"WL Peptides New Patient - 1 Month":{"Paid in Full":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 14 SLU-PP-332 100mcg\nTiming: Weeks 1-2\nDosing: 1 pill\nFrequency: Once Daily\nEstimated Duration: 2 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 18 SLU-PP-332 200mcg\nTiming: Weeks 3-4\nDosing:\n- After finishing 100mcg: 1 capsule for 2 weeks\n- Onwards: 2 capsules (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 2 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 30 AOD 600mcg\nTiming: Daily\nDosing: 1 troche between cheek and gum. No food 2 hours before or after.\nFrequency: Daily\nEstimated Duration: 4 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 46 O-304 50mg\nTiming: Weeks 1-4\nDosing:\n- First 2 weeks: 1 pill\n- Onwards: 2 pills (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 4 weeks"},"WL Peptides New Patient - 3 Months":{"Paid in Full":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 14 SLU-PP-332 100mcg\nTiming: Weeks 1-2\nDosing: 1 pill\nFrequency: Once Daily\nEstimated Duration: 2 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 138 SLU-PP-332 200mcg\nTiming: Weeks 3 and on\nDosing:\n- After finishing 100mcg: 1 capsule for 2 weeks\n- Onwards: 2 capsules (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: Rest of 3 months\n\n[date] (Pharmacy J) [initials]\nMedication: 90 AOD 600mcg\nTiming: Daily\nDosing: 1 troche between cheek and gum. No food 2 hours before or after.\nFrequency: Daily\nEstimated Duration: 12 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 166 O-304 50mg\nTiming: Weeks 1 and on\nDosing:\n- First 2 weeks: 1 pill\n- Onwards: 2 pills (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 12 weeks","1 of 2 Installments (Wks 1-6)":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 14 SLU-PP-332 100mcg\nTiming: Weeks 1-2\nDosing: 1 pill\nFrequency: Once Daily\nEstimated Duration: 2 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 42 SLU-PP-332 200mcg\nTiming: Weeks 3-6\nDosing:\n- After finishing 100mcg: 1 capsule for 2 weeks\n- Onwards: 2 capsules (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 4 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 42 AOD 600mcg\nTiming: Weeks 1-6\nDosing: 1 troche between cheek and gum. No food 2 hours before or after.\nFrequency: Daily\nEstimated Duration: 6 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 14 O-304 50mg\nTiming: Weeks 1-2\nDosing: 1 cap in the morning\nFrequency: Once Daily\nEstimated Duration: 2 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 56 O-304 50mg\nTiming: Weeks 3-6\nDosing: 2 caps (morning and early afternoon)\nFrequency: Daily\nEstimated Duration: 4 weeks","2 of 2 Installments (Wks 7-12)":"[date] (Pharmacy J) [initials]\nMedication: 96 SLU-PP-332 200mcg\nTiming: Weeks 7-12\nDosing: 2 pills (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 6 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 48 AOD 600mcg\nTiming: Weeks 7-12\nDosing: 1 troche between cheek and gum. No food 2 hours before or after.\nFrequency: Daily\nEstimated Duration: 6 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 96 O-304 50mg\nTiming: Weeks 7-12\nDosing: 2 caps (morning and early afternoon)\nFrequency: Daily\nEstimated Duration: 6 weeks"},"WL Peptides Existing Patient - 1 Month":{"Paid in Full":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 60 SLU-PP-332 200mcg\nTiming: Daily\nDosing: 2 pills (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 4 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 30 AOD 600mcg\nTiming: Daily\nDosing: 1 troche between cheek and gum. No food 2 hours before or after.\nFrequency: Daily\nEstimated Duration: 4 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 60 O-304 50mg\nTiming: Daily\nDosing: 2 caps\nFrequency: Daily\nEstimated Duration: 4 weeks"},"WL Peptides Existing Patient - 3 Months":{"Paid in Full":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 180 SLU-PP-332 200mcg\nTiming: Daily\nDosing: 2 pills (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 12 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 90 AOD 600mcg\nTiming: Daily\nDosing: 1 troche between cheek and gum. No food 2 hours before or after.\nFrequency: Daily\nEstimated Duration: 12 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 180 O-304 50mg\nTiming: Daily\nDosing: 2 caps\nFrequency: Daily\nEstimated Duration: 12 weeks","1 of 2 Installments (Wks 1-6)":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 90 SLU-PP-332 200mcg\nTiming: Weeks 1-6\nDosing: 2 pills (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 6 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 45 AOD 600mcg\nTiming: Weeks 1-6\nDosing: 1 troche between cheek and gum. No food 2 hours before or after.\nFrequency: Daily\nEstimated Duration: 6 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 90 O-304 50mg\nTiming: Weeks 1-6\nDosing: 2 caps\nFrequency: Daily\nEstimated Duration: 6 weeks","2 of 2 Installments (Wks 7-12)":"[date] (Pharmacy J) [initials]\nMedication: 90 SLU-PP-332 200mcg\nTiming: Weeks 7-12\nDosing: 2 pills (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 6 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 45 AOD 600mcg\nTiming: Weeks 7-12\nDosing: 1 troche between cheek and gum. No food 2 hours before or after.\nFrequency: Daily\nEstimated Duration: 6 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 90 O-304 50mg\nTiming: Weeks 7-12\nDosing: 2 caps\nFrequency: Daily\nEstimated Duration: 6 weeks","1 of 3 Installments (Wks 1-4)":"Products Ordered:\n[date] (Pharmacy J) [initials]\nMedication: 60 SLU-PP-332 200mcg\nTiming: Weeks 1-4\nDosing: 2 pills (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 4 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 30 AOD 600mcg\nTiming: Weeks 1-4\nDosing: 1 troche between cheek and gum. No food 2 hours before or after.\nFrequency: Daily\nEstimated Duration: 4 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 60 O-304 50mg\nTiming: Weeks 1-4\nDosing: 2 caps\nFrequency: Daily\nEstimated Duration: 4 weeks","2 of 3 Installments (Wks 5-8)":"[date] (Pharmacy J) [initials]\nMedication: 60 SLU-PP-332 200mcg\nTiming: Weeks 5-8\nDosing: 2 pills (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 4 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 30 AOD 600mcg\nTiming: Weeks 5-8\nDosing: 1 troche between cheek and gum. No food 2 hours before or after.\nFrequency: Daily\nEstimated Duration: 4 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 60 O-304 50mg\nTiming: Weeks 5-8\nDosing: 2 caps\nFrequency: Daily\nEstimated Duration: 4 weeks","3 of 3 Installments (Wks 9-12)":"[date] (Pharmacy J) [initials]\nMedication: 60 SLU-PP-332 200mcg\nTiming: Weeks 9-12\nDosing: 2 pills (one in the morning & one in the early afternoon)\nFrequency: Daily\nEstimated Duration: 4 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 30 AOD 600mcg\nTiming: Weeks 9-12\nDosing: 1 troche between cheek and gum. No food 2 hours before or after.\nFrequency: Daily\nEstimated Duration: 4 weeks\n\n[date] (Pharmacy J) [initials]\nMedication: 60 O-304 50mg\nTiming: Weeks 9-12\nDosing: 2 caps\nFrequency: Daily\nEstimated Duration: 4 weeks"}},"Rare Orders/Blends":{"Titan Standard - 3 Months":{"Paid in Full":"Products Ordered:\n[date] 9 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]\nDosing: 30 units a day\nTotal Duration: 3 months\n\n[date] 90 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 1 pill daily on empty stomach\nTotal Duration: 3 months","1 of 2 Installments (Wks 1-6)":"Products Ordered:\n[date] 5 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]\nDosing: 30 units a day\nTotal Duration: 6 weeks\n\n[date] 42 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 1 pill daily on empty stomach\nTotal Duration: 6 weeks","2 of 2 Installments (Wks 7-12)":"[date] 4 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]\nDosing: 30 units a day\nTotal Duration: 6 weeks\n\n[date] 48 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 1 pill daily on empty stomach\nTotal Duration: 6 weeks","1 of 3 Installments (Wks 1-4)":"Products Ordered:\n[date] 3 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]\nDosing: 30 units a day\nTotal Duration: 1 month\n\n[date] 30 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 1 pill daily on empty stomach\nTotal Duration: 1 month","2 of 3 Installments (Wks 5-8)":"[date] 3 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]\nDosing: 30 units a day\nTotal Duration: 1 month\n\n[date] 30 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 1 pill daily on empty stomach\nTotal Duration: 1 month","3 of 3 Installments (Wks 9-12)":"[date] 3 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]\nDosing: 30 units a day\nTotal Duration: 1 month\n\n[date] 30 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 1 pill daily on empty stomach\nTotal Duration: 1 month","1 of 4 Installments (Wks 1-3)":"Products Ordered:\n[date] 2 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]\nDosing: 30 units a day\nTotal Duration: 3 weeks\n\n[date] 21 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 1 pill daily on empty stomach\nTotal Duration: 3 weeks","2 of 4 Installments (Wks 4-6)":"[date] 3 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]\nDosing: 30 units a day\nTotal Duration: 3 weeks\n\n[date] 21 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 1 pill daily on empty stomach\nTotal Duration: 3 weeks","3 of 4 Installments (Wks 7-9)":"[date] 2 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]\nDosing: 30 units a day\nTotal Duration: 3 weeks\n\n[date] 21 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 1 pill daily on empty stomach\nTotal Duration: 3 weeks","4 of 4 Installments (Wks 10-12)":"[date] 2 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]\nDosing: 30 units a day\nTotal Duration: 3 weeks\n\n[date] 27 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 1 pill daily on empty stomach\nTotal Duration: 3 weeks"},"Titan Strong - 3 Months":{"Paid in Full":"Products Ordered:\n[date] 18 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]\nDosing: 60 units a day\nTotal Duration: 3 months\n\n[date] 90 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 1 pill daily on empty stomach\nTotal Duration: 3 months","1 of 2 Installments (Wks 1-6)":"Products Ordered:\n[date] 9 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]\nDosing: 60 units a day\nTotal Duration: 6 weeks\n\n[date] 42 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 1 pill daily on empty stomach\nTotal Duration: 6 weeks","2 of 2 Installments (Wks 7-12)":"[date] 9 vials of 3mL BPC/GHK/TB 1.66mg/9mg/3.33mg/mL (Pharmacy A) [initials]\nDosing: 60 units a day\nTotal Duration: 6 weeks\n\n[date] 48 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 1 pill daily on empty stomach\nTotal Duration: 6 weeks"},"Restore the Core - 3 Months":{"Paid in Full":"Products Ordered:\n[date] 180 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 2 pills daily on empty stomach\nTotal Duration: 3 months\n\n[date] 180 capsules Larazotide 500mcg (Pharmacy K) [initials]\nDosing: 2 capsules daily\nTotal Duration: 3 months","1 of 2 Installments (Wks 1-6)":"Products Ordered:\n[date] 90 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 2 pills daily on empty stomach\nTotal Duration: 6 weeks\n\n[date] 84 capsules Larazotide 500mcg (Pharmacy K) [initials]\nDosing: 2 capsules daily\nTotal Duration: 6 weeks","2 of 2 Installments (Wks 7-12)":"[date] 90 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 2 pills daily on empty stomach\nTotal Duration: 6 weeks\n\n[date] 96 capsules Larazotide 500mcg (Pharmacy K) [initials]\nDosing: 2 capsules daily\nTotal Duration: 6 weeks","1 of 3 Installments (Wks 1-4)":"Products Ordered:\n[date] 60 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 2 pills daily on empty stomach\nTotal Duration: 1 month\n\n[date] 60 capsules Larazotide 500mcg (Pharmacy K) [initials]\nDosing: 2 capsules daily\nTotal Duration: 1 month","2 of 3 Installments (Wks 5-8)":"[date] 60 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 2 pills daily on empty stomach\nTotal Duration: 1 month\n\n[date] 60 capsules Larazotide 500mcg (Pharmacy K) [initials]\nDosing: 2 capsules daily\nTotal Duration: 1 month","3 of 3 Installments (Wks 9-12)":"[date] 60 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 2 pills daily on empty stomach\nTotal Duration: 1 month\n\n[date] 60 capsules Larazotide 500mcg (Pharmacy K) [initials]\nDosing: 2 capsules daily\nTotal Duration: 1 month"},"Heal & Bloom - 3 Months [MD Call Required]":{"Paid in Full":"Products Ordered:\n[date] 180 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 2 pills daily on empty stomach\nTotal Duration: 3 months\n\n[date] LDN (Pharmacy F) [initials]\nDosing: Per medical direction\nTotal Duration: 3 months","1 of 2 Installments (Wks 1-6)":"Products Ordered:\n[date] 90 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 2 pills daily on empty stomach\nTotal Duration: 6 weeks\n\n[date] LDN (Pharmacy F) [initials]\nDosing: Per medical direction\nTotal Duration: 6 weeks","2 of 2 Installments (Wks 7-12)":"[date] 90 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 2 pills daily on empty stomach\nTotal Duration: 6 weeks\n\n[date] LDN (Pharmacy F) [initials]\nDosing: Per medical direction\nTotal Duration: 6 weeks"},"Control & Conquer - 3 Months [MD Call Required]":{"Paid in Full":"Products Ordered:\n[date] 180 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 2 pills daily\nTotal Duration: 3 months\n\n[date] LDN (Pharmacy F) [initials]\nDosing: Per medical direction\nTotal Duration: 3 months\n\n[date] 3 vials of 5mL Thymosin Alpha-1 3mg/mL (Pharmacy B) [initials]\nDosing: 15 units (0.45mg) daily\nTotal Duration: 3 months","1 of 2 Installments (Wks 1-6)":"Products Ordered:\n[date] 90 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 2 pills daily\nTotal Duration: 6 weeks\n\n[date] LDN (Pharmacy F) [initials]\nDosing: Per medical direction\nTotal Duration: 6 weeks\n\n[date] 2 vials of 5mL Thymosin Alpha-1 3mg/mL (Pharmacy B) [initials]\nDosing: 15 units (0.45mg) daily\nTotal Duration: 6 weeks","2 of 2 Installments (Wks 7-12)":"[date] 90 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 2 pills daily\nTotal Duration: 6 weeks\n\n[date] LDN (Pharmacy F) [initials]\nDosing: Per medical direction\nTotal Duration: 6 weeks\n\n[date] 1 vial of 5mL Thymosin Alpha-1 3mg/mL (Pharmacy B) [initials]\nDosing: 15 units (0.45mg) daily\nTotal Duration: 6 weeks","1 of 3 Installments (Wks 1-4)":"Products Ordered:\n[date] 60 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 2 pills daily\nTotal Duration: 1 month\n\n[date] LDN (Pharmacy F) [initials]\nDosing: Per medical direction\nTotal Duration: 1 month\n\n[date] 1 vial of 5mL Thymosin Alpha-1 3mg/mL (Pharmacy B) [initials]\nDosing: 15 units (0.45mg) daily\nTotal Duration: 1 month","2 of 3 Installments (Wks 5-8)":"[date] 60 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 2 pills daily\nTotal Duration: 1 month\n\n[date] LDN (Pharmacy F) [initials]\nDosing: Per medical direction\nTotal Duration: 1 month\n\n[date] 1 vial of 5mL Thymosin Alpha-1 3mg/mL (Pharmacy B) [initials]\nDosing: 15 units (0.45mg) daily\nTotal Duration: 1 month","3 of 3 Installments (Wks 9-12)":"[date] 60 BPC/KPV 500/500mcg (Pharmacy J) [initials]\nDosing: 2 pills daily\nTotal Duration: 1 month\n\n[date] LDN (Pharmacy F) [initials]\nDosing: Per medical direction\nTotal Duration: 1 month\n\n[date] 1 vial of 5mL Thymosin Alpha-1 3mg/mL (Pharmacy B) [initials]\nDosing: 15 units (0.45mg) daily\nTotal Duration: 1 month"},"Clear & Confident - 3 Months":{"Paid in Full":"Products Ordered:\n[date] 3 Semax Nasal Spray 7.5mg/ml 6mL (Pharmacy J) [initials]\nDosing: 1 spray per nostril/daily up to 3x day\nTotal Duration: 3 months\n\n[date] 3 Selank Nasal Spray 7.5mg/ml 6mL (Pharmacy J) [initials]\nDosing: 1 spray per nostril/daily up to 3x day\nTotal Duration: 3 months","1 of 2 Installments (Wks 1-6)":"Products Ordered:\n[date] 2 Semax Nasal Spray 7.5mg/ml 6mL (Pharmacy J) [initials]\nDosing: 1 spray per nostril/daily up to 3x day\nTotal Duration: 6 weeks\n\n[date] 2 Selank Nasal Spray 7.5mg/ml 6mL (Pharmacy J) [initials]\nDosing: 1 spray per nostril/daily up to 3x day\nTotal Duration: 6 weeks","2 of 2 Installments (Wks 7-12)":"[date] 1 Semax Nasal Spray 7.5mg/ml 6mL (Pharmacy J) [initials]\nDosing: 1 spray per nostril/daily up to 3x day\nTotal Duration: 6 weeks\n\n[date] 1 Selank Nasal Spray 7.5mg/ml 6mL (Pharmacy J) [initials]\nDosing: 1 spray per nostril/daily up to 3x day\nTotal Duration: 6 weeks"},"Sharp for Life - 3 Months":{"Paid in Full":"Products Ordered:\n[date] 90 Dihexa 20mg (Pharmacy J) [initials]\nDosing: 1 pill daily\nTotal Duration: 3 months\n\n[date] 1 vial of 30mL Synapsin 2/50 mg/mL (Pharmacy C) [initials]\nDosing: 1 spray per nostril once a day\nTotal Duration: 4 months","1 of 2 Installments (Wks 1-6)":"Products Ordered:\n[date] 42 Dihexa 20mg (Pharmacy J) [initials]\nDosing: 1 pill daily\nTotal Duration: 6 weeks\n\n[date] 1 vial of 15mL Synapsin 2/50 mg/mL (Pharmacy C) [initials]\nDosing: 1 spray per nostril once a day\nTotal Duration: 2 months","2 of 2 Installments (Wks 7-12)":"[date] 48 Dihexa 20mg (Pharmacy J) [initials]\nDosing: 1 pill daily\nTotal Duration: 6 weeks\n\n[date] 1 vial of 15mL Synapsin 2/50 mg/mL (Pharmacy C) [initials]\nDosing: 1 spray per nostril once a day\nTotal Duration: 2 months"},"Forge [Labs: IGF/Prolactin]":{"Paid in Full (MOTS-c 2mo + CJC/IPA 4mo)":"Products Ordered:\n[date] 8 kits of 10mg CB4211 (Pharmacy C) [initials]\nDosing: Reconstitute with 1mL BAC water then inject 0.5mL (50 units) subcutaneously twice weekly\nTotal Duration: 2 months\n\n[date] 2 vials of 6mL CJC/IPA 1.5mg/2.5mg/mL (Pharmacy A) [initials]\nDosing: 7 units 2x/day, 5 days on and 2 days off\nTotal Duration: 4 months","1 of 2 Installments (MOTS-c)":"Products Ordered:\n[date] 8 kits of 10mg CB4211 (Pharmacy C) [initials]\nDosing: Reconstitute with 1mL BAC water then inject 0.5mL (50 units) subcutaneously twice weekly\nTotal Duration: 2 months","2 of 2 Installments (CJC/IPA)":"[date] 2 vials of 6mL CJC/IPA 1.5mg/2.5mg/mL (Pharmacy A) [initials]\nDosing: 7 units 2x/day, 5 days on and 2 days off\nTotal Duration: 4 months"},"Pharmacy B [Labs: IGF/Prolactin] (+C if with GLP)":{"Paid in Full (MOTS-c 2mo + Tesa 3mo)":"Products Ordered:\n[date] 8 kits of 10mg CB4211 (Pharmacy C) [initials]\nDosing: Reconstitute with 1mL BAC water then inject 0.5mL (50 units) subcutaneously twice weekly\nTotal Duration: 2 months\n\n[date] 3 vials of 3mL Tesa 8mg/mL (Pharmacy B) [initials]\nDosing: Inject 12 units subcutaneously, 5 days on, 2 days off\nTotal Duration: 3 months","1 of 2 Installments (MOTS-c)":"Products Ordered:\n[date] 8 kits of 10mg CB4211 (Pharmacy C) [initials]\nDosing: Reconstitute with 1mL BAC water then inject 0.5mL (50 units) subcutaneously twice weekly\nTotal Duration: 2 months","2 of 2 Installments (Tesa)":"[date] 3 vials of 3mL Tesa 8mg/mL (Pharmacy B) [initials]\nDosing: Inject 12 units subcutaneously, 5 days on, 2 days off\nTotal Duration: 3 months"}},"HH/JD Comm Logs":{"WL Approval":{"Retatrutide (2mg -> 4mg)":"Pt is cleared for the WL program. No history of thyroid cancer or pancreatic issues. Pt has no active conditions and consents have been signed. Pt will be starting at the starting dose of 2mg, then titrating up to 4mg if needed per standing order. No Reta contraindications. [initials]\n\nAllergies:\nMedications:\n\nCW:\nGW:\nHeight:\nBMI:\n\nBP reading:","Semaglutide (0.25mg -> 0.5mg)":"Pt is cleared for the WL program. No history of thyroid cancer or pancreatic issues. Pt has no active conditions and consents have been signed. Pt will be starting at the starting dose of 0.25mg, then titrating up to 0.5mg if needed per standing order. [initials]\n\nAllergies:\nMedications:\n\nCW:\nGW:\nHeight:\nBMI:\n\nBP reading:","Tirzepatide (2.5mg -> 5mg)":"Pt is cleared for the WL program. No history of thyroid cancer or pancreatic issues. Pt has no active conditions and consents have been signed. Pt will be starting at the starting dose of 2.5mg, then titrating up to 5mg if needed per standing order. [initials]\n\nAllergies:\nMedications:\n\nCW:\nGW:\nHeight:\nBMI:\n\nBP reading:"},"WL Continuation":"Pt is cleared to continue with the WL program. No medical updates or changes. [initials]\n\nAllergies:\nMedications:\n\nCW:\nGW:\nHeight:\nBMI:\n\nPt is currently injecting: ___ mg ___ units.","Patient Calls & Education":{"Tirzepatide Dosing Entry":"The patient was verbally educated on proper dosing and administration technique for Tirzepatide. The patient demonstrated understanding of the prescribed dose and was able to identify the correct marking on the syringe corresponding to the dosing amount.\n\nInstructions included:\n- Drawing up the medication to the exact dose indicated by the directions given.\n- Inject ____ mg ( ___ units)\n- Ensuring to draw the medication slowly and avoid air bubbles in the syringe.\n- Confirming the drawn volume against the syringe markings before injection.\n- Storing medication as recommended and using proper injection technique to minimize discomfort.\n\nThe patient was given the opportunity to ask questions and verbalized understanding of the dosing instructions and syringe usage. No concerns were expressed at this time. Will continue to monitor adherence and technique at follow-up visits. [initials]","LDN Call":"The patient presents today for the use of LDN alongside their program.\n\nAllergies:\nAlcohol:\nOpioids:\n\nPt feels their inflammation stems from _______________________________________________.\n\nDosing instructions were provided to the patient, and all questions/concerns were addressed. [initials]","Peptides Call":"Discussed current peptide regimen, recent dosing schedule, and reported effects. Reviewed possible adjustments and reinforced storage/administration instructions. Patient verbalized understanding and all questions/concerns have been answered. [initials]"}},"Utilities":{"Supplies":"[date] xx pcs Syr xx cc + alcopads Supplies (Pharmacy A) [initials]","Care plan complete":"Care plan complete","Date Shipped and Tracking Number":"Date Shipped: [date]\nTN: UPS - xxxxxxxxxxxxxxx"},"Task Updates":{"Payment & Admin":{"No payment yet":"[date] no payment yet [initials]","PPW not yet signed":"[date] PPW not yet signed [initials]"},"Next Vial Confirmation":{"Sent SMS - can receive?":"[date] sent sms if Pt can rcv [initials]","No reply from SMS yet":"[date] no reply from sms yet [initials]"},"Labs":{"No labs yet":"[date] no labs yet [initials]","No labs yet - reminder triggered":"[date] no labs yet, triggered the reminder automation [initials]","Still no labs":"[date] still no labs [initials]","Partials are in":"[date] partials are in [initials]","Labs on requisition ready":"[date] labs still on requisition ready [initials]","Labs sent to Laura":"[date] labs sent to Laura [initials]","Waiting for Laura's approval":"[date] waiting for Laura's approval [initials]","Good to order":"[date] Good to order [initials]"},"Med Call":{"No show on med call":"[date] no show on med call [initials]","Check for updates":"[date] check sms, notes, GHL, email for updates [initials]"},"Refills":{"LDN refill - eligible for new Rx":"[date] sent sms if pt wants LDN refill, eligible for new rx [initials]"},"Shipping":{"Ship on/within date range":"[date] need to be ship on/within xx - xx [initials]","Pt out of town":"[date] Pt will be out of town on xx [initials]"}},"Reorder":{"SLU-PP + AOD + O-304":{"1 Month":"Hi [patient name]! This is Dr. Example' Order Processing Department. Your SLU-PP-332, AOD-9604, and O-304 are due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.\n\nAddress on file:\n[address]\n\nDue to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update.\n\nIf you will not be at this address within the next two weeks or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships."},"AOD + O-304":{"1 Month":"Hi [patient name]! This is Dr. Example' Order Processing Department. Your AOD-9604 and O-304 are due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.\n\nAddress on file:\n[address]\n\nDue to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update.\n\nIf you will not be at this address within the next two weeks or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships."},"CJC/IPA":{"2 Months / 1 vial":"Hi [patient name]! This is Dr. Example' Order Processing Department. Your 1 CJC/Ipamorelin vial is due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.\n\nAddress on file:\n[address]\n\nDue to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update.\n\nIf you will not be at this address within the next two weeks or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships.\n\nOne quick note: we ship peptides a few vials at a time because they have a limited shelf life. Shipping everything at once could cause some of the medication to expire before it's used."},"Tesamorelin":{"4 Weeks / 2 vials":"Hi [patient name]! This is Dr. Example' Order Processing Department. Your 2 Tesamorelin vials are due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.\n\nAddress on file:\n[address]\n\nDue to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update.\n\nIf you will not be at this address within the next two weeks or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships.\n\nOne quick note: we ship peptides a few vials at a time because they have a limited shelf life. Shipping everything at once could cause some of the medication to expire before it's used.","3 Months / 6 vials (ship 4)":"Hi [patient name]! This is Dr. Example' Order Processing Department. Your 4 Tesamorelin vials are due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.\n\nAddress on file:\n[address]\n\nDue to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update.\n\nIf you will not be at this address within the next two weeks or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships.\n\nOne quick note: we ship peptides a few vials at a time because they have a limited shelf life. Shipping everything at once could cause some of the medication to expire before it's used."},"BPC-157":{"1 Month / 1 vial":"Hi [patient name]! This is Dr. Example' Order Processing Department. Your 1 BPC-157 vial is due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.\n\nAddress on file:\n[address]\n\nDue to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update.\n\nIf you will not be at this address within the next two weeks or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships.\n\nOne quick note: we ship peptides a few vials at a time because they have a limited shelf life. Shipping everything at once could cause some of the medication to expire before it's used.","3 Months / 3 vials (ship 2)":"Hi [patient name]! This is Dr. Example' Order Processing Department. Your 2 BPC-157 vials are due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.\n\nAddress on file:\n[address]\n\nDue to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update.\n\nIf you will not be at this address within the next two weeks or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships.\n\nOne quick note: we ship peptides a few vials at a time because they have a limited shelf life. Shipping everything at once could cause some of the medication to expire before it's used."},"GHK-Cu":{"6 Weeks / 1 vial":"Hi [patient name]! This is Dr. Example' Order Processing Department. Your 1 GHK-Cu vial is due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.\n\nAddress on file:\n[address]\n\nDue to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update.\n\nIf you will not be at this address within the next two weeks or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships.\n\nOne quick note: we ship peptides a few vials at a time because they have a limited shelf life. Shipping everything at once could cause some of the medication to expire before it's used.","3 Months / 2 vials":"Hi [patient name]! This is Dr. Example' Order Processing Department. Your 2 GHK-Cu vials are due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.\n\nAddress on file:\n[address]\n\nDue to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update.\n\nIf you will not be at this address within the next two weeks or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships.\n\nOne quick note: we ship peptides a few vials at a time because they have a limited shelf life. Shipping everything at once could cause some of the medication to expire before it's used."},"TB-500":{"1 Month / 3 vials":"Hi [patient name]! This is Dr. Example' Order Processing Department. Your 3 TB-500 vials are due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.\n\nAddress on file:\n[address]\n\nDue to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update.\n\nIf you will not be at this address within the next two weeks or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships.\n\nOne quick note: we ship peptides a few vials at a time because they have a limited shelf life. Shipping everything at once could cause some of the medication to expire before it's used."},"NAD+":{"Light / 1 vial":"Hi [patient name]! This is Dr. Example' Order Processing Department. Your 1 NAD+ vial is due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.\n\nAddress on file:\n[address]\n\nDue to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update.\n\nIf you will not be at this address within the next two weeks or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships.\n\nOne quick note: we ship peptides a few vials at a time because they have a limited shelf life. Shipping everything at once could cause some of the medication to expire before it's used.","Medium / 2 vials":"Hi [patient name]! This is Dr. Example' Order Processing Department. Your 2 NAD+ vials are due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.\n\nAddress on file:\n[address]\n\nDue to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update.\n\nIf you will not be at this address within the next two weeks or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships.\n\nOne quick note: we ship peptides a few vials at a time because they have a limited shelf life. Shipping everything at once could cause some of the medication to expire before it's used.","Strong / 4 vials":"Hi [patient name]! This is Dr. Example' Order Processing Department. Your 4 NAD+ vials are due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.\n\nAddress on file:\n[address]\n\nDue to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update.\n\nIf you will not be at this address within the next two weeks or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships.\n\nOne quick note: we ship peptides a few vials at a time because they have a limited shelf life. Shipping everything at once could cause some of the medication to expire before it's used."},"Wolverine Blend (BPC/TB500)":{"Light / 1 Month / 2 vials":"Hi [patient name]! This is Dr. Example' Order Processing Department. Your 2 Wolverine Blend vials are due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.\n\nAddress on file:\n[address]\n\nDue to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update.\n\nIf you will not be at this address within the next two weeks or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships.\n\nOne quick note: we ship peptides a few vials at a time because they have a limited shelf life. Shipping everything at once could cause some of the medication to expire before it's used.","Standard / 1 Month / 3 vials":"Hi [patient name]! This is Dr. Example' Order Processing Department. Your 3 Wolverine Blend vials are due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.\n\nAddress on file:\n[address]\n\nDue to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update.\n\nIf you will not be at this address within the next two weeks or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships.\n\nOne quick note: we ship peptides a few vials at a time because they have a limited shelf life. Shipping everything at once could cause some of the medication to expire before it's used.","Strong / 1 Month / 6 vials":"Hi [patient name]! This is Dr. Example' Order Processing Department. Your 6 Wolverine Blend vials are due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.\n\nAddress on file:\n[address]\n\nDue to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update.\n\nIf you will not be at this address within the next two weeks or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships.\n\nOne quick note: we ship peptides a few vials at a time because they have a limited shelf life. Shipping everything at once could cause some of the medication to expire before it's used.","Light / 3 Months (ship 4)":"Hi [patient name]! This is Dr. Example' Order Processing Department. Your 4 Wolverine Blend vials are due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.\n\nAddress on file:\n[address]\n\nDue to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update.\n\nIf you will not be at this address within the next two weeks or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships.\n\nOne quick note: we ship peptides a few vials at a time because they have a limited shelf life. Shipping everything at once could cause some of the medication to expire before it's used.","Standard / 3 Months (ship 6)":"Hi [patient name]! This is Dr. Example' Order Processing Department. Your 6 Wolverine Blend vials are due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.\n\nAddress on file:\n[address]\n\nDue to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update.\n\nIf you will not be at this address within the next two weeks or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships.\n\nOne quick note: we ship peptides a few vials at a time because they have a limited shelf life. Shipping everything at once could cause some of the medication to expire before it's used.","Strong / 3 Months (ship 12)":"Hi [patient name]! This is Dr. Example' Order Processing Department. Your 12 Wolverine Blend vials are due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.\n\nAddress on file:\n[address]\n\nDue to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update.\n\nIf you will not be at this address within the next two weeks or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships.\n\nOne quick note: we ship peptides a few vials at a time because they have a limited shelf life. Shipping everything at once could cause some of the medication to expire before it's used."},"Glow Blend (BPC/GHK/TB)":{"1 Month / 3 vials":"Hi [patient name]! This is Dr. Example' Order Processing Department. Your 3 Glow Blend vials are due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.\n\nAddress on file:\n[address]\n\nDue to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update.\n\nIf you will not be at this address within the next two weeks or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships.\n\nOne quick note: we ship peptides a few vials at a time because they have a limited shelf life. Shipping everything at once could cause some of the medication to expire before it's used.","Strong / 1 Month / 6 vials":"Hi [patient name]! This is Dr. Example' Order Processing Department. Your 6 Glow Blend vials are due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.\n\nAddress on file:\n[address]\n\nDue to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update.\n\nIf you will not be at this address within the next two weeks or so, or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships.\n\nOne quick note: we ship peptides a few vials at a time because they have a limited shelf life. Shipping everything at once could cause some of the medication to expire before it's used."}}};


// ---- Unified SMS + Reorder (harvested from Peptide SMS v5.28.1) -----------
// Renders the patient-facing order-placed (OP2) and reorder messages from the
// bank. The patient first name + address are auto-read from the Zoho contact
// page (the same fields the original read). The [patient name] / [address]
// tokens exist ONLY in the static Reorder leaf skeletons — a token must never
// reach a copied message (see the artifact gate in harvest/gate-golden.js).
const UNIFIED_SMS = {"flavors":{"generic":{"head":"Hi {NAME}! This is Dr. Example's Order Processing Team. Your order is in and we've placed it. Here are your dosing instructions so you're ready to go.","fulfillment":null,"dosingHeader":"Dosing Instructions","guideSingle":"Full guide:","guideMulti":"Guides:","footer":["Please do not increase your dose unless instructed by our Medical Team.","Questions about shipping or delivery? Just reply to this message."]},"pharmacya":{"head":"Hi {NAME}! This is Dr. Example' Order Processing Team. Your order has been placed!","fulfillment":"Processing may take up to 10 days due to additional quality testing and high order volume. If you don't receive tracking by day 7, reply here.","dosingHeader":"DOSING:","guideSingle":"Guide:","guideMulti":"Guides:","bare":true,"guideInline":true,"glueDosing":true,"footer":["Do not increase your dose unless instructed by our Medical Team. Questions? Reply here."]},"pharmacyl":{"head":"Hi {NAME}! This is Dr. Example' Order Processing Team. Your order has been placed!","fulfillment":"Processing and shipping may take up to 4 days for your order to arrive. If you don't receive tracking by day 4, reply here.","dosingHeader":"DOSING:","guideSingle":"Guide:","guideMulti":"Guides:","bare":true,"guideInline":true,"glueDosing":true,"footer":["Do not increase your dose unless instructed by our Medical Team. Questions? Reply here."]},"direct":{"head":"Hi {NAME}! This is Dr. Example' Order Processing Team. Your order has been placed!","fulfillment":"Please allow up to 10 days for pharmacy processing and delivery. Shipping, tracking, and dosing updates will come directly from the pharmacy via text/email.","dosingHeader":"DOSING:","guideSingle":"Full Guide:","guideMulti":"Guides:","bare":true,"guideInline":false,"glueDosing":false,"footer":["Do not increase your dose unless instructed by our Medical Team. Shipping/delivery questions? Reply here."]}},"guides":{"default":"https://securelinks.drdeanjones.com/2p8vjnvs","ta1":"https://securelinks.drdeanjones.com/3ak8bksx","3mo":"https://securelinks.drdeanjones.com/2p9xxt38","6mo":"https://securelinks.drdeanjones.com/yrx6y9wz"},"guideDefaultGroups":["Injectables","Supplies / Status / Admin"],"shipping":{"pharmacya":"Tracking will be texted directly from Pharmacy A Pharmacy. Please watch for a message mentioning \"Pharmacy A.\"","pharmacyl":"Tracking will be texted directly from Pharmacy L Pharmacy. Please watch for a message mentioning \"Pharmacy L\""},"entries":[{"id":"cjc-ipamorelin","group":"Injectables","label":"CJC/Ipamorelin","pharmacies":["pharmacya"],"sms":{"med":"1 CJC/Ipamorelin","conc":"1.5mg/2.5mg per mL, 6mL vial","rx":"Inject 7 units (0.1 mg CJC / 0.2 mg Ipamorelin) under the skin twice daily, for a total of 14 units per day. Use in the morning while fasted and again before bed. Use 5 days on and 2 days off."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"ghk-cu-injection-vial-s","group":"Injectables","label":"GHK-Cu Injection / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"GHK-Cu","conc":"10mg/mL, 5mL vial","rx":"Inject 12 units (1.2 mg) under the skin once daily."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"glow-blend-vial-s","group":"Injectables","label":"Glow Blend / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"Glow Blend (BPC-157 / GHK-Cu / TB-500)","conc":"1.66mg/9mg/3.33mg per mL, 3mL vial","rx":"Inject 30 units (0.5 mg BPC-157 / 2.7 mg GHK-Cu / 1 mg TB-500) under the skin once daily."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"glow-blend-vial-s-strong","group":"Injectables","label":"Glow Blend / vial(s) (Strong)","pharmacies":["pharmacya"],"sms":{"med":"Glow Blend (BPC-157 / GHK-Cu / TB-500)","conc":"1.66mg/9mg/3.33mg per mL, 3mL vial","rx":"Inject 60 units (1 mg BPC-157 / 5.4 mg GHK-Cu / 2 mg TB-500) under the skin once daily."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"wolverine-light-vial-s","group":"Injectables","label":"Wolverine Light / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"Wolverine Blend (BPC-157 / TB-500)","conc":"1.66mg/3.33mg per mL, 3mL vial","rx":"Inject 20 units (0.33 mg BPC-157 / 0.67 mg TB-500) under the skin once daily."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"wolverine-standard-vial-s","group":"Injectables","label":"Wolverine Standard / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"Wolverine Blend (BPC-157 / TB-500)","conc":"1.66mg/3.33mg per mL, 3mL vial","rx":"Inject 30 units (0.5 mg BPC-157 / 1 mg TB-500) under the skin once daily."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"wolverine-strong-vial-s","group":"Injectables","label":"Wolverine Strong / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"Wolverine Blend (BPC-157 / TB-500)","conc":"1.66mg/3.33mg per mL, 3mL vial","rx":"Inject 60 units (1 mg BPC-157 / 2 mg TB-500) under the skin once daily."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"tb-500-vial-s","group":"Injectables","label":"TB-500 / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"TB-500","conc":"3.33mg/mL, 3mL vial","rx":"Inject 30 units (1 mg) under the skin once daily."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"bpc-157-injection-vial-s","group":"Injectables","label":"BPC-157 Injection / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"BPC-157","conc":"3mg/mL, 5mL vial","rx":"Inject 17 units (0.51 mg) into the muscle once daily at the injury site as directed."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"tesamorelin-vial-s","group":"Injectables","label":"Tesamorelin / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"Tesamorelin","conc":"2mg/mL, 5mL vial","rx":"Inject 50 units (1 mg) under the skin every night at bedtime, Monday through Friday."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"tesamorelin-ipamorelin-pharmacyk-vial-s","group":"Injectables","label":"Tesamorelin / Ipamorelin (Pharmacy K) / vial(s)","pharmacies":["pharmacyk"],"sms":{"med":"Tesamorelin / Ipamorelin","conc":"10mg/5mg per 2mL vial","rx":"Reconstitute one vial with 2 mL of bacteriostatic water, then inject 20 units (1 mg Tesamorelin / 0.5 mg Ipamorelin) under the skin every night at bedtime, Monday through Friday.","link":"https://securelinks.drdeanjones.com/3ak8bksx"},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/3ak8bksx"},{"id":"bpc-157-injection-pharmacyl-vial-s","group":"Injectables","label":"BPC-157 Injection (Pharmacy L) / vial(s)","pharmacies":["pharmacyl"],"sms":{"med":"BPC-157","conc":"5mg/mL, 5mL vial","rx":"Inject 20 units (1 mg) into the muscle once daily at the injury site."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"tb-500-pharmacyl-vial-s","group":"Injectables","label":"TB-500 (Pharmacy L) / vial(s)","pharmacies":["pharmacyl"],"sms":{"med":"TB-500","conc":"10mg/mL, 5mL vial","rx":"Inject 10 units (1 mg) under the skin once daily."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"ghk-cu-injection-pharmacyl-vial-s","group":"Injectables","label":"GHK-Cu Injection (Pharmacy L) / vial(s)","pharmacies":["pharmacyl"],"sms":{"med":"GHK-Cu","conc":"50mg/mL, 3mL vial","rx":"Inject 5 units (2.5 mg) under the skin once daily, Monday through Friday."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"mots-c-pharmacyl-vial-s","group":"Injectables","label":"MOTS-C (Pharmacy L) / vial(s)","pharmacies":["pharmacyl"],"sms":{"med":"MOTS-C","conc":"10mg/mL, 5mL vial","rx":"Inject 50 units (5 mg) under the skin twice weekly in the morning or before your workout."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"nad-pharmacyl-vial-s","group":"Injectables","label":"NAD+ (Pharmacy L) / vial(s)","pharmacies":["pharmacyl"],"sms":{"med":"NAD+","conc":"200mg/mL, 5mL vial","rx":"Inject 40 units (80 mg) under the skin 3 times per week."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"tesamorelin-pharmacyl-vial-s","group":"Injectables","label":"Tesamorelin (Pharmacy L) / vial(s)","pharmacies":["pharmacyl"],"sms":{"med":"Tesamorelin","conc":"5mg/mL, 5mL vial","rx":"Inject 20 units (1 mg) under the skin every night at bedtime, Monday through Friday."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"glow-blend-pharmacyk","group":"Injectables","label":"Glow Blend (Pharmacy K)","pharmacies":["pharmacyk"],"sms":{"med":"1 Glow Blend (BPC-157 / GHK-Cu / TB-500)","conc":"1.66mg/9mg/3.33mg per mL, 3mL vial","rx":"Inject 30 units (0.5 mg BPC-157 / 2.7 mg GHK-Cu / 1 mg TB-500) under the skin once daily."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"klow-pharmacyk-vial-s","group":"Injectables","label":"KLOW (Pharmacy K) / vial(s)","pharmacies":["pharmacyk"],"sms":{"med":"KLOW (BPC-157 / GHK-Cu / TB-500 / KPV)","conc":"3mg/3mg/3mg/10mg per mL, 10mL vial","rx":"Inject 20 units (0.6 mg BPC-157 / 0.6 mg GHK-Cu / 0.6 mg TB-500 / 2 mg KPV) under the skin once daily, Monday through Friday."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"ghk-cu-pharmacyk-vial-s","group":"Injectables","label":"GHK-Cu (Pharmacy K) / vial(s)","pharmacies":["pharmacyk"],"sms":{"med":"GHK-Cu","conc":"25mg/mL, 2mL vial","rx":"Inject 10 units (2.5 mg) under the skin once daily, Monday through Friday."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"ss-31","group":"Injectables","label":"SS-31","pharmacies":["pharmacyb"],"sms":{"med":"1 SS-31","conc":"50mg/mL, 6mL vial","rx":"Inject 40 units (20 mg) under the skin in the morning, 2 times per week."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"nad-light-vial-s","group":"Injectables","label":"NAD+ Light / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"NAD+","conc":"100mg/mL, 10mL vial","rx":"Inject 50 units (50 mg) under the skin 3 times per week."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"nad-medium-vial-s","group":"Injectables","label":"NAD+ Medium / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"NAD+","conc":"100mg/mL, 10mL vial","rx":"Inject 100 units (100 mg) under the skin 3 times per week."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"nad-strong-vial-s","group":"Injectables","label":"NAD+ Strong / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"NAD+","conc":"100mg/mL, 10mL vial","rx":"Inject 200 units (200 mg) under the skin 3 times per week. This is 2 mL total, so split it into two separate injections at different sites."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"pt-141-injection","group":"Injectables","label":"PT-141 Injection","pharmacies":["pharmacya"],"sms":{"med":"1 PT-141","conc":"2mg/mL, 5mL vial","rx":"Inject 20 units (0.4 mg) under the skin once daily, Monday through Friday."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"thymosin-alpha-1-vial-s","group":"Injectables","label":"Thymosin Alpha-1 / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"Thymosin Alpha-1","conc":"5mg/mL, 5mL vial","rx":"Inject 20 units (1 mg) under the skin every day, Monday through Friday.","link":"https://securelinks.drdeanjones.com/3ak8bksx"},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/3ak8bksx"},{"id":"mots-c-8-kits","group":"Injectables","label":"MOTS-c / 8 kits","pharmacies":["pharmacyc"],"sms":{"med":"8 kits of MOTS-c","conc":"10mg per kit, reconstituted with 1mL bacteriostatic water","rx":"Reconstitute one kit with 1 mL of bacteriostatic water, then inject 50 units (5 mg) under the skin twice weekly in the morning or before your workout.","link":"https://securelinks.drdeanjones.com/3ak8bksx"},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/3ak8bksx"},{"id":"pinealon-vial-s","group":"Injectables","label":"Pinealon / vial(s)","pharmacies":["pharmacyc"],"sms":{"med":"Pinealon","conc":"4mg/mL, 5mL vial","rx":"Inject 25 units (1 mg) under the skin once daily for 20 days, then cycle off."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"epithalon","group":"Injectables","label":"Epithalon","pharmacies":["pharmacya"],"sms":{"med":"1 Epithalon","conc":"2mg/mL, 5mL vial","rx":"Inject 20 units (0.4 mg) under the skin once daily, Monday through Friday."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"dsip-injection","group":"Injectables","label":"DSIP Injection","pharmacies":["pharmacyk"],"sms":{"med":"1 DSIP","conc":"1mg/mL, 5mL vial","rx":"Inject 20 units (0.2 mg) under the skin once nightly at bedtime, Monday through Friday."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"ll-37","group":"Injectables","label":"LL-37","pharmacies":["pharmacya"],"sms":{"med":"1 LL-37","conc":"5mg/mL, 5mL vial","rx":"Inject daily, 1 month on, 1 month off."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"melanotan-ii","group":"Injectables","label":"Melanotan II","pharmacies":["pharmacya"],"sms":{"med":"1 Melanotan II","conc":"2mg/mL, 5mL vial","rx":"Inject 12.5 units (0.25 mg) under the skin every other day until your desired color is reached, then maintain with 12.5 units (0.25 mg) twice weekly."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"pregnyl-hcg-trt","group":"Injectables","label":"Pregnyl (HCG) / TRT","pharmacies":["pharmacya"],"sms":{"med":"1 Pregnyl (HCG) 10,000 units","conc":"10,000 units in 10mL","rx":"Inject 25 to 50 units (250 to 500 IU) under the skin twice weekly in the morning or early afternoon."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},{"id":"5-amino-1mq-pill","group":"Oral / Topical / Nasal","label":"5-Amino-1MQ Pill","pharmacies":["pharmacyj"],"sms":{"med":"5-Amino-1MQ capsules","conc":"50mg per capsule","rx":"Take 1 capsule (50 mg) by mouth once daily.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"aod-9604-troche","group":"Oral / Topical / Nasal","label":"AOD-9604 Troche","pharmacies":["pharmacyj"],"sms":{"med":"AOD-9604 troches","conc":"600mcg per troche","rx":"Take 1 troche (600 mcg) in the morning while fasted, dissolving it between your cheek and gum. An optional second dose may be taken before bed.","note":"Store your troches in the fridge (2-8°C) in the original container, away from heat and moisture. Keep the lid tightly closed and use clean, dry hands when taking one out.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"bpc-157-pill","group":"Oral / Topical / Nasal","label":"BPC-157 Pill","pharmacies":["pharmacyj"],"sms":{"med":"BPC-157 capsules","conc":"500mcg per capsule","rx":"Take 1 capsule (500 mcg) by mouth every morning with WATER ONLY.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"bpc-kpv-pill","group":"Oral / Topical / Nasal","label":"BPC / KPV Pill","pharmacies":["pharmacyj"],"sms":{"med":"BPC / KPV capsules","conc":"500mcg/500mcg per capsule","rx":"Take 1 pill (500 mcg BPC / 500 mcg KPV each) per day, on an empty stomach.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"cjc-1295-ipamorelin-troche","group":"Oral / Topical / Nasal","label":"CJC-1295 / Ipamorelin Troche","pharmacies":["pharmacyd"],"sms":{"med":"CJC-1295 / Ipamorelin troches","conc":"2mg/2mg per troche","rx":"Dissolve 1 troche (2 mg CJC-1295 / 2 mg Ipamorelin) under the tongue.","note":"Store your troches in the fridge (2-8°C) in the original container, away from heat and moisture. Keep the lid tightly closed and use clean, dry hands when taking one out.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"dihexa-pill","group":"Oral / Topical / Nasal","label":"Dihexa Pill","pharmacies":["pharmacyj"],"sms":{"med":"Dihexa pills","conc":"20mg per pill","rx":"Take 1 pill (20 mg) in the morning daily.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"dsip-troches","group":"Oral / Topical / Nasal","label":"DSIP Troches","pharmacies":["pharmacyd"],"sms":{"med":"DSIP troches","conc":"300mcg per troche","rx":"Dissolve 1 troche (300 mcg) between your cheek and gum daily, 30 to 60 minutes before bed.","note":"Store your troches in the fridge (2-8°C) in the original container, away from heat and moisture. Keep the lid tightly closed and use clean, dry hands when taking one out.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"ghk-cu-argireline-leuphasyl-cream","group":"Oral / Topical / Nasal","label":"GHK-Cu / Argireline / Leuphasyl Cream","pharmacies":["pharmacyj"],"sms":{"med":"GHK-Cu / Argireline / Leuphasyl cream","conc":"0.2% / 0.5% / 3%, 30g bottle","rx":"Apply 1 pea-sized amount to the face and 1 pea-sized amount to the neck every morning and/or evening daily.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"larazotide","group":"Oral / Topical / Nasal","label":"Larazotide","pharmacies":["pharmacya"],"sms":{"med":"Larazotide capsules","conc":"500mcg per capsule","rx":"Take 2 capsules (500 mcg each) daily in the morning or evening.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"methylene-blue-10mg-starting","group":"Oral / Topical / Nasal","label":"Methylene Blue 10mg (starting)","pharmacies":["pharmacya"],"sms":{"med":"Methylene Blue pills","conc":"10mg per pill","rx":"Take 1 pill (10 mg) daily, in the morning or before your workout.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"methylene-blue-15mg-maintenance","group":"Oral / Topical / Nasal","label":"Methylene Blue 15mg (maintenance)","pharmacies":["pharmacya"],"sms":{"med":"Methylene Blue pills","conc":"15mg per pill","rx":"Take 1 pill (15 mg) daily, in the morning or before your workout.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"methylene-blue-25mg-higher-dose","group":"Oral / Topical / Nasal","label":"Methylene Blue 25mg (higher dose)","pharmacies":["pharmacya"],"sms":{"med":"Methylene Blue pills","conc":"25mg per pill","rx":"Take 1 pill (25 mg) daily, in the morning or before your workout.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"nad-nasal-spray","group":"Oral / Topical / Nasal","label":"NAD+ Nasal Spray","pharmacies":["pharmacya"],"sms":{"med":"NAD+ nasal spray","conc":"30mg/mL, 15mL bottle","rx":"Use 1 spray in each nostril every morning daily, up to 2 times per day as directed.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"nad-nasal-spray-pharmacyl-bottle-s","group":"Oral / Topical / Nasal","label":"NAD Nasal Spray (Pharmacy L) / bottle(s)","pharmacies":["pharmacyl"],"sms":{"med":"NAD Nasal Spray","conc":"300mg/mL, 10mL bottle","rx":"Use 1 spray in each nostril every morning, up to 2 times per day as directed.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"nicotine-troches","group":"Oral / Topical / Nasal","label":"Nicotine Troches","pharmacies":["pharmacya"],"sms":{"med":"Nicotine troches","conc":"1mg per troche","rx":"Take 1 troche (1 mg) in the morning or before a task as needed.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"nmn-apigenin-capsule","group":"Oral / Topical / Nasal","label":"NMN / Apigenin Capsule","pharmacies":["pharmacya"],"sms":{"med":"NMN / Apigenin capsules","conc":"250mg/150mg per capsule","rx":"Take 1 capsule (250 mg NMN / 150 mg apigenin) in the morning daily without food.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"o-304-new-patient","group":"Oral / Topical / Nasal","label":"O-304 (new patient)","pharmacies":["pharmacyj"],"sms":{"med":"50mg capsules of O-304","conc":"50mg per capsule","rx":"Take 1 capsule (50 mg) every morning daily for 14 days, then increase to 2 capsules of 50 mg every morning daily.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"phentermine","group":"Oral / Topical / Nasal","label":"Phentermine","pharmacies":["pharmacya"],"sms":{"med":"Phentermine pills","conc":"37.5mg per pill","rx":"Take 15 to 37.5 mg in the morning daily while fasted, or 1 to 2 hours after breakfast.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"pt-141-nasal-spray","group":"Oral / Topical / Nasal","label":"PT-141 Nasal Spray","pharmacies":["pharmacya"],"sms":{"med":"PT-141 nasal spray","conc":"2.5mg/0.1mL, 3mL bottle","rx":"Use 1 to 3 sprays intranasally 45 to 60 minutes before sexual activity. Do not use more than 3 sprays per day.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"selank-nasal-spray","group":"Oral / Topical / Nasal","label":"Selank Nasal Spray","pharmacies":["pharmacyj"],"sms":{"med":"Selank nasal spray","conc":"7.5mg/mL, 6mL bottle","rx":"Use 1 spray in each nostril every morning daily, up to 3 times per day as needed.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"semax-nasal-spray","group":"Oral / Topical / Nasal","label":"Semax Nasal Spray","pharmacies":["pharmacyj"],"sms":{"med":"Semax nasal spray","conc":"7.5mg/mL, 6mL bottle","rx":"Use 1 spray in each nostril every morning or before a task daily, up to 3 times per day as directed.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"slu-pp-332-new-patient-titration","group":"Oral / Topical / Nasal","label":"SLU-PP-332 (new patient titration)","pharmacies":["pharmacyj"],"sms":{"med":"100mcg and 200mcg pills of SLU-PP-332","conc":"100mcg and 200mcg per pill","rx":"Take 1 x 100 mcg pill once daily in the morning or before exercise for the first 2 weeks. Then increase to 1 x 200 mcg pill once daily for the next 2 weeks. If tolerated, increase to 2 x 200 mcg pills daily, with one dose in the morning and one dose in the early afternoon. Do not take later in the day, as it may disrupt sleep. Food is not required.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"synapsin-nasal-spray","group":"Oral / Topical / Nasal","label":"Synapsin Nasal Spray","pharmacies":["pharmacya"],"sms":{"med":"Synapsin (RG3 / Nicotinamide Riboside)","conc":"2mg/50mg per mL, 15mL vial","rx":"Use 1 spray in each nostril once daily.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"tesofensine-pill","group":"Oral / Topical / Nasal","label":"Tesofensine Pill","pharmacies":["pharmacyj"],"sms":{"med":"Tesofensine tablets","conc":"500mcg per tablet","rx":"Take 1 tablet (500 mcg) every morning daily.","pickup":false},"bodyBare":null,"legGuide":null},{"id":"thymosin-alpha-1-nasal-spray","group":"Oral / Topical / Nasal","label":"Thymosin Alpha-1 Nasal Spray","pharmacies":["pharmacya"],"sms":{"med":"Thymosin Alpha-1 nasal spray","conc":"3mg/mL, 6mL vial","rx":"Use 1 spray in each nostril every morning or early afternoon daily, up to 2 times per day as directed.","pickup":false},"bodyBare":null,"legGuide":null}],"byId":{"cjc-ipamorelin":{"id":"cjc-ipamorelin","group":"Injectables","label":"CJC/Ipamorelin","pharmacies":["pharmacya"],"sms":{"med":"1 CJC/Ipamorelin","conc":"1.5mg/2.5mg per mL, 6mL vial","rx":"Inject 7 units (0.1 mg CJC / 0.2 mg Ipamorelin) under the skin twice daily, for a total of 14 units per day. Use in the morning while fasted and again before bed. Use 5 days on and 2 days off."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"ghk-cu-injection-vial-s":{"id":"ghk-cu-injection-vial-s","group":"Injectables","label":"GHK-Cu Injection / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"GHK-Cu","conc":"10mg/mL, 5mL vial","rx":"Inject 12 units (1.2 mg) under the skin once daily."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"glow-blend-vial-s":{"id":"glow-blend-vial-s","group":"Injectables","label":"Glow Blend / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"Glow Blend (BPC-157 / GHK-Cu / TB-500)","conc":"1.66mg/9mg/3.33mg per mL, 3mL vial","rx":"Inject 30 units (0.5 mg BPC-157 / 2.7 mg GHK-Cu / 1 mg TB-500) under the skin once daily."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"glow-blend-vial-s-strong":{"id":"glow-blend-vial-s-strong","group":"Injectables","label":"Glow Blend / vial(s) (Strong)","pharmacies":["pharmacya"],"sms":{"med":"Glow Blend (BPC-157 / GHK-Cu / TB-500)","conc":"1.66mg/9mg/3.33mg per mL, 3mL vial","rx":"Inject 60 units (1 mg BPC-157 / 5.4 mg GHK-Cu / 2 mg TB-500) under the skin once daily."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"wolverine-light-vial-s":{"id":"wolverine-light-vial-s","group":"Injectables","label":"Wolverine Light / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"Wolverine Blend (BPC-157 / TB-500)","conc":"1.66mg/3.33mg per mL, 3mL vial","rx":"Inject 20 units (0.33 mg BPC-157 / 0.67 mg TB-500) under the skin once daily."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"wolverine-standard-vial-s":{"id":"wolverine-standard-vial-s","group":"Injectables","label":"Wolverine Standard / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"Wolverine Blend (BPC-157 / TB-500)","conc":"1.66mg/3.33mg per mL, 3mL vial","rx":"Inject 30 units (0.5 mg BPC-157 / 1 mg TB-500) under the skin once daily."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"wolverine-strong-vial-s":{"id":"wolverine-strong-vial-s","group":"Injectables","label":"Wolverine Strong / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"Wolverine Blend (BPC-157 / TB-500)","conc":"1.66mg/3.33mg per mL, 3mL vial","rx":"Inject 60 units (1 mg BPC-157 / 2 mg TB-500) under the skin once daily."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"tb-500-vial-s":{"id":"tb-500-vial-s","group":"Injectables","label":"TB-500 / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"TB-500","conc":"3.33mg/mL, 3mL vial","rx":"Inject 30 units (1 mg) under the skin once daily."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"bpc-157-injection-vial-s":{"id":"bpc-157-injection-vial-s","group":"Injectables","label":"BPC-157 Injection / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"BPC-157","conc":"3mg/mL, 5mL vial","rx":"Inject 17 units (0.51 mg) into the muscle once daily at the injury site as directed."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"tesamorelin-vial-s":{"id":"tesamorelin-vial-s","group":"Injectables","label":"Tesamorelin / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"Tesamorelin","conc":"2mg/mL, 5mL vial","rx":"Inject 50 units (1 mg) under the skin every night at bedtime, Monday through Friday."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"tesamorelin-ipamorelin-pharmacyk-vial-s":{"id":"tesamorelin-ipamorelin-pharmacyk-vial-s","group":"Injectables","label":"Tesamorelin / Ipamorelin (Pharmacy K) / vial(s)","pharmacies":["pharmacyk"],"sms":{"med":"Tesamorelin / Ipamorelin","conc":"10mg/5mg per 2mL vial","rx":"Reconstitute one vial with 2 mL of bacteriostatic water, then inject 20 units (1 mg Tesamorelin / 0.5 mg Ipamorelin) under the skin every night at bedtime, Monday through Friday.","link":"https://securelinks.drdeanjones.com/3ak8bksx"},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/3ak8bksx"},"bpc-157-injection-pharmacyl-vial-s":{"id":"bpc-157-injection-pharmacyl-vial-s","group":"Injectables","label":"BPC-157 Injection (Pharmacy L) / vial(s)","pharmacies":["pharmacyl"],"sms":{"med":"BPC-157","conc":"5mg/mL, 5mL vial","rx":"Inject 20 units (1 mg) into the muscle once daily at the injury site."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"tb-500-pharmacyl-vial-s":{"id":"tb-500-pharmacyl-vial-s","group":"Injectables","label":"TB-500 (Pharmacy L) / vial(s)","pharmacies":["pharmacyl"],"sms":{"med":"TB-500","conc":"10mg/mL, 5mL vial","rx":"Inject 10 units (1 mg) under the skin once daily."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"ghk-cu-injection-pharmacyl-vial-s":{"id":"ghk-cu-injection-pharmacyl-vial-s","group":"Injectables","label":"GHK-Cu Injection (Pharmacy L) / vial(s)","pharmacies":["pharmacyl"],"sms":{"med":"GHK-Cu","conc":"50mg/mL, 3mL vial","rx":"Inject 5 units (2.5 mg) under the skin once daily, Monday through Friday."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"mots-c-pharmacyl-vial-s":{"id":"mots-c-pharmacyl-vial-s","group":"Injectables","label":"MOTS-C (Pharmacy L) / vial(s)","pharmacies":["pharmacyl"],"sms":{"med":"MOTS-C","conc":"10mg/mL, 5mL vial","rx":"Inject 50 units (5 mg) under the skin twice weekly in the morning or before your workout."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"nad-pharmacyl-vial-s":{"id":"nad-pharmacyl-vial-s","group":"Injectables","label":"NAD+ (Pharmacy L) / vial(s)","pharmacies":["pharmacyl"],"sms":{"med":"NAD+","conc":"200mg/mL, 5mL vial","rx":"Inject 40 units (80 mg) under the skin 3 times per week."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"tesamorelin-pharmacyl-vial-s":{"id":"tesamorelin-pharmacyl-vial-s","group":"Injectables","label":"Tesamorelin (Pharmacy L) / vial(s)","pharmacies":["pharmacyl"],"sms":{"med":"Tesamorelin","conc":"5mg/mL, 5mL vial","rx":"Inject 20 units (1 mg) under the skin every night at bedtime, Monday through Friday."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"glow-blend-pharmacyk":{"id":"glow-blend-pharmacyk","group":"Injectables","label":"Glow Blend (Pharmacy K)","pharmacies":["pharmacyk"],"sms":{"med":"1 Glow Blend (BPC-157 / GHK-Cu / TB-500)","conc":"1.66mg/9mg/3.33mg per mL, 3mL vial","rx":"Inject 30 units (0.5 mg BPC-157 / 2.7 mg GHK-Cu / 1 mg TB-500) under the skin once daily."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"klow-pharmacyk-vial-s":{"id":"klow-pharmacyk-vial-s","group":"Injectables","label":"KLOW (Pharmacy K) / vial(s)","pharmacies":["pharmacyk"],"sms":{"med":"KLOW (BPC-157 / GHK-Cu / TB-500 / KPV)","conc":"3mg/3mg/3mg/10mg per mL, 10mL vial","rx":"Inject 20 units (0.6 mg BPC-157 / 0.6 mg GHK-Cu / 0.6 mg TB-500 / 2 mg KPV) under the skin once daily, Monday through Friday."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"ghk-cu-pharmacyk-vial-s":{"id":"ghk-cu-pharmacyk-vial-s","group":"Injectables","label":"GHK-Cu (Pharmacy K) / vial(s)","pharmacies":["pharmacyk"],"sms":{"med":"GHK-Cu","conc":"25mg/mL, 2mL vial","rx":"Inject 10 units (2.5 mg) under the skin once daily, Monday through Friday."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"ss-31":{"id":"ss-31","group":"Injectables","label":"SS-31","pharmacies":["pharmacyb"],"sms":{"med":"1 SS-31","conc":"50mg/mL, 6mL vial","rx":"Inject 40 units (20 mg) under the skin in the morning, 2 times per week."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"nad-light-vial-s":{"id":"nad-light-vial-s","group":"Injectables","label":"NAD+ Light / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"NAD+","conc":"100mg/mL, 10mL vial","rx":"Inject 50 units (50 mg) under the skin 3 times per week."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"nad-medium-vial-s":{"id":"nad-medium-vial-s","group":"Injectables","label":"NAD+ Medium / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"NAD+","conc":"100mg/mL, 10mL vial","rx":"Inject 100 units (100 mg) under the skin 3 times per week."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"nad-strong-vial-s":{"id":"nad-strong-vial-s","group":"Injectables","label":"NAD+ Strong / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"NAD+","conc":"100mg/mL, 10mL vial","rx":"Inject 200 units (200 mg) under the skin 3 times per week. This is 2 mL total, so split it into two separate injections at different sites."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"pt-141-injection":{"id":"pt-141-injection","group":"Injectables","label":"PT-141 Injection","pharmacies":["pharmacya"],"sms":{"med":"1 PT-141","conc":"2mg/mL, 5mL vial","rx":"Inject 20 units (0.4 mg) under the skin once daily, Monday through Friday."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"thymosin-alpha-1-vial-s":{"id":"thymosin-alpha-1-vial-s","group":"Injectables","label":"Thymosin Alpha-1 / vial(s)","pharmacies":["pharmacya"],"sms":{"med":"Thymosin Alpha-1","conc":"5mg/mL, 5mL vial","rx":"Inject 20 units (1 mg) under the skin every day, Monday through Friday.","link":"https://securelinks.drdeanjones.com/3ak8bksx"},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/3ak8bksx"},"mots-c-8-kits":{"id":"mots-c-8-kits","group":"Injectables","label":"MOTS-c / 8 kits","pharmacies":["pharmacyc"],"sms":{"med":"8 kits of MOTS-c","conc":"10mg per kit, reconstituted with 1mL bacteriostatic water","rx":"Reconstitute one kit with 1 mL of bacteriostatic water, then inject 50 units (5 mg) under the skin twice weekly in the morning or before your workout.","link":"https://securelinks.drdeanjones.com/3ak8bksx"},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/3ak8bksx"},"pinealon-vial-s":{"id":"pinealon-vial-s","group":"Injectables","label":"Pinealon / vial(s)","pharmacies":["pharmacyc"],"sms":{"med":"Pinealon","conc":"4mg/mL, 5mL vial","rx":"Inject 25 units (1 mg) under the skin once daily for 20 days, then cycle off."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"epithalon":{"id":"epithalon","group":"Injectables","label":"Epithalon","pharmacies":["pharmacya"],"sms":{"med":"1 Epithalon","conc":"2mg/mL, 5mL vial","rx":"Inject 20 units (0.4 mg) under the skin once daily, Monday through Friday."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"dsip-injection":{"id":"dsip-injection","group":"Injectables","label":"DSIP Injection","pharmacies":["pharmacyk"],"sms":{"med":"1 DSIP","conc":"1mg/mL, 5mL vial","rx":"Inject 20 units (0.2 mg) under the skin once nightly at bedtime, Monday through Friday."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"ll-37":{"id":"ll-37","group":"Injectables","label":"LL-37","pharmacies":["pharmacya"],"sms":{"med":"1 LL-37","conc":"5mg/mL, 5mL vial","rx":"Inject daily, 1 month on, 1 month off."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"melanotan-ii":{"id":"melanotan-ii","group":"Injectables","label":"Melanotan II","pharmacies":["pharmacya"],"sms":{"med":"1 Melanotan II","conc":"2mg/mL, 5mL vial","rx":"Inject 12.5 units (0.25 mg) under the skin every other day until your desired color is reached, then maintain with 12.5 units (0.25 mg) twice weekly."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"pregnyl-hcg-trt":{"id":"pregnyl-hcg-trt","group":"Injectables","label":"Pregnyl (HCG) / TRT","pharmacies":["pharmacya"],"sms":{"med":"1 Pregnyl (HCG) 10,000 units","conc":"10,000 units in 10mL","rx":"Inject 25 to 50 units (250 to 500 IU) under the skin twice weekly in the morning or early afternoon."},"bodyBare":null,"legGuide":"https://securelinks.drdeanjones.com/2p8vjnvs"},"5-amino-1mq-pill":{"id":"5-amino-1mq-pill","group":"Oral / Topical / Nasal","label":"5-Amino-1MQ Pill","pharmacies":["pharmacyj"],"sms":{"med":"5-Amino-1MQ capsules","conc":"50mg per capsule","rx":"Take 1 capsule (50 mg) by mouth once daily.","pickup":false},"bodyBare":null,"legGuide":null},"aod-9604-troche":{"id":"aod-9604-troche","group":"Oral / Topical / Nasal","label":"AOD-9604 Troche","pharmacies":["pharmacyj"],"sms":{"med":"AOD-9604 troches","conc":"600mcg per troche","rx":"Take 1 troche (600 mcg) in the morning while fasted, dissolving it between your cheek and gum. An optional second dose may be taken before bed.","note":"Store your troches in the fridge (2-8°C) in the original container, away from heat and moisture. Keep the lid tightly closed and use clean, dry hands when taking one out.","pickup":false},"bodyBare":null,"legGuide":null},"bpc-157-pill":{"id":"bpc-157-pill","group":"Oral / Topical / Nasal","label":"BPC-157 Pill","pharmacies":["pharmacyj"],"sms":{"med":"BPC-157 capsules","conc":"500mcg per capsule","rx":"Take 1 capsule (500 mcg) by mouth every morning with WATER ONLY.","pickup":false},"bodyBare":null,"legGuide":null},"bpc-kpv-pill":{"id":"bpc-kpv-pill","group":"Oral / Topical / Nasal","label":"BPC / KPV Pill","pharmacies":["pharmacyj"],"sms":{"med":"BPC / KPV capsules","conc":"500mcg/500mcg per capsule","rx":"Take 1 pill (500 mcg BPC / 500 mcg KPV each) per day, on an empty stomach.","pickup":false},"bodyBare":null,"legGuide":null},"cjc-1295-ipamorelin-troche":{"id":"cjc-1295-ipamorelin-troche","group":"Oral / Topical / Nasal","label":"CJC-1295 / Ipamorelin Troche","pharmacies":["pharmacyd"],"sms":{"med":"CJC-1295 / Ipamorelin troches","conc":"2mg/2mg per troche","rx":"Dissolve 1 troche (2 mg CJC-1295 / 2 mg Ipamorelin) under the tongue.","note":"Store your troches in the fridge (2-8°C) in the original container, away from heat and moisture. Keep the lid tightly closed and use clean, dry hands when taking one out.","pickup":false},"bodyBare":null,"legGuide":null},"dihexa-pill":{"id":"dihexa-pill","group":"Oral / Topical / Nasal","label":"Dihexa Pill","pharmacies":["pharmacyj"],"sms":{"med":"Dihexa pills","conc":"20mg per pill","rx":"Take 1 pill (20 mg) in the morning daily.","pickup":false},"bodyBare":null,"legGuide":null},"dsip-troches":{"id":"dsip-troches","group":"Oral / Topical / Nasal","label":"DSIP Troches","pharmacies":["pharmacyd"],"sms":{"med":"DSIP troches","conc":"300mcg per troche","rx":"Dissolve 1 troche (300 mcg) between your cheek and gum daily, 30 to 60 minutes before bed.","note":"Store your troches in the fridge (2-8°C) in the original container, away from heat and moisture. Keep the lid tightly closed and use clean, dry hands when taking one out.","pickup":false},"bodyBare":null,"legGuide":null},"ghk-cu-argireline-leuphasyl-cream":{"id":"ghk-cu-argireline-leuphasyl-cream","group":"Oral / Topical / Nasal","label":"GHK-Cu / Argireline / Leuphasyl Cream","pharmacies":["pharmacyj"],"sms":{"med":"GHK-Cu / Argireline / Leuphasyl cream","conc":"0.2% / 0.5% / 3%, 30g bottle","rx":"Apply 1 pea-sized amount to the face and 1 pea-sized amount to the neck every morning and/or evening daily.","pickup":false},"bodyBare":null,"legGuide":null},"larazotide":{"id":"larazotide","group":"Oral / Topical / Nasal","label":"Larazotide","pharmacies":["pharmacya"],"sms":{"med":"Larazotide capsules","conc":"500mcg per capsule","rx":"Take 2 capsules (500 mcg each) daily in the morning or evening.","pickup":false},"bodyBare":null,"legGuide":null},"methylene-blue-10mg-starting":{"id":"methylene-blue-10mg-starting","group":"Oral / Topical / Nasal","label":"Methylene Blue 10mg (starting)","pharmacies":["pharmacya"],"sms":{"med":"Methylene Blue pills","conc":"10mg per pill","rx":"Take 1 pill (10 mg) daily, in the morning or before your workout.","pickup":false},"bodyBare":null,"legGuide":null},"methylene-blue-15mg-maintenance":{"id":"methylene-blue-15mg-maintenance","group":"Oral / Topical / Nasal","label":"Methylene Blue 15mg (maintenance)","pharmacies":["pharmacya"],"sms":{"med":"Methylene Blue pills","conc":"15mg per pill","rx":"Take 1 pill (15 mg) daily, in the morning or before your workout.","pickup":false},"bodyBare":null,"legGuide":null},"methylene-blue-25mg-higher-dose":{"id":"methylene-blue-25mg-higher-dose","group":"Oral / Topical / Nasal","label":"Methylene Blue 25mg (higher dose)","pharmacies":["pharmacya"],"sms":{"med":"Methylene Blue pills","conc":"25mg per pill","rx":"Take 1 pill (25 mg) daily, in the morning or before your workout.","pickup":false},"bodyBare":null,"legGuide":null},"nad-nasal-spray":{"id":"nad-nasal-spray","group":"Oral / Topical / Nasal","label":"NAD+ Nasal Spray","pharmacies":["pharmacya"],"sms":{"med":"NAD+ nasal spray","conc":"30mg/mL, 15mL bottle","rx":"Use 1 spray in each nostril every morning daily, up to 2 times per day as directed.","pickup":false},"bodyBare":null,"legGuide":null},"nad-nasal-spray-pharmacyl-bottle-s":{"id":"nad-nasal-spray-pharmacyl-bottle-s","group":"Oral / Topical / Nasal","label":"NAD Nasal Spray (Pharmacy L) / bottle(s)","pharmacies":["pharmacyl"],"sms":{"med":"NAD Nasal Spray","conc":"300mg/mL, 10mL bottle","rx":"Use 1 spray in each nostril every morning, up to 2 times per day as directed.","pickup":false},"bodyBare":null,"legGuide":null},"nicotine-troches":{"id":"nicotine-troches","group":"Oral / Topical / Nasal","label":"Nicotine Troches","pharmacies":["pharmacya"],"sms":{"med":"Nicotine troches","conc":"1mg per troche","rx":"Take 1 troche (1 mg) in the morning or before a task as needed.","pickup":false},"bodyBare":null,"legGuide":null},"nmn-apigenin-capsule":{"id":"nmn-apigenin-capsule","group":"Oral / Topical / Nasal","label":"NMN / Apigenin Capsule","pharmacies":["pharmacya"],"sms":{"med":"NMN / Apigenin capsules","conc":"250mg/150mg per capsule","rx":"Take 1 capsule (250 mg NMN / 150 mg apigenin) in the morning daily without food.","pickup":false},"bodyBare":null,"legGuide":null},"o-304-new-patient":{"id":"o-304-new-patient","group":"Oral / Topical / Nasal","label":"O-304 (new patient)","pharmacies":["pharmacyj"],"sms":{"med":"50mg capsules of O-304","conc":"50mg per capsule","rx":"Take 1 capsule (50 mg) every morning daily for 14 days, then increase to 2 capsules of 50 mg every morning daily.","pickup":false},"bodyBare":null,"legGuide":null},"phentermine":{"id":"phentermine","group":"Oral / Topical / Nasal","label":"Phentermine","pharmacies":["pharmacya"],"sms":{"med":"Phentermine pills","conc":"37.5mg per pill","rx":"Take 15 to 37.5 mg in the morning daily while fasted, or 1 to 2 hours after breakfast.","pickup":false},"bodyBare":null,"legGuide":null},"pt-141-nasal-spray":{"id":"pt-141-nasal-spray","group":"Oral / Topical / Nasal","label":"PT-141 Nasal Spray","pharmacies":["pharmacya"],"sms":{"med":"PT-141 nasal spray","conc":"2.5mg/0.1mL, 3mL bottle","rx":"Use 1 to 3 sprays intranasally 45 to 60 minutes before sexual activity. Do not use more than 3 sprays per day.","pickup":false},"bodyBare":null,"legGuide":null},"selank-nasal-spray":{"id":"selank-nasal-spray","group":"Oral / Topical / Nasal","label":"Selank Nasal Spray","pharmacies":["pharmacyj"],"sms":{"med":"Selank nasal spray","conc":"7.5mg/mL, 6mL bottle","rx":"Use 1 spray in each nostril every morning daily, up to 3 times per day as needed.","pickup":false},"bodyBare":null,"legGuide":null},"semax-nasal-spray":{"id":"semax-nasal-spray","group":"Oral / Topical / Nasal","label":"Semax Nasal Spray","pharmacies":["pharmacyj"],"sms":{"med":"Semax nasal spray","conc":"7.5mg/mL, 6mL bottle","rx":"Use 1 spray in each nostril every morning or before a task daily, up to 3 times per day as directed.","pickup":false},"bodyBare":null,"legGuide":null},"slu-pp-332-new-patient-titration":{"id":"slu-pp-332-new-patient-titration","group":"Oral / Topical / Nasal","label":"SLU-PP-332 (new patient titration)","pharmacies":["pharmacyj"],"sms":{"med":"100mcg and 200mcg pills of SLU-PP-332","conc":"100mcg and 200mcg per pill","rx":"Take 1 x 100 mcg pill once daily in the morning or before exercise for the first 2 weeks. Then increase to 1 x 200 mcg pill once daily for the next 2 weeks. If tolerated, increase to 2 x 200 mcg pills daily, with one dose in the morning and one dose in the early afternoon. Do not take later in the day, as it may disrupt sleep. Food is not required.","pickup":false},"bodyBare":null,"legGuide":null},"synapsin-nasal-spray":{"id":"synapsin-nasal-spray","group":"Oral / Topical / Nasal","label":"Synapsin Nasal Spray","pharmacies":["pharmacya"],"sms":{"med":"Synapsin (RG3 / Nicotinamide Riboside)","conc":"2mg/50mg per mL, 15mL vial","rx":"Use 1 spray in each nostril once daily.","pickup":false},"bodyBare":null,"legGuide":null},"tesofensine-pill":{"id":"tesofensine-pill","group":"Oral / Topical / Nasal","label":"Tesofensine Pill","pharmacies":["pharmacyj"],"sms":{"med":"Tesofensine tablets","conc":"500mcg per tablet","rx":"Take 1 tablet (500 mcg) every morning daily.","pickup":false},"bodyBare":null,"legGuide":null},"thymosin-alpha-1-nasal-spray":{"id":"thymosin-alpha-1-nasal-spray","group":"Oral / Topical / Nasal","label":"Thymosin Alpha-1 Nasal Spray","pharmacies":["pharmacya"],"sms":{"med":"Thymosin Alpha-1 nasal spray","conc":"3mg/mL, 6mL vial","rx":"Use 1 spray in each nostril every morning or early afternoon daily, up to 2 times per day as directed.","pickup":false},"bodyBare":null,"legGuide":null}}};
const REORDER_FULFILLMENT = {"reorder":{"normal":"Processing and shipping usually takes about 7 business days, so it should arrive in roughly a week.","delayed":"Due to additional quality testing on compounded medications and high order volumes across the industry, pharmacies are experiencing longer-than-normal processing times, so your order may take up to 10 days to arrive. If you haven't received tracking information by day 7, reach out to our team for an order status update."},"addressWindow":{"normal":"within the next week or so","delayed":"within the next two weeks or so"},"op2Normal":"Orders can take up to one week to complete. Once the pharmacy has finished processing your order, you'll receive your shipping confirmation, tracking information, and dosing instructions directly from the pharmacy. Please keep an eye on both your email and text messages, as these updates may come from the pharmacy instead of Dr. Example' team."};
const REORDER_LEAF = {"Reorder\u0000SLU-PP + AOD + O-304\u00001 Month":{"items":["SLU-PP-332","AOD-9604","O-304"],"nickname":"SLU-PP-332 + AOD-9604 + O-304"},"Reorder\u0000AOD + O-304\u00001 Month":{"items":["AOD-9604","O-304"],"nickname":"AOD-9604 + O-304"},"Reorder\u0000CJC/IPA\u00002 Months / 1 vial":{"vials":1,"nickname":"CJC/Ipamorelin"},"Reorder\u0000Tesamorelin\u00004 Weeks / 2 vials":{"vials":2,"nickname":"Tesamorelin"},"Reorder\u0000Tesamorelin\u00003 Months / 6 vials (ship 4)":{"vials":4,"nickname":"Tesamorelin"},"Reorder\u0000BPC-157\u00001 Month / 1 vial":{"vials":1,"nickname":"BPC-157"},"Reorder\u0000BPC-157\u00003 Months / 3 vials (ship 2)":{"vials":2,"nickname":"BPC-157"},"Reorder\u0000GHK-Cu\u00006 Weeks / 1 vial":{"vials":1,"nickname":"GHK-Cu"},"Reorder\u0000GHK-Cu\u00003 Months / 2 vials":{"vials":2,"nickname":"GHK-Cu"},"Reorder\u0000TB-500\u00001 Month / 3 vials":{"vials":3,"nickname":"TB-500"},"Reorder\u0000NAD+\u0000Light / 1 vial":{"vials":1,"nickname":"NAD+"},"Reorder\u0000NAD+\u0000Medium / 2 vials":{"vials":2,"nickname":"NAD+"},"Reorder\u0000NAD+\u0000Strong / 4 vials":{"vials":4,"nickname":"NAD+"},"Reorder\u0000Wolverine Blend (BPC/TB500)\u0000Light / 1 Month / 2 vials":{"vials":2,"nickname":"Wolverine Blend"},"Reorder\u0000Wolverine Blend (BPC/TB500)\u0000Standard / 1 Month / 3 vials":{"vials":3,"nickname":"Wolverine Blend"},"Reorder\u0000Wolverine Blend (BPC/TB500)\u0000Strong / 1 Month / 6 vials":{"vials":6,"nickname":"Wolverine Blend"},"Reorder\u0000Wolverine Blend (BPC/TB500)\u0000Light / 3 Months (ship 4)":{"vials":4,"nickname":"Wolverine Blend"},"Reorder\u0000Wolverine Blend (BPC/TB500)\u0000Standard / 3 Months (ship 6)":{"vials":6,"nickname":"Wolverine Blend"},"Reorder\u0000Wolverine Blend (BPC/TB500)\u0000Strong / 3 Months (ship 12)":{"vials":12,"nickname":"Wolverine Blend"},"Reorder\u0000Glow Blend (BPC/GHK/TB)\u00001 Month / 3 vials":{"vials":3,"nickname":"Glow Blend"},"Reorder\u0000Glow Blend (BPC/GHK/TB)\u0000Strong / 1 Month / 6 vials":{"vials":6,"nickname":"Glow Blend"}};
const PRODUCT_SMS = {"Pharmacy J\u0000Tesofensine Pill +L +C\u00001 Month / 30 pills":"tesofensine-pill","Pharmacy J\u0000Tesofensine Pill +L +C\u00003 Months / 90 pills":"tesofensine-pill","Pharmacy J\u00005-Amino-1MQ Pill +L\u00001 Month / 30 pills":"5-amino-1mq-pill","Pharmacy J\u00005-Amino-1MQ Pill +L\u00003 Months / 90 pills":"5-amino-1mq-pill","Pharmacy J\u0000BPC Pill\u00001 Month / 30 pills":"bpc-157-pill","Pharmacy J\u0000BPC Pill\u00003 Months / 90 pills":"bpc-157-pill","Pharmacy J\u0000BPC/KPV Pill\u00001 Month / 30 pills":"bpc-kpv-pill","Pharmacy J\u0000BPC/KPV Pill\u00002 Months / 60 pills":"bpc-kpv-pill","Pharmacy J\u0000BPC/KPV Pill\u00003 Months / 90 pills (1/day)":"bpc-kpv-pill","Pharmacy J\u0000BPC/KPV Pill\u00003 Months / 180 pills (2/day)":"bpc-kpv-pill","Pharmacy J\u0000Dihexa Pill\u00001 Month / 30 pills":"dihexa-pill","Pharmacy J\u0000Dihexa Pill\u00003 Months / 90 pills":"dihexa-pill","Pharmacy J\u0000GHK-Cu / Argireline / Leuphasyl Cream\u00001 Month / 1 bottle (30gm)":"ghk-cu-argireline-leuphasyl-cream","Pharmacy J\u0000GHK-Cu / Argireline / Leuphasyl Cream\u00003 Months / 3 bottles (30gm each)":"ghk-cu-argireline-leuphasyl-cream","Pharmacy J\u0000Semax Nasal Spray\u00001 Month / 1 bottle":"semax-nasal-spray","Pharmacy J\u0000Semax Nasal Spray\u00003 Months / 3 bottles":"semax-nasal-spray","Pharmacy J\u0000Selank Nasal Spray\u00001 Month / 1 bottle":"selank-nasal-spray","Pharmacy J\u0000Selank Nasal Spray\u00003 Months / 3 bottles":"selank-nasal-spray","Pharmacy J\u0000SLU-PP-332\u0000New Patient - 1 Month / 14x100mcg + 18x200mcg":"slu-pp-332-new-patient-titration","Pharmacy J\u0000SLU-PP-332\u0000New Patient - 6 Weeks / 14x100mcg + 42x200mcg":"slu-pp-332-new-patient-titration","Pharmacy J\u0000SLU-PP-332\u0000New Patient - 2 Months / 14x100mcg + 78x200mcg":"slu-pp-332-new-patient-titration","Pharmacy J\u0000SLU-PP-332\u0000New Patient - 3 Months / 14x100mcg + 138x200mcg":"slu-pp-332-new-patient-titration","Pharmacy J\u0000SLU-PP-332\u0000New Patient - 6 Months / 14x100mcg + 318x200mcg":"slu-pp-332-new-patient-titration","Pharmacy J\u0000SLU-PP-332\u0000Refill - 1 Month / 60x200mcg (2/day)":"slu-pp-332-new-patient-titration","Pharmacy J\u0000SLU-PP-332\u0000Refill - 3 Months / 180x200mcg (2/day)":"slu-pp-332-new-patient-titration","Pharmacy J\u0000AOD Troche\u00006 Weeks / 42 troches":"aod-9604-troche","Pharmacy J\u0000AOD Troche\u00001 Month / 30 troches":"aod-9604-troche","Pharmacy J\u0000AOD Troche\u00002 Months / 60 troches":"aod-9604-troche","Pharmacy J\u0000AOD Troche\u00003 Months / 90 troches":"aod-9604-troche","Pharmacy J\u0000AOD Troche\u00006 Months / 180 troches":"aod-9604-troche","Pharmacy J\u0000O-304\u0000New Patient - 1 Month / 53 caps":"o-304-new-patient","Pharmacy J\u0000O-304\u0000New Patient - 6 Weeks / 77 caps":"o-304-new-patient","Pharmacy J\u0000O-304\u0000New Patient - 2 Months / 113 caps":"o-304-new-patient","Pharmacy J\u0000O-304\u0000New Patient - 3 Months / 173 caps":"o-304-new-patient","Pharmacy J\u0000O-304\u0000New Patient - 6 Months / 353 caps":"o-304-new-patient","Pharmacy J\u0000O-304\u0000Refill - 1 Month / 60 caps":"o-304-new-patient","Pharmacy J\u0000O-304\u0000Refill - 3 Months / 180 caps":"o-304-new-patient","Pharmacy A\u0000CJC/IPA Injection +L\u00002 Months / 1 vial":"cjc-ipamorelin","Pharmacy A\u0000Tesa Injection +L (+C if with GLP)\u00004 Weeks / 2 vials":"tesamorelin-vial-s","Pharmacy A\u0000Tesa Injection +L (+C if with GLP)\u00003 Months / 6 vials":"tesamorelin-vial-s","Pharmacy A\u0000BPC-157 Injection\u00001 Month / 1 vial":"bpc-157-injection-vial-s","Pharmacy A\u0000BPC-157 Injection\u00003 Months / 3 vials":"bpc-157-injection-vial-s","Pharmacy A\u0000GHK-Cu Injection\u00006 weeks / 1 vial":"ghk-cu-injection-vial-s","Pharmacy A\u0000GHK-Cu Injection\u00003 Months / 2 vials":"ghk-cu-injection-vial-s","Pharmacy A\u0000TB-500 Injection\u00001 Month / 3 vials":"tb-500-vial-s","Pharmacy A\u0000NAD+ Injection\u0000Light / 1 vial":"nad-light-vial-s","Pharmacy A\u0000NAD+ Injection\u0000Medium / 2 vials":"nad-medium-vial-s","Pharmacy A\u0000NAD+ Injection\u0000Strong / 4 vials":"nad-strong-vial-s","Pharmacy A\u0000NAD+ Injection\u0000Strong / 4 vials (alt. dosing)":"nad-strong-vial-s","Pharmacy A\u0000Wolverine Blend (BPC/TB500)\u0000Light / 1 Month / 2 vials":"wolverine-light-vial-s","Pharmacy A\u0000Wolverine Blend (BPC/TB500)\u0000Standard / 1 Month / 3 vials":"wolverine-standard-vial-s","Pharmacy A\u0000Wolverine Blend (BPC/TB500)\u0000Strong / 1 Month / 6 vials":"wolverine-strong-vial-s","Pharmacy A\u0000Wolverine Blend (BPC/TB500)\u0000Light / 3 Months / 6 vials":"wolverine-light-vial-s","Pharmacy A\u0000Wolverine Blend (BPC/TB500)\u0000Standard / 3 Months / 9 vials":"wolverine-standard-vial-s","Pharmacy A\u0000Wolverine Blend (BPC/TB500)\u0000Strong / 3 Months / 18 vials":"wolverine-strong-vial-s","Pharmacy A\u0000Glow Blend (BPC/GHK/TB)\u00001 Month / 3 vials":"glow-blend-vial-s","Pharmacy A\u0000Glow Blend (BPC/GHK/TB)\u0000Strong / 1 Month / 6 vials":"glow-blend-vial-s-strong","Pharmacy C\u0000Phentermine +L +C\u00001 Month / 30 pills":"phentermine","Pharmacy C\u0000Phentermine +L +C\u00003 Months / 90 pills":"phentermine","Pharmacy C\u0000MOTS-c (CB4211)\u00002 Months / 8 kits":"mots-c-8-kits","Pharmacy C\u0000Thymosin Alpha-1 Injection\u00001 Month / 1 vial":"thymosin-alpha-1-vial-s","Pharmacy C\u0000Thymosin Alpha-1 Injection\u00003 Months / 3 vials":"thymosin-alpha-1-vial-s","Pharmacy C\u0000Methylene Blue Pill 10mg\u00001 Month / 30 pills":"methylene-blue-10mg-starting","Pharmacy C\u0000Methylene Blue Pill 10mg\u00003 Months / 90 pills":"methylene-blue-10mg-starting","Pharmacy C\u0000Methylene Blue Pill 15mg\u00001 Month / 30 pills":"methylene-blue-15mg-maintenance","Pharmacy C\u0000Methylene Blue Pill 15mg\u00003 Months / 90 pills":"methylene-blue-15mg-maintenance","Pharmacy C\u0000Synapsin Nasal Spray (RG3/Nicotinamide Ribose)\u00002 Months / 1 vial 15mL":"synapsin-nasal-spray","Pharmacy C\u0000Synapsin Nasal Spray (RG3/Nicotinamide Ribose)\u00004 Months / 1 vial 30mL":"synapsin-nasal-spray","Pharmacy C\u0000Pinealon\u00001 Month / 1 vial":"pinealon-vial-s","Pharmacy D\u0000Phentermine +L +C\u00001 Month / 30 pills":"phentermine","Pharmacy D\u0000Phentermine +L +C\u00003 Months / 90 pills":"phentermine","Pharmacy D\u0000DSIP Troches 300mcg\u00001 Month / 30 troches":"dsip-troches","Pharmacy D\u0000DSIP Troches 300mcg\u00003 Months / 90 troches":"dsip-troches","Pharmacy D\u0000Methylene Blue Pill 10mg\u00001 Month / 30 pills":"methylene-blue-10mg-starting","Pharmacy D\u0000Methylene Blue Pill 10mg\u00003 Months / 90 pills":"methylene-blue-10mg-starting","Pharmacy D\u0000Methylene Blue Pill 15mg\u00001 Month / 30 pills":"methylene-blue-15mg-maintenance","Pharmacy D\u0000Methylene Blue Pill 15mg\u00003 Months / 90 pills":"methylene-blue-15mg-maintenance","Pharmacy D\u0000Synapsin Nasal Spray (RG3/Nicotinamide Ribose)\u00002 Months / 1 vial 15mL":"synapsin-nasal-spray","Pharmacy D\u0000Synapsin Nasal Spray (RG3/Nicotinamide Ribose)\u00004 Months / 1 vial 30mL":"synapsin-nasal-spray","Pharmacy B\u0000Tesa +L (+C if with GLP)[GO TO PHARMACY A!]\u00001 Vial / 3mL":"tesamorelin-vial-s","Pharmacy B\u0000Pregnyl HCG Injectable +L +C\u00001 Vial / 10mL":"pregnyl-hcg-trt","Pharmacy B\u0000CJC-1295/Ipamorelin Troche 2mg/2mg\u00001 Month / 30 troches":"cjc-1295-ipamorelin-troche","Pharmacy B\u0000CJC-1295/Ipamorelin Troche 2mg/2mg\u00002 Months / 60 troches":"cjc-1295-ipamorelin-troche","Pharmacy B\u0000CJC-1295/Ipamorelin Troche 2mg/2mg\u00003 Months / 90 troches":"cjc-1295-ipamorelin-troche","Pharmacy B\u0000Methylene Blue Pill 10mg\u00001 Month / 30 pills":"methylene-blue-10mg-starting","Pharmacy B\u0000Methylene Blue Pill 10mg\u00003 Months / 90 pills":"methylene-blue-10mg-starting","Pharmacy B\u0000Methylene Blue Pill 15mg\u00001 Month / 30 pills":"methylene-blue-15mg-maintenance","Pharmacy B\u0000Methylene Blue Pill 15mg\u00003 Months / 90 pills":"methylene-blue-15mg-maintenance","Pharmacy B\u0000Methylene Blue Pill 25mg\u00001 Month / 30 pills":"methylene-blue-25mg-higher-dose","Pharmacy B\u0000Methylene Blue Pill 25mg\u00003 Months / 90 pills":"methylene-blue-25mg-higher-dose","Pharmacy B\u0000NAD Nasal Spray\u00001 Bottle / 15mL":"nad-nasal-spray","Pharmacy B\u0000Nicotine Troches\u00001 Month / 30 troches":"nicotine-troches","Pharmacy B\u0000NMN/Apigenin Capsule\u00001 Month / 30 capsules":"nmn-apigenin-capsule","Pharmacy B\u0000NMN/Apigenin Capsule\u00003 Months / 90 capsules":"nmn-apigenin-capsule","Pharmacy B\u0000PT-141 Injection\u00001 Vial / 2mL":"pt-141-injection","Pharmacy B\u0000PT-141 Nasal Spray\u00001 Bottle / 3mL":"pt-141-nasal-spray","Pharmacy B\u0000SS-31 Injection\u00007 Weeks / 1 vial":"ss-31","Pharmacy B\u0000Thymosin Alpha-1 Injection\u00001 Month / 1 vial":"thymosin-alpha-1-vial-s","Pharmacy B\u0000Thymosin Alpha-1 Injection\u00003 Months / 3 vials":"thymosin-alpha-1-vial-s","Pharmacy B\u0000Thymosin Alpha-1 Nasal Spray\u00001 Month / 1 vial":"thymosin-alpha-1-nasal-spray","Pharmacy B\u0000Thymosin Alpha-1 Nasal Spray\u00003 Months / 3 vials":"thymosin-alpha-1-nasal-spray","Pharmacy K\u0000Melanotan II +C\u00001 Vial / 5mL":"melanotan-ii","Pharmacy K\u0000DSIP (Deep Sleep Induced Peptide)\u00001 Vial / 5mL":"dsip-injection","Pharmacy K\u0000Epithalon\u00001 Vial / 5mL":"epithalon","Pharmacy K\u0000Larazotide\u00001 Month / 60 capsules":"larazotide","Pharmacy K\u0000Larazotide\u00003 Months / 180 capsules":"larazotide","Pharmacy K\u0000LL-37\u00001 Vial / 5mL":"ll-37","Pharmacy K\u0000Tesamorelin / Ipamorelin\u00001 Month / 2 vials":"tesamorelin-ipamorelin-pharmacyk-vial-s","Pharmacy K\u0000Tesamorelin / Ipamorelin\u00002 Months / 4 vials":"tesamorelin-ipamorelin-pharmacyk-vial-s","Pharmacy K\u0000Tesamorelin / Ipamorelin\u00003 Months / 6 vials":"tesamorelin-ipamorelin-pharmacyk-vial-s","Pharmacy K\u0000GLOW\u00001 Vial / 3mL":"glow-blend-pharmacyk","Pharmacy K\u0000KLOW\u00002 vials / 14 weeks":"klow-pharmacyk-vial-s","Pharmacy K\u0000GHK-Cu\u00003 vials / 90 days":"ghk-cu-pharmacyk-vial-s","Pharmacy L\u0000[BLRX] BPC-157 injectable\u00001 Month":"bpc-157-injection-pharmacyl-vial-s","Pharmacy L\u0000[BLRX] BPC-157 injectable\u00002 Months":"bpc-157-injection-pharmacyl-vial-s","Pharmacy L\u0000[BLRX] BPC-157 injectable\u00003 Months":"bpc-157-injection-pharmacyl-vial-s","Pharmacy L\u0000[BLRX] TB-500 injectable\u00007 Weeks":"tb-500-pharmacyl-vial-s","Pharmacy L\u0000[BLRX] TB-500 injectable\u000014 Weeks":"tb-500-pharmacyl-vial-s","Pharmacy L\u0000[BLRX] GHK-Cu injectable\u00003 Months":"ghk-cu-injection-pharmacyl-vial-s","Pharmacy L\u0000[BLRX] GHK-Cu injectable\u00006 Months":"ghk-cu-injection-pharmacyl-vial-s","Pharmacy L\u0000[BLRX] GHK-Cu injectable\u00009 Months":"ghk-cu-injection-pharmacyl-vial-s","Pharmacy L\u0000[BLRX] MOTS-C injectable\u00002.5 Months":"mots-c-pharmacyl-vial-s","Pharmacy L\u0000[BLRX] MOTS-C injectable\u00005 Months":"mots-c-pharmacyl-vial-s","Pharmacy L\u0000[BLRX] NAD+ injectable\u00001 Month":"nad-pharmacyl-vial-s","Pharmacy L\u0000[BLRX] NAD+ injectable\u00002 Months":"nad-pharmacyl-vial-s","Pharmacy L\u0000[BLRX] NAD+ injectable\u00003 Months":"nad-pharmacyl-vial-s","Pharmacy L\u0000[BLRX] NAD Nasal Spray\u00002 Months":"nad-nasal-spray-pharmacyl-bottle-s","Pharmacy L\u0000[BLRX] NAD Nasal Spray\u00004 Months":"nad-nasal-spray-pharmacyl-bottle-s","Pharmacy L\u0000[BLRX] Tesamorelin injectable\u00001 Month":"tesamorelin-pharmacyl-vial-s","Pharmacy L\u0000[BLRX] Tesamorelin injectable\u00002 Months":"tesamorelin-pharmacyl-vial-s","Pharmacy L\u0000[BLRX] Tesamorelin injectable\u00003 Months":"tesamorelin-pharmacyl-vial-s"};

// OP2 flavor by ANY leg, not the first one: an entry shipped by two pharmacies
// composes the Pharmacy A template if a Pharmacy A leg exists, then Pharmacy L, else the
// pharmacy-direct template. Keying off pharmacies[0] alone gave a
// ['pharmacyc','pharmacya'] entry the wrong head/fulfillment/footer.
function smsFlavorKey(pharmacies) {
  const p = pharmacies || [];
  if (p.indexOf('pharmacya') >= 0) return 'pharmacya';
  if (p.indexOf('pharmacyl') >= 0) return 'pharmacyl';
  return 'other';
}

function unifiedSmsText(entryId, ctx) {
  const e = UNIFIED_SMS.byId && UNIFIED_SMS.byId[entryId];
  if (!e) return null;
  const F = UNIFIED_SMS.flavors;
  const name = (ctx && ctx.name) || '[patient name]';
  const key = smsFlavorKey(e.pharmacies);
  const fl = F[key === 'other' ? 'direct' : key];
  // delayed = the per-pharmacy wording baked in the bank (golden-proven);
  // normal = the original's shared one-week paragraph (v5.28.1 behavior).
  const fulfillment = fulfillmentMode() === 'normal' ? REORDER_FULFILLMENT.op2Normal : fl.fulfillment;
  const segs = [fl.head.split('{NAME}').join(name), fulfillment];
  const SHIP = { pharmacya: UNIFIED_SMS.shipping.pharmacya, pharmacyl: UNIFIED_SMS.shipping.pharmacyl };
  if (SHIP[key]) segs.push('SHIPPING: ' + SHIP[key]);
  segs.push(fl.dosingHeader);
  let leg;
  if (e.sms.body) {
    leg = (e.bodyBare || String(e.sms.body).replace(/^Medication:\s*/gm, '')) + (e.sms.note ? '\n\n' + e.sms.note : '');
  } else {
    const med = e.sms.med, conc = e.sms.conc;
    const medLine = e.sms.medLine || (conc ? med + ' (' + conc + ')' : med);
    if (fl.bare) {
      const sub = [];
      if (med) sub.push(String(med).replace(/^\d+\s+(?=[A-Za-z])/, '').replace(/^(?:kits?|vials?|pens?|syringes?|bottles?|boxes)\s+of\s+/i, '').trim());
      if (conc) sub.push(String(conc).trim());
      sub.push(e.sms.rx);
      leg = sub.join('\n');
      if (e.sms.note) leg += '\n\n' + e.sms.note;
    } else if (medLine === '') {
      leg = 'Medication: ' + e.sms.rx;
      if (e.sms.note) leg += '\n\n' + e.sms.note;
    } else if (medLine) {
      leg = 'Medication: ' + medLine + '\n' + e.sms.rx;
      if (e.sms.note) leg += '\n\n' + e.sms.note;
    } else {
      leg = e.sms.rx;
    }
  }
  segs.push(leg);
  const link = e.legGuide || e.sms.link || (UNIFIED_SMS.guideDefaultGroups.indexOf(e.group) >= 0 ? UNIFIED_SMS.guides.default : null);
  if (link) segs.push(fl.guideSingle + (fl.guideInline ? ' ' : '\n') + link);
  fl.footer.forEach(f => segs.push(f));
  let msg = segs.join('\n\n').replace(/\n{3,}/g, '\n\n');
  if (fl.glueDosing) msg = msg.replace('DOSING:\n\n', 'DOSING:\n');
  return msg;
}

function unifiedCopy(text) {
  try { GM_setClipboard(text, 'text'); return true; } catch (_) {}
  return new Promise((resolve) => {
    navigator.clipboard.writeText(text).then(() => resolve(true)).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (_) {}
      ta.remove(); resolve(true);
    });
  });
}

// ---- Patient name/address auto-read (ported from Peptide SMS v5.28.1) ----
// Same page fields + same fallback prompt as the original script. BOTH values
// are required: the address is printed in the message as "Address on file:",
// so a placeholder reaching the clipboard is a patient-facing defect, not a
// nicety (v1.1.0 silently substituted the literal "[address]").
function readCxValue(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (!el) continue;
    const v = el.getAttribute('cx-prop-value');
    if (v && v.trim()) return v.trim();
    const txt = el.textContent;
    if (txt && txt.trim()) return txt.trim();
  }
  return null;
}
function getFirstName() {
  const full = readCxValue([
    '#titlecard_LASTNAME',
    '[data-zcqa="value_LASTNAME"]',
    '#title_LASTNAME crux-text-component',
    // Zoho drifted the detail-view name field LASTNAME -> FULLNAME (2026-08-04)
    '#titlecard_FULLNAME',
    '[data-zcqa="value_FULLNAME"]',
    '#title_FULLNAME crux-text-component',
  ]);
  return full ? full.trim().split(/\s+/)[0] : null;
}
function getAddress() {
  return readCxValue([
    '[data-zcqa="value_MailingStreet"]',
    '#subvalue_CONTACTCF50',
    '#value_CONTACTCF50 crux-text-component',
  ]);
}
function getPatientContext() {
  let name = getFirstName();
  let address = getAddress();
  const missing = [];
  if (!name) missing.push('first name');
  if (!address) missing.push('address');
  if (missing.length) {
    const manual = prompt(
      'Could not auto-read ' + missing.join(' and ') +
      '.\n\nEnter as: FirstName | Full Address',
      (name || '') + ' | ' + (address || '')
    );
    if (manual === null) return null;
    const parts = manual.split('|');
    name = (parts[0] || '').trim() || name;
    address = (parts[1] || '').trim() || address;
  }
  if (!name) { alert('First name is required.'); return null; }
  if (!address) { alert('Address is required — the message states the shipping address.'); return null; }
  return { name: name, address: address };
}

// ---- Fulfillment mode + reorder (ported from Peptide SMS v5.28.1) ---------
// Same localStorage key the original used, so an existing flip carries over.
function fulfillmentMode() {
  const v = localStorage.getItem('rxSmsFulfillmentMode');
  return (v === 'normal' || v === 'delayed') ? v : 'delayed';
}
function formatOrderList(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return items[0] + ' and ' + items[1];
  return items.slice(0, -1).join(', ') + ', and ' + items[items.length - 1];
}
function buildReorderMessage(firstName, cfg, address) {
  const mode = fulfillmentMode();
  const reord = REORDER_FULFILLMENT.reorder[mode];
  const win = REORDER_FULFILLMENT.addressWindow[mode];
  const tail = "\n\nIf you will not be at this address " + win +
    ", or if you'd prefer us to ship to a different address, please let us know as soon as possible so we can update your order before it ships.";
  const head = 'Hi ' + firstName + "! This is Dr. Example' Order Processing Department. ";
  const addressBlock = '\n\nAddress on file:\n' + address + '\n\n';
  if (Array.isArray(cfg.items) && cfg.items.length) {
    return head + 'Your ' + formatOrderList(cfg.items) +
      ' are due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.' +
      addressBlock + reord + tail;
  }
  const vialWord = cfg.vials === 1 ? 'vial is' : 'vials are';
  return head + 'Your ' + cfg.vials + ' ' + cfg.nickname + ' ' + vialWord +
    ' due to be ordered today. This is already covered in your plan so nothing extra is needed on your end.' +
    addressBlock + reord + tail +
    "\n\nOne quick note: we ship peptides a few vials at a time because they have a limited shelf life. Shipping everything at once could cause some of the medication to expire before it's used.";
}

// ---- Dose calculator (2026-09-28) -----------------------------------------
// The tier blocks bake the duration in as prose, which is how a block can promise
// 30 days from a vial that holds 10. This computes it from the block's own numbers
// instead: pick the peptide, pick WHICH VIAL (one menu label can mean several
// physical products), pick the count, get the duration.
//
// It is additive. The golden tier blocks still render byte-identical; nothing that
// was copied before changes. This is new surface with its own gate.
const UNIFIED_CALC = {"entries":{"cjc-ipamorelin":{"label":"CJC/Ipamorelin","name":"CJC/Ipamorelin","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacya","pharmacyLabel":"Pharmacy A","tier":"Entry dose","volume":6,"concs":[1.5,2.5],"doses":[0.1,0.2],"units":8,"perDay":2,"daysPerWeek":5,"cadence":"twice daily, for a total of 14 units per day. Use in the morning while fasted and again before bed. Use 5 days on and 2 days off.","refuse":null}]},"ghk-cu-injection-vial-s":{"label":"GHK-Cu Injection / vial(s)","name":"GHK-Cu","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacya","pharmacyLabel":"Pharmacy A","tier":"Entry dose","volume":5,"concs":[10],"doses":[1.2],"units":12,"perDay":1,"daysPerWeek":7,"cadence":"Once daily","refuse":null}]},"glow-blend-vial-s":{"label":"Glow Blend / vial(s)","name":"Glow Blend (BPC-157 / GHK-Cu / TB-500)","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacya","pharmacyLabel":"Pharmacy A","tier":"Entry dose","volume":3,"concs":[1.66,9,3.33],"doses":[0.5,2.7,1],"units":30,"perDay":1,"daysPerWeek":7,"cadence":"Daily","refuse":null}]},"glow-blend-vial-s-strong":{"label":"Glow Blend / vial(s) (Strong)","name":"Glow Blend (BPC-157 / GHK-Cu / TB-500)","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacya","pharmacyLabel":"Pharmacy A","tier":"Entry dose","volume":3,"concs":[1.66,9,3.33],"doses":[1,5.4,2],"units":60,"perDay":1,"daysPerWeek":7,"cadence":"Daily","refuse":null}]},"wolverine-light-vial-s":{"label":"Wolverine Light / vial(s)","name":"Wolverine Blend (BPC-157 / TB-500)","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacya","pharmacyLabel":"Pharmacy A","tier":"Entry dose","volume":3,"concs":[1.66,3.33],"doses":[0.33,0.67],"units":20,"perDay":1,"daysPerWeek":7,"cadence":"Daily","refuse":null}]},"wolverine-standard-vial-s":{"label":"Wolverine Standard / vial(s)","name":"Wolverine Blend (BPC-157 / TB-500)","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacya","pharmacyLabel":"Pharmacy A","tier":"Entry dose","volume":3,"concs":[1.66,3.33],"doses":[0.5,1],"units":30,"perDay":1,"daysPerWeek":7,"cadence":"Daily","refuse":null}]},"wolverine-strong-vial-s":{"label":"Wolverine Strong / vial(s)","name":"Wolverine Blend (BPC-157 / TB-500)","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacya","pharmacyLabel":"Pharmacy A","tier":"Entry dose","volume":3,"concs":[1.66,3.33],"doses":[1,2],"units":60,"perDay":1,"daysPerWeek":7,"cadence":"Daily","refuse":null}]},"tb-500-vial-s":{"label":"TB-500 / vial(s)","name":"TB-500","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacya","pharmacyLabel":"Pharmacy A","tier":"Entry dose","volume":3,"concs":[3.33],"doses":[1],"units":30,"perDay":1,"daysPerWeek":7,"cadence":"Daily","refuse":null}]},"bpc-157-injection-vial-s":{"label":"BPC-157 Injection / vial(s)","name":"BPC-157","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacya","pharmacyLabel":"Pharmacy A","tier":"Entry dose","volume":5,"concs":[3],"doses":[0.51],"units":17,"perDay":1,"daysPerWeek":7,"cadence":"Daily","refuse":null}]},"bpc-157-injection-pharmacyl-vial-s":{"label":"BPC-157 Injection (Pharmacy L) / vial(s)","name":"BPC-157","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacyl","pharmacyLabel":"Pharmacy L","tier":"Entry dose","volume":5,"concs":[5],"doses":[1],"units":20,"perDay":1,"daysPerWeek":7,"cadence":"Once daily","refuse":null}]},"tb-500-pharmacyl-vial-s":{"label":"TB-500 (Pharmacy L) / vial(s)","name":"TB-500","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacyl","pharmacyLabel":"Pharmacy L","tier":"Entry dose","volume":5,"concs":[10],"doses":[1],"units":10,"perDay":1,"daysPerWeek":7,"cadence":"Once daily","refuse":null}]},"ghk-cu-injection-pharmacyl-vial-s":{"label":"GHK-Cu Injection (Pharmacy L) / vial(s)","name":"GHK-Cu","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacyl","pharmacyLabel":"Pharmacy L","tier":"Entry dose","volume":3,"concs":[50],"doses":[2.5],"units":5,"perDay":1,"daysPerWeek":5,"cadence":"Once daily, Monday through Friday","refuse":null}]},"mots-c-pharmacyl-vial-s":{"label":"MOTS-C (Pharmacy L) / vial(s)","name":"MOTS-C","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacyl","pharmacyLabel":"Pharmacy L","tier":"Entry dose","volume":5,"concs":[10],"doses":[5],"units":50,"perDay":1,"daysPerWeek":2,"cadence":"Twice weekly, in the morning or before your workout","refuse":null}]},"nad-pharmacyl-vial-s":{"label":"NAD+ (Pharmacy L) / vial(s)","name":"NAD+","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacyl","pharmacyLabel":"Pharmacy L","tier":"Entry dose","volume":5,"concs":[200],"doses":[80],"units":40,"perDay":1,"daysPerWeek":3,"cadence":"Three times a week","refuse":null}]},"glow-blend-pharmacyk":{"label":"Glow Blend (Pharmacy K)","name":"Glow Blend (BPC-157 / GHK-Cu / TB-500)","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacyk","pharmacyLabel":"Pharmacy K","tier":"Entry dose","volume":3,"concs":[1.66,9,3.33],"doses":[0.5,2.7,1],"units":30,"perDay":1,"daysPerWeek":7,"cadence":"Daily","refuse":null}]},"klow-pharmacyk-vial-s":{"label":"KLOW (Pharmacy K) / vial(s)","name":"KLOW (BPC-157 / GHK-Cu / TB-500 / KPV)","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacyk","pharmacyLabel":"Pharmacy K","tier":"Entry dose","volume":10,"concs":[3,3,3,10],"doses":[0.6,0.6,0.6,2],"units":20,"perDay":1,"daysPerWeek":5,"cadence":"5 days on and 2 days off (Mon-Fri)","refuse":null}]},"ghk-cu-pharmacyk-vial-s":{"label":"GHK-Cu (Pharmacy K) / vial(s)","name":"GHK-Cu","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacyk","pharmacyLabel":"Pharmacy K","tier":"Entry dose","volume":2,"concs":[25],"doses":[2.5],"units":10,"perDay":1,"daysPerWeek":5,"cadence":"5 days on and 2 days off (Mon-Fri)","refuse":null}]},"ss-31":{"label":"SS-31","name":"SS-31","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacyb","pharmacyLabel":"Pharmacy B","tier":"Entry dose","volume":6,"concs":[50],"doses":[20],"units":40,"perDay":1,"daysPerWeek":2,"cadence":"in the morning, 2 times per week","refuse":null}]},"nad-light-vial-s":{"label":"NAD+ Light / vial(s)","name":"NAD+","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacya","pharmacyLabel":"Pharmacy A","tier":"Entry dose","volume":10,"concs":[100],"doses":[50],"units":50,"perDay":1,"daysPerWeek":3,"cadence":"3 times a week","refuse":null}]},"nad-medium-vial-s":{"label":"NAD+ Medium / vial(s)","name":"NAD+","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacya","pharmacyLabel":"Pharmacy A","tier":"Entry dose","volume":10,"concs":[100],"doses":[100],"units":100,"perDay":1,"daysPerWeek":3,"cadence":"3 times a week","refuse":null}]},"nad-strong-vial-s":{"label":"NAD+ Strong / vial(s)","name":"NAD+","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacya","pharmacyLabel":"Pharmacy A","tier":"Entry dose","volume":10,"concs":[100],"doses":[200],"units":200,"perDay":1,"daysPerWeek":3,"cadence":"3 times a week","refuse":null}]},"nad-strong-vial-s-alt-dosing":{"label":"NAD+ Strong / vial(s) (alt. dosing)","name":"NAD+","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacya","pharmacyLabel":"Pharmacy A","tier":"Entry dose","volume":10,"concs":[100],"doses":[85],"units":85,"perDay":1,"daysPerWeek":7,"cadence":"Daily","refuse":null}]},"pt-141-injection":{"label":"PT-141 Injection","name":"PT-141","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacya","pharmacyLabel":"Pharmacy A","tier":"Entry dose","volume":5,"concs":[2],"doses":[0.4],"units":20,"perDay":1,"daysPerWeek":5,"cadence":"Every 3 days","refuse":null},{"key":"alt:pharmacyb:1 Vial / 2mL","pharmacy":"pharmacyb","pharmacyLabel":"Pharmacy B","tier":"1 Vial / 2mL","volume":2,"concs":[10],"doses":[0.4],"units":4,"perDay":0,"daysPerWeek":0,"cadence":"Every 3 days","inferred":null,"refuse":"cadence not derivable from its own Frequency line \"Every 3 days\""}]},"thymosin-alpha-1-vial-s":{"label":"Thymosin Alpha-1 / vial(s)","name":"Thymosin Alpha-1","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacya","pharmacyLabel":"Pharmacy A","tier":"Entry dose","volume":5,"concs":[5],"doses":[1],"units":20,"perDay":1,"daysPerWeek":5,"cadence":"Daily","refuse":null},{"key":"alt:pharmacyc:1 Month / 1 vial","pharmacy":"pharmacyc","pharmacyLabel":"Pharmacy C","tier":"1 Month / 1 vial","volume":3,"concs":[5],"doses":[1],"units":20,"perDay":1,"daysPerWeek":7,"cadence":"Daily","inferred":"15mg ÷ 5mg/mL","refuse":null},{"key":"alt:pharmacyc:3 Months / 3 vials","pharmacy":"pharmacyc","pharmacyLabel":"Pharmacy C","tier":"3 Months / 3 vials","volume":3,"concs":[5],"doses":[1],"units":20,"perDay":1,"daysPerWeek":7,"cadence":"Daily","inferred":"15mg ÷ 5mg/mL","refuse":null},{"key":"alt:pharmacyb:1 Month / 1 vial","pharmacy":"pharmacyb","pharmacyLabel":"Pharmacy B","tier":"1 Month / 1 vial","volume":5,"concs":[3],"doses":[1],"units":33,"perDay":1,"daysPerWeek":7,"cadence":"Daily","inferred":null,"refuse":null},{"key":"alt:pharmacyb:3 Months / 3 vials","pharmacy":"pharmacyb","pharmacyLabel":"Pharmacy B","tier":"3 Months / 3 vials","volume":5,"concs":[3],"doses":[1],"units":33,"perDay":1,"daysPerWeek":7,"cadence":"Daily","inferred":null,"refuse":null}]},"epithalon":{"label":"Epithalon","name":"Epithalon","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacya","pharmacyLabel":"Pharmacy A","tier":"Entry dose","volume":5,"concs":[2],"doses":[0.4],"units":20,"perDay":1,"daysPerWeek":5,"cadence":"once daily, Monday through Friday","refuse":null},{"key":"alt:pharmacyk:1 Vial / 5mL","pharmacy":"pharmacyk","pharmacyLabel":"Pharmacy K","tier":"1 Vial / 5mL","volume":5,"concs":[10],"doses":[0.4],"units":4,"perDay":1,"daysPerWeek":7,"cadence":"Daily","inferred":null,"refuse":null}]},"kisspeptin":{"label":"Kisspeptin","name":"Kisspeptin","group":"Injectables","vials":[{"key":"primary","pharmacy":"pharmacya","pharmacyLabel":"Pharmacy A","tier":"Entry dose","volume":5,"concs":[1],"doses":[0.1],"units":10,"perDay":1,"daysPerWeek":2,"cadence":"two times per week","refuse":null}]}},"entryCount":26,"refuseCount":1};

// Doses one vial yields, from the block's own lines. Two ways, and the honest
// promise is the SMALLER of the two:
//   byVolume  — fill volume ÷ drawn mL. What the vial physically holds.
//   byActives — total mg of the limiting active ÷ the mg the text promises.
// They differ when the labelled concentration is rounded: GLOW is "27mg/5mg/10mg
// per 3mL", so BPC is 1.66mg/mL nominal and 3×1.66 = 4.98mg, giving 9.96 doses at
// the promised 0.5mg rather than a nominal 10. Promising 10 would over-promise.
function calcDosesPerVial(v) {
  if (!v || !(v.volume > 0) || !(v.units > 0)) return null;
  var draw = v.units / 100;
  var byVolume = v.volume / draw;
  var byActives = Infinity;
  for (var i = 0; i < v.concs.length; i++) {
    var promised = v.doses[i];
    if (!(v.concs[i] > 0) || !(promised > 0)) continue;
    byActives = Math.min(byActives, (v.volume * v.concs[i]) / promised);
  }
  return Math.min(byVolume, isFinite(byActives) ? byActives : byVolume);
}

// Weeks the order lasts. perDay × daysPerWeek is doses per week, so vials ×
// doses ÷ that is weeks; × 7 is the calendar span. Same formula as
// harvest/derive-math.js — the gate extracts this function and the derive side
// and asserts they agree, because two implementations of one rule drift.
function calcOrder(entry, vial, vials) {
  var perWeek = vial.perDay * vial.daysPerWeek;
  if (!(perWeek > 0)) return { refuse: 'cadence not derivable for this block' };
  var dosesEach = calcDosesPerVial(vial);
  if (dosesEach == null) return { refuse: 'no unit dose or vial volume on this block' };
  if (!(vials > 0)) return { refuse: 'vial count must be at least 1' };
  var doses = vials * dosesEach;
  return {
    dosesEach: +dosesEach.toFixed(2),
    dosesTotal: +doses.toFixed(1),
    weeks: +(doses / perWeek).toFixed(1),
    days: +(doses / perWeek * 7).toFixed(0),
    perWeek: perWeek,
  };
}

// The full house-format block, same line vocabulary as the harvested tiers.
function calcBlockText(entryId, vialKey, vials) {
  var e = UNIFIED_CALC.entries && UNIFIED_CALC.entries[entryId];
  if (!e) return null;
  var v = null;
  for (var i = 0; i < e.vials.length; i++) if (e.vials[i].key === vialKey) { v = e.vials[i]; break; }
  if (!v) return null;
  var r = calcOrder(e, v, vials);
  if (r.refuse) return null;
  var concTxt = v.concs.length > 1
    ? v.concs.map(function (x) { return x; }).join('/') + 'mg per mL'
    : v.concs[0] + 'mg/mL';
  var vialWord = vials === 1 ? 'vial' : 'vials';
  var ls = [
    'Products Ordered:',
    '[date] (' + v.pharmacyLabel + ') [initials]',
    'Medication: ' + vials + ' ' + vialWord + ' of ' + v.volume + 'mL ' + e.name +
      (v.concs.length ? ' ' + v.concs.join('/') + 'mg/mL' : ''),
  ];
  if (v.concs.length) ls.push('Concentration: ' + concTxt);
  ls.push('Dosing: (' + v.units + ' units)');
  ls.push('Frequency: ' + v.cadence);
  ls.push('Estimated Duration: ' + r.weeks + ' weeks');
  return ls.join('\n');
}


GM_addStyle(`
    :root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}
    .zuni-sms,
    #zuni-fab, #zuni-root, .zuni-ul, .zuni-li, .zuni-item, .zuni-toast, #zuni-preview, #zuni-calc,
    .zuni-search-input, .zuni-section-header, .zuni-recent-dot,
    #zuni-searchbox, #zuni-searchinput {
      all: initial; box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
        .zuni-sms {
      display: inline-block !important; flex-shrink: 0 !important;
      margin-left: 8px !important; padding: 1px 6px !important;
      font-size: 10px !important; font-weight: 700 !important; letter-spacing: .03em !important;
      color: #8a5f2e !important; border: 1px solid #e8e2d8 !important; border-radius: 4px !important;
      background: #fffdf9 !important; cursor: pointer !important; user-select: none !important;
    }
    #zuni-fab {
      display: inline-flex !important; align-items: center !important; justify-content: center !important;
      position: relative !important; top: auto !important; left: auto !important;
      width: 32px !important; height: 32px !important; border-radius: 8px !important;
      background: var(--ds-accent, #aecbfa) !important; color: var(--ds-accent-text, #174ea6) !important; font-size: 15px !important;
      line-height: 1 !important; cursor: pointer !important; z-index: 2147483646 !important;
      margin-left: 10px !important; flex-shrink: 0 !important;
      transition: background .15s ease !important;
      user-select: none !important; -webkit-user-select: none !important;
    }
    #zuni-fab:hover { filter: brightness(0.95); }
    /* Fallback if the Zoho top panel isn't found: keep the old floating pill so
       the button is still reachable instead of vanishing into the page flow. */
    #zuni-fab.zuni-fab-fallback {
      position: fixed !important; top: 10px !important; left: 10px !important;
      width: 48px !important; height: 48px !important; border-radius: 100% !important;
      font-size: 20px !important; margin-left: 0 !important;
    }
    #zuni-root { position: fixed !important; z-index: 2147483647 !important; }
    .zuni-ul {
      display: block !important; list-style: none !important; margin: 0 !important; padding: 4px 0 !important;
      background: #fff !important; border: 1px solid rgba(0,0,0,.12) !important; border-radius: 8px !important;
      min-width: 220px !important; max-width: 340px !important;
      box-shadow: 0 4px 16px rgba(0,0,0,.18) !important;
    }
    .zuni-li { position: relative !important; display: block !important; }
    .zuni-li > .zuni-ul {
      display: none !important; position: absolute !important; top: -4px; left: 100%;
    }
    .zuni-li:hover > .zuni-ul { display: block !important; }
    .zuni-item {
      display: flex !important; align-items: center !important; justify-content: space-between !important;
      padding: 8px 14px !important; font-size: 13px !important; color: #202124 !important;
      cursor: pointer !important; white-space: nowrap !important; overflow: hidden !important;
      text-overflow: ellipsis !important; max-width: 100% !important;
    }
    .zuni-item:hover {
      background: #f1f3f4 !important;
    }
    .zuni-item.zuni-back {
      color: #5f6368 !important; font-size: 12px !important;
    }
    .zuni-item.zuni-back:hover {
      color: #202124 !important;
    }
    .zuni-ul.zuni-drill {
      width: min(300px, calc(100vw - 20px)) !important;
      min-width: auto !important;
      max-height: min(70vh, 560px) !important;
      overflow-y: auto !important;
    }
    .zuni-arrow { font-size: 10px !important; opacity: .5 !important; flex-shrink: 0 !important; margin-left: 8px !important; }
    .zuni-sep { height: 1px !important; background: rgba(0,0,0,.08) !important; margin: 4px 0 !important; }
    .zuni-toast {
      display: block !important; position: fixed !important; top: auto !important; left: auto !important;
      background: #323232 !important; color: #fff !important; font-size: 13px !important;
      padding: 10px 18px !important; border-radius: 6px !important; z-index: 2147483647 !important;
      opacity: 0 !important; pointer-events: none !important; max-width: calc(100vw - 24px) !important;
    }
    .zuni-toast.visible { opacity: 1 !important; }
    #zuni-preview {
      position: fixed !important; z-index: 2147483647 !important; background: #fff !important;
      border: 1px solid rgba(0,0,0,.12) !important; border-radius: 8px !important;
      padding: 12px !important; font-size: 12px !important; color: #202124 !important;
      max-width: min(90vw, 340px) !important; width: auto !important;
      height: auto !important; max-height: none !important; overflow: visible !important;
      white-space: pre-wrap !important; word-wrap: break-word !important;
      pointer-events: none !important; display: none !important; line-height: 1.4 !important;
      box-shadow: 0 4px 16px rgba(0,0,0,.18) !important;
    }
    #zuni-preview.visible { display: block !important; }
    /* Dose calculator (2026-09-28) — its own surface, not a tree leaf, so the
       golden tree shape assertion stays untouched. */
    #zuni-calc {
      position: fixed !important; z-index: 2147483647 !important;
      left: 50% !important; top: 12vh !important; transform: translateX(-50%) !important;
      background: var(--ds-surface, #fffdf9) !important;
      border: 1px solid var(--ds-border, #e8e2d8) !important; border-radius: 10px !important;
      padding: 10px 12px !important; width: min(92vw, 420px) !important;
      max-height: 76vh !important; overflow: auto !important;
      font-size: 13px !important; color: var(--ds-text, #202124) !important;
      box-shadow: 0 6px 22px rgba(0,0,0,.2) !important; line-height: 1.45 !important;
    }
    .zuni-calc-head { font-weight: 700 !important; font-size: 14px !important; margin-bottom: 6px !important; }
    .zuni-calc-back { color: var(--ds-accent, #8a5f2e) !important; cursor: pointer !important; margin-bottom: 8px !important; display: inline-block !important; }
    .zuni-calc-filter {
      width: 100% !important; box-sizing: border-box !important; margin-bottom: 8px !important;
      padding: 6px 8px !important; border: 1px solid var(--ds-border, #e8e2d8) !important; border-radius: 6px !important;
      background: var(--ds-bg, #faf8f5) !important; color: var(--ds-text, #202124) !important; font: inherit !important;
    }
    .zuni-calc-row { padding: 7px 8px !important; border-radius: 6px !important; cursor: pointer !important; }
    .zuni-calc-row:hover { background: var(--ds-surface2, #f4f0e9) !important; }
    .zuni-calc-row-dead { opacity: .55 !important; cursor: default !important; }
    .zuni-calc-note { font-size: 11px !important; color: var(--ds-muted, #7a7163) !important; padding: 2px 8px 8px !important; }
    .zuni-calc-stepper { display: flex !important; align-items: center !important; gap: 10px !important; margin: 8px 0 !important; }
    .zuni-calc-btn {
      width: 30px !important; height: 30px !important; border-radius: 6px !important; cursor: pointer !important;
      border: 1px solid var(--ds-border, #e8e2d8) !important; background: var(--ds-surface, #fffdf9) !important;
      color: var(--ds-text, #202124) !important; font-size: 16px !important; line-height: 1 !important;
    }
    .zuni-calc-num { min-width: 2.2em !important; text-align: center !important; font-weight: 700 !important; font-size: 16px !important; }
    .zuni-calc-line { font-size: 12px !important; color: var(--ds-muted, #7a7163) !important; }
    .zuni-calc-strong { color: var(--ds-text, #202124) !important; font-weight: 700 !important; font-size: 13px !important; }
    .zuni-calc-copy {
      margin-top: 10px !important; padding: 7px 14px !important; border-radius: 6px !important; cursor: pointer !important;
      border: 1px solid var(--ds-accent, #8a5f2e) !important; background: var(--ds-accent, #8a5f2e) !important;
      color: var(--ds-accent-text, #fff) !important; font: inherit !important; font-weight: 700 !important;
    }
    .zuni-calc-copy:disabled { opacity: .45 !important; cursor: not-allowed !important; }
    .zuni-li.zuni-kb-open > .zuni-ul { display: block !important; }
    .zuni-item.zuni-kb-active { background: #aecbfa !important; }
    .zuni-num {
      display: inline-block !important;
      flex-shrink: 0 !important;
      min-width: 1.4em !important;
      margin-right: 8px !important;
      text-align: right !important;
      color: #80868b !important;
      font-size: 11px !important;
      font-variant-numeric: tabular-nums !important;
    }
    .zuni-search-row { padding: 4px 10px 6px !important; }
    .zuni-search-input {
      display: block !important; width: 100% !important; box-sizing: border-box !important;
      padding: 6px 10px !important; font-size: 12px !important; border-radius: 4px !important;
      border: 1px solid rgba(0,0,0,.2) !important; outline: none !important; background: #fff !important;
      color: #202124 !important; cursor: text !important; line-height: 1.3 !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    }
    .zuni-search-input:focus { border-color: #1a73e8 !important; }
    .zuni-section-header {
      display: block !important; padding: 4px 14px !important; font-size: 10px !important;
      text-transform: uppercase !important; letter-spacing: .04em !important;
      color: #80868b !important; cursor: default !important;
    }
    .zuni-recent-dot {
      display: inline-block !important; color: #1a73e8 !important; font-size: 8px !important;
      margin-left: 6px !important; flex-shrink: 0 !important;
    }
    #zuni-searchbox {
      display: block !important; box-sizing: border-box !important;
      width: 100% !important; margin: 8px 0 10px 0 !important; clear: both !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    }
    #zuni-searchinput {
      box-sizing: border-box !important; display: block !important;
      width: 100% !important; padding: 8px 12px !important; font-size: 13px !important;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      color: #202124 !important; background: #fff !important; cursor: text !important;
      border: 1px solid #1a73e8 !important; border-radius: 8px !important; outline: none !important;
    }
    #zuni-searchinput::placeholder { color: #80868b !important; }
    #zuni-searchinput:focus { box-shadow: 0 0 0 2px rgba(26,115,232,.2) !important; }
    #zuni-replacer-row {
      /* v6.6: Date & Initials Replacer row hidden per Jeyson — feature retired from
         the UI, but kept in the DOM (display:none only) so the manual button
         handlers and the [date]/[initials] insert-path token replacement stay
         intact and can be un-hidden later without a JS change. */
      display: none !important;
    }
    #zuni-replacer-row button {
      border: none !important; background: none !important; padding: 2px 6px !important;
      font-size: 12px !important; color: #1a73e8 !important; cursor: pointer !important;
      border-radius: 4px !important; display: inline-flex !important; align-items: center !important;
      gap: 3px !important; font-family: inherit !important; line-height: 1.4 !important;
    }
    #zuni-replacer-row button:hover { background: #e8f0fe !important; }
    #zuni-replacer-row .zuni-replacer-sep { color: #dadce0 !important; font-size: 12px !important; }
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
      const num = entry.item.querySelector('.zuni-num');
      if (num) num.textContent = String(i + 1);
    });
  }

  function buildLeafItem(label, text, isTaskUpdate, path) {
    const li = document.createElement('li');
    li.className = 'zuni-li';
    const item = document.createElement('div');
    item.className = 'zuni-item';
    const num = document.createElement('span');
    num.className = 'zuni-num';
    item.appendChild(num);
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    labelSpan.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
    item.appendChild(labelSpan);
    if (path && path.length && isRecentPath(path)) {
      const dot = document.createElement('span');
      dot.className = 'zuni-recent-dot';
      dot.textContent = '●';
      dot.title = 'Recently used';
      item.appendChild(dot);
    }
    item.dataset.tmenuText = text;
    // [SMS] dual action: a small button next to the label for entries that
    // have a patient-facing message. Leaf click itself stays = Order paste.
    if (path && path.length && PRODUCT_SMS[path.join('\u0000')]) {
      const sid = PRODUCT_SMS[path.join('\u0000')];
      const btn = document.createElement('span');
      btn.className = 'zuni-sms';
      btn.textContent = 'SMS';
      btn.title = 'Copy the patient-facing SMS for this product';
      btn.addEventListener('click', (ev) => {
        ev.stopPropagation();
        hidePreview();
        const ctx = getPatientContext();
        if (!ctx) return;
        const t = unifiedSmsText(sid, ctx);
        if (t) {
          unifiedCopy(t);
          showToast('📱 SMS copied');
          closeMenu(); // pick done — auto-close like a leaf click (2026-09-28)
        } else {
          showToast('⚠️ no SMS for this entry');
        }
      });
      item.appendChild(btn);
    }
    // [REORDER] dual action on Reorder-branch leaves: copies the reorder
    // message with name + address auto-read from the contact page.
    if (path && path.length && REORDER_LEAF[path.join(' ')]) {
      const rcfg = REORDER_LEAF[path.join(' ')];
      const btn2 = document.createElement('span');
      btn2.className = 'zuni-sms';
      btn2.textContent = 'REORDER';
      btn2.title = 'Copy the reorder SMS (name + address auto-read from this contact)';
      btn2.addEventListener('click', (ev) => {
        ev.stopPropagation();
        hidePreview();
        const ctx = getPatientContext();
        if (!ctx) return;
        unifiedCopy(buildReorderMessage(ctx.name, rcfg, ctx.address));
        showToast('📱 Reorder SMS copied');
        closeMenu(); // auto-close like the SMS button (2026-09-28)
      });
      item.appendChild(btn2);
    }
    if (path && path.length === 3 && path[0] === 'Pharmacy J') {
      const btn3 = document.createElement('span');
      btn3.className = 'zuni-sms';
      btn3.textContent = 'CART';
      btn3.title = 'Add to the Pharmacy J order cart (the form has 4 rows)';
      btn3.addEventListener('click', (ev) => {
        ev.stopPropagation();
        hidePreview();
        const c = __api.__pharmacyjCart = __api.__pharmacyjCart || [];
        const key = path[1] + '\u0000' + path[2];
        if (c.some(x => x.group + '\u0000' + x.optionLabel === key)) { showToast('already in the Pharmacy J cart'); return; }
        if (c.length >= 4) { showToast('⚠️ the Pharmacy J form has 4 rows — fill or remove one'); return; }
        c.push({ group: path[1], optionLabel: path[2] });
        showToast('🧾 ' + c.length + '/4 in the Pharmacy J cart');
      });
      item.appendChild(btn3);
    }
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
    li.className = 'zuni-li zuni-search-row';
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'zuni-search-input';
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

  // ============================================================
  // DOSE CALCULATOR (2026-09-28)
  // ============================================================
  // The tier blocks bake the duration in as prose, which is how a block can promise
  // 30 days from a vial that holds 10. This derives it instead: pick the peptide,
  // pick WHICH VIAL (one menu label can mean several physical products — PT-141 is
  // 2mL@10mg/mL at Pharmacy B and 5mL@2mg/mL at Greenwich), pick the count, and the
  // duration is computed from the block's own numbers.
  //
  // Additive on purpose: the golden tier blocks are untouched and still render
  // byte-identical, so nothing copied before changed. A vial whose cadence or
  // actives cannot be read is shown with its reason and cannot be picked — the
  // whole point is to stop guessing.
  let calcPanelEl = null;
  let calcState = { view: 'index', entryId: null, vialKey: null, vials: 1, filter: '' };

  function closeCalcPanel() {
    if (calcPanelEl) { calcPanelEl.remove(); calcPanelEl = null; }
  }

  function calcEl(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function calcEntry(id) { return UNIFIED_CALC.entries[id]; }

  function calcVial(id, key) {
    const e = calcEntry(id);
    if (!e) return null;
    return e.vials.filter(v => v.key === key)[0] || null;
  }

  function openCalcPanel() {
    closeMenu();
    closeCalcPanel();
    calcState = { view: 'index', entryId: null, vialKey: null, vials: 1, filter: '' };
    calcPanelEl = document.createElement('div');
    calcPanelEl.id = 'zuni-calc';
    document.body.appendChild(calcPanelEl);
    renderCalc();
  }

  function buildCalcRow() {
    const li = calcEl('li', 'zuni-li');
    const item = calcEl('div', 'zuni-item');
    // Same child structure as buildLeafItem (num, then label): renumberLevel()
    // finds the .zuni-num, and anything reading children[1] gets the label.
    const num = calcEl('span', 'zuni-num');
    item.appendChild(num);
    const label = calcEl('span', null, '🧮 Dose calculator — derive the duration');
    label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
    item.appendChild(label);
    item.addEventListener('click', (e) => { e.stopPropagation(); openCalcPanel(); });
    li.appendChild(item);
    return li;
  }

  function renderCalc() {
    if (!calcPanelEl) return;
    while (calcPanelEl.firstChild) calcPanelEl.firstChild.remove();
    calcPanelEl.appendChild(calcEl('div', 'zuni-calc-head',
      calcState.view === 'index' ? 'Dose calculator'
      : calcState.view === 'vials' ? calcEntry(calcState.entryId).label
      : calcEntry(calcState.entryId).label + ' · ' + calcVial(calcState.entryId, calcState.vialKey).tier));

    if (calcState.view !== 'index') {
      const back = calcEl('div', 'zuni-calc-back', '← back');
      back.addEventListener('click', () => {
        if (calcState.view === 'count') { calcState.view = 'vials'; calcState.vialKey = null; }
        else { calcState.view = 'index'; calcState.entryId = null; }
        renderCalc();
      });
      calcPanelEl.appendChild(back);
    }

    if (calcState.view === 'index') renderCalcIndex();
    else if (calcState.view === 'vials') renderCalcVials();
    else renderCalcCount();
  }

  function renderCalcIndex() {
    const input = calcEl('input', 'zuni-calc-filter');
    input.type = 'search';
    input.placeholder = 'filter peptides…';
    input.value = calcState.filter;
    input.addEventListener('input', () => { calcState.filter = input.value; renderCalcList(); });
    calcPanelEl.appendChild(input);

    const list = calcEl('div', 'zuni-calc-list');
    calcPanelEl.appendChild(list);
    calcPanelEl.appendChild(calcEl('div', 'zuni-calc-note',
      UNIFIED_CALC.entryCount + ' peptides with derivable dosing · ' + UNIFIED_CALC.refuseCount + ' vials cannot be derived and are shown, not guessed'));
    calcListInto(list);
  }

  function calcListInto(list) {
    while (list.firstChild) list.firstChild.remove();
    const q = calcState.filter.trim().toLowerCase();
    for (const [id, e] of Object.entries(UNIFIED_CALC.entries)) {
      if (q && (e.label + ' ' + e.group + ' ' + e.name).toLowerCase().indexOf(q) === -1) continue;
      const okCount = e.vials.filter(v => !v.refuse).length;
      const row = calcEl('div', 'zuni-calc-row' + (okCount ? '' : ' zuni-calc-row-dead'),
        e.label + '  ·  ' + e.group + (okCount ? '' : '  (no derivable vial)'));
      if (okCount) row.addEventListener('click', () => {
        calcState.view = 'vials'; calcState.entryId = id; calcState.vials = 1; renderCalc();
      });
      list.appendChild(row);
    }
  }

  function renderCalcVials() {
    const e = calcEntry(calcState.entryId);
    const list = calcEl('div', 'zuni-calc-list');
    calcPanelEl.appendChild(list);
    for (const v of e.vials) {
      const bits = [v.pharmacyLabel, v.volume + 'mL', v.concs.length ? v.concs.join('/') + 'mg/mL' : null, v.units ? v.units + ' units' : null, v.cadence || null]
        .filter(Boolean).join(' · ');
      const row = calcEl('div', 'zuni-calc-row' + (v.refuse ? ' zuni-calc-row-dead' : ''),
        (v.inferred ? '≈ ' : '') + v.tier + ' — ' + bits);
      if (v.inferred) row.title = 'identified by ' + v.inferred;
      if (v.refuse) {
        list.appendChild(row);
        list.appendChild(calcEl('div', 'zuni-calc-note', '⚠️ ' + v.refuse));
        continue;
      }
      row.addEventListener('click', () => {
        calcState.view = 'count'; calcState.vialKey = v.key; calcState.vials = 1; renderCalc();
      });
      list.appendChild(row);
    }
  }

  function renderCalcCount() {
    const e = calcEntry(calcState.entryId);
    const v = calcVial(calcState.entryId, calcState.vialKey);
    const row = calcEl('div', 'zuni-calc-stepper');
    const minus = calcEl('button', 'zuni-calc-btn', '−');
    const num = calcEl('span', 'zuni-calc-num', String(calcState.vials));
    const plus = calcEl('button', 'zuni-calc-btn', '+');
    const setN = (n) => { calcState.vials = Math.max(1, Math.min(99, n)); num.textContent = String(calcState.vials); paintResult(); };
    minus.addEventListener('click', () => setN(calcState.vials - 1));
    plus.addEventListener('click', () => setN(calcState.vials + 1));
    row.appendChild(minus); row.appendChild(num); row.appendChild(plus);
    calcPanelEl.appendChild(row);

    const out = calcEl('div', 'zuni-calc-result');
    calcPanelEl.appendChild(out);

    const copy = calcEl('button', 'zuni-calc-copy', 'Copy block');
    copy.addEventListener('click', () => {
      const t = calcBlockText(calcState.entryId, calcState.vialKey, calcState.vials);
      if (!t) { showToast('⚠️ not derivable'); return; }
      unifiedCopy(t);
      showToast('✓ block copied');
    });
    calcPanelEl.appendChild(copy);

    function paintResult() {
      while (out.firstChild) out.firstChild.remove();
      const r = calcOrder(e, v, calcState.vials);
      if (r.refuse) { out.appendChild(calcEl('div', 'zuni-calc-note', '⚠️ ' + r.refuse)); copy.disabled = true; return; }
      copy.disabled = false;
      out.appendChild(calcEl('div', 'zuni-calc-line',
        v.volume + 'mL ÷ ' + (v.units / 100).toFixed(2) + 'mL = ' + r.dosesEach + ' doses per vial'));
      out.appendChild(calcEl('div', 'zuni-calc-line',
        calcState.vials + ' × ' + r.dosesEach + ' = ' + r.dosesTotal + ' doses'));
      out.appendChild(calcEl('div', 'zuni-calc-line zuni-calc-strong',
        r.weeks + ' weeks (' + r.days + ' days) at ' + v.cadence));
    }
    paintResult();
  }

  function appendRecentItems(ul) {
    const recent = getRecentList();
    if (!recent.length) return;
    const header = document.createElement('li');
    header.className = 'zuni-li zuni-section-header';
    header.textContent = '🕐 Recent';
    ul.appendChild(header);
    recent.forEach(r => ul.appendChild(buildLeafItem(r.label, r.text, r.isTaskUpdate, r.path)));
    const sep = document.createElement('li');
    sep.className = 'zuni-sep';
    ul.appendChild(sep);
  }

  function renderFlatResults(ul, matches) {
    if (!matches.length) {
      const empty = document.createElement('li');
      empty.className = 'zuni-li zuni-section-header';
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
    const newInput = menuRoot.querySelector('.zuni-search-input');
    if (newInput) {
      newInput.focus();
      if (cursorPos != null) { try { newInput.setSelectionRange(cursorPos, cursorPos); } catch(_) { console.warn('[ZUnified]', _); } }
    }
  }

  // --- Flyout mode (wide viewports), submenus are lazily built on first hover ---
  function buildMenuList(node, isRoot = false, isTaskUpdate = false, pathArr = []) {
    const ul = document.createElement('ul');
    ul.className = 'zuni-ul';

    if (isRoot) {
      ul.appendChild(buildSearchRow());
      ul.appendChild(buildCalcRow());
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
        li.className = 'zuni-li';
        const item = document.createElement('div');
        item.className = 'zuni-item';
        const num = document.createElement('span');
        num.className = 'zuni-num';
        item.appendChild(num);
        const label = document.createElement('span');
        label.textContent = key;
        label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
        item.appendChild(label);
        const arrow = document.createElement('span');
        arrow.className = 'zuni-arrow';
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
    ul.className = 'zuni-ul zuni-drill';
    const isRootLevel = menuStack.length === 0;

    if (menuStack.length > 0) {
      const prev = menuStack[menuStack.length - 1];
      const backLi = document.createElement('li');
      backLi.className = 'zuni-li';
      const backItem = document.createElement('div');
      backItem.className = 'zuni-item zuni-back';
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
      sep.className = 'zuni-sep';
      ul.appendChild(sep);
    }

    if (isRootLevel) {
      // The anchored box (if driving this render) already IS the search field —
      // don't show a second, redundant search input inside the dropdown too.
      if (!searchBoxDriven) ul.appendChild(buildSearchRow());
      ul.appendChild(buildCalcRow());
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
        li.className = 'zuni-li';
        const item = document.createElement('div');
        item.className = 'zuni-item';
        const num = document.createElement('span');
        num.className = 'zuni-num';
        item.appendChild(num);
        const label = document.createElement('span');
        label.textContent = key;
        label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;';
        item.appendChild(label);
        const arrow = document.createElement('span');
        arrow.className = 'zuni-arrow';
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
    menuRoot.id = 'zuni-root';
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
    try { GM_setClipboard(text, 'text'); copied = true; } catch(_) { console.warn('[ZUnified]', _); }
    if (!copied) {
      navigator.clipboard.writeText(text).catch(() => {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch(_) { console.warn('[ZUnified]', _); }
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
        } catch(_) { console.warn('[ZUnified]', _); }
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
      console.debug('[ZUnified] inject failed:', err.message);
      showToast('⚠️ Paste manually (Ctrl+V)');
    }
  }

  // ============================================================
  // SECTION 7: TOAST & PREVIEW
  // ============================================================
  function ensureToast() {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'zuni-toast'; document.body.appendChild(toastEl); }
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
    if (!previewEl) { previewEl = document.createElement('div'); previewEl.id = 'zuni-preview'; document.body.appendChild(previewEl); }
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
      menuRoot.querySelectorAll('.zuni-ul').forEach(ul => {
        if (ul.offsetParent !== null || ul.closest('.zuni-li:hover')) {
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
    fabEl.id = 'zuni-fab'; fabEl.title = 'Unified Template Menu (Alt+T)'; fabEl.textContent = '📋';
    fabEl.setAttribute('role', 'button');
    fabEl.setAttribute('tabindex', '0');
    fabEl.setAttribute('aria-label', 'Unified Template Menu');

    const attachToPanel = () => {
      const host = findTopPanelHost();
      if (!host) return false;
      fabHost = host;
      // Leftmost (Jeyson 2026-09-28): the phone/address pills (#qc-top-strip,
      // Patient Toolkit) used to land first and push this button right of them.
      host.insertBefore(fabEl, host.firstChild);
      fabEl.classList.remove('zuni-fab-fallback');
      return true;
    };

    if (!attachToPanel()) {
      // Zoho CRM is an SPA — the header may not be rendered yet. Keep a
      // floating fallback so the menu is still reachable, then dock once the
      // panel appears (appendChild moves it out of the fallback spot).
      document.body.appendChild(fabEl);
      fabEl.classList.add('zuni-fab-fallback');
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
        requestAnimationFrame(() => { fabReinjectQueued = false; host.insertBefore(fabEl, host.firstChild); });
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
      menuRoot.id = 'zuni-root';
      document.body.appendChild(menuRoot);
      attachMenuListeners();
    }
    renderDrillLevel(TEMPLATES, null, false);
    positionMenuNearBox();
  }

  function buildReplacerRow() {
    const row = document.createElement('div');
    row.id = 'zuni-replacer-row';
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
    sep.className = 'zuni-replacer-sep';
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
    searchBoxEl.id = 'zuni-searchbox';

    searchInputEl = document.createElement('input');
    searchInputEl.id = 'zuni-searchinput';
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
    return Array.from(ul.querySelectorAll(':scope > .zuni-li'))
      .map(li => ({ li, item: li.querySelector(':scope > .zuni-item') }))
      .filter(x => x.item && !x.item.classList.contains('zuni-back'));
  }

  function kbClearActive() {
    if (!menuRoot) return;
    menuRoot.querySelectorAll('.zuni-item.zuni-kb-active')
      .forEach(el => el.classList.remove('zuni-kb-active'));
  }
  function kbSetActive(item) {
    kbClearActive();
    if (item) item.classList.add('zuni-kb-active');
  }

  function kbMaybePreview(entry) {
    if (!entry || entry.item.querySelector('.zuni-arrow')) { hidePreview(); return; }
    const text = entry.item.dataset.tmenuText;
    if (text == null) { hidePreview(); return; }
    showPreview({ currentTarget: entry.item }, text);
  }

  // ---------- Flyout mode (wide viewports) ----------
  function kbFlyoutInit() {
    if (!menuRoot || kbStack.length) return;
    const rootUl = menuRoot.querySelector(':scope > .zuni-ul');
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
    entry.li.classList.add('zuni-kb-open');
    repositionSubmenu(entry.li, subUl);
    kbStack.push({ ul: subUl, index: 0 });
    const subItems = kbNavigableItems(subUl);
    if (subItems.length) { kbSetActive(subItems[0].item); kbMaybePreview(subItems[0]); }
  }

  function kbFlyoutLeft() {
    if (kbStack.length <= 1) return; // already at root
    const closing = kbStack.pop();
    const parentLi = closing.ul.closest('.zuni-li');
    if (parentLi) parentLi.classList.remove('zuni-kb-open');
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
  function kbDrillUl() { return menuRoot && menuRoot.querySelector('.zuni-ul.zuni-drill'); }

  function kbDrillMove(dir) {
    const ul = kbDrillUl();
    if (!ul) return;
    const items = kbNavigableItems(ul);
    if (!items.length) return;
    let idx = items.findIndex(x => x.item.classList.contains('zuni-kb-active'));
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
    const entry = kbNavigableItems(ul).find(x => x.item.classList.contains('zuni-kb-active'));
    if (!entry) { kbDrillMove(1); return; }
    if (entry.item.querySelector('.zuni-arrow')) { entry.item.click(); kbDrillResetTop(); }
  }

  function kbDrillLeft() {
    const back = menuRoot && menuRoot.querySelector('.zuni-item.zuni-back');
    if (!back) return; // at root
    back.click();
    kbDrillResetTop();
  }

  function kbDrillEnter() {
    const ul = kbDrillUl();
    if (!ul) return;
    const entry = kbNavigableItems(ul).find(x => x.item.classList.contains('zuni-kb-active'));
    if (!entry) { kbDrillMove(1); return; }
    const isBranch = !!entry.item.querySelector('.zuni-arrow');
    entry.item.click(); // branch → drills + re-renders; leaf → inserts + closes
    if (isBranch) kbDrillResetTop();
  }

  // Keep a single highlight: drop the keyboard highlight when the mouse takes over
  const onMenuMouseover = (e) => {
    if (!menuRoot || !kbEngaged) return;
    const overItem = e.target.closest && e.target.closest('.zuni-item');
    if (overItem && menuRoot.contains(overItem) && !overItem.classList.contains('zuni-kb-active')) {
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
  // ESC in WINDOW CAPTURE: fires before any document/window-bubble handler,
  // so Zoho's own keydown handlers can no longer swallow Escape with
  // stopPropagation before the menu sees it (2026-09-28 — ESC "did nothing"
  // while a Zoho field had focus).
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (calcPanelEl) { closeCalcPanel(); return; }
    if (menuRoot) closeMenu();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 't') {
      e.preventDefault();
      if (menuRoot) closeMenu();
      else if (searchInputEl && document.body.contains(searchInputEl)) { searchInputEl.focus(); searchInputEl.select(); }
      else openMenu(Math.round(window.innerWidth / 2 - 110), Math.round(window.innerHeight / 2 - 100));
      return;
    }
    if (e.key === 'Escape') { if (calcPanelEl) { closeCalcPanel(); return; } closeMenu(); return; }

    if (!menuRoot) return;

    // Either search input (the in-menu row, or the anchored box) — typing should
    // behave normally, but Up/Down/Enter should still drive dropdown navigation
    // without stealing focus away from the box (Left/Right keep editing the text).
    const inSearchInput = e.target === searchInputEl ||
      (e.target && e.target.classList && e.target.classList.contains('zuni-search-input'));

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
    console.error('[ZUnified] Fatal error:', err);
  }
})();
