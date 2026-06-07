// Single source of truth: chrome.storage.local (~10MB, no chunking required).
// On install/startup we merge any legacy data from chrome.storage.sync
// (normal + chunked) into local so nothing is lost or shadowed.

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
  } catch (err) {
    console.error('Initialization failed:', err);
  }
}

// ---------- Storage primitives ----------

function localGet(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

function localSet(obj) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(obj, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

function syncGet(keys) {
  return new Promise((resolve) => chrome.storage.sync.get(keys, resolve));
}

async function getBlogEntries() {
  const { blogEntries } = await localGet('blogEntries');
  return blogEntries || [];
}

async function getToReadEntries() {
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

// ---------- One-time migration from sync (normal + chunked) into local ----------

async function migrateLegacyData() {
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
  const data = await localGet(['blogEntries', 'toReadEntries']);
  const patch = {};
  if (!data.blogEntries) patch.blogEntries = [];
  if (!data.toReadEntries) patch.toReadEntries = [];
  if (Object.keys(patch).length) await localSet(patch);
}

// ---------- Read-later cleanup (drop URLs already in blogs) ----------

async function cleanupReadLaterList() {
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

async function createManualBackup() {
  const blogs = await getBlogEntries();
  const toRead = await getToReadEntries();
  await downloadBackup(blogs, toRead, 'manual');
  await localSet({ lastBackupDate: new Date().toISOString() });
}

async function restoreFromBackup(fileContent) {
  const data = JSON.parse(fileContent);
  if (!Array.isArray(data.blogEntries) || !Array.isArray(data.toReadEntries)) {
    throw new Error('Invalid backup file format');
  }
  await localSet({
    blogEntries: data.blogEntries,
    toReadEntries: data.toReadEntries,
    lastBackupBucket: Math.floor(data.blogEntries.length / BACKUP_EVERY_N_SAVES),
  });
}

// ---------- Message router ----------

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  const handlers = {
    getBlogEntries: async () => {
      await cleanupReadLaterList();
      return { blogEntries: await getBlogEntries() };
    },
    getToReadEntries: async () => {
      await cleanupReadLaterList();
      return { toReadEntries: await getToReadEntries() };
    },
    saveBlogEntries: async () => {
      await setBlogEntries(request.blogEntries);
      return { success: true };
    },
    saveToReadEntries: async () => {
      await setToReadEntries(request.toReadEntries);
      return { success: true };
    },
    createBackup: async () => {
      await createManualBackup();
      return { success: true, message: 'Backup created successfully' };
    },
    restoreBackup: async () => {
      await restoreFromBackup(request.fileContent);
      return { success: true, message: 'Backup restored successfully' };
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
