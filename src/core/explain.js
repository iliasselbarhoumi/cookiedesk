// "Explain this cookie" (P2-3): each attribute in plain English. PURE: no chrome.*,
// unit-tested. Read-only; it never changes anything.

import { domainMatchesSite } from './site.js';
import { utf8Bytes } from './validate.js';

function when(seconds, now) {
  const d = new Date(seconds * 1000);
  const days = (seconds - now / 1000) / 86400;
  const rel = days < 0 ? 'already passed' : days < 1 ? 'in less than a day' : days < 60 ? `in ${Math.floor(days)} day${Math.floor(days) === 1 ? '' : 's'}` : days < 730 ? `in about ${Math.round(days / 30)} months` : `in about ${Math.round(days / 365)} years`;
  return `${d.toLocaleString()} (${rel})`;
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return url; }
}

/** If the value looks like a JSON Web Token, its decoded `exp` (seconds), or true without one. */
export function jwtInfo(value) {
  const m = /^([A-Za-z0-9_-]{8,})\.([A-Za-z0-9_-]{8,})\.[A-Za-z0-9_-]*$/.exec(String(value ?? ''));
  if (!m) return null;
  const decode = (s) => JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), (ch) => ch.charCodeAt(0))));
  try {
    const head = decode(m[1]);
    if (typeof head?.alg !== 'string') return null;
    const body = decode(m[2]);
    // A sane epoch-seconds value only (year 2001..5000); anything else is not worth showing.
    return { exp: Number.isFinite(body?.exp) && body.exp > 1e9 && body.exp < 95e9 ? body.exp : null };
  } catch {
    return null;
  }
}

/**
 * Plain-English notes on a cookie, in reading order: [{ topic, text }].
 * `site`: the site being viewed (for third-party wording). `now` in ms.
 */
export function explainCookie(c, { site, now = Date.now() } = {}) {
  const out = [];
  const add = (topic, text) => out.push({ topic, text });
  const bare = String(c.domain).replace(/^\./, '');

  if (site && !domainMatchesSite(bare, site)) {
    add('third-party', `Set by ${bare}, a different site from ${site}: a third-party cookie${c.partitionKey?.topLevelSite ? `, kept in ${site}'s partition` : ''}.`);
  }
  // Chrome matches the prefixes case-insensitively (validate.js does too).
  if (/^__host-/i.test(c.name)) add('prefix', 'The __Host- prefix makes Chrome insist on Secure, no Domain attribute and Path=/, so no subdomain can set or replace it.');
  else if (/^__secure-/i.test(c.name)) add('prefix', 'The __Secure- prefix makes Chrome accept it only with the Secure flag.');

  add('scope', c.hostOnly
    ? `Sent only to ${bare} itself, not to its subdomains.`
    : `Sent to ${bare} and every subdomain of it (such as www.${bare}).`);
  add('path', c.path === '/' ? 'Sent with requests for every path on that host.' : `Sent only with requests for paths under ${c.path}.`);
  add('secure', c.secure
    ? 'Secure: only sent over HTTPS.'
    : 'Not Secure: also sent over plain HTTP, where anyone on the network can read it.');
  add('httpOnly', c.httpOnly
    ? 'HttpOnly: not visible to page JavaScript (document.cookie can\'t read it), which keeps it away from injected scripts.'
    : 'Readable and changeable by any script running on the page.');
  add('sameSite', {
    no_restriction: 'SameSite=None: may also be sent with cross-site requests (embedded frames, images, requests from other sites), where Chrome allows third-party cookies at all (incognito blocks them by default). That is why it must be Secure.',
    lax: 'SameSite=Lax: sent when you navigate to the site, including from a link on another site, but not with requests other sites\' pages make in the background.',
    strict: 'SameSite=Strict: only sent when you are already on the same site. Arriving from a link on another site, the first request goes without it.',
  }[c.sameSite] ?? 'No SameSite attribute: Chrome treats it as Lax.');

  if (c.session || c.expirationDate === undefined) {
    add('expiry', 'A session cookie: deleted when the browser closes (unless Chrome restores your previous session on startup).');
  } else {
    add('expiry', `Expires ${when(c.expirationDate, now)}. Chrome caps any expiry at 400 days from when the cookie was last set.`);
  }

  const pk = c.partitionKey;
  if (pk?.topLevelSite) {
    const top = hostOf(pk.topLevelSite);
    const half = pk.hasCrossSiteAncestor === true ? ' It is in the cross-site part of that partition (used where another site sits between the page and this cookie\'s site), kept apart from the same-site part.' : pk.hasCrossSiteAncestor === false ? ' It is in the same-site part of that partition, kept apart from the cross-site part.' : '';
    add('partition', `Partitioned (CHIPS): stored separately for each top-level site. This copy is only sent while ${top} is the site in the address bar.${half} The same cookie name under another site is a different cookie.`);
  }

  const jwt = jwtInfo(c.value);
  if (jwt) add('jwt', `The value looks like a JSON Web Token${jwt.exp ? `; the token itself says it expires ${when(jwt.exp, now)}` : ''}.`);
  add('size', `${utf8Bytes(c.name) + utf8Bytes(c.value)} of the 4096 bytes Chrome allows for name and value together.`);
  return out;
}
