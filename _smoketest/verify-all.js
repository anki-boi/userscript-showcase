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
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
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
    if (hVer !== null && hVer !== ver && dirtyFiles.includes(file)) {
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
  const bases = [
    process.env.GHL_EXT_ROOT,
    path.resolve(ROOT, '..'),
    'C:/Users/PC/Dropbox/Source Folder',
  ].filter(Boolean);
  let extDir = null;
  for (const base of bases) {
    if (!fs.existsSync(base)) continue;
    const mirror = fs.readdirSync(base).find(d =>
      d.startsWith('ghl-current-orders-delivery-review-v11-') &&
      fs.statSync(path.join(base, d), { throwIfNoEntry: false })?.isDirectory());
    if (!mirror) continue;
    const cand = path.join(base, mirror, 'ghl-current-orders-delivery-review-v11');
    if (fs.statSync(cand, { throwIfNoEntry: false })?.isDirectory()) { extDir = cand; break; }
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
