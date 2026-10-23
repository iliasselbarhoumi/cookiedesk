// Pure import/export. Import input is untrusted: fields are copied by explicit
// name into fresh objects, nothing is merged or spread from parsed data, and
// error messages may name the cookie but never echo its value.
import { validateCookie, utf8Bytes } from './validate.js';
import { t } from '../lib/i18n.js';

export const EXPORT_WARNING = 'This file contains live session cookies. Anyone who has it can sign in as you on these sites. Treat it like a password and delete it when done.';

const DEFAULT_MAX_BYTES = 5_000_000;
const DEFAULT_MAX_COOKIES = 5000;

function exportCookie(c) {
  const out = {
    name: c.name, value: c.value, domain: c.domain, hostOnly: c.hostOnly, path: c.path,
    secure: c.secure, httpOnly: c.httpOnly, sameSite: c.sameSite, session: c.session,
  };
  if (!c.session && c.expirationDate !== undefined) out.expirationDate = c.expirationDate;
  if (c.partitionKey) {
    out.partitionKey = { topLevelSite: c.partitionKey.topLevelSite };
    if (c.partitionKey.hasCrossSiteAncestor !== undefined) {
      out.partitionKey.hasCrossSiteAncestor = c.partitionKey.hasCrossSiteAncestor;
    }
  }
  return out;
}

/** `setName` marks the file as a named cookie set (P1-3); it is otherwise a plain export. */
export function exportJson(cookies, { site, storeId, now, setName } = {}) {
  return JSON.stringify({
    format: 'cookiedesk',
    version: 1,
    exportedAt: new Date(now ?? Date.now()).toISOString(),
    site,
    storeId,
    ...(setName ? { set: setName } : {}),
    warning: EXPORT_WARNING,
    cookies: cookies.map(exportCookie),
  }, null, 2);
}

// Netscape has no SameSite or partition columns, so partitioned cookies are
// left out (writing them unpartitioned would change what they mean).
export function exportNetscape(cookies) {
  const lines = ['# Netscape HTTP Cookie File', '# Exported by CookieDesk. Contains live session cookies; treat like a password.'];
  let skipped = 0;
  for (const c of cookies) {
    if (c.partitionKey) { skipped++; continue; }
    const domain = (c.httpOnly ? '#HttpOnly_' : '') + c.domain;
    const expiry = c.session || c.expirationDate === undefined ? 0 : Math.floor(c.expirationDate);
    lines.push([domain, c.hostOnly ? 'FALSE' : 'TRUE', c.path, c.secure ? 'TRUE' : 'FALSE', expiry, c.name, c.value].join('\t'));
  }
  if (skipped) lines.splice(2, 0, `# ${skipped} partitioned cookie(s) were not exported: this format cannot represent them.`);
  return lines.join('\n') + '\n';
}

const SNIPPET_SAME_SITE = { no_restriction: 'None', lax: 'Lax', strict: 'Strict' };

// A JS string literal. JSON.stringify leaves U+2028/U+2029 raw: legal in strings
// since ES2019, but they end a // comment, so escape them wherever text goes.
const jsString = (s) => JSON.stringify(String(s)).replace(/[\u2028\u2029]/g, (c) => `\\u${c.charCodeAt(0).toString(16)}`);

/**
 * A document.cookie snippet to paste into the DevTools console on the site.
 * HttpOnly cookies can't be set from JavaScript, so they are left out and named
 * in a comment (names only). Returns { text, skipped: names[] }.
 */
export function exportDocumentCookie(cookies, { site } = {}) {
  const lines = [
    `// document.cookie snippet${site ? ` for ${site}` : ''}, made by CookieDesk. Run it in the DevTools console on that site.`,
    '// It contains live cookie values: treat it like a password.',
  ];
  const skipped = [];
  for (const c of cookies) {
    if (c.httpOnly) { skipped.push(c.name); continue; }
    const attrs = [`${c.name}=${c.value}`, `Path=${c.path}`];
    if (!c.hostOnly) attrs.push(`Domain=${c.domain.replace(/^\./, '')}`);
    if (!c.session && c.expirationDate !== undefined) attrs.push(`Expires=${new Date(c.expirationDate * 1000).toUTCString()}`);
    if (c.secure) attrs.push('Secure');
    if (SNIPPET_SAME_SITE[c.sameSite]) attrs.push(`SameSite=${SNIPPET_SAME_SITE[c.sameSite]}`);
    if (c.partitionKey?.topLevelSite) attrs.push('Partitioned');
    // JSON string syntax is valid JavaScript, and escapes quotes, backslashes and line separators.
    lines.push(`document.cookie = ${jsString(attrs.join('; '))};`);
  }
  // Cookie names are attacker-controlled: quoted and escaped, never raw in a comment.
  if (skipped.length) lines.splice(2, 0, `// Left out (HttpOnly, not settable from JavaScript): ${skipped.map(jsString).join(', ')}`);
  return { text: lines.join('\n') + '\n', skipped };
}

// --- parsing ---

class ImportError extends Error {
  constructor(code, message, index) {
    super(message);
    this.code = code;
    this.index = index;
  }
}

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (o, k) => (Object.hasOwn(o, k) ? o[k] : undefined);

function label(index, name) {
  let n = '';
  if (typeof name === 'string') {
    n = name.length > 64 ? name.slice(0, 64) + '…' : name;
    n = JSON.stringify(n);
  }
  return n ? t('io_entry_named', index + 1, n) : t('io_entry', index + 1);
}

function normSameSite(v, index) {
  if (v === undefined || v === null) return 'unspecified';
  if (typeof v === 'string') {
    const l = v.toLowerCase();
    if (l === 'no_restriction' || l === 'none') return 'no_restriction';
    if (l === 'lax' || l === 'strict' || l === 'unspecified') return l;
  }
  throw new ImportError('bad_samesite', t('io_bad_samesite', t('io_entry', index + 1)), index);
}

function bool(o, key, dflt, index) {
  const v = own(o, key);
  if (v === undefined) return dflt;
  if (typeof v !== 'boolean') throw new ImportError('bad_type', t('io_bool', t('io_entry', index + 1), key), index);
  return v;
}

function str(o, key, index, dflt) {
  const v = own(o, key);
  if (v === undefined && dflt !== undefined) return dflt;
  if (typeof v !== 'string') throw new ImportError('bad_type', t('io_text', t('io_entry', index + 1), key), index);
  return v;
}

function toDraft(entry, index) {
  if (!isObj(entry)) throw new ImportError('bad_entry', t('io_not_object', t('io_entry', index + 1)), index);
  const name = str(entry, 'name', index);
  const value = str(entry, 'value', index);
  let domain = str(entry, 'domain', index);
  const path = str(entry, 'path', index, '/');
  const secure = bool(entry, 'secure', false, index);
  const httpOnly = bool(entry, 'httpOnly', false, index);
  const sameSite = normSameSite(own(entry, 'sameSite'), index);
  const hostOnly = bool(entry, 'hostOnly', !domain.startsWith('.'), index);

  let exp = own(entry, 'expirationDate');
  if (exp === null) exp = undefined;
  if (exp !== undefined && (typeof exp !== 'number' || !Number.isFinite(exp))) {
    throw new ImportError('bad_type', t('io_expiration_type', label(index, name)), index);
  }
  const session = bool(entry, 'session', !exp, index);

  // Chrome reports Domain= cookies with a leading dot; keep that convention.
  if (!hostOnly && domain !== '' && !domain.startsWith('.')) domain = '.' + domain;

  const draft = { name, value, domain, hostOnly, path, secure, httpOnly, sameSite, session };
  if (!session && exp !== undefined) draft.expirationDate = exp;

  const pk = own(entry, 'partitionKey');
  if (pk !== undefined && pk !== null) {
    if (!isObj(pk) || typeof own(pk, 'topLevelSite') !== 'string') {
      throw new ImportError('bad_partition_key', t('io_partition_key', label(index, name)), index);
    }
    draft.partitionKey = { topLevelSite: pk.topLevelSite };
    const h = own(pk, 'hasCrossSiteAncestor');
    if (h !== undefined) {
      if (typeof h !== 'boolean') throw new ImportError('bad_partition_key', t('io_partition_flag', label(index, name)), index);
      draft.partitionKey.hasCrossSiteAncestor = h;
    }
  }
  return draft;
}

function netscapeEntries(text) {
  const entries = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    if (line.trim() === '') continue;
    let httpOnly = false;
    if (line.startsWith('#HttpOnly_')) {
      httpOnly = true;
      line = line.slice('#HttpOnly_'.length);
    } else if (line.startsWith('#')) {
      continue;
    }
    const f = line.split('\t');
    // Some writers drop the trailing tab of an empty value.
    if (f.length < 6 || f.length > 7) {
      throw new ImportError('bad_line', t('io_bad_line', i + 1, f.length), entries.length);
    }
    const [domain, sub, path, sec, expiry, name, value = ''] = f;
    const flag = (v, what) => {
      if (v !== 'TRUE' && v !== 'FALSE') throw new ImportError('bad_line', t(what, i + 1), entries.length);
      return v === 'TRUE';
    };
    if (!/^\d{1,15}$/.test(expiry)) {
      throw new ImportError('bad_line', t('io_line_expiry', i + 1), entries.length);
    }
    // A leading dot means Domain= whatever the flag says; some exporters disagree.
    const hostOnly = !flag(sub, 'io_line_flag_subdomains') && !domain.startsWith('.');
    const exp = Number(expiry);
    const e = {
      name, value, domain, hostOnly, path, secure: flag(sec, 'io_line_flag_secure'), httpOnly,
      sameSite: 'unspecified', session: exp === 0,
    };
    if (exp !== 0) e.expirationDate = exp;
    entries.push(e);
  }
  return entries;
}

function partitionId(pk) {
  return pk ? `${pk.topLevelSite}|${pk.hasCrossSiteAncestor ?? ''}` : '';
}

export function parseImport(text, ctx = {}) {
  const maxBytes = ctx.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxCookies = ctx.maxCookies ?? DEFAULT_MAX_COOKIES;
  try {
    if (typeof text !== 'string') throw new ImportError('not_text', t('io_not_text'));
    // Cheap pre-check (length is a lower bound on bytes) so huge files never reach JSON.parse.
    if (text.length > maxBytes || utf8Bytes(text) > maxBytes) {
      throw new ImportError('too_large', t('io_too_large', maxBytes));
    }
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

    let source;
    let entries;
    const meta = {};
    const first = text.trimStart()[0];
    if (first === '{' || first === '[') {
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new ImportError('bad_json', t('io_bad_json'));
      }
      if (Array.isArray(data)) {
        source = 'array';
        entries = data;
      } else if (isObj(data) && own(data, 'format') === 'cookiedesk') {
        if (own(data, 'version') !== 1) throw new ImportError('bad_version', t('io_bad_version'));
        if (!Array.isArray(own(data, 'cookies'))) throw new ImportError('bad_envelope', t('io_no_cookie_list'));
        source = 'cookiedesk';
        entries = data.cookies;
        // Display-only labels: plain strings, length-capped, never trusted for anything else.
        for (const k of ['site', 'set', 'exportedAt']) {
          const v = own(data, k);
          if (typeof v === 'string' && v.length <= 200) meta[k] = v;
        }
      } else {
        throw new ImportError('unknown_format', t('io_unknown_format'));
      }
    } else {
      source = 'netscape';
      entries = netscapeEntries(text);
    }

    if (entries.length === 0) throw new ImportError('no_cookies', t('io_no_cookies'));
    if (entries.length > maxCookies) {
      throw new ImportError('too_many', t('io_too_many', entries.length, maxCookies));
    }

    const drafts = [];
    const warnings = [];
    const seen = new Set();
    const domains = new Set();
    const vctx = { now: ctx.now, isPublicSuffix: ctx.isPublicSuffix, pageSite: ctx.pageSite };
    for (let i = 0; i < entries.length; i++) {
      const d = toDraft(entries[i], i);
      const { errors, warnings: w } = validateCookie(d, vctx);
      if (errors.length) {
        throw new ImportError(errors[0].code, t('io_issue', label(i, d.name), errors[0].message), i);
      }
      for (const x of w) warnings.push(t('io_issue', label(i, d.name), x.message));
      // Chrome stores domains lowercased, so A.test and a.test name the same cookie.
      const key = [d.name, d.domain.toLowerCase(), d.path, partitionId(d.partitionKey)].join('\u0000');
      if (seen.has(key)) {
        throw new ImportError('duplicate', t('io_duplicate', label(i, d.name)), i);
      }
      seen.add(key);
      domains.add(d.domain.replace(/^\./, ''));
      drafts.push(d);
    }
    return { ok: true, drafts, domains: [...domains].sort(), source, warnings, meta };
  } catch (e) {
    if (e instanceof ImportError) {
      const error = { code: e.code, message: e.message };
      if (e.index !== undefined) error.index = e.index;
      return { ok: false, error };
    }
    return { ok: false, error: { code: 'bad_file', message: t('file_unreadable') } };
  }
}
