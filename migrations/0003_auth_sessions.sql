-- Opaque sessions authorize account-scoped sync; legacy user-id cookies are ignored.
-- Existing installations keep their users; clean installations need no legacy seed SQL.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS auth_sessions_by_expiry ON auth_sessions(expires_at);
