// ==UserScript==
// @name         Zoho CRM Context Extractor
// @namespace    https://drjonesdc.com/
// @version      2.9.12
// @author       Jeyson Dagondon
// @run-at       document-idle
// @description  One-click Zoho context extractor: Notes, Care Plans, Comm Logs, Attachments
// @match        https://crm.zoho.com/crm/org*/tab/Contacts/*
// @match        https://crm.zoho.com/crm/org*/EntityInfo.do?module=Contacts*
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[ZCtx v2.9.12] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['ZCtx'] = {
  name: 'Zoho CRM Context Extractor',
  version: '2.9.12',
  state: 'idle',
  message: '',
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

    // ─── STATE & CONFIG ───────────────────────────────────────────────────────────

    // Load persisted settings or fallback to defaults
    const DEFAULT_CONFIG = {
        format: 'xml', // 'xml' or 'json' (XML default — Jeyson 2026-08-20: reads better for AI)
        action: 'copy' // 'copy' or 'download'
    };

    const CONFIG = {
        format: GM_getValue('cx_format', DEFAULT_CONFIG.format),
        action: GM_getValue('cx_action', DEFAULT_CONFIG.action)
    };

    // ─── SECTION SELECTOR ─────────────────────────────────────────────────────
    // The extractor can be told which related blocks to pull. Checkbox state
    // persists in GM storage (cx_sections) and is honored by BOTH preload and
    // extraction, so unchecked blocks are never fetched (no over-extraction).
    // mountCheck is the DOM signal that the block actually mounted; preload
    // waits for it so extraction never runs blind.
    const SECTIONS = [
        { id: 'notes', label: 'Notes', preloadLabel: 'Notes', mountCheck: null },
        { id: 'carePlans', label: 'Care Plans', preloadLabel: 'Care Plan', mountCheck: () => !!document.querySelector('crm-related-list-view-header[related-module="CustomModule32"]') },
        { id: 'commLogs', label: 'Communication Logs', preloadLabel: 'Communication Log', mountCheck: () => !!document.querySelector('crm-related-list-view-header[related-module="CustomModule27"]') },
        { id: 'sms', label: 'SMS History', preloadLabel: 'RC SMS History', mountCheck: () => !!document.querySelector('crm-related-list-view-header[related-module="CustomModule75"]') },
        { id: 'weeklyMeasurements', label: 'Weekly Measurements', preloadLabel: 'Weekly Measurements', mountCheck: () => !!document.querySelector('crm-related-list-view-header[related-module="CustomModule42"]') },
        { id: 'attachments', label: 'Attachments', preloadLabel: 'Attachments', mountCheck: () => !!document.querySelector('span[id^="attach_"]') },
        { id: 'openActivities', label: 'Open Activities', preloadLabel: 'Open Activities', mountCheck: () => !!document.querySelector('crm-activity-rel-wrapper#Activities crm-activity-rel-list') },
        { id: 'closedActivities', label: 'Closed Activities', preloadLabel: 'Closed Activities', mountCheck: () => !!document.querySelector('crm-activity-rel-wrapper#Activities_History crm-activity-rel-list') }
    ];

    // Loaded from storage; unknown keys default to on. `saved[id] !== false`
    // means an explicitly-stored false stays off, anything else stays on.
    let selectedSections = (() => {
        const out = {};
        let saved = {};
        try { saved = JSON.parse(GM_getValue('cx_sections', '{}') || '{}') || {}; } catch (e) { saved = {}; }
        SECTIONS.forEach(s => { out[s.id] = saved[s.id] !== false; });
        return out;
    })();

    function saveSelectedSections() {
        GM_setValue('cx_sections', JSON.stringify(selectedSections));
    }

    // Cancellation state — set true to abort an in-progress extraction mid-run.
    let cancelled = false;
    let sleepTimer = null;
    let sleepResolve = null;

    // Helper to save config changes
    function updateConfig(key, value) {
        CONFIG[key] = value;
        GM_setValue(`cx_${key}`, value);
    }

    // ─── STYLES ───────────────────────────────────────────────────────────────────

    GM_addStyle(`
        /* Inline Toolbar Button */
        #cx-extractor-toolbar-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            padding: 0 12px;
            height: 28px;
            font-size: 13px;
            font-weight: 700;
            color: #fff;
            background: #1b2a4a;
            white-space: nowrap;
            border-radius: 4px;
            margin: 0 2px;
            transition: background 0.15s, color 0.15s;
        }
        #cx-extractor-toolbar-btn:hover { background: #2c3e62; }
        #cx-extractor-toolbar-btn.cx-working { color: #fff; background: #5a6a8a; cursor: pointer; }
        #cx-extractor-toolbar-btn.cx-working:hover { background: var(--ds-danger,#8b1a1a); color: #fff; }

        /* Settings Menu */
        #cx-settings-menu {
            background: #fff;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 10px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            display: none;
            flex-direction: column;
            gap: 8px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 13px;
            color: #333;
            min-width: 160px;
            position: fixed;
            z-index: 99999;
        }
        #cx-settings-menu.visible { display: flex; }
        .cx-menu-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            padding: 6px 8px;
            border-radius: 4px;
        }
        .cx-menu-item:hover { background: var(--ds-surface2,#f0f0f0); }
        .cx-menu-label { font-weight: 500; }
        .cx-menu-value { color: #666; font-size: 12px; }

        /* Toast */
        #cx-toast {
            position: fixed;
            bottom: 100px;
            right: 20px;
            z-index: 99999;
            background: var(--ds-surface,#1b2a4a);
            color: var(--ds-text,#fff);
            padding: 10px 16px;
            border-radius: 8px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 13px;
            font-weight: 500;
            box-shadow: 0 4px 16px rgba(0,0,0,0.25);
            opacity: 0;
            transform: translateY(8px);
            transition: opacity 0.2s ease, transform 0.2s ease;
            pointer-events: none;
            white-space: pre-line; /* Allow line breaks in toast if needed */
        }
        #cx-toast.cx-show { opacity: 1; transform: translateY(0); }
        #cx-toast.cx-error { background: var(--ds-danger,#8b1a1a); }
        #cx-toast.cx-success { background: var(--ds-success,#0e6b46); }
    `);

    // ─── UI SETUP ─────────────────────────────────────────────────────────────────

    // Toolbar button — injected into Zoho's bottom bar
    function injectToolbarButton() {
        const bar = document.querySelector('#chatBarIconList');
        if (!bar) return setTimeout(injectToolbarButton, 500);

        const td = document.createElement('td');
        td.innerHTML = '<div id="cx-extractor-toolbar-btn" title="Extract Profile (Right-click for options)"><strong>Extract Profile</strong></div>';

        const toggle = td.querySelector('#cx-extractor-toolbar-btn');
        toggle.addEventListener('click', () => {
            if (settingsMenu.classList.contains('visible')) {
                closeMenu();
            } else if (isRunning) {
                // Already extracting — a second press cancels at the next checkpoint.
                cancelExtraction();
            } else {
                // Always ask which sections to extract (remembered via checkboxes).
                showSectionPopup();
            }
        });
        toggle.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const rect = toggle.getBoundingClientRect();
            settingsMenu.style.top = (rect.top - 10) + 'px';
            settingsMenu.style.left = (rect.left - 160) + 'px';
            showMenu();
            menuTimeout = setTimeout(closeMenu, 4000);
        });

        // Append at the rightmost end of the toolbar
        bar.appendChild(td);
    }

    // Settings Menu — now positioned absolutely, anchored near the toolbar button
    const settingsMenu = document.createElement('div');
    settingsMenu.id = 'cx-settings-menu';
    document.body.appendChild(settingsMenu);

    // ─── SECTION SELECTOR POPUP ────────────────────────────────────────────────
    // Checkbox list anchored just above the toolbar button; shown on every
    // Extract click so the user picks what to pull (state is remembered).
    const sectionPopup = document.createElement('div');
    sectionPopup.id = 'cx-section-popup';
    sectionPopup.style.cssText = 'display:none;position:fixed;z-index:99999;background:#fff;border:1px solid #ddd;border-radius:8px;padding:10px 12px;box-shadow:0 4px 16px rgba(0,0,0,0.2);font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;font-size:13px;color:#333;min-width:240px;';
    document.body.appendChild(sectionPopup);

    function positionSectionPopup(btnRect) {
        sectionPopup.style.left = 'auto';
        sectionPopup.style.top = 'auto';
        sectionPopup.style.right = (window.innerWidth - btnRect.right + 2) + 'px';
        sectionPopup.style.bottom = (window.innerHeight - btnRect.top + 10) + 'px';
    }

    // Segmented picker row for the section popup — Format (XML/JSON) and
    // Action (Copy/Download), shown after the section checkboxes so the run
    // can be shaped in one place (Jeyson 2026-08-20). Persists via
    // updateConfig; the right-click menu's readouts stay in sync.
    function makeSegmentedRow(label, configKey, options) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12px;';
        const lab = document.createElement('span');
        lab.textContent = label;
        lab.style.cssText = 'color:#666;font-weight:600;';
        row.appendChild(lab);

        const btns = options.map(([value, text]) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = text;
            b.style.cssText = 'padding:3px 10px;border:1px solid #ccc;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;color:#333;';
            b.addEventListener('click', () => {
                updateConfig(configKey, value);
                paintAll();
                const fmtEl = document.getElementById('cx-display-format');
                if (fmtEl) fmtEl.textContent = CONFIG.format.toUpperCase();
                const actEl = document.getElementById('cx-display-action');
                if (actEl) actEl.textContent = CONFIG.action.charAt(0).toUpperCase() + CONFIG.action.slice(1);
            });
            row.appendChild(b);
            return b;
        });
        const paintAll = () => {
            btns.forEach((b, i) => {
                const active = CONFIG[configKey] === options[i][0];
                b.style.background = active ? '#1b2a4a' : '#fff';
                b.style.color = active ? '#fff' : '#333';
                b.style.borderColor = active ? '#1b2a4a' : '#ccc';
                b.style.fontWeight = active ? '600' : '400';
            });
        };
        paintAll();
        return row;
    }

    function buildSectionPopup() {
        sectionPopup.innerHTML = '';
        const title = document.createElement('div');
        title.textContent = 'Extract sections';
        title.style.cssText = 'font-weight:700;margin-bottom:6px;font-size:13px;';
        sectionPopup.appendChild(title);

        SECTIONS.forEach(s => {
            const row = document.createElement('label');
            row.style.cssText = 'display:flex;align-items:center;gap:7px;padding:3px 0;cursor:pointer;user-select:none;';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.checked = selectedSections[s.id];
            cb.addEventListener('change', () => {
                selectedSections[s.id] = cb.checked;
                saveSelectedSections();
            });
            row.appendChild(cb);
            row.appendChild(document.createTextNode(s.label));
            sectionPopup.appendChild(row);
        });

        // Format + Action pickers, right after the checkboxes (2026-08-20).
        const sep = document.createElement('div');
        sep.style.cssText = 'border-top:1px solid #eee;margin:8px 0 2px;';
        sectionPopup.appendChild(sep);
        sectionPopup.appendChild(makeSegmentedRow('Format', 'format', [['xml', 'XML'], ['json', 'JSON']]));
        sectionPopup.appendChild(makeSegmentedRow('Action', 'action', [['copy', '📋 Copy'], ['download', '💾 Download']]));

        const btnRow = document.createElement('div');
        btnRow.style.cssText = 'display:flex;gap:6px;justify-content:flex-end;margin-top:8px;';
        const cancelBtn = document.createElement('button');
        cancelBtn.textContent = 'Cancel';
        cancelBtn.style.cssText = 'padding:4px 12px;border:1px solid #ccc;border-radius:4px;background:#fff;cursor:pointer;font-size:12px;';
        cancelBtn.onclick = () => { sectionPopup.style.display = 'none'; };
        const runBtn = document.createElement('button');
        runBtn.textContent = 'Extract';
        runBtn.style.cssText = 'padding:4px 16px;border:0;border-radius:4px;background:#1b2a4a;color:#fff;cursor:pointer;font-size:12px;font-weight:600;';
        runBtn.onclick = () => { sectionPopup.style.display = 'none'; runExtraction(); };
        btnRow.appendChild(cancelBtn);
        btnRow.appendChild(runBtn);
        sectionPopup.appendChild(btnRow);
    }

    function showSectionPopup() {
        closeMenu();
        buildSectionPopup();
        const btn = document.getElementById('cx-extractor-toolbar-btn');
        if (btn) positionSectionPopup(btn.getBoundingClientRect());
        sectionPopup.style.display = 'block';
    }

    // Format Selector
    const formatItem = document.createElement('div');
    formatItem.className = 'cx-menu-item';
    formatItem.innerHTML = `
        <span class="cx-menu-label">Format</span>
        <span class="cx-menu-value" id="cx-display-format">${CONFIG.format.toUpperCase()}</span>
    `;
    formatItem.onclick = () => {
        const newFormat = CONFIG.format === 'xml' ? 'json' : 'xml';
        updateConfig('format', newFormat);
        document.getElementById('cx-display-format').textContent = newFormat.toUpperCase();
        closeMenu();
    };
    settingsMenu.appendChild(formatItem);

    // Action Selector
    const actionItem = document.createElement('div');
    actionItem.className = 'cx-menu-item';
    actionItem.innerHTML = `
        <span class="cx-menu-label">Action</span>
        <span class="cx-menu-value" id="cx-display-action">${CONFIG.action.charAt(0).toUpperCase() + CONFIG.action.slice(1)}</span>
    `;
    actionItem.onclick = () => {
        const newAction = CONFIG.action === 'copy' ? 'download' : 'copy';
        updateConfig('action', newAction);
        document.getElementById('cx-display-action').textContent = newAction.charAt(0).toUpperCase() + newAction.slice(1);
        closeMenu();
    };
    settingsMenu.appendChild(actionItem);

    // Attachment batch download (see ATTACHMENT DOWNLOAD ORCHESTRATION section)
    const downloadAttachItem = document.createElement('div');
    downloadAttachItem.className = 'cx-menu-item';
    downloadAttachItem.innerHTML = `<span class="cx-menu-label">Download Attachments</span>`;
    downloadAttachItem.onclick = () => {
        closeMenu();
        downloadAllAttachments();
    };
    settingsMenu.appendChild(downloadAttachItem);

    const toast = document.createElement('div');
    toast.id = 'cx-toast';
    document.body.appendChild(toast);

    let toastTimer = null;
    let menuTimeout = null;

    function showToast(msg, type = 'success', duration = 5000) {
        toast.textContent = msg;
        toast.className = `cx-show cx-${type}`;
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toast.className = ''; }, duration);
    }

    function showMenu() {
        settingsMenu.classList.add('visible');
        clearTimeout(menuTimeout);
    }

    function closeMenu() {
        settingsMenu.classList.remove('visible');
    }

    // Close menu if clicking outside. NOTE: a real click on the toolbar button
    // lands on its inner <strong> (e.target has no id), so match the button by
    // closest(), never by e.target.id — otherwise the popup is shown by the
    // button handler and instantly hidden by this outside-click handler.
    document.addEventListener('click', (e) => {
        const onToolbarBtn = !!(e.target.closest && e.target.closest('#cx-extractor-toolbar-btn'));
        if (!settingsMenu.contains(e.target) && !onToolbarBtn) closeMenu();
        if (!sectionPopup.contains(e.target) && !onToolbarBtn) {
            sectionPopup.style.display = 'none';
        }
    });

    // ─── HELPERS ──────────────────────────────────────────────────────────────────

    function sleep(ms) {
        return new Promise(resolve => {
            if (cancelled) return resolve();
            sleepResolve = resolve;
            sleepTimer = setTimeout(() => {
                sleepTimer = null;
                sleepResolve = null;
                resolve();
            }, ms);
        });
    }

    function escapeXml(str) {
        if (!str) return '';
        return str
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function getPatientName() {
        // Try standard header selectors first
        const headerName = document.querySelector('.entityNameContent, .cxEntityHeaderTitle, [data-zcqa="entityName"]');
        if (headerName) {
            const text = headerName.textContent.trim();
            if (text) return text;
        }
        // Fallback to note link title
        const noteLink = document.querySelector('a.cxNotesModuleRecordName');
        if (noteLink) return noteLink.getAttribute('lt-prop-title') || noteLink.textContent.trim();
        // Fallback to page title parsing
        const match = document.title.match(/^(.+?)\s*[-–|]/);
        return match ? match[1].trim() : 'Unknown Patient';
    }

    // ─── NOTES ────────────────────────────────────────────────────────────────────

    async function expandNotes() {
        // Step 1: load all notes (not just the latest few).
        const viewPrev = document.querySelector('.cxShowMoreNotes');
        if (viewPrev && viewPrev.offsetParent !== null) {
            viewPrev.click();
            await sleep(1500);
        }

        // Step 2: expand every truncated note. The "see more" toggle only exists on
        // notes long enough to be clamped, and clicking re-renders the note, so we
        // re-query in a loop until no expandable toggles remain (or we hit a guard).
        // A single querySelectorAll pass misses notes whose toggles mount late.
        let guard = 0;
        while (guard < 15) {
            if (cancelled) return;
            const toggles = [...document.querySelectorAll('span.cruxNoteSeeMore')]
                // Only the "show more" direction; skip "show less" so we don't collapse
                // what we just expanded and loop forever.
                .filter(el => {
                    const t = (el.textContent || '').toLowerCase();
                    return t.includes('more') || (!t.includes('less') && el.offsetParent !== null);
                });
            if (toggles.length === 0) break;
            for (const btn of toggles) {
                btn.click();
                await sleep(250);
            }
            await sleep(300);
            guard++;
        }
    }

    function extractNotes() {
        const notes = [];
        document.querySelectorAll('li.cxNotesLi').forEach(li => {
            const titleEl = li.querySelector('lyte-text.cxNoteTitleSpan');
            const title = titleEl ? titleEl.getAttribute('lt-prop-value') || '' : '';
            const contentEl = li.querySelector('div.cxNotesAddedContent');
            let content = '';
            if (contentEl) {
                content = contentEl.innerText
                    // Strip the inline toggle words in either direction, wherever they land.
                    .replace(/\s*Show More\s*$/i, '')
                    .replace(/\s*Show Less\s*$/i, '')
                    .replace(/\s*Show More\s*/gi, ' ')
                    .replace(/\s*Show Less\s*/gi, ' ')
                    .trim();
            }
            const dateEl = li.querySelector('span.cxNotesModifiedTimeInfo');
            const date = dateEl ? dateEl.getAttribute('data-title') || '' : '';
            const authorEl = li.querySelector('span.cxNotesModifiedName');
            const author = authorEl ? authorEl.getAttribute('data-title') || '' : '';
            if (content || title) notes.push({ title, date, author, content });
        });
        return notes;
    }

    // ─── RELATED LIST TABLE ───────────────────────────────────────────────────────

    function extractCellValue(td) {
        const textarea = td.querySelector('crux-text-area-component');
        if (textarea) return textarea.getAttribute('cx-prop-value') || '';
        const lookup = td.querySelector('crux-lookup-component');
        if (lookup) return lookup.getAttribute('cx-prop-value') || '';
        const user = td.querySelector('crux-user-component');
        if (user) return user.getAttribute('name') || '';
        const lyteText = td.querySelector('lyte-text');
        if (lyteText) return lyteText.getAttribute('lt-prop-value') || '';
        return td.innerText.trim();
    }

    function extractRelatedListTable(relatedModule) {
        const container = document.querySelector(`crm-related-list-view-header[related-module="${relatedModule}"]`);
        if (!container) return [];

        const headerCells = container.querySelectorAll('lyte-thead lyte-tr:first-child lyte-th');
        const columns = [];
        headerCells.forEach(th => {
            const zcqa = th.getAttribute('data-zcqa') || '';
            if (zcqa) columns.push({
                key: zcqa.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''),
                index: columns.length
            });
        });

        const records = [];
        container.querySelectorAll('lyte-tbody lyte-tr').forEach(tr => {
            const cells = tr.querySelectorAll('lyte-td');
            const record = {};
            let hasData = false;
            let dataIndex = 0;
            cells.forEach(td => {
                const zcqa = td.getAttribute('data-zcqa') || '';
                if (zcqa.includes('undefined') || td.classList.contains('editDeleteIcons')) return;
                if (dataIndex < columns.length) {
                    const val = extractCellValue(td);
                    if (val) { record[columns[dataIndex].key] = val; hasData = true; }
                    dataIndex++;
                }
            });
            if (hasData) records.push(record);
        });

        return records;
    }

    // ─── RC SMS HISTORY (paginated) ────────────────────────────────────────────────

    // The SMS module (CustomModule75) renders as a normal related-list table but is
    // paginated 10 rows at a time. The nav buttons live in a .lyteNavigator whose
    // prev/next carry data-zcqa="<relatedListId>_rellist_navig_prev|next". We find the
    // related list id from the left-panel label wrapper, then walk pages forward until
    // next is disabled (lyteDisabled) or missing, collecting rows as we go.

    const SMS_MODULE = 'CustomModule75';
    const SMS_LABEL  = 'RC SMS History';

    function getRelatedListId(displayLabel) {
        const wrapper = document.querySelector(
            `crm-related-list-label[display-label="${displayLabel}"]`
        );
        if (!wrapper) return null;
        const id = wrapper.getAttribute('id') || '';
        return id.replace(/^rl_/, '') || null;
    }

    function getNavButton(relatedListId, dir) {
        if (!relatedListId) return null;
        return document.querySelector(
            `[data-zcqa="${relatedListId}_rellist_navig_${dir}"]`
        );
    }

    function isNavDisabled(btn) {
        if (!btn) return true;
        return btn.classList.contains('lyteDisabled') ||
               btn.getAttribute('aria-disabled') === 'true';
    }

    // Signature of the currently rendered page, used to detect that the click actually
    // swapped the rows in rather than just re-rendering the same ones.
    function smsPageSignature() {
        const container = document.querySelector(
            `crm-related-list-view-header[related-module="${SMS_MODULE}"]`
        );
        if (!container) return '';
        return [...container.querySelectorAll('lyte-tbody lyte-tr')]
            .map(tr => tr.getAttribute('id') || '')
            .join('|');
    }

    async function waitForSmsPageChange(prevSig, timeout = 6000, interval = 200) {
        const start = Date.now();
        while (Date.now() - start < timeout) {
            const sig = smsPageSignature();
            if (sig && sig !== prevSig) return true;
            await sleep(interval);
        }
        return false;
    }

    // Rewind to page 1 before collecting, in case a previous run or the user left the
    // list mid-pagination. Some navigator layouts never mark the disabled button
    // (no lyteDisabled/aria-disabled on the first page) — a prev click that doesn't
    // swap rows means we're already at the start, so two consecutive no-change
    // rounds stop the walk instead of spinning the full guard.
    async function rewindSmsPagination(relatedListId) {
        let guard = 0;
        let noChangeRounds = 0;
        while (guard < 200) {
            if (cancelled) break;
            const prev = getNavButton(relatedListId, 'prev');
            if (isNavDisabled(prev)) break;
            const sig = smsPageSignature();
            prev.click();
            const changed = await waitForSmsPageChange(sig);
            if (!changed) {
                noChangeRounds++;
                if (noChangeRounds >= 2) break;
            } else {
                noChangeRounds = 0;
            }
            guard++;
        }
    }

    async function extractSmsHistory() {
        const relatedListId = getRelatedListId(SMS_LABEL);
        if (!relatedListId) return [];
        if (!document.querySelector(`crm-related-list-view-header[related-module="${SMS_MODULE}"]`)) {
            return [];
        }

        await rewindSmsPagination(relatedListId);

        const seen = new Set();
        const messages = [];
        let guard = 0;

        while (guard < 50) {
            if (cancelled) return messages;
            const container = document.querySelector(
                `crm-related-list-view-header[related-module="${SMS_MODULE}"]`
            );
            if (!container) break;

            container.querySelectorAll('lyte-tbody lyte-tr').forEach(tr => {
                const rowId = tr.getAttribute('id') || '';
                if (rowId && seen.has(rowId)) return;
                if (rowId) seen.add(rowId);

                const rec = {};
                tr.querySelectorAll('lyte-td').forEach(td => {
                    const zcqa = td.getAttribute('data-zcqa') || '';
                    if (!zcqa.startsWith('value_listviewtable_')) return;
                    const label = zcqa.replace('value_listviewtable_', '');
                    if (!label || label === 'undefined') return;
                    if (td.classList.contains('editDeleteIcons')) return;

                    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
                    const val = extractCellValue(td);
                    if (val) rec[key] = val;
                });

                // Only keep rows that actually carry a message body.
                if (rec.message) messages.push(rec);
            });

            const next = getNavButton(relatedListId, 'next');
            if (isNavDisabled(next)) break;

            const sig = smsPageSignature();
            next.click();
            const changed = await waitForSmsPageChange(sig);
            if (!changed) break;

            // Some navigator layouts never disable the next button — clicking past
            // the last page wraps back to already-seen pages. If the freshly loaded
            // page's rows are all already collected, the walk has cycled: stop.
            const pageIds = [...container.querySelectorAll('lyte-tbody lyte-tr')]
                .map(tr => tr.getAttribute('id') || '');
            if (pageIds.length > 0 && pageIds.every(id => seen.has(id))) break;
            guard++;
        }

        // Oldest first reads better as a conversation transcript.
        // Paginated pages don't come back in a globally sorted order, so reversing the
        // collection order isn't enough — timestamps zigzag within each page. Sort on
        // created_time explicitly. formatted_time is unreliable on a chunk of records
        // (workflow-written date-only values render as ~07:00 AM), so it's a fallback
        // only.
        messages.sort((a, b) => {
            const ta = Date.parse(a.created_time || a.formatted_time || '') || 0;
            const tb = Date.parse(b.created_time || b.formatted_time || '') || 0;
            return ta - tb;
        });
        return messages;
    }

    // ─── PAGE-LEVEL PRELOAD (click-based navigation) ───────────────────────────────

    // Zoho's detail view does NOT render all related lists in one scrollable column.
    // Each related list is mounted on demand when its left-panel item is clicked
    // (click handler: crm-related-list-label => scrollToRelatedView(...)). Scrolling
    // the page does nothing for blocks that haven't been navigated to. So instead we
    // click each left-panel item to force it to mount, wait for it to render, then
    // later read it.
    //
    // We target items by the display-label on their <crm-related-list-label> wrapper,
    // which is stable across records (the numeric IDs are not).
    const RL_LABELS_TO_PRELOAD = [
        'Notes',
        'Care Plan',
        'Communication Log',
        'RC SMS History',
        'Open Activities',
        'Closed Activities',
        'Attachments',
        'Weekly Measurements'
    ];

    function findLeftPanelItem(displayLabel) {
        const wrapper = document.querySelector(
            `crm-related-list-label[display-label="${displayLabel}"]`
        );
        if (!wrapper) return null;
        // The clickable row is the <li> inside, which carries the scrollToRelatedView handler.
        return wrapper.querySelector('li[click*="scrollToRelatedView"]') || wrapper.querySelector('li');
    }

    // Mount check per preload label: does the block's actual content exist in the DOM?
    // Sections without a mountCheck (Notes) are treated as always mounted.
    function isListMounted(displayLabel) {
        const section = SECTIONS.find(s => s.preloadLabel === displayLabel);
        return section && section.mountCheck ? section.mountCheck() : true;
    }

    // Click a left-panel item and wait until its block actually mounts. Zoho
    // lazy-mounts related lists on scroll and can take 6-10s+ on a fresh record,
    // and a click too early in the page's life can be a silent no-op — so poll
    // for the mount (re-clicking every 5s) up to a 15s cap. Never stalls the
    // run: a block that won't mount just yields [] at extraction time.
    async function mountRelatedList(displayLabel) {
        const item = findLeftPanelItem(displayLabel);
        if (!item) return;
        const start = Date.now();
        let attempts = 0;
        while (Date.now() - start < 15000) {
            if (cancelled) return;
            if (isListMounted(displayLabel)) return;
            if (attempts === 0 || Date.now() - start > attempts * 5000) {
                item.click();
                attempts++;
            }
            await sleep(500);
        }
    }

    async function preloadRelatedLists() {
        for (const label of RL_LABELS_TO_PRELOAD) {
            if (cancelled) return;
            const section = SECTIONS.find(s => s.preloadLabel === label);
            if (section && !selectedSections[section.id]) continue; // skipped section: never fetch
            await mountRelatedList(label);
        }
        // Return to the top of the detail view so notes-expand etc. operate cleanly.
        const topBtn = document.querySelector('#dvScrollTopDiv');
        if (topBtn && topBtn.offsetParent !== null) {
            topBtn.click();
            await sleep(500);
        }
    }

    // ─── ACTIVITIES (OPEN + CLOSED) ────────────────────────────────────────────────

    // Each activity column lazy-loads on scroll. Scroll the inner <ul> to the bottom
    // repeatedly until the rendered <li> count stops growing, so nothing is truncated.
    async function exhaustColumnScroll(ul) {
        if (!ul) return;
        let lastCount = -1;
        let stablePasses = 0;
        let guard = 0;

        // Cap iterations so a misbehaving column can never hang the whole run.
        while (stablePasses < 2 && guard < 60) {
            if (cancelled) break;
            const count = ul.querySelectorAll('li.actColumnListEle').length;
            if (count === lastCount) {
                stablePasses++;
            } else {
                stablePasses = 0;
                lastCount = count;
            }
            ul.scrollTop = ul.scrollHeight;
            await sleep(350);
            guard++;
        }
        // Reset scroll so the UI isn't left in a weird state.
        ul.scrollTop = 0;
    }

    // Pull every field out of a single activity <li>. The subject + date + owner are
    // common to all types; events carry extra labelled fields (Appointment Profile,
    // Status, Location, Territory). Closed records carry a "Closed Time". We read the
    // labelled rows generically so we don't care which type it is.
    function extractActivityRecord(li, status, type) {
        const record = { status, type };

        const subjectLink = li.querySelector('.actSubject a.link, .actSubject link-to a');
        if (subjectLink) {
            record.subject = subjectLink.textContent.trim().replace(/\s+/g, ' ');
        }

        const dateEl = li.querySelector('.date_time');
        if (dateEl) {
            // Grab the first .date_time only (the primary date row); labelled rows below
            // also use .date_time but are handled separately via their labels.
            record.date = dateEl.textContent.trim().replace(/\s+/g, ' ');
        }

        const ownerEl = li.querySelector('.jobSheetLevel .ellipsistext, [id*="_owner"] .ellipsistext');
        if (ownerEl) {
            record.owner = ownerEl.textContent.trim();
        }

        // Labelled extra rows (events + closed time). Structure:
        //   <span class="actSplitLabel">Appointment Profile</span> : <... actSplitValue>VALUE</...>
        li.querySelectorAll('.actSplitLabel').forEach(labelEl => {
            const label = labelEl.textContent.trim();
            if (!label) return;
            const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

            const row = labelEl.closest('div');
            let value = '';
            if (row) {
                // Prefer the canvas component's full value (never visually truncated).
                const crux = row.querySelector('crux-text-component');
                if (crux && crux.getAttribute('cx-prop-value')) {
                    value = crux.getAttribute('cx-prop-value');
                } else {
                    const valEl = row.querySelector('.actSplitValue');
                    if (valEl) value = valEl.textContent.trim().replace(/\s+/g, ' ');
                }
            }
            if (value && value !== '-') record[key] = value;
        });

        return record;
    }

    // Walk one wrapper ("Activities" = open, "Activities_History" = closed). Inside it
    // there are up to three columns (Tasks / Events / Calls). Scroll each to exhaustion
    // first, then read every <li>.
    async function extractActivitiesWrapper(wrapperId, status) {
        const wrapper = document.querySelector(`crm-activity-rel-wrapper#${wrapperId}`);
        if (!wrapper) return [];

        const records = [];
        const lists = wrapper.querySelectorAll('crm-activity-rel-list');

        for (const list of lists) {
            const module = list.getAttribute('module') || ''; // Tasks | Events | Calls
            const ul = list.querySelector('ul.actColumnList');

            await exhaustColumnScroll(ul);

            list.querySelectorAll('li.actColumnListEle').forEach(li => {
                // Skip the "No records found" placeholder rows.
                if (li.querySelector('.crmNotFoundColor')) return;
                if (!li.querySelector('.actSubject')) return;
                records.push(extractActivityRecord(li, status, module));
            });
        }

        return records;
    }

    async function extractActivities() {
        const open   = selectedSections.openActivities ? await extractActivitiesWrapper('Activities', 'open') : [];
        const closed = selectedSections.closedActivities ? await extractActivitiesWrapper('Activities_History', 'closed') : [];
        return { open, closed };
    }

    // ─── ATTACHMENTS ────────────────────────────────────────────────────────────────
    //
    // Metadata extraction (file name / attached by / date / size) is straightforward —
    // it's just rendered DOM text, same as every other related list here. Getting the
    // actual FILE BYTES is a different problem: the name span's click handler
    // (attachNameClick) is Zoho's own internal code, and its data-lytecbox-href /
    // data-lytecbox-dlink attributes are empty in the raw markup — meaning Zoho fills
    // them in (or opens a tab, or fires a request) only at click time. That mechanism
    // is not something to guess at; see probeAttachmentDownloadUrls() below, which is
    // a one-time diagnostic to find out what actually happens before any batch
    // downloader gets built against it.
    //
    // v2.8.1 correction: originally looked the table up by the tbody id seen in one
    // capture ("lvTred") with a related-module="Attachments" fallback. Live testing
    // showed that id isn't Attachments-specific — Zoho appears to reuse generic
    // list-view table ids across whatever related list is currently mounted, so this
    // silently matched the wrong table (0 rows found even though the record had
    // attachments). The one thing that IS unique to Attachments is the clickable name
    // span's id, always "attach_<recordId>" — anchor off that directly instead of any
    // container id or module name guess.

    function findAttachmentSpans() {
        return [...document.querySelectorAll('span[id^="attach_"]')];
    }

    function extractAttachments() {
        const records = [];
        findAttachmentSpans().forEach(span => {
            const tr = span.closest('lyte-tr');
            if (!tr) return;

            const nameCell = tr.querySelector('lyte-td[data-zcqa="value_listviewtable_File Name"]');
            // The real filename lives on the inner span's lt-prop-title, which stays
            // intact even when the visible label is ellipsis-truncated. innerText is
            // the fallback if Zoho ever changes this markup.
            let fileName = '';
            if (nameCell) {
                const titleSpan = nameCell.querySelector('span[lt-prop-title]');
                fileName = (titleSpan && titleSpan.getAttribute('lt-prop-title')) || nameCell.innerText.trim();
            }
            if (!fileName) return; // skip rows we can't identify

            const attachedByCell = tr.querySelector('lyte-td[data-zcqa="value_listviewtable_Attached By"]');
            const userComp = attachedByCell && attachedByCell.querySelector('crux-user-component');
            const attachedBy = (userComp && userComp.getAttribute('name')) ||
                (attachedByCell ? attachedByCell.innerText.trim() : '');

            const dateCell = tr.querySelector('lyte-td[data-zcqa="value_listviewtable_Date Added"]');
            const dateAdded = dateCell ? dateCell.innerText.trim() : '';

            const sizeCell = tr.querySelector('lyte-td[data-zcqa="value_listviewtable_Size"]');
            const sizeText = sizeCell ? sizeCell.innerText.trim() : '';

            records.push({
                record_id: tr.getAttribute('id') || '',
                file_name: fileName,
                attached_by: attachedBy,
                date_added: dateAdded,
                size: (sizeText && sizeText !== '-') ? sizeText : ''
            });
        });
        return records;
    }

    // ─── ATTACHMENT DOWNLOAD PROBE (diagnostic only — does not download anything) ──
    //
    // Clicks each attachment's name span (the thing attachNameClick is bound to) and
    // reports, per attachment, whatever shows up in three places a real download URL
    // could appear:
    //   1. The span's own data-lytecbox-href / data-lytecbox-dlink attrs, in case
    //      Zoho sets them post-click, right before opening its lightbox
    //   2. Any window.open(url) call made during the click (temporarily wrapped)
    //   3. Any outgoing fetch()/XHR request (fetch temporarily wrapped; XHR isn't
    //      wrapped here since Zoho's stack leans on fetch for most internal calls,
    //      but check the browser Network tab too if this comes back empty)
    // Run this once via the right-click menu, then check the browser console for
    // "[Attachment Probe Results]" and send me that output — that's what tells us
    // the real download mechanism to automate.
    async function probeAttachmentDownloadUrls() {
        const spans = findAttachmentSpans();
        if (spans.length === 0) {
            showToast('✗ No attachment rows found', 'error', 4000);
            return;
        }

        showToast(`Probing ${spans.length} attachment(s)...`, 'success', 60000);

        const results = [];

        // Wrap window.open for the duration of the probe.
        const originalOpen = window.open;
        let capturedOpenUrl = null;
        window.open = function (url, ...rest) {
            capturedOpenUrl = url;
            return originalOpen.call(window, url, ...rest);
        };

        // Wrap fetch for the duration of the probe.
        const originalFetch = window.fetch;
        let capturedFetchUrls = [];
        window.fetch = function (input, ...rest) {
            const url = typeof input === 'string' ? input : (input && input.url);
            if (url) capturedFetchUrls.push(url);
            return originalFetch.call(window, input, ...rest);
        };

        for (const span of spans) {
            capturedOpenUrl = null;
            capturedFetchUrls = [];

            const before = {
                href: span.getAttribute('data-lytecbox-href') || '',
                dlink: span.getAttribute('data-lytecbox-dlink') || ''
            };

            span.click();
            await sleep(1500); // give Zoho time to populate attrs / fire requests / open a tab

            const after = {
                href: span.getAttribute('data-lytecbox-href') || '',
                dlink: span.getAttribute('data-lytecbox-dlink') || ''
            };

            results.push({
                name: span.getAttribute('data-lytecbox-title') || '',
                attr_before: before,
                attr_after: after,
                window_open_url: capturedOpenUrl,
                fetch_urls: [...capturedFetchUrls]
            });

            // Best-effort close of whatever lightbox/overlay Zoho may have opened, so
            // the next click starts clean. This selector is a guess at Zoho's close
            // button — if it doesn't match, close it manually between clicks and the
            // probe will just take longer.
            const closeBtn = document.querySelector('.lyteCboxClose, .cboxClose, [data-zcqa="closeIcon"]');
            if (closeBtn && closeBtn.offsetParent !== null) {
                closeBtn.click();
                await sleep(400);
            }
        }

        window.open = originalOpen;
        window.fetch = originalFetch;

        console.log('[Attachment Probe Results]', results);
        showToast(`✓ Probed ${results.length} attachment(s) — check console for URLs`, 'success', 8000);
    }

    // ─── ATTACHMENT DOWNLOAD ORCHESTRATION ─────────────────────────────────────────
    //
    // Two link shapes exist, confirmed by live-probing a real record:
    //   1. Native Zoho attachments — relative /crm/org.../ViewAttachment?... URLs,
    //      same-origin. fetch() with credentials:'include' returns real file bytes
    //      (verified: correct magic bytes, correct size vs. the table's Size column).
    //      These are fetched silently and saved as a Blob — no tab, no manual step.
    //   2. Third-party e-signature/consent docs (seen so far: sendlink.co) — these
    //      reject fetch()/XHR outright (404, reproduced 3x including on an unused
    //      link with credentials omitted), but a genuine browser navigation to the
    //      same URL renders the real file. This isn't a bug to route around: once
    //      content lives on a different origin, our script's JS cannot read it,
    //      fetched or rendered — that's same-origin policy, a hard boundary, not a
    //      gap in this code. The only available automation for these is triggering
    //      the real navigation; whether that becomes an automatic download or an
    //      inline viewer depends on the browser's own PDF handling setting, not on
    //      anything here.
    //
    // CAVEAT: opening several tabs in a loop after an `await` can trip the popup
    // blocker — only window.open() calls still inside the original click's call
    // stack are guaranteed exempt. If only the first external doc opens, allow
    // popups for crm.zoho.com and re-run.
    async function downloadAllAttachments() {
        const spans = findAttachmentSpans();
        if (spans.length === 0) {
            showToast('✗ No attachment rows found', 'error', 4000);
            return;
        }

        showToast(`Downloading ${spans.length} attachment(s)...`, 'success', 60000);

        let nativeCount = 0;
        let externalCount = 0;
        let failCount = 0;

        for (const span of spans) {
            const displayName = span.getAttribute('data-lytecbox-title') || 'attachment';

            // Capture the URL without letting Zoho's own click actually navigate —
            // we decide how to handle it ourselves based on the link shape.
            const originalOpen = window.open;
            let capturedUrl = null;
            window.open = (url) => { capturedUrl = url; return null; };
            span.click();
            await sleep(1200);
            window.open = originalOpen;

            // Close whatever overlay Zoho left mid-trigger before the next row.
            const closeBtn = document.querySelector('.lyteCboxClose, .cboxClose, [data-zcqa="closeIcon"]');
            if (closeBtn && closeBtn.offsetParent !== null) {
                closeBtn.click();
                await sleep(300);
            }

            if (!capturedUrl) {
                failCount++;
                continue;
            }

            const isNative = capturedUrl.startsWith('/crm/');

            if (isNative) {
                try {
                    const resp = await fetch(capturedUrl, { credentials: 'include' });
                    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
                    const blob = await resp.blob();
                    const blobUrl = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = blobUrl;
                    a.download = displayName;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(blobUrl);
                    nativeCount++;
                } catch (err) {
                    console.error('[Attachment Download] native fetch failed for', displayName, err);
                    failCount++;
                }
            } else {
                // External doc (e.g. sendlink.co) — script can't read the bytes, so
                // open the real link and let the browser's own PDF handling take it
                // from there (auto-download or viewer, per your browser settings).
                window.open(capturedUrl, '_blank', 'noopener');
                externalCount++;
            }

            await sleep(500); // space out requests / new tabs
        }

        showToast(
            `✓ Done — ${nativeCount} auto-saved · ${externalCount} opened in new tab(s) · ${failCount} failed`,
            'success',
            8000
        );
    }

    // ─── XML BUILDER ─────────────────────────────────────────────────────────────

    function buildActivityXml(rec) {
        let xml = `    <activity>\n`;
        // Emit a stable-ish field order, then any remaining keys.
        const ordered = ['status', 'type', 'subject', 'date', 'owner'];
        ordered.forEach(k => {
            if (rec[k]) xml += `      <${k}>${escapeXml(rec[k])}</${k}>\n`;
        });
        Object.keys(rec).forEach(k => {
            if (ordered.includes(k)) return;
            if (rec[k]) xml += `      <${k}>${escapeXml(rec[k])}</${k}>\n`;
        });
        xml += `    </activity>\n`;
        return xml;
    }

    function buildXmlOutput(patientName, notes, carePlans, commLogs, smsMessages, weeklyMeasurements, activities, attachments) {
        let xml = `<zoho_context>\n  <patient>${escapeXml(patientName)}</patient>\n`;

        if (notes.length > 0) {
            xml += `\n  <notes>\n`;
            notes.forEach(n => {
                xml += `    <note>\n`;
                if (n.title) xml += `      <title>${escapeXml(n.title)}</title>\n`;
                if (n.date) xml += `      <date>${escapeXml(n.date)}</date>\n`;
                if (n.author) xml += `      <author>${escapeXml(n.author)}</author>\n`;
                xml += `      <content>${escapeXml(n.content)}</content>\n`;
                xml += `    </note>\n`;
            });
            xml += `  </notes>\n`;
        }

        if (carePlans.length > 0) {
            xml += `\n  <care_plans>\n`;
            carePlans.forEach(cp => {
                xml += `    <care_plan>\n`;
                Object.keys(cp).forEach(k => { xml += `      <${k}>${escapeXml(cp[k])}</${k}>\n`; });
                xml += `    </care_plan>\n`;
            });
            xml += `  </care_plans>\n`;
        }

        if (commLogs.length > 0) {
            xml += `\n  <comm_logs>\n`;
            commLogs.forEach(cl => {
                xml += `    <comm_log>\n`;
                Object.keys(cl).forEach(k => { xml += `      <${k}>${escapeXml(cl[k])}</${k}>\n`; });
                xml += `    </comm_log>\n`;
            });
            xml += `  </comm_logs>\n`;
        }

        if (weeklyMeasurements.length > 0) {
            xml += `\n  <weekly_measurements>\n`;
            weeklyMeasurements.forEach(wm => {
                xml += `    <measurement>\n`;
                Object.keys(wm).forEach(k => { xml += `      <${k}>${escapeXml(wm[k])}</${k}>\n`; });
                xml += `    </measurement>\n`;
            });
            xml += `  </weekly_measurements>\n`;
        }

        if (smsMessages.length > 0) {
            xml += `\n  <sms_history>\n`;
            const ordered = ['created_time', 'type', 'message', 'message_source', 'api_log',
                             'from_number', 'to_number', 'text_messages_history_owner'];
            smsMessages.forEach(m => {
                xml += `    <sms>\n`;
                ordered.forEach(k => {
                    if (m[k]) xml += `      <${k}>${escapeXml(m[k])}</${k}>\n`;
                });
                Object.keys(m).forEach(k => {
                    if (ordered.includes(k)) return;
                    if (k === 'formatted_time') return; // redundant with created_time
                    if (m[k]) xml += `      <${k}>${escapeXml(m[k])}</${k}>\n`;
                });
                xml += `    </sms>\n`;
            });
            xml += `  </sms_history>\n`;
        }

        if (attachments.length > 0) {
            xml += `\n  <attachments>\n`;
            attachments.forEach(a => {
                xml += `    <attachment>\n`;
                xml += `      <file_name>${escapeXml(a.file_name)}</file_name>\n`;
                if (a.attached_by) xml += `      <attached_by>${escapeXml(a.attached_by)}</attached_by>\n`;
                if (a.date_added) xml += `      <date_added>${escapeXml(a.date_added)}</date_added>\n`;
                if (a.size) xml += `      <size>${escapeXml(a.size)}</size>\n`;
                xml += `      <record_id>${escapeXml(a.record_id)}</record_id>\n`;
                xml += `    </attachment>\n`;
            });
            xml += `  </attachments>\n`;
        }

        if (activities.open.length > 0) {
            xml += `\n  <open_activities>\n`;
            activities.open.forEach(rec => { xml += buildActivityXml(rec); });
            xml += `  </open_activities>\n`;
        }

        if (activities.closed.length > 0) {
            xml += `\n  <closed_activities>\n`;
            activities.closed.forEach(rec => { xml += buildActivityXml(rec); });
            xml += `  </closed_activities>\n`;
        }

        xml += `</zoho_context>`;
        return xml;
    }

    function buildJsonOutput(patientName, notes, carePlans, commLogs, smsMessages, weeklyMeasurements, activities, attachments) {
        return JSON.stringify({
            patient: patientName,
            notes: notes,
            care_plans: carePlans,
            comm_logs: commLogs,
            sms_history: smsMessages,
            weekly_measurements: weeklyMeasurements,
            attachments: attachments,
            activities: activities
        }, null, 2);
    }

    // ─── MAIN ─────────────────────────────────────────────────────────────────────

    let isRunning = false;

    async function runExtraction() {
        if (isRunning) return;
        isRunning = true;
        cancelled = false;
        const api = window.__scripts['ZCtx'];
        api.state = 'running'; api.message = 'Extracting context...'; api.output = null; api.lastActivity = Date.now();
        const toggle = document.getElementById('cx-extractor-toolbar-btn');
        if (toggle) {
            toggle.classList.add('cx-working');
            toggle.innerHTML = '⏳';
            toggle.title = 'Click to cancel extraction';
        }
        closeMenu();
        showToast('Extracting... (click Extract Profile again to cancel)', 'success', 60000);

        try {
            const want = selectedSections;

            await preloadRelatedLists();
            if (cancelled) return;
            await sleep(300);

            if (want.notes) {
                await expandNotes();
                if (cancelled) return;
                await sleep(300);
            }

            const notes       = want.notes ? extractNotes() : [];
            const carePlans   = want.carePlans ? extractRelatedListTable('CustomModule32') : [];
            const commLogs    = want.commLogs ? extractRelatedListTable('CustomModule27') : [];
            const weeklyMeasurements = want.weeklyMeasurements ? extractRelatedListTable('CustomModule42') : [];
            const smsMessages = want.sms ? await extractSmsHistory() : [];
            if (cancelled) return;
            const attachments = want.attachments ? extractAttachments() : [];
            const activities  = await extractActivities();
            if (cancelled) return;

            let content;
            let mimeType;
            let extension;

            if (CONFIG.format === 'json') {
                content = buildJsonOutput(getPatientName(), notes, carePlans, commLogs, smsMessages, weeklyMeasurements, activities, attachments);
                mimeType = 'application/json';
                extension = 'json';
            } else {
                content = buildXmlOutput(getPatientName(), notes, carePlans, commLogs, smsMessages, weeklyMeasurements, activities, attachments);
                mimeType = 'text/xml';
                extension = 'xml';
            }

            // R18: expose output via Script API
            api.output = content;
            api.state = 'done';
            api.message = 'Extracted (' + CONFIG.format + ')';
            api.lastActivity = Date.now();

            if (CONFIG.action === 'copy') {
                if (typeof GM_setClipboard === 'function') {
                    GM_setClipboard(content, 'text');
                } else {
                    await navigator.clipboard.writeText(content);
                }
            } else {
                // Download
                const blob = new Blob([content], { type: mimeType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `zoho_context_${getPatientName().replace(/\s+/g, '_')}.${extension}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }

            // Restored Diagnostic Toast — only counts the sections that were requested.
            const actTotal = activities.open.length + activities.closed.length;
            const actionText = CONFIG.action === 'copy' ? 'Copied' : 'Downloaded';
            const parts = [];
            if (want.notes) parts.push(`Notes: ${notes.length}`);
            if (want.carePlans) parts.push(`Care Plans: ${carePlans.length}`);
            if (want.commLogs) parts.push(`Comm Logs: ${commLogs.length}`);
            if (want.sms) parts.push(`SMS: ${smsMessages.length}`);
            if (want.attachments) parts.push(`Attachments: ${attachments.length}`);
            if (want.weeklyMeasurements) parts.push(`Measurements: ${weeklyMeasurements.length}`);
            if (want.openActivities || want.closedActivities) parts.push(`Activities: ${actTotal} (${activities.open.length} open / ${activities.closed.length} closed)`);
            showToast(`✓ ${actionText} — ${parts.join(' · ')}`, 'success');

        } catch (err) {
            console.error('[Context Extractor]', err);
            api.state = 'error'; api.error = err.message; api.message = 'Failed: ' + err.message; api.lastActivity = Date.now();
            showToast('✗ Extraction failed: ' + err.message, 'error', 5000);
        } finally {
            if (toggle) {
                toggle.innerHTML = '<strong>Extract Profile</strong>';
                toggle.classList.remove('cx-working');
                toggle.title = 'Extract Profile (Right-click for options)';
            }
            isRunning = false;
            if (cancelled) showToast('⏹ Extraction cancelled', 'error', 4000);
        }
    }

    // Cancel an in-progress extraction: the running loops and sleep() checks see
    // `cancelled` at their next checkpoint and unwind, then runExtraction's finally
    // block resets the toolbar button.
    function cancelExtraction() {
        cancelled = true;
        // Wake up any pending sleep immediately so we stop fast instead of waiting
        // out the current delay.
        if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
        if (sleepResolve) { const r = sleepResolve; sleepResolve = null; r(); }
        showToast('⏹ Cancelling...', 'error', 3000);
    }

    // Kick off toolbar injection
    injectToolbarButton();

    // R18: trigger dispatcher
    const api = window.__scripts['ZCtx'];
    api.trigger = function (action) {
      if (action === 'extract') {
        if (isRunning) return { ok: false, error: 'already running' };
        api.state = 'running'; api.message = 'Extracting context...'; api.output = null; api.error = null; api.lastActivity = Date.now();
        runExtraction().then(() => {
          api.lastActivity = Date.now();
        }).catch(err => {
          api.state = 'error'; api.error = err.message; api.message = 'Failed: ' + err.message; api.lastActivity = Date.now();
        });
        return { ok: true };
      }
      if (action === 'stop') {
        cancelExtraction();
        api.state = 'idle'; api.message = 'Cancelled'; api.lastActivity = Date.now();
        return { ok: true };
      }
      return { ok: false, error: 'unknown action: ' + action };
    };
})();