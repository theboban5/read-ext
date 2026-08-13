// D1 helpers: seq allocation and row read/write.

export const ENTRY_COLS = [
  'url_key', 'url', 'title', 'author', 'website', 'status',
  'saved_at', 'note', 'source', 'created_at', 'updated_at', 'deleted_at', 'seq',
];

export const READ_COLS = [
  'id', 'url_key', 'read_at', 'rating', 'source',
  'created_at', 'updated_at', 'deleted_at', 'seq',
];

/**
 * Reserve a contiguous block of change-cursor values.
 * D1 is single-writer per database, so the read-modify-write here cannot interleave.
 * Returns the first seq of the block; the block is [base, base + n).
 */
export async function allocSeq(db, n) {
  if (n <= 0) return 0;
  const row = await db
    .prepare(`UPDATE counters SET value = value + ?1 WHERE name = 'seq' RETURNING value`)
    .bind(n)
    .first();
  return row.value - n;
}

export async function currentSeq(db) {
  const row = await db.prepare(`SELECT value FROM counters WHERE name = 'seq'`).first();
  return row ? row.value : 0;
}

export async function getEntries(db, urlKeys) {
  if (!urlKeys.length) return new Map();
  const out = new Map();
  // D1 caps bound parameters per statement; chunk well under it.
  for (let i = 0; i < urlKeys.length; i += 90) {
    const chunk = urlKeys.slice(i, i + 90);
    const placeholders = chunk.map((_, j) => `?${j + 1}`).join(',');
    const { results } = await db
      .prepare(`SELECT * FROM entries WHERE url_key IN (${placeholders})`)
      .bind(...chunk)
      .all();
    for (const r of results) out.set(r.url_key, r);
  }
  return out;
}

export async function getReadsFor(db, urlKeys) {
  const out = new Map();
  for (const k of urlKeys) out.set(k, []);
  if (!urlKeys.length) return out;
  for (let i = 0; i < urlKeys.length; i += 90) {
    const chunk = urlKeys.slice(i, i + 90);
    const placeholders = chunk.map((_, j) => `?${j + 1}`).join(',');
    const { results } = await db
      .prepare(
        `SELECT * FROM reads WHERE url_key IN (${placeholders}) AND deleted_at IS NULL
         ORDER BY read_at DESC`
      )
      .bind(...chunk)
      .all();
    for (const r of results) out.get(r.url_key).push(r);
  }
  return out;
}

export function upsertEntryStmt(db, row) {
  const cols = ENTRY_COLS.join(', ');
  const placeholders = ENTRY_COLS.map((_, i) => `?${i + 1}`).join(', ');
  const updates = ENTRY_COLS.filter((c) => c !== 'url_key' && c !== 'created_at')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');
  return db
    .prepare(
      `INSERT INTO entries (${cols}) VALUES (${placeholders})
       ON CONFLICT(url_key) DO UPDATE SET ${updates}`
    )
    .bind(...ENTRY_COLS.map((c) => row[c] ?? null));
}

export function upsertReadStmt(db, row) {
  const cols = READ_COLS.join(', ');
  const placeholders = READ_COLS.map((_, i) => `?${i + 1}`).join(', ');
  const updates = READ_COLS.filter((c) => c !== 'id' && c !== 'created_at')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ');
  return db
    .prepare(
      `INSERT INTO reads (${cols}) VALUES (${placeholders})
       ON CONFLICT(id) DO UPDATE SET ${updates}`
    )
    .bind(...READ_COLS.map((c) => row[c] ?? null));
}
