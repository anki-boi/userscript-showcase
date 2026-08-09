// ==UserScript==
// @name         ChatGPT Context Degradation Meter
// @namespace    http://tampermonkey.net/
// @version      0.13
// @author       Jeyson Dagondon
// @description  Context-fill bar beside the model selector; hover for numbers, click to set plan
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @require      https://unpkg.com/gpt-tokenizer/dist/o200k_base.js
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[ChatMeter v0.13] boot');
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}';
  document.documentElement.appendChild(__dsStyle);

(function () {
  'use strict';
  console.log('HOT RELOAD OK', Date.now());

  const PAGE = (typeof unsafeWindow !== 'undefined') ? unsafeWindow : window;

  // =====================================================================
  // CONFIG
  // =====================================================================
  const WINDOW_BY_PLAN = {
    free: 16000, plus: 32000, business: 32000,
    pro: 128000, enterprise: 128000, unknown: 16000
  };
  const SYSTEM_OVERHEAD = 900;
  const DEGRADATION_BANDS = {
    general:  { soft: 0.50, hard: 0.70 },
    balanced: { soft: 0.35, hard: 0.55 },
    complex:  { soft: 0.15, hard: 0.30 }
  };
  const ACTIVE_PROFILE = 'balanced';
  const styleEl = document.createElement('style');
  styleEl.textContent = `@keyframes ctxPulse { 0%,100%{opacity:1} 50%{opacity:.55} }`;
  document.head.appendChild(styleEl);
  // =====================================================================
  // STATE
  // =====================================================================
  const PLAN_KEY = 'ctxMeterPlan';
  const VALID_PLANS = ['free', 'plus', 'business', 'pro', 'enterprise'];

  let savedPlan = null;
  try {
    const v = GM_getValue(PLAN_KEY, null);
    if (v && VALID_PLANS.includes(v)) savedPlan = v;
  } catch(e) { console.warn('[ChatMeter]', e); }

  let currentPlan = savedPlan || 'unknown';
  let currentConvoId = null;
  let convoTokens = 0;

  // =====================================================================
  // TOKEN COUNTING
  // =====================================================================
  function tokenizerReady() {
    return typeof PAGE.GPTTokenizer_o200k_base?.encode === 'function';
  }
  function countTokens(text) {
    try {
      if (tokenizerReady()) return PAGE.GPTTokenizer_o200k_base.encode(text).length;
    } catch(e) { console.warn('[ChatMeter]', e); }
    return Math.ceil(text.length / 4);
  }
  function extractFromRequest(obj) {
    const buf = [];
    try {
      if (Array.isArray(obj?.messages)) {
        for (const m of obj.messages) {
          const parts = m?.content?.parts;
          if (Array.isArray(parts)) for (const p of parts) if (typeof p === 'string') buf.push(p);
        }
      }
    } catch(e) { console.warn('[ChatMeter]', e); }
    return buf.join('\n');
  }
  function extractFromMapping(obj) {
    const buf = [];
    try {
      const mapping = obj?.mapping;
      if (mapping && typeof mapping === 'object') {
        for (const nodeId in mapping) {
          const content = mapping[nodeId]?.message?.content;
          if (!content) continue;

          // normal text messages: content.parts is an array of strings
          if (Array.isArray(content.parts)) {
            for (const p of content.parts) {
              if (typeof p === 'string' && p) buf.push(p);
            }
          }

          // parsed file/PDF text lives on tether_quote nodes as content.text
          // (content_type "tether_quote"). Also covers any node exposing a
          // plain .text string. This is what makes PDFs actually count.
          if (typeof content.text === 'string' && content.text) {
            buf.push(content.text);
          }
        }
      }
    } catch(e) { console.warn('[ChatMeter]', e); }
    return buf.join('\n');
  }

  // =====================================================================
  // FETCH HOOK
  // =====================================================================
  const origFetch = PAGE.fetch;
  PAGE.fetch = async function (...args) {
    const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
    const init = args[1];

    try {
      if (url && /\/backend-api\/(?:f\/)?conversation$/.test(url) && init?.method === 'POST' && typeof init.body === 'string') {
        const text = extractFromRequest(JSON.parse(init.body));
        if (text) { convoTokens += countTokens(text); updateMeter(); }
      }
    } catch(e) { console.warn('[ChatMeter]', e); }

    const response = await origFetch.apply(this, args);

    try {
      if (url && /\/backend-api\/conversation\/[0-9a-f-]{36}(?:\?.*)?$/.test(url) && (!init?.method || init.method === 'GET')) {
        response.clone().json().then(obj => {
          const text = extractFromMapping(obj);
          if (text) { convoTokens = countTokens(text); updateMeter(); }
        }).catch((e) => { console.warn('[ChatMeter]', e); });
      }
    } catch(e) { console.warn('[ChatMeter]', e); }

    return response;
  };

  // =====================================================================
  // PLAN DETECTION (first-run default only)
  // =====================================================================
  function detectPlan() {
    const KNOWN = ['free', 'plus', 'pro', 'business', 'enterprise'];
    const btn = document.querySelector('[data-testid="accounts-profile-button"]');
    if (!btn) return 'unknown';
    const cands = [];
    btn.querySelectorAll('span').forEach(s => {
      const t = (s.textContent || '').trim().toLowerCase();
      if (t) cands.push(t);
    });
    cands.push((btn.getAttribute('aria-label') || '').toLowerCase());
    for (const text of cands) for (const p of KNOWN) if (new RegExp(`\\b${p}\\b`).test(text)) return p;
    return 'unknown';
  }

  // =====================================================================
  // CONVO SWITCH
  // =====================================================================
  function convoIdFromUrl() {
    const m = location.pathname.match(/\/c\/([0-9a-f-]{36})/);
    return m ? m[1] : null;
  }
  function checkConvoSwitch() {
    const id = convoIdFromUrl();
    if (id !== currentConvoId) {
      currentConvoId = id;
      convoTokens = 0;
      updateMeter();
    }
  }

  // =====================================================================
  // METRICS HELPER
  // =====================================================================
  function metrics() {
    const rawWindow = WINDOW_BY_PLAN[currentPlan] ?? WINDOW_BY_PLAN.unknown;
    const effWindow = rawWindow - SYSTEM_OVERHEAD;
    const band = DEGRADATION_BANDS[ACTIVE_PROFILE];
    const frac = convoTokens / effWindow;
    let color = 'var(--ds-success,#2e7d32)', label = 'context ok';
    if (frac >= band.hard) { color = 'var(--ds-danger,#c62828)'; label = 'recall likely degrading'; }
    else if (frac >= band.soft) { color = 'var(--ds-warn,#f9a825)'; label = 'attention softening'; }
    return { effWindow, frac, pct: Math.round(frac * 100), color, label };
  }

  // =====================================================================
  // FILL BAR - mounted in the header, next to the model selector.
  // =====================================================================
  let wrap, fill, track, barLabel, tooltip, planMenu;

  function buildBar() {
    // outer wrapper (inline in the header row)
    wrap = document.createElement('div');
    wrap.id = 'ctx-meter-bar';
    Object.assign(wrap.style, {
      display: 'inline-flex', alignItems: 'center', gap: '6px',
      marginInlineStart: '8px', cursor: 'pointer', position: 'relative',
      height: '32px', flex: '0 0 auto'
    });
    wrap.addEventListener('mouseenter', () => showTooltip());
    wrap.addEventListener('mouseleave', () => hideTooltip());
    wrap.addEventListener('click', (e) => { e.stopPropagation(); togglePlanMenu(); });

    // the track (background groove)
    track = document.createElement('div');
    Object.assign(track.style, {
      position: 'relative', width: '160px', height: '18px',
      borderRadius: '9999px', overflow: 'hidden',
      background: 'var(--token-border-light, rgba(120,120,120,0.28))'
    });

    // the fill (grows with context)
    fill = document.createElement('div');
    Object.assign(fill.style, {
      position: 'absolute', insetInlineStart: '0', top: '0', bottom: '0',
      width: '0%', borderRadius: '9999px',
      background: 'var(--ds-success,#2e7d32)', transition: 'width .3s ease, background .3s ease'
    });
    track.appendChild(fill);

    // percentage label overlaid on the bar
    barLabel = document.createElement('span');
    Object.assign(barLabel.style, {
      position: 'absolute', inset: '0', display: 'flex',
      alignItems: 'center', justifyContent: 'center',
      font: '700 11px/1 system-ui, sans-serif', color: '#fff',
      textShadow: '0 1px 2px rgba(0,0,0,.6)', pointerEvents: 'none',
      letterSpacing: '.02em'
    });
    track.appendChild(barLabel);
    wrap.appendChild(track);

    // tooltip with absolute numbers
    tooltip = document.createElement('div');
    Object.assign(tooltip.style, {
      position: 'absolute', top: 'calc(100% + 8px)', left: '50%',
      transform: 'translateX(-50%)', whiteSpace: 'nowrap',
      background: '#000', color: '#fff', font: '500 11px/1.4 system-ui, sans-serif',
      padding: '5px 8px', borderRadius: '6px', pointerEvents: 'none',
      opacity: '0', transition: 'opacity .15s', zIndex: '99999',
      boxShadow: '0 2px 8px rgba(0,0,0,.4)'
    });
    wrap.appendChild(tooltip);

    // plan menu (click to choose)
    planMenu = document.createElement('div');
    Object.assign(planMenu.style, {
      position: 'absolute', top: 'calc(100% + 8px)', left: '50%',
      transform: 'translateX(-50%)', display: 'none', flexDirection: 'column',
      background: '#1f1f1f', border: '1px solid #444', borderRadius: '8px',
      padding: '4px', zIndex: '100000', minWidth: '110px',
      boxShadow: '0 4px 12px rgba(0,0,0,.5)'
    });
    VALID_PLANS.forEach(p => {
      const item = document.createElement('div');
      item.textContent = p.charAt(0).toUpperCase() + p.slice(1);
      Object.assign(item.style, {
        padding: '6px 10px', borderRadius: '5px', cursor: 'pointer',
        font: '500 12px/1 system-ui, sans-serif', color: '#eee'
      });
      item.addEventListener('mouseenter', () => item.style.background = '#333');
      item.addEventListener('mouseleave', () => item.style.background = 'transparent');
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        currentPlan = p;
        try { GM_setValue(PLAN_KEY, p); } catch(err) { console.warn('[ChatMeter]', err); }
        hidePlanMenu();
        updateMeter();
      });
      planMenu.appendChild(item);
    });
    wrap.appendChild(planMenu);

    document.addEventListener('click', hidePlanMenu);
  }

  function showTooltip() {
    if (planMenu.style.display === 'flex') return;
    const m = metrics();
    const planTag = currentPlan === 'unknown' ? 'plan not set' : currentPlan;
    const est = tokenizerReady() ? '' : ' (approx)';
    tooltip.textContent =
      `${convoTokens.toLocaleString()} / ${m.effWindow.toLocaleString()} tok · ${m.pct}% · ${m.label}${est} · ${planTag}`;
    tooltip.style.opacity = '1';
  }
  function hideTooltip() { tooltip.style.opacity = '0'; }

  function togglePlanMenu() {
    if (planMenu.style.display === 'flex') hidePlanMenu();
    else { hideTooltip(); planMenu.style.display = 'flex'; }
  }
  function hidePlanMenu() { if (planMenu) planMenu.style.display = 'none'; }

  function updateMeter() {
    if (!fill) return;
    const m = metrics();
    const shown = Math.min(m.frac, 1) * 100;
    fill.style.width = shown.toFixed(1) + '%';
    fill.style.background = m.color;
    if (barLabel) barLabel.textContent = `${m.pct}%`;
    fill.style.animation = (m.frac >= DEGRADATION_BANDS[ACTIVE_PROFILE].hard)
      ? 'ctxPulse 1.2s ease-in-out infinite' : 'none';
  }

  // mount the bar in the header, after the model-selector button
  function ensureBarMounted() {
    if (document.getElementById('ctx-meter-bar')) return;
    const modelBtn = document.querySelector('[data-testid="model-switcher-dropdown-button"]');
    if (!modelBtn) return;
    if (!wrap) buildBar();
    // insert as a sibling right after the model selector button
    modelBtn.parentNode.insertBefore(wrap, modelBtn.nextSibling);
    updateMeter();
  }

  // =====================================================================
  // BOOT
  // =====================================================================
  const mo = new MutationObserver(() => ensureBarMounted());
  const startObserver = setInterval(() => {
    if (document.body) {
      mo.observe(document.body, { childList: true, subtree: true });
      ensureBarMounted();
      clearInterval(startObserver);
    }
  }, 300);

  if (!savedPlan) {
    const planBoot = setInterval(() => {
      if (savedPlan) { clearInterval(planBoot); return; }
      const p = detectPlan();
      if (p !== 'unknown') { currentPlan = p; updateMeter(); }
    }, 1500);
    setTimeout(() => clearInterval(planBoot), 30000);
  }

  setInterval(checkConvoSwitch, 400);
  checkConvoSwitch();
})();