// File-backed store for per-certificate notes (issue #41). One JSON file,
// loaded once, rewritten atomically on every mutation. Keys are
// "<folder>/<certname>" using the same folder identifiers the UI passes
// (YYYY-MM-DD, interface-ssl, legacy, root-ca).
const fs = require('fs');
const path = require('path');

const DEFAULT_NOTES_FILE = path.join(process.cwd(), 'data', 'certificate-notes.json');

function createNotesStore(filePath = DEFAULT_NOTES_FILE) {
  let notes = {};
  try {
    if (fs.existsSync(filePath)) {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('store root is not an object');
      }
      notes = parsed;
    }
  } catch (err) {
    // Fail safe, not fast: a broken notes file must not take down cert
    // listing. The bad file stays on disk until the first successful save.
    console.error(`certificate-notes: could not read ${filePath}, starting empty: ${err.message}`);
    notes = {};
  }

  function persist() {
    const dir = path.dirname(filePath);
    fs.mkdirSync(dir, { recursive: true });
    // Atomic write: rename within the same directory replaces the old file
    // all-or-nothing, so a crash mid-write can't corrupt existing notes.
    const tmp = path.join(dir, `.${path.basename(filePath)}.tmp`);
    fs.writeFileSync(tmp, JSON.stringify(notes, null, 2));
    fs.renameSync(tmp, filePath);
  }

  return {
    get(key) {
      return notes[key] ? notes[key].note : undefined;
    },
    set(key, note) {
      if (typeof note !== 'string' || note.trim() === '') {
        this.remove(key);
        return '';
      }
      notes[key] = { note, updatedAt: new Date().toISOString() };
      persist();
      return note;
    },
    remove(key) {
      if (notes[key]) {
        delete notes[key];
        persist();
      }
    },
    all() {
      return { ...notes };
    }
  };
}

module.exports = { createNotesStore, DEFAULT_NOTES_FILE };
