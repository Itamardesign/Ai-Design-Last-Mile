/**
 * Packs extension/dist into a single .zip — the file the Chrome Web Store asks for, and the easiest
 * thing to hand a colleague who just wants to load it.
 *
 * Written against the ZIP spec directly rather than shelling out, because `zip` does not exist on a
 * default Windows install and this is the one build step a designer is most likely to run.
 *
 * Run with `node extension/zip.mjs` (after a build).
 */
import { deflateRawSync } from 'node:zlib';
import { createWriteStream } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');

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

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

/** MS-DOS date/time, which is what the format stores. */
function dosTime(date) {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() / 2);
  const day = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

const files = (await walk(dist)).sort();
if (!files.length) {
  console.error('extension/dist is empty — run `npm run build:extension` first.');
  process.exit(1);
}

const manifest = JSON.parse(await readFile(join(dist, 'manifest.json'), 'utf8'));
const outPath = join(here, `meraki-design-inspector-${manifest.version}.zip`);

const chunks = [];
const central = [];
let offset = 0;

for (const file of files) {
  const name = relative(dist, file).split(sep).join('/');
  const body = await readFile(file);
  const deflated = deflateRawSync(body, { level: 9 });
  // Storing is smaller than deflating for already-compressed bytes (the PNGs).
  const stored = deflated.length >= body.length;
  const payload = stored ? body : deflated;
  const { time, day } = dosTime((await stat(file)).mtime);
  const nameBytes = Buffer.from(name, 'utf8');

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(0, 6); // flags
  local.writeUInt16LE(stored ? 0 : 8, 8); // method
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(day, 12);
  local.writeUInt32LE(crc32(body), 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(body.length, 22);
  local.writeUInt16LE(nameBytes.length, 26);
  chunks.push(local, nameBytes, payload);

  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(0x02014b50, 0);
  entry.writeUInt16LE(20, 4); // version made by
  entry.writeUInt16LE(20, 6); // version needed
  entry.writeUInt16LE(0, 8);
  entry.writeUInt16LE(stored ? 0 : 8, 10);
  entry.writeUInt16LE(time, 12);
  entry.writeUInt16LE(day, 14);
  entry.writeUInt32LE(crc32(body), 16);
  entry.writeUInt32LE(payload.length, 20);
  entry.writeUInt32LE(body.length, 24);
  entry.writeUInt16LE(nameBytes.length, 28);
  entry.writeUInt32LE(offset, 42);
  central.push(Buffer.concat([entry, nameBytes]));

  offset += local.length + nameBytes.length + payload.length;
}

const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(files.length, 8);
end.writeUInt16LE(files.length, 10);
end.writeUInt32LE(directory.length, 12);
end.writeUInt32LE(offset, 16);

const stream = createWriteStream(outPath);
[...chunks, directory, end].forEach((chunk) => stream.write(chunk));
stream.end(() => console.log(`packed ${files.length} files -> ${relative(dirname(here), outPath)}`));
