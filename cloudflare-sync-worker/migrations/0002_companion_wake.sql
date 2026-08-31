PRAGMA foreign_keys = ON;

CREATE TABLE companion_pairings (
  pairing_id TEXT PRIMARY KEY,
  owner_device_id TEXT NOT NULL,
  tv_token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  FOREIGN KEY (owner_device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE companion_requests (
  pairing_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  state TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (pairing_id, request_id),
  FOREIGN KEY (pairing_id) REFERENCES companion_pairings(pairing_id) ON DELETE CASCADE
);

CREATE TABLE companion_enrollments (
  code_hash TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE TABLE companion_push_subscriptions (
  endpoint_hash TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (device_id) REFERENCES devices(id) ON DELETE CASCADE
);

CREATE INDEX companion_pairings_owner ON companion_pairings(owner_device_id);
CREATE INDEX companion_requests_expiry ON companion_requests(expires_at);
CREATE INDEX companion_enrollments_expiry ON companion_enrollments(expires_at);
CREATE INDEX companion_push_device ON companion_push_subscriptions(device_id);
