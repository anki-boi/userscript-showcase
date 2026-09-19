// ==UserScript==
// @name         Tracking Swiss Army Knife
// @namespace    userscript-showcase
// @version      1.0.13
// @author       Jeyson Dagondon
// @run-at       document-idle
// @description  FedEx/UPS tracking panel: paste numbers, fetch full timelines, copy updates
// @match        *://*/*
// @match        https://www.ups.com/*
// @match        *://*.fedex.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addStyle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[TSAK v1.0.13] boot');

// --- Script API (R18) ---
const __WIN = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window; // TM sandbox: page window lives here
__WIN.__scripts = __WIN.__scripts || {};
__WIN.__scripts['TSAK'] = {
  name: 'Tracking Swiss Army Knife',
  version: '1.0.13',
  state: 'idle',
  message: '',
  progress: null,
  output: null,
  error: null,
  lastActivity: Date.now(),
  trigger: null
};

/* ============================================================================
   CONFIG — edit these to fit your clinic / tone (messages are local templates)
   ============================================================================ */
const CONFIG = {
  greeting: 'Hi there!',
  closing: 'Let me know if you have any questions!',
  quickTpl: '{greeting}\n\nQuick update on your {carrier} order ({tn}): {status}.\n\n{closing}',
  verboseTpl: '{greeting}\n\nHere\u2019s the full update for your {carrier} order ({tn}):\n\n{timeline}\n\n{closing}',
  fedexRetries: 3,   // FedEx often errors on first load — auto-reload up to N times
  upsRetries: 2,
  retryDelayMs: 3500,
  pollMs: 1500,
  jobTimeoutMs: 180000,
  stallMs: 30000,   // no data AND no error after this long = broken page, retry
  socialExclude: [  // ← EDIT: don't show the panel on these sites (root domains — no leading/trailing dots)
    'facebook.com', 'instagram.com', 'x.com', 'twitter.com', 'tiktok.com', 'linkedin.com',
    'snapchat.com', 'pinterest.com', 'reddit.com', 'discord.com', 'threads.net', 'tumblr.com',
    'bluesky.social', 'youtube.com', 'whatsapp.com', 'twitch.tv', 'telegram.me', 'mastodon.social'
  ]
};

const CARRIERS = {
  ups:   { name: 'UPS',   re: /^1Z/i,     url: tn => `https://www.ups.com/track?track=yes&trackNums=${tn}&loc=en_US` },
  fedex: { name: 'FedEx', re: /^\d{12,}$/, url: tn => `https://www.fedex.com/wtrk/track/?tracknumbers=${tn}` }
};
const STATUS_STYLE = { Delivered: '#3d7a46', 'Out for Delivery': '#a16207', 'In Transit': '#2c6e9c', Exception: '#b3402e', 'Label Created': '#7a7163' };

(function () {
  'use strict';

  const LOG = (...a) => console.log('[TSAK]', ...a);
  const HOST = location.hostname;
  // skip the panel on social media: exact root-domain suffix match (safe for e.g. 'x.com')
  const isSocial = d => HOST === d || HOST.endsWith('.' + d);

  /* ---------- GM storage helpers (script-scoped, shared across origins) ---------- */
  const gset = (k, v) => GM_setValue(k, JSON.stringify(v));
  const gdel = (k) => GM_deleteValue(k);
  function gget(k, fb) { try { const v = GM_getValue(k); return v ? JSON.parse(v) : fb; } catch (e) { return fb; } }

  /* ---------- shared UI helpers ---------- */
  function toast(msg, ok) {
    const el = document.createElement('div');
    el.textContent = msg;
    Object.assign(el.style, {
      position: 'fixed', top: '24px', left: '50%', transform: 'translateX(-50%)',
      zIndex: '2147483647', padding: '10px 22px', fontSize: '14px', fontWeight: '700',
      background: ok === false ? '#b3402e' : '#3d7a46', color: '#fff',
      borderRadius: '10px', boxShadow: '0 4px 14px rgba(0,0,0,0.3)',
      transition: 'opacity 0.3s', fontFamily: 'system-ui, sans-serif', maxWidth: '90vw'
    });
    (document.body || document.documentElement).appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; }, 600);
    setTimeout(() => el.remove(), 900);
  }
  function firstMatch(text, re) { const m = text.match(re); return m ? (m[1] || m[0]).trim() : ''; }
  function lineAfter(lines, label) {
    const i = lines.findIndex(l => l.toLowerCase() === label.toLowerCase() || l.toLowerCase().includes(label.toLowerCase()));
    return i >= 0 && lines[i + 1] ? lines[i + 1].trim() : '';
  }
  function fmtDate(mdy, withYear) {
    const m = String(mdy).match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (!m) return mdy;
    const year = m[3].length === 2 ? '20' + m[3] : m[3];
    const d = new Date(+year, +m[1] - 1, +m[2]);
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', year: withYear ? 'numeric' : undefined }).format(d);
  }
  function fmtTime(t) { return String(t).replace(/\./g, '').trim(); } // 10:20 A.M. -> 10:20 AM

  function api() { return __WIN.__scripts['TSAK']; }
  function setState(state, msg, extra) {
    const a = api();
    a.state = state; a.message = msg || ''; a.lastActivity = Date.now();
    if (extra) Object.assign(a, extra);
  }

  /* ============================================================================
     RESULT WRITING + QUEUE (shared by both carrier workers)
     ============================================================================ */
  function queueJobs(carrier) {
    const q = gget('tsak:queue', { jobs: [] });
    return q.jobs.filter(j => j.carrier === carrier && !j.done);
  }
  function writeResult(tn, data) {
    gset('tsak:result:' + tn, Object.assign({ tn, ts: Date.now() }, data));
    const q = gget('tsak:queue', { jobs: [] });
    const j = q.jobs.find(x => x.tn === tn);
    if (j) j.done = true;
    gset('tsak:queue', q);
    gdel('tsak:retry:' + tn);
    LOG('result written', tn, data.status || data.error);
  }

  /* ============================================================================
     CARRIER WORKER — runs on ups.com / fedex.com, drains the queue for its carrier
     ============================================================================ */
  function runWorker(carrier) {
    const jobs = queueJobs(carrier);
    if (!jobs.length) return;
    LOG('worker active for', carrier, jobs.length, 'job(s)');
    const start = Math.max(0, jobs.findIndex(j => location.href.includes(j.tn)));
    processJob(carrier, jobs[start] || jobs[0]);
  }

  function processJob(carrier, job) {
    const C = CARRIERS[carrier];
    const tn = job.tn;
    if (!location.href.includes(tn)) { location.href = C.url(tn); return; } // navigate -> script re-boots, resumes via queue

    const retries = gget('tsak:retry:' + tn, { n: 0 }).n;
    const deadline = Date.now() + CONFIG.jobTimeoutMs;
    let clickedDetails = false;

    const attempt = (isReload) => {
      if (isReload) {
        gset('tsak:retry:' + tn, { n: retries + 1 });
        setTimeout(() => { location.href = C.url(tn); }, CONFIG.retryDelayMs); // hard re-entry, same TN
        return;
      }
      extractor(carrier, tn, deadline, () => {
        clickedDetails = true; // placeholder; extractor drives its own clicks
      });
    };
    attempt(false);
  }

  /* --- extraction drivers --- */
  function extractor(carrier, tn, deadline, onDone) {
    const C = CARRIERS[carrier];
    let summarySeenAt = 0, lastCount = -1, stableRounds = 0;
    const pollStart = Date.now();
    const poll = setInterval(() => {
      if (Date.now() > deadline) {
        clearInterval(poll);
        writeResult(tn, { carrier, error: 'timeout' });
        nextJob(carrier, tn);
        return;
      }
      const err = detectError(carrier) ||
        (Date.now() - pollStart > CONFIG.stallMs && !summarySeenAt ? 'page stalled (no data rendered)' : '');
      if (err) {
        clearInterval(poll);
        const retries = gget('tsak:retry:' + tn, { n: 0 }).n;
        const max = carrier === 'fedex' ? CONFIG.fedexRetries : CONFIG.upsRetries;
        if (retries < max) { LOG(carrier, 'error state, retrying', retries + 1, '/', max, err); toast('TSAK: ' + C.name + ' error — retrying (' + (retries + 1) + '/' + max + ')', false); reloadWithRetry(carrier, tn); }
        else { LOG(carrier, 'retries exhausted:', err); writeResult(tn, { carrier, error: err }); nextJob(carrier, tn); }
        return;
      }
      const data = extractSummary(carrier);
      if (data && data.status) {
        if (!summarySeenAt) summarySeenAt = Date.now();
        ensureExpanded(carrier); // idempotent: click Show Details / View more until expanded
        const tl = extractTimeline(carrier);
        const n = tl.length;
        if (n === lastCount) stableRounds++; else { stableRounds = 0; lastCount = n; }
        // extract once the timeline settles (1 unchanged round) or after a 12s cap (summary-only)
        const settled = n >= 1 && stableRounds >= 1;
        const capped = Date.now() - summarySeenAt > 12000;
        if (settled || capped) {
          clearInterval(poll);
          if (/deliver/i.test(data.status) && tl.length && tl[tl.length - 1].location &&
              !/,\s*[A-Z]{2}(?:\s*US)?$/i.test(data.deliveredTo || '')) {
            data.deliveredTo = tl[tl.length - 1].location; // "Residence"/placeholder: real delivery location = last scan
          }
          writeResult(tn, Object.assign(data, { timeline: tl }));
          nextJob(carrier, tn);
        }
      }
    }, CONFIG.pollMs);
  }

  function ensureExpanded(carrier) {
    try {
      if (carrier === 'ups') {
        const b = document.querySelector('#showDetailButton');
        if (b && !/hide/i.test(b.textContent || '')) b.click();
      } else {
        const el = [...document.querySelectorAll('a,button,div')].find(e =>
          /view more details|view history|travel history/i.test((e.textContent || '').trim()) && (e.textContent || '').trim().length < 40);
        if (el) el.click();
      }
    } catch (e) { /* stale node — retry next poll */ }
  }

  function reloadWithRetry(carrier, tn) {
    const retries = gget('tsak:retry:' + tn, { n: 0 }).n;
    gset('tsak:retry:' + tn, { n: retries + 1 });
    setTimeout(() => { location.href = CARRIERS[carrier].url(tn); }, CONFIG.retryDelayMs);
  }

  function nextJob(carrier, tn) {
    const jobs = queueJobs(carrier);
    const i = jobs.findIndex(j => j.tn === tn);
    const next = jobs[i + 1];
    if (next) { LOG('next job', carrier, next.tn); location.href = CARRIERS[carrier].url(next.tn); }
    else { LOG('queue drained for', carrier); toast('TSAK: ' + CARRIERS[carrier].name + ' done — all queued numbers processed', true); }
  }

  /* --- error detection (R1: never trust placeholder text) --- */
  function detectError(carrier) {
    const body = (document.body ? document.body.innerText : '').replace(/\s+/g, ' ');
    if (/system-error|no-results-found|tracking-error/i.test(location.href)) return 'tracking page error';
    if (carrier === 'fedex' && /can'?t find that tracking number|unable to locate|we are unable to find|cannot be found|no records found|no results found/i.test(body)) return 'tracking number not found / page error';
    if (carrier === 'ups' && /ups could not locate|we'?re unable to locate|tracking number.*(not found|incorrect)|please try again later|session has expired/i.test(body)) return 'tracking not found / page error';
    return '';
  }

  /* --- summary + timeline extraction (UPS and FedEx) --- */
  function extractSummary(carrier) {
    if (carrier === 'ups') return extractUpsSummary();
    return extractFedexSummary();
  }
  function extractTimeline(carrier) {
    if (carrier === 'ups') return extractUpsTimeline();
    return extractFedexTimeline();
  }

  /* UPS: summary from the top of app-track-details; timeline from Package History */
  function upsSegment() {
    const el = document.querySelector('app-track-details');
    const t = el ? el.innerText : (document.body ? document.body.innerText : '');
    const lines = t.split('\n').map(s => s.trim()).filter(Boolean);
    const i = lines.findIndex(l => /package history/i.test(l));
    return { lines, head: lines.slice(0, i >= 0 ? i : 200), tail: lines.slice(i >= 0 ? i : 0) };
  }
  function extractUpsSummary() {
    const { lines, head } = upsSegment();
    const headTxt = head.join('\n');
    if (!headTxt || !/track/i.test(headTxt)) return null;
    if (!/[A-Za-z]{3,}/.test(headTxt)) return null; // R1: no real data yet
    const status = firstMatch(headTxt, /(Delivered|Out for Delivery|In Transit|On the Way|Delayed|Exception|Label Created|We Have Your Package|We'?ve Received|Ready for Pickup|Returning to Sender)/i).replace(/\b\w/g, c => c.toUpperCase());
    if (!status) return null;
    const deliveredTo = lineAfter(lines, 'Delivered To');
    // R1: UPS renders "United States" as a placeholder before the real address
    if (/^deliver/i.test(status) && deliveredTo && !/,\s*[A-Z]{2}/i.test(deliveredTo)) return null;
    let eta = '';
    const deliv = headTxt.match(/(\w+day,\s*\w+\s+\d{1,2})\s+at\s+(\d{1,2}:\d{2}\s*[AP]\.?M\.?)/i);
    if (deliv) eta = deliv[1].replace(/\w+day,\s*/i, '') + ' at ' + fmtTime(deliv[2]);
    else {
      const e = firstMatch(headTxt, /(?:expected delivery|delivery date|delivering on|delivering by)\s*[:\s]*([\w\s\/,]+?)(?:\s{2,}|$)/i);
      if (e) eta = 'Estimated delivery: ' + e.replace(/\.$/, '');
    }
    return {
      carrier: 'UPS',
      status,
      eta: eta.trim(),
      deliveredTo,
      service: lineAfter(lines, 'Service'),
      shippedOn: lineAfter(lines, 'Shipped / Billed On'),
      url: location.href
    };
  }
  function extractUpsTimeline() {
    const { tail } = upsSegment();
    const lines = tail.map(l => l.trim()).filter(Boolean).filter(l => !/time zone|keyboard_arrow/i.test(l));
    const dateRe = /^(\d{1,2}\/\d{1,2}\/\d{2,4})$/;
    const timeRe = /^(\d{1,2}:\d{2}\s*[AP]\.?M\.?)$/i;
    const stopRe = /^proof of delivery|^file a claim|^shipment details|^stay safe|^lock$/i;
    const events = [];
    let cur = null;
    for (const ln of lines) {
      let m;
      if (stopRe.test(ln)) break; // end of Package History
      if ((m = ln.match(dateRe))) { if (cur) events.push(cur); cur = { date: m[1], time: '', status: '', detail: '', location: '' }; }
      else if (cur && (m = ln.match(timeRe))) { cur.time = m[1]; }
      else if (cur) {
        if (!cur.status) cur.status = ln;
        else if (!cur.detail) cur.detail = ln;
        else cur.location = (cur.location ? cur.location + ' ' : '') + ln;
      }
    }
    if (cur) events.push(cur);
    // UPS locations may be "Los Angeles, CA, United States" — move from detail to location
    const locFix = /(?:,\s*[A-Z]{2}(?:,\s*(?:United States|US))?|United States)$/i;
    for (const ev of events) {
      if (!ev.location && ev.detail && locFix.test(ev.detail)) { ev.location = ev.detail; ev.detail = ''; }
    }
    return events;
  }

  /* FedEx: summary from label/value pairs; timeline from the Travel History text section */
  function fedexSegments() {
    const t = document.body ? document.body.innerText : '';
    const lines = t.split('\n').map(s => s.trim()).filter(Boolean);
    const hi = lines.findIndex(l => /travel history/i.test(l));
    const si = lines.findIndex(l => /shipment facts|shipment overview/i.test(l));
    return { lines, travel: lines.slice(hi >= 0 ? hi : 0), facts: lines.slice(si >= 0 ? si : 0) };
  }
  function extractFedexSummary() {
    const { lines, travel, facts } = fedexSegments();
    const head = travel.slice(0, 30).join('\n');
    if (!head || !/[A-Za-z]{3,}/.test(head)) return null;
    const has = re => new RegExp(re, 'im').test(lines.join('\n')); // 'm': ^/$ match per line
    const labelVal = (label) => {
      // exact all-caps facts labels only; reject prefix collisions ("DELIVERED" must not match "DELIVERED TO")
      const i = facts.findIndex(l => {
        const up = l.toUpperCase();
        if (up === label) return true;
        if (!up.startsWith(label)) return false;
        const rest = up.slice(label.length).trim();
        return rest && !(!rest.includes(' ') && /^[A-Z]+$/.test(rest)); // reject "TO" in "DELIVERED TO", "S" in "Services"
      });
      if (i < 0) return '';
      const rest = facts[i].slice(label.length).trim();
      return rest || (facts[i + 1] && !/^[A-Z0-9\s']+$/.test(facts[i + 1]) ? facts[i + 1] : '');
    };
    let status;
    if (has('^DELIVERED$')) status = 'Delivered';
    else if (has('on fedex vehicle for delivery|out for delivery')) status = 'Out for Delivery';
    else if (has('shipment information sent')) status = 'Label Created';
    else if (has('in transit|arrived at|departed|at local fedex|picked up')) status = 'In Transit';
    else status = firstMatch(head, /(Delivered|In Transit|Out for Delivery|Label Created|Exception|Delayed|Returning to Sender)/i) || '';
    if (!status) return null;
    let eta = '';
    const deliv = labelVal('DELIVERED');
    const std = labelVal('STANDARD TRANSIT');
    if (deliv) eta = deliv.trim();
    else if (std) eta = 'Estimated delivery: ' + std.trim();
    return {
      carrier: 'FedEx',
      status,
      eta: eta.trim(),
      service: labelVal('SERVICE'),
      deliveredTo: labelVal('DELIVERED TO'),
      shippedOn: labelVal('SHIP DATE'),
      url: location.href
    };
  }
  function extractFedexTimeline() {
    const { travel } = fedexSegments();
    const dateRe = /^(\w+day,\s*\d{1,2}\/\d{1,2}\/\d{2,4})$/i;
    const timeRe = /^(\d{1,2}:\d{2}\s*[AP]\.?M\.?)$/i;
    const locRe = /^[\w.'-]+(?:\s+[\w.'-]+)*,\s*[A-Z]{2}(?:\s+\d{5})?$/i;
    const events = [];
    let curDate = '', cur = null;
    for (const ln of travel) {
      if (/^(date\s*time|travel history)/i.test(ln)) continue;
      if (/^shipment facts|^shipment overview|^our company|^more from fedex|^track another shipment|^local scan time|^help$/i.test(ln)) break; // end of timeline
      let m;
      if ((m = ln.match(dateRe))) { curDate = m[1].replace(/^\w+day,\s*/i, ''); continue; } // "Thursday, 8/27/26" -> "8/27/26"
      if ((m = ln.match(timeRe))) {
        if (cur) events.push(cur);
        cur = { date: curDate, time: m[1], status: '', detail: '', location: '' };
        continue;
      }
      if (!cur) continue;
      if (locRe.test(ln)) cur.location = ln;
      else if (!cur.status) cur.status = ln;
      else cur.detail = (cur.detail ? cur.detail + ' ' : '') + ln;
    }
    if (cur) events.push(cur);
    // fallback: table rows when the text section is empty
    if (!events.length) {
      for (const row of document.querySelectorAll('tr.travel-history-table__row')) {
        const ls = (row.innerText || '').split('\n').map(s => s.trim()).filter(Boolean);
        if (ls.length) events.push({ date: ls[0] || '', time: ls[1] || '', status: ls[2] || '', detail: '', location: ls[ls.length - 1] && locRe.test(ls[ls.length - 1]) ? ls[ls.length - 1] : '' });
      }
    }
    return events;
  }

  /* ============================================================================
     PANEL — runs on every other site: arrow + panel + fetch orchestration
     ============================================================================ */
  if (!/ups\.com|fedex\.com/i.test(HOST) && !CONFIG.socialExclude.some(isSocial)) bootPanel();
  else runWorker(/ups\.com/i.test(HOST) ? 'ups' : 'fedex');

  function bootPanel() {
    GM_addStyle(`
      :root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#fff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}
      #tsak-arrow{position:fixed;right:0;top:45%;transform:translateY(-50%);z-index:2147483647;background:var(--ds-accent,#8a5f2e);color:#fff;border:none;border-radius:10px 0 0 10px;padding:12px 6px;font-size:16px;cursor:pointer;box-shadow:-2px 2px 8px rgba(0,0,0,.25);font-family:system-ui,sans-serif}
      #tsak-arrow:hover{background:#a2743f}
      #tsak-panel{position:fixed;top:45%;right:40px;width:360px;max-width:94vw;max-height:80vh;height:auto;z-index:2147483646;background:var(--ds-bg);border:1px solid var(--ds-border);border-radius:14px;box-shadow:0 8px 30px rgba(0,0,0,.3);display:flex;flex-direction:column;font-family:system-ui,sans-serif;font-size:13px;color:var(--ds-text);transform:translateY(-50%) translateX(calc(100% + 60px));transition:transform .25s ease;overflow:hidden}
      #tsak-panel.open{transform:translateY(-50%) translateX(0)}
      #tsak-head{display:flex;align-items:center;gap:8px;padding:10px 14px;background:var(--ds-surface);border-bottom:1px solid var(--ds-border)}
      #tsak-head b{font-size:14px;flex:1}
      #tsak-head button{background:none;border:none;cursor:pointer;font-size:15px;color:var(--ds-muted);padding:2px 6px;border-radius:6px}
      #tsak-head button:hover{background:var(--ds-surface2)}
      #tsak-body{flex:1 1 auto;min-height:0;overflow-y:auto;padding:12px}
      #tsak-input{width:100%;box-sizing:border-box;height:64px;resize:vertical;border:1px solid var(--ds-border);border-radius:8px;padding:8px;font-family:ui-monospace,Consolas,monospace;font-size:12px;background:var(--ds-surface)}
      #tsak-pills{display:flex;flex-wrap:wrap;gap:4px;margin:6px 0}
      .tsak-pill{font-size:11px;padding:2px 8px;border-radius:20px;background:var(--ds-surface2);border:1px solid var(--ds-border);color:var(--ds-muted)}
      .tsak-pill.ups{background:#5b3a1e;color:#fff;border-color:#5b3a1e}
      .tsak-pill.fedex{background:#4d148c;color:#fff;border-color:#4d148c}
      .tsak-pill.bad{background:var(--ds-danger);color:#fff;border-color:var(--ds-danger)}
      #tsak-fetch{width:100%;padding:9px;border:none;border-radius:8px;background:var(--ds-accent);color:var(--ds-accent-text);font-weight:700;font-size:13px;cursor:pointer}
      #tsak-fetch:disabled{opacity:.6;cursor:default}
      #tsak-status{font-size:12px;color:var(--ds-muted);margin:8px 0 2px;min-height:16px}
      #tsak-cards{display:flex;flex-direction:column;gap:10px;margin-top:8px}
      .tsak-card{background:var(--ds-surface);border:1px solid var(--ds-border);border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:6px}
      .tsak-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
      .tsak-carrier{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--ds-muted)}
      .tsak-status{font-size:13px;font-weight:700;display:inline-flex;align-items:center;gap:5px;white-space:nowrap}
      .tsak-status::before{content:'';width:9px;height:9px;border-radius:50%;background:currentColor;display:inline-block;flex:none}
      .tsak-tn{font-family:ui-monospace,Consolas,monospace;font-size:12px;color:var(--ds-text);word-break:break-all}
      .tsak-facts{display:grid;grid-template-columns:auto 1fr;column-gap:10px;row-gap:3px;font-size:12px;margin-top:2px}
      .tsak-facts .k{color:var(--ds-muted);white-space:nowrap}
      .tsak-facts .v{color:var(--ds-text);font-weight:600}
      .tsak-actions{display:flex;gap:6px;margin-top:4px}
      .tsak-actions button{flex:1;padding:6px;border:1px solid var(--ds-border);border-radius:6px;background:var(--ds-surface2);cursor:pointer;font-size:12px;font-weight:600;color:var(--ds-text)}
      .tsak-actions button:hover{background:var(--ds-border)}
      .tsak-actions button.primary{background:var(--ds-accent);color:var(--ds-accent-text);border-color:var(--ds-accent)}
      .tsak-err{color:var(--ds-danger);font-size:12px;margin-top:6px}
      details.tsak-tl{margin-top:8px}
      details.tsak-tl summary{cursor:pointer;font-size:12px;font-weight:600;color:var(--ds-info)}
      .tsak-ev{padding:5px 0;border-bottom:1px dashed var(--ds-border);font-size:12px}
      .tsak-ev:last-child{border-bottom:none}
      .tsak-ev .when{font-weight:700;color:var(--ds-accent)}
      .tsak-ev .loc{color:var(--ds-muted)}
    `);

    const state = { results: {}, pending: [], timers: [] };

    /* ---------- panel DOM ---------- */
    const arrow = document.createElement('button');
    arrow.id = 'tsak-arrow'; arrow.textContent = '\u{1F4E6}'; arrow.title = 'Tracking Swiss Army Knife';
    const panel = document.createElement('div');
    panel.id = 'tsak-panel';
    panel.innerHTML = `
      <div id="tsak-head"><b>\u{1F4E6} Tracking Swiss Army Knife</b><button id="tsak-close" title="Close">\u2715</button></div>
      <div id="tsak-body">
        <textarea id="tsak-input" placeholder="Paste tracking numbers — one per line or comma-separated.&#10;&#10;UPS:   1Z21939F0154586631&#10;FedEx: 874943274752"></textarea>
        <div id="tsak-pills"></div>
        <button id="tsak-fetch">Fetch statuses</button>
        <div id="tsak-status"></div>
        <div id="tsak-cards"></div>
      </div>`;
    (document.body || document.documentElement).appendChild(arrow);
    (document.body || document.documentElement).appendChild(panel);
    const $ = id => panel.querySelector('#' + id);
    const input = $('tsak-input'), pillsEl = $('tsak-pills'), fetchBtn = $('tsak-fetch'),
          statusEl = $('tsak-status'), cardsEl = $('tsak-cards');

    arrow.addEventListener('click', () => panel.classList.toggle('open'));
    $('tsak-close').addEventListener('click', () => panel.classList.remove('open'));

    /* ---------- paste -> live detect ---------- */
    function parseTns(raw) {
      const seen = new Set();
      const out = [];
      for (const tok of String(raw).split(/[\s,;]+/)) {
        const t = tok.trim();
        if (!t || seen.has(t)) continue;
        seen.add(t);
        const c = Object.keys(CARRIERS).find(k => CARRIERS[k].re.test(t));
        out.push({ tn: t, carrier: c || null });
      }
      return out;
    }
    function renderPills(list) {
      pillsEl.innerHTML = '';
      for (const p of list) {
        const el = document.createElement('span');
        el.className = 'tsak-pill ' + (p.carrier || 'bad');
        el.textContent = (p.carrier ? p.carrier.toUpperCase() + ' ' : '?? ') + p.tn;
        pillsEl.appendChild(el);
      }
    }
    let lastParsed = [];
    input.addEventListener('input', () => {
      lastParsed = parseTns(input.value);
      renderPills(lastParsed);
      const bad = lastParsed.filter(p => !p.carrier);
      fetchBtn.disabled = !lastParsed.length;
      fetchBtn.textContent = bad.length ? `Fetch (${lastParsed.length - bad.length} ok, ${bad.length} unknown)` : `Fetch ${lastParsed.length} tracking number${lastParsed.length === 1 ? '' : 's'}`;
    });

    /* ---------- fetch orchestration ---------- */
    function openCarrierTab(carrier, tn) {
      try { return window.open(CARRIERS[carrier].url(tn), '_blank'); }
      catch (e) { return null; }
    }

    function doFetch(list) {
      const jobs = list.filter(p => p.carrier).map(p => ({ tn: p.tn, carrier: p.carrier, done: false }));
      if (!jobs.length) { toast('No valid tracking numbers', false); return; }
      // always live fetch: wipe prior results + retry counters for these TNs
      for (const j of jobs) { gdel('tsak:result:' + j.tn); gdel('tsak:retry:' + j.tn); }
      gset('tsak:queue', { jobs, ts: Date.now() });
      state.results = {};
      state.pending = jobs.slice();
      renderAll();
      setState('running', 'Fetching ' + jobs.length + '...');
      statusEl.textContent = 'Opening carrier tabs\u2026';
      // one tab per carrier, opened synchronously in this click gesture (R15)
      const carriers = [...new Set(jobs.map(j => j.carrier))];
      for (const c of carriers) {
        const first = jobs.find(j => j.carrier === c);
        const win = openCarrierTab(c, first.tn);
        if (!win) statusEl.textContent = '⚠ Popup blocked — allow popups for this site, then click Fetch again.';
      }
      schedulePoll();
    }

    function schedulePoll() {
      const t = setInterval(() => {
        const stillPending = [];
        for (const j of state.pending) {
          const r = gget('tsak:result:' + j.tn, null);
          if (r) { state.results[j.tn] = r; }
          else stillPending.push(j);
        }
        state.pending = stillPending;
        renderAll();
        if (!stillPending.length) {
          clearInterval(t);
          setState('done', 'All fetched');
          statusEl.textContent = '✓ All ' + Object.keys(state.results).length + ' fetched.';
          return;
        }
        statusEl.textContent = `\u23F3 Fetching ${state.pending.length}/${state.pending.length + Object.keys(state.results).length} \u2014 tabs are working in the background\u2026`;
      }, CONFIG.pollMs);
      state.timers.push(t);
    }

    /* ---------- rendering ---------- */
    function chipColor(status) {
      const s = String(status || '');
      if (/deliver/i.test(s)) return STATUS_STYLE.Delivered;
      if (/out for delivery|on fedex vehicle/i.test(s)) return STATUS_STYLE['Out for Delivery'];
      if (/exception|delayed|returning/i.test(s)) return STATUS_STYLE.Exception;
      if (/label created|shipment information/i.test(s)) return STATUS_STYLE['Label Created'];
      return STATUS_STYLE['In Transit'];
    }
    function messageQuick(r) {
      const carrier = CARRIERS[r.carrier] ? CARRIERS[r.carrier].name : r.carrier;
      let statusPhrase = r.status;
      if (r.eta) {
        if (/^deliver/i.test(r.status)) statusPhrase = r.status + ' on ' + r.eta.replace(/^delivered\s+on\s*/i, '');
        else statusPhrase = r.status + '. ' + r.eta;
      }
      return CONFIG.quickTpl
        .replace('{greeting}', CONFIG.greeting)
        .replace('{carrier}', carrier)
        .replace('{tn}', r.tn)
        .replace('{status}', statusPhrase)
        .replace('{closing}', CONFIG.closing);
    }
    function messageVerbose(r) {
      const carrier = CARRIERS[r.carrier] ? CARRIERS[r.carrier].name : r.carrier;
      let timeline;
      if (r.timeline && r.timeline.length) {
        timeline = r.timeline.map(ev => {
          let line = '• ' + (ev.date ? fmtDate(ev.date, true) : '?') + (ev.time ? ', ' + fmtTime(ev.time) : '');
          line += ' — ' + (ev.status || ev.detail || 'Update');
          if (ev.detail && ev.detail.toLowerCase() !== (ev.status || '').toLowerCase()) line += ' — ' + ev.detail;
          if (ev.location) line += ' — ' + ev.location;
          return line;
        }).join('\n');
      } else {
        timeline = 'No detailed timeline available. Current status: ' + (r.status || 'n/a') + (r.eta ? '. ' + r.eta : '');
      }
      return CONFIG.verboseTpl
        .replace('{greeting}', CONFIG.greeting)
        .replace('{carrier}', carrier)
        .replace('{tn}', r.tn)
        .replace('{timeline}', timeline)
        .replace('{closing}', CONFIG.closing);
    }
    function copyText(text) {
      navigator.clipboard.writeText(text).then(() => toast('✓ Message copied'), () => toast('⚠ Copy failed', false));
    }
    function renderAll() {
      cardsEl.innerHTML = '';
      const list = state.pending.concat(Object.values(state.results).map(r => ({ pending: false, r })));
      const pendingByTn = {};
      for (const p of state.pending) pendingByTn[p.tn] = true;
      for (const tn of Object.keys(state.results)) {
        const r = state.results[tn];
        const card = document.createElement('div');
        card.className = 'tsak-card';
        const top = document.createElement('div'); top.className = 'tsak-top';
        const carrier = document.createElement('span');
        carrier.className = 'tsak-carrier';
        carrier.textContent = (r.carrier || '?').toUpperCase();
        top.appendChild(carrier);
        const tnEl = document.createElement('div');
        tnEl.className = 'tsak-tn'; tnEl.textContent = r.tn;
        card.appendChild(top);
        card.appendChild(tnEl);
        if (r.error) {
          const err = document.createElement('div');
          err.className = 'tsak-err';
          err.textContent = '⚠ ' + r.error + (r.error === 'timeout' ? ' — the carrier page may be slow; try Refresh.' : '');
          card.appendChild(err);
        } else {
          const st = document.createElement('span');
          st.className = 'tsak-status'; st.textContent = r.status;
          st.style.color = chipColor(r.status);
          top.appendChild(st);
          const facts = document.createElement('div');
          facts.className = 'tsak-facts';
          const rows = [['Service', r.service], ['Shipped', r.shippedOn], ['Delivered to', r.deliveredTo], ['ETA', r.eta]].filter(x => x[1]);
          for (const [k, v] of rows) {
            const kk = document.createElement('span'); kk.className = 'k'; kk.textContent = k;
            const vv = document.createElement('span'); vv.className = 'v'; vv.textContent = v;
            facts.appendChild(kk); facts.appendChild(vv);
          }
          card.appendChild(facts);
          if ((r.timeline || []).length) {
            const d = document.createElement('details');
            d.className = 'tsak-tl';
            const s = document.createElement('summary');
            s.textContent = 'Full timeline (' + r.timeline.length + ' events)';
            d.appendChild(s);
            const body = document.createElement('div');
            for (const ev of r.timeline) {
              const e = document.createElement('div');
              e.className = 'tsak-ev';
              const when = document.createElement('span');
              when.className = 'when';
              when.textContent = (ev.date ? fmtDate(ev.date) + (ev.time ? ' ' + fmtTime(ev.time) : '') : '?');
              e.appendChild(when);
              e.appendChild(document.createTextNode(' — ' + (ev.status || ev.detail || 'Update')));
              if (ev.detail && ev.detail !== ev.status) {
                const d2 = document.createElement('span');
                d2.className = 'loc';
                d2.textContent = ' (' + ev.detail + ')';
                e.appendChild(d2);
              }
              if (ev.location) {
                const l2 = document.createElement('span');
                l2.className = 'loc';
                l2.textContent = ' · ' + ev.location;
                e.appendChild(l2);
              }
              body.appendChild(e);
            }
            d.appendChild(body);
            card.appendChild(d);
          }
          const actions = document.createElement('div');
          actions.className = 'tsak-actions';
          const b1 = document.createElement('button');
          b1.className = 'primary'; b1.textContent = 'Copy quick update';
          b1.addEventListener('click', () => copyText(messageQuick(r)));
          const b2 = document.createElement('button');
          b2.textContent = 'Copy full update';
          b2.addEventListener('click', () => copyText(messageVerbose(r)));
          const b3 = document.createElement('button');
          b3.textContent = '⟳'; b3.title = 'Re-fetch this number';
          b3.addEventListener('click', () => doFetch([{ tn: r.tn, carrier: r.carrier }]));
          actions.appendChild(b1); actions.appendChild(b2); actions.appendChild(b3);
          card.appendChild(actions);
        }
        cardsEl.appendChild(card);
      }
      for (const p of state.pending) {
        if (pendingByTn[p.tn]) continue;
        const card = document.createElement('div');
        card.className = 'tsak-card';
        card.innerHTML = `<div class="row1"><span class="tsak-badge ${p.carrier}">${p.carrier.toUpperCase()}</span><span class="tsak-tn">${p.tn}</span><span class="tsak-chip" style="background:#7a7163">\u23F3 fetching</span></div>`;
        cardsEl.appendChild(card);
      }
    }

    fetchBtn.addEventListener('click', () => doFetch(lastParsed));
    if (lastParsed.length) { renderPills(lastParsed); fetchBtn.disabled = false; }

    /* ---------- R18 trigger ---------- */
    api().trigger = function (action, params) {
      if (action === 'fetch') {
        if (api().state === 'running') return { ok: false, error: 'already running' };
        const tns = (params && params.tns) || [];
        if (!tns.length) return { ok: false, error: 'no tracking numbers' };
        lastParsed = parseTns(tns.join('\n'));
        renderPills(lastParsed);
        doFetch(lastParsed);
        return { ok: true };
      }
      if (action === 'status') return { ok: true, state: api().state, results: state.results };
      return { ok: false, error: 'unknown action: ' + action };
    };
    setState('idle', 'Ready — paste tracking numbers and click Fetch');
  }
})();
