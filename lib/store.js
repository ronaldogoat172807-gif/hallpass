// One JSON file, written atomically. Plenty for one classroom.
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { emptyDb, HttpError } from './logic.js';

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

  // load/flush only matter for the hosted store below
  return { db, save, remote: false, async load() {}, async flush() {} };
}

// Hosted (Vercel): there is no disk to keep a file on, and each request may be served by a
// fresh copy of the server. So the whole database lives under one key in Upstash Redis,
// read at the start of a request (load) and written back before the reply goes out (flush).
export function openRedisStore({ url, token, key = 'hallpass:db' }) {
  const db = emptyDb();
  let dirty = false;

  async function command(...args) {
    if (!url || !token) {
      throw new HttpError(503, "The database isn't connected yet. Add Upstash Redis to this project in the Vercel dashboard, then redeploy.");
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new HttpError(503, `The database did not answer (${res.status}). Try again in a moment.`);
    return (await res.json()).result;
  }

  return {
    db,
    remote: true,
    save() { dirty = true; },
    async load() {
      const raw = await command('GET', key);
      for (const k of Object.keys(db)) delete db[k];
      Object.assign(db, emptyDb(), raw ? JSON.parse(raw) : {});
      dirty = false;
    },
    async flush() {
      if (!dirty) return;
      await command('SET', key, JSON.stringify(db));
      dirty = false;
    },
  };
}
