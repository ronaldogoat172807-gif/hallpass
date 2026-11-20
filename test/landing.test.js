import { test } from 'node:test';
import assert from 'node:assert/strict';
import { landingTarget } from '../public/common.js';

const T = '/teacher.html', K = '/kiosk.html';

test('a browser signed in as teacher AND joined as the iPad opens the teacher board', () => {
  assert.equal(landingTarget({ teacher: true, kiosk: true }), T);
});

test('one sign-in goes to its own screen, none stays on the landing page', () => {
  assert.equal(landingTarget({ teacher: true, kiosk: false }), T);
  assert.equal(landingTarget({ teacher: false, kiosk: true }), K);
  assert.equal(landingTarget({ teacher: false, kiosk: false }), null);
});

test('?as=ipad asks for the iPad screen, and shows the join form if not joined yet', () => {
  assert.equal(landingTarget({ teacher: true, kiosk: true, as: 'ipad' }), K);
  assert.equal(landingTarget({ teacher: true, kiosk: false, as: 'ipad' }), null);
});

test('?as=teacher asks for the teacher board, and shows sign-in if not signed in', () => {
  assert.equal(landingTarget({ teacher: true, kiosk: true, as: 'teacher' }), T);
  assert.equal(landingTarget({ teacher: false, kiosk: true, as: 'teacher' }), null);
});

test('a screen that lost its sign-in asks for that same sign-in again, never the other screen', async () => {
  const { readFileSync } = await import('node:fs');
  const page = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), 'utf8');
  assert.match(page('teacher.html'), /status === 401\) location\.replace\('\/\?as=teacher'\)/);
  assert.match(page('kiosk.html'), /status === 401\) location\.replace\('\/\?as=ipad'\)/);
  // with only an iPad sign-in left, the old teacher tab stays on the sign-in page
  assert.equal(landingTarget({ teacher: false, kiosk: true, as: 'teacher' }), null);
});

test('changed() is true only when the data differs, ignoring the server clock', async () => {
  const { changed } = await import('../public/common.js');
  assert.equal(changed('t', { students: ['a'], now: 1 }), true, 'first look');
  assert.equal(changed('t', { students: ['a'], now: 2 }), false, 'same data, later clock');
  assert.equal(changed('t', { students: ['a', 'b'], now: 3 }), true, 'new student');
  assert.equal(changed('other', { students: ['a', 'b'], now: 3 }), true, 'each screen tracks its own');
});

test('limitFor gives the limit of the place a trip went to, 5 if the place is gone', async () => {
  const { limitFor } = await import('../public/common.js');
  const places = [{ id: 'w', minutes: 2 }, { id: 'b', minutes: 9 }, { id: 'old' }];
  assert.equal(limitFor({ placeId: 'w' }, places), 2);
  assert.equal(limitFor({ placeId: 'b' }, places), 9);
  assert.equal(limitFor({ placeId: 'old' }, places), 5);
  assert.equal(limitFor({ placeId: 'deleted' }, places), 5);
});
