// Best-effort title fetch.
//
// The iOS Shortcut sends only a URL: `Get Details of Safari Web Page -> Name` works
// only when the share started in Safari (not Twitter, Reddit, Mail), and there is no
// JSON-escape action in Shortcuts, so a title containing a quote would break the
// request body. Fetching server-side keeps the share sheet instant and treats every
// source app the same.
//
// This runs in ctx.waitUntil() after the response has already gone out. It will fail
// on paywalled and JS-rendered pages; the de-slugified path fallback keeps the entry
// from showing a bare URL, and titles are editable in the mobile page.

import { allocSeq, upsertEntryStmt, getEntries } from './db.js';

const TIMEOUT_MS = 4000;
const MAX_BYTES = 65536;

export async function backfillTitle(env, key, url) {
  try {
    const title = (await fetchTitle(url)) || deslugify(url);
    if (!title) return;

    const map = await getEntries(env.DB, [key]);
    const existing = map.get(key);
    // Someone may have set a real title while we were fetching.
    if (!existing || existing.title) return;

    const seq = await allocSeq(env.DB, 1);
    await upsertEntryStmt(env.DB, {
      ...existing,
      title,
      updated_at: Date.now(),
      seq,
    }).run();
  } catch (err) {
    console.error('title backfill failed for', key, err && err.message);
  }
}

async function fetchTitle(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    redirect: 'follow',
    headers: {
      // Some origins serve a stub to unknown agents; a normal UA gets the real head.
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml',
      Range: `bytes=0-${MAX_BYTES - 1}`,
    },
  });

  const type = res.headers.get('content-type') || '';
  if (!res.ok && res.status !== 206) return null;
  if (!type.includes('html')) return null;

  const html = (await res.text()).slice(0, MAX_BYTES);

  const og =
    match(html, /<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    match(html, /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:title["']/i) ||
    match(html, /<meta[^>]+name=["']twitter:title["'][^>]+content=["']([^"']+)["']/i);
  if (og) return clean(og);

  const t = match(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  return t ? clean(t) : null;
}

function match(s, re) {
  const m = s.match(re);
  return m ? m[1] : null;
}

function clean(s) {
  return decodeEntities(s).replace(/\s+/g, ' ').trim().slice(0, 300) || null;
}

function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/** "https://x.com/2024/06/the-big-post" -> "The Big Post" */
function deslugify(url) {
  try {
    const path = new URL(url).pathname.split('/').filter(Boolean).pop();
    if (!path) return null;
    const words = decodeURIComponent(path)
      .replace(/\.(html?|php|aspx?)$/i, '')
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    // A bare id or hash makes a worse title than nothing.
    if (!words || /^\d+$/.test(words) || !/[a-z]/i.test(words)) return null;
    return words.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 300);
  } catch {
    return null;
  }
}
