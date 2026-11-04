# Playbook: from bug report to delivered fix

One bug, one branch (`<branchPrefix><id>-<slug>`), one worktree, one PR. Several bugs: see "Many bugs at once" at the end.

Every project value used below (base branch, card folder, id pattern, delivery types, checks, tests branch, owner commands) comes from `fix.config.json` at the repo root; [`CONFIG.md`](CONFIG.md) explains each key. The skills named below are in [`SKILLS.md`](SKILLS.md); where one is missing, do by hand what the step says.

## 0. Receive
- Read the report. If it cannot be reproduced from it, use `grilling` and ask the fewest questions that fix that, nothing more.
- Pick an id that matches `idPattern`: the existing bug id if there is one, else a new one (for example `BUG-F<yyyymmdd>-<n>`).
- `node scripts/fix/start.mjs <id> <slug>` creates the branch from `<remote>/<baseBranch>`, a worktree beside this checkout (`<worktreePrefix><id>-<slug>`), and the card `<cardDir>/<id>.md` from `cardTemplate`.

## 1. Classify (write it in the card)
| Class | What to do |
|---|---|
| App defect | continue |
| New feature or changed behaviour (the spec does not say it) | not a fix: follow [`FEATURES.md`](FEATURES.md) |
| Spec or product decision (the app does what the spec says, the owner wants something else) | record it in the project's decision log, ask the owner, stop |
| Test defect (the test is wrong) | fix the test, write why |
| Data or environment (production data, a flag, a missing asset) | say what the owner must do; prepare the script if one is needed |

## 2. Locate
- `graphify` on the source folders and `graphify query "<symptom or function>"` to find callers and the area. Skip it when the file is already known.
- `investigate-first`: read the code path, the schema or migrations and the recent commits (`git log -5 -- <file>`) before touching anything.
- `systematic-debugging` if present; else: reproduce, narrow, one hypothesis at a time, evidence for each.
- Write the **cause** in the card (file, line, why). No code change before this is written.

## 3. Red
- Write the test that fails for the right reason, at the lowest layer that shows the bug: a database rule as a database test, a server function as a function test, pure logic as a unit test, what a person sees as a browser test, phone-only behaviour as a device flow. The folders must match `testPaths` in the config, or `ship.mjs` will not see the test.
- `test-driven-development` if present. Run it and read the failure; paste the failing line in the card.
- A requirement id (`requirementIdPattern`) for the new test: reuse the existing one if the bug breaks a listed requirement. If there is none, say so in the card; step 8 adds it on the tests branch.

## 4. Fix, minimal
- `surgical-patch` for a point fix. `safe-refactor` only if code must move to fix it, and then as a separate commit with no behaviour change. `lean-build` if a small new function is truly needed.
- Same style as the neighbouring code, same comment density, same line endings. No unrelated clean-up.
- A change of a blocking type (`blockingTypes`, usually native code or native plugins): stop and tell the owner it needs the slow path (for example a store build), see [`DELIVERY.md`](DELIVERY.md).

## 5. Prove
- `node scripts/fix/gate.mjs` picks the checks from the files changed against the base (the `checks` map in the config) and runs them; `--list` only prints them; `--full` runs the whole set; `--stack` adds the checks that need a local stack.
- Green means: the new test passes, it failed before the fix, the checks the gate chose pass. Read the output; do not report from memory.
- For UI: also look at it (a browser on the local build, or the test's screenshot).
- `verify-and-stop`: when the conditions in the card are proven, stop. Do not widen the scope.

## 6. Classify the delivery
`gate.mjs` prints it: the highest type in `deliveryOrder` that a changed file maps to (`deliveryRules`), plus the other parts. Example order: `none` < `web` < `function` < `migration` < `native`.

## 7. Deliver
- Commit as `fix(<area>): <what> (<id>)`, ending with the Co-Authored-By line the session gives. Push the branch only when the owner allows pushes, then open the PR from [`templates/PR.md`](templates/PR.md).
- `node scripts/fix/ship.mjs <PR>` (or `--local` before a PR exists) checks the change (branch name, card, regression test, log row, test ticket, no result files, no blocking type) and prints the owner action from `ownerActions`.
- Read-only runner checks Claude may start are listed in `readOnlyChecks` (for example the `verify.yml` template in [`runner-templates/`](runner-templates/)).
- Everything that writes to production is the owner's: one command, or one approval of a gated workflow. Tell the owner clearly what it does and what to check afterwards.

## 8. Test-branch ticket (every fixed bug, unless it already has one)
A fixed bug is also a ticket for the tests branch (`testsBranch`), so the same bug cannot come back unseen and the test plan stays complete. The ticket is **provisional**: it starts as a note in the card and becomes a commit on the tests branch only if it adds something (a requirement, a case, a stronger oracle, a test). If nothing would be added, it is closed in the card as "covered, no change". Default assumption: a bug that reached the owner means a gap in the tests, so look for the gap first; "covered, no change" needs the case named and a reason it should have caught the bug (then the case itself is suspect and gets a stronger oracle). Work in a worktree of the tests branch, follow its own instructions and use its tools. Commit tests and plans only, never run results.
1. **Look for cover first:** search the requirement list and the cases for the screen, endpoint or rule. Write the result in the card ("Test ticket").
2. **Already covered** (a requirement and a case state the right behaviour, and the case would have caught this bug): no duplicate. Point the regression test at the requirement id, and if the case missed the bug, tighten its oracle. Ticket = "covered, strengthened" or "covered, no change".
3. **Not covered or too weak:** add what is missing: a requirement row with the next free id, a case whose oracle does not read the answer from the app, the regression test from step 3 at the right layer and linked from the test plan. A whole untested journey becomes a new test module ([`FEATURES.md`](FEATURES.md) step 4).
4. **Regenerate, never hand-edit generated files**, with the tests branch's own commands.
5. Add a row to the tests branch's update log and bug list (additions only) naming the bug id, the requirement id and the fix PR. Its commit message names the bug id and the fix branch.
6. **Link both ways:** the fix PR names the requirement id and the tests-branch commit; the tests-branch commit names the bug id and the fix branch. The new test passes with the fix and fails without it.

A fix may be delivered before the ticket is merged, but the card is not closed until the ticket exists. If the report is a test defect, the ticket is the corrected test itself.

## 9. Record
- Append a row to the log (`logFiles`, by default [`LOG.md`](LOG.md)): date, id, area, delivery, PR, test ticket.
- Fill the card's "Prove" and "Delivery" sections after the owner confirms.

## Many bugs at once
- Turn the list into one entry per bug (`ralph-prd` can help), run step 2 (locate) for each so you know the files it will touch, then write `bugs.json` and run `node scripts/fix/fix-batch.mjs bugs.json --dry` to see the plan.
- `fix-batch.mjs` puts bugs that touch the same files (or a folder that holds them) in one **lane**, done in order; separate lanes run in parallel, in **waves**. Never two writers on the same file.
- Without `--dry` it creates one branch, worktree and card per bug, and a brief per bug in `<briefDir>/<batch>/` with `plan.md`. Dispatch one sub-agent per brief of a wave (`dispatching-parallel-agents`), each confined to its worktree (`git-worktree-isolation`). Each comes back with a commit on its branch; you push and open the PRs.
