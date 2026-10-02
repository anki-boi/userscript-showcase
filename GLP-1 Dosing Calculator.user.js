// ==UserScript==
// @name         GLP-1 Dosing Calculator
// @namespace    http://tampermonkey.net/
// @version      1.15
// @description  Auto-calculates GLP-1 order block dosing (total-dose and duration modes)
// @author       Jeyson Dagondon
// @grant        none
// @match        https://crm.zoho.com/crm/org000000000/*
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[GLP1 v1.15] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['GLP1'] = { name: 'GLP-1 Dosing Calculator', version: '1.15', state: 'idle', message: 'Loaded', output: null, error: null, lastActivity: Date.now(), trigger: null };
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}';
  document.documentElement.appendChild(__dsStyle);

(function () {
    'use strict';

    // ============================================================
    // DATA — SOURCES registry + STANDARD_DOSING
    // ============================================================
    // [LF] Pharmacy A catalog below: the original four-med catalog, moved verbatim (labels/conc/volume/total).
    const LF_CATALOG = {
        "Retatrutide": [
            { label: "4mg total (1mg/0.5mL, 2mL vial)",    conc: 2,  volume: 2, total: 4 },
            { label: "8mg total (2mg/0.5mL, 2mL vial)",    conc: 4,  volume: 2, total: 8 },
            { label: "16mg total (4mg/0.5mL, 2mL vial)",   conc: 8,  volume: 2, total: 16 },
            { label: "32mg total (8mg/0.5mL, 2mL vial)",   conc: 16, volume: 2, total: 32 },
            { label: "48mg total (12mg/0.5mL, 2mL vial)",  conc: 24, volume: 2, total: 48 },
            { label: "64mg total (8mg/0.5mL, 2 x 2mL vials)", conc: 16, volume: 4, total: 64 },
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

    // Bloom injectable catalogs (portal.pharmacyl.example paste 2026-09-03) — injectables only, no oral RDTs.
    // Vial `price` (USD) surfaces ONLY in the vial option text + duration diagnostics (never order block/sig/notes).
    const SOURCES = [
        { key: '[LF] Pharmacy A', catalog: LF_CATALOG },
        {
            key: '[BLRX] Blue Five Labs',
            catalog: {
                "Retatrutide": [
                    { label: "10mg total (10mg/mL, 1mL vial)",   conc: 10, volume: 1, total: 10, price: 95 },
                    { label: "20mg total (20mg/mL, 1mL vial)",   conc: 20, volume: 1, total: 20, price: 120 },
                    { label: "30mg total (10mg/mL, 3mL vial)",   conc: 10, volume: 3, total: 30, price: 285 },
                    { label: "50mg total (10mg/mL, 5mL vial)",   conc: 10, volume: 5, total: 50, price: 425 },
                    { label: "60mg total (20mg/mL, 3mL vial)",   conc: 20, volume: 3, total: 60, price: 445 },
                    { label: "100mg total (20mg/mL, 5mL vial)",  conc: 20, volume: 5, total: 100, price: 485 },
                ],
            },
        },
        {
            key: '[BLRX] Greenstone Rx',
            catalog: {
                "Semaglutide": [
                    { label: "5mg total (2.5mg/mL, 2mL vial)",    conc: 2.5, volume: 2, total: 5,   price: 65 },
                    { label: "7.5mg total (2.5mg/mL, 3mL vial)",  conc: 2.5, volume: 3, total: 7.5, price: 85 },
                    { label: "10mg total (2.5mg/mL, 4mL vial)",   conc: 2.5, volume: 4, total: 10,  price: 105 },
                    { label: "25mg total (5mg/mL, 5mL vial)",     conc: 5,   volume: 5, total: 25,  price: 200 },
                    { label: "50mg total (10mg/mL, 5mL vial)",    conc: 10,  volume: 5, total: 50,  price: 195 },
                ],
                "Tirzepatide": [
                    { label: "15mg total (15mg/mL, 1mL vial)",   conc: 15, volume: 1, total: 15, price: 115 },
                    { label: "20mg total (10mg/mL, 2mL vial)",   conc: 10, volume: 2, total: 20, price: 155 },
                    { label: "40mg total (10mg/mL, 4mL vial)",   conc: 10, volume: 4, total: 40, price: 225 },
                    { label: "50mg total (10mg/mL, 5mL vial)",   conc: 10, volume: 5, total: 50, price: 255 },
                    { label: "100mg total (20mg/mL, 5mL vial)",  conc: 20, volume: 5, total: 100, price: 315 },
                ],
            },
        },
        { key: '[PRSC] Pharmacy A', pending: true }, // RxFlow placeholder — "coming soon", no catalog yet
    ];

    // Clinic standard ramps (weekly) — keyed by DRUG, shared by pure meds and combo meds.
    // Only `end` weeks are stored: start weeks are derived contiguously (dosing always starts
    // at Week 1, each step begins the week after the previous end). null end = open-ended
    // final step (runs until the vial is empty). Week spans noted inline.
    const STANDARD_DOSING = {
        Semaglutide: [ { mg: 0.25, end: 4 }, { mg: 0.5, end: 8 }, { mg: 0.75, end: null } ], // 0.25 wks 1-4 · 0.5 wks 5-8 · 0.75 wks 9+
        Tirzepatide: [ { mg: 2.5,  end: 4 }, { mg: 5,   end: null } ],                       // 2.5 wks 1-4 · 5 wks 5+
        Retatrutide: [ { mg: 1,    end: 4 }, { mg: 2,   end: 8 }, { mg: 4,    end: null } ], // 1 wks 1-4 · 2 wks 5-8 · 4 wks 9+
    };

    function drugOf(medication) { return medication.split('/')[0]; } // combo meds are "<Drug>/<additive>"

    function currentCatalog() {
        const key = document.getElementById('g-pharm').value;
        const src = SOURCES.find(s => s.key === key);
        return src ? (src.catalog || null) : null; // null when pending/unknown → callers error cleanly
    }

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
    const MAX_VIALS = 6;        // cap on the order quantity (packs); the 64mg pack ships 2 vials per unit
    const MAX_SUGGESTIONS = 6;  // duration-mode suggestion rows

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

    // Single source of truth for dispense math + the Medication line. `qty` is
    // the ORDER quantity in catalog units; the 64mg pack ("..., 2 x 2mL vials")
    // dispenses packVials per unit. Strength is normalized to a single-vial
    // form so every multi-vial line reads the same shape.
    function dispenseOf(vial, qty) {
        const parenM = vial.label.match(/\(([^)]+)\)/);
        let strength = parenM ? parenM[1] : "";
        let packVials = 1;
        const multiM = strength.match(/,\s*(\d+)\s*x\s*([\d.]+)\s*mL\s+vials?/i);
        if (multiM) {
            packVials = parseInt(multiM[1], 10);
            strength = strength.replace(/,\s*\d+\s*x\s*[\d.]+\s*mL\s+vials?/i, ` (${multiM[2]}mL vial)`);
        } else {
            strength = strength.replace(/,\s*([\d.]+mL vial)/, " ($1)");
        }
        return { vials: packVials * qty, packVials, strength, totalMg: vial.total * qty };
    }

    // "2 vials, 48mg total (12mg/0.5mL, 2mL vial) — $95" for the diagnostics;
    // a single vial renders exactly as v1.13 did.
    function vialRefOf(vial, qty) {
        const d = dispenseOf(vial, qty);
        const priced = vial.price != null ? ` — $${vial.price}${d.vials > 1 ? ' (unit)' : ''}` : '';
        return `${d.vials === 1 ? "" : d.vials + " vials, "}${vial.label}${priced}`;
    }

    function resolveTotalDoseMode(steps, vial, qty = 1) {
        const unitsAvailable = vial.volume * qty * UNITS_PER_ML;
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

    // Full scan: every catalog vial x order quantity 1..MAX_VIALS. Each entry
    // carries its own resolved regimen so callers never re-simulate.
    function durationCandidates(steps, vials) {
        const out = [];
        for (const vial of vials) {
            for (let qty = 1; qty <= MAX_VIALS; qty++) {
                try {
                    out.push({ vial, qty, packVials: dispenseOf(vial, qty).packVials, result: resolveTotalDoseMode(steps, vial, qty) });
                } catch(e) { console.warn('[GLP1]', e); }
            }
        }
        return out;
    }

    // Rank candidates for a target duration (Jeyson 2026-09-10):
    //   covering — duration asc, dispensed vials asc, per-vial total desc, qty asc, label
    //   short    — duration desc, dispensed vials asc, per-vial total desc, qty asc, label
    // `rows` feeds the suggestion buttons: deduped by duration (best candidate
    // per duration wins), covering first, padded from the short list, capped.
    function rankDurationOptions(cands, target, limit = MAX_SUGGESTIONS) {
        const dispensed = c => c.qty * c.packVials;
        const perVial = c => c.vial.total / c.packVials;
        const coverSort = (a, b) =>
            (a.result.duration - b.result.duration) ||
            (dispensed(a) - dispensed(b)) ||
            (perVial(b) - perVial(a)) ||
            (a.qty - b.qty) ||
            a.vial.label.localeCompare(b.vial.label);
        const shortSort = (a, b) =>
            (b.result.duration - a.result.duration) ||
            (dispensed(a) - dispensed(b)) ||
            (perVial(b) - perVial(a)) ||
            (a.qty - b.qty) ||
            a.vial.label.localeCompare(b.vial.label);
        const covering = cands.filter(c => c.result.duration >= target).sort(coverSort);
        const short = cands.filter(c => c.result.duration < target).sort(shortSort);

        const rows = [];
        const seen = new Set();
        for (const list of [covering, short]) {
            for (const c of list) {
                if (rows.length >= limit) break;
                if (seen.has(c.result.duration)) continue;
                seen.add(c.result.duration);
                rows.push({ vial: c.vial, qty: c.qty, result: c.result, short: c.result.duration < target });
            }
        }
        return { best: covering[0] || short[0] || null, covering, short, rows };
    }

    function resolveDurationMode(steps, vials, medication, targetDuration) {
        const opts = rankDurationOptions(durationCandidates(steps, vials), targetDuration);
        if (!opts.best) throw new Error(`No vial of ${medication} can accommodate this regimen.`);
        return { ...opts.best, short: opts.covering.length === 0 };
    }

    // Split a resolved regimen across the dispensed vials: weeks are drawn in
    // order; a week that no longer fits the current vial starts the next one
    // (a part-used vial is never topped up). The LAST dispensed vial absorbs
    // any final-week overdraw, same as resolveTotalDoseMode. Diagnostics only.
    function vialCoverage(resolved, unitsPerVial, vialCount) {
        const spans = [];
        let vial = 1, used = 0;
        for (const s of resolved.steps) {
            for (let w = s.startWeek; w <= s.endWeek; w++) {
                if (vial < vialCount && used > 0 && used + s.units > unitsPerVial) { vial++; used = 0; }
                used += s.units;
                const last = spans[spans.length - 1];
                if (last && last.vial === vial) last.end = w;
                else spans.push({ vial, start: w, end: w });
            }
        }
        return spans;
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

    function buildOrderBlock({ medication, vial, qty = 1, resolved, pharmacy, initials, date, orderNumber }) {
        const lines = [];
        lines.push("Products Ordered:");
        lines.push(`${date || denverToday()} (${pharmacy || "Pharmacy A"}) ${initials || "[initials]"}`);
        lines.push(`Order #${orderNumber ? " " + orderNumber : ""}`);
        const d = dispenseOf(vial, qty);
        lines.push(`Medication: ${d.vials} vial${d.vials === 1 ? "" : "s"} of ${medication} ${d.strength} = ${trimNum(d.totalMg)}mg total`);
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
#${PANEL_ID} .row input[readonly] { background:#f2efe9; color:#7a7163; cursor:default; }
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
#${PANEL_ID} .qref { display:flex; align-items:center; gap:8px; margin:10px 0 0; padding-top:8px; border-top:1px dashed #d8d8d4; }
#${PANEL_ID} .qref .lbl { margin:0; }
#${PANEL_ID} .qref input { width:56px; padding:3px 6px; }
#${PANEL_ID} .qref .out { font-size:12px; font-weight:600; color:var(--ds-info,#2c6e9c); white-space:nowrap; }
#${PANEL_ID} .sugg { display:flex; flex-direction:column; gap:3px; margin-top:3px; }
#${PANEL_ID} .sugg button { text-align:left; padding:5px 8px; font:12px system-ui, sans-serif; border:1px solid var(--ds-border,#ccc); border-radius:5px; background:var(--ds-surface,#fff); color:#111; cursor:pointer; }
#${PANEL_ID} .sugg button:hover { border-color: var(--ds-accent,#8a5f2e); }
#${PANEL_ID} .sugg button.sugg-active { background: var(--ds-accent,#8a5f2e); border-color: var(--ds-accent,#8a5f2e); color:#fff; }
#${PANEL_ID} .disclaimer { font-size:10px; color:#888; margin-top:8px; text-align:center; border-top:1px solid #eee; padding-top:6px; }
`;
    }

    let mode = 'total';
    const KEY_INIT = 'glp1_initials'; // remembered across sessions, so initials aren't retyped
    let wkManual = false; // user typed in the weeks→days box; stop auto-seeding it from resolved duration
    let stepRows = [
        { mg: '', end: '' },
        { mg: '', end: '' },
        { mg: '', end: '' },
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
        panel.appendChild(medSel);

        const durWrap = el('div', { id: 'g-dur-wrap', style: 'display:none;' });
        durWrap.appendChild(el('label', {}, 'Target duration (weeks)'));
        durWrap.appendChild(el('input', { id: 'g-target', type: 'number', min: '1', placeholder: 'e.g. 13', oninput: () => { applyBestForTarget(); recalc(); } }));
        panel.appendChild(durWrap);

        const suggWrap = el('div', { id: 'g-sugg-wrap', style: 'display:none;' });
        suggWrap.appendChild(el('label', {}, 'Closest combinations'));
        suggWrap.appendChild(el('div', { id: 'g-sugg', class: 'sugg' }));
        panel.appendChild(suggWrap);

        // Vial + quantity stay visible in BOTH modes (D5): duration mode fills
        // them from a suggestion and they stay editable for manual override.
        const vialWrap = el('div', { id: 'g-vial-wrap' });
        vialWrap.appendChild(el('label', {}, 'Vial'));
        vialWrap.appendChild(el('select', { id: 'g-vial', onchange: recalc }));
        const qtyRow = el('div', { class: 'row', style: 'margin-top:6px;' });
        qtyRow.appendChild(el('span', { class: 'lbl' }, 'Vials'));
        qtyRow.appendChild(el('input', { id: 'g-vials', type: 'number', min: '1', max: String(MAX_VIALS), step: '1', value: '1', title: 'Order units, 1-' + MAX_VIALS + ' (64mg pack = 2 vials per unit)', oninput: recalc, onchange: syncVialsBox }));
        vialWrap.appendChild(qtyRow);
        panel.appendChild(vialWrap);

        panel.appendChild(el('label', {}, 'Titration steps'));
        panel.appendChild(el('div', { id: 'g-steps' }));
        const stepBtns = el('div', { style: 'display:flex;gap:6px;margin-top:4px;' });
        stepBtns.appendChild(el('button', { class: 'btn ghost', style: 'padding:4px 9px;', onclick: () => { stepRows.push({ mg: '', end: '' }); renderSteps(); recalc(); } }, '+ step'));
        stepBtns.appendChild(el('button', { class: 'btn ghost', style: 'padding:4px 9px;', onclick: loadStandard }, 'Standard dosing'));
        panel.appendChild(stepBtns);
        panel.appendChild(el('div', { class: 'note' }, "Blank rows are skipped. Weeks run contiguously from Week 1 — start weeks are automatic. Leave only the final row's end week blank to auto-extend until the vial runs out."));

        const meta = el('div', { class: 'grid2', style: 'margin-top:10px;' });
        const pWrap = el('div'); pWrap.appendChild(el('label', {}, 'Fulfilled by'));
        const pSel = el('select', { id: 'g-pharm', onchange: () => { renderMeds(); renderVials(); recalc(); } });
        for (const s of SOURCES) {
            const attrs = { value: s.key };
            if (s.pending) attrs.disabled = 'disabled';
            pSel.appendChild(el('option', attrs, s.key + (s.pending ? ' (coming soon)' : '')));
        }
        pWrap.appendChild(pSel); meta.appendChild(pWrap);

        const iWrap = el('div'); iWrap.appendChild(el('label', {}, 'Initials'));
        iWrap.appendChild(el('input', { id: 'g-init', placeholder: 'JD', value: localStorage.getItem(KEY_INIT) || '', oninput: recalc }));
        meta.appendChild(iWrap);

        const dWrap = el('div'); dWrap.appendChild(el('label', {}, 'Date (Denver)'));
        dWrap.appendChild(el('input', { id: 'g-date', placeholder: 'M/D/YY', value: denverToday(), oninput: recalc }));
        meta.appendChild(dWrap);

        const oWrap = el('div'); oWrap.appendChild(el('label', {}, 'Order #'));
        oWrap.appendChild(el('input', { id: 'g-order', placeholder: 'optional', oninput: recalc }));
        meta.appendChild(oWrap);
        panel.appendChild(meta);

        panel.appendChild(el('pre', { id: 'g-out' }, ''));

        // Quick reference only — never included in the sig or dosing text.
        const qref = el('div', { class: 'qref', title: 'Reference only — not part of the sig' });
        qref.appendChild(el('span', { class: 'lbl' }, 'Quick ref: Weeks → Days'));
        qref.appendChild(el('input', { id: 'g-wk2d', type: 'number', min: '1', step: '1', placeholder: 'wks', oninput: () => { wkManual = true; weeksToDays(); } }));
        qref.appendChild(el('span', { class: 'out', id: 'g-wk2d-out' }, ''));
        panel.appendChild(qref);

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

    function isBlankRow(r) { return r.mg === '' && r.end === ''; }

    // Derived start weeks: dosing always begins Week 1, and every used row starts the week
    // after the previous row's end (rows are contiguous — gaps can't happen). '…' marks rows
    // that follow an open-ended row (an error state; readSteps explains it).
    // Derived start weeks shown in the readonly boxes (display-only). Row 1 is always Week 1,
    // no matter what's typed. Every later row extrapolates from the nearest preceding numeric
    // end week; blank rows are transparent so dosing stays contiguous. A row that follows an
    // open-ended (no end week) row shows '…' — that's an error state, readSteps explains it.
    function derivedStarts() {
        const starts = [];
        let cursor = 1, open = false;
        stepRows.forEach((r, i) => {
            const used = !isBlankRow(r);
            if (i === 0) starts.push('1'); // Week 1, no matter what
            else if (!used) starts.push(''); // skipped blank row
            else if (open) starts.push('…'); // follows an open-ended row
            else starts.push(String(cursor)); // extrapolated from earlier end weeks
            if (used) {
                if (r.end === '') open = true; // open-ended step — nothing may follow it
                else {
                    const e = parseInt(r.end, 10);
                    if (!isNaN(e) && e >= cursor) cursor = e + 1;
                }
            }
        });
        return starts;
    }

    // Live-update the derived start boxes without rebuilding the row inputs (keeps focus).
    function refreshChips() {
        const host = document.getElementById('g-steps');
        if (!host) return;
        const boxes = host.querySelectorAll('input[readonly]');
        derivedStarts().forEach((v, i) => { if (boxes[i] && boxes[i].value !== v) boxes[i].value = v; });
    }

    function renderSteps() {
        const host = document.getElementById('g-steps');
        if (!host) return;
        host.innerHTML = '';
        const starts = derivedStarts();
        stepRows.forEach((row, i) => {
            const r = el('div', { class: 'row' });
            const mg = el('input', { type: 'number', step: '0.05', placeholder: 'mg', value: row.mg, oninput: (e) => { stepRows[i].mg = e.target.value; recalc(); } });
            // Start week: same box as before, but auto-filled from Week 1 and not editable.
            const st = el('input', { type: 'text', readonly: 'readonly', value: starts[i], title: 'Start week — automatic (Week 1, then the week after the previous row ends)' });
            const en = el('input', { type: 'number', min: '1', placeholder: 'wk to', value: row.end, oninput: (e) => { stepRows[i].end = e.target.value; recalc(); } });
            r.appendChild(mg); r.appendChild(el('span', { class: 'lbl' }, 'wk')); r.appendChild(st);
            r.appendChild(el('span', { class: 'lbl' }, '–')); r.appendChild(en);
            r.appendChild(el('button', { class: 'rm', onclick: () => { stepRows.splice(i, 1); renderSteps(); recalc(); } }, '×'));
            host.appendChild(r);
        });
    }

    function renderMeds() {
        const med = document.getElementById('g-med');
        if (!med) return;
        const prev = med.value;
        med.innerHTML = '';
        for (const m of Object.keys(currentCatalog() || {})) med.appendChild(el('option', { value: m }, m));
        if (med.options.length && [...med.options].some(o => o.value === prev)) med.value = prev;
    }

    function renderVials() {
        const med = document.getElementById('g-med');
        const vial = document.getElementById('g-vial');
        if (!med || !vial) return;
        const prev = vial.value;
        vial.innerHTML = '';
        const vials = (currentCatalog() || {})[med.value] || [];
        for (const v of vials) {
            // Price is surfacing-only: option text gets it, option VALUE stays the plain label.
            const text = v.price != null ? `${v.label} — $${v.price}` : v.label;
            vial.appendChild(el('option', { value: v.label }, text));
        }
        if (vials.length && [...vial.options].some(o => o.value === prev)) vial.value = prev;
    }

    function setMode(newMode) {
        mode = newMode;
        document.getElementById('g-dur-wrap').style.display = mode === 'duration' ? 'block' : 'none';
        document.getElementById('g-sugg-wrap').style.display = mode === 'duration' ? 'block' : 'none';
        document.querySelectorAll('.modes button').forEach(b => b.classList.remove('active'));
        document.querySelector(`.modes button:nth-child(${mode === 'total' ? '1' : '2'})`).classList.add('active');
        recalc();
    }

    function readSteps() {
        const used = stepRows.filter(r => !isBlankRow(r));
        if (!used.length) throw new Error('Add at least one titration step.');
        const out = [];
        let cursor = 1; // dosing always starts at Week 1
        used.forEach((r, i) => {
            if (r.mg === '') throw new Error('Every step needs a dose (mg) and an end week.');
            const mg = parseFloat(r.mg);
            if (!(mg > 0)) throw new Error('Step doses must be greater than 0 mg.');
            const isLast = i === used.length - 1;
            if (r.end === '') {
                // Open-ended step: only legal as the final step; the engine auto-extends it
                // until the vial runs out (see resolveTotalDoseMode).
                if (!isLast) throw new Error('Only the final step may have a blank end week — a blank-ended step caps the regimen, so nothing can follow it.');
                out.push({ mg, startWeek: cursor, endWeek: null });
            } else {
                const end = parseInt(r.end, 10);
                if (isNaN(end) || end < cursor) throw new Error(`Step ${i + 1} must end on week ${cursor} or later (rows run contiguously from Week 1).`);
                out.push({ mg, startWeek: cursor, endWeek: end });
                cursor = end + 1;
            }
        });
        return out;
    }

    function readVialQty() {
        const q = document.getElementById('g-vials');
        const v = q ? parseInt(q.value, 10) : 1;
        return (!v || v < 1) ? 1 : Math.min(v, MAX_VIALS); // silent clamp
    }

    // The box can hold out-of-range text (number inputs only flag validity),
    // so on blur/Enter snap it to the value actually used — silent, no message.
    function syncVialsBox() {
        const q = document.getElementById('g-vials');
        if (q) q.value = String(readVialQty());
    }

    function currentVials() {
        const med = document.getElementById('g-med');
        const catalog = currentCatalog() || {};
        return (med && catalog[med.value]) || [];
    }

    // Suggestion machinery (D5, 2026-09-10): a target edit re-applies the
    // closest option; clicking a row applies it; manual vial/qty edits stand
    // until the next target edit; med/source switches keep the selection.
    function setSuggestionInputs(row) {
        const v = document.getElementById('g-vial');
        if (v) v.value = row.vial.label;
        const q = document.getElementById('g-vials');
        if (q) q.value = String(row.qty);
    }

    function applyBestForTarget() {
        if (mode !== 'duration') return;
        try {
            const target = parseInt(document.getElementById('g-target').value, 10);
            const vials = currentVials();
            if (!(target > 0) || !vials.length) return;
            const opts = rankDurationOptions(durationCandidates(readSteps(), vials), target);
            if (opts.best) setSuggestionInputs(opts.best);
        } catch (e) { /* recalc surfaces the error text */ }
    }

    function renderSuggestions(target) {
        const host = document.getElementById('g-sugg');
        if (!host) return;
        host.innerHTML = '';
        if (mode !== 'duration' || !(target > 0)) return;
        let opts;
        try { opts = rankDurationOptions(durationCandidates(readSteps(), currentVials()), target); }
        catch (e) { return; } // invalid steps; recalc shows the error
        const sel = document.getElementById('g-vial');
        const curLabel = sel ? sel.value : '';
        const curQty = readVialQty();
        for (const row of opts.rows) {
            const active = row.vial.label === curLabel && row.qty === curQty;
            const text = `${row.qty} × ${row.vial.label} → ${row.result.duration} wks${row.short ? ' (short)' : ''}`;
            host.appendChild(el('button', { class: active ? 'sugg-active' : '', onclick: () => { setSuggestionInputs(row); recalc(); } }, text));
        }
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
            localStorage.setItem(KEY_INIT, initials); // remember for next time
            const date = document.getElementById('g-date').value;
            const orderNumber = document.getElementById('g-order').value;
            const qty = readVialQty();

            const catalog = currentCatalog();
            if (!catalog) throw new Error(`${pharmacy} catalog is not available yet (coming soon).`);
            const vials = catalog[med];
            if (!vials || !vials.length) throw new Error(`${pharmacy} doesn't carry ${med}.`);

            // Target check stays first so duration mode errors cleanly.
            const target = mode === 'duration' ? parseInt(document.getElementById('g-target').value, 10) : null;
            if (mode === 'duration' && (!target || target < 1)) throw new Error('Enter a target duration.');

            // Duration mode: if no vial × quantity can hold the regimen at all,
            // keep v1.13's message instead of a per-vial capacity error.
            let cands = null;
            if (mode === 'duration') {
                cands = durationCandidates(steps, vials);
                if (!cands.length) throw new Error(`No vial of ${med} can accommodate this regimen.`);
            }

            // BOTH modes compute from the current inputs (vial select + Vials
            // box). Duration mode fills those inputs from a suggestion — auto-
            // applied when the target changes, and freely overridable by hand.
            const vLabel = document.getElementById('g-vial').value;
            const vial = vials.find(v => v.label === vLabel);
            if (!vial) throw new Error('Pick a vial.');
            const resolved = resolveTotalDoseMode(steps, vial, qty);
            const d = dispenseOf(vial, qty);

            let note = '';
            if (mode === 'duration') {
                const opts = rankDurationOptions(cands, target);
                if (opts.covering.length === 0 && opts.best) {
                    const bv = opts.best.qty * opts.best.packVials;
                    note = `\n[!] ${bv === 1 ? 'No vial reaches' : `Nothing within ${MAX_VIALS * opts.best.packVials} vials reaches`} ${target} wks. Longest via ${pharmacy}: ${vialRefOf(opts.best.vial, opts.best.qty)} → ${opts.best.result.duration} wks.`;
                } else {
                    note = `\n[picked via ${pharmacy}: ${vialRefOf(vial, qty)} → ${resolved.duration} wks, target ${target}]`;
                }
            }

            outEl.textContent = buildOrderBlock({ medication: med, vial, qty, resolved, pharmacy, initials, date, orderNumber });
            sigEl.textContent = buildSig(resolved, vial.conc);

            const over = resolved.overdraw;
            const multi = d.vials > 1;
            let drawNote = '';
            if (over > 0) drawNote = `⚠️ ${multi ? "Order" : "Vial"} will run out ~${trimNum(over / UNITS_PER_ML)} mL before Week ${resolved.duration}.\n`;
            else if (over < 0) drawNote = multi
                ? `${trimNum(-over / UNITS_PER_ML)} mL remaining across ${d.vials} vials.\n`
                : `${trimNum(-over / UNITS_PER_ML)} mL remaining in vial.\n`;
            drawNote += `[${trimNum(resolved.unitsUsed)} of ${resolved.unitsAvailable} units used]`;
            if (multi) {
                const spans = vialCoverage(resolved, (vial.volume / d.packVials) * UNITS_PER_ML, d.vials);
                const parts = spans.map(s => `vial ${s.vial} = ${s.start === s.end ? `week ${s.start}` : `weeks ${s.start}-${s.end}`}`);
                for (let v = 1; v <= d.vials; v++) if (!spans.some(s => s.vial === v)) parts.push(`vial ${v} = unused`);
                drawNote += `\nVial coverage: ${parts.join(" · ")}`;
            }
            if (note) drawNote += `\n${note}`;
            notesEl.textContent = drawNote;

            // Seed the weeks→days box with this order's estimated duration unless the user typed their own.
            const wk = document.getElementById('g-wk2d');
            if (wk && !wkManual) wk.value = resolved.duration;
            renderSuggestions(target);
        } catch (e) {
            outEl.textContent = ''; sigEl.textContent = ''; notesEl.textContent = '';
            errEl.textContent = e.message;
            renderSuggestions(null);
        }
        weeksToDays();
        refreshChips(); // start boxes follow any input change (mg, end, …), not just end weeks
    }

    function weeksToDays() {
        const wk = document.getElementById('g-wk2d');
        const out = document.getElementById('g-wk2d-out');
        if (!wk || !out) return;
        const n = parseFloat(wk.value);
        out.textContent = isNaN(n) || n < 0 ? '' : `= ${trimNum(n * 7)} days`;
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

    function loadStandard() {
        const medEl = document.getElementById('g-med');
        const errEl = document.getElementById('g-err');
        const med = medEl ? medEl.value : '';
        const ramp = STANDARD_DOSING[drugOf(med)];
        if (!ramp) {
            if (errEl) errEl.textContent = med ? `No standard dosing ramp for ${med}.` : 'Pick a medication first.';
            return;
        }
        stepRows = ramp.map(r => ({ mg: String(r.mg), end: r.end === null ? '' : String(r.end) }));
        renderSteps(); recalc();
    }

    function resetForm() {
        stepRows = [{ mg: '', end: '' }, { mg: '', end: '' }, { mg: '', end: '' }];
        const q = document.getElementById('g-vials'); if (q) q.value = '1';
        const d = document.getElementById('g-date'); if (d) d.value = denverToday();
        wkManual = false;
        const wk = document.getElementById('g-wk2d'); if (wk) wk.value = '';
        const wo = document.getElementById('g-wk2d-out'); if (wo) wo.textContent = '';
        setMode('total'); renderSteps(); recalc();
    }

    function togglePanel() {
        const p = document.getElementById(PANEL_ID);
        p.style.display = p.style.display === 'none' ? 'block' : 'none';
    }

    // Trigger contract rule 2 — the two exits the × alone does not cover: Escape, and a
    // click anywhere outside. Same 12 lines as the Patient Toolkit's copy (SPEC bundling
    // rule: no @require, every script carries its own copy).
    function wirePanelDismiss(getPanel, getTrigger, close) {
        const inside = (el, node) => !!(el && node && (el === node || el.contains(node)));
        const isOpen = () => { const p = getPanel(); return !!p && p.style.display !== 'none'; };
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && isOpen()) close(); });
        document.addEventListener('click', (e) => {
            if (!e.isTrusted || !isOpen()) return;
            if (inside(getPanel(), e.target) || inside(getTrigger(), e.target)) return;
            close();
        }, true);
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
        renderMeds(); renderVials(); renderSteps(); recalc();
        injectToolbarButton();
        // Rule 2: ✕ (in buildPanel) + Escape + click-outside. Wired once.
        wirePanelDismiss(
            () => document.getElementById(PANEL_ID),
            () => document.getElementById(BTN_ID),
            () => { const p = document.getElementById(PANEL_ID); if (p) p.style.display = 'none'; }
        );
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
