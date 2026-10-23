import type { CollectionRow } from '@mintcd/sync-engine/records'
import type { Schema } from '../app/api/sync/route'

export type TableName = keyof Schema['collections'] & string
export type Row<Name extends TableName> = CollectionRow<Schema, Name>
