# DESIGN — panel design system (Warm Paper)

**Decision (Jeyson, 2026-08-06):** the userscript panels use the **Warm Paper**
theme — light, flat, matte, warm off-white paper + ink + bronze accent — for
ALL scripts. LifeFile was initially excluded, then **included by Jeyson the
same day** ("I really like the warm paper theme now. even for ALL of them.").
Wave 1 was built on Zoho Slate tokens and switched to Warm Paper by swapping
the token block only (the token architecture's payoff — one-line theme change).

**Authorship (Jeyson, 2026-08-06):** every `.user.js` carries
`// @author       Jeyson Dagondon` in the metadata block — these are his
scripts, not Dr. Example Team's. `verify-all.js` FAILs on a missing or different
`@author`. (Fixed three stragglers: GLP-1 had "Jeyson", Text Highlighter had
"You", Opera Select still credited the original port author.)

## Tokens (also in `panel-design.css`)

| Token | Value | Use |
|---|---|---|
| `--ds-bg` | `#faf8f5` | page backdrop |
| `--ds-surface` | `#fffdf9` | panel body, cards, inputs (warm paper) |
| `--ds-surface2` | `#f4f0e9` | header bars, hover fills, wells |
| `--ds-border` | `#e8e2d8` | 1px matte borders |
| `--ds-text` | `#2b2620` | primary text (warm ink) |
| `--ds-muted` | `#7a7163` | secondary text, footers |
| `--ds-accent` | `#8a5f2e` | primary buttons, links, active tab (bronze) |
| `--ds-accent-text` | `#ffffff` | text on accent fills |
| `--ds-success` | `#3d7a46` | ok / copied / done |
| `--ds-warn` | `#a16207` | attention / pending |
| `--ds-danger` | `#b3402e` | blocked / failed / reset |
| `--ds-info` | `#2c6e9c` | info / in-progress |

Status language (one meaning everywhere): **green = done, amber = attention,
red = blocked, bronze = action**.

## Rollout rule

Every color remap keeps the ORIGINAL hex as the var() fallback —
`background: var(--ds-surface, #fffdf9);` — so a missing token block degrades
to the old look, never to a broken one. The `:root` token block is injected at
the top of each script's main CSS literal (or via a `<style>` element at boot
for scripts with no CSS literal, e.g. Toolkit and the LifeFile banners).
Tokens are `--ds-` prefixed so they can never collide with host-app CSS vars.

## Rollout tracker

| Script | Status | Notes |
|---|---|---|
| RxFlow Sale Automator | ✅ v2.5 | 18 remaps; header dark→light; tokens |
| Tracking Bus (All-in-One) | ✅ v2.14 | dark→light conversion (panel, textarea, table, status) |
| Zoho CRM — Peptide SMS Templates | ✅ v5.5.5 | accent/surface/border tokens |
| Zoho CRM — Address Validator | ✅ v1.7 | chip states + panel to tokens |
| Template Menu | ✅ v6.9 | fab to accent; rest already near-theme |
| Cross-Platform Contact Toolkit | ✅ v7.25 | link/copy-button colors + borders; style-tag token injection at boot |
| CC Custom Build - Zoho CRM Patient Data Extractor | ✅ v1.30 | wave 2 + 2.5: visible action buttons remapped (Copy Everything purple→bronze, Create Lab teal→bronze, blue pill→surface2/bronze, rose→danger) — gray/text-only remaps read as "no change" |
| LifeFile Portal Session Handler | ✅ v1.19 | status banner → success/danger tokens |
| LifeFile Order Autofill | ✅ v1.12 | clinic banner → danger, amber button text |
| LifeFile Patient Profile Autofill | ✅ v1.5 | flashButton success/danger; field glow kept (attention cue) |
| LifeFile Order Status Extractor | ✅ v1.7 | banner → info token |
| **Zoho CRM - Care Plan Toolkit** (merged 2026-09-25: Care Plan age + LDN verdict + auto-jump + whole-line highlighter) | ⏳ wave 2 | care-plan note keeps its own tone palette (green/amber/red/blue + Clinic-Pay purple); no `--ds-*` remap yet |
| All other scripts (copiers, the merged Zoho Task Toolkit — task menus + subject branching + due-date quick-set, Quick Copy, GLP-1, DJM-TZ, RC AI, LabX, RxFlow Autofill, Product Quick Nav, Auto-Expand, ChatMeter, SheetsClean, OperaSelect, Guard SMS, Context Extractors ×2) | ⏳ wave 2 | token block + chrome remaps in the same pattern (`_smoketest/themeretrofit-pass.py`); small chrome mostly — quick wins |

## Trigger contract (Jeyson, 2026-10-02)

**Decision:** floating buttons and always-visible panels clog the UI. A panel is
summoned from an inline control and must be easy to leave. Candidate list and
per-script anchors: `plans/2026-10-02_inline-panel-triggers.md`.

1. **No always-on floating UI.** Never append a visible `position:fixed`
   control at boot. The trigger is inline in the host app's own chrome — its
   toolbar, action row, tab bar, header, or beside the button the workflow is
   about.
2. **One summon control, three exits.** Every summoned panel closes on its own
   ✕/Exit, on **Escape**, and on a **click anywhere outside it** (capture phase,
   ignoring the trigger). A ✕ alone is not enough.
3. **Floating fallback only when the host chrome is missing** — small,
   edge-docked, and self-re-docking when the chrome appears
   (`Template Menu`'s `#tmenu-fab` + `.tmenu-fab-fallback` + `watchFAB()`).
4. **Dragging is not closing.** A draggable always-present panel is still an
   always-present panel.
5. **It must survive split screen.** Dock on the **fixed left edge** of the host's
   chrome (the right side drifts with search boxes/clock rows and is what clips);
   hold the item's width with `flex: 0 0 auto` on the **flex item** (the `li`, not
   the `<a>` inside it); build the trigger as `glyph span + label span` and drop
   the label at the **host's own** collapse breakpoint (`767.98px` for
   Bootstrap/AdminLTE), keeping the state in colour + `title`. Prove it by
   hit-testing the trigger at narrow widths via CDP `Emulation` (see
   `_smoketest/verify-psa-trigger-live.mjs`).

6. **Exception, granted case by case.** A script with **no host chrome to dock
   into** may keep a floating trigger — Jeyson, on `Tracking Swiss Army Knife`
   (2026-10-02): "it's fine to keep this one floating except the icon is too
   annoying. let it be an inconspicuous icon and make it small." Floating then
   means **small and quiet**: ~22px, low opacity at rest, no drop shadow, a
   single monochrome glyph with a `title`, brightening only on hover/focus and
   while the panel is open. Rule 2 (three exits) still applies.

Models to copy: `RingCentral` / `Patient Connect AI Reply Assistant`
(`injectInlineButton()` beside the send button + Escape), `Template Menu`,
`Zoho Task Toolkit`.

## Data lookup and verification (Jeyson, 2026-10-02)

**Decision:** a host app's own search is an unreliable witness. It must be asked
what you mean, and its answer must be verified — never counted. Written after
wrong-patient sends in the RxFlow Sale Automator: the Patients search is a
fuzzy substring match, so the lone surname `Sampleperson` returned **exactly one**
row — `PAT123456789 · Patienttwo Sampleperson` — and the old rule *"exactly one row =
found"* opened her profile for `Patientone Sampleperson`'s order. Downstream of that
profile sits the order and the patient SMS.

This section applies to **every** script that resolves a record in a host app
(patient, order, customer, ticket, tracking number).

1. **A result is not proof of identity.** Never accept a returned row count, or a
   single returned record, as confirmation. Parse the returned record's own
   fields and accept only when the thing you searched for **matches it exactly**.
2. **Never query a partial identifier** — no first-name-only, no last-name-only,
   no single name token, no bare prefix. Require the full discriminating key
   (full first+last name, record ID, phone, or DOB where the app supports it).
   *"avoid searching via first name only and last name only because they can
   match with a fuck ton of people."*
3. **Search only what the app actually indexes.** Verify each key against the live
   app; **drop keys it ignores**, because a key that always returns nothing
   manufactures a *false not-found* — which deletes a real record. (RxFlow's
   Patients search ignores email entirely: probe evidence in
   `_smoketest/probe-psa-lookup.mjs`.)
4. **Prove the round trip before reading any result.** After triggering a lookup,
   require evidence the app performed **that** query (the request it issued
   carrying your query, or an observable response) before interpreting rows. No
   evidence → **error, never a verdict**. *Failure this prevents:* a
   rendered-but-unwired list fired no request at all, kept its 10 unfiltered rows,
   and the row count was read as an answer.
5. **Enter a view through the app's own navigation.** Click the host app's own
   tab/nav control; a hard URL load can land on a rendered-but-dead view. Use
   `location.href`/route assignment **only** as a fallback when no such control
   exists.
6. **A lookup that failed removes the record; only a lookup that never ran may be
   kept.** No match found, or a returned record that is not this one → the record
   is treated as not found and **removed**. Keep a record **only** when no verdict
   could be produced (the check never ran, or there was nothing to search by) and
   label it with the reason. *"if there is no proper match, still remove the row
   … what gave you the approval to keep the row that is useless?"* Never invent a
   keep-for-review state.
7. **Unconfirmed identity goes to a human as an explicit choice.** If a lookup
   returns candidate records, present the **identity line** of each
   (`ID · name · DOB · phone`, never scraped button text) and open one only on a
   click. Never auto-select, and never cross a documented human safety gate
   (see `SPEC.md` § Selector contract).

Where to prove it: an offline assertion harness for the verification rules and a
**live** harness that drives the deployed script through its own API — see
`_smoketest/verify-psa-lookup-live.mjs` (28 checks: the fuzzy-match case, the
no-search-sent case, the remove-on-no-match case, and a positive control).

## Agent guardrails (Jeyson, 2026-10-02)

Rules for the agent working in this repo, not for the scripts:

1. **Drive only browser tabs the agent opened.** Never click, scroll, reload,
   navigate or close a tab Jeyson opened. Open a fresh tab for probes; if a
   reusable tab is needed, say so before using it.
2. **Never clear or overwrite state his own sessions own.** `localStorage`,
   session stores, queues and active jobs are **shared** with his real tabs.
   Remove only the keys the script under test owns, never `localStorage.clear()`,
   and reload between test scenarios instead of wiping storage.
3. **No unrequested friction or retention.** Do not add keep-for-review lists,
   extra confirmation gates, or state the user did not ask for. If the intended
   default is unclear, follow the documented rule or ask — do not invent a
   safer-looking behaviour and present it as a decision.
4. **Verify numerically, not visually.** The agent cannot read screenshots:
   assert via DOM measurement, CDP evaluation, and harness output. A screenshot
   may be produced for Jeyson, but never as the agent's evidence.
5. **Fix the script, don't assist it.** If a manual step, a re-run, or a special
   invocation is needed to make an automation work, the script is bugged — find
   the root cause instead of routing around it.

## Reference

- `panel-design.css` — canonical tokens + component recipes (`.ds-panel`,
  `.ds-head`, `.ds-btn`, `.ds-chip`, `.ds-table`, `.ds-ok/.ds-warn/.ds-err`,
  `.ds-toast`).
- `panel-themes.html` — the interactive picker Jeyson chose from (4 themes;
  pick stored in localStorage `panel-theme-pick`).
- `_smoketest/themeretrofit-pass.py` — the retrofit tool (assertion-guarded
  string replacements; extend the RETRO table for wave 2; optional file
  filter via argv).
