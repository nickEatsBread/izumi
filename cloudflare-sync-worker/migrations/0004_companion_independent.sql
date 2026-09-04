PRAGMA foreign_keys = ON;

-- Materialized TV views remain end-to-end encrypted with the TV capability. The Worker can select
-- the requested catalogue but cannot inspect a user's home rows, library, or viewing progress.
CREATE TABLE companion_snapshots (
  pairing_id TEXT NOT NULL,
  screen TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (pairing_id, screen),
  FOREIGN KEY (pairing_id) REFERENCES companion_pairings(pairing_id) ON DELETE CASCADE
);

CREATE TABLE companion_progress (
  pairing_id TEXT NOT NULL,
  media_key TEXT NOT NULL,
  payload TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (pairing_id, media_key),
  FOREIGN KEY (pairing_id) REFERENCES companion_pairings(pairing_id) ON DELETE CASCADE
);

-- A short-lived opaque ticket lets the TV load a YouTube bridge in an iframe without putting its
-- long-lived TV capability in a URL or disclosing it in a Referer header.
CREATE TABLE companion_trailer_tickets (
  code_hash TEXT PRIMARY KEY,
  pairing_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  muted INTEGER NOT NULL,
  captions INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (pairing_id) REFERENCES companion_pairings(pairing_id) ON DELETE CASCADE
);

CREATE INDEX companion_snapshots_updated ON companion_snapshots(pairing_id, updated_at DESC);
CREATE INDEX companion_progress_updated ON companion_progress(pairing_id, updated_at DESC);
CREATE INDEX companion_trailer_tickets_expiry ON companion_trailer_tickets(expires_at);

ALTER TABLE companion_pairings ADD COLUMN last_catalog_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE companion_pairings ADD COLUMN last_details_at INTEGER NOT NULL DEFAULT 0;
