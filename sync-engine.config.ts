import { defineSyncConfig } from '@mintcd/sync-engine-vinext/config'

export default defineSyncConfig({
  version: 1,
  appId: 'pdf_annotation',
  contractVersion: 'pdf-annotation/1',
  wrangler: { config: 'wrangler.jsonc', binding: 'DB' },
  replicaKeys: ['main'],
  collections: {
    documents: {
      fields: {
        id: { type: 'string' },
        source_key: { type: 'string' },
        source_type: { type: 'string', enum: ['remote', 'local'] },
        source_url: { type: 'string', nullable: true },
        file_name: { type: 'string' },
        title: { type: 'string' },
        created_at: { type: 'string' },
        updated_at: { type: 'string' },
        number_of_annotations: { type: 'number', nullable: true },
      },
      primaryKey: ['id'],
      indexes: { bySource: ['source_key'] },
    },
    annotations: {
      fields: {
        id: { type: 'string' },
        document_id: { type: 'string' },
        page_index: { type: 'number' },
        text: { type: 'string' },
        created_at: { type: 'string' },
        updated_at: { type: 'string' },
        color: { type: 'string' },
        comment: { type: 'string', nullable: true },
        position: { type: 'string' },
      },
      primaryKey: ['id'],
      indexes: { byDocument: ['document_id'], byDocumentPage: ['document_id', 'page_index'] },
    },
    highlight_colors: {
      fields: { color: { type: 'string' }, semantics: { type: 'string' } },
      primaryKey: ['color'],
    },
  },
})
