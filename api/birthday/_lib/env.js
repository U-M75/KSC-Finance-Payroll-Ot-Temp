// Shared helpers for every serverless function.

export function clean(value) {
  return String(value ?? '').trim()
}

export function env(name, fallback = '') {
  return clean(process.env[name]) || fallback
}

export function requireEnv(...names) {
  const missing = names.filter((name) => !env(name))
  if (missing.length) {
    throw new HttpError(500, `Missing environment variables: ${missing.join(', ')}`)
  }
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

export function bearerToken(req) {
  const header = String(req.headers?.authorization || '')
  return header.startsWith('Bearer ') ? header.slice(7).trim() : ''
}

export function methodNotAllowed(res) {
  return res.status(405).json({ error: 'Method not allowed' })
}

// Uniform error responses. 5xx details are logged, not leaked to the browser.
export function fail(res, error, label = 'KSC App Hub error') {
  const status = error instanceof HttpError ? error.status : 500
  if (status >= 500) console.error(label, error)
  const message = status >= 500 ? error?.message || 'Something went wrong.' : error.message
  return res.status(status).json({ error: message })
}

export function timezone() {
  return env('APP_TIMEZONE', 'Asia/Karachi')
}
