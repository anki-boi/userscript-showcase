# userscript-showcase

**33 production Tampermonkey scripts automating clinical back-office work for a live US clinic** — Zoho CRM admin, pharmacy portal sessions, carrier tracking extraction, patient-data handoffs, and SMS/PDF workflows. Zero-config for non-technical coworkers, human-in-the-loop by design, and gated by a repo-wide quality harness.

> Identifiers in this mirror are scrubbed (vendor names, portal hosts, and sample
> patient data are replaced with generic placeholders). The real suite runs in
> production against live systems — this is the public, reviewable view.

## What's inside

| Area | Scripts |
|---|---|
| **Flagship automation** | Tracking Bus (all-in-one order/ship-date tracker: fetch → extract → sweep → write-back), RxFlow Sale Automator (paste → map → auto-fill → consent → submit), Cross-Platform Contact Toolkit |
| **Portal session handling** | Auto-login + order status extraction across 7 pharmacy portals (LifeFile builds), patient profile autofill, lab profile autofill |
| **Zoho CRM** | Context extractor, address validator, patient quick-copy, peptide SMS templates, task due-date menus, care-plan auto-jump, text highlighter |
| **Tracking copiers** | UPS / FedEx / EasyPost — auto-copy "Date Shipped + Tracking #" from carrier pages |
| **Productivity** | GLP-1 dosing calculator, product quick-nav, template menus, Sheets clipboard cleaner, "select text inside a link" |

## Design philosophy

- **Few moving parts per script** — plain DOM + a handful of GM APIs; no frameworks, no build step, no runtime deps.
- **Human-in-the-loop where it matters** — every destructive or ambiguous step (a sheet write, a patient consent gate, a form submit) is either previewed first or left to one trusted user action.
- **Zero-config for coworkers** — credentials and state live in per-user Tampermonkey storage, set once, never in source.
- **Trusted-click limits respected** — synthetic events are used only where the target UI accepts them; the repo's failure history is distilled into `SCRIPT-BEST-PRACTICES`-style rules enforced by the gate.

## Quality gate

`_smoketest/verify-all.js` runs on every change: per-file syntax check, userscript header discipline, hardcoded-secret scan, boot-log/version sync, empty-catch surface, and git drift. Exit 0 = shippable. The gate exists because every check it performs once cost real time when it silently failed.

## Design system

All panels share the **Warm Paper** design system — a warm, paper-toned token set (`--ds-*` CSS variables, see `DESIGN.md` + `panel-design.css`) that keeps 30+ injected UIs visually consistent with each other and with the pages they live on.

## Dev tooling

- `cdp-eval.mjs` — drive a live Chrome tab (CDP port 9222) with `Runtime.evaluate` for probes and install flows
- `cdp-input.mjs` — send *trusted* keyboard/mouse input via the CDP Input domain (for UIs that ignore synthetic events)

## Install (for local use)

1. Install Tampermonkey in your browser.
2. Open the raw `.user.js` file — Tampermonkey intercepts it and offers to install.
3. Set per-user credentials via the script's menu command where prompted.

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Jeyson Dagondon.
