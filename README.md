# ootb-dev-tools

Tooling and AI agent prompts for the [OOTB OpenStreetMap](https://github.com/gsarig/ootb-openstreetmap) WordPress plugin — planning, compatibility checking, and release automation.

## Requirements

- **Node.js** 22 LTS or later
- **gh CLI** authenticated (`gh auth login`)
- **Composer** *(optional)* — enables PHP dependency checks
- A local checkout of the plugin repo *(optional)* — enables npm/Composer audits

## Setup

```bash
cp .env.example .env
```

Then fill in `.env`:

| Variable | Description |
|---|---|
| `GITHUB_TOKEN` | Personal access token with `repo` scope |
| `REPO_OWNER` | GitHub username (default: `gsarig`) |
| `REPO_NAME` | Plugin repo name (default: `ootb-openstreetmap`) |
| `PLUGIN_SLUG` | WordPress.org slug (usually same as `REPO_NAME`) |
| `PLUGIN_PATH` | **Absolute path** to local plugin checkout — required for npm/Composer checks |

> If you clone this repo on a new machine, `PLUGIN_PATH` in particular needs updating — it points to your local plugin directory and will differ per machine.

## Scripts

Run all scripts from the repo root.

### `node scripts/compatibility-check.js`

Checks the plugin's ecosystem for anything that needs attention:

- WordPress core and Gutenberg releases
- PHP end-of-life dates
- Leaflet.js version
- npm audit (root vulnerabilities, grouped by fix)
- npm outdated
- Composer audit and outdated packages

Opens a GitHub issue tagged `maintenance` if any ACTION REQUIRED items are found.

### `node scripts/planning-pipeline.js`

Researches and proposes the next release scope:

- Fetches open GitHub issues, community PRs, and unresolved WordPress.org forum topics
- Clusters related items by keyword similarity, scores by frequency/severity/recency
- Fetches open Dependabot security alerts
- Pulls a compatibility snapshot (WordPress, PHP EOL, Leaflet)

Output goes to the terminal and `tmp/planning-report.tmp`. Feed that file to the Planning Agent (see `agents/planning.md`).

## Agents

Prompt files in `agents/` are loaded into Claude Code sessions to drive specific workflows:

| File | Purpose |
|---|---|
| `planning.md` | Release planning — reads the pipeline report, proposes scope |
| `implementer.md` | Session A — implements a feature brief |
| `tester.md` | Session B — writes and runs tests against Session A's work |
| `copy-review.md` | Reviews translatable strings for consistency and i18n correctness |
| `cr-fix.md` | Applies or rebuts Copilot code-review suggestions |
| `compatibility.md` | Runs compatibility checks and interprets the report |

## Config

The `config/` folder holds files you may want to edit directly:

| File | Purpose |
|---|---|
| `settings.json` | Tuneable constants for the scripts (thresholds, limits) |
| `blockers.json` | Known upgrade blockers (see below) |
| `decisions.md` | Accumulated planning decisions — out-of-scope rulings, deferred items, standard replies |

### `config/settings.json`

| Key | Default | Description |
|---|---|---|
| `phpEolWarningDays` | `180` | Flag a PHP version as ACTION REQUIRED when EOL is within this many days |
| `forumMaxPages` | `20` | Max forum feed pages to fetch (3 topics/page) |
| `maxAgeDays` | `180` | Ignore forum/issue items older than this |
| `similarityThreshold` | `0.2` | Jaccard score at which two items are considered related and clustered |

## Upgrade blockers

If a dependency upgrade is attempted but causes breakage, record it in `config/blockers.json` so future runs are aware:

```json
{
  "leaflet": {
    "reason": "Leaflet 2.x removed L.mapbox; plugin must be refactored before upgrading",
    "since": "2025-01-15",
    "latestAtBlock": "2.0.0"
  }
}
```

Both scripts will annotate any finding for a blocked package with the reason and — if a newer version has since been released — a prompt to re-check whether the obstacle still applies. Remove the entry once the issue is resolved.

## Docs

- [`docs/implementation-plan.md`](docs/implementation-plan.md) — full design spec and phased build plan
