# Browser-test conventions (qa-pack)

These rules apply to every case under `paths.cases` and to every spec compiled from one. They extend the format of
the third-party `browser-test` skills (author, refiner, runner, compiler; see THIRD_PARTY.md): Summary,
Preconditions, Before Hook, Test Steps, After Hook.

## Case format

- **Summary**: one paragraph saying who does what on which screen, and what a correct result is.
- **Preconditions**: `**Standard preconditions**`, `**Environments:** local`, and a `**Markers:**` line with
  `@planned`, the area slug and the module id (`@J01`).
- **Before Hook**: `### Setup 0. Fixture preflight` (when the case needs fixtures), then `### Setup n.` steps.
- **Test Steps**: `### n. <REQ-ID> Title`, numbered from 1 with no gaps. Each step has what the user does, a
  `**Verify:**` line with the exact expected values, and an `**Oracle:**` line (see below). Optional lines:
  `Screenshot: <path> (viewport 390x844 dpr 2)`, `Design contract: <screen>#<key>[, <screen>#<key>]`,
  `Golden: <path>`.
- **After Hook**: idempotent cleanup. It deletes only what the case created (a title prefix such as `QA J01 `)
  and a second run matches nothing.

## Personas and secrets

- Personas are named only by key (`MEMBER`, `ADMIN`...). Credentials live in the gitignored
  `env.personasFile` as `<env.prefix><KEY>_USER` / `_PASSWORD`; a case or a spec never contains a value.
- Log in through the real login form once per persona (`auth.setup`), save the storage state, and reuse it.
  A test that logs out or changes a password uses a throw-away user, never a saved persona.
- Every test starts in a fresh browser context. Writes go only to rows the test created.

## Correctness oracles (refiner rule, applies to every case)

A step passes only when the result is CORRECT, not merely present or "as the code does it". Every Verify must
name its oracle:

1. **Independent ground truth.** Compare against a source that does not come from the code under test: the seed
   fixture value, the spec text, an authoritative external reference, or a value computed in the test by a
   separate formula. Never compare the app with itself.
2. **Right value, not any value.** A number, date, location or price must equal the source's value within a
   stated tolerance (for example a coordinate within 150 m, a time in the project's time zone), not just be
   "some value" or "in the future". Every place that shows the value shows the same value.
3. **Every item, not a sample.** When a rule applies to a set, the case iterates over ALL items of the seed or
   feed, asserts the expected total, and fails listing each offending id.
4. **Quality, as a real user sees it.** Images: rendered `naturalWidth`/`naturalHeight` at least the slot size
   times devicePixelRatio, the right aspect, no placeholder where a real image is expected. Text: no truncation,
   no raw keys, no mojibake, the right language. Links: the real `href` and the page it opens (status, title),
   not just that a link exists.
5. **Determinism and idempotence.** The same input gives the same output (compare hashes); a second run creates
   no duplicates.
6. **Real-user viewing.** Check at the mobile viewport (390x844, dpr 2) and at a desktop viewport. The assertion
   reads what the user reads (visible text, rendered pixels), not an internal field.
7. **Negative proof.** For each important positive check, add the wrong-value case that must fail (a value out
   of tolerance, a too-small image, a duplicate row), so the oracle is shown to be able to fail.

Screenshots are evidence of what the user saw; they never replace the numeric or textual assertion.

## Setup 0, design contract, tags, version

- **Setup 0. Fixture preflight.** A case that needs generated files or database fixtures first checks that they
  exist and stops with the list when one is missing; it never fails halfway through.
- **Design contract.** The visual expectation of a step is a key of `<paths.contracts>/<screen>.json` (tokens,
  sizes, text, hrefs, image resolution, contrast), checked by `expectDesign(page, screen, { keys })` against
  computed styles and real pixels. Screenshots are candidates until the owner approves them; approved ones in
  `paths.golden` may be compared with `toHaveScreenshot` on a fixed platform. A prose "looks like the design" is
  not a check.
- **Tags.** `@known-divergence`: the step asserts the spec and fails today because the app differs; compile it
  with `test.fail()` and the reason, never `skip`/`fixme`; it must pass unchanged once the app is fixed.
  `@owner-decision`: the expected value is not decided; it is listed in `decisions.md` until the owner decides.
- **Version.** An expected app version comes from the environment (for example `<env.prefix>RELEASE_VERSION`,
  default the highest `v*` git tag), never a literal in a case.

## Ids

- Requirement ids match `ids.requirement` (for example `R1-003`). A compiled test title contains the id only when
  the test truly asserts that requirement: `coverage-link.mjs` counts titles.
- Module ids match `ids.module` (for example `J01`). One module = one journey group = one compiled spec.
