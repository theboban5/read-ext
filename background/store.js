// Canonical local cache + the projections the UI renders from.
//
// The server is the source of truth; this is a full local copy of it so the stats
// page works offline. Rows are stored in exactly the server's shape, keyed by id,
// and projected into the flat {url, title, author, website, rating, date} arrays
// that stats.js / readlater.js have always consumed.
//
// The legacy blogEntries / toReadEntries keys are deleted once migration verifies.
// Keeping both representations in sync would be two things that must agree, and
// they would eventually disagree without anyone noticing.

import { urlKey, hostOf } from './urlkey.js';
import { applyEntry, applyRead, clampRating } from './apply.js';

export const K = {
  entries: 'entriesV3',
  reads: 'readsV3',
  meta: 'syncMeta',
  outbox: 'outbox',
  config: 'syncConfig',
  legacyBlogs: 'blogEntries',
  legacyToRead: 'toReadEntries',
  backupBlogs: 'blogEntries_v2_backup',
  backupToRead: 'toReadEntries_v2_backup',
};

export const DEFAULT_META = {
  since: 0,
  lastPullAt: null,
  lastPushAt: null,
  lastError: null,
  migrated: false,
  clientId: null,
};

// ---------- storage primitives ----------

export function localGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

export function localSet(obj) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(obj, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

export function localRemove(keys) {
  return new Promise((resolve) => chrome.storage.local.remove(keys, resolve));
}

export async function getMeta() {
  const { [K.meta]: meta } = await localGet(K.meta);
  return { ...DEFAULT_META, ...(meta || {}) };
}

export async function setMeta(patch) {
  const meta = await getMeta();
  const next = { ...meta, ...patch };
  await localSet({ [K.meta]: next });
  return next;
}

export async function getConfig() {
  // storage.local, never storage.sync -- the bearer token must not be replicated
  // into the Google account this extension is signed into.
  const { [K.config]: cfg } = await localGet(K.config);
  return cfg || { baseUrl: '', token: '' };
}

export async function setConfig(cfg) {
  await localSet({ [K.config]: { baseUrl: (cfg.baseUrl || '').replace(/\/+$/, ''), token: cfg.token || '' } });
}

export async function isConfigured() {
  const { baseUrl, token } = await getConfig();
  return Boolean(baseUrl && token);
}

async function getTables() {
  const data = await localGet([K.entries, K.reads]);
  return { entries: data[K.entries] || {}, reads: data[K.reads] || {} };
}

// ---------- projections ----------

/**
 * One element PER READ EVENT, so re-reading an article lights up both heatmap
 * cells. Shape matches what popup.js has always written, so stats.js needs no
 * change to its date parsing, year filter or heatmap bucketing.
 */
export async function projectRead() {
  const { entries, reads } = await getTables();
  const out = [];
  for (const r of Object.values(reads)) {
    if (r.deleted_at) continue;
    const e = entries[r.url_key];
    if (!e || e.deleted_at) continue;
    out.push({
      url: e.url,
      title: e.title || '',
      author: e.author || '',
      website: e.website || '',
      rating: r.rating || 0,
      date: new Date(r.read_at).toISOString(),
      // Extras the old shape did not carry. Harmless to existing consumers, and
      // they let the UI address a specific read event rather than a URL.
      readId: r.id,
      urlKey: r.url_key,
    });
  }
  return out.sort((a, b) => new Date(b.date) - new Date(a.date));
}

export async function projectToRead() {
  const { entries } = await getTables();
  return Object.values(entries)
    .filter((e) => !e.deleted_at && e.status === 'toread')
    .map((e) => ({
      url: e.url,
      title: e.title || '',
      author: e.author || '',
      website: e.website || '',
      date: new Date(e.saved_at ?? e.created_at).toISOString(),
      urlKey: e.url_key,
    }))
    .sort((a, b) => new Date(b.date) - new Date(a.date));
}

/** Reads for one article, newest first -- powers the popup's re-read prompt. */
export async function readsForUrl(url) {
  const key = urlKey(url);
  if (!key) return { key: null, entry: null, reads: [] };
  const { entries, reads } = await getTables();
  const e = entries[key];
  return {
    key,
    entry: e && !e.deleted_at ? e : null,
    reads: Object.values(reads)
      .filter((r) => r.url_key === key && !r.deleted_at)
      .sort((a, b) => b.read_at - a.read_at),
  };
}

export async function counts() {
  const { entries, reads } = await getTables();
  const live = Object.values(entries).filter((e) => !e.deleted_at);
  return {
    articles: live.length,
    toread: live.filter((e) => e.status === 'toread').length,
    reads: Object.values(reads).filter(
      (r) => !r.deleted_at && entries[r.url_key] && !entries[r.url_key].deleted_at
    ).length,
  };
}

// ---------- writes ----------

/**
 * Apply a change locally (so the UI updates instantly, online or not) and queue it
 * for the server. The local apply uses the same merge functions the worker runs,
 * so a reconnect confirms what you already saw rather than rewriting it.
 */
async function mutate(fn) {
  const { entries, reads } = await getTables();
  const now = Date.now();
  const ctx = { entries, reads, now, ops: [] };
  const result = await fn(ctx);
  await localSet({ [K.entries]: ctx.entries, [K.reads]: ctx.reads });
  if (ctx.ops.length) await enqueue(ctx.ops);
  return result;
}

export async function markRead({ url, title, author, website, rating, forceNewRead = false }) {
  const key = urlKey(url);
  if (!key) throw new Error('That page has no trackable URL.');

  return mutate(async (ctx) => {
    const existing = ctx.entries[key] || null;
    const entryRow = applyEntry(
      existing,
      {
        url_key: key,
        url: String(url).trim(),
        title,
        author,
        website: website || hostOf(url),
        status: 'read',
        source: 'ext',
      },
      { now: ctx.now, mode: 'merge' }
    );
    if (entryRow) ctx.entries[key] = { ...entryRow, seq: existing ? existing.seq : null };

    const existingReads = Object.values(ctx.reads).filter(
      (r) => r.url_key === key && !r.deleted_at
    );
    const res = applyRead(
      existingReads,
      { url_key: key, read_at: ctx.now, rating: clampRating(rating), source: 'ext', force_new: forceNewRead },
      { now: ctx.now, mode: 'force' }
    );
    if (res.row) ctx.reads[res.row.id] = { ...res.row, seq: null };

    ctx.ops.push({
      url: String(url).trim(),
      url_key: key,
      title,
      author,
      website: website || hostOf(url),
      status: 'read',
      source: 'ext',
      reads: res.row
        ? [{
            id: res.row.id,
            read_at: res.row.read_at,
            rating: res.row.rating,
            force: true,
            force_new: forceNewRead,
          }]
        : [],
    });

    return { isReread: res.op === 'insert' && existingReads.length > 0, readId: res.row && res.row.id };
  });
}

export async function addToReadLater({ url, title, author, website }) {
  const key = urlKey(url);
  if (!key) throw new Error('That page has no trackable URL.');

  return mutate(async (ctx) => {
    const existing = ctx.entries[key] || null;
    if (existing && !existing.deleted_at && existing.status === 'toread') {
      return { alreadyQueued: true };
    }
    if (existing && !existing.deleted_at && existing.status === 'read') {
      return { alreadyRead: true };
    }

    const row = applyEntry(
      existing,
      {
        url_key: key,
        url: String(url).trim(),
        title,
        author,
        website: website || hostOf(url),
        status: 'toread',
        saved_at: ctx.now,
        source: 'ext',
      },
      { now: ctx.now, mode: 'merge' }
    );
    if (row) ctx.entries[key] = { ...row, seq: existing ? existing.seq : null };

    ctx.ops.push({
      url: String(url).trim(),
      url_key: key,
      title,
      author,
      website: website || hostOf(url),
      status: 'toread',
      saved_at: ctx.now,
      source: 'ext',
    });
    return { added: true };
  });
}

/** Explicit rating change on one read event -- can go down as well as up. */
export async function setRating({ readId, rating }) {
  return mutate(async (ctx) => {
    const r = ctx.reads[readId];
    if (!r) throw new Error('That read is no longer here.');
    const next = clampRating(rating);
    ctx.reads[readId] = { ...r, rating: next, updated_at: ctx.now };
    ctx.ops.push({
      url: ctx.entries[r.url_key] ? ctx.entries[r.url_key].url : r.url_key,
      url_key: r.url_key,
      reads: [{ id: readId, read_at: r.read_at, rating: next, force: true }],
    });
    return { ok: true };
  });
}

export async function deleteEntry(url) {
  const key = urlKey(url) || url;
  return mutate(async (ctx) => {
    const e = ctx.entries[key];
    if (e) ctx.entries[key] = { ...e, deleted_at: ctx.now, updated_at: ctx.now };
    // Its reads go too, or the heatmap keeps counting a deleted article.
    for (const [id, r] of Object.entries(ctx.reads)) {
      if (r.url_key === key && !r.deleted_at) {
        ctx.reads[id] = { ...r, deleted_at: ctx.now, updated_at: ctx.now };
      }
    }
    ctx.ops.push({ url: e ? e.url : key, url_key: key, deleted: true, _delete: true });
    return { ok: true };
  });
}

export async function deleteRead(readId) {
  return mutate(async (ctx) => {
    const r = ctx.reads[readId];
    if (!r) return { ok: true };
    ctx.reads[readId] = { ...r, deleted_at: ctx.now, updated_at: ctx.now };
    ctx.ops.push({ url_key: r.url_key, _deleteRead: readId });
    return { ok: true };
  });
}

// ---------- outbox ----------

export async function getOutbox() {
  const { [K.outbox]: ob } = await localGet(K.outbox);
  return Array.isArray(ob) ? ob : [];
}

export async function setOutbox(ops) {
  await localSet({ [K.outbox]: ops });
}

/** Coalesce by url_key so a burst of edits to one article becomes one op. */
async function enqueue(ops) {
  const current = await getOutbox();
  for (const op of ops) {
    const i = current.findIndex((c) => c.url_key === op.url_key && !c._delete && !op._delete);
    if (i === -1) {
      current.push(op);
      continue;
    }
    const merged = { ...current[i], ...op };
    const reads = [...(current[i].reads || [])];
    for (const r of op.reads || []) {
      const j = reads.findIndex((x) => x.id === r.id);
      if (j >= 0) reads[j] = { ...reads[j], ...r };
      else reads.push(r);
    }
    merged.reads = reads;
    current[i] = merged;
  }
  await setOutbox(current);
}

// ---------- applying server truth ----------

/** Server rows are authoritative: overwrite, never merge. Tombstones are kept. */
export async function applyServerRows(serverEntries = [], serverReads = []) {
  const { entries, reads } = await getTables();
  for (const e of serverEntries) entries[e.url_key] = e;
  for (const r of serverReads) reads[r.id] = r;
  await localSet({ [K.entries]: entries, [K.reads]: reads });
  return { entries: serverEntries.length, reads: serverReads.length };
}

export async function replaceAll(serverEntries, serverReads) {
  const entries = {};
  const reads = {};
  for (const e of serverEntries) entries[e.url_key] = e;
  for (const r of serverReads) reads[r.id] = r;
  await localSet({ [K.entries]: entries, [K.reads]: reads });
}
