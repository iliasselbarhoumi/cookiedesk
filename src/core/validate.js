// Pure cookie validation. Chrome only answers "Failed to parse or set cookie",
// so every rule is restated here with a message that explains it.
// Messages never include the cookie value (it is a live credential).

import { t } from '../lib/i18n.js';

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
    err(null, 'bad_draft', t('v_bad_draft'));
    return { errors, warnings };
  }
  const { name, value, domain, path, hostOnly, secure, httpOnly, sameSite, partitionKey } = draft;

  // --- types ---
  const nameOk = typeof name === 'string';
  const valueOk = typeof value === 'string';
  if (!nameOk) err('name', 'name_type', t('v_name_type'));
  if (!valueOk) err('value', 'value_type', t('v_value_type'));
  const domainOk = typeof domain === 'string';
  const pathOk = typeof path === 'string';
  if (!domainOk) err('domain', 'domain_type', t('v_domain_type'));
  if (!pathOk) err('path', 'path_type', t('v_path_type'));
  for (const [flag, v, field] of [['Secure', secure, 'secure'], ['HttpOnly', httpOnly, 'httpOnly'],
    [t('host_only'), hostOnly, null], [t('session'), draft.session, null]]) {
    if (v !== undefined && typeof v !== 'boolean') {
      err(field, 'flag_type', t('v_flag_type', flag));
    }
  }
  if (sameSite !== undefined && !SAME_SITE_VALUES.includes(sameSite)) {
    err('sameSite', 'bad_samesite', t('v_bad_samesite', SAME_SITE_VALUES.join(', ')));
  }

  // --- name / value ---
  if (nameOk) {
    if (CONTROL_CHARS.test(name)) err('name', 'bad_chars_name', t('v_name_control'));
    if (name.includes(';')) err('name', 'bad_chars_name', t('v_name_semicolon'));
    if (name.includes('=')) err('name', 'name_has_equals', t('v_name_equals'));
  }
  if (valueOk) {
    if (CONTROL_CHARS.test(value)) err('value', 'bad_chars_value', t('v_value_control'));
    if (value.includes(';')) err('value', 'bad_chars_value', t('v_value_semicolon'));
  }
  if (nameOk && valueOk) {
    if (name === '' && value === '') {
      err('name', 'empty_cookie', t('v_empty_cookie'));
    } else if (name === '') {
      warn('name', 'empty_name', t('v_empty_name'));
    }
    const size = utf8Bytes(name) + utf8Bytes(value);
    if (size > MAX_NAME_VALUE_BYTES) {
      err('value', 'too_large', t('v_too_large', size, MAX_NAME_VALUE_BYTES));
    }
  }

  // --- path ---
  if (pathOk) {
    if (!path.startsWith('/')) err('path', 'path_slash', t('v_path_slash'));
    if (utf8Bytes(path) > MAX_PATH_BYTES) err('path', 'path_too_long', t('v_path_too_long', MAX_PATH_BYTES));
    if (CONTROL_CHARS.test(path) || path.includes(';')) err('path', 'bad_chars_path', t('v_path_chars'));
  }

  // --- domain ---
  let host = null; // domain without leading dot, when usable
  if (domainOk) {
    const dotted = domain.startsWith('.');
    host = dotted ? domain.slice(1) : domain;
    if (domain === '' || host === '') {
      err('domain', 'domain_empty', t('v_domain_empty'));
      host = null;
    } else if (utf8Bytes(domain) > MAX_DOMAIN_BYTES) {
      err('domain', 'domain_too_long', t('v_domain_too_long', MAX_DOMAIN_BYTES));
      host = null;
    } else if (!isHostname(host)) {
      err('domain', 'domain_invalid', t('v_domain_invalid'));
      host = null;
    } else if (dotted && hostOnly === true) {
      err('domain', 'domain_leading_dot', t('v_domain_leading_dot'));
    }
    // A host-only cookie on a public suffix is legal; a Domain= one is not.
    if (host && hostOnly !== true && typeof ctx.isPublicSuffix === 'function' && ctx.isPublicSuffix(host)) {
      err('domain', 'domain_public_suffix', t('v_domain_public_suffix', host));
    }
  }

  // --- Secure-dependent rules ---
  const isSecure = secure === true;
  if (sameSite === 'no_restriction' && !isSecure) {
    err('secure', 'samesite_none_insecure', t('v_samesite_none_insecure'));
  }
  const hasPartition = partitionKey !== undefined && partitionKey !== null;
  if (hasPartition && !isSecure) {
    err('secure', 'partitioned_insecure', t('v_partitioned_insecure'));
  }
  if (nameOk) {
    if (/^__secure-/i.test(name) && !isSecure) {
      err('secure', 'prefix_secure', t('v_prefix_secure', '__Secure-'));
    }
    if (/^__host-/i.test(name)) {
      if (!isSecure) err('secure', 'prefix_secure', t('v_prefix_secure', '__Host-'));
      if (hostOnly !== true) err('domain', 'host_prefix_domain', t('v_host_prefix_domain'));
      if (pathOk && path !== '/') err('path', 'host_prefix_path', t('v_host_prefix_path'));
    }
  }

  // --- expiry ---
  const hasExp = draft.expirationDate !== undefined && draft.expirationDate !== null;
  if (hasExp && draft.session !== true) {
    const exp = draft.expirationDate;
    if (typeof exp !== 'number' || !Number.isFinite(exp)) {
      err('expirationDate', 'bad_expiration', t('v_bad_expiration'));
    } else {
      if (exp * 1000 <= now) {
        warn('expirationDate', 'expired_deletes', t('v_expired_deletes'));
      } else if (exp * 1000 > now + CLAMP_DAYS * 86400000) {
        warn('expirationDate', 'clamped_400d', t('v_clamped', CLAMP_DAYS));
      }
    }
  } else if (!hasExp && draft.session === false) {
    err('expirationDate', 'expiration_missing', t('v_expiration_missing'));
  }

  // --- partition ---
  if (hasPartition) {
    if (typeof partitionKey !== 'object' || Array.isArray(partitionKey)) {
      err('partitionKey', 'partition_type', t('v_partition_type'));
    } else {
      const { topLevelSite, hasCrossSiteAncestor } = partitionKey;
      let topHost = null;
      if (typeof topLevelSite !== 'string') {
        err('partitionKey', 'partition_site', t('v_partition_site_type'));
      } else {
        const m = /^https:\/\/([^/:?#\s]+)$/.exec(topLevelSite);
        if (!m || !isHostname(m[1])) {
          err('partitionKey', 'partition_site', t('v_partition_site_form'));
        } else {
          topHost = m[1].toLowerCase();
        }
      }
      if (hasCrossSiteAncestor !== undefined && typeof hasCrossSiteAncestor !== 'boolean') {
        err('partitionKey', 'flag_type', t('v_partition_flag'));
      } else if (hasCrossSiteAncestor === false && topHost && host && !relatedHosts(host.toLowerCase(), topHost)) {
        err('partitionKey', 'partition_cross_site', t('v_partition_cross_site', topLevelSite));
      }
    }
  }

  // --- context ---
  if (host && typeof ctx.pageSite === 'string' && ctx.pageSite) {
    const site = ctx.pageSite.toLowerCase();
    const h = host.toLowerCase();
    if (h !== site && !h.endsWith('.' + site)) {
      warn('domain', 'other_site', t('v_other_site', host, ctx.pageSite));
    }
  }

  return { errors, warnings };
}
