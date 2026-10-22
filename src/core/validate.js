// Pure cookie validation. Chrome only answers "Failed to parse or set cookie",
// so every rule is restated here with a message that explains it.
// Messages never include the cookie value (it is a live credential).

export const SAME_SITE_VALUES = ['no_restriction', 'lax', 'strict', 'unspecified'];

const MAX_NAME_VALUE_BYTES = 4096;
const MAX_PATH_BYTES = 1024;
const MAX_DOMAIN_BYTES = 1024;
const MAX_LABEL_LENGTH = 63;
const CLAMP_DAYS = 400;

const encoder = new TextEncoder();

export function utf8Bytes(str) {
  return encoder.encode(String(str)).length;
}

const CONTROL_CHARS = /[\x00-\x1f\x7f]/;
const HOST_LABEL = /^[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?$/i;
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6 = /^\[?[0-9a-f:.]*:[0-9a-f:.]*\]?$/i;

function isHostname(host) {
  if (IPV4.test(host)) return host.split('.').every((p) => Number(p) <= 255);
  if (IPV6.test(host)) return true;
  return host.split('.').every((l) => l.length <= MAX_LABEL_LENGTH && HOST_LABEL.test(l));
}

// Same-site as far as this module can tell without the PSL: one host is the
// other or a subdomain of it.
function relatedHosts(a, b) {
  return a === b || a.endsWith('.' + b) || b.endsWith('.' + a);
}

export function validateCookie(draft, ctx = {}) {
  const errors = [];
  const warnings = [];
  const err = (field, code, message) => errors.push({ field, code, message });
  const warn = (field, code, message) => warnings.push({ field, code, message });
  const now = ctx.now ?? Date.now();

  if (draft === null || typeof draft !== 'object' || Array.isArray(draft)) {
    err(null, 'bad_draft', 'The cookie must be an object with name, value, domain and path.');
    return { errors, warnings };
  }
  const { name, value, domain, path, hostOnly, secure, httpOnly, sameSite, partitionKey } = draft;

  // --- types ---
  const nameOk = typeof name === 'string';
  const valueOk = typeof value === 'string';
  if (!nameOk) err('name', 'name_type', 'The cookie name must be text.');
  if (!valueOk) err('value', 'value_type', 'The cookie value must be text.');
  const domainOk = typeof domain === 'string';
  const pathOk = typeof path === 'string';
  if (!domainOk) err('domain', 'domain_type', 'The domain must be text.');
  if (!pathOk) err('path', 'path_type', 'The path must be text.');
  for (const [flag, v, field] of [['Secure', secure, 'secure'], ['HttpOnly', httpOnly, 'httpOnly'],
    ['Host-only', hostOnly, null], ['Session', draft.session, null]]) {
    if (v !== undefined && typeof v !== 'boolean') {
      err(field, 'flag_type', `${flag} must be true or false.`);
    }
  }
  if (sameSite !== undefined && !SAME_SITE_VALUES.includes(sameSite)) {
    err('sameSite', 'bad_samesite', `SameSite must be one of ${SAME_SITE_VALUES.join(', ')}.`);
  }

  // --- name / value ---
  if (nameOk) {
    if (CONTROL_CHARS.test(name)) err('name', 'bad_chars_name', 'The name contains control characters (such as a newline or tab), which cookies cannot hold.');
    if (name.includes(';')) err('name', 'bad_chars_name', 'The name contains ";", which would end the cookie early.');
    if (name.includes('=')) err('name', 'name_has_equals', 'The name contains "=", which separates the name from the value in a cookie.');
  }
  if (valueOk) {
    if (CONTROL_CHARS.test(value)) err('value', 'bad_chars_value', 'The value contains control characters (such as a newline or tab), which cookies cannot hold.');
    if (value.includes(';')) err('value', 'bad_chars_value', 'The value contains ";", which would end the cookie early. Encode it (for example with encodeURIComponent).');
  }
  if (nameOk && valueOk) {
    if (name === '' && value === '') {
      err('name', 'empty_cookie', 'A cookie needs a name or a value; both are empty.');
    } else if (name === '') {
      warn('name', 'empty_name', 'This cookie has an empty name. Some sites and tools handle nameless cookies badly.');
    }
    const size = utf8Bytes(name) + utf8Bytes(value);
    if (size > MAX_NAME_VALUE_BYTES) {
      err('value', 'too_large', `Name and value together are ${size} bytes (UTF-8); Chrome allows at most ${MAX_NAME_VALUE_BYTES}.`);
    }
  }

  // --- path ---
  if (pathOk) {
    if (!path.startsWith('/')) err('path', 'path_slash', 'The path must start with "/".');
    if (utf8Bytes(path) > MAX_PATH_BYTES) err('path', 'path_too_long', `The path is longer than ${MAX_PATH_BYTES} bytes.`);
    if (CONTROL_CHARS.test(path) || path.includes(';')) err('path', 'bad_chars_path', 'The path contains control characters or ";", which cookies cannot hold.');
  }

  // --- domain ---
  let host = null; // domain without leading dot, when usable
  if (domainOk) {
    const dotted = domain.startsWith('.');
    host = dotted ? domain.slice(1) : domain;
    if (domain === '' || host === '') {
      err('domain', 'domain_empty', 'The domain is empty. Enter the site the cookie belongs to, for example example.com.');
      host = null;
    } else if (utf8Bytes(domain) > MAX_DOMAIN_BYTES) {
      err('domain', 'domain_too_long', `The domain is longer than ${MAX_DOMAIN_BYTES} bytes.`);
      host = null;
    } else if (!isHostname(host)) {
      err('domain', 'domain_invalid', 'The domain is not a valid host name. Use letters, digits and hyphens separated by dots (internationalised names must be in punycode, like xn--...).');
      host = null;
    } else if (dotted && hostOnly === true) {
      err('domain', 'domain_leading_dot', 'A host-only cookie cannot have a leading dot in its domain; the dot means the cookie also applies to subdomains.');
    }
    // A host-only cookie on a public suffix is legal; a Domain= one is not.
    if (host && hostOnly !== true && typeof ctx.isPublicSuffix === 'function' && ctx.isPublicSuffix(host)) {
      err('domain', 'domain_public_suffix', `"${host}" is a public suffix (a registry-controlled domain like .com or .co.uk), so browsers refuse cookies that apply to all of it.`);
    }
  }

  // --- Secure-dependent rules ---
  const isSecure = secure === true;
  if (sameSite === 'no_restriction' && !isSecure) {
    err('secure', 'samesite_none_insecure', 'SameSite=None cookies must be Secure — Chrome rejects them otherwise. Turn on Secure or choose another SameSite.');
  }
  const hasPartition = partitionKey !== undefined && partitionKey !== null;
  if (hasPartition && !isSecure) {
    err('secure', 'partitioned_insecure', 'Partitioned cookies must be Secure — Chrome rejects them otherwise. Turn on Secure or remove the partition.');
  }
  if (nameOk) {
    if (/^__secure-/i.test(name) && !isSecure) {
      err('secure', 'prefix_secure', 'Cookies named "__Secure-..." must be Secure. Turn on Secure or rename the cookie.');
    }
    if (/^__host-/i.test(name)) {
      if (!isSecure) err('secure', 'prefix_secure', 'Cookies named "__Host-..." must be Secure. Turn on Secure or rename the cookie.');
      if (hostOnly !== true) err('domain', 'host_prefix_domain', 'Cookies named "__Host-..." must be host-only (no Domain attribute, so no subdomain sharing). Turn on host-only or rename the cookie.');
      if (pathOk && path !== '/') err('path', 'host_prefix_path', 'Cookies named "__Host-..." must have the path "/".');
    }
  }

  // --- expiry ---
  const hasExp = draft.expirationDate !== undefined && draft.expirationDate !== null;
  if (hasExp && draft.session !== true) {
    const exp = draft.expirationDate;
    if (typeof exp !== 'number' || !Number.isFinite(exp)) {
      err('expirationDate', 'bad_expiration', 'The expiration must be a finite number of seconds since 1970.');
    } else {
      if (exp * 1000 <= now) {
        warn('expirationDate', 'expired_deletes', 'Saving with an expiry in the past deletes this cookie.');
      } else if (exp * 1000 > now + CLAMP_DAYS * 86400000) {
        warn('expirationDate', 'clamped_400d', `Chrome limits cookie lifetime to ${CLAMP_DAYS} days; a later expiry is shortened when saved.`);
      }
    }
  } else if (!hasExp && draft.session === false) {
    err('expirationDate', 'expiration_missing', 'A non-session cookie needs an expiration date. Pick one or mark the cookie as a session cookie.');
  }

  // --- partition ---
  if (hasPartition) {
    if (typeof partitionKey !== 'object' || Array.isArray(partitionKey)) {
      err('partitionKey', 'partition_type', 'The partition key must be an object with a topLevelSite.');
    } else {
      const { topLevelSite, hasCrossSiteAncestor } = partitionKey;
      let topHost = null;
      if (typeof topLevelSite !== 'string') {
        err('partitionKey', 'partition_site', 'The partition\'s top-level site must be text like https://example.com.');
      } else {
        const m = /^https:\/\/([^/:?#\s]+)$/.exec(topLevelSite);
        if (!m || !isHostname(m[1])) {
          err('partitionKey', 'partition_site', 'The partition\'s top-level site must look like https://example.com (https, no path or port).');
        } else {
          topHost = m[1].toLowerCase();
        }
      }
      if (hasCrossSiteAncestor !== undefined && typeof hasCrossSiteAncestor !== 'boolean') {
        err('partitionKey', 'flag_type', 'The partition\'s hasCrossSiteAncestor must be true or false.');
      } else if (hasCrossSiteAncestor === false && topHost && host && !relatedHosts(host.toLowerCase(), topHost)) {
        err('partitionKey', 'partition_cross_site', `The cookie's domain is not on the same site as ${topLevelSite}, so Chrome requires hasCrossSiteAncestor to be true for it.`);
      }
    }
  }

  // --- context ---
  if (host && typeof ctx.pageSite === 'string' && ctx.pageSite) {
    const site = ctx.pageSite.toLowerCase();
    const h = host.toLowerCase();
    if (h !== site && !h.endsWith('.' + site)) {
      warn('domain', 'other_site', `This cookie's domain (${host}) is outside the current site (${ctx.pageSite}).`);
    }
  }

  return { errors, warnings };
}
