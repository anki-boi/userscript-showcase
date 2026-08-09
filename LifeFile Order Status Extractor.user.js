// ==UserScript==
// @name         LifeFile Order Status Extractor
// @namespace    jeyson
// @version      1.11
// @author       Jeyson Dagondon
// @run-at       document-idle
// @match        *://*/application_main_zfw/poeerx/providerrxstatusbk*
// @grant        GM_setClipboard
// @grant        GM_addStyle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[LF-Status v1.11] boot');
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}';
  document.documentElement.appendChild(__dsStyle);

(function () {
    'use strict';

    const SYRINGE_RE = /insulin syringe|alcohol pad|syringe kit/i;

    function cleanDrug(name) {
        return name.replace(/\s+/g, ' ').trim();
    }

    function parseRow(tr) {
        const tds = tr.querySelectorAll(':scope > td');
        if (tds.length < 10) return null;

        const txt = i => tds[i].textContent.replace(/\s+/g, ' ').trim();

        const dateTime  = txt(0);
        const orderNum  = txt(1);
        const status    = txt(2);
        const source    = txt(3);
        const priority  = txt(4);
        const epcs      = txt(5);
        const provider  = txt(6);
        const patient   = txt(7);
        const dob       = txt(8);

        const medTable = tds[9].querySelector('table');
        if (!medTable) return null;

        const medRows = [...medTable.querySelectorAll('tr')].slice(1);
        let items = medRows.map(r => {
            const c = r.querySelectorAll('td');
            if (c.length < 4) return null;
            const get = i => c[i] ? c[i].textContent.replace(/\s+/g, ' ').trim() : '';
            const trackCell = c[4] || c[c.length - 1];
            const trackLink = trackCell ? trackCell.querySelector('a') : null;
            return {
                rx: get(0),
                drug: cleanDrug(get(1)),
                qty: get(2),
                rxStatus: get(3),
                tracking: trackLink ? trackLink.textContent.trim() : ''
            };
        }).filter(Boolean);

        if (!items.length) return null;

        const nonSyringe = items.filter(i => !SYRINGE_RE.test(i.drug));
        if (nonSyringe.length > 0) items = nonSyringe;
        // else: syringe-only order, keep as-is

        const join = f => items.map(i => i[f]).filter(Boolean).join('; ');

        return [
            dateTime, orderNum, status, source, priority, epcs, provider, patient, dob,
            join('drug'),
            [...new Set(items.map(i => i.rxStatus))].join('; '),
            join('rx'),
            join('qty'),
            [...new Set(items.map(i => i.tracking).filter(Boolean))].join('; ')
        ];
    }

    function parseDoc(doc) {
        const rows = [];
        doc.querySelectorAll('tr.odd, tr.even').forEach(tr => {
            const r = parseRow(tr);
            if (r) rows.push(r);
        });
        return rows;
    }

    function getPageLinks() {
        const links = [...document.querySelectorAll('a.lnk_pagination')]
            .map(a => a.getAttribute('href'))
            .filter(h => /\/page\/\d+$/.test(h));
        return [...new Set(links)].sort((a, b) => {
            const n = s => parseInt(s.match(/\/page\/(\d+)$/)[1], 10);
            return n(a) - n(b);
        });
    }

    // v1.10 pagination fix (Jeyson, 2026-08-08): the widget renders only ~10
    // numbered links + a LAST-page link — the old loop stopped at the highest
    // VISIBLE link and silently dropped pages 11+ (or anything past the shown
    // window). Plan = { base: '/.../page/', max: highest page among ALL links };
    // the caller then fetches every page 2..max by construction.
    function paginationPlan(links) {
        let max = 1, base = null;
        links.forEach(h => {
            const m = String(h).match(/^(.*\/page\/)(\d+)$/);
            if (!m) return;
            if (base === null) base = m[1];
            max = Math.max(max, parseInt(m[2], 10));
        });
        return { base: base, max: max };
    }

    async function fetchPage(href) {
        const res = await fetch(href, { credentials: 'same-origin' });
        const html = await res.text();
        return new DOMParser().parseFromString(html, 'text/html');
    }

    async function collectRows(allPages) {
        let rows = parseDoc(document);

        if (allPages) {
            const plan = paginationPlan(getPageLinks());
            if (plan.base) {
                for (let p = 2; p <= plan.max; p++) {
                    btn.textContent = `Page ${p}...`;
                    const doc = await fetchPage(plan.base + p);
                    rows = rows.concat(parseDoc(doc));
                }
            }
        }

        const seen = new Set();
        return rows.filter(r => {
            if (seen.has(r[1])) return false;
            seen.add(r[1]);
            return true;
        });
    }

    function rowsToTsv(rows) {
        return rows.map(r =>
            r.map(c => String(c).replace(/\t/g, ' ').replace(/\r?\n/g, ' ')).join('\t')
        ).join('\n');
    }

    async function run(allPages) {
        btn.textContent = 'Working...';
        btn.classList.add('busy');
        btn2.classList.add('busy');
        try {
            const rows = await collectRows(allPages);
            const tsv = rowsToTsv(rows);
            GM_setClipboard(tsv, 'text');
            btn.textContent = `Copied ${rows.length} orders`;
            return { tsv: tsv, count: rows.length };
        } catch (e) {
            console.error(e);
            btn.textContent = 'Error - see console';
            return null;
        } finally {
            setTimeout(() => {
                btn.textContent = 'Copy All Pages';
                btn.classList.remove('busy');
                btn2.classList.remove('busy');
            }, 2500);
        }
    }

    GM_addStyle(`
        .rx-extract-btn{margin-top:10px;}
        .rx-extract-btn.busy{opacity:.6;pointer-events:none;}
    `);

    const btn = document.createElement('a');
    btn.href = '#';
    btn.className = 'bg_black_button rx-extract-btn';
    btn.textContent = 'Copy All Pages';
    btn.onclick = (e) => { e.preventDefault(); run(true); };

    const btn2 = document.createElement('a');
    btn2.href = '#';
    btn2.className = 'bg_black_button rx-extract-btn';
    btn2.textContent = 'Copy This Page';
    btn2.onclick = (e) => { e.preventDefault(); run(false); };

    // ---- Date-range extract (v1.10): set the filter, submit, auto-copy ----
    const CLINIC_TZ = 'America/Denver'; // clinic TZ (repo contract — order dates live in clinic time)
    function denverDate(offsetDays) {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: CLINIC_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
        const get = t => parseInt(parts.find(p => p.type === t).value, 10);
        const base = new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
        base.setUTCDate(base.getUTCDate() + (offsetDays || 0));
        const p2 = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(base);
        const g2 = t => p2.find(p => p.type === t).value;
        return g2('month') + '/' + g2('day') + '/' + g2('year');
    }

    const AUTO_COPY_KEY = 'lf_auto_copy';
    function setDateFilterAndSubmit(from, to, label, nonce, chain) {
        const fromEl = document.getElementById('txt_created_from');
        const toEl = document.getElementById('txt_created_to');
        const form = document.getElementById('filter_order_status');
        if (!fromEl || !toEl || !form) return false;
        fromEl.value = from;
        toEl.value = to;
        fromEl.dispatchEvent(new Event('change', { bubbles: true }));
        toEl.dispatchEvent(new Event('change', { bubbles: true }));
        try {
            sessionStorage.setItem(AUTO_COPY_KEY, JSON.stringify({ label: label, from: from, to: to, nonce: nonce || '', chain: !!chain }));
        } catch (e) { console.warn('[LF-Status]', e); }
        form.submit();
        return true;
    }

    const btn30 = document.createElement('a');
    btn30.href = '#';
    btn30.className = 'bg_black_button rx-extract-btn';
    btn30.textContent = '📅 Last 30 Days';
    btn30.onclick = (e) => {
        e.preventDefault();
        setDateFilterAndSubmit(denverDate(-30), denverDate(0), 'last 30 days', '');
    };

    const btnDate = document.createElement('a');
    btnDate.href = '#';
    btnDate.className = 'bg_black_button rx-extract-btn';
    btnDate.textContent = '📅 Specific Date…';
    btnDate.onclick = (e) => {
        e.preventDefault();
        const entered = prompt('Extract orders for ONE date (MM/DD/YYYY):', denverDate(0));
        if (entered === null) return;
        const v = entered.trim();
        if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v)) { alert('Enter the date as MM/DD/YYYY.'); return; }
        setDateFilterAndSubmit(v, v, 'orders on ' + v, '');
    };

    function mount() {
        const clear = document.querySelector('a.btn_cancel[href*="/clear/1"]');
        if (!clear || !clear.parentNode) return false;
        const td = clear.parentNode;
        td.appendChild(document.createTextNode('\u00A0'));
        td.appendChild(btn);
        td.appendChild(document.createTextNode('\u00A0'));
        td.appendChild(btn2);
        td.appendChild(document.createTextNode('\u00A0'));
        td.appendChild(btn30);
        td.appendChild(document.createTextNode('\u00A0'));
        td.appendChild(btnDate);
        return true;
    }

    if (!mount()) {
        const obs = new MutationObserver(() => { if (mount()) obs.disconnect(); });
        obs.observe(document.body, { childList: true, subtree: true });
    }

    // Auto-search when the Zoho "Check Orders" flow dropped an intent
    // (lf_sale_intent with _lf.step === 'orders'): fill the patient name +
    // Jan-1-to-today date range and submit the order-status filter.
    // Read the orders intent from the URL lfSale param first (the Session Handler
    // persists it to sessionStorage asynchronously, so the URL is the reliable
    // source on the very first load), falling back to sessionStorage.
    function readOrdersIntent() {
        try {
            const p = new URLSearchParams(location.search).get('lfSale');
            if (p) {
                let b64 = p.replace(/-/g, '+').replace(/_/g, '/');
                while (b64.length % 4) b64 += '=';
                const obj = JSON.parse(decodeURIComponent(atob(b64)));
                if (obj && obj._lf && obj._lf.step === 'orders') return obj;
            }
        } catch(e) { console.warn('[LF-Status]', e); }
        try {
            const raw = sessionStorage.getItem('lf_sale_intent');
            if (raw) {
                const obj = JSON.parse(raw);
                if (obj && obj._lf && obj._lf.step === 'orders') return obj;
            }
        } catch(e) { console.warn('[LF-Status]', e); }
        return null;
    }

    function maybeAutoSearch() {
        const intent = readOrdersIntent();
        if (!intent) return;
        let searched = '0';
        try { searched = sessionStorage.getItem('lf_orders_searched') || '0'; } catch(e) { console.warn('[LF-Status]', e); }
        if (searched === '1') return;

        const form = document.getElementById('filter_order_status');
        const nameEl = document.getElementById('txt_patient_name');
        if (!form || !nameEl) return;

        const last = intent.lastName || '';
        const first = intent.firstName || '';
        const nameVal = last + (first ? ', ' + first : '');
        if (nameVal) nameEl.value = nameVal;

        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const fromEl = document.getElementById('txt_created_from');
        const toEl = document.getElementById('txt_created_to');
        if (fromEl) fromEl.value = '01/01/' + now.getFullYear();
        if (toEl) toEl.value = pad(now.getMonth() + 1) + '/' + pad(now.getDate()) + '/' + now.getFullYear();

        try { sessionStorage.setItem('lf_orders_searched', '1'); } catch(e) { console.warn('[LF-Status]', e); }
        // The flow has taken over — drop the intent so it can't re-drive later.
        try { sessionStorage.removeItem('lf_sale_intent'); localStorage.removeItem('lf_sale_intent'); } catch(e) { console.warn('[LF-Status]', e); }

        const banner = document.createElement('div');
        banner.textContent = '🔎 Checking orders for ' + (nameVal || 'patient') + ' — click page to dismiss';
        banner.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:var(--ds-info,#0066cc);color:#fff;padding:10px 18px;border-radius:6px;font-family:system-ui,sans-serif;font-size:14px;font-weight:700;box-shadow:0 4px 16px rgba(0,0,0,.25);';
        document.body.appendChild(banner);
        document.addEventListener('click', () => banner.remove(), { once: true });

        form.submit();
    }

    // ---- Sheet-driven / date-range extract flows (v1.10) ----
    function readAutoCopyFlag() {
        try {
            const raw = sessionStorage.getItem(AUTO_COPY_KEY);
            return raw ? JSON.parse(raw) : null;
        } catch (e) { console.warn('[LF-Status]', e); return null; }
    }

    let lfxSource = null;
    function listenForSheetHello(nonce) {
        window.addEventListener('message', function handler(e) {
            const d = e.data;
            if (d && d.type === 'lfx' && d.nonce === nonce) lfxSource = e.source;
        });
    }

    function showBanner(text) {
        const banner = document.createElement('div');
        banner.textContent = text;
        banner.style.cssText = 'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:2147483647;background:var(--ds-success,#0a8754);color:#fff;padding:10px 18px;border-radius:6px;font-family:system-ui,sans-serif;font-size:14px;font-weight:700;box-shadow:0 4px 16px rgba(0,0,0,.25);';
        document.body.appendChild(banner);
        document.addEventListener('click', () => banner.remove(), { once: true });
        setTimeout(() => { try { banner.remove(); } catch (e) { console.warn('[LF-Status]', e); } }, 8000);
    }

    async function maybeAutoCopy() {
        const flag = readAutoCopyFlag();
        if (!flag) return;
        // The filtered page keeps the date inputs we set — only copy when the
        // visible filter actually matches, so we never copy an unfiltered table.
        const fromEl = document.getElementById('txt_created_from');
        const toEl = document.getElementById('txt_created_to');
        if (!fromEl || !toEl) return;
        if (fromEl.value !== flag.from || toEl.value !== flag.to) return;
        if (flag.nonce) listenForSheetHello(flag.nonce);
        // Wait for real rows (R1) or a settled empty table (zero results).
        const t0 = Date.now();
        while (!document.querySelector('tr.odd, tr.even') && Date.now() - t0 < 8000) {
            await new Promise(r => setTimeout(r, 300));
        }
        // Wait up to 3.5s for the sheet's hello (it retries every 2s) so we have
        // a window ref to reply to — manual button runs have no nonce and skip.
        if (flag.nonce && !lfxSource) {
            const t1 = Date.now();
            while (!lfxSource && Date.now() - t1 < 3500) {
                await new Promise(r => setTimeout(r, 250));
            }
        }
        const res = await run(true);
        try { sessionStorage.removeItem(AUTO_COPY_KEY); } catch (e) { console.warn('[LF-Status]', e); }
        const count = res ? res.count : 0;
        showBanner('📋 Copied ' + count + ' orders (' + (flag.label || 'filtered') + ')');
        if (flag.nonce && lfxSource) {
            try {
                lfxSource.postMessage({ type: 'lfx:res', nonce: flag.nonce, tsv: res ? res.tsv : '', count: count }, '*');
            } catch (e) { console.warn('[LF-Status]', e); }
            // Sheet-driven flow (v1.10): log the portal session out (the Session
            // Handler closes the tab once the logout lands — lf_self_close).
            // v1.11: Run All chains (extract.chain) keep the tab OPEN at the
            // login page so the next pharmacy can reuse it (the sheet drives it
            // via the named window — re-opening post-reload is popup-blocked).
            if (!flag.chain) {
                try { sessionStorage.setItem('lf_self_close', String(Date.now())); } catch (e) { console.warn('[LF-Status]', e); }
            }
            setTimeout(() => { try { location.href = '/application_main_zfw/login/ipadlogout/from/doctor'; } catch (e) { console.warn('[LF-Status]', e); } }, 1200);
        }
    }

    async function maybeExtractIntent() {
        const intent = readOrdersIntent();
        if (!intent || !intent._lf || !intent._lf.extract) return false;
        const ex = intent._lf.extract;
        let from, to, label;
        if (ex.mode === 'date' && /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(ex.date || '')) {
            from = ex.date; to = ex.date; label = 'orders on ' + ex.date;
        } else {
            from = denverDate(-30); to = denverDate(0); label = 'last 30 days';
        }
        // Consume the intent so it can't re-drive on the reloaded page.
        try { sessionStorage.removeItem('lf_sale_intent'); localStorage.removeItem('lf_sale_intent'); } catch (e) { console.warn('[LF-Status]', e); }
        return setDateFilterAndSubmit(from, to, label, ex.nonce || '', ex.chain || false);
    }

    maybeExtractIntent().then((drove) => {
        if (!drove) {
            maybeAutoCopy();
            maybeAutoSearch();
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const t = e.target;
        if (!t || !t.closest) return;
        if (!t.closest('#filter_order_status')) return;
        const tag = t.tagName;
        if (tag !== 'INPUT' && tag !== 'SELECT') return;
        if (t.type === 'button' || t.type === 'submit') return;
        e.preventDefault();
        document.getElementById('filter_order_status').submit();
    }, true);
})();