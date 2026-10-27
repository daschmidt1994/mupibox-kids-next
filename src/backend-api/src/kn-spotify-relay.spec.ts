// KN: the Spotify login through the relay page - one Redirect URI, the box's address in the state
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { boxOrigin, buildAuthorizeUrl, buildRedirectUri, redirectModeOf, SPOTIFY_RELAY_URI } from './eltern/oauth'

const cfg = (spotify: Record<string, unknown>) => ({ spotify }) as never

describe('kn spotify relay', () => {
  it('a new setup takes the relay; a chosen mode stays', () => {
    assert.equal(redirectModeOf(cfg({})), 'relay')
    assert.equal(redirectModeOf(cfg({ redirect: 'app' })), 'app')
    assert.equal(redirectModeOf(cfg({ redirect: 'relay' })), 'relay')
    assert.equal(buildRedirectUri('https', '192.168.178.10', 'relay'), SPOTIFY_RELAY_URI)
    assert.equal(buildRedirectUri('https', '192.168.178.10', 'app'), 'https://192.168.178.10/app/spotify-callback')
  })

  it('the state carries the address the browser shows, the Redirect URI is the relay', () => {
    const r = buildAuthorizeUrl({
      getMupiboxConfig: () => cfg({ clientId: 'abc' }),
      sessionId: 's',
      host: '100.112.5.6',
      protocol: 'https',
      origin: 'http://100.112.5.6',
    })
    assert.ok(!('error' in r))
    assert.equal(r.redirectUri, SPOTIFY_RELAY_URI)
    const [, b64] = r.state.split('~')
    assert.equal(Buffer.from(b64, 'base64url').toString(), 'http://100.112.5.6')
    assert.equal(new URL(r.url).searchParams.get('redirect_uri'), SPOTIFY_RELAY_URI)
  })

  it('an address of another machine is not taken', () => {
    assert.equal(boxOrigin('http://evil.example.com', '192.168.178.10'), null)
    assert.equal(boxOrigin('http://192.168.178.10/x', '192.168.178.10'), null)
    assert.equal(boxOrigin('javascript:alert(1)', '192.168.178.10'), null)
    assert.equal(boxOrigin('http://192.168.178.10:8200', '192.168.178.10'), 'http://192.168.178.10:8200')
    const r = buildAuthorizeUrl({
      getMupiboxConfig: () => cfg({ clientId: 'abc' }),
      sessionId: 's',
      host: 'mupibox-jakob',
      protocol: 'https',
      origin: 'http://evil.example.com',
    })
    assert.ok(!('error' in r))
    assert.equal(Buffer.from(r.state.split('~')[1], 'base64url').toString(), 'https://mupibox-jakob')
  })
})
