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

const ENV_FILE = path.join(__dirname, '..', '.env');
const env = loadEnv(ENV_FILE);

const REPO_OWNER  = env.REPO_OWNER  || 'gsarig';
const REPO_NAME   = env.REPO_NAME   || 'ootb-openstreetmap';
const PLUGIN_PATH = env.PLUGIN_PATH || null;

// Flag a PHP version as ACTION REQUIRED if EOL is within this many days.
const PHP_EOL_WARNING_DAYS = 180;

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
      find(T.ACTION, 'Leaflet.js',
        `Major update available: ${currentV} → ${latestV}`,
        'Major versions likely contain breaking changes. Review the changelog before upgrading.');
    } else if (latestV !== currentV) {
      find(T.MONITOR, 'Leaflet.js',
        `Update available: ${currentV} → ${latestV}`,
        'Minor / patch update — review changelog and test before upgrading.');
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

  for (const [pkg, info] of Object.entries(outdated)) {
    const isMajor    = majorOf(info.latest) > majorOf(info.current);
    const isRuntime  = info.type === 'dependencies';
    const tier       = isMajor && isRuntime ? T.ACTION : T.MONITOR;

    find(tier, 'npm dependencies',
      `${pkg}: ${info.current} → ${info.latest}${isMajor ? '  (MAJOR)' : ''}`,
      `Type: ${info.type || 'unknown'}`);
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
      if (f.detail) console.log(`  ${C.dim}${f.detail}${C.reset}`);
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
  checkNpmOutdated();
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
