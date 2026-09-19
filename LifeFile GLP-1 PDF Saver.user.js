// ==UserScript==
// @name         LifeFile GLP-1 PDF Saver
// @namespace    jeyson
// @version      1.1
// @author       Jeyson Dagondon
// @description  Save GLP-1 order docs as PDFs named "First Last GLP1 m-d-yy.pdf"
// @run-at       document-idle
// @match        *://*/application_main_zfw/poeerx/providerrxstatusbk*
// @grant        none
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[LF-PDF v1.1] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['LF-PDF'] = { name: 'LifeFile GLP-1 PDF Saver', version: '1.1', state: 'idle', message: 'Loaded', output: null, error: null, lastActivity: Date.now(), trigger: null };

(function () {
    'use strict';

    const GLP1_NAMES = ['Retatrutide', 'Tirzepatide', 'Semaglutide'];
    const GLP1_RE = /(Retatrutide|Tirzepatide|Semaglutide)/i;

    // --- CSS: glow + button + toast ---
    const style = document.createElement('style');
    style.textContent = `
.glp1-glow{display:inline-block;font-weight:700;color:#052e16;text-shadow:0 0 3px #bbf7d0,0 0 8px #4ade80,0 0 16px #22c55e;animation:glp1Pulse 2s ease-in-out infinite}
@keyframes glp1Pulse{0%,100%{opacity:1}50%{opacity:.55}}
button.glp1-save-pdf{background:#15803d!important;border-color:#15803d!important;color:#fff!important}
button.glp1-save-pdf:hover{background:#16a34a!important}
button.glp1-save-pdf:disabled{opacity:.55;cursor:wait}
#lfpdf-toast{position:fixed;bottom:18px;right:18px;z-index:2147483647;background:#052e16;color:#fff;padding:10px 16px;border-radius:8px;font:600 13px/1.4 system-ui,sans-serif;box-shadow:0 4px 18px rgba(0,0,0,.35);max-width:420px}
#lfpdf-toast.lfpdf-err{background:#7f1d1d}
`;
    document.head.appendChild(style);

    function toast(msg, isErr) {
        const old = document.getElementById('lfpdf-toast');
        if (old) old.remove();
        const el = document.createElement('div');
        el.id = 'lfpdf-toast';
        if (isErr) el.className = 'lfpdf-err';
        el.textContent = msg;
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 6000);
    }

    // --- parsing helpers ---
    // Patient cell is "Last, First" -> return [first, last]
    function parsePatient(text) {
        const t = String(text || '').trim();
        const comma = t.indexOf(',');
        if (comma === -1) return [t, t];
        return [t.slice(comma + 1).trim(), t.slice(0, comma).trim()];
    }

    // "09/01/2026 02:36:03 PM" -> "09-01-26" (mm-dd-yy, zero-padded)
    function parseOrderDate(text) {
        const m = String(text || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
        if (!m) return '';
        return String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[3]).slice(2);
    }

    // First GLP-1 name found in the medication cell text, canonical-cased.
    // Handles "Retatrutide 1mg/0.5ml (2ml vial)...", "Tirzepatide/Cyanocobalamin ..."
    // (the /Cyanocobalamin or /Pyridoxine suffix is ignored by matching the bare word).
    function glp1For(medText) {
        const m = GLP1_RE.exec(String(medText || ''));
        if (!m) return null;
        return GLP1_NAMES.find((g) => g.toLowerCase() === m[1].toLowerCase());
    }

    // Wrap GLP-1 name occurrences in a text node with the glow span.
    function glowTextNode(node) {
        const text = node.nodeValue;
        if (!GLP1_RE.test(text)) return;
        const frag = document.createDocumentFragment();
        let rest = text, m;
        while ((m = GLP1_RE.exec(rest))) {
            frag.appendChild(document.createTextNode(rest.slice(0, m.index)));
            const span = document.createElement('span');
            span.className = 'glp1-glow';
            span.textContent = m[0];
            frag.appendChild(span);
            rest = rest.slice(m.index + m[0].length);
        }
        frag.appendChild(document.createTextNode(rest));
        node.parentNode.replaceChild(frag, node);
    }

    function glowCell(cell) {
        const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT, {
            acceptNode: (n) => (n.nodeValue && GLP1_RE.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
        });
        let n;
        const hits = [];
        while ((n = walker.nextNode())) hits.push(n);
        hits.forEach(glowTextNode);
    }

    // --- PDF fetch + download ---
    function pageCountUrl(orderId) {
        return '/application_main_zfw/documentviewer/fullview/document_id/' + orderId +
            '/context/simple_viewer_print/layout/ipad_newpharmacy_mainframe_layout';
    }

    async function fetchPageCount(orderId) {
        const r = await fetch(pageCountUrl(orderId), { credentials: 'same-origin' });
        if (!r.ok) throw new Error('page-count HTTP ' + r.status);
        const t = await r.text();
        const m = t.match(/total_pages[^>]*value="(\d+)"/) || t.match(/value="(\d+)"[^>]*total_pages/);
        if (!m) throw new Error('total_pages not found');
        const n = Number(m[1]);
        if (!(n >= 1)) throw new Error('bad page count ' + m[1]);
        return n;
    }

    async function fetchPdf(orderId, pageCount) {
        let q = '';
        for (let i = 0; i < pageCount; i++) q += (i ? '&' : '') + 'pages[' + i + ']=' + (i + 1);
        const u = '/application_main_zfw/documentviewer/startsendpages/document_id/' + orderId +
            '/context/simple_viewer_print/temporary/0/sendby/save_to_disk/?' + q;
        const r = await fetch(u, { credentials: 'same-origin' });
        if (!r.ok) throw new Error('PDF HTTP ' + r.status);
        const buf = await r.arrayBuffer();
        if (buf.byteLength < 5 || new Uint8Array(buf).slice(0, 4).join(',') !== '37,80,68,70') {
            throw new Error('response is not a PDF');
        }
        return buf;
    }

    function downloadPdf(buf, filename) {
        const blob = new Blob([buf], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
    }

    function sanitizeName(s) {
        return String(s || '').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
    }

    // --- per-row save flow ---
    async function savePdfForRow(row, btn) {
        const cells = row.querySelectorAll(':scope > td');
        const orderId = btn.dataset.orderId || '';
        if (!orderId) throw new Error('no order id');
        const [first, last] = parsePatient(cells[COL.patient] ? cells[COL.patient].innerText : '');
        const glp1 = glp1For(cells[COL.medication] ? cells[COL.medication].innerText : '');
        const date = parseOrderDate(cells[COL.date] ? cells[COL.date].innerText : '');
        if (!glp1) throw new Error('no GLP-1 on this order');
        const filename = sanitizeName([first, last, glp1, date].filter(Boolean).join(' ')) + '.pdf';

        btn.disabled = true;
        const label = btn.textContent;
        btn.textContent = 'Saving…';
        window.__scripts['LF-PDF'].state = 'running';
        window.__scripts['LF-PDF'].message = 'Saving ' + filename;
        try {
            const pageCount = await fetchPageCount(orderId);
            const buf = await fetchPdf(orderId, pageCount);
            downloadPdf(buf, filename);
            window.__scripts['LF-PDF'].state = 'done';
            window.__scripts['LF-PDF'].output = filename;
            toast('💾 ' + filename);
        } catch (e) {
            window.__scripts['LF-PDF'].state = 'error';
            window.__scripts['LF-PDF'].error = String(e && e.message || e);
            toast('⚠ ' + String(e && e.message || e), true);
        } finally {
            window.__scripts['LF-PDF'].lastActivity = Date.now();
            btn.disabled = false;
            btn.textContent = label;
        }
    }

    // --- row setup: glow + Save PDF button (GLP-1 rows only) ---
    function setupRow(row, colMap) {
        const medCell = row.querySelectorAll(':scope > td')[colMap.medication];
        if (medCell) glowCell(medCell);

        const actionsCell = row.querySelectorAll(':scope > td')[colMap.actions];
        const printBtn = actionsCell ? actionsCell.querySelector('.btn_print_manifest_ingredients') : null;
        if (!printBtn) return;
        if (!medCell || !glp1For(medCell.innerText)) return; // only GLP-1 orders get the button

        if (actionsCell.querySelector('.glp1-save-pdf')) return; // already added (retry loop)
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'bg_black_button glp1-save-pdf';
        btn.textContent = 'Save PDF';
        btn.title = 'Save this GLP-1 order as a PDF';
        btn.dataset.orderId = printBtn.getAttribute('data-order_id') || '';
        btn.addEventListener('click', () => savePdfForRow(row, btn).catch((e) => toast('⚠ ' + e.message, true)));
        printBtn.parentNode.insertBefore(btn, printBtn);
    }

    // --- init: header-driven column map, then setup every row ---
    let COL = null, initialized = false;

    function init() {
        if (initialized) return;
        const printBtns = [...document.querySelectorAll('.btn_print_manifest_ingredients')];
        if (!printBtns.length) return;
        const table = printBtns[0].closest('table');
        const theadTr = table ? table.querySelector('thead tr') : null;
        if (!theadTr) return;
        const headers = [...theadTr.querySelectorAll(':scope > th')].map((t) => t.textContent.trim());
        const idx = (name) => headers.indexOf(name);
        const date = idx('Date Time'), patient = idx('Patient'), medication = idx('Medication'), actions = idx('Actions');
        if (date === -1 || patient === -1 || medication === -1 || actions === -1) return; // layout unknown — stay passive
        COL = { date, patient, medication, actions };

        for (const b of printBtns) setupRow(b.closest('tr'), COL);
        initialized = true;
        window.__scripts['LF-PDF'].message = 'Ready — ' + printBtns.length + ' orders scanned';
    }

    // Page reloads on filter/pagination; retry in case rows render late.
    let tries = 0;
    const timer = setInterval(() => {
        init();
        if (initialized || ++tries > 15) clearInterval(timer);
    }, 1000);
    init();

    // R18 trigger: save the PDF for a given order id (from the order table).
    window.__scripts['LF-PDF'].trigger = function (orderId) {
        const id = String(orderId || '');
        if (!id) return { ok: false, error: 'orderId required' };
        const btn = [...document.querySelectorAll('.glp1-save-pdf')].find((b) => b.dataset.orderId === id);
        if (!btn) return { ok: false, error: 'no GLP-1 row for order ' + id };
        savePdfForRow(btn.closest('tr'), btn); // never rejects — errors handled internally
        return { ok: true };
    };
})();
