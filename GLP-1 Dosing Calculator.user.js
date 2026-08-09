// ==UserScript==
// @name         GLP-1 Dosing Calculator
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  Auto-calculates GLP-1 order block dosing (total-dose and duration modes)
// @author       Jeyson Dagondon
// @grant        none
// @match        https://crm.zoho.com/crm/org695301973/*
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[GLP1 v1.6] boot');
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}';
  document.documentElement.appendChild(__dsStyle);

(function () {
    'use strict';

    // ============================================================
    // CATALOG
    // ============================================================
    const CATALOG = {
        "Retatrutide": [
            { label: "4mg total (1mg/0.5mL, 2mL vial)",    conc: 2,  volume: 2, total: 4 },
            { label: "8mg total (2mg/0.5mL, 2mL vial)",    conc: 4,  volume: 2, total: 8 },
            { label: "16mg total (4mg/0.5mL, 2mL vial)",   conc: 8,  volume: 2, total: 16 },
            { label: "32mg total (8mg/0.5mL, 2mL vial)",   conc: 16, volume: 2, total: 32 },
            { label: "48mg total (12mg/0.5mL, 2mL vial)",  conc: 24, volume: 2, total: 48 },
        ],
        "Semaglutide/Cyanocobalamin": [
            { label: "1mg total (0.25mg/0.5mg/0.5mL, 2mL vial)", conc: 0.5, volume: 2, total: 1 },
            { label: "2mg total (0.5mg/0.5mg/0.5mL, 2mL vial)",  conc: 1,   volume: 2, total: 2 },
            { label: "4mg total (1mg/1mg/0.5mL, 2mL vial)",      conc: 2,   volume: 2, total: 4 },
            { label: "6.8mg total (1.7mg/1mg/0.5mL, 2mL vial)",  conc: 3.4, volume: 2, total: 6.8 },
            { label: "8mg total (2mg/1mg/0.5mL, 2mL vial)",      conc: 4,   volume: 2, total: 8 },
            { label: "10mg total (2.5mg/1mg/0.5mL, 2mL vial)",   conc: 5,   volume: 2, total: 10 },
            { label: "15mg total (5mg/1mg/mL, 3mL vial)",        conc: 5,   volume: 3, total: 15 },
            { label: "25mg total (5mg/1mg/mL, 5mL vial)",        conc: 5,   volume: 5, total: 25 },
        ],
        "Tirzepatide/Cyanocobalamin": [
            { label: "10mg total (2.5mg/1mg/0.5mL, 2mL vial)",  conc: 5,  volume: 2, total: 10 },
            { label: "20mg total (5mg/1mg/0.5mL, 2mL vial)",    conc: 10, volume: 2, total: 20 },
            { label: "30mg total (7.5mg/1mg/0.5mL, 2mL vial)",  conc: 15, volume: 2, total: 30 },
            { label: "40mg total (10mg/1mg/0.5mL, 2mL vial)",   conc: 20, volume: 2, total: 40 },
            { label: "50mg total (12.5mg/1mg/0.5mL, 2mL vial)", conc: 25, volume: 2, total: 50 },
            { label: "60mg total (15mg/1mg/0.5mL, 2mL vial)",   conc: 30, volume: 2, total: 60 },
        ],
        "Tirzepatide/Pyridoxine (B6)": [
            { label: "10mg total (2.5mg/1mg/0.5mL, 2mL vial)",  conc: 5,  volume: 2, total: 10 },
            { label: "20mg total (5mg/1mg/0.5mL, 2mL vial)",    conc: 10, volume: 2, total: 20 },
            { label: "30mg total (7.5mg/1mg/0.5mL, 2mL vial)",  conc: 15, volume: 2, total: 30 },
            { label: "40mg total (10mg/1mg/0.5mL, 2mL vial)",   conc: 20, volume: 2, total: 40 },
            { label: "50mg total (12.5mg/1mg/0.5mL, 2mL vial)", conc: 25, volume: 2, total: 50 },
            { label: "60mg total (15mg/1mg/0.5mL, 2mL vial)",   conc: 30, volume: 2, total: 60 },
            { label: "150mg total (15mg/1mg/0.5mL, 5mL vial)",  conc: 30, volume: 5, total: 150 },
        ],
    };

    const PHARMACIES = ["Pharmacy A", "Pharmacy J", "Pharmacy C"];

    function denverToday() {
        const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Denver',
            month: 'numeric', day: 'numeric', year: '2-digit',
        }).formatToParts(new Date());
        const get = t => parts.find(p => p.type === t).value;
        return `${get('month')}/${get('day')}/${get('year')}`;
    }

    // ============================================================
    // CALCULATOR CORE
    // ============================================================
    const UNITS_PER_ML = 100;

    function mgToUnits(mg, conc) { return (mg / conc) * UNITS_PER_ML; }
    function unitsToMg(units, conc) { return (units / UNITS_PER_ML) * conc; }
    function wholeUnits(mg, conc) { return Math.round(mgToUnits(mg, conc)); }
    function isExact(mg, conc) {
        const u = wholeUnits(mg, conc);
        return Math.abs(unitsToMg(u, conc) - mg) < 1e-9;
    }
    function formatDose(mg, conc) {
        const u = wholeUnits(mg, conc);
        return `${isExact(mg, conc) ? "" : "~"}${trimNum(mg)}mg (${u} units)`;
    }
    function trimNum(n) { return parseFloat(n.toFixed(4)).toString(); }
    function weekLabel(start, end) {
        if (start === end) return `Week ${start}`;
        return `Weeks ${start} - ${end}`;
    }

    function resolveTotalDoseMode(steps, vial) {
        const unitsAvailable = vial.volume * UNITS_PER_ML;
        let unitsUsed = 0;
        const resolved = [];

        for (let i = 0; i < steps.length; i++) {
            const s = steps[i];
            const u = wholeUnits(s.mg, vial.conc);
            const isLast = i === steps.length - 1;

            if (s.endWeek === null || s.endWeek === undefined || s.endWeek === '') {
                if (!isLast) throw new Error(`Only the final step may have a blank end week (step ${i + 1} is blank).`);
                const remaining = unitsAvailable - unitsUsed;
                if (u <= 0) throw new Error(`Step ${i + 1} computes to 0 units.`);
                const weeks = Math.round(remaining / u);
                if (weeks < 1) throw new Error(`No volume left for the final step. Fixed steps already use ${trimNum(unitsUsed)} of ${unitsAvailable} units.`);
                const endWeek = s.startWeek + weeks - 1;
                unitsUsed += u * weeks;
                resolved.push({ mg: s.mg, startWeek: s.startWeek, endWeek, units: u, weeks });
            } else {
                const weeks = s.endWeek - s.startWeek + 1;
                if (weeks < 1) throw new Error(`Step ${i + 1}: end week is before start week.`);
                unitsUsed += u * weeks;
                resolved.push({ mg: s.mg, startWeek: s.startWeek, endWeek: s.endWeek, units: u, weeks });
            }
        }

        return {
            steps: resolved,
            duration: resolved[resolved.length - 1].endWeek,
            unitsUsed,
            unitsAvailable,
            overdraw: unitsUsed - unitsAvailable,
        };
    }

    function resolveDurationMode(steps, medication, targetDuration) {
        const vials = CATALOG[medication];
        const candidates = [];
        for (const vial of vials) {
            try { candidates.push({ vial, result: resolveTotalDoseMode(steps, vial), delta: Math.abs(resolveTotalDoseMode(steps, vial).duration - targetDuration) }); }
            catch(e) { console.warn('[GLP1]', e); }
        }
        if (!candidates.length) throw new Error(`No vial of ${medication} can accommodate this regimen.`);

        const covering = candidates.filter(c => c.result.duration >= targetDuration);
        if (covering.length) {
            covering.sort((a, b) => a.result.duration !== b.result.duration ? a.result.duration - b.result.duration : b.vial.total - a.vial.total);
            return covering[0];
        }
        candidates.sort((a, b) => b.result.duration - a.result.duration);
        return { ...candidates[0], short: true };
    }

    function buildSig(resolved, conc) {
        const parts = resolved.steps.map((s, i) => {
            const u = wholeUnits(s.mg, conc);
            const dose = `${trimNum(s.mg)}mg (${u} units)`;
            const isLast = i === resolved.steps.length - 1;
            const single = s.startWeek === s.endWeek;
            if (isLast) return resolved.steps.length === 1 ? dose : `${dose} weeks ${s.startWeek} and on`;
            return single ? `${dose} week ${s.startWeek}` : `${dose} weeks ${s.startWeek}-${s.endWeek}`;
        });
        return `Inject ${parts.join(', ')} subcutaneously once weekly.`;
    }

    function buildOrderBlock({ medication, vial, resolved, pharmacy, initials, date, orderNumber }) {
        const lines = [];
        lines.push("Products Ordered:");
        lines.push(`${date || denverToday()} (${pharmacy || "Pharmacy A"}) ${initials || "[initials]"}`);
        lines.push(`Order #${orderNumber ? " " + orderNumber : ""}`);
        const concLabel = vial.label.match(/\(([^)]+)\)/);
        const strengthPart = concLabel ? concLabel[1] : "";
        const totalPart = vial.label.split(" total")[0];
        lines.push(`Medication: 1 vial of ${medication} ${strengthPart.replace(/, (\d+mL vial)/, " ($1)")} = ${totalPart} total`);
        lines.push("Dosing:");
        for (const s of resolved.steps) lines.push(`- ${weekLabel(s.startWeek, s.endWeek)}: ${formatDose(s.mg, vial.conc)}`);
        lines.push("Frequency: Weekly");
        lines.push(`Estimated Duration: ${resolved.duration} Weeks`);
        return lines.join("\n");
    }

    // ============================================================
    // UI
    // ============================================================
    const PANEL_ID = 'glp1-calc-panel';
    const BTN_ID = 'glp1-calc-toolbar-btn';

    function css() {
        return `
#${BTN_ID} { display: flex; align-items: center; justify-content: center; cursor: pointer; padding: 0 12px; height: 28px; font-size: 13px; font-weight: 700; color: var(--ds-accent,var(--ds-accent,#1a6b54)); white-space: nowrap; border-radius: 4px; margin: 0 2px; transition: background 0.15s; }
#${BTN_ID} strong { font-weight: 700; }
#${BTN_ID}:hover { background: rgba(26,107,84,.1); }
#${PANEL_ID} { position: fixed; bottom: 80px; right: 20px; z-index: 10000; width: 460px; max-height: 82vh; overflow-y: auto; background: #fff; color: #111; border: 1px solid #d0d0d0; border-radius: 10px; box-shadow: 0 8px 32px rgba(0,0,0,.25); font: 13px/1.45 system-ui, -apple-system, sans-serif; padding: 14px; }
#${PANEL_ID} h3 { margin: 0 0 10px; font-size: 14px; font-weight: 600; }
#${PANEL_ID} label { display:block; font-size:11px; font-weight:600; color:#555; margin:8px 0 3px; text-transform:uppercase; letter-spacing:.3px; }
#${PANEL_ID} select, #${PANEL_ID} input { width: 100%; padding: 6px 8px; border: 1px solid #ccc; border-radius: 5px; font: 13px system-ui, sans-serif; box-sizing: border-box; background:#fff; color:#111; }
#${PANEL_ID} .row { display:flex; gap:6px; align-items:center; margin-bottom:6px; }
#${PANEL_ID} .row input { flex:1; }
#${PANEL_ID} .row .lbl { font-size:11px; color:#777; white-space:nowrap; }
#${PANEL_ID} .rm { flex:0 0 auto; width:26px; height:28px; border:1px solid #ddd; background:var(--ds-surface2,#fafafa); border-radius:5px; cursor:pointer; color:#a00; }
#${PANEL_ID} .btn { padding:7px 12px; border-radius:6px; border:1px solid var(--ds-accent,#1a6b54); background:var(--ds-accent,#1a6b54); color:#fff; cursor:pointer; font-weight:600; font-size:12px; }
#${PANEL_ID} .btn.ghost { background:#fff; color:var(--ds-accent,#1a6b54); }
#${PANEL_ID} .btns { display:flex; gap:6px; margin-top:12px; }
#${PANEL_ID} pre { background:#f6f6f4; border:1px solid #e2e2e0; border-radius:6px; padding:10px; white-space:pre-wrap; font:12px/1.5 ui-monospace, Menlo, monospace; margin:10px 0 0; color:#111; }
#${PANEL_ID} .err { color:#b00; font-size:12px; margin-top:8px; }
#${PANEL_ID} .note { color:#666; font-size:11px; margin-top:6px; }
#${PANEL_ID} .modes { display:flex; gap:0; margin-bottom:10px; border:1px solid #ccc; border-radius:6px; overflow:hidden; }
#${PANEL_ID} .modes button { flex:1; padding:6px; border:none; background:var(--ds-surface2,#f2f2f2); cursor:pointer; font-size:12px; font-weight:600; color:#555; }
#${PANEL_ID} .modes button.active { background:var(--ds-accent,#1a6b54); color:#fff; }
#${PANEL_ID} .close { float:right; border:none; background:none; font-size:16px; cursor:pointer; color:#999; line-height:1; }
#${PANEL_ID} .grid2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
#${PANEL_ID} .disclaimer { font-size:10px; color:#888; margin-top:8px; text-align:center; border-top:1px solid #eee; padding-top:6px; }
`;
    }

    let mode = 'total';
    let stepRows = [
        { mg: '', start: '1', end: '4' },
        { mg: '', start: '5', end: '8' },
        { mg: '', start: '9', end: '' },
    ];

    function el(tag, attrs = {}, children = []) {
        const e = document.createElement(tag);
        for (const [k, v] of Object.entries(attrs)) {
            if (k === 'class') e.className = v;
            else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
            else e.setAttribute(k, v);
        }
        for (const c of [].concat(children)) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        return e;
    }

    function buildPanel() {
        const panel = el('div', { id: PANEL_ID });
        panel.appendChild(el('button', { class: 'close', onclick: togglePanel }, '×'));
        panel.appendChild(el('h3', {}, 'GLP-1 Dosing Calculator'));

        const modes = el('div', { class: 'modes' });
        const bTotal = el('button', { class: mode === 'total' ? 'active' : '', onclick: () => setMode('total') }, 'Total dose → duration');
        const bDur = el('button', { class: mode === 'duration' ? 'active' : '', onclick: () => setMode('duration') }, 'Duration → vial');
        modes.appendChild(bTotal); modes.appendChild(bDur);
        panel.appendChild(modes);

        panel.appendChild(el('label', {}, 'Medication'));
        const medSel = el('select', { id: 'g-med', onchange: () => { renderVials(); recalc(); } });
        for (const m of Object.keys(CATALOG)) medSel.appendChild(el('option', { value: m }, m));
        panel.appendChild(medSel);

        const vialWrap = el('div', { id: 'g-vial-wrap' });
        vialWrap.appendChild(el('label', {}, 'Vial'));
        vialWrap.appendChild(el('select', { id: 'g-vial', onchange: recalc }));
        panel.appendChild(vialWrap);

        const durWrap = el('div', { id: 'g-dur-wrap', style: 'display:none;' });
        durWrap.appendChild(el('label', {}, 'Target duration (weeks)'));
        durWrap.appendChild(el('input', { id: 'g-target', type: 'number', min: '1', placeholder: 'e.g. 13', oninput: recalc }));
        panel.appendChild(durWrap);

        panel.appendChild(el('label', {}, 'Titration steps'));
        panel.appendChild(el('div', { id: 'g-steps' }));
        panel.appendChild(el('button', { class: 'btn ghost', style: 'margin-top:4px;padding:4px 9px;', onclick: () => { stepRows.push({ mg: '', start: '', end: '' }); renderSteps(); recalc(); } }, '+ step'));
        panel.appendChild(el('div', { class: 'note' }, 'Leave the final end week blank to auto-calculate.'));

        const meta = el('div', { class: 'grid2', style: 'margin-top:10px;' });
        const pWrap = el('div'); pWrap.appendChild(el('label', {}, 'Pharmacy'));
        const pSel = el('select', { id: 'g-pharm', onchange: recalc });
        for (const p of PHARMACIES) pSel.appendChild(el('option', { value: p }, p));
        pWrap.appendChild(pSel); meta.appendChild(pWrap);

        const iWrap = el('div'); iWrap.appendChild(el('label', {}, 'Initials'));
        iWrap.appendChild(el('input', { id: 'g-init', placeholder: 'JD', oninput: recalc }));
        meta.appendChild(iWrap);

        const dWrap = el('div'); dWrap.appendChild(el('label', {}, 'Date (Denver)'));
        dWrap.appendChild(el('input', { id: 'g-date', placeholder: 'M/D/YY', value: denverToday(), oninput: recalc }));
        meta.appendChild(dWrap);

        const oWrap = el('div'); oWrap.appendChild(el('label', {}, 'Order #'));
        oWrap.appendChild(el('input', { id: 'g-order', placeholder: 'optional', oninput: recalc }));
        meta.appendChild(oWrap);
        panel.appendChild(meta);

        panel.appendChild(el('pre', { id: 'g-out' }, ''));
        panel.appendChild(el('label', { id: 'g-sig-label' }, 'Pharmacy sig'));
        panel.appendChild(el('pre', { id: 'g-sig' }, ''));
        panel.appendChild(el('label', { id: 'g-notes-label' }, 'Notes & Diagnostics'));
        panel.appendChild(el('pre', { id: 'g-notes' }, ''));
        panel.appendChild(el('div', { id: 'g-err', class: 'err' }));

        const btns = el('div', { class: 'btns' });
        btns.appendChild(el('button', { class: 'btn', onclick: (e) => copyToClipboard(document.getElementById('g-out').textContent, e.target) }, 'Copy order block'));
        btns.appendChild(el('button', { class: 'btn', onclick: (e) => copyToClipboard(document.getElementById('g-sig').textContent, e.target) }, 'Copy sig'));
        btns.appendChild(el('button', { class: 'btn ghost', onclick: resetForm }, 'Reset'));
        panel.appendChild(btns);

        panel.appendChild(el('div', { class: 'disclaimer' }, '⚠️ For clinical verification only. Does not replace pharmacist/physician review.'));
        return panel;
    }

    function renderSteps() {
        const host = document.getElementById('g-steps');
        if (!host) return;
        host.innerHTML = '';
        stepRows.forEach((row, i) => {
            const r = el('div', { class: 'row' });
            const mg = el('input', { type: 'number', step: '0.05', placeholder: 'mg', value: row.mg, oninput: (e) => { stepRows[i].mg = e.target.value; recalc(); } });
            const st = el('input', { type: 'number', min: '1', placeholder: 'wk from', value: row.start, oninput: (e) => { stepRows[i].start = e.target.value; recalc(); } });
            const en = el('input', { type: 'number', min: '1', placeholder: 'wk to', value: row.end, oninput: (e) => { stepRows[i].end = e.target.value; recalc(); } });
            r.appendChild(mg); r.appendChild(el('span', { class: 'lbl' }, 'wk')); r.appendChild(st);
            r.appendChild(el('span', { class: 'lbl' }, '–')); r.appendChild(en);
            r.appendChild(el('button', { class: 'rm', onclick: () => { stepRows.splice(i, 1); renderSteps(); recalc(); } }, '×'));
            host.appendChild(r);
        });
    }

    function renderVials() {
        const med = document.getElementById('g-med');
        const vial = document.getElementById('g-vial');
        if (!med || !vial) return;
        const prev = vial.value;
        vial.innerHTML = '';
        for (const v of CATALOG[med.value]) vial.appendChild(el('option', { value: v.label }, v.label));
        if ([...vial.options].some(o => o.value === prev)) vial.value = prev;
    }

    function setMode(newMode) {
        mode = newMode;
        document.getElementById('g-vial-wrap').style.display = mode === 'total' ? 'block' : 'none';
        document.getElementById('g-dur-wrap').style.display = mode === 'duration' ? 'block' : 'none';
        document.querySelectorAll('.modes button').forEach(b => b.classList.remove('active'));
        document.querySelector(`.modes button:nth-child(${mode === 'total' ? '1' : '2'})`).classList.add('active');
        recalc();
    }

    function readSteps() {
        const out = [];
        for (const r of stepRows) {
            if (r.mg === '' && r.start === '' && r.end === '') continue;
            if (r.mg === '' || r.start === '') throw new Error('Every step needs a dose and a start week.');
            out.push({ mg: parseFloat(r.mg), startWeek: parseInt(r.start, 10), endWeek: r.end === '' ? null : parseInt(r.end, 10) });
        }
        if (!out.length) throw new Error('Add at least one titration step.');
        return out;
    }

    function recalc() {
        const outEl = document.getElementById('g-out');
        const sigEl = document.getElementById('g-sig');
        const notesEl = document.getElementById('g-notes');
        const errEl = document.getElementById('g-err');
        if (!outEl || !errEl) return;
        errEl.textContent = ''; notesEl.textContent = ''; sigEl.textContent = '';

        try {
            const med = document.getElementById('g-med').value;
            const steps = readSteps();
            const pharmacy = document.getElementById('g-pharm').value;
            const initials = document.getElementById('g-init').value;
            const date = document.getElementById('g-date').value;
            const orderNumber = document.getElementById('g-order').value;

            let vial, resolved, note = '';
            if (mode === 'total') {
                const vLabel = document.getElementById('g-vial').value;
                vial = CATALOG[med].find(v => v.label === vLabel);
                if (!vial) throw new Error('Pick a vial.');
                resolved = resolveTotalDoseMode(steps, vial);
            } else {
                const target = parseInt(document.getElementById('g-target').value, 10);
                if (!target || target < 1) throw new Error('Enter a target duration.');
                const pick = resolveDurationMode(steps, med, target);
                vial = pick.vial; resolved = pick.result;
                note = pick.short ? `\n[!] No vial reaches ${target} wks. Longest is ${vial.label} → ${resolved.duration} wks.` : `\n[picked ${vial.label} → ${resolved.duration} wks, target was ${target}]`;
            }

            outEl.textContent = buildOrderBlock({ medication: med, vial, resolved, pharmacy, initials, date, orderNumber });
            sigEl.textContent = buildSig(resolved, vial.conc);

            const over = resolved.overdraw;
            let drawNote = '';
            if (over > 0) drawNote = `⚠️ Vial will run out ~${trimNum(over / UNITS_PER_ML)} mL before Week ${resolved.duration}.\n`;
            else if (over < 0) drawNote = `${trimNum(-over / UNITS_PER_ML)} mL remaining in vial.\n`;
            drawNote += `[${trimNum(resolved.unitsUsed)} of ${resolved.unitsAvailable} units used]`;
            if (note) drawNote += `\n${note}`;
            notesEl.textContent = drawNote;
        } catch (e) {
            outEl.textContent = ''; sigEl.textContent = ''; notesEl.textContent = '';
            errEl.textContent = e.message;
        }
    }

    function flashBtn(btn, label) {
        if (!btn) return;
        const old = btn.textContent; btn.textContent = label;
        setTimeout(() => { btn.textContent = old; }, 1200);
    }

    function copyToClipboard(text, btn) {
        if (!text) return;
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text, btn)).then(() => flashBtn(btn, 'Copied'));
        }
        fallbackCopy(text, btn);
    }
    function fallbackCopy(text, btn) {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.cssText = 'position:fixed;opacity:0;left:-999px;';
        document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); } catch(e) { console.warn('[GLP1]', e); }
        document.body.removeChild(ta); flashBtn(btn, 'Copied');
    }

    function resetForm() {
        stepRows = [{ mg: '', start: '1', end: '4' }, { mg: '', start: '5', end: '8' }, { mg: '', start: '9', end: '' }];
        const d = document.getElementById('g-date'); if (d) d.value = denverToday();
        setMode('total'); renderSteps(); recalc();
    }

    function togglePanel() {
        const p = document.getElementById(PANEL_ID);
        p.style.display = p.style.display === 'none' ? 'block' : 'none';
    }

    let injectTries = 0;
    function injectToolbarButton() {
        if (document.getElementById(BTN_ID)) return; // already injected
        const bar = document.querySelector('#chatBarIconList');
        if (!bar) return setTimeout(injectToolbarButton, 500);

        const td = document.createElement('td');
        td.innerHTML = `<div id="${BTN_ID}" title="GLP-1 Dosing Calculator"><strong>GLP-1 Calc</strong></div>`;
        td.querySelector(`#${BTN_ID}`).addEventListener('click', togglePanel);

        // Sit directly to the left of the "Extract Profile" button so both look equally prominent.
        const extractBtn = bar.querySelector('#cx-extractor-toolbar-btn');
        const anchorTd = extractBtn ? extractBtn.closest('td') : null;
        if (anchorTd) {
            bar.insertBefore(td, anchorTd);
        } else if (injectTries++ < 10) {
            setTimeout(injectToolbarButton, 500); // wait for Extract Profile to appear
        } else {
            bar.appendChild(td); // fall back so the button is never lost
        }
    }

    function init() {
        const style = document.createElement('style'); style.textContent = css(); document.head.appendChild(style);
        const panel = buildPanel(); panel.style.display = 'none'; document.body.appendChild(panel);
        renderVials(); renderSteps(); recalc();
        injectToolbarButton();
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
