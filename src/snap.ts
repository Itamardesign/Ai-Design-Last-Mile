/**
 * Snapping and smart guides for canvas drags — the Figma behaviour, on DOM boxes.
 *
 * Pure geometry: nothing here reads the document, so it is testable and the same maths serves the
 * framed canvas and the live page. Callers gather the candidate box and the boxes around it,
 * ask for a snap, and draw whatever guides come back.
 */

export type SnapRect = { left: number; top: number; width: number; height: number };

export type SnapTarget = {
  rect: SnapRect;
  /** The parent is a container to centre in and stay inside; siblings are things to line up with. */
  kind: 'sibling' | 'parent';
};

export type SnapGuide = {
  /** A vertical line (`x`) or a horizontal one (`y`). */
  axis: 'x' | 'y';
  /** Where the line sits on its axis. */
  at: number;
  /** Extent along the other axis. */
  from: number;
  to: number;
  /** `insert` is the reorder drop line; the rest are alignment guides. */
  kind: 'edge' | 'center' | 'gap' | 'insert';
  /** Distance readout for gap guides. */
  label?: string;
};

export type SnapResult = {
  /** How far the candidate should move to land on the snap; zero when nothing is close enough. */
  dx: number;
  dy: number;
  guides: SnapGuide[];
};

type AxisLine = { at: number; kind: 'edge' | 'center'; from: number; to: number };

/** The three lines a box offers on one axis: both edges and the middle. */
function linesOf(rect: SnapRect, axis: 'x' | 'y'): AxisLine[] {
  const start = axis === 'x' ? rect.left : rect.top;
  const size = axis === 'x' ? rect.width : rect.height;
  const crossStart = axis === 'x' ? rect.top : rect.left;
  const crossEnd = crossStart + (axis === 'x' ? rect.height : rect.width);
  return [
    { at: start, kind: 'edge', from: crossStart, to: crossEnd },
    { at: start + size / 2, kind: 'center', from: crossStart, to: crossEnd },
    { at: start + size, kind: 'edge', from: crossStart, to: crossEnd },
  ];
}

/** Candidate lines compared against a target's: edges meet edges, centres meet centres. */
function bestOnAxis(candidate: SnapRect, targets: SnapTarget[], axis: 'x' | 'y', threshold: number) {
  const mine = linesOf(candidate, axis);
  let best: { delta: number; guide: SnapGuide } | null = null;
  for (const target of targets) {
    for (const line of linesOf(target.rect, axis)) {
      // A parent's edges are not something to align with — an element sits inside them — but its
      // centre is the most asked-for snap of all.
      if (target.kind === 'parent' && line.kind === 'edge') continue;
      for (const own of mine) {
        if (own.kind !== line.kind) continue;
        const delta = line.at - own.at;
        if (Math.abs(delta) > threshold) continue;
        if (best && Math.abs(delta) >= Math.abs(best.delta)) continue;
        best = {
          delta,
          guide: {
            axis,
            at: line.at,
            from: Math.min(line.from, own.from),
            to: Math.max(line.to, own.to),
            kind: line.kind,
          },
        };
      }
    }
  }
  return best;
}

/** Whether two boxes share any span across the given axis — a gap only means something between neighbours. */
function overlapsAcross(a: SnapRect, b: SnapRect, axis: 'x' | 'y') {
  if (axis === 'x') return a.top < b.top + b.height && b.top < a.top + a.height;
  return a.left < b.left + b.width && b.left < a.left + a.width;
}

/**
 * Equal spacing: the nearest sibling on each side of the candidate along one axis. When the two
 * gaps can be made equal with a nudge inside the threshold, that nudge wins and both gaps get a
 * pink tick with the shared value.
 */
function equalGapOnAxis(candidate: SnapRect, targets: SnapTarget[], axis: 'x' | 'y', threshold: number) {
  const start = axis === 'x' ? candidate.left : candidate.top;
  const end = start + (axis === 'x' ? candidate.width : candidate.height);
  let before: SnapRect | null = null;
  let after: SnapRect | null = null;
  for (const target of targets) {
    if (target.kind !== 'sibling' || !overlapsAcross(candidate, target.rect, axis)) continue;
    const rect = target.rect;
    const rectStart = axis === 'x' ? rect.left : rect.top;
    const rectEnd = rectStart + (axis === 'x' ? rect.width : rect.height);
    if (rectEnd <= start && (!before || rectEnd > (axis === 'x' ? before.left + before.width : before.top + before.height))) before = rect;
    if (rectStart >= end && (!after || rectStart < (axis === 'x' ? after.left : after.top))) after = rect;
  }
  if (!before || !after) return null;
  const beforeEnd = axis === 'x' ? before.left + before.width : before.top + before.height;
  const afterStart = axis === 'x' ? after.left : after.top;
  const gapBefore = start - beforeEnd;
  const gapAfter = afterStart - end;
  const delta = (gapAfter - gapBefore) / 2;
  if (Math.abs(delta) > threshold) return null;
  const gap = Math.round(gapBefore + delta);
  const crossStart = axis === 'x' ? candidate.top : candidate.left;
  const crossMid = crossStart + (axis === 'x' ? candidate.height : candidate.width) / 2;
  const tick = (from: number, to: number): SnapGuide => ({ axis: axis === 'x' ? 'y' : 'x', at: crossMid, from, to, kind: 'gap', label: `${gap}` });
  return {
    delta,
    guides: [tick(beforeEnd, start + delta), tick(end + delta, afterStart)],
  };
}

/**
 * Where a dragged box should settle. Edge and centre alignment run first on each axis; equal
 * spacing is offered when nothing else is closer. The result is a delta, not a rect, so a caller
 * that only writes one axis can ignore the other.
 */
export function computeSnap(candidate: SnapRect, targets: SnapTarget[], threshold: number, options: { lockX?: boolean; lockY?: boolean } = {}): SnapResult {
  const guides: SnapGuide[] = [];
  let dx = 0;
  let dy = 0;
  if (!options.lockX) {
    const gap = equalGapOnAxis(candidate, targets, 'x', threshold);
    const line = bestOnAxis(candidate, targets, 'x', threshold);
    if (gap && (!line || Math.abs(gap.delta) <= Math.abs(line.delta))) { dx = gap.delta; guides.push(...gap.guides); }
    else if (line) { dx = line.delta; guides.push(line.guide); }
  }
  if (!options.lockY) {
    const gap = equalGapOnAxis(candidate, targets, 'y', threshold);
    const line = bestOnAxis(candidate, targets, 'y', threshold);
    if (gap && (!line || Math.abs(gap.delta) <= Math.abs(line.delta))) { dy = gap.delta; guides.push(...gap.guides); }
    else if (line) { dy = line.delta; guides.push(line.guide); }
  }
  // The guides were computed against the unsnapped box; shift the ones that follow it.
  const settled = { ...candidate, left: candidate.left + dx, top: candidate.top + dy };
  return { dx, dy, guides: guides.map((guide) => guide.kind === 'gap' ? guide : extendGuide(guide, settled)) };
}

/** A guide line should run through the settled box as well as the box it was matched against. */
function extendGuide(guide: SnapGuide, rect: SnapRect): SnapGuide {
  const from = guide.axis === 'x' ? rect.top : rect.left;
  const to = from + (guide.axis === 'x' ? rect.height : rect.width);
  return { ...guide, from: Math.min(guide.from, from), to: Math.max(guide.to, to) };
}

export type InsertionPoint = {
  /** Index into the sibling list the dragged element would take. */
  index: number;
  /** The line to draw: a vertical bar between row items, a horizontal one between stacked items. */
  guide: SnapGuide;
};

/**
 * Where a pointer would drop a reordered item among its siblings.
 *
 * Each sibling splits into a near half and a far half along the flow axis; the pointer in the near
 * half means "before this one", the far half "after". Wrapped rows and grids are handled by
 * choosing the sibling whose box is closest to the pointer first, so a drop between rows still
 * lands somewhere sensible.
 */
export function findInsertion(pointer: { x: number; y: number }, siblings: SnapRect[], flow: 'row' | 'column', currentIndex: number): InsertionPoint | null {
  if (!siblings.length) return null;
  let nearest = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  siblings.forEach((rect, index) => {
    if (index === currentIndex) return;
    const cx = Math.max(rect.left, Math.min(pointer.x, rect.left + rect.width));
    const cy = Math.max(rect.top, Math.min(pointer.y, rect.top + rect.height));
    const distance = Math.hypot(pointer.x - cx, pointer.y - cy);
    if (distance < nearestDistance) { nearestDistance = distance; nearest = index; }
  });
  if (nearest === -1) return null;
  const rect = siblings[nearest];
  const before = flow === 'row' ? pointer.x < rect.left + rect.width / 2 : pointer.y < rect.top + rect.height / 2;
  // Removing the dragged item first shifts every later index down by one.
  let index = before ? nearest : nearest + 1;
  if (currentIndex < index) index -= 1;
  const guide: SnapGuide = flow === 'row'
    ? { axis: 'x', at: before ? rect.left : rect.left + rect.width, from: rect.top, to: rect.top + rect.height, kind: 'insert' }
    : { axis: 'y', at: before ? rect.top : rect.top + rect.height, from: rect.left, to: rect.left + rect.width, kind: 'insert' };
  return { index, guide };
}
