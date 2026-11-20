import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { UPDATES, CURRENT, FIRST, unseenUpdates, isKnownVersion } from '../lib/updates.js';

test('updates are listed newest first and every one has slides', () => {
  assert.equal(CURRENT, UPDATES[0].version);
  for (const u of UPDATES) {
    assert.match(u.version, /^\d+\.\d+$/);
    assert.ok(u.slides.length > 0, `update ${u.version} needs slides`);
    for (const s of u.slides) assert.ok(s.title && s.text);
  }
  const numbers = UPDATES.map((u) => Number(u.version.split('.')[0]) * 1000 + Number(u.version.split('.')[1]));
  assert.deepEqual(numbers, [...numbers].sort((a, b) => b - a));
});

test('unseenUpdates returns only what came after the version last seen', () => {
  assert.deepEqual(unseenUpdates(CURRENT), []);
  assert.deepEqual(unseenUpdates(FIRST).map((u) => u.version), UPDATES.map((u) => u.version));
  assert.deepEqual(unseenUpdates(undefined), unseenUpdates(FIRST), 'accounts from before this feature see everything');
  assert.deepEqual(unseenUpdates('99.0'), []);
  const fake = [{ version: '0.10' }, { version: '0.9' }, { version: '0.2' }];
  assert.deepEqual(unseenUpdates('0.9', fake).map((u) => u.version), ['0.10'], '0.10 is newer than 0.9');
});

test('only real version numbers can be saved as seen', () => {
  assert.ok(isKnownVersion(CURRENT));
  assert.ok(isKnownVersion(FIRST));
  assert.ok(!isKnownVersion('banana'));
  assert.ok(!isKnownVersion(undefined));
});

test('the update number matches package.json and the landing page', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.version, `${CURRENT}.0`);
  assert.ok(readFileSync(new URL('../public/index.html', import.meta.url), 'utf8').includes(`<span>v${CURRENT}</span>`));
});
