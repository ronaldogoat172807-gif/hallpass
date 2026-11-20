import express from 'express';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { openStore } from './lib/store.js';
import {
  checkOut, checkIn, openTrips, makeRoomCode, newId, HttpError,
} from './lib/logic.js';

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PLACES = ['Bathroom', 'Water', 'Nurse', 'Library', 'Office'];
const DAY = 24 * 60 * 60 * 1000;

export function createApp({ dataFile }) {
  const { db, save } = openStore(dataFile);
  const app = express();
  app.use(express.json());
  app.use(express.static(join(here, 'public')));

  // ---- live updates (Server-Sent Events) -------------------------------
  const listeners = new Map(); // teacherId -> Set<res>
  function broadcast(teacherId) {
    for (const res of listeners.get(teacherId) ?? []) {
      res.write(`event: changed\ndata: ${Date.now()}\n\n`);
    }
  }

  // ---- sessions ---------------------------------------------------------
  function cookies(req) {
    const out = {};
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }
  function setSession(res, kind, teacherId) {
    const token = randomBytes(24).toString('base64url');
    db.sessions.push({ token, kind, teacherId, createdAt: Date.now() });
    save();
    const name = kind === 'teacher' ? 'tsess' : 'ksess';
    res.cookie(name, token, { httpOnly: true, sameSite: 'lax', maxAge: 400 * DAY });
    return token;
  }
  function sessionOf(req, kind) {
    const name = kind === 'teacher' ? 'tsess' : 'ksess';
    const token = cookies(req)[name];
    if (!token) return null;
    const s = db.sessions.find((x) => x.token === token && x.kind === kind);
    if (!s) return null;
    const teacher = db.teachers.find((t) => t.id === s.teacherId);
    return teacher ? { session: s, teacher } : null;
  }
  const requireTeacher = (req, res, next) => {
    const s = sessionOf(req, 'teacher');
    if (!s) return res.status(401).json({ error: 'Please sign in.' });
    req.teacher = s.teacher;
    next();
  };
  const requireKiosk = (req, res, next) => {
    const s = sessionOf(req, 'kiosk');
    if (!s) return res.status(401).json({ error: 'This screen needs a room code.' });
    req.teacher = s.teacher;
    req.kiosk = true;
    next();
  };
  const requireAnyone = (req, res, next) => {
    const s = sessionOf(req, 'teacher') ?? sessionOf(req, 'kiosk');
    if (!s) return res.status(401).json({ error: 'Not signed in.' });
    req.teacher = s.teacher;
    req.kiosk = s.session.kind === 'kiosk';
    next();
  };

  // ---- passwords --------------------------------------------------------
  function hashPassword(password, salt = randomBytes(16).toString('hex')) {
    return { salt, hash: scryptSync(password, salt, 64).toString('hex') };
  }
  function checkPassword(teacher, password) {
    const { hash } = hashPassword(password, teacher.salt);
    return timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(teacher.passHash, 'hex'));
  }
  const publicTeacher = (t) => ({
    id: t.id, name: t.name, roomName: t.roomName, email: t.email,
    roomCode: t.roomCode, alertMinutes: t.alertMinutes, chime: t.chime,
    exitCode: t.exitCode || '',
  });

  // ---- teacher accounts -------------------------------------------------
  app.post('/api/signup', (req, res) => {
    const name = str(req.body.name), roomName = str(req.body.roomName);
    const email = str(req.body.email).toLowerCase(), password = String(req.body.password ?? '');
    if (!name || !roomName || !email) return fail(res, 400, 'Name, room name and email are all needed.');
    if (!/^[^@\s]+@[^@\s]+$/.test(email)) return fail(res, 400, 'That email does not look right.');
    if (password.length < 8) return fail(res, 400, 'Password needs at least 8 characters.');
    if (db.teachers.some((t) => t.email === email)) return fail(res, 409, 'There is already an account with that email.');

    const { salt, hash } = hashPassword(password);
    const teacher = {
      id: newId(), name, roomName, email, salt, passHash: hash,
      roomCode: uniqueRoomCode(), alertMinutes: 8, chime: true, createdAt: Date.now(),
    };
    db.teachers.push(teacher);
    for (const p of DEFAULT_PLACES) db.places.push({ id: newId(), teacherId: teacher.id, name: p });
    setSession(res, 'teacher', teacher.id);
    res.json({ teacher: publicTeacher(teacher) });
  });

  app.post('/api/login', (req, res) => {
    const email = str(req.body.email).toLowerCase();
    const teacher = db.teachers.find((t) => t.email === email);
    if (!teacher || !checkPassword(teacher, String(req.body.password ?? ''))) {
      return fail(res, 401, 'Wrong email or password.');
    }
    setSession(res, 'teacher', teacher.id);
    res.json({ teacher: publicTeacher(teacher) });
  });

  app.post('/api/logout', (req, res) => {
    const token = cookies(req).tsess;
    db.sessions = db.sessions.filter((s) => s.token !== token);
    save();
    res.clearCookie('tsess');
    res.json({ ok: true });
  });

  app.get('/api/me', requireTeacher, (req, res) => res.json({ teacher: publicTeacher(req.teacher) }));

  // ---- teacher dashboard ------------------------------------------------
  app.get('/api/state', requireTeacher, (req, res) => {
    const t = req.teacher;
    const since = Date.now() - DAY;
    res.json({
      teacher: publicTeacher(t),
      students: db.students.filter((s) => s.teacherId === t.id),
      places: db.places.filter((p) => p.teacherId === t.id),
      trips: db.trips.filter((x) => x.teacherId === t.id && (x.inAt === null || x.outAt >= since)),
      now: Date.now(),
    });
  });

  app.post('/api/students', requireTeacher, (req, res) => {
    const name = str(req.body.name);
    if (!name) return fail(res, 400, 'Give the student a name.');
    const student = { id: newId(), teacherId: req.teacher.id, name };
    db.students.push(student);
    save(); broadcast(req.teacher.id);
    res.json({ student });
  });

  app.delete('/api/students/:id', requireTeacher, (req, res) => {
    const student = db.students.find((s) => s.id === req.params.id && s.teacherId === req.teacher.id);
    if (!student) return fail(res, 404, 'Student not found.');
    if (openTrips(db, req.teacher.id).some((t) => t.studentId === student.id)) {
      return fail(res, 409, `${student.name} is out right now. Check them in first.`);
    }
    db.students = db.students.filter((s) => s !== student);
    save(); broadcast(req.teacher.id);
    res.json({ ok: true });
  });

  app.post('/api/places', requireTeacher, (req, res) => {
    const name = str(req.body.name);
    if (!name) return fail(res, 400, 'Give the place a name.');
    const place = { id: newId(), teacherId: req.teacher.id, name };
    db.places.push(place);
    save(); broadcast(req.teacher.id);
    res.json({ place });
  });

  app.delete('/api/places/:id', requireTeacher, (req, res) => {
    const place = db.places.find((p) => p.id === req.params.id && p.teacherId === req.teacher.id);
    if (!place) return fail(res, 404, 'Place not found.');
    db.places = db.places.filter((p) => p !== place);
    save(); broadcast(req.teacher.id);
    res.json({ ok: true });
  });

  app.patch('/api/settings', requireTeacher, (req, res) => {
    const t = req.teacher;
    const b = req.body;
    if ('alertMinutes' in b) {
      const n = Number(b.alertMinutes);
      if (!Number.isInteger(n) || n < 1 || n > 180) return fail(res, 400, 'Time limit must be 1 to 180 minutes.');
      t.alertMinutes = n;
    }
    if ('chime' in b) t.chime = Boolean(b.chime);
    if ('exitCode' in b) {
      const v = str(b.exitCode);
      if (v && !/^[A-Za-z0-9]{4,12}$/.test(v)) return fail(res, 400, 'Exit code must be 4 to 12 letters or numbers (or empty to turn it off).');
      t.exitCode = v;
    }
    if ('roomName' in b) { const v = str(b.roomName); if (!v) return fail(res, 400, 'Room name cannot be empty.'); t.roomName = v; }
    if ('name' in b) { const v = str(b.name); if (!v) return fail(res, 400, 'Name cannot be empty.'); t.name = v; }
    save(); broadcast(t.id);
    res.json({ teacher: publicTeacher(t) });
  });

  app.post('/api/settings/new-code', requireTeacher, (req, res) => {
    req.teacher.roomCode = uniqueRoomCode();
    // kick off any iPads joined with the old code
    db.sessions = db.sessions.filter((s) => !(s.kind === 'kiosk' && s.teacherId === req.teacher.id));
    save(); broadcast(req.teacher.id);
    res.json({ teacher: publicTeacher(req.teacher) });
  });

  // ---- kiosk (classroom iPad) ------------------------------------------
  app.post('/api/kiosk/join', (req, res) => {
    const code = str(req.body.code).toUpperCase();
    const teacher = db.teachers.find((t) => t.roomCode === code);
    if (!teacher) return fail(res, 404, 'No room has that code. Check it with your teacher.');
    setSession(res, 'kiosk', teacher.id);
    res.json({ roomName: teacher.roomName, teacherName: teacher.name });
  });

  // The teacher opening the iPad screen on her own computer: she is already signed in,
  // so join her room directly. Without this the only way to the join form was to sign
  // out, which signs out every tab in the browser, the teacher board included.
  app.post('/api/kiosk/open', requireTeacher, (req, res) => {
    const current = sessionOf(req, 'kiosk');
    if (current?.teacher.id !== req.teacher.id) setSession(res, 'kiosk', req.teacher.id);
    res.json({ roomName: req.teacher.roomName, teacherName: req.teacher.name });
  });

  // Students will absolutely press this button, so it needs the teacher's exit
  // code (if she set one) or her password.
  app.post('/api/kiosk/leave', requireKiosk, (req, res) => {
    const typed = String(req.body?.password ?? '');
    const exitCode = req.teacher.exitCode || '';
    const codeOk = exitCode !== '' && typed === exitCode;
    if (!codeOk && !checkPassword(req.teacher, typed)) {
      return fail(res, 401, exitCode ? "That's not the exit code." : "That's not the teacher's password.");
    }
    const token = cookies(req).ksess;
    db.sessions = db.sessions.filter((s) => s.token !== token);
    save();
    res.clearCookie('ksess');
    res.json({ ok: true });
  });

  app.get('/api/kiosk/state', requireKiosk, (req, res) => {
    const t = req.teacher;
    res.json({
      roomName: t.roomName,
      teacherName: t.name,
      alertMinutes: t.alertMinutes,
      students: db.students.filter((s) => s.teacherId === t.id),
      places: db.places.filter((p) => p.teacherId === t.id),
      openTrips: openTrips(db, t.id),
      now: Date.now(),
    });
  });

  // ---- trips (either screen) -------------------------------------------
  app.post('/api/trips', requireAnyone, (req, res) => {
    const trip = checkOut(db, {
      teacherId: req.teacher.id, studentId: str(req.body.studentId), placeId: str(req.body.placeId),
    });
    save(); broadcast(req.teacher.id);
    res.json({ trip });
  });

  app.post('/api/trips/:id/checkin', requireAnyone, (req, res) => {
    const trip = checkIn(db, {
      teacherId: req.teacher.id, tripId: req.params.id, by: req.kiosk ? 'student' : 'teacher',
    });
    save(); broadcast(req.teacher.id);
    res.json({ trip });
  });

  app.get('/api/events', requireAnyone, (req, res) => {
    res.set({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.flushHeaders();
    res.write('event: hello\ndata: ok\n\n');
    const set = listeners.get(req.teacher.id) ?? new Set();
    set.add(res);
    listeners.set(req.teacher.id, set);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); set.delete(res); });
  });

  // ---- errors -----------------------------------------------------------
  app.use((err, req, res, _next) => {
    if (err instanceof HttpError) return fail(res, err.status, err.message);
    if (err?.type === 'entity.parse.failed') return fail(res, 400, 'Bad JSON.');
    console.error(err);
    fail(res, 500, 'Something went wrong on the server.');
  });

  function uniqueRoomCode() {
    let code;
    do code = makeRoomCode(); while (db.teachers.some((t) => t.roomCode === code));
    return code;
  }
  return app;
}

function str(v) { return typeof v === 'string' ? v.trim() : ''; }
function fail(res, status, error) { return res.status(status).json({ error }); }

// Run directly: `node server.js`
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT) || 3000;
  const dataFile = process.env.DATA_FILE || join(here, 'data', 'db.json');
  createApp({ dataFile }).listen(port, () => {
    console.log(`Hall Pass is running at http://localhost:${port}`);
  });
}
