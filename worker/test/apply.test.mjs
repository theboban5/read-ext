// Merge rules. These decide what happens when two devices disagree, so the cases
// below are the ones that would silently lose data if they regressed.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEntry, applyRead, READ_DEDUPE_WINDOW_MS } from '../src/apply.js';

const NOW = 1_700_000_000_000;
const base = () => ({
  url_key: 'https://ex.com/a',
  url: 'https://ex.com/a',
  title: 'Title',
  author: 'Ann',
  website: 'ex.com',
  status: 'read',
  saved_at: NOW - 1000,
  note: null,
  source: 'ext',
  created_at: NOW - 1000,
  updated_at: NOW - 1000,
  deleted_at: null,
  seq: 1,
});

const merge = (existing, incoming, mode = 'merge') =>
  applyEntry(existing, { url_key: 'https://ex.com/a', ...incoming }, { now: NOW, mode });

test('a phone capture never blanks an author it does not know', () => {
  const out = merge(base(), { author: '', title: '' });
  assert.equal(out, null, 'nothing changed, so no write');
});

test('a phone capture cannot re-queue something already read', () => {
  const out = merge(base(), { status: 'toread' });
  assert.equal(out, null);
});

test('read beats toread regardless of arrival order', () => {
  const queued = { ...base(), status: 'toread' };
  assert.equal(merge(queued, { status: 'read' }).status, 'read');
});

test('an explicit edit CAN clear the author', () => {
  const out = merge(base(), { author: '' }, 'force');
  assert.equal(out.author, null);
});

test('an explicit edit CAN change the author', () => {
  assert.equal(merge(base(), { author: 'Bob' }, 'force').author, 'Bob');
});

test('an explicit edit CAN re-queue a read article', () => {
  assert.equal(merge(base(), { status: 'toread' }, 'force').status, 'toread');
});

// This is the regression that matters: /api/rate and the mobile undo path both use
// mode 'force' but send only a url_key and a status. If "force" meant "overwrite
// with whatever is in the payload", rating an article would erase its title and
// author -- across every device, silently.
test('force with fields ABSENT leaves metadata alone', () => {
  const out = merge(base(), { status: 'read' }, 'force');
  assert.equal(out, null, 'no field actually changed, so no write at all');
});

test('force with only a status set keeps title and author', () => {
  const queued = { ...base(), status: 'toread' };
  const out = merge(queued, { status: 'read' }, 'force');
  assert.equal(out.title, 'Title');
  assert.equal(out.author, 'Ann');
});

test('url is never clearable, even by an explicit edit', () => {
  const out = merge(base(), { url: '', author: 'Bob' }, 'force');
  assert.equal(out.url, 'https://ex.com/a');
});

test('saved_at survives the read transition', () => {
  const queued = { ...base(), status: 'toread', saved_at: 12345 };
  assert.equal(merge(queued, { status: 'read' }).saved_at, 12345);
});

test('an unchanged merge writes nothing (keeps seq from churning)', () => {
  assert.equal(merge(base(), { title: 'Title', author: 'Ann' }), null);
});

// --- reads ---

const reads = () => [
  { id: 'r1', url_key: 'https://ex.com/a', read_at: NOW - 1000, rating: 4,
    source: 'ext', created_at: NOW, updated_at: NOW, deleted_at: null, seq: 2 },
];

test('a second read within 24h updates rather than inserting', () => {
  const r = applyRead(reads(), { url_key: 'https://ex.com/a', read_at: NOW, rating: 5 }, { now: NOW });
  assert.equal(r.op, 'update');
  assert.equal(r.row.rating, 5, 'MAX wins');
});

test('a bare capture cannot downgrade a rating', () => {
  const r = applyRead(reads(), { url_key: 'https://ex.com/a', read_at: NOW, rating: 0 }, { now: NOW });
  assert.equal(r.op, 'noop');
});

test('an explicit rating CAN downgrade', () => {
  const r = applyRead(reads(), { id: 'r1', url_key: 'https://ex.com/a', rating: 1 }, { now: NOW, mode: 'force' });
  assert.equal(r.op, 'update');
  assert.equal(r.row.rating, 1);
});

test('a read beyond the dedupe window is a separate event', () => {
  const later = NOW + READ_DEDUPE_WINDOW_MS + 1;
  const r = applyRead(reads(), { url_key: 'https://ex.com/a', read_at: later, rating: 3 }, { now: later });
  assert.equal(r.op, 'insert');
});

test('force_new makes a re-read even inside the window', () => {
  const r = applyRead(reads(), { url_key: 'https://ex.com/a', read_at: NOW, rating: 3, force_new: true }, { now: NOW });
  assert.equal(r.op, 'insert');
});
