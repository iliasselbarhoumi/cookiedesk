// Package the shippable extension: manifest.json, _locales/, src/, icons/ -> dist/cookiedesk-<version>.zip
// Nothing else goes in (no tests, docs or dev scripts). Rebuilds _locales and the store
// listing paste helper first, and refuses to package if a language is incomplete. Dev-only: npm run build
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
for (const p of ['icons/icon-16.png', 'icons/icon-48.png', 'icons/icon-128.png']) {
  if (!existsSync(join(root, p))) throw new Error(`${p} missing: run npm run icons`);
}
execFileSync('python3', ['i18n/build_locales.py'], { cwd: root, stdio: 'inherit' });
execFileSync('python3', ['scripts/build_paste_helper.py'], { cwd: root, stdio: 'inherit' });
mkdirSync(join(root, 'dist'), { recursive: true });
const zip = join(root, 'dist', `cookiedesk-${version}.zip`);
rmSync(zip, { force: true });
execFileSync('zip', ['-r', '-X', '-q', zip, 'manifest.json', '_locales', 'src', 'icons', '-x', '*.DS_Store'], { cwd: root, stdio: 'inherit' });
console.log(execFileSync('unzip', ['-l', zip], { encoding: 'utf8' }).split('\n').slice(-2).join('\n').trim());
console.log(zip);
