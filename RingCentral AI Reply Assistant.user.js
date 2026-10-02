// ==UserScript==
// @name         RingCentral AI Reply Assistant
// @namespace    https://github.com/anki-boi/userscript-showcase
// @version      4.4.3
// @author       Jeyson Dagondon
// @run-at       document-idle
// @description  Harvests the RingCentral SMS conversation and drafts AI replies to paste in
// @match        https://app.ringcentral.com/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_setClipboard
// @grant        GM_xmlhttpRequest
// @connect      api.anthropic.com
// @connect      api.openai.com
// @connect      api.deepseek.com
// @connect      generativelanguage.googleapis.com
// @connect      localhost
// @connect      127.0.0.1
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[RC AI v4.4.3] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['RC-AI'] = { name: 'RingCentral AI Reply Assistant', version: '4.4.3', state: 'idle', message: 'Loaded', output: null, error: null, lastActivity: Date.now(), trigger: null };
  const __dsStyle = document.createElement('style');
  __dsStyle.textContent = ':root{--ds-bg:#faf8f5;--ds-surface:#fffdf9;--ds-surface2:#f4f0e9;--ds-border:#e8e2d8;--ds-text:#2b2620;--ds-muted:#7a7163;--ds-accent:#8a5f2e;--ds-accent-text:#ffffff;--ds-success:#3d7a46;--ds-warn:#a16207;--ds-danger:#b3402e;--ds-info:#2c6e9c}';
  document.documentElement.appendChild(__dsStyle);

(function () {
  'use strict';

  const DEBUG = true; // set false to silence console logging
  const log = (...a) => { if (DEBUG) console.log('[RC AI]', ...a); };

  // ── Providers: each knows how to build a request and parse a reply. ──
  // Model IDs are left as user-editable settings (not hardcoded) because
  // provider model slugs change over time — verify the current one against
  // the provider's own docs before relying on it.
  const PROVIDERS = [
    {
      key: 'deepseek', label: 'DeepSeek', color: '#4D6BFE',
      webUrl: 'https://chat.deepseek.com/',
      fields: [
        { id: 'key', label: 'API Key', type: 'password', placeholder: 'sk-...' },
        { id: 'model', label: 'Model', type: 'text', placeholder: 'e.g. deepseek-chat (check api-docs.deepseek.com)' },
      ],
      async call(prompt, cfg) {
        if (!cfg.key) throw new Error('Missing DeepSeek API key — add it in Settings.');
        if (!cfg.model) throw new Error('Missing DeepSeek model — add it in Settings.');
        const res = await gmRequest({
          method: 'POST',
          url: 'https://api.deepseek.com/v1/chat/completions',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.key}`,
          },
          data: JSON.stringify({
            model: cfg.model,
            reasoning_effort: 'low',
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        const json = parseJson(res);
        if (json.error) throw new Error(json.error.message || 'DeepSeek API error');
        return (json.choices?.[0]?.message?.content || '').trim();
      },
    },
    {
      key: 'claude', label: 'Claude', color: '#D97706',
      webUrl: 'https://claude.ai/new',
      fields: [
        { id: 'key', label: 'API Key', type: 'password', placeholder: 'sk-ant-...' },
        { id: 'model', label: 'Model', type: 'text', placeholder: 'e.g. claude-sonnet-4-5-20250929 (check docs.anthropic.com/en/docs/about-claude/models)' },
      ],
      async call(prompt, cfg) {
        if (!cfg.key) throw new Error('Missing Claude API key — add it in Settings.');
        if (!cfg.model) throw new Error('Missing Claude model — add it in Settings.');
        const res = await gmRequest({
          method: 'POST',
          url: 'https://api.anthropic.com/v1/messages',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': cfg.key,
            'anthropic-version': '2023-06-01',
            'anthropic-dangerous-direct-browser-access': 'true',
          },
          data: JSON.stringify({
            model: cfg.model,
            max_tokens: 1500,
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        const json = parseJson(res);
        if (json.error) throw new Error(json.error.message || 'Claude API error');
        return (json.content || []).map((c) => c.text || '').join('\n').trim();
      },
    },
    {
      key: 'openai', label: 'ChatGPT', color: '#10A37F',
      webUrl: 'https://chatgpt.com/',
      fields: [
        { id: 'key', label: 'API Key', type: 'password', placeholder: 'sk-...' },
        { id: 'model', label: 'Model', type: 'text', placeholder: 'e.g. gpt-4.1 (check platform.openai.com/docs/models)' },
      ],
      async call(prompt, cfg) {
        if (!cfg.key) throw new Error('Missing ChatGPT API key — add it in Settings.');
        if (!cfg.model) throw new Error('Missing ChatGPT model — add it in Settings.');
        const res = await gmRequest({
          method: 'POST',
          url: 'https://api.openai.com/v1/chat/completions',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cfg.key}`,
          },
          data: JSON.stringify({
            model: cfg.model,
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        const json = parseJson(res);
        if (json.error) throw new Error(json.error.message || 'ChatGPT API error');
        return (json.choices?.[0]?.message?.content || '').trim();
      },
    },
    {
      key: 'gemini', label: 'Gemini', color: '#4285F4',
      webUrl: 'https://aistudio.google.com/prompts/new_chat',
      fields: [
        { id: 'key', label: 'API Key', type: 'password', placeholder: 'AIza...' },
        { id: 'model', label: 'Model', type: 'text', placeholder: 'e.g. gemini-2.5-flash (check ai.google.dev/gemini-api/docs/models)' },
      ],
      async call(prompt, cfg) {
        if (!cfg.key) throw new Error('Missing Gemini API key — add it in Settings.');
        if (!cfg.model) throw new Error('Missing Gemini model — add it in Settings.');
        const res = await gmRequest({
          method: 'POST',
          url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(cfg.model)}:generateContent?key=${encodeURIComponent(cfg.key)}`,
          headers: { 'Content-Type': 'application/json' },
          data: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
          }),
        });
        const json = parseJson(res);
        if (json.error) throw new Error(json.error.message || 'Gemini API error');
        const parts = json.candidates?.[0]?.content?.parts || [];
        return parts.map((p) => p.text || '').join('').trim();
      },
    },
    {
      key: 'llamacpp', label: 'llama.cpp', color: '#6F42C1',
      fields: [
        { id: 'baseUrl', label: 'Server URL', type: 'text', placeholder: 'http://127.0.0.1:8080' },
        { id: 'model', label: 'Model (optional)', type: 'text', placeholder: 'depends on your server config' },
        { id: 'key', label: 'API Key (optional)', type: 'password', placeholder: 'only if your server requires one' },
      ],
      async call(prompt, cfg) {
        const base = (cfg.baseUrl || 'http://127.0.0.1:8080').replace(/\/+$/, '');
        const headers = { 'Content-Type': 'application/json' };
        if (cfg.key) headers.Authorization = `Bearer ${cfg.key}`;
        const res = await gmRequest({
          method: 'POST',
          url: `${base}/v1/chat/completions`,
          headers,
          data: JSON.stringify({
            model: cfg.model || 'local',
            messages: [{ role: 'user', content: prompt }],
          }),
        });
        const json = parseJson(res);
        if (json.error) throw new Error(json.error.message || 'llama.cpp server error');
        return (json.choices?.[0]?.message?.content || '').trim();
      },
    },
  ];

  function gmRequest(opts) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        timeout: 90000,
        ...opts,
        onload: (res) => {
          if (res.status >= 200 && res.status < 300) resolve(res);
          else reject(new Error(`HTTP ${res.status}: ${res.responseText?.slice(0, 300) || res.statusText}`));
        },
        onerror: () => reject(new Error('Network error reaching the API — check the URL/key and your connection.')),
        ontimeout: () => reject(new Error('Request timed out.')),
      });
    });
  }

  function parseJson(res) {
    try {
      return JSON.parse(res.responseText);
    } catch {
      throw new Error('Could not parse API response as JSON.');
    }
  }

  function providerConfig(provider) {
    const cfg = {};
    provider.fields.forEach((f) => {
      cfg[f.id] = GM_getValue(`rc_ai_cfg_${provider.key}_${f.id}`, '');
    });
    return cfg;
  }

  // ── llama.cpp has no public web chat to fall back to, so it's always API mode. ──
  // The other three fall back to "copy the prompt + open the site" whenever no
  // key/model is set, so the tool still works for people who haven't set up an
  // API key — they just lose the auto-paste-back convenience.
  function hasApiConfigured(provider) {
    if (provider.key === 'llamacpp') return true;
    const cfg = providerConfig(provider);
    return !!(cfg.key && cfg.model);
  }

  const PROMPT_TEMPLATE = `You are a pharmacist medical team assistant for Jones Medical Management, a telehealth practice specializing in GLP-1 medications, peptide therapy, and metabolic health optimization.

Your job is to draft SMS replies to patient text messages on behalf of the medical team. The medical team will review and send — never imply the message is coming directly from a provider.

<reply_rules>
- Warm, professional, concise. These are text messages, not emails. 2–4 sentences is ideal.
- Never provide information that tells the patient what to do because that's role is only within the scope of a provider. The only thing that is okay to talk about is what the peptides do. We can talk pharmacology, pharmacodynamics, contraindications, side effects.
- Never diagnose, interpret lab results, or suggest treatment changes.
- Do not use medical jargon the patient didn't use first.
- Do not start with "Hi [Name]!" — match the conversational register of the thread. If the patient texts casually, reply naturally. If formal, stay professional.
- End with a clear next step when one exists (schedule a call, reach out to coach, etc.). Do not end with a vague "let us know if you need anything" when a specific action is warranted.
- Give at least 3 replies to choose from that are boxed in markdown code blocks each so that they are easier to copy.
</reply_rules>

<standard_templates>
Use these proven templates when the situation matches. Keep the required elements; adapt the wording to the thread.

1. **Tracking notification** — must include: patient name, tracking number, a note that tracking may take 1-2 business days to update, a note that multi-pharmacy orders get separate tracking texts from different numbers, the dosing schedule, the full dosing guide link, and a sign-off, and if there is any delay, a brief neutral note that dispatch timing is handled on the pharmacy's side — the clinic follows it on their end and cannot speed up the pharmacy's shipping process (imply, don't complain).

2. **Labs/exam "No to both" follow-up** — when a patient declined both the physical exam and labs: tell them the providers likely can't approve a prescription without a physical exam or labs completed within the past 12-24 months.

3. **RxFlow order-processing message** — notify that the prescription is being submitted; flag if intake forms are incomplete (the order can't process until they're done); ask the patient to flag any shipping address changes or delayed-shipping requests before submission; include a tracking-alert block noting tracking comes by text from 72144 and by email (save the number to contacts, check spam/junk).

4. **Onboarding for paperwork-avoidant patients** — proactively complete their intake for them; the message only asks for the ID upload, and frame it as "we did this for you," never as if they're behind or annoying.

5. **New patient profile creation** — always tell the patient to expect an email with a secure link to upload their ID for identity verification.

6. **Peptides arrived warm / not cool upon arrival** — reassure with confidence: the peptides are reconstituted by the pharmacy before transit and ship with ice packs, so they were cold for the majority of transit. If they arrived warm with melted ice packs, that means only the later stages of transit were at room temperature — and the 48-hour clock only starts ticking from that point. So the peptides have barely been at room temperature at all, and remain perfectly fine for up to 48 hours at room temperature as long as they were not in direct heat or sunlight. Never plant seeds of doubt (no 'should be okay but', no hedging, no suggesting a replacement unless the patient describes actual damage). The goal is to prevent unnecessary replacements and refunds. If the order had to be rerouted because of a timing change, frame the clinic as having covered the pharmacy's shipping gap — the dispatch timing shifted on the pharmacy's side, and we rerouted through our clinic to keep the peptides cold. The clinic is the one watching out for the patient; the pharmacy's shipping schedule is out of our hands. If a clarifying follow-up question is needed (e.g. how long the package sat out), frame it with: the pharmacy typically asks these kinds of questions before they investigate on their end, and we want to give them full context.

7. **BUD (beyond-use date) question** — explain that the 3-month BUD is for pharmacy-side compliance only. Dr. Example intentionally sends the full amount of peptides, so some vials may hit the BUD slightly; degradation studies show peptides do not start degrading until 5 months, so the medication remains fully effective past the label date. Confident, simple framing; do not invite doubt or offer a replacement/refund — this is expected and safe.
</standard_templates>

<routing_logic>
Apply these rules in priority order:

1. **Default: pharmacology and clinical facts**
If the question involves any pharmacology, drug mechanism, side effect, interaction, or clinical fact — answer from your own knowledge. Keep the reply patient-friendly; don't dump scientific language on them. If you are unsure or the facts are ambiguous or conflicting, flag for Heather before sending.

2. **Clinical questions** (side effects, symptoms, medication interactions, lab concerns, new health issues) — If the symptom is common and well-documented, reassure clinically in plain language. If it sounds serious, unusual, or patient-specific, flag clearly for review before sending. Also create an SMS for Heather to ask her just in case she happens to know an answer.

3. **Plateau / non-responder complaints** ("it stopped working," "I'm not losing weight anymore") — Normalize it pharmacologically (e.g., adaptation phase, tolerance patterns). If it's lifestyle/compliance-related, point them toward their coach. If it sounds like a dose adequacy question, note in the draft that a provider check-in may be warranted — but do NOT suggest a dose change.

4. **Missed or wrong dose** — For most GLP-1s the answer is standard (skip, don't double up, resume next scheduled dose). Flag if anything is ambiguous.

5. **Scheduling, refills, shipping, or admin questions** — Answer directly if context is available. If not, let the patient know the team will follow up and flag what's missing.

6. **Insurance or prior authorization questions** — Send the patient a brief holding reply. Draft a Slack forwarding note to Heather.

7. **Accounting or refund questions** — Send the patient a brief holding reply. Draft a Slack forwarding note to KC.

8. **General check-ins, progress updates, encouragement** — Respond warmly. Acknowledge effort. If they mention food, compliance, or motivation struggles, point them to their coach.

9. **Urgent or emergency language** (chest pain, difficulty breathing, suicidal ideation, severe reactions) — Do NOT draft a casual reply. Flag at the top: ⚠️ URGENT — REVIEW BEFORE SENDING. Draft a reply directing them to call 911 or go to the nearest ER immediately.

10. **Shipment or delivery complaints** (damaged product, leakage, missing items, wrong medication, temperature excursions, delays) — DO NOT escalate to the pharmacy right away. Triage first (see <standing_rules> #4): (1) understand the situation from the thread, (2) ask clarifying questions if needed, (3) determine whether it's a legitimate problem or just an observation (e.g. arrived at room temperature with one cold pack, dispenser not leaking), (4) only escalate or offer a replacement once a real, unresolvable issue is confirmed. Education/reassurance may resolve it without any escalation. Be extra cautious if that order already had one replacement. Only once a real issue is confirmed: flag at the top 📦 PHARMACY ACTION REQUIRED and draft the escalation email using the format in <pharmacy_email_format>. Patient-facing replies must never plant ideas: do not list damage types or warning signs for the patient to check for (no leaking, cracks, broken vials, missing items), and do not tell them to watch out for anything. React only to what the patient actually reported.

<pharmacy_email_format>
Flag line: 📦 PHARMACY ACTION REQUIRED — include this above the SMS drafts so it's seen immediately.

After the SMS drafts, add a section titled:

---
📧 PHARMACY ESCALATION EMAIL

Subject: [Issue Type] — [Medication Name] — Patient: [Patient Name]

To: [Pharmacy Contact Name/Email — placeholder if unknown]

Body should include:
- Patient name and order details (medication, quantity, tracking number, delivery date) — pull from conversation, use [PLACEHOLDER] for anything missing
- Clear, factual description of the issue as reported by the patient
- Specific ask: investigation, replacement shipment, or both
- Offer to provide supporting documentation (photos, patient statement) if helpful
- Professional but firm tone — advocate for the patient without being hostile. Conciseness and readability is of utmost importance.

Keep it concise. One paragraph of context, one of the specific ask, close. No fluff.
</pharmacy_email_format>

<internal_routing_format>
Use this format whenever a message needs to be forwarded to Heather or KC.

After the SMS drafts, add a section titled:

---
💬 SLACK NOTE TO [HEATHER / KC]

Draft a short, casual Slack message. No need to be formal — just give them the context they need to act. Include:
- Patient name
- What they're asking about
- Any relevant details from the conversation
- What you need from them

Example tone: "Hey! Got a message from [Patient] about [issue]. [One line of context]. Can you take a look / handle this one?"
</internal_routing_format>

**Avoiding AI-sounding responses** — Use natural, concise language with varied sentence lengths, specific details, and small imperfections (contractions, minor colloquialisms) to sound like a real person. AVOID EM DASHES. IF YOU USE EM DASHES 5 KITTENS WILL DIE IN REAL TIME. NOTE THAT GEMINI, CLAUDE, AND CHATGPT WILL AUDIT THE REPLIES IF THEY SOUND LIKE AI. IF YOUR REPLIES DO NOT PASS, YOUR COMPANY WILL LOSE OUT ON THE AI RACE.
</routing_logic>

<standing_rules>
Cross-cutting rules that apply to every reply.

1. **Product framing** — if a patient purchased a product from Dr. Example (e.g. DSIP troches), reinforce that it was a good choice and highlight its benefits. Never let a patient feel they bought an inferior option. If they're asking about a competitor's product while you'd recommend an in-house one, explain why ours is better without disparaging the competitor.

2. **Delivery timing / shelf-life reasoning** — when a product has a long shelf life (e.g. a vial good for 3 months), it's fine to process the order now even without a stated desired delivery date. Frame it to the patient as no real downside, since they can still use it later regardless of when it arrives.

3. **Intake paperwork follow-up** — confirm patients who haven't completed intake are actually being messaged about it; don't assume it's handled. If a patient's intake looks incomplete, make sure the draft includes the follow-up.

4. **Complaint / escalation handling (do not escalate to the pharmacy right away)** — before opening a new case with the pharmacy, gather more information first, especially when the complaint may be an observation rather than a real problem. Be more cautious if there's already been one replacement on that order — avoid unnecessary back-and-forth with the pharmacy. Process: (1) understand the situation, (2) ask clarifying questions if needed — when asking, always add a brief framing line that the questions give the pharmacy full context, since the pharmacy typically asks these kinds of questions before they investigate on their end, and answering now means the pharmacy will not chase the patient with more follow-ups later (this keeps frustration directed at the pharmacy's process, never at the clinic), (3) determine if it's a legitimate issue or just an observation, (4) only escalate or offer a replacement once a real, unresolvable issue is confirmed. Education/reassurance may resolve it without escalating. Goal: give patients excellent, supportive service while also protecting the company from unnecessary escalations, replacements, and costs — don't jump straight to "make it right" mode before confirming there's something to fix.

5. **Replacement / refund prevention (no seeds of doubt)** — when reassuring patients about peptide condition or BUD dates, be confident and definitive. Never introduce uncertainty, hedging, or hypothetical problems the patient did not raise. Never give the patient ideas about what could be wrong: do not enumerate damage types or warning signs (never mention leaking, cracks, broken vials, missing items, or anything similar), never tell them what to watch out for, and never invite them to inspect or re-check the product for problems. If the patient says everything looks fine, treat it as fine. Only address problems the patient explicitly described. Unnecessary replacements and refunds cost the company — only offer them when a real, confirmed issue exists.

6. **Attribution default (logistics and process friction)** — when a reply explains a delay, shipping, tracking, or paperwork question, the cause sits with the pharmacy's process (packing, dispatch, tracking, forms) unless the truth clearly says otherwise. The clinic team is the fixer, never the cause: never imply the clinic dropped the ball, never blame the patient, never disparage the medication itself. Convey this by implication and deflection in warm, professional language — no direct accusations, no negativity toward the pharmacy as a business.
</standing_rules>

<tone_guidance>
- Patients on GLP-1s and peptides are often anxious about doing things "right." Be reassuring without being clinical.
- Never make the patient feel stupid for asking.
</tone_guidance>

PATIENT: {{PATIENT_NAME}}

--- CONVERSATION ---
{{MESSAGES}}
--- END CONVERSATION ---

{{CONTEXT_BLOCK}}

Draft a reply to the patient's most recent message.`;

  const STYLES = `
    #rc-ai-inline-btn {
      width: 44px; height: 44px; border-radius: 50%;
      background: none; border: none; cursor: pointer;
      display: inline-flex; align-items: center; justify-content: center;
      color: #0684BD; padding: 0; margin: 0 2px;
      transition: background 0.15s;
    }
    #rc-ai-inline-btn:hover { background: rgba(6,132,189,0.10); }
    #rc-ai-inline-btn:active { background: rgba(6,132,189,0.20); }
    .rc-ai-inline-icon { display: flex; align-items: center; justify-content: center; }

    #rc-ai-panel {
      position: fixed; z-index: 99999;
      width: 400px; max-height: 84vh; background: #FFFFFF; color: #1A1A1A;
      border-radius: 12px; border: 1px solid #E4E7EC;
      box-shadow: 0 8px 28px rgba(16,24,40,0.12);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 13px; display: none; flex-direction: column; overflow: hidden;
    }
    #rc-ai-panel.open { display: flex; }

    .rc-ai-header {
      padding: 14px 16px; background: #FFFFFF; color: #1A1A1A;
      font-weight: 600; font-size: 14px; display: flex;
      justify-content: space-between; align-items: center;
      border-bottom: 1px solid #F0F1F3;
    }
    .rc-ai-header-right { display: flex; align-items: center; gap: 10px; }
    .rc-ai-header-sub { font-weight: 400; font-size: 11px; color: #98A2B3; }
    #rc-ai-settings-toggle {
      background: none; border: none; cursor: pointer; font-size: 15px;
      color: var(--ds-muted,var(--ds-muted,#667085)); padding: 2px;
    }
    #rc-ai-settings-toggle:hover { color: var(--ds-text,var(--ds-text,#344054)); }

    .rc-ai-body {
      padding: 14px 16px; display: flex; flex-direction: column; gap: 12px;
      overflow-y: auto;
    }

    .rc-ai-label {
      font-size: 11px; text-transform: uppercase; letter-spacing: 0.4px;
      color: #98A2B3; margin-bottom: 6px; font-weight: 600;
    }

    #rc-ai-context {
      width: 100%; height: 80px; background: #FFFFFF; color: #1A1A1A;
      border: 1px solid #D0D5DD; border-radius: 8px; padding: 10px; font-size: 12px;
      resize: vertical; font-family: inherit; box-sizing: border-box;
      transition: border-color 0.15s, box-shadow 0.15s;
    }
    #rc-ai-context::placeholder { color: #98A2B3; }
    #rc-ai-context:focus {
      outline: none; border-color: #0684BD;
      box-shadow: 0 0 0 3px rgba(6,132,189,0.12);
    }

    #rc-ai-clear-btn {
      width: 100%; padding: 10px; background: #FFFFFF; color: var(--ds-danger,var(--ds-danger,#B42318));
      border: 1px solid #FDA29B; border-radius: 8px; cursor: pointer;
      font-size: 12px; font-weight: 600; letter-spacing: 0.3px;
      transition: background 0.15s, border-color 0.15s;
    }
    #rc-ai-clear-btn:hover { background: #FEF3F2; border-color: #F97066; }
    #rc-ai-clear-btn:active { background: #FEE4E2; }

    #rc-ai-paste-clipboard-btn {
      width: 100%; padding: 10px; background: #ECFDF3; color: var(--ds-success,var(--ds-success,#067647));
      border: 1px solid #ABEFC6; border-radius: 8px; cursor: pointer;
      font-size: 12px; font-weight: 600; letter-spacing: 0.3px;
      transition: background 0.15s, border-color 0.15s;
    }
    #rc-ai-paste-clipboard-btn:hover { background: #D1FADF; border-color: #75E0A7; }
    #rc-ai-paste-clipboard-btn:active { background: #A6F4C5; }

    .rc-ai-status {
      font-size: 11px; color: var(--ds-success,#067647); text-align: center;
      min-height: 16px; transition: opacity 0.3s; white-space: pre-line;
    }

    .rc-ai-divider { border: none; border-top: 1px solid #F0F1F3; margin: 2px 0; }

    .rc-ai-providers { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }

    .rc-ai-provider-btn {
      position: relative;
      padding: 10px 4px; border: 1px solid #E4E7EC; border-radius: 8px; cursor: pointer;
      font-size: 12px; font-weight: 600; color: var(--ds-text,#344054); background: #FFFFFF;
      transition: border-color 0.15s, background 0.15s, color 0.15s;
    }
    .rc-ai-provider-btn:hover { background: #F9FAFB; border-color: #D0D5DD; }
    .rc-ai-provider-btn:active { background: #F2F4F7; }
    .rc-ai-provider-mode { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.3px; margin-top: 2px; }
    .rc-ai-provider-btn.last-used { border-width: 2px; }
    .rc-ai-provider-btn.last-used::after {
      content: '★'; position: absolute; top: -6px; right: -6px;
      font-size: 10px; color: #FFB300; background: #FFFFFF; border-radius: 50%;
    }
    .rc-ai-providers.busy { pointer-events: none; opacity: 0.5; }

    #rc-ai-settings {
      display: none; flex-direction: column; gap: 12px;
      background: #F9FAFB; border: 1px solid #EAECF0; border-radius: 8px; padding: 12px;
    }
    #rc-ai-settings.open { display: flex; }
    .rc-ai-settings-group { display: flex; flex-direction: column; gap: 6px; }
    .rc-ai-settings-group-title { font-size: 12px; font-weight: 700; }
    .rc-ai-settings-field-label { font-size: 11px; color: var(--ds-muted,#667085); }
    .rc-ai-settings-field {
      width: 100%; padding: 7px 8px; border: 1px solid #D0D5DD; border-radius: 6px;
      font-size: 12px; box-sizing: border-box; font-family: inherit;
    }
    .rc-ai-settings-field:focus { outline: none; border-color: #0684BD; }

    #rc-ai-choice-overlay {
      position: fixed; inset: 0; z-index: 100000;
      background: rgba(16,24,40,0.45);
      display: none; align-items: center; justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    #rc-ai-choice-overlay.open { display: flex; }
    #rc-ai-choice-modal {
      width: 440px; max-width: 92vw; max-height: 82vh; overflow: hidden;
      background: #FFFFFF; border-radius: 12px; box-shadow: 0 12px 40px rgba(16,24,40,0.25);
      display: flex; flex-direction: column;
    }
    .rc-ai-choice-header {
      padding: 14px 16px; font-weight: 600; font-size: 14px; color: #1A1A1A;
      display: flex; justify-content: space-between; align-items: center;
      border-bottom: 1px solid #F0F1F3;
    }
    #rc-ai-choice-close {
      background: none; border: none; cursor: pointer; font-size: 15px; color: var(--ds-muted,#667085);
    }
    #rc-ai-choice-close:hover { color: var(--ds-text,#344054); }
    .rc-ai-choice-list {
      padding: 14px 16px; display: flex; flex-direction: column; gap: 10px;
      overflow-y: auto;
    }
    .rc-ai-choice-card {
      border: 1px solid #E4E7EC; border-radius: 10px; padding: 12px;
      cursor: pointer; transition: border-color 0.15s, background 0.15s;
    }
    .rc-ai-choice-card:hover { border-color: #0684BD; background: #F0F9FF; }
    .rc-ai-choice-text {
      font-size: 12.5px; color: #1A1A1A; white-space: pre-wrap; max-height: 140px;
      overflow-y: auto; margin-bottom: 8px;
    }
    .rc-ai-choice-actions { display: flex; gap: 8px; }
    .rc-ai-choice-actions button {
      flex: 1; padding: 8px; border-radius: 7px; cursor: pointer; font-size: 11.5px;
      font-weight: 600;
    }
    .rc-ai-choice-copy {
      border: 1px solid #D0D5DD; background: #FFFFFF; color: var(--ds-text,#344054);
    }
    .rc-ai-choice-copy:hover { background: #F9FAFB; }
    .rc-ai-choice-use {
      border: 1px solid #ABEFC6; background: #ECFDF3; color: var(--ds-success,#067647);
    }
    .rc-ai-choice-use:hover { background: #D1FADF; }

    .rc-ai-choice-tabs {
      display: flex; border-bottom: 1px solid #E4E7EC; padding: 0 16px; gap: 0;
    }
    .rc-ai-choice-tab {
      padding: 10px 16px; cursor: pointer; font-size: 12px; font-weight: 600;
      color: var(--ds-muted,#667085); border-bottom: 2px solid transparent; background: none; border-top: none;
      border-left: none; border-right: none; transition: color 0.15s, border-color 0.15s;
    }
    .rc-ai-choice-tab:hover { color: var(--ds-text,#344054); }
    .rc-ai-choice-tab.active { color: #0684BD; border-bottom-color: #0684BD; }
    .rc-ai-choice-tab .rc-ai-tab-badge {
      font-size: 10px; font-weight: 700; margin-left: 4px;
      padding: 1px 6px; border-radius: 10px; background: #F0F1F3; color: var(--ds-muted,#667085);
    }
    .rc-ai-choice-tab.active .rc-ai-tab-badge { background: #E0F2FE; color: #0684BD; }

    .rc-ai-choice-tab-panel { display: none; }
    .rc-ai-choice-tab-panel.active { display: flex; flex-direction: column; gap: 10px; }

    .rc-ai-choice-email-card {
      border: 1px solid #FED7AA; border-radius: 10px; padding: 12px;
      background: #FFF7ED;
    }
    .rc-ai-choice-email-header {
      font-size: 11px; font-weight: 700; color: #C2410C; text-transform: uppercase;
      letter-spacing: 0.3px; margin-bottom: 8px;
    }
    .rc-ai-choice-email-text {
      font-size: 12px; color: #1A1A1A; white-space: pre-wrap; max-height: 200px;
      overflow-y: auto; margin-bottom: 8px; line-height: 1.5;
    }
    .rc-ai-choice-email-actions { display: flex; gap: 8px; }
    .rc-ai-choice-email-actions button {
      flex: 1; padding: 8px; border-radius: 7px; cursor: pointer; font-size: 11.5px;
      font-weight: 600;
    }
    .rc-ai-choice-email-copy {
      border: 1px solid #FED7AA; background: #FFFFFF; color: #C2410C;
    }
    .rc-ai-choice-email-copy:hover { background: #FFF7ED; }

    .rc-ai-choice-slack-card {
      border: 1px solid #E4E7EC; border-radius: 10px; padding: 12px;
    }
    .rc-ai-choice-slack-header {
      font-size: 11px; font-weight: 700; color: #4A154B; text-transform: uppercase;
      letter-spacing: 0.3px; margin-bottom: 8px;
    }
    .rc-ai-choice-slack-text {
      font-size: 12px; color: #1A1A1A; white-space: pre-wrap; max-height: 160px;
      overflow-y: auto; margin-bottom: 8px; line-height: 1.5;
    }
    .rc-ai-choice-slack-actions { display: flex; gap: 8px; }
    .rc-ai-choice-slack-actions button {
      flex: 1; padding: 8px; border-radius: 7px; cursor: pointer; font-size: 11.5px;
      font-weight: 600;
    }
    .rc-ai-choice-slack-copy {
      border: 1px solid #D0D5DD; background: #FFFFFF; color: #4A154B;
    }
    .rc-ai-choice-slack-copy:hover { background: #F9FAFB; }
    .rc-ai-choice-empty {
      text-align: center; color: #98A2B3; font-size: 12px; padding: 20px 0;
    }
  `;

  const styleEl = document.createElement('style');
  styleEl.textContent = STYLES;
  document.head.appendChild(styleEl);

  const panel = document.createElement('div');
  panel.id = 'rc-ai-panel';
  panel.innerHTML = `
    <div class="rc-ai-header">
      <span>AI Reply Assistant</span>
      <div class="rc-ai-header-right">
        <span class="rc-ai-header-sub" id="rc-ai-last-drafted"></span>
        <button id="rc-ai-settings-toggle" title="API settings">⚙</button>
      </div>
    </div>
    <div class="rc-ai-body">
      <div id="rc-ai-settings"></div>
      <div>
        <div class="rc-ai-label">Extra Context (this patient only)</div>
        <textarea id="rc-ai-context" placeholder="Paste patient careplan, Zoho notes, medication history, or any other context here... (cleared automatically when you switch conversations)"></textarea>
      </div>
      <button id="rc-ai-clear-btn">🗑 CLEAR CONTEXT</button>
      <hr class="rc-ai-divider">
      <div class="rc-ai-label">Generate a reply — reads the whole thread. With a key set in ⚙ Settings it calls the API directly; without one it copies the prompt and opens the site (★ = last used)</div>
      <div class="rc-ai-providers" id="rc-ai-providers"></div>
      <div class="rc-ai-status" id="rc-ai-status"></div>
      <hr class="rc-ai-divider">
      <button id="rc-ai-paste-clipboard-btn">📋 Paste Clipboard Into Message Box</button>
      <div class="rc-ai-header-sub" style="text-align:center;">After copying a reply from the AI site by hand, use this to drop it into RingCentral</div>
    </div>
  `;
  document.body.appendChild(panel);

  const choiceOverlay = document.createElement('div');
  choiceOverlay.id = 'rc-ai-choice-overlay';
  choiceOverlay.innerHTML = `
    <div id="rc-ai-choice-modal">
      <div class="rc-ai-choice-header">
        <span>AI Reply Options</span>
        <button id="rc-ai-choice-close" title="Close">✕</button>
      </div>
      <div class="rc-ai-choice-tabs">
        <button class="rc-ai-choice-tab active" data-tab="sms">💬 SMS Replies <span class="rc-ai-tab-badge" id="rc-ai-sms-count">0</span></button>
        <button class="rc-ai-choice-tab" data-tab="email">📧 Email <span class="rc-ai-tab-badge" id="rc-ai-email-badge" style="display:none">1</span></button>
        <button class="rc-ai-choice-tab" data-tab="slack">💬 Slack <span class="rc-ai-tab-badge" id="rc-ai-slack-count">0</span></button>
      </div>
      <div class="rc-ai-choice-list" id="rc-ai-choice-list"></div>
      <div id="rc-ai-tweak-row" style="display:none; margin-top:10px; padding-top:10px; border-top:1px solid var(--ds-border,#E4E7EC);">
        <div style="font-size:12px; color:var(--ds-muted,#98A2B3); margin-bottom:6px;">✏️ Message needs tweaking? Tell the AI what to change and it will redraft.</div>
        <div style="display:flex; gap:8px;">
          <input id="rc-ai-tweak-input" type="text" placeholder="e.g. make it shorter, less formal, more reassuring…" style="flex:1; min-width:0; padding:6px 10px; border:1px solid var(--ds-border,#E4E7EC); border-radius:6px; font-size:13px; background:var(--ds-surface,#FFFDF9); color:var(--ds-text,#2B2620);">
          <button id="rc-ai-tweak-btn" type="button" style="padding:6px 12px; border:none; border-radius:6px; background:var(--ds-accent,#8A5F2E); color:var(--ds-accent-text,#FFFFFF); font-size:13px; cursor:pointer; white-space:nowrap;">Redraft</button>
        </div>
        <div id="rc-ai-tweak-undo" style="display:none; margin-top:6px;"><a href="javascript:void(0)" style="font-size:12px; color:var(--ds-info,#2C6E9C); text-decoration:none;">↩ Undo last revision</a></div>
      </div>
    </div>
  `;
  document.body.appendChild(choiceOverlay);
  const choiceListEl = choiceOverlay.querySelector('#rc-ai-choice-list');
  const tabBtns = choiceOverlay.querySelectorAll('.rc-ai-choice-tab');

  const statusEl       = panel.querySelector('#rc-ai-status');
  const contextArea     = panel.querySelector('#rc-ai-context');
  const providersEl     = panel.querySelector('#rc-ai-providers');
  const lastDraftedEl   = panel.querySelector('#rc-ai-last-drafted');
  const settingsToggle  = panel.querySelector('#rc-ai-settings-toggle');
  const settingsEl      = panel.querySelector('#rc-ai-settings');
  let statusTimer = null;

  function setStatus(msg, color = 'var(--ds-success,#067647)', sticky = false) {
    statusEl.style.color = color;
    statusEl.textContent = msg;
    clearTimeout(statusTimer);
    if (!sticky) statusTimer = setTimeout(() => { statusEl.textContent = ''; }, 6000);
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── Settings panel: API key / model / URL fields per provider, auto-saved. ──
  function renderSettings() {
    settingsEl.innerHTML = '';
    PROVIDERS.forEach((provider) => {
      const group = document.createElement('div');
      group.className = 'rc-ai-settings-group';
      const title = document.createElement('div');
      title.className = 'rc-ai-settings-group-title';
      title.style.color = provider.color;
      title.textContent = provider.label;
      group.appendChild(title);

      provider.fields.forEach((f) => {
        const storageKey = `rc_ai_cfg_${provider.key}_${f.id}`;
        const label = document.createElement('div');
        label.className = 'rc-ai-settings-field-label';
        label.textContent = f.label;
        const input = document.createElement('input');
        input.className = 'rc-ai-settings-field';
        input.type = f.type;
        input.placeholder = f.placeholder;
        input.value = GM_getValue(storageKey, '');
        input.addEventListener('input', () => {
          GM_setValue(storageKey, input.value);
          renderProviderButtons(); // refresh API-vs-copy badges live
        });
        group.appendChild(label);
        group.appendChild(input);
      });
      settingsEl.appendChild(group);
    });
  }
  renderSettings();

  settingsToggle.addEventListener('click', () => {
    settingsEl.classList.toggle('open');
  });

  // ── Per-conversation identity, so context notes and "last drafted" state ──
  // never bleed from one patient's thread into another's.
  function currentConvoKey() {
    return location.pathname + location.search;
  }
  let loadedConvoKey = null;

  function loadContextForCurrentConvo() {
    const key = currentConvoKey();
    if (key === loadedConvoKey) return;
    loadedConvoKey = key;
    contextArea.value = GM_getValue('rc_ai_context::' + key, '');
    const lastForConvo = GM_getValue('rc_ai_last_drafted::' + key, '');
    lastDraftedEl.textContent = lastForConvo ? `last: ${lastForConvo}` : '';
    closeChoiceModal();
  }

  contextArea.addEventListener('input', () => {
    GM_setValue('rc_ai_context::' + currentConvoKey(), contextArea.value);
  });

  // ── Runtime scroll test: does this element actually move when we set scrollTop? ──
  // overflow:hidden elements STILL scroll programmatically, so we test behavior, not CSS.
  function canScroll(el) {
    if (!el) return false;
    const range = el.scrollHeight - el.clientHeight;
    if (range < 20) return false;
    const start = el.scrollTop;
    const probe = start === 0 ? 40 : start - 40;
    el.scrollTop = probe;
    const moved = el.scrollTop !== start;
    el.scrollTop = start; // restore
    return moved;
  }

  // ── Find the real scrollable conversation container by testing every ancestor ──
  function getScrollContainer() {
    const anchor =
      document.querySelector('div[data-arrow-navigation="true"]') ||
      document.querySelector('div[data-name="conversation-card"]');

    const candidates = [];

    if (anchor) {
      let el = anchor.parentElement;
      while (el && el !== document.body) {
        if (canScroll(el)) {
          candidates.push({ el, range: el.scrollHeight - el.clientHeight });
        }
        el = el.parentElement;
      }
    }

    // Fallback: scan the whole document for scrollable divs that hold cards.
    if (candidates.length === 0) {
      document.querySelectorAll('div').forEach((el) => {
        if (!el.querySelector('div[data-name="conversation-card"]')) return;
        if (canScroll(el)) candidates.push({ el, range: el.scrollHeight - el.clientHeight });
      });
    }

    if (candidates.length === 0) {
      log('No scrollable container found.');
      return null;
    }

    // Prefer the nearest ancestor with a real scroll range; tie-break on largest range.
    candidates.sort((a, b) => b.range - a.range);
    const chosen = candidates[0].el;
    log('Scroll container chosen:', chosen, 'candidates:', candidates.map(c => c.range));
    return chosen;
  }

  function getPatientName() {
    const label = document.querySelector('div.RcInlineEditable-label');
    if (label && label.textContent.trim()) return label.textContent.trim();
    const counts = {};
    harvested.forEach((m) => {
      if (m.sender && m.sender.toLowerCase() !== 'medical team') {
        counts[m.sender] = (counts[m.sender] || 0) + 1;
      }
    });
    const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    return best ? best[0] : 'Unknown Patient';
  }

  function extractTimeText(node) {
    const spans = node.querySelectorAll('span');
    for (let i = spans.length - 1; i >= 0; i--) {
      const t = spans[i].textContent.trim();
      if (/^\d{1,2}\/\d{1,2}(\/\d{2,4})?\s+\d{1,2}:\d{2}(\s*[AP]M)?$/i.test(t)) return t;
      if (/^\d{1,2}:\d{2}(\s*[AP]M)?$/i.test(t)) return t;
    }
    return '';
  }

  const harvested = new Map();

  function harvestNow() {
    const nodes = document.querySelectorAll(
      'div[data-test-automation-class="time-node-divider"], div[data-name="conversation-card"]'
    );
    let runningDate = '';
    nodes.forEach((node) => {
      if (node.hasAttribute('data-test-automation-class')) {
        const span = node.querySelector('span');
        if (span) runningDate = span.textContent.trim();
        return;
      }
      const id = node.getAttribute('data-id') || node.getAttribute('data-card');
      if (!id) return;
      const textEl = node.querySelector('div[data-name="text"]');
      if (!textEl) return;
      const text = textEl.textContent.trim();
      if (!text) return;
      const nameEl = node.querySelector('div[data-test-automation-id="sms-card-header-name"]');
      const sender = nameEl ? nameEl.textContent.trim() : '';
      const time = extractTimeText(node);
      const prev = harvested.get(id);
      harvested.set(id, {
        id,
        text,
        sender: sender || (prev ? prev.sender : ''),
        time:   time   || (prev ? prev.time   : ''),
        date:   runningDate || (prev ? prev.date : ''),
      });
    });
  }

  async function scrollAndHarvestAll() {
    const container = getScrollContainer();
    harvested.clear();

    if (!container) {
      setStatus('⚠️ Could not find the scroll area. Capturing visible only.', '#FF9800', true);
      harvestNow();
      return;
    }

    // Anchor at the newest messages, then climb upward.
    container.scrollTop = container.scrollHeight;
    await sleep(500);
    harvestNow();

    let prevSize = -1;
    let prevTop = Infinity;
    let stall = 0;
    let guard = 0;

    while (guard++ < 800) {
      harvestNow();
      setStatus(`Loading thread…\n${harvested.size} messages (top ${Math.round(container.scrollTop)})`, '#FFB300', true);

      const top = container.scrollTop;
      const grew = harvested.size > prevSize;
      const movedUp = top < prevTop - 2;

      if (!grew && !movedUp && top <= 2) {
        stall++;
        if (stall >= 4) break; // at the top, nothing new mounting → done
      } else {
        stall = 0;
      }

      prevSize = harvested.size;
      prevTop = top;

      const step = Math.max(200, container.clientHeight * 0.85);
      container.scrollTop = Math.max(0, top - step);
      await sleep(grew ? 500 : 380);
    }

    log('Harvest complete. Total messages:', harvested.size, 'iterations:', guard);
    harvestNow();
  }

  function buildPromptFromHarvest() {
    const msgs = [...harvested.values()].sort((a, b) => Number(a.id) - Number(b.id));
    if (msgs.length === 0 && !contextArea.value.trim()) return null;

    let lastSender = '';
    msgs.forEach((m) => {
      if (m.sender) lastSender = m.sender;
      else m.sender = lastSender;
    });

    const lines = msgs.map((m) => {
      const datePrefix = m.date ? `${m.date}, ` : '';
      const stamp = (datePrefix + (m.time || '')).trim();
      return `[${stamp}] ${m.sender}: ${m.text}`;
    });

    const patientName = getPatientName();
    const context = contextArea.value.trim();
    const contextBlock = context
      ? `--- ADDITIONAL CONTEXT ---\n${context}\n--- END CONTEXT ---\n\n`
      : '';

    return {
      prompt: PROMPT_TEMPLATE
        .replace('{{PATIENT_NAME}}', patientName)
        .replace('{{MESSAGES}}', msgs.length ? lines.join('\n') : '(no conversation messages available — drafting from context only)')
        .replace('{{CONTEXT_BLOCK}}', contextBlock),
      count: msgs.length,
      patientName,
    };
  }

  // ── Composer lookup: RingCentral's message box is a Quill editor inside a ──
  // container tagged with a stable data-test-automation-id. Try that exact
  // selector first; fall back to scanning near the attachment button in case
  // the wrapper markup changes.
  function findComposer() {
    const direct = document.querySelector(
      'div[data-test-automation-id="editor-container-wrapper"] .ql-editor[contenteditable="true"]'
    );
    if (direct) return direct;

    const attachBtn = document.querySelector(
      'button[data-test-automation-id="conversation-chatbar-attachment-button"]'
    );
    if (!attachBtn) return null;
    let node = attachBtn;
    for (let i = 0; i < 6 && node; i++) {
      node = node.parentElement;
      if (!node) break;
      const editable = node.querySelector('[contenteditable="true"]') || node.querySelector('textarea');
      if (editable) return editable;
    }
    return null;
  }

  function insertTextIntoComposer(text) {
    const el = findComposer();
    if (!el) return false;
    el.focus();
    if (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT') {
      const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      document.execCommand('selectAll', false, null);
      document.execCommand('insertText', false, text);
    }
    return true;
  }

  // ── Reply picker: parse the AI's markdown code-block replies (the prompt asks ──
  // for at least 3) into separate options and let the user pick one to paste,
  // rather than dumping the whole raw response in one box.
  function extractReplyOptions(text) {
    const codeBlockRegex = /```(?:\w*\n)?([\s\S]*?)```/g;
    const options = [];
    let match;
    while ((match = codeBlockRegex.exec(text)) !== null) {
      const block = match[1].trim();
      if (block) options.push(block);
    }
    if (options.length === 0) {
      const trimmed = text.trim();
      if (trimmed) options.push(trimmed);
    }
    return options;
  }

  // ── Extract pharmacy escalation email and Slack forwarding notes from ──
  // the AI response. These appear between --- dividers with emoji headers.
  function extractEmailContent(text) {
    // Match: ---\n📧 PHARMACY ESCALATION EMAIL ... up to next --- or end
    const re = /---\s*\n📧\s*PHARMACY ESCALATION EMAIL\s*\n([\s\S]*?)(?=\n---|\n💬|$)/;
    const m = text.match(re);
    return m ? m[1].trim() : '';
  }

  function extractSlackNotes(text) {
    const notes = [];
    // Match: ---\n💬 SLACK NOTE TO [NAME]\n...content...
    const re = /---\s*\n💬\s*SLACK NOTE TO\s+(.+?)\s*\n([\s\S]*?)(?=\n---|\n📧|$)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      notes.push({ recipient: m[1].trim(), content: m[2].trim() });
    }
    return notes;
  }

  function closeChoiceModal() {
    choiceOverlay.classList.remove('open');
    choiceListEl.innerHTML = '';
    // Reset to SMS tab as default
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === 'sms'));
  }

  function pasteAndClose(text) {
    const ok = insertTextIntoComposer(text);
    closeChoiceModal();
    if (ok) {
      GM_setValue('rc_ai_last_drafted::' + currentConvoKey(), new Date().toLocaleString());
      setStatus('✅ Pasted into message box — review before sending.');
    } else {
      setStatus('⚠️ Could not find the message box on this page.', '#FF9800');
    }
  }

  function showChoiceModal(rawText) {
    // Tweak row: offer redrafting only when a previous generation exists. Always
    // start with a blank input and no undo link on a fresh modal render.
    const tweakRow = choiceOverlay.querySelector('#rc-ai-tweak-row');
    const tweakInput = choiceOverlay.querySelector('#rc-ai-tweak-input');
    const tweakUndo = choiceOverlay.querySelector('#rc-ai-tweak-undo');
    if (tweakRow) tweakRow.style.display = lastGen ? 'block' : 'none';
    if (tweakInput) tweakInput.value = '';
    if (tweakUndo) tweakUndo.style.display = 'none';

    const smsOptions = extractReplyOptions(rawText);
    const emailContent = extractEmailContent(rawText);
    const slackNotes = extractSlackNotes(rawText);

    // Update tab badges
    choiceOverlay.querySelector('#rc-ai-sms-count').textContent = smsOptions.length;
    const emailBadge = choiceOverlay.querySelector('#rc-ai-email-badge');
    emailBadge.style.display = emailContent ? 'inline' : 'none';
    const slackBadge = choiceOverlay.querySelector('#rc-ai-slack-count');
    slackBadge.textContent = slackNotes.length;

    // Determine which tab to show by default
    let activeTab = 'sms';
    if (smsOptions.length === 0 && emailContent) activeTab = 'email';
    else if (smsOptions.length === 0 && slackNotes.length > 0) activeTab = 'slack';

    // Activate the right tab button
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === activeTab));

    // Build all tab panels
    choiceListEl.innerHTML = '';

    // ── SMS tab ──
    const smsPanel = document.createElement('div');
    smsPanel.className = 'rc-ai-choice-tab-panel' + (activeTab === 'sms' ? ' active' : '');
    smsPanel.id = 'rc-ai-tab-sms';
    if (smsOptions.length === 0) {
      smsPanel.innerHTML = '<div class="rc-ai-choice-empty">No SMS replies found in the response.</div>';
    } else {
      smsOptions.forEach((opt, i) => {
        const card = document.createElement('div');
        card.className = 'rc-ai-choice-card';
        const textEl = document.createElement('div');
        textEl.className = 'rc-ai-choice-text';
        textEl.textContent = opt;
        const actions = document.createElement('div');
        actions.className = 'rc-ai-choice-actions';
        const copyBtn = document.createElement('button');
        copyBtn.className = 'rc-ai-choice-copy';
        copyBtn.textContent = '📋 Copy';
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          GM_setClipboard(opt, 'text');
          setStatus(`✅ Copied SMS option ${i + 1} to clipboard.`);
        });
        const useBtn = document.createElement('button');
        useBtn.className = 'rc-ai-choice-use';
        useBtn.textContent = '✍️ Use This';
        useBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          pasteAndClose(opt);
        });
        actions.appendChild(copyBtn);
        actions.appendChild(useBtn);
        card.appendChild(textEl);
        card.appendChild(actions);
        card.addEventListener('click', () => pasteAndClose(opt));
        smsPanel.appendChild(card);
      });
    }
    choiceListEl.appendChild(smsPanel);

    // ── Email tab ──
    const emailPanel = document.createElement('div');
    emailPanel.className = 'rc-ai-choice-tab-panel' + (activeTab === 'email' ? ' active' : '');
    emailPanel.id = 'rc-ai-tab-email';
    if (!emailContent) {
      emailPanel.innerHTML = '<div class="rc-ai-choice-empty">No pharmacy escalation email in this response.</div>';
    } else {
      const card = document.createElement('div');
      card.className = 'rc-ai-choice-email-card';
      const header = document.createElement('div');
      header.className = 'rc-ai-choice-email-header';
      header.textContent = '📧 Pharmacy Escalation Email';
      const textEl = document.createElement('div');
      textEl.className = 'rc-ai-choice-email-text';
      textEl.textContent = emailContent;
      const actions = document.createElement('div');
      actions.className = 'rc-ai-choice-email-actions';
      const copyBtn = document.createElement('button');
      copyBtn.className = 'rc-ai-choice-email-copy';
      copyBtn.textContent = '📋 Copy Email';
      copyBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        GM_setClipboard(emailContent, 'text');
        setStatus('✅ Pharmacy email copied to clipboard.');
      });
      const gmailBtn = document.createElement('button');
      gmailBtn.className = 'rc-ai-choice-email-copy';
      gmailBtn.textContent = '📬 Open Gmail';
      gmailBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        // Extract subject and body for a mailto link
        const subjectMatch = emailContent.match(/^Subject:\s*(.+)$/m);
        const subject = subjectMatch ? subjectMatch[1].trim() : 'Pharmacy Escalation';
        const body = emailContent.replace(/^Subject:.*\n?/m, '').trim();
        GM_setClipboard(emailContent, 'text');
        window.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`, '_blank');
        setStatus('✅ Email copied & Gmail opened.');
      });
      actions.appendChild(copyBtn);
      actions.appendChild(gmailBtn);
      card.appendChild(header);
      card.appendChild(textEl);
      card.appendChild(actions);
      emailPanel.appendChild(card);
    }
    choiceListEl.appendChild(emailPanel);

    // ── Slack tab ──
    const slackPanel = document.createElement('div');
    slackPanel.className = 'rc-ai-choice-tab-panel' + (activeTab === 'slack' ? ' active' : '');
    slackPanel.id = 'rc-ai-tab-slack';
    if (slackNotes.length === 0) {
      slackPanel.innerHTML = '<div class="rc-ai-choice-empty">No Slack forwarding notes in this response.</div>';
    } else {
      slackNotes.forEach((note) => {
        const card = document.createElement('div');
        card.className = 'rc-ai-choice-slack-card';
        const header = document.createElement('div');
        header.className = 'rc-ai-choice-slack-header';
        header.textContent = `💬 Slack Note to ${note.recipient}`;
        const textEl = document.createElement('div');
        textEl.className = 'rc-ai-choice-slack-text';
        textEl.textContent = note.content;
        const actions = document.createElement('div');
        actions.className = 'rc-ai-choice-slack-actions';
        const copyBtn = document.createElement('button');
        copyBtn.className = 'rc-ai-choice-slack-copy';
        copyBtn.textContent = '📋 Copy to Clipboard';
        copyBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          GM_setClipboard(note.content, 'text');
          setStatus(`✅ Slack note to ${note.recipient} copied.`);
        });
        const openSlackBtn = document.createElement('button');
        openSlackBtn.className = 'rc-ai-choice-slack-copy';
        openSlackBtn.textContent = '💬 Open Slack';
        openSlackBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          GM_setClipboard(note.content, 'text');
          window.open('slack://open', '_blank');
          setStatus(`✅ Slack note copied — opening Slack.`);
        });
        actions.appendChild(copyBtn);
        actions.appendChild(openSlackBtn);
        card.appendChild(header);
        card.appendChild(textEl);
        card.appendChild(actions);
        slackPanel.appendChild(card);
      });
    }
    choiceListEl.appendChild(slackPanel);

    choiceOverlay.classList.add('open');
  }

  // ── Tab switching ──
  function switchChoiceTab(tabName) {
    tabBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tabName));
    choiceListEl.querySelectorAll('.rc-ai-choice-tab-panel').forEach(p => {
      p.classList.toggle('active', p.id === `rc-ai-tab-${tabName}`);
    });
  }

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => switchChoiceTab(btn.dataset.tab));
  });

  choiceOverlay.querySelector('#rc-ai-choice-close').addEventListener('click', closeChoiceModal);
  choiceOverlay.addEventListener('click', (e) => {
    if (e.target === choiceOverlay) closeChoiceModal();
  });

  panel.querySelector('#rc-ai-paste-clipboard-btn').addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        setStatus('⚠️ Clipboard is empty. Copy the AI reply first.', '#FF9800');
        return;
      }
      showChoiceModal(text);
    } catch (err) {
      console.error('[RC AI] clipboard read error:', err);
      setStatus('⚠️ Clipboard access denied — paste manually (Ctrl+V) instead.', '#FF9800');
    }
  });

  let busy = false;
  // Last successful API generation, backing the "tweak the draft" redraft feature.
  // Shape: { providerKey, prompt, output }. Assigned ONLY on a successful
  // provider.call — a failed call must leave it untouched.
  let lastGen = null;
  const LAST_PROVIDER_KEY = 'rc_ai_last_provider';

  // API mode: call the provider directly, then show the reply options as pop-up cards.
  async function runApiMode(provider, result) {
    setStatus(`Sending ${result.count} messages to ${provider.label}…`, '#FFB300', true);
    const cfg = providerConfig(provider);
    const reply = await provider.call(result.prompt, cfg);
    if (!reply) throw new Error('Empty response from the API.');
    lastGen = { providerKey: provider.key, prompt: result.prompt, output: reply };
    showChoiceModal(reply);
    setStatus(`✅ Draft ready from ${provider.label}.`);
  }

  // Copy mode (no API key set): same as the original workflow — copy the
  // prompt and open the provider's own chat site for a low-key/no-setup path.
  function runCopyMode(provider, result) {
    GM_setClipboard(result.prompt, 'text');
    setStatus(`✅ Copied ${result.count} messages — opening ${provider.label}… (add an API key in ⚙ Settings to skip this step)`);
    window.open(provider.webUrl, '_blank');
  }

  function renderProviderButtons() {
    const lastKey = GM_getValue(LAST_PROVIDER_KEY, '');
    const ordered = [...PROVIDERS].sort((a, b) => (a.key === lastKey ? -1 : b.key === lastKey ? 1 : 0));
    providersEl.innerHTML = '';
    ordered.forEach((provider) => {
      const apiReady = hasApiConfigured(provider);
      const btn = document.createElement('button');
      btn.className = 'rc-ai-provider-btn' + (provider.key === lastKey ? ' last-used' : '');
      btn.style.borderLeft = `3px solid ${provider.color}`;
      btn.innerHTML = `${provider.label}<div class="rc-ai-provider-mode" style="color:${apiReady ? 'var(--ds-success,#067647)' : '#98A2B3'}">${apiReady ? 'API' : 'copy → site'}</div>`;
      btn.addEventListener('click', async () => {
        if (busy) return;
        busy = true;
        providersEl.classList.add('busy');
        closeChoiceModal();
        try {
          setStatus('Scrolling to load full conversation…', '#FFB300', true);
          await scrollAndHarvestAll();
          const result = buildPromptFromHarvest();
          if (!result) {
            setStatus('⚠️ Nothing to draft from — open a conversation or add context in the panel first.', '#FF9800');
            return;
          }
          if (apiReady) {
            await runApiMode(provider, result);
          } else {
            runCopyMode(provider, result);
          }
          GM_setValue(LAST_PROVIDER_KEY, provider.key);
          renderProviderButtons();
        } catch (err) {
          console.error('[RC AI] error:', err);
          setStatus(`⚠️ ${err.message || 'Error generating reply — check console.'}`, 'var(--ds-danger,#B42318)', true);
        } finally {
          busy = false;
          providersEl.classList.remove('busy');
        }
      });
      providersEl.appendChild(btn);
    });
  }
  renderProviderButtons();

  // ── Redraft: revise the last generation through the SAME provider. ──
  // Wired once; guarded against double-fires by the button's disabled state.
  let undoPrev = null;
  const tweakInput = choiceOverlay.querySelector('#rc-ai-tweak-input');
  const tweakBtn = choiceOverlay.querySelector('#rc-ai-tweak-btn');
  const tweakUndo = choiceOverlay.querySelector('#rc-ai-tweak-undo');

  tweakBtn.addEventListener('click', async () => {
    if (tweakBtn.disabled || !lastGen) return;
    const tweak = tweakInput.value.trim();
    if (!tweak) {
      setStatus('⚠️ Type what you want changed first.', '#FF9800');
      return;
    }
    tweakBtn.disabled = true;
    tweakBtn.textContent = 'Redrafting…';
    try {
      const provider = PROVIDERS.find((p) => p.key === lastGen.providerKey);
      if (!provider) throw new Error(`Provider ${lastGen.providerKey} is no longer available.`);
      const revisedPrompt =
        lastGen.prompt +
        '\n\n<revision_request>\nThe medical team member reviewed the previous drafts and wants one revision before sending.\n\nRevision requested: ' +
        tweak +
        '\n\nPrevious drafts:\n' +
        lastGen.output +
        '\n\nRe-draft the replies applying this revision. Follow ALL the same rules above (<reply_rules>, <standard_templates>, <routing_logic>, <standing_rules>, <tone_guidance>). Keep the same output structure. Only output the revised drafts.\n</revision_request>';
      const cfg = providerConfig(provider);
      const reply = await provider.call(revisedPrompt, cfg);
      if (!reply) throw new Error('Empty response from the API.');
      const prev = lastGen.output;
      undoPrev = prev;
      lastGen.output = reply;
      showChoiceModal(reply);
      tweakUndo.style.display = 'block';
      setStatus('✅ Redrafted — revision applied.');
    } catch (err) {
      console.error('[RC AI] redraft error:', err);
      setStatus(`⚠️ ${err.message}`, 'var(--ds-danger,#B42318)', true);
    } finally {
      tweakBtn.disabled = false;
      tweakBtn.textContent = 'Redraft';
    }
  });

  tweakUndo.querySelector('a').addEventListener('click', (e) => {
    e.preventDefault();
    if (!undoPrev || !lastGen) return;
    lastGen.output = undoPrev;
    undoPrev = null;
    tweakUndo.style.display = 'none';
    showChoiceModal(lastGen.output);
    setStatus('↩ Reverted to the previous drafts.');
  });

  panel.querySelector('#rc-ai-clear-btn').addEventListener('click', () => {
    contextArea.value = '';
    GM_setValue('rc_ai_context::' + currentConvoKey(), '');
    setStatus('Context cleared.', '#98A2B3');
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (choiceOverlay.classList.contains('open')) {
      closeChoiceModal();
    } else if (panel.classList.contains('open')) {
      panel.classList.remove('open');
    }
  });

  // ── Inline toolbar button that mimics RingCentral's native icon buttons ──
  // We do NOT rely on RC's hashed classnames (they rot every build). We match
  // the visual box (44x44, round, centered SVG) with our own scoped styles and
  // mount into the chatbar toolbar. A MutationObserver re-injects if React
  // re-renders the toolbar (e.g. when switching conversations), and we use the
  // same observer tick to detect conversation switches for context/state reset.

  const INLINE_BTN_ID = 'rc-ai-inline-btn';

  function positionPanel(btn) {
    const rect = btn.getBoundingClientRect();
    const gap = 10;              // space between button and panel
    const panelW = 400;          // matches CSS width
    const margin = 8;            // keep off the screen edge

    // Bottom of panel sits just above the button.
    panel.style.bottom = `${window.innerHeight - rect.top + gap}px`;
    panel.style.top = 'auto';

    // Center the panel horizontally over the button, then clamp to viewport.
    const btnCenterX = rect.left + rect.width / 2;
    let panelLeft = btnCenterX - panelW / 2;
    if (panelLeft < margin) panelLeft = margin;
    if (panelLeft + panelW > window.innerWidth - margin) panelLeft = window.innerWidth - panelW - margin;

    panel.style.left = `${panelLeft}px`;
    panel.style.right = 'auto';
  }

  function buildInlineButton() {
    const btn = document.createElement('button');
    btn.id = INLINE_BTN_ID;
    btn.type = 'button';
    btn.setAttribute('aria-label', 'AI Reply Assistant');
    btn.title = 'AI Reply Assistant';
    btn.innerHTML = `
      <span class="rc-ai-inline-icon">
        <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor">
          <path d="M16 3a2 2 0 0 1 2 2v1h4a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H10a4 4 0 0 1-4-4V10a4 4 0 0 1 4-4h4V5a2 2 0 0 1 2-2zm6 5H10a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V10a2 2 0 0 0-2-2zm-9 4a2 2 0 1 1 0 4 2 2 0 0 1 0-4zm6 0a2 2 0 1 1 0 4 2 2 0 0 1 0-4zM4 14a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0v-4a1 1 0 0 1 1-1zm24 0a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0v-4a1 1 0 0 1 1-1zM12 26h8a1 1 0 0 1 0 2h-8a1 1 0 0 1 0-2z"></path>
        </svg>
      </span>`;
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (panel.classList.contains('open')) {
        panel.classList.remove('open');
        return;
      }
      loadContextForCurrentConvo();
      positionPanel(btn);
      panel.classList.add('open');
    });
    return btn;
  }

  function injectInlineButton() {
    // Already present and still attached? Bail.
    if (document.getElementById(INLINE_BTN_ID)) return;

    // The attachment button carries a stable data-test-automation-id that
    // survives rebuilds far better than hashed classnames. Its parent is the
    // toolbar row.
    const attachBtn = document.querySelector(
      'button[data-test-automation-id="conversation-chatbar-attachment-button"]'
    );
    if (!attachBtn || !attachBtn.parentElement) return;

    const btn = buildInlineButton();
    // Drop it right after the attachment button so it sits with the icon cluster.
    attachBtn.insertAdjacentElement('afterend', btn);
  }

  // Initial attempt + keep it alive across React re-renders / convo switches.
  injectInlineButton();
  loadContextForCurrentConvo();
  const toolbarObserver = new MutationObserver(() => {
    injectInlineButton();
    // If the panel is open and the conversation underneath it changed
    // (patient switch without a full page reload), refresh context + label
    // so stale notes/state from the previous patient never carry over.
    if (currentConvoKey() !== loadedConvoKey) {
      loadContextForCurrentConvo();
    }
  });
  toolbarObserver.observe(document.body, { childList: true, subtree: true });

})();
