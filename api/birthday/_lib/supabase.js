// Server-only Supabase client. Uses the service role key, so it must never be
// imported from src/ (browser code). RLS is enabled on every table with no
// policies, which means anon/publishable keys cannot read or write data.
import { createClient } from '@supabase/supabase-js'
import { env, requireEnv } from './env.js'

let client = null

export function db() {
  if (!client) {
    requireEnv('HQ_SUPABASE_URL', 'HQ_SUPABASE_SERVICE_KEY')
    client = createClient(env('HQ_SUPABASE_URL'), env('HQ_SUPABASE_SERVICE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    })
  }
  return client
}

// Turns { data, error } from supabase-js into data, or throws.
export function must({ data, error }, message = 'Database request failed') {
  if (error) {
    const err = new Error(`${message}: ${error.message}`)
    err.code = error.code
    throw err
  }
  return data
}
