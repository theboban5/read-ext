-- Blog Tracker sync store.
--
-- Two tables, because a re-read is a first-class event: reading the same article
-- on 2025-08-01 and again on 2026-06-10 must light up both heatmap cells.
--
--   entries -- one row per article (identity + metadata + queue status)
--   reads   -- one row per time you read it (read_at + the rating you gave it then)
--
-- Rating lives on the read event, not the article. That is what makes a phone
-- capture structurally unable to clobber a rating given on the laptop.

CREATE TABLE entries (
  url_key    TEXT PRIMARY KEY,           -- urlKey(url) -- the identity, see src/urlkey.js
  url        TEXT NOT NULL,              -- canonical display URL
  title      TEXT,
  author     TEXT,
  website    TEXT,                       -- hostname minus "www.", matches popup.js
  status     TEXT NOT NULL CHECK (status IN ('read', 'toread')),
  saved_at   INTEGER,                    -- epoch ms, when first queued to read-later
  note       TEXT,
  source     TEXT,                       -- 'ext' | 'ios' | 'web' | 'migrate'
  created_at INTEGER NOT NULL,           -- server-stamped
  updated_at INTEGER NOT NULL,           -- server-stamped
  deleted_at INTEGER,                    -- soft-delete tombstone
  seq        INTEGER NOT NULL            -- monotonic change cursor
);

CREATE TABLE reads (
  id         TEXT PRIMARY KEY,           -- uuid
  url_key    TEXT NOT NULL REFERENCES entries(url_key),
  read_at    INTEGER NOT NULL,           -- epoch ms -- drives the heatmap
  rating     INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
  source     TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  seq        INTEGER NOT NULL
);

-- seq is the sync cursor, not updated_at: a batch write stamps many rows with the
-- same millisecond, which makes "?since=<timestamp>" either skip rows (>) or
-- re-send the boundary forever (>=). seq is allocated from counters and strictly
-- increases, so "WHERE seq > ? ORDER BY seq" is exact. One counter, both tables.
CREATE UNIQUE INDEX idx_entries_seq   ON entries(seq);
CREATE UNIQUE INDEX idx_reads_seq     ON reads(seq);

CREATE INDEX idx_entries_status ON entries(status)  WHERE deleted_at IS NULL;
CREATE INDEX idx_reads_urlkey   ON reads(url_key)   WHERE deleted_at IS NULL;
CREATE INDEX idx_reads_at       ON reads(read_at)   WHERE deleted_at IS NULL;

CREATE TABLE counters (
  name  TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO counters (name, value) VALUES ('seq', 0);

CREATE TABLE meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
INSERT INTO meta (k, v) VALUES ('schema_version', '1'), ('urlkey_version', '1');
