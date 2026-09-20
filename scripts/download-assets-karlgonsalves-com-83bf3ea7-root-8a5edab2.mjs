// Asset downloader for karlgonsalves.com clone (/ route)
// Usage: node scripts/download-assets-karlgonsalves-com-83bf3ea7-root-8a5edab2.mjs
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const SITE_KEY = 'karlgonsalves-com-83bf3ea7';
const PAGE_KEY = 'root-8a5edab2';
const BASE = 'https://karlgonsalves.com';
const OUT = join('public', 'sites', SITE_KEY, PAGE_KEY);

const ASSETS = [
  // CSS background art
  ['images/01-01.png', 'images/building_a.png'],
  ['images/02-01.png', 'images/building_b.png'],
  ['images/03-01.png', 'images/building_c.png'],
  ['images/04-01.png', 'images/building_d.png'],
  ['images/lamp_01.png', 'images/lamp_01.png'],
  ['images/cloud_01.png', 'images/cloud_01.png'],
  ['images/cloud_02.png', 'images/cloud_02.png'],
  ['images/cloud_03.png', 'images/cloud_03.png'],
  ['images/cloud_04.png', 'images/cloud_04.png'],
  ['images/cloud_05.png', 'images/cloud_05.png'],
  ['images/balloon.png', 'images/balloon.png'],
  // Content images
  ['images/vimeo_logo.png', 'images/vimeo_logo.png'],
  ['images/vimeo_logo-p-500.png', 'images/vimeo_logo-p-500.png'],
  // SEO / meta
  ['images/favicon.png', 'seo/favicon.png'],
  ['images/webclip.png', 'seo/webclip.png'],
];

async function download([src, dest]) {
  const url = `${BASE}/${src}`;
  const target = join(OUT, dest);
  const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, buf);
  return { src, dest, bytes: buf.length };
}

const BATCH = 4;
const results = [];
for (let i = 0; i < ASSETS.length; i += BATCH) {
  const batch = ASSETS.slice(i, i + BATCH);
  const settled = await Promise.allSettled(batch.map(download));
  settled.forEach((r, idx) => {
    if (r.status === 'fulfilled') {
      results.push(r.value);
      console.log(`ok   ${r.value.dest} (${r.value.bytes} bytes)`);
    } else {
      console.error(`FAIL ${batch[idx][0]}: ${r.reason.message}`);
    }
  });
}

console.log(`\n${results.length}/${ASSETS.length} assets downloaded into ${OUT}`);
