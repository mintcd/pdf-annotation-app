import handler from 'vinext/server/app-router-entry'
import type { Env } from '../utils/env'

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    globalThis.__origin = url.origin
    globalThis.__env = env

    return handler.fetch(request)
  },
}
