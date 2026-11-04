# Which skill, when

The playbook names skills by their name. They are not vendored on this branch; install them in the project or the user scope, or follow the step by hand where one is missing.

| Skill | Use it for | Do not use it for |
|---|---|---|
| `grilling` | Step 0, when a report cannot be reproduced: the shortest set of questions that makes it reproducible | Bugs that are already clear |
| `investigate-first` | Step 2: read code, schema and history before changing anything | Re-reading what the card already states |
| `graphify` | Step 2: callers, dependencies and area of an unfamiliar function (`graphify query`, `path`, `explain`). Keep its output folder out of git (it is in `resultFiles`) | A fix in a file you already know |
| `surgical-patch` | Step 4: a small, exact change in one or two places | Changes that move code |
| `safe-refactor` | Step 4: when code must move or be split to fix the bug; separate commit, no behaviour change, tests before and after | Fixing a bug in the same commit |
| `lean-build` | Step 4: a small new function or module the fix truly needs, in the smallest shape | Features |
| `verify-and-stop` | Step 5: prove the conditions in the card and stop | Finding more work |
| `ralph-prd`, `ralph` | A list of bugs: turn it into one entry per bug | A single bug |
| `dispatching-parallel-agents` | "Many bugs at once": one sub-agent per `fix-batch.mjs` brief of a wave | Bugs in the same lane (they share files) |
| `git-worktree-isolation` | Every fix agent: stay inside its own worktree, never touch another checkout | |
| `browser-test:*` | Reproducing and re-running a browser case | Backend-only bugs |
| `/qa-fix` (this branch) | A failing test case: classify, cause, red, minimal fix, verify, regression | Reports that are not test cases |
| `/fix`, `/fix-ship` (this branch) | The entry points that run this playbook and the delivery check | |

## Superpowers (optional)
A third-party plugin (`obra/superpowers`, MIT) that adds `systematic-debugging`, `test-driven-development`, `verification-before-completion`, `writing-plans`, `dispatching-parallel-agents`, `using-git-worktrees`. Review it before installing; the owner installs it:

```
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

Without it the playbook already says what to do by hand: reproduce, one hypothesis at a time, failing test first, minimal fix, run the check and read its output.

## Model and cost
Locate and fix with the session model. Reading a wide area (many files, no edit) can go to a cheaper read-only sub-agent. Never delegate the decision on cause or on delivery type.
