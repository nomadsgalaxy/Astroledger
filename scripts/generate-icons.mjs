// Regenerate every raster logo touchpoint from the canonical SVG marks.
// Run after ANY change to the logo so the favicon, PWA app icons, maskable
// icon, and Apple touch icon all stay in lockstep with the vector source.
//
//   node scripts/generate-icons.mjs
//
// Sources (vector, hand-maintained — the single source of truth):
//   public/icons/astroledger-icon.svg      dark rounded square + orange mark
//   public/icons/astroledger-maskable.svg  full-bleed square, 40% safe zone
//
// Outputs (raster, generated — do not hand-edit):
//   public/icons/astroledger-{32,180,192,512}.png
//   public/icons/astroledger-maskable.png
//   public/favicon.ico   (PNG-in-ICO @ 16/32/48 — modern browsers + Windows)

import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ICONS = path.join(root, 'public', 'icons');
const iconSvg = readFileSync(path.join(ICONS, 'astroledger-icon.svg'));
const maskSvg = readFileSync(path.join(ICONS, 'astroledger-maskable.svg'));

// High render density so the small favicon sizes stay crisp (sharp rasterizes
// the SVG once at `density` DPI, then resizes down).
async function png(svg, size, outName) {
  await sharp(svg, { density: 512 })
    .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(path.join(ICONS, outName));
  return path.join(ICONS, outName);
}

async function pngBuffer(svg, size) {
  return sharp(svg, { density: 512 }).resize(size, size).png().toBuffer();
}

// Build a valid .ico that embeds PNG payloads (supported by every browser
// released in the last decade + Windows Explorer). Each directory entry points
// at a full PNG; no BMP/DIB encoding needed.
function buildIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // image type: 1 = icon
  header.writeUInt16LE(count, 4);
  const DIR = 16;
  const dir = Buffer.alloc(count * DIR);
  let offset = 6 + count * DIR;
  entries.forEach((e, i) => {
    const o = i * DIR;
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 0); // width (0 ⇒ 256)
    dir.writeUInt8(e.size >= 256 ? 0 : e.size, o + 1); // height
    dir.writeUInt8(0, o + 2);  // palette count
    dir.writeUInt8(0, o + 3);  // reserved
    dir.writeUInt16LE(1, o + 4);   // color planes
    dir.writeUInt16LE(32, o + 6);  // bits per pixel
    dir.writeUInt32LE(e.buf.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += e.buf.length;
  });
  return Buffer.concat([header, dir, ...entries.map(e => e.buf)]);
}

const out = [];
// PWA / app icons (rounded dark square variant)
out.push(await png(iconSvg, 192, 'astroledger-192.png'));
out.push(await png(iconSvg, 512, 'astroledger-512.png'));
out.push(await png(iconSvg, 180, 'astroledger-180.png')); // Apple touch icon
out.push(await png(iconSvg, 32,  'astroledger-32.png'));   // crisp small favicon
// Maskable (full-bleed, safe-zone scaled)
out.push(await png(maskSvg, 512, 'astroledger-maskable.png'));

// favicon.ico — 16/32/48 PNG-in-ICO from the dark-square mark.
const icoEntries = await Promise.all([16, 32, 48].map(async size => ({ size, buf: await pngBuffer(iconSvg, size) })));
const icoPath = path.join(root, 'public', 'favicon.ico');
writeFileSync(icoPath, buildIco(icoEntries));
out.push(icoPath);

// Open Graph / social-share image (1200×630). The mark on the brand-dark
// canvas with the wordmark + tagline — what link unfurls show in Slack,
// iMessage, X, etc. Bare mark uses currentColor, so we wrap it in a <g> that
// sets the accent.
const markPaths = `M50 2 L93.3 27 L93.3 73 L50 98 L6.7 73 L6.7 27 Z
  M82 50 A32 32 0 1 0 18 50 A32 32 0 1 0 82 50 Z
  M78 50 A28 28 0 1 0 22 50 A28 28 0 1 0 78 50 Z
  M50 30 L46 46 L30 50 L46 54 L50 70 L54 54 L70 50 L54 46 Z`;
const ogSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <rect width="1200" height="630" fill="#0a0a0a"/>
  <rect width="1200" height="6" y="624" fill="#FD5000"/>
  <g transform="translate(120 195) scale(2.4)">
    <path fill="#FD5000" fill-rule="evenodd" d="${markPaths}"/>
  </g>
  <text x="430" y="300" font-family="Arial, Helvetica, sans-serif" font-size="92" font-weight="800" fill="#ffffff" letter-spacing="-2">Astroledger</text>
  <text x="432" y="360" font-family="Arial, Helvetica, sans-serif" font-size="34" font-weight="500" fill="#FD5000">Engineering your money</text>
  <text x="432" y="408" font-family="Arial, Helvetica, sans-serif" font-size="24" font-weight="400" fill="#8a8a8a">Self-hosted personal finance · local-first · your data stays yours</text>
</svg>`);
const ogPath = path.join(root, 'public', 'icons', 'astroledger-og.png');
await sharp(ogSvg).png().toFile(ogPath);
out.push(ogPath);

console.log('Generated:');
for (const f of out) console.log('  ' + path.relative(root, f));
