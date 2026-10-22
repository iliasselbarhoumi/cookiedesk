// "No network calls. Ever." (BUILD_SPEC §0). Static guard over everything that ships.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}
const shipped = [join(root, 'manifest.json'), ...files(join(root, 'src'))].filter((f) => /\.(js|json|html|css)$/.test(f));

test('no network APIs or remote resources in shipped code', () => {
  const forbidden = [
    /\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /\bEventSource\b/, /sendBeacon/, /importScripts/,
    /\bnew\s+Image\s*\(/, /RTCPeerConnection/, /src\s*=\s*["']https?:/, /href\s*=\s*["']https?:/, /url\(\s*["']?https?:/,
    /@import\s+["']?https?:/, /fonts\.googleapis/, /favIconUrl/,
  ];
  for (const file of shipped) {
    const text = readFileSync(file, 'utf8');
    for (const re of forbidden) assert.ok(!re.test(text), `${file.slice(root.length + 1)} matches ${re}`);
  }
});

test('no console.log/info/debug under src/ (cookie data must not reach the console; error/warn allowed)', () => {
  const noisy = /\bconsole\.(log|info|debug)\b/;
  for (const file of files(join(root, 'src'))) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      assert.ok(!noisy.test(line), `${file.slice(root.length + 1)}:${i + 1} uses console.log/info/debug`);
    });
  }
});

test('manifest permissions are exactly the justified set', () => {
  const m = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
  assert.deepEqual([...m.permissions].sort(), ['activeTab', 'cookies', 'sidePanel', 'storage']);
  assert.deepEqual(m.optional_host_permissions, ['<all_urls>']);
  assert.equal(m.host_permissions, undefined);
  assert.equal(m.content_scripts, undefined);
  assert.equal(m.externally_connectable, undefined);
  assert.equal(m.web_accessible_resources, undefined);
  assert.equal(m.background.service_worker, 'src/background/sw.js');
  assert.equal(m.background.type, 'module');
});
