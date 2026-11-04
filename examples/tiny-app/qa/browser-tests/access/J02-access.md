# J02 Access

## Summary
Who can reach what: a guest gets 401 and the sign-in form, wrong credentials are refused with the spec message, a
member cannot delete another member's note (404, the note survives), and only an admin reads the admin stats. Every
cell of the generated access matrix (route x persona) is replayed.

## Preconditions
- **Standard preconditions** (see qa-pack/conventions.md)
- **Environments:** local
- **Markers:** @planned @access @J02

## Before Hook

### Setup 0. Fixture preflight
`qa/access/matrix.json` exists and is current (`node qa-pack/scripts/access-matrix.mjs --check`).

### Setup 1. Standard preconditions
Personas GUEST (no session), MEMBER, MEMBER_B, ADMIN. Notes written by the case start with `QA J02 `.

## Test Steps

### 1. R2-001 A guest gets 401 and the sign-in form
Open the home page and call `GET /api/notes` without a session.
**Verify:** status 401 with `Sign in required`; the page shows the Sign in form and no notes section.
**Oracle:** the status and text of docs/SPEC.md 2.1; the matrix cells of GUEST on every session route (all of them, total asserted).
Design contract: notes-home#signIn

### 2. R2-002 Wrong credentials are refused
Sign in with the MEMBER user and a wrong password.
**Verify:** status 401, the alert reads `Invalid credentials`, the page stays signed out.
**Oracle:** the message of docs/SPEC.md 2.2. Positive control: the right password signs in.

### 3. R2-003 A member cannot delete another member's note
MEMBER adds `QA J02 keep`; MEMBER_B sends `DELETE /api/notes/<id>` for it and for an id that does not exist.
**Verify:** both answer 404 with the same body; MEMBER still has the note.
**Oracle:** the two responses compared with each other (same status and body: no existence oracle) and MEMBER's API list re-read.

### 4. R2-004 Admin stats are for admins only
Call `GET /api/admin/stats` as GUEST, MEMBER, MEMBER_B and ADMIN.
**Verify:** 401, 403, 403, 200.
**Oracle:** the matrix generated from the router (qa/access/matrix.json), replayed cell by cell: every cell, total asserted. Negative proof: a cell that expects allow for MEMBER must fail.

## After Hook

### Teardown 1. Idempotent cleanup
MEMBER deletes every note whose title starts with `QA J02 `; a second run matches nothing.
