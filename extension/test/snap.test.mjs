/**
 * The snap engine behind canvas drags: edges meet edges, centres meet centres, equal gaps are
 * offered, and nothing snaps from further away than the threshold.
 *
 * Run with `node extension/test/snap.test.mjs`.
 */
import { build } from 'esbuild';
import { strict as assert } from 'node:assert';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';

const here = dirname(fileURLToPath(import.meta.url));
const outdir = mkdtempSync(join(tmpdir(), 'snap-test-'));
await build({
  entryPoints: [join(here, '..', '..', 'src', 'snap.ts')],
  outfile: join(outdir, 'snap.mjs'),
  format: 'esm',
  bundle: true,
  logLevel: 'silent',
});
const { computeSnap, findInsertion, measureBetween } = await import(pathToFileURL(join(outdir, 'snap.mjs')).href);

const box = (left, top, width = 100, height = 40) => ({ left, top, width, height });
const sibling = (rect) => ({ rect, kind: 'sibling' });
const parent = (rect) => ({ rect, kind: 'parent' });

// Left edge lines up with a sibling's left edge.
{
  const result = computeSnap(box(103, 300), [sibling(box(100, 0))], 4);
  assert.equal(result.dx, -3);
  assert.equal(result.dy, 0);
  assert.equal(result.guides.length, 1);
  assert.equal(result.guides[0].axis, 'x');
  assert.equal(result.guides[0].at, 100);
  assert.equal(result.guides[0].kind, 'edge');
  // The guide spans both boxes.
  assert.equal(result.guides[0].from, 0);
  assert.equal(result.guides[0].to, 340);
}

// Centres meet centres, not edges.
{
  const result = computeSnap(box(0, 200, 60, 40), [sibling(box(0, 0, 100, 40))], 4);
  // Candidate centre 30, sibling centre 50: too far. Left edges already match.
  assert.equal(result.dx, 0);
  const near = computeSnap(box(18, 200, 60, 40), [sibling(box(0, 0, 100, 40))], 4);
  assert.equal(near.dx, 2);
  assert.equal(near.guides[0].kind, 'center');
  assert.equal(near.guides[0].at, 50);
}

// Parent: centre snaps, edges are ignored.
{
  const container = parent(box(0, 0, 400, 400));
  const centred = computeSnap(box(152, 10), [container], 4);
  assert.equal(centred.dx, -2);
  assert.equal(centred.guides[0].kind, 'center');
  const atEdge = computeSnap(box(2, 100), [container], 4);
  assert.equal(atEdge.dx, 0);
  assert.equal(atEdge.guides.length, 0);
}

// Beyond the threshold nothing happens.
{
  const result = computeSnap(box(106, 300), [sibling(box(100, 0))], 4);
  assert.equal(result.dx, 0);
  assert.equal(result.guides.length, 0);
}

// The nearest match wins when several are close.
{
  const result = computeSnap(box(103, 300), [sibling(box(100, 0)), sibling(box(104, 0))], 4);
  assert.equal(result.dx, 1);
}

// Equal gaps: a box between two neighbours is nudged so both gaps match, with a label on each.
{
  const left = sibling(box(0, 0, 100, 40));
  const right = sibling(box(240, 0, 100, 40));
  // Gaps of 22 and 18 -> both 20.
  const result = computeSnap(box(122, 0), [left, right], 4);
  assert.equal(result.dx, -2);
  const gaps = result.guides.filter((guide) => guide.kind === 'gap');
  assert.equal(gaps.length, 2);
  assert.deepEqual(gaps.map((guide) => guide.label), ['20', '20']);
  assert.equal(gaps[0].from, 100);
  assert.equal(gaps[0].to, 120);
}

// Equal gaps only count between vertical neighbours that actually sit beside the box.
{
  const far = sibling(box(0, 500, 100, 40));
  const result = computeSnap(box(122, 0), [far, sibling(box(240, 0, 100, 40))], 4);
  assert.equal(result.guides.filter((guide) => guide.kind === 'gap').length, 0);
}

// Locking an axis leaves it alone.
{
  const result = computeSnap(box(103, 303), [sibling(box(100, 300))], 4, { lockY: true });
  assert.equal(result.dx, -3);
  assert.equal(result.dy, 0);
}

// Insertion in a row: the pointer in the near half of a sibling means "before it".
{
  const row = [box(0, 0), box(120, 0), box(240, 0)];
  assert.deepEqual(findInsertion({ x: 130, y: 20 }, row, 'row', 2).index, 1);
  assert.equal(findInsertion({ x: 130, y: 20 }, row, 'row', 2).guide.at, 120);
  assert.equal(findInsertion({ x: 130, y: 20 }, row, 'row', 2).guide.axis, 'x');
  // Past the middle of the same sibling means "after it" — which for the last item is a no-op.
  assert.equal(findInsertion({ x: 200, y: 20 }, row, 'row', 2).index, 2);
  // Moving the first item after the last: index counts with the dragged item removed.
  assert.equal(findInsertion({ x: 330, y: 20 }, row, 'row', 0).index, 2);
  assert.equal(findInsertion({ x: 330, y: 20 }, row, 'row', 0).guide.at, 340);
}

// Insertion in a column draws a horizontal line.
{
  const column = [box(0, 0), box(0, 60), box(0, 120)];
  const point = findInsertion({ x: 20, y: 62 }, column, 'column', 0);
  assert.equal(point.index, 0);
  assert.equal(point.guide.axis, 'y');
  assert.equal(point.guide.at, 60);
}

// No siblings, nothing to say.
assert.equal(findInsertion({ x: 0, y: 0 }, [box(0, 0)], 'row', 0), null);

// A single edge (zero-width candidate) snaps to edges without inventing gaps.
{
  const edge = computeSnap({ left: 203, top: 0, width: 0, height: 40 }, [sibling(box(0, 100, 200, 40)), sibling(box(300, 0, 100, 40))], 4, { lockY: true, gaps: false });
  assert.equal(edge.dx, -3);
  assert.equal(edge.guides.filter((guide) => guide.kind === 'gap').length, 0);
}

// Measuring: side by side gives one labelled line per axis of separation.
{
  const guides = measureBetween(box(0, 0), box(140, 0));
  assert.equal(guides.length, 1);
  assert.equal(guides[0].kind, 'measure');
  assert.equal(guides[0].axis, 'y');
  assert.equal(guides[0].label, '40');
  assert.equal(guides[0].from, 100);
  assert.equal(guides[0].to, 140);
  const diagonal = measureBetween(box(0, 0), box(140, 100));
  assert.deepEqual(diagonal.map((guide) => guide.label).sort(), ['40', '60']);
}

// Measuring a box inside another gives the four inner distances.
{
  const guides = measureBetween(box(20, 10, 60, 20), box(0, 0, 100, 40));
  assert.deepEqual(guides.map((guide) => guide.label), ['20', '20', '10', '10']);
}

console.log('snap: ok');
