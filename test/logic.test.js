import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyDb,
  checkOut,
  checkIn,
  openTrips,
  isOverdue,
  minutesOut,
  makeRoomCode,
} from '../lib/logic.js';

function seed() {
  const db = emptyDb();
  db.teachers.push({ id: 't1', name: 'Ms. Carter', roomName: 'Room 14', alertMinutes: 8 });
  db.students.push({ id: 's1', teacherId: 't1', name: 'Chris' });
  db.students.push({ id: 's2', teacherId: 't1', name: 'Grace' });
  db.students.push({ id: 's9', teacherId: 'other', name: 'Not Ours' });
  db.places.push({ id: 'p1', teacherId: 't1', name: 'Bathroom' });
  db.places.push({ id: 'p9', teacherId: 'other', name: 'Elsewhere' });
  return db;
}

const T0 = Date.parse('2026-11-13T11:30:00Z');
const min = (n) => n * 60 * 1000;

test('checkOut creates an open trip for a student in the room', () => {
  const db = seed();
  const trip = checkOut(db, { teacherId: 't1', studentId: 's1', placeId: 'p1', now: T0 });
  assert.equal(trip.studentId, 's1');
  assert.equal(trip.placeId, 'p1');
  assert.equal(trip.outAt, T0);
  assert.equal(trip.inAt, null);
  assert.deepEqual(openTrips(db, 't1').map((t) => t.id), [trip.id]);
});

test('checkOut refuses a student who is already out', () => {
  const db = seed();
  checkOut(db, { teacherId: 't1', studentId: 's1', placeId: 'p1', now: T0 });
  assert.throws(
    () => checkOut(db, { teacherId: 't1', studentId: 's1', placeId: 'p1', now: T0 + 1000 }),
    /already out/i,
  );
});

test('checkOut refuses students or places from another room', () => {
  const db = seed();
  assert.throws(() => checkOut(db, { teacherId: 't1', studentId: 's9', placeId: 'p1', now: T0 }), /student/i);
  assert.throws(() => checkOut(db, { teacherId: 't1', studentId: 's1', placeId: 'p9', now: T0 }), /place/i);
});

test('checkIn closes the trip and records who closed it', () => {
  const db = seed();
  const trip = checkOut(db, { teacherId: 't1', studentId: 's1', placeId: 'p1', now: T0 });
  const closed = checkIn(db, { teacherId: 't1', tripId: trip.id, by: 'teacher', now: T0 + min(4) });
  assert.equal(closed.inAt, T0 + min(4));
  assert.equal(closed.closedBy, 'teacher');
  assert.deepEqual(openTrips(db, 't1'), []);
});

test('checkIn refuses a trip that is already closed or belongs to another room', () => {
  const db = seed();
  const trip = checkOut(db, { teacherId: 't1', studentId: 's1', placeId: 'p1', now: T0 });
  checkIn(db, { teacherId: 't1', tripId: trip.id, by: 'student', now: T0 + min(1) });
  assert.throws(() => checkIn(db, { teacherId: 't1', tripId: trip.id, by: 'student', now: T0 + min(2) }), /already/i);
  const trip2 = checkOut(db, { teacherId: 't1', studentId: 's2', placeId: 'p1', now: T0 });
  assert.throws(() => checkIn(db, { teacherId: 'other', tripId: trip2.id, by: 'teacher', now: T0 }), /not found/i);
});

test('minutesOut and isOverdue use the room time limit', () => {
  const trip = { outAt: T0, inAt: null };
  assert.equal(minutesOut(trip, T0 + min(4) + 30_000), 4);
  assert.equal(isOverdue(trip, 8, T0 + min(7)), false);
  assert.equal(isOverdue(trip, 8, T0 + min(8)), true);
  // a closed trip is never overdue, however long it was
  assert.equal(isOverdue({ outAt: T0, inAt: T0 + min(30) }, 8, T0 + min(60)), false);
});

test('makeRoomCode is 6 chars and avoids look-alike characters', () => {
  for (let i = 0; i < 200; i++) {
    const code = makeRoomCode();
    assert.match(code, /^[A-Z2-9]{6}$/);
    assert.doesNotMatch(code, /[IO01]/);
  }
});
