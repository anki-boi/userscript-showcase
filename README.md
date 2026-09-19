# userscript-showcase

**40 production Tampermonkey scripts that delete manual work from a live US telehealth
clinic's back office** — Zoho CRM admin, pharmacy-portal sessions, order entry, carrier
tracking, patient-data handoffs, and SMS/PDF workflows.

Every script here exists because a specific workflow was slow, error-prone, or silently
wrong. **[PROBLEMS.md](PROBLEMS.md) documents the pain point behind each one**, what the
manual process cost, and what it saves — with an explicitly stated estimate basis so you
can check or falsify the numbers.

> Identifiers in this mirror are scrubbed (vendor names, portal hosts, pharmacy names and
> sample patient data are replaced with generic placeholders). The real suite runs in
> production against live systems — this is the public, reviewable view.

---

## What was actually wrong

| The problem | What it cost | The fix | Time saved |
|---|---|---|---|
| One order meant re-typing the same patient data into whichever pharmacy portal the order needed | ~6 min/order, plus a wrong-vial-size and wrong-patient risk on every step | CRM extracts a normalized payload → portal driver autofills the whole sale, stopping one click short of Submit | **~6 min → ~40 s per order** |
| Shipments were tracked one at a time: find the number, copy it, paste it into a sheet | ~2 min/order, ~20 shipments/day | Sheet-driven bus: parse rows → auto-open UPS/FedEx → extract Date Shipped + Tracking # → write back | **~6 h/week** |
| Patient replies (SMS, portal, email) were written from a cold start with the thread open in another window | ~2 min/reply | Thread harvested from the live page → AI draft → paste | **~14 h/month** |
| Patient status checks were 4-tab manual clicks; CRM context lived in another tab | ~1 min/check | Inline status panel + one-click CRM/thread extraction | **~1 min, 4 tabs → 1 click** |
| Pharmacy logins re-authenticated by hand, mid-task | dead-end reloads that silently stopped work | Portal session driver that re-establishes entry when the handoff bounces | eliminated dead ends |
| Addresses with mismatched ZIP/city/state reached the pharmacy and bounced the order | a full re-submit per bounce | Address validator on the CRM contact record | prevented, not optimised |

Roll-up: **~15–20 manual actions removed per order**, and an estimated **~40–60 h/month**
returned. Details, per-script breakdown and the estimate basis: **[PROBLEMS.md](PROBLEMS.md)**.

## Why 40 scripts instead of one big extension

The sites these scripts run on **change their DOM constantly** — a selector that worked
last month points at nothing this month. Maintenance is the steady state, not an event,
so the design optimises for *editing one script*, not for packaging:

- **One bad selector can't take down every workflow.** A patch for a carrier layout change
  can't break patient messaging, because they are different files.
- **Every fix is a one-file change.** Version bump, reload, done — instead of rebuilding
  and re-verifying a monolith.
- **Blast radius scales with the fix, not with the codebase.**
- **A coworker can install only what their role needs.**

Visual consistency — the thing a monolith would normally buy you — is instead delivered
by a shared token-based design system (`--ds-*` CSS variables, see [`DESIGN.md`](DESIGN.md))
that every script opts into. Module boundaries and a coherent UI are not a trade-off here.

The result is a collection of **independently deployable, independently failing units.**

## What's inside

| Area | Scripts |
|---|---|
| **Flagship automation** | Tracking Bus (all-in-one order/ship-date tracker: fetch → extract → sweep → write-back), RxFlow Sale Automator (paste → map → auto-fill → consent → submit), Cross-Platform Contact Toolkit |
| **Portal session handling** | Auto-login + order status extraction across multiple pharmacy portals, patient profile autofill, lab profile autofill |
| **Zoho CRM** | Context extractor, address validator, patient quick-copy, peptide SMS templates, task due-date menus, care-plan auto-jump, text highlighter |
| **Tracking copiers** | UPS / FedEx / EasyPost — auto-copy "Date Shipped + Tracking #" from carrier pages |
| **AI reply + context** | Gmail / RingCentral / Patient Connect reply assistants; GHL + Zoho context extractors |
| **Agent APIs** | Gmail, Slack, RingCentral and Patient Connect exposed as read/list/search/compose APIs for unattended agent work |
| **Productivity** | GLP-1 dosing calculator, product quick-nav, template menus, Sheets clipboard cleaner, "select text inside a link" |

## Design philosophy

- **Every script is one job.** See above — the modularity is the safety model.
- **Few moving parts per script** — plain DOM + a handful of GM APIs; no frameworks, no
  build step, no runtime deps.
- **Human-in-the-loop where it matters** — every destructive or ambiguous step (a sheet
  write, a patient consent gate, a form submit, a multi-match patient lookup) is either
  previewed first or left to one trusted user action. A patient search returning two or
  more matches **stops for a human, always**.
- **Zero-config for coworkers** — credentials and state live in per-user Tampermonkey
  storage, set once, never in source.
- **Trusted-click limits respected** — synthetic events are used only where the target UI
  accepts them; the suite's failure history is distilled into rules enforced by the gate.

## Quality gate

[`_smoketest/verify-all.js`](_smoketest/verify-all.js) runs on every change: per-file
syntax check, userscript header discipline, hardcoded-secret scan, boot-log/version sync,
empty-catch surface, author attribution and git drift. Exit 0 = shippable.

It exists because every check it performs once cost real time when it silently failed —
and because nobody catches a selector regression by reading a diff.

## Design system

All panels share the **Warm Paper** design system — a warm, paper-toned token set
(`--ds-*` CSS variables, see [`DESIGN.md`](DESIGN.md) and [`panel-design.css`](panel-design.css))
that keeps 40 injected UIs visually consistent with each other and with the pages they
live on.

## Dev tooling

- `cdp-eval.mjs` — drive a live Chrome tab (CDP port 9222) with `Runtime.evaluate` for
  probes and install flows
- `cdp-input.mjs` — send *trusted* keyboard/mouse input via the CDP Input domain (for UIs
  that ignore synthetic events)

## Install (for local use)

1. Install Tampermonkey in your browser.
2. Open the raw `.user.js` file — Tampermonkey intercepts it and offers to install.
3. Set per-user credentials via the script's menu command where prompted.

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Jeyson Dagondon.
