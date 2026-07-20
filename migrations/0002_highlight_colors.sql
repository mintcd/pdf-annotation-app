CREATE TABLE IF NOT EXISTS highlight_colors (
  color TEXT PRIMARY KEY
    CHECK (
      length(color) = 7
      AND substr(color, 1, 1) = '#'
    ),
  semantics TEXT NOT NULL CHECK (length(trim(semantics)) > 0)
);

INSERT OR IGNORE INTO highlight_colors (color, semantics) VALUES
  ('#87ceeb', 'Reference'),
  ('#90ee90', 'Confirmed'),
  ('#ff6b6b', 'Concern'),
  ('#d3d3d3', 'Follow-up');

UPDATE sync_engine_v2_streams
SET
  schema_hash = 'sha256:1799d7c17a4cb7fc14fd612aabdfadaef7e4b4685aa09496e4feb7c9bbaf0890',
  materialized_state_json = json_set(
    materialized_state_json,
    '$.schemaHash',
    'sha256:1799d7c17a4cb7fc14fd612aabdfadaef7e4b4685aa09496e4feb7c9bbaf0890',
    '$.tables.highlight_colors',
    COALESCE(json_extract(materialized_state_json, '$.tables.highlight_colors'), json('{}'))
  ),
  updated_at = strftime('%s', 'now')
WHERE
  schema_hash <> 'sha256:1799d7c17a4cb7fc14fd612aabdfadaef7e4b4685aa09496e4feb7c9bbaf0890'
  OR json_extract(materialized_state_json, '$.tables.highlight_colors') IS NULL;
