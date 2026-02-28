#!/usr/bin/env node
/**
 * compatibility-check.js
 *
 * Monitors external dependencies and ecosystem changes that may affect
 * ootb-openstreetmap. Run monthly or before each planning cycle.
 *
 * Requires: Node 18+, gh CLI (authenticated)
 * Optional: PLUGIN_PATH in .env — enables npm outdated and composer checks
 *
 * Output tiers:
 *   ACTION REQUIRED — needs attention before next release
 *   MONITOR         — watch but no immediate action needed
 *   NO ACTION NEEDED — noted for completeness
 *
 * If any ACTION REQUIRED items are found, a GitHub issue is opened
 * in the plugin repo tagged `maintenance`.
 */

'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const CONFIG_DIR  = path.join(__dirname, '..', 'config');
const ENV_FILE    = path.join(__dirname, '..', '.env');
const env         = loadEnv(ENV_FILE);

const REPO_OWNER  = env.REPO_OWNER  || 'gsarig';
const REPO_NAME   = env.REPO_NAME   || 'ootb-openstreetmap';
const PLUGIN_PATH = env.PLUGIN_PATH || null;

const settings = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'settings.json'), 'utf8'));
const PHP_EOL_WARNING_DAYS = settings.phpEolWarningDays;

// ---------------------------------------------------------------------------
// Upgrade blockers
// ---------------------------------------------------------------------------
// config/blockers.json tracks packages that cannot be bumped yet. Each entry
// records why the upgrade is blocked and the latest version available when the
// block was added, so a new release can be flagged for a re-check.
//
// Schema:
//   {
//     "package-name": {
//       "reason":        "Short explanation of the blocker",
//       "since":         "YYYY-MM-DD",
//       "latestAtBlock": "X.Y.Z"
//     }
//   }

let BLOCKERS = {};
try {
  BLOCKERS = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, 'blockers.json'), 'utf8'));
} catch { /* file absent or malformed — treat as no blockers */ }

/**
 * Returns a multi-line annotation string if pkg is in blockers.json, null otherwise.
 * latestVersion — the version currently available from the registry / npm outdated.
 * When it differs from latestAtBlock a re-check prompt is added.
 */
function getBlockerNote(pkgName, latestVersion) {
  const b = BLOCKERS[pkgName];
  if (!b) return null;
  const lines = [`⚠ Blocked since ${b.since}: ${b.reason}`];
  if (latestVersion && b.latestAtBlock && latestVersion !== b.latestAtBlock) {
    lines.push(
      `↻ New release (${latestVersion}) available since block was recorded at ${b.latestAtBlock} — re-check whether this resolves the issue`
    );
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Tiers and colours
// ---------------------------------------------------------------------------

const T = {
  ACTION:  'ACTION REQUIRED',
  MONITOR: 'MONITOR',
  OK:      'NO ACTION NEEDED',
};

const C = {
  red:   '\x1b[31m',
  yellow:'\x1b[33m',
  green: '\x1b[32m',
  bold:  '\x1b[1m',
  dim:   '\x1b[2m',
  reset: '\x1b[0m',
};

function tierColour(tier) {
  if (tier === T.ACTION)  return C.red;
  if (tier === T.MONITOR) return C.yellow;
  return C.green;
}

// ---------------------------------------------------------------------------
// Findings store
// ---------------------------------------------------------------------------

/** @type {Array<{tier: string, category: string, message: string, detail: string}>} */
const findings = [];

function find(tier, category, message, detail = '') {
  findings.push({ tier, category, message, detail });
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(line => line.trim() && !line.startsWith('#'))
    .reduce((acc, line) => {
      const eq = line.indexOf('=');
      if (eq > 0) acc[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      return acc;
    }, {});
}

async function fetchJSON(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'ootb-dev-tools/compatibility-check' },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return res.json();
}

function readPluginFile(filename) {
  if (!PLUGIN_PATH) return null;
  const p = path.join(PLUGIN_PATH, filename);
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function daysUntil(dateStr) {
  return Math.ceil((new Date(dateStr) - Date.now()) / 864e5);
}

function majorOf(version) {
  return parseInt(String(version || '0').replace(/^[^\d]*/, '').split('.')[0], 10);
}

function stripRange(version) {
  return String(version || '').replace(/^[^\d]*/, '');
}

// ---------------------------------------------------------------------------
// Check: WordPress core
// ---------------------------------------------------------------------------

async function checkWordPress() {
  log('Checking WordPress core…');
  try {
    const data = await fetchJSON('https://api.wordpress.org/core/version-check/1.7/');
    const offers = data.offers || [];

    const stable = offers.find(o => ['upgrade', 'latest'].includes(o.response));
    const beta   = offers.find(o => o.response === 'development');

    if (beta) {
      find(T.MONITOR, 'WordPress Core',
        `Beta / RC available: ${beta.version}`,
        'Test the plugin against this build before it reaches stable.');
    }
    if (stable) {
      find(T.OK, 'WordPress Core',
        `Current stable: ${stable.version}`,
        stable.php_version ? `Requires PHP ${stable.php_version}+` : '');
    }
  } catch (err) {
    find(T.MONITOR, 'WordPress Core', `Check failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Check: Gutenberg
// ---------------------------------------------------------------------------

async function checkGutenberg() {
  log('Checking Gutenberg…');
  try {
    const data = await fetchJSON(
      'https://api.github.com/repos/WordPress/gutenberg/releases/latest'
    );
    const version   = data.tag_name || data.name || 'unknown';
    const published = data.published_at
      ? new Date(data.published_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
      : '';

    find(T.MONITOR, 'Gutenberg',
      `Latest release: ${version}${published ? ` (${published})` : ''}`,
      'Review changelog for block API or server-side rendering changes.');
  } catch (err) {
    find(T.MONITOR, 'Gutenberg', `Check failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Check: PHP EOL
// ---------------------------------------------------------------------------

async function checkPHP() {
  log('Checking PHP EOL dates…');
  try {
    const versions = await fetchJSON('https://endoflife.date/api/php.json');
    const composer = readPluginFile('composer.json');
    const minPhp   = composer?.require?.php?.replace(/[^\d.].*/, '') || null;

    for (const v of versions) {
      if (!v.eol || v.eol === false) continue;
      const days = daysUntil(v.eol);
      if (days < 0) continue; // already EOL — not relevant

      const detail = minPhp
        ? `Plugin requires PHP ${minPhp}+. Confirm ${v.cycle} is not your minimum supported version.`
        : 'Check plugin minimum PHP version requirements.';

      if (days <= PHP_EOL_WARNING_DAYS) {
        find(T.ACTION, 'PHP',
          `PHP ${v.cycle} reaches EOL on ${v.eol} (${days} days away)`,
          detail);
      } else if (days <= 365) {
        find(T.MONITOR, 'PHP',
          `PHP ${v.cycle} reaches EOL on ${v.eol} (${Math.ceil(days / 30)} months away)`,
          'Plan to drop support if needed in an upcoming release.');
      }
    }
  } catch (err) {
    find(T.MONITOR, 'PHP', `Check failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Check: Leaflet.js
// ---------------------------------------------------------------------------

async function checkLeaflet() {
  log('Checking Leaflet.js…');
  try {
    const latest  = await fetchJSON('https://registry.npmjs.org/leaflet/latest');
    const latestV = latest.version;

    const pkg     = readPluginFile('package.json');
    const currentRange = pkg?.dependencies?.leaflet || pkg?.devDependencies?.leaflet || null;

    if (!currentRange) {
      find(T.MONITOR, 'Leaflet.js',
        `Latest: ${latestV}`,
        'Set PLUGIN_PATH in .env to compare against the version in use.');
      return;
    }

    const currentV      = stripRange(currentRange);
    const currentMajor  = majorOf(currentV);
    const latestMajor   = majorOf(latestV);

    if (latestMajor > currentMajor) {
      const note = getBlockerNote('leaflet', latestV);
      find(T.ACTION, 'Leaflet.js',
        `Major update available: ${currentV} → ${latestV}`,
        ['Major versions likely contain breaking changes. Review the changelog before upgrading.', note]
          .filter(Boolean).join('\n'));
    } else if (latestV !== currentV) {
      const note = getBlockerNote('leaflet', latestV);
      find(T.MONITOR, 'Leaflet.js',
        `Update available: ${currentV} → ${latestV}`,
        ['Minor / patch update — review changelog and test before upgrading.', note]
          .filter(Boolean).join('\n'));
    } else {
      find(T.OK, 'Leaflet.js', `Up to date: ${currentV}`);
    }
  } catch (err) {
    find(T.MONITOR, 'Leaflet.js', `Check failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Check: npm outdated
// ---------------------------------------------------------------------------

function checkNpmOutdated() {
  if (!PLUGIN_PATH) {
    find(T.MONITOR, 'npm dependencies',
      'Skipped — set PLUGIN_PATH in .env to enable this check.');
    return;
  }

  log('Checking npm outdated…');

  // Read dependency type directly from package.json — npm outdated --json
  // does not include a `type` field in its output.
  const pkg         = readPluginFile('package.json');
  const runtimeDeps = new Set(Object.keys(pkg?.dependencies     || {}));
  const devDeps     = new Set(Object.keys(pkg?.devDependencies  || {}));

  // spawnSync used deliberately: npm outdated exits 1 when packages are outdated,
  // which would cause execSync to throw. spawnSync returns the output regardless.
  const result = spawnSync('npm', ['outdated', '--json'], {
    cwd: PLUGIN_PATH,
    encoding: 'utf8',
  });

  let outdated = {};
  try { outdated = JSON.parse(result.stdout || '{}'); } catch { /* empty output */ }

  if (Object.keys(outdated).length === 0) {
    find(T.OK, 'npm dependencies', 'All packages up to date.');
    return;
  }

  for (const [name, info] of Object.entries(outdated)) {
    const isMajor   = majorOf(info.latest) > majorOf(info.current);
    const isRuntime = runtimeDeps.has(name);
    const depType   = isRuntime ? 'dependency' : devDeps.has(name) ? 'devDependency' : 'unknown';
    const tier      = isMajor && isRuntime ? T.ACTION : T.MONITOR;
    const note      = getBlockerNote(name, info.latest);

    find(tier, 'npm dependencies',
      `${name}: ${info.current} → ${info.latest}${isMajor ? '  (MAJOR)' : ''}`,
      [`Type: ${depType}`, note].filter(Boolean).join('\n'));
  }
}

// ---------------------------------------------------------------------------
// Check: npm audit (known vulnerabilities)
// ---------------------------------------------------------------------------

function checkNpmAudit() {
  if (!PLUGIN_PATH) return; // already noted in npm outdated check

  log('Checking npm audit…');

  // spawnSync used deliberately: npm audit exits 1 when vulnerabilities are found.
  const result = spawnSync('npm', ['audit', '--json'], {
    cwd: PLUGIN_PATH,
    encoding: 'utf8',
  });

  let data = {};
  try { data = JSON.parse(result.stdout || '{}'); } catch { return; }

  const vulns = data.vulnerabilities || {};
  const meta  = data.metadata?.vulnerabilities || {};

  if ((meta.total || Object.keys(vulns).length) === 0) {
    find(T.OK, 'npm audit', 'No known vulnerabilities found.');
    return;
  }

  // Only report ROOT vulnerabilities — packages where the advisory is direct
  // (via[] contains an object with a title), not transitive cascades (via[] is strings).
  // This avoids listing every package that depends on a vulnerable transitive dep.
  const rootVulns = Object.entries(vulns).filter(([, v]) =>
    (v.via || []).some(entry => typeof entry === 'object' && entry.title)
  );

  const counts = { critical: 0, high: 0, moderate: 0, low: 0, info: 0 };
  for (const [, v] of rootVulns) {
    const sev = (v.severity || 'info').toLowerCase();
    if (sev in counts) counts[sev]++;
  }

  const parts = Object.entries(counts)
    .filter(([, n]) => n > 0)
    .map(([s, n]) => `${n} ${s}`);
  const total   = rootVulns.length;
  const summary = `${total} root ${total === 1 ? 'vulnerability' : 'vulnerabilities'} (${parts.join(', ')}) — ${meta.total || Object.keys(vulns).length} total including transitive`;

  const tier = (counts.critical > 0 || counts.high > 0) ? T.ACTION : T.MONITOR;
  find(tier, 'npm audit', summary, 'Run `npm audit` in the plugin directory for full details.');

  // Group root vulnerabilities by their fix package so that one `npm` bump = one task
  const SEV_ORDER = ['critical', 'high', 'moderate', 'low', 'info'];
  const fixGroups = new Map();
  for (const [name, v] of rootVulns) {
    const fa = v.fixAvailable;
    let fixKey, fixPkg, fixVersion, isMajor;
    if (!fa) {
      fixKey = '__no_fix__'; fixPkg = null; fixVersion = null; isMajor = false;
    } else if (fa === true) {
      fixKey = name; fixPkg = name; fixVersion = null; isMajor = false;
    } else {
      // fa === { name, version, isSemVerMajor }
      fixKey = fa.name; fixPkg = fa.name; fixVersion = fa.version; isMajor = fa.isSemVerMajor || false;
    }
    if (!fixGroups.has(fixKey)) fixGroups.set(fixKey, { fixPkg, fixVersion, isMajor, members: [] });
    const title = v.via.find(e => typeof e === 'object')?.title || '';
    fixGroups.get(fixKey).members.push({ name, sev: (v.severity || 'info').toLowerCase(), title });
  }

  for (const [fixKey, { fixPkg, fixVersion, isMajor, members }] of fixGroups) {
    const worstSev = members.reduce((w, m) => {
      const wi = SEV_ORDER.indexOf(w), mi = SEV_ORDER.indexOf(m.sev);
      return (mi !== -1 && (wi === -1 || mi < wi)) ? m.sev : w;
    }, 'info');
    const tier = (worstSev === 'critical' || worstSev === 'high') ? T.ACTION : T.MONITOR;

    let message;
    if (fixKey === '__no_fix__') {
      message = `No fix available — ${members.map(m => m.name).join(', ')}`;
    } else if (fixVersion) {
      message = `Bump ${fixPkg} → ${fixVersion}${isMajor ? ' (MAJOR)' : ''} — fixes ${members.length} ${members.length === 1 ? 'vulnerability' : 'vulnerabilities'}`;
    } else {
      message = `Update ${fixPkg} — fixes ${members.length} ${members.length === 1 ? 'vulnerability' : 'vulnerabilities'}`;
    }

    const memberLines = members.map(m =>
      `  ${m.name} — ${m.sev.toUpperCase()}${m.title ? ': ' + m.title : ''}`
    );
    const note   = fixPkg ? getBlockerNote(fixPkg, fixVersion) : null;
    const detail = [...memberLines, note].filter(Boolean).join('\n');
    find(tier, 'npm audit', message, detail);
  }
}

// ---------------------------------------------------------------------------
// Check: Composer audit (known vulnerabilities)
// ---------------------------------------------------------------------------

function checkComposerAudit() {
  if (!PLUGIN_PATH) return;

  log('Checking Composer audit…');

  const result = spawnSync('composer', ['audit', '--format=json', '--no-dev'], {
    cwd: PLUGIN_PATH,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.error || result.status === 127) return; // composer not installed

  let data = { advisories: {} };
  try { data = JSON.parse(result.stdout || '{"advisories":{}}'); } catch { return; }

  const advisories = Object.values(data.advisories || {}).flat();

  if (advisories.length === 0) {
    find(T.OK, 'Composer audit', 'No known vulnerabilities found.');
    return;
  }

  for (const a of advisories) {
    find(T.ACTION, 'Composer audit',
      `${a.packageName}: ${a.title}`,
      a.cve ? `CVE: ${a.cve}  ${a.link || ''}` : (a.link || ''));
  }
}

// ---------------------------------------------------------------------------
// Check: Composer runtime dependencies
// ---------------------------------------------------------------------------

function checkComposer() {
  if (!PLUGIN_PATH) return; // already noted in npm check

  log('Checking Composer dependencies…');

  const result = spawnSync('composer', ['outdated', '--format=json', '--no-dev'], {
    cwd: PLUGIN_PATH,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  if (result.error || result.status === 127) return; // composer not installed

  let data = { installed: [] };
  try { data = JSON.parse(result.stdout || '{"installed":[]}'); } catch { return; }

  const outdated = data.installed || [];

  if (outdated.length === 0) {
    find(T.OK, 'Composer dependencies', 'All runtime packages up to date.');
    return;
  }

  for (const pkg of outdated) {
    const isMajor = majorOf(pkg.latest) > majorOf(pkg.version);
    find(isMajor ? T.ACTION : T.MONITOR, 'Composer dependencies',
      `${pkg.name}: ${pkg.version} → ${pkg.latest}${isMajor ? '  (MAJOR)' : ''}`,
      pkg['latest-status'] || '');
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function printReport() {
  const date = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  console.log(`\n${C.bold}${'━'.repeat(54)}${C.reset}`);
  console.log(`${C.bold}  Compatibility Report — ${date}${C.reset}`);
  console.log(`${C.bold}${'━'.repeat(54)}${C.reset}\n`);

  for (const tier of [T.ACTION, T.MONITOR, T.OK]) {
    const group = findings.filter(f => f.tier === tier);
    if (group.length === 0) continue;

    console.log(`${tierColour(tier)}${C.bold}${tier}${C.reset}`);
    for (const f of group) {
      console.log(`  ${C.bold}[${f.category}]${C.reset} ${f.message}`);
      if (f.detail) f.detail.split('\n').forEach(line => console.log(`  ${C.dim}${line}${C.reset}`));
    }
    console.log();
  }

  const actionCount = findings.filter(f => f.tier === T.ACTION).length;
  if (actionCount > 0) {
    console.log(`${C.red}${C.bold}${actionCount} item(s) require action.${C.reset}`);
    console.log(`${C.dim}Opening a GitHub issue in ${REPO_OWNER}/${REPO_NAME}…${C.reset}\n`);
  } else {
    console.log(`${C.green}All checks passed — no immediate action required.${C.reset}\n`);
  }
}

// ---------------------------------------------------------------------------
// GitHub issue
// ---------------------------------------------------------------------------

async function createGitHubIssue() {
  const actionItems  = findings.filter(f => f.tier === T.ACTION);
  const monitorItems = findings.filter(f => f.tier === T.MONITOR);
  const date = new Date().toISOString().split('T')[0];

  const lines = [
    `## Compatibility check — ${date}`,
    '',
    '### Action Required',
    ...actionItems.map(f =>
      `- **[${f.category}]** ${f.message}${f.detail ? `\n  ${f.detail}` : ''}`
    ),
  ];

  if (monitorItems.length > 0) {
    lines.push('', '### Monitor');
    monitorItems.forEach(f =>
      lines.push(`- **[${f.category}]** ${f.message}${f.detail ? `\n  ${f.detail}` : ''}`)
    );
  }

  lines.push('', `_Generated by \`compatibility-check.js\` on ${date}_`);

  const body  = lines.join('\n');
  const title = `Compatibility check: action required (${date})`;

  try {
    const url = execSync(
      `gh issue create --repo ${REPO_OWNER}/${REPO_NAME} ` +
      `--title ${JSON.stringify(title)} ` +
      `--body ${JSON.stringify(body)} ` +
      `--label maintenance`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    console.log(`${C.green}Issue opened: ${url}${C.reset}\n`);
  } catch (err) {
    // Label may not exist yet — print instructions rather than failing silently
    console.log(`${C.yellow}Could not open GitHub issue: ${err.message.split('\n')[0]}${C.reset}`);
    console.log(`${C.dim}Tip: create a 'maintenance' label in the plugin repo first:${C.reset}`);
    console.log(`${C.dim}  gh label create maintenance --repo ${REPO_OWNER}/${REPO_NAME} --color "#e4e669"${C.reset}\n`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function log(msg) {
  console.log(`${C.dim}  ${msg}${C.reset}`);
}

async function main() {
  console.log(`\n${C.bold}Running compatibility checks…${C.reset}`);
  console.log(
    `${C.dim}Repo: ${REPO_OWNER}/${REPO_NAME}` +
    (PLUGIN_PATH ? ` | Plugin: ${PLUGIN_PATH}` : ' | No PLUGIN_PATH set (npm/composer checks skipped)') +
    C.reset + '\n'
  );

  await checkWordPress();
  await checkGutenberg();
  await checkPHP();
  await checkLeaflet();
  checkNpmAudit();
  checkNpmOutdated();
  checkComposerAudit();
  checkComposer();

  printReport();

  if (findings.some(f => f.tier === T.ACTION)) {
    await createGitHubIssue();
  }
}

main().catch(err => {
  console.error(`\n${C.red}${C.bold}Fatal: ${err.message}${C.reset}\n`);
  process.exit(1);
});
