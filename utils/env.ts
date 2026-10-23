import { env } from 'cloudflare:workers'

// Optional deployment secrets/settings supplement the Wrangler-generated bindings.
export type Env = Cloudflare.Env & {
  GITHUB_DOCUMENTS_TOKEN?: string
  GITHUB_DOCUMENTS_OWNER?: string
  GITHUB_DOCUMENTS_REPO?: string
  GITHUB_DOCUMENTS_BRANCH?: string
  GITHUB_DOCUMENTS_CDN_URL?: string
  GITHUB_DOCUMENTS_ALLOWED_USER_ID?: string
}

export function getEnv(): Env { return env }
