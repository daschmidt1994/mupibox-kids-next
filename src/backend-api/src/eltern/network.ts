// Network options of the app (the admin interface's network.php and admin.php): onboard WiFi at boot, DHCP timeout,
// WiFi watchdog, "best connection", restarting WiFi, renewing DHCP (WiFi or LAN), control by IP. The LAN itself
// (on/off, DHCP/static) has its routes in server.ts (/api/network/ethernet*), the onboard radio's quick switch too
// (/api/network/onboard-wifi).
//
// KN: no USB WiFi drivers to build any more (the original's RTL88X2BU/RTL8821AU installers, out-of-tree drivers from
// 2021 that do not build on Debian 13): the kernel has them (rtw88_8822bu, rtw88_8821au …). The page shows the adapter
// and its driver; mupi_wifi_select.sh prefers it to the onboard WiFi.

import { execFile, spawn } from 'node:child_process'
import { promises as fsp } from 'node:fs'
import * as path from 'node:path'
import type { Router } from 'express'
import type { MupiboxConfig } from '../models/mupibox-config.model'
import { requireCsrf, requireSession } from './middleware'
import { bootConfigPath } from './boot-paths'

export interface NetworkDeps {
  getMupiboxConfig: () => MupiboxConfig | undefined
  updateMupiboxConfig: (mutate: (cfg: Record<string, unknown>) => void) => Promise<void>
}

function run(cmd: string, args: string[], timeoutMs = 30000): Promise<{ ok: boolean; stdout: string }> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve({ ok: !err, stdout: stdout ?? '' }))
  })
}

function detached(script: string): void {
  const child = spawn('sh', ['-c', `setsid sh -c '${script.replace(/'/g, `'\\''`)}' >/dev/null 2>&1 < /dev/null &`], { detached: true, stdio: 'ignore' })
  child.on('error', () => undefined)
  child.unref()
}

async function exists(p: string): Promise<boolean> {
  return (await run('sudo', ['test', '-e', p], 5000)).ok
}
const ONBOARD_SCRIPT = '/usr/local/bin/mupibox/mupi_onboard_wifi.sh'
const enabled = async (unit: string) => (await run('systemctl', ['is-enabled', unit], 5000)).stdout.trim() === 'enabled'
const wifiIface = async () => (await run('/usr/local/bin/mupibox/mupi_wifi_iface.sh', [], 5000)).stdout.trim() || 'wlan0'

/** the kernel driver of a network interface (rtw88_8822bu, brcmfmac …), null without one */
async function driverOf(iface: string): Promise<string | null> {
  if (!/^[a-z0-9]+$/.test(iface)) return null
  const target = await fsp.readlink(`/sys/class/net/${iface}/device/driver`).catch(() => '')
  return target ? path.basename(target) : null
}

export function registerNetworkRoutes(router: Router, deps: NetworkDeps): void {
  router.get('/network-options', requireSession, async (_req, res) => {
    const configTxt = await fsp.readFile(await bootConfigPath(), 'utf8').catch(() => '')
    const dhclient = await fsp.readFile('/etc/dhcp/dhclient.conf', 'utf8').catch(() => '')
    const radio = (await run(ONBOARD_SCRIPT, ['status'], 5000)).stdout.trim() // on | off | unavailable
    const bootDisabled = /^dtoverlay=disable-wifi\s*$/m.test(configTxt)
    const usbIface = (await run('/usr/local/bin/mupibox/mupi_wifi_iface.sh', ['usb'], 5000)).stdout.trim()
    res.json({
      // the onboard WiFi: on only when the chip is on at the start and its radio is on
      onboard: !bootDisabled && radio === 'on',
      onboardBootDisabled: bootDisabled,
      onboardRadio: radio,
      onboardIface: (await run('/usr/local/bin/mupibox/mupi_wifi_iface.sh', ['onboard'], 5000)).stdout.trim(),
      usbIface,
      usbDriver: usbIface ? await driverOf(usbIface) : null,
      wifiIface: await wifiIface(),
      dhcpTimeout: /^timeout 10;/m.test(dhclient),
      wifiMonitor: await enabled('dietpi-wifi-monitor'),
      bestConnection: await enabled('mupi_autoconnect-wifi'),
      ipControl: ((deps.getMupiboxConfig()?.mupibox as Record<string, unknown> | undefined)?.ip_control_backend ?? false) === true,
    })
  })

  /** POST /api/app/network-options {key, value} */
  router.post('/network-options', requireSession, requireCsrf, async (req, res) => {
    const { key, value } = (req.body ?? {}) as { key?: unknown; value?: unknown }
    const on = value === true
    let r: { ok: boolean } = { ok: false }
    let rebootNeeded = false
    switch (key) {
      case 'onboard': {
        // one switch for both ways the box knows: the chip at the start (dtoverlay=disable-wifi, the admin
        // interface's switch) and its radio now (rfkill, the display's switch). Off takes effect at once; on too,
        // unless the chip was switched off at the start - then only after a restart.
        if (!on) await run('sudo', [ONBOARD_SCRIPT, 'off'], 10000)
        r = await run('sudo', ['/usr/local/bin/mupibox/set_onboard_wifi.sh', on ? 'on' : 'off'], 60000)
        if (on) {
          if ((await run(ONBOARD_SCRIPT, ['status'], 5000)).stdout.trim() === 'unavailable') rebootNeeded = true
          else await run('sudo', [ONBOARD_SCRIPT, 'on'], 10000)
        }
        break
      }
      case 'dhcpTimeout':
        r = await run('sudo', ['sed', '-i', on ? 's/#timeout 60;/timeout 10;/g' : 's/timeout 10;/#timeout 60;/g', '/etc/dhcp/dhclient.conf'])
        break
      case 'wifiMonitor':
        r = await run('sudo', ['systemctl', on ? 'enable' : 'disable', '--now', 'dietpi-wifi-monitor'])
        break
      case 'bestConnection':
        r = await run('sudo', ['systemctl', on ? 'enable' : 'disable', '--now', 'mupi_autoconnect-wifi'])
        break
      case 'ipControl':
        // the backend's address for the player: its config.json is written by setting_update.sh and read at the start
        await deps.updateMupiboxConfig((cfg) => {
          cfg.mupibox = { ...((cfg.mupibox as Record<string, unknown>) ?? {}), ip_control_backend: on }
        })
        detached('sudo /usr/local/bin/mupibox/setting_update.sh; sleep 1; PM2=$(command -v pm2 || echo /usr/local/bin/pm2); "$PM2" restart server')
        r = { ok: true }
        break
      default:
        res.status(400).json({ error: 'unknown option' })
        return
    }
    res.status(r.ok ? 200 : 500).json({ ok: r.ok, rebootNeeded })
  })

  /** POST /api/app/wifi/restart and /dhcp/renew - as the admin interface (the WiFi is gone for a moment). */
  router.post('/wifi/restart', requireSession, requireCsrf, async (_req, res) => {
    const iface = await wifiIface()
    detached(`sleep 1; sudo service ifup@${iface} stop; sudo service ifup@${iface} start`)
    res.json({ ok: true })
  })
  /**
   * POST /api/app/dhcp/renew {lan?: 'eth0'} - the address of one connection fetched anew from the router: the WiFi's,
   * or with lan the cable's. Only that connection's DHCP client (as ifupdown runs it) gives its address back and asks
   * again - it was all of them before, and then only the WiFi was started again (409: it gets no address by DHCP).
   */
  router.post('/dhcp/renew', requireSession, requireCsrf, async (req, res) => {
    const r = await renewDhcp((req.body as { lan?: unknown } | undefined)?.lan)
    res.status(r.status).json(r.body)
  })
}

/** The address of the WiFi (lan: of that cable adapter) fetched anew - for the app and the display (see server.ts) */
export async function renewDhcp(lan: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  // (an adapter of the system - also without an address, so not by os.networkInterfaces)
  const known = typeof lan === 'string' && /^(eth|en)[\w.-]{0,12}$/.test(lan) && (await fsp.stat(`/sys/class/net/${lan}`).catch(() => null))
  if (lan !== undefined && !known) return { status: 400, body: { error: 'invalid_interface' } }
  const iface = typeof lan === 'string' ? lan : await wifiIface()
  if (!/^[\w.-]{1,15}$/.test(iface)) return { status: 400, body: { error: 'invalid_interface' } }
  const pid = `/run/dhclient.${iface}.pid`
  if (!(await exists(pid))) return { status: 409, body: { error: 'no_dhcp' } }
  const files = `-pf ${pid} -lf /var/lib/dhcp/dhclient.${iface}.leases`
  detached(`sleep 1; sudo dhclient -4 -r -v ${files} ${iface}; sudo dhclient -4 -v -i ${files} -I -df /var/lib/dhcp/dhclient6.${iface}.leases ${iface}`)
  return { status: 200, body: { ok: true } }
}
