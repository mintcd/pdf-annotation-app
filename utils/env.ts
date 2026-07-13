interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement
  first<T = Record<string, unknown>>(): Promise<T | null>
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>
  run(): Promise<unknown>
}

interface D1DatabaseBinding {
  prepare(query: string): D1PreparedStatement
  batch(statements: D1PreparedStatement[]): Promise<unknown>
}

export interface Env {
  DB: D1DatabaseBinding
  ASSETS: { fetch(request: Request): Promise<Response> }
  [key: string]: unknown
}

export function getEnv(): Env {
  const env = (globalThis as unknown as { __env?: Env }).__env
  if (!env) throw new Error('Cloudflare env not available.')
  return env
}
