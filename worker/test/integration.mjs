// Drives the REAL background/store.js and background/sync.js against a running
// worker, under a fake chrome.* API. This covers the parts that are expensive to
// get wrong -- migration, re-read events, heatmap dates, offline queueing -- without
// needing a browser.
//
//   Terminal 1:  cd worker && npx wrangler dev
//   Terminal 2:  cd worker && node test/integration.mjs
//
// It talks to a live server and mutates it, so point it at local dev or staging.

const BASE = process.env.BASE || 'http://localhost:8787';
const TOKEN = process.env.TOKEN || 'dev-token-not-a-secret';

// ---------- fake chrome ----------

let storage = {};
const alarms = new Map();
let badgeText = '';

globalThis.chrome = {
  runtime: { lastError: null, sendMessage: async () => {} },
  storage: {
    local: {
      get(keys, cb) {
        const list = keys == null ? Object.keys(storage) : Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const k of list) if (k in storage) out[k] = clone(storage[k]);
        cb(out);
      },
      set(obj, cb) {
        for (const [k, v] of Object.entries(obj)) storage[k] = clone(v);
        cb();
      },
      remove(keys, cb) {
        for (const k of Array.isArray(keys) ? keys : [keys]) delete storage[k];
        cb();
      },
    },
  },
  alarms: {
    create: (n, o) => alarms.set(n, o),
    clear: async (n) => alarms.delete(n),
  },
  action: {
    setBadgeText: ({ text }) => { badgeText = text; },
    setBadgeBackgroundColor: () => {},
  },
};

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

const store = await import('../../background/store.js');
const sync = await import('../../background/sync.js');

// ---------- harness ----------

let pass = 0;
let fail = 0;
const G = '\x1b[32m', R = '\x1b[31m', D = '\x1b[2m', O = '\x1b[0m';

function check(desc, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) { console.log(`  ${G}ok${O}   ${desc}`); pass++; }
  else { console.log(`  ${R}FAIL${O} ${desc}\n       expected ${e}, got ${a}`); fail++; }
}

function section(s) { console.log(`\n${s}`); }

async function reset(legacyBlogs = [], legacyToRead = []) {
  storage = {
    blogEntries: legacyBlogs,
    toReadEntries: legacyToRead,
    syncConfig: { baseUrl: BASE, token: TOKEN },
  };
  alarms.clear();
}

const RUN = `${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
const u = (n) => `https://ex.test/${RUN}/${n}`;
const iso = (y, m, d) => new Date(y, m - 1, d, 12, 0, 0).toISOString();

// The server is shared with other test runs, so every count is scoped to this run's
// URLs. That also proves migration leaves unrelated rows alone.
const mineRead = async () => (await store.projectRead()).filter((r) => r.url.includes(RUN));
const mineToRead = async () => (await store.projectToRead()).filter((r) => r.url.includes(RUN));
const mineArticles = async () =>
  new Set((await mineRead()).map((r) => r.urlKey)).size + (await mineToRead()).length;

// ---------------------------------------------------------------- migration
section('migration');

const legacyBlogs = [
  { url: u('a'), title: 'A', author: 'Ann', website: 'ex.test', rating: 5, date: iso(2025, 8, 1) },
  { url: u('b'), title: 'B', author: 'Bob', website: 'ex.test', rating: 3, date: iso(2026, 1, 15) },
  // Same article as (a) but with tracking junk -- must collapse into one article
  // while KEEPING its own read event.
  { url: u('a') + '?utm_source=news', title: 'A', author: '', website: 'ex.test', rating: 4, date: iso(2026, 6, 10) },
  { url: 'not-a-url', title: 'junk', author: '', website: '', rating: 1, date: iso(2025, 1, 1) },
];
const legacyToRead = [
  { url: u('c'), title: 'C', author: '', website: 'ex.test', date: iso(2026, 5, 1) },
  // Already read -- should end up as one 'read' article, not duplicated.
  { url: u('b'), title: 'B', author: '', website: 'ex.test', date: iso(2025, 12, 1) },
];

await reset(legacyBlogs, legacyToRead);

const preview = sync.buildMigrationOps(legacyBlogs, legacyToRead);
check('collapses 4+2 legacy rows into 3 articles', preview.ops.length, 3);
check('reports the utm_ collision', preview.collisions.pairs.length, 1);
check('drops the entry with no usable URL', preview.dropped.length, 1);
check(
  'keeps BOTH read events for the collided article',
  preview.ops.find((o) => o.url_key === u('a')).reads.length,
  2
);

const mig = await sync.migrate(() => {});
check('migration reports ok', mig.ok, true);
check('  3 articles round-tripped', await mineArticles(), 3);
check('  3 read events (2 for the collided article + 1)', (await mineRead()).length, 3);
check('  1 still queued', (await mineToRead()).length, 1);
check('  legacy blogEntries key deleted', storage.blogEntries, undefined);
check('  pre-migration backup retained', storage.blogEntries_v2_backup.length, 4);

const readProj = await mineRead();
check('projection yields one row per read event', readProj.length, 3);
check(
  'a re-read of the same article appears on both dates',
  readProj.filter((r) => r.url === u('a')).map((r) => r.date.slice(0, 7)).sort(),
  ['2025-08', '2026-06']
);
check(
  '  with its own rating each time',
  readProj.filter((r) => r.url === u('a')).map((r) => r.rating).sort(),
  [4, 5]
);
check(
  'the merged article keeps the author typed on the other row',
  readProj.find((r) => r.url === u('a')).author,
  'Ann'
);

// The heatmap buckets by LOCAL date; epoch-ms round-tripping must not shift the day.
const localDay = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
check(
  'heatmap day survives the epoch-ms round trip',
  readProj.filter((r) => r.url === u('a')).map((r) => localDay(r.date)).sort(),
  ['2025-08-01', '2026-06-10']
);

const toReadProj = await mineToRead();
check('read-later projection has only the unread one', toReadProj.map((t) => t.url), [u('c')]);
check('  an article read after queueing is NOT in the queue', toReadProj.some((t) => t.url === u('b')), false);

// ---------------------------------------------------------------- idempotence
section('re-running migration');
const again = await sync.migrate(() => {});
check('is a no-op once migrated', again.alreadyMigrated, true);
check('  articles unchanged', await mineArticles(), 3);
check('  read events unchanged', (await mineRead()).length, 3);

// ---------------------------------------------------------------- re-reads
section('marking a re-read');
const before = (await mineRead()).length;
await store.markRead({ url: u('b'), title: 'B', author: 'Bob', website: 'ex.test', rating: 2, forceNewRead: true });
await sync.push();
check('adds a read event rather than editing the old one', (await mineRead()).length, before + 1);
const bReads = (await mineRead()).filter((r) => r.url === u('b'));
check('  the article now has 2 reads', bReads.length, 2);
check('  each keeps its own rating', bReads.map((r) => r.rating).sort(), [2, 3]);

section('same-day double save');
const beforeDouble = (await mineRead()).length;
await store.markRead({ url: u('b'), title: 'B', author: 'Bob', website: 'ex.test', rating: 4, forceNewRead: false });
await sync.push();
check('is absorbed, not counted twice', (await mineRead()).length, beforeDouble);

// ---------------------------------------------------------------- offline
section('offline');
const realFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('offline'); };

await store.markRead({ url: u('d'), title: 'D', author: 'Dee', website: 'ex.test', rating: 5 });
check('a save still shows up locally', (await mineRead()).some((r) => r.url === u('d')), true);
check('  and queues in the outbox', (await store.getOutbox()).length > 0, true);

try { await sync.syncNow(); } catch { /* expected */ }
check('  the failure is recorded, not swallowed', (await store.getMeta()).lastError.code, 'network');
check('  and a retry alarm is armed', alarms.has('syncRetry'), true);
check('  nothing is lost from the outbox', (await store.getOutbox()).length > 0, true);

globalThis.fetch = realFetch;
await sync.syncNow();
check('reconnecting drains the outbox', (await store.getOutbox()).length, 0);
check('  and clears the error', (await store.getMeta()).lastError, null);
check('  and the badge', badgeText, '');

// ---------------------------------------------------------------- cross-device
section('cross-device conflict');
// Simulate the phone: a bare capture, no title/author, no rating.
await fetch(`${BASE}/api/capture`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ url: u('d') + '?fbclid=abc', status: 'toread', rating: 0, source: 'ios' }),
});
await sync.pull();
const dRows = (await mineRead()).filter((r) => r.url === u('d'));
check('a phone capture does not duplicate a tracked article', dRows.length, 1);
check('  does not downgrade the 5-star rating', dRows[0].rating, 5);
check('  does not blank out the author', dRows[0].author, 'Dee');
check('  and does not push it back into the queue',
  (await mineToRead()).some((t) => t.url === u('d')), false);

// ---------------------------------------------------------------- reset
section('reset local cache');
const cBefore = [await mineArticles(), (await mineRead()).length, (await mineToRead()).length];
await sync.resetLocalCache();
const cAfter = [await mineArticles(), (await mineRead()).length, (await mineToRead()).length];
check('articles, reads and queue all come back identical', cAfter, cBefore);

// ---------------------------------------------------------------- delete
section('delete');
await store.deleteEntry(u('c'));
await sync.push();
check('the article leaves the queue', (await mineToRead()).some((t) => t.url === u('c')), false);
await sync.resetLocalCache();
check('  and stays gone after a full re-pull (tombstone works)',
  (await mineToRead()).some((t) => t.url === u('c')), false);

// ----------------------------------------------------------------
console.log();
if (fail === 0) console.log(`${G}${pass} passed${O}\n`);
else console.log(`${R}${fail} failed${O}, ${pass} passed\n`);
process.exit(fail === 0 ? 0 : 1);
