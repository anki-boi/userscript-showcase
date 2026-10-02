// ==UserScript==
// @name         Zoho CRM - Care Plan Toolkit
// @namespace    http://tampermonkey.net/
// @version      1.6
// @author       Jeyson Dagondon
// @description  Care Plan age + LDN verdict, auto-jump, whole-line text highlighting
// @match        *://*.crm.zoho.com/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==
// Part of the userscript-showcase collection — generated from the private working
// repo via scripts/scrub.js. Do not hand-edit; fix the source and regenerate.

console.info('[CPToolkit v1.6] boot');

// --- Script API (R18) ---
window.__scripts = window.__scripts || {};
window.__scripts['CPToolkit'] = { name: 'Zoho CRM - Care Plan Toolkit', version: '1.6', state: 'idle', message: 'Loaded', progress: null, output: null, error: null, lastActivity: Date.now(), trigger: null };

(function () {
    'use strict';

    const __VER__ = '1.6';

    // ---------------------------------------------------------------------
    // WHAT THIS DOES (merged 2026-09-25 — was three scripts)
    //
    //  1. CARE PLAN AGE + LDN VERDICT (Contacts detail view)
    //     The "Care Plan" related list's Date column gets a block under each
    //     date: how old the plan is, and an LDN eligibility line derived from
    //     the row's Care Plan Title and "Details and Tracking" text.
    //
    //     (The +3 mo / +6 mo milestone dates that used to be printed here were
    //     only ever a rough proxy for LDN eligibility — removed 2026-09-25 now
    //     that the verdict itself is computed. The age chip keeps its
    //     green/amber/red/blue stage colour.)
    //
    //     LDN RULES (Jeyson, 2026-09-25) — one table, LDN_RULES below:
    //       - 3 months is the MINIMUM course. Shorter → no verdict.
    //       - If the plan's age is younger than its course (i.e. today is
    //         before plan date + duration), the patient can be ordered an LDN
    //         script. 6 or 12 months of course does not change that.
    //       - WARRIOR program exception: "<N> Months Warrior" (also
    //         "N Months of Warrior" / "N Months FLOA Warrior") is owed
    //         N/3 scripts even after the course ends — 3 Months Warrior = 1
    //         script, 6 = 2, 12 = 4.
    //       - ...unless the plan is older than 1.5x its course: that is "way
    //         too stale" and no longer eligible.
    //       - FUNCTIONAL MEDICINE: when the plan is still within its course,
    //         the eligibility is Clinic Pay — the clinic covers everything,
    //         meds included, not just the free script.
    //       - "Free script" = the script is free; Clinic Pay = the meds are
    //         free too. Different things, rendered differently.
    //       - 1 month = 4 weeks. "12 weeks" = 3 months, "7 weeks" = 1.75 mo.
    //         Month tokens use calendar months (same math as the +3 mo chip),
    //         week tokens use 7-day weeks.
    //
    //  2. AUTO-JUMP TO CARE PLAN (Contacts detail view)
    //     Scrolls the Care Plan related list into view once Zoho has bound it
    //     to the patient in the URL (entity-id binding, not stale text).
    //
    //  3. WHOLE-LINE TEXT HIGHLIGHTER (every Zoho page)
    //     The old word-level highlighter now highlights the WHOLE LINE that
    //     contains a target word (Jeyson, 2026-09-25: "more visible").
    //     Matching is still per target word; the colour/weight of the matched
    //     target paints the entire line it sits on.
    //
    // Live DOM (verified 2026-09-11 / re-verified 2026-09-25 against real
    // patient records):
    //   crm-related-list-view-header[related-module="CustomModule32"]
    //     > lyte-tbody > lyte-tr
    //         > lyte-td[data-zcqa="value_listviewtable_Date"]
    //             > lyte-text.newDTField[lt-prop-value="Aug 12, 2026"]
    //         > lyte-td[data-zcqa="value_listviewtable_Care Plan Title"]
    //         > lyte-td[data-zcqa="value_listviewtable_Care Plan Type"]
    //         > lyte-td[data-zcqa="value_listviewtable_Details and Tracking"]
    //   The td is vertical-align:top with overflow:visible, so appending a
    //   block below the date is safe and does not disturb Zoho's own layout.
    //   Highlightable text lives in <pre class="cxTextareaViewMode"> where \n
    //   is a real line break — hence the per-line split in the highlighter.
    // ---------------------------------------------------------------------

    const CARE_PLAN_TABLE_SEL =
        'crm-related-list-view-header[related-module="CustomModule32"], ' +
        'crm-related-list-view-header[related-list-label="Care Plan"]';
    const DATE_CELL_SEL = 'lyte-td[data-zcqa="value_listviewtable_Date"]';
    const NOTE_CLASS = 'cp-note';
    const HIGHLIGHT_CLASS = 'tm-highlighted';
    const SCAN_DEBOUNCE_MS = 150;
    const HL_DEBOUNCE_MS = 100;
    const DAY_MS = 86400000;
    const CONTACTS_ROUTE = /\/tab\/Contacts\//;

    // Auto-jump tuning. Zoho mounts related lists and detail sections AFTER the
    // first jump, and every late arrival above the Care Plan pushes it down out
    // of view (on org 695301973 the section can sit 5 000 px into the scroller).
    // So the jump STAYS ARMED after it lands and re-anchors whenever the section
    // drifts — that is what "scroll to the care plan" has to mean on a page that
    // is still growing. Cost is one getBoundingClientRect per tick.
    const JUMP_POLL_MS = 200;
    const JUMP_MAX_ATTEMPTS = 100;  // ~20s ceiling while waiting for the section
    const JUMP_SETTLE_MS = 10000;   // stay armed this long after the first jump
    const JUMP_SHIFT_PX = 24;       // ignore sub-visual jitter, catch a real push
    const JUMP_USER_EVENTS = ['wheel', 'touchstart', 'keydown', 'mousedown'];

    // Auto-Jump: the Care Plan related list's id is stable inside org 695301973.
    const CARE_PLAN_ID = '4159382000086209513';

    // ─── LDN rules — ONE table, next to its use (R23) ──────────────────────

    const LDN_RULES = {
        minMonths: 3,        // "3 months is the minimum"
        monthsPerScript: 3,  // 3 months of Warrior program = 1 script
        staleFactor: 1.5,    // Warrior past 1.5x its course = way too stale
        weeksPerMonth: 4,    // "1 month = 4 weeks"
        maxMonths: 60        // sanitize: nothing real is longer than this
    };

    // Duration tokens. The unit must FOLLOW the number, which is what keeps
    // Zoho's dosing ranges ("Weeks 1 - 4", "wk 5 and on") from being read as
    // durations — in the live data the unit only ever precedes an index.
    const DURATION_PATTERNS = [
        { re: /(\d+(?:\.\d+)?)\s*[-–—]?\s*(?:months?|mos?|mo)\b/gi, kind: 'months', per: n => n },
        { re: /(\d+(?:\.\d+)?)\s*[-–—]?\s*(?:weeks?|wks?|wk)\b/gi, kind: 'weeks', per: n => n * 7 },
        { re: /(\d+(?:\.\d+)?)\s*[-–—]?\s*(?:years?|yrs?|yr)\b/gi, kind: 'years', per: n => n * 12 },
        { re: /\bannual(?:ly)?\b|\byearly\b/gi, kind: 'years', per: () => 12 }
    ];

    const WARRIOR_RE = /(\d+(?:\.\d+)?)\s*months?\s+(?:of\s+)?(?:floa\s+)?warrior/i;
    const FUNCTIONAL_MEDICINE_RE = /functional\s*medicine/i;

    const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                         'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const MONTH_INDEX = {
        jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
        jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
    };

    // Green has TWO tiers (Jeyson 2026-09-25): the hero signal is a finished plan,
    // everything else green just means "money settled" and must not compete with
    // it — so those go lighter AND lose the bold.
    const GREEN_KEY = 'green';       // rgb(0,128,0) + bold — the one that matters
    const GREEN_SOFT = '#4caf50';    // lighter, unbolded — background noise
    // Same idea for purple: these match whole ADDRESS lines in TN/HH notes, and
    // full-strength purple bold screamed across a screenful of them.
    const PURPLE_SOFT = 'mediumpurple';

    const TARGET_TEXTS = {
        'Care plan complete': { color: GREEN_KEY, bold: true, ci: true },
        'PIF': { color: GREEN_SOFT },
        'rcvd': { color: GREEN_SOFT },
        'sent, signed': { color: GREEN_SOFT },
        'Sent, signed': { color: GREEN_SOFT },
        // Typed by hand at the end of a note; casing varies, so match loosely.
        'no new ppw needed': { color: GREEN_SOFT, ci: true },
        'due': { color: 'maroon', bold: true },
        'waiting to be signed': { color: 'maroon', bold: true },
        'Products Ordered': { color: 'mediumblue', bold: true },
        'Date Shipped': { color: PURPLE_SOFT },
        'TN': { color: PURPLE_SOFT, exactMatch: true },
        'HH': { color: 'brown', bold: true, exactMatch: true }
    };

    const IGNORE_TAGS = ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'BUTTON'];
    // ONE native closest() call replaced a per-text-node JS walk to the document
    // root. That walk (plus a second, redundant copy of it) was 31% of sampled
    // CPU on a contact-page load — see the v1.2 changelog entry.
    const IGNORE_SEL = IGNORE_TAGS.map(t => t.toLowerCase()).join(', ') + ', .' + NOTE_CLASS + ', .' + HIGHLIGHT_CLASS;
    // If one mutation storm adds more than this many roots, fall back to a single
    // full-document pass instead of tracking thousands of tiny subtrees.
    const HL_ROOT_CAP = 400;

    const api = window.__scripts['CPToolkit'];

    function apiSet(state, message, extra) {
        api.state = state;
        api.message = message || '';
        api.lastActivity = Date.now();
        if (extra) Object.assign(api, extra);
        if (state === 'error') api.error = message || '';
        if (state === 'done' || state === 'idle') api.error = null;
    }

    // ─── date helpers ──────────────────────────────────────────────────────

    function toMidnight(y, m, d) {
        const dt = new Date(y, m, d);
        if (isNaN(dt.getTime())) return null;
        dt.setHours(0, 0, 0, 0);
        return dt;
    }

    function todayMidnight() {
        const now = new Date();
        return toMidnight(now.getFullYear(), now.getMonth(), now.getDate());
    }

    // Zoho renders the related-list Date as "Aug 12, 2026" (lt-prop-value).
    // The numeric shapes are kept as fallbacks in case the layout setting changes.
    function parsePlanDate(raw) {
        if (!raw) return null;
        const s = String(raw).replace(/\s+/g, ' ').trim();
        if (!s) return null;

        let m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
        if (m) {
            const mon = MONTH_INDEX[m[1].slice(0, 3).toLowerCase()];
            if (mon !== undefined) return toMidnight(+m[3], mon, +m[2]);
        }
        m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (m) {
            let y = +m[3];
            if (y < 100) y += 2000;
            return toMidnight(y, +m[1] - 1, +m[2]);
        }
        m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
        if (m) return toMidnight(+m[1], +m[2] - 1, +m[3]);

        return null;
    }

    // Calendar-month addition with end-of-month clamping (Aug 31 + 6 mo => Feb 28).
    function addMonths(date, n) {
        const firstOfTarget = new Date(date.getFullYear(), date.getMonth() + n, 1);
        const lastDay = new Date(firstOfTarget.getFullYear(), firstOfTarget.getMonth() + 1, 0).getDate();
        return toMidnight(
            firstOfTarget.getFullYear(),
            firstOfTarget.getMonth(),
            Math.min(date.getDate(), lastDay)
        );
    }

    // Calendar-day addition. MUST be date-arithmetic, not `+n*86400000`: the
    // epoch-ms form drifts an hour across a DST boundary and lands on the
    // previous day (caught by verify-cp-ldn.js — Zoho's own end date for a
    // Sep 1 + 12-week plan is Nov 24, and ms math printed Nov 23).
    function addDays(date, n) {
        return toMidnight(date.getFullYear(), date.getMonth(), date.getDate() + n);
    }

    // Whole calendar months elapsed between two dates (day-of-month aware), so
    // Aug 12 -> Nov 11 is 2 months, Nov 12 is exactly 3.
    function wholeMonthsBetween(from, to) {
        let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
        if (to.getDate() < from.getDate()) months -= 1;
        return months;
    }

    function formatDate(dt) {
        return MONTH_NAMES[dt.getMonth()] + ' ' + dt.getDate() + ', ' + dt.getFullYear();
    }

    function daysBetween(from, to) {
        return Math.round((to - from) / DAY_MS);
    }

    // ─── LDN engine (pure — pinned by _smoketest/verify-cp-ldn.js) ─────────

    // Pull every duration out of a blob of Zoho text (title / details).
    // Returns [{ months, days, token }] — weeks carry `days`, months/years
    // carry `months` so a month token can use calendar math and a week token
    // can use exact 7-day weeks.
    function parseDurations(text) {
        const found = [];
        if (!text) return found;
        const s = String(text).replace(/\s+/g, ' ');

        for (const { re, kind, per } of DURATION_PATTERNS) {
            re.lastIndex = 0;
            let m;
            while ((m = re.exec(s)) !== null) {
                const n = m[1] !== undefined ? parseFloat(m[1]) : 1;
                if (!(n > 0)) continue;

                // Sanitize (R6 — the live texts are messy). Two shapes must
                // never read as durations:
                //   "Weeks 1 - 4"  → unit precedes the number (dosing range)
                //   "1 - 4 weeks"  → number range, no single duration
                const before = s.slice(Math.max(0, m.index - 24), m.index);
                if (/\b(?:week|wk|day|month)s?\s*$/i.test(before)) continue;
                if (/[\d)]\s*[-–—]\s*$/.test(before)) continue;

                const months = kind === 'weeks' ? n / LDN_RULES.weeksPerMonth : per(n);
                if (!(months > 0) || months > LDN_RULES.maxMonths) continue;

                found.push({
                    months: Math.round(months * 100) / 100,
                    days: kind === 'weeks' ? Math.round(n * 7) : null,
                    token: m[0].trim()
                });
            }
        }
        return found;
    }

    // The latest end date any of the row's services reaches. Month tokens end
    // on the calendar anniversary (same as the +3 mo chip); week tokens end on
    // plan date + 7*n days.
    function durationEndDate(planDate, durations) {
        let end = null;
        for (const d of durations) {
            const candidate = d.days !== null
                ? addDays(planDate, d.days)
                : addMonths(planDate, Math.round(d.months));
            if (!end || candidate > end) end = candidate;
        }
        return end;
    }

    // "<N> Months Warrior" wins with its own N; a bare "FLOA Warrior" type (or
    // a Warrior title with no number) falls back to the plan's own duration.
    function warriorMonthsIn(title, type, details, maxMonths) {
        const text = [title, details].filter(Boolean).join(' ');
        const m = WARRIOR_RE.exec(text);
        if (m) return parseFloat(m[1]);
        if (!/\bwarrior\b/i.test(text) && !/\bwarrior\b/i.test(type || '')) return 0;
        return maxMonths;
    }

    // The one verdict function. Every row in the related list gets its own —
    // no type filter (Jeyson 2026-09-25: any row with a real duration counts).
    function ldnVerdict(input) {
        const planDate = input.planDate;
        const title = input.title || '';
        const type = input.type || '';
        const details = input.details || '';
        const today = input.today;

        const result = {
            status: 'none', eligible: false, clinicPay: false, warrior: false,
            scripts: 0, durationMonths: 0, endDate: null, staleAt: null, reason: ''
        };

        const durations = parseDurations([title, details].join(' \n '));
        if (!durations.length) {
            result.reason = 'no duration found in title/details';
            return result;
        }

        const maxMonths = Math.max.apply(null, durations.map(d => d.months));
        result.durationMonths = maxMonths;
        if (maxMonths < LDN_RULES.minMonths) {
            result.status = 'short';
            result.reason = maxMonths + ' mo course (minimum ' + LDN_RULES.minMonths + ' mo)';
            return result;
        }

        const end = durationEndDate(planDate, durations);
        result.endDate = end;

        const ageDays = daysBetween(planDate, today);
        if (ageDays < 0) {
            result.status = 'future';
            result.reason = 'plan starts ' + formatDate(planDate);
            return result;
        }

        const warriorMonths = warriorMonthsIn(title, type, details, maxMonths);
        result.warrior = warriorMonths > 0;
        if (result.warrior) {
            result.scripts = Math.max(1, Math.round(warriorMonths / LDN_RULES.monthsPerScript));
        }

        const clinicPay = FUNCTIONAL_MEDICINE_RE.test(title + ' ' + details);
        const withinCourse = today < end;

        if (clinicPay && withinCourse) {
            result.status = 'clinic_pay';
            result.eligible = true;
            result.clinicPay = true;
            result.scripts = result.scripts || 1;
            result.reason = 'Functional Medicine + active course — Clinic Pay';
            return result;
        }

        if (withinCourse) {
            result.status = result.warrior ? 'warrior' : 'eligible';
            result.eligible = true;
            result.scripts = result.scripts || 1;
            result.reason = 'younger than its ' + maxMonths + ' mo course';
            return result;
        }

        if (result.warrior) {
            // Warrior entitlement outlives the course — until 1.5x the course.
            // Integer days, so the boundary can't shift across a DST change.
            const staleAfterDays = Math.round(LDN_RULES.staleFactor * daysBetween(planDate, end));
            const staleAt = addDays(planDate, staleAfterDays);
            result.staleAt = staleAt;
            if (today > staleAt) {
                result.status = 'stale';
                result.reason = 'Warrior plan past ' + LDN_RULES.staleFactor + 'x its course (' + formatDate(staleAt) + ')';
                return result;
            }
            result.status = 'warrior_expired';
            result.eligible = true;
            result.reason = 'Warrior entitlement (course ended ' + formatDate(end) + ')';
            return result;
        }

        result.status = 'expired';
        result.reason = 'older than its ' + maxMonths + ' mo course (ended ' + formatDate(end) + ')';
        return result;
    }

    // Human-facing label + tone for a verdict. null = render no LDN line.
    function ldnLabel(v) {
        switch (v.status) {
            case 'clinic_pay':
                return { text: 'LDN ✓ Clinic Pay — free meds', tone: 'clinic' };
            case 'warrior':
            case 'warrior_expired':
                return {
                    text: 'LDN ✓ ' + v.scripts + ' free script' + (v.scripts === 1 ? '' : 's'),
                    tone: 'ok'
                };
            case 'eligible':
                return { text: 'LDN ✓ free script', tone: 'ok' };
            case 'expired':
                return { text: 'LDN ✗ course ended', tone: 'no' };
            case 'stale':
                return { text: 'LDN ✗ warrior plan stale', tone: 'stale' };
            case 'short':
                return { text: 'LDN — ' + v.durationMonths + ' mo course (3 mo min)', tone: 'muted' };
            case 'future':
                return { text: 'LDN — plan not started', tone: 'muted' };
            default:
                return null;
        }
    }

    // Tooltip lines shared by the age chip and the LDN line.
    function ldnTip(v) {
        const lines = [
            'LDN: ' + v.status.toUpperCase() + (v.eligible ? ' — eligible' : ''),
            'Course: ' + v.durationMonths + ' mo' + (v.endDate ? ' (ends ' + formatDate(v.endDate) + ')' : ''),
            'Warrior: ' + (v.warrior ? v.scripts + ' script(s)' : 'no'),
            'Clinic Pay: ' + (v.clinicPay ? 'yes (free meds)' : 'no'),
            'Reason: ' + v.reason
        ];
        if (v.staleAt) lines.push('Stale after: ' + formatDate(v.staleAt));
        return lines.join('\n');
    }

    // ─── presentation model ────────────────────────────────────────────────

    function buildModel(planDate, today) {
        const ageDays = daysBetween(planDate, today);
        const months = ageDays < 0 ? 0 : wholeMonthsBetween(planDate, today);

        const m3Passed = today >= addMonths(planDate, 3);
        const m6Passed = today >= addMonths(planDate, 6);

        let tone;
        if (ageDays < 0) tone = 'future';
        else if (m6Passed || months >= 6) tone = 'm6';
        else if (m3Passed || months >= 3) tone = 'm3';
        else tone = 'fresh';

        let ageText;
        if (ageDays < 0) {
            const n = Math.abs(ageDays);
            ageText = 'in ' + n + ' day' + (n === 1 ? '' : 's');
        } else if (ageDays === 0) {
            ageText = 'today';
        } else if (ageDays < 31) {
            ageText = ageDays + ' day' + (ageDays === 1 ? '' : 's') + ' old';
        } else if (months < 24) {
            const remainder = Math.max(0, daysBetween(addMonths(planDate, months), today));
            ageText = months + ' mo' + (remainder ? ' ' + remainder + ' d' : '') + ' old';
        } else {
            ageText = Math.floor(months / 12) + ' yr ' + (months % 12) + ' mo old';
        }

        const toneNote = {
            future: 'plan date is in the future',
            fresh: 'under 3 months',
            m3: '3 months passed',
            m6: '6 months passed'
        }[tone];

        const tip =
            'Care plan date: ' + formatDate(planDate) + '\n' +
            'Age: ' + ageText + ' (' + ageDays + ' day' + (ageDays === 1 ? '' : 's') + ')\n' +
            'Status: ' + toneNote;

        return { ageDays, months, ageText, tone, toneNote, tip };
    }

    // ─── rendering ─────────────────────────────────────────────────────────

    const NOTE_CSS = `
.${NOTE_CLASS} {
  display: block !important;
  margin-top: 5px !important;
  padding: 3px 0 0 6px !important;
  border-left: 3px solid #dadce0 !important;
  white-space: normal !important;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif !important;
  font-size: 10px !important;
  line-height: 1.4 !important;
  font-weight: 400 !important;
  text-align: left !important;
  cursor: default !important;
}
.${NOTE_CLASS} .cp-age-chip {
  display: inline-block !important;
  padding: 1px 6px !important;
  border-radius: 999px !important;
  border: 1px solid transparent !important;
  font-size: 10px !important;
  font-weight: 700 !important;
  letter-spacing: 0.2px !important;
  white-space: nowrap !important;
  background: #f1f3f4 !important;
  color: #5f6368 !important;
}
.${NOTE_CLASS} .cp-ldn {
  display: block !important;
  margin-top: 3px !important;
  padding: 1px 6px !important;
  border-radius: 3px !important;
  font-size: 10px !important;
  font-weight: 700 !important;
  letter-spacing: 0.2px !important;
  white-space: normal !important;
  background: #f1f3f4 !important;
  color: #5f6368 !important;
  border: 1px solid transparent !important;
}
.${NOTE_CLASS} .cp-ldn[data-cp-ldn="ok"] { background: #e6f4ea !important; color: #0f7b3f !important; border-color: #a8d5b5 !important; }
.${NOTE_CLASS} .cp-ldn[data-cp-ldn="clinic"] { background: #f3ecff !important; color: #5b2d9e !important; border-color: #d3bff5 !important; }
.${NOTE_CLASS} .cp-ldn[data-cp-ldn="no"] { background: #f4f1ec !important; color: #8a8072 !important; border-color: #e2dbcd !important; }
.${NOTE_CLASS} .cp-ldn[data-cp-ldn="stale"] { background: #fde8e6 !important; color: #b3261e !important; border-color: #f3b8b3 !important; }
.${NOTE_CLASS} .cp-ldn[data-cp-ldn="muted"] { background: #f8f7f5 !important; color: #9a9184 !important; border-color: #ece7de !important; font-weight: 400 !important; }
.${NOTE_CLASS}[data-cp-tone="future"] { border-left-color: #1a73e8 !important; }
.${NOTE_CLASS}[data-cp-tone="future"] .cp-age-chip { background: #e8f0fe !important; color: #1a73e8 !important; border-color: #c6dafc !important; }
.${NOTE_CLASS}[data-cp-tone="fresh"] { border-left-color: #34a853 !important; }
.${NOTE_CLASS}[data-cp-tone="fresh"] .cp-age-chip { background: #e6f4ea !important; color: #0f7b3f !important; border-color: #a8d5b5 !important; }
.${NOTE_CLASS}[data-cp-tone="m3"] { border-left-color: #f0a500 !important; }
.${NOTE_CLASS}[data-cp-tone="m3"] .cp-age-chip { background: #fef1d8 !important; color: #9a5b00 !important; border-color: #f2cd8a !important; }
.${NOTE_CLASS}[data-cp-tone="m6"] { border-left-color: #d93025 !important; }
.${NOTE_CLASS}[data-cp-tone="m6"] .cp-age-chip { background: #fde8e6 !important; color: #b3261e !important; border-color: #f3b8b3 !important; }
`;

    function ensureStyle() {
        if (document.getElementById('cp-toolkit-style')) return;
        const style = document.createElement('style');
        style.id = 'cp-toolkit-style';
        style.textContent = NOTE_CSS;
        (document.head || document.documentElement).appendChild(style);
    }

    function el(tag, className, text) {
        const node = document.createElement(tag);
        if (className) node.className = className;
        if (text !== undefined) node.textContent = text;
        return node;
    }

    function renderNote(td, src, model, verdict) {
        let note = td.querySelector(':scope > .' + NOTE_CLASS);
        if (!note) {
            note = el('div', NOTE_CLASS);
            td.appendChild(note);
        }
        note.dataset.cpSrc = src;
        note.dataset.cpTone = model.tone;
        note.replaceChildren();

        const chip = el('span', 'cp-age-chip', model.ageText);
        chip.setAttribute('title', model.tip);
        note.appendChild(chip);

        const label = ldnLabel(verdict);
        if (label) {
            const line = el('span', 'cp-ldn', label.text);
            line.dataset.cpLdn = label.tone;
            line.setAttribute('title', model.tip + '\n\n' + ldnTip(verdict));
            note.appendChild(line);
        }

        note.setAttribute('title', model.tip + (label ? '\n\n' + ldnTip(verdict) : ''));
        return note;
    }

    // ─── care plan rows ────────────────────────────────────────────────────

    // Read one related-list row's cells (text only — the note lives in the
    // Date cell and is never part of what we parse).
    function readCarePlanRow(tr) {
        const cell = name => {
            const td = tr.querySelector(':scope > lyte-td[data-zcqa="value_listviewtable_' + name + '"]');
            return td ? (td.textContent || '').replace(/\s+/g, ' ').trim() : '';
        };
        return {
            date: cell('Date'),
            title: cell('Care Plan Title'),
            type: cell('Care Plan Type'),
            details: cell('Details and Tracking')
        };
    }

    // Annotate one row. Returns a summary when it (re)rendered, null when the
    // row was already up to date or not a usable care plan row.
    function annotateRow(tr, today) {
        const row = readCarePlanRow(tr);
        if (!row.date) return null;

        const dateTd = tr.querySelector(':scope > ' + DATE_CELL_SEL);
        if (!dateTd) return null;

        const lyte = dateTd.querySelector('lyte-text.newDTField') || dateTd.querySelector('lyte-text');
        const rawDate = (
            (lyte && (lyte.getAttribute('lt-prop-value') || lyte.textContent)) || row.date
        ).replace(/\s+/g, ' ').trim();

        const existing = dateTd.querySelector(':scope > .' + NOTE_CLASS);
        if (!rawDate) {
            if (existing) existing.remove();
            return null;
        }

        // Zoho re-renders rows; only repaint when the bound data actually
        // changed. The highlighter wraps text in spans, which textContent
        // ignores — so its churn never triggers a repaint.
        const src = [rawDate, row.title, row.type, row.details].join(' | ');
        if (existing && existing.dataset.cpSrc === src) return null;

        const planDate = parsePlanDate(rawDate);
        if (!planDate) {
            if (existing) existing.remove();
            return null;
        }

        const model = buildModel(planDate, today);
        const verdict = ldnVerdict({
            planDate, title: row.title, type: row.type, details: row.details, today
        });
        renderNote(dateTd, src, model, verdict);

        return {
            date: rawDate,
            ageDays: model.ageDays,
            ageText: model.ageText,
            tone: model.tone,
            ldn: {
                status: verdict.status,
                eligible: verdict.eligible,
                clinicPay: verdict.clinicPay,
                warrior: verdict.warrior,
                scripts: verdict.scripts,
                durationMonths: verdict.durationMonths,
                endDate: verdict.endDate ? formatDate(verdict.endDate) : null,
                reason: verdict.reason
            }
        };
    }

    function scanCarePlan(today) {
        const tables = document.querySelectorAll(CARE_PLAN_TABLE_SEL);
        if (!tables.length) return [];
        ensureStyle();

        const summary = [];
        tables.forEach(table => {
            table.querySelectorAll('lyte-tbody > lyte-tr').forEach(tr => {
                if (!tr.querySelector(':scope > ' + DATE_CELL_SEL)) return;
                try {
                    const row = annotateRow(tr, today);
                    if (row) summary.push(row);
                } catch (err) {
                    console.warn('[CPToolkit] care plan row skipped', err);
                }
            });
        });
        return summary;
    }

    // ─── whole-line highlighter (every Zoho page) ──────────────────────────

    // The \b-anchored targets (TN/HH) are compiled ONCE. Building a RegExp per
    // text node per target was its own hot spot in the 2026-09-25 profile.
    // `ci: true` picks up the case-insensitive spelling for hand-typed phrases.
    for (const [target, cfg] of Object.entries(TARGET_TEXTS)) {
        if (cfg.exactMatch) cfg.re = new RegExp('\\b' + escapeRegex(target) + '\\b');
        else if (cfg.ci) cfg.re = new RegExp(escapeRegex(target), 'i');
    }

    function matchTarget(text) {
        for (const [target, cfg] of Object.entries(TARGET_TEXTS)) {
            if (cfg.re ? cfg.re.test(text) : text.includes(target)) return cfg;
        }
        return null;
    }

    function escapeRegex(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function shouldIgnoreNode(node) {
        if (!node.parentElement) return true;
        return !!node.parentElement.closest(IGNORE_SEL);
    }

    function createHighlightSpan(text, cfg) {
        const span = document.createElement('span');
        span.className = HIGHLIGHT_CLASS;
        span.textContent = text;
        span.style.color = cfg.color;
        span.style.fontWeight = cfg.bold ? 'bold' : 'normal';
        span.style.display = 'inline';
        return span;
    }

    // A text node in Zoho's <pre> cells carries real \n line breaks, so the
    // node is split into lines and the WHOLE line holding a target is wrapped
    // (Jeyson 2026-09-25). Colour comes from the target that matched.
    function processTextNode(node) {
        const original = node.textContent;
        if (!original) return;

        const parts = original.split(/(\n)/);
        const fragment = document.createDocumentFragment();
        let changed = false;

        for (const part of parts) {
            if (part === '\n' || part === '') {
                if (part) fragment.appendChild(document.createTextNode(part));
                continue;
            }
            const cfg = matchTarget(part);
            if (!cfg) {
                fragment.appendChild(document.createTextNode(part));
                continue;
            }
            changed = true;
            fragment.appendChild(createHighlightSpan(part, cfg));
        }

        if (changed && node.parentNode) node.parentNode.replaceChild(fragment, node);
    }

    // Walk ONLY the subtrees that changed. v1.1 re-walked all of document.body
    // on every mutation batch: 345 full-document text walks in a 25s contact
    // page load (2026-09-25 CPU profile). Roots are merged/deduped first, so a
    // storm of small mutations costs one pass over the union.
    function normalizeRoots(roots) {
        if (!roots || !roots.length) return [document.body];
        const out = [];
        for (const node of roots) {
            const el = node.nodeType === 1 ? node : node.parentElement;
            if (!el) continue;
            if (el === document.body || el === document.documentElement) return [document.body];
            let covered = false;
            for (let i = out.length - 1; i >= 0; i--) {
                if (out[i].contains(el)) { covered = true; break; }
                if (el.contains(out[i])) out.splice(i, 1);
            }
            if (!covered) out.push(el);
        }
        return out.length ? out : [document.body];
    }

    function scanSubtree(root) {
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode: function (node) {
                    // One acceptance decision per node — the ignored check used to
                    // be repeated for every collected node after the walk.
                    if (shouldIgnoreNode(node)) return NodeFilter.FILTER_REJECT;
                    const text = node.textContent;
                    if (!text || !text.trim()) return NodeFilter.FILTER_SKIP;
                    return matchTarget(text) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        const nodes = [];
        let current;
        while ((current = walker.nextNode())) nodes.push(current);

        for (const textNode of nodes) {
            if (textNode.parentNode) processTextNode(textNode);
        }
        return nodes.length;
    }

    function scanHighlights(roots) {
        if (!document.body) return 0;
        let count = 0;
        for (const root of normalizeRoots(roots)) count += scanSubtree(root);
        return count;
    }

    // ─── auto-jump to the Care Plan section ────────────────────────────────

    let lastContactId = null;

    function getContactIdFromUrl() {
        const match = location.pathname.match(/Contacts\/(\d+)/);
        return match ? match[1] : null;
    }

    // The nav label carries entity-id="<contact id>" as a real data binding —
    // unlike its text content, this can't be "stale leftover text from the last
    // patient". Comparing it to the URL's contact id tells us the panel is
    // bound to the patient we're actually looking at.
    function panelIsBoundToContact(contactId) {
        const label = document.querySelector('crm-related-list-label#rl_' + CARE_PLAN_ID);
        return !!label && label.getAttribute('entity-id') === contactId;
    }

    function getRenderedSection() {
        const section = document.getElementById('relatedList' + CARE_PLAN_ID);
        if (section && section.offsetHeight > 0) return section;
        const header = document.querySelector(CARE_PLAN_TABLE_SEL);
        const wrap = header && header.closest('crm-related-list-view-header, section, div');
        return wrap && wrap.offsetHeight > 0 ? wrap : null;
    }

    // Zoho scrolls an inner <lyte-tab-body class="dv_content_tab_body">, NEVER the
    // window (window.scrollY is permanently 0 on these pages), so the window is
    // useless as the anchor metric. Measure against whatever element scrolls.
    function scrollHost(el) {
        for (let node = el && el.parentElement; node; node = node.parentElement) {
            const overflowY = getComputedStyle(node).overflowY;
            if (/auto|scroll|overlay/.test(overflowY) && node.scrollHeight > node.clientHeight + 4) return node;
        }
        return null;
    }

    // 0 = "the section sits at the top of the scrollable area", i.e. exactly where
    // scrollIntoView({block:'start'}) puts it. Growth above the section shows up
    // here as a positive number, so this is the drift signal the jump watches.
    function sectionOffset(section) {
        const host = scrollHost(section);
        const top = section.getBoundingClientRect().top;
        return host ? top - host.getBoundingClientRect().top : top + window.scrollY;
    }

    let jumpPoll = null;

    function jumpToCarePlan(contactId) {
        if (jumpPoll) clearInterval(jumpPoll);
        let attempts = 0;
        let jumpedAt = 0;
        let cancelled = false;

        // Any deliberate input means the user wants to scroll, so stop chasing.
        const onUserInput = () => { cancelled = true; };
        for (const ev of JUMP_USER_EVENTS) window.addEventListener(ev, onUserInput, { passive: true });

        const stop = () => {
            if (jumpPoll) clearInterval(jumpPoll);
            jumpPoll = null;
            for (const ev of JUMP_USER_EVENTS) window.removeEventListener(ev, onUserInput);
        };

        jumpPoll = setInterval(() => {
            attempts++;
            if (cancelled) return stop();
            if (!panelIsBoundToContact(contactId)) return;

            const section = getRenderedSection();
            if (!section) {
                if (attempts >= JUMP_MAX_ATTEMPTS) {
                    stop();
                    console.warn('[CPToolkit] auto-jump gave up for contact', contactId);
                }
                return;
            }

            if (!jumpedAt) {
                jumpedAt = Date.now();
                section.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
            }
            if (Date.now() - jumpedAt > JUMP_SETTLE_MS) return stop(); // armed long enough

            // Off its slot: late content above pushed it down (or the first jump
            // never landed). Instant, not smooth — a correction that restarts an
            // in-flight smooth scroll just chases the moving target.
            if (Math.abs(sectionOffset(section)) > JUMP_SHIFT_PX) {
                section.scrollIntoView({ block: 'start' });
            }
        }, JUMP_POLL_MS);
    }

    function checkForContactChange() {
        if (!CONTACTS_ROUTE.test(location.pathname)) return;
        const currentId = getContactIdFromUrl();
        if (currentId && currentId !== lastContactId) {
            lastContactId = currentId;
            jumpToCarePlan(currentId);
        }
    }

    // ─── wiring: ONE observer, per-widget guards (R23) ─────────────────────

    function isOwnNode(n) {
        if (n.nodeType !== 1) return false;
        if (n.id === 'cp-toolkit-style') return true;
        if (n.classList.contains(NOTE_CLASS) || n.classList.contains(HIGHLIGHT_CLASS)) return true;
        if (n.classList.contains('cp-age-chip') || n.classList.contains('cp-ldn')) return true;
        return !!(n.closest && n.closest('.' + NOTE_CLASS));
    }

    function isOwnMutation(mutation) {
        const nodes = [...mutation.addedNodes, ...mutation.removedNodes];
        if (!nodes.length) {
            return mutation.type === 'attributes' && !!(mutation.target.closest &&
                mutation.target.closest('.' + NOTE_CLASS));
        }
        return nodes.every(isOwnNode);
    }

    let cpTimer = null;
    let hlTimer = null;
    let hlRoots = [];
    let hlFull = false;
    let cpRunning = false;

    function scheduleCarePlanScan() {
        if (cpTimer) clearTimeout(cpTimer);
        cpTimer = setTimeout(() => {
            cpTimer = null;
            if (!CONTACTS_ROUTE.test(location.pathname)) return;
            if (cpRunning) { scheduleCarePlanScan(); return; }
            cpRunning = true;
            try {
                const summary = scanCarePlan(todayMidnight());
                if (summary.length) {
                    api.output = summary;
                    apiSet(api.state === 'running' ? 'done' : 'idle', summary.length + ' care plan row(s) annotated');
                }
            } catch (err) {
                console.warn('[CPToolkit] care plan scan failed', err);
            }
            cpRunning = false;
        }, SCAN_DEBOUNCE_MS);
    }

    function scheduleHighlightScan(nodes) {
        if (nodes && nodes.length && !hlFull) {
            for (const n of nodes) {
                hlRoots.push(n);
                if (hlRoots.length > HL_ROOT_CAP) { hlFull = true; hlRoots = []; break; }
            }
        }
        if (hlTimer) clearTimeout(hlTimer);
        hlTimer = setTimeout(() => {
            hlTimer = null;
            const roots = hlFull ? null : hlRoots; // null = one full pass
            hlFull = false;
            hlRoots = [];
            try {
                scanHighlights(roots);
            } catch (err) {
                console.warn('[CPToolkit] highlight scan failed', err);
            }
        }, HL_DEBOUNCE_MS);
    }

    function startObserver() {
        const observer = new MutationObserver(mutations => {
            let relevant = false;
            const added = [];
            for (const m of mutations) {
                if (isOwnMutation(m)) continue;
                relevant = true;
                for (const n of m.addedNodes) added.push(n);
            }
            if (!relevant) return;
            scheduleCarePlanScan();
            if (added.length) scheduleHighlightScan(added);
        });
        observer.observe(document.documentElement, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['lt-prop-value']
        });
    }

    // ─── API ───────────────────────────────────────────────────────────────

    api.trigger = function (action) {
        switch (action) {
            case 'rescan':
            case 'start':
                scheduleCarePlanScan();
                scheduleHighlightScan(null);
                return { ok: true };
            case 'jump': {
                const id = getContactIdFromUrl();
                if (!id) return { ok: false, error: 'not on a contact page' };
                jumpToCarePlan(id);
                return { ok: true };
            }
            case 'reset': {
                document.querySelectorAll('.' + NOTE_CLASS).forEach(n => n.remove());
                document.querySelectorAll('.' + HIGHLIGHT_CLASS).forEach(span => {
                    if (span.parentNode) span.parentNode.replaceChild(document.createTextNode(span.textContent), span);
                });
                api.output = null;
                api.progress = null;
                apiSet('idle', 'Cleared');
                return { ok: true };
            }
            default:
                return { ok: false, error: 'unknown action: ' + action };
        }
    };

    function init() {
        ensureStyle();
        if (CONTACTS_ROUTE.test(location.pathname)) scheduleCarePlanScan();
        scheduleHighlightScan(null);
        checkForContactChange();
        setInterval(checkForContactChange, 500);
        startObserver();
        apiSet('idle', 'Watching care plan related list + highlighting text');
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
