import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server.js';

let server, base, dir;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'hallpass-'));
  const app = createApp({ dataFile: join(dir, 'db.json') });
  server = app.listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

// tiny cookie jar so each "device" keeps its own session
function device() {
  let cookie = '';
  return async function call(method, path, body) {
    const res = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: res.status, json, text };
  };
}

const teacher = device();
const ipad = device();
const stranger = device();

test('teacher signs up and gets a room with default places', async () => {
  const r = await teacher('POST', '/api/signup', {
    name: 'Ms. Carter', roomName: 'Room 14', email: 'carter@school.test', password: 'pencils123',
  });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.teacher.roomName, 'Room 14');
  assert.ok(!('passHash' in r.json.teacher), 'password hash must not leak');

  const s = await teacher('GET', '/api/state');
  assert.equal(s.status, 200);
  assert.deepEqual(s.json.places.map((p) => p.name), ['Bathroom', 'Water', 'Nurse', 'Library', 'Office']);
  assert.equal(s.json.teacher.alertMinutes, 8);
  assert.match(s.json.teacher.roomCode, /^[A-Z2-9]{6}$/);
});

test('signup rejects a reused email and a short password', async () => {
  const dup = await stranger('POST', '/api/signup', {
    name: 'X', roomName: 'Y', email: 'carter@school.test', password: 'pencils123',
  });
  assert.equal(dup.status, 409);
  const short = await stranger('POST', '/api/signup', {
    name: 'X', roomName: 'Y', email: 'x@school.test', password: '123',
  });
  assert.equal(short.status, 400);
});

test('state and mutations need a teacher session', async () => {
  assert.equal((await stranger('GET', '/api/state')).status, 401);
  assert.equal((await stranger('POST', '/api/students', { name: 'Nope' })).status, 401);
});

test('teacher adds students', async () => {
  for (const name of ['Chris', 'Grace']) {
    const r = await teacher('POST', '/api/students', { name });
    assert.equal(r.status, 200, r.text);
  }
  const s = await teacher('GET', '/api/state');
  assert.deepEqual(s.json.students.map((x) => x.name), ['Chris', 'Grace']);
});

test('iPad joins with the room code and sees students but not settings', async () => {
  const bad = await ipad('POST', '/api/kiosk/join', { code: 'ZZZZZZ' });
  assert.equal(bad.status, 404);

  const { json: { teacher: t } } = await teacher('GET', '/api/state');
  const ok = await ipad('POST', '/api/kiosk/join', { code: t.roomCode.toLowerCase() });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.roomName, 'Room 14');

  const k = await ipad('GET', '/api/kiosk/state');
  assert.equal(k.status, 200);
  assert.deepEqual(k.json.students.map((x) => x.name), ['Chris', 'Grace']);
  assert.equal(k.json.alertMinutes, 8);
  assert.equal(k.json.roomCode, undefined, 'kiosk must not see the room code');

  // a kiosk cookie is not a teacher cookie
  assert.equal((await ipad('GET', '/api/state')).status, 401);
  assert.equal((await ipad('POST', '/api/students', { name: 'Hacker' })).status, 401);
});

test('student taps out on the iPad, trip shows up on both screens', async () => {
  const k = await ipad('GET', '/api/kiosk/state');
  const chris = k.json.students.find((s) => s.name === 'Chris');
  const bathroom = k.json.places.find((p) => p.name === 'Bathroom');

  const out = await ipad('POST', '/api/trips', { studentId: chris.id, placeId: bathroom.id });
  assert.equal(out.status, 200, out.text);
  assert.equal(out.json.trip.inAt, null);

  const again = await ipad('POST', '/api/trips', { studentId: chris.id, placeId: bathroom.id });
  assert.equal(again.status, 409, 'cannot leave twice');

  const k2 = await ipad('GET', '/api/kiosk/state');
  assert.equal(k2.json.openTrips.length, 1);
  const s = await teacher('GET', '/api/state');
  assert.equal(s.json.trips.filter((t) => t.inAt === null).length, 1);
});

test('teacher closes a forgotten check-in from the dashboard', async () => {
  const s = await teacher('GET', '/api/state');
  const open = s.json.trips.find((t) => t.inAt === null);
  const r = await teacher('POST', `/api/trips/${open.id}/checkin`);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.trip.closedBy, 'teacher');
  assert.ok(r.json.trip.inAt > 0);

  const twice = await teacher('POST', `/api/trips/${open.id}/checkin`);
  assert.equal(twice.status, 409);
});

test('student checks in from the iPad, closedBy is student', async () => {
  const k = await ipad('GET', '/api/kiosk/state');
  const grace = k.json.students.find((s) => s.name === 'Grace');
  const nurse = k.json.places.find((p) => p.name === 'Nurse');
  const out = await ipad('POST', '/api/trips', { studentId: grace.id, placeId: nurse.id });
  const back = await ipad('POST', `/api/trips/${out.json.trip.id}/checkin`);
  assert.equal(back.status, 200, back.text);
  assert.equal(back.json.trip.closedBy, 'student');
});

test('teacher changes settings and regenerates the room code, old code stops working', async () => {
  const before = (await teacher('GET', '/api/state')).json.teacher.roomCode;
  const r = await teacher('PATCH', '/api/settings', { alertMinutes: 5, chime: false });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.teacher.alertMinutes, 5);
  assert.equal(r.json.teacher.chime, false);

  const bad = await teacher('PATCH', '/api/settings', { alertMinutes: 0 });
  assert.equal(bad.status, 400);

  const nc = await teacher('POST', '/api/settings/new-code');
  assert.equal(nc.status, 200);
  assert.notEqual(nc.json.teacher.roomCode, before);
  const old = await stranger('POST', '/api/kiosk/join', { code: before });
  assert.equal(old.status, 404);

  // the iPad that was joined with the old code is kicked off and must rejoin
  assert.equal((await ipad('GET', '/api/kiosk/state')).status, 401);
  const rejoin = await ipad('POST', '/api/kiosk/join', { code: nc.json.teacher.roomCode });
  assert.equal(rejoin.status, 200);
});

test('removing a student who is out is refused; removing one who is in works', async () => {
  const k = await ipad('GET', '/api/kiosk/state');
  const chris = k.json.students.find((s) => s.name === 'Chris');
  const place = k.json.places[0];
  const out = await ipad('POST', '/api/trips', { studentId: chris.id, placeId: place.id });
  assert.equal(out.status, 200);
  assert.equal((await teacher('DELETE', `/api/students/${chris.id}`)).status, 409);
  await teacher('POST', `/api/trips/${out.json.trip.id}/checkin`);
  assert.equal((await teacher('DELETE', `/api/students/${chris.id}`)).status, 200);
  const s = await teacher('GET', '/api/state');
  assert.deepEqual(s.json.students.map((x) => x.name), ['Grace']);
});

test('logout then login works and data survived', async () => {
  assert.equal((await teacher('POST', '/api/logout')).status, 200);
  assert.equal((await teacher('GET', '/api/state')).status, 401);
  const wrong = await teacher('POST', '/api/login', { email: 'carter@school.test', password: 'nope' });
  assert.equal(wrong.status, 401);
  const ok = await teacher('POST', '/api/login', { email: 'CARTER@school.test', password: 'pencils123' });
  assert.equal(ok.status, 200, ok.text);
  const s = await teacher('GET', '/api/state');
  assert.equal(s.json.teacher.alertMinutes, 5);
  assert.ok(s.json.trips.length >= 3, 'history kept');
});

test('live updates: an SSE client hears about a change', async () => {
  const k = await ipad('GET', '/api/kiosk/state');
  const grace = k.json.students.find((s) => s.name === 'Grace');
  const place = k.json.places[0];

  const ctrl = new AbortController();
  const streamRes = await fetch(base + '/api/events', {
    headers: { cookie: await teacherCookie() },
    signal: ctrl.signal,
  });
  assert.equal(streamRes.status, 200);
  const reader = streamRes.body.getReader();
  const dec = new TextDecoder();

  const out = await ipad('POST', '/api/trips', { studentId: grace.id, placeId: place.id });
  assert.equal(out.status, 200);

  let buf = '';
  const deadline = Date.now() + 3000;
  while (!/event: changed/.test(buf) && Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value);
  }
  ctrl.abort();
  assert.match(buf, /event: changed/);
  await ipad('POST', `/api/trips/${out.json.trip.id}/checkin`);
});

// helper: a fresh teacher cookie for the streaming fetch (device() hides its cookie)
async function teacherCookie() {
  const res = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'carter@school.test', password: 'pencils123' }),
  });
  return res.headers.get('set-cookie').split(';')[0];
}
