// KN: the checks of eltern/kn-netbird.ts and the NetBird addresses in the local-network gate
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { upArgs } from './eltern/kn-netbird'
import { isPrivateIp } from './eltern/middleware'

describe('kn-netbird upArgs', () => {
  it('the setup key goes to stdin, never into the arguments', () => {
    const r = upArgs({
      url: 'https://netbird.example.com',
      setupKey: ' ABCD1234-1111-2222-3333-444455556666 ',
      hostname: 'mupibox-jakob',
    })
    assert.ok('args' in r)
    assert.ok(!r.args.join(' ').includes('ABCD1234'))
    assert.deepEqual(r.input, ['ABCD1234-1111-2222-3333-444455556666'])
    assert.deepEqual(r.args.slice(1), [
      'up',
      '--url',
      'https://netbird.example.com',
      '--json',
      '--hostname',
      'mupibox-jakob',
      '--key-stdin',
    ])
  })

  it('without a key: connect again, nothing on stdin', () => {
    const r = upArgs({ url: 'https://netbird.example.com' })
    assert.ok('args' in r && !r.args.includes('--key-stdin') && r.input.length === 0)
  })

  it('refuses what is not allowed', () => {
    assert.deepEqual(upArgs({ url: 'https://x.example.com;reboot' }), { field: 'url' })
    assert.deepEqual(upArgs({ url: '--setup-key=x' }), { field: 'url' })
    assert.deepEqual(upArgs({ url: 'https://a.example.com', hostname: '-n x' }), { field: 'hostname' })
    assert.deepEqual(upArgs({ url: 'https://a.example.com', setupKey: '$(reboot)' }), { field: 'setupKey' })
  })
})

describe('local network gate', () => {
  it('lets NetBird (100.64.0.0/10) in, not other 100.x addresses', () => {
    assert.equal(isPrivateIp('100.112.188.124'), true)
    assert.equal(isPrivateIp('::ffff:100.64.0.1'), true)
    assert.equal(isPrivateIp('100.127.255.255'), true)
    assert.equal(isPrivateIp('100.63.0.1'), false)
    assert.equal(isPrivateIp('100.128.0.1'), false)
    assert.equal(isPrivateIp('8.8.8.8'), false)
  })
})
