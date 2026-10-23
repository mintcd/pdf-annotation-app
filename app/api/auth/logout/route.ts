import { errorResponse, signedOutResponse } from '../_shared'

export const runtime = 'edge'

export async function POST(request: Request): Promise<Response> {
  try { return await signedOutResponse(request) }
  catch (error) { return errorResponse(error) }
}
