// ==UserScript==
// @name         CC Custom Build - Zoho CRM Patient Data Extractor
// @namespace    http://tampermonkey.net/
// @version      1.33
// @description  Extract patient data from Zoho CRM: Copy Everything JSON payload + Create Order
// @author       Jeyson Dagondon
// @run-at       document-idle
// @match        https://crm.zoho.com/crm/*/tab/Contacts/*
// @grant        GM.setClipboard
// @grant        GM.getValue
// @grant        GM.setValue
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[CC v1.33] boot');
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}';
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
        AL: ['Pharmacy D', 'Formulation', 'Apex/Pharmacy B', 'Pharmacy C', 'Pharmacy H', 'Pharmacy E'],
        AK: ['Pharmacy D', 'Pharmacy I', 'Apex/Pharmacy B', 'Pharmacy H'],
        AR: ['Formulation', 'Pharmacy I', 'Apex/Pharmacy B', 'Pharmacy E'],
        CA: ['Pharmacy D', 'Formulation', 'Pharmacy I', 'Apex/Pharmacy B', 'Pharmacy C', 'Pharmacy H', 'Pharmacy E'],
        CT: ['Pharmacy D', 'Pharmacy H'],
        DC: ['Pharmacy C'],
        HI: ['Pharmacy I', 'Apex/Pharmacy B'],
        IN: ['Pharmacy D'],
        IA: ['Apex/Pharmacy B'],
        KY: ['Formulation'],
        LA: ['Pharmacy D', 'Apex/Pharmacy B', 'Pharmacy C', 'Pharmacy E'],
        ME: ['Pharmacy I'],
        MA: ['Pharmacy H', 'Pharmacy E', 'Pharmacy C (MOTS-c specific)'],
        MI: ['Pharmacy D', 'Formulation', 'Pharmacy C'],
        MS: ['Pharmacy D', 'Apex/Pharmacy B', 'Pharmacy C', 'Pharmacy E'],
        MT: ['Pharmacy D', 'Pharmacy C'],
        NE: ['Formulation', 'Apex/Pharmacy B'],
        NV: ['Pharmacy D', 'Formulation', 'Pharmacy E'],
        NH: ['Pharmacy H'],
        NC: ['Apex/Pharmacy B', 'Pharmacy H'],
        ND: ['Pharmacy A'],
        OH: ['Pharmacy D', 'Apex/Pharmacy B', 'Pharmacy C'],
        OR: ['Formulation', 'Pharmacy E', 'Progress (for Thymosin Alpha-1)'],
        RI: ['Pharmacy H'],
        SC: ['Pharmacy D', 'Apex/Pharmacy B', 'Pharmacy E'],
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
        { key: 'pharmacya',    name: 'Pharmacy A',              host: 'hostB',      url: 'https://hostB.lifefile.net/application_main_zfw/login/login/vendor_name/vendorA/frm/stdlogin/access/doctor' },
        { key: 'progress',   name: 'Progress (Apex/Pharmacy B)', host: 'hostC:8443', url: 'https://hostC.lifefile.net:8443/application_main_zfw/login/login/vendor_name/vendorB/frm/stdlogin/access/doctor' },
        { key: 'pharmacyc',  name: 'Pharmacy C',           host: 'hostA',      url: 'https://hostA.lifefile.net/application_main_zfw/login/login/vendor_name/vendorC/access/doctor' },
        { key: 'pharmacyd',  name: 'Pharmacy D',            host: 'hostA',      url: 'https://hostA.lifefile.net/application_main_zfw/login/login/vendor_name/pharmacyd/frm/stdlogin/access/doctor' },
        { key: 'pharmacye', name: 'Pharmacy E',        host: 'hostB',      url: 'https://hostB.lifefile.net/application_main_zfw/login/login/access/doctor/vendor_name/vendorE/logout/1' },
        { key: 'pharmacyf',   name: 'Pharmacy F',            host: 'hostD',      url: 'https://hostD.lifefile.net/application_main_zfw/login/login/vendor_name/vendorF/access/doctor' },
        { key: 'pharmacyg',   name: 'Pharmacy G (LDN)',      host: 'hostD',      url: 'https://hostD.lifefile.net/application_main_zfw/login/login/vendor_name/vendorG/access/doctor' }
    ];

    // A WindowProxy to the single LifeFile tab we drive. Survives Zoho SPA
    // navigation (this closure persists until Zoho is fully reloaded).
    let portalWin = null;
    // Navigate the existing portal tab to `url`, or open a new one. Returns
    // 'reused' | 'opened' | 'failed' so the UI can show what actually happened.
    // Cross-origin navigation via the WindowProxy is allowed, so this reuses the
    // tab for ANY pharmacy — unlike Chrome's named-window lookup, which is
    // origin-scoped and can't see *.lifefile.net tabs from crm.zoho.com.
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
    // Substring match so 'Progress (Apex/Pharmacy B)' hits 'Apex/Pharmacy B' etc.
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

    // Copy + green flash on a field card
    function flashCopy(fieldDiv, copyValue) {
        GM.setClipboard(copyValue);
        fieldDiv.style.background = '#d4edda';
        setTimeout(() => { fieldDiv.style.background = 'var(--ds-surface2,#f5f5f5)'; }, 300);
    }

    // Copy by 1-based display position (keyboard trigger)
    function triggerCopy(position) {
        const item = copyItems[position - 1];
        if (!item) return;
        flashCopy(item.fieldDiv, item.copyValue);
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
            data.lastName = parts.slice(1).join(' ') || '';
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
                flashCopy(fieldDiv, copyValue);
            });
            content.appendChild(fieldDiv);

            copyItems.push({ fieldDiv, copyValue });
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
    // INIT
    // ========================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            installTabBarObserver();
            installGlobalHotkeys();
        });
    } else {
        installTabBarObserver();
        installGlobalHotkeys();
    }
})();