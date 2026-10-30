// KN: the check of the Soloist key in eltern/kn-soloist.ts (the same rule as valid_key in mupi-kn-soloist)
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { soloistKey } from './eltern/kn-soloist'

describe('kn-soloist soloistKey', () => {
  it('takes a key, spaces from copying removed', () => {
    assert.equal(soloistKey({ apiKey: ' abcDEF0123456789-_.xyz \n' }), 'abcDEF0123456789-_.xyz')
  })
  it('refuses what a shell or an EnvironmentFile would read', () => {
    for (const apiKey of ['', 'short', 'abcdefghijklmnop"x', 'abcdefghijklmnop$x', "abcdefghijklmnop'x", 'abcdefghijklmnop;x', 'abcdefghijklmnop\\x']) {
      assert.equal(soloistKey({ apiKey }), null, apiKey)
    }
    assert.equal(soloistKey(undefined), null)
  })
})
