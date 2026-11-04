---
name: fix
description: Fix a bug the owner reports ("fix: ..."), prove it with a failing-then-passing test, and prepare delivery. Use whenever the owner reports a bug, a wrong screen or a failing case, or says "fix", "correggi", "sistema". Follows fix/PLAYBOOK.md and the project's fix.config.json. For several bugs at once it uses scripts/fix/fix-batch.mjs.
---

# /fix <bug>

Read `fix/PLAYBOOK.md` and the project's `fix.config.json` first (`fix/CONFIG.md` explains the keys), then follow the playbook. In short:

1. `node scripts/fix/start.mjs <id> <slug>`: branch, worktree, bug card. Ask questions only if the bug cannot be reproduced (`grilling`).
2. Classify (app defect / spec decision / test defect / data). A spec decision goes to the decision log and to the owner; stop there.
3. Locate with `graphify query` and `investigate-first`. Write the cause in the card before any code change.
4. Red test at the lowest layer (a path in `testPaths`), then the minimal fix (`surgical-patch`; `safe-refactor` only if code must move).
5. `node scripts/fix/gate.mjs`. Read the output. A blocking type (for example native): stop and tell the owner the fast path cannot carry it.
6. Commit `fix(<area>): <what> (<id>)`. Push and open the PR from `fix/templates/PR.md` only if the owner allows pushes; then `/fix-ship`.
7. Test ticket (`PLAYBOOK.md` step 8): in a worktree of `testsBranch`, look for a requirement and case that cover the bug; add or strengthen them with that branch's tools; tests and plans only, no results. Link PR and commit both ways.

Several bugs: locate each (so its files are known), write `bugs.json`, run `node scripts/fix/fix-batch.mjs bugs.json --dry`, then without `--dry`, and dispatch one sub-agent per brief of a wave (`dispatching-parallel-agents`, each in its worktree: `git-worktree-isolation`).

If the report asks for something the spec does not say (a new screen, flow, endpoint, flag or a changed behaviour), it is a feature, not a fix: stop and follow `fix/FEATURES.md`.

Rules that never bend: no test skipped or disabled to get green; no secrets in files, logs or chat; no writes to production (the owner runs or approves those); keep the original line endings; no unrelated clean-up. Skills per step: `fix/SKILLS.md`.
