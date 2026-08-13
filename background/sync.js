// Push/pull against the worker.
//
// Server-first with a local cache: every render path reads the cache, so stats work
// in airplane mode; writes land locally first and drain from an outbox when the
// network comes back.
//
// Failures are loud on purpose. Sync that fails silently is what quietly loses a
// month of reading.

import {
  K, getConfig, getMeta, setMeta, getOutbox, setOutbox,
  applyServerRows, replaceAll, counts, localGet, localSet, localRemove, isConfigured,
} from './store.js';
import { urlKey, hostOf } from './urlkey.js';

const PULL_ALARM = 'syncPull';
const RETRY_ALARM = 'syncRetry';
const PUSH_CHUNK = 200;
const BACKOFF_MIN = [1, 2, 5, 15, 60];

// MV3 can wake the worker for an alarm while a message-triggered sync is running.
// Overlapping pulls would double-apply, so everything funnels through one promise.
let inFlight = null;
let pushTimer = null;
let failures = 0;

// ---------- http ----------

async function api(path, { method = 'GET', body } = {}) {
  const { baseUrl, token } = await getConfig();
  if (!baseUrl || !token) throw Object.assign(new Error('Sync is not set up yet.'), { code: 'unconfigured' });

  let res;
  try {
    res = await fetch(baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw Object.assign(new Error(`Cannot reach the sync server (${err.message}).`), { code: 'network' });
  }

  if (res.status === 401) {
    throw Object.assign(new Error('Sync token rejected. Check it in the extension options.'), { code: 'auth' });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw Object.assign(new Error(`Server error ${res.status}. ${text.slice(0, 200)}`), { code: 'server' });
  }
  return res.json();
}

export async function healthCheck(baseUrl, token) {
  const res = await fetch(baseUrl.replace(/\/+$/, '') + '/api/health', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new Error('Token rejected by the server.');
  if (!res.ok) throw new Error(`Server returned ${res.status}.`);
  const body = await res.json();
  if (!body.ok) throw new Error('Server responded but not with ok:true.');
  return body;
}

// ---------- pull ----------

export async function pull({ full = false } = {}) {
  const meta = await getMeta();
  let since = full ? 0 : meta.since || 0;
  let pages = 0;
  let entries = 0;
  let reads = 0;
  const allEntries = [];
  const allReads = [];

  for (;;) {
    const page = await api(`/api/pull?since=${since}&limit=500`);
    entries += page.entries.length;
    reads += page.reads.length;

    if (full) {
      allEntries.push(...page.entries);
      allReads.push(...page.reads);
    } else {
      await applyServerRows(page.entries, page.reads);
    }

    const next = page.next_since;
    // Guard against a server that never advances the cursor.
    if (!page.has_more || next === since) {
      since = next;
      break;
    }
    since = next;
    if (++pages > 500) break;
  }

  if (full) await replaceAll(allEntries, allReads);

  await setMeta({ since, lastPullAt: Date.now(), lastError: null });
  clearFailure();
  return { entries, reads, since };
}

// ---------- push ----------

export async function push() {
  const outbox = await getOutbox();
  if (!outbox.length) return { pushed: 0 };

  let remaining = [...outbox];
  let pushed = 0;

  while (remaining.length) {
    const chunk = remaining.slice(0, PUSH_CHUNK);

    const deletes = chunk.filter((op) => op._delete);
    const readDeletes = chunk.filter((op) => op._deleteRead);
    const upserts = chunk.filter((op) => !op._delete && !op._deleteRead);

    if (deletes.length || readDeletes.length) {
      await api('/api/delete', {
        method: 'POST',
        body: {
          url_keys: deletes.map((d) => d.url_key),
          read_ids: readDeletes.map((d) => d._deleteRead),
        },
      });
    }

    if (upserts.length) {
      const res = await api('/api/push', {
        method: 'POST',
        body: { mode: 'merge', entries: upserts.map(stripInternal) },
      });
      // The response carries the authoritative post-merge rows, so reconciling
      // costs nothing extra -- no follow-up pull.
      await applyServerRows(res.entries || [], res.reads || []);
      if (typeof res.next_since === 'number') await setMeta({ since: res.next_since });
    }

    pushed += chunk.length;
    remaining = remaining.slice(PUSH_CHUNK);
    // Persist progress after every chunk so a mid-drain failure does not resend.
    await setOutbox(remaining);
  }

  await setMeta({ lastPushAt: Date.now(), lastError: null });
  clearFailure();
  return { pushed };
}

function stripInternal(op) {
  const { _delete, _deleteRead, ...rest } = op;
  return rest;
}

/** Push entries straight through, bypassing the outbox. Used by restore-from-file. */
export async function pushRaw(entries, mode = 'seed') {
  const res = await api('/api/push', { method: 'POST', body: { mode, entries } });
  await applyServerRows(res.entries || [], res.reads || []);
  return res;
}

// ---------- orchestration ----------

export async function syncNow({ full = false } = {}) {
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      if (!(await isConfigured())) return { skipped: 'unconfigured' };
      const p = await push();
      const q = await pull({ full });
      return { ...p, ...q };
    } catch (err) {
      await recordFailure(err);
      throw err;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/** Fire-and-forget refresh used by the getters: return the cache now, catch up after. */
export function syncInBackground() {
  syncNow().catch(() => {});
}

export function schedulePush() {
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushTimer = null;
    syncNow().catch(() => {});
  }, 1500);
}

// ---------- failure handling ----------

async function recordFailure(err) {
  await setMeta({ lastError: { code: err.code || 'unknown', message: err.message, at: Date.now() } });

  if (err.code === 'unconfigured') return;

  if (err.code === 'auth') {
    // Retrying a rejected token forever just burns requests. Stop and show it.
    await chrome.alarms.clear(RETRY_ALARM);
    badge('!', '#c0392b');
    return;
  }

  badge('!', '#e67e22');
  const mins = BACKOFF_MIN[Math.min(failures++, BACKOFF_MIN.length - 1)];
  chrome.alarms.create(RETRY_ALARM, { delayInMinutes: mins });
}

function clearFailure() {
  failures = 0;
  chrome.alarms.clear(RETRY_ALARM);
  badge('', '#000000');
}

function badge(text, color) {
  try {
    chrome.action.setBadgeText({ text });
    if (text) chrome.action.setBadgeBackgroundColor({ color });
  } catch {
    /* action API unavailable in some contexts */
  }
}

export function installAlarms() {
  chrome.alarms.create(PULL_ALARM, { periodInMinutes: 5 });
}

export function handleAlarm(name) {
  if (name === PULL_ALARM || name === RETRY_ALARM) {
    syncNow().catch(() => {});
    return true;
  }
  return false;
}

// ---------- migration ----------

/**
 * One-time upload of the two legacy arrays.
 *
 * Order matters: back up first, report URL collisions before touching the server,
 * and verify counts before deleting anything local. Every one of those steps is
 * there because this runs exactly once over everything you have ever tracked.
 */
export async function migrate(onProgress = () => {}) {
  const meta = await getMeta();
  if (meta.migrated) return { alreadyMigrated: true };

  onProgress({ step: 'checking', message: 'Checking the server...' });
  const { baseUrl, token } = await getConfig();
  await healthCheck(baseUrl, token);

  const legacy = await localGet([K.legacyBlogs, K.legacyToRead]);
  const blogs = legacy[K.legacyBlogs] || [];
  const toRead = legacy[K.legacyToRead] || [];

  onProgress({ step: 'backup', message: 'Saving a pre-sync backup...' });
  await localSet({ [K.backupBlogs]: blogs, [K.backupToRead]: toRead });

  onProgress({ step: 'building', message: 'Preparing entries...' });
  const { ops, collisions, dropped } = buildMigrationOps(blogs, toRead);

  onProgress({
    step: 'review',
    message: `${ops.length} articles ready.`,
    collisions,
    dropped,
    before: { blogs: blogs.length, toRead: toRead.length },
  });

  onProgress({ step: 'uploading', message: `Uploading ${ops.length} articles...`, done: 0, total: ops.length });
  for (let i = 0; i < ops.length; i += PUSH_CHUNK) {
    const chunk = ops.slice(i, i + PUSH_CHUNK);
    await api('/api/push', { method: 'POST', body: { mode: 'seed', entries: chunk } });
    onProgress({ step: 'uploading', done: Math.min(i + chunk.length, ops.length), total: ops.length });
  }

  onProgress({ step: 'pulling', message: 'Downloading the merged result...' });
  await pull({ full: true });

  // Verify before committing. A migration that half-worked and deleted the
  // originals is the one outcome there is no recovering from.
  const after = await counts();
  const expectedReads = blogs.length - collisions.readsMerged;
  const problems = [];
  if (after.reads < expectedReads) {
    problems.push(`expected at least ${expectedReads} read events, found ${after.reads}`);
  }
  if (after.articles < ops.length - collisions.pairs.length) {
    problems.push(`expected at least ${ops.length - collisions.pairs.length} articles, found ${after.articles}`);
  }

  if (problems.length) {
    return { ok: false, problems, after, before: { blogs: blogs.length, toRead: toRead.length }, collisions };
  }

  await setMeta({ migrated: true });
  await localRemove([K.legacyBlogs, K.legacyToRead]);

  return {
    ok: true,
    after,
    before: { blogs: blogs.length, toRead: toRead.length },
    collisions,
    dropped,
  };
}

/**
 * Turn the two legacy arrays into push ops.
 *
 * A URL in both lists becomes one entry with status 'read' that keeps its saved_at
 * -- which actually recovers data cleanupReadLaterList() used to throw away.
 * Entries whose URLs normalize to the same key merge their metadata but KEEP BOTH
 * read events, so no reading history is lost to a collision.
 */
export function buildMigrationOps(blogs, toRead) {
  const byKey = new Map();
  const collisions = { pairs: [], readsMerged: 0 };
  const dropped = [];

  const touch = (key, url) => {
    if (!byKey.has(key)) {
      byKey.set(key, { url, url_key: key, source: 'migrate', reads: [], _urls: new Set([url]) });
    } else {
      byKey.get(key)._urls.add(url);
    }
    return byKey.get(key);
  };

  for (const b of toRead) {
    const key = urlKey(b && b.url);
    if (!key) { dropped.push(b && b.url); continue; }
    const op = touch(key, b.url);
    op.title = op.title || b.title || '';
    op.author = op.author || b.author || '';
    op.website = op.website || b.website || hostOf(b.url);
    if (!op.status) op.status = 'toread';
    const t = Date.parse(b.date);
    op.saved_at = Number.isFinite(t) ? Math.min(op.saved_at ?? t, t) : op.saved_at ?? null;
  }

  for (const b of blogs) {
    const key = urlKey(b && b.url);
    if (!key) { dropped.push(b && b.url); continue; }
    const op = touch(key, b.url);
    op.title = op.title || b.title || '';
    op.author = op.author || b.author || '';
    op.website = op.website || b.website || hostOf(b.url);
    op.status = 'read';
    const t = Date.parse(b.date);
    op.reads.push({
      read_at: Number.isFinite(t) ? t : Date.now(),
      rating: Math.min(5, Math.max(0, parseInt(b.rating, 10) || 0)),
      source: 'migrate',
      // Historical reads are distinct events even when close together; the 24h
      // dedupe window is for accidental double-taps, not for rewriting history.
      force_new: true,
    });
  }

  // Two legacy rows for the same normalized URL collapse to one article. Both of
  // their read events survive -- that is the part that must not be lost.
  for (const op of byKey.values()) {
    const seen = new Set();
    op.reads = op.reads.filter((r) => {
      const k = `${r.read_at}|${r.rating}`;
      if (seen.has(k)) { collisions.readsMerged++; return false; }
      seen.add(k);
      return true;
    });
    // Report each group once, with its final membership. Reporting on every join
    // made one 6-URL group look like five separate collisions.
    if (op._urls.size > 1) collisions.pairs.push({ key: op.url_key, urls: [...op._urls] });
    delete op._urls;
  }

  return { ops: [...byKey.values()], collisions, dropped };
}

export async function resetLocalCache() {
  await localRemove([K.entries, K.reads, K.outbox]);
  await setMeta({ since: 0, lastError: null });
  return pull({ full: true });
}
