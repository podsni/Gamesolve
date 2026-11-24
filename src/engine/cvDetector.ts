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
 * Removes near-collinear intermediate vertices (turn angle < minTurnDeg)
 * so beveled trapezoids, pentagons, and hexagons have razor-sharp edges.
 */
function pruneNearCollinearVertices(poly: Point[], minTurnDeg = 8): Point[] {
  if (poly.length <= 3) return poly;
  const cosThresh = Math.cos((minTurnDeg * Math.PI) / 180);
  const out = poly.slice();
  let changed = true;
  while (changed && out.length > 3) {
    changed = false;
    for (let i = 0; i < out.length; i++) {
      const prev = out[(i - 1 + out.length) % out.length];
      const curr = out[i];
      const next = out[(i + 1) % out.length];
      const v1x = curr.x - prev.x;
      const v1y = curr.y - prev.y;
      const v2x = next.x - curr.x;
      const v2y = next.y - curr.y;
      const l1 = Math.hypot(v1x, v1y);
      const l2 = Math.hypot(v2x, v2y);
      if (l1 < 1e-4 || l2 < 1e-4) {
        out.splice(i, 1);
        changed = true;
        break;
      }
      const dot = (v1x * v2x + v1y * v2y) / (l1 * l2);
      if (dot >= cosThresh) {
        out.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return out;
}

/**
 * Pure pixel-buffer CV extractor (also unit-testable in Node without DOM Canvas).
 * - Automatically strips full-width top/bottom app UI toolbars & hollow button borders.
 * - Preserves 45° beveled trapezoids/pentagons/hexagons without crushing them into 90° boxes.
 * - Preserves ultra-thin white target strings (auto-classified as passThrough).
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
  // 1. Dominant background color sampled from central gameplay region (16%..82%)
  //    so full-width white/black UI toolbars at top/bottom never bias background detection.
  const bgSampleTop = Math.floor(ph * 0.16);
  const bgSampleBot = Math.floor(ph * 0.82);
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();
  const sampleStep = pw > 350 ? 3 : 2;
  for (let y = bgSampleTop; y < bgSampleBot; y += sampleStep) {
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

  const sensSq = detectSensitivity * detectSensitivity * 3 * 0.65;
  const lightBg = bgLum > 195;

  // 2. Active playfield vertical bounds (auto-crop full-width top/bottom app toolbars & banners)
  let topCut = ignoreStatusBars ? Math.floor(ph * 0.055) : 0;
  let botCut = ignoreStatusBars ? Math.floor(ph * 0.945) : ph;

  if (ignoreStatusBars) {
    const rowNonBgRatio = (y: number): number => {
      let nonBg = 0;
      let total = 0;
      for (let x = 0; x < pw; x += 2) {
        const idx = (y * pw + x) * 4;
        const dr = imgData[idx] - bgR;
        const dg = imgData[idx + 1] - bgG;
        const db = imgData[idx + 2] - bgB;
        if (dr * dr + dg * dg + db * db > sensSq * 0.6) nonBg++;
        total++;
      }
      return total > 0 ? nonBg / total : 0;
    };

    // Scan upward from bottom (up to 22% height) to strip full-width white/dark footer toolbars
    const minBotScan = Math.floor(ph * 0.78);
    let bottomBarTop = ph;
    let sawBottomBar = false;
    let gapAllowance = 0;
    for (let y = ph - 1; y >= minBotScan; y--) {
      if (rowNonBgRatio(y) >= 0.8) {
        sawBottomBar = true;
        bottomBarTop = y;
        gapAllowance = 0;
      } else if (sawBottomBar) {
        gapAllowance++;
        if (gapAllowance > 3) break;
      } else if (y < Math.floor(ph * 0.93)) {
        // No full-width bar near the bottom edge
        break;
      }
    }
    if (sawBottomBar) {
      botCut = Math.min(botCut, Math.max(minBotScan, bottomBarTop - 3));
    }

    // Scan downward from top (up to 15% height) to strip full-width top header/ad banners
    const maxTopScan = Math.floor(ph * 0.15);
    let topBarBot = 0;
    let sawTopBar = false;
    gapAllowance = 0;
    for (let y = 0; y < maxTopScan; y++) {
      if (rowNonBgRatio(y) >= 0.8) {
        sawTopBar = true;
        topBarBot = y;
        gapAllowance = 0;
      } else if (sawTopBar) {
        gapAllowance++;
        if (gapAllowance > 3) break;
      } else if (y > Math.floor(ph * 0.06)) {
        break;
      }
    }
    if (sawTopBar) {
      topCut = Math.max(topCut, Math.min(maxTopScan, topBarBot + 3));
    }
  }

  // 3. Foreground classification (target = 1, wall = 2, bg = 0)
  const labels = new Uint8Array(pw * ph);
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

  // 4. Connected Components + Solidity Filter + Exact Polygon / Bevel / OBB / Triangle Fitting
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
          // Outer pixel corners keep even 1px-thin lines non-degenerate
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
      // Reject edge-touching full-width UI strips if any remain
      if (
        ignoreStatusBars &&
        bw > pw * 0.9 &&
        (minY <= topCut + 2 || maxY >= botCut - 2)
      ) {
        continue;
      }

      const hull = convexHull(boundary);
      if (hull.length < 3) continue;

      const hullArea = polygonArea(hull);
      if (hullArea < 1) continue;

      const solidity = pixelCount / hullArea;
      // Reject hollow UI outlines (e.g. "watch ad for hint" button frame, outlined icons)
      if (!isThinLine && solidity < 0.45) continue;

      const obb = computeMinAreaOBB(hull);
      // Compare hullArea vs OBB area (rotation-invariant even on small tilted blocks,
      // while cleanly distinguishing true 90° rectangles from 45° beveled trapezoids/pentagons!)
      const hullRectRatio = obb.area > 1 ? hullArea / obb.area : 0;

      const triPoly = simplifyConvexPolygon(hull, 3, 1.0);
      const triRatio = polygonArea(triPoly) / hullArea;

      let finalPoly: Point[];
      if (isThinLine && obb.corners) {
        finalPoly = obb.corners;
      } else if (hullRectRatio >= 0.945 && solidity >= 0.82 && obb.corners) {
        finalPoly = obb.corners;
      } else if (triRatio >= 0.93 && triPoly.length === 3) {
        finalPoly = triPoly;
      } else {
        // Exact beveled / trapezoidal / polygonal contour preservation
        const simplified = simplifyConvexPolygon(hull, 8, 0.0045);
        finalPoly = pruneNearCollinearVertices(simplified, 8);
      }

      rawShapes.push({
        type: cls === 1 ? 'target' : 'wall',
        poly: finalPoly,
      });
    }
  }

  // 5. Map to logical coordinates preserving aspect ratio
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

  // Higher processing resolution (960px maxDim) preserves thin lines, narrow gaps & crisp 45° bevels
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
