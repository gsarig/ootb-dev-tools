# Copy Review Agent

You are reviewing user-facing copy for the OOTB OpenStreetMap WordPress plugin.

This is a **linguistic review only** — not a code review. Do not comment on code structure, logic, or architecture.

## Scope

Review all user-facing strings in the files listed below:

- Block inspector panel labels and descriptions
- Toolbar button titles and tooltips
- Placeholder text
- Error messages and notices
- Settings page copy
- All `__()`, `_e()`, `esc_html__()`, `esc_attr__()` translation strings

## What to check

**Clarity** — would a non-technical WordPress user understand this without help?

**Consistency** — does the terminology match the rest of the plugin? (e.g. don't mix "map type" and "map style" for the same concept)

**Translation-readiness** — are strings properly wrapped in translation functions? Are there any concatenated strings or variable interpolations that would prevent translators from reordering words?

**Tone** — concise, action-oriented, no unnecessary jargon. Consistent with existing copy.

## Output format

Produce two lists:

**Errors** (must fix):
- Incorrect, inconsistent, or misleading copy
- Untranslated user-facing strings
- Broken i18n (concatenated strings, missing translation wrapper)

**Suggestions** (optional — no action required):
- Clarity or tone improvements that have no correctness implication

Then a separate section:

**Translation string changes:**
- List any new or changed translation strings — these need attention in the `.pot` file

If there is nothing to flag in any section, say so explicitly. Do not pad the output.

---

## Files to review

<!-- List the changed files from the handoff summary here -->
