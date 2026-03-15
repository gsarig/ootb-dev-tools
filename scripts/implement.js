#!/usr/bin/env node
/**
 * implement.js
 *
 * Prints step-by-step implementation instructions for a feature PR and writes
 * a ready-to-use implementer prompt to tmp/implement-<pr>.tmp.
 *
 * With a PR number: shows instructions for that PR immediately.
 * Without a PR number: lists open feature PRs targeting the current release
 * branch and prompts the user to pick one.
 *
 * Usage:
 *   node scripts/implement.js [pr-number]
 *   npm run implement -- 87
 *   npm run implement
 */

'use strict';

const { spawnSync }  = require('child_process');
const readline       = require('readline');
const fs             = require('fs');
const path           = require('path');

// ─── Config ────────────────────────────────────────────────────────────────

const ROOT        = path.join(__dirname, '..');
const ENV_FILE    = path.join(ROOT, '.env');
const TMP_DIR     = path.join(ROOT, 'tmp');
const AGENT_FILE  = path.join(ROOT, 'agents', 'implementer.md');

const env         = loadEnv(ENV_FILE);
const REPO_OWNER  = env.REPO_OWNER  || '';
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

function prompt(question) {
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
      '--json', 'title,body,headRefName,url',
    ]);
  } catch (err) {
    die(`Could not fetch PR #${prNumber}: ${err.message}`);
  }

  const branch = pr.headRefName;
  const title  = pr.title;
  const body   = pr.body;
  const prUrl  = pr.url;

  if (!fs.existsSync(AGENT_FILE)) die(`Agent file not found: ${AGENT_FILE}`);
  const agentTemplate = fs.readFileSync(AGENT_FILE, 'utf8');

  const handoffFile = `handoff-${prNumber}.tmp`;
  const brief  = `## Brief\n\n${body.trim()}`;
  const prompt = agentTemplate
    .replace(
      /<!-- EXPECTED_BRANCH -->/,
      `**Expected branch:** \`${branch}\``
    )
    .replace(
      /<!-- HANDOFF_FILE -->/,
      handoffFile
    )
    .replace(
      /## Brief\s*\n+<!-- Paste the feature PR description or task here -->/,
      brief
    );

  if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
  const outFile = path.join(TMP_DIR, `implement-${prNumber}.tmp`);
  fs.writeFileSync(outFile, prompt, 'utf8');

  const pluginDir = PLUGIN_PATH || '<PLUGIN_PATH>';

  console.log(`
${C.bold}Implement — PR #${prNumber}${C.reset}
${C.dim}${title}${C.reset}
${C.dim}${prUrl}${C.reset}

${C.bold}Branch:${C.reset} ${branch}

${C.bold}Steps${C.reset}

  ${C.cyan}1.${C.reset} Check out the feature branch in the plugin directory:

       cd ${pluginDir}
       git checkout ${branch}

  ${C.cyan}2.${C.reset} Start a Claude Code session in the plugin directory and send this
     as your opening message:

       ${C.green}Read and follow ${outFile}${C.reset}

  ${C.cyan}3.${C.reset} The agent will implement the feature, run ${C.bold}make lint${C.reset} and ${C.bold}make phpunit${C.reset},
     and write ${C.bold}${handoffFile}${C.reset} in the plugin directory when done.

  ${C.cyan}4.${C.reset} Once the session is complete, run the tester:

       npm run test -- ${prNumber}

`);
}

// ─── Pick mode: list open feature PRs and prompt for a choice ───────────────

async function pick() {
  // Find the latest open release branch
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

  // Find the release branch (most recent release/x.y.z)
  const releasePR = allPRs
    .filter(p => p.headRefName.startsWith('release/'))
    .sort((a, b) => b.headRefName.localeCompare(a.headRefName))[0];

  const releaseBranch = releasePR?.headRefName;

  // Feature PRs: head starts with feature/, base is the release branch (or release/* if no release PR found)
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
  const answer = await prompt('Pick a number (or enter a PR number directly): ');

  let chosen;
  const idx = parseInt(answer, 10);

  if (idx >= 1 && idx <= featurePRs.length) {
    // Treated as a list position
    chosen = featurePRs[idx - 1].number;
  } else if (idx > 0) {
    // Treated as a direct PR number
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
