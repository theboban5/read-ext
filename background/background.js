// Storage model:
//   - Before sync is set up: chrome.storage.local holds blogEntries / toReadEntries,
//     exactly as it always has. Nothing changes for an install that never connects.
//   - After migration: the Cloudflare worker is the source of truth and store.js
//     keeps a full local cache of it. The two legacy arrays are projected on read,
//     so popup / stats / readlater keep seeing the shape they expect.
//
// On install/startup we still merge any legacy chrome.storage.sync data into local
// so nothing from the pre-local era is lost or shadowed.

import * as store from './store.js';
import * as sync from './sync.js';

const { K, localGet, localSet } = store;

const BACKUP_EVERY_N_SAVES = 100;
const MONTHLY_MS = 30 * 24 * 60 * 60 * 1000;

chrome.runtime.onInstalled.addListener(() => {
  initialize();
});

chrome.runtime.onStartup.addListener(() => {
  initialize();
});

async function initialize() {
  try {
    await migrateLegacyData();
    await ensureInitialized();
    await ensureBackupBaseline();
    scheduleMonthlyBackup();
    sync.installAlarms();
    sync.syncInBackground();
  } catch (err) {
    console.error('Initialization failed:', err);
  }
}

// ---------- Storage primitives ----------

function syncGet(keys) {
  return new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
}

async function getBlogEntries() {
  if (await isSynced()) return store.projectRead();
  const { blogEntries } = await localGet('blogEntries');
  return blogEntries || [];
}

async function getToReadEntries() {
  if (await isSynced()) return store.projectToRead();
  const { toReadEntries } = await localGet('toReadEntries');
  return toReadEntries || [];
}

async function setBlogEntries(entries) {
  await localSet({ blogEntries: entries });
  await maybeAutoBackup(entries);
}

async function setToReadEntries(entries) {
  await localSet({ toReadEntries: entries });
}

async function isSynced() {
  const meta = await store.getMeta();
  return meta.migrated === true;
}

// ---------- One-time migration from sync (normal + chunked) into local ----------

async function migrateLegacyData() {
  if (await isSynced()) return;

  const local = await localGet(['blogEntries', 'toReadEntries']);
  const localBlogs = local.blogEntries || [];
  const localToRead = local.toReadEntries || [];

  const syncBlogs = await readSyncBlogEntries();
  const syncToRead = await readSyncToReadEntries();

  if (syncBlogs.length === 0 && syncToRead.length === 0) return;

  const mergedBlogs = mergeByUrl(localBlogs, syncBlogs);
  const mergedToRead = mergeByUrl(localToRead, syncToRead);

  if (mergedBlogs.length !== localBlogs.length || mergedToRead.length !== localToRead.length) {
    console.log('Migrating legacy sync data into local:', {
      localBlogs: localBlogs.length,
      syncBlogs: syncBlogs.length,
      mergedBlogs: mergedBlogs.length,
      localToRead: localToRead.length,
      syncToRead: syncToRead.length,
      mergedToRead: mergedToRead.length,
    });
    await localSet({ blogEntries: mergedBlogs, toReadEntries: mergedToRead });
  }
}

function mergeByUrl(primary, secondary) {
  const map = new Map();
  for (const e of primary) if (e && e.url) map.set(e.url, e);
  for (const e of secondary) if (e && e.url && !map.has(e.url)) map.set(e.url, e);
  return [...map.values()];
}

async function readSyncBlogEntries() {
  const data = await syncGet(['blogEntries', 'chunked_metadata']);
  if (data.blogEntries && data.blogEntries.length) return data.blogEntries;
  if (data.chunked_metadata && data.chunked_metadata.blogChunks) {
    return readSyncChunks('blog_chunk_', data.chunked_metadata.blogChunks);
  }
  return [];
}

async function readSyncToReadEntries() {
  const data = await syncGet(['toReadEntries', 'chunked_metadata']);
  if (data.toReadEntries && data.toReadEntries.length) return data.toReadEntries;
  if (data.chunked_metadata && data.chunked_metadata.toReadChunks) {
    return readSyncChunks('toread_chunk_', data.chunked_metadata.toReadChunks);
  }
  return [];
}

async function readSyncChunks(prefix, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const key = `${prefix}${i}`;
    const data = await syncGet(key);
    if (data[key]) out.push(...data[key]);
  }
  return out;
}

async function ensureInitialized() {
  if (await isSynced()) return;
  const data = await localGet(['blogEntries', 'toReadEntries']);
  const patch = {};
  if (!data.blogEntries) patch.blogEntries = [];
  if (!data.toReadEntries) patch.toReadEntries = [];
  if (Object.keys(patch).length) await localSet(patch);
}

// ---------- Read-later cleanup (drop URLs already in blogs) ----------

// Only needed for the unmigrated path. Once synced, an article is a single row with
// a status column, so it cannot be in both lists and there is nothing to clean up.
async function cleanupReadLaterList() {
  if (await isSynced()) return;

  const blogEntries = await getBlogEntries();
  const toReadEntries = await getToReadEntries();
  if (!blogEntries.length || !toReadEntries.length) return;

  const readUrls = new Set(blogEntries.map((e) => e.url));
  const filtered = toReadEntries.filter((e) => !readUrls.has(e.url));
  if (filtered.length !== toReadEntries.length) {
    await setToReadEntries(filtered);
  }
}

// ---------- Auto-backup every N saves ----------

async function ensureBackupBaseline() {
  const { lastBackupBucket } = await localGet('lastBackupBucket');
  if (typeof lastBackupBucket === 'number') return;
  const blogs = await getBlogEntries();
  await localSet({ lastBackupBucket: Math.floor(blogs.length / BACKUP_EVERY_N_SAVES) });
}

async function maybeAutoBackup(blogEntries) {
  const currentBucket = Math.floor(blogEntries.length / BACKUP_EVERY_N_SAVES);
  const { lastBackupBucket = 0 } = await localGet('lastBackupBucket');
  if (currentBucket <= lastBackupBucket) {
    if (currentBucket < lastBackupBucket) {
      await localSet({ lastBackupBucket: currentBucket });
    }
    return;
  }
  try {
    await downloadBackup(blogEntries, await getToReadEntries(), 'auto');
    await localSet({ lastBackupBucket: currentBucket });
  } catch (err) {
    console.error('Auto-backup failed:', err);
  }
}

async function downloadBackup(blogEntries, toReadEntries, tag) {
  const payload = {
    version: '2.0',
    exportDate: new Date().toISOString(),
    totalArticles: blogEntries.length,
    totalToRead: toReadEntries.length,
    blogEntries,
    toReadEntries,
  };
  const json = JSON.stringify(payload, null, 2);
  const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(json);
  const date = new Date().toISOString().split('T')[0];
  const filename = `blog-tracker-${tag}-backup-${date}-${blogEntries.length}.json`;
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url: dataUrl, filename, saveAs: false }, (id) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(id);
    });
  });
}

// ---------- Monthly backup alarm ----------

function scheduleMonthlyBackup() {
  chrome.storage.local.get(['lastBackupDate'], (data) => {
    const now = Date.now();
    const last = data.lastBackupDate ? new Date(data.lastBackupDate).getTime() : 0;
    const due = last + MONTHLY_MS;
    const fireAt = due > now ? due : now + 60 * 1000;
    chrome.alarms.create('monthlyBackup', { when: fireAt });
  });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (sync.handleAlarm(alarm.name)) return;
  if (alarm.name !== 'monthlyBackup') return;
  try {
    const blogs = await getBlogEntries();
    const toRead = await getToReadEntries();
    if (blogs.length || toRead.length) {
      await downloadBackup(blogs, toRead, 'monthly');
    }
    await localSet({ lastBackupDate: new Date().toISOString() });
  } catch (err) {
    console.error('Monthly backup failed:', err);
  } finally {
    chrome.alarms.create('monthlyBackup', { when: Date.now() + MONTHLY_MS });
  }
});

// ---------- Manual backup / restore ----------

async function createManualBackup(tag = 'manual') {
  const blogs = await getBlogEntries();
  const toRead = await getToReadEntries();
  await downloadBackup(blogs, toRead, tag);
  await localSet({ lastBackupDate: new Date().toISOString() });
}

// Accepts both shapes we have ever written:
//   v2.0 (background backups)  { blogEntries: [...], toReadEntries: [...] }
//   v1.0 (stats page "Export as JSON")  { entries: [...] }   -- read entries only
// v1.0 says nothing about the read-later list, so we keep the existing one rather
// than blanking it; otherwise importing your own export silently drops that list.
async function restoreFromBackup(fileContent) {
  const data = JSON.parse(fileContent);

  let blogEntries;
  let toReadEntries;
  let keptToRead = false;

  if (Array.isArray(data.blogEntries) && Array.isArray(data.toReadEntries)) {
    blogEntries = data.blogEntries;
    toReadEntries = data.toReadEntries;
  } else if (Array.isArray(data.entries)) {
    blogEntries = data.entries;
    toReadEntries = await getToReadEntries();
    keptToRead = true;
  } else {
    throw new Error(
      'Unrecognized backup file. Expected either { blogEntries, toReadEntries } or { entries }.'
    );
  }

  if (await isSynced()) {
    // Once synced, a restore is an upload: push the file's contents to the server
    // and take back whatever it merges to. Blowing away the local cache alone
    // would just be undone by the next pull.
    const { ops } = sync.buildMigrationOps(blogEntries, toReadEntries);
    for (let i = 0; i < ops.length; i += 200) {
      await sync.pushRaw(ops.slice(i, i + 200));
    }
    await sync.pull({ full: true });
    const c = await store.counts();
    return { restored: blogEntries.length, toRead: c.toread, keptToRead, viaServer: true };
  }

  await localSet({
    blogEntries,
    toReadEntries,
    lastBackupBucket: Math.floor(blogEntries.length / BACKUP_EVERY_N_SAVES),
  });

  return { restored: blogEntries.length, toRead: toReadEntries.length, keptToRead };
}

// ---------- Message router ----------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handlers = {
    // --- reads (unchanged contract: the UI still receives flat arrays) ---
    getBlogEntries: async () => {
      await cleanupReadLaterList();
      const blogEntries = await getBlogEntries();
      if (await isSynced()) sync.syncInBackground();
      return { blogEntries };
    },
    getToReadEntries: async () => {
      await cleanupReadLaterList();
      const toReadEntries = await getToReadEntries();
      if (await isSynced()) sync.syncInBackground();
      return { toReadEntries };
    },

    // --- legacy whole-array writes (unmigrated installs only) ---
    saveBlogEntries: async () => {
      if (await isSynced()) throw new Error('Use markRead once sync is enabled.');
      await setBlogEntries(request.blogEntries);
      return { success: true };
    },
    saveToReadEntries: async () => {
      if (await isSynced()) throw new Error('Use addToReadLater once sync is enabled.');
      await setToReadEntries(request.toReadEntries);
      return { success: true };
    },

    // --- per-entry writes (work on both paths) ---
    markRead: async () => {
      const res = await writeThrough(
        () => store.markRead(request),
        () => legacyMarkRead(request)
      );
      return { success: true, ...res };
    },
    addToReadLater: async () => {
      const res = await writeThrough(
        () => store.addToReadLater(request),
        () => legacyAddToReadLater(request)
      );
      return { success: true, ...res };
    },
    setRating: async () => {
      if (!(await isSynced())) throw new Error('Rating edits require sync to be set up.');
      await store.setRating(request);
      sync.schedulePush();
      return { success: true };
    },
    // Laptop-only backfill: phone captures arrive with no author, so it gets typed
    // in here afterwards.
    updateEntry: async () => {
      if (!(await isSynced())) return legacyUpdateEntry(request);
      await store.updateEntry(request);
      sync.schedulePush();
      return { success: true };
    },
    deleteEntry: async () => {
      const res = await writeThrough(
        () => store.deleteEntry(request.url),
        () => legacyDelete(request.url)
      );
      return { success: true, ...res };
    },
    deleteRead: async () => {
      if (!(await isSynced())) throw new Error('Deleting a single read requires sync.');
      await store.deleteRead(request.readId);
      sync.schedulePush();
      return { success: true };
    },
    getReadsForUrl: async () => {
      if (!(await isSynced())) {
        const blogs = await getBlogEntries();
        const hit = blogs.filter((b) => b.url === request.url);
        return { reads: hit.map((h) => ({ read_at: Date.parse(h.date), rating: h.rating })) };
      }
      const { entry, reads } = await store.readsForUrl(request.url);
      return { entry, reads };
    },

    // --- backup / restore (unchanged) ---
    createBackup: async () => {
      await createManualBackup();
      return { success: true, message: 'Backup created successfully' };
    },
    restoreBackup: async () => {
      const { restored, toRead, keptToRead } = await restoreFromBackup(request.fileContent);
      const note = keptToRead
        ? ` Your read-later list (${toRead}) was kept -- that file format does not include it.`
        : '';
      return {
        success: true,
        message: `Restored ${restored} article${restored === 1 ? '' : 's'}.${note}`,
      };
    },

    // --- sync control ---
    getSyncStatus: async () => {
      const [meta, cfg, outbox, c] = await Promise.all([
        store.getMeta(),
        store.getConfig(),
        store.getOutbox(),
        store.counts(),
      ]);
      return {
        success: true,
        configured: Boolean(cfg.baseUrl && cfg.token),
        baseUrl: cfg.baseUrl,
        migrated: meta.migrated,
        since: meta.since,
        lastPullAt: meta.lastPullAt,
        lastPushAt: meta.lastPushAt,
        lastError: meta.lastError,
        pendingOps: outbox.length,
        counts: c,
      };
    },
    setSyncConfig: async () => {
      const health = await sync.healthCheck(request.baseUrl, request.token);
      await store.setConfig({ baseUrl: request.baseUrl, token: request.token });
      return { success: true, health };
    },
    testConnection: async () => {
      const health = await sync.healthCheck(request.baseUrl, request.token);
      return { success: true, health };
    },
    syncNow: async () => {
      const res = await sync.syncNow({ full: request.full === true });
      return { success: true, ...res };
    },
    previewMigration: async () => {
      const legacy = await localGet([K.legacyBlogs, K.legacyToRead]);
      const blogs = legacy[K.legacyBlogs] || [];
      const toRead = legacy[K.legacyToRead] || [];
      const { ops, collisions, dropped } = sync.buildMigrationOps(blogs, toRead);
      return {
        success: true,
        before: { blogs: blogs.length, toRead: toRead.length },
        articles: ops.length,
        reads: ops.reduce((n, o) => n + o.reads.length, 0),
        collisions: collisions.pairs,
        readsMerged: collisions.readsMerged,
        dropped,
      };
    },
    runMigration: async () => {
      await createManualBackup('pre-sync');
      const res = await sync.migrate((p) => {
        chrome.runtime.sendMessage({ action: 'migrationProgress', progress: p }).catch(() => {});
      });
      return { success: res.ok !== false, ...res };
    },
    resetLocalCache: async () => {
      const res = await sync.resetLocalCache();
      return { success: true, ...res };
    },
  };

  const handler = handlers[request.action];
  if (!handler) return false;

  handler()
    .then(sendResponse)
    .catch((err) => {
      console.error(`Error in ${request.action}:`, err);
      sendResponse({ success: false, message: err.message, blogEntries: [], toReadEntries: [] });
    });
  return true;
});

// ---------- write-through helpers ----------

/** Route a per-entry write to the store when synced, to the legacy arrays if not. */
async function writeThrough(syncedFn, legacyFn) {
  if (await isSynced()) {
    const res = await syncedFn();
    sync.schedulePush();
    return res;
  }
  return legacyFn();
}

async function legacyMarkRead({ url, title, author, website, rating, forceNewRead }) {
  const entries = await getBlogEntries();
  const entry = {
    url,
    title: title || '',
    author: author || '',
    website: website || '',
    rating: parseInt(rating, 10) || 0,
    date: new Date().toISOString(),
  };
  const i = entries.findIndex((e) => e.url === url);
  const isReread = i !== -1;
  // Without a server there are no read events, so a re-read appends a second row
  // -- which is what the projected shape looks like anyway.
  if (isReread && forceNewRead) entries.push(entry);
  else if (isReread) entries[i] = entry;
  else entries.push(entry);
  await setBlogEntries(entries);

  const toRead = await getToReadEntries();
  const filtered = toRead.filter((e) => e.url !== url);
  if (filtered.length !== toRead.length) await setToReadEntries(filtered);

  return { isReread };
}

async function legacyAddToReadLater({ url, title, author, website }) {
  const blogs = await getBlogEntries();
  if (blogs.some((e) => e.url === url)) return { alreadyRead: true };

  const entries = await getToReadEntries();
  if (entries.some((e) => e.url === url)) return { alreadyQueued: true };

  entries.push({
    url,
    title: title || '',
    author: author || '',
    website: website || '',
    date: new Date().toISOString(),
  });
  await setToReadEntries(entries);
  return { added: true };
}

// Unmigrated installs have no read events, so the edit lands on the single row for
// that URL. Fields left undefined stay as they were.
async function legacyUpdateEntry({ url, title, author, website, rating }) {
  const entries = await getBlogEntries();
  const i = entries.findIndex((e) => e.url === url);
  if (i === -1) throw new Error('That article is no longer here.');

  const e = { ...entries[i] };
  if (title !== undefined) e.title = title;
  if (author !== undefined) e.author = author;
  if (website !== undefined) e.website = website;
  if (rating !== undefined) e.rating = parseInt(rating, 10) || 0;
  entries[i] = e;

  await setBlogEntries(entries);
  return { success: true };
}

async function legacyDelete(url) {
  const blogs = await getBlogEntries();
  await setBlogEntries(blogs.filter((e) => e.url !== url));
  const toRead = await getToReadEntries();
  await setToReadEntries(toRead.filter((e) => e.url !== url));
  return { ok: true };
}
