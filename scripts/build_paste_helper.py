#!/usr/bin/env python3
"""
Builds store-listings/paste-helper.html: one page with every store-listings/<lang>.md
description and a Copy button per language, to fill in the Chrome Web Store dashboard.

  python3 scripts/build_paste_helper.py      (npm run package runs it too)

Open the HTML file in Chrome. Progress (which languages are done) is kept in that
browser's localStorage. The page is self-contained: no network requests.
"""
import json
import os

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
LISTINGS = os.path.join(ROOT, 'store-listings')
OUT = os.path.join(LISTINGS, 'paste-helper.html')

# As the dashboard's language selector names them.
NAMES = {
    'am': 'Amharic', 'ar': 'Arabic', 'bg': 'Bulgarian', 'bn': 'Bengali', 'ca': 'Catalan', 'cs': 'Czech',
    'da': 'Danish', 'de': 'German', 'el': 'Greek', 'en': 'English', 'es': 'Spanish', 'et': 'Estonian',
    'fa': 'Persian', 'fi': 'Finnish', 'fil': 'Filipino', 'fr': 'French', 'gu': 'Gujarati', 'he': 'Hebrew',
    'hi': 'Hindi', 'hr': 'Croatian', 'hu': 'Hungarian', 'id': 'Indonesian', 'it': 'Italian', 'ja': 'Japanese',
    'kn': 'Kannada', 'ko': 'Korean', 'lt': 'Lithuanian', 'lv': 'Latvian', 'ml': 'Malayalam', 'mr': 'Marathi',
    'ms': 'Malay', 'nl': 'Dutch', 'no': 'Norwegian', 'pl': 'Polish', 'pt_BR': 'Portuguese (Brazil)',
    'pt_PT': 'Portuguese (Portugal)', 'ro': 'Romanian', 'ru': 'Russian', 'sk': 'Slovak', 'sl': 'Slovenian',
    'sr': 'Serbian', 'sv': 'Swedish', 'sw': 'Swahili', 'ta': 'Tamil', 'te': 'Telugu', 'th': 'Thai',
    'tr': 'Turkish', 'uk': 'Ukrainian', 'vi': 'Vietnamese', 'zh_CN': 'Chinese (China)', 'zh_TW': 'Chinese (Taiwan)',
}
RTL = {'ar', 'fa', 'he'}
LIMIT = 16000  # Chrome Web Store description limit

PAGE = r'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CookieDesk listing paste helper</title>
<style>
:root {
  --bg: #f7f8fa; --card: #ffffff; --ink: #1d1f23; --muted: #5b606a; --line: #e2e4e9; --hover: #eceef2;
  --accent: #1a73e8; --accent-fg: #ffffff; --done: #188038; --done-tint: #e6f4ea;
}
@media (prefers-color-scheme: dark) {
  :root { --bg: #1c1d21; --card: #26282d; --ink: #eceef1; --muted: #a3a8b1; --line: #3a3d44; --hover: #30333a;
    --accent: #8ab4f8; --accent-fg: #1d1f23; --done: #81c995; --done-tint: #20352a; }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
header { position: sticky; top: 0; z-index: 2; display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; padding: 14px 24px; border-bottom: 1px solid var(--line); background: color-mix(in srgb, var(--bg) 92%, transparent); backdrop-filter: blur(8px); }
h1 { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 17px; font-weight: 650; }
.bar { flex: 1; min-width: 160px; height: 8px; overflow: hidden; border-radius: 9px; background: var(--hover); }
.bar i { display: block; width: 0; height: 100%; background: var(--done); transition: width .2s; }
.count { color: var(--muted); font-variant-numeric: tabular-nums; }
button { font: inherit; cursor: pointer; border: 0; border-radius: 8px; }
button:focus-visible, input:focus-visible, summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.next { padding: 7px 14px; background: var(--accent); color: var(--accent-fg); font-weight: 650; }
.reset { padding: 7px 12px; background: var(--hover); color: var(--muted); }
.intro { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 20px; margin: 16px 24px 0; color: var(--muted); }
.intro p { flex: 1 1 420px; margin: 0; }
.intro input[type=search] { width: 220px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--card); color: var(--ink); font: inherit; }
.flash { min-height: 21px; margin: 8px 24px 0; color: var(--done); font-weight: 600; }
ol { display: grid; gap: 8px; margin: 8px 24px 40px; padding: 0; list-style: none; }
li { padding: 10px 14px; border: 1px solid var(--line); border-radius: 12px; background: var(--card); }
li.done { border-color: color-mix(in srgb, var(--done) 40%, var(--line)); background: var(--done-tint); }
.row { display: grid; grid-template-columns: 28px minmax(0, 1fr) auto auto; gap: 14px; align-items: center; }
.n { color: var(--muted); font-variant-numeric: tabular-nums; }
.lang b { font-size: 15px; }
.lang small { margin-inline-start: 8px; color: var(--muted); }
.preview { display: block; overflow: hidden; color: var(--muted); font-size: 12.5px; white-space: nowrap; text-overflow: ellipsis; }
.copy { min-width: 96px; padding: 8px 14px; background: var(--accent); color: var(--accent-fg); font-weight: 650; }
li.done .copy { background: var(--hover); color: var(--done); }
.tick { width: 18px; height: 18px; accent-color: var(--done); }
details { margin: 6px 0 0 42px; }
summary { width: max-content; color: var(--muted); font-size: 12.5px; cursor: pointer; }
pre { max-height: 360px; margin: 8px 0 4px; padding: 12px; overflow: auto; border-radius: 8px; background: var(--hover); font-family: inherit; font-size: 13px; line-height: 1.55; white-space: pre-wrap; }
.over { color: #d93025; font-weight: 650; }
@media (max-width: 640px) {
  header, .intro, .flash, ol { margin-inline: 0; padding-inline: 16px; }
  ol { margin-inline: 16px; padding: 0; }
  .row { grid-template-columns: minmax(0, 1fr) auto auto; }
  .n { display: none; }
  details { margin-inline-start: 0; }
}
</style>
</head>
<body>
<header>
  <h1>CookieDesk listing descriptions</h1>
  <div class="bar" aria-hidden="true"><i id="bar"></i></div>
  <span class="count" id="count"></span>
  <button class="next" id="next" type="button">Copy next</button>
  <button class="reset" id="reset" type="button">Reset</button>
</header>
<div class="intro">
  <p>For each language: pick it in the dashboard's language selector, click <b>Copy</b> here, click the Description field, select all (⌘A / Ctrl+A) and paste. Name and summary come from the package (<code>_locales</code>), so only the description needs pasting. Progress stays in this browser.</p>
  <input type="search" id="filter" placeholder="Filter languages" aria-label="Filter languages">
</div>
<div class="flash" id="flash" role="status" aria-live="polite"></div>
<ol id="list"></ol>
<script type="application/json" id="data">__DATA__</script>
<script>
const ITEMS = JSON.parse(document.getElementById('data').textContent);
const LIMIT = __LIMIT__;
const KEY = 'jsswitch-listing-done';
const load = () => { try { return new Set(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return new Set(); } };
const done = load();
const $ = (id) => document.getElementById(id);
function persist() { try { localStorage.setItem(KEY, JSON.stringify([...done])); } catch {} }

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return; } catch {}
  const ta = Object.assign(document.createElement('textarea'), { value: text });
  document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove();
}
async function copy(item) {
  await copyText(item.text);
  done.add(item.code); persist(); render();
  $('flash').textContent = `Copied ${item.name} (${item.code}). Now pick ${item.name} in the dashboard and paste.`;
}

function render() {
  const q = $('filter').value.trim().toLowerCase();
  const list = $('list');
  list.textContent = '';
  ITEMS.forEach((item, i) => {
    if (q && !`${item.name} ${item.code} ${item.native}`.toLowerCase().includes(q)) return;
    const li = document.createElement('li');
    li.className = done.has(item.code) ? 'done' : '';
    li.innerHTML = '<div class="row"><span class="n"></span><div class="lang"><b></b><small></small><span class="preview"></span></div><button class="copy" type="button"></button><input type="checkbox" class="tick"></div><details><summary></summary><pre></pre></details>';
    li.querySelector('.n').textContent = i + 1;
    li.querySelector('b').textContent = item.name;
    li.querySelector('small').textContent = item.native && item.native !== item.name ? `${item.code} · ${item.native}` : item.code;
    const preview = li.querySelector('.preview');
    preview.textContent = item.text.split('\n')[0];
    preview.dir = item.rtl ? 'rtl' : 'ltr';
    const btn = li.querySelector('.copy');
    btn.textContent = done.has(item.code) ? 'Copied ✓' : 'Copy';
    btn.setAttribute('aria-label', `Copy the ${item.name} description`);
    btn.onclick = () => copy(item);
    const tick = li.querySelector('.tick');
    tick.checked = done.has(item.code);
    tick.title = tick.ariaLabel = `${item.name} done`;
    tick.onchange = () => { tick.checked ? done.add(item.code) : done.delete(item.code); persist(); render(); };
    const chars = [...item.text].length;
    const summary = li.querySelector('summary');
    summary.textContent = `Show full text · ${chars.toLocaleString()} characters`;
    if (chars > LIMIT) summary.classList.add('over');
    const pre = li.querySelector('pre');
    pre.textContent = item.text;
    pre.dir = item.rtl ? 'rtl' : 'ltr';
    list.append(li);
  });
  $('count').textContent = `${done.size} / ${ITEMS.length}`;
  $('bar').style.width = `${(done.size / ITEMS.length) * 100}%`;
  const next = ITEMS.find((it) => !done.has(it.code));
  $('next').disabled = !next;
  $('next').textContent = next ? `Copy next: ${next.name}` : 'All done';
}

for (const item of ITEMS) {
  try { item.native = new Intl.DisplayNames([item.code.replace('_', '-')], { type: 'language' }).of(item.code.replace('_', '-')); } catch {}
}
$('next').onclick = () => { const next = ITEMS.find((it) => !done.has(it.code)); if (next) copy(next); };
$('reset').onclick = () => { done.clear(); persist(); $('flash').textContent = ''; render(); };
$('filter').oninput = render;
render();
</script>
</body>
</html>
'''


def main():
    codes = sorted((f[:-3] for f in os.listdir(LISTINGS) if f.endswith('.md')), key=lambda c: (c != 'en', NAMES.get(c, c)))
    missing = [c for c in codes if c not in NAMES]
    if missing:
        raise SystemExit(f'no language name for {missing}')
    items = []
    for code in codes:
        text = open(os.path.join(LISTINGS, f'{code}.md'), encoding='utf-8').read().strip()
        if len(text) > LIMIT:
            raise SystemExit(f'{code}.md: {len(text)} characters > {LIMIT}')
        items.append({'code': code, 'name': NAMES[code], 'rtl': code in RTL, 'text': text})
    data = json.dumps(items, ensure_ascii=False).replace('</', '<\\/')
    with open(OUT, 'w', encoding='utf-8') as f:
        f.write(PAGE.replace('__DATA__', data).replace('__LIMIT__', str(LIMIT)))
    print(f'{os.path.relpath(OUT, ROOT)}: {len(items)} languages')


if __name__ == '__main__':
    main()
