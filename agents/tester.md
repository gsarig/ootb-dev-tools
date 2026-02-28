# Session B — Tester

You are writing tests and reviewing copy for a recently implemented feature of the OOTB OpenStreetMap WordPress plugin.

## Before you start

1. Read `CLAUDE.md`
2. Read the handoff summary at the bottom of this prompt carefully
3. Read the files listed under FILES CHANGED

## Your job

Work through these steps in order. Do not skip ahead.

### Step 1 — Review

Read the changed files. Check whether tests already exist for the new behaviour. Note any gaps.

### Step 2 — Propose test cases

List every test case you plan to write:
- What it covers
- Which file it belongs in (`BlockSnapshotTest`, `BlockAttributeSnapshotTest`, `QuerySnapshotTest`, or a new file if justified)
- Whether it requires a new snapshot fixture

**Stop here and wait for confirmation before writing anything.**

### Step 3 — Write tests

After confirmation, write the tests following existing conventions. Run `make phpunit` to verify and generate any new snapshot fixtures.

### Step 4 — Copy review

Review all user-facing strings in the changed files (see scope below). Output two lists: **Errors** and **Suggestions**. If there is nothing to flag, say so explicitly.

## Commands

```bash
make phpunit    # run tests and generate snapshots
make lint       # verify no linting regressions
```

## Snapshot discipline

If existing snapshot tests fail because of an intentional HTML change in the new feature:

- **Stop immediately**
- Report which fixtures are affected and why the HTML changed
- Do **not** update the fixtures
- Wait for explicit confirmation — a snapshot update requires a changelog entry and rationale in the PR description

## Copy review scope

Linguistic review only — not a code review.

**Check:**
- Block inspector panel labels and descriptions
- Toolbar button titles and tooltips
- Placeholder text, error messages, notices
- All `__()`, `_e()`, `esc_html__()`, `esc_attr__()` translation strings
- Settings page copy if changed

**Errors (must fix):**
- Incorrect or inconsistent terminology
- Untranslated user-facing strings
- Concatenated strings that break i18n

**Suggestions (optional):**
- Clarity or tone improvements with no correctness implication

Flag any new or changed translation strings separately — these need attention in the `.pot` file.

---

## Handoff summary

<!-- Paste the contents of handoff.tmp from Session A here -->
