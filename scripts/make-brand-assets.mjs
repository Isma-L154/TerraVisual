// Renders the raster brand assets from their sources.
//
// The logo has exactly one source of truth, web/public/favicon.svg. Every PNG
// and the .ico are derived from it here rather than exported by hand, and the
// social card (web/brand/social-card.html) embeds it rather than copying it, so
// a change to the mark is a change to one file followed by one command:
//
//   node scripts/make-brand-assets.mjs
//
// Rasterising uses the Chromium that Playwright already installs for the
// browser suite. That renders the SVG exactly as a browser tab would, and it
// avoids adding an image-processing dependency for a job that runs only when
// the logo changes. The outputs are committed; nothing here runs in the build.

import { readFileSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const PUBLIC = new URL('../web/public/', import.meta.url);
const svg = readFileSync(new URL('favicon.svg', PUBLIC), 'utf8');

/**
 * `square` removes the rounded corners. iOS and Android apply their own mask to
 * home-screen icons, and a transparent corner under that mask shows up black.
 */
const PNGS = [
  { file: 'apple-touch-icon.png', size: 180, square: true },
  { file: 'icon-192.png', size: 192, square: false },
  { file: 'icon-512.png', size: 512, square: false },
];

// Legacy browsers and some crawlers only ever ask for /favicon.ico.
const ICO_SIZES = [16, 32, 48];

const browser = await chromium.launch();
const page = await browser.newPage();

async function render(size, square) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block;width:${size}px;height:${size}px}${
      square ? 'svg>rect:first-of-type{rx:0}' : ''
    }</style>${svg}`,
  );
  return page.screenshot({ omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}

for (const { file, size, square } of PNGS) {
  const png = await render(size, square);
  writeFileSync(new URL(file, PUBLIC), png);
  console.log(`${file}  ${size}×${size}  ${png.length} bytes`);
}

/*
 * An .ico is a small directory followed by the images. Since Windows Vista the
 * images may be PNGs, which every browser that still asks for an .ico reads,
 * so there is no bitmap encoding to do — only the directory.
 */
const images = [];
for (const size of ICO_SIZES) images.push({ size, data: await render(size, false) });

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);

let offset = 6 + 16 * images.length;
const entries = images.map(({ size, data }) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size % 256, 0); // width; 0 would mean 256
  entry.writeUInt8(size % 256, 1); // height
  entry.writeUInt8(0, 2); // no palette
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += data.length;
  return entry;
});

const ico = Buffer.concat([header, ...entries, ...images.map(({ data }) => data)]);
writeFileSync(new URL('favicon.ico', PUBLIC), ico);
console.log(`favicon.ico  ${ICO_SIZES.join('/')}  ${ico.length} bytes`);

/*
 * The social card: what a shared link unfurls into. 1200×630 is the size Open
 * Graph and X's large card both expect; its source is ordinary HTML so it can
 * use the app's own palette and type.
 */
await page.setViewportSize({ width: 1200, height: 630 });
await page.goto(new URL('../web/brand/social-card.html', import.meta.url).href);
await page.waitForLoadState('load');
const card = await page.screenshot({ type: 'png' });
writeFileSync(new URL('og-image.png', PUBLIC), card);
console.log(`og-image.png  1200×630  ${card.length} bytes`);

await browser.close();
