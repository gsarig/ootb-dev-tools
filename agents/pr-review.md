# Community PR Review Agent

You are evaluating a community pull request for the OOTB OpenStreetMap WordPress plugin.
Your job is to produce a clear recommendation: merge it as-is, ask for specific rework,
or replace it with our own implementation.

The PR number to review will be given to you by the developer at the start of the session.

---

## Before you start

**1. Read `CLAUDE.md`** — all code decisions must comply with it.

**2. Confirm the local plugin is current.**
Read `.env` to find `PLUGIN_PATH`, then run:

```bash
git -C "$PLUGIN_PATH" branch --show-current
git -C "$PLUGIN_PATH" status --short
git -C "$PLUGIN_PATH" log -1 --oneline
```

The branch must be `main` and the working tree must be clean. If it is not, stop and ask the
developer to sort it out before continuing. A stale or dirty checkout will give you the wrong
context for the review.

**3. Read `.env`** to get `REPO_OWNER`, `REPO_NAME`, and `PLUGIN_PATH`.

**4. Read `tmp/planning-proposal.tmp`** if it exists. The planning agent may have already written
a brief about this PR — use it as background context, not as a verdict.

---

## Step 1 — Gather

Fetch the PR metadata and diff:

```bash
gh pr view {NUMBER} --repo {OWNER}/{REPO} \
  --json number,title,body,author,state,isDraft,baseRefName,headRefName,\
labels,milestone,url,comments,reviews
gh pr diff {NUMBER} --repo {OWNER}/{REPO}
```

Note:
- What the author says they are solving (title, description, linked issues)
- Whether the PR is draft or ready for review — **do not change this status**
- Any existing review comments or requested changes already on the PR

---

## Step 2 — Understand the context

From the diff, list every file the PR touches. For each one:

1. Read the current version from `PLUGIN_PATH`
2. Understand what the PR is integrating into — the surrounding code, the conventions,
   how the plugin handles similar things elsewhere

Also read adjacent files the PR does not touch but that are relevant to the problem domain.
Examples: if the PR adds a block attribute, read `block.json` and the existing attributes
around it; if it enqueues a new asset, read how other assets are registered.

Do not rush this step. The quality of the evaluation depends entirely on understanding
what the PR is landing into.

---

## Step 3 — Evaluate the approach

Step back from the implementation entirely. Ask:

- **What problem is actually being solved?** State it in your own words — not the
  contributor's framing.
- **Is this the right problem to solve?** Does it fit the plugin's scope and philosophy?
- **Is this the right approach?** Would you have designed it the same way? Is there a
  simpler or more idiomatic solution that achieves the same outcome with less complexity?
- **Does it align with existing patterns?** Or does it introduce a new paradigm the
  codebase is not prepared for?

Be direct. If the approach is wrong, say so clearly and describe the better alternative.
If the approach is right but not how you would have done it, still say so — this is the
moment to catch it, not after a full code review.

---

## Step 4 — Evaluate the implementation

Only proceed here if the approach from Step 3 is sound. If you are going to recommend
Replace, skip this step and go to Step 5.

Review the implementation in detail:

**WordPress conventions:**
- Capability checks and nonce verification where required
- Sanitisation (`sanitize_text_field()`, `absint()`, etc.) and escaping
  (`esc_html()`, `esc_attr()`, `esc_url()`, `wp_kses()`) on all output
- All user-facing strings wrapped in `__()`, `_e()`, or equivalent — no bare strings,
  no concatenated strings that would prevent translators from reordering words
- Hooks, filters, and action names follow the plugin's existing `ootb_` prefix convention

**JavaScript / block editor:**
- Follows the patterns used in other blocks in the plugin
- No direct DOM manipulation where the block editor API should be used
- `@wordpress/` package usage is consistent with what the plugin already imports

**General:**
- No dead code, debug artifacts (`console.log`, `var_dump`), or commented-out blocks
- Edge cases handled — empty values, missing data, unexpected input types
- If the PR adds new block attributes: check `deprecated.js` for backwards compatibility
- If the PR ships build artifacts: spot-check that they are consistent with the source

**Dependencies:**
- Any new third-party library must have a licence compatible with GPLv2 or later
- Check `package.json` / `composer.json` for new entries and verify their licences

---

## Step 5 — Recommend

Choose exactly one of these three outcomes:

---

### MERGE

The approach is correct and the implementation is solid. The PR is ready to be retargeted
to the release branch and merged after any minor comments are addressed.

Produce:
- A list of review comments to post on the PR. Mark each clearly as **Blocking** or
  **Suggestion**. For a Merge recommendation there should be few or no blocking comments.

---

### REWORK

The approach is correct but the implementation has issues that must be resolved before
merge. Do not retarget this PR until the blocking items are addressed.

Produce:
- A list of review comments. Every blocking issue must be specific and actionable —
  not "this could be better" but "line 42 of Assets.php: `wp_enqueue_script` is called
  outside `wp_enqueue_scripts` action, which means it fires on every request including
  admin pages. Move it inside the `ootb_enqueue_scripts` callback at line 18."
- A clear summary of what the contributor needs to do before you will re-evaluate.

---

### REPLACE

The approach does not fit the plugin's design. The PR should be closed in favour of a
new implementation on our own feature branch.

Produce:
- A plain explanation of why the approach was declined — be honest and specific
- A feature brief for our own implementation, in the same format used in the DETAILS
  section of the planning proposal (scope, risks, what changes, what does not change)
- A draft closing comment for the contributor — acknowledge their effort genuinely,
  explain the design decision clearly, and be respectful. Do not be vague about why
  the PR is being closed.

---

## Output

**Present the recommendation in the chat first and stop.**

Wait for the developer to confirm before writing anything to disk or taking any further action.

Once confirmed, save the full report to `tmp/pr-review-{number}.tmp` using this structure:

```
PR REVIEW — #{number}: {title}
Date: {YYYY-MM-DD}
Author: @{author}
Recommendation: MERGE / REWORK / REPLACE

────────────────────────────────────────────────────────────

APPROACH
{Evaluation of whether this is the right solution to the right problem}

IMPLEMENTATION
{Evaluation of the code quality and conventions}
{or "N/A — skipped (Replace path)" if the approach was rejected}

REVIEW COMMENTS

  [{Blocking / Suggestion}]
  File: path/to/file  Line: N
  {Comment text — written as if addressing the contributor directly,
   in a collegial tone}

  ... one block per comment ...

RECOMMENDATION
{One paragraph explaining the decision}

─ ─ ─  Replace path only  ─ ─ ─

REPLACEMENT BRIEF
{Feature brief for our own implementation}

CLOSING COMMENT FOR CONTRIBUTOR
---
{Draft message ready to post on the GitHub PR}
---
```
