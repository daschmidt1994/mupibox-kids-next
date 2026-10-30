// KN: Kids Next - Spotify Soloist in the web app (Einstellungen › Spotify › Soloist): Spotify's own player without a
// browser, with the parents' own API key.
//
// The work is done by kidsnext/soloist/mupi-kn-soloist (as root through sudo): the key goes to the tool on stdin -
// never as an argument (visible in the process list), never into a log or the box's settings. Downloading the program
// from Spotify takes a moment, so "set-key" may run for a minute.

import * as os from 'node:os'
import type { Router } from 'express'
import { parseJson, sudo, toolError } from './kn-backup'
import { requireCsrf, requireSession } from './middleware'

const TOOL = '/usr/local/sbin/mupi-kn-soloist'
const PLAYER = 'http://127.0.0.1:5005'

// the same rule as valid_key in mupi-kn-soloist
export const SOLOIST_KEY = /^[A-Za-z0-9._~+/=-]{16,512}$/

/** The key as the tool takes it (spaces from copying removed), or null when it is not one. */
export function soloistKey(body: unknown): string | null {
  const key = String((body as { apiKey?: unknown } | undefined)?.apiKey ?? '').replace(/\s+/g, '')
  return SOLOIST_KEY.test(key) ? key : null
}

// what the box's player knows: whether Spotify lists the Soloist device for the account (it does once it was chosen
// in a Spotify app - the pairing), and whether the box plays there
async function playerState(): Promise<Record<string, unknown>> {
  try {
    const r = await fetch(`${PLAYER}/soloist`, { signal: AbortSignal.timeout(4000) })
    return r.ok ? ((await r.json()) as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

export function registerKnSoloistRoutes(router: Router): void {
  /** GET /api/app/kn/soloist - installed?, version, valid until, key set?, service; paired and in use (the player) */
  router.get('/kn/soloist', requireSession, async (_req, res) => {
    const [r, player] = await Promise.all([sudo([TOOL, 'status', '--json'], [], 20000), playerState()])
    const status = parseJson(r.stdout)
    if (!status) {
      res.status(503).json({ error: r.code === 1 && /sudo/.test(r.stderr) ? 'no rights' : 'Soloist tool missing' })
      return
    }
    res.json({ ...status, hostname: os.hostname(), paired: player.deviceId ? true : player.known === false ? false : null, inUse: player.inUse === true })
  })

  /** POST /api/app/kn/soloist/key {apiKey} - save the key, download Soloist if needed, start it */
  router.post('/kn/soloist/key', requireSession, requireCsrf, async (req, res) => {
    const key = soloistKey(req.body)
    if (!key) {
      res.status(400).json({ error: 'Der API-Key ist ungültig.', field: 'apiKey' })
      return
    }
    const r = await sudo([TOOL, 'set-key', '--json'], [key], 300000)
    const j = parseJson(r.stdout)
    if (!r.ok || !j?.ok) {
      res.status(r.code === 2 ? 400 : 502).json({ error: toolError(r) })
      return
    }
    // (the player looks for the new device at its next start of something)
    void fetch(`${PLAYER}/soloist/forget`, { signal: AbortSignal.timeout(3000) }).catch(() => undefined)
    res.json(j)
  })

  /** POST /api/app/kn/soloist/remove - delete the key, stop Soloist (the box plays Spotify in the browser again) */
  router.post('/kn/soloist/remove', requireSession, requireCsrf, async (_req, res) => {
    const r = await sudo([TOOL, 'remove-key', '--json'], [], 30000)
    if (!r.ok) {
      res.status(502).json({ error: toolError(r) })
      return
    }
    void fetch(`${PLAYER}/soloist/forget`, { signal: AbortSignal.timeout(3000) }).catch(() => undefined)
    res.json({ ok: true })
  })

  /** POST /api/app/kn/soloist/update - the newest version from Spotify now (else weekly, and when one expired) */
  router.post('/kn/soloist/update', requireSession, requireCsrf, async (_req, res) => {
    const r = await sudo([TOOL, 'update', '--force', '--json'], [], 300000)
    const j = parseJson(r.stdout)
    if (!r.ok || !j?.ok) {
      res.status(502).json({ error: toolError(r) })
      return
    }
    res.json(j)
  })
}
