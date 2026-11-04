# {{ID}}: {{TITLE}}

- Reported: {{DATE}}
- Branch: `{{BRANCH}}`
- Area: <screen, function or table>
- Requirement: <requirement id, or "none yet">
- Class: <app defect | spec decision | test defect | data/environment>

## Report
What the owner wrote (copy it; add the screenshot path if any).

## Reproduce
Role, device or browser, steps, expected, got.

## Cause
File and line, and why it happens. Written before any code change.

## Red
The test (path) and the failing line it produces before the fix.

## Fix
What changed, in a few sentences. Files touched.

## Prove
Commands run and their result (pass counts, not logs). The delivery type printed by `node scripts/fix/gate.mjs`.

## Test ticket (tests branch `{{TESTS_BRANCH}}`)
- Cover found: <requirement id and case path, or "none">
- Action: <covered, no change | covered, strengthened | new requirement | new test module>
- Files added or changed on the tests branch, and the commit.
- Update-log row and bug-list row on the tests branch: done / not yet.

## Delivery
Type, the owner's command or approval, PR link, date delivered, how it was checked afterwards.
