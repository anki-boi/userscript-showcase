// ==UserScript==
// @name         Zoho CRM — Address Validator
// @namespace    http://tampermonkey.net/
// @version      1.9
// @description  Validates patient addresses on Zoho contacts: ZIP/city/state + street checks
// @author       Jeyson Dagondon
// @match        https://crm.zoho.com/crm/*/tab/Contacts/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[AddrVal v1.9] boot');

// ============================================================
// Zoho CRM — Address Validator v1.0 (2026-08-04)
// Reads the MailingStreet field (patients' full address is usually
// dumped there — verified live), parses US parts, and validates
// against Zippopotam.us (keyless, CORS-enabled, no credentials).
// Fatal = missing parts / nonexistent ZIP / state-ZIP mismatch /
// placeholder text / city PROVABLY not belonging to the ZIP (reverse
// lookup: city exists but its zips exclude this one). Warning =
// city unknown to the dataset (real aliases like "Sandy Springs" for
// 30342 which USPS lists as Atlanta — common and shippable, so it
// must NOT hard-fail), odd street text.
// Record-switch aware: re-runs when the contact id in the URL
// changes; waits for async field mount before declaring "no
// address" (SCRIPT-BEST-PRACTICES R1).
// Changelog: v1.4 street-level existence check via Nominatim/OSM (keyless,
// rate-limited, cached) — made-up streets and street↔ZIP mismatches warn
// (e.g. Ruby Salas "88 Salmon Way" maps to ZIP 99685, record says 99692);
// v1.3 parser fix — "Street, City ST ZIP" (no comma before
// state, e.g. Ruby Salas "88 Salmon Way, Dutch Harbor AK 99692") was
// misreported as missing state/ZIP; v1.2 city-provable-wrong -> red
// (reverse lookup); v1.1 no-comma "City ST ZIP" parsing; v1.0 initial.
// ============================================================

(function () {
  'use strict';

  // ---------- canonical helpers (small subset) ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function getContactId() {
    const m = location.pathname.match(/\/tab\/Contacts\/(\d+)/);
    return m ? m[1] : null;
  }

  function readMailingStreet() {
    // Primary: the zcqa value wrapper (layout-agnostic per site map).
    const el = document.querySelector('[data-zcqa="value_MailingStreet"]');
    if (el) return (el.textContent || '').trim();
    // Fallback: any cxElemCompViewWrap whose text ends in a ZIP.
    const wrap = [...document.querySelectorAll('span.cxElemCompViewWrap')]
      .find(e => /\b\d{5}(?:-\d{4})?\b$/.test((e.textContent || '').trim()));
    return wrap ? wrap.textContent.trim() : '';
  }

  // ---------- parsing ----------
  const US_STATES = new Set([
    'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
    'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
    'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
    'VA','WA','WV','WI','WY','DC','AS','GU','MP','PR','VI'
  ]);

  const PLACEHOLDER = /^(test|n\/?a|unknown|none|tbd|asdf|xxx|0|\.|no address|not (?:provided|given|available)|address|street)$/i;

  function normalizeCity(s) {
    return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  // "505 Forest Valley Rd, Sandy Springs, GA 30342" -> parts
  function parseAddress(raw) {
    const text = (raw || '').replace(/\s+/g, ' ').trim();
    if (!text) return { street: '', city: '', state: '', zip: '', raw: '' };
    const parts = text.split(',').map(s => s.trim());
    let street = '', city = '', state = '', zip = '';
    if (parts.length >= 3) {
      street = parts[0];
      const tail = parts[parts.length - 1];
      const m = tail.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
      if (m) {
        state = m[1].toUpperCase();
        zip = m[2];
        city = parts.slice(1, -1).join(', ');
      } else if (/^\d{5}(?:-\d{4})?$/.test(tail)) {
        zip = tail;
        state = (parts[parts.length - 2] || '').toUpperCase();
        if (!US_STATES.has(state)) state = '';
        city = parts.slice(1, -2).join(', ');
      }
    } else if (parts.length === 2) {
      street = parts[0];
      const tail = parts[1];
      const m = tail.match(/^([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
      if (m) { state = m[1].toUpperCase(); zip = m[2]; }
      else {
        // "City ST ZIP" in one segment (no comma before state) e.g.
        // "Dutch Harbor AK 99692" — verified real-world shape (Ruby Salas).
        const mc = tail.match(/^(.*?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
        if (mc && US_STATES.has(mc[2].toUpperCase())) {
          city = mc[1].trim();
          state = mc[2].toUpperCase();
          zip = mc[3];
        }
        else if (/^\d{5}(?:-\d{4})?$/.test(tail)) { zip = tail; city = ''; }
        else city = tail;
      }
    } else {
      // Single line: try trailing "ST ZIP" / "ZIP" forms.
      const m = text.match(/^(.+?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
      if (m) { street = m[1].trim(); state = m[2].toUpperCase(); zip = m[3]; }
      else {
        // no commas: "456 Oak Dr Miami FL 33101" -> street, state, zip
        const ms = text.match(/^(.*?)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)$/);
        if (ms && US_STATES.has(ms[2].toUpperCase())) { street = ms[1].trim(); state = ms[2].toUpperCase(); zip = ms[3]; }
        else {
          const z = text.match(/^(.*?)\s+(\d{5}(?:-\d{4})?)$/);
          if (z) { street = z[1].trim(); zip = z[2]; }
          else street = text;
        }
      }
    }
    return { street, city, state, zip, raw: text };
  }

  // ---------- Zippopotam.us lookup (keyless, cached) ----------
  const zipCache = new Map();
  const cityCache = new Map(); // "STATE|city" -> { found: bool, zips: [] }
  async function lookupZip(zip) {
    if (zipCache.has(zip)) return zipCache.get(zip);
    try {
      const r = await fetch('https://api.zippopotam.us/us/' + encodeURIComponent(zip), { signal: AbortSignal.timeout(8000) });
      if (!r.ok) { zipCache.set(zip, { exists: false }); return { exists: false }; }
      const j = await r.json();
      const places = (j.places || []).map(p => ({
        city: normalizeCity(p['place name']),
        state: (p['state abbreviation'] || '').toUpperCase()
      }));
      const out = { exists: true, places };
      zipCache.set(zip, out);
      return out;
    } catch (e) {
      return { exists: null, error: String(e) }; // network fail -> unknown, not "invalid"
    }
  }

  // Reverse: which zips does this city (in this state) actually belong to?
  // Returns { found: bool, zips: [] } — found=false means the city is NOT in
  // Zippopotam's dataset (common for real alias cities like Sandy Springs), so
  // callers must treat that as AMBIGUOUS, not "wrong".
  async function lookupCityZips(state, city) {
    const key = (state + '|' + normalizeCity(city));
    if (cityCache.has(key)) return cityCache.get(key);
    try {
      const r = await fetch('https://api.zippopotam.us/us/' + encodeURIComponent(state) + '/' + encodeURIComponent(city), { signal: AbortSignal.timeout(8000) });
      const j = r.ok ? await r.json() : null;
      const zips = j && Array.isArray(j.places) ? j.places.map(p => p['post code']).filter(Boolean) : [];
      const out = { found: !!zips.length, zips };
      cityCache.set(key, out);
      return out;
    } catch (e) {
      return { found: null, zips: [], error: String(e) }; // network fail -> unknown
    }
  }

  // Street-level existence check via Nominatim (OpenStreetMap) — keyless, CORS
  // verified live 2026-08-04. Catches MADE-UP streets (not found) and
  // street-vs-zip mismatches (found, but a DIFFERENT zip than the record).
  // NOT authoritative (OSM coverage gaps exist) -> verdict is a WARNING, never
  // fatal. Rate-limited to >=1s between requests per Nominatim usage policy.
  const streetCache = new Map(); // normalized query -> result
  let lastStreetReq = 0;
  async function lookupStreet(street, city, state, zip) {
    const key = normalizeCity([street, city, state, zip].filter(Boolean).join('|'));
    if (streetCache.has(key)) return streetCache.get(key);
    const wait = Math.max(0, 1000 - (Date.now() - lastStreetReq));
    if (wait) await sleep(wait);
    lastStreetReq = Date.now();
    try {
      const q = encodeURIComponent([street, city, state, zip].filter(Boolean).join(', '));
      const r = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + q, { signal: AbortSignal.timeout(8000) });
      const j = r.ok ? await r.json() : [];
      const hit = j[0] || null;
      const out = hit ? {
        found: true,
        display: hit.display_name || '',
        zip: (hit.address && hit.address.postcode) || '',
        type: hit.addresstype || ''
      } : { found: false };
      streetCache.set(key, out);
      return out;
    } catch (e) {
      return { found: null, error: String(e) }; // network fail -> unknown
    }
  }

  // ---------- validation ----------
  async function validate(raw) {
    const p = parseAddress(raw);
    const checks = [];
    const add = (key, ok, msg) => checks.push({ key, ok, msg });

    if (!p.raw) {
      add('street', false, 'No address in MailingStreet');
      return { fatal: true, checks, parsed: p, zipLookup: null };
    }

    // Fatal group
    add('street', !!p.street && !PLACEHOLDER.test(p.street), p.street ? (PLACEHOLDER.test(p.street) ? 'Street looks like placeholder text' : 'Street present') : 'Missing street');
    add('city', !!p.city && !PLACEHOLDER.test(p.city), p.city ? 'City present' : 'Missing city');
    add('state', !!p.state && US_STATES.has(p.state), p.state ? (US_STATES.has(p.state) ? `State ${p.state} present` : `"${p.state}" is not a US state code`) : 'Missing state');
    add('zip', /^\d{5}(?:-\d{4})?$/.test(p.zip), p.zip ? 'ZIP present, 5/9-digit format' : 'Missing ZIP');

    const zipOk = /^\d{5}(?:-\d{4})?$/.test(p.zip);
    let lookup = null;
    if (zipOk) {
      lookup = await lookupZip(p.zip);
      if (lookup.error) {
        add('zipExists', null, 'Could not verify ZIP (network) — heuristic check only');
      } else if (!lookup.exists) {
        add('zipExists', false, `ZIP ${p.zip} not found in USPS data`);
      } else {
        add('zipExists', true, `ZIP ${p.zip} exists`);
        const stateMatch = lookup.places.some(pl => pl.state === p.state);
        if (p.state) {
          add('stateMatch', stateMatch, stateMatch
            ? `State ${p.state} matches ZIP ${p.zip}`
            : `State ${p.state} does NOT match ZIP ${p.zip} (${[...new Set(lookup.places.map(pl => pl.state))].join('/')})`);
        }
        if (p.city) {
          const cn = normalizeCity(p.city);
          const cityMatch = lookup.places.some(pl => pl.city === cn || cn.includes(pl.city) || pl.city.includes(cn));
          if (cityMatch) {
            add('cityMatch', true, `City "${p.city}" matches ZIP ${p.zip}`);
          } else {
            // No direct match: is the city provably wrong, or just an alias
            // Zippopotam doesn't know (Sandy Springs for 30342)?
            const rev = await lookupCityZips(p.state, p.city);
            if (rev.found === null) {
              add('cityMatch', null, `Could not verify city "${p.city}" vs ZIP ${p.zip} (network) — verify manually`);
            } else if (rev.found && !rev.zips.includes(p.zip)) {
              // The city exists and belongs to DIFFERENT zips — provably wrong.
              add('cityWrong', false, `City "${p.city}" does NOT belong to ZIP ${p.zip} (its zips: ${rev.zips.slice(0, 6).join(', ')}${rev.zips.length > 6 ? ', …' : ''}) — patient likely gave the wrong city`);
            } else if (rev.found && rev.zips.includes(p.zip)) {
              add('cityMatch', true, `City "${p.city}" belongs to ZIP ${p.zip}`);
            } else {
              // City unknown to the dataset -> ambiguous (real alias OR wrong
              // city in a different state). Warn only; the Google button
              // resolves it fast (team's manual workflow).
              add('cityMatch', false, `City "${p.city}" is not the primary name for ZIP ${p.zip} (e.g. ${lookup.places.map(pl => pl.city).join(', ')}) — verify with patient (could be a valid alias or the wrong city)`);
            }
          }
        }
      }
    }

    // Warning-only: street text sanity
    if (p.street && !PLACEHOLDER.test(p.street)) {
      const hasNumber = /\d/.test(p.street);
      const looksLikeAddr = /(street|st|ave|avenue|blvd|rd|road|dr|drive|lane|ln|court|ct|way|pl|place|ter|terrace|hwy|highway|pkwy|parkway|loop|cir|circle|sq|square|bvd|p\.?o\.?\s*box|unit|apt|#)/i.test(p.street);
      add('streetShape', hasNumber && looksLikeAddr, hasNumber && looksLikeAddr
        ? 'Street has number + thoroughfare'
        : 'Street text looks unusual (no number/thoroughfare) — verify');
    }

    // Street-level existence check (Nominatim/OSM, keyless) — catches made-up
    // streets and street↔ZIP mismatches. Warning severity: OSM has coverage
    // gaps, so "not found" is a verify-signal, not proof of wrong.
    // Only runs when the ZIP EXISTS — a bogus zip is already fatal red; no
    // point geocoding (and no API noise on top of the red).
    if (zipOk && lookup && lookup.exists && p.street && !PLACEHOLDER.test(p.street)) {
      const sl = await lookupStreet(p.street, p.city, p.state, p.zip);
      if (sl.found === null) {
        add('streetFound', null, 'Could not verify street on the map (network) — verify manually');
      } else if (!sl.found) {
        add('streetFound', false, `Street "${p.street}" not found on the map near ${p.city || '?'}, ${p.state} — may be a made-up/wrong street, or a map gap; verify`);
      } else {
        const recZip = p.zip.replace('-', '');
        const osmZip = (sl.zip || '').replace('-', '');
        if (osmZip && osmZip !== recZip) {
          add('streetFound', false, `Street "${p.street}" maps to ZIP ${osmZip}, but the record says ${p.zip} — verify which is correct`);
        } else {
          add('streetFound', true, `Street "${p.street}" exists near ${p.city || '?'}, ${p.state}${osmZip ? ' (ZIP ' + osmZip + ')' : ''}`);
        }
      }
    }

    const fatal = checks.some(c => c.ok === false && ['street', 'city', 'state', 'zip', 'zipExists', 'stateMatch', 'cityWrong'].includes(c.key));
    const warns = checks.some(c => c.ok === false && ['cityMatch', 'streetShape', 'streetFound'].includes(c.key));
    const unknown = checks.some(c => c.ok === null);
    return { fatal, warns, unknown, checks, parsed: p, zipLookup: lookup };
  }

  // ---------- UI ----------
  let chipEl = null;
  let panelEl = null;
  let currentId = null;
  let inFlight = false;

  function topPanelHost() {
    return document.querySelector('#crmNextGenTopMenu [data-zcqa="appTopMenuTitle"]')
      || document.querySelector('#crmNextGenTopMenu .flexAlignCenter')
      || document.querySelector('#crmNextGenTopMenu');
  }

  function ensureStyle() {
    if (document.getElementById('zav-style')) return;
    const st = document.createElement('style');
    st.id = 'zav-style';
    st.textContent = `
      :root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}
      #zav-chip {
        display: inline-flex !important; align-items: center !important; gap: 5px !important;
        margin: 0 0 0 10px !important; padding: 3px 10px !important;
        font: 600 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        border-radius: 999px !important; cursor: pointer !important; user-select: none !important;
        border: 1px solid transparent !important; vertical-align: middle !important;
      }
      #zav-chip.zav-ok { background: #e6f4ea !important; color: var(--ds-success, #137333) !important; border-color: var(--ds-success, #137333) !important; }
      #zav-chip.zav-warn { background: #fef7e0 !important; color: var(--ds-warn, #b06000) !important; border-color: var(--ds-warn, #b06000) !important; }
      #zav-chip.zav-bad { background: #fce8e6 !important; color: var(--ds-danger, #c5221f) !important; border-color: var(--ds-danger, #c5221f) !important; }
      #zav-chip.zav-na { background: var(--ds-surface2, #f1f3f4) !important; color: var(--ds-muted, #5f6368) !important; border-color: var(--ds-border, #dadce0) !important; }
      #zav-chip.zav-checking { background: #e8f0fe !important; color: var(--ds-accent, #1a73e8) !important; border-color: var(--ds-accent, #1a73e8) !important; }
      #zav-panel {
        position: fixed !important; right: 16px !important; top: 64px !important; z-index: 99999 !important;
        width: 340px !important; max-height: 70vh !important; overflow: auto !important;
        background: var(--ds-surface, #fff) !important; border: 1px solid var(--ds-border, #dadce0) !important; border-radius: 10px !important;
        box-shadow: 0 2px 8px rgba(31,45,61,.08) !important; padding: 12px 14px !important;
        font: 13px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        color: var(--ds-text, #202124) !important;
      }
      #zav-panel h4 { margin: 0 0 8px !important; font-size: 13px !important; }
      #zav-panel .zav-addr { margin: 0 0 10px !important; padding: 6px 8px !important; background: var(--ds-surface2, #f8f9fa) !important; border-radius: 6px !important; font-size: 12px !important; white-space: pre-wrap !important; }
      #zav-panel .zav-line { display: flex !important; gap: 6px !important; align-items: flex-start !important; margin: 3px 0 !important; }
      #zav-panel .zav-line .zav-ico { flex: 0 0 16px !important; text-align: center !important; }
      #zav-panel .zav-line.ok { color: var(--ds-success, #137333) !important; }
      #zav-panel .zav-line.warn { color: var(--ds-warn, #b06000) !important; }
      #zav-panel .zav-line.bad { color: var(--ds-danger, #c5221f) !important; }
      #zav-panel .zav-line.na { color: var(--ds-muted, #5f6368) !important; }
      #zav-panel .zav-google {
        display: block !important; width: 100% !important; margin: 10px 0 2px !important;
        padding: 7px 10px !important; font: 600 12px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
        background: #1a73e8 !important; color: #fff !important; border: none !important;
        border-radius: 6px !important; cursor: pointer !important; text-align: center !important;
      }
      #zav-panel .zav-google:hover { background: #1765cc !important; }
    `;
    document.head.appendChild(st);
  }

  function setChip(state, label) {
    if (!chipEl) return;
    chipEl.className = 'zav-' + state;
    chipEl.textContent = label;
  }

  function renderPanel(res) {
    if (!panelEl) {
      panelEl = document.createElement('div');
      panelEl.id = 'zav-panel';
      document.body.appendChild(panelEl);
    }
    const p = res.parsed;
    const lines = res.checks.map(c => {
      const cls = c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'na';
      const ico = c.ok === true ? '✓' : c.ok === false ? '✗' : '?';
      return `<div class="zav-line ${cls}"><span class="zav-ico">${ico}</span><span>${c.msg}</span></div>`;
    }).join('');
    panelEl.innerHTML = `<h4>Address check</h4>` +
      (p.raw ? `<div class="zav-addr">${p.raw.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>` : '') +
      lines +
      (p.raw ? `<button class="zav-google">🔍 Google this address</button>` : '');
    // Google the address — the team's manual resolution workflow, one click.
    const gBtn = panelEl.querySelector('.zav-google');
    if (gBtn) {
      gBtn.addEventListener('click', () => {
        const q = [p.street, p.city, p.state, p.zip].filter(Boolean).join(', ') || p.raw;
        window.open('https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q), '_blank');
      });
    }
  }

  // ---------- main run ----------
  async function run() {
    const id = getContactId();
    if (!id || id === currentId && chipEl) return; // no change
    if (inFlight) return;
    inFlight = true;
    currentId = id;

    ensureStyle();
    let host = topPanelHost();
    if (!chipEl && host) {
      chipEl = document.createElement('span');
      chipEl.id = 'zav-chip';
      chipEl.title = 'Click for address breakdown';
      chipEl.addEventListener('click', () => {
        if (panelEl) { panelEl.remove(); panelEl = null; return; }
        // re-run so the panel shows fresh data
        const raw = readMailingStreet();
        validate(raw).then(r => { renderPanel(r); });
      });
      host.appendChild(chipEl);
    }

    setChip('checking', '⏳ address…');

    // R1: fields mount async (~8-15s after hard reload). Poll until we get
    // SOMETHING in MailingStreet, or give up after ~15s and report honestly.
    let raw = readMailingStreet();
    const deadline = Date.now() + 15000;
    while (!raw && Date.now() < deadline) {
      await sleep(1500);
      raw = readMailingStreet();
      host = topPanelHost();
      if (chipEl && host && !host.contains(chipEl)) host.appendChild(chipEl); // re-dock
    }

    const res = await validate(raw);
    if (res.fatal) setChip('bad', '⚠ Address INVALID');
    else if (res.warns) setChip('warn', '⚠ Address: verify');
    else if (res.unknown) setChip('na', '⏳ unverified');
    else if (!raw) setChip('na', '— no address');
    else setChip('ok', '✓ Address OK');
    inFlight = false;
  }

  // Record switch: poll the contact id (Zoho's router doesn't reliably fire popstate).
  let lastId = getContactId();
  setInterval(() => {
    const id = getContactId();
    if (id !== lastId) {
      lastId = id;
      currentId = null;      // force re-run
      inFlight = false;
      if (panelEl) { panelEl.remove(); panelEl = null; }
      run();
    }
  }, 1500);

  // Initial run + late-mount re-runs (R1: don't trust one early snapshot).
  run();
  setTimeout(run, 5000);
  setTimeout(run, 12000);
})();
