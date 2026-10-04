#!/usr/bin/env node
/**
 * Generates the extension icons (PNG, RGBA) with zero dependencies.
 *
 * Design: rounded-square accent background, white microphone capsule with a stand, and a small
 * recording dot. Rendering is done analytically with signed distance fields and 3×3
 * supersampling, then encoded as a minimal PNG (filter 0 + zlib deflate + CRC32).
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'src/assets/icons');
const SIZES = [16, 32, 48, 128];

/* ----------------------------- geometry helpers ----------------------------- */

const clamp01 = (v) => Math.min(1, Math.max(0, v));

function sdRoundedBox(px, py, cx, cy, halfW, halfH, radius) {
  const qx = Math.abs(px - cx) - (halfW - radius);
  const qy = Math.abs(py - cy) - (halfH - radius);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  return outside + Math.min(Math.max(qx, qy), 0) - radius;
}

function sdCircle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function sdCapsule(px, py, x0, y0, x1, y1, r) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - x0) * dx + (py - y0) * dy) / len2;
  t = Math.min(1, Math.max(0, t));
  return Math.hypot(px - (x0 + t * dx), py - (y0 + t * dy)) - r;
}

function sdRing(px, py, cx, cy, radius, thickness) {
  return Math.abs(sdCircle(px, py, cx, cy, radius)) - thickness;
}

/* --------------------------------- render --------------------------------- */

function renderIcon(size) {
  const SS = 3; // supersampling factor
  const scale = 1 / size;
  const pixels = new Uint8Array(size * size * 4);

  // normalized layout (design space is 0..1)
  const bg = { cx: 0.5, cy: 0.5, half: 0.5, radius: 0.24 };
  const capsule = { x: 0.5, y0: 0.24, y1: 0.52, r: 0.115 };
  const arc = { cx: 0.5, cy: 0.5, radius: 0.235, thickness: 0.032 };
  const stem = { x: 0.5, y0: 0.72, y1: 0.80, r: 0.028 };
  const dot = { cx: 0.76, cy: 0.24, r: 0.085 };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let bgCoverage = 0;
      let micCoverage = 0;
      let dotCoverage = 0;
      let arcCoverage = 0;
      let capsuleCoverage = 0;
      let stemCoverage = 0;

      for (let sy = 0; sy < SS; sy += 1) {
        for (let sx = 0; sx < SS; sx += 1) {
          const px = (x + (sx + 0.5) / SS) * scale;
          const py = (y + (sy + 0.5) / SS) * scale;

          const dBox = sdRoundedBox(px, py, bg.cx, bg.cy, bg.half, bg.half, bg.radius);
          const bgA = clamp01(0.5 - dBox * size * 1.6);
          bgCoverage += bgA;

          const dCapsule = sdCapsule(px, py, capsule.x, capsule.y0, capsule.x, capsule.y1, capsule.r);
          const capsuleA = clamp01(0.5 - dCapsule * size * 1.6);
          capsuleCoverage += capsuleA;
          micCoverage = Math.max(micCoverage, capsuleA);

          const dArc = sdRing(px, py, arc.cx, arc.cy, arc.radius, arc.thickness);
          // only the lower half of the ring is used (the mic holder)
          const arcA = py > 0.42 ? clamp01(0.5 - dArc * size * 1.6) : 0;
          arcCoverage += arcA;

          const dStem = sdCapsule(px, py, stem.x, stem.y0, stem.x, stem.y1, stem.r);
          const stemA = clamp01(0.5 - dStem * size * 1.6);
          stemCoverage += stemA;
          micCoverage = Math.max(micCoverage, stemA);

          const dDot = sdCircle(px, py, dot.cx, dot.cy, dot.r);
          const dotA = clamp01(0.5 - dDot * size * 1.6);
          dotCoverage = Math.max(dotCoverage, dotA);
        }
      }

      const samples = SS * SS;
      const bgA = clamp01(bgCoverage / samples);
      const white = clamp01((capsuleCoverage + stemCoverage) / samples);
      const holder = clamp01(arcCoverage / samples);
      const red = clamp01(dotCoverage / samples);

      // colors: background gradient (indigo -> violet), white mic, red recording dot
      const t = y / size;
      let r = Math.round(58 + 40 * t);
      let g = Math.round(96 - 10 * t);
      let b = Math.round(226 + 20 * t);
      const a = bgA;

      const solid = clamp01(Math.max(white, holder));
      if (solid > 0) {
        r = Math.round(r * (1 - solid) + 255 * solid);
        g = Math.round(g * (1 - solid) + 255 * solid);
        b = Math.round(b * (1 - solid) + 255 * solid);
      }
      if (red > 0) {
        r = Math.round(r * (1 - red) + 255 * red);
        g = Math.round(g * (1 - red) + 82 * red);
        b = Math.round(b * (1 - red) + 82 * red);
      }

      const idx = (y * size + x) * 4;
      pixels[idx] = r;
      pixels[idx + 1] = g;
      pixels[idx + 2] = b;
      pixels[idx + 3] = Math.round(a * 255);
    }
  }
  return pixels;
}

/* ---------------------------------- PNG ---------------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'latin1');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePng(pixels, size) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 6;   // color type RGBA
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace

  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(pixels.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

/* ---------------------------------- main ---------------------------------- */

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const pixels = renderIcon(size);
  const png = encodePng(pixels, size);
  const file = resolve(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, png);
  console.log(`icon${size}.png  ${png.length} bytes`);
}
console.log(`icons written to ${OUT_DIR}`);
