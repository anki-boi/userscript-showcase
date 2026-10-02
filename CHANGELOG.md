# RxFlow Sale Automator — changelog

Moved out of the script's `@description` header on 2026-08-03 so the Tampermonkey metadata stays a one-liner. The `@version` header is the source of truth for the current version; this file is the history.

## Current

Paste a CSV or JSON order row, confirm the column mapping, then auto-drive patient lookup -> consent gate (with the pharmacy-routing advisory) -> sale creation -> product/quantity entry -> questionnaire AUTOFILL (never skipped — the script fills it and a human submits) -> ship-date entry, stopping right before Continue is clicked (Continue itself is the last automated action; provider selection is out of scope).

---

## v2.34 — the trigger moved beside the search box, glyph-only, and it is now actually visible

Jeyson 2026-10-02: *"can we just put rxflow sale automator as a button besides the
search button? Also the font color is quite faint. It's hard to find. … Left side of the
search please."* then *"Just remove the text from the button. Just keep the cart icon."*

**The real cause of "hard to find" was not the colour.** Measured live: the site sets the
navbar's LEFT `ul.navbar-nav` to `display: none` at wide widths — the v2.27 dock measured
**0×0 at a 1083px viewport**. The button was invisible on a normal desktop and only appeared
once the window got narrow. A faint grey label on a dock nobody can see.

**New dock:** the navbar's **search row** (`div.row` holding `.search-col`), as its FIRST
item — a cart-icon button immediately left of the search magnifier. Measured: chip `271,16`
with the search button at `308` (1083px), `51,16` / `93` (805px), `51,20` (259px). The row is
present and visible at every width and sits outside the Vue router-view, so a content
re-render never takes the button with it. The left-ul dock stays as a fallback for routes
with no search row.

**Glyph-only, solid fill:** `🛒` on the site's own brand colour (`var(--primary-color)`,
`#c9a227`) with dark ink and a 1px ring; each state repaints the FILL (running = warn, done =
success, needs-you / blocked = danger) because there is no text left to colour. The state word
lives in the `title` tooltip. The old `@media (max-width: 767.98px)` label-collapse rule is
gone — there is no label to collapse.

**Cost, measured and accepted:** that row has only ~20px of slack (search 223 + filter 54 +
clocks 487 inside a 784px row) and the clock cells cannot shrink below their min-content, so
ANY chip — even a 29px one — wraps the timezone clock row onto a second navbar line (nav
height 72 → 110 at 1083px). Tried and rejected: the chip inside `.input-group` (the search
input wraps to a second line), inside `.search-col` (overlaps the magnifier), and `flex`
overrides on `.clocks-col` (no effect — min-content floor). The clocks stay fully readable,
just below the search.

Proof: `verify-psa-trigger.js` 21 asserts (search-row anchor, leftmost insert, fallback kept,
glyph-only, solid fill, state-as-fill, no leftover label rule) + `verify-psa-trigger-live.mjs`
**27/27 live** — docked, first in row, left of the search button, glyph-only, solid fill,
hit-testable, visible at desktop width, panel hidden at boot, all three exits, inside-click
immunity, `api.trigger(start-row)` still refuses on an empty queue, and the chip survives
1191 / 900 / 768 / 677 / 568 / 503 / 459 / 350 / 300px. (The harness's overlap test had to
become 2D: the wrapped clock row spans the full row width on the line below, so an x-only test
reports a phantom overlap.)

---

## v2.33 — LIVE CATALOG SWEEP + fuzzy peptide mapping + a name chooser

Jeyson 2026-10-02: *"it doesnt properly map to the right peptides because the website has
pretty shitty naming system. Please pipe them up together and when the time comes where the
peptide names drift, the script should ask me to choose which peptide I am talking about, so
that means it must have a extract sweep of the peptides in the list so we can fuzzy match."*

**The hardcoded catalog was already wrong.** A live sweep of the picker proved it (plan:
`plans/2026-10-02_psa-peptide-catalog-mapping.md`): **79 live products vs 26 hardcoded** —
`Fat Loss` and `Fat Loss / Growth Hormone` are EMPTY, so the aliases `tesa` and `tesa/ipa`
named products the site no longer sells; `[STK] GHK-Cu`, `[STK] BPC-157 injectable`,
`[STK] CJC/Ipamorelin`, `[STK] NAD+` and the whole **GLP1** med type (52 products) were
invisible to the script; and `[GRE]`/`[STK]` sell the same name (BPC-157 injectable,
CJC/Ipamorelin, NAD+) while the sheet cannot say which brand.

1. **`sweepLiveCatalog()`** walks the picker the way `goToProduct` already drives it —
   `#medications-list .btn` → `.med-item` → OTC/eRx/Subscription tab →
   `.filtered-items .cursor-class.text-break.font-weight-bold` — and caches
   `{ts, rows}` in `localStorage['psa-live-catalog']`. It never touches Continue, so it
   cannot save a sale (Jeyson: "it only creates a draft after pressing Continue").
   **Trap found live:** the picker renders progressively — at boot only "Services" is
   present, and sweeping then records an EMPTY catalog. The sweep now waits for the
   med-type row to stop growing.
2. **The sweep is the candidate pool** (`catalogPool()`); the hardcoded `CATALOG` is the
   fallback when no sweep exists yet (a cold sweep must not disable matching).
   `goToProduct` now takes the swept **tab** instead of assuming `eRx`.
3. **Fuzzy match** (`fuzzyResolve`): brand tag and form words dropped, doses KEPT as
   tokens (0.5 mg and 1 mg are different products), token exact/prefix/bigram scoring,
   brand and form hints applied. Auto-pick only when the winner clears **0.72** and beats
   the runner-up by **0.12**; a curated `PRODUCT_ALIASES` entry is never overridden.
4. **A name that is not clearly decided is ASKED** — `renderAmbiguousChooser` shows the
   sheet text plus ranked candidates (`Peptides › Healing › eRx · [STK] BPC-157 injectable
   (1)`). Picking one **learns** it (`localStorage['psa-learned-aliases']`) and adds it;
   "None of these" keeps the old manual hand-off. This replaces a dead end with a loop
   that converges.
5. **Drift report** on every sweep: `Live catalog swept: 79 products — drift vs the
   built-in list: 4 gone, 54 new`.

Verification: new `_smoketest/verify-psa-catalog.js` **44 asserts** on the real swept
catalog (`tests/fixtures/rxflow-catalog-live.json`) — incl. the regression guard
that a drifted shorthand cannot silently add a different peptide — and
`_smoketest/verify-psa-catalog-live.mjs` **11/11 live** (79 products, [STK] products
present, Tesamorelin absent, GLP1 swept). `verify-psa-v20.js` needed its synthetic sandbox
extended for the two new resolver dependencies.

## v2.31

**No proper match = no row** (2026-10-02, Jeyson: *"if there is no proper match,
still remove the row"*).

- The sweep now **removes** a row whose lookup came back `ambiguous` — the search
  returned rows that are **not** this patient — exactly like `not-found`.
  Previously those rows stayed in the queue flagged *"multiple matches — review
  manually"* (R13, v1.27). They are now listed in their own summary line:
  **🗑 N removed (the search returned a different patient)**.
- **Two cases are still kept, deliberately — they are not match verdicts, the
  check never ran:**
  - `error` — the app never sent the search request. Removing here would let one
    broken/stale Patients page wipe the entire queue in a single sweep.
  - `no-identifier` — no Patient ID, phone, or full name to search: a sheet-data
    problem worth seeing rather than silently dropping.
  Both are a one-line change away from removal.
- The **Run** path is unchanged: a single row that fails verification is still
  refused and offered as a click-to-confirm button. Only the sweep's queue action
  changed.
- Live: `_smoketest/verify-psa-lookup-live.mjs` **27/27 PASS** — C (a row the
  search could not match) and E (the real `Emiliano Sampleperson` sheet row) now both
  assert the row is **removed**.

---

## v2.30

**Patient lookup: prove the search ran, and stop trusting what it returns**
(2026-10-02, Jeyson: *"I've been getting mistakes in sending because some
patients have similar names and the search function there somehow shows one name
which is not an exact match and it ends up with me accidentally sending to the
wrong patient … rxflow sale automator latches on to any result that only
outputs one row. it trusts rxflow search function way too much"* and
*"for the patient sweep search, I would need to click the patients tab first in
order to make the sweep reliably latch on to the search function there"*).

### The bug, reproduced on the real queue

The `Current Orders` sheet row `Emiliano Sampleperson` (no RxFlow Patient ID)
was looked up through the Patients search. Measured live
(`_smoketest/probe-psa-lookup.mjs`):

| query | rows | what came back |
|---|---|---|
| `PAT123456789` | 1 | Lara Sampleperson — an exact ID hit |
| `Emiliano Sampleperson` | 0 | no profile (he is pending intake) |
| **`Sampleperson`** | **1** | **PAT123456789 · Lara Sampleperson · 1970-01-01** — a different patient |
| `Emiliano` | 0 | — |
| `patient@example.com` | 0 | **the search ignores email entirely** |
| `0000000000` (Lara's own number) | 1 | Lara Sampleperson |

The app's search is a **fuzzy substring** match, so a lone first or last name can
return exactly one stranger. The old rule was *"exactly one row = found"*, and its
only sanity check (`rowLooksLikePatient`) passed when **any** name token appeared
*anywhere* in the row text — so `Sampleperson` was "verified" by `Lara Sampleperson`,
and her profile was opened for his order. Downstream of that profile sits the
sale and the SMS.

Second, independent failure mode: on a page whose list was rendered but not
wired (reproduced after driving the tab through the sale URLs), typing +
clicking Search fired **no `patients-list?search=` request at all** and the list
kept its **10 unfiltered rows** for both a real query and `zzzzqqq`. The old code
counted those rows as the app's answer.

### Fixes

- **The app's own navigation.** The Patients list is now entered by clicking
  `aside.main-sidebar a.nav-link` **"Patients"** (the SPA router mounts the list
  with its search bound), with `location.href = "/patients"` kept only as the
  fallback when that link is absent. Used by both the Run path and the sweep.
- **Proof of search.** `runPatientsSearch()` types, clicks Search, and then
  **waits for the app's own `/api/patients-list` request carrying exactly the
  query it sent** (`performance.getEntriesByType('resource')` +
  `URLSearchParams.get('search')`). No request → `{ok:false}` → the lookup stops
  as an **error**; a row-count verdict is then impossible. A search that
  provably never ran can no longer be read as "no profile" (which used to
  *delete* a real patient's row from the queue).
- **Identity, not a row count.** Every returned row is parsed
  (`PAT id · name · DOB · phone`, action-button text stripped) and verified:
  - `psaNameVerdict` requires an **exact token-set match** against a **full
    first+last** expected name. A missing token (`Sampleperson`) **or** an extra one
    (`Lara` / a middle initial) is a different person until a human says otherwise.
  - `psaPhoneVerdict` matches the last 10 digits (country code and punctuation
    are free).
  - `psaVerifyCandidate`: an ID hit must match the ID **and** the name; a phone
    hit must match the phone **and** the name; a name hit must match the name
    **and** the phone when the sheet has one.
- **Single-token names are never searched.** `psaCandidateList` drops a name with
  fewer than two tokens — the exact input that produced the wrong patient.
- **Email is never used as a search key.** The Patients search ignores it, so
  searching it could only ever manufacture a false "no profile". A row whose only
  field is an email is now `no-identifier` (kept, flagged) instead of
  not-found (removed).
- **Human gate.** Ambiguous lookups render confirmation buttons showing
  `PAT id · name · DOB · phone` — never the scraped row text — and the profile
  opens only on that click. The sweep never opens a profile; it keeps the row
  flagged as `multiple matches — review manually (<reason>)`.
- **`not-found` is now reachable only** when every attempted search was *proven*
  and returned **no rows at all**.
- **R18/R19:** `start-row`'s early exits now set the API state
  (`waiting_human` / `error`) instead of leaving the run stuck at `running`, and a
  new `profile-check` action runs the same sweep the queue stage auto-runs.

### Verification

- `_smoketest/verify-psa-lookup.js` — 51 offline assertions (the Sampleperson/Lara
  regression, name/phone/row parsing, candidate refusal, decision rules).
- `_smoketest/probe-psa-lookup.mjs` — the live probe used to find the bug.
- `_smoketest/verify-psa-lookup-live.mjs` — **24/24 PASS** against the real site,
  driving the deployed script through its own API on a fresh dashboard tab:
  - **A** lone surname → **no search request is sent at all**, no navigation,
    `waiting_human`.
  - **B** full name + another patient's phone → the app returns Lara's single row
    → **refused** (`the result row is missing "emiliano"`), gated as
    `Open PAT123456789 · Lara Sampleperson · DOB 1970-01-01 · 0000000000`, no profile
    opened. Under the old rule this exact input auto-opened her profile.
  - **C** the sweep keeps the unconfirmable row with its review note instead of
    deleting it.
  - **D** positive control: a real patient ID still resolves and opens
    `/patient-details/351792`.

**Consequence:** a row that is not confirmed is **removed** from the queue —
whether the search found nothing (`not-found`) or found someone who is not this
patient (`ambiguous`, v2.31). `Emiliano Sampleperson` (pending intake, no profile) is
such a row. Rows are kept only when the check itself never ran.

---

## v2.27

**Trigger moved to the LEFT of the navbar + split-screen proof** (2026-10-02,
Jeyson: *"perhaps we should add the rxflow sale button next to the hamburger
icon on the left for this one"* and *"when the tabs are in split screen mode it
makes the UI very thin, make sure the button survives that"*).

- **Dock moved:** `nav.main-header ul.navbar-nav.ml-auto` (right, beside the
  notification bell) → **`nav.main-header > ul.navbar-nav:not(.ml-auto)`,
  immediately after the hamburger**. Measured: the left item sits at `x=16` at
  every width tested (860 → 250), while the right item drifts with the search box
  and the clock row (`x` 580 → 138) and was the side that clipped.
- **Split-screen measurements** (CDP `Emulation.setDeviceMetricsOverride`, live
  page, widths 860/768/677/568/503/459/350/300/250):
  - v2.26 docked RIGHT with a plain text label: **clipped at 677, 602, 503, 404,
    305, 259** — the navbar items shrink to ~30-48px below the host's 768px
    collapse and a 101-139px label overflows.
  - `flex: 0 0 auto` on the **`<a>`** does nothing: the flex item is the **`li`**.
    Moved to `.psa-trigger-item` (the li) — and the label is now its own span.
  - Final shape (left dock + li flex + label collapse ≤ 767.98px): **OK at every
    width** — item 30-48px glyph-only below 768, label fits inside the item, no
    overlap with the search box / clock row / bell, `elementFromPoint` hits it.
  - Below 768 the left ul becomes `display: block` and the items stack vertically
    (hamburger at `y=8`, ours at `y=54`) — still inside the navbar band, still
    clickable.
- **State survives the collapsed label:** the label span is hidden below 768px, so
  `renderTrigger()` also writes the state into `title` (`Sale Automator — running ·
  <message> …`) and the colour (amber/green/red).
- Gate: `_smoketest/verify-psa-trigger.js` 20 assertions (RED 6 → GREEN) and
  `_smoketest/verify-psa-trigger-live.mjs` extended with **7 split-screen widths**
  (23 checks, all PASS; one retry per width because the host can be mid-re-render
  of the navbar).

## v2.26

**Floating panel → inline navbar trigger** (2026-10-02, Jeyson's UI preference:
*"the floating button design choice is just not ideal and clogs up the UI so
fast"* — see `DESIGN.md` § Trigger contract and
`plans/2026-10-02_inline-panel-triggers.md`).

- The panel no longer appears at boot. `#psa-panel` is created **hidden**
  (`display:none` before it enters the DOM) and is summoned from
  **🛒 Sale Automator**, docked inline in the site's own top navbar
  (`nav.main-header ul.navbar-nav.ml-auto`, inserted as a native
  `li.nav-item > a.nav-link` left of the notification bell). Chosen because the
  navbar is the AdminLTE app shell: the topmost element on every authenticated
  route and OUTSIDE the Vue `router-view`, so content-area re-renders never take
  it. Verified live on `/dashboard`, `/patient-details/335341` and
  `/dashboard/PAT87498589/1036/0/patient-sales` — all three expose
  `nav.main-header` + `ul.navbar-nav.ml-auto`.
- **Three exits:** the panel's own `✕` (`#psa-close`), **Escape**, and a
  **capture-phase click anywhere outside it** (clicks inside the panel and on the
  trigger are exempt; the trigger toggles).
- **Hidden, never removed.** Every automation step writes into
  `panel.body` / `panel.status`, so `closePanel()` hides the node instead of
  removing it — closing the panel mid-job cannot break the flow. `api.trigger`
  (`continue` / `stop` / `reset`) still works on the hidden DOM.
- **State stays visible while closed:** `apiSet()` mirrors the job state onto the
  trigger — `🛒 Sale Automator` / `🛒 Running…` (amber) / `🛒 Needs you` (red) /
  `🛒 Done` (green) / `🛒 Blocked` (red).
- A **resumed job** (localStorage `psa-active-job`) and an **agent-started run**
  (`api.trigger('start-row')`) open the panel automatically.
- Re-dock: a debounced (250 ms trailing) `MutationObserver` re-inserts the button
  if Vue ever re-renders the nav list, and doubles as the boot wait for a navbar
  that has not rendered yet.
- Drag-to-position (v1.24) and the title-click collapse are unchanged — dragging
  is a convenience now, not the only way to get the panel out of the way.
- Gate: new `_smoketest/verify-psa-trigger.js` (14 source assertions; RED against
  v2.25 — 13 failures — GREEN against v2.26). `verify-psa-v20.js` no longer pins
  `@version 2.25` literally; it asserts `>= 2.26` so future bumps don't break it.

## v2.25

**`cjc` offers now carry Pharmacy A alongside Greenwich** (2026-10-01), because the extractor
(patient toolkit v1.1.4) does. `verify-psa-v20` enforces that the two copies of
`PHARMACY_OFFERS` share the same pharmacies per key — "shared PHARMACY_OFFERS keys match CC —
cjc: CC[Greenwich|Pharmacy A] vs PSA[Greenwich]" — so the two move together or the gate stops the
commit. CJC/IPA is not a RxFlow catalog product, so no sale can reach either entry; the row
exists to keep the matrix congruent.

## v2.24

**`PHARMACY_OFFERS` keys kept identical to the extractor's** (2026-10-01). Adding
`ldn` and `tesofensine` to the extractor (patient toolkit v1.1.3) tripped the
`verify-psa-v20` gate — "PSA knows every pharmacy-offering key CC routes — missing
ldn, tesofensine" — which is that gate doing its job: two copies of one matrix drift
silently unless something compares them.

- Added `ldn: ["Pharmacy G", "Pharmacy H"]` and `tesofensine: ["Pharmacy J"]`.
- Neither is a RxFlow catalog product (`componentForProduct` maps catalog products to
  keys, and neither appears in `PRODUCT_COMPONENTS`), so no RxFlow sale can reach these
  rows. They exist to keep the matrices congruent, which is what the gate checks.
- `verify-psa-v20.js`: 504 passed, 0 failed.

---

## v2.23

**The routing gate now keys on the SHIPPING address's state, not the patient's**
(2026-09-29, Jeyson: *"there are times where the patient's state is restricted
but the shipping address they gave is for a state which is not restricted at
all"*):

- v2.20-v2.22 harvested the profile header's `State :` row — the patient's
  **contact/billing** state — and the two disagree constantly. A patient in a
  restricted state who ships to family elsewhere was gated for nothing; one who
  ships INTO a restricted state from a free one was waved through.
- `shippingAddressStateFromProfile()` reads the `State` row **inside the Shipping
  Address section** of `#patient_details` (rows are matched with their section
  title — Contact Details and Shipping Address both carry an "Address line 1 /
  City / State / …" block, and an untagged read returned the contact one,
  live-caught). `job.state` is now that value and nothing else; the header state
  and the sheet's `Patient State` survive only as `job.stateHint`, printed in the
  "could not read the shipping state" warning so it is clear they were NOT used.
- The advisory header reads **"Pharmacy routing (ships to ND)"** so the verdict
  names the address it is about.
- `no-state` still warns without pausing; the pause (v2.22) now only ever fires
  on a shipping-address verdict.
- `api.stateRead()` exposes `{ shippingState, shippingStateRaw, contactState,
  used, source }` for agents and the live harness.
- Pinned in `_smoketest/verify-psa-v20.js`: the shipping read exists, `job.state`
  comes from it, `measurements.state` can never reach the verdict, and the hint
  is present.
- The Patient Toolkit's module 4 got the same fix (v1.1.2): its contact-state
  fallback is deleted and the address glow only marks the shipping State row.

---

## v2.22

**A gated row now pauses instead of walking past its own warning** (2026-09-29):

- The v2.20 routing advisory warns when the patient's state blocks the offering
  pharmacies — but `stepConsentCheck` auto-proceeded 1s after the four consent
  boxes were ticked, whatever the advisory said. A warning the flow outruns in a
  second is not a pause.
- `routingNeedsAttention(job.routing)` now skips the auto-proceed (partial /
  clinic / blocked). Nothing else changes: the same confirm button resumes the
  row, retitled **"Proceed anyway — routing gated"**, and the status line says
  what to do (fix the shipping address, then continue). Stop/Reset untouched.
- The advisory itself, the matrix and every other step are byte-identical.
- A `no-state` read (state unreadable) still only warns — that is a data gap,
  not a gate.
- Harness: `_smoketest/verify-psa-v20.js` repins the version header.
- The address work itself is NOT here — it lives in the Patient Toolkit's module
  4 (v1.1.0), standalone and job-independent, so a fully manual sale can use it.

---

## v2.21

Wolverine aliases, a ship-date value that no longer aborts the row, and a
previous-questionnaire report (2026-09-24):

- **Wolverine variants resolve.** The sheet writes "Wolverine Light" and
  "Wolverine injection"/"Inj" for the same product. The v2.19 name safety net
  could NOT save these: it strips at most ONE trailing form word
  (injectable/inj/capsules/solution), so "Wolverine injection" → "wolverine" and
  "Wolverine Light" → "wolverine light", neither of which equals the catalog
  name `[GRE] Wolverine 1`. Both fell through to the manual "unmapped" hand-off.
  Added explicit `PRODUCT_ALIASES` entries (`wolverine light`, `wolverine
  injection`, `wolverine inj`, `wolverine injectable`) → `[GRE] Wolverine 1`;
  they route as `wolverine` (Greenwich/Pharmacy A), which the harness pins too.
- **A non-date Desired Shipping Date no longer kills the row.** Live case,
  patient 351792: the column held the instruction **"hold-do not ship yet"**,
  `setTransmitLaterDate` treated the parse failure as fatal, and the row aborted
  BEFORE the questionnaire step — the panel just showed a date-parse complaint.
  A non-date value is an instruction for the pharmacist, not a malformed date:
  `shipDateIsInstruction()` detects it, `applyShipDateIfAny()` is now the SINGLE
  interpretation point (both former call sites route through it), it reports
  "Ship date is \"…\" (not a date) — left the transmit date alone for you;
  continuing" in amber, and the questionnaire / Continue gate still run. The
  script never invents a date. Harness asserts only ONE `setTransmitLaterDate`
  call site can exist, so no path can bypass this again.
- **Previous-questionnaire report (REPORT-ONLY).** Jeyson 2026-09-24: *"Autofill
  either way. Just let me know whether or not there was a previous
  questionnaire."* The consent panel now shows whether the patient already has a
  questionnaire on file — `Previous questionnaire: N on file` with each record's
  template name, status and date, or `NONE on file`. It changes NO behaviour:
  nothing branches on it, and the sale-form questionnaire is autofilled either
  way. It runs on the profile page (concurrently with the consent settle) via the
  app's own endpoints, found live on patient 351792:
  `GET /api/getPatientQuestionnaries/<id>` (paginated records: `template_id`,
  `answers`, `status`) and `GET /api/getFunnelQuestionnaireList` (template
  catalogue: 13667 Dr. Example Product Questionnaire / source 1036, 13666 Renewal /
  1029, 15527 Weborder / 1028). A FAILED check says "could not check (<reason>)"
  — it is never reported as "none on file", which would be a lie. The pure
  `parseQuestionnaireHistory()` is harness-covered for empty / real-shaped /
  missing-total / unparseable-answers / non-array / null bodies.
- **Correction recorded while investigating:** the sale-form questionnaire is a
  Vue `formRender` component (submit form id `questionnare-form`) rendered inside
  a MODAL, and the profile tabs carry only an empty `#funnelQuestionnaireFrame`
  iframe plus a `questionnaireSubmittionModal`. `#questionnare-form` therefore
  does not exist in the parent document outside the live sale form — worth
  knowing before trusting any presence check that looks for it by id.
- Harness: `_smoketest/verify-psa-v20.js` — 494 asserts.

---

## v2.20

Never skip the questionnaire + pharmacy-routing advisory (2026-09-24):

- **The questionnaire is NEVER skipped any more (Jeyson's rule).** The old flow
  branched on the sheet's "Existing RxFlow Patient" column: non-empty ->
  prefill + human submit, **blank -> click "Skip Questionnaire"**. Two things
  were wrong with that. (1) It cost a **45-second poll** to decide something it
  could simply observe, and reported `"No questionnaire appeared to skip"` when
  a button render was late. (2) Worse, it **discarded real questionnaires** —
  the skip path clicked Skip whenever the button appeared, and one Skip click
  REMOVES the form (verified 2026-08-06). The column was never the right signal:
  the sale-form questionnaire is fetched per-sale from the **cart's drug ids**,
  not from patient history. The script now checks whether
  `#questionnare-form` actually rendered and **always autofills it when it did**
  (`handleQuestionnaireStep` / `prefillSaleQuestionnaire` — one path for new
  patients, existing patients, and manual product entry). When no form renders
  within 15s it continues, which is a real answer, not a timeout guess. The
  `existingPatient` column is still parsed and still shown to the pharmacist as
  context; **nothing branches on it any more**. Net behaviour change to expect:
  new-patient sales now generate questionnaire records where they used to skip,
  and carts with unanswerable required fields (GLP-1 refill photo, cancer/
  autoimmune history groups) now stop and glow for the pharmacist instead of
  sailing past. The script still never auto-submits.
- **Auto-prefill on MANUAL ordering too.** With no job in localStorage the
  script used to sit idle, so a hand-built sale got no help at all. On the sale
  form it now watches for the questionnaire and fills it from the same answer
  bank (`startManualQuestionnaireAutofill`). Deliberately narrow: sale-form URL
  only, never a backgrounded tab, no submit / ship date / Continue gate (there
  is no job flow to resume), a latch so it cannot re-fill in a loop on every
  cart mutation, and an explicit "Re-scan the questionnaire" button.
- **Pharmacy-routing advisory — "does this even ship here?" before a pharmacy is
  picked.** New `routingReport()` renders into the consent panel (the last point
  before the sale is created, with the patient's state known) and warns when the
  clinic's availability matrix blocks the cart's route in the patient's state —
  the Greenwich/Pharmacy A case Jeyson asked about:
  `⚠ KLOW — nothing ships to NC direct · ship Greenwich to Heather (CO)`,
  `⛔ ... restricted in ND AND CO — no route`. Data is ported from the CC
  extractor (`RESTRICTION_MAP` / `PHARMACY_OFFERS` / `COMPONENT_FORMS` /
  `MED_RULES` / `SS31_PROGRESS_LICENSED`), so the same rules drive the Care Plan
  highlighting and the sale form. Advisory only — the pharmacy is chosen
  downstream (LifeFile), so it never blocks a row, and it records to
  `api.routing` rather than overwriting the step's own status. The patient state
  is harvested from the profile header's `State :` row (`.show_pat_content`
  pair — verified live; the sheet's Patient State column is gone), with the
  sheet value as a normalized fallback, and an unreadable state is REPORTED
  ("routing not checked"), never guessed.
- **Product -> component map is the PS side of the matrix**, so routing follows
  what the cart actually contains: a form word decides the BPC-157 split
  (`capsules -> Pill -> Pharmacy J` vs `injectable -> Pharmacy L/Greenwich`), and
  `Tesa/IPA` routes as the tesa-ipa blend (Pharmacy K) rather than plain tesa.
  Catalog products with **no** availability data (glutathione, DSIP, pinealon/
  semax, kisspeptin, PT-141, 5-Amino-1MQ, GHK-Cu/Epithalon, the AOD/MOTs-C/
  Tesamorelin combos) render `? ... no availability data` — never silently
  "shippable".
- Harness: `_smoketest/verify-psa-v20.js` gained a v2.20 section — 60+ asserts on
  the router (every status class, the form split, unreadable/unknown state,
  headline wording, and the `blocked` "no route" branch that must NOT say
  Heather) **plus a cross-script parity check that diffs RESTRICTION_MAP /
  PHARMACY_OFFERS / COMPONENT_FORMS / MED_RULES against the CC extractor**, so a
  matrix edit on one side can't silently drift from the other. 411 asserts.
- Live-verified 2026-09-24 against the real patient page (Andrew Robinson,
  NC): the profile harvest returned `state=NC, 5'11", 160 lbs, male` and the
  router rendered `ship Greenwich to Heather (CO)` for KLOW/Thymosin while
  Tesa-IPA/BPC capsules/NAD+ read as direct routes.

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

