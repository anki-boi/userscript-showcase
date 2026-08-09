// ==UserScript==
// @name         RxFlow Lab Profile Autofill
// @namespace    http://tampermonkey.net/
// @version      1.4.6
// @description  Fills RxFlow Add Patient form from Zoho lab intent; one-shot, passive
// @author       Jeyson Dagondon
// @match        https://staff.exampleclinic.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[PRX-Autofill v1.4.6] boot');
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}';
  document.documentElement.appendChild(__dsStyle);

(function () {
    'use strict';

    // ========================================
    // CONFIG
    // ========================================
    const INTENT_KEY = 'rxflow-lab-intent';
    const DASHBOARD_PATH = '/dashboard';
    const ADD_PATIENT_PREFIX = '/add-patient';
    const INTENT_TTL = 15 * 60 * 1000; // 15 min
    const BOUNCE_KEY = 'presc-lab-bounces';
    const MAX_BOUNCES = 3; // redirect-fight guard: stop instead of looping

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const pad2 = (n) => String(n).padStart(2, '0');

    // ========================================
    // STATUS BANNER
    // ========================================
    let statusEl = null;
    function status(msg, color = '#0a8754', persist = false) {
        if (!statusEl) {
            statusEl = document.createElement('div');
            statusEl.id = 'rxflow-lab-status';
            statusEl.style.cssText = `
                position: fixed; top: 14px; left: 50%; transform: translateX(-50%);
                z-index: 2147483647; padding: 12px 20px; border-radius: 8px;
                font-family: system-ui, sans-serif; font-size: 15px; font-weight: 700;
                box-shadow: 0 4px 16px rgba(0,0,0,0.25); pointer-events: none;
                text-align: center; max-width: 86vw; color: #fff;
            `;
            document.body.appendChild(statusEl);
        }
        statusEl.textContent = msg;
        // ✕ kill switch: clears any pending lab intent so a stuck co-worker can
        // stop the steering immediately without editing code (v1.4).
        const x = document.createElement('span');
        x.textContent = ' ✕';
        x.style.cssText = 'pointer-events:auto; cursor:pointer; margin-left:10px; font-size:14px; opacity:.85; user-select:none;';
        x.title = 'Cancel pending lab profile fill';
        x.addEventListener('click', () => { clearIntent(); statusEl.style.display = 'none'; });
        statusEl.appendChild(x);
        statusEl.style.background = (color === 'red' || color === '#b3261e') ? 'var(--ds-danger,#b3261e)' : 'var(--ds-success,#0a8754)';
        statusEl.style.display = 'block';
        if (!persist) {
            clearTimeout(statusEl._t);
            statusEl._t = setTimeout(() => { statusEl.style.display = 'none'; }, 5000);
        }
    }

    // ========================================
    // INTENT (URL param -> localStorage)
    // ========================================
    function readUrlIntent() {
        const m = location.search.match(/[?&]labIntent=([^&]+)/);
        if (!m) return null;
        try {
            return JSON.parse(decodeURIComponent(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
        } catch (e) { return null; }
    }
    function loadIntent() {
        try {
            const s = localStorage.getItem(INTENT_KEY);
            if (!s) return null;
            const it = JSON.parse(s);
            if (!it || !it._ts || Date.now() - it._ts > INTENT_TTL) {
                localStorage.removeItem(INTENT_KEY); // stale -> clear (v1.3)
                return null;
            }
            return it;
        } catch (e) { return null; }
    }
    function saveIntent(it) {
        try { localStorage.setItem(INTENT_KEY, JSON.stringify({ ...it, _ts: Date.now() })); } catch(e) { console.warn('[PRX-Autofill]', e); }
    }
    function clearIntent() {
        try { localStorage.removeItem(INTENT_KEY); } catch(e) { console.warn('[PRX-Autofill]', e); }
    }

    // ========================================
    // LOGIN / REDIRECT-FIGHT GUARDS (v1.3)
    // ========================================
    function isLoginPage() {
        const p = (location.pathname || '').toLowerCase();
        if (p.indexOf('login') !== -1 || p.indexOf('signin') !== -1 || p.indexOf('/auth') !== -1) return true;
        // Fallback (v1.4.1): a VISIBLE password field with NO logged-in chrome
        // means an auth form. The logged-in dashboard renders hidden password/
        // email inputs in a template widget, so visibility + absence of
        // logout/form-button/nav is required — a naive `input[type=password]`
        // check false-positived on the dashboard and blocked the whole flow.
        const pw = document.querySelector('input[type="password"]');
        if (!pw) return false;
        const r = pw.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return false;
        return !document.querySelector('#logout-form, form#logout-form, button.form-button, nav, [class*="sidebar"]');
    }
    function getBounces() { try { return parseInt(sessionStorage.getItem(BOUNCE_KEY) || '0', 10) || 0; } catch (e) { return 0; } }
    function bumpBounces() { const n = getBounces() + 1; try { sessionStorage.setItem(BOUNCE_KEY, String(n)); } catch(e) { console.warn('[PRX-Autofill]', e); } return n; }
    function resetBounces() { try { sessionStorage.removeItem(BOUNCE_KEY); } catch(e) { console.warn('[PRX-Autofill]', e); } }

    // ========================================
    // DOM HELPERS
    // ========================================
    function setNativeValue(el, value) {
        if (!el) return;
        const proto = (el.tagName === 'TEXTAREA')
            ? window.HTMLTextAreaElement.prototype
            : window.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, 'value');
        desc.set.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function setSelectValue(el, value) {
        if (!el) return false;
        const opt = [...el.options].find((o) => o.value === String(value));
        if (!opt) return false;
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }
    // v1.4.1: the page renders an async checkbox filter widget whose ids collide
    // with the form's (e.g. #first_name is a checkbox there). getElementById can
    // hit the widget and "fill" an invisible checkbox — the field never shows a
    // value (the "didn't paste name/number/DOB" incident). Target the real
    // inputs only: same id but NOT a checkbox or hidden input.
    function getField(id) {
        const exact = document.querySelector(`#${id}:not([type="checkbox"]):not([type="hidden"])`);
        return exact || document.getElementById(id);
    }
    // This site renders EVERYTHING asynchronously — waitFor accepts either a CSS
    // selector or a predicate function, and polls until the element is real.
    async function waitFor(sel, timeout = 20000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            let el;
            if (typeof sel === 'function') {
                try { el = sel(); } catch (e) { el = null; }
            } else {
                el = document.querySelector(sel);
            }
            if (el) return el;
            await sleep(250);
        }
        return null;
    }

    // ========================================
    // GLOW (missing required fields -> orange pulse)
    // ========================================
    function ensureGlowStyle() {
        if (document.getElementById('rxflow-lab-glow-style')) return;
        const s = document.createElement('style');
        s.id = 'rxflow-lab-glow-style';
        s.textContent = `
            @keyframes labGlowPulse {
                0%   { box-shadow: 0 0 0 0 rgba(255,120,0,0.85); border-color: #ff7800; }
                50%  { box-shadow: 0 0 8px 4px rgba(255,120,0,0.55); border-color: #ff9a3d; }
                100% { box-shadow: 0 0 0 0 rgba(255,120,0,0.85); border-color: #ff7800; }
            }
            .lab-glow {
                animation: labGlowPulse 1.1s ease-in-out infinite !important;
                outline: 2px solid #ff7800 !important;
                outline-offset: 1px !important;
                border-radius: 4px !important;
            }
        `;
        document.head.appendChild(s);
    }
    function glow(el) {
        if (!el) return;
        el.classList.add('lab-glow');
        el.addEventListener('input', () => el.classList.remove('lab-glow'), { once: true });
        el.addEventListener('change', () => el.classList.remove('lab-glow'), { once: true });
    }

    // ========================================
    // FILL THE ADD PATIENT FORM
    // ========================================
    async function fillForm(intent) {
        const fn = await waitFor(() => getField('first_name'));
        if (!fn) { status('Add Patient form did not load.', '#b3261e', true); return; }
        // The selects populate asynchronously — wait for real options before
        // filling, or setSelectValue silently misses (caught live).
        await waitFor(() => {
            const s = getField('state');
            const g = getField('gender');
            return s && s.options.length > 1 && g && g.options.length > 1;
        }, 20000);
        ensureGlowStyle();

        const filled = [];
        const missing = [];

        // Straight text/email/number fields
        const textMap = [
            { id: 'first_name',  label: 'First Name', val: intent.firstName },
            { id: 'last_name',   label: 'Last Name',  val: intent.lastName },
            { id: 'email',       label: 'Email',      val: intent.email },
            { id: 'postal_code', label: 'Postal Code', val: intent.zip },
            { id: 'city',        label: 'City',       val: intent.city },
            { id: 'mobile',      label: 'Mobile',     val: intent.phone || intent.cell },
            { id: 'address_line1', label: 'Address 1', val: intent.address }
        ];

        // v1.4: wait for ALL mapped fields — they mount asynchronously, often in
        // waves, and filling into a half-mounted form silently skipped the late
        // fields (name/phone/DOB came up empty in a re-render race). If some
        // never appear, they're listed as manual entries instead of skipped.
        await waitFor(() => textMap.every((f) => getField(f.id)), 20000);
        for (const f of textMap) {
            const el = getField(f.id);
            if (!el) { missing.push(f.label); continue; }
            if (f.val) { setNativeValue(el, f.val); filled.push(f.label); }
            else if (f.id === 'city' || f.id === 'postal_code' || f.id === 'mobile' || f.id === 'address_line1' || f.id === 'first_name' || f.id === 'last_name') glow(el);
        }

        // DOB -> MM-DD-YYYY
        if (intent.dob && intent.dob.m && intent.dob.d && intent.dob.y) {
            const dobEl = getField('dob');
            if (dobEl) {
                setNativeValue(dobEl, `${pad2(intent.dob.m)}-${pad2(intent.dob.d)}-${intent.dob.y}`);
                filled.push('DOB');
            }
        } else {
            glow(getField('dob'));
        }

        // Gender (payload f/m -> male/female)
        const genderEl = getField('gender');
        if (intent.gender) {
            const gval = String(intent.gender).toLowerCase() === 'm' ? 'male' : 'female';
            if (setSelectValue(genderEl, gval)) filled.push('Gender');
            else glow(genderEl);
        } else {
            glow(genderEl);
        }

        // State (payload carries the full name now, e.g. "Indiana")
        const stateEl = getField('state');
        if (intent.stateFullName && setSelectValue(stateEl, intent.stateFullName)) filled.push('State');
        else glow(stateEl);

        // Country -> United States (only option)
        if (setSelectValue(getField('country'), 'us')) filled.push('Country');

        // Shipping: "Same as Billing" is triggered when the City field becomes
        // non-empty and loses focus — the moment the billing address is finalized.
        // If City was auto-filled it's already populated (and not focused), so it
        // triggers immediately; if City needs manual entry, the checkbox stays off
        // until the user types it and tabs/blurs out.
        const cityEl = getField('city');
        const sab = document.getElementById('sameAsBilling');
        const checkSameAsBilling = () => {
            if (sab && !sab.checked && cityEl && cityEl.value.trim() !== '') {
                sab.click();
                filled.push('Same as Billing');
            }
        };
        if (cityEl) {
            cityEl.addEventListener('blur', checkSameAsBilling);
            cityEl.addEventListener('change', checkSameAsBilling);
        }
        if (cityEl && cityEl.value.trim() !== '') checkSameAsBilling();

        // Emergency contact is required but never in the payload -> glow all of it
        ['emergency_name', 'emergency_email', 'emergency_age', 'emergency_contact_number', 'emergency_gender', 'emergency_relation']
            .forEach((id) => glow(document.getElementById(id)));

        const manual = (cityEl && cityEl.classList.contains('lab-glow')) ? ' City needs manual entry — Same as Billing triggers once you type it and tab out.' : '';
        const missNote = missing.length ? ` Could not find these fields — fill manually: ${missing.join(', ')}.` : '';
        status(`Filled: ${filled.join(', ') || 'nothing'}. Review, then click Create. Emergency contact needs manual entry.${manual}${missNote}`, '#0a8754', true);

        // v1.4 one-shot: a complete fill clears the intent so a refresh never
        // steers back into patient creation. A partial fill keeps it (15-min TTL)
        // for a retry, but the form's submit ALSO clears it — the moment Create
        // is clicked the flow goes passive, whatever filled.
        if (missing.length === 0) clearIntent();
        const formEl = document.querySelector('form');
        if (formEl) formEl.addEventListener('submit', () => clearIntent(), { once: true });
    }

    // ========================================
    // ROUTER
    // ========================================
    async function run() {
        const urlIntent = readUrlIntent();
        const persisted = loadIntent();
        // Fresh URL intents from Zoho re-stamp _ts; persisted intents keep their
        // original timestamp so the 15-min TTL actually expires (v1.2 re-stamped
        // on every load, so a pending intent never aged out).
        let intent = urlIntent || persisted;
        if (urlIntent) saveIntent(urlIntent);

        if (!intent) return; // passive unless a lab intent is present
        if (urlIntent) resetBounces(); // brand-new run from Zoho

        const path = location.pathname;

        // Logged-out guard: bouncing the login page to /dashboard makes the app's
        // auth redirect fight the script (redirect loop). Stop with a hint instead.
        if (isLoginPage()) {
            status('Log in to RxFlow first, then re-run Create Lab Profile from Zoho.', '#b3261e', true);
            return;
        }

        if (path.indexOf(ADD_PATIENT_PREFIX) === 0) {
            await fillForm(intent);
        } else if (path === DASHBOARD_PATH || path === DASHBOARD_PATH + '/') {
            // Under the "Add Patient" header, click "Form" — but the button
            // renders async, so wait for it (this site renders everything late).
            status('Opening Add Patient form...');
            const formBtn = await waitFor(() => [...document.querySelectorAll('button')].find((b) => {
                const t = (b.textContent || '').trim();
                return t === 'Form' && (b.className || '').toString().indexOf('form-button') !== -1;
            }), 25000);
            if (formBtn) {
                formBtn.click();
                await fillForm(intent); // waits for #first_name whether it's a router push or a reload
            } else {
                status('Add Patient "Form" button did not load.', '#b3261e', true);
            }
        } else {
            // Any other page with a pending intent -> go to the dashboard. Bounce
            // guard: stop after MAX_BOUNCES so an app redirect fight never loops.
            if (bumpBounces() > MAX_BOUNCES) {
                status('Could not reach the Add Patient form — please open it manually, then re-run Create Lab Profile from Zoho.', '#b3261e', true);
                return;
            }
            location.href = DASHBOARD_PATH;
        }
    }

    setTimeout(() => run(), 800);
})();
