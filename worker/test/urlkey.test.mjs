// Asserts the two copies of urlKey() agree with each other and with the vectors.
//
// The extension copy (background/urlkey.js) and the worker copy (worker/src/urlkey.js)
// must never drift: they are the identity function for an article, and a disagreement
// means the same article gets two rows -- silently, and only across devices.
//
// Run: npm test   (from worker/)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { urlKey as workerKey, URLKEY_VERSION as workerVersion, hostOf } from '../src/urlkey.js';
import { urlKey as extKey, URLKEY_VERSION as extVersion } from '../../background/urlkey.js';

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(here, 'urlkey-vectors.json'), 'utf8'));

// The extension applies writes optimistically against its local cache so the UI
// updates offline. It must reach the same answer the server would, or a reconnect
// would visibly rewrite what you just did.
for (const f of ['urlkey.js', 'apply.js']) {
  test(`the two copies of ${f} are byte-identical`, () => {
    const a = readFileSync(join(here, `../src/${f}`), 'utf8');
    const b = readFileSync(join(here, `../../background/${f}`), 'utf8');
    assert.equal(
      a,
      b,
      `worker/src/${f} and background/${f} have diverged. ` +
        'Edit one and copy it over the other -- they are the same function by contract.'
    );
  });
}

test('URLKEY_VERSION matches across copies', () => {
  assert.equal(workerVersion, extVersion);
});

test('vectors produce the expected key', async (t) => {
  for (const v of vectors) {
    await t.test(`${v.why} :: ${JSON.stringify(v.in)}`, () => {
      assert.equal(workerKey(v.in), v.out);
    });
  }
});

test('both copies agree on every vector', () => {
  for (const v of vectors) {
    assert.equal(extKey(v.in), workerKey(v.in), `copies disagree on ${JSON.stringify(v.in)}`);
  }
});

test('urlKey is idempotent (normalizing a key returns the key)', () => {
  for (const v of vectors) {
    if (v.out === null) continue;
    assert.equal(workerKey(v.out), v.out, `not idempotent for ${v.out}`);
  }
});

test('hostOf matches what popup.js has always stored', () => {
  assert.equal(hostOf('https://www.stratechery.com/a/b'), 'stratechery.com');
  assert.equal(hostOf('http://Example.COM:8080/x'), 'example.com');
  assert.equal(hostOf('not a url'), '');
});
