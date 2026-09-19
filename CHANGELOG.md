# RxFlow Sale Automator — changelog

Moved out of the script's `@description` header on 2026-08-03 so the Tampermonkey metadata stays a one-liner. The `@version` header is the source of truth for the current version; this file is the history.

## Current

Paste a CSV or JSON order row, confirm the column mapping, then auto-drive patient lookup -> consent gate -> sale creation -> product/quantity entry -> questionnaire logic -> ship-date entry, stopping right before Continue is clicked (Continue itself is the last automated action; provider selection is out of scope).

---

## v2.19

Unmatched purchase items no longer kill the row + a safe name resolver (2026-09-11):

- **One unknown shorthand used to abort the WHOLE row.** `stepSelectModules`
  returned early when `parsePurchase` reported an unmapped item
  ("Add them to PRODUCT_ALIASES and resume manually"), so the peptides that DID
  resolve were never added either — and the questionnaire, ship date and
  Continue gate all had to be done by hand. Jeyson: *"it really bums me out
  that I had to fill things out manually."*
  Now the script adds everything it can resolve, shows an amber hand-off
  listing the leftovers, and **resumes the automation** when the human presses
  **"Added them manually — continue"** (or `trigger('continue')`): questionnaire
  skip/prefill, ship date and the final Continue gate stay automated. The
  matched items already in the cart are flagged (`job.productsAdded`) so a page
  reload during the hand-off cannot re-add them.
- **Product-name resolver (`resolveCatalogProduct`) — a second chance before
  handing off.** When a shorthand has no `PRODUCT_ALIASES` entry, the catalog
  name itself is matched after ignoring the `[GRE]`/`[STK]` brand tag, case and
  whitespace, optionally ignoring ONE trailing form word
  (injectable/inj/capsules/solution). Verified against the live catalog +
  Jeyson's real sheet values: `Epithalon Inj`, `BPC-157 Inj`, `BPC-157 Capsule`,
  `MOTS-C`, `TB500`, `Tesamorelin`, `5-Amino 1MQ`, `PT-141 Inj`,
  `Glutathione Inj`, `DSIP/BPC/CJC`, `Klow Injectable` now resolve with no alias
  entry; `BPC-157` alone still defers to its alias.
  **It never guesses:** a same-core ambiguity with no form word
  (`BPC-157` vs the injectable + capsules pair), a component-only name whose
  catalog entry is a combo (`Semax`, `Selank`, `Pinealon`, `AOD-9604`), or an
  unknown name stays unmapped for the human. Auto-matched items are reported in
  the panel message + console (`[PSA] auto-matched by product name ...`), never
  silently.
- Harness: `_smoketest/verify-psa-v20.js` gained a v2.19 section (name-resolver
  battery incl. the synthetic same-core ambiguity contract, autoMatched
  reporting, and source guards for the resumable hand-off) — 335 asserts.

---

## v2.18

Hardened CSV parsing + new sheet column (2026-08-25):

- **Multi-line cells no longer become fake rows.** The sheet's new
  "Current Healing/GH peptides" column (and the "Medical Action" / "Purchase"
  columns) contain cells with EMBEDDED NEWLINES (e.g. "8/7\n3 Tesa/Ipa").
  Spreadsheet copies quote those cells, but the old parser split the whole
  paste on newlines FIRST, so every embedded newline was misread as a new
  row — one patient became several broken rows. `parseCSV` is now a
  full-stream quote-aware tokenizer that only ends a field (delimiter) or a
  row (newline) when OUTSIDE quotes, so multi-line cells stay intact.
  Internal whitespace in each cell collapses to single spaces.
- **Fixed-schema mapping updated** for the new column: "Current Healing/GH
  peptides" inserted into `FIXED_HEADER_ORDER` (between Purchase and Existing
  RxFlow Patient). It is informational (not mapped to a canonical field)
  but its position keeps headerless single-row pastes aligned.
- **Purchase parsing now splits on "&" AND a space-wrapped "+"** — the live
  sheet mixes both ("3 Tesa/Ipa + 3 Klow", "3 Klow & 3 Tesa/Ipa"). The "+"
  split is space-delimited (`\s+\+\s+`) so shorthands containing a plus —
  "NAD+ Inj" — are never broken in two.

---

## v2.16



Script API (R18) — agent-facing status/trigger/output channel (2026-08-22):



- `window.__scripts['PSA']` registers `state`, `message`, `progress`,

  `output`, `error`, `lastActivity`, and a `trigger(action, params)`

  dispatcher (`start-row` by `_id` or first queued, `continue`, `stop`,

  `reset`).

- State machine: `idle -> running -> waiting_human -> done` (or `error`);

  the Continue gate, multi-match pick-one, and Stop/Reset all sync into

  the API object. Progress = `{current, total, step}` per row.

- Version moved 2.15 -> 2.16 because the Thymosin alias commit already

  took 2.15 (it landed on origin while this R18 work was in flight).



---



## v2.15



Added `"thymosin alpha-1 inj"` to the purchase-alias map -> `[GRE]

Thymosin injectable` (2026-08-22). One-line catalog addition; no flow,

selector, or output changes.



---

## v2.13

Comments only — no behavior change, not deployed to Edge (Jeyson 2026-08-18):

- Added a BUSINESS CONTEXT block at the sheet column mapping explaining what
  "Existing RxFlow Patient" really means: non-empty (e.g.
  "YES - Do Not Resend Intake") = patient ordered before + sale already
  created → the automator fills the questionnaire FOR them (prefill + human
  Submit); blank = new patient → auto-skip. Emphasizes the column records
  PRIOR-SALE status, not mere profile existence, and that it stays the single
  source of truth for the skip decision (so future edits don't re-introduce
  the v1.27 profile-check overwrite regression).

---

## v2.12

Auto-skip decision restored to the sheet column as the single source of truth
(Jeyson 2026-08-18 — "if the column is non-empty, do not auto-skip"):

- **Bug**: since v1.27 the profile-check pass force-flagged every found row
  `existingPatient = "TRUE"`, so rows whose sheet "Existing RxFlow
  Patient" column was BLANK stopped auto-skipping the questionnaire — they
  took the existing-patient prefill + human-review path instead.
- **Fix**: `applyProfileCheckResults` no longer writes `r.existingPatient`.
  The pass still fills the patient ID (search-by-ID + queue badges) and still
  removes no-profile rows, but the questionnaire decision in
  `stepSelectModules` now reads ONLY the pasted column value: blank →
  auto-skip (new patient), non-empty → prefill + human review/submit
  (existing patient). Submission stays manual either way.
- Version bump only otherwise — no selector, product, or flow changes.

---

## v2.9

Peptide button remap after RxFlow list changes (2026-08-17, live-verified):

- **Med-type button renamed**: `Peptide` → `Peptides`. The exact-match finder
  timed out on every peptide add — this was why NO product (KLOW, Tesa/IPA,
  all of them) could be found.
- **GLOW moved to the STK brand**: `[GRE] GLOW` → `[STK] GLOW` (catalog +
  `glow` alias).
- **New product**: `[GRE] BPC-157/KPV/TB500` added to Healing (+ aliases
  `bpc-157/kpv/tb500`, `bpc/kpv/tb500`).
- Everything else (categories, all other product names) verified unchanged
  live against a sale form.

---

## v2.2

Short-name purchase aliases (Jeyson's real sheet values, 2026-08-06):

- **New aliases**: `kisspeptin` / `kisspeptin inj`, `bpc inj` / `bpc157` /
  `bpc157 inj`, `nad+ inj` / `nad inj` → the existing products.
- **Kisspeptin added to the CATALOG** (Peptide → Libido → `[GRE] Kisspeptin
  injectable`, live-verified in the sale form) — previously it surfaced as an
  unmapped item.
- **Parser fixes**:
  - A part with NO leading number ("3 Tesa/IPA & Klow") now means quantity 1
    (was: flagged unmapped).
  - A leading duration token is stripped ("1 Year Tesa/IPA" → "Tesa/IPA") —
    the sheet prefixes plan durations. Strips year/years/yr/month/months/mo/
    week/weeks/wk/day/days.
- **Harness now 248 assertions**: all 24 of Jeyson's real purchase strings run
  through the SHIPPED parser with zero unmapped items, exact products, exact
  quantities (capped at 3 with the capped flag preserved).
- Live-verified E2E: "3 Tesa/IPA & 3 Klow & 2 Kisspeptin" → cart Tesa ×3 +
  KLOW ×3 + Kisspeptin ×2, questionnaire prefilled, zero glows.

## v2.1

Explicit answer map (Jeyson's picks, 2026-08-06 — delivered via the clickable
answer sheet) + randomization:

- **25 explicit answers** added to `QUESTION_EXPLICIT_ANSWERS` (now 26 entries
  incl. the "Yes, both" physical-exam rule). Each entry is typed:
  - **checkbox questions** (goals/symptoms lists): the script checks a **random
    non-empty subset** of the picked options — random WHICH and random HOW MANY
    (Fisher–Yates + count 1..N), so questionnaires don't come out identical for
    every patient (Jeyson's ask: "randomize on the which and the how many").
  - **radio questions** (single-select): the script clicks ONE of the picked
    options — chosen at random when several were listed (e.g. hCG goal).
- Questions with NO explicit answer stay manual and glow (11 of the 36: medical
  history, hair progression, Thymosin version, HRT stage, durations Jeyson left
  unset, the broken "Radio Group" field, and the conditional labs checklist).
- **Map integrity is harness-proven**: every key round-trips against the live
  harvest (shipped normalization, HTML-entity-aware), every option exists in the
  question's values, radio/checkbox typing matches the template, and
  `randomSubset` provably varies which + how many (300-iteration invariants).
  Harness now 120 assertions.
- Live-verified E2E (Ying Zhang, Tesa/IPA ×3 + KLOW ×3): **zero glows**, clean
  "Questionnaire filled and ship date set." handoff, Tesa+IPA Combination goals
  answered with a random subset, physical-exam still "Yes, both".
- `questionnaire-answers.html` (the clickable answer-sheet tool) committed for
  future question harvests — new questions get added there, Jeyson clicks, map
  updates.

## v2.0

Complete questionnaire coverage — the sale-form questionnaire was overhauled by the
site (product-driven flow, 432-field template, 301 unique questions across 54
products) and the old generic rules silently left required questions blank. v2.0
rebuilds the prefill and makes misses LOUD:

- **Physical exam/lab work question is ALWAYS "Yes, both"** (Jeyson's policy,
  2026-08-06 — the clinic requires recent physical exam + labs). Implemented via a
  new explicit per-question answer map (`QUESTION_EXPLICIT_ANSWERS`, label-normalized),
  checked before the generic patterns.
- **Enriched generic answer rules**: radios gain "No to both", "Not sure yet",
  "Stay at Same dose", "No hair loss yet" (plus "No" priority); checkboxes gain
  consent disclosures ("I understand…" always checked), "No history/symptoms",
  "No prior", "first time", "No chronic medical conditions", "Still have a full
  head of hair", and any "No …" negation.
- **Conditional follow-up texts** ("If yes, please…", "If \"Other\", please…")
  are auto-filled with "N/A" — they render visible even when the trigger answer
  is No/None, and were blocking Submit.
- **Missed required questions GLOW** (red pulsing outline, `.psa-q-missed`) and
  the handoff message names each one — no silent blanks. GLP-1 goal weight and
  refill file uploads (cannot auto-answer) glow + list for the pharmacist.
- **Skip path self-report**: the panel now says "Skipped N questionnaire(s)." or
  "No questionnaire appeared to skip — continuing." (plus `[PSA]` console log) —
  a 0-skip result is a real signal, not a silent pass.
- Live-verified E2E (Ying Zhang, Tesa/IPA ×3 + KLOW ×3): prefill answers every
  answerable question, exactly 1 unanswered (Tesa+IPA Combination goals — no None
  option) glows + is named; blank-Existing skip run reaches the Continue gate with
  no questionnaire and the transmit section set.
- Reference data committed: `rxflow-questionnaire-bank.md` (full harvest:
  API endpoints, drug-id map, 301-question coverage, answer policies) +
  `_smoketest/q-harvest*.json` / `q-drugids.json` / analysis files +
  `_smoketest/verify-psa-v20.js` (38-assertion harness).

## v1.29

De-duplicate the panel after the profile-check pass (Jeyson feedback: the strip at the
top repeated the queue cards below, and the bottom cards were the keeper). The always-
visible queue strip now HIDES while the queue stage (colored cards + summary) is showing
in the body, and re-appears on the input stage, during the profile-check pass, and during
run steps — where the strip's clickable rows are still the only row list on screen. No
logic changes.

## v1.28

Match-status visual pass on the panel (Jeyson feedback: hard to see which rows got a
match). Same colors the script already uses (green #27ae60 ok, red #c0392b error, amber
#e67e22 warning):

- Queue-stage rows are now tinted cards: green left-border + pale-green background when
  the row has a patient ID, amber when it needs review, gray otherwise.
- The patient ID renders as a green monospace BADGE (e.g. PAT123456789) next to the name
  instead of being buried in the label text; review warnings render in red/amber.
- The always-visible queue strip (top of the panel) gets a colored status DOT per row —
  green = has ID, amber = review, gray = unchecked — so match status is scannable even
  while a row is mid-run.
- The post-pass summary is split into colored blocks: green "N with profiles", red
  "N removed (no profile)" with names, amber "N kept for review".
- No logic changes — purely presentation. (v1.27's pass behavior is untouched.)

## v1.27

New batch-paste flow: the script now FIRST checks which pasted rows already have a
RxFlow profile, then clears the rows without one, and only then does the user click
Run. Details:

- After "Looks good — build row queue", the profile-check pass auto-starts (skippable via
  "Skip check"): each row without a patient ID is looked up on the Patients page via the
  dedicated search box, in order email -> phone -> name (all three are matched by the app's
  search; verified live 2026-08-04).
- Single unambiguous match -> the patient ID (first `.grid-item span` of the result row,
  e.g. PAT123456789) is appended to the row in the panel/queue and persisted to the row's
  patientId, so Run later searches by ID first. The row is also flagged existingPatient=TRUE
  (a found profile IS an existing patient — this fixes rows whose sheet "Existing RxFlow
  Patient" column is blank, which previously took the new-patient skip-questionnaire path).
- Zero matches -> the row is removed from the queue after the pass, with a visible summary
  listing every removed patient (nothing vanishes silently). 2+ matches, or a lone match
  that fails a phone/name sanity check, is kept and flagged "multiple matches — review
  manually" (R13: never auto-pick) — Run on those rows still offers the manual picker.
- Rows that already carry an ID from the sheet are skipped (an ID IS a profile).
- The pass persists as job step "profile-check" with per-row results, so navigation to
  /patients or a reload mid-pass resumes where it left off.
- Root cause hunt (live): every no-profile row first came back "multiple matches". The
  culprit was getSearchRows()'s table fallback — the page carries hidden <table>s that fire
  EXACTLY when a search returns zero rows (no Action buttons), turning a genuine "no
  profile" into one phantom match. The pass now counts rows with the strict Action-button-
  only variant (getSearchRows(false)). Search settling is a fixed 1.6s wait (the app
  filters in ~600ms, verified live) plus a fresh box re-locate per candidate; a 25s per-row
  timeout, a per-row catch, and an outer try/catch with a window.__psaTrace log make a
  silent pass stall impossible to hide.
- FIXED_HEADER_ORDER refreshed to the live sheet (Intake Link after Phone, Confirmed
  Shipping / Medical Action added, Patient State gone) so headerless pastes still map by
  position.

## v1.1

real-DOM fixes from a live session — correct Patients search box, div-based patient rows
(Action -> View Patient), case-insensitive matching (CREATE SALE), vue-multiselect caret fallback,
.selected-med-item-child cart lines, #questionnare-form detection, and Vue datepicker setDate()
for the transmit-later date.

## v1.2

debug fixes — require the dedicated Patients search box (no more false match on the
dashboard's hidden table) and click the Search button after typing (the list doesn't filter on
typing alone).

## v1.3

getSearchRows fix — walk past the small "Action View Patient" wrapper to the real
grid-content row, and run the Action-button heuristic BEFORE the (unrelated hidden table)
fallback so search matches resolve correctly.

## v1.4

openPatientRow fix — wait for the async Action dropdown to render its "View Patient"
button before clicking it (the script was looking too early and falling back to a no-op
row click, so the patient profile never opened).

## v1.5

openPatientRow fix #2 — the "View Patient" button exists hidden in the DOM even when
the dropdown is closed, so wait for it to be VISIBLE (offsetParent) after opening the Action
dropdown before clicking; clicking the hidden button was a silent no-op.

## v1.6

openPatientRow fix #3 — the dropdown swallows a plain el.click(), so dispatch a realistic
mouse sequence (pointer/mouse down+up+click) via realClick() for the Action and View Patient
buttons; verified live that this opens the patient profile.

## v1.7

The app requires a TRUSTED (real) click on "View Patient" to navigate — synthetic events
open the dropdown but are ignored, and a @grant none userscript can't make trusted events.
So after auto-search/match the script now opens the row's menu and hands that single click to
the user (a natural safety checkpoint), then resumes at the consent step on the profile page.

## v1.8

Same trusted-click rule applies to the source selection in Create Sale — selecting it
opens the sale form in a NEW TAB via window.open, which synthetic clicks can't do (popup
blocked). The script now opens the source dropdown and hands that one click to the user, then
resumes at the modules step when the sale form opens.

## v1.9

stepConsentCheck now WAITS for the async consent section to render before reading the
verified status — it was running at document-idle and showing everything as "unknown".

## v1.10

Removed the two manual handoffs entirely. Verified live that the app opens patient
profiles and sale forms via window.open, and that synthetic clicks DO fire the app's Vue
handlers — only the popup was being blocked. The script now hooks window.open, captures the
URL, and navigates the current tab via location.href (never popup-blocked). View Patient is
auto-clicked after the row menu opens; the source dropdown is force-opened via the Vue
instance (vm.isOpen = true) and "Dr. Example Phone Order" is auto-selected. Zero manual clicks.
Also hardened the UI: Reset() bumps a generation counter so an in-flight async step can't
overwrite the fresh panel, and stepConsentCheck refuses to render on the wrong page (waits
for /patient-details/ instead of showing a bogus "unknown" consent panel).

## v1.11

Quantity cap — the clinic only orders 3 of each peptide, so requested quantities are
clamped to 3 (sheet "6" -> 3) via MAX_PEPTIDE_QTY. goToProduct also re-locates the "+"
control fresh on every click (the cart line re-renders, so cached references go stale) and
skips a disabled "+" (the app locks it past the cap — seen live as disabled-qty-btn).
parseDateParts now accepts 2-digit years (the sheet ships "7/26/26" -> 2026-07-26).

## v1.12

Existing patients — the profile's height/weight (verified DOM: .show_common_pat
title/value pairs like "5'8\" (68)" / "225 lbs") are harvested on the patient-details page
and stored in the job. The questionnaire is a SINGLE adaptive form: which question groups
appear depends on the products in the cart (verified: KLOW/Tesa add healing+GH groups,
BPC/NAD+ add more), and every checkbox group has a "None of the above"/"No known allergies"
option plus Yes/No radios. The script prefills height/weight + safe defaults
(QUESTIONNAIRE_SAFE_OPTIONS) but NEVER submits — a human reviews every answer (and the
ship/pharmacy date) and clicks Submit, then presses Resume.

## v1.13

Gender is harvested too (profile .show_pat_content "Gender at Birth"). The pregnancy
question answers by gender: "Not Applicable" for male patients, "No" for female; if gender
is unknown it is left blank for the pharmacist. Safe radio patterns are also tried in
priority order so "Not Applicable"/"No active symptoms" win over a plain "No".

## v1.14

Messy clipboard pastes are now sanitized automatically — Mso/HTML comments
("<!--td {...}-->"), stray tags, and GHL markdown links ("[Name](url)" -> "Name") are
stripped before parsing. Since the sheet's column order never changes, headerless single-row
pastes are auto-mapped by position via FIXED_HEADER_ORDER/FIXED_HEADER_FIELDS — paste -> Run
with no manual column mapping.

## v1.15

When ALL consent items are checked (Terms and Conditions, Non-FDA Consent, Driver's
License Validated, Patient Verified) the script AUTO-PROCEEDS to Create Sale — no manual
click needed for fully-verified patients. The Override button remains for partial/unverified
cases, and Reset/Stop during the short pre-navigation delay still cancels the auto-proceed.

## v1.16

Gender-specific questionnaire questions (the ones with a "Not Applicable" option) are
now ONLY answered when the harvested gender is known: male -> "Not Applicable", female ->
"No". Unknown gender is left blank for the pharmacist — previously the generic safe-pattern
fallback picked "Not Applicable" for unknown-gender patients, which is wrong if they are
actually female (caught live on an unreported-gender patient).

## v1.17

Height/weight are now waited-for and reliably filled from the profile (a
progressive-render race made them silently skip before); if the profile lacks them the
script pauses so the pharmacist can enter them (the questionnaire can't be completed
without them).

## v1.18

The questionnaire is NEVER auto-submitted. After prefilling height/weight + safe
defaults the script sets the ship date immediately (the pharmacy ship date can be entered
before the questionnaire is submitted), then hands off — the pharmacist reviews the filled
questionnaire, clicks Submit, and presses Resume to reach the final "Click Continue" gate.

## v1.19

The ship date is set in ALL cases (verified live that the transmit section renders
before the questionnaire is submitted), including when height/weight are missing — it is
never deferred to after the handoff.

## v1.20

THIS SITE RENDERS EVERYTHING ASYNCHRONOUSLY — every value is provisional until it
loads. (1) The profile's height/weight/gender show placeholders ("Non Reported", "--") first
then the real values later, so the harvest now WAITS for real data instead of capturing the
placeholder (caught live: Patient Name harvested as "Non Reported"/no weight/"--" but the
profile actually has 6'3"/195 lbs/Male). (2) The medication-type buttons load async too
(only "Services" at 8s, "Peptide"/"GLP1" appeared at ~9s), so the default waitForByText
timeout was raised 8s -> 20s.

## v1.21

Running a row from anywhere in the app now AUTO-NAVIGATES to the Patients page — the
job is already saved at step "search", so the search resumes on the Patients page load
(previously the user had to click Patients themselves).

## v1.22

New patients (blank "Existing Prescriber Patient") get the questionnaire SKIPPED
automatically — the script now waits for the "Skip Questionnaire" button to render
(async site) and clicks it, so the user never has to check or click it themselves.

## v1.23

Fixed the skip — the questionnaire only pops up AFTER a peptide is added and
renders async, so it can be absent when the skip runs. resolveQuestionnaires now WAITS
for it to appear (it always will, since a peptide was just added), clicks "Skip
Questionnaire", and keeps clicking follow-ups until none return (previously it bailed
early when the form wasn't present yet, leaving the questionnaire stuck on screen).

## v1.24

The panel is now draggable by its header — drag it anywhere (position is saved
across page loads, since the panel re-renders on every page); a plain click on the title
still collapses/expands it.

## v1.25

Fixed manual navigation — the window.open interceptor (v1.10) suppressed EVERY
popup to /patient-details/ or /patient-sales, so manually opening a new tab to another
patient (or a sale form) was silently swallowed. The interceptor now only captures
navigation while the automation itself is driving a click (inside clickAndFollowNav);
manual window.open calls pass through untouched and open new tabs normally.

## v1.26

The row queue is now persistent and ALWAYS visible. Pasted rows are saved to
localStorage (`psa-row-queue`) and rendered as a compact strip at the top of the
panel, OUTSIDE `#psa-body` — so every step render (and page navigation across
patients -> profile -> sale form) keeps every queued row clickable at all times: on
the input stage, mid-flow, and on the final "Click Continue" gate. Clicking any
row's Run starts that patient fresh from search (the epoch guard abandons any
in-flight step for the old job), so a hung intermediate step no longer forces
Reset + re-paste to switch patients. The strip highlights the active row and
carries a "✕ clear queue" button; Reset now clears only the active job, not the
queue.

