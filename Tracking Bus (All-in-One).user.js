// ==UserScript==
// @name         Tracking Bus (All-in-One)
// @namespace    drjones-trackbus
// @version      2.33
// @author       Jeyson Dagondon
// @description  Fetch blank days (configurable), parse rows, auto-open UPS/FedEx, extract DS+TN
// @match        https://docs.google.com/spreadsheets/*
// @match        *://www.fedex.com/*
// @match        *://*.fedex.com/*
// @match        https://www.ups.com/track*
// @match        https://www.ups.com/WebTracking/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_setClipboard
// @grant        GM_addStyle
// @run-at       document-start
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[TrackBus v2.33] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['TrackBus'] = {
  name: 'Tracking Bus (All-in-One)',
  version: '2.33',
  state: 'idle',
  message: '',
  progress: null,
  output: null,
  error: null,
  lastActivity: Date.now(),
  trigger: null
};

(function () {
  'use strict';

  console.log('[TrackBus] BOOT', location.hostname, window.top === window.self);
  if (window.top !== window.self) return;

  var HOST = location.hostname;
  var LOG = function () {
    var a = Array.prototype.slice.call(arguments);
    a.unshift('[TrackBus]');
    console.log.apply(console, a);
  };

  /* ============================================================
     SHARED
     ============================================================ */

  function toast(msg, success) {
    var el = document.createElement('div');
    el.textContent = msg;
    Object.assign(el.style, {
      position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '2147483647', padding: '14px 28px', fontSize: '16px', fontWeight: '700',
      background: success ? '#22c55e' : '#ef4444', color: '#fff',
      borderRadius: '10px', boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
      transition: 'opacity 0.3s', opacity: '1', fontFamily: 'system-ui, sans-serif'
    });
    (document.body || document.documentElement).appendChild(el);
    setTimeout(function () { el.style.opacity = '0'; }, 600);
    setTimeout(function () { el.remove(); }, 900);
  }

  function publish(tn, date, carrier) {
    // v2.3: copy Date Shipped + TN to the clipboard in the EXACT format the
    // standalone UPS/FedEx Tracking Copier scripts use, so Tracking Bus and
    // the copiers go hand in hand — whichever fires, the pair is copiable.
    var text = '\nDate Shipped: ' + date + '\nTN: ' + carrier + ' - ' + tn;
    LOG('publish', tn, date, carrier);
    // v2.7: storage handoff for the sheet-side auto-drive (the controller
    // polls this key after opening each carrier link). Restored from v2.2 —
    // now it finally has a consumer. Harmless on manual opens.
    GM_setValue('tb:' + tn, JSON.stringify({ date: date, carrier: carrier, ts: Date.now() }));
    var close = function () {
      toast('✓ Tracking copied', true);
      // v2.31 (Jeyson): one-tab-at-a-time runs REUSE this tab — while the
      // sheet's tb:seq flag is set, do NOT self-close (the controller
      // navigates this tab to the next TN and closes it at run end).
      // Manual opens (flag unset) still close as before.
      var seqMode = false;
      try { seqMode = GM_getValue('tb:seq', 0) === 1; } catch (e) { seqMode = false; }
      if (!seqMode) setTimeout(function () { window.close(); }, 700);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(close)
        .catch(function () {
          // v2.5: clipboard-write rejects without focus/transient activation
          // (e.g. a tracking tab that rendered in the background). GM_setClipboard
          // writes regardless — belt and suspenders over the copiers.
          try { GM_setClipboard(text, 'text'); close(); }
          catch (e) { toast('⚠ Copy failed', false); }
        });
    } else {
      GM_setClipboard(text, 'text');
      close();
    }
  }

  function normalizeDate(raw) {
    var p = raw.trim().split('/');
    if (p.length !== 3) return raw.trim();
    return parseInt(p[0], 10) + '/' + parseInt(p[1], 10) + '/' + p[2].slice(-2);
  }

  /* ============================================================
     FEDEX EXTRACTOR
     ============================================================ */

  function runFedEx() {
    var started = false;

    function getTracking() {
      var label = document.querySelector('#menuTitle');
      if (label && label.nextElementSibling) {
        var t = label.nextElementSibling.textContent.trim();
        if (/^\d{9,}$/.test(t)) return t;
      }
      var spans = document.querySelectorAll('span.fdx-c-navbar__title, span');
      for (var i = 0; i < spans.length; i++) {
        var s = spans[i].textContent.trim();
        if (/^\d{12,}$/.test(s)) return s;
      }
      var m = location.href.match(/trknbr=(\d{9,})/i);
      return m ? m[1] : null;
    }

    function extractDateFromRow(row) {
      var dateEl = row.querySelector('.travel-history-table__scan-event-date span');
      var src = dateEl ? dateEl.textContent : row.textContent;
      var m = src.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
      return m ? normalizeDate(m[1]) : null;
    }

    function getShipDate() {
      var rows = Array.prototype.slice.call(
        document.querySelectorAll('tr.travel-history-table__row'));
      LOG('fedex rows:', rows.length);
      if (!rows.length) return null;
      for (var i = 0; i < rows.length; i++) {
        if (/shipment information sent/i.test(rows[i].textContent)) {
          var d = extractDateFromRow(rows[i]);
          if (d) return d;
        }
      }
      return extractDateFromRow(rows[rows.length - 1]);
    }

    function clickViewHistory() {
      var els = document.querySelectorAll('a, button');
      for (var i = 0; i < els.length; i++) {
        var t = els[i].textContent.trim().toLowerCase();
        if (t === 'view more details' ||
            t.indexOf('view more details') !== -1 ||
            t.indexOf('view history') !== -1 ||
            t.indexOf('travel history') !== -1) {
          els[i].click();
          return true;
        }
      }
      return false;
    }

    function proceed(trackingNum) {
      if (started) return;
      started = true;
      LOG('fedex proceed:', trackingNum);

      var finished = false;
      var rowObserver = null;

      function finish() {
        if (finished) return;
        finished = true;
        if (rowObserver) rowObserver.disconnect();
        var shipDate = getShipDate();
        if (!trackingNum || !shipDate) {
          LOG('fedex FAIL - tn:', trackingNum, 'date:', shipDate);
          toast('No tracking data found', false);
          return;
        }
        publish(trackingNum, shipDate, 'FedEx');
      }

      function watchRows() {
        rowObserver = new MutationObserver(function () {
          var rows = document.querySelectorAll('tr.travel-history-table__row');
          if (!rows.length) return;
          var hasOrigin = false;
          for (var i = 0; i < rows.length; i++) {
            if (/shipment information sent/i.test(rows[i].textContent)) hasOrigin = true;
          }
          if (hasOrigin) setTimeout(finish, 200);
        });
        rowObserver.observe(document.body, { childList: true, subtree: true });
        if (document.querySelector('tr.travel-history-table__row')) {
          setTimeout(finish, 400);
        }
      }

      var deadline = Date.now() + 25000;
      var clicked = false;
      var poll = setInterval(function () {
        if (finished) { clearInterval(poll); return; }
        if (document.querySelector('tr.travel-history-table__row')) {
          clearInterval(poll); watchRows(); return;
        }
        if (!clicked && clickViewHistory()) {
          clicked = true; clearInterval(poll); watchRows(); return;
        }
        if (Date.now() > deadline) {
          clearInterval(poll); watchRows(); setTimeout(finish, 500);
        }
      }, 400);

      setTimeout(finish, 30000);
    }

    var tnNow = getTracking();
    if (tnNow) { proceed(tnNow); return; }

    // v2.4: documentElement (body is null at document-start); 30s patience.
    var obs = new MutationObserver(function () {
      var tn = getTracking();
      if (tn) { obs.disconnect(); clearTimeout(fedexTimer); proceed(tn); }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    var fedexTimer = setTimeout(function () { obs.disconnect(); proceed(getTracking()); }, 30000);
  }

  /* ============================================================
     UPS EXTRACTOR
     ============================================================ */

  function runUPS() {
    var done = false;

    function extract() {
      var tnEl = document.querySelector(
        'span.mb-0.ups-txt-black.ups-txt_size_md.ups-txt-weight_medium');
      var trackingNum = tnEl ? tnEl.textContent.trim() : null;
      if (!trackingNum) {
        var m = location.href.match(/trackNums=(1Z[A-Z0-9]+)/i);
        if (m) trackingNum = m[1];
      }
      var billedEl = document.querySelector('#stApp_txtAdditionalInfoBilledOn');
      var billedRaw = billedEl ? billedEl.textContent.trim() : null;
      if (!trackingNum || !billedRaw) return null;
      var p = billedRaw.split('/');
      if (p.length !== 3) return null;
      return {
        tn: trackingNum,
        date: parseInt(p[0], 10) + '/' + parseInt(p[1], 10) + '/' + p[2].slice(-2)
      };
    }

    function go() {
      if (done) return;
      done = true;
      var r = extract();
      if (!r) { LOG('ups FAIL'); toast('No tracking data found', false); return; }
      publish(r.tn, r.date, 'UPS');
    }

    // v2.4: observe documentElement — document.body is NULL at document-start,
    // and MutationObserver.observe(null) threw, killing the extractor before
    // the fallback timer even started (confirmed live 2026-08-05). 30s
    // patience: UPS renders the billed element late on cold loads.
    var observer = new MutationObserver(function () {
      if (done) return;
      if (document.querySelector('#stApp_txtAdditionalInfoBilledOn')) {
        clearTimeout(fallbackTimer);
        setTimeout(go, 300);
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    if (document.querySelector('#stApp_txtAdditionalInfoBilledOn')) setTimeout(go, 300);
    var fallbackTimer = setTimeout(function () {
      observer.disconnect();
      go();
    }, 30000);
  }

  /* ============================================================
     SHEETS CONTROLLER (v2.0)
     Paste sheet rows -> quote-aware CSV/TSV parse -> JSON table.
     Results panel: click a cell to copy it (patient / carrier /
     tracking # / date). No sheet writes, no tab fetching.
     ============================================================ */

  function runController() {
    var box, btn, driveBtn, status, resultsPanel, resultsBody;
    var lfFetchBtn, daysInput, lfPortalWin = null, lfCleanup = null;
    var rowStatus = [], statusCells = [], dateCells = [], openedAt = [];
    var currentDateLabel = 'Date Shipped';
    var headDateEl = null;
    var currentItems = []; // last parsed/rendered rows (write-back reads extracted dates from here)
    // v2.9: Zoho patient-search link — same org + URL shape as the
    // Cross-Platform Contact Toolkit's ZOHO_URL (and its Zoho-side handler
    // v2.26 (Jeyson): the patient-name Zoho hyperlink is GONE — the name is a
    // plain copy button (helpers removed with it).

    // v2.17: LifeFile portal map (parity with Cross-Platform Contact Toolkit's
    // LF_PHARMACY_URL_MAP — self-contained copy, no @require). The fetch button
    // opens the pharmacy LOGIN URL with an lfSale intent; the portal-side
    // Session Handler auto-logs in and routes to the order-status page, and the
    // Order Status Extractor runs the date-range extract + copies all pages.
    var LF_PHARMACY_URL_MAP = [
      { key: 'pharmacya',   name: 'Pharmacy A',              host: 'hostB',      url: 'https://hostB.lifefile.net/application_main_zfw/login/login/vendor_name/vendorA/frm/stdlogin/access/doctor' },
      { key: 'progress',  name: 'Progress (Apex/Pharmacy B)', host: 'hostC:8443', url: 'https://hostC.lifefile.net:8443/application_main_zfw/login/login/vendor_name/vendorB/frm/stdlogin/access/doctor' },
      { key: 'pharmacyc', name: 'Pharmacy C',           host: 'hostA',      url: 'https://hostA.lifefile.net/application_main_zfw/login/login/vendor_name/vendorC/access/doctor' },
      { key: 'pharmacyd', name: 'Pharmacy D',            host: 'hostA',      url: 'https://hostA.lifefile.net/application_main_zfw/login/login/vendor_name/pharmacyd/frm/stdlogin/access/doctor' },
      { key: 'pharmacye', name: 'Pharmacy E',       host: 'hostB',      url: 'https://hostB.lifefile.net/application_main_zfw/login/login/access/doctor/vendor_name/vendorE/logout/1' },
      { key: 'pharmacyf',  name: 'Pharmacy F',            host: 'hostD',      url: 'https://hostD.lifefile.net/application_main_zfw/login/login/vendor_name/vendorF/access/doctor' },
      { key: 'pharmacyg',  name: 'Pharmacy G (LDN)',      host: 'hostD',      url: 'https://hostD.lifefile.net/application_main_zfw/login/login/vendor_name/vendorG/access/doctor' }
    ];

    function parseDelimited(text) {
      // Quote-aware CSV/TSV: cells can contain real newlines (the
      // tracking cell is "Date Shipped: 8/3/26\nTN: UPS - 1Z...")
      var tabCount = 0, commaCount = 0;
      var probe = text.split('\n').slice(0, 3).join('\n');
      for (var i = 0; i < probe.length; i++) {
        if (probe[i] === '\t') tabCount++;
        if (probe[i] === ',') commaCount++;
      }
      var delim = tabCount > commaCount ? '\t' : ',';

      var rows = [], row = [], cur = '', inQ = false;
      for (i = 0; i < text.length; i++) {
        var ch = text[i];
        if (inQ) {
          if (ch === '"') {
            if (text[i + 1] === '"') { cur += '"'; i++; }
            else inQ = false;
          } else cur += ch;
        } else if (ch === '"' && cur === '') {
          inQ = true;
        } else if (ch === '"') {
          cur += ch;
        } else if (ch === delim) {
          row.push(cur); cur = '';
        } else if (ch === '\n') {
          row.push(cur); rows.push(row); row = []; cur = '';
        } else if (ch.charCodeAt(0) === 13) {
          // skip CR (CRLF handled by \n)
        } else {
          cur += ch;
        }
      }
      row.push(cur); rows.push(row);
      return rows;
    }

    function findHeader(rows) {
      for (var i = 0; i < Math.min(rows.length, 5); i++) {
        var row = rows[i];
        var joined = row.join(' ').toLowerCase();
        if (!/patient|track|ship|date/i.test(joined)) continue;
        // A real header row has short label cells; a data row has a TN,
        // a date, or a 40+ char blob ("Date Shipped: 8/3/26\nTN: 1Z...").
        var looksData = false;
        for (var c = 0; c < row.length; c++) {
          var cell = String(row[c] || '');
          if (cell.length > 40) { looksData = true; break; }
          if (extractTN(cell) || extractDate(cell)) { looksData = true; break; }
        }
        if (!looksData) return i;
      }
      return -1;
    }

    function extractTN(text) {
      var m = String(text || '').match(/(1Z[A-Z0-9]{16}|\d{12,22})/i);
      return m ? m[1] : '';
    }

    function extractDate(text) {
      var m = String(text || '').match(/Date Shipped:\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
      if (m) return m[1];
      m = String(text || '').match(/(\d{1,2}\/\d{1,2}\/\d{2,4})/);
      return m ? m[1] : '';
    }

    function carrierOf(tn) {
      if (/^1Z/i.test(tn)) return 'UPS';
      if (/^\d{12,22}$/.test(tn)) return 'FedEx';
      return '';
    }

    function parseToJSON() {
      var rows = parseDelimited(box.value);
      var headerIdx = findHeader(rows);
      var cols = { patient: -1, track: -1, date: -1, shipDate: -1, orderDate: -1, meds: -1 };
      var hdrRaw = null;
      if (headerIdx >= 0) {
        hdrRaw = rows[headerIdx].map(function (h) { return String(h).trim(); });
        var hdr = hdrRaw.map(function (h) { return h.toLowerCase(); });
        for (var i = 0; i < hdr.length; i++) {
          if (cols.patient === -1 && /patient/.test(hdr[i])) cols.patient = i;
          if (cols.track === -1 && /track/.test(hdr[i])) cols.track = i;
          if (cols.shipDate === -1 && /date\s*ship|ship\s*date|shipped/.test(hdr[i])) cols.shipDate = i;
          // v2.23 (Jeyson): the ORDER date (PON column B "Date Ordered") is
          // separate from the shipped date — keep it out of the generic slot.
          if (cols.orderDate === -1 && /date\s*order|order\s*date|target_c2/.test(hdr[i])) cols.orderDate = i;
          if (cols.meds === -1 && /medication|product/.test(hdr[i])) cols.meds = i;
          if (cols.date === -1 && /date/.test(hdr[i]) && !/ship/.test(hdr[i]) && !/order/.test(hdr[i])) cols.date = i;
        }
      }

      var out = [];
      for (i = headerIdx + 1; i < rows.length; i++) {
        var cells = rows[i];
        var joined = cells.join(' ');
        if (!joined.trim()) continue;

        var cellTN = cols.track >= 0 ? cells[cols.track] : '';
        var tn = extractTN(cellTN) || extractTN(joined);
        if (!tn) continue; // row has no tracking number -> skip

        var patient = cols.patient >= 0 ? String(cells[cols.patient] || '').trim() : '';
        if (!patient) {
          // v2.10 (Jeyson: "patient names are column E"): headerless fallback
          // tries column E (5th cell) first — it must NOT grab the batch
          // number (col A "4"), pharmacy (C), Rx # (D, numeric), status (I),
          // or FALSE cells. Then "Last, First" comma names anywhere, then any
          // text-looking cell.
          var nameLike = function (s) {
            s = String(s || '').trim();
            if (!s || extractTN(s) || extractDate(s) || carrierOf(s)) return false;
            if (!/[A-Za-z]/.test(s)) return false;
            return !/^(false|true|verified|labeled|shipped|rx shipping pickup|rx scheduled|rx cancelled|pharmacya|progress|pharmacy c|pharmacyd|pharmacyj)$/i.test(s);
          };
          if (nameLike(cells[4])) {
            patient = String(cells[4]).trim();
          } else {
            for (var c = 0; c < cells.length; c++) {
              var v = String(cells[c] || '').trim();
              if (nameLike(v) && /^[A-Za-z][A-Za-z .'\u2019-]*,\s+[A-Za-z]/.test(v)) { patient = v; break; }
            }
            if (!patient) {
              for (var c2 = 0; c2 < cells.length; c2++) {
                var v2 = String(cells[c2] || '').trim();
                if (nameLike(v2)) { patient = v2; break; }
              }
            }
          }
        }

        // v2.6 (Jeyson): a sheet date column is often the ORDER date, not the
        // ship date — the real ship date comes from the carrier site via the
        // hyperlink flow and lands in the tracking cell as labeled copier
        // output ("Date Shipped: X\nTN: ..."). Priority: labeled text in the
        // tracking cell -> ship-named column -> generic date column -> anywhere.
        // The results column is labeled by its true source, never a fake
        // "Date Shipped".
        var date = extractDate(cellTN);
        var dateLabel = 'Date';
        if (date) dateLabel = 'Date Shipped';
        else if (cols.shipDate >= 0 && (date = extractDate(cells[cols.shipDate]))) dateLabel = 'Date Shipped';
        else if (cols.date >= 0 && (date = extractDate(cells[cols.date]))) dateLabel = (hdrRaw && hdrRaw[cols.date]) ? hdrRaw[cols.date] : 'Date';
        else {
          date = extractDate(joined);
          dateLabel = /date\s*shipped/i.test(joined) ? 'Date Shipped' : 'Date';
        }

        var orderDate = '';
        if (cols.orderDate >= 0) orderDate = String(cells[cols.orderDate] || '').trim();
        else { // headerless fallback (v2.10 layout: column B = order date)
          var bCell = String(cells[1] || '').trim();
          if (bCell && extractDate(bCell)) orderDate = bCell;
        }
        var meds = cols.meds >= 0 ? String(cells[cols.meds] || '').trim() : '';
        if (!meds && cells.length > 13) { // headerless fallback: column N (Jeyson's layout)
          var nCell = String(cells[13] || '').trim();
          if (nCell && !/^(false|true)$/i.test(nCell)) meds = nCell;
        }
        out.push({ patient: patient, tn: tn, carrier: carrierOf(tn), date: date, dateLabel: dateLabel, hadBlob: /date\s*shipped/i.test(cellTN || joined), orderDate: orderDate, meds: meds });
      }
      // v2.23: match the Medication column against the clinic's product menu.
      for (i = 0; i < out.length; i++) out[i].medNames = matchProducts(out[i].meds);
      return out;
    }

    // v2.23 (Jeyson's product menu): canonical product names matched against
    // the Medication column (N) by distinctive tokens (case + punctuation
    // normalized). Combos first; within a ";"-segment, a plain product is
    // dropped when its tokens are a subset of a matched combo's (e.g.
    // "Tesamorelin/Ipamorelin Injection" wins over plain "Tesamorelin").
    var PRODUCT_TOKENS = [
      ['CJC/IPA Injection', ['CJC', 'IPA']],
      ['Tesamorelin/Ipamorelin Injection', ['TESAMORELIN', 'IPAMORELIN']],
      ['BPC/KPV Pill', ['BPC', 'KPV']],
      ['Titan Stack', ['TITAN']],
      ['Wolverine Stack', ['WOLVERINE']],
      ['Glow', ['GLOW']],
      ['Klow', ['KLOW']],
      ['Restore the Core', ['RESTORE', 'CORE']],
      ['Heal & Bloom', ['HEAL', 'BLOOM']],
      ['Control & Conquer', ['CONTROL', 'CONQUER']],
      ['Clear & Confident', ['CLEAR', 'CONFIDENT']],
      ['Sharp for Life', ['SHARP', 'LIFE']],
      ['Forge', ['FORGE']],
      ['Apex', ['APEX']],
      ['Retatrutide', ['RETATRUTIDE']],
      ['Tirzepatide', ['TIRZEPATIDE']],
      ['Semaglutide', ['SEMAGLUTIDE']],
      ['Tesamorelin', ['TESAMORELIN']],
      ['BPC-157', ['BPC']],
      ['TB-500', ['TB', '500']],
      ['GHK-Cu', ['GHK', 'CU']],
      ['MOTS-c', ['MOTS']],
      ['NAD+', ['NAD']],
      ['DSIP', ['DSIP']],
      ['Epithalon', ['EPITHALON']],
      ['Kisspeptin', ['KISSPEPTIN']],
      ['KPV', ['KPV']],
      ['Larazotide', ['LARAZOTIDE']],
      ['Melanotan II', ['MELANOTAN']],
      ['Methylene Blue', ['METHYLENE']],
      ['Nicotine Troche', ['NICOTINE']],
      ['NMN', ['NMN']],
      ['Pregnyl (HCG)', ['PREGNYL']],
      ['PT-141', ['PT141']],
      ['Selank', ['SELANK']],
      ['Semax', ['SEMAX']],
      ['SS-31', ['SS31']],
      ['Synapsin', ['SYNAPSIN']],
      ['Thymosin Alpha-1', ['THYMOSIN']],
      ['Tesofensine', ['TESOFENSINE']],
      ['5-Amino-1MQ', ['1MQ']],
      ['Dihexa', ['DIHEXA']],
      ['AOD Troche', ['AOD']],
      ['SLU-PP-332', ['SLUPP332']],
      ['O-3O4 (ATX-304)', ['ATX304']],
      ['Phentermine', ['PHENTERMINE']],
      ['LDN', ['LDN']],
      ['BHRT', ['BHRT']]
    ];
    function matchProducts(medRaw) {
      var norm = function (s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); };
      // v2.26 (Jeyson): accessories are noise in the Products cell — drop them.
      var ACCESSORY = /syringe|swab|alcohol pad|mixing kit|device|needle/i;
      var names = [];
      String(medRaw || '').split(';').forEach(function (seg) {
        var s = String(seg || '').trim();
        if (!s || ACCESSORY.test(s)) return;
        var n = norm(s);
        var hits = [];
        for (var i = 0; i < PRODUCT_TOKENS.length; i++) {
          var entry = PRODUCT_TOKENS[i];
          var all = true;
          for (var t = 0; t < entry[1].length; t++) {
            if (n.indexOf(entry[1][t]) === -1) { all = false; break; }
          }
          if (all) hits.push(entry);
        }
        var combos = [];
        hits.forEach(function (h) {
          // multi-token entries are full product names — push directly; combos
          // are collected so plain products subsumed by one get dropped.
          if (h[1].length > 1) {
            combos.push(h);
            if (names.indexOf(h[0]) === -1) names.push(h[0]);
            return;
          }
          var subsumed = false;
          for (var c = 0; c < combos.length; c++) {
            var sub = true;
            for (var t3 = 0; t3 < h[1].length; t3++) {
              if (combos[c][1].indexOf(h[1][t3]) === -1) { sub = false; break; }
            }
            if (sub) { subsumed = true; break; }
          }
          if (!subsumed && names.indexOf(h[0]) === -1) names.push(h[0]);
        });
        if (!hits.length) {
          var raw = s.length > 42 ? s.slice(0, 42) + '…' : s;
          if (names.indexOf(raw) === -1) names.push(raw);
        }
      });
      return names.join('; ');
    }

    function copyText(value, label, el) {
      GM_setClipboard(value, 'text');
      toast('Copied ' + label + ': ' + value, true);
      if (el) { el.classList.remove('tb-flash'); void el.offsetWidth; el.classList.add('tb-flash'); }
    }

    function renderTable(items) {
      // replaceChildren, not innerHTML: docs.google.com enforces Trusted Types
      resultsBody.replaceChildren();
      if (!items.length) {
        status.textContent = 'No tracking numbers found in the paste.';
        return;
      }
      rowStatus = []; statusCells = []; dateCells = []; openedAt = [];
      currentDateLabel = (items[0] && items[0].dateLabel) ? items[0].dateLabel : 'Date Shipped';
      var table = document.createElement('table');
      table.style.cssText = 'width:100%;border-collapse:collapse;font:11px system-ui,sans-serif';

      function th(t) {
        var el = document.createElement('th');
        el.textContent = t;
        el.style.cssText = 'text-align:left;padding:4px 6px;border-bottom:1px solid var(--ds-border,#444);color:var(--ds-success,#9c9)';
        return el;
      }
      var headRow = document.createElement('tr');
      headRow.appendChild(th('')); // v2.29 (Jeyson): ✕ moved to the LEFT — next to the name
      headRow.appendChild(th('Patient'));
      headRow.appendChild(th('Carrier'));
      headRow.appendChild(th('Tracking #'));
      headDateEl = th(currentDateLabel);
      headRow.appendChild(headDateEl);
      // v2.23 (Jeyson): order date (separate from Date Shipped) + products
      headRow.appendChild(th('Order Date'));
      headRow.appendChild(th('Products'));
      headRow.appendChild(th('Status'));
      table.appendChild(headRow);

      items.forEach(function (it, idx) {
        var tr = document.createElement('tr');
        tr.style.cssText = 'border-bottom:1px solid var(--ds-border,#333)';

        function td(text, label) {
          var el = document.createElement('td');
          el.textContent = text || '';
          el.className = 'tb-copy-cell';
          el.style.cssText = 'padding:4px 6px;cursor:pointer;white-space:pre-wrap;word-break:break-all';
          el.title = 'Click to copy ' + (label || '');
          el.onclick = function () { copyText(text, label, el); };
          return el;
        }
        // v2.8 (Jeyson): the Tracking # and Date cells return the FULL pair
        // ("\nDate Shipped: X\nTN: Carrier - N") — the individual values alone
        // are useless. No more tiny ⧉ button.
        function pairTd(text) {
          var el = document.createElement('td');
          el.textContent = text || '';
          el.className = 'tb-copy-cell';
          el.style.cssText = 'padding:4px 6px;cursor:pointer;white-space:pre-wrap;word-break:break-all;color:var(--ds-text,#cdd)';
          el.title = 'Click to copy Date Shipped + TN';
          el.onclick = function () { copyPair(it, el); };
          return el;
        }
        // v2.29 (Jeyson): ✕ first — next to the name, so it's clear which row
        // gets removed. The clear only drops the panel row, never the sheet.
        var xTd = document.createElement('td');
        xTd.style.cssText = 'padding:4px 6px;text-align:center;width:24px';
        var xBtn = document.createElement('button');
        xBtn.textContent = '✕';
        xBtn.style.cssText = 'cursor:pointer;background:none;border:none;color:var(--ds-text,#c99);font-size:12px;line-height:1;padding:2px 4px;border-radius:3px';
        xBtn.title = 'Clear this row';
        xBtn.onclick = function () { clearRow(idx, tr); };
        xTd.appendChild(xBtn);
        tr.appendChild(xTd);
        // v2.26 (Jeyson): NO hyperlink — the patient name is a copy button.
        var patTd = document.createElement('td');
        patTd.textContent = it.patient || '';
        patTd.className = 'tb-copy-cell';
        patTd.style.cssText = 'padding:4px 6px;cursor:pointer;white-space:pre-wrap;word-break:break-all';
        patTd.title = 'Click to copy patient name';
        patTd.onclick = function () { copyText(it.patient, 'patient name', patTd); };
        tr.appendChild(patTd);
        tr.appendChild(td(it.carrier, 'carrier'));
        tr.appendChild(pairTd(it.tn));
        var dateTd = pairTd(it.date);
        dateCells.push(dateTd);
        tr.appendChild(dateTd);
        // v2.23 (Jeyson): the ORDER date (column B) — separate from Date Shipped
        var odTd = document.createElement('td');
        odTd.textContent = it.orderDate || '';
        odTd.style.cssText = 'padding:4px 6px;white-space:pre-wrap;word-break:break-all';
        tr.appendChild(odTd);
        // v2.23 (Jeyson): products matched against the clinic's menu (column N)
        var medTd = document.createElement('td');
        medTd.textContent = it.medNames || '';
        medTd.style.cssText = 'padding:4px 6px;white-space:pre-wrap;word-break:break-all;color:var(--ds-text,#bdb)';
        medTd.title = it.meds ? 'Medication: ' + it.meds : '';
        tr.appendChild(medTd);
        // v2.7: live status (⏳ opening / ✓ extracted / ✗ failed)
        var stTd = document.createElement('td');
        stTd.style.cssText = 'padding:4px 6px;text-align:center;color:var(--ds-success,#9c9)';
        statusCells.push(stTd);
        tr.appendChild(stTd);
        table.appendChild(tr);
      });

      resultsBody.appendChild(table);
      resultsPanel.classList.remove('collapsed');
      status.textContent = items.length + ' row(s). Click Tracking # or Date to copy Date Shipped + TN.';
    }

    // v2.22 (Jeyson): ✕ in the results table — remove a parsed row so the
    // panel stays neat. Only the panel row is dropped; the sheet is untouched.
    // Cleared rows are skipped by setRow (nulled cells).
    function clearRow(idx, tr) {
      rowStatus[idx] = 'cleared';
      statusCells[idx] = null;
      dateCells[idx] = null;
      if (tr && tr.parentNode) tr.parentNode.removeChild(tr);
      // count the VISIBLE rows (rowStatus is only populated by Open & Extract;
      // the Parse path renders without it)
      var left = Math.max(0, resultsBody.querySelectorAll('tr').length - 1); // minus the header row
      if (left === 0) {
        resultsPanel.classList.add('collapsed');
        status.textContent = '';
      } else {
        status.textContent = left + ' row(s) remaining.';
      }
    }

    function copyPair(it, el) {
      if (!it.date) { copyText(it.tn, 'tracking #', el); return; } // pre-extraction / failed row
      var label = it.dateLabel || 'Date Shipped';
      copyText('\n' + label + ': ' + it.date + '\nTN: ' + (it.carrier ? it.carrier + ' - ' : '') + it.tn, label + ' + TN', el);
    }

    function setRow(idx, state, date) {
      rowStatus[idx] = state;
      if (statusCells[idx]) {
        statusCells[idx].textContent = state === 'done' ? '✓' : state === 'failed' ? '✗' : state === 'skip' ? '–' : '⏳';
        statusCells[idx].style.color = state === 'failed' ? '#e55' : state === 'skip' ? '#888' : '#9c9';
      }
      if (state === 'done' && date && dateCells[idx]) {
        dateCells[idx].textContent = date;
        dateCells[idx].style.color = '#9c9';
        dateCells[idx].title = 'Click to copy Date Shipped + TN';
        if (headDateEl && headDateEl.textContent !== 'Date Shipped') headDateEl.textContent = 'Date Shipped';
      }
      // R18: update progress in the Script API
      if (rowStatus.length) {
        var done = rowStatus.filter(function(s){return s==='done'||s==='skip';}).length;
        window.__scripts['TrackBus'].progress = { done: done, total: rowStatus.length };
        window.__scripts['TrackBus'].lastActivity = Date.now();
        if (done === rowStatus.length) {
          window.__scripts['TrackBus'].state = 'done';
          window.__scripts['TrackBus'].message = done + ' rows complete';
        }
      }
    }

    // v2.7 (Jeyson's flow): the script builds the carrier links itself (same
    // logic as the sheet's formula), opens each, and the extractors on those
    // pages publish tb:<tn> to GM storage + copy to clipboard + close.
    function carrierUrl(tn) {
      tn = String(tn || '').trim();
      if (!tn) return '';
      if (/^1Z/i.test(tn)) return 'https://www.ups.com/track?track=yes&trackNums=' + tn;
      return 'https://www.fedex.com/wtrk/track/?tracknumbers=' + tn;
    }

    /* ============================================================
       v2.31 (Jeyson): ONE carrier tab at a time. Opening the whole
       table at once flooded RAM and the line, so each item now waits
       for the previous extraction before the next opens. The first
       open rides the click's user gesture; every later item NAVIGATES
       the same tab (navigation is never popup-blocked, unlike a fresh
       window.open after an await). The extractor skips its self-close
       while the tb:seq flag is set, so the tab survives for reuse;
       the controller closes it at run end.
       ============================================================ */
    var tbCarrierWin = null;
    var tbExtractBusy = false;

    function openTbTab(url) {
      if (tbCarrierWin && !tbCarrierWin.closed) {
        try { tbCarrierWin.location.href = url; return tbCarrierWin; }
        catch (e) { tbCarrierWin = null; } // proxy gone — fall through
      }
      tbCarrierWin = window.open(url, '_blank');
      return tbCarrierWin;
    }

    function closeTbTab() {
      try { GM_deleteValue('tb:seq'); } catch (e) { LOG('closeTbTab delete', e); }
      if (tbCarrierWin && !tbCarrierWin.closed) {
        try { tbCarrierWin.close(); } catch (e) { LOG('closeTbTab close', e); }
      }
      tbCarrierWin = null;
    }

    function awaitTb(it, timeoutMs) {
      // Poll GM storage until the extractor publishes tb:<tn>. Resolves
      // true on a valid payload, false on timeout (old poller semantics).
      return new Promise(function (resolve) {
        var t0 = Date.now();
        (function poll() {
          var raw = GM_getValue('tb:' + it.tn, '');
          if (raw) {
            var rec = null;
            try { rec = JSON.parse(raw); } catch (e) { rec = null; }
            GM_deleteValue('tb:' + it.tn);
            if (rec) {
              it.date = rec.date || it.date;
              it.dateLabel = 'Date Shipped';
              resolve(true);
              return;
            }
            // malformed payload — delete and keep polling (old behaviour)
          }
          if (Date.now() - t0 > timeoutMs) { resolve(false); return; }
          setTimeout(poll, 800);
        })();
      });
    }

    async function openAndExtract() {
      if (tbExtractBusy) { toast('Extraction already running', false); return; }
      var items = parseToJSON();
      if (!items.length) { toast('No tracking numbers to open', false); return; }
      tbExtractBusy = true;
      try {
        currentItems = items;
        renderTable(items, currentDateLabel);
        try { GM_setValue('tb:seq', 1); } catch (e) { LOG('seq flag set failed', e); } // keep extractor tabs alive
        var anyOpen = false;
        var done = 0, failed = 0;
        for (var idx = 0; idx < items.length; idx++) {
          var it = items[idx];
          var url = carrierUrl(it.tn);
          if (!url) { setRow(idx, 'failed'); failed++; continue; }
          GM_deleteValue('tb:' + it.tn); // clear any stale result from a prior run
          var w = openTbTab(url);
          if (!w) { setRow(idx, 'failed'); failed++; continue; } // popup blocked
          anyOpen = true;
          openedAt[idx] = Date.now();
          setRow(idx, 'opening');
          status.textContent = 'Extracting ' + (idx + 1) + '/' + items.length + '…';
          var ok = await awaitTb(it, 90000);
          if (ok) { setRow(idx, 'done', it.date); done++; }
          else { setRow(idx, 'failed'); failed++; }
        }
        if (!anyOpen) { toast('⚠ Popups blocked — allow popups for this site', false); return; }
        status.textContent = done + '/' + items.length + ' extracted. Click cells to copy.';
        toast(done === items.length ? 'Done — click cells to copy' : done + ' extracted, ' + failed + ' failed', done > 0);
      } finally {
        closeTbTab();
        tbExtractBusy = false;
      }
    }

    /* ============================================================
       LIFEFILE ORDER FETCH (v2.18) — Jeyson's flow
       On the pharmacy subtab (renamed Pharmacy A/Progress/Pharmacy C/
       Pharmacy D...), click Fetch: the portal tab opens with an lfSale
       intent, the Session Handler auto-logs in, the Order Status
       Extractor sets the configurable blank-days filter and copies
       ALL pages, then replies over postMessage. The sheet snaps
       focus back, the TSV lands on the OS clipboard + textarea, cell
       A2 is auto-selected, and the user presses Ctrl+V (the ONE
       trusted step — Sheets refuses synthetic range writes). The
       portal logs out and the tab self-closes.
       ============================================================ */
    var TAB_PHARMACY_MAP = {
      'pharmacya': 'pharmacya',
      'progress': 'progress',
      'pharmacy c': 'pharmacyc',
      'pharmacyc': 'pharmacyc',
      'pharmacyd': 'pharmacyd',
      'pharmacy e': 'pharmacye',
      'pharmacye': 'pharmacye',
      'pharmacy f': 'pharmacyf',
      'pharmacyf': 'pharmacyf',
      'pharmacy g': 'pharmacyg'
    };
    function detectPharmacyFromTab() {
      var el = document.querySelector('.docs-sheet-tab.docs-sheet-active-tab .docs-sheet-tab-name');
      var name = el ? (el.textContent || '').trim() : '';
      var norm = name.toLowerCase().replace(/\s+/g, ' ');
      return TAB_PHARMACY_MAP[norm] || null;
    }
    function pharmDisplay(key) {
      for (var i = 0; i < LF_PHARMACY_URL_MAP.length; i++) {
        if (LF_PHARMACY_URL_MAP[i].key === key) return LF_PHARMACY_URL_MAP[i].name;
      }
      return key;
    }
    function fetchDays() {
      // v2.32 (Jeyson): the fetch range is configurable — the number input
      // next to the button (persisted in GM storage, default 30).
      var n = parseInt((daysInput && daysInput.value) || '', 10);
      if (!n || isNaN(n)) n = 30;
      if (n < 1) n = 1;
      if (n > 365) n = 365;
      return n;
    }
    function updateFetchLabel() {
      if (!lfFetchBtn) return;
      var apply = function () {
        var key = detectPharmacyFromTab();
        lfFetchBtn.textContent = key ? ('⬇ Fetch Blank Days (' + pharmDisplay(key) + ')') : '⬇ Fetch Blank Days';
        return key;
      };
      if (apply()) return;
      // The tab bar renders AFTER the panel mounts (Sheets is slow) — retry so
      // the label reflects the detected pharmacy once the tabs appear.
      var tries = 0;
      (function poll() {
        tries++;
        if (apply() || tries >= 25) return;
        setTimeout(poll, 400);
      })();
    }
    // Select a cell on the CURRENT tab via the URL hash (the only synthetic-safe
    // navigation — the name box misroutes and Find needs an existing value).
    function selectCell(ref) {
      try {
        var m = (location.hash || location.search).match(/gid=(\d+)/);
        var gid = m ? m[1] : '';
        location.hash = (gid ? 'gid=' + gid + '&' : '') + 'range=' + ref;
      } catch (e) { console.warn('[TrackBus]', e); }
    }
    function fetchLifeFileOrders() {
      var days = fetchDays();
      var pharmKey = detectPharmacyFromTab();
      if (pharmKey) { doLifeFileFetch(pharmKey, days); return; }
      // The tab bar renders after the panel (Sheets is slow) — wait briefly
      // before complaining, so a fast click still works.
      var tries = 0;
      (function waitPharm() {
        tries++;
        var k = detectPharmacyFromTab();
        if (k) { doLifeFileFetch(k, days); return; }
        if (tries >= 8) { toast('Rename this tab to a pharmacy (Pharmacy A, Progress, Pharmacy C, Pharmacy D…)', false); return; }
        setTimeout(waitPharm, 400);
      })();
    }
    function doLifeFileFetch(pharmKey, days) {
      var pharm = null;
      for (var i = 0; i < LF_PHARMACY_URL_MAP.length; i++) {
        if (LF_PHARMACY_URL_MAP[i].key === pharmKey) { pharm = LF_PHARMACY_URL_MAP[i]; break; }
      }
      if (!pharm) { toast('Unknown pharmacy tab', false); return; }
      if (lfCleanup) { try { lfCleanup(); } catch (e) {} lfCleanup = null; }
      var b = buildLfTarget(pharmKey, days);
      var nonce = b.nonce;
      var target = b.target;

      if (lfPortalWin && !lfPortalWin.closed) {
        try { lfPortalWin.location.href = target; }
        catch (e) { lfPortalWin = window.open(target, '_blank'); }
      } else {
        lfPortalWin = window.open(target, '_blank');
      }
      if (!lfPortalWin) { toast('⚠ Popups blocked — allow popups for this site', false); return; }
      // Snap back to the sheet immediately — the portal tab does its work unseen.
      try { window.focus(); } catch (e) { console.warn('[TrackBus]', e); }

      status.textContent = 'Fetching ' + pharm.name + ' (last ' + days + ' days)…';
      waitForLfx(pharm, nonce, lfPortalWin);
    }
    // Build the portal intent URL for a pharmacy.
    function buildLfTarget(pharmKey, days) {
      var pharm = null;
      for (var i = 0; i < LF_PHARMACY_URL_MAP.length; i++) {
        if (LF_PHARMACY_URL_MAP[i].key === pharmKey) { pharm = LF_PHARMACY_URL_MAP[i]; break; }
      }
      var nonce = Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
      var statusUrl = 'https://' + new URL(pharm.url).host + '/application_main_zfw/poeerx/providerrxstatusbk';
      var intent = {
        _lf: {
          pharmacy: pharm.key, name: pharm.name,
          portalUrl: statusUrl, loginUrl: pharm.url, step: 'orders',
          extract: { mode: 'days', days: days, nonce: nonce }
        }
      };
      var b64 = btoa(encodeURIComponent(JSON.stringify(intent))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      var sep = pharm.url.indexOf('?') === -1 ? '?' : '&';
      return { target: pharm.url + sep + 'lfSale=' + b64, nonce: nonce, pharm: pharm };
    }
    // The sheet-side half of a fetch: poll the portal with hello messages,
    // wait for the lfx:res response, then load the clipboard + select A2 +
    // prompt the user's ONE trusted Ctrl+V.
    function waitForLfx(pharm, nonce, portalWin) {
      if (lfCleanup) { try { lfCleanup(); } catch (e) {} lfCleanup = null; }
      var deadline = Date.now() + 180000;
      var hello = setInterval(function () {
        try { portalWin.postMessage({ type: 'lfx', nonce: nonce }, '*'); } catch (e) { console.warn('[TrackBus]', e); }
        if (Date.now() > deadline) {
          clearInterval(hello);
          window.removeEventListener('message', onLfx);
          status.textContent = '⚠ LifeFile fetch timed out (3 min)';
          toast('⚠ LifeFile fetch timed out', false);
        }
      }, 2000);
      function onLfx(e) {
        var d = e.data;
        if (!d || d.type !== 'lfx:res' || d.nonce !== nonce) return;
        clearInterval(hello);
        window.removeEventListener('message', onLfx);
        var tsv = d.tsv || '';
        var count = typeof d.count === 'number' ? d.count : 0;
        box.value = tsv;
        try { GM_setClipboard(tsv, 'text'); } catch (e2) { console.warn('[TrackBus]', e2); }
        // Auto-select A2 on the current tab — then ONE trusted Ctrl+V by the
        // user lands the whole range (Sheets blocks synthetic range writes).
        selectCell('A2');
        status.textContent = '✅ ' + count + ' orders from ' + pharm.name + ' — press Ctrl+V at A2';
        toast('✅ ' + count + ' orders — press Ctrl+V to paste at A2', true);
        // ALWAYS refocus the sheet — the portal tab holds the window focus
        // during the fetch, and the user's Ctrl+V must land HERE.
        try { window.focus(); } catch (e) { console.warn('[TrackBus]', e); }
        // The extractor logs the portal session out itself; close the tab with
        // retries (the logout redirect can swallow the first close), then
        // refocus the spreadsheet.
        setTimeout(function () {
          var tries = 0;
          var closer = setInterval(function () {
            tries++;
            try { if (portalWin && !portalWin.closed) portalWin.close(); } catch (e3) { console.warn('[TrackBus]', e3); }
            if (!portalWin || portalWin.closed || tries >= 12) {
              clearInterval(closer);
              try { window.focus(); } catch (e4) { console.warn('[TrackBus]', e4); }
            }
          }, 1000);
        }, 1500);
      }
      window.addEventListener('message', onLfx);
      lfCleanup = function () {
        clearInterval(hello);
        window.removeEventListener('message', onLfx);
      };
    }

    function go() {
      var items = parseToJSON();
      currentItems = items;
      renderTable(items);
      pulse(driveBtn); // v2.29: next step is Open & Extract
    }

    var CSS = [
      ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}',
      '#tb-panel{position:fixed;bottom:16px;right:16px;z-index:2147483647;',
      'background:var(--ds-surface,#1e1e1e);color:var(--ds-text,#eee);padding:10px;border-radius:8px;',
      'font:12px system-ui,sans-serif;width:280px;max-height:calc(100vh - 32px);overflow-y:auto;',
      'box-shadow:0 2px 8px rgba(31,45,61,.08)}',
      '#tb-panel textarea{width:100%;height:110px;background:var(--ds-surface,#111);color:var(--ds-text,#eee);',
      'border:1px solid var(--ds-border,#444);border-radius:4px;font:11px monospace;padding:4px;',
      'box-sizing:border-box;resize:vertical}',
      '#tb-panel button{width:100%;margin-top:6px;padding:6px;border:0;border-radius:4px;',
      'background:var(--ds-accent,#4a8);color:var(--ds-accent-text,#fff);cursor:pointer;font-size:12px}',
      '#tb-panel button:disabled{background:var(--ds-surface2,#555);cursor:default}',
      '#tb-status{margin-top:6px;font-size:11px;color:var(--ds-success,#9c9);min-height:14px}',
      '#tb-head{display:flex;justify-content:space-between;align-items:center;',
      'margin-bottom:6px;font-weight:600;cursor:pointer}',
      '#tb-panel.collapsed textarea,#tb-panel.collapsed button,',
      '#tb-panel.collapsed #tb-status{display:none}',
      '#tb-results{position:fixed;bottom:196px;right:16px;z-index:2147483647;',
      'background:var(--ds-surface,#1e1e1e);color:var(--ds-text,#eee);padding:10px;border-radius:8px;',
      // v2.26 (Jeyson): bigger — he works in this table now.
      'font:12px system-ui,sans-serif;width:min(1100px,calc(100vw - 40px));max-height:75vh;',
      'box-shadow:0 2px 8px rgba(31,45,61,.08);display:flex;flex-direction:column}',
      '#tb-results-head{display:flex;justify-content:space-between;align-items:center;',
      'margin-bottom:6px;font-weight:600;cursor:move}',
      '#tb-results-body{overflow:auto;max-height:68vh}',
      '#tb-results.collapsed #tb-results-body{display:none}',
      '#tb-lf-fetch{background:var(--ds-info,#2c6e9c)}',
      // v2.32 (Jeyson): fetch row = days input + Fetch Blank Days button
      '#tb-fetch-row{display:flex;gap:6px;margin-top:6px}',
      '#tb-fetch-row button{margin-top:0;flex:1}',
      '#tb-days{width:56px;padding:5px;border:1px solid var(--ds-border,#444);border-radius:4px;',
      'background:var(--ds-surface,#111);color:var(--ds-text,#eee);font:12px system-ui,sans-serif;text-align:center}',
      // v2.29: affordances — hover cues, click flash, next-action pulse, guide mode
      '.tb-copy-cell{cursor:pointer;transition:background .15s ease}',
      '.tb-copy-cell:hover{background:rgba(138,95,46,.18)!important;outline:1px dashed rgba(138,95,46,.6);outline-offset:-1px}',
      '.tb-flash{animation:tbFlash .7s ease-out}',
      '@keyframes tbFlash{0%{background:rgba(61,122,70,.45)}100%{background:transparent}}',
      '.tb-pulse{animation:tbPulse 1.3s ease-in-out 3}',
      '@keyframes tbPulse{0%,100%{box-shadow:0 0 0 0 rgba(255,196,90,.65)}50%{box-shadow:0 0 0 6px rgba(255,196,90,0)}}',
      '#tb-guide{position:fixed;top:16px;right:16px;z-index:2147483646;width:300px;',
      'background:var(--ds-surface,#1e1e1e);color:var(--ds-text,#eee);border:1px solid rgba(255,196,90,.6);',
      'border-radius:8px;padding:10px 12px;font:12px/1.5 system-ui,sans-serif;',
      'box-shadow:0 4px 16px rgba(31,45,61,.25)}',
      '#tb-guide h4{margin:0 0 6px;font-size:12px;color:var(--ds-accent,#8a5f2e)}',
      '#tb-guide ol{margin:0;padding-left:18px}',
      '#tb-guide li{margin:2px 0}',
      '#tb-guide b{color:var(--ds-accent,#8a5f2e)}',
      '#tb-guide-close{position:absolute;top:6px;right:8px;cursor:pointer;border:0;background:none;color:var(--ds-muted,#998);font-size:13px;width:auto;margin:0;padding:2px 6px}',
      '.tb-guide-ring{position:fixed;z-index:2147483646;pointer-events:none;border:2px solid #ffb43c;border-radius:6px;animation:tbPulse 1.4s ease-in-out infinite}',
      '.tb-guide-num{position:fixed;z-index:2147483646;pointer-events:none;background:#ffb43c;color:#2b2620;font:700 11px/18px system-ui,sans-serif;',
      'width:18px;height:18px;text-align:center;border-radius:50%;box-shadow:0 1px 4px rgba(0,0,0,.4)}',
      '#tb-results.collapsed #tb-results-foot{display:none}'
    ].join('');

    /* ============================================================
       v2.29 GUIDE MODE — show what to hover / click
       ============================================================ */
    var guideEl = null, guideTimer = null, guideTimeout = null;
    var GUIDE_STEPS = [
      { label: 'Paste box', desc: 'Paste the sheet rows here (or use ⬇ Fetch Blank Days first).' },
      { label: '⬇ Fetch Blank Days', desc: 'Pulls orders for the last N days (set N in the box next to it) from the pharmacy named on the ACTIVE tab. Press Ctrl+V at A2 when told.' },
      { label: 'Parse to Table', desc: 'Turns the paste into the results table.' },
      { label: 'Open & Extract', desc: 'Opens every tracking # on UPS/FedEx — the tabs close by themselves. Watch for ✓.' },
      { label: 'Results table', desc: 'Click any highlighted cell to copy — patient, carrier, tracking #, or date.' },
      { label: '✕ (first column)', desc: 'Removes that row from the table — the sheet is never touched.' },
      { label: 'Panel titles', desc: 'Drag to move either panel wherever you like.' }
    ];

    function pulse(btnEl) {
      if (!btnEl) return;
      btnEl.classList.remove('tb-pulse'); void btnEl.offsetWidth; btnEl.classList.add('tb-pulse');
    }

    function removeGuideRings() {
      var els = document.querySelectorAll('.tb-guide-ring, .tb-guide-num');
      for (var i = 0; i < els.length; i++) els[i].remove();
    }

    function placeGuideRings() {
      removeGuideRings();
      var targets = [box, lfFetchBtn, btn, driveBtn];
      targets.forEach(function (t, i) {
        if (!t) return;
        var r = t.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var ring = document.createElement('div');
        ring.className = 'tb-guide-ring';
        ring.style.cssText = 'left:' + r.left + 'px;top:' + r.top + 'px;width:' + r.width + 'px;height:' + r.height + 'px';
        document.documentElement.appendChild(ring);
        var num = document.createElement('div');
        num.className = 'tb-guide-num';
        num.textContent = i + 1;
        num.style.left = (r.left - 9) + 'px';
        num.style.top = (r.top - 9) + 'px';
        document.documentElement.appendChild(num);
      });
      if (resultsPanel && !resultsPanel.classList.contains('collapsed')) {
        var rr = resultsPanel.getBoundingClientRect();
        if (rr.width && rr.height) {
          var ring2 = document.createElement('div');
          ring2.className = 'tb-guide-ring';
          ring2.style.cssText = 'left:' + rr.left + 'px;top:' + rr.top + 'px;width:' + rr.width + 'px;height:' + rr.height + 'px';
          document.documentElement.appendChild(ring2);
        }
      }
    }

    function hideGuide() {
      if (guideTimer) { clearInterval(guideTimer); guideTimer = null; }
      if (guideTimeout) { clearTimeout(guideTimeout); guideTimeout = null; }
      removeGuideRings();
      if (guideEl) { guideEl.remove(); guideEl = null; }
    }

    function showGuide() {
      if (guideEl) { hideGuide(); return; }
      guideEl = document.createElement('div');
      guideEl.id = 'tb-guide';
      var h = document.createElement('h4');
      h.textContent = 'Tracking Bus — quick guide';
      var close = document.createElement('button');
      close.id = 'tb-guide-close';
      close.textContent = '✕';
      close.title = 'Close the guide';
      close.onclick = hideGuide;
      var ol = document.createElement('ol');
      GUIDE_STEPS.forEach(function (s) {
        var li = document.createElement('li');
        var b = document.createElement('b');
        b.textContent = s.label + ' — ';
        li.appendChild(b);
        li.appendChild(document.createTextNode(s.desc));
        ol.appendChild(li);
      });
      guideEl.appendChild(h);
      guideEl.appendChild(close);
      guideEl.appendChild(ol);
      document.documentElement.appendChild(guideEl);
      try { localStorage.setItem('tb_guide_seen', '1'); } catch (e) { console.warn('[TrackBus]', e); }
      guideTimer = setInterval(placeGuideRings, 800);
      placeGuideRings();
      guideTimeout = setTimeout(function () { if (guideEl) hideGuide(); }, 60000);
    }

    function toggleGuide() {
      if (guideEl) hideGuide(); else showGuide();
    }

    function onGuideKey(e) {
      if (e.key === 'Escape') hideGuide();
    }

    function build() {
      GM_addStyle(CSS);

      var panel = document.createElement('div');
      panel.id = 'tb-panel';

      // v2.23 (Jeyson): no collapse toggle needed — the panels are draggable.
      var head = document.createElement('div');
      head.id = 'tb-head';
      var h1 = document.createElement('span');
      h1.textContent = 'Tracking Bus';
      head.appendChild(h1);

      box = document.createElement('textarea');
      box.placeholder = 'Paste the sheet rows here (headers optional):\nPatient Name | Date Shipped / Tracking #';

      btn = document.createElement('button');
      btn.textContent = 'Parse to Table';
      btn.title = 'Turn the pasted rows into the results table';
      btn.onclick = go;

      driveBtn = document.createElement('button');
      driveBtn.textContent = 'Open & Extract';
      driveBtn.style.background = '#36c';
      driveBtn.title = 'Open every tracking # on UPS/FedEx and extract the ship date — the tabs close by themselves';
      driveBtn.onclick = openAndExtract;

      lfFetchBtn = document.createElement('button');
      lfFetchBtn.id = 'tb-lf-fetch';
      lfFetchBtn.textContent = '⬇ Fetch Blank Days';
      lfFetchBtn.title = 'Fetch the last N days of orders from the pharmacy named on the active tab — press Ctrl+V at A2 when told (N is the box next to it)';
      lfFetchBtn.onclick = fetchLifeFileOrders;
      daysInput = document.createElement('input');
      daysInput.id = 'tb-days';
      daysInput.type = 'number';
      daysInput.min = '1';
      daysInput.max = '365';
      daysInput.title = 'How many days back to fetch — blank days to fill';
      try { daysInput.value = String(GM_getValue('tb:fetchDays', 30)); } catch (e) { daysInput.value = '30'; }
      daysInput.addEventListener('change', function () {
        try { GM_setValue('tb:fetchDays', fetchDays()); } catch (e) { console.warn('[TrackBus]', e); }
      });
      var fetchRow = document.createElement('div');
      fetchRow.id = 'tb-fetch-row';
      fetchRow.appendChild(daysInput);
      fetchRow.appendChild(lfFetchBtn);
      updateFetchLabel();

      status = document.createElement('div');
      status.id = 'tb-status';

      panel.appendChild(head);
      panel.appendChild(box);
      // v2.32 (Jeyson): button order = 1. Fetch Blank Days 2. Parse 3. Open & Extract
      panel.appendChild(fetchRow);
      panel.appendChild(btn);
      panel.appendChild(driveBtn);
      // Draggable panels (v2.22/v2.23, Jeyson): grab the ⠿ handle (or the
      // results title) to move a panel; positions persist in localStorage.
      function makeDraggable(panelEl, handleEl, storageKey) {
        var dragState = null;
        handleEl.style.cursor = 'move';
        handleEl.addEventListener('mousedown', function (e) {
          if (e.button !== 0) return;
          dragState = { dx: e.clientX - panelEl.offsetLeft, dy: e.clientY - panelEl.offsetTop };
          e.preventDefault();
        });
        document.addEventListener('mousemove', function (e) {
          if (!dragState) return;
          var x = e.clientX - dragState.dx;
          var y = e.clientY - dragState.dy;
          panelEl.style.left = Math.max(0, Math.min(x, window.innerWidth - 80)) + 'px';
          panelEl.style.top = Math.max(0, Math.min(y, window.innerHeight - 40)) + 'px';
          panelEl.style.bottom = 'auto';
          panelEl.style.right = 'auto';
        });
        document.addEventListener('mouseup', function () {
          if (!dragState) return;
          dragState = null;
          try { localStorage.setItem(storageKey, JSON.stringify({ l: panelEl.style.left, t: panelEl.style.top })); } catch (e) { console.warn('[TrackBus]', e); }
        });
        try {
          var saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
          if (saved && saved.l) {
            panelEl.style.left = saved.l;
            panelEl.style.top = saved.t;
            panelEl.style.bottom = 'auto';
            panelEl.style.right = 'auto';
          }
        } catch (e) { console.warn('[TrackBus]', e); }
      }
      var panelHead = document.createElement('div');
      panelHead.id = 'tb-panel-head';
      panelHead.style.cssText = 'user-select:none;font-weight:bold;margin-bottom:6px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.08);display:flex;justify-content:space-between;align-items:center;';
      var phLabel = document.createElement('span');
      phLabel.textContent = '⠿ Tracking Bus';
      panelHead.appendChild(phLabel);
      // v2.29: ? toggles the guide (what to hover / click)
      var guideBtn = document.createElement('button');
      guideBtn.textContent = '?';
      guideBtn.title = 'Show the guide — what to hover and click';
      guideBtn.style.cssText = 'width:auto;margin:0;padding:0 8px;font-weight:700;background:rgba(255,255,255,0.14);border-radius:4px;cursor:pointer;border:0;color:var(--ds-text,#eee);font-size:12px;line-height:18px';
      guideBtn.addEventListener('mousedown', function (e) { e.stopPropagation(); });
      guideBtn.onclick = toggleGuide;
      panelHead.appendChild(guideBtn);
      makeDraggable(panel, panelHead, 'tb_panel_pos');
      panel.insertBefore(panelHead, panel.firstChild);
      panel.appendChild(status);

      resultsPanel = document.createElement('div');
      resultsPanel.id = 'tb-results';
      resultsPanel.classList.add('collapsed');
      // v2.23 (Jeyson): no collapse toggle — the title drags the panel.
      var rHead = document.createElement('div');
      rHead.id = 'tb-results-head';
      var rH1 = document.createElement('span');
      rH1.id = 'tb-results-title';
      rH1.textContent = 'Tracking Bus — Results';
      rHead.appendChild(rH1);
      // v2.29: ? toggles the guide (what to hover / click)
      var rGuide = document.createElement('button');
      rGuide.textContent = '?';
      rGuide.title = 'Show the guide — what to hover and click';
      rGuide.style.cssText = 'width:auto;margin:0;padding:0 8px;font-weight:700;background:rgba(255,255,255,0.14);border-radius:4px;cursor:pointer;border:0;color:var(--ds-text,#eee);font-size:12px;line-height:18px';
      rGuide.addEventListener('mousedown', function (e) { e.stopPropagation(); });
      rGuide.onclick = toggleGuide;
      rHead.appendChild(rGuide);
      makeDraggable(resultsPanel, rH1, 'tb_results_pos');
      resultsBody = document.createElement('div');
      resultsBody.id = 'tb-results-body';
      resultsPanel.appendChild(rHead);
      resultsPanel.appendChild(resultsBody);
      // v2.29: legend — what's clickable, at a glance
      var rFoot = document.createElement('div');
      rFoot.id = 'tb-results-foot';
      rFoot.textContent = 'Click highlighted cells to copy · ✕ removes a row · Drag titles to move panels';
      rFoot.style.cssText = 'margin-top:6px;font-size:11px;color:var(--ds-muted,#998);border-top:1px solid var(--ds-border,#e8e2d8);padding-top:4px';
      resultsPanel.appendChild(rFoot);

      document.documentElement.appendChild(resultsPanel);
      document.documentElement.appendChild(panel);
      LOG('panel mounted');
      // v2.29: first-run coach — show the guide once so the hover/click
      // targets are obvious from the start (then only via the ? button).
      try {
        if (!localStorage.getItem('tb_guide_seen')) showGuide();
      } catch (e) { console.warn('[TrackBus]', e); }
      document.addEventListener('keydown', onGuideKey);
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', build);
    } else {
      build();
    }

    // R18: trigger dispatcher (set by runController so it has closure access)
    var api = window.__scripts['TrackBus'];
    api.trigger = function (action) {
      if (action === 'extract') {
        api.state = 'running'; api.message = 'Opening tabs & extracting...'; api.progress = null; api.lastActivity = Date.now();
        openAndExtract();
        return { ok: true };
      }
      if (action === 'status') {
        return { ok: true, state: api.state, message: api.message, progress: api.progress };
      }
      return { ok: false, error: 'unknown action: ' + action };
    };
  }

  /* ============================================================
     ROUTER
     ============================================================ */

  if (HOST.indexOf('docs.google.com') !== -1) {
    // Broad @match (specific doc-ID patterns fail to inject on Chrome 151/TM 5.5)
    // -> guard at runtime so the panel only mounts on the Patient Order Tracking
    // sheet + the sandbox test copies (16av3…, 1kFhy… — agent testing homes).
    if (location.pathname.indexOf('1uojE2XuMYsAZ6DkFqAzt4mhBEHC7UNQrdcfUh1YnFeM') === -1 &&
        location.pathname.indexOf('16av3HmIB5uKvVGWH120Ek76s1nEb3CpaNPRS2NOwuJI') === -1 &&
        location.pathname.indexOf('1kFhy8dNInul7L442Fqu1gLO0L3joLymKsSMr_eu8zBc') === -1 &&
        location.pathname.indexOf('1TCKJxeq8U6fBSP9-4jH2MmnmnHVqzy-YM5DXdzYHjdI') === -1) return;
    runController();
  } else if (HOST.indexOf('fedex.com') !== -1) {
    runFedEx();
  } else if (HOST.indexOf('ups.com') !== -1) {
    runUPS();
  }
})();