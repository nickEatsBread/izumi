PRAGMA foreign_keys = ON;

-- This profile is deliberately separate from end-to-end encrypted sync records. The owner opts
-- in because the Worker must read configured add-on URLs in order to resolve sources while Izumi
-- is closed. URLs may contain add-on credentials and are never returned to the TV.
CREATE TABLE resolver_profiles (
  owner_device_id TEXT PRIMARY KEY,
  profile_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (owner_device_id) REFERENCES devices(id) ON DELETE CASCADE
);

ALTER TABLE companion_pairings ADD COLUMN last_resolve_at INTEGER NOT NULL DEFAULT 0;
