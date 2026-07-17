# Certificate Notes — Design

**Date:** 2026-07-17
**Issue:** [#41 — Feature: Notes Field for existing certificates](https://github.com/jeffcaldwellca/mkcertWeb/issues/41)
**Status:** Approved

## Problem

Users want to document certificate-related information (what a cert is for,
where it's deployed, renewal quirks) alongside each certificate in the UI.
Certificates are plain files on disk with no database, so there is currently
nowhere to put such metadata.

## Scope

- Every certificate card can hold one plain-text note: generated pairs,
  uploaded certs, archived certs, interface-SSL certs, and the Root CA card.
  Read-only certificates can still be annotated — notes are UI metadata, not
  certificate data.
- One note per logical certificate (the folder + base-name grouping the list
  already uses). No history, no markdown, no attachments.
- Notes survive archive/restore, server restarts, and container recreates.
- Notes are removed when their certificate is permanently deleted.

## Storage

New module `src/services/notesStore.js` owning `data/certificate-notes.json`:

```json
{
  "2026-07-17/localhost":   { "note": "staging nginx — renews via cron", "updatedAt": "2026-07-17T12:00:00.000Z" },
  "interface-ssl/server":   { "note": "…", "updatedAt": "…" }
}
```

- Key: `<folder>/<certname>`, where folder is one of the identifiers the UI
  already passes (`YYYY-MM-DD` date folder, `interface-ssl`, `legacy`,
  `root-ca`) and certname is the certificate base name.
- Loaded once at startup into an in-memory map; every mutation writes the
  whole file atomically (write to a temp file in the same directory, then
  rename).
- A missing file means "no notes". A malformed file is logged and treated as
  empty; the store is NOT overwritten until the first successful save (fail
  safe, matching the fail-fast spirit of `src/config/index.js` without
  bricking cert listing).
- `data/` already exists as the `mkcert_data:/app/data` volume in
  docker-compose (currently unused), so persistence needs no compose changes.
  The module creates the directory if absent.

API of the module: `get(key)`, `set(key, note)`, `remove(key)`, `all()`.
`set` with an empty/whitespace-only note behaves as `remove`.

## HTTP API

Both endpoints live in `src/routes/certificates.js`, using the same
`requireAuth`, folder validation (date pattern, `interface-ssl`, `legacy`,
`root-ca`), and `security.validateFilename(certname + '.pem')` discipline as
the existing archive/delete routes.

- **`GET /api/certificates`** — merges `note` (string, possibly absent) into
  each grouped certificate object via one map lookup per cert. No extra I/O.
- **`PUT /api/certificates/:folder/:certname/notes`** — body
  `{ "note": string }`.
  - `note` must be a string; max 2,000 characters; otherwise 400.
  - Empty string (or whitespace-only) deletes the stored note. 200 either way,
    returning `{ note }` as saved.
  - Rate limit: `generalRateLimiter` (no CLI process is spawned).
  - CSRF: enforced automatically — `verifyCsrf` covers PUT and the frontend
    `apiRequest` helper already attaches `X-CSRF-Token`.
  - The route does not check that the certificate exists on disk; a note for a
    key with no matching cert is harmless and cheaper than a scan. Orphans are
    cleaned by the delete routes (below) and are invisible in the UI.
- **`DELETE /api/certificates/:folder/:certname`** and
  **`DELETE /api/certificate/:filename`** — after successful file deletion,
  also `remove()` the note entry. The legacy `:filename` route deletes files
  in the certificates root, where the UI key may be either
  `interface-ssl/<base>` or `legacy/<base>` — it removes both candidate keys.

## UI

On every certificate card, a notes block between the info grid and the action
buttons (`public/script.js` card template):

- **Display state:** note text rendered with `escapeHtml`, wrapped in a
  container styled `white-space: pre-wrap` (line breaks preserved), plus an
  Edit button. When no note exists, a subtle "Add note" button only.
- **Edit state:** a `<textarea>` (maxlength 2000) prefilled with the current
  note, with Save and Cancel buttons. Save issues the PUT via `apiRequest`,
  then updates the card back to display state; Cancel restores display state
  without a request.
- All buttons use `data-action` values (`edit-note`, `save-note`,
  `cancel-note`) handled by the existing delegated click handler on
  `#certificates-list` — no inline handlers (the CSP source-guard test in
  `test/security-headers.test.js` enforces this) and no per-render rewiring.
- The current note value for editing comes from the client-side certificates
  data (kept when `displayCertificates` renders), never re-parsed from DOM.
- The Root CA card in the certificates list gets the same treatment for free;
  the separate Root CA info panel above the list is unchanged.

## Error handling

- PUT failures (network, 400, 403) surface through the existing
  `showAlert(...)` path; the textarea content is preserved so the user can
  retry without losing what they typed.
- Store write failures return 500 through the standard `apiResponse` helpers
  and leave the previous file intact (atomic rename).

## Testing

node:test, following the `archive-validation.test.js` mounting pattern (the
notes store path must be overridable or cwd-relative so tests use a fixture
directory):

- PUT stores a note and GET /api/certificates returns it on the right cert.
- PUT with empty string removes a previously stored note.
- PUT rejects: non-string note, >2,000 chars, invalid folder, invalid certname
  (400 each).
- DELETE of a certificate removes its note entry.
- notesStore unit tests: set/get/remove round-trip through a reload; malformed
  JSON file treated as empty without crashing.

Manual verification via Playwright before release: add → edit → cancel →
archive → restore (note persists) → delete (note gone from store file), and
the CSP/no-inline-handler suite stays green.

## Out of scope

- Notes on the SCEP page or in downloads/bundles.
- Multi-user attribution, note history, markdown rendering.
- Search/filter by note content.
