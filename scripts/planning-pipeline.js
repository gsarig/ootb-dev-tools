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
// Fetch: GitHub issues
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
    console.log(`${C.yellow}  GitHub: ${err.message}${C.reset}`);
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

function printReport(ranked, githubCount, forumCount) {
  const date = new Date().toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  console.log(`\n${C.bold}${'━'.repeat(56)}${C.reset}`);
  console.log(`${C.bold}  Planning Report — ${date}${C.reset}`);
  console.log(`${C.bold}  ${REPO_OWNER}/${REPO_NAME}${C.reset}`);
  console.log(`${C.bold}${'━'.repeat(56)}${C.reset}\n`);
  console.log(
    `${C.dim}Analysed: ${githubCount} open GitHub issues · ` +
    `${forumCount} unresolved forum topics (last ${MAX_AGE_DAYS / 30} months)${C.reset}\n`
  );

  const clustered = ranked.filter(r => r.cluster.length > 1 || r.score >= 20);
  const isolated  = ranked.filter(r => r.cluster.length === 1 && r.score < 20);

  if (clustered.length === 0 && ranked.length === 0) {
    console.log(`${C.green}No open issues or forum topics found.${C.reset}\n`);
    return;
  }

  if (clustered.length > 0) {
    console.log(`${C.bold}PROPOSED PRIORITIES${C.reset}\n`);
    clustered.forEach(({ cluster, score, type }, idx) => {
      const title   = clusterTitle(cluster);
      const gh      = cluster.filter(i => i.source === 'github');
      const forum   = cluster.filter(i => i.source === 'forum');
      const latest  = cluster.reduce((d, i) => (i.date > d ? i.date : d), cluster[0].date);
      const colour  = type === 'Bug' ? C.red : type === 'Feature Request' ? C.cyan : C.yellow;

      console.log(`${C.bold}[${idx + 1}] ${colour}${type}${C.reset}${C.bold}: ${title}${C.reset}`);
      console.log(`    Score: ${score} | ${cluster.length} item(s) — ${gh.length} GitHub · ${forum.length} forum`);
      if (gh.length)    console.log(`    GitHub:  ${gh.map(i => i.id).join(', ')}`);
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
      const src = i.source === 'github' ? `GitHub ${i.id}` : 'Forum';
      console.log(`${C.dim}  [${src}] ${i.title} — ${formatAge(i.date)}${C.reset}`);
    });
    console.log();
  }

  console.log(`${C.dim}Full report saved to planning-report.tmp${C.reset}\n`);
}

// ---------------------------------------------------------------------------
// Save report to file
// ---------------------------------------------------------------------------

function saveReport(ranked, githubCount, forumCount) {
  const date      = new Date().toISOString().split('T')[0];
  const clustered = ranked.filter(r => r.cluster.length > 1 || r.score >= 20);
  const isolated  = ranked.filter(r => r.cluster.length === 1 && r.score < 20);

  const lines = [
    `PLANNING REPORT — ${date}`,
    `Repo: ${REPO_OWNER}/${REPO_NAME}`,
    `Analysed: ${githubCount} GitHub issues · ${forumCount} forum topics`,
    '',
  ];

  if (clustered.length > 0) {
    lines.push('PROPOSED PRIORITIES', '');
    clustered.forEach(({ cluster, score, type }, idx) => {
      const title  = clusterTitle(cluster);
      const gh     = cluster.filter(i => i.source === 'github');
      const forum  = cluster.filter(i => i.source === 'forum');
      const latest = cluster.reduce((d, i) => (i.date > d ? i.date : d), cluster[0].date);

      lines.push(`[${idx + 1}] ${type}: ${title}`);
      lines.push(`    Score: ${score}`);
      if (gh.length)    lines.push(`    GitHub:  ${gh.map(i => `${i.id}  ${i.url}`).join('\n             ')}`);
      forum.forEach(i  => lines.push(`    Forum:   ${i.url}${i.replyCount ? ` (${i.replyCount} replies)` : ''}`));
      lines.push(`    Most recent: ${formatAge(latest)}`);
      lines.push('');
    });
  }

  if (isolated.length > 0) {
    lines.push('ISOLATED ITEMS', '');
    isolated.forEach(({ cluster }) => {
      const i = cluster[0];
      lines.push(`  [${i.source === 'github' ? `GitHub ${i.id}` : 'Forum'}] ${i.title}`);
      lines.push(`  ${i.url}`);
    });
  }

  fsys.writeFileSync(path.join(__dirname, '..', 'planning-report.tmp'), lines.join('\n'), 'utf8');
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n${C.bold}Running planning pipeline…${C.reset}`);
  console.log(`${C.dim}Repo: ${REPO_OWNER}/${REPO_NAME} · Forum slug: ${PLUGIN_SLUG}${C.reset}\n`);

  const [githubIssues, forumTopics] = await Promise.all([
    fetchGitHubIssues(),
    fetchForumTopics(),
  ]);

  const githubCount = githubIssues.length;
  const forumCount  = forumTopics.length;

  log(`${githubCount} GitHub issues · ${forumCount} forum topics after filtering.\n`);

  const allItems = [...githubIssues, ...forumTopics];

  if (allItems.length === 0) {
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

  printReport(ranked, githubCount, forumCount);
  saveReport(ranked, githubCount, forumCount);
}

main().catch(err => {
  console.error(`\n${C.red}${C.bold}Fatal: ${err.message}${C.reset}\n`);
  process.exit(1);
});
