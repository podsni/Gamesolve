import { ImageRect, LOGICAL_H, LOGICAL_W, Point, Shape, ShapeType } from './types';
import {
  computeMinAreaOBB,
  convexHull,
  polygonArea,
  polygonCentroid,
  simplifyConvexPolygon,
} from './geometry';

export interface CVExtractParams {
  img: HTMLImageElement;
  detectSensitivity: number;
  ignoreStatusBars: boolean;
  swapTargetWall: boolean;
  allocateId: () => number;
}

export interface CVExtractResult {
  bgColor: string;
  uploadedRect: ImageRect;
  shapes: Shape[];
  targetCount: number;
  thinTargetCount: number;
  wallCount: number;
}

export interface CVRawBufferParams {
  imgData: Uint8ClampedArray;
  pw: number;
  ph: number;
  detectSensitivity: number;
  ignoreStatusBars: boolean;
  swapTargetWall: boolean;
  allocateId: () => number;
}

/**
 * Ensures ultra-thin 4-corner bars/lines keep a minimum logical thickness
 * so physics outward normals and Canvas rendering remain crisp without bloating gaps.
 */
function ensureMinBarThickness(verts: Point[], minThickness = 1.4): Point[] {
  if (verts.length !== 4) return verts;
  const e0x = verts[1].x - verts[0].x;
  const e0y = verts[1].y - verts[0].y;
  const len0 = Math.hypot(e0x, e0y);
  const e1x = verts[2].x - verts[1].x;
  const e1y = verts[2].y - verts[1].y;
  const len1 = Math.hypot(e1x, e1y);
  if (len0 < 1e-4 || len1 < 1e-4) return verts;

  const shortLen = Math.min(len0, len1);
  if (shortLen >= minThickness) return verts;

  const cent = polygonCentroid(verts);
  // Unit vector along short axis
  const sx = len0 < len1 ? e0x / len0 : e1x / len1;
  const sy = len0 < len1 ? e0y / len0 : e1y / len1;
  const halfDelta = (minThickness - shortLen) * 0.5;

  return verts.map((v) => {
    const proj = (v.x - cent.x) * sx + (v.y - cent.y) * sy;
    const sign = proj >= 0 ? 1 : -1;
    return {
      x: v.x + sx * sign * halfDelta,
      y: v.y + sy * sign * halfDelta,
    };
  });
}

/**
 * Pure pixel-buffer CV extractor (also unit-testable in Node without DOM Canvas).
 * Preserves ultra-thin target lines (even 1–2px thick) using outer pixel-corner hulls
 * and thin-line aspect-aware acceptance rules while rejecting subtle drop shadows.
 */
export function extractShapesFromImageData({
  imgData,
  pw,
  ph,
  detectSensitivity,
  ignoreStatusBars,
  swapTargetWall,
  allocateId,
}: CVRawBufferParams): CVExtractResult {
  const topCut = ignoreStatusBars ? Math.floor(ph * 0.055) : 0;
  const botCut = ignoreStatusBars ? Math.floor(ph * 0.945) : ph;

  // 1. Dominant background color (quantized 3-bit histogram)
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  const sampleStep = pw > 350 ? 3 : 2;
  for (let y = topCut; y < botCut; y += sampleStep) {
    for (let x = 0; x < pw; x += sampleStep) {
      const idx = (y * pw + x) * 4;
      const r = imgData[idx];
      const g = imgData[idx + 1];
      const b = imgData[idx + 2];
      const key = `${r >> 3},${g >> 3},${b >> 3}`;
      const entry = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      entry.count++;
      entry.r += r;
      entry.g += g;
      entry.b += b;
      buckets.set(key, entry);
    }
  }
  let bgEntry = { count: 1, r: 63, g: 73, b: 87 };
  for (const entry of buckets.values()) {
    if (entry.count > bgEntry.count) bgEntry = entry;
  }
  const bgR = Math.round(bgEntry.r / bgEntry.count);
  const bgG = Math.round(bgEntry.g / bgEntry.count);
  const bgB = Math.round(bgEntry.b / bgEntry.count);
  const bgLum = 0.299 * bgR + 0.587 * bgG + 0.114 * bgB;
  const bgColor = `rgb(${bgR}, ${bgG}, ${bgB})`;

  // 2. Foreground classification (target = 1, wall = 2, bg = 0)
  const labels = new Uint8Array(pw * ph);
  const sensSq = detectSensitivity * detectSensitivity * 3 * 0.65;
  const lightBg = bgLum > 195;

  for (let y = topCut; y < botCut; y++) {
    for (let x = 0; x < pw; x++) {
      const pIdx = y * pw + x;
      const idx = pIdx * 4;
      const r = imgData[idx];
      const g = imgData[idx + 1];
      const b = imgData[idx + 2];
      const dr = r - bgR;
      const dg = g - bgG;
      const db = b - bgB;
      const distSq = dr * dr + dg * dg + db * db;
      const lum = 0.299 * r + 0.587 * g + 0.114 * b;

      // Also catch bright anti-aliased thin target pixels slightly softened by downsampling
      const isThinBrightTarget = !lightBg && lum >= bgLum + 42;
      if (distSq > sensSq || isThinBrightTarget) {
        let cls = !lightBg
          ? lum >= bgLum + 18 || lum > 175
            ? 1
            : 2
          : lum < 95
            ? 1
            : 2;
        if (swapTargetWall) cls = cls === 1 ? 2 : 1;
        labels[pIdx] = cls;
      }
    }
  }

  // 3. Connected Components + Outer-Corner Hull + Smart Rectangle / Triangle / Line Fitting
  const visited = new Uint8Array(pw * ph);
  const rawShapes: { type: ShapeType; poly: Point[] }[] = [];
  const minAreaPx = Math.max(30, Math.floor(pw * ph * 0.0003));
  const maxAreaPx = Math.floor(pw * ph * 0.45);
  const minThinLineLen = Math.max(20, Math.floor(pw * 0.075));
  const queueX = new Int32Array(pw * ph);
  const queueY = new Int32Array(pw * ph);
  const nbs: [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (let y = topCut; y < botCut; y++) {
    for (let x = 0; x < pw; x++) {
      const startIdx = y * pw + x;
      const cls = labels[startIdx];
      if (cls === 0 || visited[startIdx]) continue;

      let qHead = 0;
      let qTail = 0;
      queueX[qTail] = x;
      queueY[qTail] = y;
      qTail++;
      visited[startIdx] = 1;

      const boundary: Point[] = [];
      let minX = x;
      let maxX = x;
      let minY = y;
      let maxY = y;
      let pixelCount = 0;

      while (qHead < qTail) {
        const cx = queueX[qHead];
        const cy = queueY[qHead];
        qHead++;
        pixelCount++;
        if (cx < minX) minX = cx;
        if (cx > maxX) maxX = cx;
        if (cy < minY) minY = cy;
        if (cy > maxY) maxY = cy;

        let isBoundary = false;
        for (let k = 0; k < 4; k++) {
          const nx = cx + nbs[k][0];
          const ny = cy + nbs[k][1];
          if (nx < 0 || nx >= pw || ny < topCut || ny >= botCut) {
            isBoundary = true;
            continue;
          }
          const nIdx = ny * pw + nx;
          if (labels[nIdx] !== cls) {
            isBoundary = true;
          } else if (!visited[nIdx]) {
            visited[nIdx] = 1;
            queueX[qTail] = nx;
            queueY[qTail] = ny;
            qTail++;
          }
        }
        if (isBoundary) {
          // Push pixel outer corners so even 1px-thin lines yield a crisp non-degenerate 4-corner OBB
          boundary.push(
            { x: cx, y: cy },
            { x: cx + 1, y: cy },
            { x: cx + 1, y: cy + 1 },
            { x: cx, y: cy + 1 }
          );
        }
      }

      const bw = maxX - minX + 1;
      const bh = maxY - minY + 1;
      const maxDimComp = Math.max(bw, bh);
      const minDimComp = Math.min(bw, bh);
      const isThinLine =
        maxDimComp >= minThinLineLen &&
        minDimComp <= Math.max(8, Math.floor(maxDimComp * 0.14)) &&
        pixelCount >= Math.max(16, Math.floor(maxDimComp * 0.8));

      if ((!isThinLine && pixelCount < minAreaPx) || pixelCount > maxAreaPx) continue;
      if (bw > pw * 0.92 && bh > ph * 0.85) continue;

      const hull = convexHull(boundary);
      if (hull.length < 3) continue;

      const hullArea = polygonArea(hull);
      const obb = computeMinAreaOBB(hull);
      const rectangularity = obb.area > 1 ? pixelCount / obb.area : 0;

      const triPoly = simplifyConvexPolygon(hull, 3, 1.0);
      const triRatio = hullArea > 1 ? polygonArea(triPoly) / hullArea : 0;

      let finalPoly: Point[];
      if (isThinLine && obb.corners) {
        finalPoly = obb.corners;
      } else if (rectangularity >= 0.78 && obb.corners) {
        finalPoly = obb.corners;
      } else if (triRatio >= 0.88 && triPoly.length === 3) {
        finalPoly = triPoly;
      } else {
        finalPoly = simplifyConvexPolygon(hull, 6, 0.02);
      }

      rawShapes.push({
        type: cls === 1 ? 'target' : 'wall',
        poly: finalPoly,
      });
    }
  }

  // 4. Map to logical coordinates preserving aspect ratio
  const imgAspect = pw / ph;
  const stageAspect = LOGICAL_W / LOGICAL_H;
  let drawW: number;
  let drawH: number;
  let offsetX: number;
  let offsetY: number;
  if (imgAspect > stageAspect) {
    drawW = LOGICAL_W;
    drawH = LOGICAL_W / imgAspect;
    offsetX = 0;
    offsetY = (LOGICAL_H - drawH) * 0.5;
  } else {
    drawH = LOGICAL_H;
    drawW = LOGICAL_H * imgAspect;
    offsetX = (LOGICAL_W - drawW) * 0.5;
    offsetY = 0;
  }

  const uploadedRect: ImageRect = { x: offsetX, y: offsetY, w: drawW, h: drawH };
  const shapes: Shape[] = rawShapes.map((rs) => {
    const mapped = rs.poly.map((p) => ({
      x: offsetX + (p.x / pw) * drawW,
      y: offsetY + (p.y / ph) * drawH,
    }));

    // Classify ultra-thin elongated white lines as pass-through Okay? strings ("benang putih")
    let passThrough = false;
    if (rs.type === 'target' && mapped.length === 4) {
      const len0 = Math.hypot(mapped[1].x - mapped[0].x, mapped[1].y - mapped[0].y);
      const len1 = Math.hypot(mapped[2].x - mapped[1].x, mapped[2].y - mapped[1].y);
      const shortLen = Math.min(len0, len1);
      const longLen = Math.max(len0, len1);
      if (shortLen <= 6.5 && longLen >= 30 && longLen / Math.max(0.5, shortLen) >= 8) {
        passThrough = true;
      }
    }

    return {
      id: allocateId(),
      type: rs.type,
      vertices: ensureMinBarThickness(mapped, 1.4),
      alive: true,
      flash: 0,
      passThrough,
    };
  });

  const targetCount = shapes.filter((s) => s.type === 'target').length;
  const thinTargetCount = shapes.filter(
    (s) => s.type === 'target' && Boolean(s.passThrough)
  ).length;
  const wallCount = shapes.filter((s) => s.type === 'wall').length;

  return {
    bgColor,
    uploadedRect,
    shapes,
    targetCount,
    thinTargetCount,
    wallCount,
  };
}

export function extractShapesFromImage({
  img,
  detectSensitivity,
  ignoreStatusBars,
  swapTargetWall,
  allocateId,
}: CVExtractParams): CVExtractResult {
  const procCanvas = document.createElement('canvas');
  const procCtx = procCanvas.getContext('2d', { willReadFrequently: true });
  if (!procCtx) {
    return {
      bgColor: '#3f4957',
      uploadedRect: { x: 0, y: 0, w: LOGICAL_W, h: LOGICAL_H },
      shapes: [],
      targetCount: 0,
      thinTargetCount: 0,
      wallCount: 0,
    };
  }

  // Higher processing resolution (960px maxDim) preserves ultra-thin white lines and narrow obstacle gaps
  const maxDim = 960;
  const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
  const pw = Math.max(40, Math.round(img.width * scale));
  const ph = Math.max(40, Math.round(img.height * scale));

  procCanvas.width = pw;
  procCanvas.height = ph;
  procCtx.imageSmoothingEnabled = true;
  procCtx.imageSmoothingQuality = 'high';
  procCtx.drawImage(img, 0, 0, pw, ph);
  const imgData = procCtx.getImageData(0, 0, pw, ph).data;

  return extractShapesFromImageData({
    imgData,
    pw,
    ph,
    detectSensitivity,
    ignoreStatusBars,
    swapTargetWall,
    allocateId,
  });
}
