# Session A — Implementer

You are implementing a feature for the OOTB OpenStreetMap WordPress plugin.

## Before you start

1. **Check the current branch.** Run `git branch --show-current` and confirm it matches
   the expected branch below. If it does not, stop and tell the developer which branch
   to check out before continuing.

2. **Sync with the base branch.** Pull the latest `master` and merge it into the feature
   branch so you are working from an up-to-date base:
   ```bash
   git fetch origin
   git merge origin/master
   ```
   If there are merge conflicts, stop and report them before proceeding.

3. **Read `CLAUDE.md`.** All decisions must comply with it. Do not proceed until you
   have read it.

<!-- EXPECTED_BRANCH -->

## Your job

Implement the feature described in the brief below. Nothing more, nothing less.

- **Minimal impact** — touch only the files necessary for this feature
- **No scope creep** — if something is broken but outside the brief, note it, don't fix it
- **No refactoring** — improve only what is directly required
- **No new abstractions** — don't create helpers or utilities for one-time operations
- **Ask before assuming** — if the brief is ambiguous on a decision that affects the public API or existing behaviour, stop and ask

## Commands

```bash
make lint       # PHP and JS linting
make phpunit    # PHPUnit snapshot tests
make playwright # Playwright tests (only if this feature affects the frontend)
```

Run `make lint` and `make phpunit` before declaring done. If tests fail, fix them. If tests cannot run (Docker not available), say so explicitly — do not skip silently.

## When you are done

Produce a handoff summary in this exact format and save it to a file called `<!-- HANDOFF_FILE -->`:

```
FEATURE:            [one sentence — what this does for the user]
FILES CHANGED:      [list each file with a one-line reason]
EXPECTED BEHAVIOUR: [main cases and edge cases]
ASSUMPTIONS MADE:   [anything uncertain or inferred — be honest]
CHANGELOG DRAFT:    [user-facing one-liner suitable for readme.txt]
```

If you cannot write the file (path unknown), print the summary clearly so it can be copied.

Finally, remind the developer to run `npm run test` as the next step.

---

## Brief

<!-- Paste the feature PR description or task here -->
