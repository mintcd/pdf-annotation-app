import { syncSessionForUserId } from '../../../../utils/syncIdentity'
import {
  AuthRequestError,
  errorResponse,
  findUserByUsername,
  hashPassword,
  readCredentials,
  sessionResponse,
} from '../_shared'

export const runtime = 'edge'

export async function POST(request: Request): Promise<Response> {
  try {
    const credentials = await readCredentials(request)
    const user = await findUserByUsername(credentials.username)
    const passwordHash = await hashPassword(credentials.password)

    if (user === null || user.password_hash !== passwordHash) {
      throw new AuthRequestError('Invalid username or password', 401)
    }

    return sessionResponse(syncSessionForUserId(user.id))
  } catch (error) {
    return errorResponse(error)
  }
}
