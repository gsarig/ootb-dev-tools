#!/usr/bin/env node
/**
 * test.js
 *
 * Prints step-by-step testing instructions for a feature PR and writes
 * a ready-to-use tester prompt to tmp/test-<pr>.tmp.
 *
 * Expects handoff.tmp to exist in PLUGIN_PATH (written by the implementer session).
 *
 * With a PR number: shows instructions for that PR immediately.
 * Without a PR number: lists open feature PRs targeting the current release
 * branch and prompts the user to pick one.
 *
 * Usage:
 *   node scripts/test.js [pr-number]
 *   npm run test -- 87
 *   npm run test
 */

'use strict';

const { spawnSync } = require('child_process');
const readline      = require('readline');
const fs            = require('fs');
const path          = require('path');

// ─── Config ────────────────────────────────────────────────────────────────

const ROOT        = path.join(__dirname, '..');
const ENV_FILE    = path.join(ROOT, '.env');
const TMP_DIR     = path.join(ROOT, 'tmp');
const AGENT_FILE  = path.join(ROOT, 'agents', 'tester.md');

const env         = loadEnv(ENV_FILE);
const REPO_OWNER  = env.REPO_OWNER  || 'gsarig';
const REPO_NAME   = env.REPO_NAME   || 'ootb-openstreetmap';
const PLUGIN_PATH = (env.PLUGIN_PATH || '').replace(/\/$/, '');

// ─── Colors ─────────────────────────────────────────────────────────────────

const C = {
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  reset:  '\x1b[0m',
};

// ─── Utilities ───────────────────────────────────────────────────────────────

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return {};
  return fs.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.startsWith('#'))
    .reduce((acc, l) => {
      const eq = l.indexOf('=');
      if (eq > 0) acc[l.slice(0, eq).trim()] = l.slice(eq + 1).trim();
      return acc;
    }, {});
}

function ghJson(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error((r.stderr || '').trim() || `gh exited with status ${r.status}`);
  }
  return JSON.parse(r.stdout);
}

function die(msg) {
  console.error(`\nError: ${msg}\n`);
  process.exit(1);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim()); }));
}

// ─── Core: print instructions for a given PR ────────────────────────────────

function run(prNumber) {
  let pr;
  try {
    pr = ghJson([
      'pr', 'view', String(prNumber),
      '--repo', `${REPO_OWNER}/${REPO_NAME}`,
      '--json', 'title,headRefName,url',
    ]);
  } catch (err) {
    die(`Could not fetch PR #${prNumber}: ${err.message}`);
  }

  const branch = pr.headRefName;
  const title  = pr.title;
  const prUrl  = pr.url;

  if (!fs.existsSync(AGENT_FILE)) die(`Agent file not found: ${AGENT_FILE}`);
  const agentTemplate = fs.readFileSync(AGENT_FILE, 'utf8');

  const handoffPath   = PLUGIN_PATH ? path.join(PLUGIN_PATH, `handoff-${prNumber}.tmp`) : null;
  const handoffExists = handoffPath && fs.existsSync(handoffPath);
  const handoffNote   = handoffExists
    ? `${C.green}Found:${C.reset} ${handoffPath}`
    : `${C.yellow}Not found yet${C.reset} — the implementer session must complete first`;

  let prompt = agentTemplate.replace(
    /<!-- EXPECTED_BRANCH -->/,
    `**Expected branch:** \`${branch}\``
  );
  if (handoffExists) {
    const handoff = fs.readFileSync(handoffPath, 'utf8').trim();
    prompt = prompt.replace(
      /## Handoff summary\s*\n+<!-- Paste the contents of handoff\.tmp from Session A here -->/,
      `## Handoff summary\n\n\`\`\`\n${handoff}\n\`\`\``
    );
  }

  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  const outFile = path.join(TMP_DIR, `test-${prNumber}.tmp`);
  fs.writeFileSync(outFile, prompt, 'utf8');

  const pluginDir = PLUGIN_PATH || '<PLUGIN_PATH>';

  console.log(`
${C.bold}Test — PR #${prNumber}${C.reset}
${C.dim}${title}${C.reset}
${C.dim}${prUrl}${C.reset}

${C.bold}Branch:${C.reset} ${branch}
${C.bold}Handoff:${C.reset} ${handoffNote}

${C.bold}Steps${C.reset}

  ${C.cyan}1.${C.reset} Make sure you are on the feature branch in the plugin directory:

       cd ${pluginDir}
       git checkout ${branch}

  ${C.cyan}2.${C.reset} Start a ${C.bold}new${C.reset} Claude Code session in the plugin directory and send
     this as your opening message:

       ${C.green}Read and follow ${outFile}${C.reset}
${handoffExists ? '' : `
  ${C.yellow}Note:${C.reset} handoff-${prNumber}.tmp was not found — run the implementer session first,
     then re-run ${C.bold}npm run test -- ${prNumber}${C.reset} to regenerate the prompt with the handoff included.
`}
  ${C.cyan}3.${C.reset} The tester will propose test cases and wait for your confirmation
     before writing anything. Review the proposal, then approve.

  ${C.cyan}4.${C.reset} Once tests pass, push the branch — PR #${prNumber} is already open.

`);
}

// ─── Pick mode: list open feature PRs and prompt for a choice ───────────────

async function pick() {
  let allPRs;
  try {
    allPRs = ghJson([
      'pr', 'list',
      '--repo', `${REPO_OWNER}/${REPO_NAME}`,
      '--state', 'open',
      '--json', 'number,title,headRefName,baseRefName,isDraft',
      '--limit', '50',
    ]);
  } catch (err) {
    die(`Could not fetch PR list: ${err.message}`);
  }

  const releasePR = allPRs
    .filter(p => p.headRefName.startsWith('release/'))
    .sort((a, b) => b.headRefName.localeCompare(a.headRefName))[0];

  const releaseBranch = releasePR?.headRefName;

  const featurePRs = allPRs.filter(p =>
    p.headRefName.startsWith('feature/') &&
    (releaseBranch ? p.baseRefName === releaseBranch : p.baseRefName.startsWith('release/'))
  );

  if (featurePRs.length === 0) {
    const target = releaseBranch ? `targeting ${releaseBranch}` : 'targeting any release branch';
    die(`No open feature PRs found ${target}.`);
  }

  console.log(`
${C.bold}Available feature PRs${C.reset}${releaseBranch ? ` ${C.dim}(${releaseBranch})${C.reset}` : ''}
`);

  featurePRs.forEach((p, i) => {
    const draft = p.isDraft ? ` ${C.dim}[draft]${C.reset}` : '';
    console.log(`  ${C.cyan}${i + 1}.${C.reset} #${p.number}  ${p.title}${draft}`);
  });

  console.log();
  const answer = await ask('Pick a number (or enter a PR number directly): ');

  let chosen;
  const idx = parseInt(answer, 10);

  if (idx >= 1 && idx <= featurePRs.length) {
    chosen = featurePRs[idx - 1].number;
  } else if (idx > 0) {
    chosen = idx;
  } else {
    die('Invalid selection.');
  }

  console.log();
  run(chosen);
}

// ─── Entry point ─────────────────────────────────────────────────────────────

const arg = parseInt(process.argv[2], 10);
if (arg) {
  run(arg);
} else {
  pick().catch(err => die(err.message));
}
