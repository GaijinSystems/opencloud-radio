// Part of deploy/relay-test: see run.sh.
// A stand-in for a station's http origin that misbehaves on purpose, one way
// per port, and tells the client which request headers reached it.
import { createServer } from 'node:http'
const seen = (req) => JSON.stringify({ cookie: req.headers.cookie ?? null, authorization: req.headers.authorization ?? null, referer: req.headers.referer ?? null, icy: req.headers['icy-metadata'] ?? null, host: req.headers.host ?? null, xff: req.headers['x-forwarded-for'] ?? null, forwarded: req.headers.forwarded ?? null, origin: req.headers.origin ?? null, realIp: req.headers['x-real-ip'] ?? null, xfh: req.headers['x-forwarded-host'] ?? null, xfp: req.headers['x-forwarded-proto'] ?? null, more: ['x-forwarded-server', 'x-forwarded-port', 'x-forwarded-ssl', 'via', 'true-client-ip', 'cf-connecting-ip', 'x-client-ip', 'x-cluster-client-ip', 'client-ip', 'fastly-client-ip', 'x-original-forwarded-for'].filter((h) => h in req.headers) })
const behave = {
  8001: (req, res) => { // a real stream, with every whole-site header a hostile origin might add
    // Asked for titles (Icy-MetaData: 1), it weaves one in after 1024 bytes, as Icecast does.
    if (req.headers['icy-metadata'] === '1') {
      const text = Buffer.from("StreamTitle='Artist - Title';")
      const block = Buffer.alloc(1 + Math.ceil(text.length / 16) * 16); block[0] = Math.ceil(text.length / 16); text.copy(block, 1)
      res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'icy-metaint': '1024', 'X-Seen': seen(req) })
      res.end(Buffer.concat([Buffer.alloc(1024, 0xff), block, Buffer.alloc(1024, 0xff)]))
      return
    }
    res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'X-Seen': seen(req), 'Set-Cookie': 'session=stolen; Path=/',
      'Clear-Site-Data': '"*"', 'Strict-Transport-Security': 'max-age=0', NEL: '{"report_to":"x","max_age":1}',
      'Report-To': '{"group":"x","max_age":1,"endpoints":[{"url":"https://evil.example/r"}]}',
      'Reporting-Endpoints': 'x="https://evil.example/r"', Refresh: '0; url=https://evil.example/',
      'Alt-Svc': 'h3=":8443"; ma=86400', Link: '<https://evil.example/x.css>; rel=stylesheet',
      'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Expose-Headers': '*',
      'Cache-Control': 'public, max-age=31536000', 'Accept-CH': 'Sec-CH-UA-Model', 'Set-Login': 'logged-in' })
    res.end(Buffer.alloc(4096, 0xff))
  },
  8002: (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<script>alert(document.cookie)</script>') },
  8003: (req, res) => { res.writeHead(200, [['Content-Type', 'audio/mpeg'], ['Content-Type', 'text/html']]); res.end('<script>alert(1)</script>') },
  8004: (req, res) => { res.writeHead(302, { 'Content-Type': 'audio/mpeg', Location: 'https://evil.example/' }); res.end() },
  8005: (req, res) => { res.writeHead(200, { 'Content-Type': 'audio/mpeg, text/html' }); res.end('<script>alert(1)</script>') },
  8006: (req, res) => { res.writeHead(200, { 'Content-Type': 'audio/x text/html' }); res.end('<script>alert(1)</script>') },
  // An interim answer first, with headers that would act on the whole host, then a clean stream.
  8007: (req, res) => {
    res.writeEarlyHints({ link: '<https://evil.example/x.js>; rel=preload; as=script', 'set-cookie': 'early=1; Path=/', 'clear-site-data': '"*"' })
    res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); res.end(Buffer.alloc(1024, 0xff))
  }
}
for (const port of Object.keys(behave)) createServer(behave[port]).listen(Number(port))
console.log('origin up')
