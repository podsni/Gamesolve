import {
  EPS,
  HitEvent,
  LOGICAL_H,
  LOGICAL_W,
  MAX_BOUNCES,
  Point,
  Shape,
  SimResult,
} from './types';
import {
  distPointToSegmentSq,
  pointInPolygon,
  polygonCentroid,
} from './geometry';

export interface SegmentHit {
  t: number;
  nx: number;
  ny: number;
}

export interface ShapeCastHit extends SegmentHit {
  shapeIdx: number;
  shape: Shape;
}

export function isPointClearOfShapes(
  px: number,
  py: number,
  shapes: Shape[],
  radius: number
): boolean {
  const rSq = (radius + 0.35) * (radius + 0.35);
  for (const s of shapes) {
    if (s.alive === false) continue;
    const verts = s.vertices;
    if (pointInPolygon(px, py, verts)) return false;
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      if (distPointToSegmentSq(px, py, a.x, a.y, b.x, b.y) < rSq) return false;
    }
  }
  return true;
}

/**
 * Exact swept-circle collision test against a line segment + its two endpoints.
 * Fixes grazing contact tunneling when dist is slightly within [R - 0.08, R].
 */
export function rayCircleVsSegment(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  R: number
): SegmentHit | null {
  let bestT = Infinity;
  let bestNx = 0;
  let bestNy = 0;

  // 1. Segment body
  const ex = bx - ax;
  const ey = by - ay;
  const len = Math.hypot(ex, ey);
  if (len > 1e-6) {
    const tx = ex / len;
    const ty = ey / len;
    let nx = -ty;
    let ny = tx;
    let denom = dx * nx + dy * ny;
    if (denom > 0) {
      nx = -nx;
      ny = -ny;
      denom = -denom;
    }
    if (denom < -1e-8) {
      const dist = (ox - ax) * nx + (oy - ay) * ny;
      if (dist >= R - 0.08) {
        const rawT = (R - dist) / denom;
        const t = dist < R ? Math.max(EPS * 2, rawT) : rawT;
        if (t > EPS && t < bestT) {
          const hx = ox + dx * t;
          const hy = oy + dy * t;
          const proj = (hx - ax) * tx + (hy - ay) * ty;
          if (proj >= -1e-4 && proj <= len + 1e-4) {
            bestT = t;
            bestNx = nx;
            bestNy = ny;
          }
        }
      }
    }
  }

  // 2. Endpoint circles (handles sharp corners smoothly)
  const endpoints: [number, number][] = [
    [ax, ay],
    [bx, by],
  ];
  const rSq = R * R;
  for (let k = 0; k < 2; k++) {
    const vx = endpoints[k][0];
    const vy = endpoints[k][1];
    const fx = ox - vx;
    const fy = oy - vy;
    const bDot = fx * dx + fy * dy;
    if (bDot >= 0) continue; // Moving away
    const c = fx * fx + fy * fy - rSq;
    const disc = bDot * bDot - c;
    if (disc < 0) continue;
    const t = -bDot - Math.sqrt(disc);
    if (t > EPS && t < bestT) {
      const hx = ox + dx * t;
      const hy = oy + dy * t;
      const nx = (hx - vx) / R;
      const ny = (hy - vy) / R;
      if (dx * nx + dy * ny < -1e-6) {
        bestT = t;
        bestNx = nx;
        bestNy = ny;
      }
    }
  }

  return bestT < Infinity ? { t: bestT, nx: bestNx, ny: bestNy } : null;
}

export function castCircleAgainstShapes(
  ox: number,
  oy: number,
  dx: number,
  dy: number,
  shapes: Shape[],
  aliveArr: Uint8Array | null,
  radius: number
): ShapeCastHit | null {
  let best: ShapeCastHit | null = null;
  let bestT = Infinity;

  for (let sIdx = 0; sIdx < shapes.length; sIdx++) {
    if (aliveArr ? !aliveArr[sIdx] : shapes[sIdx].alive === false) continue;
    const verts = shapes[sIdx].vertices;
    const n = verts.length;

    for (let i = 0; i < n; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % n];
      const hit = rayCircleVsSegment(ox, oy, dx, dy, a.x, a.y, b.x, b.y, radius);
      if (hit && hit.t < bestT) {
        bestT = hit.t;
        best = {
          t: hit.t,
          nx: hit.nx,
          ny: hit.ny,
          shapeIdx: sIdx,
          shape: shapes[sIdx],
        };
      }
    }
  }
  return best;
}

export function computeExitDist(
  ox: number,
  oy: number,
  dx: number,
  dy: number
): number {
  const margin = 24;
  let tMax = 1200;
  if (dx > 1e-7) tMax = Math.min(tMax, (LOGICAL_W + margin - ox) / dx);
  else if (dx < -1e-7) tMax = Math.min(tMax, (-margin - ox) / dx);
  if (dy > 1e-7) tMax = Math.min(tMax, (LOGICAL_H + margin - oy) / dy);
  else if (dy < -1e-7) tMax = Math.min(tMax, (-margin - oy) / dy);
  return Math.max(0, tMax);
}

/**
 * Runs a deterministic continuous-collision simulation for a single shot.
 */
export function simulateShot(
  sx: number,
  sy: number,
  angle: number,
  shapes: Shape[],
  ballRadius: number,
  fastMode = false
): SimResult {
  const R = ballRadius;
  const alive = new Uint8Array(shapes.length);
  let totalTargets = 0;
  for (let i = 0; i < shapes.length; i++) {
    alive[i] = 1;
    if (shapes[i].type === 'target') totalTargets++;
  }

  let ox = sx;
  let oy = sy;
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  const points: Point[] = [{ x: ox, y: oy }];
  const hitEvents: HitEvent[] = [];
  let targetsHit = 0;
  let bounces = 0;
  let wallStreak = 0;
  let postWinSteps = 0;

  for (let step = 0; step < MAX_BOUNCES; step++) {
    const exitT = computeExitDist(ox, oy, dx, dy);
    const hit = castCircleAgainstShapes(ox, oy, dx, dy, shapes, alive, R);

    if (!hit || hit.t > exitT) {
      points.push({ x: ox + dx * exitT, y: oy + dy * exitT });
      break;
    }

    const hitX = ox + dx * hit.t;
    const hitY = oy + dy * hit.t;
    points.push({ x: hitX, y: hitY });

    const isPassThrough =
      hit.shape.type === 'target' && Boolean(hit.shape.passThrough);

    if (!isPassThrough) {
      bounces++;
    }

    hitEvents.push({
      pointIdx: points.length - 1,
      shapeId: hit.shape.id,
      hitX,
      hitY,
      type: hit.shape.type,
      passThrough: isPassThrough,
    });

    if (hit.shape.type === 'target') {
      alive[hit.shapeIdx] = 0;
      targetsHit++;
      wallStreak = 0;
    } else {
      wallStreak++;
      if (wallStreak > 24) break; // Prevent infinite wall traps
    }

    if (isPassThrough) {
      // Thin white string: cut/clear target and keep traveling straight through without bouncing
      ox = hitX + dx * 0.06;
      oy = hitY + dy * 0.06;
    } else {
      // Solid target or black wall: reflect velocity cleanly and normalize to avoid drift
      const dot = dx * hit.nx + dy * hit.ny;
      dx = dx - 2 * dot * hit.nx;
      dy = dy - 2 * dot * hit.ny;
      const mag = Math.hypot(dx, dy) || 1;
      dx /= mag;
      dy /= mag;

      // Tiny normal offset prevents immediate re-intersection on the same surface
      ox = hitX + hit.nx * 0.06;
      oy = hitY + hit.ny * 0.06;
    }

    // If all targets are cleared, let ball continue briefly for clean exit
    if (targetsHit === totalTargets && totalTargets > 0) {
      if (fastMode) break;
      postWinSteps++;
      if (postWinSteps >= 3) {
        const remExit = computeExitDist(ox, oy, dx, dy);
        points.push({
          x: ox + dx * Math.min(remExit, 180),
          y: oy + dy * Math.min(remExit, 180),
        });
        break;
      }
    }
  }

  const solved = totalTargets > 0 && targetsHit === totalTargets;

  // Smooth heuristic score for solver optimization:
  // Measure closest approach of ANY trajectory segment to unhit target vertices/midpoints/centroid
  let proximityBonus = 0;
  if (!solved && totalTargets > 0 && points.length >= 2) {
    let minDSq = Infinity;
    for (let i = 0; i < shapes.length; i++) {
      if (!alive[i] || shapes[i].type !== 'target') continue;
      const verts = shapes[i].vertices;
      const c = polygonCentroid(verts);
      const vn = verts.length;

      for (let seg = 0; seg < points.length - 1; seg++) {
        const ax = points[seg].x;
        const ay = points[seg].y;
        const bx = points[seg + 1].x;
        const by = points[seg + 1].y;

        const dc = distPointToSegmentSq(c.x, c.y, ax, ay, bx, by);
        if (dc < minDSq) minDSq = dc;

        for (let v = 0; v < vn; v++) {
          const p0 = verts[v];
          const dv = distPointToSegmentSq(p0.x, p0.y, ax, ay, bx, by);
          if (dv < minDSq) minDSq = dv;
          const p1 = verts[(v + 1) % vn];
          const mx = (p0.x + p1.x) * 0.5;
          const my = (p0.y + p1.y) * 0.5;
          const dm = distPointToSegmentSq(mx, my, ax, ay, bx, by);
          if (dm < minDSq) minDSq = dm;
        }
      }
    }
    if (minDSq < Infinity) {
      const minD = Math.sqrt(minDSq);
      proximityBonus = Math.max(0, 650 - minD * 2.5);
    }
  }

  const score =
    (solved ? 500000 : 0) +
    targetsHit * 10000 +
    proximityBonus -
    bounces * 10 -
    (wallStreak > 16 ? 350 : 0);

  return {
    sx,
    sy,
    angle,
    points,
    hitEvents,
    targetsHit,
    totalTargets,
    bounces,
    solved,
    score,
  };
}
