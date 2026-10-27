// KN: Kids Next - NAS backup and restore in the web app (Einstellungen › System › Backup).
//
// The work is done by the box's tools (kidsnext/backup/mupi-kn-backup, mupi-kn-restore, as root through sudo): this
// module only checks what the app sends and hands it on as separate arguments (never through a shell). Passwords and
// the recovery key go to the tools on stdin, never as arguments (those are visible in the process list) and never
// into a log. A backup or a restore runs as a systemd unit of its own: it goes on when this server is stopped - a
// restore stops it on purpose and restarts the box at the end.

import { spawn } from 'node:child_process'
import type { Router } from 'express'
import { requireCsrf, requireSession } from './middleware'

const BACKUP = '/usr/local/sbin/mupi-kn-backup'
const RESTORE = '/usr/local/sbin/mupi-kn-restore'
const BACKUP_UNIT = 'mupi-kn-backup-now'
const RESTORE_UNIT = 'mupi-kn-restore-now'
const REPORT = '/var/lib/mupibox-kn/restore-report.json'

// the same rules as kb_valid in backup-lib.sh
const RULES = {
  type: /^(nfs|smb)$/,
  host: /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/,
  share: /^\/?[A-Za-z0-9._ $-]+(\/[A-Za-z0-9._ -]+)*\/?$/,
  dir: /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/,
  box: /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/,
  user: /^[A-Za-z0-9._@\\-]{1,64}$/,
  time: /^([01][0-9]|2[0-3]):[0-5][0-9]$/,
  days: /^(daily|(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(,(Mon|Tue|Wed|Thu|Fri|Sat|Sun))*)$/,
  keep: /^[0-9]{1,3}$/,
  snapshot: /^[0-9a-f]{8,64}$/,
}

interface Result {
  ok: boolean
  code: number | null
  stdout: string
  stderr: string
}

/** A tool as root, with lines on stdin (password, key) */
function sudo(args: string[], input: string[] = [], timeoutMs = 120000): Promise<Result> {
  return new Promise((resolve) => {
    const child = spawn('sudo', ['-n', ...args], { stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    child.stdout.on('data', (d) => {
      stdout += d
    })
    child.stderr.on('data', (d) => {
      stderr += d
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ ok: false, code: null, stdout, stderr: stderr || 'sudo failed' })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ ok: code === 0, code, stdout, stderr })
    })
    child.stdin.end(input.map((l) => `${l}\n`).join(''))
  })
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(text)
    return v && typeof v === 'object' ? v : null
  } catch {
    return null
  }
}

/** The tool's own message for the app: its JSON error, else its last line (German, made for the parents) */
function toolError(r: Result): string {
  const j = parseJson(r.stdout)
  if (j && typeof j.error === 'string') return j.error
  const last = (r.stderr || r.stdout).trim().split('\n').pop() ?? ''
  return last.replace(/^✘\s*/, '') || 'Das hat nicht geklappt'
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** The NAS part of a request as the tools' arguments; a wrong value gives its field */
export function nasArgs(body: Record<string, unknown>): { args: string[]; input: string[] } | { field: string } {
  const type = str(body.type)
  const host = str(body.host)
  const share = str(body.share)
  const dir = str(body.dir) || 'mupibox-backups'
  if (!RULES.type.test(type)) return { field: 'type' }
  if (!RULES.host.test(host)) return { field: 'host' }
  if (!RULES.share.test(share) || share.includes('..')) return { field: 'share' }
  if (!RULES.dir.test(dir) || dir.includes('..')) return { field: 'dir' }
  const args = ['--type', type, '--host', host, '--share', share, '--dir', dir]
  const input: string[] = []
  if (type === 'smb') {
    const user = str(body.user)
    const password = typeof body.password === 'string' ? body.password : ''
    if (!RULES.user.test(user)) return { field: 'user' }
    if (password.includes('\n')) return { field: 'password' }
    // (no password given when the setup is changed: the one saved on the box stays)
    if (password !== '' || body.passwordRequired) {
      args.push('--user', user, '--password-stdin')
      input.push(password)
    }
  }
  return { args, input }
}

async function unitActive(unit: string): Promise<boolean> {
  const r = await sudo(['systemctl', 'is-active', unit], [], 10000)
  const s = r.stdout.trim()
  return s === 'active' || s === 'activating'
}

async function journalTail(unit: string): Promise<string> {
  const r = await sudo(['journalctl', '-u', unit, '-n', '40', '-o', 'cat', '--no-pager'], [], 10000)
  return r.stdout
}

export function registerKnBackupRoutes(router: Router): void {
  /** GET /api/app/kn/backup - settings, last runs, whether a backup runs right now */
  router.get('/kn/backup', requireSession, async (_req, res) => {
    const [status, running] = await Promise.all([sudo([BACKUP, 'status', '--json'], [], 20000), unitActive(BACKUP_UNIT)])
    const j = parseJson(status.stdout)
    if (!j) {
      res.status(503).json({ error: 'not_installed', detail: toolError(status) })
      return
    }
    res.json({ ...j, running, output: running ? await journalTail(BACKUP_UNIT) : '' })
  })

  /** POST /api/app/kn/backup/setup - set up or change the NAS backup; answers with a new recovery key once */
  router.post('/kn/backup/setup', requireSession, requireCsrf, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const nas = nasArgs(body)
    if ('field' in nas) {
      res.status(400).json({ error: 'invalid', field: nas.field })
      return
    }
    const box = str(body.box)
    const time = str(body.time) || '03:30'
    const days = str(body.days) || 'daily'
    if (!RULES.box.test(box)) return void res.status(400).json({ error: 'invalid', field: 'box' })
    if (!RULES.time.test(time)) return void res.status(400).json({ error: 'invalid', field: 'time' })
    if (!RULES.days.test(days)) return void res.status(400).json({ error: 'invalid', field: 'days' })
    const keep = ['keepDaily', 'keepWeekly', 'keepMonthly'].map((k) => String(body[k] ?? ''))
    if (!keep.every((k) => RULES.keep.test(k))) return void res.status(400).json({ error: 'invalid', field: 'keep' })
    const args = [
      BACKUP,
      'setup',
      '--json',
      '--yes',
      ...nas.args,
      '--box',
      box,
      '--media',
      body.media ? '1' : '0',
      '--time',
      time,
      '--days',
      days,
      '--keep-daily',
      keep[0],
      '--keep-weekly',
      keep[1],
      '--keep-monthly',
      keep[2],
      body.enabled === false ? '--disable' : '--enable',
    ]
    const input = [...nas.input]
    // the key of an existing backup of this box (set up again on a new card without the restore)
    const key = str(body.key)
    if (key) {
      if (key.length > 200) return void res.status(400).json({ error: 'invalid', field: 'key' })
      args.push('--key-stdin')
      input.push(key)
    }
    // (installing the NFS/SMB programs the first time can take minutes on a Pi 3)
    const r = await sudo(args, input, 10 * 60000)
    const j = parseJson(r.stdout)
    if (!r.ok || !j?.ok) {
      res.status(422).json({ error: toolError(r) })
      return
    }
    res.json(j)
  })

  /** POST /api/app/kn/backup/run - a backup now, in the background (progress: GET /kn/backup) */
  router.post('/kn/backup/run', requireSession, requireCsrf, async (_req, res) => {
    if ((await unitActive(BACKUP_UNIT)) || (await unitActive('mupi-kn-backup'))) {
      res.status(409).json({ error: 'running' })
      return
    }
    const r = await sudo(
      ['systemd-run', `--unit=${BACKUP_UNIT}`, '--collect', '--property=Nice=15', '--property=IOSchedulingClass=idle', BACKUP, 'run'],
      [],
      20000,
    )
    if (!r.ok) {
      res.status(500).json({ error: toolError(r) })
      return
    }
    res.json({ ok: true })
  })

  /** GET /api/app/kn/backup/list - the backups on the NAS */
  router.get('/kn/backup/list', requireSession, async (_req, res) => {
    const r = await sudo([BACKUP, 'list', '--json'], [], 120000)
    let list: unknown = null
    try {
      list = JSON.parse(r.stdout)
    } catch {
      // not JSON: the tool's message below
    }
    if (!r.ok || !Array.isArray(list)) {
      res.status(422).json({ error: toolError(r) })
      return
    }
    res.json({ snapshots: list })
  })

  /** POST /api/app/kn/backup/key - the recovery key once more (POST: never cached, needs the session's token) */
  router.post('/kn/backup/key', requireSession, requireCsrf, async (_req, res) => {
    const r = await sudo([BACKUP, 'show-key'], [], 10000)
    if (!r.ok) {
      res.status(404).json({ error: toolError(r) })
      return
    }
    res.set('Cache-Control', 'no-store').json({ key: r.stdout.trim() })
  })

  /** POST /api/app/kn/restore/browse - the boxes on the NAS, or (with box and key) the backups of one */
  router.post('/kn/restore/browse', requireSession, requireCsrf, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const nas = nasArgs({ ...body, passwordRequired: true })
    if ('field' in nas) {
      res.status(400).json({ error: 'invalid', field: nas.field })
      return
    }
    const args = [RESTORE, 'browse', ...nas.args]
    const input = [...nas.input]
    const box = str(body.box)
    if (box) {
      if (!RULES.box.test(box)) return void res.status(400).json({ error: 'invalid', field: 'box' })
      const key = str(body.key)
      if (!key || key.length > 200) return void res.status(400).json({ error: 'invalid', field: 'key' })
      args.push('--box', box, '--key-stdin')
      input.push(key)
    }
    const r = await sudo(args, input, 10 * 60000)
    const j = parseJson(r.stdout)
    if (!j) {
      res.status(422).json({ error: toolError(r) })
      return
    }
    res.status(j.ok ? 200 : 422).json(j)
  })

  /**
   * POST /api/app/kn/restore/start - restore a backup: chosen and its key checked here, then checked on the NAS,
   * restored and the box restarted by a unit of its own (this server is stopped on the way).
   */
  router.post('/kn/restore/start', requireSession, requireCsrf, async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const nas = nasArgs({ ...body, passwordRequired: true })
    if ('field' in nas) {
      res.status(400).json({ error: 'invalid', field: nas.field })
      return
    }
    const box = str(body.box)
    const key = str(body.key)
    const snapshot = str(body.snapshot)
    if (!RULES.box.test(box)) return void res.status(400).json({ error: 'invalid', field: 'box' })
    if (!key || key.length > 200) return void res.status(400).json({ error: 'invalid', field: 'key' })
    if (!RULES.snapshot.test(snapshot)) return void res.status(400).json({ error: 'invalid', field: 'snapshot' })
    if ((await unitActive(RESTORE_UNIT)) || (await unitActive(BACKUP_UNIT))) {
      res.status(409).json({ error: 'running' })
      return
    }
    const sel = await sudo(
      [RESTORE, 'select', ...nas.args, '--box', box, '--snapshot', snapshot, '--key-stdin', '--no-check'],
      [...nas.input, key],
      10 * 60000,
    )
    if (!sel.ok) {
      res.status(422).json({ error: toolError(sel) })
      return
    }
    const netbird = body.netbird === true ? 'yes' : 'no'
    // (fixed words only in the shell line: everything the app sent went to select above)
    const script = `${RESTORE} apply --check --yes --netbird ${netbird} && ${BACKUP} timer && sleep 3 && systemctl reboot`
    const r = await sudo(['systemd-run', `--unit=${RESTORE_UNIT}`, '--collect', '/bin/sh', '-c', script], [], 20000)
    if (!r.ok) {
      res.status(500).json({ error: toolError(r) })
      return
    }
    res.json({ ok: true })
  })

  /** GET /api/app/kn/restore/state - a running restore (its output) and the report of the last one */
  router.get('/kn/restore/state', requireSession, async (_req, res) => {
    const running = await unitActive(RESTORE_UNIT)
    const report = await sudo(['cat', REPORT], [], 10000)
    res.json({ running, output: await journalTail(RESTORE_UNIT), report: report.ok ? parseJson(report.stdout) : null })
  })
}
