---
name: qa-gate
description: Check the release gates (G0-G6 core, G5 mobile, G7-G9 store and legal when those profiles are on) of a qa-pack project and say exactly what is missing. Use when asked "can we ship", "what is left", or before a release.
---

# /qa-gate

`node qa-pack/runners/pack.mjs gate --project <dir> [G4] [--json]` prints each gate of the active profiles (qa.config
`gates.profiles`: core, mobile, store) green or red with the reason: a flow step not done, or an evidence file not
signed. Gates are defined in `qa-pack/gates/gates.json`; evidence templates are in `qa-pack/evidence/` and are copied
to `paths.gateEvidence`; a file counts only with a `Signed: <who> <yyyy-mm-dd>` line and no TODO/UNSIGNED.
Rules: 0 open decisions (G1), 0 pending scaffolds, 0 requirements without a test, design contract approved, backend
green, reliability repeat green, Maestro series green (mobile). "Published" (store profile) is only what the store
consoles and the live site show, never a green build. Only the owner signs evidence.
