// KN: Kids Next - Spotify Soloist's local control (its WebSocket API on 127.0.0.1, see kidsnext/soloist). Play, pause,
// skip and seek go to Soloist on the box itself - not through Spotify's Web API, whose requests a Spotify app of the box
// gets only about 100 a day of: Spotify blocked Julia's box for 14 hours on 30.10.2026, and then nothing played.
// The state (what plays, where) comes from Soloist's own messages, so the display's questions cost no requests either.
//
// Only while Soloist runs and is logged in (paired once in a Spotify app); otherwise the player uses the Web API as
// before. The shapes Soloist sends are mapped to the Web API's (the player and the display know those).

const fs = require('node:fs')
const os = require('node:os')
const { execFile } = require('node:child_process')

const DATA = '/var/lib/mupibox-kn/soloist'
// (the last state as Soloist sent it, for looking at on the box)
const DUMP = '/tmp/soloist-state.json'
const LOCAL_DEVICE_ID = 'soloist-local'

let ws = null
let connecting = false
let loggedIn = false
let deviceName = ''
let state = null // Soloist's playback_state, updated by its granular messages
let stateAt = 0
const waiters = new Set() // functions called with every message (results, track changes)
let log = console

function port() {
  try {
    const p = Number.parseInt(fs.readFileSync(`${DATA}/ws.port`, 'utf8'), 10)
    return p > 0 && p < 65536 ? p : null
  } catch {
    return null
  }
}

function connect() {
  if (ws || connecting) return
  const p = port()
  if (!p || typeof WebSocket !== 'function') return
  connecting = true
  let socket
  try {
    socket = new WebSocket(`ws://127.0.0.1:${p}`)
  } catch {
    connecting = false
    return
  }
  socket.onopen = () => {
    connecting = false
    ws = socket
    send({ command: 'get_auth_state' })
  }
  socket.onclose = () => {
    connecting = false
    if (ws === socket) ws = null
    loggedIn = false
  }
  socket.onerror = () => {
    // (onclose follows)
  }
  socket.onmessage = (e) => {
    let m
    try {
      m = JSON.parse(String(e.data))
    } catch {
      return
    }
    onMessage(m)
    for (const w of [...waiters]) w(m)
  }
}

function onMessage(m) {
  switch (m?.type) {
    case 'auth_state': {
      const was = loggedIn
      loggedIn = m.logged_in === true
      deviceName = m.device_name ?? deviceName
      if (loggedIn && !was) {
        log.info(`${new Date().toLocaleString()}: [Soloist] logged in - Spotify plays through Soloist's local control`)
        send({ command: 'get_state' })
        try {
          fs.writeFileSync(SEEN, '')
        } catch {}
        warmUp()
      }
      if (state) state.is_active = m.is_active
      break
    }
    case 'playback_state':
      // (an item already known keeps what a shorter message leaves out - seen: only uri and name after a pause)
      state = { ...m, item: sameItem(state?.item, m.item) }
      delete state.type
      stateAt = Date.now()
      try {
        fs.writeFileSync(DUMP, JSON.stringify(m, null, 1))
      } catch {}
      break
    case 'position_sync':
      if (state) state.position = m.position
      stateAt = Date.now()
      break
    case 'track_changed':
      if (state) state.item = sameItem(state.item, m.item)
      break
    case 'playback_changed':
      if (state) state.status = m.status
      break
    case 'volume_changed':
      if (state) state.volume = m.volume
      break
    case 'device_changed':
      if (state) state.is_active = m.is_active
      break
    case 'context_changed':
      if (state) state.context = m.context
      break
    case 'options_changed':
      if (state) state.options = m.options
      break
  }
}

// the new item, completed by the old one's details when it is the same (deeply: decorations, parent, playback)
function sameItem(old, item) {
  if (!old || !item || uriOf(old) !== uriOf(item)) return item
  const merge = (a, b) => {
    if (!a || typeof a !== 'object' || Array.isArray(a) || !b || typeof b !== 'object' || Array.isArray(b)) return b ?? a
    const out = { ...a }
    for (const k of Object.keys(b)) out[k] = merge(a[k], b[k])
    return out
  }
  return merge(old, item)
}

function send(cmd) {
  if (!ws || ws.readyState !== 1) return false
  ws.send(JSON.stringify({ type: 'command', ...cmd }))
  return true
}

// A command and its command_result (dispatched - not yet done); an error message rejects it.
function command(cmd, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const done = (fn, v) => {
      clearTimeout(timer)
      waiters.delete(w)
      fn(v)
    }
    const w = (m) => {
      if (m?.type === 'command_result' && m.command === cmd.command) done(resolve, m)
      else if (m?.type === 'error') done(reject, Object.assign(new Error(`Soloist: ${m.message}`), { soloist: true }))
    }
    const timer = setTimeout(() => done(reject, Object.assign(new Error(`Soloist: no answer to ${cmd.command}`), { soloist: true })), timeoutMs)
    waiters.add(w)
    if (!send(cmd)) done(reject, Object.assign(new Error('Soloist: not connected'), { soloist: true }))
  })
}

// waits for a message `match` accepts (a track change after a skip); resolves false after `ms`
function waitFor(match, ms) {
  return new Promise((resolve) => {
    const w = (m) => {
      if (!match(m)) return
      clearTimeout(timer)
      waiters.delete(w)
      resolve(true)
    }
    const timer = setTimeout(() => {
      waiters.delete(w)
      resolve(false)
    }, ms)
    waiters.add(w)
  })
}

const uriOf = (x) => (typeof x === 'string' ? x : (x?.uri ?? ''))
const kindOf = (uri) => String(uri).split(':')[1] ?? ''
const idOf = (uri) => String(uri).split(':')[2] ?? ''

// Soloist's entities (seen 30.10.2026): { uri, entity_type, decorations: { identity: { name }, visual_identity: { cover:
// [{ url, size }] }, parent: { entity }, creators: [{ entity }], playback: { duration_ms } } } - parent, creators and
// playback are read in decorations and, in case, next to it
const deco = (e, key) => e?.decorations?.[key] ?? e?.[key]
const nameOf = (e) => e?.decorations?.identity?.name ?? e?.name ?? ''
const SIZES = { xlarge: 640, large: 640, default: 300, small: 64 }
const imagesOf = (e) =>
  (e?.decorations?.visual_identity?.cover ?? e?.images ?? [])
    .filter((c) => c?.url)
    .map((c) => ({ url: c.url, height: c.height ?? SIZES[c.size] ?? 300, width: c.width ?? SIZES[c.size] ?? 300 }))
    .sort((x, y) => y.height - x.height)

/** Soloist's state in the Web API's shape (GET /me/player), or an empty object while nothing is known. */
function webState() {
  if (!state) return {}
  const raw = state.item
  let item = null
  if (raw) {
    const uri = uriOf(raw)
    const type = raw.entity_type ?? (kindOf(uri) || 'track')
    const parent = deco(raw, 'parent')?.entity ?? null
    const ctx = state.context?.uri === uriOf(parent) ? state.context : null
    const images = imagesOf(raw).length ? imagesOf(raw) : imagesOf(parent).length ? imagesOf(parent) : imagesOf(ctx)
    const artists = (deco(raw, 'creators') ?? []).map((c) => ({ id: idOf(uriOf(c.entity)), uri: uriOf(c.entity), name: nameOf(c.entity) }))
    const album = parent ? { id: idOf(uriOf(parent)), uri: uriOf(parent), name: nameOf(parent), images, artists } : { name: '', images, artists }
    item = {
      id: idOf(uri),
      uri,
      type,
      name: nameOf(raw),
      duration_ms: deco(raw, 'playback')?.duration_ms ?? raw.duration_ms ?? 0,
      artists,
      album,
      // (an episode's show, as the Web API names it)
      ...(type === 'episode' ? { show: { id: album.id, uri: album.uri, name: album.name, images } } : {}),
      images,
    }
  }
  const pos = state.position ?? {}
  const playing = state.status === 'playing'
  let progress = typeof pos.position_ms === 'number' ? pos.position_ms : 0
  if (playing && typeof pos.timestamp_ms === 'number') progress += Math.max(0, Date.now() - pos.timestamp_ms) * (pos.speed || 1)
  if (item?.duration_ms) progress = Math.min(progress, item.duration_ms)
  const ctxUri = uriOf(state.context)
  const o = state.options ?? {}
  const repeat = o.repeat === 'track' || o.repeat_track ? 'track' : o.repeat === 'context' || o.repeat_context ? 'context' : 'off'
  return {
    device: { id: LOCAL_DEVICE_ID, name: deviceName, is_active: state.is_active !== false, type: 'Speaker', volume_percent: state.volume },
    shuffle_state: o.shuffle === true,
    repeat_state: repeat,
    context: ctxUri ? { uri: ctxUri, type: state.context?.entity_type ?? kindOf(ctxUri) } : null,
    progress_ms: Math.round(progress),
    is_playing: playing,
    item,
    currently_playing_type: item?.type === 'episode' ? 'episode' : item ? 'track' : 'unknown',
  }
}

/** Soloist's state as the Web Playback SDK's getCurrentState() gives it (the display reads its progress there). */
function sdkState() {
  const w = webState()
  if (!w.item) return null
  const t = w.item
  return {
    paused: !w.is_playing,
    loading: false,
    position: w.progress_ms,
    duration: t.duration_ms,
    timestamp: Date.now(),
    shuffle: w.shuffle_state,
    repeat_mode: w.repeat_state === 'track' ? 2 : w.repeat_state === 'context' ? 1 : 0,
    context: { uri: w.context?.uri ?? null, metadata: {} },
    disallows: {},
    restrictions: {},
    track_window: {
      current_track: {
        id: t.id,
        uri: t.uri,
        type: t.type,
        media_type: 'audio',
        name: t.name,
        duration_ms: t.duration_ms,
        is_playable: true,
        album: { uri: t.album?.uri ?? '', name: t.album?.name ?? '', images: t.album?.images ?? [] },
        artists: (t.artists ?? []).map((a) => ({ uri: a.uri, name: a.name })),
      },
      previous_tracks: [],
      next_tracks: [],
    },
  }
}

/**
 * Starts what the Web API's play would (context_uri / uris, offset.position, position_ms) - or resumes without either.
 * Soloist's play takes no offset: the album is started and skipped forward to the track, then sought.
 */
// a track of its own in Soloist's message (an empty item: it took the album but resolved no track)
const hasTrack = (m) => (m?.type === 'track_changed' || m?.type === 'playback_state') && !!uriOf(m.item)

// Soloist restarted (sudo: the player runs as dietpi, who may), and logged in again (its stored session) - at most
// once in 2 minutes
let restartedAt = 0
async function restartSoloist() {
  if (Date.now() - restartedAt < 120000) return false
  restartedAt = Date.now()
  log.info(`${new Date().toLocaleString()}: [Soloist] took the album but started no track - restarted`)
  return restartAndWait()
}

async function restartAndWait() {
  await new Promise((resolve) => execFile('sudo', ['-n', 'systemctl', 'restart', 'mupi-kn-soloist'], { timeout: 30000 }, () => resolve()))
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 500))
    if (module.exports.ready()) return true
  }
  return false
}

// Soloist started with the box hung at its first play, every time (Julia's box: 75 s and 5 min after its login, the
// clock synchronised, PulseAudio long up) - and played at once after a restart, even when the play came only 95 s after
// it. So it is restarted once right after its first login when the box has just started; the display keeps its tiles
// grey meanwhile (warming(): the server's display-ready), so the first tap of a child plays at once (before: 6-10 s of
// silence until the restart in play). Not when a play has already restarted it.
let warmed = false
let warmingNow = false
let busy = 0
function warmUp() {
  if (warmed || os.uptime() > 600) return
  warmed = true
  if (busy || restartedAt || state?.status === 'playing' || state?.status === 'buffering') return
  warmingNow = true
  log.info(`${new Date().toLocaleString()}: [Soloist] restarted once after the box started (its first play hung)`)
  restartAndWait().finally(() => (warmingNow = false))
}
// (true while the box is young and the restart is still to come or running - only where Soloist has logged in before,
// SEEN; at most until 90 s after the start: a Soloist that does not log in does not keep the tiles grey)
const SEEN = '/home/dietpi/.mupibox/soloist-seen'
const warming = () => warmingNow || (!warmed && !restartedAt && os.uptime() <= 90 && fs.existsSync(SEEN))

async function play(options = {}, retried = false) {
  busy++
  try {
    return await playNow(options, retried)
  } finally {
    busy--
  }
}

async function playNow(options = {}, retried = false) {
  const uri = options.context_uri || options.uris?.[0]
  if (!uri) {
    await command({ command: 'play' })
    return { body: {} }
  }
  // (a track came 0.2 s after the play; a restart and its login take about 2 s - waiting 8 s made the children wait 10 s
  // for the first play after the box was switched on)
  const started = waitFor(hasTrack, 4000)
  await command({ command: 'play', uri })
  // (seen after a start of the box: Soloist logged in, took the album, said "playing" - and resolved no track, until it
  // was restarted; seen again with the clock synchronised, the first play 75 s after its login)
  if (!(await started)) {
    if (!retried && (await restartSoloist())) return playNow(options, true)
    throw Object.assign(new Error('Soloist started no track'), { soloist: true })
  }
  const skips = Math.max(0, Math.min(200, Number(options.offset?.position) || 0))
  for (let i = 0; i < skips; i++) {
    const changed = waitFor((m) => m?.type === 'track_changed', 3000)
    await command({ command: 'skip_next' })
    if (!(await changed)) break
  }
  if (options.position_ms > 0) await command({ command: 'seek', position_ms: Math.round(options.position_ms) })
  return { body: {} }
}

const api = {
  play,
  pause: () => command({ command: 'pause' }).then(() => ({ body: {} })),
  skipToNext: () => command({ command: 'skip_next' }).then(() => ({ body: {} })),
  skipToPrevious: () => command({ command: 'skip_prev' }).then(() => ({ body: {} })),
  seek: (ms) => command({ command: 'seek', position_ms: Math.max(0, Math.round(ms)) }).then(() => ({ body: {} })),
  setShuffle: (on) => command({ command: 'set_shuffle', enabled: !!on }).then(() => ({ body: {} })),
  getMyCurrentPlaybackState: async () => ({ body: webState() }),
}

module.exports = {
  LOCAL_DEVICE_ID,
  /** starts keeping the connection (every 5 s while it is down); `logger`: the player's log */
  start(logger) {
    if (logger) log = logger
    connect()
    setInterval(connect, 5000).unref()
  },
  /** connected and logged in: the player may use the local control */
  ready: () => !!ws && ws.readyState === 1 && loggedIn,
  warming,
  api,
  webState,
  sdkState,
  deviceName: () => deviceName,
  // (for trying the mapping with a recorded message)
  _message: onMessage,
}
