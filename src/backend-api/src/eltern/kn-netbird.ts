// KN: Kids Next - NetBird in the web app (Einstellungen › Netzwerk › NetBird): the box in the parents' own VPN, so the
// app is reachable from outside the home network too.
//
// The work is done by kidsnext/netbird/mupi-kn-netbird (as root through sudo): this module checks what the app sends
// and hands it on as separate arguments (never through a shell). The setup key goes to the tool on stdin - never as an
// argument (visible in the process list), never into a log or the box's settings. The installation (apt) runs as a
// systemd unit of its own, the app asks for its end.

import * as os from 'node:os'
import type { Router } from 'express'
import { parseJson, sudo, toolError } from './kn-backup'
import { requireCsrf, requireSession } from './middleware'

const TOOL = '/usr/local/sbin/mupi-kn-netbird'
const INSTALL_UNIT = 'mupi-kn-netbird-install'

// the same rules as valid_url, valid_hostname and valid_key in mupi-kn-netbird
export const NB_RULES = {
  url: /^https?:\/\/[A-Za-z0-9][A-Za-z0-9.-]{0,252}(:[0-9]{1,5})?\/?$/,
  hostname: /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/,
  key: /^[A-Za-z0-9-]{8,128}$/,
}

/** The tool's arguments and stdin for "up", or the field that is not valid. */
export function upArgs(body: Record<string, unknown>): { args: string[]; input: string[] } | { field: string } {
  const url = String(body.url ?? '').trim()
  const hostname = String(body.hostname ?? '').trim()
  const key = String(body.setupKey ?? '').replace(/\s+/g, '')
  if (!NB_RULES.url.test(url)) return { field: 'url' }
  if (hostname && !NB_RULES.hostname.test(hostname)) return { field: 'hostname' }
  if (key && !NB_RULES.key.test(key)) return { field: 'setupKey' }
  const args = [TOOL, 'up', '--url', url, '--json']
  if (hostname) args.push('--hostname', hostname)
  if (key) args.push('--key-stdin')
  return { args, input: key ? [key] : [] }
}

const FIELD_TEXT: Record<string, string> = {
  url: 'Die Server-Adresse ist ungültig (z. B. https://netbird.example.com).',
  hostname: 'Der Name ist ungültig (Buchstaben, Ziffern, Bindestrich).',
  setupKey: 'Der Setup-Key ist ungültig.',
}

export function registerKnNetbirdRoutes(router: Router): void {
  /** GET /api/app/kn/netbird - installed?, connected?, NetBird IP and name, peers; the installation running */
  router.get('/kn/netbird', requireSession, async (_req, res) => {
    const unit = await sudo(['systemctl', 'is-active', `${INSTALL_UNIT}.service`], [], 5000)
    const installing = ['active', 'activating'].includes(unit.stdout.trim())
    const r = await sudo([TOOL, 'status', '--json'], [], 20000)
    const status = parseJson(r.stdout)
    if (!status) {
      res
        .status(503)
        .json({ error: r.code === 1 && /sudo/.test(r.stderr) ? 'no rights' : 'NetBird tool missing', installing })
      return
    }
    res.json({ ...status, installing, hostname: os.hostname() })
  })

  /** POST /api/app/kn/netbird/install - NetBird from netbird.io's repository (a unit of its own: apt takes a while) */
  router.post('/kn/netbird/install', requireSession, requireCsrf, async (_req, res) => {
    const r = await sudo(['systemd-run', `--unit=${INSTALL_UNIT}`, '--collect', '--quiet', TOOL, 'install'], [], 15000)
    if (!r.ok) {
      res
        .status(/already|exists/i.test(r.stderr) ? 409 : 500)
        .json({ error: 'Die Installation ließ sich nicht starten.' })
      return
    }
    res.json({ ok: true })
  })

  /** POST /api/app/kn/netbird/up {url, hostname?, setupKey?} - connect (a new box: with a setup key) */
  router.post('/kn/netbird/up', requireSession, requireCsrf, async (req, res) => {
    const a = upArgs((req.body ?? {}) as Record<string, unknown>)
    if ('field' in a) {
      res.status(400).json({ error: FIELD_TEXT[a.field], field: a.field })
      return
    }
    const r = await sudo(a.args, a.input, 120000)
    const j = parseJson(r.stdout)
    if (!r.ok || !j?.ok) {
      res.status(r.code === 2 ? 400 : 502).json({ error: toolError(r) })
      return
    }
    res.json(j)
  })

  /** POST /api/app/kn/netbird/down - disconnect (the registration stays: "up" without a key connects again) */
  router.post('/kn/netbird/down', requireSession, requireCsrf, async (_req, res) => {
    const r = await sudo([TOOL, 'down', '--json'], [], 40000)
    if (!r.ok) {
      res.status(502).json({ error: toolError(r) })
      return
    }
    res.json({ ok: true })
  })
}
