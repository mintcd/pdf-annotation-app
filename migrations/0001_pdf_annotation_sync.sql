CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  source_key TEXT NOT NULL UNIQUE,
  source_type TEXT NOT NULL,
  source_url TEXT,
  file_name TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  number_of_annotations INTEGER
);

CREATE TABLE IF NOT EXISTS annotations (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  page_index INTEGER NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  color TEXT NOT NULL,
  comment TEXT,
  position TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS annotations_by_document ON annotations (document_id);
CREATE INDEX IF NOT EXISTS annotations_by_document_page ON annotations (document_id, page_index);
CREATE INDEX IF NOT EXISTS annotations_by_updated_at ON annotations (updated_at);

CREATE TABLE IF NOT EXISTS operations (
  id TEXT PRIMARY KEY,
  entity TEXT NOT NULL,
  op_type TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  processed INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  client_id TEXT,
  client_op_id TEXT,
  sent_at TEXT,
  undone INTEGER NOT NULL DEFAULT 0,
  instance_id TEXT
);

CREATE INDEX IF NOT EXISTS operations_by_processed ON operations (processed);
CREATE INDEX IF NOT EXISTS operations_by_client ON operations (client_id, client_op_id);
CREATE INDEX IF NOT EXISTS operations_by_created_at ON operations (created_at);
CREATE UNIQUE INDEX IF NOT EXISTS operations_by_client_operation
  ON operations (client_id, client_op_id)
  WHERE client_id IS NOT NULL AND client_op_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT
);

INSERT INTO users (id, username, password_hash)
VALUES (
  'aaa027c73a2451552ef56351fdcbdd73dc9f6b417f8fdb75e4561807fe6cab40',
  'mintcd',
  '02d2c87960434582b5dccb0e50224d47b4ed4b418cce54de8b9e0c67be71b116'
)
ON CONFLICT(username) DO UPDATE SET
  id = excluded.id,
  password_hash = excluded.password_hash;

CREATE TABLE IF NOT EXISTS sync_engine_v2_streams (
  stream_id TEXT PRIMARY KEY,
  schema_hash TEXT NOT NULL,
  head_sequence INTEGER NOT NULL,
  materialized_state_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  updated_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS sync_engine_v2_log_entries (
  stream_id TEXT NOT NULL,
  sequence INTEGER NOT NULL,
  operation_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_sequence INTEGER NOT NULL,
  intent_hash TEXT NOT NULL,
  operation_json TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  PRIMARY KEY (stream_id, sequence),
  UNIQUE (stream_id, operation_id),
  UNIQUE (stream_id, client_id, client_sequence)
);

CREATE TABLE IF NOT EXISTS sync_engine_v2_decisions (
  stream_id TEXT NOT NULL,
  operation_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_sequence INTEGER NOT NULL,
  intent_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('accepted', 'rejected')),
  sequence INTEGER,
  operation_json TEXT,
  reason_json TEXT,
  created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
  PRIMARY KEY (stream_id, operation_id),
  UNIQUE (stream_id, client_id, client_sequence),
  CHECK (
    (
      status = 'accepted'
      AND sequence IS NOT NULL
      AND operation_json IS NOT NULL
      AND reason_json IS NULL
    )
    OR
    (
      status = 'rejected'
      AND sequence IS NULL
      AND operation_json IS NULL
      AND reason_json IS NOT NULL
    )
  )
);

INSERT OR IGNORE INTO sync_engine_v2_streams (
  stream_id,
  schema_hash,
  head_sequence,
  materialized_state_json
)
VALUES (
  'user:aaa027c73a2451552ef56351fdcbdd73dc9f6b417f8fdb75e4561807fe6cab40',
  'sha256:a6dde84d8af2a55e36b4d2d2a3cdc1365719567cde2e77906917ba10acb09670',
  0,
  '{"schemaHash":"sha256:a6dde84d8af2a55e36b4d2d2a3cdc1365719567cde2e77906917ba10acb09670","tables":{"annotations":{},"documents":{}}}'
);
