---
name: qa-fix
description: Fix a failing test case properly: classify the failure, find the root cause, write the failing test first, minimal fix, verify, regression. Uses systematic-debugging, test-driven-development and verification-before-completion when installed. Use whenever a test fails and is not a known divergence.
---

# /qa-fix <case or requirement id>

1. **Classify**: app bug / spec decision (record it in the decision log, ask the owner, do not guess) / test bug.
2. **Root cause** first: `systematic-debugging` if installed. No fix before the cause is understood.
3. **Red**: the failing step is the test (or a smaller one at the right layer: a database test for a rule, a function test for a function). `test-driven-development`: watch it fail for the right reason.
4. **Minimal fix**, in the repo's style, on a fix branch (`node scripts/fix/start.mjs <id> <slug>`). Commit `fix(<area>): <what> (<id>)` naming the requirement id; add the bug with its evidence to the project's bug list.
5. **Verify**: `verification-before-completion` if installed: run the case, the cases that share the same table, function or screen, and `node scripts/fix/gate.mjs`. Read the output before saying done.

Never skip, disable, quarantine or retry a test to get green. Use one worktree per defect and parallel agents only for defects that share no files (`node scripts/fix/fix-batch.mjs`). Without the optional skills, follow the same discipline by hand: reproduce, root cause, failing test first, minimal fix, run the verification and read its output.
