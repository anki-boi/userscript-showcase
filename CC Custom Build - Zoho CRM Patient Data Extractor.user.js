// ==UserScript==
// @name         CC Custom Build - Zoho CRM Patient Data Extractor
// @namespace    http://tampermonkey.net/
// @version      1.48
// @description  Extract patient data from Zoho CRM: Copy Everything JSON payload + Create Order
// @author       Jeyson Dagondon
// @run-at       document-idle
// @match        https://crm.zoho.com/crm/*/tab/Contacts/*
// @match        https://staff.exampleclinic.com/patient-*
// @grant        GM.setClipboard
// @grant        GM.getValue
// @grant        GM.setValue
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[CC v1.48] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['CC'] = {
  name: 'CC Custom Build - Zoho CRM Patient Data Extractor',
  version: '1.48',
  state: 'idle',
  message: '',
  progress: null,
  output: null,
  error: null,
  lastActivity: Date.now(),
  trigger: null
};
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}' +
    // v1.34: copy feedback — strong flash animation + confirmation toast
    '.cc-copy-flash{animation:ccCopyFlash .8s ease-out}' +
    '@keyframes ccCopyFlash{0%{background-color:var(--ds-success,#3d7a46);color:#fff}60%{background-color:#c8e6c9;color:#1f1f1f}100%{background-color:transparent;color:#1f1f1f}}' +
    '#cc-toast{position:fixed;top:24px;left:50%;transform:translateX(-50%);z-index:2147483647;background:var(--ds-success,#3d7a46);color:#fff;padding:10px 18px;border-radius:8px;font:600 13px system-ui,sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.25);opacity:0;transition:opacity .25s;pointer-events:none;max-width:70vw;text-align:center}' +
    '#cc-toast.show{opacity:1}';
  document.documentElement.appendChild(__dsStyle);

(function() {
    'use strict';

    // ========================================
    // MODULE STATE (keyboard copy / active window)
    // ========================================
    let copyItems = [];          // [{ fieldDiv, copyValue }] in displayed order
    let activeFloatWindow = null;

    // ========================================
    // STATE ABBREVIATION ↔ FULL NAME MAP
    // ========================================
    const stateMap = {
        'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR',
        'california': 'CA', 'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE',
        'florida': 'FL', 'georgia': 'GA', 'hawaii': 'HI', 'idaho': 'ID',
        'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA', 'kansas': 'KS',
        'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
        'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS',
        'missouri': 'MO', 'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV',
        'new hampshire': 'NH', 'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY',
        'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH', 'oklahoma': 'OK',
        'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
        'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT',
        'vermont': 'VT', 'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV',
        'wisconsin': 'WI', 'wyoming': 'WY',
        'district of columbia': 'DC', 'puerto rico': 'PR'
    };

    // Reverse map: abbreviation → full name (title case)
    const abbrToFull = {};
    for (const [full, abbr] of Object.entries(stateMap)) {
        abbrToFull[abbr] = full.replace(/\b\w/g, c => c.toUpperCase());
    }
    // ========================================
    // PHARMACY RESTRICTION MAP (state abbr → restricted pharmacies)
    // Source: clinic pharmacy shipping matrix
    // Pharmacy J = all 50 states (never restricted). Pharmacy A = all except ND.
    // Pharmacy F / Pharmacy G have no restriction data → not checked.
    // A "(...)" note marks a PARTIAL/conditional restriction (rendered amber).
    // ========================================
    const RESTRICTION_MAP = {
        AL: ['Pharmacy D', 'Formulation', 'Pharmacy B', 'Pharmacy C', 'Pharmacy H', 'Pharmacy E'],
        AK: ['Pharmacy D', 'Pharmacy I', 'Pharmacy B', 'Pharmacy H'],
        AR: ['Formulation', 'Pharmacy I', 'Pharmacy B', 'Pharmacy E'],
        CA: ['Pharmacy D', 'Formulation', 'Pharmacy I', 'Pharmacy B', 'Pharmacy C', 'Pharmacy H', 'Pharmacy E'],
        CT: ['Pharmacy D', 'Pharmacy H'],
        DC: ['Pharmacy C'],
        HI: ['Pharmacy I', 'Pharmacy B'],
        IN: ['Pharmacy D'],
        IA: ['Pharmacy B'],
        KY: ['Formulation'],
        LA: ['Pharmacy D', 'Pharmacy B', 'Pharmacy C', 'Pharmacy E'],
        ME: ['Pharmacy I'],
        MA: ['Pharmacy H', 'Pharmacy E', 'Pharmacy C (MOTS-c specific)'],
        MI: ['Pharmacy D', 'Formulation', 'Pharmacy C'],
        MS: ['Pharmacy D', 'Pharmacy B', 'Pharmacy C', 'Pharmacy E'],
        MT: ['Pharmacy D', 'Pharmacy C'],
        NE: ['Formulation', 'Pharmacy B'],
        NV: ['Pharmacy D', 'Formulation', 'Pharmacy E'],
        NH: ['Pharmacy H'],
        NC: ['Pharmacy B', 'Pharmacy H'],
        ND: ['Pharmacy A'],
        OH: ['Pharmacy D', 'Pharmacy B', 'Pharmacy C'],
        OR: ['Formulation', 'Pharmacy E', 'Progress (for Thymosin Alpha-1)'],
        RI: ['Pharmacy H'],
        SC: ['Pharmacy D', 'Pharmacy B', 'Pharmacy E'],
        TX: ['Pharmacy D', 'Pharmacy I', 'Pharmacy C', 'Pharmacy H (no injections)'],
        VT: ['Pharmacy H'],
        VA: ['Formulation', 'Pharmacy E'],
        WA: ['Pharmacy D', 'Formulation', 'Pharmacy C', 'Pharmacy E'],
        WV: ['Pharmacy D', 'Formulation', 'Pharmacy C']
    };

    // ========================================
    // LIFEFILE PHARMACY → PORTAL URL MAP
    // Login-page URLs (user-provided 2026-08-02). All end in access/doctor.
    // The LifeFile portal scripts read the clipboard JSON (_lf intent) and drive
    // the sale from the login page onward.
    // ========================================
    const PHARMACY_URL_MAP = [
        { key: 'pharmacya',    name: 'Pharmacy A',              host: 'hostB',      url: 'https://hostB.pharmalink.example/application_main_zfw/login/login/vendor_name/vendorA/frm/stdlogin/access/doctor' },
        { key: 'progress',   name: 'Pharmacy B', host: 'hostC:8443', url: 'https://hostC.pharmalink.example:8443/application_main_zfw/login/login/vendor_name/vendorB/frm/stdlogin/access/doctor' },
        { key: 'pharmacyc',  name: 'Pharmacy C',           host: 'hostA',      url: 'https://hostA.pharmalink.example/application_main_zfw/login/login/vendor_name/vendorC/access/doctor' },
        { key: 'pharmacyd',  name: 'Pharmacy D',            host: 'hostA',      url: 'https://hostA.pharmalink.example/application_main_zfw/login/login/vendor_name/pharmacyd/frm/stdlogin/access/doctor' },
        { key: 'pharmacye', name: 'Pharmacy E',        host: 'hostB',      url: 'https://hostB.pharmalink.example/application_main_zfw/login/login/access/doctor/vendor_name/vendorE/logout/1' },
        { key: 'pharmacyf',   name: 'Pharmacy F',            host: 'hostD',      url: 'https://hostD.pharmalink.example/application_main_zfw/login/login/vendor_name/vendorF/access/doctor' },
        { key: 'pharmacyg',   name: 'Pharmacy G (LDN)',      host: 'hostD',      url: 'https://hostD.pharmalink.example/application_main_zfw/login/login/vendor_name/vendorG/access/doctor' }
    ];

    // A WindowProxy to the single LifeFile tab we drive. Survives Zoho SPA
    // navigation (this closure persists until Zoho is fully reloaded).
    let portalWin = null;
    // Navigate the existing portal tab to `url`, or open a new one. Returns
    // 'reused' | 'opened' | 'failed' so the UI can show what actually happened.
    // Cross-origin navigation via the WindowProxy is allowed, so this reuses the
    // tab for ANY pharmacy — unlike Chrome's named-window lookup, which is
    // origin-scoped and can't see *.pharmalink.example tabs from crm.zoho.com.
    function openPortalTab(url) {
        if (portalWin && !portalWin.closed) {
            try { portalWin.location.href = url; portalWin.focus(); return 'reused'; } catch(e) { console.warn('[CC]', e); }
        }
        const w = window.open(url, '_blank');
        if (w) { portalWin = w; return 'opened'; }
        return 'failed';
    }

    // Version marker — lets us confirm the RUNNING script version in the page.
    try { window.__lfSaleVer = '1.33'; } catch(e) { console.warn('[CC]', e); }

    const normPharm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();

    // Is a pharmacy blocked from shipping to a state (per RESTRICTION_MAP)?
    // Substring match so 'Pharmacy B' hits 'Pharmacy B' etc.
    function isPharmacyRestricted(pharmName, stateAbbr) {
        if (!stateAbbr) return false;
        const restricted = RESTRICTION_MAP[stateAbbr];
        if (!restricted) return false;
        const pn = normPharm(pharmName);
        return restricted.some((r) => {
            const rn = normPharm(r);
            return pn.includes(rn) || rn.includes(pn);
        });
    }

    // ========================================
    // MEDICAL FIELD SELECTORS
    // ========================================
    const MEDICAL_FIELDS = {
        fullName: {
            selector: 'span.cxElemCompViewWrap',
            label: 'Full Name',
            extract: (el) => el.textContent.trim(),
            index: 0
        },
        dateOfBirth: {
            selector: 'span.cxElementViewValue.cxElemCompViewValue',
            label: 'Date of Birth',
            extract: (el) => {
                const raw = el.textContent.trim();
                const d = new Date(raw);
                if (!isNaN(d.getTime())) {
                    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
                }
                return raw;
            }
        },
        address: {
            selector: 'span.cxElemCompViewWrap',
            label: 'Address',
            extract: (el) => el.textContent.trim(),
            filter: (elements) => {
                const zipCodePattern = /\b\d{5}(?:-\d{4})?\b$/;
                for (const el of elements) {
                    const text = el.textContent.trim();
                    if (zipCodePattern.test(text)) {
                        return el;
                    }
                }
                return null;
            },
            parse: (full) => {
                let clean = full.replace(/\n/g, ', ').replace(/\s{2,}/g, ' ').trim();
                clean = clean.replace(/,\s*,/g, ',').replace(/,+/g, ',').trim();
                clean = clean.replace(/,\s*$/, '').trim();

                // 1. Extract ZIP code (always the last token)
                let zipCode = '';
                const zipMatch = clean.match(/,?\s*(\d{5}(?:-\d{4})?)\s*$/);
                if (zipMatch) {
                    zipCode = zipMatch[1];
                    clean = clean.substring(0, zipMatch.index).trim().replace(/,\s*$/, '').trim();
                }

                // 2. Extract state (now the last token after removing ZIP)
                let stateAbbr = '';
                let stateFullName = '';

                // Try full state names first (longer names first to avoid partial matches)
                const stateNames = Object.keys(stateMap).sort((a, b) => b.length - a.length);
                let foundState = false;

                for (const name of stateNames) {
                    const regex = new RegExp(',?\\s*\\b(' + name.replace(/\s/g, '\\s') + ')\\s*$', 'i');
                    const match = clean.match(regex);
                    if (match) {
                        stateAbbr = stateMap[name];
                        stateFullName = abbrToFull[stateAbbr];
                        clean = clean.substring(0, match.index).trim().replace(/,\s*$/, '').trim();
                        foundState = true;
                        break;
                    }
                }

                // Fall back to 2-letter abbreviation
                if (!foundState) {
                    const abbrMatch = clean.match(/,?\s*\b([A-Z]{2})\s*$/);
                    if (abbrMatch && abbrToFull[abbrMatch[1]]) {
                        stateAbbr = abbrMatch[1];
                        stateFullName = abbrToFull[stateAbbr];
                        clean = clean.substring(0, abbrMatch.index).trim().replace(/,\s*$/, '').trim();
                    }
                }

                // 3. Split the trailing city out of the remaining "street, city".
                //    Only a CLEAN comma-separated city is auto-filled — Zoho often
                //    stores "205 Marquette Ave South Bend" with no comma, and
                //    guessing where the city starts there is unreliable, so in that
                //    case the city is left blank and the portal form glows it for
                //    manual entry (never risk filling a wrong city).
                let city = '';
                const lastComma = clean.lastIndexOf(',');
                if (lastComma > 0) {
                    city = clean.substring(lastComma + 1).trim();
                    clean = clean.substring(0, lastComma).trim().replace(/,\s*$/, '').trim();
                }

                return {
                    address: clean,
                    city: city,
                    state: stateAbbr,
                    zipCode: zipCode,
                    _stateFullName: stateFullName
                };
            }
        },
        gender: {
            selector: 'lyte-text.cxElemCompViewValue',
            label: 'Gender',
            extract: (el) => el.getAttribute('lt-prop-value') || el.textContent.trim()
        },
        phone: {
            selector: 'span.cxPhoneViewValue.lvPhFld',
            label: 'Phone',
            extract: (el) => {
                return el.textContent.trim().replace(/\D/g, '').slice(-10);
            },
            index: 0
        },
        mobile: {
            selector: 'span.cxPhoneViewValue.lvPhFld',
            label: 'Mobile',
            extract: (el) => {
                const digits = el.textContent.trim().replace(/\D/g, '').slice(-10);
                return `(${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
            },
            index: 1
        },
        email: {
            selector: 'crm-rl-share-email[email*="@"], lyte-text[lt-prop-value*="@"], a.cxEmailViewLink',
            label: 'Email',
            extract: (el) => {
                const emailAttr = el.getAttribute('email');
                if (emailAttr && emailAttr.includes('@')) return emailAttr;
                const propValue = el.getAttribute('lt-prop-value');
                if (propValue && propValue.includes('@')) return propValue;
                const text = el.textContent?.trim();
                if (text && text.includes('@')) return text;
                const href = el.getAttribute('href');
                return href ? href.replace('mailto:', '') : '';
            }
        }
    };

    // ========================================
    // HELPERS
    // ========================================
    function findFieldByLabel(labelText, selector) {
        const elements = document.querySelectorAll(selector);
        for (const el of elements) {
            let prev = el.previousElementSibling || el.parentElement?.previousElementSibling;
            while (prev) {
                if (prev.textContent?.includes(labelText)) return el;
                prev = prev.previousElementSibling;
            }
            const parentText = el.parentElement?.textContent || '';
            if (parentText.indexOf(labelText) < parentText.indexOf(el.textContent)) {
                return el;
            }
        }
        return elements[0];
    }

    // Find value by detail-view label text (e.g., "Weight In Day", "FLOA Phase", "Goal Weight")
    function getFieldValueByLabel(labelText) {
        const labels = document.querySelectorAll('[id^="labelTD_"]');
        for (const lbl of labels) {
            if (lbl.textContent.trim() === labelText) {
                const container = lbl.closest('[id^="mouseArea__"]');
                if (!container) continue;

                // Picklist / dropdown values (e.g., Weight In Day, FLOA Phase)
                const lyteText = container.querySelector('lyte-text.cxElemCompViewValue');
                if (lyteText) {
                    return (lyteText.getAttribute('lt-prop-value') || lyteText.textContent.trim()).trim();
                }

                // Number values (e.g., Goal Weight)
                const numberVal = container.querySelector('.cxElemCompViewValue.numberDivNumberView');
                if (numberVal) return numberVal.textContent.trim();

                // Generic fallback
                const textVal = container.querySelector('.cxElemCompViewValue');
                if (textVal) return textVal.textContent.trim();
            }
        }
        return '';
    }

    // Extract short timezone label (e.g., "ET") from the third-party timezone panel
    function getTimezoneShort() {
        const panel = document.querySelector('.djm-tz-panel');
        if (!panel) return '';
        const body = panel.querySelector('[data-role="tz-body"]');
        if (!body) return '';
        const firstDiv = body.querySelector('div');
        if (!firstDiv) return '';
        const match = firstDiv.textContent.match(/Timezone:\s*([A-Za-z]+)/);
        return match ? match[1].trim() : '';
    }
    // Build the restriction warning HTML for a given state abbreviation.
    // Returns red ✕ chips for full blocks, amber ⚠ chips for partial/conditional,
    // or a green "no restrictions" confirmation when the state is clear.
    function buildRestrictionHtml(stateAbbr) {
        if (!stateAbbr) return '';
        const restricted = RESTRICTION_MAP[stateAbbr];

        if (!restricted || restricted.length === 0) {
            return `<div style="margin-top:6px;color:var(--ds-success,#0a8754);font-size:11px;font-weight:600;">✓ No pharmacy restrictions</div>`;
        }

        const chips = restricted.map(name => {
            const partial = /\(/.test(name); // any parenthetical = conditional restriction
            const fg = partial ? 'var(--ds-warn,#8a5a00)' : 'var(--ds-danger,#b3261e)';
            const bg = partial ? '#fff4e0' : '#fdecea';
            const bd = partial ? '#f0cf94' : '#f5c6c2';
            const icon = partial ? '⚠' : '✕';
            return `<span style="
                display:inline-flex;align-items:center;gap:3px;
                background:${bg};color:${fg};border:1px solid ${bd};
                border-radius:4px;padding:2px 6px;font-size:11px;font-weight:600;
                line-height:1.3;white-space:nowrap;">
                <span style="font-weight:700;">${icon}</span>${name}
            </span>`;
        }).join('');

        return `
            <div style="margin-top:8px;padding-top:6px;border-top:1px dashed #e0a0a0;">
                <div style="color:var(--ds-danger,#b3261e);font-size:11px;font-weight:700;margin-bottom:4px;">
                    ⚠ Restricted at ${restricted.length}:
                </div>
                <div style="display:flex;flex-wrap:wrap;gap:4px;">${chips}</div>
            </div>
        `;
    }
    // Is the user currently typing somewhere we must NOT hijack number keys?
    function isTypingTarget(el) {
        if (!el) return false;
        const tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    }

    // v1.34: confirmation toast — "✓ Copied <label>: <value>" so a click
    // always has visible proof (the old 300ms tint alone was too subtle).
    let ccToastTimer = null;
    function ccToast(msg) {
        let el = document.getElementById('cc-toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'cc-toast';
            document.body.appendChild(el);
        }
        el.textContent = msg;
        // Reflow commits the opacity:0 state, then .show transitions it in —
        // rAF is NOT used: it never fires in background tabs, which would
        // leave the toast text set but invisible (found via CDP testing).
        void el.offsetWidth;
        el.classList.add('show');
        if (ccToastTimer) clearTimeout(ccToastTimer);
        ccToastTimer = setTimeout(() => el.classList.remove('show'), 1600);
    }

    // Copy + strong flash + toast on a field card (v1.34: label-aware,
    // animated green flash that fades back to the hover state).
    function flashCopy(fieldDiv, copyValue, label) {
        GM.setClipboard(copyValue);
        fieldDiv.classList.remove('cc-copy-flash');
        void fieldDiv.offsetWidth; // restart the animation on rapid clicks
        fieldDiv.classList.add('cc-copy-flash');
        setTimeout(() => fieldDiv.classList.remove('cc-copy-flash'), 900);
        const shown = String(copyValue).length > 60 ? String(copyValue).slice(0, 60) + '…' : String(copyValue);
        ccToast('✓ Copied ' + (label || 'value') + ': ' + shown);
    }

    // Copy by 1-based display position (keyboard trigger)
    function triggerCopy(position) {
        const item = copyItems[position - 1];
        if (!item) return;
        flashCopy(item.fieldDiv, item.copyValue, item.label);
    }

    function closeFloatWindow() {
        if (activeFloatWindow) {
            activeFloatWindow.remove();
            activeFloatWindow = null;
        }
        copyItems = [];
    }

    // ========================================
    // PAYLOAD NORMALIZERS (for Copy Everything → pharmacy portal injector)
    // ========================================

    // Normalize whatever Zoho returns for gender into the pharmacy radio value: f / m.
    // Returns '' when gender is absent or unrecognized — the payload then OMITS the key,
    // so the injector glows the gender area rather than wrongly selecting "Unknown".
    // (Admin usually just hasn't filled it in yet.)
    function normalizeGender(raw) {
        if (!raw) return '';
        const g = String(raw).trim().toLowerCase();
        if (g === 'f' || g === 'female') return 'f';
        if (g === 'm' || g === 'male') return 'm';
        return '';
    }

    // Render gender as a NON-clickable pill shown in the floating window header:
    // very light pink + "Female", very light blue + "Male", or a red
    // "Gender Missing" warning when the gender is absent/unrecognized.
    function getGenderBadgeHtml(rawGender) {
        const g = normalizeGender(rawGender);
        if (g === 'f') {
            return `<span style="
                display:inline-flex;align-items:center;gap:6px;
                background:#ffe4ec;color:var(--ds-danger,#c2185b);border:1px solid #f7b6c9;
                border-radius:999px;padding:2px 10px;font-size:11px;font-weight:700;
                line-height:1.4;user-select:none;">♀ Female</span>`;
        }
        if (g === 'm') {
            return `<span style="
                display:inline-flex;align-items:center;gap:6px;
                background:var(--ds-surface2,#e6f2ff);color:var(--ds-accent,#1565c0);border:1px solid var(--ds-border,#b3d1f2);
                border-radius:999px;padding:2px 10px;font-size:11px;font-weight:700;
                line-height:1.4;user-select:none;">♂ Male</span>`;
        }
        // Missing or unrecognized gender → red warning pill
        return `<span style="
            display:inline-flex;align-items:center;gap:6px;
            background:#fdecea;color:var(--ds-danger,#b3261e);border:1px solid #f5c6c2;
            border-radius:999px;padding:2px 10px;font-size:11px;font-weight:700;
            line-height:1.4;user-select:none;">⚠ Gender Missing</span>`;
    }

    // Strip any phone-ish string down to bare 10 digits (kills +1, parens, spaces, dashes).
    // Returns '' if it can't produce exactly 10 digits.
    function toBareDigits(raw) {
        if (!raw) return '';
        const digits = String(raw).replace(/\D/g, '').slice(-10);
        return digits.length === 10 ? digits : '';
    }

    // Split the display DOB string (M/D/YYYY produced by our own extractor) into unpadded ints.
    // Returns { m, d, y } or null if it can't parse three clean numbers.
    function parseDobComponents(dobStr) {
        if (!dobStr) return null;
        const parts = String(dobStr).trim().split('/');
        if (parts.length !== 3) return null;
        const m = parseInt(parts[0], 10);
        const d = parseInt(parts[1], 10);
        const y = parseInt(parts[2], 10);
        if (isNaN(m) || isNaN(d) || isNaN(y)) return null;
        if (m < 1 || m > 12 || d < 1 || d > 31 || y < 1900 || y > 2100) return null;
        return { m, d, y };
    }

    // Build the clean JSON payload the pharmacy portal injector expects.
    // Only includes keys that actually extracted. DOB omitted entirely if it won't parse cleanly.
    function buildPayload() {
        const src = extractMedicalData();
        const payload = {};

        if (src.firstName) payload.firstName = src.firstName;
        if (src.lastName)  payload.lastName  = src.lastName;

        const dob = parseDobComponents(src.dateOfBirth);
        if (dob) payload.dob = dob;

        // gender: only include when Zoho actually had one. Empty → key omitted →
        // injector glows the gender area for manual entry (never auto-picks Unknown).
        const gender = normalizeGender(src.gender);
        if (gender) payload.gender = gender;

        const phone = toBareDigits(src.phone);
        if (phone) payload.phone = phone;

        const cell = toBareDigits(src.mobile);
        if (cell) payload.cell = cell;

        if (src.email) payload.email = src.email;

        // Address: single clean line, commas stripped (matches the manual copy behavior)
        if (src.address) {
            payload.address = src.address.replace(/,/g, '').replace(/\s{2,}/g, ' ').trim();
        }
        if (src.city)    payload.city   = src.city.trim();
        if (src._stateFullName) payload.stateFullName = src._stateFullName.trim(); // RxFlow's state select wants full names

        if (src.state)   payload.state = src.state;
        if (src.zipCode) payload.zip   = src.zipCode;

        return payload;
    }

    // ========================================
    // EXTRACT MEDICAL DATA
    // ========================================
    function extractMedicalData() {
        const data = {};
        for (const [key, config] of Object.entries(MEDICAL_FIELDS)) {
            try {
                let el;
                if (['phone', 'mobile'].includes(key)) {
                    const labelMap = { phone: 'Phone number', mobile: 'Mobile Number' };
                    el = findFieldByLabel(labelMap[key], config.selector);
                } else if (config.filter) {
                    const elements = document.querySelectorAll(config.selector);
                    el = config.filter(elements);
                } else {
                    const elements = document.querySelectorAll(config.selector);
                    const idx = config.index || 0;
                    el = elements[idx];
                }

                if (el) {
                    const value = config.extract(el);
                    if (value) {
                        if (config.parse) {
                            Object.assign(data, config.parse(value));
                        } else {
                            data[key] = value;
                        }
                    }
                } else {
                    console.warn(`Element not found for medical field: ${key}`);
                }
            } catch (e) {
                console.error(`Error extracting medical ${key}:`, e);
            }
        }

        // Split fullName into firstName and lastName
        if (data.fullName) {
            const parts = data.fullName.trim().split(/\s+/);
            data.firstName = parts[0] || '';
            const lastNameParts = parts.slice(1);
            data.lastName = lastNameParts.join(' ') || '';
            // Two-word last name (e.g. "Juan Dela Cruz"): fold the first word
            // into the first name, keep only the second word as the last name.
            // Single-word and 3+ word last names stay unchanged.
            if (lastNameParts.length === 2) {
                data.firstName = (data.firstName + ' ' + lastNameParts[0]).trim();
                data.lastName = lastNameParts[1];
            }
        }

        return data;
    }

    // ========================================
    // EXTRACT COACHING DATA
    // ========================================
    function extractCoachingData() {
        const data = {};

        // Name - full, no split
        const nameEl = document.querySelectorAll('span.cxElemCompViewWrap')[0];
        if (nameEl) {
            const name = nameEl.textContent.trim();
            if (name) data.fullName = name;
        }

        const weighIn = getFieldValueByLabel('Weight In Day');
        if (weighIn) data.weighInDay = weighIn;

        const floaPhase = getFieldValueByLabel('FLOA Phase');
        if (floaPhase) data.floaPhase = floaPhase;

        const goalWeight = getFieldValueByLabel('Goal Weight');
        if (goalWeight) data.goalWeight = goalWeight;

        const tz = getTimezoneShort();
        if (tz) data.timezone = tz;

        return data;
    }

    // ========================================
    // FLOATING WINDOW (draggable, position-persistent)
    // ========================================
    async function createFloatingWindow(modeTitle) {
        const container = document.createElement('div');
        container.id = 'patient-data-float-window';
        container.style.cssText = `
            position: fixed; z-index: 999999;
            background: var(--ds-surface, white); border: 2px solid var(--ds-accent,#0066cc); border-radius: 8px;
            padding: 12px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            font-family: system-ui, -apple-system, sans-serif; font-size: 13px;
            min-width: 280px; max-width: 320px; max-height: 80vh; overflow: hidden;
        `;

        // Restore saved position or use default
        let savedPos = null;
        try { savedPos = await GM.getValue('floatWindowPosition', null); } catch(e) { console.warn('[CC]', e); }
        if (savedPos && savedPos.left && savedPos.top) {
            container.style.left = savedPos.left;
            container.style.top = savedPos.top;
        } else {
            container.style.top = '50px';
            container.style.right = '20px';
        }

        const header = document.createElement('div');
        header.style.cssText = `
            display: flex; justify-content: space-between; align-items: center;
            margin-bottom: 12px; border-bottom: 1px solid #ddd; padding-bottom: 8px;
            cursor: grab; user-select: none;
        `;
        header.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;min-width:0;">
                <strong style="color: var(--ds-accent,#0066cc);">${modeTitle}</strong>
                <span id="patient-data-gender-badge" style="display:none;"></span>
            </div>
            <button id="close-float-btn" style="
                background: none; border: none; font-size: 18px;
                cursor: pointer; color: #999; line-height: 1;">✕</button>
        `;

        // Keyboard hint strip
        const hint = document.createElement('div');
        hint.style.cssText = `
            font-size: 11px; color: #999; margin-bottom: 10px;
            user-select: none; line-height: 1.4;
        `;
        hint.innerHTML = `Press <b>1–9 / 0</b> to copy · <b>Esc</b> to close`;

        const content = document.createElement('div');
        content.id = 'patient-data-content';
        content.style.cssText = `
            display: flex; flex-direction: column; gap: 10px;
            max-height: calc(80vh - 84px); overflow-y: auto;
        `;

        container.appendChild(header);
        container.appendChild(hint);
        container.appendChild(content);
        document.body.appendChild(container);

        activeFloatWindow = container;

        document.getElementById('close-float-btn')?.addEventListener('click', () => closeFloatWindow());

        // ====== FLOAT WINDOW DRAG LOGIC ======
        let fwDragging = false;
        let fwMoved = false;
        let fwStartX = 0, fwStartY = 0;
        let fwOffsetX = 0, fwOffsetY = 0;
        const FW_DRAG_THRESHOLD = 5;

        header.addEventListener('mousedown', (e) => {
            if (e.target.id === 'close-float-btn') return;
            if (e.button !== 0) return;
            fwDragging = true;
            fwMoved = false;
            fwStartX = e.clientX;
            fwStartY = e.clientY;

            const rect = container.getBoundingClientRect();
            container.style.left = rect.left + 'px';
            container.style.top = rect.top + 'px';
            container.style.right = 'auto';
            container.style.bottom = 'auto';

            fwOffsetX = e.clientX - rect.left;
            fwOffsetY = e.clientY - rect.top;
            e.preventDefault();
        });

        document.addEventListener('mousemove', (e) => {
            if (!fwDragging) return;
            const dx = Math.abs(e.clientX - fwStartX);
            const dy = Math.abs(e.clientY - fwStartY);
            if (!fwMoved && (dx > FW_DRAG_THRESHOLD || dy > FW_DRAG_THRESHOLD)) {
                fwMoved = true;
                header.style.cursor = 'grabbing';
            }
            if (fwMoved) {
                const rect = container.getBoundingClientRect();
                let newLeft = Math.max(0, Math.min(e.clientX - fwOffsetX, window.innerWidth - rect.width));
                let newTop = Math.max(0, Math.min(e.clientY - fwOffsetY, window.innerHeight - rect.height));
                container.style.left = newLeft + 'px';
                container.style.top = newTop + 'px';
            }
        });

        document.addEventListener('mouseup', async () => {
            if (!fwDragging) return;
            fwDragging = false;
            header.style.cursor = 'grab';
            if (fwMoved) {
                try {
                    await GM.setValue('floatWindowPosition', {
                        left: container.style.left,
                        top: container.style.top
                    });
                } catch (err) {
                    console.warn('Could not save float window position:', err);
                }
            }
        });

        return container;
    }

    function populateFloatingWindow(data, displayOrder, labels) {
        const content = document.getElementById('patient-data-content');
        if (!content) return;
        content.innerHTML = '';
        copyItems = [];

        // Gender is deliberately NOT a clickable card — render it as a badge in
        // the window header (pink Female / blue Male / red Gender Missing) instead.
        // Only shown in the medical panel (gender is never part of coaching data).
        const badgeEl = document.getElementById('patient-data-gender-badge');
        if (badgeEl) {
            const isMedical = activeFloatWindow && activeFloatWindow.dataset.mode === 'medical';
            const badgeHtml = isMedical ? getGenderBadgeHtml(data.gender) : '';
            badgeEl.innerHTML = badgeHtml;
            badgeEl.style.display = badgeHtml ? 'inline-flex' : 'none';
        }

        for (const key of displayOrder) {
            const value = data[key];
            if (!value) continue;
            const labelText = labels[key] || key;

            // For state field: show full state name + pharmacy restriction warnings
            const isStateField = (key === 'state');
            let stateExtraHtml = '';
            if (isStateField) {
                if (data._stateFullName) {
                    stateExtraHtml += `<div style="color:#999;font-size:12px;margin-top:4px;">${data._stateFullName}</div>`;
                }
                stateExtraHtml += buildRestrictionHtml(value);
            }

            const displayValue = value + stateExtraHtml;
            const copyValue = (key === 'address') ? value.replace(/,/g, '').replace(/\s{2,}/g, ' ').trim() : value;

            const fieldDiv = document.createElement('div');
            fieldDiv.style.cssText = `
                padding: 12px; background: var(--ds-surface2,#f5f5f5); border-radius: 6px;
                cursor: pointer; transition: background 0.2s;
                border-left: 4px solid var(--ds-accent,#0066cc);
            `;
            fieldDiv.innerHTML = `
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;">
                    <span style="font-weight:700;color:var(--ds-info,#0066cc);font-size:12px;">${labelText}</span>
                </div>
                <div style="color:var(--ds-text,#1f1f1f);font-size:14px;font-weight:500;word-break:break-word;">${displayValue}</div>
            `;
            fieldDiv.addEventListener('mouseenter', () => fieldDiv.style.background = 'var(--ds-surface2,#e6f0ff)');
            fieldDiv.addEventListener('mouseleave', () => fieldDiv.style.background = 'var(--ds-surface2,#f5f5f5)');
            fieldDiv.addEventListener('click', (e) => {
                e.stopPropagation();
                flashCopy(fieldDiv, copyValue, labelText);
            });
            content.appendChild(fieldDiv);

            copyItems.push({ fieldDiv, copyValue, label: labelText });
        }
    }

    // ========================================
    // ACTIONS
    // ========================================
    async function showMedicalData() {
        if (activeFloatWindow && activeFloatWindow.dataset.mode === 'medical') {
            closeFloatWindow();
            return;
        }
        closeFloatWindow();
        const data = extractMedicalData();
        console.log('Extracted Medical Data:', data);
        const win = await createFloatingWindow('Medical Data');
        win.dataset.mode = 'medical';
        populateFloatingWindow(
            data,
            ['fullName', 'dateOfBirth', 'phone', 'mobile', 'email', 'address', 'city', 'state', 'zipCode'],
            {
                fullName: 'Full Name',
                dateOfBirth: 'Date of Birth',
                phone: 'Phone',
                mobile: 'Mobile',
                email: 'Email',
                address: 'Address',
                city: 'City',
                state: 'State',
                zipCode: 'ZIP Code'
            }
        );
    }

    async function showCoachingData() {
        if (activeFloatWindow && activeFloatWindow.dataset.mode === 'coaching') {
            closeFloatWindow();
            return;
        }
        closeFloatWindow();
        const data = extractCoachingData();
        console.log('Extracted Coaching Data:', data);
        const win = await createFloatingWindow('Coaching Data');
        win.dataset.mode = 'coaching';
        populateFloatingWindow(
            data,
            ['fullName', 'weighInDay', 'floaPhase', 'goalWeight', 'timezone'],
            {
                fullName: 'Full Name',
                weighInDay: 'Weigh-in Day',
                floaPhase: 'FLOA Phase',
                goalWeight: 'Goal Weight',
                timezone: 'Timezone'
            }
        );
    }

    // Copy Everything: build clean JSON payload → clipboard only — no panel.
    // (The medical data table no longer auto-opens on copy; open it via its
    // own button when needed. Brief on-button confirmation, muted to match
    // the seamless tab styling.)
    function copyEverything(btn) {
        const payload = buildPayload();
        const json = JSON.stringify(payload);
        console.log('Copy Everything payload:', payload);
        GM.setClipboard(json);

        // R18: also expose XML output via the Script API (for AI consumption)
        const api = window.__scripts['CC'];
        api.output = buildXmlOutput(payload);
        api.state = 'done';
        api.message = 'Extracted patient data';
        api.lastActivity = Date.now();

        // Muted confirmation: green text + faint green tint, no solid fill
        const originalText = btn.textContent;
        btn.textContent = '✓ Copied!';
        btn.style.color = 'var(--ds-success,#0a8754)';
        btn.style.background = 'rgba(10,135,84,0.10)';
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.color = 'var(--ds-accent,#6a1b9a)';
            btn.style.background = 'transparent';
        }, 900);
    }

    // R18: build XML from the payload object (for AI consumption)
    function buildXmlOutput(p) {
        const esc = (s) => String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
        const f = (tag, val) => val ? `  <${tag}>${esc(val)}</${tag}>\n` : '';
        let xml = '<patient>\n';
        xml += f('first_name', p.firstName);
        xml += f('last_name', p.lastName);
        if (p.dob) {
          xml += `  <dob>${p.dob.m}/${p.dob.d}/${p.dob.y}</dob>\n`;
        }
        // Human-readable gender for AI
        const gReadable = p.gender === 'f' ? 'Female' : p.gender === 'm' ? 'Male' : '';
        xml += f('gender', gReadable);
        xml += f('phone', p.phone);
        xml += f('mobile', p.cell);
        xml += f('email', p.email);
        xml += f('address', p.address);
        xml += f('city', p.city);
        xml += f('state', p.stateFullName);
        xml += f('state_abbr', p.state);
        xml += f('zip', p.zip);
        xml += '</patient>';
        return xml;
    }

    // ========================================
    // CREATE ORDER (pharmacy orchestrator)
    // One action: pick a pharmacy → clipboard JSON gains a `_lf` intent → open
    // that pharmacy's LifeFile login page. The portal-side scripts read the
    // clipboard and drive the rest (login → patient → order → product).
    // ========================================
    function showPharmacyChooser(payload, onPick, opts = {}) {
        const existing = document.getElementById('lf-pharmacy-chooser');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'lf-pharmacy-chooser';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 9999999;
            background: rgba(0,0,0,0.35);
            display: flex; align-items: center; justify-content: center;
            font-family: system-ui, -apple-system, sans-serif;
        `;

        const card = document.createElement('div');
        card.style.cssText = `
            background: var(--ds-surface, white); border-radius: 10px; padding: 18px 16px;
            box-shadow: 0 8px 28px rgba(0,0,0,0.25); max-width: 380px; width: 92%;
        `;

        const state = payload.state || '';
        const patientName = [payload.firstName, payload.lastName].filter(Boolean).join(' ');
        const title = opts.title || '🚀 Create Order';
        const subtitle = opts.subtitle || 'Pick the pharmacy portal to create this order in.';
        const accent = opts.accent || 'var(--ds-accent,#b3261e)';
        const showRestriction = opts.showRestriction !== false;

        card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <strong style="color:${accent};font-size:14px;">${title}</strong>
                <button id="lf-chooser-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#999;line-height:1;">✕</button>
            </div>
            <div style="color:#555;font-size:12px;margin-bottom:12px;line-height:1.5;">
                ${patientName ? `<b>${patientName}</b>${state && showRestriction ? ` · ${state}` : ''}` : 'No patient data extracted yet'}
                <br>${subtitle}
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;" id="lf-chooser-list"></div>
            <div style="margin-top:10px;color:#999;font-size:11px;">Esc to cancel</div>
        `;
        overlay.appendChild(card);
        document.body.appendChild(overlay);

        const list = card.querySelector('#lf-chooser-list');
        for (const pharm of PHARMACY_URL_MAP) {
            const restricted = isPharmacyRestricted(pharm.name, state);
            const btn = document.createElement('button');
            btn.style.cssText = `
                display:flex; justify-content:space-between; align-items:center;
                padding:10px 12px; border:1px solid var(--ds-border,#e0e0e0); border-radius:6px;
                background:var(--ds-surface2,#fafafa); cursor:pointer; font-family:inherit; text-align:left;
            `;
            btn.innerHTML = `
                <span style="font-weight:600;color:var(--ds-text,#1f1f1f);font-size:13px;">${pharm.name}
                    <span style="color:#999;font-weight:400;font-size:11px;"> (${pharm.host})</span>
                </span>
                ${showRestriction ? `<span style="font-size:11px;${restricted ? 'color:var(--ds-danger,#b3261e);font-weight:700;' : 'color:var(--ds-success,#0a8754);font-weight:600;'}white-space:nowrap;">${restricted ? '⚠ restricted' : '✓ ok'}</span>` : ''}
            `;
            btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--ds-surface2,#eef2f7)'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = 'var(--ds-surface2,#fafafa)'; });
            btn.addEventListener('click', () => { overlay.remove(); onPick(pharm); });
            list.appendChild(btn);
        }

        const close = () => overlay.remove();
        card.querySelector('#lf-chooser-close').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        const escHandler = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
        document.addEventListener('keydown', escHandler);
    }

    function runLifeFileSale(btn) {
        const payload = buildPayload();
        showPharmacyChooser(payload, (pharmacy) => {
            payload._lf = { pharmacy: pharmacy.key, name: pharmacy.name, portalUrl: pharmacy.url, loginUrl: pharmacy.url, step: 'session' };
            const json = JSON.stringify(payload);
            console.log('Create Order →', pharmacy.name, payload);
            GM.setClipboard(json);

            // Cross-origin intent carrier: Tampermonkey GM storage is PER-SCRIPT, so
            // the Zoho and portal scripts can't share it. Instead carry the intent in
            // the opened URL as a base64url query param (`lfSale`); the portal Session
            // Handler reads it on load and persists it to sessionStorage (same host).
            const b64 = btoa(encodeURIComponent(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            const sep = pharmacy.url.includes('?') ? '&' : '?';
            const target = pharmacy.url + sep + 'lfSale=' + b64;

            // Reuse the ONE LifeFile tab instead of spawning a new tab per sale: keep
            // a WindowProxy to the portal tab and navigate it to each new target. The
            // Session Handler auto-logs-out/logs-in + handles the session modal. Fall
            const how = openPortalTab(target);
            if (how === 'failed') { location.href = target; return; }

            const originalText = btn.textContent;
            btn.textContent = how === 'reused' ? '✓ Reused LifeFile tab' : '✓ Portal opened';
            btn.style.color = 'var(--ds-success,#0a8754)';
            btn.style.background = 'rgba(10,135,84,0.10)';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.color = 'var(--ds-danger,#b3261e)';
                btn.style.background = 'transparent';
            }, 2200);
        });
    }

    // ========================================
    // CREATE LAB PROFILE (LabX / RxFlow orchestrator)
    // Picks a lab portal and carries the extracted payload as a `labIntent`
    // base64url URL param to the portal's login page. The portal-side scripts
    // (LabX Lab Profile Autofill / RxFlow Lab Profile Autofill) auto-log
    // in (LabX) and fill the new-patient form.
    // ========================================
    const LAB_PORTALS = [
        { key: 'labx',      name: 'LabX', host: 'portal.labx.example.com',
          loginUrl: 'https://portal.labx.example.com/Account/Logon' },
        { key: 'rxflow', name: 'RxFlow',      host: 'staff.exampleclinic.com',
          loginUrl: 'https://staff.exampleclinic.com/dashboard' }
    ];

    function showLabChooser(payload, onPick) {
        const existing = document.getElementById('lf-lab-chooser');
        if (existing) existing.remove();

        const overlay = document.createElement('div');
        overlay.id = 'lf-lab-chooser';
        overlay.style.cssText = `
            position: fixed; inset: 0; z-index: 9999999;
            background: rgba(0,0,0,0.35);
            display: flex; align-items: center; justify-content: center;
            font-family: system-ui, -apple-system, sans-serif;
        `;

        const card = document.createElement('div');
        card.style.cssText = `
            background: var(--ds-surface, white); border-radius: 10px; padding: 18px 16px;
            box-shadow: 0 8px 28px rgba(0,0,0,0.25); max-width: 380px; width: 92%;
        `;

        const patientName = [payload.firstName, payload.lastName].filter(Boolean).join(' ');

        card.innerHTML = `
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
                <strong style="color:var(--ds-accent,#00796b);font-size:14px;">🧪 Create Lab Profile</strong>
                <button id="lf-lab-close" style="background:none;border:none;font-size:18px;cursor:pointer;color:#999;line-height:1;">✕</button>
            </div>
            <div style="color:#555;font-size:12px;margin-bottom:12px;line-height:1.5;">
                ${patientName ? `<b>${patientName}</b>` : 'No patient data extracted yet'}
                <br>Pick the lab portal to create this patient's profile in.
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;" id="lf-lab-list"></div>
            <div style="margin-top:10px;color:#999;font-size:11px;">Esc to cancel</div>
        `;
        overlay.appendChild(card);
        document.body.appendChild(overlay);

        const list = card.querySelector('#lf-lab-list');
        for (const lab of LAB_PORTALS) {
            const btn = document.createElement('button');
            btn.style.cssText = `
                display:flex; justify-content:space-between; align-items:center;
                padding:10px 12px; border:1px solid var(--ds-border,#e0e0e0); border-radius:6px;
                background:var(--ds-surface2,#fafafa); cursor:${lab.soon ? 'not-allowed' : 'pointer'};
                font-family:inherit; text-align:left; ${lab.soon ? 'opacity:0.55;' : ''}
            `;
            btn.innerHTML = `
                <span style="font-weight:600;color:var(--ds-text,#1f1f1f);font-size:13px;">${lab.name}
                    <span style="color:#999;font-weight:400;font-size:11px;"> (${lab.host})</span>
                </span>
                <span style="font-size:11px;color:${lab.soon ? 'var(--ds-muted,#999)' : 'var(--ds-success,#0a8754)'};font-weight:600;white-space:nowrap;">
                    ${lab.soon ? 'coming soon' : '✓ open'}
                </span>
            `;
            btn.addEventListener('mouseenter', () => { if (!lab.soon) btn.style.background = 'var(--ds-surface2,#eef2f7)'; });
            btn.addEventListener('mouseleave', () => { btn.style.background = 'var(--ds-surface2,#fafafa)'; });
            btn.addEventListener('click', () => { if (lab.soon) return; overlay.remove(); onPick(lab); });
            list.appendChild(btn);
        }

        const close = () => overlay.remove();
        card.querySelector('#lf-lab-close').addEventListener('click', close);
        overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
        const escHandler = (e) => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', escHandler); } };
        document.addEventListener('keydown', escHandler);
    }

    function runLabProfileSale(btn) {
        const payload = buildPayload();
        showLabChooser(payload, (lab) => {
            payload._lab = { vendor: lab.key, name: lab.name, portalUrl: lab.loginUrl, step: 'login' };
            const json = JSON.stringify(payload);
            console.log('Create Lab Profile →', lab.name, payload);
            GM.setClipboard(json);

            // Carry the intent as a base64url URL param; the portal-side script
            // reads it on the login page and persists to localStorage, so it
            // survives the login redirect + navigation to the New Patient page.
            const b64 = btoa(encodeURIComponent(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            const sep = lab.loginUrl.includes('?') ? '&' : '?';
            const target = lab.loginUrl + sep + 'labIntent=' + b64;

            const how = openPortalTab(target);
            if (how === 'failed') { location.href = target; return; }

            const originalText = btn.textContent;
            btn.textContent = how === 'reused' ? '✓ Reused portal tab' : '✓ Portal opened';
            btn.style.color = 'var(--ds-success,#0a8754)';
            btn.style.background = 'rgba(10,135,84,0.10)';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.color = 'var(--ds-accent,#00796b)';
                btn.style.background = 'transparent';
            }, 2200);
        });
    }

    // ========================================
    // GLOBAL HOTKEYS
    // ========================================
    function installGlobalHotkeys() {
        document.addEventListener('keydown', (e) => {
            // --- Open/toggle: Alt+M (medical), Alt+C (coaching) ---
            if (e.altKey && !e.ctrlKey && !e.metaKey) {
                const k = e.key.toLowerCase();
                if (k === 'm') { e.preventDefault(); showMedicalData(); return; }
                if (k === 'c') { e.preventDefault(); showCoachingData(); return; }
            }

            // Everything below requires an open window
            if (!activeFloatWindow) return;

            // --- Esc closes (works regardless of focus) ---
            if (e.key === 'Escape') {
                e.preventDefault();
                closeFloatWindow();
                return;
            }

            // --- Number copy: skip if typing in a field or any modifier held ---
            if (isTypingTarget(document.activeElement)) return;
            if (e.altKey || e.ctrlKey || e.metaKey) return;

            if (/^[0-9]$/.test(e.key)) {
                const position = (e.key === '0') ? 10 : parseInt(e.key, 10);
                if (position <= copyItems.length) {
                    e.preventDefault();
                    triggerCopy(position);
                }
            }
        });
    }

    // ========================================
    // TAB-BAR BUTTONS (inline with Overview/Timeline)
    // ========================================
    function injectTabBarButtons() {
        const tabHead = document.querySelector('lyte-tab-head[role="tablist"]');
        if (!tabHead) return;
        if (document.querySelector('#pde-tabbar-btns')) return; // already injected

        // Host the buttons as a sibling BEFORE the tab head (inside the tab-bar
        // container) so they stay leftmost without overlapping the absolutely
        // positioned active-tab indicator (lyteInnerActiveTab) that lives inside
        // the tab head.
        const container = tabHead.closest('#dv_lyte_content_tab') || tabHead.parentElement;
        if (!container) return;

        const wrap = document.createElement('span');
        wrap.id = 'pde-tabbar-btns';
        wrap.style.cssText = `
            display: inline-flex; align-items: center; gap: 4px;
            margin-right: 20px; vertical-align: middle;
        `;

        // Seamless base: transparent fill, muted text, faint colored accent.
        // Reads as part of the tab bar; the tint just hints "this is a tool."
        const baseBtnStyle = `
            padding: 6px 12px;
            background: transparent;
            border: none;
            border-radius: 4px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.15s, color 0.15s;
            white-space: nowrap;
            font-family: inherit;
            line-height: 1.4;
        `;

        // Each button: [element, accent text color, faint hover bg]
        const specs = [
            { id: 'extract-medical-btn',  action: 'medical',  label: '📋 Medical Data',    fg: 'var(--ds-accent,#0066cc)', hoverBg: 'rgba(0,102,204,0.08)' },
            { id: 'extract-coaching-btn', action: 'coaching', label: '🏋 Coaching Data',    fg: 'var(--ds-accent,#0a8754)', hoverBg: 'rgba(10,135,84,0.08)', hidden: true },
            { id: 'extract-copy-all-btn', action: 'copyall',  label: '📦 Copy Everything', fg: 'var(--ds-accent,#6a1b9a)', hoverBg: 'rgba(106,27,154,0.08)' },
            { id: 'extract-lifefile-btn', action: 'lifefile', label: '🚀 Create Order', fg: 'var(--ds-accent,#b3261e)', hoverBg: 'rgba(179,38,30,0.08)' },
            { id: 'extract-lab-btn',      action: 'lab',      label: '🧪 Create Lab Profile', fg: 'var(--ds-accent,#00796b)', hoverBg: 'rgba(0,121,107,0.08)' }
        ];

        const btns = {};
        for (const spec of specs) {
            const btn = document.createElement('button');
            btn.id = spec.id;
            btn.textContent = spec.label;
            btn.dataset.action = spec.action;
            btn.style.cssText = baseBtnStyle + `color: ${spec.fg};` + (spec.hidden ? 'display: none;' : '');
            btn.addEventListener('mouseenter', () => { btn.style.background = spec.hoverBg; });
            btn.addEventListener('mouseleave', () => { btn.style.background = 'transparent'; });
            wrap.appendChild(btn);
            btns[spec.action] = btn;
        }

        // Insert as the first child of the tab-bar container, before the tab head,
        // so buttons sit left of Overview/Timeline without colliding with the
        // active-tab indicator (lyteInnerActiveTab) inside the tab head.
        container.insertBefore(wrap, tabHead);

        btns.medical.addEventListener('click',  (e) => { e.stopPropagation(); showMedicalData(); });
        btns.coaching.addEventListener('click', (e) => { e.stopPropagation(); showCoachingData(); });
        btns.copyall.addEventListener('click',  (e) => { e.stopPropagation(); copyEverything(btns.copyall); });
        btns.lifefile.addEventListener('click', (e) => { e.stopPropagation(); runLifeFileSale(btns.lifefile); });
        btns.lab.addEventListener('click',      (e) => { e.stopPropagation(); runLabProfileSale(btns.lab); });
    }

    // Zoho re-renders the tab bar on navigation; re-inject when it disappears.
    function installTabBarObserver() {
        injectTabBarButtons();
        const observer = new MutationObserver(() => {
            if (!document.querySelector('#pde-tabbar-btns')) {
                injectTabBarButtons();
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ========================================
    // RXFLOW PATIENT-TAB EXTRACTOR (staff.exampleclinic.com)
    // Runs ONLY on RxFlow patient pages — selectors/URL map per
    // rxflow-patient-tabs-selectors.md (verified live 2026-08-20).
    // Extraction only: never auto-picks or submits anything (R7), and makes
    // zero writes to the site — the walk continuity lives in sessionStorage.
    // ========================================
    const PRX_TABS = [
        { path: 'patient-details',        name: 'Details',        listKey: '' },
        { path: 'patient-alergies',       name: 'Allergies',      listKey: 'allergies' },
        { path: 'patient-appointments',   name: 'Appointments',   listKey: 'appointments' },
        { path: 'patient-communication',  name: 'Communication',  listKey: 'communication' },
        { path: 'patient-documents',      name: 'Documents',      listKey: 'documents' },
        { path: 'patient-encounters',     name: 'Encounters',     listKey: 'encounters' },
        { path: 'patient-medications',    name: 'Medications',    listKey: 'medications' },
        { path: 'patient-notes',          name: 'Notes',          listKey: 'notes' },
        { path: 'patient-labs',           name: 'Labs',           listKey: 'labs' },
        { path: 'patient-prescriptions',  name: 'Prescriptions',  listKey: 'prescriptions' },
        { path: 'patient-questionnaries', name: 'Questionnaires', listKey: 'questionnaires' },
        { path: 'patient-sales',          name: 'Sales',          listKey: 'sales' }
    ];
    const PRX_ORDER = PRX_TABS.map(t => t.path);
    const PRX_TAB_NAME = Object.fromEntries(PRX_TABS.map(t => [t.path, t.name]));
    const PRX_LIST_KEY = Object.fromEntries(PRX_TABS.filter(t => t.listKey).map(t => [t.path, t.listKey]));
    const PRX_ID_RE = /patient-(?:details|alergies|appointments|communication|documents|encounters|medications|notes|labs|prescriptions|questionnaries|sales)\/(\d+)/;
    const PRX_WALK_KEY = 'cc-prx-walk';
    // Copy Patient Data on a non-details tab: navigate to patient-details and
    // resume the copy on boot (details has everything — Jeyson 2026-08-20).
    const PRX_COPY_KEY = 'cc-prx-copy-pending';

    // Identity label → payload key. Some labels pack two values ("DOB | Age"):
    // `split` picks the piece of a "|"-separated value when one is present.
    const PRX_IDENTITY_MAP = [
        { re: /^patient\s*name$/i,            key: 'patientName' },
        { re: /^patient\s*id$/i,              key: 'patientRef' },
        { re: /^dob/i,                        key: 'dob',  split: 0 },
        { re: /^age/i,                        key: 'age',  split: 1 },
        { re: /^status$/i,                    key: 'status' },
        { re: /^registered\s*date$/i,         key: 'registeredDate' },
        { re: /^state$/i,                     key: 'state' },
        { re: /^coach$/i,                     key: 'coach' },
        { re: /^gender\s*at\s*birth$/i,       key: 'genderAtBirth' },
        { re: /^gender\s*identity$/i,         key: 'genderIdentity' },
        { re: /^language$/i,                  key: 'language' },
        { re: /^phone\s*number$/i,            key: 'phone' },
        { re: /^email$/i,                     key: 'email' }
    ];
    // Detail section heading → payload key (Shipping Address is the PREFERRED address).
    const PRX_SECTION_MAP = [
        { re: /^shipping\s*address/i, key: 'shippingAddress' },
        { re: /^contact/i,            key: 'contactAddress' },
        { re: /^basic/i,              key: 'basicInfo' },
        { re: /^additional/i,         key: 'additionalDetails' },
        { re: /^emergency/i,          key: 'emergencyDetails' }
    ];

    function prxSleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function prxPatientId() {
        const m = location.pathname.match(PRX_ID_RE);
        return m ? m[1] : '';
    }
    function prxTabPath() {
        const m = location.pathname.match(/\/patient-([a-z]+)\//);
        return m ? 'patient-' + m[1] : '';
    }

    // R1: the site renders async and slowly — poll up to ~45s for the pane's
    // content (plus the identity header, which exists on every tab) before
    // extracting anything. Returns false on timeout / navigated away.
    // The identity name row renders as "-" BEFORE the real value (live-caught
    // 2026-08-20: panel title froze on "-") — never extract until it's real.
    async function prxWaitForContent(tab) {
        const isDetails = tab === 'patient-details';
        const deadline = Date.now() + 45000;
        while (Date.now() < deadline) {
            if (!/\/patient-[a-z]+\//.test(location.pathname)) return false;
            const hasIdentity = !!document.querySelector('.patient-header-detail .show_pat_content.pl-0');
            if (hasIdentity && prxIdentityNameReady()) {
                if (isDetails) {
                    const pane = document.getElementById('patient_details');
                    if (pane && pane.getClientRects().length > 0) return true;
                } else if (document.querySelector('.content-wrapper .grid-container') ||
                           document.querySelector('.content-wrapper .empty-results')) {
                    return true;
                }
            }
            await prxSleep(600);
        }
        return false;
    }

    // True once the Patient Name row's value is a real name, not the early
    // placeholder ("-", "--", "Non Reported", or empty).
    function prxIdentityNameReady() {
        const row = [...document.querySelectorAll('.patient-header-detail .show_pat_content.pl-0')]
            .find(r => /^patient\s*name/i.test((r.querySelector('span.title_color') || {}).textContent || ''));
        if (!row) return false;
        const name = Array.from(row.querySelectorAll('span'))
            .filter(s => !s.classList.contains('title_color'))
            .map(s => (s.textContent || '').replace(/\s+/g, ' ').trim())
            .filter(Boolean)
            .join(' ')
            .trim();
        return name.length > 0 && name !== '-' && name !== '--' && !/^non\s*reported$/i.test(name);
    }

    // Identity: label→value rows in the header card, plus the Height/BMI stats line.
    function prxExtractIdentity() {
        const identity = {};
        document.querySelectorAll('.patient-header-detail .show_pat_content.pl-0').forEach(row => {
            const labelEl = row.querySelector('span.title_color');
            if (!labelEl) return;
            const label = (labelEl.textContent || '').replace(/\s*:\s*$/, '').trim();
            if (!label) return;
            const value = Array.from(row.querySelectorAll('span'))
                .filter(s => s !== labelEl)
                .map(s => (s.textContent || '').replace(/\s+/g, ' ').trim())
                .filter(Boolean)
                .join(' ')
                .trim();
            if (value && !(label in identity)) identity[label] = value;
        });
        const header = document.querySelector('.patient-header-detail');
        if (header) {
            const lines = ((header.innerText || header.textContent) || '').split('\n')
                .map(l => l.replace(/\s+/g, ' ').trim())
                .filter(Boolean);
            const stats = lines.find(l => l.includes('Height') && l.includes('BMI'));
            if (stats) identity.headerStats = stats;
        }
        return identity;
    }

    // Details tab: sections + label/strong field rows inside #patient_details.
    function prxParseDetailRow(row) {
        const cols = row.querySelectorAll(':scope > div.col-md-6');
        if (cols.length < 2) return null;
        const label = (cols[0].textContent || '').replace(/\s+/g, ' ').trim();
        if (!label) return null;
        const strong = cols[1].querySelector('strong');
        const value = strong
            ? (strong.textContent || '').replace(/\s+/g, ' ').trim()
            : (cols[1].textContent || '').replace(/\s+/g, ' ').trim();
        if (!value) return null;
        return { label, value };
    }

    function prxExtractDetails() {
        const pane = document.getElementById('patient_details');
        if (!pane) return {};
        const sections = {};
        let currentTitle = '';
        for (const el of pane.querySelectorAll('h3.border-bottom.pb-2, div.row.pt-3')) {
            if (el.matches('h3.border-bottom.pb-2')) {
                currentTitle = (el.textContent || '').trim();
            } else if (currentTitle) {
                const parsed = prxParseDetailRow(el);
                if (parsed) {
                    sections[currentTitle] = sections[currentTitle] || {};
                    sections[currentTitle][parsed.label] = parsed.value;
                }
            }
        }
        const out = {};
        for (const [title, rows] of Object.entries(sections)) {
            for (const { re, key } of PRX_SECTION_MAP) {
                if (re.test(title)) { out[key] = rows; break; }
            }
        }
        return out;
    }

    // Shared list grid: header items ↔ :scope > .grid-item cells per record.
    // Skips the trailing Action cell; empty state → []. Lazy rows need scrolls.
    async function prxExtractList() {
        try {
            for (let i = 0; i < 3; i++) {
                window.scrollTo(0, document.body.scrollHeight);
                await prxSleep(900);
            }
        } catch (e) { console.warn('[CC-PRX] lazy scroll', e); }

        const grid = document.querySelector('.content-wrapper .grid-container');
        if (!grid) return [];
        if (grid.querySelector('.empty-results')) return [];

        const headers = Array.from(grid.querySelectorAll('.header.adjust-columns .header-item'))
            .map(el => (el.textContent || '').replace(/\s+/g, ' ').trim())
            .filter(h => h.length > 0);

        const records = [];
        for (const row of grid.querySelectorAll('.grid-content')) {
            const cells = Array.from(row.querySelectorAll(':scope > .grid-item'));
            let cellCount = cells.length;
            const last = cells[cells.length - 1];
            if (last) {
                const lastText = (last.textContent || '').replace(/\s+/g, ' ').trim();
                if (lastText === 'Action' || last.querySelector('.btn-group, .dropdown-toggle')) cellCount--;
            }
            const rec = {};
            for (let i = 0; i < headers.length && i < cellCount; i++) {
                const value = prxCellText(cells[i]);
                if (value) rec[headers[i]] = value;
            }
            if (Object.keys(rec).length) records.push(rec);
        }
        return records;
    }

    // Date cells stack two divs (date / time) — join with a space.
    function prxCellText(cell) {
        const kids = Array.from(cell.children).filter(el => el.nodeType === 1);
        if (kids.length >= 2) {
            const parts = kids
                .map(k => (k.textContent || '').replace(/\s+/g, ' ').trim())
                .filter(Boolean);
            if (parts.length === kids.length) return parts.join(' ');
        }
        return (cell.textContent || '').replace(/\s+/g, ' ').trim();
    }

    // Wait for the current tab's pane, then collect its content. The wait can
    // span navigation: if the user switches tabs/patients mid-wait, never
    // harvest the new page under the old tab's key — report it instead.
    async function prxCollectCurrentEntry() {
        const tab = prxTabPath();
        const pid = prxPatientId();
        const ready = await prxWaitForContent(tab);
        if (prxTabPath() !== tab || prxPatientId() !== pid) {
            return { tab, kind: 'error', error: 'navigated' };
        }
        if (!ready) {
            console.warn('[CC-PRX] timeout waiting for content on', tab);
            return { tab, kind: 'error', error: 'timeout' };
        }
        if (tab === 'patient-details') {
            return { tab, kind: 'details', data: prxExtractDetails() };
        }
        return { tab, kind: 'list', data: await prxExtractList() };
    }

    function prxMapIdentity(identity) {
        const out = {};
        for (const [label, raw] of Object.entries(identity)) {
            if (label === 'headerStats') continue;
            for (const { re, key, split } of PRX_IDENTITY_MAP) {
                if (!re.test(label)) continue;
                let v = String(raw).trim();
                if (split !== undefined && v.includes('|')) {
                    const parts = v.split('|').map(s => s.trim());
                    v = (parts[split] || '').trim();
                }
                if (v && !out[key]) out[key] = v;
                break;
            }
        }
        return out;
    }

    function prxSplitName(full) {
        if (!full) return null;
        const parts = String(full).replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
        if (!parts.length) return null;
        if (parts.length === 1) return { firstName: parts[0], middleName: '', lastName: '', nickname: '' };
        return {
            firstName: parts[0],
            middleName: parts.slice(1, -1).join(' '),
            lastName: parts[parts.length - 1],
            nickname: ''
        };
    }

    function prxNameFromBasicInfo(basicInfo) {
        if (!basicInfo) return null;
        const find = (re) => {
            for (const [k, v] of Object.entries(basicInfo)) {
                if (re.test(k)) return v;
            }
            return '';
        };
        const firstName = find(/^first\s*name$/i);
        const middleName = find(/^middle\s*name$/i);
        const lastName = find(/^last\s*name$/i);
        const nickname = find(/^nickname$/i);
        if (!firstName && !lastName && !nickname) return null;
        return { firstName, middleName, lastName, nickname };
    }

    // Shared payload core: identity + name + patientId. Only keys with data.
    function prxBasePayload(identity, sections) {
        const m = prxMapIdentity(identity);
        const payload = { source: 'rxflow' };
        const pid = prxPatientId();
        if (pid) payload.patientId = pid;
        if (m.patientRef) payload.patientRef = m.patientRef;
        const name = prxNameFromBasicInfo((sections || {}).basicInfo) || prxSplitName(m.patientName);
        if (name) payload.name = name;
        for (const k of ['dob', 'age', 'status', 'registeredDate', 'state', 'coach', 'genderAtBirth', 'genderIdentity', 'language', 'phone', 'email']) {
            if (m[k]) payload[k] = m[k];
        }
        if (identity.headerStats) payload.headerStats = identity.headerStats;
        return payload;
    }

    // ---------- LifeFile Patient Profile Autofill compat (2026-08-20) ----------
    // The LifeFile new-patient form reads FLAT keys from the clipboard JSON:
    // firstName, lastName, gender ('f'/'m'), phone, email, address, city,
    // state (ABBR — the select's option values), zip, dob {m,d,y}. Attach a
    // flat block under _lifeFileProfile so the SAME copied payload feeds the
    // portal's "💉 Fill Patient Form" / Alt+F with zero logic changes there
    // (it unwraps the block). Shipping address wins (Jeyson's rule). cell is
    // intentionally omitted — RxFlow has no separate mobile; it glows.
    const PRX_MONTHS = { january:1, february:2, march:3, april:4, may:5, june:6, july:7, august:8, september:9, october:10, november:11, december:12 };
    // "July 07, 1992" → { m: 7, d: 7, y: 1992 } (LifeFile DOB selects), else null.
    function prxParseDob(str) {
        if (!str) return null;
        const m = String(str).match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
        if (!m) return null;
        const month = PRX_MONTHS[m[1].toLowerCase()];
        const day = parseInt(m[2], 10);
        const year = parseInt(m[3], 10);
        if (!month || day < 1 || day > 31 || year < 1900 || year > 2100) return null;
        return { m: month, d: day, y: year };
    }
    function prxAttachLifeFileCompat(payload) {
        const ship = payload.shippingAddress || {};
        const contact = payload.contactAddress || {};
        const addr = Object.keys(ship).length ? ship : contact;
        const flat = {};
        const name = payload.name || {};
        if (name.firstName) flat.firstName = name.firstName;
        if (name.lastName) flat.lastName = name.lastName;
        const gender = normalizeGender(payload.genderAtBirth || payload.genderIdentity);
        if (gender) flat.gender = gender;
        if (payload.phone) flat.phone = payload.phone;
        if (payload.email) flat.email = payload.email;
        if (addr['Address line 1']) flat.address = addr['Address line 1'];
        if (addr['City']) flat.city = addr['City'];
        if (addr['State']) {
            const abbr = stateMap[String(addr['State']).trim().toLowerCase()];
            flat.state = abbr || addr['State']; // abbr preferred; raw falls through to a glow
        }
        if (addr['Postal Code']) flat.zip = addr['Postal Code'];
        const dob = prxParseDob(payload.dob);
        if (dob) flat.dob = dob;
        if (Object.keys(flat).length) payload._lifeFileProfile = flat;
    }

    // FLAT Zoho-style payload for Copy Patient Data (Jeyson 2026-08-20): SAME
    // keys as the Zoho branch's buildPayload() — firstName, lastName,
    // dob {m,d,y}, gender ('f'/'m'), phone (bare 10), cell, email, address,
    // city, stateFullName (full name), state (ABBR), zip — so downstream
    // consumers (Pharmacy J PDF filler, LifeFile portal autofill) treat
    // RxFlow and Zoho payloads identically. cell mirrors phone
    // (RxFlow has no separate mobile — the contact number IS the mobile;
    // matches the Zoho shape where phone and cell are the same number).
    // No source / patientId / nested sections / _meta — that stays with the
    // walk (Collect All Tabs). Allergies/meds mapping: FUTURE build.
    function prxBuildFlatPayload(payload) {
        const lf = payload._lifeFileProfile || {};
        const flat = {};
        if (lf.firstName) flat.firstName = lf.firstName;
        if (lf.lastName) flat.lastName = lf.lastName;
        if (lf.dob) flat.dob = lf.dob;
        if (lf.gender) flat.gender = lf.gender;
        if (lf.phone) {
            flat.phone = lf.phone;
            flat.cell = lf.phone;
        }
        if (lf.email) flat.email = lf.email;
        if (lf.address) flat.address = lf.address;
        if (lf.city) flat.city = lf.city;
        if (payload.state) flat.stateFullName = payload.state; // identity row, e.g. "California"
        if (lf.state) flat.state = lf.state;                   // abbr, e.g. "CA"
        if (lf.zip) flat.zip = lf.zip;
        return flat;
    }

    // Phone: always try to produce a bare 10-digit number (Jeyson 2026-08-20).
    // Fallback chain: header "Phone Number" → details "Mobile"/"Phone" → omit
    // (LifeFile then glows the field rather than filling garbage).
    function prxNormalizePhone(payload) {
        if (!payload.phone && payload.contactAddress) {
            payload.phone = payload.contactAddress['Mobile'] || payload.contactAddress['Phone'] || '';
        }
        const bare = toBareDigits(payload.phone);
        if (bare) payload.phone = bare;
        else delete payload.phone;
    }

    // Copy a finished payload to the clipboard with the standard toast.
    // COMPACT single-line JSON — identical to the Zoho branch's Copy Everything
    // (JSON.stringify without indent). One line = a small paste that never
    // scrambles in any terminal; multiline pastes were the paste-race trigger
    // (Jeyson 2026-08-20: "All these line breaks!").
    function prxCopyPayload(payload) {
        const json = JSON.stringify(payload);
        try { GM.setClipboard(json); } catch (e) { console.warn('[CC-PRX] clipboard', e); ccToast('✗ clipboard blocked'); return; }
        const bytes = new Blob([json]).size;
        ccToast('✓ Copied ' + bytes + ' bytes · ' + prxFieldCount(payload) + ' fields');
        console.log('[CC-PRX] payload', payload);
    }

    async function prxBuildSinglePayload() {
        const tab = prxTabPath();
        if (tab !== 'patient-details') {
            // The details tab has everything (identity + all sections + shipping
            // address) — auto-navigate there and resume the copy on boot
            // (Jeyson 2026-08-20).
            const pid = prxPatientId();
            if (!pid) { ccToast('✗ No patient id'); return null; }
            try { sessionStorage.setItem(PRX_COPY_KEY, '1'); } catch (e) {}
            ccToast('→ Opening Patient Details…');
            location.href = '/patient-details/' + pid;
            return null;
        }
        const entry = await prxCollectCurrentEntry();
        if (entry.kind === 'error' && entry.error === 'navigated') {
            ccToast('✗ Page changed during extraction — try again');
            return null;
        }
        const identity = prxExtractIdentity();
        const sections = entry.kind === 'details' ? entry.data : null;
        const payload = prxBasePayload(identity, sections);
        if (sections) {
            Object.assign(payload, sections);
        } else {
            const key = PRX_LIST_KEY[tab];
            if (key) payload[key] = entry.kind === 'list' ? entry.data : { error: entry.error };
        }
        prxNormalizePhone(payload);
        prxAttachLifeFileCompat(payload);
        // FLAT output — the nested payload above is only the intermediate.
        // Copy Patient Data ships the compact Zoho-shaped flat JSON (no source
        // tag, no sections, no _meta) so both sources flow through the same
        // downstream pipeline. Collect All Tabs keeps the full nested payload.
        return prxBuildFlatPayload(payload);
    }

    function prxFieldCount(payload) {
        let n = 0;
        for (const [k, v] of Object.entries(payload)) {
            if (k === '_meta') continue;
            if (Array.isArray(v)) n += v.length;
            else if (v && typeof v === 'object') n += Object.keys(v).length;
            else if (v !== '' && v != null) n += 1;
        }
        return n;
    }

    // ---------------- walk state (sessionStorage; survives re-boot per R9) ----------------
    function prxReadWalk() {
        try {
            const raw = sessionStorage.getItem(PRX_WALK_KEY);
            if (!raw) return null;
            const w = JSON.parse(raw);
            if (!w || !Array.isArray(w.order) || !w.order.length || typeof w.collected !== 'object') return null;
            return w;
        } catch (e) { console.warn('[CC-PRX] read walk', e); return null; }
    }
    function prxSaveWalk(w) {
        try { sessionStorage.setItem(PRX_WALK_KEY, JSON.stringify(w)); }
        catch (e) { console.warn('[CC-PRX] save walk', e); }
    }
    function prxClearWalk() {
        try { sessionStorage.removeItem(PRX_WALK_KEY); }
        catch (e) { console.warn('[CC-PRX] clear walk', e); }
    }
    function prxNewWalk() {
        return { order: PRX_ORDER.slice(), idx: 0, collected: {}, startedAt: Date.now() };
    }
    function prxNextUncollected(walk) {
        for (const p of walk.order) {
            if (!walk.collected[p]) return p;
        }
        return null;
    }

    function prxWalkSummary(walk) {
        const lines = [];
        for (const p of walk.order) {
            const e = walk.collected[p];
            const label = PRX_TAB_NAME[p] || p;
            if (!e) lines.push(label + ': pending');
            else if (e.kind === 'error') lines.push(label + ': ' + e.error);
            else if (e.kind === 'details') lines.push(label + ': details');
            else lines.push(label + ': ' + (e.data || []).length);
        }
        return lines.join(' · ');
    }
    function prxShowWalkBanner(walk) {
        const banner = document.getElementById('cc-prx-walk-banner');
        if (!banner) return;
        banner.style.display = 'inline-block';
        banner.textContent = 'Walk in progress: tab ' + Math.min(walk.idx + 1, walk.order.length) + '/' + walk.order.length;
    }
    function prxSetStatus(text) {
        const el = document.getElementById('cc-prx-status');
        if (!el) return;
        el.textContent = text || '';
        el.style.display = text ? 'inline-block' : 'none';
    }

    // The walk button DOUBLES as the stop button while a walk is active
    // (Jeyson 2026-08-20 — accidental walk start, wanted one-click halt).
    function prxRenderWalkButton() {
        const btn = document.getElementById('cc-prx-walk');
        if (!btn) return;
        const active = !!prxReadWalk();
        btn.textContent = active ? '⏹ Stop Walk' : '🧲 Collect All Tabs';
        btn.title = active ? 'Stop the walk now (partial summary stays in the panel)' : 'Collect all 12 tabs (~2 min)';
        btn.style.color = active ? 'var(--ds-danger,#b3402e)' : 'var(--ds-accent,#8a5f2e)';
        btn.style.borderColor = active ? 'var(--ds-danger,#b3402e)' : 'var(--ds-border,#e8e2d8)';
    }

    // Stop: clear the walk flag, hide the banner, keep the partial per-tab
    // summary visible, and ensure no pending navigation fires.
    function prxStopWalk() {
        const walk = prxReadWalk();
        prxClearWalk();
        prxRenderWalkButton();
        const banner = document.getElementById('cc-prx-walk-banner');
        if (banner) banner.style.display = 'none';
        const n = walk ? Object.keys(walk.collected).length : 0;
        ccToast('⏹ Walk stopped — ' + n + '/' + (walk ? walk.order.length : 12) + ' collected');
        if (walk) prxSetStatus(prxWalkSummary(walk));
    }

    // Extract the current tab, save it, then navigate to the next uncollected
    // tab — or finalize once all 12 are in. Extraction only; no site writes.
    let prxWalkBusy = false; // one advance at a time (boot continuation vs button)
    async function prxAdvanceWalk() {
        if (prxWalkBusy) return;
        prxWalkBusy = true;
        try {
            const walk = prxReadWalk();
            if (!walk) return;
            const tab = prxTabPath();
            const pid = prxPatientId();
            let entry;
            try {
                entry = await prxCollectCurrentEntry();
            } catch (e) {
                console.error('[CC-PRX] collect failed on', tab, e);
                entry = { tab, kind: 'error', error: 'exception' };
            }
            // The wait spans navigation — if the user moved on, abort the walk
            // instead of harvesting a different page or yanking them back.
            if (prxTabPath() !== tab || prxPatientId() !== pid || entry.error === 'navigated') {
                prxClearWalk();
                ccToast('walk aborted (manual navigation)');
                return;
            }
            // Stop may have been clicked during the wait — the flag is gone.
            // Bail WITHOUT saving: re-saving this stale snapshot would resurrect
            // the cleared flag and the walk would keep navigating (live-caught
            // 2026-08-20 in the v1.38 stop-button test).
            if (!prxReadWalk()) return;
            walk.collected[tab] = entry;
            prxSaveWalk(walk);
            prxSetStatus(prxWalkSummary(walk));

            const next = prxNextUncollected(walk);
            if (!next) { prxFinalizeWalk(walk); return; }
            if (!pid) { prxClearWalk(); prxRenderWalkButton(); ccToast('✗ walk aborted (no patient id)'); return; }
            walk.idx = walk.order.indexOf(next);
            prxSaveWalk(walk);
            ccToast('✓ Collected ' + (PRX_TAB_NAME[tab] || tab) + ' · next: ' + (PRX_TAB_NAME[next] || next));
            setTimeout(() => {
                // Stop may have been clicked during the collect wait — never
                // navigate after a stop (the flag is gone).
                const w = prxReadWalk();
                if (!w || w.order[w.idx] !== next) return;
                location.href = '/' + next + '/' + pid;
            }, 350);
        } finally {
            prxWalkBusy = false;
        }
    }

    // Boot continuation: verify we're still on the expected tab, else abort.
    async function prxContinueWalk() {
        const walk = prxReadWalk();
        if (!walk) return;
        const tab = prxTabPath();
        if (walk.order[walk.idx] !== tab) {
            prxClearWalk();
            prxRenderWalkButton();
            ccToast('walk aborted (manual navigation)');
            prxSetStatus(prxWalkSummary(walk)); // keep the partial summary in the panel
            return;
        }
        prxShowWalkBanner(walk);
        await prxAdvanceWalk();
    }

    // Click handler: start/resume the walk, or STOP it if one is running.
    async function prxStartOrResumeWalk() {
        const tab = prxTabPath();
        const orderIdx = PRX_ORDER.indexOf(tab);
        if (orderIdx === -1) { ccToast('✗ Not a patient tab'); return; }

        const walk = prxReadWalk() || prxNewWalk();
        walk.idx = orderIdx; // we are here now
        prxSaveWalk(walk);
        prxRenderWalkButton(); // → "⏹ Stop Walk"
        prxShowWalkBanner(walk);
        await prxAdvanceWalk();
    }

    function prxFinalizeWalk(walk) {
        prxClearWalk();
        prxRenderWalkButton(); // back to "🧲 Collect All Tabs"
        const identity = prxExtractIdentity();
        const detailsEntry = walk.collected['patient-details'];
        const basicInfo = (detailsEntry && detailsEntry.kind === 'details' && detailsEntry.data) ? detailsEntry.data.basicInfo : null;
        const payload = prxBasePayload(identity, basicInfo ? { basicInfo } : null);
        for (const p of walk.order) {
            const e = walk.collected[p];
            if (!e) continue;
            const key = PRX_LIST_KEY[p];
            if (e.kind === 'details') {
                if (e.data) Object.assign(payload, e.data);
            } else if (e.kind === 'list') {
                if (key) payload[key] = e.data || [];
            } else if (e.kind === 'error') {
                if (key) payload[key] = { error: e.error };
            }
        }
        prxNormalizePhone(payload);
        prxAttachLifeFileCompat(payload);
        payload._meta = {
            source: 'rxflow',
            collectedFrom: location.pathname,
            allTabs: true,
            tabs: walk.order.map(p => {
                const e = walk.collected[p];
                let records = 'skipped';
                if (e) {
                    if (e.kind === 'details') records = 'details';
                    else if (e.kind === 'error') records = e.error;
                    else records = (e.data || []).length;
                }
                return { path: p, name: PRX_TAB_NAME[p] || p, records };
            }),
            collectedAt: new Date().toISOString()
        };
        const json = JSON.stringify(payload, null, 2);
        try { GM.setClipboard(json); } catch (e) { console.warn('[CC-PRX] clipboard', e); ccToast('✗ clipboard blocked'); }
        const bytes = new Blob([json]).size;
        const errs = walk.order.filter(p => walk.collected[p] && walk.collected[p].kind === 'error').length;
        const ok = walk.order.length - errs;
        ccToast('✓ ' + ok + '/' + walk.order.length + ' tabs collected' + (errs ? ' (' + errs + ' error)' : '') + ' — ' + bytes + ' bytes');
        prxSetStatus(prxWalkSummary(walk));
        console.log('[CC-PRX] walk payload', payload);
    }

    // Fixed float panel (cc-prx-* ids, warm-paper --ds tokens) on every patient tab.
    function prxCreatePanel(tabName) {
        const existing = document.getElementById('cc-prx-panel');
        if (existing) existing.remove();
        if (!document.body) return null;

        // Inline button group — attached right after the "Patient Info" label
        // in the patient header card (Jeyson 2026-08-20: no floating panels,
        // sleek + part of the site's ecosystem). No title bar: the patient
        // name is already right there in the header.
        const panel = document.createElement('span');
        panel.id = 'cc-prx-panel';
        panel.style.cssText = `
            display: inline-flex; align-items: center; gap: 6px;
            margin-left: 10px; vertical-align: middle;
            font-family: system-ui, -apple-system, sans-serif;
        `;
        const btnBase = `
            padding: 3px 10px; border: 1px solid var(--ds-border, #e8e2d8);
            border-radius: 6px; background: var(--ds-surface2, #f4f0e9);
            color: var(--ds-text, #2b2620); font: 600 12px system-ui, sans-serif;
            cursor: pointer; white-space: nowrap;
        `;
        panel.innerHTML = `
            <button id="cc-prx-copy" type="button" style="${btnBase}">📋 Copy Patient Data</button>
            <button id="cc-prx-walk" type="button" style="${btnBase}color: var(--ds-accent, #8a5f2e);">🧲 Collect All Tabs</button>
            <span id="cc-prx-walk-banner" style="display:none;padding:2px 8px;border-radius:999px;background:#fff4e0;color:var(--ds-warn,#a16207);font-size:11px;font-weight:600;white-space:nowrap;"></span>
            <span id="cc-prx-status" style="display:none;color:var(--ds-muted,#7a7163);font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:440px;vertical-align:middle;"></span>
        `;

        // Attach right after the "Patient Info" label in the header card.
        const infoSpan = document.querySelector('.patient-header-detail .card-header span.info-header');
        const host = infoSpan ? infoSpan.parentElement : null;
        if (host && host !== document.body) {
            host.appendChild(panel);
        } else {
            // Fallback: right side of the "Patients" header row, else float.
            const heading = [...document.querySelectorAll('.content-wrapper h1, .content-wrapper h2, .content-wrapper h3')]
                .find(h => /^Patients/.test((h.textContent || '').trim()));
            const row = heading ? (heading.closest('.row') || heading.parentElement) : null;
            if (row && row !== document.body) {
                panel.style.marginLeft = 'auto';
                panel.style.alignSelf = 'center';
                row.appendChild(panel);
            } else {
                panel.style.position = 'fixed';
                panel.style.top = '70px';
                panel.style.right = '16px';
                panel.style.zIndex = '999999';
                document.body.appendChild(panel);
            }
        }

        const copyBtn = document.getElementById('cc-prx-copy');
        copyBtn.addEventListener('mouseenter', () => { copyBtn.style.background = '#e9e2d4'; });
        copyBtn.addEventListener('mouseleave', () => { copyBtn.style.background = 'var(--ds-surface2,#f4f0e9)'; });
        copyBtn.addEventListener('click', async () => {
            copyBtn.disabled = true;
            try {
                const payload = await prxBuildSinglePayload();
                if (!payload) return; // navigating to patient-details — resumes on boot
                prxCopyPayload(payload);
            } catch (e) {
                console.error('[CC-PRX] copy failed', e);
                ccToast('✗ Copy failed — see console');
            } finally {
                copyBtn.disabled = false;
            }
        });

        const walkBtn = document.getElementById('cc-prx-walk');
        walkBtn.addEventListener('mouseenter', () => { walkBtn.style.background = '#e9e2d4'; });
        walkBtn.addEventListener('mouseleave', () => { walkBtn.style.background = 'var(--ds-surface2,#f4f0e9)'; });
        walkBtn.addEventListener('click', async () => {
            walkBtn.disabled = true;
            try {
                if (prxReadWalk()) {
                    prxStopWalk(); // active walk → one-click halt
                } else {
                    await prxStartOrResumeWalk();
                }
            } catch (e) {
                console.error('[CC-PRX] walk failed', e);
                ccToast('✗ Walk failed — see console');
            } finally {
                walkBtn.disabled = false;
            }
        });
        prxRenderWalkButton(); // initial state: Stop if a walk is active

        return panel;
    }

    // The patient header card (with the "Patient Info" label) renders ASYNC —
    // the panel may have landed in a fallback spot (Patients row / float) at
    // DOMContentLoaded. Re-anchor it inline after "Patient Info" once the
    // header card is actually in the DOM.
    async function prxReanchorPanel() {
        for (let i = 0; i < 24; i++) { // up to ~12s — the site is slow
            const infoSpan = document.querySelector('.patient-header-detail .card-header span.info-header');
            const panel = document.getElementById('cc-prx-panel');
            if (infoSpan && panel && infoSpan.parentElement && panel.parentElement !== infoSpan.parentElement) {
                panel.style.position = '';
                panel.style.top = '';
                panel.style.right = '';
                panel.style.zIndex = '';
                panel.style.marginLeft = '';
                panel.style.alignSelf = '';
                infoSpan.parentElement.appendChild(panel);
                return;
            }
            if (infoSpan || !panel) return;
            await prxSleep(500);
        }
    }

    // Copy Patient Data on a non-details tab set PRX_COPY_KEY and navigated
    // here — finish the job: extract the details payload and copy the flat JSON.
    async function prxResumeCopy() {
        let flag = false;
        try { flag = sessionStorage.getItem(PRX_COPY_KEY) === '1'; } catch (e) {}
        if (!flag) return;
        try { sessionStorage.removeItem(PRX_COPY_KEY); } catch (e) {}
        if (prxTabPath() !== 'patient-details') return; // manual navigation broke the flow
        const payload = await prxBuildSinglePayload();
        if (payload) prxCopyPayload(payload);
    }

    // RxFlow entry point: panel + walk continuation + title warm-up.
    async function initRxFlow() {
        const tab = prxTabPath();
        if (!tab) return;
        const panel = prxCreatePanel(PRX_TAB_NAME[tab] || tab);
        if (!panel) return;

        prxReanchorPanel().catch(e => console.warn('[CC-PRX] reanchor', e));
        prxResumeCopy().catch(e => console.error('[CC-PRX] copy resume failed', e));

        const walk = prxReadWalk();
        if (walk) {
            if (walk.order[walk.idx] !== tab) {
                prxClearWalk();
                ccToast('walk aborted (manual navigation)');
                prxSetStatus(prxWalkSummary(walk)); // partial kept in the panel
            } else {
                prxShowWalkBanner(walk);
                prxContinueWalk().catch(e => console.error('[CC-PRX] walk continue failed', e));
            }
        }
    }

    // ========================================
    // INIT
    // ========================================
    // RxFlow patient pages run their own extraction module and skip ALL
    // Zoho init (tab-bar buttons, global hotkeys, LifeFile/lab orchestration).
    if (location.hostname === 'staff.exampleclinic.com') {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => initRxFlow());
        } else {
            initRxFlow();
        }
    } else if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            installTabBarObserver();
            installGlobalHotkeys();
        });
    } else {
        installTabBarObserver();
        installGlobalHotkeys();
    }

    // R18: trigger dispatcher
    const api = window.__scripts['CC'];
    api.trigger = function (action) {
      if (action === 'extract') {
        // Build payload + XML directly (no DOM button required)
        const payload = buildPayload();
        const keyFields = Object.keys(payload).filter(k => payload[k] !== undefined && payload[k] !== '' && k !== 'dob');
        if (keyFields.length === 0 && !payload.dob) {
          api.state = 'error';
          api.error = 'No extractable fields found (is the patient record loaded?)';
          api.lastActivity = Date.now();
          return { ok: false, error: api.error };
        }
        const xml = buildXmlOutput(payload);
        api.output = xml;
        api.state = 'done';
        api.message = `Extracted ${keyFields.length} field(s)` + (payload.dob ? ' + DOB' : '');
        api.lastActivity = Date.now();
        // Also copy JSON to clipboard (preserves the manual behavior)
        try { GM.setClipboard(JSON.stringify(payload)); } catch(e) {}
        console.log('[CC] API extract:', xml);
        return { ok: true, output: xml };
      }
      if (action === 'stop') {
        api.state = 'idle';
        api.message = 'Stopped';
        api.lastActivity = Date.now();
        return { ok: true };
      }
      return { ok: false, error: `unknown action: ${action}` };
    };
})();