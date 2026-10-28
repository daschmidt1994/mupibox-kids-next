// KN: Kids Next - the box's own limits for Spotify requests in the web app (Bibliothek › Spotify › Sync-Einstellungen):
// what was asked in the last 30 seconds, hour and day, whether something waits and why, the last block by Spotify -
// and the limits themselves (spotify-budget.ts).

import type { Router } from 'express'
import { setSpotifyLimits, spotifyBudgetView } from '../spotify-budget'
import { requireCsrf, requireSession } from './middleware'

export function registerKnSpotifyLimitRoutes(router: Router): void {
  /** GET /api/app/kn/spotify-limits - limits, defaults, the requests counted, waiting */
  router.get('/kn/spotify-limits', requireSession, (_req, res) => {
    res.json(spotifyBudgetView())
  })

  /** POST /api/app/kn/spotify-limits {window?, hour?, day?, gapSeconds?} or {defaults: true} */
  router.post('/kn/spotify-limits', requireSession, requireCsrf, (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const view = spotifyBudgetView()
    const next =
      body.defaults === true
        ? view.defaults
        : { window: body.window, hour: body.hour, day: body.day, gapSeconds: body.gapSeconds }
    for (const [k, v] of Object.entries(next)) {
      if (v !== undefined && !Number.isFinite(Number(v))) {
        res.status(400).json({ error: 'Bitte nur Zahlen eingeben.', field: k })
        return
      }
    }
    setSpotifyLimits(next)
    res.json(spotifyBudgetView())
  })
}
