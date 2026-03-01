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

### Guiding principle: the plugin's scope comes first

User requests are input, not requirements. The plugin has an established purpose and philosophy, and every request must be evaluated against that — not the other way around.

A valid response to any request can be:
- **Implement it** — it fits the plugin's design and is worth the complexity
- **Implement something adjacent** — a partial solution, or a different approach that achieves a similar result via a different route, without the baggage of the literal request
- **Defer it** — valid in principle, but not the right moment
- **Reject it** — out of scope, a poor fit, adds complexity that doesn't serve the broader user base, or simply a bad idea

Never feel obligated to implement something just because a user asked for it. The plugin serves many users with different needs; any given request reflects one person's specific situation. Some requests are low quality, poorly thought through, or ask the plugin to become something it isn't. Treat those accordingly.

### Output format

Present the proposal in this order — summary first, detail second:

---

**PROPOSED TASKS**

A numbered list of everything recommended for the roadmap. This is the deliverable — the developer should be able to read this section alone and know exactly what is being proposed.

Each task on one line:

```
1. [Bug] Short, GitHub-issue-style title — one sentence on why it matters
2. [Feature] Short title — one sentence on why it matters
3. [Maintenance] Bump package X → Y.Z — fixes N vulnerabilities (HIGH)
```

Types: `Bug` · `Feature` · `Improvement` · `Maintenance` · `Community PR`

Do not include deferred or rejected items here. Do not include triage items unless they were escalated to a feature request.

---

**DETAILS**

The reasoning behind each decision, in the same numbered order as the task list above.

---

### Steps

Work through these steps to build the proposal, then format the output as above:

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

   **Think in terms of the underlying need, not the specific suggestion.** A user's request is a signal, not a spec. Before writing the brief, ask: what is the generic capability being asked for? What feature would satisfy this request *and* similar requests from users with different concrete needs? The implementation should be broadly useful — not a narrow solution to one person's exact wording.

   For example: "show posts with headline and image in a popup" → the underlying need is customisable popup content. The right solution is probably a flexible popup template or content field, not a hard-coded posts layout.

   When a cluster contains multiple sources (issue + forum topic, or multiple forum topics), treat that as evidence that the need is real and recurring. Use the variation across reports to understand the *range* of use cases the solution needs to cover.

   **The solution does not have to match the request.** It is perfectly valid to implement something that only partially addresses what was asked, or to take a completely different route that achieves a similar outcome in a way that better fits the plugin's design. Note clearly in the brief when this is the case — what the request was, what is actually being proposed, and why the proposed approach is the better fit.

5. **Handle the TRIAGE NEEDED section** — items marked `[?]` are questions or support requests that may not require any code changes. For each one:

   **First, read `config/decisions.md`** to check whether a relevant decision has already been made:
   - If the item matches an **Out of scope** entry → use that rationale to draft the decline; no further investigation needed
   - If the item matches a **Deferred** entry → note it as deferred with the existing reason; check whether the revisit condition has been met
   - If the item matches a **Standard reply** → adapt that reply for the specific context

   **If no prior decision applies, read the plugin codebase** to ground your answer in what actually exists:
   - Start with the plugin's `README.md` and `readme.txt` for user-facing feature documentation
   - Check `block.json` (or equivalent) for registered block attributes and supported options
   - Search relevant source files if the README is inconclusive

   **Then classify the item** and produce a draft reply:

   - **Already supported** — the feature exists; write a ready-to-post reply that explains exactly how to use it, referencing specific block settings or attributes by name
   - **Out of scope** — the request doesn't fit the plugin's purpose; write a polite decline that briefly explains why and, where possible, suggests an alternative approach
   - **Valid feature request** — escalate it into the proposed priorities with an implementation brief; no reply needed at this stage
   - **Needs more info** — write a reply asking the specific question(s) required to move forward

   Format each triage response as a clearly labelled block so the developer can copy-paste it directly:

   ```
   [TRIAGE: Issue #68 / Forum: topic-slug]
   Classification: Already supported / Out of scope / Feature request / Needs more info

   Suggested reply:
   ---
   Hi, thanks for reaching out! …
   ---
   ```

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

### Step 1 — Update decisions.md

Before handing off to implementation, update `config/decisions.md` to reflect what was decided in this session.

**Read the current `config/decisions.md`**, then derive the minimal set of changes needed:

- **Add** a new entry for any item newly classified as out of scope, deferred, or given a standard reply
- **Update** an existing entry if circumstances have changed (e.g. a deferred item's revisit condition is now met, or an out-of-scope ruling has been reversed because the item is being implemented)
- **Remove** an entry if it's no longer relevant (e.g. a deferred feature is now in scope and being built)
- **Leave unchanged** anything not touched by this session — do not reformat or reorganise entries that aren't being modified

Present the proposed changes clearly — one block per entry, showing exactly what would be added, updated, or removed. If no changes are needed, say so explicitly.

**Wait for sign-off before writing.** Once the developer confirms, apply the changes to `config/decisions.md`.

### Step 2 — Hand off to implementation

Phase 2 (not yet built): on approval, `planning-pipeline.js` will create the release branch and draft feature PRs automatically. Until then, the approved proposal becomes the brief for Session A.
