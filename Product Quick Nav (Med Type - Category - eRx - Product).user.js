// ==UserScript==
// @name         Product Quick Nav (Med Type - Category - eRx - Product)
// @namespace    jeyson-quicknav
// @version      3.5
// @author       Jeyson Dagondon
// @description  Quick-pick bar that auto-clicks medication type, category, eRx tab, then product
// @match        https://staff.exampleclinic.com/*/*/*/*/patient-sales
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[PQNav v3.5] boot');
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}';
  document.documentElement.appendChild(__dsStyle);

(function () {
    'use strict';

    const CATALOG = {
        "Peptide": {
            "Longevity": [
                "[GRE] Epithalon injectable",
                "[GRE] GHK-Cu injectable",
                "[GRE] Glutathione injection",
                "GHK-Cu/Epithalon 10mg/2mg/mL SOLUTION"
            ],
            "Mitochondria / Metabolic": [
                "[GRE] 5-Amino 1MQ capsules",
                "[GRE] MOTS-C injectable",
                "[GRE] MOTs-C/Tesamorelin injectable" // NOTE: duplicate text exists on page; first match wins
            ],
            "Fat Loss": [
                "[GRE] AOD-9604/MOTs-C/Tesamorelin injectable"
            ],
            "Healing": [
                "[GRE] BPC-157 capsules",
                "[GRE] BPC-157 injectable",
                "[GRE] BPC-157/TB-500 capsules",
                "[GRE] GLOW",
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

    // Always-pinned favorites (per usage: majority of picks are one of these).
    // A 3rd pinned slot is filled adaptively from click counts below.
    const PINNED_SEED = ["[GRE] KLOW", "[GRE] Tesamorelin/Ipamorelin injectable"];
    const PIN_COUNT = 3;

    // ---------- Click counts (localStorage) ----------

    const COUNTS_KEY = 'qn-click-counts';
    const MODE_KEY = 'qn-sort-mode'; // 'grouped' | 'used'

    function loadCounts() {
        try {
            return JSON.parse(localStorage.getItem(COUNTS_KEY)) || {};
        } catch (e) {
            return {};
        }
    }

    function saveCounts(counts) {
        try {
            localStorage.setItem(COUNTS_KEY, JSON.stringify(counts));
        } catch (e) {
            console.warn('[Product Quick Nav] could not save counts', e);
        }
    }

    function bumpCount(product) {
        const counts = loadCounts();
        counts[product] = (counts[product] || 0) + 1;
        saveCounts(counts);
        return counts[product];
    }

    function loadMode() {
        const m = localStorage.getItem(MODE_KEY);
        return m === 'used' ? 'used' : 'grouped';
    }

    function saveMode(mode) {
        try {
            localStorage.setItem(MODE_KEY, mode);
        } catch (e) { /* ignore */ }
    }

    // Flatten catalog: [{ medType, category, product }]
    function flatCatalog() {
        const out = [];
        for (const [medType, categories] of Object.entries(CATALOG)) {
            for (const [category, products] of Object.entries(categories)) {
                products.forEach((product) => out.push({ medType, category, product }));
            }
        }
        return out;
    }

    function getPinnedEntries(counts) {
        const all = flatCatalog();
        const byProduct = new Map(all.map((e) => [e.product, e]));
        const pinned = PINNED_SEED.filter((p) => byProduct.has(p)).map((p) => byProduct.get(p));
        const pinnedSet = new Set(pinned.map((e) => e.product));
        const rest = all
            .filter((e) => !pinnedSet.has(e.product))
            .sort((a, b) => (counts[b.product] || 0) - (counts[a.product] || 0) || a.product.localeCompare(b.product));
        for (const e of rest) {
            if (pinned.length >= PIN_COUNT) break;
            pinned.push(e);
        }
        return pinned;
    }

    // ---------- Search (token AND-match, separator/order independent) ----------
    // "tesa/ipa", "tesa ipa", "IPA-Tesa" all match "Tesamorelin/Ipamorelin injectable".

    function tokenize(query) {
        return query.toLowerCase().split(/[^a-z0-9]+/i).filter(Boolean);
    }

    function searchCatalog(query) {
        const tokens = tokenize(query);
        if (!tokens.length) return [];
        return flatCatalog()
            .filter((e) => {
                const haystack = `${e.product} ${e.category} ${e.medType}`.toLowerCase();
                return tokens.every((t) => haystack.includes(t));
            });
    }

    // ---------- DOM helpers ----------

    function findByText(selector, text) {
        const els = document.querySelectorAll(selector);
        for (const el of els) {
            if (el.textContent.trim() === text) return el;
        }
        return null;
    }

    function waitForByText(selector, text, timeout = 6000) {
        return new Promise((resolve, reject) => {
            const existing = findByText(selector, text);
            if (existing) return resolve(existing);

            const observer = new MutationObserver(() => {
                const el = findByText(selector, text);
                if (el) {
                    observer.disconnect();
                    resolve(el);
                }
            });

            observer.observe(document.body, { childList: true, subtree: true });

            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Timeout waiting for "${text}"`));
            }, timeout);
        });
    }

    // ---------- Auto-dismiss questionnaire ----------

    function autoSkipQuestionnaire() {
        const trySkip = () => {
            const btn = findByText('button.btn.btn-primary', 'Skip Questionnaire');
            if (btn) btn.click();
        };
        trySkip();
        const observer = new MutationObserver(trySkip);
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function setStatus(statusEl, text, ok, isError) {
        if (!statusEl) return;
        statusEl.textContent = text;
        statusEl.style.color = isError ? 'var(--ds-danger,#c0392b)' : (ok ? 'var(--ds-success,#27ae60)' : 'var(--ds-muted,#555)');
    }

    // ---------- Navigation sequence ----------

    async function goToProduct(medType, category, product, statusEl) {
        try {
            setStatus(statusEl, `Clicking "${medType}"...`);
            const medTypeEl = findByText('#medications-list .btn', medType);
            if (!medTypeEl) throw new Error(`Medication type not found: ${medType}`);
            medTypeEl.click();

            setStatus(statusEl, `Clicking "${category}"...`);
            const catEl = await waitForByText('.med-item', category);
            catEl.click();

            setStatus(statusEl, `Clicking eRx tab...`);
            const tabEl = await waitForByText('.col.text-center.cursor-class > div', 'eRx');
            tabEl.click();

            setStatus(statusEl, `Waiting for "${product}"...`);
            const prodEl = await waitForByText(
                '.filtered-items .cursor-class.text-break.font-weight-bold',
                product
            );
            prodEl.click();

            setStatus(statusEl, `Done: ${product}`, true);
        } catch (err) {
            console.error('[Product Quick Nav]', err);
            setStatus(statusEl, `Failed: ${err.message}`, false, true);
        }
    }

    // ---------- UI ----------

    function buildPanel() {
        const style = document.createElement('style');
        style.textContent = `
            #qn-panel, #qn-panel * {
                box-sizing: border-box;
            }
            #qn-panel {
                position: fixed;
                top: 60px;
                right: 0;
                width: 210px;
                background: #fff;
                border: 1px solid #ccc;
                border-right: none;
                border-radius: 5px 0 0 5px;
                box-shadow: -2px 2px 8px rgba(0,0,0,0.15);
                z-index: 999999;
                font-family: sans-serif;
                font-size: 11px !important;
                line-height: 1.2 !important;
            }
            #qn-header {
                padding: 5px 8px !important;
                background: var(--ds-surface2,#2c3e50);
                color: var(--ds-text,#fff);
                font-weight: bold;
                font-size: 11.5px !important;
                border-radius: 5px 0 0 0;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 4px;
            }
            #qn-search-wrap {
                padding: 5px !important;
                border-bottom: 1px solid #eee;
                position: relative;
            }
            #qn-search {
                width: 100%;
                box-sizing: border-box;
                padding: 4px 6px !important;
                font-size: 11px !important;
                border: 1px solid #ccc;
                border-radius: 3px;
                line-height: 1.2 !important;
            }
            #qn-search-results {
                display: none;
                position: absolute;
                top: 100%;
                left: 5px;
                right: 5px;
                background: #fff;
                border: 1px solid #7fb3ff;
                border-top: none;
                border-radius: 0 0 4px 4px;
                box-shadow: 0 4px 10px rgba(0,0,0,0.15);
                max-height: 260px;
                overflow-y: auto;
                z-index: 1000000;
            }
            #qn-search-results.visible { display: block; }
            #qn-pinned {
                padding: 4px 5px !important;
                border-bottom: 1px solid #eee;
            }
            #qn-pinned-label {
                font-size: 9px !important;
                text-transform: uppercase;
                letter-spacing: 0.3px;
                color: #888;
                padding: 0 1px 2px !important;
            }
            #qn-browse-toggle {
                display: block;
                width: 100%;
                text-align: center;
                padding: 4px !important;
                background: #f4f6f8;
                border: none;
                border-bottom: 1px solid #eee;
                color: var(--ds-text,#2c3e50);
                cursor: pointer;
                font-size: 10px !important;
            }
            #qn-browse-toggle:hover { background: #eaf0f6; }
            #qn-mode {
                font-size: 9px !important;
                font-weight: normal;
                padding: 2px 5px !important;
                border: 1px solid #6b8199;
                border-radius: 3px;
                background: #3b5266;
                color: #fff;
                cursor: pointer;
                line-height: 1.2 !important;
                white-space: nowrap;
            }
            #qn-mode:hover { background: #4a6479; }
            #qn-body {
                padding: 4px;
                display: none;
                max-height: 60vh;
                overflow-y: auto;
            }
            #qn-body.expanded { display: block; }
            .qn-medtype {
                font-weight: bold;
                font-size: 11px !important;
                margin-top: 6px;
                padding: 3px 4px !important;
                background: var(--ds-surface2,#eef2f7);
                border-radius: 3px;
                color: #1a1a1a;
            }
            .qn-cat {
                font-weight: bold;
                margin-top: 5px;
                padding: 1px 3px !important;
                color: var(--ds-text,#2c3e50);
                font-size: 9.5px !important;
                text-transform: uppercase;
                letter-spacing: 0.2px;
            }
            .qn-btn {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 4px;
                width: 100%;
                text-align: left;
                padding: 3px 4px !important;
                margin: 1px 0 !important;
                border: 1px solid #ddd;
                border-radius: 3px;
                background: #f8f8f8;
                cursor: pointer;
                font-size: 10px !important;
                line-height: 1.2 !important;
            }
            .qn-btn:hover { background: #eaf3ff; border-color: #7fb3ff; }
            .qn-btn.qn-btn-pinned { background: #eef7ee; border-color: #bfe3bf; }
            .qn-btn.qn-btn-pinned:hover { background: #dff0df; }
            .qn-btn-label { flex: 1; text-align: left; }
            .qn-count {
                flex: 0 0 auto;
                font-size: 9px !important;
                color: #888;
                background: var(--ds-surface2,#ececec);
                border-radius: 8px;
                padding: 0 4px !important;
                min-width: 16px;
                text-align: center;
            }
            .qn-empty { padding: 3px; color: #999; font-style: italic; font-size: 10px !important; }
            #qn-status {
                padding: 4px 8px !important;
                border-top: 1px solid #eee;
                font-style: italic;
                font-size: 10px !important;
                min-height: 14px;
            }
        `;
        document.head.appendChild(style);

        let mode = loadMode();

        const panel = document.createElement('div');
        panel.id = 'qn-panel';

        const header = document.createElement('div');
        header.id = 'qn-header';
        const headerTitle = document.createElement('span');
        headerTitle.textContent = 'Quick Nav';
        header.appendChild(headerTitle);
        panel.appendChild(header);

        const statusEl = document.createElement('div');
        statusEl.id = 'qn-status';
        statusEl.textContent = 'Ready.';

        function makeButton(entry, counts, pinned) {
            const btn = document.createElement('button');
            btn.className = 'qn-btn' + (pinned ? ' qn-btn-pinned' : '');

            const label = document.createElement('span');
            label.className = 'qn-btn-label';
            label.textContent = entry.product;

            const countEl = document.createElement('span');
            countEl.className = 'qn-count';
            countEl.textContent = counts[entry.product] || 0;

            btn.appendChild(label);
            btn.appendChild(countEl);

            btn.addEventListener('click', () => {
                const n = bumpCount(entry.product);
                countEl.textContent = n;
                goToProduct(entry.medType, entry.category, entry.product, statusEl);
                closeSearchResults();
                collapseBrowse();
                renderPinned();
            });

            return btn;
        }

        // ---- Pinned favorites row (always visible) ----

        const pinnedWrap = document.createElement('div');
        pinnedWrap.id = 'qn-pinned';
        panel.appendChild(pinnedWrap);

        function renderPinned() {
            const counts = loadCounts();
            pinnedWrap.innerHTML = '';
            const label = document.createElement('div');
            label.id = 'qn-pinned-label';
            label.textContent = 'Quick pick';
            pinnedWrap.appendChild(label);
            getPinnedEntries(counts).forEach((entry) => {
                pinnedWrap.appendChild(makeButton(entry, counts, true));
            });
        }

        // ---- Search box + dropdown results (auto-closes after pick) ----

        const searchWrap = document.createElement('div');
        searchWrap.id = 'qn-search-wrap';
        const searchInput = document.createElement('input');
        searchInput.id = 'qn-search';
        searchInput.type = 'text';
        searchInput.placeholder = 'Search (e.g. tesa/ipa, klow)...';
        const searchResults = document.createElement('div');
        searchResults.id = 'qn-search-results';
        searchWrap.appendChild(searchInput);
        searchWrap.appendChild(searchResults);
        panel.appendChild(searchWrap);

        function closeSearchResults() {
            searchResults.classList.remove('visible');
            searchResults.innerHTML = '';
            searchInput.value = '';
        }

        function renderSearchResults(query) {
            const counts = loadCounts();
            const matches = searchCatalog(query).sort((a, b) =>
                (counts[b.product] || 0) - (counts[a.product] || 0) || a.product.localeCompare(b.product)
            );
            searchResults.innerHTML = '';
            if (!matches.length) {
                const empty = document.createElement('div');
                empty.className = 'qn-empty';
                empty.textContent = 'No matches';
                searchResults.appendChild(empty);
            } else {
                matches.forEach((entry) => searchResults.appendChild(makeButton(entry, counts, false)));
            }
            searchResults.classList.add('visible');
        }

        searchInput.addEventListener('input', () => {
            const q = searchInput.value.trim();
            if (!q) {
                closeSearchResults();
                return;
            }
            renderSearchResults(q);
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            const q = searchInput.value.trim();
            if (!q) return;
            const matches = searchCatalog(q);
            if (matches.length === 1) {
                const btn = searchResults.querySelector('.qn-btn');
                if (btn) btn.click();
            }
        });

        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeSearchResults();
        });

        document.addEventListener('click', (e) => {
            if (!searchWrap.contains(e.target)) closeSearchResults();
        });

        // ---- Full catalog browser (hidden by default, toggled on demand) ----

        const browseToggle = document.createElement('button');
        browseToggle.id = 'qn-browse-toggle';
        browseToggle.textContent = 'Browse all ▾';
        panel.appendChild(browseToggle);

        const body = document.createElement('div');
        body.id = 'qn-body';

        function collapseBrowse() {
            body.classList.remove('expanded');
            browseToggle.textContent = 'Browse all ▾';
        }

        function expandBrowse() {
            body.classList.add('expanded');
            browseToggle.textContent = 'Hide ▴';
        }

        browseToggle.addEventListener('click', () => {
            if (body.classList.contains('expanded')) collapseBrowse();
            else { expandBrowse(); renderBrowse(); }
        });

        function renderGrouped(counts) {
            for (const [medType, categories] of Object.entries(CATALOG)) {
                const medGroup = document.createElement('div');
                medGroup.className = 'qn-medtype-group';

                const medLabel = document.createElement('div');
                medLabel.className = 'qn-medtype';
                medLabel.textContent = medType;
                medGroup.appendChild(medLabel);

                for (const [category, products] of Object.entries(categories)) {
                    const catGroup = document.createElement('div');
                    catGroup.className = 'qn-cat-group';

                    const catLabel = document.createElement('div');
                    catLabel.className = 'qn-cat';
                    catLabel.textContent = category;
                    catGroup.appendChild(catLabel);

                    products.forEach((product) => {
                        catGroup.appendChild(makeButton({ medType, category, product }, counts, false));
                    });

                    medGroup.appendChild(catGroup);
                }

                body.appendChild(medGroup);
            }
        }

        function renderMostUsed(counts) {
            const catGroup = document.createElement('div');
            catGroup.className = 'qn-cat-group';
            flatCatalog()
                .sort((a, b) => (counts[b.product] || 0) - (counts[a.product] || 0) || a.product.localeCompare(b.product))
                .forEach((entry) => catGroup.appendChild(makeButton(entry, counts, false)));
            body.appendChild(catGroup);
        }

        function renderBrowse() {
            const counts = loadCounts();
            body.innerHTML = '';

            const modeRow = document.createElement('div');
            modeRow.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:4px;';
            const modeBtn = document.createElement('button');
            modeBtn.id = 'qn-mode';
            modeBtn.textContent = mode === 'used' ? 'Most used' : 'Grouped';
            modeBtn.addEventListener('click', () => {
                mode = mode === 'used' ? 'grouped' : 'used';
                saveMode(mode);
                renderBrowse();
            });
            modeRow.appendChild(modeBtn);
            body.appendChild(modeRow);

            if (mode === 'used') renderMostUsed(counts);
            else renderGrouped(counts);
        }

        panel.appendChild(body);
        panel.appendChild(statusEl);
        document.body.appendChild(panel);

        renderPinned();
    }

    //autoSkipQuestionnaire();
    buildPanel();
})();
