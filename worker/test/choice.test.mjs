// parseChoice turns one line picked in the iOS Shortcut's "Choose from List" into
// a status + rating. It has to be forgiving: the list is hand-typed in the
// Shortcuts app, so a stray space or a renamed line must not cost a capture.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseChoice } from '../src/choice.js';

const cases = [
  ['★★★★★', 'read', 5],
  ['★★★★', 'read', 4],
  ['★★★', 'read', 3],
  ['★★', 'read', 2],
  ['★', 'read', 1],
  ['  ★★★  ', 'read', 3],
  ['★★★ (good)', 'read', 3],

  // The iOS keyboard has no star key, so the list is often typed with asterisks.
  ['*****', 'read', 5],
  ['****', 'read', 4],
  ['***', 'read', 3],
  ['**', 'read', 2],
  ['*', 'read', 1],
  ['  ***  ', 'read', 3],
  ['Read later', 'toread', 0],
  ['read later', 'toread', 0],
  ['Later', 'toread', 0],
  ['Save for later', 'toread', 0],
  ['5', 'read', 5],
  ['1', 'read', 1],
  ['Read', 'read', 0],
  ['', 'read', 0],
  ['anything else', 'read', 0],
  ['★★★★★★★', 'read', 5],
];

for (const [input, status, rating] of cases) {
  test(`parseChoice(${JSON.stringify(input)}) -> ${status} ${rating}`, () => {
    assert.deepEqual(parseChoice(input), { status, rating });
  });
}

test('a starred line beats the word "later" appearing in it', () => {
  // "★★★ read later" is ambiguous; stars are the stronger signal.
  assert.deepEqual(parseChoice('★★★ read later'), { status: 'read', rating: 3 });
});
