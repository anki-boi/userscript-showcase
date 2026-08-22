// ==UserScript==
// @name         LifeFile Patient Profile Autofill
// @namespace    http://tampermonkey.net/
// @version      1.12
// @description  Fills the LifeFile new-patient form from Copy Everything; glows missing fields
// @author       Jeyson Dagondon
// @run-at       document-idle
// @match        https://hostB.lifefile.net/*
// @match        https://hostA.lifefile.net/*
// @match        https://hostC.lifefile.net:8443/*
// @match        https://hostD.lifefile.net/*
// @grant        none
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[LF-Profile v1.12] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['LF-Profile'] = { name: 'LifeFile Patient Profile Autofill', version: '1.12', state: 'idle', message: 'Loaded', output: null, error: null, lastActivity: Date.now(), trigger: null };
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}';
  document.documentElement.appendChild(__dsStyle);

// ┌──────────────────────────────────────────────────────────────────────────┐
// │  IMPORTANT: edit the @match line above to the real pharmacy portal URL.    │
// │  Example: // @match  https://portal.somepharmacy.com/*                     │
// │  Until you do, this script will not load on the portal page.               │
// └──────────────────────────────────────────────────────────────────────────┘

(function() {
    'use strict';

    // ========================================
    // FIELD MAP  (payload key → form target)
    //   type:  'text' | 'select' | 'radio'
    //   glow:  true  = pulse this field when its payload value is missing
    //          false = optional field, stay quiet when missing
    // ========================================
    const FIELD_MAP = {
        firstName: { id: 'txt_patient_first_name', type: 'text',   glow: true  },
        lastName:  { id: 'txt_patient_last_name',  type: 'text',   glow: true  },
        gender:    { name: 'rad_patient_gender',   type: 'radio',  glow: true,
                     container: 'rad_patient_gender-element' },
        phone:     { id: 'txt_patient_phone',      type: 'text',   glow: false },
        cell:      { id: 'txt_patient_cell_phone', type: 'text',   glow: true  },
        email:     { id: 'txt_patient_email',      type: 'text',   glow: false },
        address:   { id: 'txt_patient_address_1',  type: 'text',   glow: true  },
        city:      { id: 'txt_patient_city',       type: 'text',   glow: true  },
        state:     { id: 'sel_patient_state',      type: 'select', glow: true  },
        zip:       { id: 'txt_patient_zip',        type: 'text',   glow: true  }
    };

    // DOB is three separate selects, handled specially.
    const DOB_IDS = {
        m: 'txt_patient_date_of_birth-month',
        d: 'txt_patient_date_of_birth-day',
        y: 'txt_patient_date_of_birth-year'
    };

    // Supervising Practitioner (required select on the new-patient form) — the
    // clinic always creates patients under Finley. Not part of the patient payload.
    const SUPERVISING_PRACTITIONER = 'FINLEY LAURA';

    // City: filled from payload.city when the extractor found a clean comma-separated
    // city (e.g. "8 Bella Rd, Carmel, NY 10512"). When Zoho's address had NO comma
    // before the city, the whole string stays as the address and the city key is
    // absent — the glow then prompts the manual entry (never risk a guessed city).

    const GLOW_CLASS = 'cc-injector-glow';
    const BTN_ID = 'pinj-fill-btn';

    // ========================================
    // GLOW STYLE (injected once)
    // ========================================
    function ensureGlowStyle() {
        if (document.getElementById('cc-injector-glow-style')) return;
        const style = document.createElement('style');
        style.id = 'cc-injector-glow-style';
        style.textContent = `
            @keyframes ccInjectorPulse {
                0%   { box-shadow: 0 0 0 0 rgba(255,120,0,0.85); border-color: #ff7800; }
                50%  { box-shadow: 0 0 8px 4px rgba(255,120,0,0.55); border-color: #ff9a3d; }
                100% { box-shadow: 0 0 0 0 rgba(255,120,0,0.85); border-color: #ff7800; }
            }
            .${GLOW_CLASS} {
                animation: ccInjectorPulse 1.1s ease-in-out infinite !important;
                outline: 2px solid #ff7800 !important;
                outline-offset: 1px !important;
                border-radius: 4px !important;
            }
        `;
        document.head.appendChild(style);
    }

    // Apply glow to an element and wire it to stop the moment the user touches it.
    function glowElement(el) {
        if (!el) return;
        ensureGlowStyle();
        el.classList.add(GLOW_CLASS);

        const clear = () => {
            el.classList.remove(GLOW_CLASS);
            el.removeEventListener('focus', clear, true);
            el.removeEventListener('input', clear, true);
            el.removeEventListener('change', clear, true);
            el.removeEventListener('click', clear, true);
        };
        // capture=true so it fires even for the radio group's inner inputs
        el.addEventListener('focus', clear, true);
        el.addEventListener('input', clear, true);
        el.addEventListener('change', clear, true);
        el.addEventListener('click', clear, true);
    }

    // ========================================
    // FIELD SETTERS
    // ========================================
    // Plain jQuery/vanilla form — set .value then dispatch input+change so any
    // validation listeners fire.
    function setText(id, value) {
        const el = document.getElementById(id);
        if (!el) { console.warn('[injector] text field not found:', id); return false; }
        el.value = value;
        el.dispatchEvent(new Event('input',  { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function setSelect(id, value) {
        const el = document.getElementById(id);
        if (!el) { console.warn('[injector] select not found:', id); return false; }
        el.value = String(value);
        // If the value didn't match any option, .value goes empty — treat as failure.
        if (el.value !== String(value)) {
            console.warn('[injector] no matching option for', id, '=', value);
            return false;
        }
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    function setRadio(name, value) {
        const el = document.querySelector(`input[name="${name}"][value="${value}"]`);
        if (!el) { console.warn('[injector] radio not found:', name, value); return false; }
        el.checked = true;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        el.dispatchEvent(new Event('click',  { bubbles: true }));
        return true;
    }

    // Grab the element we visually glow for a given field config.
    function glowTargetFor(cfg) {
        if (cfg.type === 'radio') {
            return document.getElementById(cfg.container) || document.getElementsByName(cfg.name)[0];
        }
        return document.getElementById(cfg.id);
    }

// A last name with more than two words usually means a full name or a stray
// first name landed in the wrong field — flag it for a manual look.
function isSuspiciousLastName(value) {
    const words = String(value).trim().split(/\s+/).filter(Boolean);
    return words.length > 1;
}

// ========================================
// MAIN FILL
// ========================================
function fillForm(payload, btn) {
    let filled = 0;
    let glowed = 0;

    // --- standard fields ---
    for (const [key, cfg] of Object.entries(FIELD_MAP)) {
        const value = payload[key];
        const hasValue = (value !== undefined && value !== null && value !== '');

        if (hasValue) {
            let ok = false;
            if (cfg.type === 'text')   ok = setText(cfg.id, value);
            else if (cfg.type === 'select') ok = setSelect(cfg.id, value);
            else if (cfg.type === 'radio')  ok = setRadio(cfg.name, value);

            if (ok) {
                filled++;
                // Extra sanity check: lastName with 3+ words is suspicious even
                // though it filled successfully.
                if (key === 'lastName' && isSuspiciousLastName(value)) {
                    glowElement(glowTargetFor(cfg));
                    glowed++;
                }
            }
            else if (cfg.glow) { glowElement(glowTargetFor(cfg)); glowed++; }
        } else if (cfg.glow) {
            glowElement(glowTargetFor(cfg));
            glowed++;
        }
    }

    // --- DOB (three selects) ---
    // Runs BEFORE the Supervising Practitioner block: LifeFile changed that
    // field to a hidden input (2026-08-13) which once crashed fillForm here and
    // skipped the DOB fill. DOB is core patient data — never let it be skipped.
    const dob = payload.dob;
    if (dob && dob.m && dob.d && dob.y) {
        const okM = setSelect(DOB_IDS.m, dob.m);
        const okD = setSelect(DOB_IDS.d, dob.d);
        const okY = setSelect(DOB_IDS.y, dob.y);
        if (okM) filled++; else { glowElement(document.getElementById(DOB_IDS.m)); glowed++; }
        if (okD) filled++; else { glowElement(document.getElementById(DOB_IDS.d)); glowed++; }
        if (okY) filled++; else { glowElement(document.getElementById(DOB_IDS.y)); glowed++; }
    } else {
        glowElement(document.getElementById(DOB_IDS.m));
        glowElement(document.getElementById(DOB_IDS.d));
        glowElement(document.getElementById(DOB_IDS.y));
        glowed += 3;
    }

    // --- Supervising Practitioner (fixed clinic value) ---
    // LifeFile changed this field from a real <select> to a hidden input the
    // server pre-defaults (2026-08-13). Feature-detect: real select → pick
    // Finley; non-select with a value → trust the server default; non-select
    // with no value → glow for manual attention. Wrapped in try/catch so this
    // block can NEVER abort the rest of the fill.
    try {
        const supSel = document.getElementById('sel_authorize_provider');
        if (supSel) {
            if (supSel.options && supSel.options.length) {
                const supOpt = Array.from(supSel.options).find((o) =>
                    (o.textContent || '').trim().toUpperCase().includes(SUPERVISING_PRACTITIONER));
                if (supOpt) {
                    if (setSelect('sel_authorize_provider', supOpt.value)) filled++;
                    else { glowElement(supSel); glowed++; }
                } else {
                    glowElement(supSel);
                    glowed++;
                }
            } else if (String(supSel.value || '').trim() !== '') {
                // Hidden input / custom widget — server pre-defaulted it.
                console.log('[injector] sel_authorize_provider is not a select; trusting server default:', supSel.value);
                filled++;
            } else {
                glowElement(supSel);
                glowed++;
            }
        }
    } catch (e) {
        console.warn('[injector] Supervising Practitioner step failed:', e);
        const supSel = document.getElementById('sel_authorize_provider');
        if (supSel) { glowElement(supSel); glowed++; }
    }

    flashButton(btn, `✓ Filled ${filled} · ${glowed} to check`, 'var(--ds-success,#0a8754)');
    console.log(`[injector] filled ${filled} fields, glowing ${glowed} for manual attention`, payload);
}
    // ========================================
    // CLIPBOARD READ + TRIGGER
    // ========================================
    async function readClipboardAndFill(btn) {
        let text = '';
        try {
            text = await navigator.clipboard.readText();
        } catch (e) {
            console.error('[injector] clipboard read failed:', e);
            flashButton(btn, '✕ Clipboard blocked', 'var(--ds-danger,#b3261e)');
            return;
        }

        let payload;
        try {
            payload = JSON.parse(text);
        } catch (e) {
            console.error('[injector] clipboard is not valid JSON:', e);
            flashButton(btn, '✕ No valid data', 'var(--ds-danger,#b3261e)');
            return;
        }

        if (!payload || typeof payload !== 'object') {
            flashButton(btn, '✕ Bad payload', 'var(--ds-danger,#b3261e)');
            return;
        }

        // RxFlow payloads carry the flat LifeFile block under
        // _lifeFileProfile (keeps the rich patient payload untouched).
        if (payload._lifeFileProfile) payload = payload._lifeFileProfile;

        fillForm(payload, btn);
    }

    // Flash feedback on the button. Restores to '' so the bg_forward class styling
    // takes back over cleanly afterward.
    function flashButton(btn, message, color) {
        if (!btn) return;
        const originalText = btn.textContent;
        const originalBg = btn.style.backgroundColor;
        btn.textContent = message;
        btn.style.backgroundColor = color;
        setTimeout(() => {
            btn.textContent = originalText;
            btn.style.backgroundColor = originalBg;
        }, 1400);
    }

    // ========================================
    // INLINE BUTTON  (styled like Save Patient, left-aligned in the button row)
    // ========================================
    function makeFillButton() {
        const btn = document.createElement('a');
        btn.href = '#';
        btn.id = BTN_ID;
        // Reuse the portal's own forward-button styling so it matches Save Patient.
        btn.className = 'bg_forward';
        btn.textContent = '💉 Fill Patient Form';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            readClipboardAndFill(btn);
        });
        return btn;
    }

    // Inject into the empty left cell of the Save Patient / Cancel button row.
    // Returns true once injected so the observer can stop watching.
    function injectInlineButton() {
        if (document.getElementById(BTN_ID)) return true;

        const save = document.querySelector('a.btn_insert_patient');
        if (!save) return false;

        const row = save.closest('tr');
        if (!row) return false;

        // First cell in the row is the align="left" spacer holding only &nbsp;
        const leftCell = row.querySelector('td');
        if (!leftCell) return false;

        leftCell.innerHTML = '';               // clear the &nbsp;
        leftCell.appendChild(makeFillButton());
        console.log('[injector] Fill Patient Form button injected.');
        return true;
    }

    // The form may render after initial load, so watch until the row appears.
    function waitAndInject() {
        if (injectInlineButton()) return;
        const observer = new MutationObserver(() => {
            if (injectInlineButton()) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ========================================
    // OPTIONAL HOTKEY: Alt+F fills from clipboard
    // ========================================
    function installHotkey() {
        document.addEventListener('keydown', (e) => {
            if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'f') {
                e.preventDefault();
                readClipboardAndFill(document.getElementById(BTN_ID));
            }
        });
    }

    // ========================================
    // AUTO-FILL ON LOAD (Phase 3)
    // The Order Autofill's new-patient flow lands here with the patient payload in
    // sessionStorage under lf_sale_intent — fill it without needing a button click.
    // ========================================
    function autoFillFromIntent() {
        let intent = null;
        try {
            const raw = sessionStorage.getItem('lf_sale_intent');
            intent = raw ? JSON.parse(raw) : null;
        } catch (e) { return; }
        if (!intent) return;
        // RxFlow payloads carry the flat block under _lifeFileProfile
        // (order-flow intents are already flat — this is a no-op for them).
        // MUST unwrap before the firstName check or rxflow payloads
        // would early-return (their flat keys are nested).
        if (intent._lifeFileProfile) intent = intent._lifeFileProfile;
        if (!intent.firstName || !intent.lastName) return;
        if (!document.querySelector('a.btn_insert_patient')) {
            // New-patient form not rendered yet — retry shortly.
            setTimeout(autoFillFromIntent, 700);
            return;
        }
        const btn = document.getElementById(BTN_ID) || document.createElement('a');
        fillForm(intent, btn);
        console.log('[injector] auto-filled from LifeFile sale intent');
    }

    // ========================================
    // INIT
    // ========================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            waitAndInject();
            installHotkey();
            autoFillFromIntent();
        });
    } else {
        waitAndInject();
        installHotkey();
        autoFillFromIntent();
    }
})();