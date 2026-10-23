import handler from 'vinext/server/app-router-entry'

export default {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext): Promise<Response> {
    return handler.fetch(request, env, ctx)
  },
} satisfies ExportedHandler<Cloudflare.Env>
