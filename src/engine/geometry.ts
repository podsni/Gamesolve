import { Point, Shape, ShapeType } from './types';

export function makeRectShape(
  id: number,
  cx: number,
  cy: number,
  w: number,
  h: number,
  angleDeg = 0,
  type: ShapeType = 'target'
): Shape {
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const hw = w * 0.5;
  const hh = h * 0.5;
  const local: Point[] = [
    { x: -hw, y: -hh },
    { x: hw, y: -hh },
    { x: hw, y: hh },
    { x: -hw, y: hh },
  ];

  return {
    id,
    type,
    vertices: local.map((p) => ({
      x: cx + p.x * cos - p.y * sin,
      y: cy + p.x * sin + p.y * cos,
    })),
    alive: true,
    flash: 0,
  };
}

/**
 * Creates a crisp right triangle with right angle at bottom-right.
 */
export function makeRightTriangle(
  id: number,
  x: number,
  y: number,
  size: number,
  type: ShapeType = 'target'
): Shape {
  return {
    id,
    type,
    vertices: [
      { x: x + size, y },
      { x: x + size, y: y + size },
      { x, y: y + size },
    ],
    alive: true,
    flash: 0,
  };
}

export function cloneShape(shape: Shape): Shape {
  return {
    ...shape,
    vertices: shape.vertices.map((v) => ({ x: v.x, y: v.y })),
  };
}

export function polygonCentroid(verts: Point[]): Point {
  let sx = 0;
  let sy = 0;
  const n = verts.length || 1;
  for (let i = 0; i < verts.length; i++) {
    sx += verts[i].x;
    sy += verts[i].y;
  }
  return { x: sx / n, y: sy / n };
}

export function polygonBounds(verts: Point[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const v of verts) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  return { minX, maxX, minY, maxY };
}

export function pointInPolygon(px: number, py: number, verts: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const xi = verts[i].x;
    const yi = verts[i].y;
    const xj = verts[j].x;
    const yj = verts[j].y;
    const intersect =
      yi > py !== yj > py &&
      px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function distPointToSegmentSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const wx = px - ax;
  const wy = py - ay;
  const c1 = wx * vx + wy * vy;
  if (c1 <= 0) return wx * wx + wy * wy;
  const c2 = vx * vx + vy * vy;
  if (c2 <= c1) {
    const dx = px - bx;
    const dy = py - by;
    return dx * dx + dy * dy;
  }
  const t = c1 / c2;
  const projX = ax + t * vx;
  const projY = ay + t * vy;
  const dx = px - projX;
  const dy = py - projY;
  return dx * dx + dy * dy;
}

export function translateShape(shape: Shape, dx: number, dy: number): void {
  for (const v of shape.vertices) {
    v.x += dx;
    v.y += dy;
  }
}

export function rotateShape(shape: Shape, angleDeg: number): void {
  const c = polygonCentroid(shape.vertices);
  const rad = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  shape.vertices = shape.vertices.map((v) => {
    const rx = v.x - c.x;
    const ry = v.y - c.y;
    return {
      x: c.x + rx * cos - ry * sin,
      y: c.y + rx * sin + ry * cos,
    };
  });
}

export function scaleShape(shape: Shape, factor: number): void {
  const c = polygonCentroid(shape.vertices);
  const b = polygonBounds(shape.vertices);
  const curSize = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  if ((factor < 1 && curSize < 14) || (factor > 1 && curSize > 340)) return;
  shape.vertices = shape.vertices.map((v) => ({
    x: c.x + (v.x - c.x) * factor,
    y: c.y + (v.y - c.y) * factor,
  }));
}

export function mirrorShapeX(shape: Shape): void {
  const c = polygonCentroid(shape.vertices);
  shape.vertices = shape.vertices
    .map((v) => ({
      x: c.x - (v.x - c.x),
      y: v.y,
    }))
    .reverse();
}

export function convexHull(points: Point[]): Point[] {
  if (points.length <= 3) return points;
  const pts = points
    .slice()
    .sort((a, b) => (a.x === b.x ? a.y - b.y : a.x - b.x));
  const cross = (o: Point, a: Point, b: Point) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

  const lower: Point[] = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Point[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function polygonArea(poly: Point[]): number {
  let area = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    area += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area) * 0.5;
}

export function computeMinAreaOBB(hull: Point[]): {
  area: number;
  corners: Point[] | null;
} {
  let minArea = Infinity;
  let bestCorners: Point[] | null = null;
  for (let i = 0; i < hull.length; i++) {
    const p1 = hull[i];
    const p2 = hull[(i + 1) % hull.length];
    const ex = p2.x - p1.x;
    const ey = p2.y - p1.y;
    const len = Math.hypot(ex, ey);
    if (len < 1e-6) continue;
    const ux = ex / len;
    const uy = ey / len;
    const vx = -uy;
    const vy = ux;
    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    for (const p of hull) {
      const u = p.x * ux + p.y * uy;
      const v = p.x * vx + p.y * vy;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < minArea) {
      minArea = area;
      bestCorners = [
        { x: minU * ux + minV * vx, y: minU * uy + minV * vy },
        { x: maxU * ux + minV * vx, y: maxU * uy + minV * vy },
        { x: maxU * ux + maxV * vx, y: maxU * uy + maxV * vy },
        { x: minU * ux + maxV * vx, y: minU * uy + maxV * vy },
      ];
    }
  }
  return { area: minArea, corners: bestCorners };
}

export function simplifyConvexPolygon(
  hull: Point[],
  targetMaxVerts = 6,
  minAreaLossRatio = 0.018
): Point[] {
  const poly = hull.slice();
  const totalArea = polygonArea(poly);
  if (totalArea < 1) return poly;

  while (poly.length > 3) {
    let minTriArea = Infinity;
    let removeIdx = -1;
    for (let i = 0; i < poly.length; i++) {
      const prev = poly[(i - 1 + poly.length) % poly.length];
      const curr = poly[i];
      const next = poly[(i + 1) % poly.length];
      const triArea =
        Math.abs(
          (curr.x - prev.x) * (next.y - prev.y) -
            (curr.y - prev.y) * (next.x - prev.x)
        ) * 0.5;
      if (triArea < minTriArea) {
        minTriArea = triArea;
        removeIdx = i;
      }
    }
    if (
      poly.length > targetMaxVerts ||
      minTriArea / totalArea < minAreaLossRatio
    ) {
      poly.splice(removeIdx, 1);
    } else {
      break;
    }
  }
  return poly;
}

export function normalizeAngleDeg(angleRad: number): number {
  return ((((angleRad * 180) / Math.PI) % 360) + 360) % 360;
}

export function angleToCompassText(deg: number): string {
  const dirs = [
    'Kanan →',
    'Kanan-Bawah ↘',
    'Bawah ↓',
    'Kiri-Bawah ↙',
    'Kiri ←',
    'Kiri-Atas ↖',
    'Atas ↑',
    'Kanan-Atas ↗',
  ];
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}
