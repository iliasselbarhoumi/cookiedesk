// Check store/listing.md and the store images against the Chrome Web Store limits
// before submitting. Dev-only, no network: npm run listing-check
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const listing = readFileSync(join(root, 'store/listing.md'), 'utf8');
const problems = [];
const ok = (cond, msg) => { if (!cond) problems.push(msg); };

// The description is the text between the two '---' lines under "### Description".
const descBlock = listing.split('### Description')[1] ?? '';
const desc = (descBlock.split('\n---\n')[1] ?? '').trim();
const block = (title) => (listing.split(title)[1] ?? '').match(/```\n([\s\S]*?)\n```/)?.[1] ?? '';

ok(manifest.name.length <= 75, `title is ${manifest.name.length} characters (max 75)`);
ok(manifest.description.length <= 132, `summary is ${manifest.description.length} characters (max 132)`);
ok(block('### Title') === manifest.name, 'listing title differs from manifest name');
ok(block('### Summary') === manifest.description, 'listing summary differs from manifest description');
ok(listing.includes(`dist/cookiedesk-${manifest.version}.zip`), `listing does not name dist/cookiedesk-${manifest.version}.zip`);
ok(desc.length > 500 && desc.length <= 16_000, `description is ${desc.length} characters (expected 500–16,000)`);
// Spec §11: the searched forms must appear in the description.
for (const k of ['cookie editor', 'edit cookies', 'cookie manager', 'view cookies', 'delete cookies', 'cookie viewer', 'partitioned cookie editor', 'edit httponly cookie']) {
  ok(desc.toLowerCase().includes(k), `description lacks "${k}"`);
}
ok(/Not affiliated with Cookie-Editor or EditThisCookie/.test(desc), 'description lacks the "not affiliated" line');
ok(!/\*\*|```|^#{1,6} |\[[^\]]+\]\(/m.test(desc), 'description contains Markdown (the store shows plain text)');

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file) {
  const b = readFileSync(file);
  if (b.toString('ascii', 1, 4) !== 'PNG') return null;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}
function image(rel, w, h) {
  const f = join(root, rel);
  if (!existsSync(f)) return problems.push(`${rel} is missing`);
  const s = pngSize(f);
  ok(s && s[0] === w && s[1] === h, `${rel} is ${s?.join('×')} (needs ${w}×${h})`);
}
image('icons/icon-128.png', 128, 128);
image('store/promo-small.png', 440, 280);
image('store/promo-marquee.png', 1400, 560);
const shots = readdirSync(join(root, 'store/screenshots')).filter((f) => f.endsWith('.png')).sort();
ok(shots.length >= 1 && shots.length <= 5, `${shots.length} screenshots (1–5 allowed)`);
for (const s of shots) image(`store/screenshots/${s}`, 1280, 800);
for (const s of shots) ok(listing.includes(s), `listing doesn't mention screenshot ${s}`);

console.log(`title ${manifest.name.length}/75 · summary ${manifest.description.length}/132 · description ${desc.length}/16000 · ${shots.length} screenshots`);
if (problems.length) {
  console.log(problems.map((p) => `✗ ${p}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log('✓ listing and images are within the store limits');
}
