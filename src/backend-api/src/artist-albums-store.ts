// The albums of a Spotify artist, kept on the SD card (cache/artist-albums): for the display's artist entries and the
// Smart-Sync's artist subscriptions. A big artist has hundreds of albums - 30 pages of 10 for Spotify apps under its
// 2026 rules - and asking for all of them again and again ran those apps into blocks of many hours.
//
// Spotify lists an artist's albums newest first (checked with artists of 25, 177 and 294 albums). So once the whole
// list is kept, a check asks for the first page only: the albums not known yet are the new ones, and Spotify's total
// says whether that is all (else - an album removed, or one added with an older date - the whole list is asked again).
// A check at most every 6 hours, the whole list every 3 to 5 weeks (each artist on a day of its own: the lists the
// display asked for together all ran out in the same week and were asked whole one after the other - hundreds of
// requests for a big library; the check finds the new albums anyway). Written only when the list changed.
//
// KN: a whole list is no longer asked in one go (eight big artists opened in the app were well over 100 requests in a
// few minutes - Spotify blocked the box for 22 hours, 27.10.2026). The display and the app get the first page at once
// (the newest albums) and the others come page by page as background requests within the box's own limits
// (spotify-budget.ts) - what is loaded is kept, the next look carries on from there. The Smart-Sync waits for the whole
// list (it needs every album) and, held back by the limits, tries again at its next run with what is loaded so far.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { asBackground, currentSpotifyKind, type SpotifyRequestKind } from './spotify-budget'

export interface StoredAlbum {
  id?: string
  name?: string
  album_type?: string
  artists?: Array<{ id?: string; name?: string }>
  images?: Array<{ url?: string; width?: number | null; height?: number | null }>
  release_date?: string
}

export interface AlbumPage {
  items?: StoredAlbum[]
  total?: number
  next?: string | null
}

/** One page of the artist's albums from `offset` on (the caller picks how many per page), asked as `kind`. */
export type FetchAlbumPage = (offset: number, kind: SpotifyRequestKind) => Promise<AlbumPage>

const DIR = path.join(process.cwd(), 'cache', 'artist-albums')
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const FULL_EVERY_MS = 28 * 24 * 60 * 60 * 1000

// 0.75 to 1.25 times FULL_EVERY_MS, always the same for an artist (from its key)
function fullEvery(key: string): number {
  let h = 0
  for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return FULL_EVERY_MS * (0.75 + (h % 1000) / 2000)
}
const MAX_ALBUMS = 500
const PAGE_PAUSE_MS = 400

interface Kept {
  albums: StoredAlbum[]
  total: number
  /** when the whole list was asked (ms); 0: no whole list yet (only `progress`) */
  fullAt: number
  /** KN: a whole list being asked page by page: the pages so far, and the offset of the next one */
  progress?: { albums: StoredAlbum[]; total: number; next: number; startedAt: number }
}

// (a list begun longer ago starts over: Spotify's pages may have moved since)
const PROGRESS_MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000

const memory = new Map<string, Kept & { checkedAt: number }>()

/** Forgets the lists kept in memory (after "clear cache" removed their files). */
export function clearArtistAlbumsMemory(): void {
  memory.clear()
}
const running = new Map<string, Promise<StoredAlbum[]>>()

const keyOf = (artistId: string, groups: string) => `${artistId}_${groups}`.replace(/[^A-Za-z0-9_-]/g, '-')
const fileOf = (key: string) => path.join(DIR, `${key}.json`)

function read(key: string): (Kept & { checkedAt: number }) | undefined {
  const inMemory = memory.get(key)
  if (inMemory) return inMemory
  try {
    const kept = JSON.parse(fs.readFileSync(fileOf(key), 'utf8')) as Kept
    if (!Array.isArray(kept?.albums)) return undefined
    // (as if checked at some time in the last 6 hours: each artist's first check after a restart comes at a time of its
    // own - they were all asked in the first minute after every restart, and right after a block ended)
    const entry = { ...kept, checkedAt: Date.now() - Math.random() * CHECK_EVERY_MS }
    memory.set(key, entry)
    return entry
  } catch {
    return undefined
  }
}

function keep(key: string, kept: Kept, changed: boolean): void {
  memory.set(key, { ...kept, checkedAt: Date.now() })
  if (!changed) return
  try {
    fs.mkdirSync(DIR, { recursive: true })
    const tmp = `${fileOf(key)}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(kept))
    fs.renameSync(tmp, fileOf(key))
  } catch (err) {
    console.warn(`${new Date().toLocaleString()}: [artist-albums] could not keep ${key}: ${(err as Error).message}`)
  }
}

// only what the box uses (the list of a big artist stays small on the card)
const slim = (a: StoredAlbum): StoredAlbum => ({
  id: a.id,
  name: a.name,
  album_type: a.album_type,
  artists: (a.artists ?? []).map((x) => ({ id: x?.id, name: x?.name })),
  images: (a.images ?? []).map((i) => ({ url: i?.url, width: i?.width ?? null, height: i?.height ?? null })),
  release_date: a.release_date,
})

// the whole lists queue up: many pages of several artists at the same moment is what Spotify answers with a block
let queue: Promise<unknown> = Promise.resolve()
function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const next = queue.then(work, work)
  queue = next.catch(() => undefined)
  return next
}

// One page more of the whole list being asked: kept with its pages so far (on the card too). True when it is complete.
async function nextPage(key: string, fetchPage: FetchAlbumPage, kind: SpotifyRequestKind): Promise<boolean> {
  const kept: Kept = read(key) ?? { albums: [], total: 0, fullAt: 0 }
  const now = Date.now()
  const progress =
    kept.progress && now - kept.progress.startedAt < PROGRESS_MAX_AGE_MS
      ? kept.progress
      : { albums: [], total: 0, next: 0, startedAt: now }
  const page = await fetchPage(progress.next, kind)
  const items = page.items ?? []
  const seen = new Set(progress.albums.map((a) => a.id))
  const albums = [...progress.albums]
  for (const a of items) {
    if (a?.id && !seen.has(a.id)) {
      seen.add(a.id)
      albums.push(slim(a))
    }
  }
  const total = typeof page.total === 'number' ? page.total : progress.total
  // (Spotify's own paging decides - a page it shortened to fewer than asked for still has a next one)
  const done = !page.next || items.length === 0 || albums.length >= MAX_ALBUMS
  if (done) {
    keep(key, { albums, total: total || albums.length, fullAt: now }, true)
    console.log(`${new Date().toLocaleString()}: [artist-albums] ${key}: whole list asked, ${albums.length} albums`)
    return true
  }
  keep(
    key,
    {
      albums: kept.albums,
      total: kept.total,
      fullAt: kept.fullAt,
      progress: { albums, total, next: progress.next + items.length, startedAt: progress.startedAt },
    },
    true,
  )
  return false
}

// The rest of the whole list, page by page as background requests (one artist after the other, see oneAtATime) - done
// when another one completed it meanwhile.
function completeInTurn(key: string, fetchPage: FetchAlbumPage): Promise<void> {
  return oneAtATime(() =>
    asBackground(async () => {
      for (;;) {
        const kept = read(key)
        if (kept?.fullAt && !kept.progress && Date.now() - kept.fullAt < fullEvery(key)) return
        if (await nextPage(key, fetchPage, 'background')) return
        // (a pause between the pages; the gap of the limits comes on top)
        await new Promise((resolve) => setTimeout(resolve, PAGE_PAUSE_MS))
      }
    }),
  )
}

// the whole lists the display and the app wait for no longer (each once in the queue)
const completing = new Set<string>()
function completeLater(key: string, fetchPage: FetchAlbumPage): void {
  if (completing.has(key)) return
  completing.add(key)
  completeInTurn(key, fetchPage)
    // (the limits are reached, a block, no network: the next look at the artist carries on)
    .catch(() => undefined)
    .finally(() => completing.delete(key))
}

/** KN: how far the artist's list is when no whole list is kept yet (have of total) - undefined: it is complete. */
export function artistAlbumsProgress(artistId: string, groups: string): { have: number; total: number } | undefined {
  const kept = read(keyOf(artistId, groups))
  if (!kept || kept.fullAt) return undefined
  return { have: kept.progress?.albums.length ?? 0, total: kept.progress?.total ?? 0 }
}

/**
 * The artist's albums, newest first: kept, checked with one page, or asked whole (see above).
 * staleOnError: when Spotify cannot be asked (a block, no network), a kept list is handed out instead of the error -
 * the display goes on showing it; the sync wants the error (to stop and wait for a block).
 * partial (KN): the display and the app - a list not complete yet is handed out as far as it is (the newest albums),
 * the rest is asked in the background. Without it (the sync) the whole list is waited for.
 */
export async function artistAlbums(
  artistId: string,
  groups: string,
  fetchPage: FetchAlbumPage,
  opts: { staleOnError?: boolean; partial?: boolean } = {},
): Promise<StoredAlbum[]> {
  const key = keyOf(artistId, groups)
  const busy = running.get(key)
  if (busy) return busy
  const kind = currentSpotifyKind(opts.partial ? 'tap' : 'background')
  const work = (async () => {
    const kept = read(key)
    const now = Date.now()
    const complete = kept && kept.fullAt > 0
    const sofar = () => {
      const k = read(key)
      return k?.fullAt ? k.albums : (k?.progress?.albums ?? [])
    }
    if (complete && now - kept.checkedAt < CHECK_EVERY_MS && !kept.progress) return kept.albums
    try {
      if (complete && !kept.progress && now - kept.fullAt < fullEvery(key)) {
        const first = await fetchPage(0, kind)
        const known = new Set(kept.albums.map((a) => a.id))
        const fresh = (first.items ?? []).filter((a) => a?.id && !known.has(a.id)).map(slim)
        // (against Spotify's own count of last time, not the kept list's length: that one is shorter where Spotify counts
        // albums it does not list - or more than MAX_ALBUMS - and the whole list was asked again at every check)
        if (typeof first.total === 'number' && first.total === kept.total + fresh.length) {
          const albums = [...fresh, ...kept.albums]
          keep(key, { albums, total: first.total, fullAt: kept.fullAt }, fresh.length > 0)
          if (fresh.length)
            console.log(`${new Date().toLocaleString()}: [artist-albums] ${artistId}: ${fresh.length} new (1 request)`)
          return albums
        }
      }
      if (opts.partial) {
        // a kept whole list is shown meanwhile; else the first page right away (someone is waiting for it)
        if (!complete && !(kept?.progress && now - kept.progress.startedAt < PROGRESS_MAX_AGE_MS)) {
          if (await nextPage(key, fetchPage, kind)) return sofar()
        }
        completeLater(key, fetchPage)
        return sofar()
      }
      // the sync: page after page as background requests, carried on at its next run when the limits hold it back
      await completeInTurn(key, fetchPage)
      return sofar()
    } catch (err) {
      if (opts.staleOnError || opts.partial) {
        const list = sofar()
        if (list.length) return list
      }
      throw err
    }
  })()
  running.set(key, work)
  try {
    return await work
  } finally {
    running.delete(key)
  }
}
