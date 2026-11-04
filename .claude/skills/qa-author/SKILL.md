---
name: qa-author
description: Write a browser test case (markdown) for a feature of a qa-pack project - Summary, Preconditions with Markers, Before Hook with Setup 0, Test Steps with Verify and Oracle, Screenshot, Design contract and Golden lines, an After Hook that is safe to run twice. Use when a requirement or feature has no browser case yet.
---

# /qa-author

This skill adapts the third-party `browser-test:author` skill (Autodesk/claude-browser-test-skills, Apache-2.0,
installed by reference: see THIRD_PARTY.md) to the qa-pack format. When that plugin is enabled, use its interview and
exploration method; the output must still follow `qa-pack/conventions.md`.

1. Inputs: the module manifest (`<paths.modules>/<id>/module.json`), its requirement rows in `paths.requirements`
   (source text, code location, verdict), `app.docs` (the spec wins per `app.precedence`), and the real components
   for locators (`paths.inventoryMd`, the graphify graph if present).
2. Start from `qa-pack/templates/module/case.md`. One step per scenario: `### n. <REQ-ID> Title`, the action,
   `**Verify:**` with the exact values of the requirement, `**Oracle:**`, then optional `Screenshot:` /
   `Design contract: <screen>#<key>` / `Golden:` lines.
3. Personas only by key; credentials only by env name (`<env.prefix><KEY>_USER` / `_PASSWORD`). Fresh context per
   test. After Hook idempotent.
4. Tag steps that fail today by design `@known-divergence`, undecided ones `@owner-decision` (and add a row to
   `decisions.md`).
5. Finish with `node qa-pack/runners/pack.mjs validate --project <dir>`; set the module status to `authored`.
