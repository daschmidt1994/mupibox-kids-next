// Updates of the app (the start page's "update available", Einstellungen › Updates): MuPiBox Kids Next from its own
// repository (kn-repo.ts), the operating system with apt.
//
// KN: the original's update (splitti/MuPiBox: version.json and update/start_mupibox_update.sh) is gone - its releases
// are made for its own image with an older Debian and would replace Kids Next. An update here is kidsnext/install.sh
// with the new version: the same steps as the installation, settings and library stay (autosetup.sh keeps them aside).
// Two channels: "stable" = the newest release on GitHub (its tag), "dev" = the development branch as it is now.
//
// Both run as a systemd unit of their own (mupibox-update), out of the server: the update stops and replaces the server
// itself. Its progress goes to a file the app reads.

import { execFile } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { Router } from 'express'
import type { MupiboxConfig } from '../models/mupibox-config.model'
import { KN_API, KN_BRANCH, KN_INSTALLED_JSON, KN_RAW, KN_REPO } from './kn-repo'
import { requireCsrf, requireSession } from './middleware'

export interface UpdatesDeps {
  getMupiboxConfig: () => MupiboxConfig | undefined
}

const STATE_DIR = '/var/lib/mupibox-update'
const UNIT = 'mupibox-update'
const CHANNELS = ['stable', 'dev'] as const
type Channel = (typeof CHANNELS)[number]
/** a tag or branch as GitHub and install.sh --ref take it */
const REF_RE = /^[A-Za-z0-9._/-]{1,100}$/

function run(cmd: string, args: string[], timeoutMs = 30000): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ ok: !err, stdout: stdout ?? '', stderr: stderr ?? '' }),
    )
  })
}

// $1 = stable | dev | os, $2 = the tag or branch (stable, dev). Its state for the app in state (key=value), progress
// (percent, tab, step) and output.txt; they stay after the restart, so the app can tell how the last update went.
export const RUN_SH = `#!/bin/bash
# The app's update (backend-api eltern/updates.ts), run as the systemd unit ${UNIT}: $1 = stable | dev | os, $2 = ref
D=${STATE_DIR}
KIND="$1"
REF="$2"
PHASE=running
STARTED=$(date +%s)
FINISHED=
write_state() {
	printf 'kind=%s\\nref=%s\\nphase=%s\\nstarted=%s\\nfinished=%s\\n' "$KIND" "$REF" "$PHASE" "$STARTED" "$FINISHED" > "$D/state.tmp" && mv "$D/state.tmp" "$D/state"
}
finish() {
	PHASE="$1"
	FINISHED=$(date +%s)
	write_state
}
progress() { printf '%s\\t%s\\n' "$1" "$2" > "$D/progress"; }
exec > "$D/output.txt" 2>&1
write_state
progress 0 "Start"

# the idle shutdown must not switch the box off in the middle of it
IDLE_WAS_ACTIVE=$(systemctl is-active mupi_idle_shutdown 2>/dev/null)
systemctl stop mupi_idle_shutdown 2>/dev/null

if [ "$KIND" = "os" ]; then
	export DEBIAN_FRONTEND=noninteractive
	APT_OPTS="-o DPkg::Lock::Timeout=600 -o Dpkg::Options::=--force-confdef -o Dpkg::Options::=--force-confold"
	progress 10 "apt-get update"
	if apt-get $APT_OPTS update; then
		progress 30 "apt-get upgrade"
		if apt-get -y --install-recommends $APT_OPTS upgrade; then
			progress 100 "OK"
			finish ok
		else
			finish failed
		fi
	else
		finish failed
	fi
	[ "$IDLE_WAS_ACTIVE" = "active" ] && systemctl start mupi_idle_shutdown
	exit 0
fi

case "$REF" in
	'' | *[!A-Za-z0-9._/-]*) echo "Invalid version: $REF"; finish failed; exit 0 ;;
esac

progress 1 "Download"
if ! curl -fsSL --retry 3 --retry-delay 3 -m 120 -o "$D/install.sh" "https://raw.githubusercontent.com/${KN_REPO}/$REF/kidsnext/install.sh" || ! bash -n "$D/install.sh"; then
	echo "The installer could not be downloaded - nothing was changed."
	[ "$IDLE_WAS_ACTIVE" = "active" ] && systemctl start mupi_idle_shutdown
	finish failed
	exit 0
fi

# a copy of the settings, the library and the covers on the box (the newest three are kept)
progress 2 "Backup"
mkdir -p /home/dietpi/mupibox-backups
BACKUP="/home/dietpi/mupibox-backups/before-update-$(date +%Y-%m-%d-%H%M).zip"
zip -q -r "$BACKUP" /etc/mupibox/mupiboxconfig.json /home/dietpi/.mupibox/Sonos-Kids-Controller-master/server/config/data.json /home/dietpi/MuPiBox/media/cover
chown -R dietpi:dietpi /home/dietpi/mupibox-backups
ls -1t /home/dietpi/mupibox-backups/before-update-*.zip 2>/dev/null | tail -n +4 | xargs -r rm -f

# The installer, as on a new box but without questions and without its own restart. Its steps for the progress:
# its headlines (==>) and the installation's (indented), the latter between 10 and 85 %.
cd /root
PCT=3
bash "$D/install.sh" --new --yes --no-reboot --ref "$REF" 2>&1 | while IFS= read -r line; do
	printf '%s\\n' "$line"
	text=$(printf '%s' "$line" | sed 's/\\x1b\\[[0-9;]*m//g')
	case "$text" in
		'==> MuPiBox installieren'*) PCT=10 ;;
		'==> Kids-Next'* | '==> NAS-Backup'*) [ "$PCT" -lt 86 ] && PCT=86 ;;
		'==> Installation prüfen'*) PCT=95 ;;
		'==> '*) [ "$PCT" -lt 9 ] && PCT=$((PCT + 1)) ;;
		'    '[!\\ ]*) [ "$PCT" -ge 10 ] && [ "$PCT" -lt 85 ] && PCT=$((PCT + 1)) ;;
		*) continue ;;
	esac
	progress "$PCT" "$(printf '%s' "$text" | sed 's/^==> //; s/^ *//' | cut -c1-120)"
done
RC=\${PIPESTATUS[0]}
if [ "$RC" = "0" ]; then
	progress 100 "OK"
	finish rebooting
	sleep 10
	systemctl reboot
else
	echo "The update stopped (exit code $RC). Settings and library stay; the installer can be started again."
	finish failed
	[ "$IDLE_WAS_ACTIVE" = "active" ] && systemctl start mupi_idle_shutdown
	# (the installation stops the server and the display on the way; an aborted run may leave them stopped)
	sudo -H -u dietpi bash -c "pm2 start server"
	sudo -i -u dietpi /usr/local/bin/mupibox/restart_kiosk.sh
fi
`

export interface Release {
  version: string
  /** the tag (stable) or branch (dev) install.sh takes */
  ref: string
  info: string
  /** dev: the commit and its day */
  commit?: string
  date?: string
}
export interface Installed {
  version: string | null
  ref: string | null
  commit: string | null
  date: string | null
}

let stableCache: { at: number; release: Release | null } | null = null
let devCache: { at: number; release: Release | null } | null = null
const HOUR = 3600_000

async function getJson(url: string, accept = 'application/vnd.github+json'): Promise<unknown> {
  const r = await fetch(url, { signal: AbortSignal.timeout(8000), headers: { Accept: accept } })
  if (!r.ok) throw new Error(String(r.status))
  return r.json()
}

/** The newest release (stable) and the development branch now (dev); null where GitHub did not answer. */
export async function knVersions(): Promise<Record<Channel, Release | null>> {
  if (!stableCache || Date.now() - stableCache.at > HOUR) {
    try {
      const rel = (await getJson(`${KN_API}/releases/latest`)) as { tag_name?: string; name?: string; body?: string }
      const tag = String(rel.tag_name ?? '')
      stableCache = {
        at: Date.now(),
        release: REF_RE.test(tag)
          ? { version: tag.replace(/^v/, ''), ref: tag, info: String(rel.name || rel.body || '').slice(0, 300) }
          : null,
      }
    } catch (e) {
      // 404: no release yet; else no internet - the last answer, if any
      if ((e as Error).message === '404') stableCache = { at: Date.now(), release: null }
    }
  }
  if (!devCache || Date.now() - devCache.at > HOUR) {
    try {
      const c = (await getJson(`${KN_API}/commits/${KN_BRANCH}`)) as {
        sha?: string
        commit?: { message?: string; committer?: { date?: string } }
      }
      const v = await fetch(`${KN_RAW}/kidsnext/VERSION`, { signal: AbortSignal.timeout(8000) })
      const version = v.ok ? (await v.text()).trim() : ''
      devCache = {
        at: Date.now(),
        release: c.sha
          ? {
              version: /^\d+(\.\d+)+$/.test(version) ? version : '?',
              ref: KN_BRANCH,
              info: String(c.commit?.message ?? '')
                .split('\n')[0]
                .slice(0, 200),
              commit: String(c.sha),
              date: String(c.commit?.committer?.date ?? '').slice(0, 10),
            }
          : null,
      }
    } catch {
      // no internet
    }
  }
  return { stable: stableCache?.release ?? null, dev: devCache?.release ?? null }
}

export async function readInstalled(file = KN_INSTALLED_JSON): Promise<Installed> {
  try {
    const j = JSON.parse(await fsp.readFile(file, 'utf8')) as Record<string, unknown>
    const s = (k: string) => (typeof j[k] === 'string' && j[k] ? (j[k] as string) : null)
    return { version: s('version'), ref: s('ref'), commit: s('commit'), date: s('date') }
  } catch {
    return { version: null, ref: null, commit: null, date: null }
  }
}

/** The channel a box follows: the development branch, or (a tag, or not known) the releases. */
export function channelOf(installed: Installed): Channel {
  return installed.ref === KN_BRANCH ? 'dev' : 'stable'
}

/** -1, 0, 1 for version numbers like 4.2.10 against 4.2.9 */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

/** Whether the channel of the box has something newer: dev by its commit, stable by the version number. */
export function updateFor(
  installed: Installed,
  latest: Record<Channel, Release | null>,
): { channel: Channel; version: string } | null {
  const channel = channelOf(installed)
  const next = latest[channel]
  if (!next) return null
  if (channel === 'dev') {
    if (!next.commit || next.commit === installed.commit) return null
    return { channel, version: `${next.version} · Stand ${next.date ?? ''} (${next.commit.slice(0, 7)})` }
  }
  if (!installed.version) return null
  return compareVersions(next.version, installed.version) > 0 ? { channel, version: next.version } : null
}

async function jobState() {
  const read = (f: string) => fsp.readFile(path.join(STATE_DIR, f), 'utf8').catch(() => '')
  const [stateText, progressText, output] = await Promise.all([read('state'), read('progress'), read('output.txt')])
  if (!stateText) return null
  const state = Object.fromEntries(
    stateText
      .split('\n')
      .filter((l) => l.includes('='))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  )
  const [percent, step] = progressText.trim().split('\t')
  // the unit may have ended without a word (a crash, the box switched off): then it is not running any more
  const active = (await run('systemctl', ['is-active', UNIT], 5000)).stdout.trim()
  // (and "rebooting" is done once the box is up again)
  let phase = state.phase
  const alive = active === 'active' || active === 'activating'
  if (phase === 'running' && !alive) phase = 'failed'
  if (phase === 'rebooting' && !alive) phase = 'ok'
  return {
    kind: state.kind,
    ref: state.ref ?? '',
    phase, // running | rebooting | ok | failed
    started: Number(state.started) * 1000 || null,
    finished: Number(state.finished) * 1000 || null,
    percent: Number(percent) || 0,
    step: step ?? '',
    // the last lines, without the terminal's control characters
    output: output
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
      .split(/\r?\n|\r/)
      .filter((l) => l.trim())
      .slice(-40)
      .join('\n'),
  }
}

export function registerUpdateRoutes(router: Router, deps: UpdatesDeps): void {
  /** GET /api/app/updates - the installed version, the repository's, whether there is a newer one, the last job */
  router.get('/updates', requireSession, async (_req, res) => {
    const [latest, installed, job] = await Promise.all([knVersions(), readInstalled(), jobState()])
    // (a box without installed.json: the version the setup wrote into the config, e.g. "Kids Next 0.1.0")
    const fromConfig = String((deps.getMupiboxConfig()?.mupibox as Record<string, unknown> | undefined)?.version ?? '')
    if (!installed.version) installed.version = /\d+(?:\.\d+)+/.exec(fromConfig)?.[0] ?? null
    const channel = channelOf(installed)
    res.json({
      repo: KN_REPO,
      installed: installed.version ? `Kids Next ${installed.version}` : fromConfig,
      installedInfo: installed,
      channel,
      latest,
      update: updateFor(installed, latest),
      job,
    })
  })

  /** GET /api/app/updates/job - the running (or last) update, for the progress */
  router.get('/updates/job', requireSession, async (_req, res) => {
    res.json({ job: await jobState() })
  })

  /** POST /api/app/updates/start {kind: stable|dev|os} - the version is the one the server knows, not the page's */
  router.post('/updates/start', requireSession, requireCsrf, async (req, res) => {
    const kind = String((req.body ?? {}).kind ?? '')
    if (![...CHANNELS, 'os'].includes(kind)) {
      res.status(400).json({ error: 'invalid kind' })
      return
    }
    let ref = ''
    if (kind !== 'os') {
      const rel = (await knVersions())[kind as Channel]
      if (!rel || !REF_RE.test(rel.ref)) {
        res.status(409).json({ error: 'version not known (no internet?)' })
        return
      }
      ref = rel.ref
    }
    const active = (await run('systemctl', ['is-active', UNIT], 5000)).stdout.trim()
    if (active === 'active' || active === 'activating') {
      res.status(409).json({ error: 'an update is running' })
      return
    }
    const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'mupibox-update-'))
    try {
      await fsp.writeFile(path.join(tmp, 'run.sh'), RUN_SH)
      const install = await run('sudo', [
        'sh',
        '-c',
        `install -d -m 755 ${STATE_DIR} && install -m 755 '${tmp}/run.sh' ${STATE_DIR}/run.sh && rm -rf ${STATE_DIR}/bin ${STATE_DIR}/state ${STATE_DIR}/progress ${STATE_DIR}/output.txt`,
      ])
      if (!install.ok) {
        res.status(500).json({ error: 'could not prepare the update' })
        return
      }
    } finally {
      await fsp.rm(tmp, { recursive: true, force: true })
    }
    const args = [
      'systemd-run',
      `--unit=${UNIT}`,
      '--collect',
      '--quiet',
      '--working-directory=/root',
      '/bin/bash',
      `${STATE_DIR}/run.sh`,
      kind,
    ]
    if (ref) args.push(ref)
    const r = await run('sudo', args, 15000)
    if (!r.ok) {
      res.status(500).json({ error: `could not start the update ${r.stderr.slice(0, 200)}` })
      return
    }
    res.json({ ok: true })
  })
}
