// ==UserScript==
// @name         GHL Conversation Context Extractor
// @namespace    https://github.com/anki-boi/userscript-showcase
// @version      1.8.17
// @author       Jeyson Dagondon
// @run-at       document-idle
// @description  One-click GHL conversation extractor (SMS/calls/transcripts/emails) to XML/JSON
// @match        https://app.gohighlevel.com/*
// @match        https://*.gohighlevel.com/*
// @match        https://*.leadconnectorhq.com/*
// @match        https://*.msgsndr.com/*
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @grant        GM_getValue
// @grant        GM_setValue
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[GHL-Ctx v1.8.17] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['GHL'] = {
  name: 'GHL Conversation Context Extractor',
  version: '1.8.17',
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

    // ─── CONFIG ───────────────────────────────────────────────────────────────────

    const DEFAULT_CONFIG = {
        format: 'json',   // 'xml' or 'json'
        action: 'download',  // 'copy' or 'download'
        files: 'download'    // 'skip' or 'download'
    };

    const CONFIG = {
        format: GM_getValue('ghl_format', DEFAULT_CONFIG.format),
        action: GM_getValue('ghl_action', DEFAULT_CONFIG.action),
        files: GM_getValue('ghl_files', DEFAULT_CONFIG.files)
    };

    function updateConfig(key, value) {
        CONFIG[key] = value;
        GM_setValue(`ghl_${key}`, value);
    }

    // v1.4.0 speed pass constants.
    // TRANSCRIPT_TIMEOUT_MS: 9000ms is enough for even long calls to stabilize.
    //   14000ms was overkill and caused unnecessary wait times on fast connections.
    // TRANSCRIPT_FIRST_TRY_MS: 5000ms allows enough clicks to force expansion before
    //   falling back to the polling loop.
    const TRANSCRIPT_TIMEOUT_MS   = 9000;
    const TRANSCRIPT_FIRST_TRY_MS = 5000;

    // LOAD PHASE (data-index driven).
    // LOAD_POLL_MS: 369ms is a "prime-ish" number to avoid locking into sync cycles
    //   with GHL's own internal render timers (often 100/200/500ms).
    // LOAD_FETCH_WAIT_MS: 1000ms gives the network request time to return and the DOM
    //   to update before we declare the round "no growth".
    // LOAD_IDLE_BREAK_MS: break only after this much wall-clock time passes with NO
    //   scrollHeight growth AND no visible loader. The sweep jitter (500px down/up)
    //   triggers virtualizer batch fetches immediately — full thread materializes
    //   in ~5s — so 30s of continuous no-growth means we're genuinely done.
    //   A round-count budget (10 rounds ≈ 13–25s) races with batch gaps and stops
    //   early (v1.8.8 flake).
    const LOAD_POLL_MS         = 369;
    const LOAD_FETCH_WAIT_MS   = 1000;
    const LOAD_IDLE_BREAK_MS   = 75000;
    const LOAD_MAX_ROUNDS      = 420;

    // DOCUMENTS PANEL (file download) constants.
    // DOC_PANEL_MAX_WAIT_MS: how long we'll wait for the panel to render rows
    //   after clicking the sidebar icon.
    // DOC_MENU_WAIT_MS: how long we give the kebab dropdown to open before we
    //   search for its "Download" item.
    // DOC_ROW_GAP_MS: pause after a successful download click before moving to
    //   the next row, so the browser's download isn't clobbered mid-flight.
    const DOC_PANEL_MAX_WAIT_MS = 4000;
    const DOC_PANEL_POLL_MS     = 250;
    const DOC_MENU_WAIT_MS      = 400;
    const DOC_ROW_GAP_MS        = 700;


    // ─── STYLES ───────────────────────────────────────────────────────────────────

    GM_addStyle(`
        #gx-extractor-container {
            position: fixed;
            top: 120px;
            right: 20px;
            display: flex;
            flex-direction: column;
            align-items: flex-end;
            gap: 8px;
            z-index: 99999;
            cursor: grab;
            user-select: none;
            touch-action: none;
        }
        #gx-extractor-container.gx-dragging { cursor: grabbing; }

        /* Simple, flat button */
        #gx-extractor-toggle {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 12px 22px;
            border-radius: 10px;
            background: #1b2a4a;
            color: #fff;
            border: 1px solid #2a4070;
            cursor: pointer;
            font-size: 16px;
            font-weight: 700;
            line-height: 1;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            white-space: nowrap;
            user-select: none;
        }
        #gx-extractor-toggle:hover { background: #2a4070; }
        #gx-extractor-toggle:active { background: var(--ds-surface2,#16223c); }

        /* While running it becomes a red Stop button */
        #gx-extractor-toggle.gx-working {
            background: var(--ds-danger,#b33030);
            border-color: var(--ds-danger,#8b1a1a);
        }
        #gx-extractor-toggle.gx-working:hover { background: #c0392b; }

        /* Settings Menu — fixed, but repositioned on open so it never leaves the viewport */
        #gx-settings-menu {
            position: fixed;
            background: #fff;
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 10px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.12);
            display: none;
            flex-direction: column;
            gap: 4px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 13px;
            color: #333;
            min-width: 180px;
            z-index: 100000;
            opacity: 0;
            transform: translateY(4px);
            transition: opacity 0.15s ease, transform 0.15s ease;
            pointer-events: none;
        }
        #gx-settings-menu.visible {
            display: flex;
            opacity: 1;
            transform: translateY(0);
            pointer-events: auto;
        }
        .gx-menu-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            cursor: pointer;
            padding: 6px 8px;
            border-radius: 4px;
        }
        .gx-menu-item:hover { background: var(--ds-surface2,#f0f0f0); }
        .gx-menu-label { font-weight: 500; }
        .gx-menu-value { color: #666; font-size: 12px; }

        /* Depth submenu — expands in place inside the settings menu. The menu is
           re-clamped (positionSettingsMenu) when it opens, so the extra height can
           never push the menu off the bottom of the viewport. */
        #gx-depth-menu {
            display: none;
            flex-direction: column;
            gap: 4px;
            padding-left: 8px;
            margin-left: 4px;
            border-left: 2px solid var(--ds-border,#e8e2d8);
        }
        #gx-depth-menu.visible { display: flex; }

        #gx-toast {
            position: absolute;
            bottom: calc(100% + 8px);
            right: 0;
            z-index: 100001;
            background: #1b2a4a;
            color: #fff;
            padding: 10px 16px;
            border-radius: 8px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            font-size: 13px;
            font-weight: 500;
            box-shadow: 0 2px 8px rgba(0,0,0,0.12);
            opacity: 0;
            transform: translateY(8px);
            transition: opacity 0.2s ease, transform 0.2s ease;
            pointer-events: none;
            white-space: pre-line;
            max-width: 70vw;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        #gx-toast.gx-show { opacity: 1; transform: translateY(0); }
        #gx-toast.gx-error { background: var(--ds-danger,#8b1a1a); }
        #gx-toast.gx-success { background: var(--ds-success,#0e6b46); }
    `);

    // ─── UI SETUP ─────────────────────────────────────────────────────────────────

    const container = document.createElement('div');
    container.id = 'gx-extractor-container';

    const toggle = document.createElement('button');
    toggle.id = 'gx-extractor-toggle';
    toggle.innerHTML = '<span class="gx-toggle-emoji">📋</span><span class="gx-toggle-label">Extract</span>';
    toggle.title = 'Extract conversation context (Drag to move · Right-click for options)';
    container.appendChild(toggle);

    // Settings Menu
    const settingsMenu = document.createElement('div');
    settingsMenu.id = 'gx-settings-menu';

    // Format Selector
    const formatItem = document.createElement('div');
    formatItem.className = 'gx-menu-item';
    formatItem.innerHTML = `
        <span class="gx-menu-label">Format</span>
        <span class="gx-menu-value" id="gx-display-format">${CONFIG.format.toUpperCase()}</span>
    `;
    formatItem.onclick = () => {
        const newFormat = CONFIG.format === 'xml' ? 'json' : 'xml';
        updateConfig('format', newFormat);
        document.getElementById('gx-display-format').textContent = newFormat.toUpperCase();
        closeMenu();
    };
    settingsMenu.appendChild(formatItem);

    // Action Selector
    const actionItem = document.createElement('div');
    actionItem.className = 'gx-menu-item';
    actionItem.innerHTML = `
        <span class="gx-menu-label">Action</span>
        <span class="gx-menu-value" id="gx-display-action">${CONFIG.action.charAt(0).toUpperCase() + CONFIG.action.slice(1)}</span>
    `;
    actionItem.onclick = () => {
        const newAction = CONFIG.action === 'copy' ? 'download' : 'copy';
        updateConfig('action', newAction);
        document.getElementById('gx-display-action').textContent = newAction.charAt(0).toUpperCase() + newAction.slice(1);
        closeMenu();
    };
    settingsMenu.appendChild(actionItem);

    // Files Selector
    const filesItem = document.createElement('div');
    filesItem.className = 'gx-menu-item';
    filesItem.innerHTML = `
        <span class="gx-menu-label">Files</span>
        <span class="gx-menu-value" id="gx-display-files">${CONFIG.files === 'download' ? 'Download' : 'Skip'}</span>
    `;
    filesItem.onclick = () => {
        const newFiles = CONFIG.files === 'download' ? 'skip' : 'download';
        updateConfig('files', newFiles);
        document.getElementById('gx-display-files').textContent = newFiles === 'download' ? 'Download' : 'Skip';
        closeMenu();
    };
    settingsMenu.appendChild(filesItem);

    // ── Depth Selector (v1.8.17) ──────────────────────────────────────────────
    // Deliberately NOT stored in GM_* and deliberately given NO default: a
    // remembered depth silently shortens a later export, which is the exact failure
    // this picker exists to remove. Each run must be handed an explicit window, and
    // the choice is consumed by that run (see runExtraction).
    let runDepth = null;

    const depthItem = document.createElement('div');
    depthItem.className = 'gx-menu-item';
    depthItem.innerHTML = `
        <span class="gx-menu-label">Depth</span>
        <span class="gx-menu-value" id="gx-display-depth">Choose…</span>
    `;

    const depthSubmenu = document.createElement('div');
    depthSubmenu.id = 'gx-depth-menu';

    const DEPTH_CHOICES = [
        { mode: 'days', value: 7, label: 'Last 7 days' },
        { mode: 'days', value: 3, label: 'Last 3 days' },
        { mode: 'custom',         label: 'Custom date…' },
        { mode: 'full',           label: 'Full history' }
    ];

    function setDepth(choice) {
        runDepth = choice;
        const display = document.getElementById('gx-display-depth');
        if (display) display.textContent = choice.label;
        closeMenu();
        showToast(`Depth: ${choice.label} — click 📋 to extract`, 'success', 3000);
    }

    DEPTH_CHOICES.forEach(choice => {
        const row = document.createElement('div');
        row.className = 'gx-menu-item';
        row.innerHTML = `<span class="gx-menu-label">${choice.label}</span>`;
        row.onclick = (e) => {
            e.stopPropagation();
            if (choice.mode !== 'custom') { setDepth(choice); return; }
            const input = prompt('Extract back to (YYYY-MM-DD):', isoDay(new Date()));
            if (input === null) return;
            const bound = resolveDepthBound('date', input.trim());
            if (!bound) { showToast('✗ Not a valid date: ' + input, 'error', 4000); return; }
            setDepth({ mode: 'date', value: isoDay(bound), label: 'Since ' + isoDay(bound) });
        };
        depthSubmenu.appendChild(row);
    });

    depthItem.onclick = (e) => {
        e.stopPropagation();
        // The right-click menu auto-closes after 4s; a depth choice takes longer
        // than that, so stop the clock while the submenu is open.
        clearTimeout(menuTimeout);
        depthSubmenu.classList.toggle('visible');
        positionSettingsMenu();
    };

    settingsMenu.appendChild(depthItem);
    settingsMenu.appendChild(depthSubmenu);

    container.appendChild(settingsMenu);

    const toast = document.createElement('div');
    toast.id = 'gx-toast';
    container.appendChild(toast);

    let toastTimer = null;
    let menuTimeout = null;
    let shouldStop = false;

    // Keep the toast fully on-screen even when the button sits near the left edge.
    function clampToastToViewport() {
        const cRect = container.getBoundingClientRect();
        const tRect = toast.getBoundingClientRect();
        if (tRect.left < 8) {
            toast.style.right = 'auto';
            toast.style.left = Math.max(4, 8 - cRect.left) + 'px';
        } else {
            toast.style.left = 'auto';
            toast.style.right = '0';
        }
    }

    function showToast(msg, type = 'success', duration = 5000) {
        toast.textContent = msg;
        toast.className = `gx-show gx-${type}`;
        clampToastToViewport();
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => { toast.className = ''; }, duration);
    }

    // ── FLOATING, DRAGGABLE PLACEMENT (remembers last position) ──
    function savePosition() {
        const r = container.getBoundingClientRect();
        GM_setValue('ghl_pos', JSON.stringify({ left: r.left, top: r.top }));
    }

    function restorePosition() {
        const raw = GM_getValue('ghl_pos', null);
        if (!raw) return false;
        try {
            const pos = JSON.parse(raw);
            if (typeof pos.left === 'number' && typeof pos.top === 'number') {
                // Clamp back inside the viewport in case the window got smaller
                const w = container.offsetWidth || 160;
                const h = container.offsetHeight || 50;
                const left = Math.min(Math.max(4, pos.left), window.innerWidth - w - 4);
                const top  = Math.min(Math.max(4, pos.top),  window.innerHeight - h - 4);
                container.style.left = left + 'px';
                container.style.top = top + 'px';
                container.style.right = 'auto';
                container.style.bottom = 'auto';
                return true;
            }
        } catch (e) { /* ignore a bad stored value */ }
        return false;
    }

    function mountFloating() {
        if (!container.isConnected) {
            document.body.appendChild(container);
            if (!restorePosition()) {
                container.style.right = '20px';
                container.style.top = '120px';
            }
        }
    }
    mountFloating();

    // Drag-to-move. Uses pointer events; right-click is left untouched so the
    // settings menu still opens. A click that ends a drag won't start extraction.
    let dragState = null;
    let lastDragMoved = false;

    function startDrag(e) {
        if (e.button !== 0) return;   // only drag with the primary button
        lastDragMoved = false;
        const r = container.getBoundingClientRect();
        dragState = {
            pointerId: e.pointerId,
            offsetX: e.clientX - r.left,
            offsetY: e.clientY - r.top,
            startX: e.clientX,
            startY: e.clientY,
            moved: false
        };
        container.classList.add('gx-dragging');
        if (toggle.setPointerCapture) toggle.setPointerCapture(e.pointerId);
        e.preventDefault();
    }

    function onDragMove(e) {
        if (!dragState || dragState.pointerId !== e.pointerId) return;
        if (Math.abs(e.clientX - dragState.startX) + Math.abs(e.clientY - dragState.startY) > 4) {
            dragState.moved = true;
        }
        let left = e.clientX - dragState.offsetX;
        let top = e.clientY - dragState.offsetY;

        // Keep the button fully inside the viewport while dragging
        const r = container.getBoundingClientRect();
        left = Math.min(Math.max(4, left), window.innerWidth - r.width - 4);
        top  = Math.min(Math.max(4, top),  window.innerHeight - r.height - 4);

        container.style.left = left + 'px';
        container.style.top = top + 'px';
        container.style.right = 'auto';
        container.style.bottom = 'auto';

        // Keep the toast glued to the button as it's dragged
        if (toast.classList.contains('gx-show')) clampToastToViewport();
    }

    function endDrag(e) {
        if (!dragState || dragState.pointerId !== e.pointerId) return;
        container.classList.remove('gx-dragging');
        if (toggle.hasPointerCapture && toggle.hasPointerCapture(e.pointerId)) {
            toggle.releasePointerCapture(e.pointerId);
        }
        if (dragState.moved) savePosition();
        lastDragMoved = dragState.moved;
        dragState = null;
    }

    toggle.addEventListener('pointerdown', startDrag);
    toggle.addEventListener('pointermove', onDragMove);
    toggle.addEventListener('pointerup', endDrag);
    toggle.addEventListener('pointercancel', endDrag);

    // ── SETTINGS MENU POSITIONING (never leaves the viewport) ──
    function positionSettingsMenu() {
        const r = toggle.getBoundingClientRect();
        const mw = settingsMenu.offsetWidth || 180;
        const mh = settingsMenu.offsetHeight || 132;
        const pad = 8;
        const vw = window.innerWidth;
        const vh = window.innerHeight;

        // Open below the button by default; flip above when it would overflow the bottom
        let top = r.bottom + 6;
        let bottom = 'auto';
        if (top + mh > vh - pad) {
            top = 'auto';
            bottom = (vh - r.top) + 6;
        }

        // Keep it horizontally inside the viewport
        let left = r.left;
        if (left + mw > vw - pad) left = Math.max(pad, vw - mw - pad);

        settingsMenu.style.top = (top === 'auto' ? 'auto' : top + 'px');
        settingsMenu.style.bottom = (bottom === 'auto' ? 'auto' : bottom + 'px');
        settingsMenu.style.left = left + 'px';
        settingsMenu.style.right = 'auto';
    }

    function showMenu() {
        settingsMenu.classList.add('visible');
        positionSettingsMenu();
        clearTimeout(menuTimeout);
    }

    function closeMenu() {
        settingsMenu.classList.remove('visible');
        depthSubmenu.classList.remove('visible');
    }

    window.addEventListener('resize', () => {
        if (settingsMenu.classList.contains('visible')) positionSettingsMenu();
        if (toast.classList.contains('gx-show')) clampToastToViewport();
    });

    // Request the current extraction to stop at the next checkpoint.
    function stopExtraction() {
        shouldStop = true;
        toggle.innerHTML = '<span class="gx-toggle-emoji">⏹</span><span class="gx-toggle-label">Stopping…</span>';
        toggle.title = 'Stopping extraction…';
        showToast('Stopping… (finishing current step)', 'error', 3000);
        const api = window.__scripts['GHL'];
        api.state = 'idle'; api.message = 'Stopped'; api.lastActivity = Date.now();
    }

    // Toggle Logic — click starts extraction, or stops it while running.
    // A click that ends a drag is ignored.
    toggle.addEventListener('click', () => {
        if (lastDragMoved) {
            lastDragMoved = false;
            return;
        }
        if (settingsMenu.classList.contains('visible')) {
            closeMenu();
        } else if (isRunning) {
            stopExtraction();
        } else {
            runExtraction();
        }
    });

    // Right click to open menu
    toggle.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMenu();
        menuTimeout = setTimeout(closeMenu, 4000);
    });

    // Close menu if clicking outside
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target)) closeMenu();
    });

    // ─── HELPERS ──────────────────────────────────────────────────────────────────

    function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    function escapeXml(str) {
        if (str == null) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');
    }

    function clean(str) {
        return (str || '').replace(/\s+/g, ' ').trim();
    }

    // ─── DATE PARSING (ported from the extension's content.js) ────────────────────
    //
    // The depth bound has to know how old the oldest mounted day chip is, and GHL
    // renders those chips as TEXT: "Today", "Yesterday", "Mon, Aug 3, 2026 · 12",
    // "8/3/26". This script had no chip-text -> Date parser at all before v1.8.17
    // (it only ever collected the raw strings for the <day_marker> tags), so the
    // bound cannot exist without it. ONE parser: the depth rule and every date we
    // report come through parseConversationDateLabel.
    const MONTHS = Object.freeze({
        jan: 1, january: 1,
        feb: 2, february: 2,
        mar: 3, march: 3,
        apr: 4, april: 4,
        may: 5,
        jun: 6, june: 6,
        jul: 7, july: 7,
        aug: 8, august: 8,
        sep: 9, sept: 9, september: 9,
        oct: 10, october: 10,
        nov: 11, november: 11,
        dec: 12, december: 12
    });

    function normalizeYear(year) {
        if (!year) return new Date().getFullYear();
        const numeric = Number(year);
        return numeric < 100 ? 2000 + numeric : numeric;
    }

    function validDateParts(year, month, day) {
        const date = new Date(year, month - 1, day);
        return date.getFullYear() === year &&
            date.getMonth() === month - 1 &&
            date.getDate() === day;
    }

    // A mounted day chip -> Date, or null when it is not a date we understand.
    // Note the deliberate omission: an unqualified month+day ("Aug 3") resolves to
    // the CURRENT year, never a past one. A chip is the day of a message that is
    // already on screen, so this only ever mis-year-degrades a chip dated more than
    // a year back — and that errs by making the bound look NOT yet reached, i.e. it
    // loads more, never less. Truncation is the failure mode worth avoiding.
    function parseConversationDateLabel(label) {
        const text = clean(label).toLowerCase();
        if (!text) return null;

        const now = new Date();

        if (text === 'today') {
            return new Date(now.getFullYear(), now.getMonth(), now.getDate());
        }

        if (text === 'yesterday') {
            const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            date.setDate(date.getDate() - 1);
            return date;
        }

        const normalized = text
            .replace(/\b(mon|tue|wed|thu|fri|sat|sun)(day)?\b,?/gi, '')
            .replace(/\s+/g, ' ')
            .trim();

        let match = normalized.match(
            /\b(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(\d{1,2})(?:,?\s+(\d{4}))?\b/i
        );

        if (match) {
            const month = MONTHS[match[1].toLowerCase()];
            const day = Number(match[2]);
            const year = match[3] ? Number(match[3]) : now.getFullYear();
            return validDateParts(year, month, day)
                ? new Date(year, month - 1, day)
                : null;
        }

        match = normalized.match(
            /\b(0?[1-9]|1[0-2])[\/.-](0?[1-9]|[12]\d|3[01])(?:[\/.-](\d{2}|\d{4}))?\b/
        );

        if (match) {
            const month = Number(match[1]);
            const day = Number(match[2]);
            const year = match[3] ? normalizeYear(match[3]) : now.getFullYear();
            return validDateParts(year, month, day)
                ? new Date(year, month - 1, day)
                : null;
        }

        return null;
    }

    /** ISO yyyy-mm-dd in LOCAL time — GHL day chips are local days, so a UTC
     *  midnight would shave hours off the window. */
    function isoDay(value) {
        if (!value) return null;
        const d = value instanceof Date ? value : new Date(value);
        if (isNaN(d)) return null;
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    // Depth mode -> the instant the load may stop at. LOCAL midnight, for the same
    // reason isoDay is local. 'full' (and anything unrecognised) returns null.
    function resolveDepthBound(mode, value, now = new Date()) {
        if (mode === 'days') {
            const n = Number(value);
            if (!Number.isFinite(n)) return null;
            return new Date(now.getFullYear(), now.getMonth(), now.getDate() - n);
        }
        if (mode === 'date') {
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
            if (!m) return null;
            const year = Number(m[1]), month = Number(m[2]), day = Number(m[3]);
            return validDateParts(year, month, day) ? new Date(year, month - 1, day) : null;
        }
        return null;
    }

    // Full email body from a mail card: v2 renders most bodies inside an
    // iframe srcdoc (parse it into text); the first card of a chain is inline.
    // Falls back to the preview span when no body container is found.
    function readEmailBody(card) {
        const iframe = card.querySelector('iframe[srcdoc]');
        if (iframe) {
            const srcdoc = iframe.getAttribute('srcdoc') || '';
            if (srcdoc.trim()) {
                const doc = new DOMParser().parseFromString(srcdoc, 'text/html');
                doc.querySelectorAll("style, script").forEach(el => el.remove());
                const bodyEl = doc.body || doc.documentElement;
                const text = bodyEl ? (bodyEl.innerText || bodyEl.textContent || '') : '';
                if (text.trim()) return clean(text);
            }
        }
        // Inline body (first card of a chain, or non-iframe renders): the
        // deepest text element inside the card that isn't the clamped preview
        // span / sender row / timestamp.
        let best = null;
        let bestLen = 0;
        const walker = document.createTreeWalker(card, NodeFilter.SHOW_ELEMENT);
        let el;
        while ((el = walker.nextNode())) {
            if (el.tagName === 'IFRAME' || el.tagName === 'SCRIPT' || el.tagName === 'STYLE') continue;
            if ((el.className || '').toString().includes('line-clamp')) continue;
            if ((el.className || '').toString().includes('font-medium') && (el.className || '').toString().includes('h-[')) continue;
            const t = (el.textContent || '').trim();
            if (t.length > bestLen && el.children.length < 6) {
                bestLen = t.length;
                best = el;
            }
        }
        const txt = best ? clean(best.textContent) : '';
        if (txt) return txt;
        const previewEl = card.querySelector('.line-clamp-1, .text-gray-600.truncate');
        return clean(previewEl && previewEl.innerText);
    }

    // The scrollable column that holds the messages.
    function getScrollContainer() {
        const anyMsg = document.querySelector('.message-item[data-message-id]');
        if (!anyMsg) return null;

        const candidates = [];
        let el = anyMsg.parentElement;
        while (el && el !== document.body) {
            const oy = getComputedStyle(el).overflowY;
            if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 20) {
                candidates.push(el);
            }
            el = el.parentElement;
        }
        if (candidates.length === 0) return null;
        candidates.sort((a, b) =>
            (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight)
        );
        return candidates[0];
    }

    function isLoadingMore(sc) {
        const scope = sc || document;
        return !!scope.querySelector(
            '.loading, .spinner, [class*="loading" i], [class*="skeleton" i], ' +
            '[role="progressbar"], svg.animate-spin, .animate-spin'
        );
    }

    // The oldest date the thread has actually scrolled back to, in ms, or null when
    // no mounted day chip parses. Reads the SAME chips the harvest collects into
    // dateChips — one selector, one parser, so "how far back did we get" means the
    // same thing to the stop rule and to the report.
    function oldestDatedChipMs(parseDate) {
        if (typeof parseDate !== 'function') return null;
        let oldest = null;
        document.querySelectorAll('[id^="date-label-"]').forEach(chip => {
            const wrap = chip.querySelector('.hr-tag__count-wrapper');
            const parsed = parseDate(clean(wrap ? wrap.textContent : chip.textContent));
            if (!parsed) return;
            const ms = parsed instanceof Date ? parsed.getTime() : NaN;
            if (isNaN(ms)) return;
            if (oldest === null || ms < oldest) oldest = ms;
        });
        return oldest;
    }

    // ─── VIRTUALIZER INDEX HELPERS ───────────────────────────────────────────────────

    function indexOfNode(node) {
        const wrap = node.closest('[data-index]');
        const v = wrap ? +wrap.dataset.index : NaN;
        return isNaN(v) ? Infinity : v;
    }

    function minDataIndex() {
        let min = Infinity;
        document.querySelectorAll('[data-index]').forEach(n => {
            const v = +n.dataset.index;
            if (!isNaN(v) && v < min) min = v;
        });
        return min === Infinity ? null : min;
    }

    // ─── TRANSCRIPT LOADING ──────────────────────────────────────────────────────────

    function findFullTranscriptExpander(item) {
        const btn = item.querySelector('button[id^="toggle-transcript-btn-"]');
        const scopes = [
            btn && btn.closest('.recording-item'),
            btn && btn.closest('.chat-message'),
            btn && btn.closest('.chat-content'),
            btn && btn.closest('.message-item'),
            item
        ].filter(Boolean);

        for (const scope of scopes) {
            const hit = [...scope.querySelectorAll('div.cursor-pointer, span, button, a')]
                .find(el => el.offsetParent !== null &&
                            clean(el.textContent).toLowerCase() === 'full transcript');
            if (hit) return hit.closest('div.cursor-pointer') || hit;
        }
        const any = [...document.querySelectorAll('div.cursor-pointer, span, button, a')]
            .find(el => el.offsetParent !== null &&
                        clean(el.textContent).toLowerCase() === 'full transcript');
        return any ? (any.closest('div.cursor-pointer') || any) : null;
    }

    async function openPreview(item) {
        const btn = item.querySelector('button[id^="toggle-transcript-btn-"]');
        if (!btn || btn.offsetParent === null) return;
        const t = (btn.textContent || '').toLowerCase();
        if (t.includes('view') || t.includes('show')) {
            btn.click();
            await sleep(250);
        }
    }

    async function loadOneTranscript(item) {
        const start = Date.now();
        const lineCount = () => extractTranscriptLines(item).length;

        await openPreview(item);

        let beforeFull = lineCount();
        let expanderClicks = 0;
        while (Date.now() - start < TRANSCRIPT_FIRST_TRY_MS && !shouldStop) {
            const expander = findFullTranscriptExpander(item);
            if (!expander) break;
            expander.click();
            expanderClicks++;
            await sleep(350);
            if (lineCount() > beforeFull) break;
            if (expanderClicks >= 6) break;
        }

        let last = -1, stable = 0;
        while (Date.now() - start < TRANSCRIPT_TIMEOUT_MS && !shouldStop) {
            const n = lineCount();
            if (n === last && n > 0) {
                stable++;
                if (stable >= 2) break;
            } else {
                stable = 0;
                last = n;
            }
            if (n > 0 && n <= 5) {
                const expander = findFullTranscriptExpander(item);
                if (expander) { expander.click(); await sleep(300); }
            }
            await sleep(200);
        }

        return lineCount();
    }

    async function expandEmailChains() {
        let clicks = 0;
        for (let i = 0; i < 30; i++) {
            const pills = [...document.querySelectorAll('.message-item[data-message-id] [id^="conv-mail-thread-count-button"]')]
                .filter(p => p.offsetParent !== null);
            if (!pills.length) break;
            pills.forEach(p => { try { p.click(); } catch (e) {} });
            clicks += pills.length;
            await sleep(3000);
            if (shouldStop) break;
        }
        return clicks;
    }

    async function expandEmailCardBodies() {
        // v1.8.14: single (non-chain) email cards render COLLAPSED - the full body
        // only materializes after a synthetic click on the card header (the click
        // is a TOGGLE, so cards that already have an iframe[srcdoc] or an inline
        // body are never clicked). Chain cards expanded by pill clicks already
        // carry iframe[srcdoc] or inline bodies and are skipped here.
        const cards = [...document.querySelectorAll('[data-email-id]')];
        let clicked = 0;
        for (const card of cards) {
            if (card.querySelector('iframe[srcdoc]')) continue;
            if (hasSubstantialInlineBody(card)) continue;
            const parent = card.parentElement;
            if (parent && parent.querySelectorAll("[data-email-id]").length > 1) continue;
            const header = card.querySelector('.cursor-pointer') || card;
            header.click();
            clicked++;
            await sleep(1200); // let the body render before harvest reads it
        }
        if (clicked) console.log('[GHL-Ctx] email card expansions:', clicked);
    }

    function hasSubstantialInlineBody(card) {
        // True when the card already contains a real body as inline text (chain
        // first cards). Counts text-node characters OUTSIDE .line-clamp subtrees
        // (the clamped preview must not count); sender/time rows are short, so a
        // collapsed single card stays well under the 400-char threshold.
        let total = 0;
        const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            let p = node.parentElement;
            let inClamp = false;
            while (p && p !== card) {
                if ((p.className || '').toString().includes('line-clamp')) { inClamp = true; break; }
                p = p.parentElement;
            }
            if (inClamp) continue;
            total += (node.textContent || '').trim().length;
        }
        return total > 400;
    }

    async function expandAndLoadVisibleTranscripts() {
        const visibleCalls = [...document.querySelectorAll('.message-item[data-message-id]')]
            .filter(n => n.querySelector('button[id^="toggle-transcript-btn-"]'));

        if (visibleCalls.length === 0 || shouldStop) return 0;

        await Promise.all(visibleCalls.map(c => loadOneTranscript(c)));
        return visibleCalls.length;
    }

    // ─── HARVEST-AS-YOU-SCROLL ──────────────────────────────────────────────

    function transcriptLineCount(data) {
        if (data && data.type === 'call' && data.fields && data.fields.transcript) {
            return data.fields.transcript.length;
        }
        return 0;
    }

    // `depth` is { boundMs, parseDate, minRounds, graceRounds } or null for a full
    // load. The bound is a STOP RULE, not a filter: it short-circuits the load once
    // the thread has scrolled back past the chosen window, and everything still
    // mounted is harvested exactly as before. Deeper is never a behaviour change;
    // shallower changes what gets exported, so the caller must announce the window.
    //
    // There is no `onHarvestStep` third parameter any more. It was passed
    // `settleAndHarvest` by both call sites and NEVER CALLED, while the comment
    // further down claimed the harvest rode along with every scroll position. It
    // does not, and it must not: a merged walk re-triggers newer-batch loads below
    // the spacer, growth never stops, and the page bounces forever (v1.8.11 flake).
    // The harvest is STEP 2 in harvestWholeThread().
    async function loadEntireHistory(sc, onPharmacyB, depth) {
        const messageCount = () =>
            document.querySelectorAll('.message-item[data-message-id]').length;

        // Depth bound. minRounds stops a thread whose FIRST mounted window is
        // already older than the bound from leaving before a single batch fetch has
        // been triggered; graceRounds absorbs an undated entry sitting between two
        // dated ones. Both are calibration knobs for a real thread, not constants.
        const boundMs = depth && Number.isFinite(depth.boundMs) ? depth.boundMs : null;
        const minRounds = depth && Number.isFinite(depth.minRounds) ? depth.minRounds : 3;
        const graceRounds = depth && Number.isFinite(depth.graceRounds) ? depth.graceRounds : 2;
        let belowBoundRounds = 0;

        let rounds = 0;
        let lastSh = sc.scrollHeight;
        let lastGrowthAt = Date.now();

        while (rounds < LOAD_MAX_ROUNDS) {
            if (shouldStop) break;
            // Sweep jitter at the top: v2 virtualizer ignores sub-pixel scrolls
            // (0/1/0 jitter = no batch fetches), but a 500px down/up sweep
            // triggers the older-batch load reliably (sweep test: full thread
            // materialized in 4 rounds vs zero growth from 75s of 1px jitter).
            sc.scrollTop = 0;
            await sleep(80);
            sc.scrollTop = Math.min(500, sc.scrollHeight);
            await sleep(150);
            sc.scrollTop = 0;
            await sleep(80);

            const waitStart = Date.now();
            let grew = false;
            while (Date.now() - waitStart < LOAD_FETCH_WAIT_MS && !shouldStop) {
                const sh = sc.scrollHeight;
                // v2 virtualizer: only a window of items is mounted and index 0
                // can exist from the first mount, so the v1 "min index
                // decreases" signal alone never fires reliably. Robust growth
                // signal = scrollHeight grew (new batches materialized).
                if (sh > lastSh) {
                    lastSh = sh;
                    grew = true;
                    break;
                }
                await sleep(LOAD_POLL_MS);
            }
            if (sc.scrollHeight > lastSh) {
                lastSh = sc.scrollHeight;
                grew = true;
            }

            if (grew) lastGrowthAt = Date.now();

            rounds++;
            if (onPharmacyB) onPharmacyB(messageCount(), rounds);

            // Time-based idle break: only stop after LOAD_IDLE_BREAK_MS of
            // continuous no-growth. Round-count budgets race with batch gaps
            // and stop too early (v1.8.8 flake). Do NOT walk during the load —
            // a merged walk re-triggers newer-batch loads below the spacer and
            // growth never stops (v1.8.11 infinite-loop flake); the harvest
            // phase is a separate bounded one-way walk.
            if (Date.now() - lastGrowthAt >= LOAD_IDLE_BREAK_MS) {
                break;
            }

            // ── DEPTH BOUND (the fast exit) ────────────────────────────────────
            // Evaluated once per round, after the growth check, so it can never
            // pre-empt the idle logic on an undated thread.
            if (boundMs !== null) {
                const oldest = oldestDatedChipMs(depth && depth.parseDate);
                if (oldest !== null && oldest < boundMs) {
                    belowBoundRounds += 1;
                    if (belowBoundRounds >= graceRounds && rounds >= minRounds) break;
                } else {
                    belowBoundRounds = 0;
                }
            }
        }

        return {
            rounds,
            finalCount: messageCount(),
            stopped: shouldStop,
            depthRequestedMs: boundMs,
            oldestReachedMs: depth ? oldestDatedChipMs(depth.parseDate) : null
        };
    }

    // `options.depth` is the resolveDepthBound window ({ boundMs, parseDate } or just
    // { boundMs, parseDate, minRounds, graceRounds }); null/undefined = full history.
    // Returns the old shape plus timing, so a run can be measured instead of guessed.
    async function harvestWholeThread(options) {
        const opts = options || {};
        const sc = getScrollContainer();
        if (!sc) return { container: false, messages: 0, entries: [], transcriptsOpened: 0 };

        const messages = new Map();
        const dateChips = new Map();
        let transcriptsOpened = 0;

        const harvestVisible = () => {
            document.querySelectorAll('[id^="date-label-"]').forEach(chip => {
                const idx = indexOfNode(chip);
                const wrap = chip.querySelector('.hr-tag__count-wrapper');
                const txt = clean(wrap ? wrap.textContent : chip.textContent);
                if (txt && idx !== Infinity) dateChips.set(idx, txt);
            });

            document.querySelectorAll('.message-item[data-message-id]').forEach(node => {
                const id = node.getAttribute('data-message-id');
                if (!id) return;
                const data = classifyAndExtract(node);
                if (!data) return;

                // Email chains: classifyAndExtract may return MULTIPLE entries
                // (one per [data-email-id] mail card inside the collapsed thread).
                const list = Array.isArray(data) ? data : [data];
                list.forEach((entry, i) => {
                    const key = list.length > 1 ? `${id}#${i}` : id;
                    const existing = messages.get(key);

                    if (!existing) {
                        messages.set(key, { idx: indexOfNode(node), data: entry });
                        return;
                    }

                    if (transcriptLineCount(entry) > transcriptLineCount(existing.data)) {
                        messages.set(key, { idx: existing.idx, data: entry });
                    }
                });
            });
        };

        const settleAndHarvest = async () => {
            if (shouldStop) return;
            if (isLoadingMore(sc)) await sleep(200);
            if (shouldStop) return;
            await expandEmailChains();
            await expandEmailCardBodies();
            if (shouldStop) return;
            transcriptsOpened += await expandAndLoadVisibleTranscripts();
            harvestVisible();
        };

        // ── STEP 1: LOAD PHASE (walks + harvests in the same pass) ──
        // harvestStep rides along with every scroll position: the virtualizer
        // unmounts items outside the viewport, so harvest must happen while
        // scrolling. Each round walks top→bottom (harvesting), then returns to
        // top (which triggers the older-batch load); repeats until growth stops.
        // ── STEP 1: LOAD PHASE (scrolls to materialize history; harvests nothing) ──
        // The two phases are timed SEPARATELY on purpose. Starting the harvest clock
        // before the load (or at the top of this function) would make harvest.ms
        // include the load and report the whole run twice.
        const loadStart = Date.now();
        const loadStats = await loadEntireHistory(
            sc, harvestWholeThread._onLoadPharmacyB || null, opts.depth || null
        );
        const loadMs = Date.now() - loadStart;
        const harvestStart = Date.now();

        await sleep(300);
        await settleAndHarvest();

        // ── STEP 2: HARVEST PHASE ──
        const step = Math.max(240, Math.floor(sc.clientHeight * 0.8));
        let pos = 0, guard = 0, lastHeight = -1, stableHeight = 0, steps = 0;
        const MAX_STEPS = 600;

        while (guard < MAX_STEPS) {
            if (shouldStop) break;
            steps++;
            pos += step;
            if (pos > sc.scrollHeight) pos = sc.scrollHeight;
            sc.scrollTop = pos;
            // v2 virtualizer mounts windows lazily; 150ms can outrun it on slow
            // networks and skip windows. 800ms lets each window mount before
            // harvest (v1.8.8 flake).
            await sleep(800);
            await settleAndHarvest();

            const atBottom = (sc.scrollTop + sc.clientHeight) >= (sc.scrollHeight - 4);
            const h = sc.scrollHeight;
            if (h === lastHeight) stableHeight++; else { stableHeight = 0; lastHeight = h; }
            if (atBottom && stableHeight >= 2) break;
            guard++;
        }

        harvestVisible();

        sc.scrollTop = 0; await sleep(200);
        sc.scrollTop = sc.scrollHeight; await sleep(150);

        const chipList = [...dateChips.entries()]
            .map(([idx, date]) => ({ idx, date }))
            .sort((a, b) => a.idx - b.idx);

        const dateFor = (idx) => {
            let d = '';
            for (const c of chipList) { if (c.idx <= idx) d = c.date; else break; }
            return d;
        };

        const entries = [...messages.values()]
            .sort((a, b) => a.idx - b.idx)
            .map(m => ({ data: m.data, date: dateFor(m.idx) }));

        const transcriptLines = entries.reduce((n, e) => {
            const t = e.data && e.data.type === 'call' && e.data.fields && e.data.fields.transcript;
            return n + (t ? t.length : 0);
        }, 0);

        // How far back the WHOLE run actually got, taken from the date chips the
        // harvest itself collected (harvestVisible fills `dateChips` from every window
        // the walk ever mounted) rather than by re-reading the DOM here. Two reasons,
        // both found by running the real flow:
        //   1. STEP 2 scrolls, and scrolling mounts older batches, so the walk reaches
        //      DEEPER than the load alone did. Reporting the load-phase value claimed a
        //      window the run then exceeded.
        //   2. The DOM at this point is NOT representative: the walk ends near the
        //      bottom, and the virtualizer has unmounted the old windows by then, so a
        //      re-query returned null and the report said "oldest chip seen unknown" —
        //      on the one run where knowing how far back you got matters most. It also
        //      cannot report anything at all without a bound, because loadEntireHistory
        //      only parses chips through the depth object it was handed.
        const oldestReachedMs = (() => {
            let oldest = null;
            for (const txt of dateChips.values()) {
                const parsed = parseConversationDateLabel(txt);
                if (!parsed) continue;
                const ms = parsed.getTime();
                if (oldest === null || ms < oldest) oldest = ms;
            }
            return oldest;
        })();

        return {
            container: true,
            messages: entries.length,
            entries,
            transcriptsOpened,
            transcriptLines,
            oldestReachedMs,
            load: {
                rounds: loadStats.rounds,
                messages: loadStats.finalCount,
                ms: loadMs,
                stopped: loadStats.stopped,
                depthRequestedMs: loadStats.depthRequestedMs
            },
            harvest: { ms: Date.now() - harvestStart, steps }
        };
    }

    function extractTranscriptLines(item) {
        const btn = item.querySelector('button[id^="toggle-transcript-btn-"]');
        if (!btn) return [];

        const m = btn.id.match(/^toggle-transcript-btn-(.+)$/);
        const key = m ? m[1] : null;

        const lines = [];
        const seen = new Set();
        const push = (time, text) => {
            if (!text) return;
            const sig = time + '|' + text;
            if (seen.has(sig)) return;
            seen.add(sig);
            lines.push({ time, text });
        };

        const readRow = (node) => {
            const spans = node.querySelectorAll(':scope > span');
            if (spans.length >= 2) {
                push(clean(spans[0].textContent), clean(spans[1].textContent));
            } else {
                const all = node.querySelectorAll('span');
                if (all.length >= 2) {
                    push(clean(all[0].textContent), clean(all[1].textContent));
                } else {
                    push('', clean(node.textContent));
                }
            }
        };

        if (key) {
            document
                .querySelectorAll(`[id^="conv-transcript-line-${CSS.escape(key)}-"]`)
                .forEach(readRow);
        }

        if (lines.length === 0) {
            const scopes = [
                btn.closest('.recording-item'),
                btn.closest('.chat-message'),
                btn.closest('.chat-content'),
                btn.closest('.message-item'),
                item
            ].filter(Boolean);

            for (const scope of scopes) {
                const rows = [...scope.querySelectorAll('div.flex.items-baseline.gap-1')]
                    .filter(n => {
                        const first = n.querySelector(':scope > span');
                        return first && /^\d{1,2}:\d{2}$/.test(clean(first.textContent));
                    });
                if (rows.length) {
                    rows.forEach(readRow);
                    break;
                }
            }
        }

        return lines;
    }

    function getDirection(item) {
        if (item.querySelector('.message-container.ml-auto, .chat-bubble-outbound')) return 'outbound';
        if (item.querySelector('.message-container.mr-auto, .chat-bubble-inbound')) return 'inbound';
        return '';
    }

    function getSenderInitials(item) {
        const av = item.querySelector('.hr-avatar__text p, .hr-avatar__text');
        if (av) {
            const t = clean(av.textContent);
            if (t && t.length <= 4) return t;
        }
        return '';
    }

    function getTimestamp(item) {
        const t = item.querySelector('.text-gray-600.text-\\[12px\\] .cursor-pointer, span.cursor-pointer');
        if (t) {
            const txt = clean(t.textContent);
            if (/\d{1,2}:\d{2}/.test(txt)) return txt;
        }
        const d = item.querySelector('.text-gray-500.text-\\[13px\\]');
        if (d) return clean(d.textContent);
        return '';
    }

    function classifyAndExtract(item) {
        const systemPill = item.querySelector('.justify-center .text-ellipsis, .justify-center.w-full');
        const hasBubble = item.querySelector('.chat-bubble-inbound, .chat-bubble-outbound');

        // Check for call indicators early to set the button flag
        const transcriptBtn = item.querySelector('button[id^="toggle-transcript-btn-"]');
        const isCallCard = item.querySelector('.audio-player, button[id^="toggle-transcript-btn-"], [id^="avatar-call-"]');
        const isEmailCard = item.querySelector('#conv-email-message-view, [datatestid="EMAIL_DETAILS"], #conv-mail-thread-header');

        // ── EMAIL ──
        if (isEmailCard) {
            const subjEl = item.querySelector('#conv-mail-thread-header span.text-gray-900, #conv-mail-thread-header .truncate');
            const subject = clean(subjEl && subjEl.textContent);

            // v2 email CHAINS: a single message-item may hold the whole thread as
            // multiple [data-email-id] mail cards, collapsed behind a
            // "+N messages earlier" pill (expandEmailChains expands them before
            // harvest). Emit one entry per mail card so long chains survive.
            const mailCards = [...item.querySelectorAll('[data-email-id]')];
            if (mailCards.length > 1) {
                // DOM renders the chain newest-first (pill sits above the older
                // batch); reverse so the output reads oldest→newest like the
                // rest of the thread.
                return mailCards.reverse().map(card => {
                    // v2 (2026-08): sender is a small fixed-height span inside the mail card;
                    // plain `.text-gray-900.truncate` now matches the SUBJECT first, so scope to the sender row.
                    const fromEl = card.querySelector('span.h-\\[16px\\].text-\\[14px\\].font-medium');
                    const previewEl = card.querySelector('.line-clamp-1, .text-gray-600.truncate');
                    const tsEl = card.querySelector('.text-md.text-gray-600 span, .text-gray-600.cursor-default span');
                    return {
                        type: 'email',
                        fields: {
                            subject,
                            from: clean(fromEl && fromEl.textContent),
                            preview: clean(previewEl && previewEl.innerText),
                            // FULL BODY: iframe srcdoc / inline container (v1.8.13)
                            body: readEmailBody(card),
                            time: clean(tsEl && tsEl.textContent) || getTimestamp(item)
                        }
                    };
                });
            }

            // v2 (2026-08): sender is a small fixed-height span inside the mail card;
            // plain `.text-gray-900.truncate` now matches the SUBJECT first, so scope to the sender row.
            const fromEl = item.querySelector('#conv-email-message-view span.h-\\[16px\\].text-\\[14px\\].font-medium, [datatestid="EMAIL_DETAILS"] span.h-\\[16px\\].text-\\[14px\\].font-medium');
            const previewEl = item.querySelector('.line-clamp-1, .text-gray-600.truncate');
            const tsEl = item.querySelector('.text-md.text-gray-600 span, .text-gray-600.cursor-default span');
            return {
                type: 'email',
                fields: {
                    subject,
                    from: clean(fromEl && fromEl.textContent),
                    preview: clean(previewEl && previewEl.innerText),
                    // FULL BODY: iframe srcdoc / inline container (v1.8.13)
                    body: readEmailBody(item),
                    time: clean(tsEl && tsEl.textContent) || getTimestamp(item)
                }
            };
        }

        // ── CALL / VOICEMAIL ──
        if (isCallCard) {
            let status = '';
            item.querySelectorAll('span.text-sm.text-gray-900').forEach(s => {
                const t = clean(s.textContent);
                if (/call completed|voicemail|no answer|missed|busy|declined|outgoing|incoming/i.test(t)) status = t;
            });
            let duration = '';
            const durEl = item.querySelector('.audio-player span.min-w-\\[40px\\], .audio-player .text-gray-500.text-sm');
            if (durEl) {
                const mm = clean(durEl.textContent).match(/\/\s*(\d{1,2}:\d{2})/);
                if (mm) duration = mm[1];
            }
            const transcript = extractTranscriptLines(item);
            return {
                type: 'call',
                fields: {
                    status: status || 'call',
                    direction: getDirection(item),
                    party: getSenderInitials(item),
                    duration,
                    time: getTimestamp(item),
                    transcript,
                    // FIX BUG 2: Tag whether a transcript button existed
                    hadTranscriptButton: !!transcriptBtn
                }
            };
        }

        // ── SYSTEM / ACTIVITY EVENT ──
        if (!hasBubble && systemPill) {
            const lineEl = item.querySelector('.text-ellipsis, .justify-center p');
            const dateEl = item.querySelector('.text-gray-500.text-\\[13px\\]');
            return {
                type: 'event',
                fields: {
                    text: clean(lineEl && lineEl.innerText),
                    date: clean(dateEl && dateEl.textContent)
                }
            };
        }

        // ── PLAIN MESSAGE (SMS / chat bubble) ──
        if (hasBubble) {
            const body = item.querySelector('.chat-message .font-inter.text-gray-900, .chat-message .text-\\[14px\\]');
            return {
                type: 'message',
                fields: {
                    direction: getDirection(item),
                    sender: getSenderInitials(item),
                    time: getTimestamp(item),
                    body: clean(body && body.innerText)
                }
            };
        }

        // ── UNKNOWN (last-resort capture so nothing is silently dropped) ──
        const fallback = clean(item.innerText);
        if (fallback) {
            return { type: 'unknown', fields: { text: fallback.slice(0, 1000) } };
        }
        return null;
    }

    // ─── DOCUMENTS PANEL (FILE DOWNLOAD) ─────────────────────────────────────────

    // Opens the contact's "Documents" sidebar panel if it isn't already showing
    // file rows. We can't reliably detect an "opened but empty" state without
    // more markup, so after clicking we just wait and let the row scan below
    // report zero files if that's genuinely the case.
    async function ensureDocumentsPanelOpen() {
        if (document.querySelector('div[currentfolderid]')) return true;

        const icon = document.getElementById('sidebar-documents-icon');
        const btn = icon && icon.closest('button');
        if (!btn) return false;

        btn.click();

        const start = Date.now();
        while (Date.now() - start < DOC_PANEL_MAX_WAIT_MS) {
            if (document.querySelector('div[currentfolderid]')) return true;
            await sleep(DOC_PANEL_POLL_MS);
        }
        return true;
    }

    // Searches broadly for a visible, clickable element whose text matches
    // `text` — same "search anywhere" approach as findFullTranscriptExpander,
    // used here because GHL's dropdown menu is very likely teleported outside
    // the row's own DOM subtree rather than nested inside it.
    function findVisibleTextMatch(selectors, text) {
        const wanted = text.toLowerCase();
        for (const sel of selectors) {
            const exact = [...document.querySelectorAll(sel)]
                .find(el => el.offsetParent !== null && clean(el.textContent).toLowerCase() === wanted);
            if (exact) return exact;
        }
        for (const sel of selectors) {
            const partial = [...document.querySelectorAll(sel)]
                .find(el => el.offsetParent !== null && clean(el.textContent).toLowerCase().includes(wanted));
            if (partial) return partial;
        }
        return null;
    }

    async function clickMenuItemByText(text) {
        const el = findVisibleTextMatch(
            ['[role="menuitem"]', '.hr-dropdown-option', '.n-dropdown-option', 'li', 'div.cursor-pointer', 'span', 'button', 'a'],
            text
        );
        if (!el) return false;
        (el.closest('[role="menuitem"]') || el).click();
        return true;
    }

    async function downloadFileRow(row) {
        const nameEl = row.querySelector('span[title]');
        const fileName = (nameEl && (nameEl.getAttribute('title') || clean(nameEl.textContent))) || 'file';

        const trigger = row.querySelector('#fileActionOptions-trigger');
        if (!trigger) return { fileName, ok: false, reason: 'no menu trigger found' };

        trigger.click();
        await sleep(DOC_MENU_WAIT_MS);

        const clicked = await clickMenuItemByText('download');

        // Force-close any leftover dropdown before moving to the next row.
        document.body.click();
        await sleep(150);

        if (!clicked) return { fileName, ok: false, reason: 'no "Download" option found in menu' };

        await sleep(DOC_ROW_GAP_MS);
        return { fileName, ok: true };
    }

    async function downloadAllDocuments(onPharmacyB) {
        const opened = await ensureDocumentsPanelOpen();
        if (!opened) return { opened: false, total: 0, downloaded: 0, failed: [] };

        await sleep(500);

        const rows = [...document.querySelectorAll('div[currentfolderid]')]
            .filter(r => r.querySelector('span[title]') && r.querySelector('#fileActionOptions-trigger'));

        const failed = [];
        let downloaded = 0;

        for (const row of rows) {
            if (shouldStop) break;
            const result = await downloadFileRow(row);
            if (result.ok) downloaded++; else failed.push(`${result.fileName} (${result.reason})`);
            if (onPharmacyB) onPharmacyB(downloaded + failed.length, rows.length);
        }

        return { opened: true, total: rows.length, downloaded, failed };
    }

    // ─── OUTPUT BUILDERS ──────────────────────────────────────────────────────────

    function getContactName() {
        const sel = [
            '[data-testid="conversation-header-name"]',
            '.conversation-header-title',
            'h2.contact-name',
            '#conversations-detail-header .truncate',
            // v2 contact-detail header (2026-08): name inside hr-text-lg + hr-ellipsis
            'p.hr-text.hr-text-lg .hr-ellipsis span',
            'p.hr-text.hr-text-lg'
        ];
        for (const s of sel) {
            const el = document.querySelector(s);
            if (el && clean(el.textContent)) return clean(el.textContent);
        }
        const m = document.title.match(/^(.+?)\s*[-–|]/);
        return m ? clean(m[1]) : 'Unknown Contact';
    }

    // Helper to keep XML building DRY
    function field(tag, val, indent = '      ') {
        if (val == null || val === '') return '';
        return `${indent}<${tag}>${escapeXml(val)}</${tag}>\n`;
    }

    // `meta` is optional (older 2-arg calls still work). No default parameter on
    // purpose: the test harness's sliceDecl brace-matches from the first `{` it sees,
    // and a `meta = {}` default puts that brace in the signature.
    function buildXml(contactName, entries, meta) {
        const m = meta || {};
        let xml = `<ghl_conversation>\n`;
        xml += `  <contact>${escapeXml(contactName)}</contact>\n`;
        xml += `  <extracted_at>${escapeXml(new Date().toISOString())}</extracted_at>\n`;
        xml += `  <message_count>${entries.length}</message_count>\n`;
        xml += `  <depth_requested>${escapeXml(m.depthRequested || 'full')}</depth_requested>\n`;
        xml += `  <oldest_reached>${escapeXml(m.oldestReached || '')}</oldest_reached>\n`;
        xml += `  <thread>\n`;

        let lastDate = null;
        for (const { data, date } of entries) {
            if (!data) continue;

            if (date && date !== lastDate) {
                xml += `    <day_marker date="${escapeXml(date)}"/>\n`;
                lastDate = date;
            }

            const f = data.fields;
            switch (data.type) {
                case 'message':
                    xml += `    <message direction="${escapeXml(f.direction)}">\n`;
                    xml += field('sender', f.sender);
                    xml += field('time', f.time);
                    xml += field('body', f.body);
                    xml += `    </message>\n`;
                    break;

                case 'call':
                    xml += `    <call status="${escapeXml(f.status)}" direction="${escapeXml(f.direction)}">\n`;
                    xml += field('party', f.party);
                    xml += field('duration', f.duration);
                    xml += field('time', f.time);
                    if (f.transcript && f.transcript.length) {
                        xml += `      <transcript lines="${f.transcript.length}">\n`;
                        for (const ln of f.transcript) {
                            const t = ln.time ? ` time="${escapeXml(ln.time)}"` : '';
                            xml += `        <line${t}>${escapeXml(ln.text)}</line>\n`;
                        }
                        xml += `      </transcript>\n`;
                    } else {
                        xml += `      <transcript empty="true"/>\n`;
                    }
                    xml += `    </call>\n`;
                    break;

                case 'email':
                    xml += `    <email>\n`;
                    xml += field('subject', f.subject);
                    xml += field('from', f.from);
                    xml += field('time', f.time);
                    xml += field('preview', f.preview);
                    xml += field('body', f.body);
                    xml += `    </email>\n`;
                    break;

                case 'event':
                    xml += `    <event>\n`;
                    xml += field('text', f.text);
                    xml += field('date', f.date);
                    xml += `    </event>\n`;
                    break;

                default:
                    xml += `    <unknown>\n`;
                    xml += field('text', f.text);
                    xml += `    </unknown>\n`;
            }
        }

        xml += `  </thread>\n`;
        xml += `</ghl_conversation>`;
        return xml;
    }

    function buildJsonOutput(contactName, entries, meta) {
        const m = meta || {};
        return JSON.stringify({
            contact: contactName,
            extracted_at: new Date().toISOString(),
            message_count: entries.length,
            // The requested window and the oldest day chip actually seen. A short
            // export is then self-explaining instead of looking like a short thread.
            depth_requested: m.depthRequested || 'full',
            oldest_reached: m.oldestReached || null,
            // FIX BUG 1: Spread fields first, then override with wrapper date/type
            thread: entries.map(({ data, date }) => ({
                ...data.fields,
                type: data.type,
                date
            }))
        }, null, 2);
    }


    // ─── MAIN ─────────────────────────────────────────────────────────────────────

    let isRunning = false;

    async function runExtraction() {
        if (isRunning) return;

        // No window chosen -> no run. An unannounced bound is indistinguishable from
        // a silent truncation, so the choice is mandatory and per-run.
        if (!runDepth) {
            showMenu();
            showToast('⚠ Choose a depth first → menu → Depth', 'error', 5000);
            return;
        }
        const depthBound = resolveDepthBound(runDepth.mode, runDepth.value);
        const depth = depthBound
            ? { boundMs: depthBound.getTime(), parseDate: parseConversationDateLabel }
            : null;

        isRunning = true;
        shouldStop = false;
        const api = window.__scripts['GHL'];
        api.state = 'running'; api.message = 'Extracting conversation...'; api.output = null; api.error = null; api.progress = null; api.lastActivity = Date.now();
        toggle.classList.add('gx-working');
        toggle.innerHTML = '<span class="gx-toggle-emoji">⏹</span><span class="gx-toggle-label">Stop</span>';
        toggle.title = 'Click to stop extraction';
        closeMenu();

        try {
            // Name the resolved window BEFORE the run: a bounded load nobody
            // announced is exactly the silent truncation this picker exists to stop.
            const windowText = depth ? `back to ${isoDay(depthBound)} (${runDepth.label})` : 'full history';
            showToast(`Loading ${windowText}…`, 'success', 60000);
            harvestWholeThread._onLoadPharmacyB = (count, rounds) => {
                api.progress = { phase: 'load', messages: count, rounds };
                showToast(`Loading ${windowText}… ${count} messages so far`, 'success', 120000);
            };
            const result = await harvestWholeThread({ depth });

            if (shouldStop) {
                showToast('⏹ Extraction stopped during loading', 'error', 5000);
                api.state = 'idle'; api.message = 'Stopped during loading'; api.lastActivity = Date.now();
                return;
            }

            if (!result.container) {
                // The R18 state used to stay 'running' forever here, so the API lied
                // about a run that had already given up. Report it instead.
                showToast('⚠ Could not find the conversation scroll area', 'error', 6000);
                api.state = 'idle';
                api.message = 'No conversation scroll area (thread may not overflow its panel)';
                api.lastActivity = Date.now();
                return;
            }

            showToast('Building output...', 'success', 60000);
            const entries = result.entries;
            const contactName = getContactName();

            // What the run actually walked, recorded on the export itself so a short
            // file can be told apart from a short conversation.
            const meta = {
                depthRequested: isoDay(result.load.depthRequestedMs) || 'full',
                oldestReached: isoDay(result.oldestReachedMs),
                depthLabel: runDepth.label
            };

            let content;
            let mimeType;
            let extension;

            if (CONFIG.format === 'json') {
                content = buildJsonOutput(contactName, entries, meta);
                mimeType = 'application/json';
                extension = 'json';
            } else {
                content = buildXml(contactName, entries, meta);
                mimeType = 'text/xml';
                extension = 'xml';
            }

            // ALWAYS copy to clipboard (user-mandated): every run writes output, regardless of action
            if (typeof GM_setClipboard === 'function') {
                GM_setClipboard(content, 'text');
            } else {
                await navigator.clipboard.writeText(content);
            }

            // R18: expose output via the Script API
            api.output = content;
            api.state = 'done';
            api.message = `Extracted ${entries.length} items`;
            api.lastActivity = Date.now();

            // Download action still downloads (AND also copies, see above)
            if (CONFIG.action === 'download') {
                const blob = new Blob([content], { type: mimeType });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `ghl_conversation_${contactName.replace(/\s+/g, '_')}.${extension}`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }

            // Optionally download every file in the Documents panel
            let fileStats = null;
            if (CONFIG.files === 'download' && !shouldStop) {
                showToast('Downloading attached files…', 'success', 60000);
                fileStats = await downloadAllDocuments((done, total) => {
                    showToast(`Downloading files… ${done}/${total}`, 'success', 60000);
                });
            }

            if (shouldStop) {
                showToast('⏹ Extraction stopped', 'error', 5000);
                return;
            }

            // Diagnostics
            const counts = entries.reduce((a, e) => {
                if (e.data) a[e.data.type] = (a[e.data.type] || 0) + 1;
                return a;
            }, {});

            const transcriptsFound = entries.filter(
                e => e.data && e.data.type === 'call' &&
                     e.data.fields.transcript && e.data.fields.transcript.length
            ).length;

            // FIX BUG 2: Only count as "empty/fail" if it HAD a button but returned no lines
            const emptyTranscripts = entries.filter(
                e => e.data && e.data.type === 'call' &&
                     e.data.fields.hadTranscriptButton &&
                     e.data.fields.transcript.length === 0
            ).length;

            const actionText = CONFIG.action === 'copy' ? 'Copied' : 'Downloaded';
            let diagMsg = `✓ ${actionText} — Msgs: ${counts.message || 0} · Calls: ${counts.call || 0} ` +
                `(${transcriptsFound} transcripts) · Emails: ${counts.email || 0} · ` +
                `Events: ${counts.event || 0} · Total: ${entries.length}`;

            if (emptyTranscripts > 0) {
                diagMsg += `\n⚠ ${emptyTranscripts} call(s) had empty transcripts`;
            }

            if (fileStats) {
                if (!fileStats.opened) {
                    diagMsg += `\n📎 Could not open Documents panel`;
                } else if (fileStats.total === 0) {
                    diagMsg += `\n📎 No files found in Documents panel`;
                } else {
                    diagMsg += `\n📎 Files: ${fileStats.downloaded}/${fileStats.total} downloaded`;
                    if (fileStats.failed.length) {
                        diagMsg += ` (failed: ${fileStats.failed.join('; ')})`;
                    }
                }
            }

            // Instrumentation. load.ms and harvest.ms are separate measurements —
            // measure with these, never with a stopwatch on the outside.
            const stats = {
                load: {
                    rounds: result.load.rounds,
                    messages: result.load.finalCount,
                    ms: result.load.ms,
                    stopped: result.load.stopped,
                    depthRequested: meta.depthRequested,
                    oldestReached: meta.oldestReached
                },
                harvest: result.harvest,
                entries: entries.length,
                transcriptLines: result.transcriptLines
            };
            api.progress = stats;
            diagMsg += `\n⏱ ${((result.load.ms + result.harvest.ms) / 1000).toFixed(1)}s — ` +
                `load ${result.load.rounds}r/${(result.load.ms / 1000).toFixed(1)}s · ` +
                `harvest ${result.harvest.steps} steps/${(result.harvest.ms / 1000).toFixed(1)}s · ` +
                `${result.transcriptLines} transcript lines` +
                `\n🗓 window: ${meta.depthRequested} → oldest chip seen ${meta.oldestReached || 'unknown'}`;

            showToast(diagMsg, 'success', 9000);

        } catch (err) {
            console.error('[GHL Extractor]', err);
            showToast('✗ Extraction failed: ' + err.message, 'error', 6000);
            const api = window.__scripts['GHL'];
            api.state = 'error'; api.error = err.message; api.message = 'Failed: ' + err.message; api.lastActivity = Date.now();
        } finally {
            toggle.innerHTML = '<span class="gx-toggle-emoji">📋</span><span class="gx-toggle-label">Extract</span>';
            toggle.title = 'Extract conversation context (Drag to move · Right-click for options)';
            toggle.classList.remove('gx-working');
            isRunning = false;
            shouldStop = false;
            // Consumed by the run: the next extraction is asked for its window again.
            runDepth = null;
            const depthDisplay = document.getElementById('gx-display-depth');
            if (depthDisplay) depthDisplay.textContent = 'Choose…';
        }
    }

    // R18: trigger dispatcher
    const api = window.__scripts['GHL'];
    api.trigger = function (action) {
      if (action === 'extract') {
        if (api.state === 'running') return { ok: false, error: 'already running' };
        runExtraction();
        return { ok: true };
      }
      if (action === 'stop') {
        stopExtraction();
        return { ok: true };
      }
      return { ok: false, error: `unknown action: ${action}` };
    };

})();