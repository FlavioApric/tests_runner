# New features: documented, tested, and a new test module

A fix repairs behaviour the spec already describes. **A new feature (a new screen, flow, endpoint, function, flag, or a change to what the spec says) is not a fix.** It follows this path, and it is not delivered until it is documented and has its own test module.

## When this applies
| Request | Path |
|---|---|
| The app does not do what the spec says | Fix: [`PLAYBOOK.md`](PLAYBOOK.md) |
| The owner wants something the spec does not say, or wants it to work differently | Feature: this file, plus a decision |
| A fix needs a new screen, endpoint, table or flag to work | Split it: the feature part follows this file |

## Steps (in order)
1. **Decide and write it down.** Add a dated row to the project's decision log (what, why, owner, date, one id). If it changes what a screen or a flow does, update the matching spec section, the design notes when it touches the UI, and the architecture notes. The paths go in `featureChecks` so `ship.mjs --feature` can check them.
2. **Build it** on its own branch `feat/<slug>` from the base branch (not on a fix branch), small and modular: `lean-build` for the smallest shape, `safe-refactor` if existing code must move first, `graphify` to see what it touches. Keep it on the fastest delivery type where possible ([`DELIVERY.md`](DELIVERY.md)); say so in the PR if it needs a migration, a function or a native build.
3. **Flag it** when it is not ready for everyone: a feature flag, default off, switched on by the owner.
4. **Test it on the tests branch** (`testsBranch`), following that branch's own instructions (for example the `test-plan` pipeline of this repository):
   - open a **new test module** with the next free id; never reuse an id;
   - new requirement rows with the next free ids (`requirementIdPattern`);
   - cases with an oracle that does not read the answer from the app, and design checks for visible steps;
   - non-browser tests at the lowest layer that proves each rule (database, function, unit, browser, device), added to the test plan and the module manifest;
   - regenerate generated files with that branch's commands, never by hand; add an update-log row;
   - commit tests and plans only, never run results.
5. **Link the two.** The feature PR names the test module and requirement ids; the tests-branch commit names the feature branch and the decision id.
6. **Prove it.** The new tests run and pass; a negative case shows a test would fail without the feature. Read the output.
7. **Deliver** like a fix ([`DELIVERY.md`](DELIVERY.md)): owner command or approved workflow. The flag stays off until the owner switches it on.

## Definition of done for a feature
- [ ] Decision row and spec, design and architecture text updated; `ship.mjs --feature` passes its `featureChecks`.
- [ ] A new test module exists and the tests branch's validation is clean.
- [ ] Every new rule has a requirement id, a test at the right layer and an oracle that does not read the answer from the app.
- [ ] Generated files regenerated; update-log row added; no result files committed.
- [ ] Flag default off (or the owner said it goes live directly).
- [ ] Delivery type stated; the owner knows the command.

## Changing an existing feature
Update the decision and the spec text, re-check the affected requirements, and update the existing test module (add a case and the requirement id). Open a new module only if it becomes a separate journey. A requirement the spec drops stays, marked retired, with the reason.
