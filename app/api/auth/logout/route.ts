import {
  errorResponse,
  signedOutResponse,
} from '../_shared'

export const runtime = 'edge'

export async function POST(): Promise<Response> {
  try {
    return signedOutResponse()
  } catch (error) {
    return errorResponse(error)
  }
}
