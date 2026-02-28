#!/usr/bin/env node
/**
 * planning-pipeline.js — Phase 1: Research
 *
 * Reads open GitHub issues and recent WordPress.org support forum topics,
 * clusters related items by keyword overlap, scores by frequency/severity/recency,
 * and presents a prioritised proposal.
 *
 * Phase 2 (not yet built): on your approval, creates release branch and
 * draft feature PRs with full descriptions.
 *
 * Requires: Node 18+, gh CLI (authenticated)
 * Output:   terminal report + planning-report.tmp
 */

'use strict';

const { execSync } = require('child_process');
const fsys = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const ENV_FILE   = path.join(__dirname, '..', '.env');
const env        = loadEnv(ENV_FILE);

const REPO_OWNER  = env.REPO_OWNER  || 'gsarig';
const REPO_NAME   = env.REPO_NAME   || 'ootb-openstreetmap';
const PLUGIN_SLUG = env.PLUGIN_SLUG || REPO_NAME;

const FORUM_MAX_PAGES = 20; // feed returns 3 items/page; 20 pages = up to 60 topics
const MAX_AGE_DAYS    = 180; // ignore items older than this
const SIMILARITY_THRESHOLD = 0.2; // Jaccard — items sharing ≥20% keywords are grouped

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

const C = {
  red:   '\x1b[31m',
  yellow:'\x1b[33m',
  green: '\x1b[32m',
  cyan:  '\x1b[36m',
  bold:  '\x1b[1m',
  dim:   '\x1b[2m',
  reset: '\x1b[0m',
};

function log(msg)  { console.log(`${C.dim}  ${msg}${C.reset}`); }

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function loadEnv(filePath) {
  if (!fsys.existsSync(filePath)) return {};
  return fsys.readFileSync(filePath, 'utf8')
    .split('\n')
    .filter(line => line.trim() && !line.startsWith('#'))
    .reduce((acc, line) => {
      const eq = line.indexOf('=');
      if (eq > 0) acc[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      return acc;
    }, {});
}

async function fetchText(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'ootb-dev-tools/planning-pipeline (+https://github.com/gsarig/ootb-dev-tools)',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

function stripHTML(html) {
  return (html || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function daysAgo(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr)) / 864e5);
}

function formatAge(dateStr) {
  const days = daysAgo(dateStr);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30)  return `${days} days ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Keyword extraction
// ---------------------------------------------------------------------------

// Words that appear in nearly every support topic and carry no signal.
const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'from','by','as','is','are','was','were','be','been','have','has','had',
  'do','does','did','will','would','can','could','should','may','might',
  'this','that','these','those','it','its','i','my','me','we','our','you',
  'your','he','she','they','their','there','here','what','which','when',
  'where','how','why','not','no','yes','get','got','make','made','use',
  'used','using','just','also','more','some','any','all','new','want',
  // Plugin-specific noise — present in almost every topic
  'plugin','wordpress','block','map','maps','ootb','openstreetmap','site',
  'page','post','works','work','working','hello','hi','thanks','thank',
  'please','help','need','like','know','think','see','show','find','try',
  'tried','able','unable','version','update','updated','issue','problem',
]);

function extractKeywords(text) {
  return new Set(
    (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

function jaccardSimilarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0;
  const intersection = [...a].filter(k => b.has(k)).length;
  return intersection / (a.size + b.size - intersection);
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

const BUG_KEYWORDS = new Set([
  'error','broken','break','breaking','crash','crashes','fails','fail',
  'failure','bug','wrong','incorrect','missing','lost','disappear',
  'disappeared','fatal','undefined','null','white','blank','freeze',
  'frozen','stuck','loading','not-loading','stopped','regression',
]);

const FEATURE_KEYWORDS = new Set([
  'feature','request','idea','suggestion','improvement','enhance',
  'enhancement','wishlist','would','could','option','optional','support',
  'add','ability','allow','let','enable','custom','customise','customize',
]);

function detectType(keywords) {
  const bugScore     = [...keywords].filter(k => BUG_KEYWORDS.has(k)).length;
  const featureScore = [...keywords].filter(k => FEATURE_KEYWORDS.has(k)).length;
  if (bugScore > featureScore) return 'Bug';
  if (featureScore > bugScore) return 'Feature Request';
  return 'Improvement';
}

function severityWeight(type) {
  if (type === 'Bug')             return 3;
  if (type === 'Feature Request') return 1;
  return 2;
}

function recencyWeight(dateStr) {
  // Exponential decay: full score today, halves every 30 days
  return 10 * Math.exp(-daysAgo(dateStr) / 30);
}

function scoreCluster(cluster, type) {
  const latest     = cluster.reduce((d, i) => (i.date > d ? i.date : d), cluster[0].date);
  const crossSrc   = cluster.some(i => i.source === 'github') &&
                     cluster.some(i => i.source === 'forum') ? 15 : 0;
  const totalReplies = cluster
    .filter(i => i.source === 'forum')
    .reduce((n, i) => n + (i.replyCount || 0), 0);

  return Math.round(
    cluster.length    * 10 +
    severityWeight(type) * 20 +
    recencyWeight(latest) +
    crossSrc +
    Math.min(totalReplies, 20) // reply count bonus, capped at 20
  );
}

// ---------------------------------------------------------------------------
// Fetch: GitHub issues and pull requests
// ---------------------------------------------------------------------------

async function fetchGitHubIssues() {
  log(`Fetching open issues from ${REPO_OWNER}/${REPO_NAME}…`);
  try {
    const raw = execSync(
      `gh issue list --repo ${REPO_OWNER}/${REPO_NAME} --state open --limit 100 ` +
      `--json number,title,body,labels,createdAt,updatedAt,url`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    return JSON.parse(raw || '[]')
      .filter(i => daysAgo(i.updatedAt) <= MAX_AGE_DAYS)
      .filter(i => !(i.labels || []).some(l => l.name === 'maintenance'))
      .map(i => {
        const text = `${i.title} ${stripHTML(i.body || '')}`;
        return {
          source:     'github',
          id:         `#${i.number}`,
          title:      i.title,
          url:        i.url,
          date:       i.updatedAt,
          labels:     (i.labels || []).map(l => l.name),
          replyCount: 0,
          keywords:   extractKeywords(text),
        };
      });
  } catch (err) {
    console.log(`${C.yellow}  GitHub issues: ${err.message}${C.reset}`);
    return [];
  }
}

/**
 * Returns { communityPRs, dependabotPRs }
 * Community PRs participate in clustering (source: 'pr').
 * Dependabot PRs are shown separately — they are maintenance, not planning.
 */
async function fetchGitHubPRs() {
  log(`Fetching open PRs from ${REPO_OWNER}/${REPO_NAME}…`);
  try {
    const raw = execSync(
      `gh pr list --repo ${REPO_OWNER}/${REPO_NAME} --state open --limit 100 ` +
      `--json number,title,body,labels,createdAt,updatedAt,url,isDraft,author`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const all = JSON.parse(raw || '[]');

    const dependabotPRs = all.filter(pr =>
      pr.author?.login === 'app/dependabot' ||
      pr.author?.login?.includes('dependabot') ||
      (pr.labels || []).some(l => l.name === 'dependencies')
    );

    const communityPRs = all
      .filter(pr => !dependabotPRs.includes(pr))
      .filter(pr => daysAgo(pr.updatedAt) <= MAX_AGE_DAYS)
      .map(pr => {
        const text = `${pr.title} ${stripHTML(pr.body || '')}`;
        return {
          source:   'pr',
          id:       `#${pr.number}`,
          title:    pr.title,
          url:      pr.url,
          date:     pr.updatedAt,
          isDraft:  pr.isDraft,
          author:   pr.author?.login || 'unknown',
          labels:   (pr.labels || []).map(l => l.name),
          keywords: extractKeywords(text),
        };
      });

    return { communityPRs, dependabotPRs };
  } catch (err) {
    console.log(`${C.yellow}  GitHub PRs: ${err.message}${C.reset}`);
    return { communityPRs: [], dependabotPRs: [] };
  }
}

// ---------------------------------------------------------------------------
// Fetch: GitHub Dependabot security alerts
// ---------------------------------------------------------------------------

async function fetchSecurityAlerts() {
  log(`Fetching Dependabot security alerts from ${REPO_OWNER}/${REPO_NAME}…`);
  try {
    const raw = execSync(
      `gh api repos/${REPO_OWNER}/${REPO_NAME}/dependabot/alerts` +
      ` --jq '[.[] | select(.state == "open")]'`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const alerts = JSON.parse(raw || '[]');
    return alerts.map(a => ({
      number:   a.number,
      severity: (a.security_advisory?.severity || 'unknown').toLowerCase(),
      package:  a.dependency?.package?.name || 'unknown',
      summary:  a.security_advisory?.summary || '',
      url:      a.html_url || '',
    }));
  } catch (err) {
    console.log(`${C.yellow}  Security alerts: ${err.message}${C.reset}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Fetch: WordPress.org forum topics (unresolved only)
// ---------------------------------------------------------------------------

function parseRSSFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];

  for (const block of blocks) {
    const titleM = block.match(/<title><!\[CDATA\[([^\]]+)/) || block.match(/<title>([^<]+)/);
    const linkM  = block.match(/<link>([^<]+)/);
    const dateM  = block.match(/<pubDate>([^<]+)/);
    const descM  = block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]>/);

    if (!titleM || !linkM) continue;

    const description = descM ? descM[1] : '';
    const replyM      = description.match(/Replies:\s*(\d+)/i);

    items.push({
      title:      stripHTML(titleM[1]).trim(),
      url:        linkM[1].trim(),
      date:       dateM ? new Date(dateM[1].trim()).toISOString() : new Date().toISOString(),
      replyCount: replyM ? parseInt(replyM[1], 10) : 0,
      excerpt:    stripHTML(description).replace(/Replies:\s*\d+/i, '').trim().slice(0, 300),
    });
  }

  return items;
}

async function fetchForumTopics() {
  log(`Fetching unresolved forum topics for ${PLUGIN_SLUG}…`);
  const base    = `https://wordpress.org/support/plugin/${PLUGIN_SLUG}/unresolved/feed/`;
  const results = [];

  const seen = new Set();

  for (let page = 1; page <= FORUM_MAX_PAGES; page++) {
    const url = page === 1 ? base : `${base}?paged=${page}`;
    try {
      const xml    = await fetchText(url);
      const topics = parseRSSFeed(xml);
      if (topics.length === 0) break;

      // WordPress.org repeats the last real page when paged= exceeds the total.
      // Stop when every item on the page is already known.
      const newTopics = topics.filter(t => !seen.has(t.url));
      if (newTopics.length === 0) break;

      newTopics.forEach(t => seen.add(t.url));
      results.push(...newTopics);
    } catch (err) {
      log(`Forum page ${page}: ${err.message}`);
      break;
    }
  }

  return results
    .filter(t => daysAgo(t.date) <= MAX_AGE_DAYS)
    .map(t => ({
      source:     'forum',
      id:         t.url.split('/').filter(Boolean).pop(),
      title:      t.title,
      url:        t.url,
      date:       t.date,
      replyCount: t.replyCount,
      // Use title + excerpt for richer keyword extraction
      keywords:   extractKeywords(`${t.title} ${t.excerpt}`),
    }));
}

// ---------------------------------------------------------------------------
// Clustering
// ---------------------------------------------------------------------------

function clusterItems(items) {
  const clusters = [];
  const assigned = new Set();

  for (let i = 0; i < items.length; i++) {
    if (assigned.has(i)) continue;
    const cluster = [items[i]];
    assigned.add(i);

    for (let j = i + 1; j < items.length; j++) {
      if (assigned.has(j)) continue;
      if (jaccardSimilarity(items[i].keywords, items[j].keywords) >= SIMILARITY_THRESHOLD) {
        cluster.push(items[j]);
        assigned.add(j);
      }
    }
    clusters.push(cluster);
  }

  return clusters;
}

// Best title for a cluster: prefer GitHub issue title, otherwise
// the forum topic with the most replies.
function clusterTitle(cluster) {
  const gh = cluster.find(i => i.source === 'github');
  if (gh) return gh.title;
  return [...cluster]
    .sort((a, b) => (b.replyCount || 0) - (a.replyCount || 0))[0].title;
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

function severityColour(sev) {
  if (sev === 'critical') return C.red;
  if (sev === 'high')     return C.red;
  if (sev === 'medium')   return C.yellow;
  return C.dim;
}

function printReport(ranked, githubCount, prCount, forumCount, securityAlerts, dependabotPRs, compatFindings) {
  const date = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  console.log(`\n${C.bold}${'━'.repeat(56)}${C.reset}`);
  console.log(`${C.bold}  Planning Report — ${date}${C.reset}`);
  console.log(`${C.bold}  ${REPO_OWNER}/${REPO_NAME}${C.reset}`);
  console.log(`${C.bold}${'━'.repeat(56)}${C.reset}\n`);
  console.log(
    `${C.dim}Analysed: ${githubCount} open issues · ${prCount} community PRs · ` +
    `${forumCount} unresolved forum topics (last ${MAX_AGE_DAYS / 30} months)${C.reset}\n`
  );

  const clustered = ranked.filter(r => r.cluster.length > 1 || r.score >= 20);
  const isolated  = ranked.filter(r => r.cluster.length === 1 && r.score < 20);

  if (clustered.length === 0 && ranked.length === 0) {
    console.log(`${C.green}No open issues, PRs, or forum topics found.${C.reset}\n`);
  } else {
    if (clustered.length > 0) {
      console.log(`${C.bold}PROPOSED PRIORITIES${C.reset}\n`);
      clustered.forEach(({ cluster, score, type }, idx) => {
        const title  = clusterTitle(cluster);
        const gh     = cluster.filter(i => i.source === 'github');
        const prs    = cluster.filter(i => i.source === 'pr');
        const forum  = cluster.filter(i => i.source === 'forum');
        const latest = cluster.reduce((d, i) => (i.date > d ? i.date : d), cluster[0].date);
        const colour = type === 'Bug' ? C.red : type === 'Feature Request' ? C.cyan : C.yellow;

        console.log(`${C.bold}[${idx + 1}] ${colour}${type}${C.reset}${C.bold}: ${title}${C.reset}`);
        console.log(`    Score: ${score} | ${cluster.length} item(s) — ${gh.length} issue · ${prs.length} PR · ${forum.length} forum`);
        if (gh.length)   console.log(`    Issue:   ${gh.map(i => i.id).join(', ')}`);
        prs.forEach(i  => console.log(`    PR:      ${i.id} — ${i.title}${i.isDraft ? ' [DRAFT]' : ''} (@${i.author})`));
        forum.forEach(i => console.log(`    Forum:   ${i.url}` + (i.replyCount ? ` (${i.replyCount} replies)` : '')));
        console.log(`    Most recent: ${formatAge(latest)}`);
        console.log();
      });
    }

    if (isolated.length > 0) {
      console.log(`${C.dim}${'─'.repeat(56)}${C.reset}`);
      console.log(`${C.dim}ISOLATED ITEMS (single report, below threshold)${C.reset}\n`);
      isolated.forEach(({ cluster }) => {
        const i   = cluster[0];
        const src = i.source === 'github' ? `Issue ${i.id}` : i.source === 'pr' ? `PR ${i.id}` : 'Forum';
        console.log(`${C.dim}  [${src}] ${i.title} — ${formatAge(i.date)}${C.reset}`);
      });
      console.log();
    }
  }

  if (securityAlerts.length > 0) {
    const sevOrder  = ['critical', 'high', 'medium', 'low', 'unknown'];
    const sorted    = [...securityAlerts].sort(
      (a, b) => sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity)
    );
    console.log(`${C.dim}${'─'.repeat(56)}${C.reset}`);
    console.log(`${C.red}${C.bold}SECURITY ALERTS (${securityAlerts.length} open)${C.reset}\n`);
    sorted.forEach(a => {
      const col = severityColour(a.severity);
      console.log(`  ${col}${C.bold}[${a.severity.toUpperCase()}]${C.reset} ${a.package}`);
      console.log(`  ${C.dim}${a.summary}${C.reset}`);
      console.log(`  ${C.dim}${a.url}${C.reset}`);
    });
    console.log();
  }

  if (compatFindings.length > 0) {
    const actionItems = compatFindings.filter(f => f.level === 'action');
    const watchItems  = compatFindings.filter(f => f.level === 'watch');
    console.log(`${C.dim}${'─'.repeat(56)}${C.reset}`);
    console.log(`${C.bold}COMPATIBILITY WATCH${C.reset}\n`);
    actionItems.forEach(f => console.log(`  ${C.red}${C.bold}[ACTION]${C.reset} ${f.text}`));
    watchItems.forEach(f  => console.log(`  ${C.yellow}[WATCH]${C.reset}  ${f.text}`));
    console.log();
  }

  if (dependabotPRs.length > 0) {
    console.log(`${C.dim}${'─'.repeat(56)}${C.reset}`);
    console.log(`${C.dim}DEPENDABOT PRs (${dependabotPRs.length} open — review and merge separately)${C.reset}\n`);
    dependabotPRs.forEach(pr => {
      console.log(`${C.dim}  #${pr.number} ${pr.title}${C.reset}`);
    });
    console.log();
  }

  console.log(`${C.dim}Full report saved to tmp/planning-report.tmp${C.reset}\n`);
}

// ---------------------------------------------------------------------------
// Save report to file
// ---------------------------------------------------------------------------

function saveReport(ranked, githubCount, prCount, forumCount, securityAlerts, dependabotPRs, compatFindings) {
  const date      = new Date().toISOString().split('T')[0];
  const clustered = ranked.filter(r => r.cluster.length > 1 || r.score >= 20);
  const isolated  = ranked.filter(r => r.cluster.length === 1 && r.score < 20);

  const lines = [
    `PLANNING REPORT — ${date}`,
    `Repo: ${REPO_OWNER}/${REPO_NAME}`,
    `Analysed: ${githubCount} open issues · ${prCount} community PRs · ${forumCount} forum topics`,
    '',
  ];

  if (clustered.length > 0) {
    lines.push('PROPOSED PRIORITIES', '');
    clustered.forEach(({ cluster, score, type }, idx) => {
      const title  = clusterTitle(cluster);
      const gh     = cluster.filter(i => i.source === 'github');
      const prs    = cluster.filter(i => i.source === 'pr');
      const forum  = cluster.filter(i => i.source === 'forum');
      const latest = cluster.reduce((d, i) => (i.date > d ? i.date : d), cluster[0].date);

      lines.push(`[${idx + 1}] ${type}: ${title}`);
      lines.push(`    Score: ${score}`);
      if (gh.length)  lines.push(`    Issue:  ${gh.map(i => `${i.id}  ${i.url}`).join('\n            ')}`);
      prs.forEach(i  => lines.push(`    PR:     ${i.id}  ${i.url}${i.isDraft ? ' [DRAFT]' : ''} (@${i.author})`));
      forum.forEach(i => lines.push(`    Forum:  ${i.url}${i.replyCount ? ` (${i.replyCount} replies)` : ''}`));
      lines.push(`    Most recent: ${formatAge(latest)}`);
      lines.push('');
    });
  }

  if (isolated.length > 0) {
    lines.push('ISOLATED ITEMS', '');
    isolated.forEach(({ cluster }) => {
      const i = cluster[0];
      const src = i.source === 'github' ? `Issue ${i.id}` : i.source === 'pr' ? `PR ${i.id}` : 'Forum';
      lines.push(`  [${src}] ${i.title}`);
      lines.push(`  ${i.url}`);
    });
    lines.push('');
  }

  if (securityAlerts.length > 0) {
    lines.push(`SECURITY ALERTS (${securityAlerts.length} open)`, '');
    const sevOrder = ['critical', 'high', 'medium', 'low', 'unknown'];
    [...securityAlerts]
      .sort((a, b) => sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity))
      .forEach(a => {
        lines.push(`  [${a.severity.toUpperCase()}] ${a.package}: ${a.summary}`);
        lines.push(`  ${a.url}`);
      });
    lines.push('');
  }

  if (compatFindings.length > 0) {
    lines.push('COMPATIBILITY WATCH', '');
    compatFindings.forEach(f => lines.push(`  [${f.level.toUpperCase()}] ${f.text}`));
    lines.push('');
  }

  if (dependabotPRs.length > 0) {
    lines.push(`DEPENDABOT PRs (${dependabotPRs.length} open)`, '');
    dependabotPRs.forEach(pr => lines.push(`  #${pr.number}  ${pr.title}`));
  }

  const tmpDir = path.join(__dirname, '..', 'tmp');
  if (!fsys.existsSync(tmpDir)) fsys.mkdirSync(tmpDir);
  fsys.writeFileSync(path.join(tmpDir, 'planning-report.tmp'), lines.join('\n'), 'utf8');
}

// ---------------------------------------------------------------------------
// Fetch: compatibility snapshot (WordPress, PHP EOL, Leaflet)
// A lightweight summary for the planning report — not a replacement for
// running compatibility-check.js, which is more thorough and opens issues.
// ---------------------------------------------------------------------------

async function fetchCompatibility() {
  log('Fetching compatibility snapshot…');
  const findings = [];

  try {
    const wp = await fetchText('https://api.wordpress.org/core/version-check/1.7/');
    const offers = JSON.parse(wp).offers || [];
    const stable = offers.find(o => ['upgrade', 'latest'].includes(o.response));
    const beta   = offers.find(o => o.response === 'development');
    if (beta)   findings.push({ level: 'watch',  text: `WordPress beta/RC available: ${beta.version} — test before it goes stable` });
    if (stable) findings.push({ level: 'ok',     text: `WordPress stable: ${stable.version}` });
  } catch { /* non-fatal */ }

  try {
    const versions = JSON.parse(await fetchText('https://endoflife.date/api/php.json'));
    for (const v of versions) {
      if (!v.eol || v.eol === false) continue;
      const days = Math.ceil((new Date(v.eol) - Date.now()) / 864e5);
      if (days < 0)   continue;
      if (days <= 180) findings.push({ level: 'action', text: `PHP ${v.cycle} EOL in ${days} days (${v.eol}) — verify minimum version requirements` });
      else if (days <= 365) findings.push({ level: 'watch', text: `PHP ${v.cycle} EOL in ${Math.ceil(days / 30)} months (${v.eol})` });
    }
  } catch { /* non-fatal */ }

  try {
    const latest  = JSON.parse(await fetchText('https://registry.npmjs.org/leaflet/latest'));
    const pkg     = PLUGIN_PATH ? (() => {
      try { return JSON.parse(fsys.readFileSync(path.join(PLUGIN_PATH, 'package.json'), 'utf8')); } catch { return null; }
    })() : null;
    const current = pkg?.dependencies?.leaflet || pkg?.devDependencies?.leaflet;
    if (current) {
      const cur = current.replace(/^[^\d]*/, '');
      if (parseInt(latest.version) > parseInt(cur)) {
        findings.push({ level: 'action', text: `Leaflet major update: ${cur} → ${latest.version}` });
      } else if (latest.version !== cur) {
        findings.push({ level: 'watch', text: `Leaflet update available: ${cur} → ${latest.version}` });
      }
    }
  } catch { /* non-fatal */ }

  return findings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n${C.bold}Running planning pipeline…${C.reset}`);
  console.log(`${C.dim}Repo: ${REPO_OWNER}/${REPO_NAME} · Forum slug: ${PLUGIN_SLUG}${C.reset}\n`);

  const [
    githubIssues,
    { communityPRs, dependabotPRs },
    forumTopics,
    securityAlerts,
    compatFindings,
  ] = await Promise.all([
    fetchGitHubIssues(),
    fetchGitHubPRs(),
    fetchForumTopics(),
    fetchSecurityAlerts(),
    fetchCompatibility(),
  ]);

  const githubCount = githubIssues.length;
  const prCount     = communityPRs.length;
  const forumCount  = forumTopics.length;

  log(`${githubCount} issues · ${prCount} community PRs · ${dependabotPRs.length} dependabot PRs · ${forumCount} forum topics.\n`);

  const allItems = [...githubIssues, ...communityPRs, ...forumTopics];

  if (allItems.length === 0 && dependabotPRs.length === 0 && securityAlerts.length === 0 && compatFindings.length === 0) {
    console.log(`${C.yellow}No items found. Check your credentials and PLUGIN_SLUG.${C.reset}\n`);
    process.exit(1);
  }

  const clusters = clusterItems(allItems);
  const ranked   = clusters
    .map(cluster => {
      const type  = detectType(new Set(cluster.flatMap(i => [...i.keywords])));
      return { cluster, type, score: scoreCluster(cluster, type) };
    })
    .sort((a, b) => b.score - a.score);

  printReport(ranked, githubCount, prCount, forumCount, securityAlerts, dependabotPRs, compatFindings);
  saveReport(ranked, githubCount, prCount, forumCount, securityAlerts, dependabotPRs, compatFindings);
}

main().catch(err => {
  console.error(`\n${C.red}${C.bold}Fatal: ${err.message}${C.reset}\n`);
  process.exit(1);
});
