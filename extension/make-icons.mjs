/**
 * Draws the toolbar icons.
 *
 * Written by hand rather than exported from a design file for one reason: an extension is
 * unloadable without its PNGs, and a build that can produce them from nothing means `git clone &&
 * npm run build:extension` always ends in something you can load. Four sizes, drawn from the same
 * maths so the mark stays centred and the brackets stay crisp at 16px.
 *
 * Run with `node extension/make-icons.mjs`.
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ACCENT = [0x8b, 0x5c, 0xf6];
const INK = [0xff, 0xff, 0xff];

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, pixels) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // truecolour with alpha
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 4 + 1)] = 0; // no per-scanline filter
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Distance-based coverage, so edges are antialiased instead of stepped. */
const coverage = (distance) => Math.max(0, Math.min(1, 0.5 - distance));

/** Signed distance to a rounded square centred in the icon. */
function roundedSquare(x, y, size, inset, radius) {
  const half = size / 2 - inset;
  const dx = Math.abs(x - size / 2) - (half - radius);
  const dy = Math.abs(y - size / 2) - (half - radius);
  const outside = Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
  return outside + Math.min(Math.max(dx, dy), 0) - radius;
}

/**
 * The mark: a selection frame with a filled centre — the two things the tool does, picking an
 * element and changing it.
 */
function draw(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const inset = size * 0.055;
  const radius = size * 0.24;
  const bracket = size * 0.185; // arm length
  const stroke = Math.max(1, Math.round(size * 0.085));
  const frameInset = size * 0.26;
  const dot = size * 0.115;

  const blend = (index, color, alpha) => {
    if (alpha <= 0) return;
    for (let channel = 0; channel < 3; channel += 1) {
      const existing = pixels[index + channel];
      pixels[index + channel] = Math.round(existing * (1 - alpha) + color[channel] * alpha);
    }
    pixels[index + 3] = Math.round(pixels[index + 3] * (1 - alpha) + 255 * alpha);
  };

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const index = (y * size + x) * 4;
      const px = x + 0.5;
      const py = y + 0.5;

      blend(index, ACCENT, coverage(roundedSquare(px, py, size, inset, radius)));

      // Four corner brackets, drawn as the union of eight short bars.
      const left = frameInset;
      const right = size - frameInset;
      let markAlpha = 0;
      for (const [ax, ay, horizontal] of [
        [left, left, true],
        [left, left, false],
        [right, left, true],
        [right, left, false],
        [left, right, true],
        [left, right, false],
        [right, right, true],
        [right, right, false],
      ]) {
        const towardsCentre = (value, edge) => (edge < size / 2 ? value - edge : edge - value);
        const along = horizontal ? towardsCentre(px, ax) : towardsCentre(py, ay);
        const across = horizontal ? py - ay : px - ax;
        if (along < -stroke / 2 || along > bracket) continue;
        const distance = Math.max(Math.abs(across) - stroke / 2, -along - stroke / 2, along - bracket);
        markAlpha = Math.max(markAlpha, coverage(distance));
      }
      blend(index, INK, markAlpha);

      // Centre dot: what you have selected.
      blend(index, INK, coverage(Math.hypot(px - size / 2, py - size / 2) - dot));
    }
  }
  return pixels;
}

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'icons');
mkdirSync(outDir, { recursive: true });
for (const size of [16, 32, 48, 128]) {
  writeFileSync(join(outDir, `${size}.png`), png(size, draw(size)));
}
console.log('wrote extension/icons/{16,32,48,128}.png');
