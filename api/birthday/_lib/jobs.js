// Scheduled jobs run by Vercel Cron (see vercel.json).
import { env, timezone } from './env.js'
import { postToChannel, sendDm } from './slack.js'
import { todayIn, upcomingCelebrations, routeShoutout, digestChannelFor } from './celebrations.js'
import { shoutoutText, digestBlocks } from './slack-blocks.js'
import { loadEligibleEmployees, claimCelebration, releaseCelebrationClaim } from './employees.js'
import { db } from './supabase.js'

// On-the-day shoutouts: public non-Disney -> #ksc-chat-room, private -> DM, Disney public -> nothing.
export async function runMilestones(now = new Date()) {
  const tz = timezone()
  const today = todayIn(tz, now)
  const employees = await loadEligibleEmployees({ withDates: true })
  const items = upcomingCelebrations(employees, today, 0)
  const summary = { date: today, chat_room: 0, dm: 0, skipped: 0 }

  for (const item of items) {
    const route = routeShoutout(item.employee)
    if (route === 'none') {
      summary.skipped += 1
      continue
    }
    const isPrivate = route === 'dm'
    const claimed = await claimCelebration(item.employee.id, item.kind, item.occurrenceDate, route)
    if (!claimed) {
      summary.skipped += 1
      continue
    }
    try {
      const text = shoutoutText(item, { private: isPrivate })
      if (isPrivate) await sendDm(item.employee.slack_user_id, text)
      else await postToChannel(env('SLACK_CHANNEL_KSC_CHAT_ROOM'), text)
      summary[route] += 1
    } catch (error) {
      // Release the claim so the next run can retry this one.
      await releaseCelebrationClaim(item.employee.id, item.kind, item.occurrenceDate, route)
      console.error('Shoutout failed', item.employee.id, error)
    }
  }
  return summary
}

// Upcoming-celebration digests. Private employees are never listed.
export async function runDigests(now = new Date()) {
  const tz = timezone()
  const today = todayIn(tz, now)
  const windowDays = Number(env('DIGEST_WINDOW_DAYS', '7')) || 7
  const employees = await loadEligibleEmployees({ withDates: true })
  const items = upcomingCelebrations(employees, today, windowDays)
  const disney = items.filter((item) => digestChannelFor(item.employee) === 'disney')
  const general = items.filter((item) => digestChannelFor(item.employee) === 'onboarding')
  const summary = { date: today, disney: disney.length, onboarding: general.length }

  // Housekeeping: Slack retry-protection rows older than 7 days are no longer needed.
  await db()
    .from('ksc_slack_event_log')
    .delete()
    .lt('received_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())

  if (disney.length) {
    const title = `📅 Disney team: upcoming celebrations (next ${windowDays} days)`
    await postToChannel(env('SLACK_CHANNEL_DISNEY_INSIGHTS'), title, digestBlocks(title, disney, tz))
  }
  if (general.length) {
    const title = `📅 KSC team: upcoming celebrations (next ${windowDays} days)`
    await postToChannel(env('SLACK_CHANNEL_ONBOARDING_INSIGHTS'), title, digestBlocks(title, general, tz))
  }
  return summary
}
