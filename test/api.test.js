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

test('leaving the room from the iPad needs the teacher password', async () => {
  assert.equal((await ipad('GET', '/api/kiosk/state')).status, 200);
  const none = await ipad('POST', '/api/kiosk/leave', {});
  assert.equal(none.status, 401);
  const wrong = await ipad('POST', '/api/kiosk/leave', { password: 'guess123' });
  assert.equal(wrong.status, 401);
  assert.equal((await ipad('GET', '/api/kiosk/state')).status, 200, 'still joined after a wrong guess');

  const ok = await ipad('POST', '/api/kiosk/leave', { password: 'pencils123' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal((await ipad('GET', '/api/kiosk/state')).status, 401, 'kicked off after the right password');

  // rejoin so later tests still have an iPad
  const { json: { teacher: t } } = await teacher('GET', '/api/state');
  assert.equal((await ipad('POST', '/api/kiosk/join', { code: t.roomCode })).status, 200);
});

test('an exit code lets the iPad leave without the teacher password', async () => {
  const bad = await teacher('PATCH', '/api/settings', { exitCode: '12' });
  assert.equal(bad.status, 400, 'too short');
  const set = await teacher('PATCH', '/api/settings', { exitCode: '1234' });
  assert.equal(set.status, 200, set.text);
  assert.equal(set.json.teacher.exitCode, '1234');
  assert.ok(!('exitCode' in (await ipad('GET', '/api/kiosk/state')).json), 'iPad never sees the exit code');

  assert.equal((await ipad('POST', '/api/kiosk/leave', { password: '4321' })).status, 401);
  assert.equal((await ipad('POST', '/api/kiosk/leave', { password: '' })).status, 401);
  assert.equal((await ipad('GET', '/api/kiosk/state')).status, 200, 'still joined after wrong codes');
  assert.equal((await ipad('POST', '/api/kiosk/leave', { password: '1234' })).status, 200);
  assert.equal((await ipad('GET', '/api/kiosk/state')).status, 401, 'left with the exit code');

  // the teacher password still works too, and clearing the code turns it off
  assert.equal((await ipad('POST', '/api/kiosk/join', { code: set.json.teacher.roomCode })).status, 200);
  assert.equal((await ipad('POST', '/api/kiosk/leave', { password: 'pencils123' })).status, 200);
  assert.equal((await ipad('POST', '/api/kiosk/join', { code: set.json.teacher.roomCode })).status, 200);
  assert.equal((await teacher('PATCH', '/api/settings', { exitCode: '' })).status, 200);
  assert.equal((await ipad('POST', '/api/kiosk/leave', { password: '1234' })).status, 401, 'cleared code no longer works');
});

test('update notes: a new account has nothing to catch up on, an older one sees the slides once', async () => {
  const fresh = (await teacher('GET', '/api/state')).json;
  assert.match(fresh.version, /^\d+\.\d+$/);
  assert.deepEqual(fresh.updates, [], 'signed up on the current update');

  // pretend this account last looked during the very first version
  assert.equal((await teacher('PATCH', '/api/settings', { seenUpdate: 'banana' })).status, 400);
  assert.equal((await teacher('PATCH', '/api/settings', { seenUpdate: '0.1' })).status, 200);
  const old = (await teacher('GET', '/api/state')).json;
  assert.ok(old.updates.length > 0);
  assert.equal(old.updates[0].version, old.version);
  assert.ok(old.updates[0].slides[0].title);

  assert.equal((await teacher('PATCH', '/api/settings', { seenUpdate: old.version })).status, 200);
  assert.deepEqual((await teacher('GET', '/api/state')).json.updates, [], 'not shown again');
  assert.ok(!('updates' in (await ipad('GET', '/api/kiosk/state')).json), 'students never get the slideshow');
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

test('a signed-in teacher can open the iPad screen without signing out or typing the code', async () => {
  assert.equal((await stranger('POST', '/api/kiosk/open')).status, 401, 'needs a teacher sign-in');

  const laptop = device();
  assert.equal((await laptop('POST', '/api/login', { email: 'carter@school.test', password: 'pencils123' })).status, 200);
  const before = (await teacher('GET', '/api/state')).json;

  // the jar keeps the newest cookie, so after this the laptop only holds the iPad sign-in
  const open = await laptop('POST', '/api/kiosk/open');
  assert.equal(open.status, 200, open.text);
  const k = await laptop('GET', '/api/kiosk/state');
  assert.equal(k.status, 200, 'joined to the room');
  assert.equal(k.json.roomName, before.teacher.roomName);

  assert.equal((await teacher('GET', '/api/state')).status, 200, 'teacher sign-ins are untouched');
});
