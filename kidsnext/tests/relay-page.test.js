// The relay page for the Spotify login (kidsnext/relay/callback): which box addresses it forwards to, asks for, refuses;
// and that its Content-Security-Policy still names the hash of its script (else the browser would not run it).
const fs = require('fs')
const html = fs.readFileSync(process.argv[2], 'utf8')
const js = html.match(/<script>([\s\S]*?)<\/script>/)[1]
const hash = require('crypto').createHash('sha256').update(js).digest('base64')
if (!html.includes(`'sha256-${hash}'`)) {
  console.log('BAD CSP hash: run with --fix-hash')
  if (process.argv[3] === '--fix-hash') fs.writeFileSync(process.argv[2], html.replace(/'sha256-[^']+'/, `'sha256-${hash}'`))
  process.exit(1)
}
const b64u = (s) => Buffer.from(s).toString('base64url')
function run(search) {
  const els = {}
  const el = (id) => (els[id] ??= { id, textContent: '', children: [], appendChild(c) { this.children.push(c) } })
  let replaced = null
  const location = { search, replace: (u) => (replaced = u) }
  const document = { getElementById: el, createElement: (t) => ({ tag: t, textContent: '' }) }
  new Function('location', 'document', js)(location, document)
  return { replaced, title: el('title').textContent, link: el('target').children.find((c) => c.tag === 'a')?.href }
}
const q = (origin, extra = '&code=abc') => `?state=${'f'.repeat(48)}~${b64u(origin)}${extra}`
const cases = [
  ['http://192.168.178.10', 'replace'],
  ['https://100.112.5.6', 'replace'],
  ['http://mupibox-jakob', 'replace'],
  ['http://mupibox-jakob.netbird.selfhosted', 'replace'],
  ['https://evil.example.com', 'ask'],
  ['https://192.168.178.10/x', 'fail'],
  ['javascript:alert(1)', 'fail'],
  ['http://user:pw@10.0.0.1', 'fail'],
  ['http://8.8.8.8', 'ask'],
]
let bad = 0
for (const [o, want] of cases) {
  const r = run(q(o))
  const got = r.replaced ? 'replace' : r.link ? 'ask' : 'fail'
  if (got !== want) bad++
  console.log(got === want ? 'ok ' : 'BAD', o, got, r.replaced ?? r.link ?? r.title)
}
const r = run('?code=x&state=nostate')
if (r.replaced) bad++
console.log(r.replaced ? 'BAD' : 'ok ', 'no ~ -> fail')
process.exit(bad)
