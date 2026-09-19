# Problems this suite solves

Every script in this repository exists because a specific piece of work was slow,
error-prone, or **silently wrong**. This file lists the pain point behind each one,
what the manual workflow actually looked like, what replaced it, and what it saves.

The scripts are a *consequence* of the problems, not the interesting part. Read this
file to judge the systems thinking; read the `.user.js` files to judge the code.

---

## How to read the numbers

> **Every time figure here is an order-of-magnitude estimate, not a measurement.**
>
> Volume basis used throughout: **~20 order/patient touches per working day × 21
> working days = ~420 touches/month.** Change that one number and every monthly
> figure scales linearly. Per-task figures (the "~4 min/order" part) come from the
> before/after step counts in each script's changelog history, not from a stopwatch.
>
> They are deliberately conservative and intentionally easy to falsify. Where a
> number would be a guess dressed up as precision, the entry says so.

---

## 1. The order pipeline — the expensive one

This is where the hours were. A single order used to mean: read a sheet row, open a
pharmacy portal, log in, search for the patient, create or match them, pick the
product through four cascading menus, answer a questionnaire, set a ship date, then
write the tracking number back. Every step was a chance to pick the wrong patient or
the wrong vial size.

| Script | The pain | What it replaced | Impact |
|---|---|---|---|
| **RxFlow Sale Automator** | A multi-step sale re-typed by hand, every time | Paste one CSV/JSON row → auto patient lookup → consent gate → sale creation → product/quantity entry → questionnaire → ship date, stopping one click short of Submit | **~6 min → ~40 s per order.** ~420 orders/mo ≈ **38 h/mo** returned |
| **CC Custom Build — Zoho CRM Patient Data Extractor** | The same patient data re-typed into whichever compounding-pharmacy portal the order needed | One click extracts the CRM record and hands a normalized payload to the right portal driver | Removes the biggest re-typing surface in the clinic; ~2 min/order ≈ **14 h/mo** |
| **LifeFile Order Autofill** | Step-1 form + patient search-or-create filled by hand on every order | One-click autofill, patient search-or-create, missing-field glow | ~3 min/order ≈ **21 h/mo** |
| **LifeFile Portal Session Handler** | Logging into the portal by hand, repeatedly, and losing the session mid-task | Drives the portal session, holds the login, re-establishes entry when the portal bounces the handoff | ~1 min/order plus eliminated dead-end reloads |
| **Product Quick Nav** | Four cascading clicks to reach one product, every product, every order | Quick-pick bar auto-clicks medication type → category → eRx tab → product | ~45 s/order ≈ **5 h/mo** |
| **Template Menu** | Order confirmations, dosing text and stack breakdowns re-typed from memory or scrolled for in an old note | Cascading insert menu with live preview, search and recent-tracking; pharmacy-specific branches | ~2 min/order ≈ **14 h/mo** |
| **GLP-1 Dosing Calculator** | Titration math done in the head or on a calculator, per order | Auto-calculates GLP-1 block dosing in total-dose and duration modes | Eliminates a class of arithmetic error; ~1 min/order |
| **GLP-1 PDF Saver** | Manually saving and filing the order PDF from the portal | One-click PDF save from the portal page | ~30 s/order |
| **Zoho CRM — Subject Template Branching Menu** | Retyping order/lab subject lines into CRM records | Click the subject label → pick from a branching list | ~20 s/record |
| **Zoho CRM — Address Validator** | Bad ZIP/city/state combos reaching the pharmacy and bouncing the order | Validates ZIP ↔ city ↔ state and street shape on the contact record | Every bounce costs a full re-submit; prevented, not optimised |
| **Sheets TN Clipboard Cleaner** | Pasted tracking numbers arriving wrapped in TSV quotes, needing scrubbing | Strips the quote-wrapping on paste | Small, but it broke a downstream parser every single time |

**The safety rule that mattered more than the speed:** when a patient lookup returns
two or more matches, the automator **refuses to choose** and stops for a human. One
match proceeds; zero matches falls through to create-or-retry. Picking the wrong
patient means medicating the wrong person, so that step is not automatable by design.
Same for the questionnaire: it is *never* auto-submitted — it is prefilled and handed
to a pharmacist.

---

## 2. Tracking — the daily grind

| Script | The pain | What it replaced | Impact |
|---|---|---|---|
| **Tracking Bus (All-in-One)** | Every shipped order needed its tracking number found, then copied back into a sheet, one at a time | Fetches blank ship-days from the sheet, parses the rows, auto-opens UPS/FedEx, extracts Date Shipped + Tracking #, writes them back | **~2 min/order → ~15 s.** ~20 shipments/day ≈ **6 h/wk** |
| **Tracking Swiss Army Knife** | Carrier pages give you a status, not the timeline you actually need to answer "where is my package" | Paste tracking numbers → full timelines fetched → copy-ready updates | ~2 min per patient enquiry |
| **UPS Tracking Copier** | Selecting and copying a tracking number from a UPS page by hand | Auto-copies Date Shipped + Tracking # | ~30 s/order |
| **FedEx Tracking Copier** | Same, on FedEx — including the ship/label date buried in the label block | Auto-copies tracking number + ship/label date | ~30 s/order |
| **EasyPost Tracking Copier** | Same, on EasyPost | Auto-copies tracking details | ~30 s/order |
| **LifeFile Order Status Extractor** | Clicking through portal order pages to read status, then retyping it | Reads status straight off the portal page and surfaces it | ~1 min/order |
| **Cross-Platform Contact Toolkit** | "Has this patient ordered from this pharmacy before?" required opening the portal and searching | Unified toolbar: copy name+link, cross-platform search, one-click order check from any platform | ~2 min per check, several checks a day |

The three carrier copiers are small on purpose. They are one job each, and each one
replaced a handful of manual selections per order. Nine such micro-scripts across a
400-order month is thousands of avoided micro-actions — which is where the "deathly
allergic to manual, repetitive workflows" part actually shows up.

---

## 3. Context — not losing the plot between systems

The clinic runs on a CRM, a patient portal, a phone system, a shared inbox and Slack.
The information a coworker needs to answer a patient is always split across all five.

| Script | The pain | What it replaced | Impact |
|---|---|---|---|
| **Zoho CRM Context Extractor** | Rebuilding a patient's story by opening Notes, Care Plans, Comm Logs and Attachments one by one | One click extracts all of it | ~5 min per handoff or escalation |
| **GHL Conversation Context Extractor** | Scrolling an entire SMS/call/email thread to understand what happened | One-click extraction of SMS, calls, transcripts and emails to XML/JSON | ~5 min per thread review |
| **Gmail AI Reply Assistant** | Writing a reply from a cold start, with the thread context in another window | Harvests the thread and drafts a reply to paste in | ~2 min/reply ≈ **14 h/mo** |
| **RingCentral AI Reply Assistant** | Same, for SMS | Harvests the SMS conversation and drafts a reply | ~2 min/reply |
| **Patient Connect AI Reply Assistant** | Same, for the patient portal inbox | Harvests the portal thread and drafts a reply | ~2 min/reply |
| **Patient Timezone — Zoho + GHL** | Dosing schedules and "when should I take it" calls, without knowing the patient's local time | Denver offset + patient local time, copy/paste timezone between Zoho and GHL | Prevents a recurring class of wrong-dosing-time advice |
| **ChatGPT Context Degradation Meter** | Long agent sessions quietly degrading with no signal that context was full | Context-fill bar next to the model selector; hover for numbers | Removed a whole category of "why is the model worse now" debugging |

---

## 4. Machine-readable systems — giving the agent eyes

These four turn point-and-click web apps into APIs the agent can read. They exist
because the alternative was a human opening a tab and reading it out loud.

| Script | The pain | What it replaced | Impact |
|---|---|---|---|
| **Gmail API Automation** | An agent that can't read the shared inbox | list / search / read / compose / send / templates / unread | Unblocks unattended email triage |
| **Slack API Automation** | An agent that can't read the team channel | list / read / search / compose | Unblocks unattended status reporting |
| **RingCentral API Automation** | An agent that can't read SMS | list / read / search / staged send | Unblocks unattended SMS context |
| **Patient Connect API Automation** | An agent that can't read patient-portal conversations | list / read conversations | Unblocks unattended patient-context lookup |

Each one is small because each one is *one* system. Staged sends and read-only reads
by default mean the agent can gather context without a human gate, and only writes
route through one.

---

## 5. Small frictions worth killing anyway

| Script | The pain | What it replaced |
|---|---|---|
| **Zoho CRM Patient Quick Copy** | Hunting for a phone number or address inside a CRM record, then selecting it carefully | Always-visible phone + address pills in the top panel; click to copy. Also carries the address/ZIP validation |
| **Zoho CRM Auto-Expand Textareas on Focus** | Reading and editing notes through a four-line letterbox | Auto-expands textareas to full content height on focus |
| **Zoho CRM - Auto-Jump to Care Plan** | Scrolling to find the Care Plan section on every patient | Auto-scrolls once it binds to the current patient |
| **Zoho CRM Text Highlighter** | Re-scanning a wall of CRM text for the two fields that matter | Persistent text highlighting with no checkbox to remember |
| **Zoho Task Due Date Quick-Set (Inline)** | Counting days forward by hand to set a due date | Inline button: set N days/weeks ahead |
| **Zoho Task Update + Due Date Branching Menu** | Two menu hunts per task update, plus typing the same update text again | Task Update and Set Due Date as branching menus on the task popover |
| **Zoho CRM — Peptide SMS Templates** | Every SMS hand-written and per-pharmacy customised; mixed-pharmacy orders need a different body, shipping line and dosing format | Template library with per-pharmacy flavors, auto-selected from cart contents | ~3 min/SMS ≈ **21 h/mo** |
| **LabX Lab Profile Autofill** | Retyping a lab profile from the CRM into the lab portal | Passive autofill from the CRM lab intent; missing required fields glow | ~2 min/order |
| **RxFlow Lab Profile Autofill** | Same, for a second lab portal (near-identical bug surface, separate script) | Same pattern, one-shot and passive | ~2 min/order |
| **RingCentral - Guard SMS Delete** | One mis-click in a 3-dot menu permanently deletes a patient conversation | Confirm-gates (or hides) the per-conversation Delete | Prevents an unrecoverable loss |
| **Select text inside a link like Opera** | Links swallow the drag, so you can't select the text inside them | Disables link dragging globally | Seconds, dozens of times a day |

---

## 6. Why 40 scripts instead of one extension

This is the architectural decision behind the whole repository, and it is deliberate.

**These sites change their DOM constantly.** A selector that worked last month points
at nothing this month. That means maintenance is not an occasional event here — it is
the steady state. The design has to optimise for *editing a script*, not for packaging.

Consolidating into one extension or one mega-userscript would mean:

- **One bad selector takes down every workflow at once.** A patch for a FedEx layout
  change would risk breaking patient messaging. Separately, a broken tracking copier
  breaks tracking and nothing else.
- **Every maintenance edit becomes a full-suite redeploy.** With 40 scripts, a fix is
  a version bump on one file and one reload. With a monolith it is a rebuild, a
  reinstall, and a re-verification of everything.
- **Blast radius scales with the file, not the fix.** Isolation is the only thing
  keeping routine selector churn cheap.
- **Onboarding a coworker becomes all-or-nothing.** Per-script installs mean a new
  hire can take the two scripts their role needs.
- **The shared panel design survives anyway.** The consistency a monolith would give
  is delivered by a token-based design system (`--ds-*` CSS variables, see
  `DESIGN.md`) that every script opts into. Module boundaries and visual consistency
  are not a trade-off here.

The suite is therefore a **collection of independently deployable, independently
failing units** — each one a single job, each one replaceable without touching
anything else.

### Which is also why there's a gate

`_smoketest/verify-all.js` runs on every change: per-file syntax check, userscript
header discipline, hardcoded-secret scan, boot-log/version sync, empty-catch surface,
author attribution and git drift. Exit 0 means shippable.

The gate exists for the same reason the scripts are separate: nobody catches a
selector regression by reading a diff, so the machine has to.

---

## 7. What the failure history taught (and why the code looks the way it does)

Every rule in the suite's internal best-practices guide was earned by a real incident.
The short version:

| Lesson | What it cost before it was a rule |
|---|---|
| **The DOM lies until proven otherwise.** These SPAs render placeholders, then real values. | A patient was harvested as "Non Reported" when the record actually said 6'3" / 195 lbs / Male. A script that reads early doesn't fail — it harvests garbage confidently. |
| **Checkbox state is not the field value.** The app's own handler writes the field validation reads. | An allergies checkbox visibly reverted ~2.5 s after being set, and submit bounced with "allergies description is required" — the checkbox was only a UI toggle. |
| **Synthetic clicks are not trusted; hook `window.open` instead.** | Three separate attempts at synthetic navigation were silently ignored before the working pattern — capture the URL, navigate the current tab — was found. |
| **Never click a hidden element.** The control exists in the DOM while its menu is closed. | Clicks that "succeeded" and did nothing, repeatedly, with no error. |
| **Guard async races.** Reset must not be overwritten by an in-flight step. | A stale step could repaint a fresh panel with old results. |
| **Sanitize paste before parsing.** | Clipboard paste carried Mso/HTML comments, stray tags and markdown links into the parser. |
| **Respect human stop points.** | Destructive and ambiguous steps are previewed or handed to one trusted click, never auto-fired. |
| **Credentials never live in source.** | A portal password was hardcoded and printed into a design doc. Now per-user storage only, and the build **fails** if a secret pattern survives. |
| **Version bumps are the proof of deploy.** | Tampermonkey runs new code only after a reload — without a bump you cannot tell a failed deploy from a fixed bug. |

This is the part that took the most time, and it is the part that does not show up in
a feature list: **the scripts are not written to work, they are written to fail
loudly, early, and in one place.**

---

## 8. Consolidated impact

| | |
|---|---|
| Manual actions removed per order | ~15–20 |
| Estimated time returned | **~40–60 h/month** across ordering, tracking, templates and messaging |
| Re-typing surfaces eliminated | Patient demographics, addresses, products, dosing, tracking numbers, subject lines |
| Classes of error designed out | Wrong-patient selection, wrong vial size, bad ZIP/state, dose arithmetic, premature questionnaire submit, accidental conversation deletion |
| Scripts that can fail without taking down the suite | All 40 |
