#!/usr/bin/env node
/**
 * verify-all.js — meta-harness for the whole userscript repo.
 *
 * One command gates every change: syntax, header discipline (R10), secrets
 * (R12), version sync (__VER__ const vs @version), boot-log convention (R17),
 * empty-catch surface, and git drift. Run from the repo root:
 *
 *     node _smoketest/verify-all.js
 *
 * Exit code 0 = no FAILs (WARNs are debt, printed as a backlog). Exit 1 = a
 * FAIL that must be fixed before shipping. Written for the failure history:
 * every check below exists because a silent variant of it cost real time
 * (see SCRIPT-BEST-PRACTICES.md).
 *
 * CommonJS on purpose — matches the repo's committed harness style
 * (verify-trackbus.js, verify-psa-v20.js) and sidesteps ESM path traps.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const HEADER_OPEN = '// ==UserScript==';
const HEADER_CLOSE = '// ==/UserScript==';

// ---------------------------------------------------------------------------
// Collect + parse scripts
// ---------------------------------------------------------------------------

const files = fs.readdirSync(ROOT)
  .filter(f => f.endsWith('.user.js'))
  .sort();

function readHeader(src) {
  const open = src.indexOf(HEADER_OPEN);
  const close = src.indexOf(HEADER_CLOSE);
  if (open === -1 || close === -1) return null;
  return src.slice(open, close + HEADER_CLOSE.length);
}

function parseHeader(h) {
  const kv = {};
  for (const line of h.split('\n')) {
    // [\w-]+ — hyphenated keys like @run-at/@user-agent were never matched by
    // \w+ (parsed as key "run"), flagging every script since the harness was
    // built (2026-08-06: surfaced by the harness-debt pass)
    const m = line.match(/^\/\/\s*@([\w-]+)\s*(.*)$/m);
    if (m) (kv[m[1]] = kv[m[1]] || []).push(m[2].trim());
  }
  return kv;
}

// ---------------------------------------------------------------------------
// Git state (version-bump discipline + drift proof)
// ---------------------------------------------------------------------------

function git(args) {
  // -c core.quotePath=false: git C-escapes non-ASCII paths by default
  // ("Zoho CRM \342\200\224 ..."), so the em-dash script's path never matched
  // dirtyFiles and R10's version-bump discipline was silently unenforced for it
  // (same blind-spot class as the quoting fix below).
  const r = spawnSync('git', ['-c', 'core.quotePath=false'].concat(args), { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

// git() returns null when the command fails, which includes "this tree is not a
// git repo at all" — the userscripts folder is NOT one. Treating null as "no
// changes" made dirtyFiles empty, headVersion() always null, and the R10
// version-bump discipline (below) silently unenforced, while the report still
// printed "working tree clean". That is a false PASS, so it is now its own warn.
const gitStatusRaw = git(['status', '--porcelain']);
const gitAvailable = gitStatusRaw !== null;
const gitStatus = gitStatusRaw || '';
// strip porcelain status chars AND git's quotes around spaced paths
// (quoted paths never matched plain filenames -> dirtyFiles was always empty
// -> version-bump enforcement was blind; 2026-08-06 fix)
const dirtyFiles = gitStatus.split('\n').filter(Boolean)
  .map(l => l.slice(3).trim().replace(/^"|"$/g, ''))
  .filter(f => f.endsWith('.user.js'));

function headVersion(file) {
  const out = git(['show', `HEAD:${file}`]);
  if (!out) return null;
  const h = readHeader(out);
  if (!h) return null;
  const kv = parseHeader(h);
  return (kv.version && kv.version[0]) || null;
}

// ---------------------------------------------------------------------------
// Check registry
// ---------------------------------------------------------------------------

const fails = [];
const warns = [];
const infos = [];
let checked = 0;

function FAIL(msg) { fails.push(msg); }
function WARN(msg) { warns.push(msg); }
function INFO(msg) { infos.push(msg); }

if (!gitAvailable) {
  WARN('git unavailable — version-bump discipline (R10) and drift proof are NOT enforced on this tree');
}

for (const file of files) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  const header = readHeader(src);
  const kv = header ? parseHeader(header) : null;
  const base = path.basename(file, '.user.js');
  checked++;

  // --- 0. node --check (syntax gate) -------------------------------------
  const chk = spawnSync(process.execPath, ['--check', file], { cwd: ROOT, encoding: 'utf8' });
  if (chk.status !== 0) {
    FAIL(`${file}: node --check FAILED\n${chk.stderr.split('\n').slice(0, 6).join('\n')}`);
  }

  // --- 1. header structure -------------------------------------------------
  if (!header) { FAIL(`${file}: no // ==UserScript== header block`); continue; }
  if (!kv.version || !/^\d+(\.\d+)+$/.test(kv.version[0])) {
    FAIL(`${file}: @version missing or malformed (${kv.version ? kv.version[0] : 'none'})`);
  } else {
    const ver = kv.version[0];
    const hVer = headVersion(file);
    // A file marked FROZEN GOLDEN REFERENCE is reference data, not a maintained
    // script: Template Menu.user.js stays in the repo only so the golden gate can
    // diff rendered text against the original literals (SPEC Wave 6). Version-bump
    // discipline does not apply to it — but it says so out loud, so the exemption
    // cannot be picked up by accident.
    const frozen = /FROZEN GOLDEN REFERENCE/.test(src);
    if (frozen) {
      WARN(`${file}: FROZEN GOLDEN REFERENCE — not installed, not maintained; R10 bump discipline does not apply`);
    } else if (hVer !== null && hVer !== ver && dirtyFiles.includes(file)) {
      WARN(`${file}: @version ${ver} vs HEAD ${hVer} — changed AND bumped (good); reinstall pending`);
    } else if (hVer !== null && hVer === ver && dirtyFiles.includes(file)) {
      WARN(`${file}: changed on disk but @version NOT bumped (R10) — ${hVer} == HEAD`);
    }
  }

  // @name should match filename (R10)
  if (kv.name && kv.name[0] !== base) {
    WARN(`${file}: @name "${kv.name[0]}" != filename "${base}"`);
  }

  // @author required (Jeyson's legacy credit — every script, 2026-08-06)
  if (!kv.author) {
    FAIL(`${file}: no @author — add "// @author       Jeyson Dagondon"`);
  } else if (kv.author[0] !== 'Jeyson Dagondon') {
    FAIL(`${file}: @author "${kv.author[0]}" != "Jeyson Dagondon"`);
  }

  // @match required (or @include)
  const HOST_WIDE = /^(\*|https?:\/\/\*\/\*|\*:\/\/*\/\*)$/;
  if (!kv.match && !kv.include) {
    WARN(`${file}: no @match/@include — installs nowhere by default`);
  } else {
    if (kv.match && kv.match.some(m => HOST_WIDE.test(m))) {
      WARN(`${file}: @match "${kv.match.join(', ')}" is host-wide`);
    }
    if (kv.include && kv.include.some(m => HOST_WIDE.test(m))) {
      WARN(`${file}: @include "${kv.include.join(', ')}" is host-wide`);
    }
  }

  // @grant presence + GM_* usage consistency (typeof-guarded usage is a valid fallback)
  const grants = (kv.grant || ['none']).join(' ');
  const gmCallRe = /GM_[A-Za-z]+(?=\()/g;
  let gmCalls = [];
  let gmMatch;
  while ((gmMatch = gmCallRe.exec(src)) !== null) {
    const back = src.slice(Math.max(0, gmMatch.index - 100), gmMatch.index);
    if (!back.includes(`typeof ${gmMatch[0]}`)) gmCalls.push(gmMatch[0]);
  }
  gmCalls = [...new Set(gmCalls)];
  if (grants === 'none' && gmCalls.length) {
    FAIL(`${file}: @grant none but unguarded GM_* calls (${gmCalls.join(', ')}) — broken by design`);
  } else if (!kv.grant && gmCalls.length) {
    FAIL(`${file}: no @grant but unguarded GM_* calls (${gmCalls.join(', ')}) — sandbox off, GM_ undefined`);
  } else if (!kv.grant) {
    WARN(`${file}: no @grant (defaults to none — declare it, R10)`);
  }

  // @run-at (R10 wants it declared)
  if (!kv['run-at']) WARN(`${file}: no @run-at (defaults to document-idle)`);

  // @require — co-worker scripts must be self-contained (zero-config rule).
  // Personal scripts may carry one (ChatGPT meter needs the gpt-tokenizer
  // library) — surfaced as WARN so the exception stays visible, not silent.
  if (kv.require) WARN(`${file}: @require present (${kv.require.join(', ')}) — co-worker scripts must be self-contained`);

  // @description one-liner (R10); >200 chars is a wall of text
  const desc = (kv.description || [''])[0];
  if (desc.length > 200) {
    WARN(`${file}: @description ${desc.length} chars (R10 one-liner; target <= 80)`);
  } else if (desc.length > 80) {
    WARN(`${file}: @description ${desc.length} chars (target <= 80)`);
  }

  // --- 2. secrets (R12) -----------------------------------------------------
  const secretPat = /(password|passwd|secret|api[_-]?key|authorization)\s*[:=]\s*['"][^'"]{4,}/i;
  const secretHit = secretPat.exec(src);
  if (secretHit) {
    if (src.includes('R12 override')) {
      INFO(`${file}: hardcoded credentials present but carries the R12-override comment (documented user decision)`);
    } else {
      FAIL(`${file}: hardcoded credential pattern "${secretHit[0].slice(0, 40)}..." — R12`);;
    }
  }

  // --- 3. boot-log convention (R17) -----------------------------------------
  const ver = (kv.version || [''])[0];
  const bootLog = src.match(/console\.(info|log)\(\s*'\[([^\]]+) v(\d+(?:\.\d+)+)\]/);
  if (!bootLog) {
    WARN(`${file}: no versioned boot log — add 'console.info('[Name vX.Y.Z] boot');' (R17)`);
  } else if (ver && bootLog[3] !== ver) {
    FAIL(`${file}: boot log version "${bootLog[3]}" != @version "${ver}" — drift`);
  }

  // __VER__ const sync
  const verConst = src.match(/const\s+__VER__\s*=\s*'([^']+)'/);
  if (verConst && verConst[1] !== ver) {
    FAIL(`${file}: __VER__ "${verConst[1]}" != @version "${ver}"`);
  }

  // --- 4. empty catch surface -----------------------------------------------
  const emptyCatches = src.match(/catch\s*(\([^)]*\))?\s*\{\s*\}/g) || [];
  const emptyPromises = src.match(/\.catch\(\s*(function\s*\(\s*\)|\(\)\s*=>)\s*\{\s*\}\)/g) || [];
  const nEmpty = emptyCatches.length + emptyPromises.length;
  if (nEmpty > 0) WARN(`${file}: ${nEmpty} empty catch(es) — silent failure surface`);

  // --- 5. Trusted Types / innerHTML on docs.google.com -----------------------
  // Usage-aware: strip line comments first so a *mention* ("use replaceChildren,
  // not innerHTML") doesn't trip the WARN — only a real `innerHTML =` assignment
  // on a docs.google.com page can throw under Trusted Types.
  const codeOnly = src.replace(/^\s*\/\/.*$/gm, '');
  if (/docs\.google\.com/.test((kv.match || []).join(' ')) && /\binnerHTML\s*=/.test(codeOnly)) {
    WARN(`${file}: @match docs.google.com + innerHTML — Trusted Types will throw (Tracking Bus v2.2 lesson)`);
  }
}

// ---------------------------------------------------------------------------
// Extension drift gate (port-pins.json + verify-port.js).
// The GHL extension carries hashed copies of three userscripts. Nothing else in
// this repo notices when the master moves, so the repo gate runs it too.
// The extension folder's unpacked id derives from its absolute path, so it is
// found by pattern, never by a hardcoded id or timestamp.
// ---------------------------------------------------------------------------
(function gateExtension() {
  // The mirror used to be found by looking beside the repo, which only worked
  // while the repo lived in Dropbox/Source Folder. It does not any more, so try
  // every place it can plausibly be — env override first, then beside the repo,
  // then the Dropbox folder it actually sits in — and take the first real hit.
  // Each base is also searched ONE LEVEL DOWN: the mirror sits in a "Source Folder"
  // inside repos and inside Dropbox, and a gate that silently skips while the
  // master moves is the exact drift it exists to catch.
  const bases = [
    process.env.GHL_EXT_ROOT,
    path.resolve(ROOT, '..'),
    path.resolve(ROOT, '..', 'Source Folder'),
    'C:/Users/PC/Dropbox/Source Folder',
  ].filter(Boolean);

  const extIn = (dir) => {
    if (!fs.existsSync(dir)) return null;
    // Match the master folder by VERSION DIGIT, not a pinned `v11-` prefix. The
    // folder is `ghl-current-orders-delivery-review-v11.5--JMD-update` — a DOT
    // before the minor version — so the pinned prefix never matched and the drift
    // gate has been skipping (WARN, but enforcing nothing) while the extension
    // sits right there. A gate that cannot fail is not a gate.
    const mirror = fs.readdirSync(dir).find(d =>
      /^ghl-current-orders-delivery-review-v\d/i.test(d) &&
      fs.statSync(path.join(dir, d), { throwIfNoEntry: false })?.isDirectory());
    if (!mirror) return null;
    const cand = path.join(dir, mirror, 'ghl-current-orders-delivery-review-v11');
    return fs.statSync(cand, { throwIfNoEntry: false })?.isDirectory() ? cand : null;
  };

  let extDir = null;
  for (const base of bases) {
    extDir = extIn(base);
    if (extDir) break;
    const subs = fs.existsSync(base)
      ? fs.readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => path.join(base, e.name))
      : [];
    for (const sub of subs) {
      extDir = extIn(sub);
      if (extDir) break;
    }
    if (extDir) break;
  }
  const gate = extDir && path.join(extDir, 'verify-port.js');
  if (!gate || !fs.existsSync(gate)) {
    WARN(`GHL extension not found (looked in: ${bases.join(', ')}) — verify-port.js drift gate skipped`);
    return;
  }
  const r = spawnSync(process.execPath, ['verify-port.js'], { cwd: extDir, encoding: 'utf8' });
  if (r.status === 0) {
    INFO(`extension drift gate: ${(r.stdout.match(/RESULT: (.+)/) || [, '?'])[1]}`);
  } else {
    const drift = (r.stdout || '').split('\n').filter(l => l.includes('FAIL')).join(' | ');
    FAIL(`GHL extension drift gate (verify-port.js): ${drift || (r.stderr || '').split('\n')[0]}`);
  }
})();

// ---------------------------------------------------------------------------
// Unified-menu template bank gate (src/zoho/unified-menu/templates.json)
// The bank is the source of truth for the unified Template Menu. It checks
// parse + id/tuple integrity, the derived vial math (units, supply ±2wk, vial
// identity), the override backlog, and staleness — then runs the golden gate.
//
// The math block used to read `actives`/`volume`/`units`/`tiers`, fields the
// harvest never wrote, so its body never once executed for any of the 118
// entries: a gate that cannot fail is not a gate. It now reads `entry.math`,
// which harvest/derive-m.js derives from the harvested sentences and checks
// arithmetically.
// ---------------------------------------------------------------------------
(function gateTemplateBank() {
  const bankPath = path.join(ROOT, 'src', 'zoho', 'unified-menu', 'templates.json');
  if (!fs.existsSync(bankPath)) { WARN('unified-menu bank missing — gate skipped'); return; }
  let j;
  try { j = JSON.parse(fs.readFileSync(bankPath, 'utf8')); }
  catch (e) { FAIL(`unified-menu bank: JSON parse failed: ${e.message}`); return; }

  // A `$schema` pointer to a file that does not exist is a lie, and this one
  // pointed at nothing. The schema is now GENERATED from the bank
  // (harvest/make-schema.js), so it can never drift; this checks the pointer
  // still resolves.
  if (j.$schema) {
    const target = path.join(path.dirname(bankPath), String(j.$schema).replace(/^\.\//, ''));
    if (!fs.existsSync(target)) FAIL(`unified-menu bank: $schema points at missing ${j.$schema}`);
    else {
      try {
        const sch = JSON.parse(fs.readFileSync(target, 'utf8'));
        const undocumented = Object.keys(j).filter((k) => !(sch.properties || {})[k]);
        if (undocumented.length) FAIL(`unified-menu bank: schema does not document ${undocumented.join(', ')} — re-run harvest/make-schema.js`);
      } catch (e) { FAIL(`unified-menu bank: schema JSON unreadable: ${e.message}`); }
    }
  }

  const entries = [];
  for (const [g, arr] of Object.entries(j.groups || {})) for (const e of arr) entries.push(e);
  if (!entries.length) { WARN('unified-menu bank: no entries — gate skipped'); return; }

  // --- integrity: class, unique ids, no active tuple collisions, supersedes ---
  const ids = new Set();
  const tuples = new Set();
  let noClass = 0;
  for (const e of entries) {
    if (!e.id) { FAIL('unified-menu bank: entry with no id'); continue; }
    if (ids.has(e.id)) FAIL(`unified-menu bank: duplicate id ${e.id}`);
    ids.add(e.id);
    if (e.supersedes && !ids.has(e.supersedes)) WARN(`unified-menu bank: ${e.id} supersedes missing ${e.supersedes}`);
    if (!e.class) { noClass++; continue; }
    if (e.retired) continue;
    // GLP-1 stubs are per-patient calculator entries, not fixed pharmacy products.
    if (e.class === 'glp1') continue;
    const sms = e.sms || {};
    const math = e.math || {};
    for (const pk of e.pharmacies || []) {
      if (j.pharmacies && !j.pharmacies[pk]) { WARN(`unified-menu bank: ${e.id} references unknown pharmacy ${pk}`); continue; }
      // The SPEC's tuple is (drug set, pharmacy, concentration, volume, cadence).
      // That is unsatisfiable as written: NAD+ Light/Medium/Strong and the
      // Wolverine and Glow tiers share vial + cadence and differ ONLY by dose,
      // so the rule flags legitimate products. The dose-bearing sentence is part
      // of the identity, so it stays in the signature, and cadence is added on
      // top (this is the KLOW guard the SPEC is actually about).
      const vol = e.volume ?? (e.container && e.container.count) ?? math.volume ?? null;
      const sig = [e.name ?? e.label, pk, JSON.stringify(sms.conc ?? null), vol, JSON.stringify(e.cadence ?? null), JSON.stringify(sms.rx ?? null)].join('|');
      if (tuples.has(sig)) FAIL(`unified-menu bank: active tuple collision: ${sig}`);
      tuples.add(sig);
    }
  }
  if (noClass) FAIL(`unified-menu bank: ${noClass} entries have no \`class\` (the schema requires one)`);

  // --- math: the derived chain, checked, not assumed ---
  let mathOk = 0, mathPending = 0, altVialCount = 0;
  const pendingReasons = new Map();
  for (const e of entries) {
    const m = e.math;
    if (!m) continue;
    if (m.status !== 'ok') {
      mathPending++;
      const r = String(m.reason || 'not derivable').slice(0, 70);
      pendingReasons.set(r, (pendingReasons.get(r) || 0) + 1);
      continue;
    }
    mathOk++;
    altVialCount += (m.altVials || []).length;
    for (const c of m.checks) {
      if (c.ok) continue;
      // A tier that names a mg total but no mL volume cannot be identified at
      // all — nothing in the bank can then prove the right vial ships, so that
      // is a hard FAIL, not debt. A vial mismatch where BOTH sides state their
      // volume is a different physical product sharing a menu label: derive-math
      // registers it as an altVial with its own identity, so it is no longer a
      // contradiction. A units mismatch IS a contradiction inside one sentence,
      // and an actives mismatch means the entry cannot describe a real vial.
      if (c.name === 'actives') FAIL(`unified-menu bank: ${e.id} — ${c.detail}`);
      else if (c.name === 'vial' && /no mL volume|cannot be identified/.test(c.detail))
        FAIL(`unified-menu bank: ${e.id} — ${c.detail}`);
      else WARN(`unified-menu bank math debt: ${e.id} ${c.name} — ${c.detail}`);
    }
    for (const d of m.debt || []) WARN(`unified-menu bank label debt: ${e.id} — ${d}`);
  }
  if (altVialCount) INFO(`unified-menu bank: ${altVialCount} tiers carry a DISTINCT physical vial, registered as altVials with their own identity (they are no longer counted as contradictions against the entry's own vial)`);
  pendingReasons.forEach((n, r) => WARN(`unified-menu bank: ${n} entries with no derivable math (${r})`));

  // --- override backlog + staleness (debt, not failure) ---
  const stale = Date.now() / 86400000 - 60;
  let overrides = 0, staleCount = 0;
  for (const e of entries) {
    if (e.sentence || e.sentenceRefill || e.rxOverride) {
      overrides++;
      WARN(`unified-menu bank: override debt: ${e.id} (${[e.sentence ? 'sentence' : '', e.sentenceRefill ? 'sentenceRefill' : '', e.rxOverride ? 'rxOverride' : ''].filter(Boolean).join(', ')})`);
    }
    if (e.lastVerified && Date.now() / 86400000 - new Date(e.lastVerified).getTime() / 86400000 > stale) {
      staleCount++;
      WARN(`unified-menu bank: ${e.id} lastVerified ${e.lastVerified} > 60 days`);
    }
  }
  // An empty override backlog is not "no debt" — the harvest never populates
  // these fields, so say which it is instead of letting a clean count read as
  // a clean bank.
  if (!overrides) INFO('unified-menu bank: override backlog empty because the harvest stores no sentence/rxOverride fields — the SPEC gate 3 is vacuous until it does');
  INFO(`unified-menu bank: ${entries.length} entries, ${tuples.size} active tuples, math derived for ${mathOk} / pending ${mathPending}, ${staleCount} stale`);

  // --- golden-text gate: the bank AND the built script must match the originals ---
  const gate = path.join(ROOT, 'src', 'zoho', 'unified-menu', 'harvest', 'gate-golden.js');
  if (fs.existsSync(gate)) {
    const r = spawnSync(process.execPath, [gate], { encoding: 'utf8', cwd: path.dirname(gate) });
    const out = (r.stdout || '') + (r.stderr || '');
    if (r.status === 0 && /PASS/.test(out)) INFO('unified-menu bank: golden gate PASS (tracking + orderPlaced + reorder + blocks + built artifact byte-identical)');
    else FAIL('unified-menu bank: golden gate FAILED (exit ' + r.status + '):\n' + out.slice(0, 600));
  } else {
    WARN('unified-menu bank: golden gate script missing — skipped');
  }
})();

// ---------------------------------------------------------------------------
// Harness sweep (2026-09-27): run every offline _smoketest/verify-*.js.
//
// WHY: these harnesses existed but nothing invoked them. A gate nobody runs is
// decoration — that is exactly how verify-trackbus sat broken (`blobFor is not
// defined`) for four releases while still being cited as Tracking Bus's gate, and
// how verify-ohio-meds learned to cry wolf with 4 permanent false failures.
// Wiring them here means a regression in any of them fails the commit hook.
//
// Only pure-Node harnesses: the *.mjs ones drive CDP against a live browser and
// belong in their own live runs, not in a pre-commit gate.
// ---------------------------------------------------------------------------
const HARNESS_SKIP = new Set(['verify-all.js']);
const harnesses = fs.readdirSync(__dirname)
  .filter((f) => /^verify-.*\.js$/.test(f) && !HARNESS_SKIP.has(f))
  .sort();
const harnessFails = [];
let harnessPass = 0;
for (const h of harnesses) {
  const r = spawnSync(process.execPath, [path.join(__dirname, h)], { encoding: 'utf8', cwd: ROOT, timeout: 60000 });
  const out = ((r.stdout || '') + (r.stderr || '')).trim();
  const last = out.split('\n').filter(Boolean).pop() || '(no output)';
  if (r.error) {
    harnessFails.push(`${h}: harness crashed (${r.error.code || r.error.message}) — a gate that cannot run guards nothing`);
  } else if (r.status !== 0) {
    harnessFails.push(`${h}: FAILED — ${last.slice(0, 160)}`);
  } else {
    harnessPass++;
  }
}
if (harnessFails.length) harnessFails.forEach((f) => FAIL('harness sweep: ' + f));
INFO(`harness sweep: ${harnessPass}/${harnesses.length} offline harnesses green (${harnesses.length - harnessPass} failing)`);

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(`\nverify-all — ${checked} userscripts, ${files.length - checked} non-.user.js skipped, + GHL extension drift gate\n`);
if (infos.length) { console.log(`INFO (${infos.length}):`); infos.forEach(i => console.log('  • ' + i)); console.log(); }
if (warns.length) { console.log(`WARN (${warns.length}) — debt backlog:`); warns.forEach(w => console.log('  • ' + w)); console.log(); }
if (fails.length) { console.log(`FAIL (${fails.length}):`); fails.forEach(f => console.log('  ✗ ' + f)); console.log(); }

if (!gitAvailable) {
  console.log('git: unavailable — version-bump discipline NOT enforced');
} else if (dirtyFiles.length) {
  console.log(`git: ${dirtyFiles.length} .user.js file(s) dirty on disk (${dirtyFiles.join(', ')})`);
} else {
  console.log('git: working tree clean for .user.js files');
}

console.log(`\nRESULT: ${fails.length === 0 ? 'PASS (gate clear — WARNs are tracked debt)' : 'FAIL — fix before shipping'}`);

// ---------------------------------------------------------------------------
// --deep mode (2026-08-06): audits that are too slow/noisy for the default
// gate. Run: node _smoketest/verify-all.js --deep
//   1. retrofit pair audit — AST-parses themeretrofit-pass.py's RETRO table;
//      every pair's `new` must be present in its script and no RAW `old`
//      occurrence may remain (half-applied theme remaps = FAIL)
//   2. EOL consistency report — LF-only working-tree scripts (repo standard is
//      CRLF via autocrlf; LF is cosmetically fine, reported not failed)
// ---------------------------------------------------------------------------
if (process.argv.includes('--deep')) {
  const deepFails = [];
  const deepWarns = [];

  // --- 1. retrofit pair audit (via python AST dump) ---
  const py = [
    "import ast, json, sys",
    "tree = ast.parse(open('_smoketest/themeretrofit-pass.py', encoding='utf-8').read())",
    "out = {}",
    "for n in ast.walk(tree):",
    "  if isinstance(n, ast.Assign):",
    "    for t in n.targets:",
    "      if isinstance(t, ast.Name) and t.id == 'RETRO' and isinstance(n.value, ast.Dict):",
    "        for k, v in zip(n.value.keys, n.value.values):",
    "          if isinstance(k, ast.Constant) and isinstance(v, ast.List):",
    "            ps = []",
    "            for e in v.elts:",
    "              if isinstance(e, ast.Tuple) and len(e.elts) == 2:",
    "                try: ps.append([ast.literal_eval(e.elts[0]), ast.literal_eval(e.elts[1])])",
    "                except (ValueError, TypeError): pass  # TOKENS-concatenated pairs skip",
    "            out[k.value] = ps",
    "print(json.dumps(out))",
  ].join('\n');
  const dump = spawnSync('python', ['-c', py], { cwd: ROOT, encoding: 'utf8' });
  if (dump.status === 0) {
    let pairs;
    try { pairs = JSON.parse(dump.stdout); } catch (e) { pairs = null; }
    if (pairs) {
      for (const [file, plist] of Object.entries(pairs)) {
        const p = path.join(ROOT, file);
        if (!fs.existsSync(p)) { deepFails.push(`--deep: ${file}: retrofit target missing`); continue; }
        const src = fs.readFileSync(p, 'utf8');
        for (const [old, nw] of plist) {
          if (old.length < 4) continue;
          if (nw && !src.includes(nw)) deepFails.push(`--deep: ${file}: retrofit new string MISSING: ${nw.slice(0, 60)}`);
          // raw occurrence = not already wrapped in var(--ds- ...)
          const re = new RegExp(old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
          let m;
          while ((m = re.exec(src)) !== null) {
            const back = src.slice(Math.max(0, m.index - 30), m.index);
            if (!back.includes('var(--ds-')) deepFails.push(`--deep: ${file}: RAW old still present: ${old.slice(0, 50)}`);
          }
        }
      }
    } else {
      deepFails.push('--deep: retrofit table could not be parsed from themeretrofit-pass.py');
    }
  } else {
    deepFails.push(`--deep: python dump failed: ${(dump.stderr || '').split('\n')[0]}`);
  }

  // --- 2. EOL consistency report ---
  for (const file of files) {
    const b = fs.readFileSync(path.join(ROOT, file));
    const hasCRLF = b.includes(Buffer.from('\r\n'));
    const hasLF = b.includes(Buffer.from('\n'));
    if (hasLF && !hasCRLF) deepWarns.push(`${file}: LF-only working tree (cosmetic; autocrlf normalizes on commit)`);
  }

  console.log(`\nDEEP (${deepFails.length} fails, ${deepWarns.length} warns):`);
  deepFails.forEach(f => console.log('  ✗ ' + f));
  deepWarns.forEach(w => console.log('  • ' + w));
  if (deepFails.length) process.exit(1);
}
process.exit(fails.length === 0 ? 0 : 1);
