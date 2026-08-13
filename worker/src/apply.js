// Merge rules. This is the ONLY place conflict logic lives -- clients never merge,
// they just write what the server hands back.
//
// The rules exist because two devices disagree in predictable ways:
//   - the phone knows a URL and nothing else (no author, often no title)
//   - the phone may capture something the laptop already has queued, or already read
//   - either device may be offline for a while and arrive "late"
// So arrival order must not change the outcome for the cases that matter.

export const READ_DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Non-empty incoming value wins; never blank out something already there. */
function preferNonEmpty(existing, incoming) {
  const inc = typeof incoming === 'string' ? incoming.trim() : incoming;
  if (inc !== undefined && inc !== null && inc !== '') return inc;
  return existing ?? null;
}

/** First non-null wins -- for "when did this first happen" timestamps. */
function firstWins(existing, incoming) {
  if (existing !== undefined && existing !== null) return existing;
  return incoming ?? null;
}

function blankToNull(v) {
  const t = typeof v === 'string' ? v.trim() : v;
  return t === '' || t === undefined ? null : t;
}

/**
 * Field setter for text metadata.
 *
 * Normally a non-empty incoming value wins and empty never clobbers -- the phone
 * rarely knows the author and must not blank out what you typed. But an explicit
 * edit (mode 'force') has to be able to CLEAR a field too, so there a
 * present-but-empty value wins.
 *
 * Absent (undefined) always means "leave it alone" in both modes. That is what
 * stops /api/rate and the mobile undo path -- which send only a url_key and a
 * status -- from wiping metadata they never carried.
 */
function setText(existing, incoming, mode) {
  if (mode !== 'force') return preferNonEmpty(existing, incoming);
  if (incoming === undefined) return existing ?? null;
  return blankToNull(incoming);
}

/**
 * Merge an incoming entry against what is already stored.
 *
 * @param {object|null} existing  current row, or null for an insert
 * @param {object} incoming       client-proposed fields
 * @param {{now: number, mode?: 'merge'|'force'|'seed', source?: string}} ctx
 * @returns {object|null} the row to write, or null if nothing changed
 */
export function applyEntry(existing, incoming, ctx) {
  const { now, mode = 'merge' } = ctx;
  const source = incoming.source || ctx.source || 'ext';

  if (!existing) {
    return {
      url_key: incoming.url_key,
      url: incoming.url,
      title: preferNonEmpty(null, incoming.title),
      author: preferNonEmpty(null, incoming.author),
      website: preferNonEmpty(null, incoming.website),
      status: incoming.status === 'read' ? 'read' : 'toread',
      saved_at: incoming.saved_at ?? (incoming.status === 'toread' ? now : null),
      note: preferNonEmpty(null, incoming.note),
      source,
      created_at: now,
      updated_at: now,
      deleted_at: incoming.deleted ? now : null,
    };
  }

  // 'seed' is the one-time migration: never disturb a row some device already owns.
  if (mode === 'seed' && existing.source !== 'migrate') return null;

  const next = { ...existing };

  // 'read' beats 'toread', always. This encodes what cleanupReadLaterList() has
  // always done -- once you have read something it leaves the queue -- and makes
  // "queued on laptop, read on phone" resolve the same way regardless of which
  // write lands first. Only an explicit user action (force) can re-queue.
  if (mode === 'force' && incoming.status) {
    next.status = incoming.status;
  } else if (incoming.status === 'read') {
    next.status = 'read';
  }

  // url is the article's identity in display form -- never clearable, even by an
  // explicit edit.
  next.url = preferNonEmpty(existing.url, incoming.url);
  next.title = setText(existing.title, incoming.title, mode);
  next.author = setText(existing.author, incoming.author, mode);
  next.website = setText(existing.website, incoming.website, mode);
  next.note = setText(existing.note, incoming.note, mode);

  // Survives the read transition, which the old moveToReadList() destroyed.
  next.saved_at = firstWins(existing.saved_at, incoming.saved_at);

  if (incoming.deleted === true) next.deleted_at = existing.deleted_at ?? now;
  else if (incoming.deleted === false) next.deleted_at = null;

  return changed(existing, next) ? { ...next, updated_at: now } : null;
}

/**
 * Decide what a capture/push means for the reads table.
 *
 * Insert-only, with one exception: a read within READ_DEDUPE_WINDOW_MS of an
 * existing one updates that read instead of inserting. That is what stops a
 * double-tap in the iOS share sheet from inventing a re-read, while still letting
 * a genuine re-read months later create its own event.
 *
 * @param {object[]} existingReads  non-deleted reads for this url_key
 * @param {object} incoming         { read_at, rating, id?, source? }
 * @param {{now: number, mode?: 'merge'|'force'|'seed'}} ctx
 * @returns {{op: 'insert'|'update'|'noop', row: object|null}}
 */
export function applyRead(existingReads, incoming, ctx) {
  const { now, mode = 'merge' } = ctx;
  const readAt = incoming.read_at ?? now;
  const rating = clampRating(incoming.rating);

  // An explicit re-read request always creates a new event, window or not.
  if (incoming.force_new === true) {
    return { op: 'insert', row: newRead(incoming, readAt, rating, now) };
  }

  // Addressing a specific read by id (the mobile page's star tap) is a direct edit.
  if (incoming.id) {
    const target = existingReads.find((r) => r.id === incoming.id);
    if (!target) return { op: 'insert', row: newRead(incoming, readAt, rating, now) };
    const next = { ...target };
    next.rating = mode === 'force' ? rating : Math.max(target.rating || 0, rating);
    if (incoming.read_at != null) next.read_at = incoming.read_at;
    if (incoming.deleted === true) next.deleted_at = target.deleted_at ?? now;
    else if (incoming.deleted === false) next.deleted_at = null;
    return changed(target, next)
      ? { op: 'update', row: { ...next, updated_at: now } }
      : { op: 'noop', row: null };
  }

  const near = existingReads
    .filter((r) => Math.abs(r.read_at - readAt) < READ_DEDUPE_WINDOW_MS)
    .sort((a, b) => Math.abs(a.read_at - readAt) - Math.abs(b.read_at - readAt))[0];

  if (!near) return { op: 'insert', row: newRead(incoming, readAt, rating, now) };

  const next = { ...near };
  // MAX, not overwrite: a share-sheet capture defaults to rating 0 and must not
  // downgrade the stars you just gave it. Explicit edits pass mode 'force'.
  next.rating = mode === 'force' ? rating : Math.max(near.rating || 0, rating);
  return changed(near, next)
    ? { op: 'update', row: { ...next, updated_at: now } }
    : { op: 'noop', row: null };
}

function newRead(incoming, readAt, rating, now) {
  return {
    id: incoming.id || crypto.randomUUID(),
    url_key: incoming.url_key,
    read_at: readAt,
    rating,
    source: incoming.source || 'ext',
    created_at: now,
    updated_at: now,
    deleted_at: incoming.deleted ? now : null,
  };
}

export function clampRating(r) {
  const n = Number.parseInt(r, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(5, Math.max(0, n));
}

// Skip no-op writes. Without this, an idempotent re-push churns seq on every row,
// which makes every other client pull the whole database back down for nothing.
const VOLATILE = new Set(['updated_at', 'seq']);
function changed(a, b) {
  for (const k of Object.keys(b)) {
    if (VOLATILE.has(k)) continue;
    if ((a[k] ?? null) !== (b[k] ?? null)) return true;
  }
  return false;
}
