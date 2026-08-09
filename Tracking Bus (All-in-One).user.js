// ==UserScript==
// @name         Tracking Bus (All-in-One)
// @namespace    drjones-trackbus
// @version      2.28
// @author       Jeyson Dagondon
// @description  Paste rows, auto-open UPS/FedEx, extract DS+TN, patient->Zoho, write back
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

console.info('[TrackBus v2.28] boot');

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
      setTimeout(function () { window.close(); }, 700);
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
    var box, btn, driveBtn, writeBtn, sweepBtn, status, resultsPanel, resultsBody;
    var lfFetchBtn, lfPortalWin = null, lfCleanup = null;
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
        } else if (ch === '"') {
          inQ = true;
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

    function copyText(value, label) {
      GM_setClipboard(value, 'text');
      toast('Copied ' + label + ': ' + value, true);
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
      headRow.appendChild(th('Patient'));
      headRow.appendChild(th('Carrier'));
      headRow.appendChild(th('Tracking #'));
      headDateEl = th(currentDateLabel);
      headRow.appendChild(headDateEl);
      // v2.23 (Jeyson): order date (separate from Date Shipped) + products
      headRow.appendChild(th('Order Date'));
      headRow.appendChild(th('Products'));
      headRow.appendChild(th('Status'));
      headRow.appendChild(th('')); // v2.22: ✕ clear column
      table.appendChild(headRow);

      items.forEach(function (it, idx) {
        var tr = document.createElement('tr');
        tr.style.cssText = 'border-bottom:1px solid var(--ds-border,#333)';

        function td(text, label) {
          var el = document.createElement('td');
          el.textContent = text || '';
          el.style.cssText = 'padding:4px 6px;cursor:pointer;white-space:pre-wrap;word-break:break-all';
          el.title = 'Click to copy ' + (label || '');
          el.onclick = function () { copyText(text, label); };
          return el;
        }
        // v2.8 (Jeyson): the Tracking # and Date cells return the FULL pair
        // ("\nDate Shipped: X\nTN: Carrier - N") — the individual values alone
        // are useless. No more tiny ⧉ button.
        function pairTd(text) {
          var el = document.createElement('td');
          el.textContent = text || '';
          el.style.cssText = 'padding:4px 6px;cursor:pointer;white-space:pre-wrap;word-break:break-all;color:var(--ds-text,#cdd)';
          el.title = 'Click to copy Date Shipped + TN';
          el.onclick = function () { copyPair(it); };
          return el;
        }
        // v2.26 (Jeyson): NO hyperlink — the patient name is a copy button.
        var patTd = document.createElement('td');
        patTd.textContent = it.patient || '';
        patTd.style.cssText = 'padding:4px 6px;cursor:pointer;white-space:pre-wrap;word-break:break-all';
        patTd.title = 'Click to copy patient name';
        patTd.onclick = function () { copyText(it.patient, 'patient name'); };
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
        // v2.22 (Jeyson): ✕ clears a parsed row so the panel stays neat.
        var xTd = document.createElement('td');
        xTd.style.cssText = 'padding:4px 6px;text-align:center;width:24px';
        var xBtn = document.createElement('button');
        xBtn.textContent = '✕';
        xBtn.style.cssText = 'cursor:pointer;background:none;border:none;color:var(--ds-text,#c99);font-size:12px;line-height:1;padding:2px 4px;border-radius:3px';
        xBtn.title = 'Clear this row';
        xBtn.onclick = function () { clearRow(idx, tr); };
        xTd.appendChild(xBtn);
        tr.appendChild(xTd);
        table.appendChild(tr);
      });

      resultsBody.appendChild(table);
      resultsPanel.classList.remove('collapsed');
      status.textContent = items.length + ' row(s). Click Tracking # or Date to copy Date Shipped + TN.';
    }

    // v2.22 (Jeyson): ✕ in the results table — remove a parsed row so the
    // panel stays neat. Only the panel row is dropped; the sheet is untouched
    // (Write Back is the explicit write path). Cleared rows are skipped by the
    // poller (rowStatus !== 'opening') and by setRow (nulled cells).
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

    function copyPair(it) {
      if (!it.date) { copyText(it.tn, 'tracking #'); return; } // pre-extraction / failed row
      var label = it.dateLabel || 'Date Shipped';
      copyText('\n' + label + ': ' + it.date + '\nTN: ' + (it.carrier ? it.carrier + ' - ' : '') + it.tn, label + ' + TN');
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

    function openAndExtract() {
      var items = parseToJSON();
      if (!items.length) { toast('No tracking numbers to open', false); return; }
      currentItems = items;
      renderTable(items, currentDateLabel);
      var anyOpen = false;
      items.forEach(function (it, idx) {
        var url = carrierUrl(it.tn);
        if (!url) { setRow(idx, 'failed'); return; }
        GM_deleteValue('tb:' + it.tn); // clear any stale result from a prior run
        var w = window.open(url, '_blank');
        if (!w) { setRow(idx, 'failed'); return; } // popup blocked
        anyOpen = true;
        openedAt[idx] = Date.now();
        setRow(idx, 'opening');
      });
      if (!anyOpen) { toast('⚠ Popups blocked — allow popups for this site', false); return; }
      toast('Extracting from carrier pages…', true);
      startPoller(items);
    }

    function startPoller(items) {
      var poller = setInterval(function () {
        var allDone = true;
        items.forEach(function (it, idx) {
          if (rowStatus[idx] !== 'opening') return;
          if (Date.now() - openedAt[idx] > 90000) { setRow(idx, 'failed'); return; }
          var raw = GM_getValue('tb:' + it.tn, '');
          if (raw) {
            try {
              var rec = JSON.parse(raw);
              it.date = rec.date || it.date;
              it.dateLabel = 'Date Shipped';
              setRow(idx, 'done', it.date);
            } catch (e) { /* malformed — leave row opening */ }
            GM_deleteValue('tb:' + it.tn);
          }
        });
        items.forEach(function (it, idx) { if (rowStatus[idx] === 'opening') allDone = false; });
        if (allDone) { clearInterval(poller); toast('Done — click cells to copy', true); }
      }, 800);
    }

    /* ============================================================
       LIFEFILE ORDER FETCH (v2.18) — Jeyson's flow
       On the pharmacy subtab (renamed Pharmacy A/Progress/Pharmacy C/
       Pharmacy D...), click Fetch: the portal tab opens with an lfSale
       intent, the Session Handler auto-logs in, the Order Status
       Extractor sets the last-30-days filter and copies ALL pages,
       then replies over postMessage. The sheet snaps focus back, the
       TSV lands on the OS clipboard + textarea, cell A2 is auto-
       selected, and the user presses Ctrl+V (the ONE trusted step —
       Sheets refuses synthetic range writes). The portal logs out and
       the tab self-closes.
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
    function updateFetchLabel() {
      if (!lfFetchBtn) return;
      var apply = function () {
        var key = detectPharmacyFromTab();
        lfFetchBtn.textContent = key ? ('⬇ Fetch 30 Days (' + pharmDisplay(key) + ')') : '⬇ Fetch 30 Days';
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
      var pharmKey = detectPharmacyFromTab();
      if (pharmKey) { doLifeFileFetch(pharmKey); return; }
      // The tab bar renders after the panel (Sheets is slow) — wait briefly
      // before complaining, so a fast click still works.
      var tries = 0;
      (function waitPharm() {
        tries++;
        var k = detectPharmacyFromTab();
        if (k) { doLifeFileFetch(k); return; }
        if (tries >= 8) { toast('Rename this tab to a pharmacy (Pharmacy A, Progress, Pharmacy C, Pharmacy D…)', false); return; }
        setTimeout(waitPharm, 400);
      })();
    }
    function doLifeFileFetch(pharmKey) {
      var pharm = null;
      for (var i = 0; i < LF_PHARMACY_URL_MAP.length; i++) {
        if (LF_PHARMACY_URL_MAP[i].key === pharmKey) { pharm = LF_PHARMACY_URL_MAP[i]; break; }
      }
      if (!pharm) { toast('Unknown pharmacy tab', false); return; }
      if (lfCleanup) { try { lfCleanup(); } catch (e) {} lfCleanup = null; }
      var b = buildLfTarget(pharmKey);
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

      status.textContent = 'Fetching ' + pharm.name + ' (last 30 days)…';
      waitForLfx(pharm, nonce, lfPortalWin);
    }
    // Build the portal intent URL for a pharmacy.
    function buildLfTarget(pharmKey) {
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
          extract: { mode: 'last30', nonce: nonce }
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

    /* ============================================================
       WRITE BACK (v2.11) — Jeyson's ideal workflow
       Replace the tracking-number-only cells (bare TN text OR the sheet's
       HYPERLINK formula cell) with the full "Date Shipped + TN" blob.
       Uses ONLY verified mechanics (google-sheets-automation.md):
       - Sheets' native Find (#docs-findbar-input + Enter) selects the cell
       - the formula bar (#t-formula-bar-input .cell-input) shows the selected
         cell's content — that is the read-before-write guard
       - #t-name-box gives the cell ref — writes only happen in column H
       - constructed ClipboardEvent('paste') + synthetic Enter COMMITS
       Every write is guarded; anything ambiguous is SKIPPED, never overwritten.
       ============================================================ */

    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

    function ensureFindbar() {
      return new Promise(function (resolve) {
        var fb = document.querySelector('#docs-findbar');
        if (fb && fb.offsetParent !== null) { resolve(true); return; }
        toast('Press Ctrl+F to open Find, then wait…', true);
        var obs = new MutationObserver(function () {
          var f2 = document.querySelector('#docs-findbar');
          if (f2 && f2.offsetParent !== null) { obs.disconnect(); resolve(true); }
        });
        obs.observe(document.documentElement, { childList: true, subtree: true });
        setTimeout(function () { obs.disconnect(); resolve(false); }, 20000);
      });
    }

    function findAndSelect(tn) {
      return new Promise(function (resolve) {
        var input = document.querySelector('#docs-findbar-input');
        if (!input) { resolve(false); return; }
        input.focus();
        var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(input, tn);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: tn }));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        var t0 = Date.now();
        (function poll() {
          var nb = document.querySelector('#t-name-box');
          var ref = nb ? nb.textContent.trim() : '';
          if (ref && /H\d+$/i.test(ref)) { resolve(ref); return; }
          if (Date.now() - t0 > 6000) { resolve(ref || false); }
          setTimeout(poll, 300);
        })();
      });
    }

    function readCell() {
      var el = document.querySelector('#t-formula-bar-input .cell-input');
      return el ? (el.textContent || '').trim() : '';
    }

    function writeCell(value) {
      return new Promise(function (resolve) {
        var input = document.querySelector('#t-formula-bar-input .cell-input');
        if (!input) { resolve(false); return; }
        input.focus();
        var dt = new DataTransfer();
        dt.setData('text/plain', value);
        var ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        input.dispatchEvent(ev);
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        setTimeout(function () { resolve(ev.defaultPrevented === true); }, 700);
      });
    }

    function blobFor(it) {
      return '\nDate Shipped: ' + it.date + '\nTN: ' + (it.carrier ? it.carrier + ' - ' : '') + it.tn;
    }

    async function writeBack() {
      var items = currentItems && currentItems.length ? currentItems : parseToJSON();
      var bare = items.filter(function (it) { return it.tn && it.date && !it.hadBlob; });
      if (!bare.length) { toast('No bare-TN rows with extracted dates — run Open & Extract first', false); return; }
      renderTable(items, currentDateLabel);
      var fbOk = await ensureFindbar();
      if (!fbOk) { toast('Find bar never appeared — press Ctrl+F, then click Write Back again', false); return; }
      var written = 0, skipped = 0, failed = 0;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (!it.tn || !it.date || it.hadBlob) continue;
        setRow(i, 'opening');
        var ref = await findAndSelect(it.tn);
        if (!ref || !/H\d+$/i.test(ref)) { setRow(i, 'failed'); failed++; continue; }
        await sleep(400);
        var content = readCell();
        if (content.indexOf('Date Shipped') !== -1) { setRow(i, 'skip'); skipped++; continue; }   // already a blob
        if (content !== it.tn && !/^\s*=/.test(content)) { setRow(i, 'skip'); skipped++; continue; } // not bare TN or formula — never overwrite
        var took = await writeCell(blobFor(it));
        await sleep(800);
        var after = readCell();
        if (took && after.indexOf('Date Shipped') !== -1) { setRow(i, 'done', it.date); written++; }
        else { setRow(i, 'failed'); failed++; }
      }
      toast('Write-back: ' + written + ' written, ' + skipped + ' skipped, ' + failed + ' failed', written > 0);
    }

    /* ============================================================
       SWEEP SHIP DATES (v2.28) — fill the sheet's unfilled Date
       Shipped cells in place: scan the sheet DATA (internal gviz
       CSV endpoint — robust against the grid's virtualized DOM and
       slow renders), find TN cells lacking 'Date Shipped', open
       each carrier link (rebuilt via carrierUrl — same logic as
       the sheet's own formula), let the extractor publish tb:<tn>,
       then write the blob back to the target column (auto-detected
       by header name — "Date Shipped / Tracking #").
       ============================================================ */
    var sweepState = null; // { items, outputCol, error }

    function parseCsv(text) {
      // Quoted-aware CSV parser (blob cells contain \n inside quotes).
      var rows = []; var row = []; var cur = ''; var inQ = false;
      for (var i = 0; i < text.length; i++) {
        var ch = text[i];
        if (ch === '\r') continue;
        if (inQ) {
          if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
          else cur += ch;
        } else if (ch === '"') { inQ = true; }
        else if (ch === ',') { row.push(cur); cur = ''; }
        else if (ch === '\n') { row.push(cur); cur = ''; rows.push(row); row = []; }
        else cur += ch;
      }
      if (cur.length || row.length) { row.push(cur); rows.push(row); }
      return rows;
    }

    async function scanViaGviz() {
      // Read the active tab's data straight from the sheet (same-origin,
      // session cookie). Finds the "Date Shipped" column by header name.
      var m = location.pathname.match(/\/d\/([^/]+)/);
      var gid = (location.hash.match(/gid=(\d+)/) || [null, '0'])[1];
      if (!m) return { items: [], outputCol: null, error: 'no doc id in URL' };
      try {
        var res = await fetch('/spreadsheets/d/' + m[1] + '/gviz/tq?tqx=out:csv&gid=' + gid);
        if (!res.ok) return { items: [], outputCol: null, error: 'gviz ' + res.status };
        var rows = parseCsv(await res.text());
        var headerIdx = -1, targetCol = -1;
        for (var r = 0; r < Math.min(rows.length, 5); r++) {
          for (var c = 0; c < rows[r].length; c++) {
            if (String(rows[r][c]).indexOf('Date Shipped') !== -1) { headerIdx = r; targetCol = c; break; }
          }
          if (headerIdx >= 0) break;
        }
        if (targetCol < 0) return { items: [], outputCol: null, error: 'no "Date Shipped" column found' };
        var items = []; var seen = {};
        for (var i = headerIdx + 1; i < rows.length; i++) {
          var cell = String(rows[i][targetCol] || '').trim();
          if (!cell || cell.indexOf('Date Shipped') !== -1) continue; // empty or already a blob
          var tn = extractTN(cell);
          if (!tn || seen[tn]) continue;
          seen[tn] = 1;
          items.push({ tn: tn, patient: String(rows[i][4] || '').trim(), row: i + 1, col: targetCol + 1, date: '', carrier: carrierOf(tn) });
        }
        return { items: items, outputCol: targetCol + 1, error: '' };
      } catch (e) {
        return { items: [], outputCol: null, error: String((e && e.message) || e) };
      }
    }

    function colLetter(colIdx) {
      var s = ''; colIdx = colIdx - 1; // 1-based → 0-based
      while (colIdx >= 0) { s = String.fromCharCode(65 + (colIdx % 26)) + s; colIdx = Math.floor(colIdx / 26) - 1; }
      return s;
    }

    function selectCellRef(ref) {
      // Name-box navigation: "M123" + Enter selects that cell (same UI path
      // the sheet's own Go-To uses). Returns true if the selection landed.
      return new Promise(function (resolve) {
        var nb = document.querySelector('#t-name-box');
        if (!nb) { resolve(false); return; }
        nb.focus();
        var setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        setter.call(nb, ref);
        nb.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ref }));
        nb.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        nb.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        setTimeout(function () {
          var cur = document.querySelector('#t-name-box');
          resolve(cur ? (cur.value || '').trim().toUpperCase() === ref.toUpperCase() : false);
        }, 600);
      });
    }

    async function sweepExtractBatch(batch) {
      // Phase B: open each item's carrier link (own href preferred), poll
      // tb:<tn> until every item resolves or 90s elapses. Extractor tabs
      // self-close after publishing, so tab count stays bounded.
      batch.forEach(function (it) {
        GM_deleteValue('tb:' + it.tn);
        var w = window.open(carrierUrl(it.tn), '_blank');
        if (!w) it._fail = 'popup';
      });
      var t0 = Date.now();
      for (;;) {
        var pending = batch.filter(function (it) { return !it.date && !it._fail; });
        if (!pending.length) break;
        if (Date.now() - t0 > 90000) break;
        await sleep(800);
        pending.forEach(function (it) {
          var raw = GM_getValue('tb:' + it.tn, '');
          if (raw) {
            try { var rec = JSON.parse(raw); it.date = rec.date || ''; it.carrier = rec.carrier || it.carrier; }
            catch (e) { LOG('malformed tb payload for', it.tn); }
            GM_deleteValue('tb:' + it.tn);
          }
        });
      }
    }

    async function sweepWrite(item) {
      // Phase C: write the blob — to the detected output column (name-box
      // select), or in-place via find-by-TN. Guard is intentionally lighter
      // than Write Back's H-guard: sweep MUST consume =HYPERLINK cells (the
      // preview was the approval); only a race-gained blob is skipped.
      var ref = null;
      if (sweepState.outputCol && item.row) {
        ref = colLetter(sweepState.outputCol) + item.row;
        var ok = await selectCellRef(ref);
        if (!ok) ref = null; // name-box failed → fall back to find-by-TN
      }
      if (!ref) {
        var fb = await ensureFindbar();
        if (!fb) return 'failed';
        ref = await findAndSelect(item.tn);
        if (!ref) return 'failed';
      }
      await sleep(400);
      var content = readCell();
      if (content.indexOf('Date Shipped') !== -1) return 'skip'; // already a blob (race)
      if (!item.date) return 'failed'; // extractor never published / popup blocked
      var took = await writeCell(blobFor(item));
      await sleep(800);
      var after = readCell();
      return (took && after.indexOf('Date Shipped') !== -1) ? 'done' : 'failed';
    }

    async function sweepRun() {
      if (!sweepState || !sweepState.items || !sweepState.items.length) { toast('Nothing to sweep — scan first', false); return; }
      var items = sweepState.items;
      var BATCH = 8;
      var done = 0, skipped = 0, failed = 0;
      sweepBtn.disabled = true;
      for (var b = 0; b < items.length; b += BATCH) {
        var batch = items.slice(b, b + BATCH);
        sweepBtn.textContent = 'Sweeping… ' + Math.min(b + BATCH, items.length) + '/' + items.length;
        await sweepExtractBatch(batch);
        for (var i = 0; i < batch.length; i++) {
          var st = await sweepWrite(batch[i]);
          if (st === 'done') { done++; setRow(items.indexOf(batch[i]), 'done', batch[i].date); }
          else if (st === 'skip') { skipped++; setRow(items.indexOf(batch[i]), 'skip'); }
          else { failed++; setRow(items.indexOf(batch[i]), 'failed'); }
        }
        toast('Sweep: ' + done + ' done, ' + skipped + ' skipped, ' + failed + ' failed — continuing', done > 0);
      }
      sweepBtn.disabled = false;
      sweepBtn.textContent = '🧹 Sweep Ship Dates';
      sweepState = null;
      toast('Sweep complete: ' + done + ' written, ' + skipped + ' skipped, ' + failed + ' failed', done > 0);
    }

    async function sweepGo() {
      // Click 1: scan + preview (opens nothing). Click 2: confirm + run.
      if (sweepState && sweepState.items && sweepState.items.length) { sweepRun(); return; }
      status.textContent = 'Scanning sheet data…';
      var res = await scanViaGviz();
      sweepState = res;
      if (res.error) { status.textContent = 'Sweep scan failed: ' + res.error; sweepState = null; return; }
      if (!res.items.length) { status.textContent = 'No unfilled tracking cells found.'; sweepState = null; return; }
      currentItems = res.items;
      renderTable(res.items);
      status.textContent = 'Sweep: ' + res.items.length + ' cell(s) to fill in column ' + colLetter(res.outputCol) +
        ' ("Date Shipped / Tracking #"). Click 🧹 again to confirm & run.';
      toast('Preview ready — click 🧹 again to run', true);
    }

    function go() {
      var items = parseToJSON();
      currentItems = items;
      renderTable(items);
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
      '#tb-lf-fetch{background:var(--ds-info,#2c6e9c)}'
    ].join('');

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
      btn.onclick = go;

      driveBtn = document.createElement('button');
      driveBtn.textContent = 'Open & Extract';
      driveBtn.style.background = '#36c';
      driveBtn.onclick = openAndExtract;

      writeBtn = document.createElement('button');
      writeBtn.textContent = 'Write Back to Sheet';
      writeBtn.style.background = '#e67e22';
      writeBtn.onclick = writeBack;

      sweepBtn = document.createElement('button');
      sweepBtn.textContent = '🧹 Sweep Ship Dates';
      sweepBtn.style.background = '#7c5cfc';
      sweepBtn.title = 'Scan the grid for unfilled Date Shipped cells, open each carrier link, extract, write back. Click once to preview, again to run.';
      sweepBtn.onclick = sweepGo;

      lfFetchBtn = document.createElement('button');
      lfFetchBtn.id = 'tb-lf-fetch';
      lfFetchBtn.textContent = '⬇ Fetch 30 Days';
      lfFetchBtn.onclick = fetchLifeFileOrders;
      updateFetchLabel();

      status = document.createElement('div');
      status.id = 'tb-status';

      panel.appendChild(head);
      panel.appendChild(box);
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
      panelHead.textContent = '⠿ Tracking Bus';
      panelHead.style.cssText = 'user-select:none;font-weight:bold;margin-bottom:6px;padding:2px 6px;border-radius:4px;background:rgba(255,255,255,0.08);';
      makeDraggable(panel, panelHead, 'tb_panel_pos');
      panel.insertBefore(panelHead, panel.firstChild);
      panel.appendChild(lfFetchBtn);
      panel.appendChild(writeBtn);
      panel.appendChild(sweepBtn);
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
      makeDraggable(resultsPanel, rH1, 'tb_results_pos');
      resultsBody = document.createElement('div');
      resultsBody.id = 'tb-results-body';
      resultsPanel.appendChild(rHead);
      resultsPanel.appendChild(resultsBody);

      document.documentElement.appendChild(resultsPanel);
      document.documentElement.appendChild(panel);
      LOG('panel mounted');
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', build);
    } else {
      build();
    }
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