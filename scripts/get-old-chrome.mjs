// Download Chrome for Testing builds that predate each partition API, for test 5
// (test/e2e/old-chrome.e2e.mjs). Dev-only; the extension itself never downloads.
//   116: below minimum_chrome_version; its cookies API returns partitioned cookies
//        unlabelled (FINDINGS §8), so the extension must refuse to load there
//   119: oldest supported: partitionKey, no hasCrossSiteAncestor
//   131: hasCrossSiteAncestor, no getPartitionKey
// Usage: npm run get-old-chrome   ->  .chrome-old/<version>/
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const OLD_VERSIONS = ['116.0.5845.96', '119.0.6045.105', '131.0.6778.264'];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OLD_DIR = join(root, '.chrome-old');

export function platform() {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
  if (process.platform === 'win32') return 'win64';
  return 'linux64';
}

/** Path of the Chrome binary for a downloaded version, or null. */
export function oldChromePath(version) {
  const p = platform();
  const base = join(OLD_DIR, version, `chrome-${p}`);
  const bin = p.startsWith('mac')
    ? join(base, 'Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing')
    : p === 'win64' ? join(base, 'chrome.exe') : join(base, 'chrome');
  return existsSync(bin) ? bin : null;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const v of OLD_VERSIONS) {
    if (oldChromePath(v)) { console.log(`have ${v}`); continue; }
    const dir = join(OLD_DIR, v);
    mkdirSync(dir, { recursive: true });
    const url = `https://storage.googleapis.com/chrome-for-testing-public/${v}/${platform()}/chrome-${platform()}.zip`;
    console.log(`downloading ${url}`);
    const zip = join(dir, 'chrome.zip');
    writeFileSync(zip, Buffer.from(await (await fetch(url)).arrayBuffer()));
    execFileSync('unzip', ['-q', zip], { cwd: dir });
    rmSync(zip);
  }
}
