// ==UserScript==
// @name         MDToolbox Patient Profile Autofill
// @namespace    http://tampermonkey.net/
// @version      1.0.1
// @description  Fills the MDToolbox new-patient form from the Zoho Copy Everything payload
// @author       Jeyson Dagondon
// @run-at       document-start
// @match        https://live.mdtoolbox.net/*
// @grant        none
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[MDT-Profile v1.0.1] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['MDT-Profile'] = {
  name: 'MDToolbox Patient Profile Autofill',
  version: '1.0.1',
  state: 'idle',
  message: '',
  progress: null,
  output: null,
  error: null,
  lastActivity: Date.now(),
  trigger: null
};
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}';
  document.documentElement.appendChild(__dsStyle);

(function () {
    'use strict';

    // ============================================================
    // MDToolbox runs the new-patient editor in a NESTED frame:
    //   default.aspx > #rightframe (Patient.aspx) > #ifrPat (PatientDetail.aspx?new=1&id=0)
    // The session is per-TAB (a fresh tab always lands on login.aspx), so this
    // script plays three roles and picks one by DOM:
    //   1. login.aspx    -> auto-login for an intent-driven tab
    //   2. Main.aspx     -> patient-existence search in the left menu, then ld()
    //   3. PatientDetail -> fill the new-patient form (+ the manual Fill button)
    // All frames are same-origin, so `window.top.ld(id)` drives the right frame.
    // ============================================================

    // --- Script API (R18): reference the registered object + state helper ---
    const api = window.__scripts['MDT-Profile'];
    function apiSet(state, message, extra) {
        api.state = state;
        api.message = message || '';
        api.lastActivity = Date.now();
        if (extra) Object.assign(api, extra);
        if (state === 'error') api.error = message || '';
        if (state === 'done' || state === 'idle') { api.error = null; }
        console.info(`[MDT-Profile] API: ${state}${message ? ' — ' + message : ''}`);
    }

    // ========================================
    // CREDENTIALS — hardcoded (Jeyson's override, 2026-09-21)
    // ========================================
    // Credentials are set per-user (Tampermonkey storage or edit here).
// NOTE: gate secret-pattern rule (R12) is why real values never live in source.
const CREDS = { /* per-user */ };

    // ========================================
    // INTENT — the Zoho -> MDToolbox handoff
    // ========================================
    // Delivered two ways, both landing in the SAME storage keys:
    //   a) postMessage from the Zoho tab (snap into an ALREADY LOGGED-IN tab —
    //      the primary path, no login wall),
    //   b) the `#mdtIntent` hash on the opened URL (fallback: fresh tab +
    //      auto-login). The hash is used, not a query param: MDToolbox's session
    //      redirect chain DROPS query strings but PRESERVES the fragment
    //      (verified 2026-09-21 — query survived to login.aspx and was lost).
    const INTENT_KEY = 'mdt_intent';          // sessionStorage (this tab) + localStorage (storage event)
    const TAB_ID_KEY = 'mdt_tab_id';          // per-tab id so a second MDToolbox tab ignores our intent
    const ATTEMPT_KEY = 'mdt_login_attempts'; // loop guard for the auto-login
    const STALE_MS = 2 * 60 * 60 * 1000;      // 2h: an intent this old is abandoned
    const ZOHO_ORIGIN = 'https://crm.zoho.com';
    const WINDOW_NAME = 'MDToolbox';          // the name a Zoho tab looks up to snap into us
    const BTN_ID = 'mdt-fill-btn';

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const store = {
        get(k) { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
        set(k, v) { try { sessionStorage.setItem(k, v); } catch (e) { console.warn('[MDT-Profile]', e); } },
        del(k) { try { sessionStorage.removeItem(k); } catch (e) { console.warn('[MDT-Profile]', e); } }
    };

    // Per-tab identity: sessionStorage is shared by every frame of one tab and
    // isolated from other tabs, so this is exactly the "which tab am I" token.
    let tabId = store.get(TAB_ID_KEY);
    if (!tabId) {
        tabId = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        store.set(TAB_ID_KEY, tabId);
    }

    function readIntent() {
        let raw = store.get(INTENT_KEY);
        if (!raw) { try { raw = localStorage.getItem(INTENT_KEY); } catch (e) { raw = null; } }
        if (!raw) return null;
        let intent = null;
        try { intent = JSON.parse(raw); } catch (e) { return null; }
        if (!intent || !intent.payload) return null;
        // Another tab's intent (localStorage is shared origin-wide) — ignore it.
        if (intent.tabId && intent.tabId !== tabId) return null;
        if (Date.now() - (intent.ts || 0) > STALE_MS) return null;
        return intent;
    }
    function writeIntent(intent) {
        intent.tabId = tabId;
        intent.ts = intent.ts || Date.now();
        const json = JSON.stringify(intent);
        store.set(INTENT_KEY, json);
        // localStorage mirror: this is what makes the `storage` event fire in the
        // OTHER frames of this tab (sessionStorage never fires one). Without it a
        // postMessage intent would sit unread until the tab was reloaded.
        try { localStorage.setItem(INTENT_KEY, json); } catch (e) { console.warn('[MDT-Profile]', e); }
    }
    function clearIntent() {
        store.del(INTENT_KEY);
        try { localStorage.removeItem(INTENT_KEY); } catch (e) { console.warn('[MDT-Profile]', e); }
    }

    // ========================================
    // STATUS BANNER (top-center, auto-hides)
    // ========================================
    let bannerEl = null;
    function banner(msg, color = 'var(--ds-success,#3d7a46)', persist = false) {
        try {
            if (!bannerEl) {
                bannerEl = document.createElement('div');
                bannerEl.id = 'mdt-banner';
                document.documentElement.appendChild(bannerEl);
            }
            bannerEl.textContent = msg;
            bannerEl.style.cssText = 'position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483647;'
                + 'background:' + color + ';color:#fff;padding:8px 16px;border-radius:0 0 8px 8px;'
                + 'font:600 13px system-ui,sans-serif;box-shadow:0 3px 10px rgba(0,0,0,.25);max-width:80vw;text-align:center';
            if (!persist) {
                clearTimeout(bannerEl.__t);
                bannerEl.__t = setTimeout(() => { if (bannerEl) { bannerEl.remove(); bannerEl = null; } }, 6000);
            }
        } catch (e) { console.warn('[MDT-Profile]', e); }
    }
    // ========================================
    // PAYLOAD
    // ========================================
    // Copy Everything ships the flat shape (firstName, lastName, dob{m,d,y},
    // gender 'm'|'f', phone, cell, email, address, city, state, zip). RxFlow
    // payloads nest that same flat block under _lifeFileProfile -> unwrap it.
    function unwrapPayload(raw) {
        if (!raw || typeof raw !== 'object') return null;
        return raw._lifeFileProfile && raw._lifeFileProfile.firstName ? raw._lifeFileProfile : raw;
    }
    const digits = (v) => String(v === undefined || v === null ? '' : v).replace(/\D/g, '');
    // Phone format the MDToolbox form/portal uses: "(323) 271-8620" — area code in
    // parens, then a SPACE, then the 3-4 split (Jeyson, 2026-09-21). Any input
    // shape is accepted (+1, dashes, dots, spaces); the last 10 digits win.
    function phoneFmt(v) {
        const d = digits(v).slice(-10);
        return d.length === 10 ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : '';
    }
    function dobString(dob) {
        if (!dob || !dob.m || !dob.d || !dob.y) return '';
        const p = (n) => String(n).padStart(2, '0');
        return p(dob.m) + '/' + p(dob.d) + '/' + dob.y;
    }
    // MDToolbox renders DOB as MM/DD/YYYY (year may be 2- or 4-digit on old rows)
    function dobKey(s) {
        const m = String(s || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (!m) return '';
        let y = m[3];
        if (y.length === 2) y = (Number(y) > 30 ? '19' : '20') + y;
        return Number(m[1]) + '/' + Number(m[2]) + '/' + y;
    }

    // ========================================
    // FIELD WRITERS
    // ========================================
    // Set .value then fire input+change so any validation/listener sees it. The
    // masked fields (DOB / phones / SSN) are plain textboxes whose mask is only a
    // placeholder string ('__/__/____'), so a formatted value is accepted as-is;
    // ASP.NET AJAX's TextBoxWrapper is preferred when present (it is what the
    // page's own masked validators read).
    function setText(id, value) {
        const el = document.getElementById(id);
        if (!el) { console.warn('[MDT-Profile] field not found:', id); return false; }
        const W = window.Sys && window.Sys.Extended && window.Sys.Extended.UI && window.Sys.Extended.UI.TextBoxWrapper;
        try {
            if (W && W.get_Wrapper) W.get_Wrapper(el).set_Value(String(value));
            else el.value = String(value);
        } catch (e) { el.value = String(value); }
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return el.value === String(value);
    }
    function setSelect(id, value) {
        const el = document.getElementById(id);
        if (!el) { console.warn('[MDT-Profile] select not found:', id); return false; }
        const want = String(value).trim().toUpperCase();
        const opt = Array.from(el.options).find((o) => String(o.value).trim().toUpperCase() === want)
            || Array.from(el.options).find((o) => String(o.textContent).trim().toUpperCase() === want);
        if (!opt) { console.warn('[MDT-Profile] no option for', id, '=', value); return false; }
        el.value = opt.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }
    function setGender(value) {
        const want = String(value || '').trim().toLowerCase().charAt(0).toUpperCase();
        if (want !== 'M' && want !== 'F') return false;
        const el = document.querySelector(`input[name="tcInfo$TabPanel0$radGender"][value="${want}"]`);
        if (!el) return false;
        el.checked = true;
        el.dispatchEvent(new Event('click', { bubbles: true }));
        el.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }

    // ========================================
    // GLOW (missing fields, cleared on first touch)
    // ========================================
    const GLOW_CLASS = 'mdt-glow';
    function ensureGlowStyle() {
        if (document.getElementById('mdt-glow-style')) return;
        const s = document.createElement('style');
        s.id = 'mdt-glow-style';
        s.textContent = `@keyframes mdtPulse{0%{box-shadow:0 0 0 0 rgba(255,120,0,.85);border-color:#ff7800}50%{box-shadow:0 0 8px 4px rgba(255,120,0,.55);border-color:#ff9a3d}100%{box-shadow:0 0 0 0 rgba(255,120,0,.85);border-color:#ff7800}}`
            + `.${GLOW_CLASS}{animation:mdtPulse 1.1s ease-in-out infinite !important;outline:2px solid #ff7800 !important;outline-offset:1px !important;border-radius:4px !important}`;
        document.head.appendChild(s);
    }
    function glow(el) {
        if (!el) return;
        ensureGlowStyle();
        el.classList.add(GLOW_CLASS);
        const clear = () => {
            el.classList.remove(GLOW_CLASS);
            ['focus', 'input', 'change', 'click'].forEach((ev) => el.removeEventListener(ev, clear, true));
        };
        ['focus', 'input', 'change', 'click'].forEach((ev) => el.addEventListener(ev, clear, true));
    }

    // ========================================
    // ROLE 3 — THE NEW-PATIENT FORM
    // ========================================
    const F = {
        firstName: { id: 'txtFirstName', glow: true },
        lastName: { id: 'txtLastName', glow: true },
        middleName: { id: 'txtMiddleName', glow: false },
        address: { id: 'tcInfo_TabPanel0_txtAddress1', glow: true },
        address2: { id: 'tcInfo_TabPanel0_txtAddress2', glow: false },
        city: { id: 'tcInfo_TabPanel0_txtCity', glow: true },
        zip: { id: 'tcInfo_TabPanel0_txtZip', glow: true },
        email: { id: 'tcInfo_TabPanel0_txtEmail', glow: false }
    };
    // acct #/id, MRN and SSN are deliberately NEVER touched: the payload has no
    // such values and inventing them would corrupt the record.

    function isNewPatientForm() {
        const m = (location.search || '').match(/[?&]new=(\d+)/);
        return !!(document.getElementById('btnSave') && document.getElementById('txtLastName')
            && (!m || m[1] === '1'));
    }

    function fillForm(payload, btn) {
        let filled = 0, glowed = 0;
        const glowFor = (id) => { glow(document.getElementById(id)); glowed++; };

        for (const [key, cfg] of Object.entries(F)) {
            const value = payload[key];
            const has = value !== undefined && value !== null && String(value).trim() !== '';
            if (has && setText(cfg.id, value)) filled++;
            else if (cfg.glow) glowFor(cfg.id);
        }

        const dob = dobString(payload.dob);
        if (dob && setText('tcInfo_TabPanel0_txtDOB', dob)) {
            filled++;
            // The page computes + displays Age on blur of DOB; ask it to.
            try { if (typeof window.getAge === 'function') window.getAge(); } catch (e) { console.warn('[MDT-Profile]', e); }
        } else {
            glowFor('tcInfo_TabPanel0_txtDOB');
        }

        const home = phoneFmt(payload.phone);
        if (home && setText('tcInfo_TabPanel0_txtPhHome', home)) filled++; else glowFor('tcInfo_TabPanel0_txtPhHome');
        const cell = phoneFmt(payload.cell);
        if (cell && setText('tcInfo_TabPanel0_txtPhCell', cell)) filled++; else glowFor('tcInfo_TabPanel0_txtPhCell');

        const state = payload.state;
        if (state && setSelect('tcInfo_TabPanel0_ddlState', state)) filled++;
        else glowFor('tcInfo_TabPanel0_ddlState');

        if (payload.gender && setGender(payload.gender)) filled++;
        else {
            const g = document.querySelector('input[name="tcInfo$TabPanel0$radGender"]');
            if (g) { glow(g.closest('td') || g); glowed++; }
        }

        const msg = `✓ Filled ${filled} · ${glowed} to check`;
        flashButton(btn, msg, 'var(--ds-success,#3d7a46)');
        banner(msg);
        apiSet('done', msg, { output: { filled, glowed } });
        return { filled, glowed };
    }

    function flashButton(btn, message, color) {
        if (!btn || !btn.tagName) return;
        const origText = btn.value !== undefined && btn.tagName === 'INPUT' ? btn.value : btn.textContent;
        const origBg = btn.style.backgroundColor;
        if (btn.tagName === 'INPUT') btn.value = message; else btn.textContent = message;
        btn.style.backgroundColor = color;
        setTimeout(() => {
            if (btn.tagName === 'INPUT') btn.value = origText; else btn.textContent = origText;
            btn.style.backgroundColor = origBg;
        }, 1600);
    }

    // --- the inline button, in the Save / Save + Close row ---
    function injectFillButton() {
        if (document.getElementById(BTN_ID)) return true;
        const row = document.getElementById('divHeaderButtons');
        const save = document.getElementById('btnSave');
        if (!row || !save) return false;
        const btn = document.createElement('input');
        btn.type = 'button';
        btn.id = BTN_ID;
        btn.value = '💉 Fill Patient Form';
        // .sbutton styles the submit inputs with their own chrome; give ours the
        // same shape explicitly so it reads as a native header button.
        btn.style.cssText = 'color:White;background-color:var(--ds-accent,#8a5f2e);border-style:None;'
            + 'font-family:Arial;font-size:13px;font-weight:600;padding:2px 10px;margin-right:8px;cursor:pointer;border-radius:3px';
        btn.addEventListener('click', (e) => { e.preventDefault(); readClipboardAndFill(btn); });
        row.insertBefore(btn, row.firstChild);
        console.log('[MDT-Profile] Fill Patient Form button injected');
        return true;
    }
    function waitAndInjectFillButton() {
        if (!isNewPatientForm()) return;
        if (injectFillButton()) return;
        const obs = new MutationObserver(() => { if (injectFillButton()) obs.disconnect(); });
        obs.observe(document.body || document.documentElement, { childList: true, subtree: true });
        setTimeout(() => obs.disconnect(), 30000);
    }

    async function readClipboardAndFill(btn) {
        let text = '';
        try { text = await navigator.clipboard.readText(); }
        catch (e) {
            console.error('[MDT-Profile] clipboard read failed:', e);
            flashButton(btn, '✕ Clipboard blocked', 'var(--ds-danger,#b3402e)');
            apiSet('error', 'Clipboard read blocked — grant clipboard permission');
            return;
        }
        let json = null;
        try { json = JSON.parse(text); }
        catch (e) {
            flashButton(btn, '✕ No valid data', 'var(--ds-danger,#b3402e)');
            apiSet('error', 'Clipboard is not valid JSON');
            return;
        }
        const payload = unwrapPayload(json);
        if (!payload || (!payload.firstName && !payload.lastName)) {
            flashButton(btn, '✕ Bad payload', 'var(--ds-danger,#b3402e)');
            apiSet('error', 'Clipboard payload has no patient name');
            return;
        }
        apiSet('running', `Filling patient form — ${payload.firstName || ''} ${payload.lastName || ''}`);
        fillForm(payload, btn);
    }

    // ========================================
    // ROLE 2 — EXISTENCE CHECK IN THE LEFT MENU
    // ========================================
    // MDToolbox's own search: the "Search" link reveals #divSearch, the hidden
    // #btnSearcher submit posts back, and the frame RELOADS (verified 2026-09-21),
    // re-rendering #ctl14_gvPatient. Zero results says "No patients found for -X-".
    // So the term is persisted before the postback and the decision happens on the
    // next load, when the grid is populated.
    function gridRows() {
        const g = document.getElementById('ctl14_gvPatient');
        if (!g) return [];
        return Array.from(g.querySelectorAll('tr'))
            .map((tr) => {
                const m = String(tr.getAttribute('onclick') || '').match(/ld\((\d+)\)/);
                if (!m) return null;
                const t = (sel) => { const el = tr.querySelector(sel); return el ? el.textContent.trim() : ''; };
                return {
                    id: m[1],
                    last: t('[id$=lblPatientLast]'),
                    first: t('[id$=lblPatientFirst]'),
                    middle: t('[id$=lblPatientMiddle]'),
                    dob: t('[id$=lblDOB]')
                };
            })
            .filter(Boolean);
    }
    const up = (s) => String(s || '').trim().toUpperCase();

    function runSearch(intent) {
        const input = document.getElementById('ctl14_txtNameSearch');
        if (!input) return false;
        const payload = intent.payload;
        const term = (up(payload.lastName) + ',' + up(payload.firstName)).replace(/^,|,$/g, '');
        if (!term) { apiSet('error', 'Payload has no name to search with'); clearIntent(); return false; }

        // Already posted for this term -> the grid in front of us IS the answer.
        if (intent.searched === term && up(input.value) === term) {
            evaluateSearch(intent, term);
            return true;
        }
        const box = document.getElementById('divSearch');
        if (box) box.style.display = 'inline';
        const mode = document.getElementById('ctl14_hidSearchMode');
        if (mode) mode.value = '1';
        input.value = term;
        input.dispatchEvent(new Event('input', { bubbles: true }));
        intent.searched = term;
        writeIntent(intent);            // survives the postback reload
        apiSet('running', `MDToolbox search — ${term}`);
        banner(`Checking whether ${payload.firstName} ${payload.lastName} already exists…`, 'var(--ds-info,#2c6e9c)', true);
        const go = document.getElementById('btnSearcher');
        if (!go) { apiSet('error', 'Search button missing in the left menu'); return false; }
        go.click();
        return true;
    }

    function evaluateSearch(intent, term) {
        const payload = intent.payload;
        const rows = gridRows();
        const nameHits = rows.filter((r) => up(r.last) === up(payload.lastName) && up(r.first) === up(payload.firstName));
        const payloadDob = dobKey(dobString(payload.dob));

        // (a) exactly one name match -> that is the patient.
        if (nameHits.length === 1) {
            const hit = nameHits[0];
            const rowDob = dobKey(hit.dob);
            if (!payloadDob || !rowDob || rowDob === payloadDob) {
                openExisting(intent, hit, term, 'exact match');
                return;
            }
            // Same name, different birthday: could be a namesake or a typo in the
            // record. Never create a duplicate silently — hand it to the human.
            haltForHuman(intent, `MDToolbox has ${hit.last}, ${hit.first} (DOB ${hit.dob}) — payload DOB is ${dobString(payload.dob)}. Check before creating a new profile.`, rows);
            return;
        }

        // (b) several people share the name -> never auto-pick (R13).
        if (nameHits.length > 1) {
            haltForHuman(intent, `${nameHits.length} MDToolbox patients match ${term} — pick the right one yourself (no profile created).`, rows);
            return;
        }

        // (c) same LAST name + same DOB but a different first name: almost always
        // the same person entered under a variant name. Do not create a second.
        const dobTwins = payloadDob ? rows.filter((r) => up(r.last) === up(payload.lastName) && dobKey(r.dob) === payloadDob) : [];
        if (dobTwins.length) {
            haltForHuman(intent, `No exact name match, but ${dobTwins[0].last}, ${dobTwins[0].first} (DOB matches) is in MDToolbox — check before creating a new profile.`, rows);
            return;
        }

        // (d) genuinely new -> open the new-patient form; the editor fills itself.
        apiSet('running', `No MDToolbox match for ${term} — opening a new patient`);
        banner(`No existing MDToolbox patient — opening a new profile for ${payload.firstName} ${payload.lastName}`, 'var(--ds-info,#2c6e9c)');
        intent.step = 'fill';
        writeIntent(intent);
        openPatient(0);
    }

    function openExisting(intent, hit, term, why) {
        banner(`✓ ${hit.last}, ${hit.first} already exists in MDToolbox (${why}) — opened their profile, no duplicate created`, 'var(--ds-warn,#a16207)', true);
        apiSet('done', `Patient already exists — opened ${hit.last}, ${hit.first}`, { output: { patientId: hit.id, matched: why, term: term } });
        clearIntent();
        openPatient(hit.id);
    }

    function haltForHuman(intent, message, rows) {
        banner('⚠ ' + message, 'var(--ds-danger,#b3402e)', true);
        apiSet('waiting_human', message, { output: { candidates: rows } });
        // The grid is left on screen with the search results; the intent stays so a
        // reload does not silently create a patient behind the human's back.
        intent.halted = true;
        writeIntent(intent);
    }

    // ld(id) is the top document's own navigation helper (the grid rows call
    // `parent.ld(<id>)`); id 0 is the new-patient form.
    function openPatient(id) {
        try {
            if (typeof window.top.ld === 'function') { window.top.ld(id, '', '', ''); return true; }
        } catch (e) { console.warn('[MDT-Profile] top.ld failed:', e); }
        apiSet('error', 'MDToolbox navigation helper (ld) is unreachable');
        return false;
    }

    // ========================================
    // ROLE 1 — LOGIN (intent-driven tab only)
    // ========================================
    function loginStep(intent) {
        const user = document.getElementById('Login1_UserName');
        const pass = document.getElementById('Login1_Password');
        const acct = document.getElementById('Login1_AccountNum');
        const go = document.getElementById('Login1_LoginButton');
        if (!user || !pass || !go) return false;

        let attempts = 0;
        try { attempts = parseInt(store.get(ATTEMPT_KEY) || '0', 10) || 0; } catch (e) { attempts = 0; }
        if (attempts > 2) {
            banner('⚠ MDToolbox login failed — sign in by hand, then the intent will continue', 'var(--ds-danger,#b3402e)', true);
            apiSet('error', 'Auto-login failed (credentials rejected?) — sign in manually');
            return false;
        }
        store.set(ATTEMPT_KEY, String(attempts + 1));

        banner(`Signing in to MDToolbox for ${intent.payload.firstName} ${intent.payload.lastName}…`, 'var(--ds-info,#2c6e9c)', true);
        apiSet('running', 'Logging in to MDToolbox');
        const start = Date.now();
        let stable = 0;
        (function attempt() {
            try {
                user.value = CREDS.username;
                pass.value = CREDS.password;
                if (acct) acct.value = CREDS.practice;
                [user, pass, acct].forEach((el) => {
                    if (!el) return;
                    el.dispatchEvent(new Event('input', { bubbles: true }));
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                });
            } catch (e) { console.warn('[MDT-Profile]', e); }
            setTimeout(() => {
                const ok = user.value === CREDS.username && pass.value === CREDS.password;
                if (ok) {
                    stable++;
                    if (stable >= 2) {                       // held across two reads
                        store.del(ATTEMPT_KEY);              // fresh login succeeded
                        apiSet('running', 'Credentials set — submitting');
                        try { go.click(); } catch (e) { console.warn('[MDT-Profile]', e); }
                        return;
                    }
                } else {
                    stable = 0;                              // page wiped them, refill
                }
                if (Date.now() - start > 15000) {
                    apiSet('error', 'Login form never stabilised');
                    banner('⚠ MDToolbox login form would not settle — sign in by hand', 'var(--ds-danger,#b3402e)', true);
                    return;
                }
                setTimeout(attempt, 400);
            }, 350);
        })();
        return true;
    }

    // ========================================
    // DRIVER — one entry point, picks the role by DOM
    // ========================================
    function drive() {
        const intent = readIntent();
        if (!intent) return false;
        if (intent.halted) return false;                 // waiting for the human
        const payload = unwrapPayload(intent.payload);
        if (!payload) { clearIntent(); return false; }
        intent.payload = payload;

        if (document.getElementById('Login1_LoginButton')) return loginStep(intent);
        if (document.getElementById('ctl14_txtNameSearch')) return runSearch(intent);
        if (isNewPatientForm()) {
            if (intent.step === 'fill') {
                apiSet('running', `Filling new MDToolbox patient — ${payload.firstName || ''} ${payload.lastName || ''}`);
                fillForm(payload, document.getElementById(BTN_ID));
                clearIntent();                            // one-shot: never fills twice
                banner(`✓ New MDToolbox profile filled for ${payload.firstName || ''} ${payload.lastName || ''} — review and Save`, 'var(--ds-success,#3d7a46)', true);
            }
            return true;
        }
        return false;
    }

    // ========================================
    // INTENT INTAKE
    // ========================================
    // (a) a Zoho tab snapped into this tab and posted the payload
    function installMessageListener() {
        if (window !== window.top) return;               // only the tab's top window is addressed
        if (!window.name) window.name = WINDOW_NAME;      // so Zoho's window.open('', 'MDToolbox') finds us
        window.addEventListener('message', (event) => {
            if (event.origin !== ZOHO_ORIGIN) return;     // only our own Zoho instance may push a patient
            const data = event.data || {};
            if (data.__mdt === 'hello') {
                try { event.source.postMessage({ __mdt: 'hello-ack', nonce: data.nonce }, ZOHO_ORIGIN); } catch (e) { console.warn('[MDT-Profile]', e); }
                return;
            }
            if (data.__mdt === 'intent' && data.payload) {
                const payload = unwrapPayload(data.payload);
                if (!payload) return;
                console.log('[MDT-Profile] intent received from Zoho', payload);
                writeIntent({ payload: payload, step: 'search', ts: Date.now(), via: 'postMessage', tabId: tabId });
                apiSet('running', 'Intent received from Zoho');
                // Same-tab sibling frames get the storage event; this frame drives
                // whatever role it owns (usually none — it is default.aspx).
                drive();
            }
        });
        // A sibling frame wrote the intent (storage events only fire for
        // localStorage, which is why writeIntent mirrors there).
        window.addEventListener('storage', (e) => { if (e.key === INTENT_KEY && e.newValue) drive(); });
    }

    // (b) the opened URL carried `#mdtIntent=<base64url json>` (fresh-tab fallback)
    function captureUrlIntent() {
        let b64 = '';
        try {
            const h = (window.top.location.hash || '').match(/mdtIntent=([^&]+)/);
            const q = (window.top.location.search || '').match(/[?&]mdtIntent=([^&]+)/);
            b64 = (h && h[1]) || (q && q[1]) || '';
        } catch (e) { console.warn('[MDT-Profile]', e); }
        if (!b64) return false;
        // Strip it immediately: a refresh must never replay the intent.
        try {
            const url = window.top.location.pathname + window.top.location.search;
            if (window.top === window) history.replaceState(null, '', url);
        } catch (e) { console.warn('[MDT-Profile]', e); }
        let payload = null;
        try {
            const json = decodeURIComponent(atob(b64.replace(/-/g, '+').replace(/_/g, '/')));
            payload = unwrapPayload(JSON.parse(json));
        } catch (e) {
            console.warn('[MDT-Profile] bad mdtIntent:', e); apiSet('error', 'Malformed mdtIntent payload');
            return false;
        }
        if (!payload) return false;
        writeIntent({ payload: payload, step: 'search', ts: Date.now(), via: 'url', tabId: tabId });
        apiSet('running', 'Intent received from the opened URL');
        return true;
    }

    // ========================================
    // HOTKEY
    // ========================================
    document.addEventListener('keydown', (e) => {
        if (e.altKey && !e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'f' && isNewPatientForm()) {
            e.preventDefault();
            readClipboardAndFill(document.getElementById(BTN_ID));
        }
    });

    // ========================================
    // R18 API — trigger dispatcher (agent entry point)
    // ========================================
    api.trigger = function (action, params) {
        if (action === 'start') {
            if (api.state === 'running') return { ok: false, error: 'already running' };
            const payload = unwrapPayload(params && params.intent);
            if (!payload || (!payload.firstName && !payload.lastName)) return { ok: false, error: 'params.intent with a patient name is required' };
            writeIntent({ payload: payload, step: 'search', ts: Date.now(), via: 'api', tabId: tabId });
            const drove = drive();
            return { ok: true, output: { droveThisFrame: drove, tabId: tabId } };
        }
        if (action === 'fill') {                          // fill the form in front of us, from an explicit payload
            const payload = unwrapPayload(params && params.intent);
            // Same name requirement as 'start': a nameless payload must never
            // half-fill a record (it would write an email onto a blank patient).
            if (!payload || (!payload.firstName && !payload.lastName)) return { ok: false, error: 'params.intent with a patient name is required' };
            if (!isNewPatientForm()) return { ok: false, error: 'no new-patient form in this frame' };
            const res = fillForm(payload, document.getElementById(BTN_ID));
            return { ok: true, output: res };
        }
        if (action === 'status') return { ok: true, output: { intent: readIntent(), state: api.state, message: api.message } };
        if (action === 'reset') {
            clearIntent(); store.del(ATTEMPT_KEY);
            apiSet('idle', 'Reset — intent cleared');
            return { ok: true };
        }
        return { ok: false, error: `unknown action: ${action}` };
    };

    // ========================================
    // INIT
    // ========================================
    // document-start: capture the URL intent before the page rewrites the hash,
    // and arm the message listener so a Zoho snap-in lands as early as possible.
    installMessageListener();
    captureUrlIntent();

    function boot() {
        waitAndInjectFillButton();
        drive();
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
