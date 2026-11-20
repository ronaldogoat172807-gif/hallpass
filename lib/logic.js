// Pure classroom rules. No I/O here, so it is easy to test.
import { randomBytes, randomUUID } from 'node:crypto';

export function emptyDb() {
  return { teachers: [], students: [], places: [], trips: [], sessions: [] };
}

export function newId() {
  return randomUUID();
}

export function openTrips(db, teacherId) {
  return db.trips.filter((t) => t.teacherId === teacherId && t.inAt === null);
}

export function checkOut(db, { teacherId, studentId, placeId, now = Date.now() }) {
  const student = db.students.find((s) => s.id === studentId && s.teacherId === teacherId);
  if (!student) throw new HttpError(404, 'That student is not in this room.');
  const place = db.places.find((p) => p.id === placeId && p.teacherId === teacherId);
  if (!place) throw new HttpError(404, 'That place is not on the list for this room.');
  if (openTrips(db, teacherId).some((t) => t.studentId === studentId)) {
    throw new HttpError(409, `${student.name} is already out.`);
  }
  const trip = {
    id: newId(),
    teacherId,
    studentId,
    placeId,
    outAt: now,
    inAt: null,
    closedBy: null,
  };
  db.trips.push(trip);
  return trip;
}

export function checkIn(db, { teacherId, tripId, by, now = Date.now() }) {
  const trip = db.trips.find((t) => t.id === tripId && t.teacherId === teacherId);
  if (!trip) throw new HttpError(404, 'Trip not found.');
  if (trip.inAt !== null) throw new HttpError(409, 'Already checked back in.');
  trip.inAt = now;
  trip.closedBy = by;
  return trip;
}

export function minutesOut(trip, now = Date.now()) {
  const end = trip.inAt ?? now;
  return Math.floor((end - trip.outAt) / 60000);
}

export function isOverdue(trip, alertMinutes, now = Date.now()) {
  if (trip.inAt !== null) return false;
  return now - trip.outAt >= alertMinutes * 60000;
}

// 6 characters, no I/O/0/1 so it reads cleanly off a whiteboard.
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function makeRoomCode() {
  const bytes = randomBytes(6);
  let code = '';
  for (const b of bytes) code += CODE_CHARS[b % CODE_CHARS.length];
  return code;
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
