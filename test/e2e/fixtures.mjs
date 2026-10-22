// HTTPS fixture sites for e2e tests. Chrome maps *.test to 127.0.0.1 via
// --host-resolver-rules; the certificate is a throwaway self-signed one.
//
//   https://a.test/a        first-party cookies (plain, httpOnly, session, partitioned) + iframe b.test
//   https://b.test/frame    third-party cookies: partitioned under a.test, and unpartitioned
//   https://www.a.test/www  host-only cookie + a Domain=a.test cookie
//   https://a.test/login    issues a session cookie `sid`;  /whoami  says whether it is valid
//   https://a.test/many     sets 45 cookies many_00..many_44 (value val_<n>) for search tests

import { createServer } from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';

export const CHROME_ARGS = ['--host-resolver-rules=MAP *.test 127.0.0.1', '--ignore-certificate-errors'];

export async function startFixtures() {
  const certDir = mkdtempSync(join(tmpdir(), 'cookiedesk-cert-'));
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=a.test',
    '-addext', 'subjectAltName=DNS:a.test,DNS:www.a.test,DNS:b.test,DNS:c.test',
    '-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem'),
  ], { stdio: 'ignore' });

  const sessions = new Set();
  let port;
  const server = createServer({
    key: readFileSync(join(certDir, 'key.pem')),
    cert: readFileSync(join(certDir, 'cert.pem')),
  }, (req, res) => {
    const host = req.headers.host.split(':')[0];
    const cookies = Object.fromEntries((req.headers.cookie ?? '').split(/;\s*/).filter(Boolean).map((p) => [p.slice(0, p.indexOf('=')), p.slice(p.indexOf('=') + 1)]));
    const route = `${host}${req.url}`;
    res.setHeader('Content-Type', 'text/html');
    if (route === 'a.test/a') {
      res.setHeader('Set-Cookie', [
        'a_plain=one; Secure; SameSite=Lax; Path=/; Max-Age=3600',
        'a_http=secret; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600',
        'a_session=s; Path=/',
        'a_part=p; Secure; SameSite=None; Partitioned; Path=/; Max-Age=3600',
      ]);
      res.end(`<!doctype html><title>a</title><iframe src="https://b.test:${port}/frame"></iframe>`);
    } else if (route === 'b.test/frame') {
      res.setHeader('Set-Cookie', [
        'b_part=p; Secure; SameSite=None; Partitioned; Path=/; Max-Age=3600',
        'b_3p=u; Secure; SameSite=None; Path=/; Max-Age=3600',
      ]);
      res.end('<!doctype html><title>frame</title>b');
    } else if (route === 'www.a.test/www') {
      res.setHeader('Set-Cookie', ['www_only=w; Secure; Path=/; Max-Age=3600', 'parent_dom=d; Domain=a.test; Secure; Path=/; Max-Age=3600']);
      res.end('<!doctype html><title>www</title>www');
    } else if (route === 'a.test/many') {
      res.setHeader('Set-Cookie', Array.from({ length: 45 }, (_, i) => `many_${String(i).padStart(2, '0')}=val_${i}; Secure; Path=/; Max-Age=3600`));
      res.end('<!doctype html><title>many</title>many');
    } else if (route === 'a.test/login') {
      const sid = randomBytes(16).toString('hex');
      sessions.add(sid);
      res.setHeader('Set-Cookie', [`sid=${sid}; HttpOnly; Secure; SameSite=Lax; Path=/`]);
      res.end('<!doctype html><title>login</title>logged in');
    } else if (route === 'a.test/whoami') {
      res.end(`<!doctype html><title>${sessions.has(cookies.sid) ? 'logged-in' : 'anonymous'}</title>`);
    } else {
      res.statusCode = 404;
      res.end();
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  return {
    port,
    url: (hostAndPath) => `https://${hostAndPath.replace('/', `:${port}/`)}`,
    close: () => { server.close(); rmSync(certDir, { recursive: true, force: true }); },
  };
}
