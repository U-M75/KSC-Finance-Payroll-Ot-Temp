// GET /api/cron/digest. Scheduled daily by vercel.json.
import { env, methodNotAllowed, fail, bearerToken } from '../env.js'
import { runDigests } from '../jobs.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res)
  if (!env('CRON_SECRET') || bearerToken(req) !== env('CRON_SECRET')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const summary = await runDigests()
    return res.status(200).json({ job: 'digest', ...summary })
  } catch (error) {
    return fail(res, error, 'Digest job failed')
  }
}
