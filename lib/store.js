// One JSON file, written atomically. Plenty for one classroom.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { emptyDb } from './logic.js';

export function openStore(file) {
  mkdirSync(dirname(file), { recursive: true });
  let db = emptyDb();
  if (existsSync(file)) {
    try {
      db = { ...emptyDb(), ...JSON.parse(readFileSync(file, 'utf8')) };
    } catch (err) {
      console.error(`Could not read ${file}, starting empty:`, err.message);
    }
  }

  let pending = null;
  function save() {
    // coalesce bursts of writes into one write per tick
    if (pending) return;
    pending = setImmediate(() => {
      pending = null;
      const tmp = file + '.tmp';
      writeFileSync(tmp, JSON.stringify(db, null, 2));
      renameSync(tmp, file);
    });
  }

  return { db, save };
}
