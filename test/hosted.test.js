// Hosted mode (Vercel): no disk, so data lives in an Upstash Redis database reached over
// HTTPS, and any request may land on a fresh copy of the server. A tiny fake Redis stands in.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../server.js';
import { openRedisStore } from '../lib/store.js';

let redis, redisUrl;
const kv = new Map();
const servers = [];

before(async () => {
  redis = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.headers.authorization !== 'Bearer test-token') { res.writeHead(401).end('{"error":"WRONGPASS"}'); return; }
      const [cmd, key, value] = JSON.parse(body);
      let result = null;
      if (cmd === 'GET') result = kv.get(key) ?? null;
      else if (cmd === 'SET') { kv.set(key, value); result = 'OK'; }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ result }));
    });
  }).listen(0);
  await new Promise((r) => redis.once('listening', r));
  redisUrl = `http://127.0.0.1:${redis.address().port}`;
});

after(() => { redis.close(); for (const s of servers) s.close(); });

// a brand-new copy of the server, like a fresh Vercel instance
async function instance(env = { url: redisUrl, token: 'test-token' }) {
  const server = createApp({ store: openRedisStore(env) }).listen(0);
  servers.push(server);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return async function call(method, path, body, cookie = '') {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] };
  };
}

test('data and sign-ins survive landing on a different copy of the server', async () => {
  const a = await instance();
  const signup = await a('POST', '/api/signup', {
    name: 'Ms. Carter', roomName: 'Room 14', password: 'pencils123',
  });
  assert.equal(signup.status, 200, signup.text);
  assert.equal((await a('POST', '/api/students', { name: 'Chris' }, signup.cookie)).status, 200);

  const b = await instance();
  const state = await b('GET', '/api/state', undefined, signup.cookie);
  assert.equal(state.status, 200, 'the sign-in cookie works on a server that never saw the signup');
  assert.deepEqual(state.json.students.map((s) => s.name), ['Chris']);
  assert.equal(state.json.places.length, 5);

  // a change made through B is seen by A, which still has its old copy in memory
  assert.equal((await b('POST', '/api/students', { name: 'Grace' }, signup.cookie)).status, 200);
  const again = await a('GET', '/api/state', undefined, signup.cookie);
  assert.deepEqual(again.json.students.map((s) => s.name), ['Chris', 'Grace']);
});

test('many changes at once on one server all get saved', async () => {
  const a = await instance();
  const login = await a('POST', '/api/login', { name: 'Ms. Carter', password: 'pencils123' });
  const names = ['Ava', 'Ben', 'Cy', 'Dee', 'Eli', 'Fay'];
  const results = await Promise.all(names.map((name) => a('POST', '/api/students', { name }, login.cookie)));
  assert.deepEqual(results.map((r) => r.status), names.map(() => 200));
  const state = await (await instance())('GET', '/api/state', undefined, login.cookie);
  assert.deepEqual(state.json.students.map((s) => s.name).sort(), ['Chris', 'Grace', ...names].sort());
});

test('hosted mode has no live stream, so screens fall back to checking every few seconds', async () => {
  const a = await instance();
  const login = await a('POST', '/api/login', { name: 'Ms. Carter', password: 'pencils123' });
  assert.equal((await a('GET', '/api/events', undefined, login.cookie)).status, 204);
});

test('a missing database gives a clear message instead of a crash', async () => {
  const a = await instance({ url: '', token: '' });
  const r = await a('POST', '/api/signup', { name: 'A', password: 'pencils123' });
  assert.equal(r.status, 503);
  assert.match(r.json.error, /database/i);
});
