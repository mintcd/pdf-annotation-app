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
  position JSON NOT NULL,
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
