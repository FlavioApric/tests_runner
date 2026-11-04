---
name: qa-refiner
description: Strengthen a browser test case so it proves the result is CORRECT, not just present - independent oracle, right value with tolerance, every item with a total, real-user quality, determinism, mobile and desktop, negative proof. Use after authoring a case, or when a test passes but the output might be wrong.
---

# /qa-refiner

Adapts `browser-test:refiner` (Autodesk/claude-browser-test-skills, Apache-2.0, by reference). Apply the "Correctness
oracles" of `qa-pack/conventions.md` to every Verify:
1. independent ground truth (seed, spec, separate formula; never the app compared with itself);
2. the RIGHT value within a stated tolerance, and the same value everywhere it is shown;
3. every item with an asserted total, failing with the list of offending ids;
4. quality as a user sees it (image natural size for the slot at the dpr, aspect, no placeholder; text not truncated;
   the real href and the page it opens);
5. determinism and idempotence (same hash, no duplicate on a second run);
6. mobile 390x844 dpr 2 and desktop;
7. a negative proof that must fail.
Add the fixtures the oracle needs to Setup 0. Keep ids, numbering, tags and the Screenshot / Design contract / Golden
lines. Never write secret values. Then `pack.mjs validate`; module status `refined`.
