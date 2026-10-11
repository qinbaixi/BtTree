/* global Buffer, console */
// Writes build/icon.png (512x512) and build/icon.ico from code: a rounded accent-blue square with a
// white tree glyph. Deterministic, so running it again rewrites identical files.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';

const buildDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'build');
const ACCENT = [59, 108, 246];
const WHITE = [255, 255, 255];

// Signed distance functions in unit coordinates (0..1 across the icon).
function circle(px, py, cx, cy, r) {
  return Math.hypot(px - cx, py - cy) - r;
}

function segment(px, py, ax, ay, bx, by, halfWidth) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const h = Math.min(1, Math.max(0, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * h, pay - bay * h) - halfWidth;
}

function roundedSquare(px, py, radius) {
  const qx = Math.abs(px - 0.5) - (0.5 - radius);
  const qy = Math.abs(py - 0.5) - (0.5 - radius);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
}

function glyph(px, py) {
  const edge = 0.045;
  return Math.min(
    circle(px, py, 0.5, 0.3, 0.095),
    circle(px, py, 0.29, 0.7, 0.08),
    circle(px, py, 0.71, 0.7, 0.08),
    segment(px, py, 0.5, 0.3, 0.29, 0.7, edge),
    segment(px, py, 0.5, 0.3, 0.71, 0.7, edge),
  );
}

/** Anti-aliased coverage of a shape whose signed distance is `distance` (in unit coordinates). */
function coverage(distance, size) {
  return Math.min(1, Math.max(0, 0.5 - distance * size));
}

function renderRgba(size) {
  const data = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / size;
      const py = (y + 0.5) / size;
      const shape = coverage(roundedSquare(px, py, 0.22), size);
      const mark = coverage(glyph(px, py), size);
      const i = (y * size + x) * 4;
      for (let c = 0; c < 3; c++) {
        data[i + c] = Math.round(ACCENT[c] + (WHITE[c] - ACCENT[c]) * mark);
      }
      data[i + 3] = Math.round(shape * 255);
    }
  }
  return data;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndData));
  return Buffer.concat([length, typeAndData, crc]);
}

function encodePng(size) {
  const rgba = renderRgba(size);
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // Filter type: none.
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // Bit depth.
  header[9] = 6; // Colour type: RGBA.
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** ICO container holding PNG images (supported by Windows Vista and later). */
function encodeIco(sizes) {
  const images = sizes.map((size) => ({ size, png: encodePng(size) }));
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, png }, i) => {
    const entry = 6 + i * 16;
    header[entry] = size >= 256 ? 0 : size;
    header[entry + 1] = size >= 256 ? 0 : size;
    header.writeUInt16LE(1, entry + 4); // Colour planes.
    header.writeUInt16LE(32, entry + 6); // Bits per pixel.
    header.writeUInt32LE(png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  return Buffer.concat([header, ...images.map((image) => image.png)]);
}

mkdirSync(buildDir, { recursive: true });
writeFileSync(join(buildDir, 'icon.png'), encodePng(512));
writeFileSync(join(buildDir, 'icon.ico'), encodeIco([16, 32, 48, 256]));
console.log(`icons written to ${buildDir}`);
