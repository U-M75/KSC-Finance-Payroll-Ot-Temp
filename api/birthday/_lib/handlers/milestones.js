// GET /api/cron/milestones. Scheduled daily by vercel.json.
import { env, methodNotAllowed, fail, bearerToken } from '../env.js'
import { runMilestones } from '../jobs.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res)
  if (!env('CRON_SECRET') || bearerToken(req) !== env('CRON_SECRET')) {
    return res.status(401).json({ error: 'Unauthorized' })
  }
  try {
    const summary = await runMilestones()
    return res.status(200).json({ job: 'milestones', ...summary })
  } catch (error) {
    return fail(res, error, 'Milestone job failed')
  }
}
