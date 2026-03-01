# ootb-dev-tools

Tooling and AI agent prompts for the [OOTB OpenStreetMap](https://github.com/gsarig/ootb-openstreetmap) WordPress plugin — planning, compatibility checking, and release automation.

## TL;DR

**1.** Generate the planning report:

```bash
npm run plan
```

**2.** Follow the printed instructions to start the planning session. Then review `tmp/planning-proposal.tmp` and decide which tasks go in the upcoming release and which get deferred.

**3.** Create the release branch, PRs, and issues from the approved proposal:

```bash
npm run execute -- 2.10.0 --release 2,3 --backlog 4
```

**4.** For each feature, run the implementer and follow the printed instructions:

```bash
npm run implement
```

**5.** Once the implementer session writes `handoff-{pr}.tmp`, run the tester and follow the printed instructions:

```bash
npm run test
```

---

Run `npm run compat` monthly or before a release to check for compatibility issues.

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
| `DEFAULT_BRANCH` | Default branch of the plugin repo — `main` or `master` (default: `main`) |
| `PLUGIN_SLUG` | WordPress.org slug (usually same as `REPO_NAME`) |
| `PLUGIN_PATH` | **Absolute path** to local plugin checkout — required for npm/Composer checks and PR review |
| `PROJECT_NUMBER` | GitHub Project number — enables automatic project item creation in the release pipeline (optional) |

> If you clone this repo on a new machine, `PLUGIN_PATH` in particular needs updating — it points to your local plugin directory and will differ per machine.

## Usage

```bash
npm run plan    # compatibility check (dry run) + planning pipeline — full pre-session report
npm run compat  # standalone compatibility check — opens a GitHub issue if action is needed
npm run execute -- <version> --release 1,2 --backlog 3 --community 65
                # create release branch, PRs, issues, and retarget community PRs
                # add --dry-run to preview without touching GitHub
npm run implement        # pick a feature PR and get implementation instructions
npm run implement -- 87  # jump straight to PR #87
npm run test             # pick a feature PR and get testing instructions
npm run test -- 87       # jump straight to PR #87
```

`npm run plan` and `npm run compat` print a next-step prompt at the end telling you which agent to load in Claude Code.

## Scripts

The npm commands above are the intended entry points. The underlying scripts can also be run directly if needed.

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

### `node scripts/release-pipeline.js`

Bridges the approved planning proposal to GitHub artefacts:

- Creates (or reuses) the `release/<version>` branch and a draft release PR
- For each `--release` task: creates a feature branch and a draft PR with the implementation brief as the description, assigns label, milestone, and GitHub Project item
- For each `--backlog` task: creates a GitHub issue with the brief as the description
- For each `--community` PR: retargets the base branch to the release branch, posts a notice comment, sets the milestone, and adds a project item
- Skips `[Community PR]` tasks in `--release` and `--backlog` with a clear notice — those require `agents/pr-review.md` first

Reads `tmp/planning-proposal.tmp`. Add `--dry-run` to write a full preview to `tmp/release-pipeline-dryrun.tmp` without touching GitHub.

### `node scripts/implement.js [pr-number]`

Prints step-by-step instructions for implementing a feature PR and writes a combined agent prompt (implementer instructions + PR brief) to `tmp/implement-<pr>.tmp`. Without a PR number, lists open feature PRs targeting the current release branch and prompts for a selection.

### `node scripts/test.js [pr-number]`

Prints step-by-step instructions for the tester session and writes a combined agent prompt (tester instructions + handoff summary) to `tmp/test-<pr>.tmp`. Automatically embeds `handoff.tmp` from `PLUGIN_PATH` if it exists. Without a PR number, shows the same interactive picker as `implement.js`.

## Agents

Prompt files in `agents/` are loaded into Claude Code sessions to drive specific workflows:

| File | Purpose |
|---|---|
| `planning.md` | Release planning — reads the pipeline report, proposes scope, triggers the execute command after approval |
| `pr-review.md` | Community PR evaluation — reads the diff and codebase, recommends Merge / Rework / Replace |
| `implementer.md` | Session A — implements a feature brief |
| `tester.md` | Session B — writes and runs tests against Session A's work |
| `copy-review.md` | Reviews translatable strings for consistency and i18n correctness |
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
