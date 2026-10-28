// KN: Kids Next - the box's own budget for requests to Spotify's Web API, so Spotify does not block it at all.
// spotify-block.ts only reacts: after Spotify's 429 nothing is asked until its Retry-After (seen 27.10.2026: 22 h, after
// eight big artists opened in the app - well over 100 requests in a few minutes). Here every request is counted first
// (the last 30 seconds, hour and day, kept on the SD card over a restart) and held back when a limit is reached.
//
// Two kinds: 'tap' - someone waits for it (a list opened on the display or in the app) - and 'background' (Smart-Sync,
// album lists completed later, cache refreshes, the album fill). Background requests may use only a share of each limit
// and keep a gap between them: whatever runs in the background, a tap still gets its answer.
// When Spotify blocks anyway, the counts at that moment are kept and the limits lowered below them (the parents see it
// in the app and can set them again there).

import { AsyncLocalStorage } from 'node:async_hooks'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { onSpotifyBlockNoted, spotifyBlock } from './spotify-block'

export type SpotifyRequestKind = 'tap' | 'background'

export interface SpotifyLimits {
  /** requests in any 30 seconds */
  window: number
  /** requests in any hour */
  hour: number
  /** requests in any 24 hours */
  day: number
  /** seconds between two background requests */
  gapSeconds: number
}

export const DEFAULT_SPOTIFY_LIMITS: SpotifyLimits = { window: 15, hour: 120, day: 600, gapSeconds: 3 }
export const SPOTIFY_LIMIT_RANGE: Record<keyof SpotifyLimits, [number, number]> = {
  window: [3, 60],
  hour: [20, 1000],
  day: [50, 5000],
  gapSeconds: [1, 60],
}
// the share of each limit the background may use
const BACKGROUND_SHARE = 0.5
const WINDOW_MS = 30 * 1000
const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
// (the server's tests ask a fake Spotify hundreds of times: the limits are off there - kn-spotify-budget.spec.ts turns
// them on)
const OFF = process.env.NODE_ENV === 'test' && process.env.KN_SPOTIFY_BUDGET !== 'on'

const DIR = path.join(process.cwd(), 'cache')
// (not among the files "clear cache" removes - see clearSpotifyCache in eltern/routes.ts)
const LIMITS_FILE = path.join(DIR, 'spotify-limits.json')
const COUNT_FILE = path.join(DIR, 'spotify-requests.json')

interface Entry {
  /** when (ms) */
  t: number
  /** 'b' for a background request */
  k?: 'b'
}

export interface SpotifyLockout {
  /** when Spotify blocked (ms) */
  at: number
  window: number
  hour: number
  day: number
  /** the limits lowered to (none when they were below already) */
  lowered?: SpotifyLimits
}

let limits: SpotifyLimits | undefined
let lastLockout: SpotifyLockout | undefined
let entries: Entry[] | undefined
let lastBackgroundAt = 0
let saveTimer: NodeJS.Timeout | undefined

export function normalizeLimits(raw: Partial<Record<keyof SpotifyLimits, unknown>> | undefined): SpotifyLimits {
  const out = { ...DEFAULT_SPOTIFY_LIMITS }
  for (const key of Object.keys(DEFAULT_SPOTIFY_LIMITS) as Array<keyof SpotifyLimits>) {
    const v = Math.round(Number(raw?.[key]))
    const [min, max] = SPOTIFY_LIMIT_RANGE[key]
    if (Number.isFinite(v)) out[key] = Math.min(max, Math.max(min, v))
  }
  return out
}

function writeJson(file: string, value: unknown): void {
  try {
    fs.mkdirSync(DIR, { recursive: true })
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(value))
    fs.renameSync(`${file}.tmp`, file)
  } catch {
    // only for this run of the server then
  }
}

function loadLimits(): SpotifyLimits {
  if (limits) return limits
  try {
    const kept = JSON.parse(fs.readFileSync(LIMITS_FILE, 'utf8'))
    limits = normalizeLimits(kept?.limits)
    lastLockout = kept?.lastLockout && typeof kept.lastLockout.at === 'number' ? kept.lastLockout : undefined
  } catch {
    limits = { ...DEFAULT_SPOTIFY_LIMITS }
  }
  return limits
}

function loadEntries(): Entry[] {
  if (entries) return entries
  try {
    const kept = JSON.parse(fs.readFileSync(COUNT_FILE, 'utf8'))
    entries = Array.isArray(kept) ? kept.filter((e) => typeof e?.t === 'number') : []
  } catch {
    entries = []
  }
  prune(Date.now())
  return entries
}

function prune(now: number): void {
  if (!entries) return
  const from = entries.findIndex((e) => e.t > now - DAY_MS)
  if (from < 0) entries.length = 0
  else if (from > 0) entries.splice(0, from)
}

// written at most every 10 seconds (a request is not worth a write to the SD card each)
function saveSoon(): void {
  if (saveTimer) return
  saveTimer = setTimeout(() => {
    saveTimer = undefined
    writeJson(COUNT_FILE, entries ?? [])
  }, 10_000)
  saveTimer.unref?.()
}

function counts(
  now: number,
  onlyBackground = false,
): { window: number; hour: number; day: number; oldest: { window?: number; hour?: number; day?: number } } {
  const list = loadEntries()
  prune(now)
  const c = { window: 0, hour: 0, day: 0, oldest: {} as { window?: number; hour?: number; day?: number } }
  for (const e of list) {
    if (onlyBackground && e.k !== 'b') continue
    c.day++
    c.oldest.day ??= e.t
    if (e.t > now - HOUR_MS) {
      c.hour++
      c.oldest.hour ??= e.t
    }
    if (e.t > now - WINDOW_MS) {
      c.window++
      c.oldest.window ??= e.t
    }
  }
  return c
}

/** Why a request has to wait, and until when (ms) - or null: it may be sent now. */
export function spotifyBudgetWait(
  kind: SpotifyRequestKind,
  now = Date.now(),
): { until: number; reason: string } | null {
  const block = spotifyBlock()
  if (block) return { until: block.until, reason: `Spotify blocks (${block.reason})` }
  const l = loadLimits()
  const share = kind === 'background' ? BACKGROUND_SHARE : 1
  // (the background counts its own requests against its share - and all of them against the whole limit)
  const lists = kind === 'background' ? [counts(now, true), counts(now)] : [counts(now)]
  let wait: { until: number; reason: string } | null = null
  const later = (until: number, reason: string) => {
    if (!wait || until > wait.until) wait = { until, reason }
  }
  lists.forEach((c, i) => {
    const f = i === 0 ? share : 1
    const window = Math.max(1, Math.floor(l.window * f))
    const hour = Math.max(1, Math.floor(l.hour * f))
    const day = Math.max(1, Math.floor(l.day * f))
    if (c.window >= window)
      later((c.oldest.window ?? now) + WINDOW_MS, `${c.window} requests in 30 s (limit ${window})`)
    if (c.hour >= hour) later((c.oldest.hour ?? now) + HOUR_MS, `${c.hour} requests in the last hour (limit ${hour})`)
    if (c.day >= day) later((c.oldest.day ?? now) + DAY_MS, `${c.day} requests in 24 h (limit ${day})`)
  })
  if (kind === 'background' && lastBackgroundAt + l.gapSeconds * 1000 > now)
    later(lastBackgroundAt + l.gapSeconds * 1000, 'gap between background requests')
  return wait
}

/** The box's own limit holds a request back (not Spotify's block: nothing is noted for the other requests). */
export class SpotifyBudgetError extends Error {
  readonly statusCode = 429
  readonly localLimit = true
  constructor(
    readonly until: number,
    readonly why: string,
  ) {
    super(`Spotify request held back by the box's own limit until ${new Date(until).toLocaleString()}: ${why}`)
  }
  get retryAfterSeconds(): number {
    return Math.max(1, Math.ceil((this.until - Date.now()) / 1000))
  }
}

const context = new AsyncLocalStorage<SpotifyRequestKind>()

/** Runs `work` with all its Spotify requests counted as background ones (Smart-Sync, the album fill, …). */
export function asBackground<T>(work: () => Promise<T>): Promise<T> {
  return context.run('background', work)
}

/** The kind of the requests made here: 'background' inside asBackground, else `fallback`. */
export function currentSpotifyKind(fallback: SpotifyRequestKind = 'tap'): SpotifyRequestKind {
  return context.getStore() ?? fallback
}

/**
 * Takes one request from the budget: waits when it is free again within `maxWaitMs` (the next 30 seconds, the gap of
 * the background), else throws SpotifyBudgetError. Counted as sent once it returns - call it right before the request.
 */
export async function takeSpotifyRequest(kind: SpotifyRequestKind, what: string, maxWaitMs?: number): Promise<void> {
  if (OFF) return
  // (a tap waits out the 30 seconds, the background its gap)
  const deadline = Date.now() + (maxWaitMs ?? (kind === 'tap' ? WINDOW_MS : loadLimits().gapSeconds * 1000 + 500))
  for (;;) {
    const now = Date.now()
    const wait = spotifyBudgetWait(kind, now)
    if (!wait) {
      loadEntries().push(kind === 'background' ? { t: now, k: 'b' } : { t: now })
      if (kind === 'background') lastBackgroundAt = now
      saveSoon()
      return
    }
    if (wait.until > deadline || spotifyBlock()) {
      if (!heldBackLogged || now - heldBackLogged > 60_000) {
        heldBackLogged = now
        console.warn(
          `${new Date().toLocaleString()}: [Spotify] ${kind} request ${what} held back until ${new Date(wait.until).toLocaleString()}: ${wait.reason}`,
        )
      }
      throw new SpotifyBudgetError(wait.until, wait.reason)
    }
    await new Promise((resolve) => setTimeout(resolve, Math.max(50, wait.until - now + 20)))
  }
}
let heldBackLogged = 0

export interface SpotifyBudgetView {
  limits: SpotifyLimits
  defaults: SpotifyLimits
  range: typeof SPOTIFY_LIMIT_RANGE
  used: { window: number; hour: number; day: number; backgroundHour: number }
  /** until when taps / the background wait (ms), with why */
  tapWait: { until: number; reason: string } | null
  backgroundWait: { until: number; reason: string } | null
  lastLockout?: SpotifyLockout
}

export function spotifyBudgetView(now = Date.now()): SpotifyBudgetView {
  const c = counts(now)
  return {
    limits: { ...loadLimits() },
    defaults: { ...DEFAULT_SPOTIFY_LIMITS },
    range: SPOTIFY_LIMIT_RANGE,
    used: { window: c.window, hour: c.hour, day: c.day, backgroundHour: counts(now, true).hour },
    tapWait: spotifyBudgetWait('tap', now),
    // (the gap alone is no waiting worth showing)
    backgroundWait: (() => {
      const w = spotifyBudgetWait('background', now)
      return w && w.until - now > loadLimits().gapSeconds * 1000 ? w : null
    })(),
    lastLockout,
  }
}

/** New limits from the app (each kept within SPOTIFY_LIMIT_RANGE). */
export function setSpotifyLimits(raw: Partial<Record<keyof SpotifyLimits, unknown>>): SpotifyLimits {
  limits = normalizeLimits({ ...loadLimits(), ...raw })
  writeJson(LIMITS_FILE, { limits, lastLockout })
  return limits
}

// Spotify blocked after all: what was sent until then is too much for this Spotify app - the limits go to 80 % of it
// (never below the lower end of their range)
onSpotifyBlockNoted(() => {
  const now = Date.now()
  const c = counts(now)
  const l = loadLimits()
  const below = (used: number, limit: number) => (used > 0 && limit >= used ? Math.floor(used * 0.8) : limit)
  const next = normalizeLimits({
    ...l,
    window: below(c.window, l.window),
    hour: below(c.hour, l.hour),
    day: below(c.day, l.day),
  })
  const lowered = next.window !== l.window || next.hour !== l.hour || next.day !== l.day
  lastLockout = { at: now, window: c.window, hour: c.hour, day: c.day, ...(lowered ? { lowered: next } : {}) }
  limits = next
  writeJson(LIMITS_FILE, { limits, lastLockout })
  if (lowered)
    console.warn(
      `${new Date().toLocaleString()}: [Spotify] blocked after ${c.window} requests in 30 s, ${c.hour} in the hour, ${c.day} in 24 h - the box's limits lowered to ${next.window}/${next.hour}/${next.day}`,
    )
})

/** For the tests: forget what is kept in memory (the files stay). */
export function resetSpotifyBudgetMemory(): void {
  limits = undefined
  lastLockout = undefined
  entries = undefined
  lastBackgroundAt = 0
}
