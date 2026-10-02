// ==UserScript==
// @name         Pharmacy J Order Panel
// @namespace    http://tampermonkey.net/
// @version      1.6
// @author       Jeyson Dagondon
// @description  Fill the Pharmacy J Ultimate Template PDF from the unified menu's cart
// @match        https://crm.zoho.com/crm/*/tab/Contacts/*
// @run-at       document-idle
// @grant        unsafeWindow
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.


(function () {
  'use strict';

  console.info('[Pharmacy J Order Panel v1.6] boot');

  // v1.6 CHANGES (2026-10-02):
  //  - .sop-panel is now box-sizing:border-box. It declared width:420px + padding:12px + a
  //    1px border in the DEFAULT content box, so the rendered panel was 446px wide, and the
  //    split-screen cap max-width:calc(100vw - 48px) capped the CONTENT, not the panel — at
  //    the narrow extreme it hung 2px off the viewport. Found by the live harness measuring
  //    446px against a 420px assert.

  // The cart is NOT built here. The unified menu's Pharmacy J leaves carry a 🧾 button that stacks
  // {group, optionLabel} onto the page window — one product picker, the one Jeyson already uses.
  // The filler resolves each label against pharmacyj-instructions.mjs and fails loudly if it cannot.
  const MAX_ROWS = 4;   // the Ultimate Template has 4 prescription rows
  const page = (typeof unsafeWindow !== 'undefined' ? unsafeWindow : window);
  const cart = () => (page.__pharmacyjCart = page.__pharmacyjCart || []);

  const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text != null) x.textContent = text; return x; };

  function payload() {
    // The Toolkit publishes the builder on the page window (it is sandboxed by @grant).
    const build = page.__scripts && page.__scripts.buildPayload;
    if (typeof build !== 'function') throw new Error('Care Plan Toolkit is not loaded — it builds the patient payload');
    const p = build() || {};
    const out = {};
    for (const f of ['firstName', 'lastName', 'middleName', 'phone', 'address', 'state', 'zip', 'gender']) {
      if (p[f] != null && String(p[f]).trim() !== '') out[f] = String(p[f]).trim();
    }
    // Zoho's DOB comes out of the extractor as {m,d,y}. Left alone it stringifies to [object Object]
    // and the form would print that in the patient's date of birth.
    const dob = p.dob;
    if (dob && dob.m && dob.d && dob.y) out.dob = `${dob.m}/${dob.d}/${dob.y}`;
    else if (typeof dob === 'string' && dob.trim()) out.dob = dob.trim();
    if (!out.firstName || !out.lastName) throw new Error('the Toolkit could not read this patient\'s name');
    return out;
  }

  let cityInput, allergiesInput, medsInput, status, badge;

  function render() {
    const items = cart();
    // The badge is the trigger: it has to read correctly while the panel is CLOSED,
    // so its label is written before the panel guard (it used to stay empty until
    // the panel was already open).
    if (badge) badge.textContent = `🧾 Pharmacy J PDF${items.length ? ' (' + items.length + ')' : ''}`;
    if (!panel) return;
    const body = panel.querySelector('.sop-body');
    body.replaceChildren();
    if (!items.length) {
      body.appendChild(el('div', 'sop-empty', 'Cart is empty — pick products from the unified menu (🧾 on a Pharmacy J row).'));
    }
    for (const c of items) {
      const r = el('div', 'sop-row');
      r.append(el('span', 'sop-group', c.group), el('span', 'sop-opt', c.optionLabel));
      const del = el('button', 'sop-del', '✕');
      del.onclick = () => { page.__pharmacyjCart = items.filter(x => x !== c); render(); };
      r.appendChild(del);
      body.appendChild(r);
    }
    status.textContent = `${items.length} of ${MAX_ROWS} prescription rows`;
  }

  let panel = null;

  function closePanel() { if (panel) { panel.remove(); panel = null; } }

  function open() {
    if (panel) { closePanel(); return; }
    let p;
    try { p = payload(); } catch (e) { alert(e.message); return; }
    panel = el('div', 'sop-panel');
    const head = el('div', 'sop-head', `Pharmacy J order — ${p.firstName} ${p.lastName}`);
    const close = el('button', 'sop-close', '✕'); close.onclick = closePanel;
    head.appendChild(close);
    cityInput = el('input'); cityInput.placeholder = 'City (Zoho keeps it inside the address line)'; cityInput.value = p.city || '';
    allergiesInput = el('input'); allergiesInput.placeholder = 'Allergies (empty = NKDA)';
    medsInput = el('input'); medsInput.placeholder = 'Current medications';
    status = el('div', 'sop-status');
    const go = el('button', 'sop-go', '🧾 Fill the PDF');
    go.onclick = () => {
      try {
        const items = cart();
        if (!items.length) throw new Error('the cart is empty');
        if (items.length > MAX_ROWS) throw new Error(`the form has ${MAX_ROWS} rows`);
        // The filler prompts for city/DOB/gender when it does not get them. Launched from a protocol
        // handler there is no terminal to answer, so the panel refuses instead of hanging.
        if (!cityInput.value.trim()) throw new Error('city is required — Zoho keeps it inside the address line');
        if (!p.dob) throw new Error('date of birth is required');
        if (!p.gender) throw new Error('gender is required');
        const intent = { patient: p, cart: items.map(c => ({ group: c.group, optionLabel: c.optionLabel })),
          allergies: allergiesInput.value.trim(), meds: medsInput.value.trim(), city: cityInput.value.trim() };
        const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(intent)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        status.textContent = 'Opening PharmacyJFill…';
        location.href = 'pharmacyjfill://' + encodeURIComponent(b64);
      } catch (e) { status.textContent = '✕ ' + e.message; }
    };
    panel.append(head, el('div', 'sop-body'), cityInput, allergiesInput, medsInput, status, go);
    document.body.appendChild(panel);
    render();
  }

  const style = document.createElement('style');
  style.textContent = `
.sop-panel{box-sizing:border-box;position:fixed;top:120px;right:24px;z-index:2147483647;width:420px;max-width:calc(100vw - 48px);background:#fff;border:1px solid #c9d2e0;border-radius:8px;box-shadow:0 8px 28px rgba(0,0,0,.18);padding:12px;font:13px/1.45 system-ui,sans-serif;color:#1c2733}
.sop-head{font-weight:700;margin-bottom:8px;display:flex;justify-content:space-between}
.sop-row{display:flex;gap:6px;align-items:center;margin-bottom:5px;border-bottom:1px solid #eef2f7;padding:4px 0}
.sop-group{font-weight:600;min-width:120px}
.sop-opt{flex:1;color:#44566b}
.sop-empty{color:#77869a;font-style:italic}
.sop-panel input{width:100%;margin-top:6px;padding:6px;font:13px system-ui,sans-serif}
.sop-panel button{cursor:pointer;font:13px system-ui,sans-serif}
.sop-go{margin-top:8px;padding:6px 10px;background:#0a8754;color:#fff;border:0;border-radius:5px;font-weight:700}
.sop-del{background:none;border:0;color:#a33}
.sop-close{background:none;border:0;font-weight:700}
.sop-status{margin-top:6px;color:#5a6b7d;font-size:12px}
#pdt-pharmacyj-btn{margin-left:6px;padding:4px 9px;border:1px solid #c9d2e0;border-radius:5px;background:#fff;color:#0a8754;font:12px/1.25 system-ui,sans-serif;cursor:pointer;white-space:nowrap}
#pdt-pharmacyj-btn:hover{border-color:#0a8754}`;
  document.head.appendChild(style);

  // DESIGN.md § Trigger contract rule 2 — three exits on a summoned panel: its
  // own ✕, Escape, and a click anywhere outside it (capture phase, ignoring the
  // docked badge). Registered once; both no-op while the panel is closed.
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && panel) closePanel(); });
  document.addEventListener('mousedown', (e) => {
    if (!panel) return;
    const t = e.target;
    if (t && (panel.contains(t) || (badge && (badge === t || badge.contains(t))))) return;
    closePanel();
  }, true);

  // Dock next to the Toolkit's top-panel strip; float until it appears.
  function attach() {
    const strip = document.getElementById('qc-top-strip');
    if (!strip || !strip.parentElement) return false;
    if (document.getElementById('pdt-pharmacyj-btn')) return true;
    badge = el('button', 'pdt-pharmacyj-btn');
    badge.id = 'pdt-pharmacyj-btn';
    badge.type = 'button';
    badge.title = 'Fill the Pharmacy J Ultimate Template PDF from the unified menu cart';
    badge.addEventListener('click', open);
    strip.parentElement.appendChild(badge);
    render();
    return true;
  }
  if (!attach()) {
    const obs = new MutationObserver(() => { if (attach()) obs.disconnect(); });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), 30000);
  }
})();
