// KN: the box's own limits for Spotify requests (spotify-budget.ts) and the artists' album lists asked page by page
// within them (artist-albums-store.ts)
import assert from 'node:assert/strict'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { after, before, beforeEach, describe, it } from 'node:test'

// (both keep their files under cache/ of the working directory, read when they are loaded)
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-spotify-budget-'))
const cwd = process.cwd()
process.chdir(dir)
process.env.KN_SPOTIFY_BUDGET = 'on'

type Budget = typeof import('./spotify-budget')
type Store = typeof import('./artist-albums-store')
type Block = typeof import('./spotify-block')
let budget: Budget
let store: Store
let block: Block

before(async () => {
  budget = await import('./spotify-budget')
  store = await import('./artist-albums-store')
  block = await import('./spotify-block')
})
after(() => {
  process.chdir(cwd)
  fs.rmSync(dir, { recursive: true, force: true })
})
beforeEach(() => {
  block.clearSpotifyBlock('test')
  fs.rmSync(path.join(dir, 'cache'), { recursive: true, force: true })
  budget.resetSpotifyBudgetMemory()
  store.clearArtistAlbumsMemory()
})

describe('spotify-budget', () => {
  it('limits are kept within their range', () => {
    assert.deepEqual(budget.normalizeLimits({ window: 0, hour: 'x', day: 99999, gapSeconds: 2.4 }), {
      window: 3,
      hour: budget.DEFAULT_SPOTIFY_LIMITS.hour,
      day: 5000,
      gapSeconds: 2,
    })
  })

  it('taps up to the 30-second limit, then held back without waiting', async () => {
    budget.setSpotifyLimits({ window: 3, hour: 100, day: 100 })
    for (let i = 0; i < 3; i++) await budget.takeSpotifyRequest('tap', 'test', 0)
    await assert.rejects(
      budget.takeSpotifyRequest('tap', 'test', 0),
      (e: unknown) => e instanceof budget.SpotifyBudgetError && e.retryAfterSeconds <= 30,
    )
    assert.equal(budget.spotifyBudgetView().used.window, 3)
  })

  it('the background uses only half of a limit and keeps its gap', async () => {
    budget.setSpotifyLimits({ window: 4, hour: 200, day: 500, gapSeconds: 1 })
    await budget.takeSpotifyRequest('background', 'test', 0)
    // (the gap)
    await assert.rejects(budget.takeSpotifyRequest('background', 'test', 0), budget.SpotifyBudgetError)
    await budget.takeSpotifyRequest('background', 'test', 1500)
    // (half of the 30 seconds used up by the background: taps still go)
    await assert.rejects(budget.takeSpotifyRequest('background', 'test', 1500), /in 30 s/)
    await budget.takeSpotifyRequest('tap', 'test', 0)
    await budget.takeSpotifyRequest('tap', 'test', 0)
    await assert.rejects(budget.takeSpotifyRequest('tap', 'test', 0), /in 30 s/)
  })

  it('nothing is taken during a block by Spotify', async () => {
    block.noteSpotifyBlock(Date.now() + 60_000, 'display', '429 test')
    await assert.rejects(budget.takeSpotifyRequest('tap', 'test', 0), /Spotify blocks/)
  })

  it('a block by Spotify lowers the limits below what led to it', async () => {
    budget.setSpotifyLimits({ window: 20, hour: 100, day: 500 })
    for (let i = 0; i < 10; i++) await budget.takeSpotifyRequest('tap', 'test', 0)
    block.noteSpotifyBlock(Date.now() + 60_000, 'display', '429 test')
    const v = budget.spotifyBudgetView()
    assert.deepEqual([v.limits.window, v.limits.hour, v.limits.day], [8, 20, 50])
    assert.equal(v.lastLockout?.hour, 10)
    // (kept on the SD card)
    budget.resetSpotifyBudgetMemory()
    assert.equal(budget.spotifyBudgetView().limits.window, 8)
  })

  it('the counts outlast a restart of the server', async () => {
    await budget.takeSpotifyRequest('tap', 'test', 0)
    await budget.takeSpotifyRequest('tap', 'test', 0)
    await new Promise((resolve) => setTimeout(resolve, 10_500))
    budget.resetSpotifyBudgetMemory()
    assert.equal(budget.spotifyBudgetView().used.hour, 2)
  })

  it('asBackground marks the requests made inside', async () => {
    assert.equal(budget.currentSpotifyKind(), 'tap')
    assert.equal(await budget.asBackground(async () => budget.currentSpotifyKind()), 'background')
  })
})

describe('artist albums page by page', () => {
  const ARTIST = '0jRC2uXx4hEpqNrBDJdY7l'
  // an artist with 35 albums, 10 per page, newest first
  const all = Array.from({ length: 35 }, (_, i) => ({ id: `a${35 - i}`, name: `Folge ${35 - i}` }))
  function pages(asked: Array<[number, string]>): import('./artist-albums-store').FetchAlbumPage {
    return async (offset, kind) => {
      await budget.takeSpotifyRequest(kind, 'test')
      asked.push([offset, kind])
      const items = all.slice(offset, offset + 10)
      return { items, total: all.length, next: offset + 10 < all.length ? 'more' : null }
    }
  }

  it('the display gets the first page at once, the rest follows in the background', async () => {
    budget.setSpotifyLimits({ window: 60, hour: 200, day: 500, gapSeconds: 1 })
    const asked: Array<[number, string]> = []
    const first = await store.artistAlbums(ARTIST, 'album', pages(asked), { staleOnError: true, partial: true })
    assert.equal(first.length, 10)
    assert.deepEqual(asked[0], [0, 'tap'])
    assert.deepEqual(store.artistAlbumsProgress(ARTIST, 'album'), { have: 10, total: 35 })
    // (the other three pages as background requests, a gap apart)
    for (let i = 0; i < 100 && store.artistAlbumsProgress(ARTIST, 'album'); i++)
      await new Promise((r) => setTimeout(r, 100))
    assert.equal(store.artistAlbumsProgress(ARTIST, 'album'), undefined)
    assert.deepEqual(
      asked.map(([o, k]) => `${o}:${k}`),
      ['0:tap', '10:background', '20:background', '30:background'],
    )
    const whole = await store.artistAlbums(ARTIST, 'album', pages(asked), { staleOnError: true, partial: true })
    assert.equal(whole.length, 35)
    // (kept: not asked again)
    assert.equal(asked.length, 4)
  })

  it('held back by the limits: what is loaded is kept, the next look carries on', async () => {
    // (the background may take 1 request in 30 s: half of 3)
    budget.setSpotifyLimits({ window: 3, hour: 200, day: 500, gapSeconds: 1 })
    const asked: Array<[number, string]> = []
    await store.artistAlbums(ARTIST, 'album', pages(asked), { staleOnError: true, partial: true })
    for (let i = 0; i < 40 && asked.length < 2; i++) await new Promise((r) => setTimeout(r, 100))
    await new Promise((r) => setTimeout(r, 1500))
    assert.deepEqual(store.artistAlbumsProgress(ARTIST, 'album'), { have: 20, total: 35 })
    // (after a restart of the server too)
    store.clearArtistAlbumsMemory()
    budget.setSpotifyLimits({ window: 60 })
    const again = await store.artistAlbums(ARTIST, 'album', pages(asked), { staleOnError: true, partial: true })
    assert.equal(again.length, 20)
    for (let i = 0; i < 100 && store.artistAlbumsProgress(ARTIST, 'album'); i++)
      await new Promise((r) => setTimeout(r, 100))
    assert.deepEqual(
      asked.map(([o]) => o),
      [0, 10, 20, 30],
    )
  })

  it('the sync waits for the whole list - and fails when the limits hold it back', async () => {
    budget.setSpotifyLimits({ window: 60, hour: 200, day: 500, gapSeconds: 1 })
    const asked: Array<[number, string]> = []
    const whole = await store.artistAlbums(ARTIST, 'album', pages(asked))
    assert.equal(whole.length, 35)
    assert.ok(asked.every(([, k]) => k === 'background'))

    store.clearArtistAlbumsMemory()
    fs.rmSync(path.join(dir, 'cache', 'artist-albums'), { recursive: true, force: true })
    budget.setSpotifyLimits({ window: 3 })
    await assert.rejects(store.artistAlbums(ARTIST, 'album', pages([])), budget.SpotifyBudgetError)
  })
})
