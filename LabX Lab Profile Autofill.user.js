// ==UserScript==
// @name         LabX Lab Profile Autofill
// @namespace    http://tampermonkey.net/
// @version      1.9
// @description  LabX New Patient form autofill from Zoho lab intent (passive)
// @author       Jeyson Dagondon
// @match        https://portal.labx.example.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[LabX v1.9] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['LabX'] = { name: 'LabX Lab Profile Autofill', version: '1.9', state: 'idle', message: 'Loaded', output: null, error: null, lastActivity: Date.now(), trigger: null };
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}';
  document.documentElement.appendChild(__dsStyle);

(function () {
    'use strict';

    // ========================================
    // CONFIG
    // ========================================
    // Credentials are set per-user (Tampermonkey storage or edit here).
// NOTE: gate secret-pattern rule (R12) is why real values never live in source.
const CREDS = { /* per-user */ };

    const INTENT_KEY = 'labx-lab-intent';
    const INTENT_MAX_AGE_MS = 2 * 60 * 60 * 1000; // R9 resume window: intents older than 2h are dead and self-clear
    const PATIENT_ADD_PATH = '/LabOrder/PatientAdd';
    const LOGON_PATH = '/Account/Logon';

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // ========================================
    // STATUS BANNER (top-center, auto-dismiss)
    // ========================================
    let statusEl = null;
    function status(msg, color = '#0a8754', persist = false) {
        if (!statusEl) {
            statusEl = document.createElement('div');
            statusEl.id = 'labx-lab-status';
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
        // stop the flow without editing code (v1.3).
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
    // The Zoho orchestrator carries the extracted payload in the opened URL as
    // a base64url `labIntent` param. We persist it to localStorage so it survives
    // the login redirect and the manual navigation to the New Patient page.
    // ========================================
    function readUrlIntent() {
        const m = location.search.match(/[?&]labIntent=([^&]+)/);
        if (!m) return null;
        try {
            return JSON.parse(decodeURIComponent(atob(m[1].replace(/-/g, '+').replace(/_/g, '/'))));
        } catch (e) { return null; }
    }
    function loadIntent() {
        try { return JSON.parse(localStorage.getItem(INTENT_KEY)); } catch (e) { return null; }
    }
    function saveIntent(it) {
        try { localStorage.setItem(INTENT_KEY, JSON.stringify({ ...it, _ts: Date.now() })); } catch(e) { console.warn('[LabX]', e); }
    }
    function clearIntent() {
        try { localStorage.removeItem(INTENT_KEY); } catch(e) { console.warn('[LabX]', e); }
    }

    // ========================================
    // SESSION MODAL (Stay Logged In / Go To Login)
    // ========================================
    function dismissSessionModal() {
        const btn = [...document.querySelectorAll('button')].find((b) => {
            const t = (b.textContent || '').trim().toLowerCase();
            return t === 'stay logged in' && b.offsetParent !== null;
        });
        if (btn) { btn.click(); return true; }
        return false;
    }
    // Keep watching briefly — the modal pops up when the session is about to
    // expire mid-flow; clicking Stay Logged In keeps the automation alive.
    function watchSessionModal() {
        let quiet = 0;
        const iv = setInterval(() => {
            if (dismissSessionModal()) quiet = 0; else quiet++;
            if (quiet > 25) clearInterval(iv); // ~75s of no modal -> stop watching
        }, 3000);
    }

    // ========================================
    // DOM HELPERS
    // ========================================
    function setInputValue(el, value) {
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
    async function waitForEl(selector, timeout = 15000) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const el = document.querySelector(selector);
            if (el) return el;
            await sleep(200);
        }
        return null;
    }
    // "ex: (123) 456-7890" — match the portal's example format.
    function formatPhone(digits) {
        const d = String(digits || '').replace(/\D/g, '');
        if (d.length !== 10) return '';
        return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
    }

    // ========================================
    // GLOW (missing required fields -> orange pulse)
    // ========================================
    function ensureGlowStyle() {
        if (document.getElementById('labx-glow-style')) return;
        const s = document.createElement('style');
        s.id = 'labx-glow-style';
        s.textContent = `
            @keyframes labxGlowPulse {
                0%   { box-shadow: 0 0 0 0 rgba(255,120,0,0.85); border-color: #ff7800; }
                50%  { box-shadow: 0 0 8px 4px rgba(255,120,0,0.55); border-color: #ff9a3d; }
                100% { box-shadow: 0 0 0 0 rgba(255,120,0,0.85); border-color: #ff7800; }
            }
            .labx-glow {
                animation: labxGlowPulse 1.1s ease-in-out infinite !important;
                outline: 2px solid #ff7800 !important;
                outline-offset: 1px !important;
                border-radius: 4px !important;
            }
        `;
        document.head.appendChild(s);
    }
    function glow(el) {
        if (!el) return;
        el.classList.add('labx-glow');
        el.addEventListener('input', () => el.classList.remove('labx-glow'), { once: true });
        el.addEventListener('change', () => el.classList.remove('labx-glow'), { once: true });
    }

    // ========================================
    // FILL NEW PATIENT FORM
    // ========================================
    const FIELD_MAP = [
        { key: 'firstName', id: 'patient_FirstName',      label: 'First Name', glow: true },
        { key: 'lastName',  id: 'patient_LastName',       label: 'Last Name',  glow: true },
        { key: 'address',   id: 'patient_StreetAddress',  label: 'Street',     glow: true },
        { key: 'city',      id: 'patient_City',           label: 'City',       glow: true },
        { key: 'state',     id: 'patient_State',          label: 'State',      glow: true, select: true },
        { key: 'zip',       id: 'patient_PostalCode',     label: 'ZIP',        glow: true },
        { key: 'email',     id: 'patient_EmailAddress',   label: 'Email',      glow: true },
        { key: 'phone',     id: 'phone',                  label: 'Phone',      glow: true },
        { key: 'gender',    id: 'patient_Gender',         label: 'Gender',     glow: true, select: true, gender: true }
    ];
    const DOB_IDS = { m: 'patient_DOBMonth', d: 'patient_DOBDay', y: 'patient_DOBYear' };

    async function fillPatientForm(intent) {
        const form = await waitForEl('#patient_FirstName');
        if (!form) { status('New Patient form did not load.', '#b3261e', true); return; }
        ensureGlowStyle();

        const filled = [];
        for (const f of FIELD_MAP) {
            const el = document.getElementById(f.id);
            if (!el) continue;

            let val = intent[f.key];
            if (f.key === 'phone') {
                val = formatPhone(intent.phone || intent.cell);
            } else if (f.key === 'gender') {
                val = intent.gender ? String(intent.gender).toUpperCase() : ''; // f -> F, m -> M
            }

            if (f.select) {
                if (val && setSelectValue(el, val)) { filled.push(f.label); continue; }
            } else if (val) {
                setInputValue(el, val);
                filled.push(f.label);
                continue;
            }

            if (f.glow) glow(el); // required but missing in the payload
        }

        // DOB (month/day/year selects — month/day are zero-padded, year is 4-digit)
        if (intent.dob && intent.dob.m && intent.dob.d && intent.dob.y) {
            const pad2 = (n) => String(n).padStart(2, '0');
            const ok = setSelectValue(document.getElementById(DOB_IDS.m), pad2(intent.dob.m))
                && setSelectValue(document.getElementById(DOB_IDS.d), pad2(intent.dob.d))
                && setSelectValue(document.getElementById(DOB_IDS.y), intent.dob.y);
            if (ok) filled.push('DOB');
        }

        // City is only auto-filled from a clean comma-separated address; when it
        // couldn't be split out it is glowed as a manual-entry reminder.
        const cityEl = document.getElementById('patient_City');
        const cityGlowed = cityEl && cityEl.classList.contains('labx-glow');
        const cityNote = cityGlowed ? ' City needs manual entry (orange field).' : '';

        status(`Filled: ${filled.join(', ') || 'nothing'}. Review, then click Create Patient.${cityNote}`, '#0a8754', true);

        // One-shot: the script's job is pasting the patient data — done. Clear the
        // intent so the portal goes passive (no more auto-login/redirect on every
        // load). v1.2 never cleared it, which is why it looped forever.
        clearIntent();
    }

    // ========================================
    // AUTO-LOGIN (login page)
    // ========================================
    async function doLogin() {
        status('Auto-logging in to LabX...');
        const user = await waitForEl('#UserName');
        const pass = await waitForEl('#Password');
        const btn = await waitForEl('#btnLogon');
        if (!user || !pass || !btn) { status('Login form did not load.', '#b3261e', true); return; }
        setInputValue(user, CREDS.username);
        setInputValue(pass, CREDS.password);
        await sleep(300);
        btn.click(); // POST navigates away; the next page's router continues
    }

    // ========================================
    // ROUTER (runs on every portal page load)
    // ========================================
    async function run() {
        const urlIntent = readUrlIntent();
        const persisted = loadIntent();

        // Intent freshness (v1.3): a URL intent from Zoho is fresh by definition;
        // a persisted intent is only honored within the 2h resume window and is
        // cleared when stale — so a leftover intent can never resurrect the
        // auto-login/redirect loop on a later visit. Only fresh URL intents may
        // re-stamp _ts (v1.2 re-stamped on every load, so nothing ever expired).
        let intent = urlIntent || persisted;
        if (!urlIntent && intent) {
            if (Date.now() - (intent._ts || 0) > INTENT_MAX_AGE_MS) {
                clearIntent();
                intent = null;
            }
        }
        if (urlIntent) saveIntent(urlIntent);

        const path = location.pathname;

        // Login page: auto-login whenever a lab intent is pending, then let the
        // redirect land on the dashboard, where the router continues to PatientAdd.
        if (path.indexOf(LOGON_PATH) === 0) {
            if (intent) await doLogin();
            return;
        }

        if (intent) {
            if (path.indexOf(PATIENT_ADD_PATH) === 0) {
                await fillPatientForm(intent);
            } else {
                // Logged-in landing page (Dashboard etc.) with a pending intent -> New Patient
                location.href = PATIENT_ADD_PATH;
            }
        }
    }

    // Boot: dismiss any session modal, then route.
    setTimeout(() => { dismissSessionModal(); watchSessionModal(); run(); }, 600);
})();
