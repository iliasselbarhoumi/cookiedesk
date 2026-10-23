// "Explain this cookie" (P2-3): each attribute in plain English. PURE: no chrome.*,
// unit-tested. Read-only; it never changes anything.

import { domainMatchesSite } from './site.js';
import { utf8Bytes } from './validate.js';
import { t, uiLanguage } from '../lib/i18n.js';

function when(seconds, now) {
  const d = new Date(seconds * 1000);
  const days = (seconds - now / 1000) / 86400;
  const rtf = new Intl.RelativeTimeFormat(uiLanguage(), { numeric: 'always' });
  const rel = days < 0 ? t('when_passed') : days < 1 ? t('when_under_day') : days < 60 ? rtf.format(Math.floor(days), 'day') : days < 730 ? rtf.format(Math.round(days / 30), 'month') : rtf.format(Math.round(days / 365), 'year');
  return t('when', d.toLocaleString(uiLanguage()), rel);
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
    add('third-party', t(c.partitionKey?.topLevelSite ? 'explain_third_party_partitioned' : 'explain_third_party', bare, site));
  }
  // Chrome matches the prefixes case-insensitively (validate.js does too).
  if (/^__host-/i.test(c.name)) add('prefix', t('explain_host_prefix'));
  else if (/^__secure-/i.test(c.name)) add('prefix', t('explain_secure_prefix'));

  add('scope', c.hostOnly
    ? t('explain_scope_host', bare)
    : t('explain_scope_domain', bare));
  add('path', c.path === '/' ? t('explain_path_all') : t('explain_path_under', c.path));
  add('secure', c.secure
    ? t('explain_secure')
    : t('explain_not_secure'));
  add('httpOnly', c.httpOnly
    ? t('explain_httponly')
    : t('explain_script_readable'));
  add('sameSite', t({ no_restriction: 'explain_samesite_none', lax: 'explain_samesite_lax', strict: 'explain_samesite_strict' }[c.sameSite] ?? 'explain_samesite_unset'));

  if (c.session || c.expirationDate === undefined) {
    add('expiry', t('explain_session'));
  } else {
    add('expiry', t('explain_expires', when(c.expirationDate, now)));
  }

  const pk = c.partitionKey;
  if (pk?.topLevelSite) {
    const top = hostOf(pk.topLevelSite);
    const half = pk.hasCrossSiteAncestor === true ? t('explain_partition_cross') : pk.hasCrossSiteAncestor === false ? t('explain_partition_same') : '';
    add('partition', [t('explain_partition', top), half, t('explain_partition_other')].filter(Boolean).join(' '));
  }

  const jwt = jwtInfo(c.value);
  if (jwt) add('jwt', jwt.exp ? t('explain_jwt_exp', when(jwt.exp, now)) : t('explain_jwt'));
  add('size', t('explain_size', utf8Bytes(c.name) + utf8Bytes(c.value)));
  return out;
}
