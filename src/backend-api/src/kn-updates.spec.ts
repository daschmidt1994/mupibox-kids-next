// KN: the app's update takes Kids Next's own versions only - never the original MuPiBox's
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it } from 'node:test'
import { channelOf, type Installed, type Release, RUN_SH, readInstalled, updateFor } from './eltern/updates'

const inst = (o: Partial<Installed>): Installed => ({ version: null, ref: null, commit: null, date: null, ...o })
const stable: Release = { version: '0.2.0', ref: 'v0.2.0', info: '' }
const dev: Release = { version: '0.2.17', ref: 'kids-next', info: '', commit: 'b'.repeat(40), date: '2026-10-28' }

describe('kn updates', () => {
  it('a box on the development branch follows its commits', () => {
    const box = inst({ version: '0.1.0', ref: 'kids-next', commit: 'a'.repeat(40) })
    assert.equal(channelOf(box), 'dev')
    assert.deepEqual(updateFor(box, { stable, dev }), { channel: 'dev', version: '0.2.17' })
    assert.equal(updateFor({ ...box, commit: 'b'.repeat(40) }, { stable, dev }), null)
  })

  it('a box on a release follows the releases by version', () => {
    const box = inst({ version: '0.1.0', ref: 'v0.1.0' })
    assert.equal(channelOf(box), 'stable')
    assert.deepEqual(updateFor(box, { stable, dev }), { channel: 'stable', version: '0.2.0' })
    assert.equal(updateFor({ ...box, version: '0.2.0' }, { stable, dev }), null)
    assert.equal(updateFor(box, { stable: null, dev }), null)
  })

  it('reads installed.json and survives a missing or broken one', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kn-upd-'))
    writeFileSync(
      join(dir, 'ok.json'),
      JSON.stringify({ version: '0.1.0', ref: 'kids-next', commit: 'c'.repeat(40), date: 'x' }),
    )
    writeFileSync(join(dir, 'bad.json'), '{')
    assert.equal((await readInstalled(join(dir, 'ok.json'))).ref, 'kids-next')
    assert.equal((await readInstalled(join(dir, 'bad.json'))).version, null)
    assert.equal((await readInstalled(join(dir, 'missing.json'))).version, null)
  })

  it('the update script is valid bash and loads nothing from the original MuPiBox', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kn-upd-'))
    writeFileSync(join(dir, 'run.sh'), RUN_SH)
    execFileSync('bash', ['-n', join(dir, 'run.sh')])
    assert.ok(!/splitti|mupibox\.de|start_mupibox_update/.test(RUN_SH))
    assert.ok(RUN_SH.includes('daschmidt1994/mupibox-kids-next'))
  })
})
