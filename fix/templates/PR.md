## What was wrong
<one or two sentences, the symptom users see> (<id>, card: <cardDir>/<id>.md)

## Cause
<file, why>

## Fix
<what changed>

## Proof
- Red: `<test path>` failed before the fix with `<line>`.
- Green: `<test path>` passes; `node scripts/fix/gate.mjs` passes (<n> checks).

## Test ticket
Requirement: `<requirement id>` (covered | new). Tests-branch commit: `<sha>` on `<testsBranch>`. Update-log row added: yes / no.

## Delivery
Type: <the type printed by gate.mjs>.
Owner action: <the line printed by ship.mjs>.
After: <what to check on a device, in the browser or in the admin panel>.
