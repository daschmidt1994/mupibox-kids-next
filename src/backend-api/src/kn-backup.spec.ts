// KN: the checks of eltern/kn-backup.ts - nothing the app sends reaches the root tools unchecked
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { nasArgs } from './eltern/kn-backup'

describe('kn-backup nasArgs', () => {
  it('NFS: arguments in order, nothing on stdin', () => {
    const r = nasArgs({ type: 'nfs', host: '192.168.178.20', share: '/mnt/user/backups' })
    assert.deepEqual(r, { args: ['--type', 'nfs', '--host', '192.168.178.20', '--share', '/mnt/user/backups', '--dir', 'mupibox-backups'], input: [] })
  })

  it('SMB: the password goes to stdin, never into the arguments', () => {
    const r = nasArgs({ type: 'smb', host: 'tower', share: 'backups', user: 'mupi', password: 'ge heim;$(rm -rf /)' })
    assert.ok('args' in r)
    assert.ok(!r.args.join(' ').includes('heim'))
    assert.deepEqual(r.input, ['ge heim;$(rm -rf /)'])
    assert.ok(r.args.includes('--password-stdin'))
  })

  it('SMB without password when changing: the saved one stays (no --password-stdin)', () => {
    const r = nasArgs({ type: 'smb', host: 'tower', share: 'backups', user: 'mupi', password: '' })
    assert.ok('args' in r && !r.args.includes('--password-stdin'))
  })

  it('refuses what is not allowed', () => {
    const bad: Array<[Record<string, unknown>, string]> = [
      [{ type: 'ftp', host: 'a', share: 's' }, 'type'],
      [{ type: 'nfs', host: '-oProxyCommand=x', share: '/s' }, 'host'],
      [{ type: 'nfs', host: 'nas', share: '/mnt/../etc' }, 'share'],
      [{ type: 'nfs', host: 'nas', share: '/mnt/user/b;reboot' }, 'share'],
      [{ type: 'nfs', host: 'nas', share: '/s', dir: '../x' }, 'dir'],
      [{ type: 'smb', host: 'nas', share: 's', user: 'a b', password: 'x' }, 'user'],
      [{ type: 'smb', host: 'nas', share: 's', user: 'a', password: 'x\ny' }, 'password'],
    ]
    for (const [body, field] of bad) assert.deepEqual(nasArgs(body), { field }, JSON.stringify(body))
  })
})
