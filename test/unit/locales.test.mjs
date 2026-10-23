import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const json = (p) => JSON.parse(read(p));
const en = json('i18n/en.json');
const langs = readdirSync(new URL('i18n/', root)).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
const subs = (s) => new Set(s.match(/\$\d/g) || []);
const subset = (a, b) => [...a].every((x) => b.has(x));

test('51 languages, English is the default locale', () => {
  assert.equal(langs.length, 51);
  assert.equal(json('manifest.json').default_locale, 'en');
});

test('every language has exactly the English keys and the same substitutions', () => {
  for (const lang of langs) {
    const tr = json(`i18n/${lang}.json`);
    assert.deepEqual(Object.keys(tr).sort(), Object.keys(en).sort(), `${lang}: keys differ`);
    for (const [key, text] of Object.entries(tr)) {
      assert.ok(text.trim(), `${lang}.${key} is empty`);
      // A "one" form may drop the count where that language's "one" means exactly 1.
      const ok = key.endsWith('_one') ? subset(subs(text), subs(en[key])) : String([...subs(text)].sort()) === String([...subs(en[key])].sort());
      assert.ok(ok, `${lang}.${key}: substitutions differ from English`);
    }
  }
});

test('store name and summary fit the Chrome Web Store limits', () => {
  for (const lang of langs) {
    const tr = json(`i18n/${lang}.json`);
    assert.ok([...tr.extension_name].length <= 75, `${lang}: name too long`);
    assert.ok([...tr.extension_description].length <= 132, `${lang}: summary too long`);
  }
});

test('_locales is built from the current i18n sources', () => {
  for (const lang of langs) {
    const path = `_locales/${lang}/messages.json`;
    assert.ok(existsSync(new URL(path, root)), `${path} missing: run python3 i18n/build_locales.py`);
    const built = json(path);
    for (const [key, text] of Object.entries(json(`i18n/${lang}.json`))) {
      assert.equal(built[key]?.message, text.replace(/\$(\d)/g, '$P$1$'), `${path} is stale: run python3 i18n/build_locales.py`);
    }
  }
});

test('the bundled English fallback matches i18n/en.json', async () => {
  const { default: bundled } = await import('../../src/lib/i18n-en.js');
  assert.deepEqual(bundled, en, 'src/lib/i18n-en.js is stale: run python3 i18n/build_locales.py');
});

test('every literal message key used in the code exists in English', () => {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(new URL(dir, root), { withFileTypes: true })) {
      const p = `${dir}${e.name}`;
      if (e.isDirectory()) walk(`${p}/`);
      else if (/\.(js|html)$/.test(e.name) && !p.startsWith('src/lib/i18n')) files.push(p); // i18n.js only has examples
    }
  };
  walk('src/');
  const missing = [];
  for (const f of files) {
    const src = read(f);
    for (const [, key] of src.matchAll(/\bt\(\s*'([a-z0-9_]+)'/g)) if (!(key in en)) missing.push(`${f}: ${key}`);
    for (const [, key] of src.matchAll(/\b(?:tn|withKeys)\(\s*'([a-z0-9_]+)'/g)) {
      const ok = key in en || (`${key}_one` in en && `${key}_other` in en);
      if (!ok) missing.push(`${f}: ${key}`);
    }
    for (const [, key] of src.matchAll(/data-i18n(?:-title|-aria|-placeholder)?="([a-z0-9_]+)"/g)) if (!(key in en)) missing.push(`${f}: ${key}`);
  }
  for (const m of JSON.stringify(json('manifest.json')).matchAll(/__MSG_([a-z0-9_]+)__/g)) if (!(m[1] in en)) missing.push(`manifest.json: ${m[1]}`);
  assert.deepEqual(missing, []);
});
