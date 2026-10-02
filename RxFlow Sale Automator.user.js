// ==UserScript==
// @name         RxFlow Sale Automator
// @namespace    jeyson-sale-automator
// @version      2.34
// @author       Jeyson Dagondon
// @description  Auto-drive RxFlow sales from CSV/JSON rows: lookup, consent, products
// @match        https://staff.exampleclinic.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[PSA v2.34] boot');

// --- Script API (R18) — agent-facing status/trigger/output channel ---
window.__scripts = window.__scripts || {};
window.__scripts['PSA'] = {
  name: 'RxFlow Sale Automator',
  version: '2.33',
  state: 'idle',
  message: '',
  progress: null,
  output: null,
  error: null,
  // v2.20: pharmacy-routing advisory result for the current row (advisory only
  // — the flow's own state/message are never overwritten by it).
  routing: null,
  lastActivity: Date.now(),
  trigger: null
};
(function () {
    'use strict';
    const api = window.__scripts['PSA'];
    function apiSet(state, message, extra) {
      api.state = state;
      api.message = message || '';
      api.lastActivity = Date.now();
      if (extra) Object.assign(api, extra);
      if (state === 'error') api.error = message || '';
      if (state === 'done' || state === 'idle') { api.error = null; }
      renderTrigger(); // the navbar trigger is the state readout while the panel is closed
      console.info(`[PSA] API: ${state}${message ? ' — ' + message : ''}`);
    }

    /* =========================================================================
       SECTION 1 — CONFIG / REFERENCE DATA
       Everything in this section is data, not logic. Edit freely when the
       clinic's product list, aliases, or field names change — none of it is
       hardcoded into the automation steps below.
       ========================================================================= */

    // Product catalog, carried over from the existing Product Quick Nav script.
    // v2.9: RxFlow renamed the med-type button "Peptide" -> "Peptides"
    // (2026-08-17) and moved GLOW to the STK brand; BPC-157/KPV/TB500 added.
    const CATALOG = {
        "Peptides": {
            "Longevity": [
                "[GRE] Epithalon injectable",
                "[GRE] GHK-Cu injectable",
                "[GRE] Glutathione injection",
                "GHK-Cu/Epithalon 10mg/2mg/mL SOLUTION"
            ],
            "Mitochondria / Metabolic": [
                "[GRE] 5-Amino 1MQ capsules",
                "[GRE] MOTS-C injectable",
                "[GRE] MOTs-C/Tesamorelin injectable"
            ],
            "Fat Loss": [
                "[GRE] AOD-9604/MOTs-C/Tesamorelin injectable"
            ],
            "Healing": [
                "[GRE] BPC-157 capsules",
                "[GRE] BPC-157 injectable",
                "[GRE] BPC-157/KPV/TB500",
                "[GRE] BPC-157/TB-500 capsules",
                "[STK] GLOW",
                "[GRE] KLOW",
                "[GRE] Wolverine 1",
                "[STK] TB500 injectable"
            ],
            "Growth Hormone": [
                "[GRE] CJC/Ipamorelin injectable"
            ],
            "Sleep": [
                "[GRE] DSIP injectable",
                "[GRE] DSIP/BPC/CJC injectable"
            ],
            "Libido": [
                "[GRE] Kisspeptin injectable",
                "[GRE] PT-141 injectable"
            ],
            "Cognitive": [
                "[GRE] Pinealon/PE22-28/Selank injectable",
                "[GRE] Semax/Selank injectable"
            ],
            "Fat Loss / Growth Hormone": [
                "[GRE] Tesamorelin injectable",
                "[GRE] Tesamorelin/Ipamorelin injectable"
            ],
            "Autoimmune": [
                "[GRE] Thymosin injectable"
            ],
            "Mitochondria / Energy": [
                "[GRE] NAD+ Injectable"
            ]
        }
    };

    // Reverse index: exact product name -> { medType, category, product }
    const PRODUCT_INDEX = {};
    for (const [medType, categories] of Object.entries(CATALOG)) {
        for (const [category, products] of Object.entries(categories)) {
            products.forEach((product) => {
                PRODUCT_INDEX[product] = { medType, category, product };
            });
        }
    }

    // ── PSA CATALOG MAPPING (v2.32) — extracted by _smoketest/verify-psa-catalog.js
    /* ---- Live catalog sweep + fuzzy mapping (v2.32) ----------------------
       Jeyson 2026-10-02: "it doesnt properly map to the right peptides because
       the website has pretty shitty naming system... it must have a extract
       sweep of the peptides in the list so we can fuzzy match".
       Verified by a live sweep of the picker: the hardcoded CATALOG below has
       ALREADY drifted — "Fat Loss" and "Fat Loss / Growth Hormone" are EMPTY
       live (so the aliases tesa / tesa/ipa name products the picker no longer
       lists), [STK] twins exist for GHK-Cu / BPC-157 / CJC-IPA / NAD+, and the
       whole GLP1 med type is missing here. So the picker is swept, the sweep
       becomes the candidate pool, names are fuzzy-matched against it, and a
       name that is not clearly decided is ASKED, never guessed
       (DESIGN.md § Data lookup and verification). */
    const LIVE_CATALOG_KEY = "psa-live-catalog";
    const LEARNED_ALIAS_KEY = "psa-learned-aliases";
    const FUZZY_AUTO_MIN = 0.72; // a candidate must clear this to be auto-picked
    const FUZZY_MARGIN = 0.12;   // ...and beat the runner-up by this much

    function readJsonKey(key, fallback) {
        try { const v = JSON.parse(localStorage.getItem(key) || ""); return v || fallback; } catch (e) { return fallback; }
    }
    function readLiveCatalog() {
        const v = readJsonKey(LIVE_CATALOG_KEY, null);
        return (v && Array.isArray(v.rows) && v.rows.length) ? v : null;
    }
    function readLearnedAliases() { const v = readJsonKey(LEARNED_ALIAS_KEY, null); return (v && typeof v === "object") ? v : {}; }
    // A learned alias is Jeyson's own decision, not a guess: once he picks the
    // peptide for a shorthand, that shorthand resolves outright from then on.
    function learnAlias(alias, product) {
        const map = readLearnedAliases();
        map[String(alias).toLowerCase().trim()] = product;
        localStorage.setItem(LEARNED_ALIAS_KEY, JSON.stringify(map));
    }
    // Candidate pool: the swept picker when a sweep exists, else the hardcoded
    // catalog. A cold sweep must never disable name resolution.
    function catalogPool() {
        const live = readLiveCatalog();
        if (live) return live.rows.map((r) => ({ medType: r.medType, category: r.category, product: r.product, tab: r.tab || "eRx", live: true }));
        return Object.keys(PRODUCT_INDEX).map((product) => ({ ...PRODUCT_INDEX[product], tab: "eRx", live: false }));
    }
    function poolEntry(product) {
        const hit = catalogPool().find((p) => p.product === product);
        return hit ? { medType: hit.medType, category: hit.category, product: hit.product, tab: hit.tab } : null;
    }
    function catalogDrift() {
        const live = readLiveCatalog(); if (!live) return null;
        const liveNames = new Set(live.rows.map((r) => r.product));
        const hardNames = new Set(Object.keys(PRODUCT_INDEX));
        return { ts: live.ts, count: live.rows.length,
            gone: [...hardNames].filter((n) => !liveNames.has(n)),
            added: [...liveNames].filter((n) => !hardNames.has(n)) };
    }

    // Sweep the picker exactly the way goToProduct drives it. Read-only: picking
    // a product does nothing server-side until "Continue" (Jeyson 2026-10-02).
    async function sweepLiveCatalog() {
        const visible = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.offsetParent !== null);
        const uniq = (arr) => [...new Set(arr.map((e) => (e.innerText || "").trim()).filter(Boolean))];
        const types = uniq(visible("#medications-list .btn"));
        if (!types.length) { console.info("[PSA] catalog sweep: no med-type buttons"); return null; }
        console.info(`[PSA] catalog sweep: ${types.length} med types`, types);
        const rows = [];
        for (const medType of types) {
            const mtEl = visible("#medications-list .btn").find((e) => (e.innerText || "").trim() === medType);
            if (!mtEl) continue;
            mtEl.click(); await sleep(1200);
            const cats = uniq(visible(".med-item"));
            console.info(`[PSA] sweep ${medType}: ${cats.length} categories`);
            for (const category of cats) {
                const catEl = visible(".med-item").find((e) => (e.innerText || "").trim() === category);
                if (!catEl) continue;
                catEl.click(); await sleep(700);
                const tabs = uniq(visible(".col.text-center.cursor-class > div"));
                for (const tab of (tabs.length ? tabs : ["eRx"])) {
                    const tabEl = visible(".col.text-center.cursor-class > div").find((e) => (e.innerText || "").trim() === tab);
                    if (tabEl) { tabEl.click(); await sleep(600); }
                    for (const product of uniq(visible(".filtered-items .cursor-class.text-break.font-weight-bold"))) {
                        rows.push({ medType, category, tab, product });
                    }
                }
            }
        }
        if (!rows.length) { console.info("[PSA] catalog sweep: picker rendered but no products"); return null; }
        const stamp = { ts: Date.now(), rows };
        localStorage.setItem(LIVE_CATALOG_KEY, JSON.stringify(stamp));
        return stamp;
    }

    /* ---- Fuzzy name matching ------------------------------------------------
       Token model: brand tag dropped, form words and units dropped, everything
       else (- / . ( ) split) kept — INCLUDING doses, because "0.5 mg" and
       "1 mg" are different products. A token matches exactly (1.0), as a prefix
       (0.85 — "ipa" for "ipamorelin"), or by bigram similarity (typos). */
    const FUZZY_DROP = new Set(["injectable", "injection", "inj", "capsules", "capsule", "caps", "solution", "mg", "mcg", "ml", "with", "w/", "w"]);
    function fuzzyTokens(s) {
        return String(s).toLowerCase().replace(/^\[[a-z]+\]\s*/, "").replace(/[^a-z0-9+/]+/g, " ")
            // Doses stay: "0.5 mg" and "1 mg" are DIFFERENT products, so a bare
            // numeric token counts even when it is one character long.
            .split(" ").filter((t) => (t.length > 1 || /^\d/.test(t)) && !FUZZY_DROP.has(t));
    }
    function bigrams(s) { const out = []; for (let i = 0; i + 1 < s.length; i++) out.push(s.slice(i, i + 2)); return out; }
    function dice(a, b) {
        if (a === b) return 1;
        const A = bigrams(a), B = new Set(bigrams(b));
        if (!A.length || !B.size) return 0;
        let hit = 0; for (const g of A) if (B.has(g)) hit++;
        return (2 * hit) / (A.length + B.size);
    }
    function tokenMatch(t, ptoks) {
        let best = 0;
        for (const p of ptoks) {
            if (p === t) return 1;
            const r = (p.startsWith(t) || t.startsWith(p)) ? 0.85 : dice(t, p);
            if (r > best) best = r;
        }
        return best;
    }
    function brandOf(name) { const m = String(name).match(/^\[([a-z]+)\]/i); return m ? m[1].toLowerCase() : null; }
    function fuzzyCandidates(alias) {
        const atoks = fuzzyTokens(alias);
        if (!atoks.length) return [];
        let scored = catalogPool().map((p) => {
            const ptoks = fuzzyTokens(p.product);
            const score = atoks.reduce((a, t) => a + tokenMatch(t, ptoks), 0) / atoks.length;
            return { medType: p.medType, category: p.category, product: p.product, tab: p.tab, score: Math.round(score * 100) / 100 };
        }).filter((p) => p.score >= 0.5);
        const brandHint = brandOf(alias);
        if (brandHint) { const b = scored.filter((p) => brandOf(p.product) === brandHint); if (b.length) scored = b; }
        const wantForm = productForm(alias);
        if (wantForm) { const f = scored.filter((p) => productForm(p.product) === wantForm); if (f.length) scored = f; }
        return scored.sort((a, b) => b.score - a.score).slice(0, 6);
    }
    function fuzzyResolve(alias) {
        const cands = fuzzyCandidates(alias);
        if (!cands.length) return { verdict: "unknown", candidates: [] };
        const top = cands[0];
        const runner = cands[1] && cands[1].score >= top.score - FUZZY_MARGIN ? cands[1] : null;
        if (top.score >= FUZZY_AUTO_MIN && !runner) return { verdict: "auto", best: top, candidates: cands };
        return { verdict: "ambiguous", best: top, candidates: cands };
    }
    // ── PSA CATALOG MAPPING END ──

    // Shorthand -> exact catalog product name, used to parse the "Purchase"
    // column (e.g. "Tesa/IPA", "Klow"). Keys are matched case-insensitively
    // after trimming. This is a reference table, not logic — extend it as
    // new shorthand shows up in the sheet.
    const PRODUCT_ALIASES = {
        "klow": "[GRE] KLOW",
        "glow": "[STK] GLOW",
        "tesa/ipa": "[GRE] Tesamorelin/Ipamorelin injectable",
        "tesa": "[GRE] Tesamorelin injectable",
        "epithalon": "[GRE] Epithalon injectable",
        "thymosin alpha-1 inj": "[GRE] Thymosin injectable",
        "thymosin inj": "[GRE] Thymosin injectable",
        "thymosin": "[GRE] Thymosin injectable",
        "dsip inj": "[GRE] DSIP injectable",
        "dsip": "[GRE] DSIP injectable",
        "bpc": "[GRE] BPC-157 injectable",
        "bpc-157": "[GRE] BPC-157 injectable",
        "bpc-157 caps": "[GRE] BPC-157 capsules",
        "bpc-157/kpv/tb500": "[GRE] BPC-157/KPV/TB500",
        "bpc/kpv/tb500": "[GRE] BPC-157/KPV/TB500",
        "wolverine": "[GRE] Wolverine 1",
        "wolverine 1": "[GRE] Wolverine 1",
        // v2.20 (Jeyson 2026-09-24): the sheet also writes the Wolverine
        // variants — "Wolverine Light" and "Wolverine injection"/"Inj" all mean
        // the same catalog product. Without these entries the name resolver
        // could NOT save them: it strips a trailing form word only
        // (injectable/inj/capsules/solution), so "Wolverine injection" ->
        // "wolverine" and "Wolverine Light" -> "wolverine light", neither of
        // which equals the catalog name "[GRE] Wolverine 1" — both fell through
        // to "unmapped" and handed the whole item to the human.
        "wolverine light": "[GRE] Wolverine 1",
        "wolverine injection": "[GRE] Wolverine 1",
        "wolverine inj": "[GRE] Wolverine 1",
        "wolverine injectable": "[GRE] Wolverine 1",
        "nad+": "[GRE] NAD+ Injectable",
        "nad": "[GRE] NAD+ Injectable",
        "pt-141": "[GRE] PT-141 injectable",
        "pt141": "[GRE] PT-141 injectable",
        "glutathione": "[GRE] Glutathione injection",
        "cjc/ipa": "[GRE] CJC/Ipamorelin injectable",
        "cjc": "[GRE] CJC/Ipamorelin injectable",
        // v2.2: short sheet names (Jeyson's real purchase column, 2026-08-06).
        "kisspeptin": "[GRE] Kisspeptin injectable",
        "kisspeptin inj": "[GRE] Kisspeptin injectable",
        "bpc inj": "[GRE] BPC-157 injectable",
        "bpc157": "[GRE] BPC-157 injectable",
        "bpc157 inj": "[GRE] BPC-157 injectable",
        "nad+ inj": "[GRE] NAD+ Injectable",
        "nad inj": "[GRE] NAD+ Injectable",
        // v2.14 (2026-08-19): GHK-Cu shorthand — "3 GHK-Cu Inj." hit unmapped.
        "ghk-cu inj": "[GRE] GHK-Cu injectable",
        "ghk-cu": "[GRE] GHK-Cu injectable"
        // Anything typed in the sheet that isn't a key here (e.g.
        // a brand-new product) will surface as an "unmapped item" for
        // manual handling rather than silently failing.
    };

    // The sales source selected when creating a sale. Must match the option
    // label in the "Choose any option" dropdown exactly. The script force-opens
    // the dropdown and selects this source automatically.
    const SALE_SOURCE = "Dr. Example Phone Order";

    // Quantity cap for peptides: the clinic only ever orders 3 of each at a
    // time, even when the sheet says more (e.g. "6" -> 3). The app's own
    // "+" control also disables past this point (disabled-qty-btn), so this
    // keeps the automation inside the enabled range too.
    const MAX_PEPTIDE_QTY = 3;

    /* ---------------------------------------------------------------------
       PHARMACY ROUTING (v2.20) — advisory only
       Mirrors the clinic's availability matrix from the CC Custom Build
       extractor (`RESTRICTION_MAP` / `PHARMACY_OFFERS` / `MED_RULES` /
       `COMPONENT_FORMS` there). This script does not PICK a pharmacy — the
       pharmacy is chosen downstream (LifeFile order creation) — so the matrix
       is used purely to WARN: "Greenwich and Pharmacy A won't ship this to <state>
       direct; ship it to Heather (the clinic, CO) instead."

       "Ship to Heather" = the clinic's Colorado address. Sending a
       state-blocked order to the clinic is standard procedure (Jeyson
       2026-09), which is why a blocked route is a warning with a known
       destination, not a dead end.

       Keep these tables in sync with the CC extractor — `_smoketest/
       verify-psa-v20.js` diffs the shared rows so a matrix edit on one side
       can't silently drift from the other.
       --------------------------------------------------------------------- */
    const CLINIC_STATE = "CO";
    const CLINIC_NAME = "Heather";

    // Full state name -> abbreviation (the profile header prints the FULL
    // name: "State : North Carolina").
    const STATE_ABBR = {
        "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
        "colorado": "CO", "connecticut": "CT", "delaware": "DE", "district of columbia": "DC",
        "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL",
        "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA",
        "maine": "ME", "maryland": "MD", "massachusetts": "MA", "michigan": "MI",
        "minnesota": "MN", "mississippi": "MS", "missouri": "MO", "montana": "MT",
        "nebraska": "NE", "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ",
        "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
        "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA",
        "rhode island": "RI", "south carolina": "SC", "south dakota": "SD", "tennessee": "TN",
        "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA", "washington": "WA",
        "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY", "puerto rico": "PR"
    };

    // State -> pharmacies that will NOT ship there. A "(...)" note is a
    // PARTIAL/conditional restriction. Pharmacy J is unrestricted in all 50 states
    // and is therefore absent; Pharmacy F / Pharmacy G have no restriction data.
    const RESTRICTION_MAP = {
        AL: ["Pharmacy D", "Formulation", "Pharmacy B", "Pharmacy C", "Pharmacy H", "Pharmacy E", "Greenwich"],
        AK: ["Pharmacy D", "Pharmacy I", "Pharmacy B", "Pharmacy H"],
        AR: ["Formulation", "Pharmacy I", "Pharmacy B", "Pharmacy E", "Greenwich"],
        CA: ["Pharmacy D", "Formulation", "Pharmacy I", "Pharmacy B", "Pharmacy C", "Pharmacy H", "Pharmacy E", "Greenwich"],
        CT: ["Pharmacy D", "Pharmacy H", "Greenwich"],
        DC: ["Pharmacy C"],
        DE: ["Greenwich"],
        GA: ["Greenwich"],
        HI: ["Pharmacy I", "Pharmacy B"],
        IL: ["Greenwich"],
        IN: ["Pharmacy D", "Greenwich"],
        IA: ["Pharmacy B"],
        KY: ["Formulation", "Greenwich"],
        LA: ["Pharmacy D", "Pharmacy B", "Pharmacy C", "Pharmacy E", "Greenwich"],
        ME: ["Pharmacy I"],
        MA: ["Pharmacy H", "Pharmacy E", "Pharmacy C (MOTS-c specific)"],
        MI: ["Pharmacy D", "Formulation", "Pharmacy C", "Greenwich"],
        MN: ["Greenwich"],
        MS: ["Pharmacy D", "Pharmacy B", "Pharmacy C", "Pharmacy E", "Greenwich"],
        MT: ["Pharmacy D", "Pharmacy C"],
        NE: ["Formulation", "Pharmacy B"],
        NV: ["Pharmacy D", "Formulation", "Pharmacy E", "Greenwich"],
        NH: ["Pharmacy H", "Greenwich"],
        NJ: ["Greenwich"],
        NM: ["Greenwich"],
        NC: ["Pharmacy B", "Pharmacy H", "Greenwich"],
        ND: ["Pharmacy A", "Greenwich"],
        OH: ["Pharmacy D", "Pharmacy B", "Pharmacy C", "Pharmacy A"],
        OK: ["Greenwich"],
        OR: ["Formulation", "Pharmacy E", "Pharmacy B (for Thymosin Alpha-1)"],
        RI: ["Pharmacy H"],
        SC: ["Pharmacy D", "Pharmacy B", "Pharmacy E", "Greenwich"],
        SD: ["Greenwich"],
        TN: ["Greenwich"],
        TX: ["Pharmacy D", "Pharmacy I", "Pharmacy C", "Pharmacy H (no injections)"],
        VT: ["Pharmacy H", "Greenwich"],
        VA: ["Formulation", "Pharmacy E", "Greenwich"],
        WA: ["Pharmacy D", "Formulation", "Pharmacy C", "Pharmacy E", "Greenwich"],
        WV: ["Pharmacy D", "Formulation", "Pharmacy C", "Greenwich"]
    };

    // Which pharmacies offer each component. "Pharmacy K" is an MDToolbox
    // pharmacy, not a LifeFile portal. A component missing here has no known
    // alternative and reads "no availability data" rather than guessing.
    const PHARMACY_OFFERS = {
        reta:      ["Pharmacy L"],
        bpc:       ["Pharmacy L", "Greenwich", "Pharmacy J"],
        "bpc-kpv": ["Pharmacy J"],
        kpv:       ["Pharmacy J"],
        tb:        ["Pharmacy L"],
        cjc:       ["Greenwich", "Pharmacy A"],
        ghk:       ["Pharmacy L", "Pharmacy A", "Pharmacy K"],
        tesa:      ["Pharmacy L"],
        "tesa-ipa": ["Pharmacy K"],
        mots:      ["Pharmacy L", "Pharmacy C"],
        ss31:      ["Pharmacy B", "Pharmacy C"],
        thymosin:  ["Greenwich", "Pharmacy B"],
        klow:      ["Greenwich"],
        wolverine: ["Greenwich", "Pharmacy A"],
        glow:      ["Pharmacy A", "Pharmacy K"],
        "slu-pp":  ["Pharmacy J"],
        nad:       ["Pharmacy L"],
        sema:      ["Pharmacy A", "Greenwich"],
        tirz:      ["Pharmacy A", "Greenwich"],
        // Keys must stay identical to the extractor's PHARMACY_OFFERS (verify-psa-v20
        // gate). LDN and Tesofensine added 2026-10-01 (Jeyson): LDN is Pharmacy F only —
        // Pharmacy H on a Functional Medicine care plan, Pharmacy G otherwise — and
        // Tesofensine is Pharmacy J. Neither is a RxFlow catalog product, so this row
        // exists to keep the two matrices from drifting, not to route a RxFlow sale.
        ldn:       ["Pharmacy G", "Pharmacy H"],
        tesofensine: ["Pharmacy J"]
    };

    // Components that ship in more than one dosage form AND route differently
    // per form — the union in PHARMACY_OFFERS above is not what the router
    // uses for these. Detected from the product name ("… capsules" / "…
    // injectable"), never guessed: a form the component doesn't come in reads
    // as unknown rather than borrowing the wrong route.
    const COMPONENT_FORMS = {
        bpc: [
            { form: "Injectable", offers: ["Pharmacy L", "Greenwich"] },
            { form: "Pill",       offers: ["Pharmacy J"] }
        ],
        "bpc-kpv": [{ form: "Pill", offers: ["Pharmacy J"] }],
        kpv:       [{ form: "Pill", offers: ["Pharmacy J"] }]
    };

    // Pharmacy B is licensed for SS-31 in THESE states ONLY. Kept verbatim as an
    // allow-list so it can be diffed straight against the email.
    const SS31_PROGRESS_LICENSED = ["AZ", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "MA", "MD", "MO", "MT", "NE", "NH", "NJ", "NY", "ND", "OH", "OK", "OR", "PA", "RI", "SD", "TN", "UT", "VT", "WI", "WY"];

    // Med-specific (conditional) restrictions: a pharmacy that is not
    // hard-blocked in a state still can't ship THESE components there.
    // `states` is a BLOCK-list unless `mode: 'allow'` flips it to an allow-list.
    const MED_RULES = [
        { pharmacy: "Pharmacy C", states: ["MA"], components: ["mots"], label: "MOTS-c specific" },
        { pharmacy: "Pharmacy B",   states: ["OR"], components: ["thymosin"], label: "Thymosin Alpha-1" },
        { pharmacy: "Pharmacy B",   states: SS31_PROGRESS_LICENSED, components: ["ss31"], label: "SS-31", mode: "allow" }
    ];

    // The PSA sale-form catalog product -> routing component. This is the PS
    // side of the matrix: the extractor routes Care Plan TITLES, this routes
    // the catalog names the sale form actually lists.
    //
    // Products deliberately ABSENT have no availability data in the clinic
    // matrix (glutathione, DSIP, pinealon/semax, kisspeptin, PT-141,
    // 5-Amino-1MQ, GHK-Cu/Epithalon and the AOD/MOTs-C/Tesamorelin combos).
    // They are reported as "no availability data" in the banner — never
    // silently claimed to be shippable, and never blocking the row.
    const PRODUCT_COMPONENTS = {
        "[GRE] Epithalon injectable": "epithalon",
        "[GRE] GHK-Cu injectable": "ghk",
        "[GRE] Glutathione injection": "glutathione",
        "GHK-Cu/Epithalon 10mg/2mg/mL SOLUTION": "ghk-epithalon",
        "[GRE] 5-Amino 1MQ capsules": "5-amino-1mq",
        "[GRE] MOTS-C injectable": "mots",
        "[GRE] MOTs-C/Tesamorelin injectable": "mots-tesa",
        "[GRE] AOD-9604/MOTs-C/Tesamorelin injectable": "aod-mots-tesa",
        "[GRE] BPC-157 capsules": "bpc",
        "[GRE] BPC-157 injectable": "bpc",
        "[GRE] BPC-157/KPV/TB500": "bpc-kpv",
        "[GRE] BPC-157/TB-500 capsules": "bpc-tb",
        "[STK] GLOW": "glow",
        "[GRE] KLOW": "klow",
        "[GRE] Wolverine 1": "wolverine",
        "[STK] TB500 injectable": "tb",
        "[GRE] CJC/Ipamorelin injectable": "cjc",
        "[GRE] DSIP injectable": "dsip",
        "[GRE] DSIP/BPC/CJC injectable": "dsip-bpc-cjc",
        "[GRE] Kisspeptin injectable": "kisspeptin",
        "[GRE] PT-141 injectable": "pt141",
        "[GRE] Pinealon/PE22-28/Selank injectable": "pinealon",
        "[GRE] Semax/Selank injectable": "semax-selank",
        "[GRE] Tesamorelin injectable": "tesa",
        "[GRE] Tesamorelin/Ipamorelin injectable": "tesa-ipa",
        "[GRE] Thymosin injectable": "thymosin",
        "[GRE] NAD+ Injectable": "nad"
    };

    // Components that exist in the PSA catalog but have NO availability data in
    // the clinic matrix. Reported so the gap is visible instead of looking like
    // a clean bill of health.
    const COMPONENT_LABELS = {
        epithalon: "Epithalon", ghk: "GHK-Cu", glutathione: "Glutathione",
        "ghk-epithalon": "GHK-Cu/Epithalon", "5-amino-1mq": "5-Amino 1MQ",
        mots: "MOTS-c", "mots-tesa": "MOTs-C/Tesamorelin",
        "aod-mots-tesa": "AOD-9604/MOTs-C/Tesamorelin",
        bpc: "BPC-157", "bpc-kpv": "BPC-157/KPV/TB500", "bpc-tb": "BPC-157/TB-500",
        glow: "Glow Blend", klow: "KLOW", wolverine: "Wolverine", tb: "TB-500",
        cjc: "CJC-1295/Ipamorelin", dsip: "DSIP", "dsip-bpc-cjc": "DSIP/BPC/CJC",
        kisspeptin: "Kisspeptin", pt141: "PT-141", pinealon: "Pinealon/PE22-28/Selank",
        "semax-selank": "Semax/Selank", tesa: "Tesamorelin", "tesa-ipa": "Tesamorelin/Ipamorelin",
        thymosin: "Thymosin Alpha-1", nad: "NAD+", reta: "Retatrutide",
        sema: "Semaglutide", tirz: "Tirzepatide", ss31: "SS-31"
    };

    // Safe default answers for the sale-form questionnaire. The questionnaire
    // is one adaptive form — which question groups render depends on the
    // products in the cart (verified live: KLOW/Tesa add healing+GH groups,
    // BPC/NAD+ add more). Every checkbox group carries a "None of the above" /
    // "No known allergies" option and Yes/No radios, so these generic rules
    // cover every product's questionnaire. The script PREFILLS these but NEVER
    // submits and NEVER skips — a human must review and click Submit
    // (prefillSaleQuestionnaire; single path since v2.20).
    const QUESTIONNAIRE_SAFE_OPTIONS = {
        // Radio groups: click the first option whose label matches (in order).
        // v2.0: added "No to both", "Not sure yet", "Stay at Same dose",
        // "No hair loss yet" — question variants that render with no plain
        // "No" option. Explicit per-question answers (QUESTION_EXPLICIT_ANSWERS)
        // are checked BEFORE these generic patterns.
        radioSafePatterns: [
            /^No$/,                  // plain Yes/No questions
            /^No to both$/,          // physical exam / lab work style questions
            /^No active symptoms/,   // "No active symptoms – using proactively" (symptom onset)
            /^Not sure yet$/,        // "What form of Epithalon...?" style
            /^Stay at Same dose/,    // GLP-1 refill dose preference
            /^No hair loss yet/      // hair-loss status: "No hair loss yet – hoping to prevent it"
        ],
        // Checkbox groups: check the first option whose label matches.
        // v2.0: added none-equivalents ("No history...", "No prior...",
        // "first time", "No chronic medical conditions", "Still have a full
        // head of hair") and the consent/disclosure acknowledgments
        // ("I understand...") which the clinic always requires checked.
        checkboxSafePatterns: [
            /^I understand/,         // consent / disclosure acknowledgments
            /^None of the above$/,
            /^No known allergies/,
            /^No history or symptoms/,
            /^No prior/,
            /^No chronic medical conditions$/,
            /^Still have a full head of hair$/,
            /first time/,            // "This is my first time using NAD+..." / "No – this will be my first time"
            /^No /                   // last resort: any "No ..." negation option
        ],
        // Free-text fields prefilled (matched against the field's label).
        // v2.0: conditional follow-ups ("If yes, please list/describe",
        // "If \"Other\", please specify") render visible even when the
        // trigger answer is No/None — "N/A" is the standard safe fill.
        freeTextDefaults: [
            { label: /anything else/i, value: "N/A" },
            { label: /if yes, please/i, value: "N/A" },
            { label: /if "?other"?\s*,?\s*please/i, value: "N/A" }
        ]
    };

    // Explicit per-question answers (v2.1), checked BEFORE the generic patterns.
    // Key = normalized question label (lowercase, alphanumeric only, collapsed
    // spaces). Each entry lists the ACCEPTABLE options (Jeyson's picks, 2026-08-06):
    //   - type "radio": the script clicks ONE of the listed options (chosen at
    //     random when more than one is listed — radio groups are single-select).
    //   - type "checkbox": the script checks a RANDOM NON-EMPTY subset of the
    //     listed options — random which AND how many, so questionnaires don't
    //     come out identical for every patient.
    // Questions NOT in this map have no explicit answer — they stay manual and
    // glow for the pharmacist.
    const QUESTION_EXPLICIT_ANSWERS = {
        // The clinic requires a recent physical exam AND lab work — this
        // question is ALWAYS "Yes, both" (Jeyson's policy, 2026-08-06).
        "have you had a physical exam and or lab work within the last 12 24 months": { type: "radio", options: ["Yes, both"] },
        "how would you describe the area or condition you are hoping to support with this therapy": { type: "checkbox", options: ["General longevity / regenerative wellness", "Inflammatory gut or GI symptoms"] },
        "how long have you been experiencing symptoms you re hoping to improve": { type: "radio", options: ["6–12 months"] },
        "how long have you been experiencing sleep related issues": { type: "radio", options: ["6–12 months"] },
        "what are your primary goals for epithalon therapy select up to 3": { type: "checkbox", options: ["Improved sleep regulation", "Enhanced cellular repair or longevity", "Stress resilience or mood regulation"] },
        "what is your primary goal for this treatment": { type: "checkbox", options: ["Weight loss", "Improve metabolic health", "Improve body composition", "General wellness support"] },
        "what are your primary health goals for microdose glp1 therapy check all that apply": { type: "checkbox", options: ["Appetite regulation", "Longevity and healthy aging"] },
        "how would you describe your skin type": { type: "radio", options: ["Unsure"] },
        "how long have these concerns been present": { type: "radio", options: ["6–12 months"] },
        "what are your primary goals for vip therapy check all that apply": { type: "checkbox", options: ["Fatigue or low energy", "Cognitive enhancement", "Enhancing overall brain function or mental clarity"] },
        "what are your primary goals with nad topical therapy select all that apply": { type: "checkbox", options: ["Mood or mental clarity", "Recovery or performance optimization", "Mitochondrial or cellular energy support", "Anti-aging or longevity benefits"] },
        "have you previously used any nad therapies select all that apply": { type: "checkbox", options: ["This is my first time using NAD+ in any form"] },
        "what are your primary goals for using semax selank select all that apply": { type: "checkbox", options: ["Cognitive support (focus, memory, clarity)", "Resilience to stress or burnout", "Mood regulation or emotional stability", "Support during periods of high performance/demand", "Immune system modulation", "General nootropic use or biohacking"] },
        "do you currently experience any of the following select all that apply": { type: "checkbox", options: ["Low mood or emotional blunting", "Difficulty focusing or brain fog", "Poor sleep quality due to mental restlessness", "Fatigue, mental exhaustion, or burnout"] },
        "how would you describe your current mental and emotional baseline": { type: "checkbox", options: ["Stable and functional"] },
        "what are your primary goals with thymosin therapy select all that apply": { type: "checkbox", options: ["Immune support or immune modulation", "Anti-inflammatory benefits", "Autoimmune condition support", "Longevity or anti-aging goals", "Neurological or cognitive support"] },
        "what are your primary goals for using aod 9604": { type: "checkbox", options: ["Improved body composition", "Fat loss", "Support for weight loss resistance", "Prevention of weight regain"] },
        "how long have you been struggling with weight or metabolic challenges": { type: "checkbox", options: ["Over 1 year"] },
        "what are your primary goals with ll 37 therapy": { type: "checkbox", options: ["Immune system modulation", "Antimicrobial and anti-biofilm support", "Wound healing and tissue regeneration", "Autoimmune modulation"] },
        "what are your primary goals with tesamorelin ipamorelin combination therapy select all that apply": { type: "checkbox", options: ["Body composition improvements (e.g., fat reduction, muscle preservation)", "Support for healthy growth hormone levels", "Improved recovery or repair (e.g., injury, post-exercise)", "Sleep or circadian rhythm support", "Cognitive clarity or mood support", "Anti-aging or longevity support", "Metabolic improvements (e.g., insulin sensitivity, lipid balance)"] },
        "what are your primary goals with retatrutide therapy select all that apply": { type: "checkbox", options: ["Improved metabolic health", "Longevity or anti-aging support", "Appetite/craving control", "Visceral fat reduction", "Energy enhancement"] },
        "what are your primary goals for starting kisspeptin therapy": { type: "checkbox", options: ["Improve reproductive function/fertility", "Improve libido or sexual function"] },
        "what are your primary goals with this therapy select all that apply": { type: "checkbox", options: ["Sleep support or circadian rhythm regulation", "Cognitive support (e.g., memory, focus, processing speed)", "Mood or emotional regulation (e.g., anxiety, stress resilience)", "Recovery from burnout, fatigue, or neurological injury"] },
        "what symptoms or conditions are you currently targeting": { type: "checkbox", options: ["Cognitive symptoms (memory, clarity)", "Fatigue or low energy", "Chronic pain or inflammation"] },
        "what are your primary goals for hormone therapy please select all that apply": { type: "checkbox", options: ["Energy and vitality", "Reduced anxiety or irritability", "Improved libido", "Mood stabilization", "Improved sleep", "Cognitive clarity"] },
        "what is your primary goal for starting hcg treatment": { type: "radio", options: ["Reduce body fat", "Improve metabolism", "Body composition improvement", "Break through a weight loss plateau", "Weight loss"] }
    };
    const normalizeQuestionKey = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
    // Tolerant option-label comparison (trim + collapse whitespace).
    const normLabel = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");

    /* =========================================================================
       SECTION 1b — PHARMACY ROUTING ENGINE (advisory)
       Pure functions over the tables above — no DOM. Returns plain data so the
       panel and any harness can render/inspect the same result.
       ========================================================================= */

    const normPharm = (s) => String(s || "").replace(/\s+/g, " ").trim().toLowerCase();

    /* ---------------------------------------------------------------------
       PREVIOUS-QUESTIONNAIRE CHECK (v2.20) — informational only
       Jeyson 2026-09-24: "Autofill either way. Just let me know whether or not
       there was a previous questionnaire."

       So this changes NO behaviour: the sale-form questionnaire is autofilled
       whether or not one exists before. It only REPORTS the history on the
       profile page so the pharmacist can see it. Verified live 2026-09-24 on
       patient 351792 (the tab's own XHR is the source of the endpoints):
         GET /api/getPatientQuestionnariesHeaderValues/<id>
             -> {"code":"success","questionData":{"height":"5'3\"","weight":207}}
         GET /api/getPatientQuestionnaries/<id>
             -> paginated records: {id, template_id, patient_id, answers, status, ...}
         GET /api/getFunnelQuestionnaireList
             -> the template catalogue (13667 Dr. Example Product Questionnaire /
                source 1036, 13666 Renewal / 1029, 15527 Weborder / 1028)
       NOTE: the sale-form questionnaire itself is a Vue `formRender` component
       (submit form id "questionnare-form") rendered inside a modal, NOT a form
       in the parent document — and this profile tab only carries an empty
       `#funnelQuestionnaireFrame` iframe. Nothing here touches the form.
       --------------------------------------------------------------------- */
    const QUESTIONNAIRE_HISTORY_URL = (pid) => "/api/getPatientQuestionnaries/" + encodeURIComponent(pid);

    // Patient id from the profile URL (/patient-details/<id>, /patient-sales/<id>).
    function patientIdFromUrl() {
        const m = location.pathname.match(/^\/patient-(?:details|sales)\/(\d+)/);
        return m ? m[1] : "";
    }

    // PURE: normalize the /api/getPatientQuestionnaries response. No DOM, no
    // fetch — so the harness can exercise every shape (empty, paginated,
    // missing/odd fields) without a live page.
    function parseQuestionnaireHistory(json) {
        if (!json || typeof json !== "object") return { ok: false, reason: "no response body" };
        const rows = Array.isArray(json.data) ? json.data : [];
        return {
            ok: true,
            total: typeof json.total === "number" ? json.total : rows.length,
            records: rows.map((r) => {
                let answers = [];
                try { answers = JSON.parse(r.answers || "[]"); } catch (e) { answers = []; }
                if (!Array.isArray(answers)) answers = [];
                return {
                    id: r.id,
                    templateId: r.template_id,
                    status: r.status || "",
                    submittedAt: r.submitted_at || r.updated_at || r.created_at || "",
                    answerCount: answers.length
                };
            })
        };
    }

    // Fetch the patient's questionnaire records. Read-only GET, same-origin, so
    // the session cookies already authorize it (verified live 2026-09-24: the
    // records tab fetches exactly this URL, and it appears in the page's own
    // resource log). Never throws: any failure returns { ok:false } and the
    // panel says the check could not be made rather than implying "no previous
    // questionnaire" (which would be a lie).
    async function fetchQuestionnaireHistory(patientId) {
        if (!patientId) return { ok: false, reason: "no patient id in the URL" };
        try {
            const res = await fetch(QUESTIONNAIRE_HISTORY_URL(patientId), {
                credentials: "same-origin",
                headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" }
            });
            if (!res.ok) return { ok: false, reason: "HTTP " + res.status };
            return parseQuestionnaireHistory(await res.json());
        } catch (err) {
            return { ok: false, reason: err && err.message ? err.message : String(err) };
        }
    }

    // Template id -> name, from the app's own catalogue endpoint.
    async function fetchQuestionnaireTemplates() {
        try {
            const res = await fetch("/api/getFunnelQuestionnaireList", {
                credentials: "same-origin",
                headers: { Accept: "application/json", "X-Requested-With": "XMLHttpRequest" }
            });
            if (!res.ok) return {};
            const json = await res.json();
            const map = {};
            for (const q of (json && json.questionaires) || []) map[String(q.id)] = q.title;
            return map;
        } catch (err) {
            return {};
        }
    }

    // Renders the history line(s) into the current panel body (never wipes it).
    function renderQuestionnaireHistory(history, templates, panel) {
        const wrap = document.createElement("div");
        wrap.style.cssText = "margin-top:6px;padding-top:6px;border-top:1px dashed var(--ds-border, #e8e2d8);";
        const head = document.createElement("div");
        head.style.cssText = "font-weight:bold;";
        wrap.appendChild(head);

        if (!history.ok) {
            head.textContent = "Previous questionnaire: could not check (" + history.reason + ")";
            head.style.color = "var(--ds-muted, #7a7163)";
            panel.body.appendChild(wrap);
            console.warn("[PSA] questionnaire history check failed:", history.reason);
            return { found: null, message: "check failed: " + history.reason };
        }

        if (!history.total) {
            head.textContent = "Previous questionnaire: NONE on file";
            head.style.color = "var(--ds-warn, #a16207)";
            const note = document.createElement("div");
            note.textContent = "No prior Dr. Example Product Questionnaire for this patient — the sale form's questionnaire is still autofilled.";
            note.style.color = "var(--ds-muted, #7a7163)";
            wrap.appendChild(note);
            panel.body.appendChild(wrap);
            console.info("[PSA] previous questionnaire: none on file for this patient");
            return { found: false, message: "none on file" };
        }

        head.textContent = "Previous questionnaire: " + history.total + " on file";
        head.style.color = "var(--ds-success, #3d7a46)";
        for (const rec of history.records) {
            const line = document.createElement("div");
            const name = templates[String(rec.templateId)] || ("template " + rec.templateId);
            const when = rec.submittedAt ? String(rec.submittedAt).replace("T", " ").slice(0, 16) : "no date";
            line.textContent = "• " + name + " — " + (rec.status || "?") + " · " + when + " · " + rec.answerCount + " answers";
            line.style.color = "var(--ds-muted, #7a7163)";
            wrap.appendChild(line);
        }
        panel.body.appendChild(wrap);
        console.info("[PSA] previous questionnaire: " + history.total + " on file — " + history.records.map((r) => (templates[String(r.templateId)] || r.templateId) + "/" + r.status).join(", "));
        return { found: true, message: history.total + " on file" };
    }


    // Normalize a state value to its 2-letter abbreviation, or "" when it is
    // neither a known full name nor a 2-letter code. Never guesses: an
    // unrecognized value returns "" so the advisory says "state not readable"
    // instead of routing on a wrong state.
    function normalizeStateAbbr(value) {
        const clean = String(value || "").replace(/\s+/g, " ").trim();
        if (!clean) return "";
        if (/^[A-Za-z]{2}$/.test(clean)) return clean.toUpperCase();
        return STATE_ABBR[clean.toLowerCase()] || "";
    }

    // Pharmacy-name match tolerant of the matrix's aliases: the same pharmacy
    // is "Pharmacy B" in the offering lists but "Pharmacy B" in the
    // restriction map. Mirrors the extractor's `pharmMatches`.
    function pharmMatches(a, b) {
        const x = normPharm(a), y = normPharm(b);
        if (!x || !y) return false;
        return x === y || x.includes(y) || y.includes(x);
    }

    // Hard-restricted pharmacies for a state (full entries only — a "(...)"
    // note marks a conditional/partial restriction).
    function hardRestrictedPharmacies(stateAbbr) {
        return (RESTRICTION_MAP[stateAbbr] || []).filter((n) => !/\(/.test(n));
    }
    function pharmacyHardRestricted(pharm, stateAbbr) {
        return hardRestrictedPharmacies(stateAbbr).some((n) => pharmMatches(n, pharm));
    }
    function pharmacyMedRestricted(pharm, stateAbbr, componentKey) {
        return MED_RULES.some((r) => {
            if (!pharmMatches(r.pharmacy, pharm) || !r.components.includes(componentKey)) return false;
            const listed = r.states.includes(stateAbbr);
            return r.mode === "allow" ? !listed : listed;
        });
    }

    // Dosage form named by a catalog product name, or "" when it doesn't say.
    // Only the words at the END of the name count, so a combo product doesn't
    // tag its components with the wrong form.
    // NOTE: named `routingFormFor`, not `productForm` — the v2.19 name resolver
    // below already owns `productForm` (returns the PRODUCT_FORM_RULES
    // canonical) and a second declaration would silently shadow it.
    function routingFormFor(product) {
        const s = String(product || "").toLowerCase();
        if (/\bcapsules?\b|\bpills?\b|\btablets?\b/.test(s)) return "Pill";
        if (/\binjectable\b|\binjection\b|\bsolution\b|\binj\b/.test(s)) return "Injectable";
        return "";
    }

    // Routing component for a catalog product, or null when the clinic matrix
    // has no entry for it.
    function componentForProduct(product) {
        return PRODUCT_COMPONENTS[product] || null;
    }

    // Worst-first severity order, matching the extractor.
    const RX_STATUS_ORDER = ["blocked", "clinic", "partial", "ok", "unknown"];

    // Status for ONE offering list in the patient's state.
    //   ok      — at least one pharmacy ships direct and none are blocked
    //   partial — some blocked, but a direct route still exists
    //   clinic  — every offering pharmacy is blocked here, but CO (Heather) is
    //             not, i.e. ship it to the clinic
    //   blocked — blocked here AND in CO: nowhere to send it
    function offersStatus(offering, componentKey, stateAbbr) {
        const blocked = [], ok = [], viaClinic = [];
        for (const ph of offering) {
            const isBlocked = pharmacyHardRestricted(ph, stateAbbr) || pharmacyMedRestricted(ph, stateAbbr, componentKey);
            if (!isBlocked) { ok.push(ph); continue; }
            blocked.push(ph);
            if (!pharmacyHardRestricted(ph, CLINIC_STATE) && !pharmacyMedRestricted(ph, CLINIC_STATE, componentKey)) {
                viaClinic.push(ph);
            }
        }
        const status = !blocked.length ? "ok"
            : ok.length ? "partial"
            : viaClinic.length ? "clinic" : "blocked";
        return { status, blocked, ok, viaClinic };
    }

    // Status for ONE component in the patient's state. Multi-form components
    // have their form taken from the product name; the top-level status is the
    // WORST form so the row still warns.
    function componentStatus(componentKey, stateAbbr, formName) {
        const forms = COMPONENT_FORMS[componentKey];
        if (!PHARMACY_OFFERS[componentKey] && !forms) {
            return { status: "unknown", blocked: [], ok: [], viaClinic: [] };
        }
        if (forms && forms.length) {
            const only = formName
                ? forms.find((f) => f.form === formName)
                : (forms.length === 1 ? forms[0] : null);
            if (formName && !only) {
                // The product named a form this component doesn't come in.
                return { status: "unknown", blocked: [], ok: [], viaClinic: [], form: formName };
            }
            if (only) {
                const r = offersStatus(only.offers, componentKey, stateAbbr);
                return (formName && forms.length > 1) ? Object.assign(r, { form: only.form }) : r;
            }
            const per = forms.map((f) => Object.assign({ form: f.form }, offersStatus(f.offers, componentKey, stateAbbr)));
            const worst = per.reduce((a, b) =>
                RX_STATUS_ORDER.indexOf(b.status) < RX_STATUS_ORDER.indexOf(a.status) ? b : a);
            return {
                status: worst.status,
                blocked: per.flatMap((p) => p.blocked),
                ok: per.flatMap((p) => p.ok),
                viaClinic: per.flatMap((p) => p.viaClinic),
                forms: per
            };
        }
        return offersStatus(PHARMACY_OFFERS[componentKey], componentKey, stateAbbr);
    }

    // Advisory report for a purchase string in a state.
    // Returns { status: "no-state" } when no state could be read, and
    // { status: "nothing-routable" } when no purchase item maps to the matrix,
    // so the caller renders no banner rather than an empty or misleading one.
    function routingReport(purchase, stateAbbr) {
        const state = normalizeStateAbbr(stateAbbr);
        if (!state) return { status: "no-state", state: "", rows: [] };

        const { items } = parsePurchase(purchase || "");
        const seen = new Set();
        const rows = [];
        for (const it of items) {
            const byAlias = PRODUCT_INDEX[it.alias];
            const product = it.product || (byAlias ? byAlias.product : "");
            const key = componentForProduct(product) || componentForProduct(it.alias);
            if (!key || seen.has(key)) continue;
            seen.add(key);
            const formName = routingFormFor(product || "");
            const st = componentStatus(key, state, formName);
            rows.push({
                key,
                label: (COMPONENT_LABELS[key] || key) + (st.form ? " (" + st.form + ")" : ""),
                status: st.status,
                blocked: st.blocked,
                ok: st.ok,
                viaClinic: st.viaClinic,
                forms: st.forms
            });
        }
        if (!rows.length) return { status: "nothing-routable", state, rows };
        let level = "ok";
        for (const w of RX_STATUS_ORDER) { if (rows.some((r) => r.status === w)) { level = w; break; } }
        return { status: level, state, rows };
    }

    function routingNeedsAttention(report) {
        return !!report && ["blocked", "clinic", "partial"].includes(report.status);
    }

    // Severity order for DISPLAY — most-restrictive first. Same order as
    // RX_STATUS_ORDER except unknown last (it is a data gap, not a block).
    const ROUTING_DISPLAY_ORDER = { blocked: 0, clinic: 1, partial: 2, ok: 3, unknown: 4 };
    const ROUTING_COLOR = {
        blocked: "var(--ds-danger, #b3402e)",
        clinic:  "var(--ds-warn, #a16207)",
        partial: "var(--ds-warn, #a16207)",
        ok:      "var(--ds-success, #3d7a46)",
        unknown: "var(--ds-muted, #7a7163)"
    };

    // One-line, non-nesting rendering of a routing status (the extractor nests
    // an outline under each Care Plan title; the PSA panel is 340px wide, so the
    // same facts go on one wrapped line).
    //   ok       ✓ BPC-157 — Direct: Pharmacy L, Greenwich
    //   partial  ⚠ Tirzepatide — no OH direct · ship to Heather (CO): Pharmacy A, Greenwich
    //   clinic   ⚠ KLOW — nothing ships to WA direct · ship to Heather (CO): Greenwich
    //   blocked  ⛔ Thymosin — restricted in ND AND CO — no route
    function routingRowText(row, state) {
        const label = row.label;
        if (row.status === "ok") return "✓ " + label + " — Direct: " + row.ok.join(", ");
        if (row.status === "unknown") return "? " + label + " — no availability data";
        if (row.status === "blocked") return "⛔ " + label + " — restricted in " + state + " AND " + CLINIC_STATE + " — no route";
        const dest = row.viaClinic.length ? row.viaClinic.join(", ") : (row.blocked.join(", ") || "the blocked pharmacy");
        if (row.status === "partial") {
            return "⚠ " + label + " — no " + state + " direct for " + row.blocked.join(", ")
                + " · ship " + dest + " to " + CLINIC_NAME + " (" + CLINIC_STATE + ") · Direct: " + row.ok.join(", ");
        }
        return "⚠ " + label + " — nothing ships to " + state + " direct · ship " + dest + " to " + CLINIC_NAME + " (" + CLINIC_STATE + ")";
    }

    // Renders the advisory into the CURRENT panel body (never wipes it) and
    // records it on the API channel. Advisory only: the pharmacy is picked
    // downstream, so nothing here blocks or changes the sale.
    // NOTE: deliberately does NOT call apiSet — the panel status line belongs
    // to the consent/questionnaire step that is running. The advisory rides
    // `api.routing` instead, so an agent can read it without the flow's own
    // state being overwritten.
    function renderRoutingAdvisory(job, panel, stateOverride) {
        try {
            const state = stateOverride || job.state || (job.row && job.row.patientState) || "";
            const report = routingReport(job.row && job.row.purchase, state);
            const needsAttention = routingNeedsAttention(report);
            job.routing = {
                status: report.status,
                state: report.state || "",
                needsAttention,
                rows: report.rows.map((r) => ({ key: r.key, label: r.label, status: r.status, blocked: r.blocked, ok: r.ok, viaClinic: r.viaClinic }))
            };
            saveJob(job);
            api.routing = job.routing;

            // No state read -> say so; a silent banner would look like a clean
            // routing result when nothing was actually checked.
            if (report.status === "no-state") {
                const note = document.createElement("div");
                note.style.cssText = "margin-top:6px;font-weight:bold;color:" + ROUTING_COLOR.unknown;
                note.textContent = "⚠ Pharmacy routing not checked — the patient's SHIPPING address state could not be read"
                    + (job.stateHint ? " (the profile header says " + job.stateHint + ", which is the patient's own state, not where this ships)" : "")
                    + ". Verify the route manually before choosing a pharmacy.";
                panel.body.appendChild(note);
                console.warn("[PSA] routing: patient state not readable — routing not checked");
                return job.routing;
            }
            if (report.status === "nothing-routable") {
                console.info("[PSA] routing: no routable product in the purchase column — nothing to check");
                return job.routing; // stay silent rather than imply a check happened
            }

            const wrap = document.createElement("div");
            wrap.style.cssText = "margin-top:7px;padding-top:6px;border-top:1px dashed var(--ds-border, #e8e2d8);";
            const head = document.createElement("div");
            head.style.cssText = "font-weight:bold;color:" + (needsAttention ? ROUTING_COLOR.partial : ROUTING_COLOR.ok);
            head.textContent = "Pharmacy routing (ships to " + report.state + ") — "
                + (needsAttention ? "check before picking a pharmacy" : "no state restrictions found");
            wrap.appendChild(head);

            const sorted = report.rows.slice().sort((a, b) => ROUTING_DISPLAY_ORDER[a.status] - ROUTING_DISPLAY_ORDER[b.status]);
            for (const row of sorted) {
                const line = document.createElement("div");
                line.style.cssText = "margin-top:2px;color:" + (ROUTING_COLOR[row.status] || ROUTING_COLOR.unknown);
                if (row.status === "partial" || row.status === "clinic") line.style.fontWeight = "bold";
                line.textContent = routingRowText(row, report.state);
                wrap.appendChild(line);
            }
            panel.body.appendChild(wrap);

            // Console line: the whole report in one grep-able place (the panel
            // is transient; a mis-route investigation needs a durable record).
            console.info(`[PSA] routing ${report.state} ${report.status} — ` + sorted.map((r) => `${r.label}:${r.status}[${r.blocked.join("/")}|direct:${r.ok.join("/")}|clinic:${r.viaClinic.join("/")}]`).join("; "));
            return job.routing;
        } catch (err) {
            // Advisory must never take the row down.
            console.warn("[PSA] routing advisory failed", err);
            return null;
        }
    }
    // Fisher–Yates shuffle + random count 1..N — never an empty subset, so a
    // required explicit question is always answered (v2.1 randomization).
    function randomSubset(options) {
        const arr = options.slice();
        for (let i = arr.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [arr[i], arr[j]] = [arr[j], arr[i]];
        }
        return arr.slice(0, 1 + Math.floor(Math.random() * arr.length));
    }

    // Question group helpers (v2.0). The formbuilder renders each question as
    // a wrapper div (.form-group) with a question <label class="formbuilder-
    // ...-label"> and the inputs inside. Required questions carry a "*" in
    // the wrapper text. Missed required questions get a red pulsing glow so
    // the pharmacist can spot them at a glance (Jeyson's ask, 2026-08-06).
    function questionGroupFor(input) {
        return input.closest(".form-group") || input.closest("[class*='formbuilder-']");
    }
    function questionGroupLabel(group) {
        if (!group) return "";
        const l = group.querySelector(".formbuilder-radio-group-label, .formbuilder-checkbox-group-label, [class*='formbuilder-'][class*='label'], label");
        const txt = (l ? l.textContent : group.textContent).trim().replace(/\s+/g, " ");
        return txt.replace(/\*+$/, "").trim();
    }
    function groupIsRequired(group) {
        return !!(group && group.textContent.includes("*"));
    }
    function ensureGlowStyle() {
        if (document.getElementById("psa-q-glow-style")) return;
        const st = document.createElement("style");
        st.id = "psa-q-glow-style";
        st.textContent = `
            .psa-q-missed { box-shadow: 0 0 0 3px #e74c3c !important; border-radius: 4px !important; }
            .psa-q-missed .formbuilder-radio-group-label,
            .psa-q-missed .formbuilder-checkbox-group-label,
            .psa-q-missed label,
            .psa-q-missed .formbuilder-label { color: #e74c3c !important; font-weight: bold !important; }
            @keyframes psa-q-pulse { 0%,100% { box-shadow: 0 0 0 3px #e74c3c; } 50% { box-shadow: 0 0 0 7px #ff7b6e; } }
            .psa-q-missed { animation: psa-q-pulse 1.2s ease-in-out infinite !important; }`;
        document.head.appendChild(st);
    }
    function markMissed(group) {
        if (!group || group.offsetParent === null) return; // only visible questions
        ensureGlowStyle();
        group.classList.add("psa-q-missed");
    }

    // Canonical field -> normalized header variants we auto-recognize.
    // Headers are normalized (lowercased, non-alphanumeric stripped) before
    // matching, so "RxFlow Patient ID", "rxflow_patient_id", and
    // "RxFlowPatientID" all match the same entry.
    const FIELD_ALIASES = {
        patientId:       ["rxflowpatientid", "patientid", "rxpatientid", "rxflowid"],
        patientEmail:    ["patientemail", "email"],
        phone:           ["phone", "phonenumber", "mobile", "contactnumber"],
        patientName:     ["patientname", "name", "fullname"],
        purchase:        ["purchase", "order", "products", "items"],
        existingPatient: ["existingrxflowpatient", "existingpatient", "existingrxflow"],
        shipDate:        ["desiredshippingdate", "shippingdate", "shipdate"],
        patientState:    ["patientstate", "state"],
        notes:           ["notes", "note", "comment", "comments"]
    };
    const CANONICAL_FIELDS = Object.keys(FIELD_ALIASES);
    const FIELD_LABELS = {
        patientId: "RxFlow Patient ID",
        patientEmail: "Patient Email",
        phone: "Phone",
        patientName: "Patient Name",
        purchase: "Purchase",
        existingPatient: "Existing RxFlow Patient",
        shipDate: "Desired Shipping Date",
        patientState: "Patient State",
        notes: "Notes"
    };

    // The sheet's column order never changes, so headerless single-row pastes
    // can be auto-mapped by position (FIXED_HEADER_ORDER) instead of requiring
    // manual mapping. FIXED_HEADER_FIELDS maps each column header to the
    // canonical field it feeds (columns not listed are ignored by the automator).
    // v1.27: order refreshed to match the live sheet (Intake Link after Phone,
    // Confirmed Shipping / Medical Action added; Patient State column is gone).
    // v2.18: added "Current Healing/GH peptides" (between Purchase and Existing
    // RxFlow Patient). It is informational — not mapped to any canonical
    // field — but it MUST hold its position here so headerless single-row
    // pastes keep aligning every later column.
    // ── BUSINESS CONTEXT: the "Existing RxFlow Patient" column ──────────
    // (Jeyson, 2026-08-18 — do not "fix" this semantics back into a profile
    // check. A non-empty value, e.g. "YES - Do Not Resend Intake", means the
    // patient has ordered BEFORE and a sale was already created for them, so
    // there is no need to SEND them another intake questionnaire. Blank = no
    // prior order/sale.
    // CRITICAL: the column records PRIOR-SALE status, NOT mere existence in
    // RxFlow — finding a profile in the search does NOT imply a prior
    // sale, so never derive existingPatient from profile-check results.
    // v2.20 — THE COLUMN NO LONGER DECIDES ANYTHING. It used to be the sole
    // input to "skip the questionnaire?" (v2.12), which was wrong twice over:
    // the sale-form questionnaire is fetched per-sale from the CART's drug ids,
    // not from patient history, and a Skip click REMOVES the form. The script
    // now observes whether a questionnaire rendered and always autofills it
    // (Jeyson 2026-09-24: "never skip, always autofill"). The field is still
    // parsed and still shown to the pharmacist — it is useful context about
    // whether the patient has ordered before — but nothing branches on it.
    const FIXED_HEADER_ORDER = [
        "Patient Name", "Patient Email", "Phone", "Intake Link",
        "RxFlow Patient ID", "Purchase", "Current Healing/GH peptides",
        "Existing RxFlow Patient",
        "Invite Sent", "FA Signed", "Confirmed Shipping",
        "RxFlow Intake Completed", "Desired Shipping Date", "Medical Action",
        "Order Date", "Order Date Timestamp", "Notes"
    ];
    const FIXED_HEADER_FIELDS = {
        "Patient Name": "patientName",
        "Patient Email": "patientEmail",
        "Phone": "phone",
        "RxFlow Patient ID": "patientId",
        "Purchase": "purchase",
        "Existing RxFlow Patient": "existingPatient",
        "Desired Shipping Date": "shipDate",
        "Notes": "notes"
    };

    /* =========================================================================
       SECTION 2 — INPUT PARSING (CSV or JSON, auto-detected)
       ========================================================================= */

    function detectDelimiter(headerLine) {
        const candidates = [",", "\t", ";"];
        let best = ",", bestCount = -1;
        for (const d of candidates) {
            const count = headerLine.split(d).length;
            if (count > bestCount) { bestCount = count; best = d; }
        }
        return best;
    }

    // Guesses whether a line is a real header row (like "Patient Name, Email...")
    // versus a raw data row (like "Patient Name, patient@example.com..."). This
    // matters because a single copied spreadsheet row — no header line at all —
    // is the normal case here, not the exception.
    function looksLikeHeaderRow(cells) {
        let score = 0;
        for (const cell of cells) {
            const norm = normalizeHeader(cell);
            for (const field of CANONICAL_FIELDS) {
                if (FIELD_ALIASES[field].includes(norm)) { score++; break; }
            }
        }
        return score >= 2; // at least 2 recognizable field names -> treat as a header row
    }

    function parseCSV(text) {
        if (typeof text !== "string") return [];
        const body = text.trim();
        if (!body) return [];

        // Delimiter detection reads the first PHYSICAL line (the header row) —
        // embedded newlines only ever appear in data cells, never the header.
        const delim = detectDelimiter(body.split(/\r\n|\n|\r/)[0] || "");

        // Full-stream CSV tokenizer (hardened v2.18). The sheet gained a
        // "Current Healing/GH peptides" column whose cells contain EMBEDDED
        // NEWLINES (e.g. "8/7\n3 Tesa/Ipa"). Spreadsheet copies quote such
        // cells, but the old parser split the whole text on newlines FIRST,
        // so every embedded newline became a fake row break — one patient
        // turned into several broken rows. This tokenizer walks the entire
        // text in a single pass and only ends a field (delimiter) or a row
        // (newline) when OUTSIDE quotes, so multi-line cells stay intact.
        const rows = [];
        let row = [];
        let field = "";
        let inQuotes = false;
        let i = 0;
        while (i < body.length) {
            const ch = body[i];
            const next = body[i + 1];
            if (inQuotes) {
                if (ch === '"') {
                    if (next === '"') { field += '"'; i += 2; continue; } // "" escape
                    inQuotes = false; i++; continue;
                }
                field += ch; i++; continue;
            }
            if (ch === '"') {
                // A quote opens a quoted field only at the START of a field;
                // mid-cell quotes (e.g. a height like 6'8") stay literal.
                if (field === "") { inQuotes = true; i++; continue; }
                field += ch; i++; continue;
            }
            if (ch === delim) { row.push(field); field = ""; i++; continue; }
            if (ch === "\r" || ch === "\n") {
                if (ch === "\r" && next === "\n") i++; // CRLF = one break
                row.push(field); field = "";
                if (row.some((c) => c.trim() !== "")) rows.push(row);
                row = [];
                i++; continue;
            }
            field += ch; i++;
        }
        row.push(field); // flush the final field
        if (row.some((c) => c.trim() !== "")) rows.push(row);

        if (rows.length === 0) return [];

        // Collapse embedded whitespace inside each cell — multi-line cells
        // become single lines ("8/7\n3 Tesa/Ipa" -> "8/7 3 Tesa/Ipa",
        // "3 Epithalon &\n3 Thymosin Inj" -> "3 Epithalon & 3 Thymosin Inj").
        const cells = rows.map((r) => r.map((c) => c.trim().replace(/\s+/g, " ")));

        const firstIsHeader = looksLikeHeaderRow(cells[0]);

        if (firstIsHeader) {
            const headers = cells[0];
            const out = [];
            for (let i = 1; i < cells.length; i++) {
                const obj = {};
                headers.forEach((h, idx) => { obj[h] = cells[i][idx] !== undefined ? cells[i][idx] : ""; });
                out.push(obj);
            }
            return out;
        }

        // Headerless: every line is data. Build synthetic column names sized
        // to the widest row and carry the actual values so the mapping stage
        // can show samples.
        const maxCols = Math.max(...cells.map((line) => line.length));
        const headers = Array.from({ length: maxCols }, (_, i) => `Column ${i + 1}`);
        return cells.map((line) => {
            const obj = {};
            headers.forEach((h, idx) => { obj[h] = line[idx] !== undefined ? line[idx] : ""; });
            return obj;
        });
    }

    // Cleans messy clipboard pastes from Google Sheets / Excel before parsing.
    // Real pastes carry an Mso HTML-comment prefix ("<!--td {...}-->"), the
    // name cell may be a GHL markdown link ("[Patient Name](https://...)"), and
    // stray tags can appear. Strip those so the row parses cleanly.
    function sanitizeRawInput(text) {
        return String(text)
            .replace(/<!--[\s\S]*?-->/g, "")          // Mso / HTML comments
            // <br> tags are how HTML-clipboard copies encode the line breaks
            // INSIDE a cell (the Mso comment "br {mso-data-placement:same-cell}")
            // — turn them into a space (v2.18) so a multi-line cell stays one
            // field instead of words getting merged ("8/7<br>3 Tesa/Ipa" would
            // otherwise strip to "8/73 Tesa/Ipa"). Real newlines in a TSV paste
            // are handled by the quote-aware parseCSV below.
            .replace(/<br\s*\/?>/gi, " ")
            .replace(/<[^>]*>/g, "")                  // any leftover tags
            .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1") // [text](url) -> text
            .trim();
    }

    function parseInput(raw) {
        const trimmed = sanitizeRawInput(raw);
        if (!trimmed) return [];
        if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
            const parsed = JSON.parse(trimmed); // let caller catch/report errors
            return Array.isArray(parsed) ? parsed : [parsed];
        }
        return parseCSV(trimmed);
    }

    /* =========================================================================
       SECTION 3 — COLUMN MAPPING (auto-map + editable preview)
       ========================================================================= */

    function normalizeHeader(h) {
        return String(h).toLowerCase().replace(/[^a-z0-9]/g, "");
    }

    function autoMapColumns(sampleRow) {
        const headers = Object.keys(sampleRow);
        const normalizedHeaders = headers.map((h) => ({ original: h, norm: normalizeHeader(h) }));
        const mapping = {};
        for (const field of CANONICAL_FIELDS) {
            const variants = FIELD_ALIASES[field];
            const match = normalizedHeaders.find((h) => variants.includes(h.norm));
            mapping[field] = match ? match.original : null;
        }
        return mapping;
    }

    // Headerless pastes (a single copied row with no header line) can't be
    // mapped by header name. The sheet's column order is stable, so fall back
    // to mapping by position via FIXED_HEADER_ORDER.
    function autoMapByFixedSchema(sampleRow) {
        const mapping = {};
        const colHeaders = Object.keys(sampleRow);
        for (let i = 0; i < FIXED_HEADER_ORDER.length; i++) {
            const field = FIXED_HEADER_FIELDS[FIXED_HEADER_ORDER[i]];
            if (!field) continue;
            if (!mapping[field] && colHeaders[i]) mapping[field] = colHeaders[i];
        }
        return mapping;
    }

    function normalizeRow(row, mapping) {
        const out = {};
        for (const field of CANONICAL_FIELDS) {
            const header = mapping[field];
            out[field] = header && row[header] !== undefined ? String(row[header]).trim() : "";
        }
        return out;
    }

    /* =========================================================================
       SECTION 4 — JOB STATE (persists across page loads / new tabs)
       The sale flow spans multiple pages/tabs (dashboard -> patient-details ->
       patient-sales -> a freshly opened sale tab). localStorage is shared
       across tabs on the same origin, so the job survives the handoff.
       ========================================================================= */

    const JOB_KEY = "psa-active-job";

    function saveJob(job) { localStorage.setItem(JOB_KEY, JSON.stringify(job)); }
    function loadJob() {
        try { return JSON.parse(localStorage.getItem(JOB_KEY)); }
        catch (e) { return null; }
    }
    function clearJob() { localStorage.removeItem(JOB_KEY); }

    // The row queue outlives the active job: it persists in localStorage so
    // the panel can keep every pasted row clickable at ALL times (input stage,
    // mid-flow steps, and the final "Click Continue" gate) — no Reset needed
    // to move on to the next patient (v1.26).
    const QUEUE_KEY = "psa-row-queue";
    function saveQueue(rows) { localStorage.setItem(QUEUE_KEY, JSON.stringify(rows)); }
    function loadQueue() {
        try { return JSON.parse(localStorage.getItem(QUEUE_KEY)); }
        catch (e) { return null; }
    }
    function clearQueue() { localStorage.removeItem(QUEUE_KEY); }

    // UI generation counter. Reset() bumps it so an in-flight async step that
    // was already running (e.g. consent-check's wait loop) can't finish and
    // overwrite the fresh panel after a reset — verified live that it did.
    let panelEpoch = 0;
    function beginRender() { const e = panelEpoch; return () => e === panelEpoch; }

    /* =========================================================================
       SECTION 5 — GENERIC DOM HELPERS
       ========================================================================= */

    function findByText(selector, text, exact = true, caseInsensitive = true) {
        // Case-insensitive by default: the UI mixes casing (e.g. the button
        // is "CREATE SALE", not "Create Sale"), so an exact-case match misses it.
        const els = document.querySelectorAll(selector);
        const needle = caseInsensitive ? text.toLowerCase() : text;
        for (const el of els) {
            const t = el.textContent.trim();
            const hay = caseInsensitive ? t.toLowerCase() : t;
            if (exact ? hay === needle : hay.includes(needle)) return el;
        }
        return null;
    }

    function waitForByText(selector, text, timeout = 20000, exact = true) {
        return new Promise((resolve, reject) => {
            const existing = findByText(selector, text, exact);
            if (existing) return resolve(existing);
            const observer = new MutationObserver(() => {
                const el = findByText(selector, text, exact);
                if (el) { observer.disconnect(); resolve(el); }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Timeout waiting for "${text}"`));
            }, timeout);
        });
    }

    function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

    // v1.27 debug trace: every pass step logs to window.__psaTrace so a silent
    // stall can be diagnosed from the live page instead of by guessing.
    function trace() {
        try {
            const t = (window.__psaTrace = window.__psaTrace || []);
            t.push(Date.now() + " " + Array.prototype.join.call(arguments, " "));
            if (t.length > 300) t.splice(0, t.length - 300);
        } catch (e) { /* trace must never break the flow */ }
    }

    /* ---- Navigation interceptor (removes the trusted-click handoffs) ----
       The app opens patient profiles and sale forms with window.open(). A
       @grant none userscript can't synthesize a TRUSTED click, and the popup
       blocker drops window.open calls that don't come from a real user
       gesture — so those pages never opened from synthetic clicks, and v1.7/
       v1.8 handed those clicks to the user. But window.open is just a JS
       call: verified live that synthetic clicks DO fire the app's Vue
       handlers (only the popup is blocked). So we hook window.open, capture
       the URL it wants to open, and navigate the CURRENT tab via location.href
       (which is never popup-blocked). That removes both manual handoffs.
       IMPORTANT (v1.25): interception is scoped to navCaptureActive so it only
       suppresses popups while the AUTOMATION is driving a click. Manual
       window.open calls (e.g. a real click on View Patient to open a new tab)
       must pass through untouched — the old all-the-time hook swallowed them. */
    let navCaptureActive = false;
    function installNavInterceptor() {
        if (window.__psa_navInstalled) return;
        window.__psa_navInstalled = true;
        window.__psa_lastNav = null;
        const origOpen = window.open;
        window.open = function (url, name, features) {
            if (navCaptureActive && typeof url === "string" && (url.indexOf("/patient-details/") === 0 || url.indexOf("/patient-sales") !== -1)) {
                window.__psa_lastNav = url;
                return null; // suppress only automation-driven popups; we navigate ourselves
            }
            return origOpen.apply(this, arguments);
        };
    }
    function resetNavCapture() { window.__psa_lastNav = null; }
    async function waitForNavCapture(timeoutMs = 8000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (window.__psa_lastNav) return window.__psa_lastNav;
            await sleep(150);
        }
        return null;
    }
    // Clicks a trigger element and returns the window.open URL it fires
    // (without navigating — the caller saves the job first, then navigates).
    // navCaptureActive is turned on ONLY around the automation's own click so
    // the interceptor captures (and suppresses) that one popup, then is turned
    // off so manual window.open calls — real clicks that open new tabs to other
    // patients — are never affected (v1.25).
    async function clickAndFollowNav(clickFn) {
        resetNavCapture();
        navCaptureActive = true;
        try {
            clickFn();
            return await waitForNavCapture();
        } finally {
            navCaptureActive = false;
        }
    }
    function clickVisibleViewPatient() {
        const vp = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().toLowerCase().includes("view patient") && b.offsetParent !== null);
        if (!vp) return false;
        realClick(vp);
        return true;
    }
    // Force-opens the source multiselect via its Vue instance. Synthetic
    // caret/focus clicks don't open this component (verified live); setting
    // isOpen does.
    function openSourceDropdown() {
        const modal = document.getElementById("salesSourceModal");
        const m = modal && modal.querySelector(".multiselect");
        const vm = m && m.__vue__;
        if (vm) vm.isOpen = true;
        return modal;
    }
    function findVisibleSourceOption(modal) {
        if (!modal) return null;
        return [...modal.querySelectorAll(".multiselect__option")].find((o) => o.textContent.trim() === SALE_SOURCE && o.offsetParent !== null);
    }
    async function waitForVisibleSourceOption(timeoutMs = 6000) {
        const modal = openSourceDropdown();
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            const opt = findVisibleSourceOption(modal);
            if (opt) return opt;
            await sleep(200);
        }
        return null;
    }

    function setStatus(statusEl, text, ok, isError) {
        if (!statusEl) return;
        statusEl.textContent = text;
        statusEl.style.color = isError ? "#c0392b" : (ok ? "#27ae60" : "#555");
        if (isError && statusEl.id === "psa-status") { api.state = 'error'; api.message = text; api.error = text; api.lastActivity = Date.now(); }
    }

    /* =========================================================================
       SECTION 6 — PURCHASE STRING PARSING
       "3 Tesa/IPA & 2 Klow" -> [{ qty: 3, alias: "Tesa/IPA" }, { qty: 2, alias: "Klow" }]
       ========================================================================= */

    /* ---- Product-name resolver (v2.19) ------------------------------------
       Second chance for purchase shorthands that have no PRODUCT_ALIASES
       entry ("3 Epithalon Inj", "3 [GRE] KLOW", "3 BPC-157 Inj"). It resolves
       ONLY when the match is grounded:
         1. exact PRODUCT_ALIASES hit wins outright;
         2. otherwise the alias must equal a catalog product name once the
            "[GRE] "-style brand tag, case and whitespace are ignored —
            optionally ignoring ONE trailing form word (injectable/inj/
            capsules/solution);
         3. when several same-core variants survive (BPC-157 injectable vs
            capsules), an EXPLICIT form word in the sheet picks between them;
         4. anything still ambiguous or unknown returns null and is handed to
            the human. The script never guesses which medication was meant. */
    const PRODUCT_FORM_RULES = [
        [/(capsules|capsule|caps)$/i, "capsules"],
        [/(injectable|injection|inj)$/i, "injectable"],
        [/(solution)$/i, "solution"]
    ];
    function normProductName(n) {
        return String(n).toLowerCase().replace(/^\[[a-z]+\]\s*/, "").replace(/\s+/g, " ").trim();
    }
    function productForm(n) {
        const s = String(n).toLowerCase();
        for (const [re, canon] of PRODUCT_FORM_RULES) if (re.test(s)) return canon;
        return null;
    }
    function stripProductForm(n) {
        return normProductName(n).replace(/\s+(capsules|capsule|caps|injectable|injection|inj|solution)$/, "").trim();
    }
    function resolveCatalogProduct(aliasText) {
        const direct = PRODUCT_ALIASES[String(aliasText).toLowerCase()];
        if (direct && PRODUCT_INDEX[direct]) return direct;
        const learned = readLearnedAliases()[String(aliasText).toLowerCase().trim()];
        if (learned && catalogPool().some((p) => p.product === learned)) return learned;
        const target = normProductName(aliasText);
        const core = stripProductForm(aliasText);
        if (core.length < 3) return null;
        const hits = catalogPool().map((p) => p.product).filter((p) => normProductName(p) === target || stripProductForm(p) === core);
        if (hits.length === 1) return hits[0];
        if (hits.length > 1) {
            const wantForm = productForm(aliasText);
            if (wantForm) {
                const formed = hits.filter((p) => productForm(p) === wantForm);
                if (formed.length === 1) return formed[0];
            }
        }
        return null;
    }

    function parsePurchase(purchaseStr) {
        // Item separators are "&" AND a space-wrapped "+" — the live sheet uses
        // both ("3 Tesa/Ipa + 3 Klow", "3 Klow & 3 Tesa/Ipa"). The "+" must be
        // space-delimited (/\s+\+\s+/) so shorthands that CONTAIN a plus —
        // "NAD+ Inj" — are never split in two.
        const parts = String(purchaseStr).split(/&|\s\+\s/).map((p) => p.trim()).filter(Boolean);
        const items = [];
        const unmapped = [];
        const autoMatched = [];
        const ambiguous = []; // v2.32: fuzzy matched but not clearly decided — Jeyson picks

        for (const part of parts) {
            // "3 Tesa/IPA" -> qty 3, alias "Tesa/IPA". A part with NO leading
            // number ("& Klow") means quantity 1 (v2.2 — the sheet writes bare
            // product names this way).
            let m = part.match(/^(\d+)\s+(.+)$/);
            let qty, rawAlias;
            if (m) {
                qty = parseInt(m[1], 10);
                rawAlias = m[2].trim();
            } else {
                qty = 1;
                rawAlias = part;
            }
            // v2.2: strip a leading duration token ("1 Year Tesa/IPA" ->
            // "Tesa/IPA") — the sheet sometimes prefixes plan durations.
            rawAlias = rawAlias.replace(/^(year|years|yr|month|months|mo|week|weeks|wk|day|days)\s+/i, "");
            // v2.14: drop trailing sentence punctuation ("GHK-Cu Inj." -> "GHK-Cu Inj")
            // so shorthand ending in a period still resolves.
            rawAlias = rawAlias.replace(/[.,;:]+$/, "");
            const productName = resolveCatalogProduct(rawAlias);
            const effectiveQty = Math.min(qty, MAX_PEPTIDE_QTY);
            if (!productName) {
                // v2.32: second chance against the LIVE picker. A clear winner is
                // auto-picked and reported; anything close is ASKED, never guessed.
                const fz = fuzzyResolve(rawAlias);
                if (fz.verdict === "auto") {
                    autoMatched.push({ alias: rawAlias, product: fz.best.product, via: `fuzzy ${fz.best.score}` });
                    items.push({ qty: effectiveQty, requestedQty: qty, capped: qty > effectiveQty, alias: rawAlias, ...poolEntry(fz.best.product) });
                } else if (fz.verdict === "ambiguous") {
                    ambiguous.push({ alias: rawAlias, part, qty: effectiveQty, requestedQty: qty, capped: qty > effectiveQty, candidates: fz.candidates });
                } else {
                    unmapped.push(part);
                }
                continue;
            }
            // Distinguish a safety-net match from a real alias hit so the panel
            // and console can report what was auto-resolved by name (v2.19).
            if (PRODUCT_ALIASES[rawAlias.toLowerCase()] !== productName) autoMatched.push({ alias: rawAlias, product: productName });
            items.push({ qty: effectiveQty, requestedQty: qty, capped: qty > effectiveQty, alias: rawAlias, ...poolEntry(productName) });
        }
        return { items, unmapped, autoMatched, ambiguous };
    }

    /* =========================================================================
       SECTION 7 — PAGE-SPECIFIC STEP IMPLEMENTATIONS
       ========================================================================= */

    function setNativeInputValue(input, value) {
        // Vue/React often track value via the native property setter, not a
        // plain `.value =` assignment — bypassing that can leave the
        // framework's internal state (and its search-as-you-type listener)
        // unaware anything changed.
        const proto = window.HTMLInputElement.prototype;
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        desc.set.call(input, value);
    }

    async function typeIntoSearchBox(searchBox, value) {
        trace("typeInto start", value);
        searchBox.focus();
        await sleep(400); // let focus fully register before the value changes
        trace("typeInto focused");

        setNativeInputValue(searchBox, "");
        searchBox.dispatchEvent(new Event("input", { bubbles: true }));
        await sleep(150);
        trace("typeInto cleared");

        setNativeInputValue(searchBox, value);
        searchBox.dispatchEvent(new Event("input", { bubbles: true }));
        searchBox.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
        searchBox.dispatchEvent(new Event("change", { bubbles: true }));
        // Defensive settle: let the app commit the typed value to its model
        // before the Search button is clicked (v1.27).
        await sleep(250);
        trace("typeInto typed", value, "boxNow=" + searchBox.value);
    }

    function getSearchRows(allowTableFallback = true) {
        // The Patients list (confirmed in-session) is div-based, not a
        // <table>. Identify rows by their "Action" dropdown button (each
        // patient row owns one) and walk UP to the data row. Debugging found
        // two traps: (1) the button's immediate parent is a small wrapper
        // (~45 chars, "Action View Patient") — we must skip past it to the
        // real row (grid-content / longer text); (2) unrelated hidden
        // <table>s exist on the page, so the Action-button heuristic must
        // run BEFORE the table fallback, not after.
        const actionBtns = [...document.querySelectorAll("button")].filter((b) => b.textContent.trim().toLowerCase().includes("action"));
        const rows = new Set();
        for (const btn of actionBtns) {
            let el = btn.parentElement;
            for (let i = 0; i < 6 && el; i++) {
                const t = el.textContent ? el.textContent.trim() : "";
                if ((el.classList && el.classList.contains("grid-content")) || t.length > 60) { rows.add(el); break; }
                el = el.parentElement;
            }
        }
        if (rows.size > 0) return [...rows];

        // v1.27: the profile-check pass counts rows to decide found/not-found,
        // so it MUST NOT use this fallback — hidden tables fire exactly when
        // the app shows an EMPTY result (no Action buttons), which would turn
        // a genuine "no profile" into a phantom match (live bug: every
        // no-profile row came back "multiple matches").
        if (!allowTableFallback) return [];

        // Fallback: table rows on list pages that do use tables.
        return [...document.querySelectorAll("table tr")].filter((r) => r.querySelectorAll("td, [role=cell]").length > 0);
    }

    // The row's Action dropdown closes on the very events a plain el.click()
    // dispatches, swallowing the item click. A realistic mouse sequence
    // (pointer/mouse down+up+click) on the element is required for the
    // dropdown itself to open — verified live.
    function realClick(el) {
        ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
            el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
        });
    }

    // Opens a patient record from a search-result row by opening the row's
    // Action dropdown. Debugging (v1.3-v1.6) established that:
    //   - the "View Patient" button exists hidden in the DOM even when the
    //     dropdown is closed, so we must wait until it is actually VISIBLE;
    //   - the app requires a TRUSTED (real) click on "View Patient" to
    //     navigate — synthetic events (el.click() or a full mouse sequence)
    //     open the menu but are ignored for navigation. A @grant none
    //     userscript cannot generate trusted events, and there is no
    //     derivable profile URL, so we open the menu and hand that single
    //     click to the user (a reasonable safety checkpoint anyway).
    // Returns true if the dropdown is open and ready for the user.
    async function openPatientRow(row) {
        const actionBtn = [...row.querySelectorAll("button, [role=button]")].find((b) => b.textContent.trim().toLowerCase().includes("action"));
        if (!actionBtn) return false;
        realClick(actionBtn);
        for (let i = 0; i < 20; i++) {
            const viewBtn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().toLowerCase().includes("view patient"));
            if (viewBtn && viewBtn.offsetParent !== null) return true;
            await sleep(150);
        }
        return false;
    }

    // ── PSA PATIENT IDENTITY (v2.30) ──────────────────────────────────────────
    // Pure functions: no DOM, no globals. They exist because the Patients search
    // is a FUZZY SUBSTRING search and its row count is NOT an answer. On the real
    // 2026-10-02 queue, "Patientone Sampleperson" returned 0 rows while the lone
    // surname "Sampleperson" returned exactly ONE row — "Patienttwo Sampleperson" — and the
    // old rule "exactly one row = found" opened her profile for his order.
    // Identity is decided here, never by a row count.
    // Harness: _smoketest/verify-psa-lookup.js (live probe: probe-psa-lookup.mjs)
    function psaCleanIdentifier(v) {
        return String(v == null ? "" : v).replace(/\s+/g, " ").trim();
    }

    function psaNameTokens(s) {
        return psaCleanIdentifier(s).toLowerCase().replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t.length > 0);
    }

    // A name verifies only on an EXACT token-set match against a full
    // first+last name. A missing token ("Sampleperson" vs "Patientone Sampleperson") or
    // an extra one ("Patienttwo Sampleperson") is a different person until a human says
    // otherwise — this is the check that stops the wrong-patient send.
    function psaNameVerdict(resultName, expectedName) {
        const want = psaNameTokens(expectedName);
        if (want.length < 2) return { ok: false, reason: `"${psaCleanIdentifier(expectedName)}" is not a full first+last name` };
        const got = psaNameTokens(resultName);
        if (got.length === 0) return { ok: false, reason: "the result row shows no name" };
        const missing = want.filter((t) => got.indexOf(t) === -1);
        if (missing.length) return { ok: false, reason: `the result row is missing "${missing.join(" ")}"` };
        const extra = got.filter((t) => want.indexOf(t) === -1);
        if (extra.length) return { ok: false, reason: `the result row has an unexpected name part "${extra.join(" ")}"` };
        return { ok: true, reason: "" };
    }

    function psaPhoneDigits(v) {
        const d = String(v == null ? "" : v).replace(/\D/g, "");
        return d.length >= 10 ? d.slice(-10) : "";
    }

    function psaPhoneVerdict(resultPhone, expectedPhone) {
        const want = psaPhoneDigits(expectedPhone);
        if (!want) return { applicable: false, ok: false, reason: "this row has no phone to compare" };
        const got = psaPhoneDigits(resultPhone);
        if (!got) return { applicable: false, ok: false, reason: "the result row shows no phone" };
        if (got !== want) return { applicable: true, ok: false, reason: `the result row's phone ${got} is not ${want}` };
        return { applicable: true, ok: true, reason: "" };
    }

    // A rendered result row reads
    //   "PAT123456789 Patienttwo Sampleperson 1970-01-01 0000000000 Action View Patient"
    // The action buttons' text must never leak into the name.
    function psaParseSearchRowText(text) {
        const t = psaCleanIdentifier(text);
        const idRaw = (t.match(/PAT\s*\d+/i) || [""])[0];
        const dob = (t.match(/\d{4}-\d{2}-\d{2}/) || [""])[0];
        const phone = (t.match(/\b\d{7,}\b/) || [""])[0];
        let name = t;
        [idRaw, dob, phone].filter(Boolean).forEach((part) => { name = name.replace(part, " "); });
        name = name.replace(/\bAction\b/ig, " ").replace(/\bView\s*Patient\b/ig, " ").replace(/\s+/g, " ").trim();
        return { id: idRaw.replace(/\s+/g, ""), name, dob, phone };
    }

    // What we may search by, strongest first. Email is deliberately ABSENT: the
    // Patients search ignores it (proved live 2026-10-02 —
    // "patient@example.com" returns 0 rows), so searching it can only
    // manufacture a false "no profile" that deletes a real patient's row. A name
    // needs two tokens; a lone surname or first name is never searched.
    function psaCandidateList(row) {
        const out = [];
        const id = psaCleanIdentifier(row.patientId);
        if (id) out.push({ key: "patientId", label: "RxFlow Patient ID", value: id });
        const phone = psaCleanIdentifier(row.phone);
        if (phone) out.push({ key: "phone", label: "Phone", value: phone });
        const name = psaCleanIdentifier(row.patientName);
        if (name && psaNameTokens(name).length >= 2) out.push({ key: "name", label: "Patient Name", value: name });
        return out;
    }

    // Verify ONE returned row against the queue row we are looking for.
    //   { status: "found" | "ambiguous", reason }
    function psaVerifyCandidate(input) {
        const parsed = input.parsed || {};
        const row = input.row || {};
        const value = psaCleanIdentifier(input.identifierValue);
        const hasFullName = psaNameTokens(row.patientName).length >= 2;

        if (input.identifierKey === "patientId") {
            if (psaCleanIdentifier(parsed.id) !== value) return { status: "ambiguous", reason: `the result row's ID ${parsed.id || "(none)"} is not ${value}` };
            if (hasFullName) {
                const nv = psaNameVerdict(parsed.name, row.patientName);
                if (!nv.ok) return { status: "ambiguous", reason: nv.reason };
            }
            return { status: "found", reason: "" };
        }
        if (input.identifierKey === "phone") {
            const pv = psaPhoneVerdict(parsed.phone, row.phone);
            if (!pv.ok) return { status: "ambiguous", reason: pv.reason };
            if (hasFullName) {
                const nv = psaNameVerdict(parsed.name, row.patientName);
                if (!nv.ok) return { status: "ambiguous", reason: nv.reason };
            }
            return { status: "found", reason: "" };
        }
        if (input.identifierKey === "name") {
            const nv = psaNameVerdict(parsed.name, row.patientName);
            if (!nv.ok) return { status: "ambiguous", reason: nv.reason };
            if (psaPhoneDigits(row.phone)) {
                const pv = psaPhoneVerdict(parsed.phone, row.phone);
                if (!pv.ok) return { status: "ambiguous", reason: pv.reason };
            }
            return { status: "found", reason: "" };
        }
        return { status: "ambiguous", reason: `unknown identifier "${input.identifierKey}"` };
    }

    // The verdict for a whole lookup, from the PER-CANDIDATE evidence. `results`
    // is [{ label, key, value, fired, reason?, rows: [{ parsed, verdict }] }].
    // Safety rules:
    //   - fired:false     -> error. A search that never ran must never be read
    //                        as "no profile" — that deletes a real row.
    //   - fired + 0 rows  -> a proven miss; keep trying other identifiers.
    //   - rows that fail verification -> ambiguous, NEVER not-found.
    //   - not-found is reachable only when EVERY attempted search was proven and
    //     returned no rows at all.
    function psaDecideLookup(results) {
        let sawRows = false;
        let last = null;
        for (const r of (results || [])) {
            if (!r.fired) return { status: "error", message: r.reason || `the Patients search never ran for "${r.value}"` };
            const rows = r.rows || [];
            if (rows.length === 0) continue;
            sawRows = true;
            const hits = rows.filter((x) => x.verdict && x.verdict.status === "found");
            if (hits.length === 1) return { status: "found", foundBy: r.label, hit: hits[0], parsed: hits[0].parsed };
            if (hits.length > 1) return { status: "ambiguous", foundBy: r.label, reason: `${hits.length} rows match this patient`, candidates: hits };
            last = { foundBy: r.label, reason: (rows[0].verdict && rows[0].verdict.reason) || "no returned row matches this patient", candidates: rows };
        }
        if (sawRows && last) return { status: "ambiguous", foundBy: last.foundBy, reason: last.reason, candidates: last.candidates };
        return { status: "not-found" };
    }

    // What the human confirmation gate shows — id · name · DOB · phone, never
    // the scraped "Action View Patient" button text.
    function psaIdentityLine(parsed) {
        const p = parsed || {};
        return [p.id || "(ID unknown)", p.name || "(name unknown)", "DOB " + (p.dob || "?"), p.phone || "no phone"].join(" · ");
    }
    // ── PSA PATIENT IDENTITY END ─────────────────────────────────────────────

    // ---- DOM side of the lookup (v2.28) ----
    const PATIENTS_SEARCH_BOX = 'input[placeholder="Search by record ID, name, dob or mobile"]';

    function patientsSearchBox() {
        return document.querySelector(PATIENTS_SEARCH_BOX);
    }

    // The Patients list is entered through the app's OWN sidebar link: that runs
    // the router and mounts the list component with its search wired up. A hard
    // location.href = "/patients" can land on a rendered-but-dead list whose
    // search answers nothing (proved live 2026-10-02: no patients-list?search=
    // request at all, and the 10 unfiltered rows stayed put for both a real query
    // and "zzzzqqq"). Returns "ready" | "navigating" | "failed".
    function patientsNavLink() {
        const links = [...document.querySelectorAll("aside.main-sidebar a.nav-link")];
        return links.find((a) => a.textContent.trim().toLowerCase() === "patients")
            || links.find((a) => /^patients?$/i.test(a.textContent.trim()));
    }

    function psaSay(panel, msg, good, stop) {
        if (!panel) return;
        if (panel.status) setStatus(panel.status, msg, good, stop);
        else renderRunStatus(panel, msg);
    }

    async function enterPatientsList(panel, why) {
        if (patientsSearchBox()) return "ready";
        const link = patientsNavLink();
        if (!link) {
            psaSay(panel, `${why} — opening the Patients page...`);
            location.href = "/patients";
            return "navigating";
        }
        psaSay(panel, `${why} — opening the Patients tab...`);
        realClick(link);
        for (let i = 0; i < 60; i++) {
            if (patientsSearchBox()) {
                await sleep(800); // let the list component finish mounting
                trace("enterPatientsList ready after", i, "polls");
                return "ready";
            }
            await sleep(250);
        }
        psaSay(panel, `${why} — the Patients search box never appeared. Reload the Patients page and try again.`, false, true);
        return "failed";
    }

    function psaSearchRequests() {
        try { return performance.getEntriesByType("resource").filter((e) => /\/api\/patients-list/i.test(e.name)); }
        catch (err) { return []; }
    }

    // The proof that a search RAN: the app's own /api/patients-list request
    // carrying exactly the query we typed, started after we clicked Search.
    function psaSearchRequestFired(mark, query) {
        const want = psaCleanIdentifier(query).toLowerCase();
        if (!want) return false;
        return psaSearchRequests().some((e) => {
            if (e.startTime < mark) return false;
            let sent = "";
            try { sent = new URL(e.name, location.origin).searchParams.get("search") || ""; } catch (err) { sent = ""; }
            return psaCleanIdentifier(sent).toLowerCase() === want;
        });
    }

    // Type, click Search, and WAIT FOR THE APP'S OWN REQUEST before reading any
    // row: a row count is evidence only once the app has answered the question.
    async function runPatientsSearch(query) {
        const value = psaCleanIdentifier(query);
        if (!value) return { ok: false, reason: "empty search query" };
        const mark = performance.now();
        const box = patientsSearchBox();
        if (!box) return { ok: false, reason: "the Patients search box is not on the page" };
        await typeIntoSearchBox(box, value);
        const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim().toLowerCase() === "search");
        if (!btn) return { ok: false, reason: "the Patients Search button was not found" };
        btn.click();
        for (let i = 0; i < 32; i++) {            // ≤ 8s
            if (psaSearchRequestFired(mark, value)) {
                await sleep(1400);                // let the filtered list render
                return { ok: true, query: value, rows: getSearchRows(false) };
            }
            await sleep(250);
        }
        return { ok: false, reason: `the app never sent a patients-list search for "${value}"` };
    }

    // The ONLY lookup the script performs. Every returned row is VERIFIED, and an
    // unproven search is an error, never a verdict.
    async function lookupPatientRow(row, onPharmacyB) {
        const candidates = psaCandidateList(row);
        if (candidates.length === 0) return { status: "no-identifier" };
        const results = [];
        for (const c of candidates) {
            if (onPharmacyB) onPharmacyB(`searching by ${c.label} ("${c.value}")...`);
            const res = await runPatientsSearch(c.value);
            const rows = res.ok ? res.rows.map((el) => {
                const parsed = psaParseSearchRowText(el.textContent);
                if (!parsed.id) {
                    const fallback = extractPatientIdFromRow(el);
                    if (fallback) parsed.id = fallback;
                }
                return { el, parsed, verdict: psaVerifyCandidate({ identifierKey: c.key, identifierValue: c.value, parsed, row }) };
            }) : [];
            results.push({ label: c.label, key: c.key, value: c.value, fired: res.ok, reason: res.reason, rows });

            const decision = psaDecideLookup(results);
            trace("lookup", c.label, c.value, "rows=" + rows.length, decision.status, decision.reason || decision.message || "");
            if (decision.status === "found") {
                return { status: "found", foundBy: decision.foundBy, patientId: decision.parsed.id || null, parsed: decision.parsed, element: decision.hit.el };
            }
            if (decision.status === "error") return { status: "error", message: decision.message };
        }
        const decision = psaDecideLookup(results);
        if (decision.status === "found") {
            return { status: "found", foundBy: decision.foundBy, patientId: decision.parsed.id || null, parsed: decision.parsed, element: decision.hit.el };
        }
        if (decision.status === "ambiguous") {
            return { status: "ambiguous", foundBy: decision.foundBy, reason: decision.reason, candidates: decision.candidates || [] };
        }
        if (decision.status === "error") return { status: "error", message: decision.message };
        return { status: "not-found" };
    }

    async function stepSearch(job, panel) {
        const row = job.row;
        const candidates = psaCandidateList(row);

        if (candidates.length === 0) {
            setStatus(panel.status, "No usable identifier in this row (Patient ID, phone, or a full first+last name) — open the patient manually. A single name token is never searched.", false, true);
            apiSet('waiting_human', 'no usable identifier in this row — open the patient manually');
            return;
        }

        // The Patients list search box (confirmed in-session) is labeled
        // "Search by record ID, name, dob or mobile". Require it — never fall
        // back to a generic input. While debugging, the dashboard's global
        // "Search" box + a hidden table made the script false-match a hidden
        // row, so if we're not on the Patients list page, stop and let the
        // user navigate (the job is left in "search" so the script resumes
        // on the Patients page load).
        // Enter the Patients list through the app's own sidebar link (v2.28): a
        // hard /patients load can land on a list whose search silently does
        // nothing, and then every row reads as "no profile" (proved live
        // 2026-10-02). The job is already saved at step "search", so the hard URL
        // fallback still resumes on the Patients page load.
        const entered = await enterPatientsList(panel, "Not on the Patients page");
        if (entered !== "ready") return;

        // v2.28 — ONE lookup, verified at every step. The old loop accepted the
        // first non-empty row list as proof of identity ("exactly one row =
        // found"), which on this fuzzy substring search meant a lone surname
        // ("Sampleperson") auto-opened a stranger's profile ("Patienttwo Sampleperson").
        const lookup = await lookupPatientRow(row, (m) => setStatus(panel.status, `Searching: ${m}`));
        trace("stepSearch verdict", lookup.status, lookup.foundBy || "", lookup.reason || lookup.message || "");

        if (lookup.status === "error") {
            // A search that provably did not run must never be read as "no
            // patient" — that is how a real row gets dropped from the queue.
            setStatus(panel.status, `Search stopped: ${lookup.message}. Nothing was changed — reload the Patients page and run again.`, false, true);
            apiSet('error', lookup.message);
            return;
        }

        if (lookup.status === "no-identifier") {
            setStatus(panel.status, "No usable identifier in this row — open the patient manually.", false, true);
            apiSet('waiting_human', 'no usable identifier in this row — open the patient manually');
            return;
        }

        if (lookup.status === "ambiguous") {
            const cands = lookup.candidates || [];
            setStatus(panel.status, cands.length
                ? `${lookup.reason || "more than one possible patient"} — confirm the record below before opening a profile (searched by ${lookup.foundBy}).`
                : `${lookup.reason || "the search returned nothing usable"} — open the patient manually.`, false, true);
            apiSet('waiting_human', cands.length ? `${cands.length} record(s) need confirmation` : 'needs a manual lookup');
            cands.forEach((cand) => {
                const btn = document.createElement("button");
                btn.className = "psa-btn";
                btn.textContent = "Open " + psaIdentityLine(cand.parsed);
                btn.title = "Confirm this is the right patient — a wrong patient here becomes a wrong sale and a wrong SMS.";
                btn.addEventListener("click", async () => {
                    const menuOpenedNow = await openPatientRow(cand.el);
                    if (menuOpenedNow) {
                        const nav = await clickAndFollowNav(() => clickVisibleViewPatient());
                        if (nav) {
                            job.step = "consent-check";
                            saveJob(job);
                            location.href = nav;
                            return;
                        }
                    }
                    job.step = "consent-check";
                    saveJob(job);
                    setStatus(panel.status, "Menu opened — click View Patient for the confirmed record.");
                });
                panel.body.appendChild(btn);
            });
            return;
        }

        if (lookup.status === "not-found") {
            setStatus(panel.status, "No patient record found by Patient ID, phone, or full name. Stopping — verify manually.", false, true);
            apiSet('waiting_human', 'no patient record found — verify manually before creating the sale');
            clearJob();
            renderQueueStrip(panel);
            return;
        }

        const menuOpened = await openPatientRow(lookup.element);
        if (menuOpened) {
            // View Patient navigates via window.open (popup-blocked for
            // synthetic clicks), but our hook captures the URL and we
            // redirect the current tab — fully automated, no manual click.
            const nav = await clickAndFollowNav(() => clickVisibleViewPatient());
            if (nav) {
                job.step = "consent-check";
                saveJob(job);
                setStatus(panel.status, `Patient found via ${lookup.foundBy} (${psaIdentityLine(lookup.parsed)}). Opening profile...`);
                location.href = nav;
                return;
            }
        }
        job.step = "consent-check";
        saveJob(job);
        setStatus(panel.status, menuOpened
            ? `Patient found via ${lookup.foundBy} (${psaIdentityLine(lookup.parsed)}). Click View Patient in the open menu to open the profile — the script resumes there.`
            : `Patient found via ${lookup.foundBy} but the row menu wouldn't open — click its Action > View Patient, then reload.`);
    }

    // ---- STEP: profile-check pass (v1.27) ----
    // After a batch paste, the script FIRST checks which rows already have a
    // RxFlow profile. Rows with a profile get the patient ID (e.g.
    // PAT123456789) filled into the row; rows with no profile are removed
    // from the queue after the pass; ambiguous lookups stay in the queue
    // flagged for the human (R13). Only then does the user click Run.
    // Lookup order per row (v2.28): patient ID -> phone -> full name. Email is
    // NOT searched — the Patients search ignores it (proved live 2026-10-02), so
    // an email query can only manufacture a false "no profile". Rows that already
    // carry a patient ID from the sheet are skipped — an ID IS a profile.

    function extractPatientIdFromRow(rowEl) {
        // Verified live 2026-08-04: the first .grid-item span in a search
        // result row is the patient ID ("PAT123456789"). Fall back to a
        // PAT<digits> match over the whole row text.
        const first = rowEl.querySelector(".grid-item span");
        const t = first ? first.textContent.trim() : "";
        if (/^PAT\S*$/.test(t)) return t;
        const m = rowEl.textContent.match(/PAT\S+/);
        return m ? m[0].trim() : null;
    }

    // v2.28: rowLooksLikePatient() / waitForSearchSettle() / checkPatientExists()
    // lived here. They were replaced by the identity block + lookupPatientRow()
    // above: the old net passed a row if ANY name token appeared anywhere in its
    // text (so "Zhang" was "verified" by "yinggggg zhanggggg"), and the old rule
    // "exactly one row = found" opened a stranger's profile for the surname
    // "Sampleperson".

    // Kicks off the pass. Persists the job so a navigation to /patients (or a
    // reload mid-pass) resumes where it left off.
    function startProfileCheck(panel) {
        const queue = loadQueue() || [];
        if (queue.length === 0) return;
        const results = queue.map((r) => ({
            _id: r._id,
            name: r.patientName || r.patientId || r.patientEmail || "(no identifier)",
            status: r.patientId ? "has-id" : "pending"
        }));
        const job = { step: "profile-check", pass: { index: 0, results } };
        saveJob(job);
        if (patientsSearchBox()) { runProfileCheckPass(panel); return; }
        renderRunStatus(panel, "Opening the Patients tab to check which rows have profiles...");
        enterPatientsList(panel, "Checking which rows have profiles").then((entered) => {
            // "navigating" = the hard /patients fallback; the saved job resumes the
            // pass on that page load. "failed" already reported itself.
            if (entered === "ready") runProfileCheckPass(panel);
        });
    }

    // Runs (or resumes) the pass on the Patients page. Searches each row
    // without an ID, records the result, then hands off to
    // applyProfileCheckResults.
    async function runProfileCheckPass(panel) {
        const job = loadJob();
        if (!job || job.step !== "profile-check") return;
        const isCurrent = beginRender();

        let queue = loadQueue() || [];
        let results = (job.pass && job.pass.results) || [];
        if (results.length !== queue.length) {
            results = queue.map((r) => ({
                _id: r._id,
                name: r.patientName || r.patientId || r.patientEmail || "(no identifier)",
                status: r.patientId ? "has-id" : "pending"
            }));
            job.pass = { index: 0, results };
            saveJob(job);
        }
        if (queue.length === 0) { clearJob(); renderInputStage(panel); return; }

        // The sidebar Patients tab is the reliable way in (v2.28): it mounts the
        // list with its search wired up, where a hard /patients load can leave a
        // rendered-but-dead search box that answers nothing.
        const entered = await enterPatientsList(panel, "Checking which rows have profiles");
        if (entered !== "ready") return; // navigating (the job resumes) or failed (reported)

        if (!isCurrent()) return;
        panel.body.innerHTML = "";

        try {
        renderQueueStrip(panel); // v1.29: re-show the strip while the pass runs

        const skipBtn = document.createElement("button");
        skipBtn.className = "psa-btn";
        skipBtn.textContent = "Skip check — show queue as-is";
        skipBtn.addEventListener("click", () => {
            clearJob();
            renderQueueStage(panel, loadQueue() || [], null, false);
        });
        panel.body.appendChild(skipBtn);

        const status = document.createElement("div");
        status.id = "psa-status";
        panel.body.appendChild(status);
        panel.status = status;

        setStatus(status, `Checking which of ${queue.length} rows have profiles...`);

        for (let i = job.pass.index; i < results.length; i++) {
            const res = results[i];
            if (res.status !== "pending") continue;
            const row = queue.find((r) => r._id === res._id);
            if (!row) { res.status = "skipped"; job.pass.index = i + 1; saveJob(job); continue; }

            trace("row start", i + 1, res.name);
            // Per-row timeout: a hung search must never stall the whole pass
            // (v1.27 live: the pass twice died silently mid-search, with the
            // page healthy and no capturable exception).
            const found = await Promise.race([
                lookupPatientRow(row, (m) =>
                    setStatus(status, `Row ${i + 1}/${results.length} (${res.name}): ${m}`))
                    .catch((err) => ({ status: "error", message: err && err.message ? err.message : String(err) })),
                new Promise((resolve) => setTimeout(() => resolve({ status: "error", message: "row check timed out" }), 40000))
            ]);
            trace("row done", i + 1, res.name, found.status, found.patientId || "");

            if (!isCurrent()) return; // Reset / another row started — abandon (R5)
            // Never persist DOM nodes: the candidates carried for the human gate
            // are reduced to the parsed identity + verdict.
            delete found.element;
            if (found.candidates) found.candidates = found.candidates.map((c) => ({ parsed: c.parsed, verdict: c.verdict }));
            Object.assign(res, found);
            job.pass.index = i + 1;
            saveJob(job);

            if (found.status === "found") {
                setStatus(status, `Row ${i + 1}/${results.length}: ✅ ${res.name} — ${found.patientId} (via ${found.foundBy}${found.parsed ? " · " + psaIdentityLine(found.parsed) : ""})`, true);
            } else if (found.status === "not-found") {
                setStatus(status, `Row ${i + 1}/${results.length}: 🚫 ${res.name} — no profile (searched by ID / phone / full name; the row will be removed)`, false, true);
            } else if (found.status === "ambiguous") {
                setStatus(status, `Row ${i + 1}/${results.length}: ⚠ ${res.name} — kept for review: ${found.reason || "the search did not confirm this patient"}`);
            } else if (found.status === "error") {
                setStatus(status, `Row ${i + 1}/${results.length}: ⛔ ${res.name} — kept: ${found.message || "the search did not run"}`);
            }
            await sleep(200);
        }

        applyProfileCheckResults(panel, results);
        } catch (err) {
            // Last line of defense: never die silently mid-pass (v1.27).
            trace("pass FATAL", err && err.message ? err.message : String(err));
            setStatus(panel.status, `Profile check stopped: ${err.message}`, false, true);
            try { applyProfileCheckResults(panel, results); } catch (e2) { /* nothing else to do */ }
        }
    }

    // Applies the pass results to the persisted queue: fills patient IDs on
    // found rows, removes the no-profile rows, keeps ambiguous/no-identifier
    // rows flagged for the human. NOTE (v2.12): the pass does NOT touch
    // r.existingPatient. v1.27 used to flag found rows existingPatient="TRUE",
    // which had wrongly switched rows out of the (then) auto-skip path
    // (Jeyson 2026-08-18).
    // v2.20: nothing branches on existingPatient any more — the questionnaire
    // is always autofilled when it renders — so the pass stays hands-off for
    // the same reason but with no downstream consequence either way.
    function applyProfileCheckResults(panel, results) {
        clearJob();
        const queue = loadQueue() || [];
        const kept = [];
        const removed = [];
        const removedUnmatched = [];
        for (const r of queue) {
            const res = results.find((x) => x._id === r._id);
            const status = res ? res.status : "has-id";
            if (status === "found") {
                r.patientId = res.patientId;
                delete r._checkNote;
                kept.push(r);
            } else if (status === "has-id") {
                delete r._checkNote;
                kept.push(r);
            } else if (status === "ambiguous") {
                // Jeyson 2026-10-02: "if there is no proper match, still remove
                // the row." A search that came back with rows that are NOT this
                // patient is a failed lookup — same as no result at all. (Rows
                // still kept below are not match verdicts: the check never ran.)
                delete r._checkNote;
                removed.push(r);
                removedUnmatched.push(r);
            } else if (status === "no-identifier") {
                r._checkNote = "no Patient ID / phone / full name — couldn't check";
                kept.push(r);
            } else if (status === "error") {
                r._checkNote = (res && res.message) || "check error — review manually";
                kept.push(r);
            } else {
                removed.push(r); // not-found / skipped
            }
        }
        saveQueue(kept);
        renderQueueStrip(panel);

        const summary = {
            kept: kept.length,
            found: kept.filter((r) => r.patientId).length,
            removed,
            removedUnmatched,
            noId: kept.filter((r) => (r._checkNote || "").startsWith("no Patient ID"))
        };
        renderQueueStage(panel, kept, summary, false);
    }

    // ---- STEP: consent / verification gate (patient-details page) ----
    function findNearbyVerifiedIcon(labelEl) {
        // Confirmed real markup: <img class="verified_img" src=".../verified.png">
        // sitting near the label when a field is checked. Walk up a few
        // ancestor levels since the icon isn't always a direct sibling.
        // NOTE: the verified_img class is shared by THREE images (live-captured
        // 2026-08-18) — verified.png = genuinely checked; green-check.png = the
        // Driver's License loading placeholder that LOOKS like a checkmark;
        // remove.png = red X shown for "Patient Verified:" when NOT verified.
        // Match on class AND filename so the green-check/remove decoys never
        // read as "checked".
        let node = labelEl.parentElement;
        for (let i = 0; i < 3 && node; i++) {
            const icon = node.querySelector('img.verified_img[src*="verified.png"]');
            if (icon) return icon;
            node = node.parentElement;
        }
        return null;
    }

    function findNotYetMarker(labelEl) {
        // The Driver's License row settles unvalidated into a "Not yet Verified"
        // link once the green-check placeholder is gone. If any leaf a/span/div
        // in the field's OWN container still says "not yet", that is
        // authoritative — the field is NOT checked even if a decoy icon happens
        // to be present. IMPORTANT: scope to labelEl.parentElement ONLY — the
        // parent .show_pat_content div holds just this one field (label + icon
        // + marker). Walking further up reaches the shared column div, where the
        // license's "Not yet Verified" link would wrongly mark EVERY field in
        // the column as not-checked (hit live 2026-08-18).
        const parent = labelEl.parentElement;
        if (!parent) return null;
        return [...parent.querySelectorAll("a, span, div")].find((el) => el.children.length === 0 && /not yet/i.test(el.textContent)) || null;
    }

    function detectConsentStatus() {
        const labels = ["Terms and Conditions:", "Non-FDA Consent:", "Driver's License Validated:", "Patient Verified:"];
        const results = {};
        for (const label of labels) {
            const labelEl = [...document.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent.trim() === label);
            if (!labelEl) { results[label] = "unknown"; continue; }
            const icon = findNearbyVerifiedIcon(labelEl);
            const notYet = findNotYetMarker(labelEl);
            // The three verified_img states (confirmed live 2026-08-18):
            //   verified.png     -> genuinely checked
            //   green-check.png  -> Driver's License loading placeholder (looks
            //                       like a checkmark but means nothing yet)
            //   remove.png       -> red X, "Patient Verified:" NOT verified
            // A "Not yet Verified" marker is authoritative: a field is checked
            // ONLY when the real verified.png icon is present AND no not-yet
            // marker is nearby; everything else reads as not-checked.
            results[label] = icon && !notYet ? "checked" : "not-checked";
        }
        return results;
    }

    // Harvests the patient's height/weight/gender from the profile page for
    // later use in the sale-form questionnaire. Verified DOM: height/weight live
    // in <div class="show_common_pat"><span class="title_color">Height  :</span>
    // <span>5'8\" (68)</span></div> pairs (weight "225 lbs"), gender lives in a
    // .show_pat_content pair ("Gender at Birth : Female").
    // v2.20: ALSO harvests the state from the header's "State :" row (verified
    // live: <div class="col-md-12 show_pat_content pl-0"><span
    // class="title_color">State :</span><span>North Carolina</span></div>) —
    // the pharmacy-routing advisory needs it. The full name is mapped through
    // STATE_ABBR; a bare 2-letter value is taken as-is.
    // v2.23: THE STATE THAT MATTERS IS THE ONE THE ORDER SHIPS TO.
    // The header "State :" row is the patient's CONTACT/billing state, and the
    // two disagree all the time — a patient whose contact state is restricted
    // may ship to a family member in a free state (not gated), and one whose
    // contact state is free may ship into a restricted state (gated). The
    // shipping address ships, so only its State row decides the advisory.
    //
    // The rows are read with their SECTION title, because Contact Details and
    // Shipping Address both carry an "Address line 1 / City / State / …" block
    // (live-caught 2026-09-29: an untagged read returned the contact state while
    // the shipping state was different).
    function shippingAddressStateFromProfile() {
        const pane = document.getElementById("patient_details");
        if (!pane) return { abbr: "", raw: "", source: "" };
        let section = "";
        for (const el of pane.querySelectorAll("h3, div.row.pt-3")) {
            if (el.tagName === "H3") { section = (el.textContent || "").replace(/\s+/g, " ").trim(); continue; }
            if (!/^shipping\s*address/i.test(section)) continue;
            const cols = el.querySelectorAll(":scope > div.col-md-6");
            if (cols.length < 2) continue;
            const label = (cols[0].textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
            if (label !== "state") continue;
            const strong = cols[1].querySelector("strong");
            const raw = ((strong ? strong.textContent : cols[1].textContent) || "").replace(/\s+/g, " ").trim();
            const clean = /^-$/.test(raw) ? "" : raw;
            if (!clean) break; // rendered placeholder — treat as not readable yet
            const abbr = normalizeStateAbbr(clean);
            return { abbr, raw: clean, source: abbr ? "shipping-address" : "" };
        }
        return { abbr: "", raw: "", source: "" };
    }

    function harvestProfileMeasurements() {
        const out = {};
        const divs = document.querySelectorAll(".show_common_pat, .show_pat_content");
        for (const d of divs) {
            const title = d.querySelector(".title_color");
            const valEl = d.querySelector("span:not(.title_color)");
            if (!title || !valEl) continue;
            const t = title.textContent.trim().toLowerCase();
            const v = valEl.textContent.trim();
            if (t.indexOf("height") === 0) {
                const ftin = v.match(/(\d+)'\s*(\d+)"/);
                out.heightLabel = ftin ? ftin[0] : v; // "5'8\""
                if (ftin) out.heightIn = parseInt(ftin[1], 10) * 12 + parseInt(ftin[2], 10);
                else { const p = v.match(/\((\d+)\)/); if (p) out.heightIn = parseInt(p[1], 10); }
            } else if (t.indexOf("weight") === 0) {
                const w = v.match(/(\d+)/);
                if (w) out.weightLbs = parseInt(w[1], 10);
            } else if (t.indexOf("gender") === 0 && !out.gender) {
                out.gender = /female/i.test(v) ? "female" : (/male/i.test(v) ? "male" : v);
            } else if (t.indexOf("state") === 0 && !out.state) {
                // "State :" — full name preferred, plain abbreviation accepted.
                // Never guess: an unrecognized value stays empty and the
                // routing advisory says so instead of inventing a route.
                const clean = v.replace(/\s+/g, " ").trim();
                if (/^[A-Za-z]{2}$/.test(clean)) out.state = clean.toUpperCase();
                else if (STATE_ABBR[clean.toLowerCase()]) out.state = STATE_ABBR[clean.toLowerCase()];
            }
        }
        // v2.23: the shipping address's own State row — the ONLY state the
        // routing advisory is allowed to act on.
        const ship = shippingAddressStateFromProfile();
        if (ship.abbr) out.shippingState = ship.abbr;
        if (ship.raw) out.shippingStateRaw = ship.raw;
        return out;
    }

    // The profile's height/weight/gender render with PLACEHOLDER values
    // ("Non Reported", "--", blank) while the data loads asynchronously, then
    // update to the real values a beat later — same race as the consent
    // section (verified live: Patient Name showed "Non Reported"/"--"/no
    // weight at harvest time, then 6'3"/195 lbs/Male once loaded). Never
    // harvest a placeholder: poll until a real height (starts with a digit)
    // appears, and prefer a snapshot that also has weight. Returns the most
    // complete snapshot found, or null if nothing real ever appears.
    // v2.20: the state row is part of the same header render, so a snapshot
    // that has a real height but no state yet is kept polling — the routing
    // advisory must not report "state unknown" just because it read early.
    // v2.23: "no state" now means no SHIPPING state; the header state does not
    // satisfy the wait (it is the wrong address).
    async function waitForProfileMeasurements(timeoutMs = 12000) {
        const start = Date.now();
        let best = null;
        while (Date.now() - start < timeoutMs) {
            const m = harvestProfileMeasurements();
            const hasRealHeight = m.heightLabel && /^\d/.test(m.heightLabel);
            if (hasRealHeight && m.weightLbs && m.shippingState) return m;  // fully real
            if (hasRealHeight) best = m;                                     // at least a real height
            await sleep(300);
        }
        return best;
    }

    // Shared by the manual confirm button and the auto-proceed timer (v1.15):
    // opens the patient's Sales tab, advances the job to create-sale, and
    // starts the next step. Used instead of inlining the handler in the button
    // so the auto-proceed path is identical to the manual-click path.
    async function proceedToCreateSale(job, panel) {
        setStatus(panel.status, "Opening Sales tab...");
        // "Sales" is a same-page anchor (#patientSales), not a real page
        // load, so the script has to drive the next step itself here
        // rather than waiting to re-run on a fresh page.
        // NOTE: there are two "Sales" links on this page — the main
        // left-nav Sales section, and this patient's own tab
        // (href="#patientSales"). Target the href specifically so we
        // don't accidentally navigate away to the wrong Sales page.
        const salesTab = document.querySelector('a[href="#patientSales"]')
            || [...document.querySelectorAll("a")].find((a) => a.getAttribute("href") === "#patientSales");
        if (salesTab) salesTab.click();
        await sleep(700);

        job.step = "create-sale";
        saveJob(job);
        await stepCreateSale(job, panel);
    }

    // The license section renders its placeholder (green-check.png) first and
    // settles into the real status a few seconds later, so a single read can be
    // wrong — the decoy can read as "checked" then the real "Not yet Verified"
    // arrives late (or vice versa). Never trust a single read: poll until the
    // status is stable for 3 consecutive identical readings (~2.5s apart,
    // ~7.5s of stability) before auto-proceeding. Returns null if the render
    // goes stale (Stop/Reset must abort it), else the settled status; on
    // timeout it returns one final detectConsentStatus() read.
    async function waitForConsentSettle(timeoutMs = 20000) {
        const isCurrent = beginRender();
        const start = Date.now();
        let prevSignature = null;
        let stableCount = 0;
        while (Date.now() - start < timeoutMs) {
            if (!isCurrent()) return null;
            const status = detectConsentStatus();
            const signature = JSON.stringify(status);
            if (signature === prevSignature) {
                stableCount++;
                if (stableCount >= 3) return status;
            } else {
                stableCount = 1;
                prevSignature = signature;
            }
            await sleep(2500);
        }
        return detectConsentStatus();
    }

    async function stepConsentCheck(job, panel) {
        const isCurrent = beginRender();

        // Guard: this step belongs on the patient's profile page. If we're not
        // there yet (navigation still in flight, or the profile never opened),
        // wait briefly for the URL — never render a bogus "unknown" consent
        // panel on the wrong page. Profiles are served at /patient-details/<id>
        // AND at /patient-sales/<id> (the full profile block lives there); the
        // plain /patient-sales listing page (no id) must NOT match.
        const onProfilePage = () => location.pathname.indexOf("/patient-details/") === 0 || /^\/patient-sales\/\d+/.test(location.pathname);
        if (!onProfilePage()) {
            for (let i = 0; i < 24; i++) {
                if (onProfilePage()) break;
                await sleep(250);
            }
        }
        if (!onProfilePage()) {
            if (!isCurrent()) return;
            panel.body.innerHTML = "";
            const msg = document.createElement("div");
            msg.id = "psa-status";
            msg.textContent = "Open the patient's profile (Patient Details or patient Sales page) — the consent check runs there.";
            msg.style.color = "#c0392b";
            panel.body.appendChild(msg);
            panel.status = msg;
            return;
        }

        // The consent section loads asynchronously — running detection at
        // document-idle can show everything as "unknown" (verified live). Wait
        // for the section to render before reading the status.
        for (let i = 0; i < 20; i++) {
            const labelEl = [...document.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent.trim() === "Terms and Conditions:");
            if (labelEl) break;
            await sleep(250);
        }

        // The settle poll can take up to ~20s — show a progress line so the
        // panel doesn't look hung while it and the measurements harvest run.
        // The later render (below) wipes this when the real results appear.
        if (isCurrent()) {
            panel.body.innerHTML = "";
            const waitMsg = document.createElement("div");
            waitMsg.id = "psa-status";
            waitMsg.textContent = "Waiting for the consent status to settle (checking repeatedly)...";
            panel.body.appendChild(waitMsg);
            panel.status = waitMsg;
        }

        // Harvest height/weight while on the profile page so the sale-form
        // questionnaire can be prefilled later (existing patients).
        // NOTE: the profile shows PLACEHOLDER values ("Non Reported", "--",
        // blank) while its data loads async, then the real values — so WAIT
        // for real data before harvesting (v1.20). Run the consent settle
        // concurrently with the harvest — both wait on the page's async data.
        // v2.20: the previous-questionnaire check runs concurrently too (a
        // read-only GET). It changes NO behaviour — the sale form's
        // questionnaire is autofilled either way (Jeyson 2026-09-24) — it only
        // reports the history on this panel.
        const [settledStatus, measurements, qHistory] = await Promise.all([
            waitForConsentSettle(),
            waitForProfileMeasurements().then((m) => m || harvestProfileMeasurements()),
            fetchQuestionnaireHistory(patientIdFromUrl())
        ]);
        const qTemplates = qHistory.ok && qHistory.total ? await fetchQuestionnaireTemplates() : {};
        if (measurements.heightLabel) job.heightLabel = measurements.heightLabel;
        if (measurements.heightIn) job.heightIn = measurements.heightIn;
        if (measurements.weightLbs) job.weightLbs = measurements.weightLbs;
        if (measurements.gender) job.gender = measurements.gender;
        // v2.20: the sheet's Patient State column was removed from the live
        // sheet, so the profile is the source for the routing advisory. The
        // sheet value is only a FALLBACK when the profile gave nothing, and it
        // is normalized first — the sheet writes FULL names ("North Carolina")
        // in some builds and abbreviations in others, and the router only
        // accepts a 2-letter code (a full name there would read as "no state"
        // and silently skip the check).
        const sheetState = normalizeStateAbbr(job.row && job.row.patientState);
        // v2.23: the SHIPPING address decides. The header state and the sheet's
        // Patient State are the patient's own state — they are kept as a HINT for
        // the "could not read it" warning, never as a verdict (a patient gated in
        // their own state who ships somewhere free is not gated, and vice versa).
        const shipState = measurements.shippingState || "";
        job.state = shipState;
        job.stateSource = shipState ? "shipping-address" : "";
        job.stateHint = shipState ? "" : (measurements.state || sheetState || "");
        job.questionnaireHistory = {
            checked: qHistory.ok,
            reason: qHistory.ok ? "" : qHistory.reason,
            total: qHistory.ok ? qHistory.total : null,
            templates: qTemplates,
            records: qHistory.ok ? qHistory.records : []
        };
        saveJob(job);
        api.questionnaireHistory = job.questionnaireHistory;

        const status = settledStatus || detectConsentStatus();
        const allGood = Object.values(status).every((s) => s === "checked");

        if (!isCurrent()) return;
        panel.body.innerHTML = "";
        const heading = document.createElement("div");
        heading.innerHTML = "<strong>Consent / verification check (verify visually — do not trust the sheet)</strong>";
        panel.body.appendChild(heading);

        for (const [label, state] of Object.entries(status)) {
            const line = document.createElement("div");
            line.textContent = `${label} ${state}`;
            line.style.color = state === "checked" ? "#27ae60" : "#c0392b";
            panel.body.appendChild(line);
        }

        if (job.row.notes) {
            const noteLine = document.createElement("div");
            noteLine.style.fontWeight = "bold";
            noteLine.style.marginTop = "6px";
            noteLine.textContent = `Notes from sheet: ${job.row.notes}`;
            panel.body.appendChild(noteLine);
        }

        // v2.20: report whether the patient already has a questionnaire on file
        // (informational — the sale form's questionnaire is autofilled either
        // way), then the pharmacy-routing advisory.
        renderQuestionnaireHistory(job.questionnaireHistory || { ok: false, reason: "not checked" }, (job.questionnaireHistory && job.questionnaireHistory.templates) || {}, panel);
        renderRoutingAdvisory(job, panel);

        const confirmBtn = document.createElement("button");
        confirmBtn.className = "psa-btn psa-btn-primary";
        // v2.22: a gated route PAUSES the row. The advisory above is a warning,
        // and a warning the flow outruns in one second is not a pause — so the
        // auto-proceed is skipped and this button becomes the operator's resume.
        const routingGated = routingNeedsAttention(job.routing);
        confirmBtn.textContent = routingGated
            ? "Proceed anyway — routing gated"
            : allGood ? "Confirmed — proceed to Create Sale" : "Override — proceed anyway";

        const stopBtn = document.createElement("button");
        stopBtn.className = "psa-btn";
        stopBtn.textContent = "Stop this row";

        panel.body.appendChild(confirmBtn);
        panel.body.appendChild(stopBtn);

        const statusEl = document.createElement("div");
        statusEl.id = "psa-status";
        panel.body.appendChild(statusEl);
        panel.status = statusEl;

        confirmBtn.addEventListener("click", () => proceedToCreateSale(job, panel));

        // All four consent items verified — auto-proceed instead of waiting
        // for a manual click. Brief delay so the panel is visible (and the
        // user can still hit Stop / Reset) before navigation starts; the
        // epoch guard abandons the timer if the panel was reset meanwhile.
        // v2.22: NEVER when the routing report needs attention (partial / clinic
        // / blocked) — that case waits for a human, which is the whole point of
        // the advisory. Nothing else about the flow changes.
        if (allGood && !routingGated) {
            setStatus(panel.status, "All verified — auto-proceeding to Create Sale...");
            setTimeout(() => {
                if (isCurrent()) proceedToCreateSale(job, panel);
            }, 1000);
        } else if (routingGated) {
            setStatus(panel.status, "⚠ Gated — the pharmacy route needs your check (see above). Fix the shipping address, then click to proceed anyway.", true);
        }

        stopBtn.addEventListener("click", () => {
            clearJob();
            renderQueueStrip(panel);
            panel.body.innerHTML = "";
            const doneStatus = document.createElement("div");
            doneStatus.id = "psa-status";
            doneStatus.textContent = "Stopped.";
            panel.body.appendChild(doneStatus);
            panel.status = doneStatus;
        });
    }

    // ---- STEP: create sale (patient-sales listing page) ----
    async function stepCreateSale(job, panel) {
        setStatus(panel.status, "Clicking Create Sale...");
        const createBtn = findByText("button", "Create Sale", false);
        if (!createBtn) { setStatus(panel.status, "Could not find Create Sale button.", false, true); return; }
        createBtn.click();

        // Wait for the "Choose any option" modal's Source input to actually
        // exist rather than a blind sleep — the modal can take a moment.
        let sourceInput = null;
        for (let i = 0; i < 20 && !sourceInput; i++) {
            sourceInput = document.querySelector("#source, input.multiselect__input");
            if (!sourceInput) await sleep(200);
        }
        if (!sourceInput) { setStatus(panel.status, "Could not find Source selector.", false, true); return; }

        // Selecting the source opens the sale form via window.open, which
        // browsers only allow from a TRUSTED click — v1.8 handed this to the
        // user. Verified live that the Vue handler still fires on synthetic
        // clicks and that force-opening the multiselect via its Vue instance
        // (vm.isOpen = true) works where caret/focus clicks don't. So we open
        // the dropdown, select the source, capture the window.open URL, and
        // navigate the current tab ourselves — fully automated.
        job.step = "select-modules";
        saveJob(job);

        const sourceOpt = await waitForVisibleSourceOption();
        if (sourceOpt) {
            const nav = await clickAndFollowNav(() => realClick(sourceOpt));
            if (nav) {
                setStatus(panel.status, `Opening sale form...`);
                location.href = nav;
                return;
            }
        }
        setStatus(panel.status, "Source dropdown is open — click 'Dr. Example Phone Order' to open the sale form (the script resumes there).", false);
    }

    // ---- STEP: modules / cart / questionnaire / ship date (sale detail page) ----
    async function goToProduct(medType, category, product, tab, qty, requestedQty, capped, panel) {
        setStatus(panel.status, capped
            ? `Adding ${qty}x ${product} (sheet said ${requestedQty} — capped at ${MAX_PEPTIDE_QTY}).`
            : `Adding ${qty}x ${product}...`);

        // The medication list renders asynchronously after the sale form
        // loads (same race as the consent section) — a one-shot lookup right
        // after navigation misses it. Wait for the button to appear.
        const medTypeEl = await waitForByText("#medications-list .btn", medType);
        medTypeEl.click();

        const catEl = await waitForByText(".med-item", category);
        catEl.click();

        // v2.32: the tab comes from the swept catalog — products also live under
        // OTC and Subscription, and the old hardcoded "eRx" click missed them.
        const tabEl = await waitForByText(".col.text-center.cursor-class > div", tab || "eRx");
        tabEl.click();

        const prodEl = await waitForByText(".filtered-items .cursor-class.text-break.font-weight-bold", product);
        prodEl.click();

        await sleep(500);

        // Find the cart line for this product and click "+" (qty - 1) times
        // (adding the product starts it at quantity 1). Cart lines carry the
        // confirmed class .selected-med-item-child; fall back to a text search.
        const cartLine = [...document.querySelectorAll(".selected-med-item-child")].find((el) => el.textContent.includes(product));
        let plusBtn = cartLine
            ? [...cartLine.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent.trim() === "+")
            : null;
        if (!plusBtn) {
            const cartLabel = [...document.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent.trim() === product);
            if (cartLabel) {
                const cartRow = cartLabel.closest("div").parentElement;
                plusBtn = [...cartRow.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent.trim() === "+");
            }
        }
        if (!plusBtn) throw new Error(`Could not find the "+" control for ${product}.`);

        // The cart line re-renders after every click, so re-locate the "+"
        // fresh each time — a cached reference goes stale and later clicks are
        // silently dropped (verified live). Skip a disabled "+" (the app locks
        // it past MAX_PEPTIDE_QTY).
        for (let i = 1; i < qty; i++) {
            const line = [...document.querySelectorAll(".selected-med-item-child")].find((el) => el.textContent.includes(product));
            const plus = line
                ? [...line.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent.trim() === "+" && !el.classList.contains("disabled-qty-btn"))
                : null;
            if (!plus) throw new Error(`Could not find an enabled "+" control for ${product}.`);
            plus.click();
            await sleep(250);
        }
    }

    // Is the sale-form questionnaire actually on the page?
    // v2.20: this is the GROUND TRUTH for the whole questionnaire step, so it
    // checks the form element itself (id "questionnare-form", the app's typo —
    // confirmed in-session and again live 2026-08-06). It deliberately does NOT
    // match a bare "Submit"/"Skip Questionnaire" button: those exist only as
    // children of this form, so matching them adds nothing except a way to be
    // wrong (any other form on the page with a Submit button would read as "a
    // questionnaire is here", and the old skip path keyed off the Skip button,
    // which is exactly the artifact that made "never skip" impossible to trust).
    function questionnaireIsPresent() {
        return !!document.getElementById("questionnare-form");
    }

    // Wait for the questionnaire to render, then report whether it did.
    // The form is fetched per-sale by the cart's drug ids and renders
    // asynchronously AFTER the products are added, so it can legitimately be
    // absent at this instant. Absent-after-waiting is a REAL answer ("this cart
    // has no questionnaire"), not a failure — the caller continues either way.
    // 25s (not 15) because live probing 2026-09-24 showed the questionnaire is a
    // Vue component rendered INSIDE A MODAL on the sale form, fetched after the
    // cart is set — a second async hop after the products land. Waiting longer
    // costs nothing next to a sale the pharmacist reviews anyway, and declaring
    // "no questionnaire" too early would step past one that was merely slow.
    async function waitForQuestionnaireForm(timeoutMs = 25000) {
        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            if (questionnaireIsPresent()) return { present: true, waitedMs: Date.now() - start };
            await sleep(300);
        }
        return { present: questionnaireIsPresent(), waitedMs: Date.now() - start };
    }

    // The questionnaire step's ONE entry point (v2.20).
    //
    // Jeyson's rule (2026-09-24): NEVER skip the questionnaire — autofill it
    // whether the sale is being driven automatically or the products were added
    // by hand. The script never clicks "Skip Questionnaire" under any
    // condition. The old behaviour branched on the sheet's "Existing
    // RxFlow Patient" column and, for a blank, polled up to 45s for the
    // Skip button and clicked it — which (a) burned 45s when no form was
    // coming, and (b) DISCARDED a real questionnaire whenever one was there
    // (one Skip click removes the form), silently, with the sheet column as the
    // only justification. The form is not conditional on patient history at
    // all: it is fetched from the cart's drug ids, so "is it there?" is
    // observable and the column was never the right signal.
    async function handleQuestionnaireStep(job, panel) {
        setStatus(panel.status, "Checking for a questionnaire...");
        const found = await waitForQuestionnaireForm();
        if (!found.present) {
            console.info(`[PSA] no questionnaire rendered after ${Math.round(found.waitedMs / 1000)}s — nothing to fill, continuing`);
            // Advance the persisted step BEFORE finishing, like the pre-v2.20
            // skip path did — otherwise a reload at the Continue gate re-runs
            // stepSelectModules and re-adds the whole cart.
            job.step = "ship-date";
            saveJob(job);
            await finishModulesStep(job, panel);
            return;
        }
        await prefillSaleQuestionnaire(job, panel);
    }

    /* ---- Questionnaire prefill (existing patients; NEVER auto-submits) ---- */
    function questionnaireLabelFor(input) {
        const l = input.closest("label");
        if (l) return l.textContent.trim().replace(/\s+/g, " ");
        const byFor = document.querySelector('label[for="' + input.id + '"]');
        if (byFor) return byFor.textContent.trim().replace(/\s+/g, " ");
        if (input.parentElement) return input.parentElement.textContent.trim().replace(/\s+/g, " ");
        return "";
    }

    function prefillQuestionnaire(job) {
        const qf = document.getElementById("questionnare-form");
        const filled = [];
        const missing = [];
        let heightFilled = false;
        let weightFilled = false;
        if (!qf) return { filled, missing, heightFilled, weightFilled };

        // Height (the questionnaire's first <select> is the height picker).
        // Only a real value (starts with a digit, e.g. "5'8\"") counts as
        // on-file — "Non Reported" / "--" do not, so a missing height surfaces
        // in `missing` and the caller pauses for the pharmacist.
        const hSel = qf.querySelector("select");
        const hasHeight = !!job.heightLabel && /^\d/.test(job.heightLabel);
        if (hasHeight) {
            if (hSel && hSel.options.length > 1) {
                const prefix = job.heightLabel.replace('"', ""); // "5'8" -> "5'8"
                const opt = [...hSel.options].find((o) => o.textContent.trim().replace('"', "") === prefix);
                if (opt) {
                    hSel.value = opt.value;
                    hSel.dispatchEvent(new Event("change", { bubbles: true }));
                    filled.push(`height ${prefix}"`);
                    heightFilled = true;
                } else {
                    missing.push("height (no matching option in the picker)");
                }
            } else {
                missing.push("height (picker not ready)");
            }
        } else {
            missing.push("height (not on file in profile)");
        }

        // Weight (the questionnaire's number input). Declared at function
        // scope so the v2.0 extra-number check below can reference it.
        const wInput = qf.querySelector('input[type="number"]');
        if (job.weightLbs) {
            if (wInput) {
                setNativeInputValue(wInput, String(job.weightLbs));
                wInput.dispatchEvent(new Event("input", { bubbles: true }));
                wInput.dispatchEvent(new Event("change", { bubbles: true }));
                filled.push(`weight ${job.weightLbs} lbs`);
                weightFilled = true;
            } else {
                missing.push("weight (input not ready)");
            }
        } else {
            missing.push("weight (not on file in profile)");
        }

        // Radio groups: explicit per-question answer first, then the
        // gender-specific rule (the only groups with a "Not Applicable"
        // option), then the generic safe patterns. Anything still unanswered
        // and required -> glowing + listed (never silently left blank).
        const radioGroups = {};
        qf.querySelectorAll('input[type="radio"]').forEach((r) => {
            const m = r.id.match(/^(radio-group-\d+)-/);
            const key = m ? m[1] : (r.name || r.id);
            (radioGroups[key] = radioGroups[key] || []).push(r);
        });
        Object.values(radioGroups).forEach((group) => {
            const labels = group.map((r) => questionnaireLabelFor(r));
            const groupEl = questionGroupFor(group[0]);
            const qKey = normalizeQuestionKey(questionGroupLabel(groupEl));
            let safe = null;

            // 1. Explicit per-question answer (Jeyson's picks; radio groups are
            // single-select — if several options are listed, pick one at random).
            const expl = QUESTION_EXPLICIT_ANSWERS[qKey];
            if (expl && expl.type === "radio") {
                const present = group.filter((r) => expl.options.some((o) => normLabel(questionnaireLabelFor(r)) === normLabel(o)));
                if (present.length) safe = present[Math.floor(Math.random() * present.length)];
            }

            // 2. Gender-specific question (the only group with a "Not
            // Applicable" option): "Not Applicable" for male patients, "No"
            // for female. Unknown gender is left BLANK for the pharmacist —
            // do NOT fall through to the generic patterns (v1.16: the generic
            // fallback picked "Not Applicable" for unknown-gender patients,
            // which could be wrong if the patient is actually female).
            if (!safe && !expl) {
                const hasNA = labels.some((l) => /^Not Applicable$/i.test(l));
                if (hasNA) {
                    if (job.gender === "male") safe = group.find((r) => /^Not Applicable$/i.test(questionnaireLabelFor(r)));
                    else if (job.gender === "female") safe = group.find((r) => /^No$/.test(questionnaireLabelFor(r)));
                    else if (groupEl && groupIsRequired(groupEl)) {
                        missing.push(questionGroupLabel(groupEl) || "gender-specific question (gender unknown)");
                        markMissed(groupEl);
                    }
                }
            }

            // 3. Generic safe default for every other radio group — patterns
            // are tried in priority order so "No" wins over "No to both"
            // regardless of DOM order.
            if (!safe && !expl) {
                for (const pattern of QUESTIONNAIRE_SAFE_OPTIONS.radioSafePatterns) {
                    safe = group.find((r) => pattern.test(questionnaireLabelFor(r)));
                    if (safe) break;
                }
            }

            if (safe) {
                safe.checked = true;
                safe.dispatchEvent(new Event("change", { bubbles: true }));
                filled.push(questionnaireLabelFor(safe));
            } else if (groupEl && groupIsRequired(groupEl)) {
                // v2.0: a required radio question with no safe answer is
                // reported AND glows — no more silent misses.
                missing.push(questionGroupLabel(groupEl) || "an unanswered radio question");
                markMissed(groupEl);
            }
        });

        // Checkbox groups -> explicit answer first, then the "None"-style
        // option; required groups with no none-equivalent -> glowing + listed.
        const checkboxGroups = {};
        qf.querySelectorAll('input[type="checkbox"]').forEach((c) => {
            const m = c.id.match(/^(checkbox-group-\d+)-/);
            const key = m ? m[1] : (c.name || c.id);
            (checkboxGroups[key] = checkboxGroups[key] || []).push(c);
        });
        Object.values(checkboxGroups).forEach((group) => {
            const groupEl = questionGroupFor(group[0]);
            const qKey = normalizeQuestionKey(questionGroupLabel(groupEl));
            const expl = QUESTION_EXPLICIT_ANSWERS[qKey];
            let answered = false;
            // 1. Explicit per-question answer (Jeyson's picks): check a RANDOM
            // non-empty subset of the acceptable options — random which AND how
            // many, so every patient's questionnaire isn't identical (v2.1).
            if (expl && expl.type === "checkbox") {
                const present = group.filter((c) => expl.options.some((o) => normLabel(questionnaireLabelFor(c)) === normLabel(o)));
                if (present.length) {
                    for (const c of randomSubset(present)) {
                        c.checked = true;
                        c.dispatchEvent(new Event("change", { bubbles: true }));
                        filled.push(questionnaireLabelFor(c));
                    }
                    answered = true;
                }
            }
            // 2. No explicit entry — check the "None"-style option; required
            // groups with no none-equivalent -> glowing + listed.
            if (!answered) {
                const none = group.find((c) => QUESTIONNAIRE_SAFE_OPTIONS.checkboxSafePatterns.some((p) => p.test(questionnaireLabelFor(c))));
                if (none) {
                    none.checked = true;
                    none.dispatchEvent(new Event("change", { bubbles: true }));
                    filled.push(questionnaireLabelFor(none));
                } else if (groupEl && groupIsRequired(groupEl)) {
                    missing.push(questionGroupLabel(groupEl) || "an unanswered checkbox question");
                    markMissed(groupEl);
                }
            }
        });

        // Free-text defaults (e.g. "anything else" -> "N/A"); any other
        // REQUIRED and visible text field left empty -> glowing + listed.
        const textFields = Array.from(qf.querySelectorAll('input[type="text"], textarea'));
        textFields.forEach((t) => {
            const label = questionnaireLabelFor(t) + " " + (t.placeholder || "");
            let done = false;
            for (const def of QUESTIONNAIRE_SAFE_OPTIONS.freeTextDefaults) {
                if (def.label.test(label) && !t.value) {
                    setNativeInputValue(t, def.value);
                    t.dispatchEvent(new Event("input", { bubbles: true }));
                    filled.push(`text: ${def.value}`);
                    done = true;
                    break;
                }
            }
            if (!done) {
                const groupEl = questionGroupFor(t);
                // Visibility check is on the FIELD, not the group: conditional
                // texts ("If yes, please describe") nest inside the visible
                // group wrapper and would false-positive a glow on the group.
                if (groupIsRequired(groupEl) && t.offsetParent !== null && !t.value) {
                    missing.push(questionGroupLabel(groupEl) || "a required text field");
                    markMissed(groupEl);
                }
            }
        });

        // Additional required number fields (e.g. GLP-1 goal weight) and file
        // uploads (e.g. GLP-1 refill vial/script photo) cannot be auto-filled
        // — glow + list them for the pharmacist (v2.0).
        qf.querySelectorAll('input[type="number"]').forEach((n) => {
            if (n === wInput || n.value) return;
            const groupEl = questionGroupFor(n);
            if (groupIsRequired(groupEl) && n.offsetParent !== null) {
                missing.push(questionGroupLabel(groupEl) || "a required number field");
                markMissed(groupEl);
            }
        });
        qf.querySelectorAll('input[type="file"]').forEach((f) => {
            const groupEl = questionGroupFor(f);
            if (groupIsRequired(groupEl) && f.offsetParent !== null && (!f.files || !f.files.length)) {
                missing.push(questionGroupLabel(groupEl) || "a required file upload");
                markMissed(groupEl);
            }
        });

        return { filled, missing, heightFilled, weightFilled };
    }

    // Prefill the sale-form questionnaire from the harvested profile data plus
    // the safe-default answer bank, set the ship date, then hand off to a human.
    //
    // v2.20: this is the ONLY questionnaire path — new patients, existing
    // patients, and manual product entry all land here. The script fills what it
    // can, glows the required questions it cannot answer, and NEVER submits and
    // NEVER skips: the pharmacist reviews and clicks Submit, then presses the
    // button to continue to the final "Click Continue" gate.
    //
    // `manual` (no active job) changes only the RESUME behaviour: with a job we
    // set `job.step = "ship-date"` so the flow continues to the Continue gate;
    // without one there is no flow to resume, so resuming just re-runs this scan
    // (the human may have edited the form or the cart in the meantime).
    async function prefillSaleQuestionnaire(job, panel, manual) {
        setStatus(panel.status, "Filling the questionnaire...");
        const qf = document.getElementById("questionnare-form");
        if (!qf) {
            // The caller waited for the form, so this is a genuine race (it was
            // torn down, or the cart changed). Never guess: report and continue.
            console.warn("[PSA] questionnaire form vanished before prefill");
            if (job && !manual) await finishModulesStep(job, panel);
            return;
        }

        // The height picker and weight input can render a beat after the form
        // element itself (progressive render) — wait for them so the prefill
        // actually lands (v1.17: height/weight were silently skipped when the
        // fields weren't ready yet).
        for (let i = 0; i < 10; i++) {
            const sel = qf.querySelector("select");
            const wInput = qf.querySelector('input[type="number"]');
            if (sel && sel.options.length > 1 && wInput) break;
            await sleep(300);
        }

        const result = prefillQuestionnaire(job || {});

        // Set the ship date NOW, right after the questionnaire is filled. It is
        // independent of the questionnaire submit (verified live: the transmit
        // section renders before the questionnaire is submitted), so the ship
        // date is set in every case — including when height/weight are missing.
        // Manual mode has no sheet row, so there is no ship date to set.
        // v2.20: routed through applyShipDateIfAny so a non-date value (a "hold"
        // instruction) can never abort the row before the questionnaire.
        if (job && job.row && job.row.shipDate) {
            const res = await applyShipDateIfAny(job.row.shipDate, panel);
            if (res.status === "error") return; // status already set
        }

        // The questionnaire cannot be completed without height & weight. If the
        // profile didn't provide them, stop and let the pharmacist enter them —
        // the script can't invent the data.
        if (!result.heightFilled || !result.weightFilled) {
            renderQuestionnaireHandoff(job, panel,
                "Height/weight are not on file for this patient — enter them in the questionnaire, complete any required answers, click Submit, then press the button below."
                + (job && job.row && job.row.shipDate ? " Ship date is already set." : ""),
                manual);
            return;
        }

        // Any required question that could not be auto-answered is listed BY
        // NAME in the message (and glows red in the form) — no silent misses.
        const extraMissed = result.missing.filter((m) => !/height|weight/i.test(m));
        const shipNote = (job && job.row && job.row.shipDate) ? " Ship date is already set." : "";
        let handoffMsg;
        if (extraMissed.length > 0) {
            handoffMsg = `Questionnaire filled, but ${extraMissed.length} required question(s) are unanswered (glowing red in the form): ${extraMissed.join("; ")}. Answer them, click Submit, then press the button below.${shipNote}`;
        } else {
            handoffMsg = `Questionnaire filled. Review the answers, click Submit in the form, then press the button below.${shipNote}`;
        }
        renderQuestionnaireHandoff(job, panel, handoffMsg, manual);
    }

    // Handoff after prefill: the script fills the questionnaire (height/weight +
    // safe defaults) and sets the ship date, but NEVER submits and NEVER skips —
    // the pharmacist reviews and clicks Submit, then presses the button to land
    // on the final "Click Continue" gate.
    // Re-attach the manual-ordering note block after a panel wipe so its
    // live-update closure stays in the document. In manual mode there is no job
    // flow to run, but the note is still the script's only feedback surface.
    function restoreManualNote(panel) {
        const note = document.getElementById("psa-manual-note");
        if (note) panel.body.appendChild(note);
    }

    function renderQuestionnaireHandoff(job, panel, message, manual) {
        panel.body.innerHTML = "";
        restoreManualNote(panel);
        const resumeBtn = document.createElement("button");
        resumeBtn.className = "psa-btn psa-btn-primary";
        resumeBtn.textContent = manual ? "Re-scan / refresh the prefilled answers" : "Questionnaire submitted — continue";
        resumeBtn.addEventListener("click", () => {
            if (manual) {
                // No job flow to resume — re-run the scan so a re-rendered form
                // (or a cart change) gets filled again.
                prefillSaleQuestionnaire(null, panel, true);
                return;
            }
            job.step = "ship-date";
            saveJob(job);
            finishModulesStep(job, panel);
        });
        panel.body.appendChild(resumeBtn);

        const status = document.createElement("div");
        status.id = "psa-status";
        panel.body.appendChild(status);
        panel.status = status;
        setStatus(status, message, true);
    }

    function parseDateParts(shipDateStr) {
        // Accepts M/D/YY or M/D/YYYY (the sheet uses "7/26/26" for 2026-07-26).
        // 2-digit years map to the 2000s.
        const m = String(shipDateStr || "").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
        if (!m) return null;
        let year = parseInt(m[3], 10);
        if (year < 100) year += 2000;
        return { month: parseInt(m[1], 10), day: parseInt(m[2], 10), year };
    }

    // v2.20: the sheet's Desired Shipping Date column is not always a date.
    // Live case (patient 351792, 2026-09-24) it held the instruction
    // "hold-do not ship yet", and the old code treated the parse failure as a
    // fatal error — which aborted the row BEFORE the questionnaire step, so the
    // panel just showed a date-parse complaint and nothing else ran. A
    // non-date value is an INSTRUCTION for the pharmacist ("hold", "do not ship
    // yet", "TBD", "call patient"), not a malformed date: the script must not
    // invent a date, but it must still fill the questionnaire, leave the
    // transmit choice alone, and reach the Continue gate.
    // Returns the trimmed instruction text, or "" when the value is blank or
    // actually parses as a date.
    function shipDateIsInstruction(shipDateStr) {
        const v = String(shipDateStr || "").trim();
        if (!v) return "";
        return parseDateParts(v) ? "" : v;
    }

    const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    // The ONE place the ship-date column is interpreted (v2.20). Every call site
    // must go through this so a non-date value can never abort a row again.
    // Returns:
    //   { status: "skipped",  instruction }  — blank, or a non-date instruction
    //                                          ("hold-do not ship yet"): the
    //                                          date is LEFT ALONE and the flow
    //                                          continues to the questionnaire
    //                                          and the Continue gate.
    //   { status: "set" }                    — the transmit date was applied.
    //   { status: "error", message }         — a date was given but the form
    //                                          could not be driven; the row stops.
    async function applyShipDateIfAny(shipDateStr, panel) {
        const raw = String(shipDateStr || "").trim();
        const instruction = shipDateIsInstruction(raw);
        if (!raw) return { status: "skipped", instruction: "" };
        if (instruction) {
            // Never invent a date. Say so, and keep going.
            const msg = `Ship date is "${instruction}" (not a date) — left the transmit date alone for you; continuing.`;
            setStatus(panel.status, msg, false);
            panel.status.style.color = "var(--ds-warn, #a16207)"; // amber = needs human
            apiSet("waiting_human", msg);
            trace("shipDate instruction, skipped", instruction);
            console.info(`[PSA] ship date "${instruction}" is not a date — transmit date left for the pharmacist`);
            return { status: "skipped", instruction };
        }
        const ok = await setTransmitLaterDate(raw, panel);
        return ok ? { status: "set" } : { status: "error", message: "ship date could not be set" };
    }

    async function setTransmitLaterDate(shipDateStr, panel) {
        const target = parseDateParts(shipDateStr);
        // Defensive: callers should route through applyShipDateIfAny, but never
        // hard-fail here either — a non-date is not an error state.
        if (!target) { setStatus(panel.status, `Ship date "${shipDateStr}" is not a date — leaving it for you.`, false); return false; }

        // The transmit section can render a beat after the questionnaire
        // submits — wait for it instead of failing on a one-shot lookup.
        let transmitLabel = null;
        for (let i = 0; i < 15 && !transmitLabel; i++) {
            transmitLabel = [...document.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent.trim() === "Transmit to Pharmacy on a later date?");
            if (!transmitLabel) await sleep(300);
        }
        if (!transmitLabel) { setStatus(panel.status, "Could not find Transmit to Pharmacy toggle.", false, true); return false; }
        const container = transmitLabel.parentElement;
        const yesInput = container.querySelector("#transmissionYes") || [...container.querySelectorAll('input[type="radio"]')][1];
        if (!yesInput) { setStatus(panel.status, "Could not find the Yes radio for Transmit to Pharmacy.", false, true); return false; }
        yesInput.click();

        await sleep(400);
        const dateInput = document.querySelector('input[placeholder="mm/dd/yyyy"]');
        if (!dateInput) { setStatus(panel.status, "Date field did not appear.", false, true); return false; }

        // The ship-date field is a Vue 2 datepicker (vdp-datepicker).
        // In-session, opening its calendar with synthetic or even real mouse
        // clicks proved unreliable, but the component exposes setDate(), which
        // sets the selected date AND emits "input" so the parent model updates.
        // Prefer that, and only fall back to clicking through the calendar.
        const pickerEl = dateInput.closest(".vdp-datepicker");
        const vm = pickerEl && pickerEl.__vue__;
        if (vm && typeof vm.setDate === "function") {
            vm.setDate(new Date(target.year, target.month - 1, target.day));
            // Vue applies the formatted value asynchronously (next tick /
            // debounce), so poll for it to actually appear — confirmed live
            // that the value lands a beat later (e.g. "09-11-2026").
            for (let i = 0; i < 15; i++) {
                await sleep(200);
                const value = (dateInput.value || "").trim();
                if (value) return true;
            }
        }

        dateInput.click();
        await sleep(300);
        for (let i = 0; i < 24; i++) {
            const header = [...document.querySelectorAll("*")].find((el) => el.children.length === 0 && /^[A-Za-z]{3} \d{4}$/.test(el.textContent.trim()));
            if (!header) break;
            const [monthName, yearStr] = header.textContent.trim().split(" ");
            const curMonth = MONTH_NAMES.indexOf(monthName) + 1;
            const curYear = parseInt(yearStr, 10);
            if (curMonth === target.month && curYear === target.year) break;

            const diff = (target.year - curYear) * 12 + (target.month - curMonth);
            const arrowText = diff > 0 ? ">" : "<";
            const arrow = [...header.parentElement.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent.trim() === arrowText);
            if (!arrow) break;
            arrow.click();
            await sleep(250);
        }

        const dayCells = [...document.querySelectorAll("*")].filter((el) => el.children.length === 0 && el.textContent.trim() === String(target.day));
        const dayCell = dayCells.find((el) => el.hasAttribute("cursor-class") || el.getAttribute("cursor") === "pointer" || true);
        if (!dayCell) { setStatus(panel.status, `Could not find day ${target.day} in the calendar.`, false, true); return false; }
        dayCell.click();
        return true;
    }

    async function stepSelectModules(job, panel) {
        const { items, unmapped, autoMatched, ambiguous } = parsePurchase(job.row.purchase);

        // v2.19 (Jeyson rule): a purchase item with no matching alias must NOT
        // abort the row. Add everything that DID resolve, then hand the
        // leftovers to the human and resume the questionnaire / ship date /
        // Continue automation once they've added them by hand. Before this,
        // one unknown shorthand meant the whole rest of the sale was manual.
        if (autoMatched.length > 0) {
            const report = autoMatched.map((m) => `${m.alias} -> ${m.product}`).join("; ");
            console.log(`[PSA] auto-matched by product name (no alias entry): ${report}`);
            trace("selectModules autoMatched", report);
        }

        // A reload while the manual hand-off is open must not re-add the
        // products that are already in the cart — the flag persists with the job.
        if (!job.productsAdded) {
            try {
                for (const item of items) {
                    await goToProduct(item.medType, item.category, item.product, item.tab, item.qty, item.requestedQty, item.capped, panel);
                }
            } catch (err) {
                setStatus(panel.status, `Failed: ${err.message}`, false, true);
                return;
            }
            job.productsAdded = true;
            saveJob(job);
        }

        if (ambiguous && ambiguous.length > 0) {
            renderAmbiguousChooser(job, panel, ambiguous, autoMatched);
            return;
        }

        if (unmapped.length > 0) {
            renderUnmappedHandoff(job, panel, unmapped, items.length, autoMatched);
            return;
        }

        await continueAfterProducts(job, panel);
    }

    // The questionnaire + ship-date half of the modules step. Split out in
    // v2.19 so the manual-product hand-off can resume straight into it without
    // re-adding the products that are already in the cart.
    //
    // v2.20 (Jeyson rule): ONE path for everyone. The old branch on the sheet's
    // "Existing RxFlow Patient" column is gone — blank meant "auto-skip",
    // which both wasted 45s waiting on a Skip button that may never come and
    // threw away real questionnaires. The script now always checks whether a
    // questionnaire rendered and always autofills it when it did.
    async function continueAfterProducts(job, panel) {
        try {
            await handleQuestionnaireStep(job, panel);
        } catch (err) {
            setStatus(panel.status, `Failed: ${err.message}`, false, true);
        }
    }

    // v2.32: the peptide chooser. A purchase shorthand that fuzzy-matches the
    // LIVE picker with no clear winner is put in front of Jeyson with its
    // candidates ranked. Whichever he picks is LEARNED (localStorage), so the
    // same shorthand resolves outright next time — that is the "pipe them up
    // together" he asked for. The script never picks the peptide itself.
    function renderAmbiguousChooser(job, panel, ambiguous, autoMatched) {
        panel.body.innerHTML = "";
        restoreManualNote(panel);
        const status = document.createElement("div");
        status.id = "psa-status";
        panel.body.appendChild(status);
        panel.status = status;
        const pending = ambiguous.slice();

        async function renderNext() {
            if (!pending.length) {
                apiSet('running', "Peptides chosen — continuing with questionnaire / ship date");
                await continueAfterProducts(job, panel);
                return;
            }
            const item = pending[0];
            panel.body.innerHTML = "";
            restoreManualNote(panel);
            const head = document.createElement("div");
            head.style.cssText = "font-weight:700;margin:6px 0;";
            head.textContent = `Which peptide is "${item.alias}"?`;
            panel.body.appendChild(head);
            const sub = document.createElement("div");
            sub.style.cssText = "font-size:12px;color:var(--ds-muted,#666);margin-bottom:6px;";
            sub.textContent = "Ranked fuzzy match against the live product list. Picking one teaches the script this shorthand. None right — add it by hand."
                + (autoMatched.length ? ` (Auto-matched: ${autoMatched.map((m) => `${m.alias} -> ${m.product}`).join("; ")})` : "");
            panel.body.appendChild(sub);
            for (const c of item.candidates) {
                const b = document.createElement("button");
                b.className = "psa-btn";
                b.style.cssText = "display:block;width:100%;margin:4px 0;text-align:left;";
                b.textContent = `${c.medType} › ${c.category} › ${c.tab} · ${c.product}  (${c.score})`;
                b.addEventListener("click", async () => {
                    learnAlias(item.alias, c.product);
                    setStatus(status, `Learned "${item.alias}" = ${c.product} — adding it...`, true);
                    try {
                        await goToProduct(c.medType, c.category, c.product, c.tab, item.qty, item.requestedQty, item.capped, panel);
                    } catch (err) {
                        setStatus(status, `Failed: ${err.message}`, false, true);
                        return;
                    }
                    pending.shift();
                    renderNext();
                });
                panel.body.appendChild(b);
            }
            const skip = document.createElement("button");
            skip.className = "psa-btn psa-btn-primary";
            skip.textContent = "None of these — I'll add it myself";
            skip.addEventListener("click", () => {
                trace("selectModules ambiguous declined by human", item.alias);
                pending.shift();
                renderNext();
            });
            panel.body.appendChild(skip);
            apiSet('waiting_human', `Which peptide is "${item.alias}"? ${item.candidates.length} candidates`);
            trace("selectModules ambiguous", `${item.alias} -> ${item.candidates.map((c) => `${c.product} (${c.score})`).join(", ")}`);
        }
        renderNext();
    }

    // v2.19: the manual hand-off for purchase items with no alias/name match.
    // The matched items are ALREADY in the cart; the human adds the leftovers
    // with the app's own product list (the script cannot know which catalog
    // entry they mean), then this resumes the automation — never auto-guessed.
    function renderUnmappedHandoff(job, panel, unmapped, addedCount, autoMatched) {
        panel.body.innerHTML = "";
        restoreManualNote(panel);
        const resumeBtn = document.createElement("button");
        resumeBtn.className = "psa-btn psa-btn-primary";
        resumeBtn.textContent = "Added them manually — continue";
        resumeBtn.addEventListener("click", () => {
            apiSet('running', "Manual products added — continuing with questionnaire / ship date");
            continueAfterProducts(job, panel);
        });
        panel.body.appendChild(resumeBtn);

        const status = document.createElement("div");
        status.id = "psa-status";
        panel.body.appendChild(status);
        panel.status = status;

        let msg = `No catalog match for: ${unmapped.join(", ")}. `;
        if (addedCount > 0) msg += `${addedCount} matched item(s) are already in the cart. `;
        if (autoMatched && autoMatched.length > 0) msg += `Auto-matched by name: ${autoMatched.map((m) => `${m.alias} -> ${m.product}`).join("; ")}. `;
        msg += "Add the item(s) above with the app's product list, then press the button — the questionnaire, ship date and Continue stay automated.";
        setStatus(status, msg, false);
        status.style.color = "var(--ds-warn, #a16207)"; // amber = needs human review
        apiSet('waiting_human', `Unmatched purchase item(s): ${unmapped.join(", ")} — add them manually, then continue`);
        trace("selectModules blocked on unmapped", unmapped.join(", "));
    }

    async function finishModulesStep(job, panel) {
        // v2.20: routed through applyShipDateIfAny so a non-date value (a "hold"
        // instruction) can never abort the row before the Continue gate.
        if (job.row.shipDate) {
            const res = await applyShipDateIfAny(job.row.shipDate, panel);
            if (res.status === "error") return; // status already set
        }

        let continueBtn = findByText("*", "Continue", true);
        for (let i = 0; i < 15 && !continueBtn; i++) {
            await sleep(300);
            continueBtn = findByText("*", "Continue", true);
        }
        if (!continueBtn) { setStatus(panel.status, "Could not find Continue button.", false, true); return; }

        setStatus(panel.status, "Ready — click Continue below to finish this row (script stops here).", true);
        apiSet('waiting_human', 'At Continue gate — ready to finish row');
        const continueTrigger = document.createElement("button");
        continueTrigger.className = "psa-btn psa-btn-primary";
        continueTrigger.textContent = "Click Continue";
        continueTrigger.addEventListener("click", () => {
            continueBtn.click();
            setStatus(panel.status, "Continue clicked. Row complete — provider selection is manual from here.", true);
            api.output = { row: job.row, completedAt: new Date().toISOString(), note: 'provider selection is manual from here' };
            apiSet('done', 'Row complete — provider selection is manual from here');
            clearJob();
            renderQueueStrip(panel); // next patient's row is one click away
        });
        panel.body.appendChild(continueTrigger);
    }

    /* =========================================================================
       SECTION 8 — PANEL UI (paste box, mapping preview, row queue)
       ========================================================================= */

    function buildPanel() {
        const style = document.createElement("style");
        style.textContent = `
            :root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}
            #psa-panel { position: fixed; top: 60px; right: 0; width: 340px; max-height: 80vh;
                overflow-y: auto; background: var(--ds-surface, #fff); border: 1px solid var(--ds-border, #ccc); border-right: none;
                border-radius: 5px 0 0 5px; box-shadow: -2px 2px 8px rgba(0,0,0,0.15);
                z-index: 999999; font-family: sans-serif; font-size: 12px; }
            #psa-header { padding: 6px 10px; background: var(--ds-surface2, #2c3e50); color: var(--ds-text, #fff); font-weight: bold;
                cursor: move; user-select: none; border-radius: 5px 0 0 0; display: flex; justify-content: space-between; align-items: center; }
            #psa-reset { font-size: 10px; font-weight: normal; padding: 2px 6px; border: 1px solid var(--ds-danger, #c0392b);
                border-radius: 3px; background: var(--ds-danger, #c0392b); color: #fff; cursor: pointer; }
            #psa-reset:hover { background: var(--ds-danger, #e74c3c); }
            #psa-stop { font-size: 10px; font-weight: normal; padding: 2px 6px; border: 1px solid #7a1f12; border-radius: 3px; background: var(--ds-danger, #b3402e); color: #fff; cursor: pointer; }
            #psa-stop:hover { background: #d9534f; }
            #psa-body { padding: 8px; }
            #psa-body.collapsed { display: none; }
            #psa-input { width: 100%; height: 90px; font-family: monospace; font-size: 11px; box-sizing: border-box; }
            .psa-btn { display: block; width: 100%; margin: 3px 0; padding: 5px 6px; font-size: 11px;
                border: 1px solid var(--ds-border, #ccc); border-radius: 3px; background: var(--ds-surface2, #f8f8f8); cursor: pointer; text-align: left; }
            .psa-btn:hover { background: #eaf3ff; }
            .psa-btn-primary { background: var(--ds-accent, #2c7be5); color: var(--ds-accent-text, #fff); border-color: var(--ds-accent, #2c7be5); font-weight: bold; }
            table.psa-map-table { width: 100%; border-collapse: collapse; font-size: 11px; margin-bottom: 6px; }
            table.psa-map-table th, table.psa-map-table td { border: 1px solid var(--ds-border, #ddd); padding: 3px 4px; text-align: left; }
            #psa-status { padding: 6px 0; font-style: italic; min-height: 14px; }
            #psa-queue { padding: 4px 8px; border-bottom: 1px solid var(--ds-border, #ddd); background: var(--ds-surface2, #fafafa); }
            #psa-queue .psa-q-head { display: flex; justify-content: space-between; align-items: center; font-weight: bold; margin-bottom: 2px; }
            #psa-q-clear { font-size: 10px; padding: 1px 5px; border: 1px solid var(--ds-border, #bbb); border-radius: 3px; background: #fff; cursor: pointer; }
            #psa-queue .psa-q-row { display: flex; align-items: center; gap: 5px; padding: 2px 0; border-top: 1px solid #eee; }
            #psa-queue .psa-q-row.active { background: #fff8e1; }
            #psa-queue .psa-q-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
            .psa-q-run { width: auto; margin: 0; padding: 2px 8px; }
            /* v1.28: match-status styling — green = has profile/ID,
               amber = needs review, gray = not checked */
            .psa-q-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
            .psa-q-dot.ok { background: var(--ds-success, #27ae60); }
            .psa-q-dot.warn { background: var(--ds-warn, #e67e22); }
            .psa-q-dot.plain { background: var(--ds-border, #bbb); }
            .psa-row { border-left: 3px solid var(--ds-border, #ddd); }
            .psa-row.ok { border-left-color: var(--ds-success, #27ae60); background: #f2faf4; }
            .psa-row.warn { border-left-color: var(--ds-warn, #e67e22); background: #fdf6ec; }
            .psa-id-badge { display: inline-block; background: var(--ds-success, #27ae60); color: #fff; border-radius: 3px;
                padding: 1px 5px; font-size: 10px; font-weight: bold; font-family: monospace; margin-left: 4px; }
            .psa-note-warn { color: var(--ds-danger, #c0392b); font-size: 11px; margin-left: 4px; }
            .psa-purchase { color: #777; margin-left: 4px; }
            /* v2.26 (DESIGN.md § Trigger contract): the panel is summoned from an
               inline button in the site's own top navbar and is hidden at boot. */
            #psa-close { font-size: 12px; font-weight: bold; padding: 2px 7px; border: 1px solid var(--ds-border, #ccc);
                border-radius: 3px; background: var(--ds-surface2, #f8f8f8); color: var(--ds-text, #333); cursor: pointer; }
            #psa-close:hover { background: var(--ds-danger, #b3402e); color: #fff; border-color: var(--ds-danger, #b3402e); }
            /* v2.34 — the trigger is a GLYPH-ONLY cart button docked as the first item
               of the navbar's search row (div.row > .search-col), i.e. immediately LEFT
               of the search magnifier. Jeyson: "besides the search button… left side of
               the search", then "just keep the cart icon" — so the state lives in the
               colour and the title tooltip, not in a label.
               WHY IT MOVED: measured live 2026-10-02, the site sets the navbar's LEFT
               ul to display:none at wide widths — the old left-nav dock measured 0x0 at
               a 1083px viewport. A docked button nobody can see at desktop width is the
               bug behind "it's hard to find". The search row is visible at every width
               (measured chip 271,16 at 1083px / 162,16 at 818px / 63,35 at 391px).
               COST, measured and accepted: that row has only ~20px of slack (search 223
               + filter 54 + clocks 487 inside a 784px row) and the clock cells cannot
               shrink below their min-content, so ANY chip — even a 29px one — wraps the
               clock row onto a second navbar line (nav height 72 -> 110 at 1083px). The
               clocks stay fully readable, just below the search. */
            #psa-trigger { flex: 0 0 auto; display: inline-flex; align-items: center;
                justify-content: center; border: none; cursor: pointer; line-height: 1;
                font-size: 15px; padding: 4px 8px; margin-right: 6px; border-radius: 6px;
                background: var(--primary-color, #c9a227); color: #111;
                box-shadow: 0 0 0 1px rgba(0, 0, 0, .18); }
            #psa-trigger:hover { filter: brightness(.92); }
            #psa-trigger.psa-state-run { background: var(--ds-warn, #a16207); color: #fff; }
            #psa-trigger.psa-state-done { background: var(--ds-success, #3d7a46); color: #fff; }
            #psa-trigger.psa-state-wait, #psa-trigger.psa-state-bad { background: var(--ds-danger, #b3402e); color: #fff; }
            /* Fallback dock only: when a route renders no search row the button goes in
               the navbar's left ul, where the flex rule must sit on the LI (the flex
               item), not on the button inside it. */
            .psa-trigger-item { flex: 0 0 auto !important; white-space: nowrap; }
        `;
        document.head.appendChild(style);

        const panelEl = document.createElement("div");
        panelEl.id = "psa-panel";

        const header = document.createElement("div");
        header.id = "psa-header";

        const headerTitle = document.createElement("span");
        headerTitle.textContent = "Sale Automator";

        const resetBtn = document.createElement("button");
        resetBtn.id = "psa-reset";
        resetBtn.textContent = "Reset";
        resetBtn.title = "Clear the current job and start over";
        resetBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            clearJob();
            panelEpoch++; // abandon any in-flight async step
            renderQueueStrip(panel);
            renderInputStage(panel);
            api.output = null; api.progress = null;
            apiSet('idle');
        });

        // v1.24: the panel is draggable by its header. A drag moves the panel
        // (and remembers the position across page loads); a plain click on the
        // title still collapses/expands it (suppressed only when a real drag
        // just happened).
        let suppressToggle = false;
        let drag = null;
        headerTitle.addEventListener("click", () => {
            if (suppressToggle) { suppressToggle = false; return; }
            body.classList.toggle("collapsed");
        });
        header.addEventListener("mousedown", (e) => {
            if (e.target.closest("#psa-reset, #psa-stop")) return;
            suppressToggle = false;
            const rect = panelEl.getBoundingClientRect();
            drag = { startX: e.clientX, startY: e.clientY, left: rect.left, top: rect.top, moved: false };
            e.preventDefault();
        });
        window.addEventListener("mousemove", (e) => {
            if (!drag) return;
            const dx = e.clientX - drag.startX;
            const dy = e.clientY - drag.startY;
            if (!drag.moved && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) drag.moved = true;
            panelEl.style.right = "auto";
            panelEl.style.left = (drag.left + dx) + "px";
            panelEl.style.top = (drag.top + dy) + "px";
        });
        window.addEventListener("mouseup", () => {
            if (!drag) return;
            if (drag.moved) {
                suppressToggle = true;
                // v2.6: clamp on save so a drag can never park the panel off-screen
                const W = window.innerWidth, H = window.innerHeight;
                const left = Math.min(Math.max(parseFloat(panelEl.style.left) || drag.left, 8), Math.max(8, W - 180));
                const top = Math.min(Math.max(parseFloat(panelEl.style.top) || drag.top, 8), Math.max(60, H - 60));
                panelEl.style.left = left + "px";
                panelEl.style.top = top + "px";
                try {
                    localStorage.setItem("psa-panel-pos", JSON.stringify({ left, top }));
                } catch (err) { /* non-fatal */ }
            }
            drag = null;
        });

        const stopBtn = document.createElement("button");
        stopBtn.id = "psa-stop";
        stopBtn.textContent = "■ Stop";
        stopBtn.title = "Stop the current process immediately — works at any step, any time";
        stopBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            clearJob();
            panelEpoch++; // abandon any in-flight async step
            renderQueueStrip(panel);
            renderRunStatus(panel, "Stopped. Rows are still in the queue — click Run to start again.");
            apiSet('idle', 'Stopped — queue preserved');
        });

        // Right-aligned button group: Stop (abort now, keep the queue visible)
        // + Reset (clear the job and return to the input stage).
        const headerBtns = document.createElement("span");
        headerBtns.style.cssText = "display:flex; gap:4px; align-items:center;";
        headerBtns.appendChild(stopBtn);
        headerBtns.appendChild(resetBtn);
        // v2.26: the panel's own exit (the other two exits are Esc and a click
        // outside — see SECTION 8b).
        const closeBtn = document.createElement("button");
        closeBtn.id = "psa-close";
        closeBtn.textContent = "✕";
        closeBtn.title = "Close this panel (Esc or a click outside also work)";
        closeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            closePanel();
        });
        headerBtns.appendChild(closeBtn);
        header.appendChild(headerTitle);
        header.appendChild(headerBtns);
        panelEl.appendChild(header);

        // v1.26: the row queue strip lives OUTSIDE #psa-body, so step renders
        // that clear the body can never wipe the clickable rows.
        const queueSection = document.createElement("div");
        queueSection.id = "psa-queue";
        panelEl.appendChild(queueSection);

        const body = document.createElement("div");
        body.id = "psa-body";
        panelEl.appendChild(body);

        // Restore the dragged position (the panel re-renders on every page
        // load, so remember where the user left it — v1.24).
        // v2.6: visibility guard — a saved position can park the panel fully
        // off-screen (reported 2026-08-06: top:1054 in a 904px viewport, "the
        // automator doesn't show"). Fully-off positions reset to the default;
        // partially-off ones clamp into view.
        try {
            const saved = JSON.parse(localStorage.getItem("psa-panel-pos"));
            if (saved && typeof saved.left === "number") {
                const W = window.innerWidth, H = window.innerHeight;
                const savedTop = saved.top || 60;
                const fullyOff = savedTop > H - 8 || savedTop + 40 < 8;
                if (fullyOff) {
                    panelEl.style.right = "0";
                    panelEl.style.left = "auto";
                    panelEl.style.top = "60px";
                } else {
                    panelEl.style.right = "auto";
                    panelEl.style.left = Math.min(Math.max(saved.left, 8), Math.max(8, W - 180)) + "px";
                    panelEl.style.top = Math.min(Math.max(savedTop, 8), Math.max(60, H - 60)) + "px";
                }
            }
        } catch (err) { /* ignore */ }

        // v2.26: HIDDEN at boot. The navbar trigger summons it (DESIGN.md says no
        // always-on floating panel). It is hidden, never removed — every step of a
        // running job writes into panel.body / panel.status, so removing the node
        // mid-job would break the flow.
        panelUI = { root: panelEl };
        panelEl.style.display = "none";
        document.body.appendChild(panelEl);

        const panel = { root: panelEl, header, body, queueSection, status: null };
        renderInputStage(panel);
        renderQueueStrip(panel);
        return panel;
    }

    /* =========================================================================
       SECTION 8b — TRIGGER + DISMISSAL (DESIGN.md § Trigger contract, 2026-10-02)
       The trigger is docked INLINE in the site's own navbar SEARCH ROW (the div.row
       that holds .search-col), as its first item — a cart-icon button immediately
       left of the search magnifier. That row is the topmost element on every
       authenticated route and is OUTSIDE the Vue router-view, so the content area
       re-rendering all day never takes the button with it — and unlike the navbar's
       left ul (display:none at wide widths) it is actually visible at desktop width.
       Three exits: the panel's ✕, Escape, and a click anywhere outside it.
       ========================================================================= */
    let panelUI = null; // { root } — set by buildPanel()
    let triggerEl = null;

    function panelIsOpen() {
        return !!panelUI && panelUI.root.style.display !== "none";
    }

    function detachPanelDismiss() {
        document.removeEventListener("mousedown", onOutsidePress, true);
        document.removeEventListener("keydown", onPanelKey, true);
    }

    function onOutsidePress(e) {
        if (!panelUI) return;
        const t = e.target;
        if (panelUI.root.contains(t)) return; // clicks inside the panel keep it open
        if (triggerEl && (triggerEl === t || triggerEl.contains(t))) return; // the trigger toggles
        closePanel();
    }

    function onPanelKey(e) {
        if (e.key === "Escape") closePanel();
    }

    function openPanel() {
        if (!panelUI) return;
        panelUI.root.style.display = "";
        document.addEventListener("mousedown", onOutsidePress, true);
        document.addEventListener("keydown", onPanelKey, true);
    }

    function closePanel() {
        if (!panelUI) return;
        panelUI.root.style.display = "none";
        detachPanelDismiss();
    }

    // State readout on the trigger — a closed panel must not hide the job's state.
    // The button carries no text (glyph only), so every state word lives in the title.
    const TRIGGER_STATE = {
        idle: { label: "Sale Automator", cls: "psa-state-idle", hint: "idle — click to paste rows" },
        running: { label: "Running…", cls: "psa-state-run", hint: "running" },
        waiting_human: { label: "Needs you", cls: "psa-state-wait", hint: "waiting for you" },
        done: { label: "Done", cls: "psa-state-done", hint: "done" },
        error: { label: "Blocked", cls: "psa-state-bad", hint: "blocked" }
    };

    function renderTrigger() {
        if (!triggerEl) return;
        const s = TRIGGER_STATE[api.state] || TRIGGER_STATE.idle;
        triggerEl.className = s.cls;
        // Colour alone cannot be read over a chat/notification glance, and there is no
        // label: the tooltip is the state word.
        triggerEl.title = "Sale Automator — " + s.hint
            + (api.message ? " · " + api.message : "")
            + " (✕ / Esc / click outside closes the panel)";
    }

    function buildTrigger() {
        if (triggerEl && triggerEl.isConnected) return true;
        // PRIMARY DOCK: the navbar's search row, as its FIRST item — immediately left of
        // the search magnifier. The site hides the navbar's left ul at wide widths
        // (measured: display:none, 0x0 at a 1083px viewport), so the old left-ul dock was
        // invisible on a normal desktop. This row is present and visible at every width.
        const searchCol = document.querySelector(".search-col");
        const row = searchCol && searchCol.parentElement;
        let host = row || null;
        let fallbackLi = null;
        if (!host) {
            // FALLBACK: routes that render no search row get the navbar's left ul.
            const nav = document.querySelector("nav.main-header > ul.navbar-nav:not(.ml-auto)");
            const burgerLi = nav && nav.querySelector("li.nav-item");
            if (!burgerLi) return false; // navbar not rendered yet (SPA boot)
            fallbackLi = document.createElement("li");
            fallbackLi.className = "nav-item psa-trigger-item";
            host = fallbackLi;
        }
        const btn = document.createElement("button");
        btn.id = "psa-trigger";
        btn.type = "button";
        btn.className = "psa-state-idle";
        btn.textContent = "🛒"; // glyph only — the state is colour + tooltip
        btn.title = "Sale Automator";
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (panelIsOpen()) closePanel(); else openPanel();
        });
        if (fallbackLi) { burgerLi.after(fallbackLi); fallbackLi.appendChild(btn); }
        else host.insertBefore(btn, host.firstChild);
        triggerEl = btn;
        renderTrigger();
        return true;
    }

    // Re-dock if Vue ever re-renders the nav list out from under us. Debounced
    // 250ms trailing (one scan per mutation burst), and it doubles as the boot
    // wait for a navbar that has not rendered yet.
    function watchTrigger() {
        let timer = null;
        const tryDock = () => {
            if (timer) return;
            timer = setTimeout(() => {
                timer = null;
                if (triggerEl && triggerEl.isConnected) return;
                buildTrigger();
            }, 250);
        };
        new MutationObserver(tryDock).observe(document.documentElement, { childList: true, subtree: true });
        tryDock();
    }

    function renderInputStage(panel) {
        const isCurrent = beginRender();
        if (!isCurrent()) return;
        renderQueueStrip(panel); // v1.29: re-show the strip (the queue stage hid it)
        panel.body.innerHTML = "";

        const textarea = document.createElement("textarea");
        textarea.id = "psa-input";
        textarea.placeholder = "Paste CSV or JSON here...";
        panel.body.appendChild(textarea);

        const parseBtn = document.createElement("button");
        parseBtn.className = "psa-btn psa-btn-primary";
        parseBtn.textContent = "Parse & Preview Mapping";
        panel.body.appendChild(parseBtn);

        const status = document.createElement("div");
        status.id = "psa-status";
        panel.body.appendChild(status);
        panel.status = status;

        parseBtn.addEventListener("click", () => {
            let rows;
            try {
                rows = parseInput(textarea.value);
            } catch (e) {
                setStatus(status, `Parse error: ${e.message}`, false, true);
                return;
            }
            if (rows.length === 0) {
                setStatus(status, "No rows found in input.", false, true);
                return;
            }
            renderMappingStage(panel, rows);
        });
    }

    function renderMappingStage(panel, rawRows) {
        const isCurrent = beginRender();
        if (!isCurrent()) return;
        panel.body.innerHTML = "";

        let mapping = autoMapColumns(rawRows[0]);
        const anyMapped = Object.values(mapping).some(Boolean);
        if (!anyMapped) mapping = autoMapByFixedSchema(rawRows[0]);
        const availableHeaders = Object.keys(rawRows[0]);

        const heading = document.createElement("div");
        heading.innerHTML = `<strong>Confirm column mapping</strong> (${rawRows.length} row${rawRows.length > 1 ? "s" : ""})`;
        panel.body.appendChild(heading);

        const table = document.createElement("table");
        table.className = "psa-map-table";
        const thead = document.createElement("tr");
        thead.innerHTML = "<th>Field</th><th>Mapped column</th>";
        table.appendChild(thead);

        const selects = {};
        for (const field of CANONICAL_FIELDS) {
            const tr = document.createElement("tr");
            const tdLabel = document.createElement("td");
            tdLabel.textContent = FIELD_LABELS[field];
            const tdSelect = document.createElement("td");
            const select = document.createElement("select");
            const noneOpt = document.createElement("option");
            noneOpt.value = ""; noneOpt.textContent = "(none)";
            select.appendChild(noneOpt);
            availableHeaders.forEach((h) => {
                const opt = document.createElement("option");
                const sample = rawRows[0][h];
                opt.value = h;
                opt.textContent = sample ? `${h} (e.g. "${String(sample).slice(0, 30)}")` : h;
                if (mapping[field] === h) opt.selected = true;
                select.appendChild(opt);
            });
            selects[field] = select;
            tdSelect.appendChild(select);
            tr.appendChild(tdLabel);
            tr.appendChild(tdSelect);
            table.appendChild(tr);
        }
        panel.body.appendChild(table);

        const previewNote = document.createElement("div");
        previewNote.style.marginBottom = "6px";
        previewNote.textContent = "Check every row above — remap any column that doesn't look right, then confirm.";
        panel.body.appendChild(previewNote);

        const confirmBtn = document.createElement("button");
        confirmBtn.className = "psa-btn psa-btn-primary";
        confirmBtn.textContent = "Looks good — build row queue";
        panel.body.appendChild(confirmBtn);

        const backBtn = document.createElement("button");
        backBtn.className = "psa-btn";
        backBtn.textContent = "Back";
        panel.body.appendChild(backBtn);

        const status = document.createElement("div");
        status.id = "psa-status";
        panel.body.appendChild(status);
        panel.status = status;

        backBtn.addEventListener("click", () => renderInputStage(panel));

        confirmBtn.addEventListener("click", () => {
            const finalMapping = {};
            for (const field of CANONICAL_FIELDS) finalMapping[field] = selects[field].value || null;
            const normalizedRows = rawRows.map((r) => normalizeRow(r, finalMapping));
            renderQueueStage(panel, normalizedRows);
        });
    }

    function escHtml(s) {
        return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    // Row label for the queue strip and queue stage. v1.27: shows the patient
    // ID when the profile check filled one in, plus any review warning.
    function rowLabel(row, withId = true) {
        const name = row.patientName || row.patientId || row.patientEmail || "(no identifier)";
        const id = withId && row.patientId ? ` — ${row.patientId}` : "";
        const note = row._checkNote ? ` — ⚠ ${row._checkNote}` : "";
        const purchase = row.purchase ? ` — ${row.purchase}` : "";
        return `${name}${id}${note}${purchase}`;
    }

    // v1.28: HTML label for the queue-stage rows — the patient ID renders as a
    // green badge and any review warning in amber, so a match is scannable at
    // a glance instead of being buried in the text.
    function rowLabelHtml(row) {
        const name = escHtml(row.patientName || row.patientId || row.patientEmail || "(no identifier)");
        const id = row.patientId ? ` <span class="psa-id-badge">${escHtml(row.patientId)}</span>` : "";
        const note = row._checkNote ? ` <span class="psa-note-warn">⚠ ${escHtml(row._checkNote)}</span>` : "";
        const purchase = row.purchase ? ` <span class="psa-purchase">— ${escHtml(row.purchase)}</span>` : "";
        return `${name}${id}${note}${purchase}`;
    }

    // v1.28: match-status class for a row — green when it has a patient ID
    // (found by the check or from the sheet), amber when it needs review.
    function rowStatusClass(row) {
        return row.patientId ? "ok" : (row._checkNote ? "warn" : "plain");
    }

    function renderQueueStage(panel, rows, summary, autoCheck = true) {
        const isCurrent = beginRender();
        if (!isCurrent()) return;
        panel.body.innerHTML = "";

        // v1.26: tag rows with a stable id and persist the whole queue so the
        // always-visible strip can re-render it on later page loads.
        rows.forEach((r, i) => { if (r._id === undefined) r._id = i; });
        saveQueue(rows);
        renderQueueStrip(panel);
        // v1.29: the body's queue cards duplicate the strip — hide the strip
        // on this stage (it re-appears on the input stage, during the pass,
        // and during run steps).
        panel.queueSection.style.display = "none";

        // v1.27: after the profile-check pass, summarize what happened so the
        // removed rows are never silent. v1.28: split into colored blocks —
        // green for matches, red for removed, amber for review-needed.
        if (summary) {
            if (summary.found > 0) {
                const ok = document.createElement("div");
                ok.style.cssText = "border:1px solid #27ae60;border-radius:3px;padding:6px;margin-bottom:6px;background:#f2faf4;";
                ok.innerHTML = `<strong>✅ Profile check complete</strong><br><b>${summary.found} with profiles</b> — IDs are filled in the rows below`;
                panel.body.appendChild(ok);
            }
            if (summary.removed.length > 0) {
                const rm = document.createElement("div");
                rm.style.cssText = "border:1px solid #c0392b;border-radius:3px;padding:6px;margin-bottom:6px;background:#fdf3f2;";
                rm.innerHTML = `🗑 <b>${summary.removed.length} removed</b> (no matching patient): ${summary.removed.map((r) => escHtml(rowLabel(r, false))).join(", ")}`;
                panel.body.appendChild(rm);
            }
            if (summary.removedUnmatched && summary.removedUnmatched.length > 0) {
                const am = document.createElement("div");
                am.style.cssText = "border:1px solid #c0392b;border-radius:3px;padding:6px;margin-bottom:6px;background:#fdf3f2;";
                am.innerHTML = `🗑 <b>${summary.removedUnmatched.length} removed</b> (the search returned a different patient): ${summary.removedUnmatched.map((r) => escHtml(rowLabel(r, false))).join(", ")}`;
                panel.body.appendChild(am);
            }
            if (summary.noId.length > 0) {
                const ni = document.createElement("div");
                ni.style.cssText = "border:1px solid #e67e22;border-radius:3px;padding:6px;margin-bottom:6px;background:#fdf6ec;";
                ni.innerHTML = `⚠ <b>${summary.noId.length} kept</b> (no Patient ID / phone / full name to check): ${summary.noId.map((r) => escHtml(rowLabel(r, false))).join(", ")}`;
                panel.body.appendChild(ni);
            }
        }

        const heading = document.createElement("div");
        heading.innerHTML = `<strong>Row queue</strong> (${rows.length}) — click <em>Run this row</em> to start each sale`;
        panel.body.appendChild(heading);

        rows.forEach((row, idx) => {
            const wrap = document.createElement("div");
            wrap.className = "psa-row " + rowStatusClass(row);
            wrap.style.border = "1px solid #eee";
            wrap.style.padding = "4px";
            wrap.style.marginTop = "4px";

            const label = document.createElement("div");
            label.innerHTML = `${idx + 1}. ${rowLabelHtml(row)}`;
            wrap.appendChild(label);

            const runBtn = document.createElement("button");
            runBtn.className = "psa-btn psa-btn-primary";
            runBtn.textContent = "Run this row";
            runBtn.addEventListener("click", () => startRow(panel, row));
            wrap.appendChild(runBtn);

            panel.body.appendChild(wrap);
        });

        const backBtn = document.createElement("button");
        backBtn.className = "psa-btn";
        backBtn.textContent = "Start over";
        backBtn.addEventListener("click", () => renderInputStage(panel));
        panel.body.appendChild(backBtn);

        const status = document.createElement("div");
        status.id = "psa-status";
        panel.body.appendChild(status);
        panel.status = status;

        // v1.27: a fresh paste auto-runs the profile check (fills IDs, removes
        // no-profile rows) unless this render is the check's own output
        // (autoCheck=false) or every row already has an ID.
        if (autoCheck && rows.some((r) => !r.patientId)) {
            startProfileCheck(panel);
        }
    }

    /* ---- Persistent row queue strip (v1.26) ----
       The pasted rows stay available at ALL times — on the input stage, during
       every intermediate step, and on the final "Click Continue" gate — so a
       hung step never traps the queue: click any row's Run to switch patients
       without Reset. The strip lives in its own #psa-queue element OUTSIDE
       #psa-body, so step renders that clear the body can't wipe it. */
    function renderRunStatus(panel, message) {
        panel.body.innerHTML = "";
        const status = document.createElement("div");
        status.id = "psa-status";
        panel.body.appendChild(status);
        panel.status = status;
        setStatus(status, message, false);
        api.message = message; // R18: sync API message
        api.lastActivity = Date.now();
    }

    function startRow(panel, row) {
        panelEpoch++; // abandon any in-flight async step for the old job (R5)
        const job = { row, step: "search" };
        saveJob(job);
        renderQueueStrip(panel);
        renderRunStatus(panel, `Starting ${row.patientName || row.patientId || "(no identifier)"} — searching...`);
        const q = loadQueue();
        const idx = q ? q.findIndex(r => r._id === row._id) + 1 : 0;
        apiSet('running', `Row ${idx}: ${row.patientName || row.patientId || '(no identifier)'}`, { progress: { current: idx, total: q ? q.length : 0, step: 'search' } });
        runCurrentStep(panel);
    }

    function renderQueueStrip(panel) {
        const qs = panel.queueSection;
        if (!qs) return;
        qs.innerHTML = "";
        const queue = loadQueue();
        if (!queue || queue.length === 0) { qs.style.display = "none"; return; }
        qs.style.display = "";

        const job = loadJob();
        const activeId = job && job.row && job.row._id;

        const head = document.createElement("div");
        head.className = "psa-q-head";
        const title = document.createElement("span");
        title.textContent = `Rows (${queue.length})`;
        const clearBtn = document.createElement("button");
        clearBtn.id = "psa-q-clear";
        clearBtn.textContent = "✕ clear queue";
        clearBtn.title = "Remove all pasted rows (the active job, if any, keeps running)";
        clearBtn.addEventListener("click", () => {
            clearQueue();
            renderQueueStrip(panel);
            renderInputStage(panel);
        });
        head.appendChild(title);
        head.appendChild(clearBtn);
        qs.appendChild(head);

        queue.forEach((row, idx) => {
            const rowEl = document.createElement("div");
            rowEl.className = "psa-q-row" + (row._id === activeId ? " active" : "");
            // v1.28: status dot — green = has patient ID, amber = review, gray = unchecked
            const dot = document.createElement("span");
            dot.className = "psa-q-dot " + rowStatusClass(row);
            rowEl.appendChild(dot);
            const label = document.createElement("span");
            label.className = "psa-q-label";
            label.textContent = `${idx + 1}. ${rowLabel(row)}`;
            const runBtn = document.createElement("button");
            runBtn.className = "psa-btn psa-btn-primary psa-q-run";
            runBtn.textContent = row._id === activeId ? "Re-run" : "Run";
            runBtn.addEventListener("click", () => startRow(panel, row));
            rowEl.appendChild(label);
            rowEl.appendChild(runBtn);
            qs.appendChild(rowEl);
        });
    }

    /* =========================================================================
       SECTION 9 — STEP DISPATCH (runs on every page load, based on saved job)
       ========================================================================= */

    async function runCurrentStep(panel) {
        const job = loadJob();
        if (!job) return;
        if (api.state === 'running' || api.state === 'waiting_human') {
          api.progress = api.progress || {};
          api.progress.step = job.step;
          api.lastActivity = Date.now();
        }

        switch (job.step) {
            case "search":
                await stepSearch(job, panel);
                break;
            case "profile-check":
                await runProfileCheckPass(panel);
                break;
            case "consent-check":
                await stepConsentCheck(job, panel);
                break;
            case "create-sale":
                await stepCreateSale(job, panel);
                break;
            case "select-modules":
                await stepSelectModules(job, panel);
                break;
            case "ship-date":
                await finishModulesStep(job, panel);
                break;
            default:
                break;
        }
    }

    /* =========================================================================
       SECTION 10 — BOOTSTRAP
       ========================================================================= */

    installNavInterceptor(); // capture window.open navigation before any step runs
    const panel = buildPanel();
    watchTrigger(); // docks 🛒 Sale Automator in the top navbar (and keeps it docked)
    const existingJob = loadJob();
    if (existingJob) {
        openPanel(); // a resumed job must be visible, not hidden behind a button
        panel.body.innerHTML = "";
        const status = document.createElement("div");
        status.id = "psa-status";
        panel.body.appendChild(status);
        panel.status = status;
        setStatus(status, `Resuming job at step "${existingJob.step}"...`);
        apiSet('running', `Resuming at step "${existingJob.step}"`, { progress: { step: existingJob.step } });
        runCurrentStep(panel);
    } else {
        startManualQuestionnaireAutofill(panel);
    }

    // v2.32: sweep the live picker while we are idle on a sale form, so name
    // matching runs against the clinic's REAL product names. Never during a
    // running job — the sweep clicks the picker around. The sale form is rendered
    // by Vue AFTER this script boots, so the picker is waited for, not assumed.
    if (!existingJob) {
        (async () => {
            // The picker renders PROGRESSIVELY: at boot only "Services" is in
            // #medications-list, and sweeping then records an empty catalog
            // (verified live 2026-10-02). Wait until the med-type row stops growing.
            let last = -1, stable = 0;
            for (let i = 0; i < 45; i++) {
                await sleep(1000);
                const count = document.querySelectorAll("#medications-list .btn").length;
                if (count >= 2 && count === last) { if (++stable >= 2) break; } else { stable = 0; last = count; }
            }
            if (!document.querySelector("#medications-list") || loadJob()) return;
            const s = await sweepLiveCatalog();
            if (!s) return;
            const d = catalogDrift();
            api.message = `Live catalog swept: ${s.rows.length} products` +
                (d && (d.gone.length || d.added.length) ? ` — drift vs the built-in list: ${d.gone.length} gone, ${d.added.length} new` : " — no drift");
            console.info(`[PSA] ${api.message}`, d ? { gone: d.gone, added: d.added } : {});
        })().catch((err) => console.warn("[PSA] catalog sweep failed:", err && err.message));
    }

    /* =========================================================================
       SECTION 10b — MANUAL ORDERING AUTOFILL (no active job)
       Jeyson's rule (2026-09-24): the questionnaire is autofilled "even when we
       are doing manual ordering. That way it always fires the autofill."

       With no job in localStorage the script used to sit idle on every page, so
       a hand-built sale (the products added by hand, for a cart the script never
       touched) got no help at all. This path fills that gap: on the sale form,
       once the questionnaire renders, prefill it from the same answer bank.

       Deliberately NARROW:
       - only on the sale-form URL (/dashboard/PAT…/…/patient-sales), never on
         the profile or list pages;
       - only after a product is actually in the cart (the form is fetched by
         cart drug ids, so an empty cart has nothing to fill);
       - it never submits, never sets a ship date, never clicks Continue and
         never touches a background tab. There is no job flow here, so the
         handoff just offers a re-scan.
       ========================================================================= */
    function startManualQuestionnaireAutofill(panel) {
        const onSaleForm = () => /^\/dashboard\/PAT\d+\//.test(location.pathname);
        if (!onSaleForm()) return;

        // ADDITIVE, never destructive: this runs at boot, before any job or
        // paste-UI code has touched the panel. Wiping panel.body here would be
        // fine at this instant but would erase the paste stage if anything
        // re-entered later, so the manual notes get their own block appended
        // after whatever is already there (and only once).
        const note = document.createElement("div");
        note.id = "psa-manual-note";
        note.style.cssText = "margin-top:6px;padding-top:6px;border-top:1px dashed var(--ds-border, #e8e2d8);font-size:11px;";
        panel.body.appendChild(note);
        const render = (state, message) => {
            note.replaceChildren();
            const status = document.createElement("div");
            status.id = "psa-manual-status";
            status.textContent = message;
            status.style.color = state === "done" ? "var(--ds-success, #3d7a46)"
                : state === "error" ? "var(--ds-danger, #b3402e)"
                : "var(--ds-muted, #7a7163)";
            note.appendChild(status);
            if (state === "done") {
                const again = document.createElement("button");
                again.className = "psa-btn";
                again.textContent = "Re-scan the questionnaire";
                again.addEventListener("click", () => { filled = false; tryFill(); });
                note.appendChild(again);
            }
        };

        let running = false;
        // The observer below fires on EVERY cart/form mutation, and the form
        // stays mounted after a prefill — without this latch the script would
        // re-prefill in a loop the moment the human touched anything.
        // Re-armed only by the explicit "Re-scan" button.
        let filled = false;
        const tryFill = async () => {
            if (running || filled) return;
            if (document.hidden) return; // never work a backgrounded tab unprompted
            if (questionnaireIsPresent()) {
                running = true;
                apiSet('running', 'Manual ordering — autofilling the questionnaire');
                try {
                    await prefillSaleQuestionnaire(null, panel, true);
                    filled = true;
                    apiSet('waiting_human', 'Manual ordering — questionnaire prefilled, review and submit');
                } catch (err) {
                    filled = true; // don't hot-loop on a form we can't handle
                    apiSet('error', `Manual questionnaire autofill failed: ${err.message}`);
                    render("error", `Could not fill the questionnaire: ${err.message}`);
                } finally {
                    running = false;
                }
                return;
            }
            // Nothing yet — keep checking briefly, then say so (silence would
            // look like the script is absent).
            for (let i = 0; i < 12; i++) {
                await sleep(500);
                if (questionnaireIsPresent()) { tryFill(); return; }
            }
            render("idle", "Manual ordering — no questionnaire on this sale yet. Add the products and it fills automatically.");
        };

        // Explicit re-scan is the ONLY way to re-arm a completed fill.
        api.manualQuestionnaireRescan = () => { filled = false; tryFill(); };

        // The form mounts after the products are added, which may already have
        // happened before this script booted — so check immediately, then watch.
        tryFill();
        const observer = new MutationObserver(() => { if (questionnaireIsPresent()) tryFill(); });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        // The observer alone would never fire if the form is already there, and
        // it fires on every cart mutation — tryFill() is guarded by `running`
        // and by questionnaireIsPresent(), so this stays cheap.
        api.manualAutofill = { armed: true, onSaleForm: true };
    }

    // R18: trigger dispatcher (agent entry point)
    // v2.23: what the routing advisory actually keyed on — the SHIPPING address
    // state — plus the contact state it deliberately ignored. Agents and the live
    // harness read this instead of guessing from api.routing.
    api.stateRead = function () {
      const m = harvestProfileMeasurements();
      return {
        shippingState: m.shippingState || "",
        shippingStateRaw: m.shippingStateRaw || "",
        contactState: m.state || "",
        used: m.shippingState || "",
        source: m.shippingState ? "shipping-address" : ""
      };
    };
    api.trigger = function (action, params) {
      if (action === 'start-row') {
        if (api.state === 'running' && !api.message.match(/stopped|idle/i)) {
          return { ok: false, error: 'already running' };
        }
        const q = loadQueue() || [];
        if (q.length === 0) return { ok: false, error: 'queue is empty — paste rows first' };
        const row = params && params.id ? q.find(r => r._id === params.id) : q[0];
        if (!row) return { ok: false, error: 'row not found' };
        openPanel(); // an agent-started run must be visible to the human
        startRow(panel, row);
        return { ok: true };
      }
      if (action === 'continue') {
        const btn = panel.body.querySelector('.psa-btn.psa-btn-primary');
        if (!btn) return { ok: false, error: 'no Continue button visible (not at the gate)' };
        btn.click();
        return { ok: true };
      }
      if (action === 'stop') {
        const btn = document.getElementById('psa-stop');
        if (btn) btn.click();
        return { ok: true };
      }
      if (action === 'reset') {
        const btn = document.getElementById('psa-reset');
        if (btn) btn.click();
        return { ok: true };
      }
      // R19: load-rows — populate the queue by API (no parse/map UI, no manual
      // localStorage). Accepts an array of objects keyed by CANONICAL fields
      // (patientName, patientEmail, phone, patientId, purchase, existingPatient,
      // shipDate, patientState, notes) OR an array of raw CSV strings. Each row
      // is normalized to canonical fields, _id'd, saved, and the panel re-renders
      // — byte-identical to what the UI's "build row queue" produces.
      if (action === 'load-rows') {
        const src = params && params.rows ? params.rows : null;
        if (!Array.isArray(src) || src.length === 0) return { ok: false, error: 'params.rows must be a non-empty array' };
        const isCsv = typeof src[0] === 'string';
        let rawRows;
        if (isCsv) {
          // each element is a line; join and run the same parser the UI uses.
          // parseCSV returns header-keyed row objects (or synthetic Column-N
          // keys for headerless), auto-detecting the header row + delimiter.
          rawRows = parseCSV(src.join('\n'));
        } else {
          rawRows = src;
        }
        // normalize: if a row already carries canonical keys (patientName, ...),
        // keep them; else auto-map by header name (fall back to fixed schema).
        const rows = rawRows.map((o) => {
          const hasCanonical = CANONICAL_FIELDS.some((f) => f in o && o[f] !== "" && o[f] !== undefined);
          if (hasCanonical) { const out = {}; for (const f of CANONICAL_FIELDS) out[f] = String(o[f] || "").trim(); return out; }
          const mapping = autoMapColumns(o);
          const anyMapped = Object.values(mapping).some(Boolean);
          const mapped = (anyMapped ? mapping : autoMapByFixedSchema(o));
          const out = {}; for (const f of CANONICAL_FIELDS) out[f] = (mapped[f] && o[mapped[f]] !== undefined) ? String(o[mapped[f]]).trim() : "";
          return out;
        });
        rows.forEach((r, i) => { r._id = i; });
        saveQueue(rows);
        renderInputStage(panel);   // refresh panel to the input stage (strip updates)
        renderQueueStrip(panel);
        return { ok: true, count: rows.length, rows: rows.map((r) => ({ id: r._id, name: r.patientName, patientId: r.patientId, purchase: r.purchase })) };
      }
      if (action === 'get-queue') {
        const q = loadQueue() || [];
        return { ok: true, count: q.length, rows: q };
      }
      // R19: profile-check — run the SAME sweep the queue stage auto-runs after
      // a paste: fill patient IDs on found rows, remove only rows whose profile
      // was PROVEN absent, keep unconfirmed rows flagged for a human.
      if (action === 'profile-check') {
        const q = loadQueue() || [];
        if (q.length === 0) return { ok: false, error: 'queue is empty — paste rows first' };
        openPanel();
        startProfileCheck(panel);
        return { ok: true };
      }
      if (action === 'clear-queue') {
        clearQueue();
        renderInputStage(panel);
        renderQueueStrip(panel);
        return { ok: true };
      }
      return { ok: false, error: `unknown action: ${action}` };
    };
})();