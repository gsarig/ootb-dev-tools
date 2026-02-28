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
- **Compatibility watch** — upcoming WordPress/PHP releases and any dependency updates that may require code changes
- **Dependabot PRs** — dependency bumps waiting to be reviewed, listed separately

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

## After approval

Phase 2 (not yet built): on approval, `planning-pipeline.js` will create the release branch and draft feature PRs automatically. Until then, the approved proposal becomes the brief for Session A.
