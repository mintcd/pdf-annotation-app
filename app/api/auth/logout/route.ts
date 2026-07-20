import {
  errorResponse,
  signedOutResponse,
} from '../_shared'

export const runtime = 'nodejs'

export async function POST(): Promise<Response> {
  try {
    return signedOutResponse()
  } catch (error) {
    return errorResponse(error)
  }
}
