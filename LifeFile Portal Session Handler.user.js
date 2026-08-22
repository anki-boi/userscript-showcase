// ==UserScript==
// @name         LifeFile Portal Session Handler
// @namespace    http://tampermonkey.net/
// @version      1.25
// @description  LifeFile pharmacy portal driver for Zoho's Run LifeFile Sale intent (passive)
// @author       Jeyson Dagondon
// @match        https://hostB.lifefile.net/*
// @match        https://hostA.lifefile.net/*
// @match        https://hostC.lifefile.net:8443/*
// @match        https://hostD.lifefile.net/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[LF-Session v1.25] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['LF-Session'] = { name: 'LifeFile Portal Session Handler', version: '1.25', state: 'idle', message: 'Loaded', output: null, error: null, lastActivity: Date.now(), trigger: null };
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}';
  document.documentElement.appendChild(__dsStyle);

(function () {
    'use strict';

    // ========================================
    // CREDENTIALS — hardcoded (Jeyson's override, 2026-08-04)
    // ========================================
    // v1.15 stored these in Tampermonkey GM storage with auto-prompt onboarding
    // (8 popups + a "Set LifeFile credentials..." menu command); Jeyson chose to
    // hardcode them instead — the popups were friction for non-technical
    // Credentials are set per-user (Tampermonkey storage or edit here).
// NOTE: gate secret-pattern rule (R12) is why real values never live in source.
const CREDS = { /* per-user */ };

    // Cross-origin intent key. Carried from Zoho in the opened URL as the `lfSale`
    // param, then persisted to localStorage + sessionStorage (GM storage is
    // per-script and won't share between the Zoho and portal scripts), so the flow
    // survives the Zoho -> portal tab switch with no user gesture needed.
    const SESSION_INTENT_KEY = 'lf_sale_intent';
    // Loop guard so a stuck session never spins forever.
    const ATTEMPT_KEY = 'lf_session_attempts';
    // Set once the login handoff is done so we don't re-drive (and re-logout)
    // on the patient-flow pages.
    const DONE_KEY = 'lf_session_done';

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // ========================================
    // STATUS BANNER (floating text, top-center)
    // ========================================
    let statusEl = null;
    function status(msg, color = '#0a8754', persist = false) {
        if (!statusEl) {
            statusEl = document.createElement('div');
            statusEl.id = 'lf-session-status';
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
        statusEl.style.background = (color === 'red' || color === '#b3261e') ? 'var(--ds-danger,#b3261e)' : 'var(--ds-success,#0a8754)';
        statusEl.style.display = 'block';
        if (!persist) {
            clearTimeout(statusEl._t);
            statusEl._t = setTimeout(() => { statusEl.style.display = 'none'; }, 4000);
        }
    }

    // ========================================
    // INTENT READ
    // ========================================
    // The Zoho orchestrator carries the intent in the opened URL as a base64url
    // query param (`lfSale`), because Tampermonkey GM storage is PER-SCRIPT and
    // won't share between the Zoho and portal scripts. We persist it to BOTH
    // sessionStorage (for the Order Autofill/Patient Autofill) and localStorage
    // (which survives the session-diagnostic Continue blanking the page, so the
    // guided handoff can resume on the fresh login load).
    function parseIntent() {
        // 1) URL param (fresh trigger from Zoho)
        try {
            const p = new URLSearchParams(location.search).get('lfSale');
            if (p) {
                let b64 = p.replace(/-/g, '+').replace(/_/g, '/');
                while (b64.length % 4) b64 += '=';
                const obj = JSON.parse(decodeURIComponent(atob(b64)));
                if (obj && obj._lf) return obj;
            }
        } catch(e) { console.warn('[LF-Session]', e); }
        // 2) localStorage (survives a closed tab — resume point). Only resume a
        //    RECENT intent (< 2h) so a stale one from a finished run never hijacks
        //    a manual portal session; the flow clears it once it completes.
        try {
            const raw = localStorage.getItem(SESSION_INTENT_KEY);
            if (raw) {
                const obj = JSON.parse(raw);
                if (obj && obj._lf && obj._lf._ts && (Date.now() - obj._lf._ts) < 2 * 60 * 60 * 1000) {
                    return obj;
                }
                localStorage.removeItem(SESSION_INTENT_KEY);
            }
        } catch(e) { console.warn('[LF-Session]', e); }
        // 3) sessionStorage (persisted earlier this run)
        try {
            const raw = sessionStorage.getItem(SESSION_INTENT_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch(e) { console.warn('[LF-Session]', e); }
        return null;
    }
    function persistSessionIntent(payload) {
        try {
            payload._lf = payload._lf || {};
            payload._lf._ts = Date.now(); // resume-bridge freshness stamp
        } catch(e) { console.warn('[LF-Session]', e); }
        const j = JSON.stringify(payload);
        try { sessionStorage.setItem(SESSION_INTENT_KEY, j); } catch(e) { console.warn('[LF-Session]', e); }
        try { localStorage.setItem(SESSION_INTENT_KEY, j); } catch(e) { console.warn('[LF-Session]', e); }
    }
    function getAttempts() {
        try { return parseInt(sessionStorage.getItem(ATTEMPT_KEY) || '0', 10) || 0; } catch (e) { return 0; }
    }
    function bumpAttempts() {
        try { sessionStorage.setItem(ATTEMPT_KEY, String(getAttempts() + 1)); } catch(e) { console.warn('[LF-Session]', e); }
    }
    function resetAttempts() {
        try { sessionStorage.removeItem(ATTEMPT_KEY); } catch(e) { console.warn('[LF-Session]', e); }
    }

    // ========================================
    // PAGE-STATE DETECTORS
    // ========================================
    function isLoginFormPresent() {
        return !!(document.querySelector('#standard_login_form')
            || document.querySelector('#txt_user_name')
            || document.querySelector('#lnk_standard_login_submit'));
    }

    // Session-diagnostic modal: "another session already running …". Matches by
    // text (works across portals even if ids differ) and returns the green
    // Continue button if found.
    function findSessionModalContinue() {
        const candidates = document.querySelectorAll(
            'div, span, p, td, .ui-dialog, [class*="modal"], [class*="dialog"], [class*="overlay"], [class*="blockUI"], body'
        );
        for (const el of candidates) {
            const t = (el.textContent || '').trim();
            if (t.length < 15 || t.length > 1500) continue;
            if (!/another session.*already running/i.test(t)) continue;
            const btn = Array.from(el.querySelectorAll(
                'a, button, input[type="button"], input[type="submit"], span[class*="btn"]'
            )).find((b) => /continue/i.test(((b.textContent || '') + ' ' + (b.value || '')).trim()));
            if (btn) return btn;
        }
        return null;
    }

    function findLogoutLink() {
        const els = document.querySelectorAll('a, button, input[type="submit"]');
        for (const el of els) {
            const txt = (el.textContent || '') + ' ' + (el.value || '') + ' ' + (el.getAttribute('href') || '');
            if (/log\s?out|log\s?off|sign\s?out|signout|logoff|end session/i.test(txt)) return el;
        }
        return null;
    }

    // ========================================
    // PHARMACY IDENTITY (for auto-logout on mismatch)
    // ========================================
    const VENDOR_MAP = {
        vendorA: 'pharmacya',
        vendorB: 'progress',
        vendorC: 'pharmacyc',
        pharmacyd: 'pharmacyd',
        vendorE: 'pharmacye',
        vendorF: 'pharmacyf',
        vendorG: 'pharmacyg'
    };
    // Shared hosts — the vendor segment disambiguates them (logged-in pages carry no
    // vendor segment, so currentPharmacyKey() returns null there and the wrong-host
    // check falls back to HOST_MAP comparison):
    //   hostA = Pharmacy C + Pharmacy D, hostB = Pharmacy A + Pharmacy E,
    //   hostD = Pharmacy F (pharmasolutions) + Pharmacy G (pharmacy).
    const HOST_MAP = {
        'hostB.lifefile.net': 'hostB',
        'hostC.lifefile.net': 'progress',
        'hostA.lifefile.net': 'hostA',
        'hostD.lifefile.net': 'hostD'
    };
    // Vendor from a login/portal-entry URL's `/vendor_name/<vendor>/` segment.
    function currentVendor() {
        const m = (location.pathname + location.search).match(/vendor_name\/([^\/]+)/i);
        return m ? m[1].toLowerCase() : null;
    }
    // Best-effort key of the pharmacy the CURRENT page belongs to (null if ambiguous).
    function currentPharmacyKey() {
        const v = currentVendor();
        if (v && VENDOR_MAP[v]) return VENDOR_MAP[v];
        const h = HOST_MAP[location.hostname];
        if (h === 'hostA' || h === 'hostB' || h === 'hostD') return null; // shared hosts — can't tell without vendor
        return h || null;
    }
    function intentHostKey(intent) {
        try { return HOST_MAP[new URL(intent._lf.portalUrl).hostname] || null; } catch (e) { return null; }
    }
    // The URL we should be on (the TARGET portal login + lfSale intent), for
    // re-navigation. Always derived from _lf.portalUrl (NOT the current location —
    // on a cross-host relay page the current URL is the relay, not the target).
    function buildEntryUrl(intent) {
        return buildUrlWithIntent(intent._lf.portalUrl, intent);
    }
    // Append the base64url intent to any LifeFile URL (login, status, etc.).
    function buildUrlWithIntent(baseUrl, intent) {
        try {
            const json = JSON.stringify(intent);
            const b64 = btoa(encodeURIComponent(json)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            const sep = baseUrl.includes('?') ? '&' : '?';
            return baseUrl + sep + 'lfSale=' + b64;
        } catch (e) { return baseUrl; }
    }
    // LifeFile shows an ACCESS DENIED page (title "ACCESS DENIED" / /index/accessdenied)
    // when a protected page is hit while logged out or in a bad session state.
    function isAccessDeniedPage() {
        const p = location.pathname || '';
        if (p.indexOf('accessdenied') !== -1) return true;
        return /^access denied/i.test((document.title || '').trim());
    }
    // Pharmacy-switch handoff: after logging out of a wrong pharmacy, bounce to the right one.
    function pendingPharmSwitch() { try { return sessionStorage.getItem('lf_pharm_switch'); } catch (e) { return null; } }
    function setPharmSwitch(url) { try { sessionStorage.setItem('lf_pharm_switch', url); } catch(e) { console.warn('[LF-Session]', e); } }
    function clearPharmSwitch() { try { sessionStorage.removeItem('lf_pharm_switch'); } catch(e) { console.warn('[LF-Session]', e); } }

    // ========================================
    // LOGIN
    // ========================================
    // Stability-gated auto-login (v1.23): the portal's login form renders
    // asynchronously and its JS can re-render the fields AFTER they're filled —
    // the username "pastes then suddenly disappears" (Jeyson, 2026-08-08).
    // So: fill, then READ BACK and refill until the values stick across two
    // consecutive reads (~700ms apart), and only then click submit. Every
    // failure mode gets a visible status.
    function doLogin(creds) {
        const user = document.querySelector('#txt_user_name');
        const pass = document.querySelector('#pwd_password');
        const go = document.querySelector('#lnk_standard_login_submit');
        if (!user || !pass || !go) return Promise.resolve(false);
        return new Promise((resolve) => {
            const start = Date.now();
            let stableReads = 0;
            (function attempt() {
                try {
                    user.value = creds.username;
                    user.dispatchEvent(new Event('input', { bubbles: true }));
                    user.dispatchEvent(new Event('change', { bubbles: true }));
                    pass.value = creds.password;
                    pass.dispatchEvent(new Event('input', { bubbles: true }));
                    pass.dispatchEvent(new Event('change', { bubbles: true }));
                    status('Filling credentials…');
                } catch (e) { console.warn('[LF-Session]', e); }
                setTimeout(() => {
                    let u = '', p = '';
                    try { u = user.value || ''; p = pass.value || ''; } catch (e) { console.warn('[LF-Session]', e); }
                    if (u === creds.username && p === creds.password) {
                        stableReads++;
                        if (stableReads >= 2) return finishLogin(); // stuck across 2 reads = page settled
                    } else {
                        stableReads = 0; // the page wiped the fields — keep waiting + refilling
                    }
                    if (Date.now() - start > 15000) return resolve(false); // never became stable
                    setTimeout(attempt, 400);
                }, 350);
            })();
            // v1.24 (portal source, 2026-08-08): the Login link's click handler
            // runs an AJAX preference check and only submits when
            // count_keydowns > 2 (real keystrokes) or the saved autocomplete
            // preference is 'yes' — otherwise it WIPES THE PASSWORD and fires
            // alert("Please insert pass"), blocking the page. Synthetic fills
            // never press keys, so: dispatch keydowns on the username field
            // (the portal's own counter counts them) AND set the counter
            // directly — then click. Belt-and-suspenders: if the AJAX stalls,
            // submit the form directly after 3.5s (native submit skips the
            // preference gate entirely).
            function finishLogin() {
                try {
                    for (let i = 0; i < 4; i++) {
                        user.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', code: 'KeyA', bubbles: true, cancelable: true }));
                    }
                    if (typeof window.count_keydowns !== 'undefined') window.count_keydowns = 4;
                    status('Credentials verified — submitting…');
                } catch (e) { console.warn('[LF-Session]', e); }
                go.click();
                setTimeout(() => {
                    try {
                        const form = document.querySelector('#standard_login_form') || document.querySelector('form');
                        if (form && (location.pathname || '').indexOf('/login') !== -1) {
                            status('Preference check stalled — submitting form directly…');
                            form.submit();
                        }
                    } catch (e) { console.warn('[LF-Session]', e); }
                }, 3500);
                resolve(true);
            }
        });
    }

    // ========================================
    // POST-LOGIN HANDOFF → patient list
    // After login we land on the POE home/control panel. Navigate to the patient
    // selection page; the Order Autofill's search step takes it from there.
    // ========================================
    function isOrderCheck(intent) {
        return !!(intent && intent._lf && intent._lf.step === 'orders');
    }
    function gotoPatientList() {
        location.href = '/application_main_zfw/poe/searchpatient';
    }
    function gotoDestination(intent) {
        location.href = isOrderCheck(intent)
            ? '/application_main_zfw/poeerx/providerrxstatusbk'
            : '/application_main_zfw/poe/searchpatient';
    }

    // ========================================
    // MAIN DRIVER
    // ========================================
    // ========================================
    // PAGE-SETTLE HELPERS
    // ========================================
    // Wait until the page settles: either the login form is present (not logged
    // in) or we're on a logged-in page (real content on a non-/login/ path).
    // The LifeFile login form can render asynchronously, so polling avoids the
    // false "already logged in" branch that caused reload loops.
    function waitForPageSettled(timeout = 6000, interval = 300) {
        return new Promise((resolve) => {
            const start = Date.now();
            (function poll() {
                try {
                    if (findSessionModalContinue()) return resolve('modal');
                    if (isLoginFormPresent()) return resolve('login');
                    // Any non-/login/ LifeFile path means we're already past login
                    // (poemainframe, poehome, searchpatient, ...) even if the top
                    // document body is an empty frameset.
                    if ((location.pathname || '').indexOf('/login') === -1) return resolve('loggedin');
                } catch(e) { console.warn('[LF-Session]', e); }
                if (Date.now() - start > timeout) return resolve(null);
                setTimeout(poll, interval);
            })();
        });
    }

    // Wait until we've navigated off the /login/ path (login POST completed).
    function waitForLogoutOfLogin(timeout = 10000, interval = 400) {
        return new Promise((resolve) => {
            const start = Date.now();
            (function poll() {
                try {
                    if ((location.pathname || '').indexOf('/login') === -1) return resolve(true);
                } catch(e) { console.warn('[LF-Session]', e); }
                if (Date.now() - start > timeout) return resolve(false);
                setTimeout(poll, interval);
            })();
        });
    }

    // Fresh trigger (the opened URL carries the lfSale param) vs. a re-navigation
    // within this run (intent came from sessionStorage).
    function hasUrlIntent() {
        try { return !!new URLSearchParams(location.search).get('lfSale'); } catch (e) { return false; }
    }
    function getDone() {
        try { return sessionStorage.getItem(DONE_KEY) === '1'; } catch (e) { return false; }
    }
    function setDone() {
        try { sessionStorage.setItem(DONE_KEY, '1'); } catch(e) { console.warn('[LF-Session]', e); }
        // Keep the localStorage copy as a closed-tab resume bridge (freshness-
        // guarded in parseIntent); the Order Autofill / Order Status Extractor
        // clear it once the order flow actually runs.
    }
    function resetDone() {
        try { sessionStorage.removeItem(DONE_KEY); } catch(e) { console.warn('[LF-Session]', e); }
    }

    // ========================================
    // MAIN DRIVER
    // ========================================
    async function drive() {
        const intent = parseIntent();
        if (!intent) return; // passive: no Zoho sale intent

        // LifeFile denied access (a protected page hit while logged out) — bounce to
        // the pharmacy login so auto-login can take over.
        if (isAccessDeniedPage() && intent._lf && intent._lf.loginUrl) {
            status('Access denied — going to login…', 'red', true);
            location.href = buildUrlWithIntent(intent._lf.loginUrl, intent);
            return;
        }

        // Pharmacy-switch handoff (from auto-logout of a wrong pharmacy): bounce to
        // the correct portal as soon as we can.
        const switchUrl = pendingPharmSwitch();
        if (switchUrl) {
            clearPharmSwitch();
            if (switchUrl !== location.href) { location.href = switchUrl; return; }
        }

        const fresh = hasUrlIntent();
        if (fresh) { resetDone(); resetAttempts(); } // brand-new run from Zoho
        else if (getDone()) return; // already handed off to the patient flow

        const lf = intent._lf;
        status(`LifeFile sale → ${lf.name || lf.pharmacy}`);
        persistSessionIntent(intent);

        // Wait for the page to settle: modal, login form, or already-past-login.
        const settled = await waitForPageSettled();

        // 1) Session-diagnostic modal? GUIDED HANDOFF: the user presses Continue
        //    (it blanks the page in the backend) and reopens the portal link; the
        //    intent was persisted to localStorage so we resume on the fresh load.
        if (settled === 'modal') {
            const entry = buildEntryUrl(intent);
            status('Another session running — auto-clearing + reloading…', 'red', true);
            const btn = findSessionModalContinue();
            if (btn) btn.click();
            await sleep(2500);
            // Continue kills the stray sessions; reload straight to the right portal.
            // (If Continue closed this tab, this line never runs — the next Zoho run
            // reopens it via the named-window reuse.)
            try { if (location.href !== entry) location.href = entry; } catch(e) { console.warn('[LF-Session]', e); }
            return;
        }

        // 2) Already past login (poemainframe/poehome/searchpatient...): hand off to
        //    the patient flow once. (Cross-pharmacy session conflicts are handled by
        //    the modal above, so no auto-logout here.)
        if (settled === 'loggedin') {
            const cur = currentPharmacyKey();
            if (cur && cur !== lf.pharmacy) {
                // Logged in on the WRONG pharmacy — log out, then bounce to the right portal.
                status(`On ${cur} — logging out to switch to ${lf.name}…`, 'red', true);
                setPharmSwitch(buildEntryUrl(intent));
                location.href = '/application_main_zfw/login/ipadlogout/from/doctor';
                return;
            }
            if (cur === null) {
                // Vendor not visible (past-login hostA: pharmacyc vs pharmacyd) — but if
                // we're on the wrong HOST entirely, bounce to the right portal.
                const hereHost = HOST_MAP[location.hostname];
                const wantHost = intentHostKey(intent);
                if (wantHost && hereHost !== wantHost) {
                    status(`Wrong host — switching to ${lf.name}…`, 'red', true);
                    location.href = buildEntryUrl(intent);
                    return;
                }
            }
            if (!getDone()) {
                setDone();
                if (isOrderCheck(intent)) {
                    // Order check: land on the order-status page. If we're already
                    // there (Zoho navigated straight to it), DON'T re-navigate — the
                    // URL still carries lfSale and would reload-loop.
                    status('Checking orders — opening order status…');
                    if (location.pathname.indexOf('/poeerx/providerrxstatusbk') === -1) {
                        location.href = '/application_main_zfw/poeerx/providerrxstatusbk';
                    }
                } else {
                    status('Logged in — starting patient flow…');
                    gotoPatientList();
                }
            }
            return;
        }

        // 3) On the login form → auto-login (attempts-guarded).
        if (settled === 'login') {
            const cur = currentPharmacyKey();
            if (cur && cur !== lf.pharmacy) {
                // On the WRONG pharmacy's login form — bounce to the right portal.
                status(`On ${cur} login — switching to ${lf.name}…`, 'red', true);
                location.href = buildEntryUrl(intent);
                return;
            }
            if (getAttempts() >= 3) {
                status('Session handling stuck — please finish login manually', 'red', true);
                return;
            }
            bumpAttempts();
            const creds = CREDS[lf.pharmacy];
            if (!creds || !creds.username || !creds.password) {
                status(`No credentials for ${lf.name} — log in manually`, 'red', true);
                return;
            }
            status(`Logging in to ${lf.name}…`);
            const loginOk = await doLogin(creds);
            if (!loginOk) {
                status('⚠ Credentials kept resetting — log in manually (or re-run)', 'red', true);
                return;
            }
            const loggedIn = await waitForLogoutOfLogin();
            if (!loggedIn) {
                status('⚠ Login submitted but did not complete — log in manually', 'red', true);
                return;
            }
            setDone();
            resetAttempts();
            status(isOrderCheck(intent) ? 'Logged in — opening order status…' : 'Logged in — starting patient flow…');
            gotoDestination(intent);
            return;
        }

        // 4) Did not settle (transient blank / popup-check page) — stay passive; it
        //    redirects on its own and this handler re-runs on the next page.
    }

    // ========================================
    // INIT
    // ========================================
    // Sheet-driven fetch cleanup (v1.22): the Order Status Extractor sets
    // lf_self_close=<ts> right before the post-extract logout; every boot in
    // the logout chain (ipadlogout -> login redirect) retries closing the
    // script-opened tab — a close attempt during navigation is silently
    // dropped, so the flag survives until a settled page actually closes.
    // window.close() is a silent no-op on user-opened tabs, so this is safe
    // everywhere; the 30s window prevents a stuck flag from living forever.
    try {
        const raw = sessionStorage.getItem('lf_self_close');
        if (raw) {
            const ts = parseInt(raw, 10) || 0;
            if (Date.now() - ts < 30000) {
                try { window.close(); } catch(e) { console.warn('[LF-Session]', e); }
                if (!window.closed) {
                    setTimeout(() => { try { window.close(); } catch(e) { console.warn('[LF-Session]', e); } }, 800);
                    return;
                }
            }
            try { sessionStorage.removeItem('lf_self_close'); } catch(e) { console.warn('[LF-Session]', e); }
            return;
        }
    } catch(e) { console.warn('[LF-Session]', e); }
    // Detach from the Zoho opener so closing the Zoho tab doesn't close this portal
    // tab. (The window NAME — set by Zoho's named window.open — is what makes this
    // the single reusable "LifeFileSaleTab"; the opener link isn't needed for that.)
    try { if (window.opener) window.opener = null; } catch(e) { console.warn('[LF-Session]', e); }
    // Claim the reusable name on ANY freshly-opened LifeFile tab (login/patient/...),
    // so Zoho's window.open(url, 'LifeFileSaleTab') snaps to an existing tab the user
    // opened manually too. DON'T overwrite an existing name (e.g. LifeFile's own
    // "testPopup" popup-check) — only empty names become the reusable sale tab.
    try { if (!window.name) window.name = 'LifeFileSaleTab'; } catch(e) { console.warn('[LF-Session]', e); }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', drive);
    } else {
        drive();
    }
})();
