// Blog Tracker sync worker.
//
// Single user, one shared bearer token. The D1 database is the source of truth;
// the Chrome extension keeps a local cache of it so stats render offline, and the
// iOS Shortcut / mobile page write straight through.

import { urlKey, hostOf, URLKEY_VERSION } from './urlkey.js';
import { applyEntry, applyRead, clampRating } from './apply.js';
import {
  allocSeq, currentSeq, getEntries, getReadsFor, upsertEntryStmt, upsertReadStmt,
} from './db.js';
import { backfillTitle } from './title.js';
import { parseChoice } from './choice.js';
import MOBILE_HTML from './mobile.html';

const MAX_PUSH = 500;
const MAX_PULL = 1000;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));

    try {
      if (path === '/') return page(MOBILE_HTML);
      if (path === '/manifest.webmanifest') return webmanifest();

      if (!path.startsWith('/api/')) return json({ ok: false, error: 'not_found' }, 404);

      const auth = await authorize(request, env, path);
      if (!auth.ok) return auth.response;

      switch (`${request.method} ${path}`) {
        case 'GET /api/health':   return await health(env);
        case 'POST /api/capture': return await capture(request, env, ctx);
        case 'GET /api/pull':     return await pull(url, env);
        case 'POST /api/push':    return await push(request, env);
        case 'POST /api/rate':    return await rate(request, env);
        case 'POST /api/delete':  return await remove(request, env);
        case 'GET /api/list':     return await list(url, env);
        default:                  return json({ ok: false, error: 'not_found' }, 404);
      }
    } catch (err) {
      console.error(err && err.stack ? err.stack : err);
      return json({ ok: false, error: 'internal', detail: String(err && err.message) }, 500);
    }
  },
};

// ---------- auth ----------

// The Shortcut holds a token in plaintext on the phone. If CAPTURE_TOKEN is set it
// is accepted for /api/capture only, so the phone need not carry a full-read
// credential. SYNC_TOKEN always works everywhere.
async function authorize(request, env, path) {
  const header = request.headers.get('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  const accepted = [env.SYNC_TOKEN];
  if (env.CAPTURE_TOKEN && path === '/api/capture') accepted.push(env.CAPTURE_TOKEN);

  if (!env.SYNC_TOKEN) {
    return { ok: false, response: json({ ok: false, error: 'server_misconfigured' }, 500) };
  }
  if (token && accepted.some((t) => t && timingSafeEqual(token, t))) return { ok: true };

  // Slow down brute force a little; the 32-byte token is the real defense.
  await new Promise((r) => setTimeout(r, 250));
  return { ok: false, response: json({ ok: false, error: 'unauthorized' }, 401) };
}

function timingSafeEqual(a, b) {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

// ---------- endpoints ----------

async function health(env) {
  const [entries, reads, seq] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS n FROM entries WHERE deleted_at IS NULL`).first(),
    env.DB.prepare(`SELECT COUNT(*) AS n FROM reads WHERE deleted_at IS NULL`).first(),
    currentSeq(env.DB),
  ]);
  const toread = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM entries WHERE deleted_at IS NULL AND status = 'toread'`)
    .first();
  return json({
    ok: true,
    schema_version: 1,
    urlkey_version: URLKEY_VERSION,
    counts: { entries: entries.n, reads: reads.n, toread: toread.n },
    seq,
    server_time: Date.now(),
  });
}

// The iOS Shortcut endpoint. Everything it needs to do is one round trip, and the
// response carries a pre-formatted `message` so the Shortcut does zero string work.
async function capture(request, env, ctx) {
  const body = await readJson(request);

  // Send `"format": "text"` and the reply is the bare message instead of JSON.
  // The Shortcuts app has no easy way to pluck one key out of a JSON response --
  // doing it there needs an extra action dragged into the middle of the list -- so
  // the server just answers in the shape the notification wants.
  const asText = body.format === 'text' || (request.headers.get('Accept') || '').includes('text/plain');
  const reply = (payload, status) =>
    asText
      ? cors(new Response(payload.message || (payload.ok ? 'Saved' : 'Failed'), {
          status,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        }))
      : json(payload, status);

  const key = urlKey(body.url);
  if (!key) {
    // This message lands in a notification on the phone, so say what to do about it.
    const got = String(body.url == null ? '' : body.url).trim();
    return reply({
      ok: false,
      error: 'bad_url',
      message: got
        ? `Not a link: "${got.slice(0, 60)}" -- needs to start with http:// or https://`
        : 'No link was shared -- try again from the share sheet.',
    }, 400);
  }

  // `choice` lets a client send one human-readable string instead of separate
  // status/rating fields. The iOS Shortcut uses it: a flat "Choose from List"
  // returns the picked line directly, which avoids building five nested menu
  // branches by hand on a phone.
  const picked = body.choice != null ? parseChoice(body.choice) : null;

  const rating = picked ? picked.rating : clampRating(body.rating);
  const wantsQueue = picked ? picked.status === 'toread' : body.status === 'toread';
  // A rating implies you read it.
  const status = wantsQueue && rating === 0 ? 'toread' : 'read';
  const now = Date.now();

  const incoming = {
    url_key: key,
    url: String(body.url).trim(),
    title: body.title,
    author: body.author,
    website: body.website || hostOf(body.url),
    status,
    saved_at: body.saved_at,
    note: body.note,
    source: body.source || 'ios',
  };

  const existingMap = await getEntries(env.DB, [key]);
  const existing = existingMap.get(key) || null;
  const readsMap = await getReadsFor(env.DB, [key]);

  const stmts = [];
  const entryRow = applyEntry(existing, incoming, { now, mode: 'merge' });
  let action = existing ? 'updated' : 'created';

  let readResult = { op: 'noop', row: null };
  if (status === 'read') {
    readResult = applyRead(readsMap.get(key) || [], {
      url_key: key,
      read_at: body.read_at ?? now,
      rating,
      source: incoming.source,
      force_new: body.force_new === true,
    }, { now, mode: 'merge' });
  }

  const needed = (entryRow ? 1 : 0) + (readResult.row ? 1 : 0);
  const base = await allocSeq(env.DB, needed);
  let n = 0;

  if (entryRow) stmts.push(upsertEntryStmt(env.DB, { ...entryRow, seq: base + n++ }));
  if (readResult.row) stmts.push(upsertReadStmt(env.DB, { ...readResult.row, seq: base + n++ }));
  if (stmts.length) await env.DB.batch(stmts);

  const finalEntry = entryRow || existing;

  // Respond now; go fetch the title afterwards. The share sheet stays instant, and
  // links shared from Twitter/Mail (which carry no title at all) still get one.
  if (!finalEntry.title) {
    ctx.waitUntil(backfillTitle(env, key, finalEntry.url));
  }

  const stars = rating > 0 ? ' · ' + '★'.repeat(rating) : '';
  const where = status === 'read' ? 'Saved' : 'Queued';
  const reread = readResult.op === 'insert' && (readsMap.get(key) || []).length > 0;

  return reply({
    ok: true,
    action,
    reread,
    entry: { ...finalEntry, seq: entryRow ? base : finalEntry.seq },
    read: readResult.row,
    message: `${reread ? 'Re-read' : where}${stars} · ${finalEntry.website || hostOf(finalEntry.url)}`,
  }, 200);
}

async function pull(url, env) {
  const since = int(url.searchParams.get('since'), 0);
  const limit = Math.min(int(url.searchParams.get('limit'), 500), MAX_PULL);

  const [entries, reads] = await Promise.all([
    env.DB.prepare(`SELECT * FROM entries WHERE seq > ?1 ORDER BY seq LIMIT ?2`)
      .bind(since, limit).all(),
    env.DB.prepare(`SELECT * FROM reads WHERE seq > ?1 ORDER BY seq LIMIT ?2`)
      .bind(since, limit).all(),
  ]);

  // Both tables share one counter, so a page is "everything up to the lowest
  // watermark either query could still be hiding beyond its LIMIT".
  const eFull = entries.results.length === limit;
  const rFull = reads.results.length === limit;
  let cutoff = Infinity;
  if (eFull) cutoff = Math.min(cutoff, entries.results[entries.results.length - 1].seq);
  if (rFull) cutoff = Math.min(cutoff, reads.results[reads.results.length - 1].seq);

  const e = entries.results.filter((r) => r.seq <= cutoff);
  const r = reads.results.filter((x) => x.seq <= cutoff);
  const hasMore = eFull || rFull;

  const maxSeq = Math.max(since, ...e.map((x) => x.seq), ...r.map((x) => x.seq));

  return json({
    ok: true,
    entries: e,
    reads: r,
    next_since: maxSeq,
    has_more: hasMore,
    urlkey_version: URLKEY_VERSION,
    server_time: Date.now(),
  });
}

// Batch upsert from the extension. Echoes the merged rows so the client reconciles
// its optimistic state in the same round trip -- no follow-up pull needed.
async function push(request, env) {
  const body = await readJson(request);
  const items = Array.isArray(body.entries) ? body.entries : [];
  if (items.length > MAX_PUSH) {
    return json({ ok: false, error: 'too_many', max: MAX_PUSH }, 413);
  }

  const mode = body.mode === 'seed' ? 'seed' : 'merge';
  const now = Date.now();

  const normalized = [];
  const skipped = [];
  for (const it of items) {
    const key = urlKey(it.url || it.url_key);
    if (!key) { skipped.push(it.url || it.url_key || null); continue; }
    normalized.push({ ...it, url_key: key, url: (it.url || key).trim() });
  }

  const keys = [...new Set(normalized.map((n) => n.url_key))];
  const [existingMap, readsMap] = await Promise.all([
    getEntries(env.DB, keys),
    getReadsFor(env.DB, keys),
  ]);

  const entryWrites = [];
  const readWrites = [];

  for (const it of normalized) {
    const perItemMode = it.force === true ? 'force' : mode;
    const existing = pending(entryWrites, it.url_key) || existingMap.get(it.url_key) || null;

    const row = applyEntry(existing, {
      ...it,
      website: it.website || hostOf(it.url),
    }, { now, mode: perItemMode });
    if (row) entryWrites.push(row);

    const readsForKey = [
      ...(readsMap.get(it.url_key) || []),
      ...readWrites.filter((w) => w.url_key === it.url_key),
    ];

    // A push carries read events explicitly; an entry with no reads[] is metadata only.
    for (const rd of it.reads || []) {
      const res = applyRead(readsForKey, {
        ...rd,
        url_key: it.url_key,
        source: rd.source || it.source,
      }, { now, mode: rd.force === true ? 'force' : perItemMode });
      if (res.row) {
        const i = readWrites.findIndex((w) => w.id === res.row.id);
        if (i >= 0) readWrites[i] = res.row; else readWrites.push(res.row);
        readsForKey.push(res.row);
      }
    }
  }

  const base = await allocSeq(env.DB, entryWrites.length + readWrites.length);
  let n = 0;
  const stmts = [
    ...entryWrites.map((r) => upsertEntryStmt(env.DB, { ...r, seq: base + n++ })),
    ...readWrites.map((r) => upsertReadStmt(env.DB, { ...r, seq: base + n++ })),
  ];
  if (stmts.length) await env.DB.batch(stmts);

  // Hand back the authoritative post-merge state for everything they sent.
  const [finalEntries, finalReads] = await Promise.all([
    getEntries(env.DB, keys),
    getReadsFor(env.DB, keys),
  ]);

  return json({
    ok: true,
    applied: entryWrites.length + readWrites.length,
    skipped: skipped.length,
    skipped_urls: skipped,
    entries: [...finalEntries.values()],
    reads: [...finalReads.values()].flat(),
    next_since: await currentSeq(env.DB),
    server_time: Date.now(),
  });
}

// Batch rating from the mobile page. Always an explicit user action, so: force.
async function rate(request, env) {
  const body = await readJson(request);
  const items = Array.isArray(body.items) ? body.items : [];
  const now = Date.now();

  const keys = [...new Set(items.map((i) => urlKey(i.url_key || i.url)).filter(Boolean))];
  const [existingMap, readsMap] = await Promise.all([
    getEntries(env.DB, keys),
    getReadsFor(env.DB, keys),
  ]);

  const entryWrites = [];
  const readWrites = [];

  for (const it of items) {
    const key = urlKey(it.url_key || it.url);
    if (!key) continue;
    const existing = pending(entryWrites, key) || existingMap.get(key) || null;
    if (!existing) continue;

    const row = applyEntry(existing, { url_key: key, status: 'read' }, { now, mode: 'force' });
    if (row) entryWrites.push(row);

    const res = applyRead(readsMap.get(key) || [], {
      url_key: key,
      id: it.read_id,
      read_at: it.read_at ?? now,
      rating: clampRating(it.rating),
      source: 'web',
    }, { now, mode: 'force' });
    if (res.row) readWrites.push(res.row);
  }

  const base = await allocSeq(env.DB, entryWrites.length + readWrites.length);
  let n = 0;
  const stmts = [
    ...entryWrites.map((r) => upsertEntryStmt(env.DB, { ...r, seq: base + n++ })),
    ...readWrites.map((r) => upsertReadStmt(env.DB, { ...r, seq: base + n++ })),
  ];
  if (stmts.length) await env.DB.batch(stmts);

  return json({
    ok: true,
    applied: stmts.length,
    entries: entryWrites.map((r, i) => ({ ...r, seq: base + i })),
    reads: readWrites,
    next_since: await currentSeq(env.DB),
  });
}

async function remove(request, env) {
  const body = await readJson(request);
  const urlKeys = (body.url_keys || []).map((k) => urlKey(k)).filter(Boolean);
  const readIds = body.read_ids || [];
  const now = Date.now();

  const n = urlKeys.length + readIds.length;
  if (!n) return json({ ok: true, applied: 0, entries: [], reads: [] });

  const base = await allocSeq(env.DB, n);
  let i = 0;
  const stmts = [
    ...urlKeys.map((k) =>
      env.DB.prepare(
        `UPDATE entries SET deleted_at = ?1, updated_at = ?1, seq = ?2 WHERE url_key = ?3`
      ).bind(now, base + i++, k)
    ),
    ...readIds.map((id) =>
      env.DB.prepare(
        `UPDATE reads SET deleted_at = ?1, updated_at = ?1, seq = ?2 WHERE id = ?3`
      ).bind(now, base + i++, id)
    ),
  ];
  // Deleting an article deletes its reads too, otherwise the heatmap keeps counting it.
  for (const k of urlKeys) {
    const extra = await allocSeq(env.DB, 1);
    stmts.push(
      env.DB.prepare(
        `UPDATE reads SET deleted_at = ?1, updated_at = ?1, seq = ?2
         WHERE url_key = ?3 AND deleted_at IS NULL`
      ).bind(now, extra, k)
    );
  }
  await env.DB.batch(stmts);

  const entries = await getEntries(env.DB, urlKeys);
  return json({
    ok: true,
    applied: n,
    entries: [...entries.values()],
    next_since: await currentSeq(env.DB),
  });
}

// Convenience read for the mobile page so it never pulls full history over cellular.
async function list(url, env) {
  const status = url.searchParams.get('status');
  const limit = Math.min(int(url.searchParams.get('limit'), 200), 500);
  const order = url.searchParams.get('order') || 'saved_desc';

  const where = ['e.deleted_at IS NULL'];
  const binds = [];
  if (status === 'read' || status === 'toread') {
    binds.push(status);
    where.push(`e.status = ?${binds.length}`);
  }

  const orderBy = {
    saved_desc: 'COALESCE(e.saved_at, e.created_at) DESC',
    saved_asc: 'COALESCE(e.saved_at, e.created_at) ASC',
    read_desc: 'last_read_at DESC',
    title_asc: 'e.title ASC',
  }[order] || 'COALESCE(e.saved_at, e.created_at) DESC';

  binds.push(limit);
  const { results } = await env.DB
    .prepare(
      `SELECT e.*,
              (SELECT MAX(read_at) FROM reads r WHERE r.url_key = e.url_key AND r.deleted_at IS NULL) AS last_read_at,
              (SELECT COUNT(*)     FROM reads r WHERE r.url_key = e.url_key AND r.deleted_at IS NULL) AS read_count,
              (SELECT r.rating     FROM reads r WHERE r.url_key = e.url_key AND r.deleted_at IS NULL
                 ORDER BY r.read_at DESC LIMIT 1) AS rating,
              (SELECT r.id         FROM reads r WHERE r.url_key = e.url_key AND r.deleted_at IS NULL
                 ORDER BY r.read_at DESC LIMIT 1) AS read_id
         FROM entries e
        WHERE ${where.join(' AND ')}
        ORDER BY ${orderBy}
        LIMIT ?${binds.length}`
    )
    .bind(...binds)
    .all();

  return json({ ok: true, items: results, server_time: Date.now() });
}

// ---------- plumbing ----------

/** Later ops in the same batch must see earlier ones, not just what is on disk. */
function pending(writes, key) {
  for (let i = writes.length - 1; i >= 0; i--) if (writes[i].url_key === key) return writes[i];
  return null;
}

async function readJson(request) {
  try {
    const b = await request.json();
    return b && typeof b === 'object' ? b : {};
  } catch {
    return {};
  }
}

function int(v, fallback) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function json(body, status = 200) {
  return cors(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    })
  );
}

function page(html) {
  return cors(
    new Response(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Content-Security-Policy':
          "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:",
      },
    })
  );
}

function webmanifest() {
  return cors(
    new Response(
      JSON.stringify({
        name: 'Reading',
        short_name: 'Reading',
        start_url: '/',
        display: 'standalone',
        background_color: '#ffffff',
        theme_color: '#ffffff',
      }),
      { headers: { 'Content-Type': 'application/manifest+json' } }
    )
  );
}

// No cookies are used, so `*` carries no CSRF risk here.
function cors(res) {
  res.headers.set('Access-Control-Allow-Origin', '*');
  res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.headers.set('Access-Control-Max-Age', '86400');
  return res;
}
