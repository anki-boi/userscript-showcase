# DESIGN — panel design system (Warm Paper)

**Decision (Jeyson, 2026-08-06):** the userscript panels use the **Warm Paper**
theme — light, flat, matte, warm off-white paper + ink + bronze accent — for
ALL scripts. LifeFile was initially excluded, then **included by Jeyson the
same day** ("I really like the warm paper theme now. even for ALL of them.").
Wave 1 was built on Zoho Slate tokens and switched to Warm Paper by swapping
the token block only (the token architecture's payoff — one-line theme change).

**Authorship (Jeyson, 2026-08-06):** every `.user.js` carries
`// @author       Jeyson Dagondon` in the metadata block — these are his
scripts, not Dr. Jones Team's. `verify-all.js` FAILs on a missing or different
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
| All other scripts (copiers, task menus, Quick Copy, Subject Branching, GLP-1, DJM-TZ, RC AI, LabX, RxFlow Autofill, Product Quick Nav, Auto-Jump, Auto-Expand, Text Highlighter, ChatMeter, SheetsClean, OperaSelect, Guard SMS, Context Extractors ×2) | ⏳ wave 2 | token block + chrome remaps in the same pattern (`_smoketest/themeretrofit-pass.py`); small chrome mostly — quick wins |

## Reference

- `panel-design.css` — canonical tokens + component recipes (`.ds-panel`,
  `.ds-head`, `.ds-btn`, `.ds-chip`, `.ds-table`, `.ds-ok/.ds-warn/.ds-err`,
  `.ds-toast`).
- `panel-themes.html` — the interactive picker Jeyson chose from (4 themes;
  pick stored in localStorage `panel-theme-pick`).
- `_smoketest/themeretrofit-pass.py` — the retrofit tool (assertion-guarded
  string replacements; extend the RETRO table for wave 2; optional file
  filter via argv).
