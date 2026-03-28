#!/usr/bin/env node
/**
 * release-pipeline.js
 *
 * Bridges the approved planning proposal to concrete GitHub artefacts:
 *   - Release branch + draft release PR
 *   - Draft feature PRs for release tasks (one per task)
 *   - GitHub issues for backlog tasks
 *   - GitHub Project items for all of the above
 *
 * Usage:
 *   node scripts/release-pipeline.js <version> --release <nums> --backlog <nums>
 *   npm run execute -- 2.10.0 --release 1,2,3 --backlog 4,5
 *
 * Reads:  tmp/planning-proposal.md
 * Config: .env  (REPO_OWNER, REPO_NAME, PROJECT_NUMBER)
 */

'use strict';

const { spawnSync } = require('child_process');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

// ─── Config ────────────────────────────────────────────────────────────────

const ROOT           = path.join(__dirname, '..');
const ENV_FILE       = path.join(ROOT, '.env');
const env            = loadEnv(ENV_FILE);

const REPO_OWNER      = env.REPO_OWNER     || '';
const REPO_NAME       = env.REPO_NAME      || 'ootb-openstreetmap';
const DEFAULT_BRANCH  = env.DEFAULT_BRANCH || 'main';
const PROJECT_NUMBER  = env.PROJECT_NUMBER ? parseInt(env.PROJECT_NUMBER, 10) : null;

// ─── Colors ────────────────────────────────────────────────────────────────

const C = {
  red:    '\x1b[31m',
  yellow: '\x1b[33m',
  green:  '\x1b[32m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  reset:  '\x1b[0m',
};

// ─── Utilities ─────────────────────────────────────────────────────────────

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

/** Run gh CLI with the given args array. Returns stdout. Throws on non-zero exit. */
function gh(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error((r.stderr || '').trim() || `gh exited with status ${r.status}`);
  }
  return r.stdout;
}

/** gh + JSON.parse */
function ghJson(args) {
  return JSON.parse(gh(args));
}

/** Write content to a temp file and return its path. */
function tmpWrite(content) {
  const p = path.join(os.tmpdir(), `relpipe-${process.pid}-${Date.now()}.md`);
  fs.writeFileSync(p, content, 'utf8');
  return p;
}

function die(msg) {
  console.error(`\n${C.red}${msg}${C.reset}\n`);
  process.exit(1);
}

// ─── Argument parsing ──────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2);
  if (!argv[0] || argv[0].startsWith('-')) {
    die(
      'Usage: node scripts/release-pipeline.js <version> [--release 1,2] [--backlog 3,4]\n' +
      '                                                   [--community 65,82] [--dry-run]'
    );
  }

  const version      = argv[0];
  let   releaseNums  = [];
  let   backlogNums  = [];
  let   communityPRs = []; // existing PR numbers to retarget to the release branch
  let   dryRun       = false;

  for (let i = 1; i < argv.length; i++) {
    if ((argv[i] === '--release' || argv[i] === '-r') && argv[i + 1]) {
      releaseNums = argv[++i].split(',').map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));
    } else if ((argv[i] === '--backlog' || argv[i] === '-b') && argv[i + 1]) {
      backlogNums = argv[++i].split(',').map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));
    } else if ((argv[i] === '--community' || argv[i] === '-c') && argv[i + 1]) {
      communityPRs = argv[++i].split(',').map(n => parseInt(n.trim(), 10)).filter(n => !isNaN(n));
    } else if (argv[i] === '--dry-run' || argv[i] === '-n') {
      dryRun = true;
    }
  }

  return { version, releaseNums, backlogNums, communityPRs, dryRun };
}

// ─── Proposal parsing ──────────────────────────────────────────────────────

/**
 * Parse tmp/planning-proposal.md.
 * Returns: Array<{ number, type, title, oneLiner, brief }>
 */
function parseProposal(filePath) {
  const text  = fs.readFileSync(filePath, 'utf8');
  const tasks = [];

  // ── PROPOSED TASKS — up to first "---" separator
  const tasksSec = text.match(/^PROPOSED TASKS\s*\n([\s\S]*?)^---/m);
  if (!tasksSec) throw new Error('No PROPOSED TASKS section found in planning-proposal.md');

  for (const line of tasksSec[1].split('\n')) {
    // Format: N. [Type] Title — one-liner
    const m = line.match(/^(\d+)\.\s+\[([^\]]+)\]\s+(.+?)\s+—\s+(.+)$/);
    if (m) {
      tasks.push({
        number:   parseInt(m[1], 10),
        type:     m[2].trim(),
        title:    m[3].trim(),
        oneLiner: m[4].trim(),
        brief:    '',
      });
    }
  }

  // ── DETAILS — slice from the "DETAILS" header to the "TRIAGE" header (or end
  // of file). Index-based slicing avoids the "---" task separators inside the
  // section from being misread as the section boundary.
  const detailsIdx = text.search(/^DETAILS\b/m);
  const triageIdx  = text.search(/^TRIAGE\b/m);
  if (detailsIdx !== -1) {
    const detailsBody = text.slice(detailsIdx, triageIdx !== -1 ? triageIdx : undefined);
    // Split on "---" separators between individual task blocks
    const blocks = detailsBody.split(/\n---\n/).filter(b => b.trim());
    for (const block of blocks) {
      // Match "**N. Title**" or "N. [Type] Title" task header formats
      const hm = block.match(/^(?:\*\*)?(\d+)\. /m);
      if (!hm) continue;
      const task = tasks.find(t => t.number === parseInt(hm[1], 10));
      if (task) {
        const lines  = block.split('\n');
        const hdrIdx = lines.findIndex(l => /^(?:\*\*)?(\d+)\. /.test(l));
        task.brief   = lines.slice(hdrIdx + 1).join('\n').trim();
      }
    }
  }

  return tasks;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/** "Enrich default popup content" → "feature/enrich-default-popup-content" */
function titleToSlug(title) {
  return 'feature/' + title
    .toLowerCase()
    .replace(/\(#\d+\)/g, '')      // strip PR refs like "(#65)"
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const LABEL_MAP = {
  'Bug':          'bug',
  'Feature':      'enhancement',
  'Improvement':  'enhancement',
  'Maintenance':  'maintenance',
  'Community PR': 'enhancement',
};

const LABEL_COLORS = {
  bug:         'd73a4a',
  enhancement: 'a2eeef',
  maintenance: 'e4e669',
};

function typeToLabel(type) { return LABEL_MAP[type] || 'enhancement'; }

/** "2.10.0" → "2.11.0" */
function bumpMinor(v) {
  const parts = v.split('.').map(Number);
  if (parts.length < 2 || parts.some(isNaN)) return v;
  parts[1] += 1;
  if (parts.length >= 3) parts[2] = 0;
  return parts.join('.');
}

/**
 * Priority by position in the approved list.
 * pos is 1-based. total is the count of non-skipped release tasks.
 */
function getPriority(pos, total) {
  if (total <= 1 || pos === 1) return 'High';
  if (pos === total)           return 'Low';
  return 'Medium';
}

function buildBody(task, date) {
  return [
    '## What',
    task.oneLiner,
    '',
    '## Brief',
    task.brief,
    '',
    '---',
    `*Planning proposal: ${date} · Task ${task.number}*`,
  ].join('\n');
}

// ─── GitHub: branch ────────────────────────────────────────────────────────

/** Ensure branch exists; create from `base` if absent. Returns true if created. */
function ensureBranch(branch, base) {
  try {
    ghJson(['api', `repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${branch}`]);
    console.log(`  ${C.dim}Branch already exists: ${branch}${C.reset}`);
    return false;
  } catch {
    // Fetch base SHA then create the ref
    const baseRef = ghJson(['api', `repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${base}`]);
    ghJson([
      'api', `repos/${REPO_OWNER}/${REPO_NAME}/git/refs`,
      '-X', 'POST',
      '-f', `ref=refs/heads/${branch}`,
      '-f', `sha=${baseRef.object.sha}`,
    ]);
    console.log(`  ${C.green}Created branch: ${branch}${C.reset}`);
    return true;
  }
}

/**
 * Push an empty commit onto `branch` so GitHub will allow opening a PR.
 * GitHub refuses to create a PR between two refs with identical commit SHAs.
 */
function pushEmptyCommit(branch, message) {
  const ref     = ghJson(['api', `repos/${REPO_OWNER}/${REPO_NAME}/git/ref/heads/${branch}`]);
  const sha     = ref.object.sha;
  const commit  = ghJson(['api', `repos/${REPO_OWNER}/${REPO_NAME}/git/commits/${sha}`]);
  const treeSha = commit.tree.sha;
  const newCommit = ghJson([
    'api', `repos/${REPO_OWNER}/${REPO_NAME}/git/commits`,
    '-X', 'POST',
    '-f', `message=${message}`,
    '-f', `tree=${treeSha}`,
    '-F', `parents[]=${sha}`,
  ]);
  ghJson([
    'api', `repos/${REPO_OWNER}/${REPO_NAME}/git/refs/heads/${branch}`,
    '-X', 'PATCH',
    '-f', `sha=${newCommit.sha}`,
  ]);
}

// ─── GitHub: label ────────────────────────────────────────────────────────

/** Ensure label exists in the repo; create it if absent. */
function ensureLabel(label) {
  try {
    gh(['api', `repos/${REPO_OWNER}/${REPO_NAME}/labels/${encodeURIComponent(label)}`]);
  } catch {
    ghJson([
      'api', `repos/${REPO_OWNER}/${REPO_NAME}/labels`,
      '-X', 'POST',
      '-f', `name=${label}`,
      '-f', `color=${LABEL_COLORS[label] || 'cccccc'}`,
    ]);
    console.log(`  ${C.green}Created label: ${label}${C.reset}`);
  }
}

// ─── GitHub: milestone ────────────────────────────────────────────────────

/** Ensure a milestone named `version` exists. Returns the title (used by gh pr create --milestone). */
function ensureMilestone(version) {
  const list = ghJson(['api', `repos/${REPO_OWNER}/${REPO_NAME}/milestones`, '-X', 'GET']);
  if (list.find(m => m.title === version)) return version;
  ghJson([
    'api', `repos/${REPO_OWNER}/${REPO_NAME}/milestones`,
    '-X', 'POST',
    '-f', `title=${version}`,
    '-f', 'state=open',
  ]);
  console.log(`  ${C.green}Created milestone: ${version}${C.reset}`);
  return version;
}

// ─── GitHub: draft PR ────────────────────────────────────────────────────

/**
 * Ensure a draft PR exists (head → base). Creates one if absent.
 * Returns { url, nodeId, created }.
 * opts: { label, milestone }
 */
function ensureDraftPR(head, base, title, bodyFile, opts = {}) {
  // Check for an existing open PR from this head to this base
  try {
    const prs = ghJson([
      'api',
      `repos/${REPO_OWNER}/${REPO_NAME}/pulls?state=open&head=${REPO_OWNER}:${head}&base=${base}`,
    ]);
    if (prs.length > 0) {
      console.log(`  ${C.dim}PR already exists: ${prs[0].html_url}${C.reset}`);
      return { url: prs[0].html_url, nodeId: prs[0].node_id, created: false };
    }
  } catch { /* treat as not found */ }

  const args = [
    'pr', 'create',
    '--repo',      `${REPO_OWNER}/${REPO_NAME}`,
    '--head',      head,
    '--base',      base,
    '--title',     title,
    '--body-file', bodyFile,
    '--draft',
  ];
  if (opts.label)     args.push('--label',     opts.label);
  if (opts.milestone) args.push('--milestone',  opts.milestone);

  const url    = gh(args).trim();
  const numM   = url.match(/\/pull\/(\d+)$/);
  let   nodeId = null;

  if (numM) {
    try {
      const pr = ghJson(['api', `repos/${REPO_OWNER}/${REPO_NAME}/pulls/${numM[1]}`]);
      nodeId   = pr.node_id;
    } catch { /* non-fatal — project linking will be skipped */ }
  }

  console.log(`  ${C.green}Created PR: ${url}${C.reset}`);
  return { url, nodeId, created: true };
}

// ─── GitHub: community PR ────────────────────────────────────────────────

/**
 * Retarget an existing community PR to the release branch, then attach
 * the milestone, label, and GitHub Project item.
 * The PR's draft/ready-for-review status is intentionally left unchanged.
 * Returns { url, nodeId, mergeable }.
 */
function retargetCommunityPR(prNumber, relBranch, version) {
  // Fetch current PR state
  const pr = ghJson([
    'api', `repos/${REPO_OWNER}/${REPO_NAME}/pulls/${prNumber}`,
  ]);

  const url    = pr.html_url;
  const nodeId = pr.node_id;
  const title  = pr.title;

  console.log(`  PR #${prNumber}: ${title}`);
  console.log(`  ${C.dim}Current base: ${pr.base.ref}${C.reset}`);

  // Retarget base branch
  if (pr.base.ref === relBranch) {
    console.log(`  ${C.dim}Already targeting ${relBranch} — skipping retarget${C.reset}`);
  } else {
    ghJson([
      'api', `repos/${REPO_OWNER}/${REPO_NAME}/pulls/${prNumber}`,
      '-X', 'PATCH',
      '-f', `base=${relBranch}`,
    ]);
    console.log(`  ${C.green}Retargeted: ${pr.base.ref} → ${relBranch}${C.reset}`);

    // Notify the contributor
    const comment =
      `This PR has been retargeted to \`${relBranch}\` as part of the ${version} release pipeline. ` +
      `It will reach \`${DEFAULT_BRANCH}\` via the release PR when the release is ready. ` +
      `No action needed on your end — but please rebase onto \`${relBranch}\` if GitHub reports conflicts.`;
    ghJson([
      'api', `repos/${REPO_OWNER}/${REPO_NAME}/issues/${prNumber}/comments`,
      '-X', 'POST',
      '-f', `body=${comment}`,
    ]);
    console.log(`  ${C.green}Posted retarget notice${C.reset}`);
  }

  // Milestone
  try { ensureMilestone(version); } catch { /* non-fatal */ }
  const milestones = ghJson(['api', `repos/${REPO_OWNER}/${REPO_NAME}/milestones`, '-X', 'GET']);
  const ms = milestones.find(m => m.title === version);
  if (ms) {
    ghJson([
      'api', `repos/${REPO_OWNER}/${REPO_NAME}/issues/${prNumber}`,
      '-X', 'PATCH',
      '-f', `milestone=${ms.number}`,
    ]);
    console.log(`  ${C.green}Milestone set: ${version}${C.reset}`);
  }

  // Check mergeability (informational only — we do not block on this)
  const refreshed  = ghJson(['api', `repos/${REPO_OWNER}/${REPO_NAME}/pulls/${prNumber}`]);
  const mergeable  = refreshed.mergeable; // true | false | null (not yet computed)
  if (mergeable === false) {
    console.log(`  ${C.yellow}Warning: PR has merge conflicts — ask the contributor to rebase onto ${relBranch}${C.reset}`);
  }

  return { url, nodeId, mergeable };
}

// ─── GitHub: issue ───────────────────────────────────────────────────────

/**
 * Create a GitHub issue. Returns { url, nodeId }.
 */
function createIssue(title, bodyFile, label) {
  const args = [
    'issue', 'create',
    '--repo',      `${REPO_OWNER}/${REPO_NAME}`,
    '--title',     title,
    '--body-file', bodyFile,
  ];
  if (label) args.push('--label', label);

  const url  = gh(args).trim();
  const numM = url.match(/\/issues\/(\d+)$/);
  let nodeId = null;

  if (numM) {
    try {
      const issue = ghJson(['api', `repos/${REPO_OWNER}/${REPO_NAME}/issues/${numM[1]}`]);
      nodeId      = issue.node_id;
    } catch { /* non-fatal */ }
  }

  console.log(`  ${C.green}Created issue: ${url}${C.reset}`);
  return { url, nodeId };
}

// ─── GitHub Projects V2 ──────────────────────────────────────────────────

let _project = null; // cached project metadata; false if unavailable

function getProject() {
  if (_project !== null) return _project;
  if (!PROJECT_NUMBER) { _project = false; return false; }

  const q = `
    query {
      user(login: "${REPO_OWNER}") {
        projectV2(number: ${PROJECT_NUMBER}) {
          id
          fields(first: 20) {
            nodes {
              ... on ProjectV2SingleSelectField { id name options { id name } }
              ... on ProjectV2Field             { id name }
            }
          }
        }
      }
    }`;

  try {
    const data    = ghJson(['api', 'graphql', '-f', `query=${q}`]);
    const project = data.data?.user?.projectV2;
    if (!project) { _project = false; return false; }

    const fields = {};
    for (const n of project.fields.nodes) {
      if (n.id && n.name) fields[n.name] = n;
    }
    _project = { id: project.id, fields };
    return _project;
  } catch (err) {
    console.log(`  ${C.yellow}GitHub Project not accessible: ${err.message}${C.reset}`);
    _project = false;
    return false;
  }
}

/**
 * Add a PR or issue (by GraphQL node ID) to the GitHub Project and set fields.
 * opts: { type, priority, status }
 */
function addToProject(nodeId, { type, priority, status }) {
  const p = getProject();
  if (!p || !nodeId) return;

  let itemId;
  try {
    const r = ghJson(['api', 'graphql', '-f',
      `query=mutation { addProjectV2ItemById(input: { projectId: "${p.id}" contentId: "${nodeId}" }) { item { id } } }`,
    ]);
    itemId = r.data?.addProjectV2ItemById?.item?.id;
  } catch (err) {
    console.log(`  ${C.yellow}Warning: Could not add to project — ${err.message}${C.reset}`);
    return;
  }
  if (!itemId) return;

  // Set single-select fields: Type, Priority, Status
  for (const [name, value] of [['Type', type], ['Priority', priority], ['Status', status]]) {
    const field  = p.fields[name];
    if (!field?.options) continue;
    const option = field.options.find(o => o.name === value);
    if (!option) continue;
    try {
      ghJson(['api', 'graphql', '-f',
        `query=mutation { updateProjectV2ItemFieldValue(input: { projectId: "${p.id}" itemId: "${itemId}" fieldId: "${field.id}" value: { singleSelectOptionId: "${option.id}" } }) { projectV2Item { id } } }`,
      ]);
    } catch (err) {
      console.log(`  ${C.yellow}Warning: Could not set ${name}=${value} — ${err.message}${C.reset}`);
    }
  }
}

// ─── Dry run ─────────────────────────────────────────────────────────────

/**
 * Print and write a full description of what execute would do,
 * without making any GitHub API calls.
 * Report is saved to tmp/release-pipeline-dryrun.tmp.
 */
function runDryRun(tasks, version, releaseNums, backlogNums, communityPRs, date) {
  const relBranch = `release/${version}`;
  const hr        = '─'.repeat(60);
  const lines     = []; // plain-text report (no ANSI)

  const add  = (...args) => lines.push(...args);
  const rule = () => add(hr);

  add(`DRY RUN — Release Pipeline ${version}`);
  add(`Date: ${date} · Repo: ${REPO_OWNER}/${REPO_NAME}`);
  rule();
  add('');

  // ── Release branch + PR ──────────────────────────────────────────────────
  add('RELEASE BRANCH');
  add('');
  add(`  [ ] Create branch: ${relBranch}  (from ${DEFAULT_BRANCH})`);
  add('');
  add('RELEASE PR');
  add('');
  add(`  [ ] Draft PR:  Release ${version}`);
  add(`       ${relBranch} → ${DEFAULT_BRANCH}`);
  add('');

  // ── Feature PRs ──────────────────────────────────────────────────────────
  const relTasks = releaseNums.map(n => tasks.find(t => t.number === n)).filter(Boolean);

  if (relTasks.length > 0) {
    add('FEATURE PRs');
    add('');

    const effectiveTasks = relTasks.filter(
      t => !(/\(#\d+\)/.test(t.title) || t.type === 'Community PR')
    );
    let effectivePos = 0;

    for (const task of relTasks) {
      if (/\(#\d+\)/.test(task.title) || task.type === 'Community PR') {
        add(`  [SKIP] Task ${task.number}: ${task.title}`);
        add(`         Reason: references an existing PR — handle manually`);
        add('');
        continue;
      }

      effectivePos++;
      const priority = getPriority(effectivePos, effectiveTasks.length);
      const slug     = titleToSlug(task.title);
      const label    = typeToLabel(task.type);
      const body     = buildBody(task, date);

      add(`  Task ${task.number}: ${task.title}`);
      add('');
      add(`  [ ] Create branch: ${slug}  (from ${relBranch})`);
      add(`  [ ] Ensure label:  ${label}`);
      add(`  [ ] Draft PR:      ${task.title}`);
      add(`       ${slug} → ${relBranch}`);
      add(`       Label: ${label} | Priority: ${priority} | Milestone: ${version}`);
      if (PROJECT_NUMBER) {
        add(`  [ ] Add to project #${PROJECT_NUMBER}: Type=${task.type} | Priority=${priority} | Status=Todo`);
      }
      add('');
      add('  PR body:');
      add('  ' + '·'.repeat(56));
      for (const l of body.split('\n')) add('  ' + l);
      add('  ' + '·'.repeat(56));
      add('');
    }
  }

  // ── Backlog issues ───────────────────────────────────────────────────────
  const backlogTasks = backlogNums.map(n => tasks.find(t => t.number === n)).filter(Boolean);

  if (backlogTasks.length > 0) {
    add('BACKLOG ISSUES');
    add('');

    for (const task of backlogTasks) {
      if (/\(#\d+\)/.test(task.title) || task.type === 'Community PR') {
        add(`  [SKIP] Task ${task.number}: ${task.title}`);
        add(`         Reason: references an existing PR — handle manually`);
        add('');
        continue;
      }

      const label = typeToLabel(task.type);
      const body  = buildBody(task, date);

      add(`  Task ${task.number}: ${task.title}`);
      add('');
      add(`  [ ] Ensure label: ${label}`);
      add(`  [ ] Create issue: ${task.title}`);
      add(`       Label: ${label}`);
      if (PROJECT_NUMBER) {
        add(`  [ ] Add to project #${PROJECT_NUMBER}: Type=${task.type} | Priority=Low | Status=Backlog`);
      }
      add('');
      add('  Issue body:');
      add('  ' + '·'.repeat(56));
      for (const l of body.split('\n')) add('  ' + l);
      add('  ' + '·'.repeat(56));
      add('');
    }
  }

  // ── Community PRs ────────────────────────────────────────────────────────
  if (communityPRs.length > 0) {
    add('COMMUNITY PRs');
    add('');
    for (const prNumber of communityPRs) {
      add(`  PR #${prNumber}`);
      add(`  [ ] Retarget base: ??? → ${relBranch}`);
      add(`  [ ] Post retarget notice comment`);
      add(`  [ ] Set milestone: ${version}`);
      if (PROJECT_NUMBER) {
        add(`  [ ] Add to project #${PROJECT_NUMBER}: Priority=High | Status=Todo`);
      }
      add(`  [ ] Check for merge conflicts after retarget`);
      add('');
    }
  }

  rule();
  add('No GitHub changes were made.');

  const report  = lines.join('\n');
  const outPath = path.join(ROOT, 'tmp', 'release-pipeline-dryrun.tmp');
  fs.writeFileSync(outPath, report, 'utf8');

  // Print to terminal (reuse the plain text — it reads fine without ANSI)
  console.log(`\n${C.bold}Dry run — Release Pipeline ${version}${C.reset}`);
  console.log(`${C.dim}${REPO_OWNER}/${REPO_NAME}${C.reset}\n`);
  console.log(report);
  console.log(`${C.dim}Report saved to tmp/release-pipeline-dryrun.tmp${C.reset}\n`);
}

// ─── Main ────────────────────────────────────────────────────────────────

function main() {
  const { version, releaseNums, backlogNums, communityPRs, dryRun } = parseArgs();

  const proposalPath = path.join(ROOT, 'tmp', 'planning-proposal.md');
  if (!fs.existsSync(proposalPath)) {
    die('tmp/planning-proposal.md not found. Run the planning pipeline first.');
  }

  // ── Guard: reject versions that are already published ──────────────────
  try {
    const latestRelease = ghJson(['api', `repos/${REPO_OWNER}/${REPO_NAME}/releases/latest`]);
    const latestTag     = String(latestRelease.tag_name || '').replace(/^v/, '');
    const versionClean  = version.replace(/^v/, '');
    if (latestTag === versionClean) {
      die(
        `Version ${version} has already been published as a release.\n` +
        `Latest tag: ${latestRelease.tag_name}\n` +
        `Pass the next version number instead (e.g. bump the minor: ${bumpMinor(versionClean)}).`
      );
    }
  } catch (err) {
    // No releases yet or network error — proceed without blocking
    console.warn(`${C.yellow}Warning: could not verify latest release — ${err.message}${C.reset}`);
  }

  const tasks = parseProposal(proposalPath);
  const date  = new Date().toISOString().split('T')[0];

  if (dryRun) {
    runDryRun(tasks, version, releaseNums, backlogNums, communityPRs, date);
    return;
  }

  const relBranch = `release/${version}`;
  const tmpFiles  = [];

  const summary = {
    releaseBranch:  relBranch,
    releasePR:      null,
    featurePRs:     [],
    backlogIssues:  [],
    communityPRs:   [],
    skipped:        [],
  };

  console.log(`\n${C.bold}Release Pipeline — ${version}${C.reset}`);
  console.log(`${C.dim}${REPO_OWNER}/${REPO_NAME}${C.reset}\n`);

  // ── 1. Release branch ────────────────────────────────────────────────────
  console.log(`${C.bold}Release branch${C.reset}`);
  let relBranchCreated = false;
  try {
    relBranchCreated = ensureBranch(relBranch, DEFAULT_BRANCH);
  } catch (err) {
    die(`Could not ensure release branch: ${err.message}`);
  }
  if (relBranchCreated) {
    try { pushEmptyCommit(relBranch, `Release ${version}`); }
    catch (err) { console.log(`  ${C.yellow}Warning (empty commit): ${err.message}${C.reset}`); }
  }

  // ── 2. Milestone (needed by both release PR and feature PRs) ─────────────
  let milestone = null;
  try { milestone = ensureMilestone(version); }
  catch (err) { console.log(`  ${C.yellow}Warning: Could not ensure milestone — ${err.message}${C.reset}`); }

  // ── 3. Release PR ────────────────────────────────────────────────────────
  console.log(`\n${C.bold}Release PR${C.reset}`);
  const relBodyFile = tmpWrite(`Draft release PR for version ${version}.`);
  tmpFiles.push(relBodyFile);
  try {
    const relPR      = ensureDraftPR(relBranch, DEFAULT_BRANCH, `Release ${version}`, relBodyFile, {
      milestone: milestone || undefined,
    });
    summary.releasePR = relPR.url;
  } catch (err) {
    console.log(`  ${C.yellow}Warning: ${err.message}${C.reset}`);
  }

  // ── 4. Feature PRs ───────────────────────────────────────────────────────
  const relTasks = releaseNums.map(n => tasks.find(t => t.number === n)).filter(Boolean);

  if (relTasks.length > 0) {
    console.log(`\n${C.bold}Feature PRs (${relTasks.length})${C.reset}`);

    // Assign priorities based on position among non-skipped tasks.
    // We need to know the total first, so pre-filter community PRs.
    const effectiveTasks = relTasks.filter(
      t => !(/\(#\d+\)/.test(t.title) || t.type === 'Community PR')
    );

    let effectivePos = 0;

    for (const task of relTasks) {
      // Skip tasks that reference an existing PR
      if (/\(#\d+\)/.test(task.title) || task.type === 'Community PR') {
        console.log(`\n${C.yellow}[SKIP] Task ${task.number} references an existing PR — handle manually${C.reset}`);
        summary.skipped.push(task);
        continue;
      }

      effectivePos++;
      const priority = getPriority(effectivePos, effectiveTasks.length);
      const slug     = titleToSlug(task.title);
      const label    = typeToLabel(task.type);

      console.log(`\n  Task ${task.number}: ${C.bold}${task.title}${C.reset} [${priority}]`);
      console.log(`  ${C.dim}${slug}${C.reset}`);

      const branchCreated = (() => {
        try { return ensureBranch(slug, relBranch); }
        catch (err) { console.log(`  ${C.yellow}Warning (branch): ${err.message}${C.reset}`); return false; }
      })();

      // GitHub won't open a PR between identical refs — push an empty commit.
      if (branchCreated) {
        try { pushEmptyCommit(slug, `Start: ${task.title}`); }
        catch (err) { console.log(`  ${C.yellow}Warning (empty commit): ${err.message}${C.reset}`); }
      }

      try { ensureLabel(label); }
      catch (err) { console.log(`  ${C.yellow}Warning (label): ${err.message}${C.reset}`); }

      const bodyFile = tmpWrite(buildBody(task, date));
      tmpFiles.push(bodyFile);

      let pr = null;
      try {
        pr = ensureDraftPR(slug, relBranch, task.title, bodyFile, {
          label,
          milestone: milestone || undefined,
        });
        if (pr.nodeId) addToProject(pr.nodeId, { type: task.type, priority, status: 'Todo' });
      } catch (err) {
        console.log(`  ${C.yellow}Warning (PR): ${err.message}${C.reset}`);
      }

      summary.featurePRs.push({ task, url: pr?.url || null, priority });
    }
  }

  // ── 5. Backlog issues ────────────────────────────────────────────────────
  const backlogTasks = backlogNums.map(n => tasks.find(t => t.number === n)).filter(Boolean);

  if (backlogTasks.length > 0) {
    console.log(`\n${C.bold}Backlog issues (${backlogTasks.length})${C.reset}`);

    for (const task of backlogTasks) {
      if (/\(#\d+\)/.test(task.title) || task.type === 'Community PR') {
        console.log(`\n${C.yellow}[SKIP] Task ${task.number} references an existing PR — handle manually${C.reset}`);
        summary.skipped.push(task);
        continue;
      }

      const label = typeToLabel(task.type);
      console.log(`\n  Task ${task.number}: ${C.bold}${task.title}${C.reset}`);

      try { ensureLabel(label); }
      catch (err) { console.log(`  ${C.yellow}Warning (label): ${err.message}${C.reset}`); }

      const bodyFile = tmpWrite(buildBody(task, date));
      tmpFiles.push(bodyFile);

      let issue = null;
      try {
        issue = createIssue(task.title, bodyFile, label);
        if (issue.nodeId) addToProject(issue.nodeId, { type: task.type, priority: 'Low', status: 'Backlog' });
      } catch (err) {
        console.log(`  ${C.yellow}Warning (issue): ${err.message}${C.reset}`);
      }

      summary.backlogIssues.push({ task, url: issue?.url || null });
    }
  }

  // ── 5. Community PRs ─────────────────────────────────────────────────────
  if (communityPRs.length > 0) {
    console.log(`\n${C.bold}Community PRs (${communityPRs.length})${C.reset}`);
    for (const prNumber of communityPRs) {
      console.log(`\n  PR #${prNumber}`);
      try {
        const result = retargetCommunityPR(prNumber, relBranch, version);
        if (result.nodeId) addToProject(result.nodeId, { type: 'Feature', priority: 'High', status: 'Todo' });
        summary.communityPRs.push({ prNumber, url: result.url, mergeable: result.mergeable });
      } catch (err) {
        console.log(`  ${C.yellow}Warning: ${err.message}${C.reset}`);
        summary.communityPRs.push({ prNumber, url: null, mergeable: null });
      }
    }
  }

  // Cleanup temp files
  for (const f of tmpFiles) try { fs.unlinkSync(f); } catch { /* ignore */ }

  // ── 6. Summary ───────────────────────────────────────────────────────────
  printSummary(summary, version);
}

function printSummary({ releaseBranch, releasePR, featurePRs, backlogIssues, communityPRs, skipped }, version) {
  const hr = '─'.repeat(56);
  console.log(`\n${C.bold}${hr}${C.reset}`);
  console.log(`${C.bold}Release ${version} — Done${C.reset}`);
  console.log(`${C.bold}${hr}${C.reset}\n`);

  console.log(`Branch : ${releaseBranch}`);
  console.log(`PR     : ${releasePR || '(not created)'}`);

  if (featurePRs.length > 0) {
    console.log(`\nFeature PRs:`);
    for (const { task, url, priority } of featurePRs) {
      console.log(`  [${priority}] Task ${task.number} — ${task.title}`);
      if (url) console.log(`    ${C.dim}${url}${C.reset}`);
    }
  }

  if (backlogIssues.length > 0) {
    console.log(`\nBacklog Issues:`);
    for (const { task, url } of backlogIssues) {
      console.log(`  Task ${task.number} — ${task.title}`);
      if (url) console.log(`    ${C.dim}${url}${C.reset}`);
    }
  }

  if (communityPRs.length > 0) {
    console.log(`\nCommunity PRs (retargeted to ${releaseBranch}):`);
    for (const { prNumber, url, mergeable } of communityPRs) {
      const conflict = mergeable === false ? ` ${C.yellow}[conflicts — ask contributor to rebase]${C.reset}` : '';
      console.log(`  #${prNumber}${conflict}`);
      if (url) console.log(`    ${C.dim}${url}${C.reset}`);
    }
  }

  if (skipped.length > 0) {
    console.log(`\n${C.yellow}Skipped (handle manually):${C.reset}`);
    for (const task of skipped) {
      console.log(`  [SKIP] Task ${task.number} — ${task.title}`);
    }
  }

  console.log();
}

main();
