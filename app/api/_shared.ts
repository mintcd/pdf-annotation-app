export interface Env {
  DB: any;
  [key: string]: any;
}

declare global {
  // eslint-disable-next-line no-var
  var __env: Env | undefined;
  // eslint-disable-next-line no-var
  var __origin: string | undefined;
}


export function getEnv(): Env {
  const env = globalThis.__env;
  if (!env) throw new Error("Cloudflare env not available (missing globalThis.__env)");
  return env;
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function err(message: string, status = 400) {
  return json({ error: message }, status);
}

export function sqliteTypeToJsType(type: string): string {
  const normalized = String(type || '').trim().toUpperCase();
  if (!normalized) return 'any';
  if (normalized.includes('INT') || normalized.includes('REAL') || normalized.includes('FLOA') || normalized.includes('DOUB') || normalized.includes('NUM')) {
    return 'number';
  }
  if (normalized.includes('JSON')) return 'object';
  if (normalized.includes('BLOB')) return 'object';
  if (normalized.includes('BOOL')) return 'boolean';
  return 'string';
}

export function hasColumn(columns: readonly string[], column: string): boolean {
  return columns.includes(column);
}

export function validateColumns(columns: readonly string[], requested: string[]): { ok: boolean; error?: string } {
  for (const column of requested) {
    if (!hasColumn(columns, column)) return { ok: false, error: `Unknown field: ${column}` };
  }
  return { ok: true };
}

export function columnList(columns: string[]): string {
  return columns.map((column) => `"${column.replace(/"/g, '""')}"`).join(", ");
}

export function parseJsonField<T extends Record<string, unknown>>(row: T, field: string): T {
  const value = row[field];
  if (typeof value !== "string") return row;
  try {
    return { ...row, [field]: JSON.parse(value) };
  } catch {
    return row;
  }
}

export function parseJsonFields<T extends Record<string, unknown>>(
  row: T,
  schema: Record<string, string>,
): T {
  let parsed = row;
  for (const [field, sqliteType] of Object.entries(schema)) {
    if (/JSON/i.test(sqliteType)) parsed = parseJsonField(parsed, field);
  }
  return parsed;
}

export function validateData(data: Record<string, unknown>, schema: Record<string, string>): { ok: boolean; error?: string } {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    const expectedType = schema[key];
    if (!expectedType) return { ok: false, error: `Unknown field: ${key}` };
    const jsType = sqliteTypeToJsType(expectedType);
    if (jsType !== 'any' && typeof value !== jsType) {
      return { ok: false, error: `Invalid type for field ${key}: expected ${jsType}, got ${typeof value}` };
    }
  }
  return { ok: true };
}

export function validatePartial(data: Record<string, unknown>, schema: Record<string, string>): { ok: boolean; error?: string } {
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) continue;
    const expectedType = schema[key];
    if (!expectedType) return { ok: false, error: `Unknown field: ${key}` };
    const jsType = sqliteTypeToJsType(expectedType);
    if (jsType !== 'any' && typeof value !== jsType) {
      return { ok: false, error: `Invalid type for field ${key}: expected ${jsType}, got ${typeof value}` };
    }
  }
  return { ok: true };
}
