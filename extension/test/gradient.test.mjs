/**
 * The gradient model behind the builder: a computed background-image reads back into stops,
 * stops write out as CSS the browser accepts, and the round trip loses nothing.
 *
 * Run with `node extension/test/gradient.test.mjs`.
 */
import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const outdir = mkdtempSync(join(tmpdir(), 'gradient-test-'));
await build({
  entryPoints: [join(here, '..', '..', 'src', 'gradient.ts')],
  outfile: join(outdir, 'gradient.mjs'),
  format: 'esm',
  bundle: true,
  logLevel: 'silent',
});
const { parseGradient, serializeGradient, sampleGradient, reverseGradient, defaultGradient, splitTopLevel, sortStops } = await import(pathToFileURL(join(outdir, 'gradient.mjs')).href);

// What Chrome hands back as the computed value of a preset.
{
  const gradient = parseGradient('linear-gradient(135deg, rgb(102, 126, 234) 0%, rgb(118, 75, 162) 100%)');
  assert.equal(gradient.type, 'linear');
  assert.equal(gradient.angle, 135);
  assert.deepEqual(gradient.stops, [
    { color: '#667eea', alpha: 100, position: 0 },
    { color: '#764ba2', alpha: 100, position: 100 },
  ]);
}

// Hex, rgba and transparent stops keep their opacity apart from their colour.
{
  const gradient = parseGradient('linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, #ff000080 50%, transparent 100%)');
  assert.deepEqual(gradient.stops.map((stop) => stop.alpha), [0, 50, 0]);
  assert.equal(gradient.stops[1].color, '#ff0000');
}

// Keyword directions and missing positions fold onto the model's angle and evenly spread stops.
{
  const gradient = parseGradient('linear-gradient(to right, #fff, #000, #f00)');
  assert.equal(gradient.angle, 90);
  assert.deepEqual(gradient.stops.map((stop) => stop.position), [0, 50, 100]);
  assert.equal(parseGradient('linear-gradient(#fff, #000)').angle, 180);
}

// Radial and conic shapes are read and written back in a stable form.
{
  const radial = parseGradient('radial-gradient(circle at center center, rgb(255, 255, 255) 0%, rgb(0, 0, 0) 100%)');
  assert.equal(radial.type, 'radial');
  assert.equal(serializeGradient(radial), 'radial-gradient(circle at center, #ffffff 0%, #000000 100%)');
  const conic = parseGradient('conic-gradient(from 90deg at center center, rgb(255, 0, 0) 0%, rgb(0, 0, 255) 100%)');
  assert.equal(conic.type, 'conic');
  assert.equal(conic.angle, 90);
  assert.equal(serializeGradient(conic), 'conic-gradient(from 90deg at center, #ff0000 0%, #0000ff 100%)');
}

// The round trip is the identity on what the builder writes.
{
  const css = 'linear-gradient(45deg, #ff000080 10%, #00ff00 55.5%, #0000ff 90%)';
  assert.equal(serializeGradient(parseGradient(css)), css);
}

// Pictures, stacks of layers, patterns and nothing at all are not the builder's.
{
  assert.equal(parseGradient('none'), null);
  assert.equal(parseGradient('url("a.png")'), null);
  assert.equal(parseGradient('linear-gradient(#fff, #000), url("a.png")'), null);
  assert.equal(parseGradient('repeating-linear-gradient(45deg, #fff 0 10px, #000 10px 20px)'), null);
  assert.equal(parseGradient('linear-gradient(#fff)'), null);
  assert.equal(splitTopLevel('rgb(1, 2, 3) 0%, #fff 100%').length, 2);
}

// A stop added mid-bar starts as the colour already showing there.
{
  const gradient = parseGradient('linear-gradient(90deg, #000000 0%, #ffffff 100%)');
  assert.deepEqual(sampleGradient(gradient, 50), { color: '#808080', alpha: 100 });
  assert.deepEqual(sampleGradient(gradient, 0), { color: '#000000', alpha: 100 });
  assert.deepEqual(sampleGradient(gradient, 100), { color: '#ffffff', alpha: 100 });
}

// Reversing swaps the ends and mirrors the positions.
{
  const gradient = parseGradient('linear-gradient(90deg, #000000 20%, #ffffff 100%)');
  const reversed = reverseGradient(gradient);
  assert.deepEqual(reversed.stops, [
    { color: '#ffffff', alpha: 100, position: 0 },
    { color: '#000000', alpha: 100, position: 80 },
  ]);
}

// Reversing an out-of-order gradient (mid-drag order) still mirrors by position, and sorting settles it.
{
  const gradient = parseGradient('linear-gradient(90deg, #4facfe 0%, #00f2fe 100%, #29cefe 77%)');
  assert.deepEqual(reverseGradient(gradient).stops.map((stop) => [stop.color, stop.position]), [['#00f2fe', 0], ['#29cefe', 23], ['#4facfe', 100]]);
  assert.deepEqual(sortStops(gradient).stops.map((stop) => stop.position), [0, 77, 100]);
}

// A fresh gradient fades the fill colour to its own transparent.
{
  const gradient = defaultGradient('rgb(102, 126, 234)');
  assert.equal(serializeGradient(gradient), 'linear-gradient(180deg, #667eea 0%, #667eea00 100%)');
}

console.log('gradient: ok');
