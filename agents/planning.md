# Planning Agent

You are planning the next release of the OOTB OpenStreetMap WordPress plugin.

## Before you start

Run the planning pipeline from the `ootb-dev-tools` directory:

```bash
node scripts/planning-pipeline.js
```

Then read `tmp/planning-report.tmp`. That file is your primary source of truth.

## What the report contains

- **Proposed priorities** — GitHub issues, community PRs, and unresolved WordPress.org forum topics, clustered by keyword similarity and scored by frequency, severity, recency, and cross-source signal
- **Security alerts** — open Dependabot vulnerability alerts, grouped by package
- **Compatibility watch** — upcoming WordPress/PHP releases and any dependency updates that may require code changes
- **Dependabot PRs** — dependency bumps waiting to be reviewed, listed separately

Items marked **⚠ Blocked** are packages that cannot be upgraded yet due to a known compatibility issue recorded in `config/blockers.json`. If a **↻ New release** line appears alongside a blocker, the package has received a new version since the block was added — re-examine whether the obstacle still applies before deciding to defer.

## Your job

Using the report as input, produce a release proposal for the developer's approval:

1. **Review the proposed priorities** — do the clusters make sense? Are any items miscategorised or grouped incorrectly? Note anything that looks wrong.

2. **Propose a release scope** — which items should go into the next release? Consider:
   - Bugs first, especially if they appear in multiple sources
   - Community PRs that are ready to review — these represent done work
   - Feature requests with high reply counts
   - Compatibility items flagged as ACTION REQUIRED

3. **Flag what to defer** — items that are out of scope, low signal, or better suited for a future release

4. **For each proposed item, draft a one-paragraph brief** covering:
   - What it is and why it matters (link to the source issue/topic)
   - Rough scope (what needs to change)
   - Any known risks or dependencies

**Stop here and present the proposal. Do not create branches, PRs, or any git operations. Wait for approval before proceeding.**

## Recording upgrade blockers

When a dependency upgrade is attempted but causes breakage (e.g. a major Leaflet bump removes an API the plugin uses, or `@wordpress/scripts` 30.x drops a required loader), record it in `config/blockers.json`:

```json
{
  "leaflet": {
    "reason": "Leaflet 2.x removed L.mapbox; plugin must be refactored before upgrading",
    "since": "2025-01-15",
    "latestAtBlock": "2.0.0"
  }
}
```

- `reason` — short, plain-English explanation so future sessions understand the constraint
- `since` — ISO date when the block was discovered
- `latestAtBlock` — the latest available version at that time; when a newer version appears the report will flag it for a re-check

To **remove** a blocker once the issue is resolved, delete its key from `config/blockers.json`.

## After approval

Phase 2 (not yet built): on approval, `planning-pipeline.js` will create the release branch and draft feature PRs automatically. Until then, the approved proposal becomes the brief for Session A.
