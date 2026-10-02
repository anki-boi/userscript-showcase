// ==UserScript==
// @name         LifeFile Order Autofill
// @namespace    http://tampermonkey.net/
// @version      1.24
// @author       Jeyson Dagondon
// @description  LifeFile order autofill: patient search-or-create + order-form fill (no auto-submit, no step-2)
// @match        https://hostB.pharmalink.example/*
// @match        https://hostA.pharmalink.example/*
// @match        https://hostC.pharmalink.example:8443/*
// @match        https://hostD.pharmalink.example/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[LF-Autofill v1.24] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['LF-Autofill'] = { name: 'LifeFile Order Autofill', version: '1.24', state: 'idle', message: 'Loaded', progress: null, output: null, error: null, lastActivity: Date.now(), trigger: null };
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}';
  document.documentElement.appendChild(__dsStyle);

(function () {
    'use strict';

    // --- Script API (R18): reference the registered object + state helper ---
    const api = window.__scripts['LF-Autofill'];
    function apiSet(state, message, extra) {
        api.state = state;
        api.message = message || '';
        api.lastActivity = Date.now();
        if (extra) Object.assign(api, extra);
        if (state === 'error') api.error = message || '';
        if (state === 'done' || state === 'idle') { api.error = null; }
        console.info(`[LF-Autofill] API: ${state}${message ? ' — ' + message : ''}`);
    }

    // ---- DEBUG: flip to true to log every setSelect to console ----
    const DEBUG = false;
    const log = (...a) => DEBUG && console.log('[LifeFile Autofill]', ...a);

    // ---- CONFIG: future-proofing dictionaries ----
    // Delivery method: ordered priority. First match found in the dropdown wins.
    const DELIVERY_PRIORITY = [
        'FEDEX- PRIORITY OVERNIGHT',
        'FEDEX PRIORITY OVERNIGHT',
        'PRIORITY OVERNIGHT',
        'UPS- NEXT DAY AIR',
        'UPS NEXT DAY AIR',
        'NEXT DAY AIR',
    ];

    // Pharmacy G (LDN): its delivery dropdown only offers Clinic-pay / patient-pay
    // options — there is no FEDEX/UPS choice, so DELIVERY_PRIORITY can't match.
    const PHARMACY_F_DELIVERY = 'PATIENT PAY ONLY - SHIPPING TBD';
    // Supervising Prescriber on the order form — the clinic always authorizes Finley.
    const SUPERVISING_PRESCRIBER = 'FINLEY LAURA';

    // Payment profile: preferred payee names, in priority order.
    const PROFILE_PRIORITY = ['Jones', 'Finley'];

    // ========================================
    // ORDER-FORM FILL + CLINIC SHIP-TO OVERRIDE
    // ========================================
    // Hardcoded clinic shipping address — identical across ALL pharmacy portals
    // (Pharmacy A's portal had a different clinic address; hardcoding makes the
    // ship-to-clinic override consistent everywhere).
    const CLINIC_ADDRESS = {
        address: '6319 Resplendent Ct',
        city: 'Colorado Springs',
        state: 'CO',
        zip: '80924'
    };
    // Per-run sale intent (patient data + pharmacy) written by the Session Handler.
    const SALE_INTENT_KEY = 'lf_sale_intent';
    // Tracks the exact search string already run on the patient-search page so a
    // page reload (POST) doesn't re-run the search in a loop.
    const SEARCHED_KEY = 'lf_searched';

    function getSaleIntent() {
        try {
            const raw = sessionStorage.getItem(SALE_INTENT_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { return null; }
    }
    function clearSaleIntent() {
        try { sessionStorage.removeItem(SALE_INTENT_KEY); } catch(e) { console.warn('[LF-Autofill]', e); }
        try { localStorage.removeItem(SALE_INTENT_KEY); } catch(e) { console.warn('[LF-Autofill]', e); }
    }
    function isOrderCheck() {
        const intent = getSaleIntent();
        return !!(intent && intent._lf && intent._lf.step === 'orders');
    }
    function formatDob(dob) {
        if (!dob || !dob.m || !dob.d || !dob.y) return '';
        const p = (n) => String(n).padStart(2, '0');
        return `${p(dob.m)}/${p(dob.d)}/${dob.y}`;
    }

    // Small floating status banner (auto-hides).
    let statusEl = null;
    function statusNote(msg, color = '#0a8754', persist = false) {
        if (!statusEl) {
            statusEl = document.createElement('div');
            statusEl.id = 'lf-autofill-status';
            statusEl.style.cssText = `
                position: fixed; top: 12px; left: 50%; transform: translateX(-50%);
                z-index: 2147483646; padding: 10px 18px; border-radius: 8px;
                font-family: system-ui, sans-serif; font-size: 14px; font-weight: 700;
                box-shadow: 0 4px 16px rgba(0,0,0,0.25); pointer-events: none;
                text-align: center; max-width: 88vw; color: #fff;
            `;
            document.body.appendChild(statusEl);
        }
        statusEl.textContent = msg;
        statusEl.style.background = (color === 'red' || color === '#b3261e') ? '#b3261e' : '#0a8754';
        statusEl.style.display = 'block';
        if (!persist) {
            clearTimeout(statusEl._t);
            statusEl._t = setTimeout(() => { statusEl.style.display = 'none'; }, 5000);
        }
    }


    // ========================================
    // PHARMACY DETECTION: Provider ID → pharmacy name
    // ========================================
    const PHARMACY_ID_MAP = {
        '1221275': 'Pharmacy A',
        '978415':  'Pharmacy B',
        '1018094': 'Pharmacy C',
        '1056130': 'Pharmacy D',
    };

    // ========================================
    // STATE RESTRICTION MAP
    // Key = state abbreviation, Value = array of pharmacy names that CANNOT ship there.
    // Source: clinic pharmacy shipping matrix (synced from Zoho extractor v1.8).
    // ========================================
    const RESTRICTION_MAP = {
        AL: ['Pharmacy D', 'Pharmacy B', 'Pharmacy C'],
        AK: ['Pharmacy D', 'Pharmacy B'],
        AR: ['Pharmacy B'],
        CA: ['Pharmacy D', 'Pharmacy B', 'Pharmacy C'],
        CT: ['Pharmacy D'],
        DC: ['Pharmacy C'],
        HI: ['Pharmacy B'],
        IA: ['Pharmacy B'],
        LA: ['Pharmacy D', 'Pharmacy B', 'Pharmacy C'],
        MI: ['Pharmacy D', 'Pharmacy C'],
        MS: ['Pharmacy D', 'Pharmacy B', 'Pharmacy C'],
        MT: ['Pharmacy D', 'Pharmacy C'],
        NC: ['Pharmacy B'],
        ND: ['Pharmacy A'],
        NV: ['Pharmacy D'],
        OH: ['Pharmacy D', 'Pharmacy B', 'Pharmacy C', 'Pharmacy A'],
        OR: ['Pharmacy B'],
        SC: ['Pharmacy D', 'Pharmacy B'],
        TX: ['Pharmacy D', 'Pharmacy C'],
        WA: ['Pharmacy D', 'Pharmacy C'],
        WV: ['Pharmacy D', 'Pharmacy C'],
    };


    // ---- helpers ----
    const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toUpperCase();
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // Glow a section to signal failure. Walks up to the enclosing <td> if possible.
    function glow(el, color = 'red') {
        if (!el) return;
        const target = el.closest('td') || el;
        const prev = target.style.boxShadow;
        const prevT = target.style.transition;
        target.style.transition = 'box-shadow 0.25s ease';
        target.style.boxShadow = `0 0 12px 3px ${color}`;
        setTimeout(() => {
            target.style.boxShadow = prev;
            setTimeout(() => { target.style.transition = prevT; }, 300);
        }, 2000);
    }

    // Fire the events LifeFile's listeners actually watch, so the DOM rebuilds.
    function setSelect(sel, value) {
        sel.value = value;
        sel.dispatchEvent(new Event('input', { bubbles: true }));
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        if (window.jQuery) window.jQuery(sel).trigger('change');
        const stuck = sel.value === value;
        log('setSelect', { id: sel.id, value, 'value stuck?': stuck, selectedText: sel.options[sel.selectedIndex]?.textContent });
        return stuck;
    }

    function clickEl(el) {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    }

    // Poll for a condition instead of blind setTimeout.
    function waitFor(fn, { timeout = 6000, interval = 120 } = {}) {
        return new Promise((resolve, reject) => {
            const start = Date.now();
            (function poll() {
                let result;
                try { result = fn(); } catch (e) { result = null; }
                if (result) return resolve(result);
                if (Date.now() - start > timeout) return reject(new Error('waitFor timeout'));
                setTimeout(poll, interval);
            })();
        });
    }

    // Find an option matching one of the priority labels.
    function matchOption(select, priorityList) {
        // Guard: the element may be a hidden input / custom widget with no
        // .options (LifeFile changed sel_authorize_provider 2026-08-13) — treat
        // as "no match" instead of crashing on Array.from(undefined).
        if (!select || !select.options || !select.options.length) return null;
        const opts = Array.from(select.options);
        for (const target of priorityList) {
            const t = norm(target);
            const hit = opts.find((o) => norm(o.textContent) === t || norm(o.label) === t);
            if (hit) return hit.value;
        }
        for (const target of priorityList) {
            const t = norm(target);
            const hit = opts.find((o) => norm(o.textContent).includes(t));
            if (hit) return hit.value;
        }
        return null;
    }

    // ========================================
    // PHARMACY DETECTION
    // Scans the page for the provider ID span and maps it to a pharmacy name.
    // Returns pharmacy name string or null if unrecognized.
    // ========================================
    function detectPharmacy() {
        // The provider ID is in a bold span, format: "Name (ID: 1234567)"
        const spans = document.querySelectorAll('span');
        for (const span of spans) {
            const text = span.textContent || '';
            const match = text.match(/\(ID:\s*(\d+)\)/);
            if (match) {
                const id = match[1];
                const pharmacy = PHARMACY_ID_MAP[id];
                if (pharmacy) {
                    log('Detected pharmacy:', pharmacy, 'ID:', id);
                    return pharmacy;
                }
            }
        }
        log('Could not detect pharmacy from provider ID');
        return null;
    }

    // ========================================
    // SHIPPING STATE READER
    // After "Copy Patient Information" populates shipping fields, read the state.
    // Tries common LifeFile field patterns: select, text input, by ID and by name.
    // Returns 2-letter uppercase abbreviation or '' if not found.
    // ========================================
    function getShippingState() {
        // Try known LifeFile selectors in priority order.
        // sel_patient_state is populated by "Copy Patient Information" even when
        // sel_shipping_state stays empty (confirmed on Pharmacy C portal).
        const selectors = [
            '#sel_patient_state',
            '#sel_shipping_state',
            'select[name="shipping_state"]',
            'select[name*="ship"][name*="state"]',
            '#txt_shipping_state',
            '#txt_patient_state',
            'input[name="shipping_state"]',
            'input[name*="ship"][name*="state"]',
        ];
        for (const sel of selectors) {
            const el = document.querySelector(sel);
            if (el) {
                const val = (el.value || '').trim().toUpperCase();
                if (val && val.length === 2 && /^[A-Z]{2}$/.test(val)) {
                    log('Found shipping state:', val, 'via', sel);
                    return val;
                }
            }
        }
        // Fallback: scan all selects/inputs whose id or name contains "state"
        const allFields = document.querySelectorAll('select, input[type="text"]');
        for (const el of allFields) {
            const ident = ((el.id || '') + ' ' + (el.name || '')).toLowerCase();
            if (ident.includes('state') && (ident.includes('ship') || ident.includes('patient') || ident.includes('delivery'))) {
                const val = (el.value || '').trim().toUpperCase();
                if (val && val.length === 2 && /^[A-Z]{2}$/.test(val)) {
                    log('Found shipping state (fallback):', val);
                    return val;
                }
            }
        }
        log('Could not read shipping state from form');
        return '';
    }

    // Check if a pharmacy is hard-restricted from shipping to a given state.
    // State-level blocks only — the med-specific (conditional) rules were step-2
    // guardrails and no longer apply since the product form is handled elsewhere.
    function isRestricted(pharmacyName, stateAbbr) {
        if (!pharmacyName || !stateAbbr) return false;
        const restricted = RESTRICTION_MAP[stateAbbr];
        if (!restricted) return false;
        const pn = norm(pharmacyName);
        return restricted.some((name) => norm(name) === pn);
    }

    // Pulsating glow on an element to draw attention (e.g., Copy Doctor button).
    // Returns a stop() function to cancel the animation.
    function pulseGlow(el, color = '#ff6600') {
        if (!el) return () => {};
        const styleId = '_lf_pulse_style';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                @keyframes lfPulse {
                    0%, 100% { box-shadow: 0 0 6px 2px ${color}; }
                    50%      { box-shadow: 0 0 18px 6px ${color}; }
                }
                .lf-pulse-glow {
                    animation: lfPulse 1.2s ease-in-out infinite;
                    border-radius: 4px;
                }
            `;
            document.head.appendChild(style);
        }
        el.classList.add('lf-pulse-glow');
        return () => el.classList.remove('lf-pulse-glow');
    }

    // Set a text input value and fire the events LifeFile listens to.
    function setInput(el, value) {
        if (!el) return;
        el.value = value;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        if (window.jQuery) window.jQuery(el).trigger('change');
    }

    // ========================================
    // STEP-1 MANUAL TOGGLES — big enough to hit without aiming
    // ========================================
    // "Check here if there are no allergies" (#chk_no_allergies) and "Check here
    // if there are no diagnosis" (#chk_no_diagnostics) are NEVER auto-ticked:
    // both are clinical decisions the operator owns (allergies are recorded on
    // the form; a real diagnosis may exist). They render as small checkboxes in
    // a dense table, so enlarge the box, enlarge the caption, and let the
    // caption itself toggle the box — the click still goes through LifeFile's
    // bound jQuery handler, which writes the description field that validation
    // actually reads (R4: the checkbox state alone is never enough). The
    // description field beside them gets a bigger font so it is easy to click
    // into and read.
    const MANUAL_TOGGLE_IDS = ['chk_no_allergies', 'chk_no_diagnostics'];

    // The block that holds ONLY this checkbox's caption. Climb from the box
    // until we find text, but STOP before any block that also holds another
    // control — the caption usually shares its cell/row with the description
    // input, and clicks there must never toggle the box.
    function toggleCaptionFor(cb) {
        let el = cb.parentElement;
        for (let depth = 0; el && el !== document.body && depth < 5; depth++, el = el.parentElement) {
            const others = Array.from(el.querySelectorAll('input, select, textarea, button, a'))
                .filter((x) => x !== cb);
            if (others.length) return null;
            if ((el.textContent || '').trim().length > 2) return el;
        }
        return null;
    }

    function enlargeManualToggles() {
        for (const id of MANUAL_TOGGLE_IDS) {
            const cb = document.getElementById(id);
            if (!cb || cb.dataset.lfBigToggle === '1') continue;
            cb.dataset.lfBigToggle = '1';

            // 1. The box itself — a target you can hit without aiming.
            cb.style.width = '22px';
            cb.style.height = '22px';
            cb.style.margin = '0 8px 0 0';
            cb.style.verticalAlign = 'middle';
            cb.style.cursor = 'pointer';
            cb.style.accentColor = 'var(--ds-accent, #8a5f2e)';

            // 2. A real <label> already toggles the box when its text is clicked
            //    — just enlarge the text.
            const labels = (cb.labels && cb.labels.length) ? Array.from(cb.labels) : [];
            if (labels.length) {
                for (const l of labels) {
                    l.style.fontSize = '17px';
                    l.style.fontWeight = '700';
                    l.style.cursor = 'pointer';
                }
            } else {
                // 3. No <label> element: enlarge the caption block and wire its
                //    clicks to the box (never hijacking another control).
                const caption = toggleCaptionFor(cb);
                if (caption) {
                    caption.style.fontSize = '17px';
                    caption.style.fontWeight = '700';
                    caption.style.cursor = 'pointer';
                    caption.style.userSelect = 'none';
                    caption.addEventListener('click', (e) => {
                        if (e.target === cb) return; // native toggle
                        if (e.target.closest && e.target.closest('input, select, textarea, button, a')) return;
                        cb.click(); // runs LifeFile's bound handler (writes the description field)
                    });
                } else if (cb.parentElement) {
                    // Caption shares its block with other controls — enlarge the
                    // text only; the box itself is already a big target.
                    cb.parentElement.style.fontSize = '17px';
                }
            }

            // 4. The description field(s) these boxes belong to — allergy rows
            //    carry the app's own `.allergy` class; the diagnosis description
            //    is id/name-matched. Bigger font = easier to click into/read.
            const fields = document.querySelectorAll(
                'input.allergy, textarea.allergy, input[id*="diagnos" i], textarea[id*="diagnos" i], ' +
                'input[name*="diagnos" i], textarea[name*="diagnos" i]'
            );
            for (const f of fields) {
                if (f === cb || f.dataset.lfBigToggleField === '1') continue;
                f.dataset.lfBigToggleField = '1';
                f.style.fontSize = '16px';
            }
        }
    }

    // ---- the main sequence ----
    async function run(btn) {
        const original = btn.textContent;
        btn.textContent = 'Working...';
        btn.style.pointerEvents = 'none';
        let stopPulse = () => {};
        apiSet('running', 'Autofilling order form…');
        try {
            // 0. Detect which pharmacy portal we're on
            const pharmacy = detectPharmacy();
            log('Pharmacy:', pharmacy || 'UNKNOWN');

            // 1. Delivery method (ALWAYS first — reveals residential options)
            //    Pharmacy G's dropdown only offers clinic-pay / patient-pay options,
            //    so detect it by its signature option and pick the fixed value.
            const delivery = document.querySelector('#sel_delivery_method');
            if (!delivery) throw new Error('delivery method select not found');
            const isPharmacyF = Array.from(delivery.options).some((o) => norm(o.textContent).includes('PATIENT PAY ONLY'));
            let dval = isPharmacyF
                ? matchOption(delivery, [PHARMACY_F_DELIVERY])
                : matchOption(delivery, DELIVERY_PRIORITY);
            if (!dval) { glow(delivery); throw new Error('no matching delivery option'); }
            if (!setSelect(delivery, dval)) glow(delivery);
            // Pharmacy G: the same option also drives the Delivery Service select below it.
            if (isPharmacyF) {
                const shipService = document.querySelector('#sel_shipping_service');
                if (shipService) {
                    const sv = matchOption(shipService, [PHARMACY_F_DELIVERY]);
                    if (sv && !setSelect(shipService, sv)) glow(shipService);
                }
            }

            // 1b. Supervising Prescriber — the clinic always authorizes Finley
            //     (Laura Finley). Set wherever the option exists; glow if it
            //     can't be matched so the operator picks it manually.
            //     LifeFile changed this to a hidden input the server pre-defaults
            //     (2026-08-13): a non-select with a value is trusted as filled.
            const prescriber = document.querySelector('#sel_authorize_provider');
            if (prescriber) {
                if (prescriber.options && prescriber.options.length) {
                    // Real <select> — existing logic.
                    const pv = matchOption(prescriber, [SUPERVISING_PRESCRIBER]);
                    if (pv) { if (!setSelect(prescriber, pv)) glow(prescriber); }
                    else glow(prescriber);
                } else if (String(prescriber.value || '').trim() !== '') {
                    // Hidden input / custom widget — trust the server default.
                    console.log('[LifeFile Autofill] sel_authorize_provider is not a select; trusting server default:', prescriber.value);
                } else {
                    glow(prescriber);
                }
            }

            await sleep(1000);

            // 2. Residential indicator
            const resSel = document.querySelector('#sel_delivery_residential_address_indicator');
            if (resSel) {
                const hasReal = Array.from(resSel.options).some((o) => o.value !== '');
                if (hasReal) {
                    if (!setSelect(resSel, '1')) glow(resSel);
                }
            }

            // 3. SHIPPING ADDRESS: Copy Patient first, then check restriction.
            //    If restricted → overwrite with Copy Doctor (ship to clinic).
            const copyPatientBtn = document.querySelector('.lnk_load_shipping_from_patient');
            const copyDoctorBtn = document.querySelector('.lnk_load_shipping_from_doctor');

            if (copyPatientBtn) {
                clickEl(copyPatientBtn);
            } else {
                glow(document.querySelector('#sel_delivery_method'));
            }

            // Give the form time to populate shipping fields
            await sleep(800);

            // Read the patient's state and name from the now-populated shipping fields
            const patientState = getShippingState();
            const patientFirstName = (document.querySelector('#txt_shipping_patient_first_name')?.value || '').trim();
            const patientLastName  = (document.querySelector('#txt_shipping_patient_last_name')?.value || '').trim();
            let shippedToClinic = false;

            if (pharmacy && patientState && isRestricted(pharmacy, patientState)) {
                // This pharmacy can't ship to this state — reroute to clinic
                log(`RESTRICTED: ${pharmacy} cannot ship to ${patientState}. Switching to Copy Doctor.`);
                if (copyDoctorBtn) {
                    // Pulsating glow so the operator knows clinic shipping was triggered
                    stopPulse = pulseGlow(copyDoctorBtn, '#ff6600');

                    clickEl(copyDoctorBtn);
                    shippedToClinic = true;
                    await sleep(800);

                    // Overwrite shipping name with patient's name so the clinic
                    // can immediately identify who to forward the package to.
                    const fnField = document.querySelector('#txt_shipping_patient_first_name');
                    const lnField = document.querySelector('#txt_shipping_patient_last_name');
                    if (fnField && patientFirstName) setInput(fnField, patientFirstName);
                    if (lnField && patientLastName)  setInput(lnField, patientLastName);
                    log('Restored patient name on shipping:', patientFirstName, patientLastName);
                } else {
                    glow(copyPatientBtn || delivery, 'orange');
                    console.warn('[LifeFile Autofill] State restricted but Copy Doctor button not found!');
                }
            }

            // 4. Step-1 toggles: BOTH are left to the operator — neither the
            //    "Check here if there are no allergies" box (#chk_no_allergies)
            //    nor the "Check here if there are no diagnosis" box
            //    (#chk_no_diagnostics) is auto-ticked. Allergies are recorded on
            //    the form and a real diagnosis may exist, so the human makes the
            //    call. Both are enlarged (box + caption + the description field
            //    next to them) so they are easy to hit — the operator's click
            //    still runs LifeFile's bound jQuery handler, which is what writes
            //    the description field validation reads (R4).
            enlargeManualToggles();

            // 5–8. BILLING (optional — some portals like Pharmacy C auto-bill
            //       and have no payor/profile selectors at all).
            const payor = document.querySelector('#sel_payment_payor_type');
            if (payor) {
                // 5. Payor -> Prescriber
                if (!setSelect(payor, 'doc')) glow(payor);

                // 6. Wait for Billing Profiles button, then click it
                let billingBtn;
                try {
                    billingBtn = await waitFor(() => {
                        const b = document.querySelector('.lnk_load_payment_profile');
                        return (b && b.offsetParent !== null) ? b : null;
                    }, { timeout: 6000 });
                } catch (e) {
                    glow(payor);
                    log('Billing Profiles button never appeared — skipping billing steps');
                    billingBtn = null;
                }

                if (billingBtn) {
                    clickEl(billingBtn);

                    // 7. Wait for payment profile selector to populate
                    let profileSel;
                    try {
                        profileSel = await waitFor(() => {
                            const s = document.querySelector('#sel_payment_profile_selector');
                            if (!s) return null;
                            return Array.from(s.options).some((o) => o.value !== '') ? s : null;
                        }, { timeout: 6000 });
                    } catch (e) {
                        glow(billingBtn);
                        log('Payment profile selector never populated — skipping');
                        profileSel = null;
                    }

                    if (profileSel) {
                        const realOpts = Array.from(profileSel.options).filter((o) => o.value !== '');
                        let chosen;
                        if (realOpts.length === 1) {
                            chosen = realOpts[0];
                        } else {
                            for (const name of PROFILE_PRIORITY) {
                                const n = norm(name);
                                chosen = realOpts.find((o) => norm(o.textContent).includes(n));
                                if (chosen) break;
                            }
                            if (!chosen) chosen = realOpts[0];
                        }
                        if (!setSelect(profileSel, chosen.value)) glow(profileSel);
                        await sleep(500);

                        // 8. Select Payment
                        const confirmBtn = document.querySelector('#lnk_confirm_payment_profile_selector');
                        if (confirmBtn) clickEl(confirmBtn);
                        else glow(profileSel);
                    }
                }
            } else {
                log('No payor selector found — portal auto-bills (e.g. Pharmacy C). Skipping billing steps.');
            }

            // 9. RECIPIENT TYPE + CLINIC OVERRIDE
            const recipientSel = document.querySelector('#sel_shipping_recipient_type');
            if (recipientSel) {
                const target = shippedToClinic ? 'clinic' : 'patient';
                if (!setSelect(recipientSel, target)) glow(recipientSel);
            }
            if (shippedToClinic) {
                // Override the clinic shipping address with the hardcoded clinic
                // address — identical on every portal (incl. Pharmacy A).
                const a = CLINIC_ADDRESS;
                setInput(document.querySelector('#txt_shipping_patient_address'), a.address);
                setInput(document.querySelector('#txt_shipping_patient_city'), a.city);
                if (!setSelect(document.querySelector('#sel_shipping_patient_state'), a.state)) {
                    glow(document.querySelector('#sel_shipping_patient_state'));
                }
                setInput(document.querySelector('#txt_shipping_patient_zip'), a.zip);
            }
            await sleep(600);

            // No auto-submit: the operator reviews the filled order form, ticks
            // the allergies / no-diagnosis boxes (both manual), and clicks
            // "Medication Information" themselves (the product/medication form
            // is handled outside this script now).
            apiSet('waiting_human', 'Order form filled — tick allergies / no-diagnosis, then submit manually');

            // Final status
            if (shippedToClinic) {
                btn.textContent = `✓ Done (→ Clinic: ${patientState} restricted)`;
                btn.style.color = 'var(--ds-warn,#b35900)';
                await sleep(3000);
                btn.style.color = '';

            } else {
                btn.textContent = 'Done ✓';
                await sleep(1200);
            }
            btn.textContent = original;
        } catch (err) {
            console.error('[LifeFile Autofill]', err);
            apiSet('error', (err && err.message) ? err.message : String(err));
            btn.textContent = 'Error (see console)';
            try { stopPulse(); } catch(_) { console.warn('[LF-Autofill]', _); }
            await sleep(2000);
            btn.textContent = original;
        } finally {
            btn.style.pointerEvents = '';
        }
    }

    // ========================================
    // PHASE 3 — PATIENT SEARCH-OR-CREATE
    // ========================================
    // Find the patient row matching last/first/DOB on the search-results page.
    // Column positions differ between portals/lists (Pharmacy A recent list vs South
    // Lake search results), so resolve columns from the table header when present,
    // else fall back to matching cells by exact content.
    function findMatchingPatientRow(lastName, firstName, dobStr) {
        const norm = (s) => (s || '').replace(/\s+/g, ' ').trim().toUpperCase();
        const rowEls = document.querySelectorAll('tr.odd, tr.even');

        // Locate the results table (the one containing Select/setpatient links).
        let table = null;
        for (const tr of rowEls) {
            if (tr.querySelector('a[href*="/poe/setpatient/"]')) { table = tr.closest('table'); break; }
        }

        // Column layout from the header row (if any).
        let colLast = -1, colFirst = -1, colDob = -1;
        if (table) {
            const headerTr = table.querySelector('tr:first-child, thead tr');
            const ths = headerTr ? Array.from(headerTr.querySelectorAll('th')) : [];
            ths.forEach((th, i) => {
                const t = norm(th.textContent);
                if (/LAST/.test(t) && colLast === -1) colLast = i;
                if (/FIRST/.test(t) && colFirst === -1) colFirst = i;
                if (/(DATE OF BIRTH|DOB)/.test(t) && colDob === -1) colDob = i;
            });
        }

        const cellText = (td) => (td ? norm(td.textContent) : '');

        for (const tr of rowEls) {
            const tds = Array.from(tr.querySelectorAll(':scope > td'));
            if (!tds.length) continue;

            if (colLast !== -1 && colFirst !== -1) {
                // Header-driven layout.
                if (cellText(tds[colLast]) !== norm(lastName)) continue;
                if (firstName && cellText(tds[colFirst]) !== norm(firstName)) continue;
                if (dobStr && colDob !== -1) {
                    const d = cellText(tds[colDob]);
                    if (d && d !== norm(dobStr)) continue;
                }
                return tr;
            }

            // Fallback: exact-cell matching across the row.
            if (!tds.some((td) => cellText(td) === norm(lastName))) continue;
            if (firstName && !tds.some((td) => cellText(td) === norm(firstName))) continue;
            if (dobStr && !tds.some((td) => cellText(td) === norm(dobStr))) continue;
            return tr;
        }
        return null;
    }

    // On the patient-search page with an active sale intent: try every word-boundary
    // split of the full name (permutation search), pick the matching patient
    // (Select → chain), or open the new-patient form when nothing matches.
    async function trySearchPatient() {
        if (location.pathname.indexOf('/poe/searchpatient') === -1) return false;
        const intent = getSaleIntent();
        if (!intent || !intent.firstName || !intent.lastName) return false;
        if (isOrderCheck()) return false; // orders mode never runs the sale search
        apiSet('running', `Searching patient — ${intent.firstName} ${intent.lastName}`);

        // Permutation state persisted in sessionStorage so a full-page POST reload
        // (which re-runs this script) continues from the same split, not from 0.
        const PERM_LIST_KEY = 'lf_perm_list';
        const PERM_IDX_KEY = 'lf_perm_idx';
        const PERM_GUARD_KEY = 'lf_perm_guard';
        const guardKey = `${intent.lastName}, ${intent.firstName}`.toUpperCase(); // original extractor search key

        const clearPermState = () => {
            try { sessionStorage.removeItem(PERM_LIST_KEY); } catch(e) { console.warn('[LF-Autofill]', e); }
            try { sessionStorage.removeItem(PERM_IDX_KEY); } catch(e) { console.warn('[LF-Autofill]', e); }
            try { sessionStorage.removeItem(PERM_GUARD_KEY); } catch(e) { console.warn('[LF-Autofill]', e); }
        };
        const clearSearchedKey = () => {
            try { sessionStorage.removeItem(SEARCHED_KEY); } catch(e) { console.warn('[LF-Autofill]', e); }
        };

        // Every word-boundary split of the full name. allWords[0..i] = first name,
        // allWords[i+1..] = last name, for i in 0..len-2 (never empty either side).
        const allWords = `${intent.firstName} ${intent.lastName}`.trim().split(/\s+/).filter(Boolean);
        const maxI = allWords.length - 2;
        const origI = intent.firstName.trim().split(/\s+/).filter(Boolean).length - 1;
        const indices = [];
        const pushI = (i) => { if (i >= 0 && i <= maxI && indices.indexOf(i) === -1) indices.push(i); };
        pushI(origI); // original extractor split FIRST
        pushI(0);     // whole-surname split next
        for (let i = 1; i <= maxI; i++) pushI(i); // then remaining boundaries ascending
        let perms = [];
        const seen = new Set();
        for (const i of indices) {
            const first = allWords.slice(0, i + 1).join(' ');
            const last = allWords.slice(i + 1).join(' ');
            const key = `${last}, ${first}`.toUpperCase();
            if (seen.has(key)) continue; // dedupe on 'LAST, FIRST'
            seen.add(key);
            perms.push({ first, last, key });
        }

        // Resume from persisted progress only when the guard (this intent's original
        // search key) matches; otherwise reset to index 0 and rebuild the list.
        let idx = 0;
        try {
            if ((sessionStorage.getItem(PERM_GUARD_KEY) || '') === guardKey) {
                const rawList = sessionStorage.getItem(PERM_LIST_KEY);
                if (rawList) {
                    const parsed = JSON.parse(rawList);
                    if (Array.isArray(parsed) && parsed.length) {
                        perms = parsed;
                        idx = parseInt(sessionStorage.getItem(PERM_IDX_KEY) || '0', 10) || 0;
                        if (idx < 0 || idx >= perms.length) idx = 0;
                    }
                }
            }
        } catch(e) { console.warn('[LF-Autofill]', e); }
        try { sessionStorage.setItem(PERM_LIST_KEY, JSON.stringify(perms)); } catch(e) { console.warn('[LF-Autofill]', e); }
        try { sessionStorage.setItem(PERM_GUARD_KEY, guardKey); } catch(e) { console.warn('[LF-Autofill]', e); }
        try { sessionStorage.setItem(PERM_IDX_KEY, String(idx)); } catch(e) { console.warn('[LF-Autofill]', e); }

        while (idx < perms.length) {
            const perm = perms[idx];
            let doneKey = '';
            try { doneKey = sessionStorage.getItem(SEARCHED_KEY) || ''; } catch(e) { console.warn('[LF-Autofill]', e); }

            if (doneKey !== perm.key) {
                const box = document.querySelector('#txt_search');
                const btn = document.querySelector('#btn_search_button');
                if (!box || !btn) {
                    apiSet('error', 'Patient search controls not found on this page');
                    return false;
                }
                const nameRadio = document.querySelector('#rad_search_type-name');
                if (nameRadio && !nameRadio.checked) nameRadio.checked = true;
                statusNote(`Searching ${perm.last}, ${perm.first}…`);
                try { sessionStorage.setItem(SEARCHED_KEY, perm.key); } catch(e) { console.warn('[LF-Autofill]', e); }
                setInput(box, `${perm.last}, ${perm.first}`);
                clickEl(btn);
            }

            // If the search is a full-page POST the context reloads and init re-runs
            // with the marker set (resuming from this permutation); if it's AJAX we
            // continue here after the wait.
            await sleep(1800);

            const row = findMatchingPatientRow(perm.last, perm.first, formatDob(intent.dob));
            if (row) {
                const sel = row.querySelector('a[href*="/poe/setpatient/"]');
                if (sel) {
                    statusNote(`Found ${perm.first} ${perm.last} — selecting…`);
                    clickEl(sel);
                    clearPermState();
                    clearSearchedKey();
                    apiSet('running', `Patient matched — ${perm.last}, ${perm.first} selected; proceeding to the order flow`);
                    return true;
                }
            }
            idx++;
            try { sessionStorage.setItem(PERM_IDX_KEY, String(idx)); } catch(e) { console.warn('[LF-Autofill]', e); }
        }

        clearPermState();
        clearSearchedKey();
        statusNote('No matching patient — opening New Patient form…');
        apiSet('error', `No matching patient found after ${perms.length} search permutation(s) — opened the New Patient form (manual creation)`);
        location.href = '/application_main_zfw/poepatient/newpatient';
        return true;
    }

    // On the new-patient page with a sale intent: wait for the user to save the
    // patient (page navigates away), then start the eRx chain from the control panel.
    function tryHandleNewPatientPage() {
        if (location.pathname.indexOf('/poepatient/newpatient') === -1) return false;
        if (!getSaleIntent()) return false;
        const watch = () => {
            if (location.pathname.indexOf('/poepatient/newpatient') === -1) {
                // Left the new-patient page → patient saved → control panel → eRx
                try { sessionStorage.setItem(CHAIN_KEY, 'click_erx'); } catch(e) { console.warn('[LF-Autofill]', e); }
                location.href = '/application_main_zfw/poe/poecontrolpanel';
                return;
            }
            setTimeout(watch, 1200);
        };
        setTimeout(watch, 4000); // give the autofill time to run first
        return true;
    }


    // ========================================
    // PAGE CHAIN: Select → eRx → Autofill
    // Uses sessionStorage to persist intent across page navigations.
    // Flow: patient list (Select click) → control panel (auto-click eRx) → order form (auto-run autofill)
    // ========================================
    const CHAIN_KEY = 'lf_autofill_chain';

    function startChain() {
        sessionStorage.setItem(CHAIN_KEY, 'click_erx');
    }

    function getChainState() {
        return sessionStorage.getItem(CHAIN_KEY) || '';
    }

    function advanceChain(nextState) {
        sessionStorage.setItem(CHAIN_KEY, nextState);
    }

    function clearChain() {
        sessionStorage.removeItem(CHAIN_KEY);
    }

    // ---- STEP 0: Patient list page ----
    // Intercept Select buttons so clicking one sets the chain flag before navigation.
    function installSelectInterceptors() {
        const selects = document.querySelectorAll('a.bg_black_button[href*="/poe/setpatient/"]');
        if (selects.length === 0) return false; // not on patient list page
        for (const btn of selects) {
            if (btn.dataset.lfChained) continue;
            btn.dataset.lfChained = '1';
            // Set chain flag BEFORE the native onclick/href fires.
            // Uses capture phase so it runs before jQuery handlers.
            btn.addEventListener('click', () => startChain(), { capture: true });
        }
        log('Intercepted', selects.length, 'Select button(s) on patient list');
        return true;
    }

    // ---- STEP 1: Control panel page ----
    // If chain flag says "click_erx", find the eRx link and click it.
    function tryAutoClickErx() {
        if (getChainState() !== 'click_erx') return false;
        const erx = document.querySelector('a.control_panel_link[href*="/poeerx/poeorderinfo"]');
        if (!erx) return false;
        log('Chain: auto-clicking eRx');
        advanceChain('run_autofill');
        // Small delay to let the page finish rendering before navigation
        setTimeout(() => erx.click(), 300);
        return true;
    }

    // ---- STEP 2: Order form page ----
    // If chain flag says "run_autofill", inject the button and auto-run.
    async function tryAutoRunAutofill() {
        if (getChainState() !== 'run_autofill') return;
        clearChain();
        log('Chain: waiting for order form to be ready…');
        // Wait for the delivery method select (signals the form is rendered)
        try {
            await waitFor(() => document.querySelector('#sel_delivery_method'), { timeout: 12000 });
        } catch (e) {
            console.warn('[LifeFile Autofill] Order form not ready for auto-run — timed out');
            return;
        }
        // Inject the Autofill button (also serves as manual fallback)
        injectButton();
        await sleep(400);
        const btn = document.querySelector('#lf_autofill_btn');
        if (btn) {
            log('Chain: auto-running autofill');
            run(btn);
        }
    }

    // ---- inject the manual trigger button on the order form ----
    function injectButton() {
        if (document.querySelector('#lf_autofill_btn')) return;

        const forward = document.querySelector('a.bg_forward[onclick*="submit_step_1_new"]');
        if (!forward) return;

        const row = forward.closest('tr');
        if (!row) return;

        const leftCell = row.querySelector('td');
        if (!leftCell) return;

        const btn = document.createElement('a');
        btn.id = 'lf_autofill_btn';
        btn.href = '#';
        btn.textContent = 'Autofill Order';
        btn.className = forward.className;
        btn.style.cssText = 'padding:6px 14px; font-size:14px; font-weight:bold;';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            run(btn);
        });

        leftCell.innerHTML = '';
        leftCell.appendChild(btn);
        return;
    }

    // ========================================
    // INIT — detect which page we're on and act accordingly
    // ========================================
    function init() {
        // Patient list page: intercept Select buttons
        const isPatientList = installSelectInterceptors();

        // Control panel page: auto-click eRx if chain is active
        const isControlPanel = tryAutoClickErx();

        // Patient selection page: auto-search for the sale patient (Phase 3)
        trySearchPatient();

        // New-patient page: watch for save, then start the eRx chain (Phase 3)
        tryHandleNewPatientPage();

        // Order form page: inject manual button + auto-run if chain is active
        if (!isPatientList && !isControlPanel) {
            // Step-1 toggles are manual — enlarge them up front so the operator
            // can hit them even when the autofill never runs this load.
            enlargeManualToggles();
            injectButton();
            tryAutoRunAutofill();
        }
    }

    // R18: trigger dispatcher (agent entry point) — defined AFTER the functions
    // it dispatches to.
    api.trigger = function (action, params) {
        if (action === 'start') {
            if (api.state === 'running') return { ok: false, error: 'already running' };
            const intent = params && params.intent;
            if (!intent || typeof intent !== 'object') return { ok: false, error: 'params.intent is required' };
            let j = null;
            try { j = JSON.stringify(intent); } catch (e) { return { ok: false, error: 'intent is not JSON-serializable' }; }
            try {
                sessionStorage.setItem(SALE_INTENT_KEY, j);
                localStorage.setItem(SALE_INTENT_KEY, j);
            } catch (e) { return { ok: false, error: 'could not persist intent to storage' }; }
            apiSet('running', `Triggered start — ${intent.firstName || '?'} ${intent.lastName || ''}`);
            const path = location.pathname || '';
            if (path.indexOf('/poe/searchpatient') !== -1) {
                // Patient search page: the permutation search picks or creates.
                trySearchPatient();
            } else if (path.indexOf('/poepatient/newpatient') !== -1) {
                // New-patient form: the Profile Autofill fills it; the human saves.
                tryHandleNewPatientPage();
                apiSet('waiting_human', 'New-patient form — fill & save (Profile Autofill fills it)');
            } else if (path.indexOf('/poeerx/poeorderinfo') !== -1) {
                // Step-1 order form: inject the button and run the autofill.
                const tryRun = (n) => {
                    injectButton();
                    const btn = document.querySelector('#lf_autofill_btn');
                    if (btn) { run(btn); return true; }
                    if (n > 0) { setTimeout(() => tryRun(n - 1), 800); return false; }
                    apiSet('error', 'Step-1 order form not found — cannot autofill');
                    return false;
                };
                tryRun(5);
            } else {
                apiSet('waiting_human', 'Intent persisted — not on a LifeFile flow page; navigate or reload');
            }
            return { ok: true };
        }
        if (action === 'reset') {
            apiSet('idle', 'Reset — cleared to idle');
            return { ok: true };
        }
        return { ok: false, error: `unknown action: ${action}` };
    };

    // Run init now and re-run on DOM changes (LifeFile re-renders dynamically)
    const obs = new MutationObserver(() => {
        // Re-inject Select interceptors if new rows appear
        installSelectInterceptors();
        // Re-inject Autofill button if it was removed by a re-render
        if (!document.querySelector('#lf_autofill_btn')) {
            injectButton();
        }
        // Re-apply the enlarged manual toggles — the form re-renders (Copy
        // Patient Information, validation bounces) recreate the checkboxes.
        enlargeManualToggles();
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();