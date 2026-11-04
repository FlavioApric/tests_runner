---
name: qa-runner
description: Execute one browser test case (markdown) of a qa-pack project step by step against the local app with Playwright or the browser tools, capture screenshots, check the design contract and report pass/fail per step. Use to run one case or journey by hand before it is compiled.
---

# /qa-runner

Adapts `browser-test:runner` (Autodesk/claude-browser-test-skills, Apache-2.0, by reference).
Preconditions: `/qa-run` green for the capabilities the case needs. Run Setup 0, the Before Hook, then each step:
perform it, check **Verify** with its **Oracle**, save the screenshot at the step's path, check the contract keys
(`expectDesign(page, screen, { keys })` from `qa-pack/lib/designContract.mjs`), then the After Hook (twice when asked:
it must be idempotent).
Report per step: oracle value, observed value, screenshot path, verdict. A failing `@known-divergence` step is
expected; anything else is a defect for `/qa-fix`. Reference-image candidates go to `paths.candidates`; only the owner
approves them into `paths.golden`. No retries, no skipping.
