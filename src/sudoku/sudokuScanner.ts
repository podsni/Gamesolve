import {
  BoxDims,
  createEmptyGrid,
  digitToSymbol,
  findConflicts,
  getBoxDims,
  getCageHeadCell,
  KillerCage,
  solveSudoku,
  SudokuGrid,
  SudokuSize,
  SudokuVariant,
  SUPPORTED_SUDOKU_SIZES,
} from './sudokuSolver';

export interface SudokuGridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SudokuScanOptions {
  /** Force a specific grid size, or `'auto'` to auto-detect among 4, 6, 8, 9, 12, 16 */
  sizeHint?: SudokuSize | 'auto';
  /** Force classic/killer mode, or `'auto'` to auto-detect dashed Killer cages */
  variantHint?: SudokuVariant | 'auto';
}

export interface SudokuScanResult {
  size: SudokuSize;
  boxDims: BoxDims;
  variant: SudokuVariant;
  board: SudokuGrid;
  cages: KillerCage[];
  confidences: number[][];
  gridRect: SudokuGridRect | null;
  detectedCount: number;
  detectedCageCount: number;
  imageWidth: number;
  imageHeight: number;
}

interface HoleInfo {
  area: number;
  cyNorm: number; // 0 (top) .. 1 (bottom)
  cxNorm: number; // 0 (left) .. 1 (right)
}

interface GlyphSignature {
  /** Symbol code: 0 = '0', 1..9 = '1'..'9', 10..16 = 'A'..'G' */
  code: number;
  pixels: Float32Array; // 24x24 zero-mean unit-norm vector
  binary: Uint8Array;   // 24x24 binary mask (0 or 1)
  aspect: number;       // original bbox w / h
  holes: HoleInfo[];
  leftStraightness: number; // fraction of vertical left-column pixels filled
  bottomRightMass: number;  // fraction of bottom-right quadrant filled
  midRightMass: number;     // fraction of right-middle band filled
  centerHollow: boolean;    // true when center is empty and surrounded on 4 sides (helps tiny '0')
}

const GLYPH_SIZE = 24;

function analyzeGlyphHoles(binary: Uint8Array, size: number): HoleInfo[] {
  const pw = size + 2;
  const ph = size + 2;
  const pad = new Uint8Array(pw * ph);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      pad[(y + 1) * pw + (x + 1)] = binary[y * size + x];
    }
  }

  const visited = new Uint8Array(pw * ph);
  const qx = new Int32Array(pw * ph);
  const qy = new Int32Array(pw * ph);

  const bfs = (sx: number, sy: number) => {
    let head = 0;
    let tail = 0;
    qx[tail] = sx;
    qy[tail] = sy;
    tail++;
    visited[sy * pw + sx] = 1;
    let count = 0;
    let sumX = 0;
    let sumY = 0;

    while (head < tail) {
      const cx = qx[head];
      const cy = qy[head];
      head++;
      count++;
      sumX += cx - 1;
      sumY += cy - 1;

      const dirs: [number, number][] = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ];
      for (const [dx, dy] of dirs) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || nx >= pw || ny < 0 || ny >= ph) continue;
        const nIdx = ny * pw + nx;
        if (!visited[nIdx] && pad[nIdx] === 0) {
          visited[nIdx] = 1;
          qx[tail] = nx;
          qy[tail] = ny;
          tail++;
        }
      }
    }
    return { count, sumX, sumY };
  };

  bfs(0, 0);

  const holes: HoleInfo[] = [];
  for (let y = 1; y <= size; y++) {
    for (let x = 1; x <= size; x++) {
      const idx = y * pw + x;
      if (pad[idx] === 0 && !visited[idx]) {
        const comp = bfs(x, y);
        if (comp.count >= 2) {
          holes.push({
            area: comp.count,
            cxNorm: comp.sumX / comp.count / size,
            cyNorm: comp.sumY / comp.count / size,
          });
        }
      }
    }
  }

  holes.sort((a, b) => a.cyNorm - b.cyNorm);
  return holes;
}

function buildGlyphSignatureFromCrop(
  crop: Float32Array,
  cw: number,
  ch: number,
  code: number
): GlyphSignature {
  const N = GLYPH_SIZE;
  const pad = 2;
  const targetBox = N - pad * 2;
  const scale = Math.min(targetBox / Math.max(1, cw), targetBox / Math.max(1, ch));
  const dw = cw * scale;
  const dh = ch * scale;
  const ox = (N - dw) * 0.5;
  const oy = (N - dh) * 0.5;

  const pixels = new Float32Array(N * N);
  const binary = new Uint8Array(N * N);

  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const sx = (x + 0.5 - ox) / scale - 0.5;
      const sy = (y + 0.5 - oy) / scale - 0.5;
      if (sx < -0.5 || sx > cw - 0.5 || sy < -0.5 || sy > ch - 0.5) continue;

      const x0 = Math.max(0, Math.min(cw - 1, Math.floor(sx)));
      const y0 = Math.max(0, Math.min(ch - 1, Math.floor(sy)));
      const x1 = Math.max(0, Math.min(cw - 1, x0 + 1));
      const y1 = Math.max(0, Math.min(ch - 1, y0 + 1));
      const fx = Math.max(0, Math.min(1, sx - x0));
      const fy = Math.max(0, Math.min(1, sy - y0));

      const v00 = crop[y0 * cw + x0];
      const v10 = crop[y0 * cw + x1];
      const v01 = crop[y1 * cw + x0];
      const v11 = crop[y1 * cw + x1];
      const v =
        (v00 * (1 - fx) + v10 * fx) * (1 - fy) +
        (v01 * (1 - fx) + v11 * fx) * fy;

      pixels[y * N + x] = v;
      binary[y * N + x] = v >= 0.45 ? 1 : 0;
    }
  }

  // Detect hollow ring center (catches small anti-aliased '0' even if 1px hole bridges)
  let cSum = 0;
  let cCnt = 0;
  for (let y = Math.floor(ch * 0.32); y <= Math.floor(ch * 0.68); y++) {
    for (let x = Math.floor(cw * 0.34); x <= Math.floor(cw * 0.66); x++) {
      cSum += crop[y * cw + x];
      cCnt++;
    }
  }
  const centerMean = cSum / Math.max(1, cCnt);
  const midX = Math.floor(cw * 0.5);
  const midY = Math.floor(ch * 0.5);
  const topEdge = Math.max(
    crop[midX],
    crop[Math.min(ch - 1, 1) * cw + midX]
  );
  const botEdge = Math.max(
    crop[(ch - 1) * cw + midX],
    crop[Math.max(0, ch - 2) * cw + midX]
  );
  const leftEdge = Math.max(
    crop[midY * cw],
    crop[midY * cw + Math.min(cw - 1, 1)]
  );
  const rightEdge = Math.max(
    crop[midY * cw + (cw - 1)],
    crop[midY * cw + Math.max(0, cw - 2)]
  );
  const minRingEdge = Math.min(topEdge, botEdge, leftEdge, rightEdge);
  const centerHollow =
    cw / Math.max(1, ch) >= 0.48 &&
    ((centerMean < 0.32 && minRingEdge >= 0.38) ||
      (minRingEdge - centerMean >= 0.16 && centerMean < 0.45));

  // Structural cues on original tight crop (helps separate B vs 8, D vs 0, E vs F, C vs G)
  let leftHits = 0;
  const leftBandW = Math.max(1, Math.ceil(cw * 0.22));
  for (let y = 0; y < ch; y++) {
    let hit = false;
    for (let x = 0; x < leftBandW; x++) {
      if (crop[y * cw + x] >= 0.4) {
        hit = true;
        break;
      }
    }
    if (hit) leftHits++;
  }
  const leftStraightness = leftHits / Math.max(1, ch);

  let brSum = 0;
  let brTotal = 0;
  for (let y = Math.floor(ch * 0.72); y < ch; y++) {
    for (let x = Math.floor(cw * 0.55); x < cw; x++) {
      brSum += crop[y * cw + x];
      brTotal++;
    }
  }
  const bottomRightMass = brSum / Math.max(1, brTotal);

  let mrSum = 0;
  let mrTotal = 0;
  for (let y = Math.floor(ch * 0.42); y < Math.ceil(ch * 0.68); y++) {
    for (let x = Math.floor(cw * 0.52); x < cw; x++) {
      mrSum += crop[y * cw + x];
      mrTotal++;
    }
  }
  const midRightMass = mrSum / Math.max(1, mrTotal);

  // Zero-mean unit-norm for NCC
  let sum = 0;
  for (let i = 0; i < pixels.length; i++) sum += pixels[i];
  const mean = sum / pixels.length;
  let normSq = 0;
  for (let i = 0; i < pixels.length; i++) {
    pixels[i] -= mean;
    normSq += pixels[i] * pixels[i];
  }
  const invNorm = normSq > 1e-8 ? 1 / Math.sqrt(normSq) : 0;
  for (let i = 0; i < pixels.length; i++) pixels[i] *= invNorm;

  return {
    code,
    pixels,
    binary,
    aspect: cw / Math.max(1, ch),
    holes: analyzeGlyphHoles(binary, N),
    leftStraightness,
    bottomRightMass,
    midRightMass,
    centerHollow,
  };
}

let cachedAllTemplates: GlyphSignature[] | null = null;

/**
 * Generates multi-font sans-serif templates for codes 0..16 ('0'..'9', 'A'..'G').
 */
function getSymbolTemplates(): GlyphSignature[] {
  if (cachedAllTemplates) return cachedAllTemplates;
  const templates: GlyphSignature[] = [];
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return templates;

  const fontSpecs = [
    '400 44px "Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif',
    '500 44px -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, Arial, sans-serif',
    '400 44px Arial, Helvetica, sans-serif',
    '600 44px "Liberation Sans", "DejaVu Sans", sans-serif',
    '400 44px Verdana, Geneva, sans-serif',
    '400 44px "Century Gothic", "Avenir", "Futura", "Trebuchet MS", sans-serif',
    '500 44px "Quicksand", "Nunito", "Rubik", "Segoe UI", system-ui, sans-serif',
  ];

  for (const font of fontSpecs) {
    for (let code = 0; code <= 16; code++) {
      const ch = code === 0 ? '0' : digitToSymbol(code);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#000000';
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(ch, 32, 33);

      const d = ctx.getImageData(0, 0, 64, 64).data;
      let minX = 64;
      let maxX = -1;
      let minY = 64;
      let maxY = -1;
      for (let y = 0; y < 64; y++) {
        for (let x = 0; x < 64; x++) {
          const v = 1 - d[(y * 64 + x) * 4] / 255;
          if (v > 0.25) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < minX || maxY < minY) continue;
      const cw = maxX - minX + 1;
      const chBox = maxY - minY + 1;
      const crop = new Float32Array(cw * chBox);
      for (let y = 0; y < chBox; y++) {
        for (let x = 0; x < cw; x++) {
          crop[y * cw + x] = 1 - d[((minY + y) * 64 + (minX + x)) * 4] / 255;
        }
      }
      templates.push(buildGlyphSignatureFromCrop(crop, cw, chBox, code));
    }
  }

  cachedAllTemplates = templates;
  return templates;
}

function classifyGlyph(
  sig: GlyphSignature,
  templates: GlyphSignature[],
  allowedCodes: number[]
): {
  code: number;
  confidence: number;
  secondCode: number;
  secondConfidence: number;
} {
  const allowed = new Set(allowedCodes);
  const bestPerCode = new Float32Array(17).fill(-999);

  for (const tpl of templates) {
    if (!allowed.has(tpl.code)) continue;

    // 1. NCC similarity in [-1, 1]
    let dot = 0;
    const a = sig.pixels;
    const b = tpl.pixels;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];

    // 2. Aspect ratio penalty
    const aspectPenalty = Math.abs(sig.aspect - tpl.aspect) * 0.16;

    // 3. Structural + topological hole consistency
    let adjust = 0;
    const hCount = sig.holes.length;
    const tCount = tpl.holes.length;

    if (tpl.code === 8) {
      if (hCount === 2) adjust += 0.12;
      else if (hCount === 0) adjust -= 0.18;
      // '8' has curved waist on left, unlike straight-stem 'B'
      if (allowed.has(11) && sig.leftStraightness > 0.9) adjust -= 0.08;
    } else if (tpl.code === 11) {
      // 'B'
      if (hCount === 2) adjust += 0.12;
      else if (hCount === 0) adjust -= 0.18;
      if (sig.leftStraightness > 0.88) adjust += 0.08;
      else if (sig.leftStraightness < 0.72) adjust -= 0.1;
    } else if (tpl.code === 0) {
      if (hCount === 1) adjust += 0.14;
      else if (sig.centerHollow) adjust += 0.11;
      else adjust -= 0.08;
    } else if (tpl.code === 1) {
      if (hCount === 0 && !sig.centerHollow) adjust += 0.05;
      else if (hCount >= 1 || sig.centerHollow) adjust -= 0.16;
    } else if (tpl.code === 13) {
      // 'D'
      if (hCount === 1) adjust += 0.11;
      else if (hCount === 0) adjust -= 0.16;
      if (sig.leftStraightness > 0.88) adjust += 0.07;
    } else if (tpl.code === 10) {
      // 'A'
      if (hCount === 1 && sig.holes[0].cyNorm >= 0.25 && sig.holes[0].cyNorm <= 0.65) {
        adjust += 0.1;
      } else if (hCount >= 2) {
        adjust -= 0.14;
      }
      if (sig.leftStraightness > 0.9) adjust -= 0.08;
    } else if (tpl.code === 6) {
      if (hCount === 1 && sig.holes[0].cyNorm > 0.52) adjust += 0.12;
      else if (hCount === 1 && sig.holes[0].cyNorm < 0.42) adjust -= 0.16;
      else if (hCount === 2) adjust -= 0.12;
    } else if (tpl.code === 9) {
      if (hCount === 1 && sig.holes[0].cyNorm < 0.48) adjust += 0.12;
      else if (hCount === 1 && sig.holes[0].cyNorm > 0.58) adjust -= 0.16;
      else if (hCount === 2) adjust -= 0.12;
    } else if (tpl.code === 4) {
      if (hCount === 1 && sig.holes[0].cyNorm >= 0.3 && sig.holes[0].cyNorm <= 0.68) {
        adjust += 0.08;
      }
    } else if (tpl.code === 14) {
      // 'E' vs 'F': E has bottom horizontal bar (higher bottomRightMass)
      if (hCount === 0) adjust += 0.05;
      else adjust -= 0.12;
      if (sig.leftStraightness > 0.85) adjust += 0.04;
      if (sig.bottomRightMass > 0.14) adjust += 0.06;
      else adjust -= 0.08;
    } else if (tpl.code === 15) {
      // 'F' has open bottom-right
      if (hCount === 0) adjust += 0.05;
      else adjust -= 0.12;
      if (sig.leftStraightness > 0.85) adjust += 0.04;
      if (sig.bottomRightMass < 0.09) adjust += 0.06;
      else adjust -= 0.09;
    } else if (tpl.code === 12) {
      // 'C' vs 'G': C has lower right-middle mass
      if (hCount === 0) adjust += 0.05;
      else adjust -= 0.14;
      if (sig.midRightMass < 0.14) adjust += 0.05;
      else if (sig.midRightMass > 0.28) adjust -= 0.08;
    } else if (tpl.code === 16) {
      // 'G' has inward middle-right bar
      if (hCount === 0) adjust += 0.05;
      else if (hCount >= 2) adjust -= 0.16;
      if (sig.midRightMass > 0.2) adjust += 0.06;
      else if (sig.midRightMass < 0.11) adjust -= 0.08;
    } else if (tCount === 0) {
      if (hCount === 0) adjust += 0.05;
      else if (hCount >= 2) adjust -= 0.18;
      else if (hCount === 1) adjust -= 0.09;
    }

    const score = dot - aspectPenalty + adjust;
    if (score > bestPerCode[tpl.code]) {
      bestPerCode[tpl.code] = score;
    }
  }

  let bestCode = -1;
  let bestScore = -999;
  let secondCode = -1;
  let secondScore = -999;
  for (const code of allowedCodes) {
    const sc = bestPerCode[code];
    if (sc > bestScore) {
      secondScore = bestScore;
      secondCode = bestCode;
      bestScore = sc;
      bestCode = code;
    } else if (sc > secondScore) {
      secondScore = sc;
      secondCode = code;
    }
  }

  return {
    code: bestCode,
    confidence: Math.max(0, Math.min(1, bestScore)),
    secondCode,
    secondConfidence: Math.max(0, Math.min(1, secondScore)),
  };
}

interface DetectedGridInfo {
  rect: SudokuGridRect;
  size: SudokuSize;
  boxDims: BoxDims;
  isDarkTheme: boolean;
  bgLum: number;
}

/**
 * Evaluates how strongly a candidate `(size, boxDims)` matches the internal horizontal & vertical
 * grid lines inside `rect`, combining:
 * 1) Combined strong + fine-ridge line presence at all `k = 1..size-1` positions
 * 2) Midpoint & 1/3 interior suppression so divisors (4 or 8 on 16x16, 6 on 9x9) never win
 * 3) Continuous ink-weight box-divider contrast so thick box lines distinguish `9x9` vs `6x6`
 *    AND automatically separate `2x3` vs `3x2` (6x6), `2x4` vs `4x2` (8x8), `3x4` vs `4x3` (12x12)!
 */
function scoreCandidateGridSize(
  combRow: Float32Array,
  combCol: Float32Array,
  inkRow: Float32Array,
  inkCol: Float32Array,
  rect: SudokuGridRect,
  size: SudokuSize,
  boxDims: BoxDims,
  pw: number,
  ph: number
): number {
  const { boxRows, boxCols } = boxDims;
  const cellH = rect.h / size;
  const cellW = rect.w / size;
  const searchRadius = Math.max(2, Math.min(5, Math.round(Math.min(cellW, cellH) * 0.08)));

  let lineSum = 0;
  let lineWeightSum = 0;
  let missingLines = 0;

  let boxInkSum = 0;
  let boxInkCnt = 0;
  let thinInkSum = 0;
  let thinInkCnt = 0;

  for (let k = 1; k < size; k++) {
    const ey = Math.round(rect.y + k * cellH);
    const ex = Math.round(rect.x + k * cellW);
    let maxR = 0;
    let maxC = 0;
    let bestInkR = 0;
    let bestInkC = 0;
    for (let d = -searchRadius; d <= searchRadius; d++) {
      if (ey + d >= 0 && ey + d < ph) {
        if (combRow[ey + d] > maxR) maxR = combRow[ey + d];
        if (inkRow[ey + d] > bestInkR) bestInkR = inkRow[ey + d];
      }
      if (ex + d >= 0 && ex + d < pw) {
        if (combCol[ex + d] > maxC) maxC = combCol[ex + d];
        if (inkCol[ex + d] > bestInkC) bestInkC = inkCol[ex + d];
      }
    }
    if (maxR < 0.42) missingLines++;
    if (maxC < 0.42) missingLines++;

    const isBoxRow = k % boxRows === 0;
    const isBoxCol = k % boxCols === 0;
    const wR = isBoxRow ? 1.55 : 1.0;
    const wC = isBoxCol ? 1.55 : 1.0;
    lineSum += maxR * wR + maxC * wC;
    lineWeightSum += wR + wC;

    if (isBoxRow) {
      boxInkSum += bestInkR;
      boxInkCnt++;
    } else {
      thinInkSum += bestInkR;
      thinInkCnt++;
    }
    if (isBoxCol) {
      boxInkSum += bestInkC;
      boxInkCnt++;
    } else {
      thinInkSum += bestInkC;
      thinInkCnt++;
    }
  }
  const avgLine = lineSum / Math.max(1, lineWeightSum);
  const missingPenalty = (missingLines / Math.max(1, (size - 1) * 2)) * 1.45;

  // Box-divider contrast: true (size, boxDims) has much heavier ink mass on box dividers
  // than on regular 1x1 cell dividers (and never puts a missing line on a box divider).
  const avgBoxInk = boxInkSum / Math.max(1, boxInkCnt);
  const avgThinInk = thinInkSum / Math.max(1, thinInkCnt);
  const boxContrast = Math.max(-0.5, Math.min(0.6, (avgBoxInk - avgThinInk) * 0.45));

  // Measure line strength at cell midpoints (k + 0.5) * cellSize.
  // For the TRUE size N, midpoints fall inside cell interiors (very low full-span line score).
  // For a divisor like N=4 or N=8 on a 16x16 board, midpoints land directly on real grid lines!
  let midSum = 0;
  for (let k = 0; k < size; k++) {
    const my = Math.round(rect.y + (k + 0.5) * cellH);
    const mx = Math.round(rect.x + (k + 0.5) * cellW);
    let maxR = 0;
    let maxC = 0;
    for (let d = -2; d <= 2; d++) {
      if (my + d >= 0 && my + d < ph) maxR = Math.max(maxR, combRow[my + d]);
      if (mx + d >= 0 && mx + d < pw) maxC = Math.max(maxC, combCol[mx + d]);
    }
    midSum += (maxR + maxC) * 0.5;
  }
  const avgMid = midSum / size;

  // Also check 1/3 interior points so N=4 on a 12x12 or N=6 on a 9x9 doesn't get fooled
  let thirdPenalty = 0;
  if (size <= 8) {
    let tSum = 0;
    for (let k = 0; k < size; k++) {
      const ty = Math.round(rect.y + (k + 0.333) * cellH);
      const tx = Math.round(rect.x + (k + 0.333) * cellW);
      let mr = 0;
      let mc = 0;
      for (let d = -2; d <= 2; d++) {
        if (ty + d >= 0 && ty + d < ph) mr = Math.max(mr, combRow[ty + d]);
        if (tx + d >= 0 && tx + d < pw) mc = Math.max(mc, combCol[tx + d]);
      }
      tSum += (mr + mc) * 0.5;
    }
    const avgThird = tSum / size;
    if (avgThird > 0.45) thirdPenalty = (avgThird - 0.35) * 0.85;
  }

  return avgLine + boxContrast - avgMid * 1.15 - thirdPenalty - missingPenalty;
}

/**
 * Locates the Sudoku board (supporting light, dark, pure-black, navy-gradient, and rounded-corner boards)
 * and auto-detects both its grid size (4, 6, 8, 9, 12, 16) and its box orientation (e.g. 2x3 vs 3x2).
 */
function findSudokuGridAndSize(
  rgba: Uint8ClampedArray,
  lum: Uint8Array,
  pw: number,
  ph: number,
  sizeHint: SudokuSize | 'auto'
): DetectedGridInfo | null {
  const hist = new Int32Array(256);
  const yStart = Math.floor(ph * 0.14);
  const yEnd = Math.floor(ph * 0.78);
  for (let y = yStart; y < yEnd; y += 2) {
    for (let x = 0; x < pw; x += 2) {
      hist[lum[y * pw + x]]++;
    }
  }
  let bgLum = 255;
  let maxH = 0;
  for (let i = 0; i < 256; i++) {
    if (hist[i] > maxH) {
      maxH = hist[i];
      bgLum = i;
    }
  }
  const isDarkTheme = bgLum < 110;

  // Estimate dominant background RGB for chromatic border detection (e.g., bright blue borders on dark navy)
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let bgCnt = 0;
  for (let y = yStart; y < yEnd; y += 4) {
    for (let x = 0; x < pw; x += 4) {
      const idx = y * pw + x;
      if (Math.abs(lum[idx] - bgLum) <= 5) {
        sumR += rgba[idx * 4];
        sumG += rgba[idx * 4 + 1];
        sumB += rgba[idx * 4 + 2];
        bgCnt++;
      }
    }
  }
  const bgR = bgCnt > 0 ? sumR / bgCnt : bgLum;
  const bgG = bgCnt > 0 ? sumG / bgCnt : bgLum;
  const bgB = bgCnt > 0 ? sumB / bgCnt : bgLum;

  const isLinePx = (x: number, y: number): boolean => {
    const idx = y * pw + x;
    const v = lum[idx];
    if (isDarkTheme ? v > bgLum + 26 : v < bgLum - 28) return true;
    // Catch colored borders (cyan/blue/indigo) whose RGB differs strongly from background
    const rgbDiff =
      Math.abs(rgba[idx * 4] - bgR) +
      Math.abs(rgba[idx * 4 + 1] - bgG) +
      Math.abs(rgba[idx * 4 + 2] - bgB);
    return rgbDiff >= 95 && (isDarkTheme ? v >= bgLum + 10 : v <= bgLum - 10);
  };

  // Horizontal line score per row across central 84% of width (handles rounded outer corners cleanly)
  // Compute BOTH global contrast AND local 1D vertical ridge so soft ambient backlight glows
  // (like dark-navy radial glow themes) never merge with and hide crisp thin borders!
  const gx0 = Math.floor(pw * 0.08);
  const gx1 = Math.ceil(pw * 0.92);
  const gSpan = Math.max(1, gx1 - gx0);
  const rowScoreGlobal = new Float32Array(ph);
  const rowRidgeGlobal = new Float32Array(ph);
  for (let y = 0; y < ph; y++) {
    let cnt = 0;
    let rCnt = 0;
    const yUp = Math.max(0, y - 5);
    const yDn = Math.min(ph - 1, y + 5);
    for (let x = gx0; x < gx1; x++) {
      if (isLinePx(x, y)) cnt++;
      const v = lum[y * pw + x];
      const ref = 0.5 * (lum[yUp * pw + x] + lum[yDn * pw + x]);
      const ridge = isDarkTheme ? v - ref : ref - v;
      if (ridge >= 18) rCnt++;
    }
    rowScoreGlobal[y] = cnt / gSpan;
    rowRidgeGlobal[y] = rCnt / gSpan;
  }

  const hLines: number[] = [];
  const maxGridLineThickness = Math.max(12, Math.round(ph * 0.014));
  const addHLine = (cy: number) => {
    for (const existing of hLines) {
      if (Math.abs(existing - cy) <= 6) return;
    }
    hLines.push(cy);
  };
  const collectHLinesFromProfile = (profile: Float32Array) => {
    for (let y = Math.floor(ph * 0.05); y < Math.floor(ph * 0.92); y++) {
      if (profile[y] >= 0.48) {
        let yEndRun = y;
        while (yEndRun + 1 < ph && profile[yEndRun + 1] >= 0.38) yEndRun++;
        // Reject thick solid UI banners/headers (real Sudoku borders are thin lines <= ~12px)
        if (yEndRun - y <= maxGridLineThickness) {
          addHLine((y + yEndRun) * 0.5);
        }
        y = yEndRun;
      }
    }
  };
  collectHLinesFromProfile(rowRidgeGlobal);
  collectHLinesFromProfile(rowScoreGlobal);
  hLines.sort((a, b) => a - b);

  const candidateSizes: SudokuSize[] =
    sizeHint === 'auto' ? SUPPORTED_SUDOKU_SIZES : [sizeHint];

  let bestInfo: DetectedGridInfo | null = null;
  let bestTotalScore = -999;

  for (let i = 0; i < hLines.length; i++) {
    for (let j = i + 1; j < hLines.length; j++) {
      const top = hLines[i];
      const bot = hLines[j];
      const h = bot - top;
      // Support both square grids and slightly rectangular mobile grids (e.g. 16x16 where h ~ 1.13*w)
      if (h < pw * 0.45 || h > pw * 1.38) continue;

      const y0 = Math.max(0, Math.round(top));
      const y1 = Math.min(ph - 1, Math.round(bot));
      // Corner-safe vertical span (skips outer 7.5% on top & bottom so rounded corners never break detection!)
      const marginY = Math.max(4, Math.round(h * 0.075));
      const sy0 = Math.min(y1, y0 + marginY);
      const sy1 = Math.max(sy0, y1 - marginY);

      const strongCol = new Float32Array(pw);
      const ridgeCol = new Float32Array(pw);
      const yStep = Math.max(1, Math.floor((sy1 - sy0) / 300));
      let samplesY = 0;
      for (let y = sy0; y <= sy1; y += yStep) samplesY++;
      for (let x = 0; x < pw; x++) {
        let cnt = 0;
        let rCnt = 0;
        const xLt = Math.max(0, x - 5);
        const xRt = Math.min(pw - 1, x + 5);
        for (let y = sy0; y <= sy1; y += yStep) {
          if (isLinePx(x, y)) cnt++;
          const v = lum[y * pw + x];
          const ref = 0.5 * (lum[y * pw + xLt] + lum[y * pw + xRt]);
          const ridge = isDarkTheme ? v - ref : ref - v;
          if (ridge >= 18) rCnt++;
        }
        strongCol[x] = cnt / Math.max(1, samplesY);
        ridgeCol[x] = rCnt / Math.max(1, samplesY);
      }

      // Snap left & right to the ridge peak of their outer border stroke (immune to outer backlight halos!)
      const colPeak = (x: number) => Math.max(strongCol[x], ridgeCol[x]);
      let left = -1;
      let right = -1;
      for (let x = 0; x < pw; x++) {
        if (colPeak(x) >= 0.72) {
          let xEnd = x;
          while (xEnd + 1 < pw && xEnd - x < 12 && colPeak(xEnd + 1) >= 0.65) {
            xEnd++;
          }
          // Prefer peak of ridgeCol inside the run if a sharp border ridge exists
          let bestX = (x + xEnd) * 0.5;
          let maxR = 0;
          for (let kx = x; kx <= xEnd; kx++) {
            if (ridgeCol[kx] > maxR) maxR = ridgeCol[kx];
          }
          if (maxR >= 0.55) {
            let rx0 = xEnd;
            let rx1 = x;
            for (let kx = x; kx <= xEnd; kx++) {
              if (ridgeCol[kx] >= maxR * 0.85) {
                if (kx < rx0) rx0 = kx;
                if (kx > rx1) rx1 = kx;
              }
            }
            bestX = (rx0 + rx1) * 0.5;
          }
          left = bestX;
          break;
        }
      }
      for (let x = pw - 1; x >= 0; x--) {
        if (colPeak(x) >= 0.72) {
          let xStart = x;
          while (xStart - 1 >= 0 && x - xStart < 12 && colPeak(xStart - 1) >= 0.65) {
            xStart--;
          }
          let bestX = (xStart + x) * 0.5;
          let maxR = 0;
          for (let kx = xStart; kx <= x; kx++) {
            if (ridgeCol[kx] > maxR) maxR = ridgeCol[kx];
          }
          if (maxR >= 0.55) {
            let rx0 = x;
            let rx1 = xStart;
            for (let kx = xStart; kx <= x; kx++) {
              if (ridgeCol[kx] >= maxR * 0.85) {
                if (kx < rx0) rx0 = kx;
                if (kx > rx1) rx1 = kx;
              }
            }
            bestX = (rx0 + rx1) * 0.5;
          }
          right = bestX;
          break;
        }
      }
      if (left < 0 || right <= left) continue;

      const w = right - left;
      const aspectErr = Math.abs(w - h) / Math.max(w, h);
      if (aspectErr > 0.25) continue;

      const x0 = Math.max(0, Math.round(left));
      const x1 = Math.min(pw - 1, Math.round(right));

      // Verify left & right borders are continuous just inside the rounded-corner zone (7.5%..21% from top/bot)
      const capStart = Math.max(4, Math.round(h * 0.075));
      const capEnd = Math.max(capStart + 8, Math.round(h * 0.21));
      const capLen = capEnd - capStart;
      let topCapL = 0;
      let topCapR = 0;
      let botCapL = 0;
      let botCapR = 0;
      const hasLineNearX = (cx: number, cy: number): boolean => {
        for (let dx = -2; dx <= 2; dx++) {
          const nx = cx + dx;
          if (nx >= 0 && nx < pw && isLinePx(nx, cy)) return true;
        }
        return false;
      };
      for (let dy = capStart; dy < capEnd; dy++) {
        if (y0 + dy < ph) {
          if (hasLineNearX(x0, y0 + dy)) topCapL++;
          if (hasLineNearX(x1, y0 + dy)) topCapR++;
        }
        if (y1 - dy >= 0) {
          if (hasLineNearX(x0, y1 - dy)) botCapL++;
          if (hasLineNearX(x1, y1 - dy)) botCapR++;
        }
      }
      if (
        topCapL / capLen < 0.72 ||
        topCapR / capLen < 0.72 ||
        botCapL / capLen < 0.72 ||
        botCapR / capLen < 0.72
      ) {
        continue;
      }

      // Corner-safe horizontal span for outer top/bottom border verification & internal line profiles
      const marginX = Math.max(4, Math.round(w * 0.075));
      const sx0 = Math.min(x1, x0 + marginX);
      const sx1 = Math.max(sx0, x1 - marginX);
      const xStep = Math.max(1, Math.floor((sx1 - sx0) / 260));
      let samplesX = 0;
      for (let x = sx0; x <= sx1; x += xStep) samplesX++;

      const strongRow = new Float32Array(ph);
      const combRow = new Float32Array(ph);
      const rawInkRow = new Float32Array(ph);

      // Estimate local interior board background luminance (handles dark-card-on-black or gradient themes!)
      const boardHist = new Int32Array(256);
      const bStepY = Math.max(2, Math.floor((sy1 - sy0) / 60));
      const bStepX = Math.max(2, Math.floor((sx1 - sx0) / 60));
      for (let y = sy0; y <= sy1; y += bStepY) {
        for (let x = sx0; x <= sx1; x += bStepX) {
          boardHist[lum[y * pw + x]]++;
        }
      }
      let boardBgLum = bgLum;
      let boardMaxH = 0;
      for (let b = 0; b < 256; b++) {
        if (boardHist[b] > boardMaxH) {
          boardMaxH = boardHist[b];
          boardBgLum = b;
        }
      }
      const boardDark = boardBgLum < 110;

      for (let y = y0; y <= y1; y++) {
        let sCnt = 0;
        let fCnt = 0;
        let inkSum = 0;
        const yUp = Math.max(0, y - 4);
        const yDn = Math.min(ph - 1, y + 4);
        for (let x = sx0; x <= sx1; x += xStep) {
          const v = lum[y * pw + x];
          const strong = isLinePx(x, y);
          if (strong) sCnt++;
          const ref = 0.5 * (lum[yUp * pw + x] + lum[yDn * pw + x]);
          const ridge = boardDark ? v - ref : ref - v;
          const diffBg = boardDark ? v - boardBgLum : boardBgLum - v;
          if (strong || ridge >= 5 || (ridge >= 3 && diffBg >= 8)) {
            fCnt++;
          }
          if (diffBg > 6) inkSum += diffBg / 255;
        }
        strongRow[y] = sCnt / Math.max(1, samplesX);
        combRow[y] = Math.max(strongRow[y], fCnt / Math.max(1, samplesX));
        rawInkRow[y] = inkSum / Math.max(1, samplesX);
      }

      // Outer top & bottom straight edges must be solid continuous borders (check ±2px around y0/y1)
      let topBorderStr = 0;
      let botBorderStr = 0;
      for (let dy = -2; dy <= 2; dy++) {
        if (y0 + dy >= y0 && y0 + dy <= y1) topBorderStr = Math.max(topBorderStr, strongRow[y0 + dy]);
        if (y1 + dy >= y0 && y1 + dy <= y1) botBorderStr = Math.max(botBorderStr, strongRow[y1 + dy]);
      }
      if (topBorderStr < 0.72 || botBorderStr < 0.72) continue;

      // Compute fine-ridge & ink-mass vertical profiles strictly inside [sy0..sy1]
      const combCol = new Float32Array(pw);
      const rawInkCol = new Float32Array(pw);
      for (let x = x0; x <= x1; x++) {
        let fCnt = 0;
        let inkSum = 0;
        const xLt = Math.max(0, x - 4);
        const xRt = Math.min(pw - 1, x + 4);
        for (let y = sy0; y <= sy1; y += yStep) {
          const v = lum[y * pw + x];
          const strong = isLinePx(x, y);
          const ref = 0.5 * (lum[y * pw + xLt] + lum[y * pw + xRt]);
          const ridge = boardDark ? v - ref : ref - v;
          const diffBg = boardDark ? v - boardBgLum : boardBgLum - v;
          if (strong || ridge >= 5 || (ridge >= 3 && diffBg >= 8)) {
            fCnt++;
          }
          if (diffBg > 6) inkSum += diffBg / 255;
        }
        combCol[x] = Math.max(strongCol[x], fCnt / Math.max(1, samplesY));
        rawInkCol[x] = inkSum / Math.max(1, samplesY);
      }

      // Integrated ink mass over ±2px window captures BOTH line thickness AND contrast strength
      const inkRow = new Float32Array(ph);
      for (let y = y0; y <= y1; y++) {
        let sum = 0;
        for (let d = -2; d <= 2; d++) {
          if (y + d >= y0 && y + d <= y1) sum += rawInkRow[y + d];
        }
        inkRow[y] = sum;
      }
      const inkCol = new Float32Array(pw);
      for (let x = x0; x <= x1; x++) {
        let sum = 0;
        for (let d = -2; d <= 2; d++) {
          if (x + d >= x0 && x + d <= x1) sum += rawInkCol[x + d];
        }
        inkCol[x] = sum;
      }

      const rect: SudokuGridRect = { x: left, y: top, w, h };

      for (const sz of candidateSizes) {
        const defBox = getBoxDims(sz);
        const boxVariants: BoxDims[] =
          defBox.boxRows === defBox.boxCols
            ? [defBox]
            : [defBox, { boxRows: defBox.boxCols, boxCols: defBox.boxRows }];

        for (const boxDims of boxVariants) {
          const gridScore = scoreCandidateGridSize(
            combRow,
            combCol,
            inkRow,
            inkCol,
            rect,
            sz,
            boxDims,
            pw,
            ph
          );
          const borderBonus =
            (topBorderStr + botBorderStr + strongCol[x0] + strongCol[x1]) * 0.06;
          const totalScore =
            gridScore * (1 - aspectErr * 0.35) + borderBonus + (w / pw) * 0.12;
          if (totalScore > bestTotalScore) {
            bestTotalScore = totalScore;
            bestInfo = {
              rect,
              size: sz,
              boxDims,
              isDarkTheme: boardDark,
              bgLum: boardBgLum,
            };
          }
        }
      }
    }
  }

  return bestInfo;
}

/**
 * Estimates whether a pixel at (x,y) is dark/colored ink (including blue dashed Killer borders)
 * compared to a local cell background luminance.
 */
function isInkAt(
  rgba: Uint8ClampedArray,
  lum: Uint8Array,
  pw: number,
  x: number,
  y: number,
  cellBgLum: number,
  darkBg: boolean,
  threshold: number
): boolean {
  const idx = y * pw + x;
  const v = lum[idx];
  const lDiff = darkBg ? v - cellBgLum : cellBgLum - v;
  if (lDiff >= threshold) return true;
  // Also catch saturated blue/indigo dashed cage borders even if luminance diff is modest
  const r = rgba[idx * 4];
  const g = rgba[idx * 4 + 1];
  const b = rgba[idx * 4 + 2];
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  return sat >= 45 && lDiff >= threshold * 0.55;
}

/**
 * Measures dashed cage-border presence along an inset strip inside cell (r, c) parallel to one side.
 * Returns { density, transitions } where a dashed line has moderate-to-high density AND multiple dashes.
 */
function measureInsetDashStrip(
  rgba: Uint8ClampedArray,
  lum: Uint8Array,
  pw: number,
  ph: number,
  gridRect: SudokuGridRect,
  size: SudokuSize,
  r: number,
  c: number,
  side: 'top' | 'bottom' | 'left' | 'right',
  cellBgLum: number
): { density: number; transitions: number } {
  const cellW = gridRect.w / size;
  const cellH = gridRect.h / size;
  const darkBg = cellBgLum < 110;

  const cx0 = gridRect.x + c * cellW;
  const cy0 = gridRect.y + r * cellH;
  const cx1 = gridRect.x + (c + 1) * cellW;
  const cy1 = gridRect.y + (r + 1) * cellH;

  // Inset band strictly inside the solid border (offset ~4.5%..11.5% of cell size)
  const offMin = Math.max(2, Math.round(Math.min(cellW, cellH) * 0.045));
  const offMax = Math.max(offMin + 2, Math.round(Math.min(cellW, cellH) * 0.125));

  // Avoid top-left corner where Killer cage sums live (start at 38% along top edge, 34% along left edge)
  let totalSteps = 0;
  let hits = 0;
  let transitions = 0;
  let prevHit = false;

  if (side === 'top' || side === 'bottom') {
    const startX = Math.round(cx0 + cellW * (side === 'top' ? 0.4 : 0.2));
    const endX = Math.round(cx1 - cellW * 0.14);
    for (let x = startX; x <= endX; x++) {
      if (x < 0 || x >= pw) continue;
      let colHasDash = false;
      for (let off = offMin; off <= offMax; off++) {
        const y = side === 'top' ? Math.round(cy0) + off : Math.round(cy1) - off;
        if (y < 0 || y >= ph) continue;
        if (isInkAt(rgba, lum, pw, x, y, cellBgLum, darkBg, 28)) {
          colHasDash = true;
          break;
        }
      }
      if (totalSteps > 0 && colHasDash !== prevHit) transitions++;
      prevHit = colHasDash;
      if (colHasDash) hits++;
      totalSteps++;
    }
  } else {
    const startY = Math.round(cy0 + cellH * (side === 'left' ? 0.36 : 0.18));
    const endY = Math.round(cy1 - cellH * 0.16);
    for (let y = startY; y <= endY; y++) {
      if (y < 0 || y >= ph) continue;
      let rowHasDash = false;
      for (let off = offMin; off <= offMax; off++) {
        const x = side === 'left' ? Math.round(cx0) + off : Math.round(cx1) - off;
        if (x < 0 || x >= pw) continue;
        if (isInkAt(rgba, lum, pw, x, y, cellBgLum, darkBg, 28)) {
          rowHasDash = true;
          break;
        }
      }
      if (totalSteps > 0 && rowHasDash !== prevHit) transitions++;
      prevHit = rowHasDash;
      if (rowHasDash) hits++;
      totalSteps++;
    }
  }

  return {
    density: hits / Math.max(1, totalSteps),
    transitions,
  };
}

function estimateCellBgLum(
  lum: Uint8Array,
  pw: number,
  ph: number,
  gridRect: SudokuGridRect,
  size: SudokuSize,
  r: number,
  c: number,
  isDarkTheme: boolean
): number {
  const cellW = gridRect.w / size;
  const cellH = gridRect.h / size;
  const x0 = Math.max(0, Math.round(gridRect.x + c * cellW + cellW * 0.15));
  const y0 = Math.max(0, Math.round(gridRect.y + r * cellH + cellH * 0.15));
  const x1 = Math.min(pw - 1, Math.round(gridRect.x + (c + 1) * cellW - cellW * 0.15));
  const y1 = Math.min(ph - 1, Math.round(gridRect.y + (r + 1) * cellH - cellH * 0.15));

  const samples: number[] = [];
  for (let x = x0; x <= x1; x += 2) {
    samples.push(lum[y0 * pw + x], lum[y1 * pw + x]);
  }
  for (let y = y0; y <= y1; y += 2) {
    samples.push(lum[y * pw + x0], lum[y * pw + x1]);
  }
  if (samples.length === 0) return isDarkTheme ? 24 : 255;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length * (isDarkTheme ? 0.28 : 0.72))];
}

/**
 * Automatically detects whether the scanned board contains Killer Sudoku inset dashed cages.
 */
function detectIsKillerSudoku(
  rgba: Uint8ClampedArray,
  lum: Uint8Array,
  pw: number,
  ph: number,
  gridRect: SudokuGridRect,
  size: SudokuSize,
  cellBgs: number[][]
): boolean {
  if (size > 9) return false;
  let dashedEdges = 0;
  let checkedEdges = 0;

  // Check outer perimeter inner edges (every Killer cage MUST have a dashed border on outer edges!)
  for (let i = 0; i < size; i++) {
    const topStrip = measureInsetDashStrip(
      rgba,
      lum,
      pw,
      ph,
      gridRect,
      size,
      0,
      i,
      'top',
      cellBgs[0][i]
    );
    const botStrip = measureInsetDashStrip(
      rgba,
      lum,
      pw,
      ph,
      gridRect,
      size,
      size - 1,
      i,
      'bottom',
      cellBgs[size - 1][i]
    );
    const rightStrip = measureInsetDashStrip(
      rgba,
      lum,
      pw,
      ph,
      gridRect,
      size,
      i,
      size - 1,
      'right',
      cellBgs[i][size - 1]
    );
    checkedEdges += 3;
    if (topStrip.density >= 0.22 && topStrip.transitions >= 3) dashedEdges++;
    if (botStrip.density >= 0.22 && botStrip.transitions >= 3) dashedEdges++;
    if (rightStrip.density >= 0.22 && rightStrip.transitions >= 3) dashedEdges++;
  }

  return dashedEdges / Math.max(1, checkedEdges) >= 0.5;
}

/**
 * Extracts Killer Sudoku cages via Union-Find across adjacent cell borders,
 * then OCRs the small 1-or-2-digit cage sum in the top-left corner of each cage's head cell.
 */
function extractKillerCages(
  rgba: Uint8ClampedArray,
  lum: Uint8Array,
  pw: number,
  ph: number,
  gridRect: SudokuGridRect,
  size: SudokuSize,
  cellBgs: number[][],
  templates: GlyphSignature[],
  scannedBoard: SudokuGrid
): KillerCage[] {
  const total = size * size;
  const parent = Int32Array.from({ length: total }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const unite = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  // Horizontal neighbor connections: (r, c) <-> (r, c + 1)
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size - 1; c++) {
      const sLeft = measureInsetDashStrip(
        rgba,
        lum,
        pw,
        ph,
        gridRect,
        size,
        r,
        c,
        'right',
        cellBgs[r][c]
      );
      const sRight = measureInsetDashStrip(
        rgba,
        lum,
        pw,
        ph,
        gridRect,
        size,
        r,
        c + 1,
        'left',
        cellBgs[r][c + 1]
      );
      const hasWall =
        (sLeft.density >= 0.24 && sLeft.transitions >= 2) ||
        (sRight.density >= 0.24 && sRight.transitions >= 2) ||
        sLeft.density + sRight.density >= 0.42;
      if (!hasWall) {
        unite(r * size + c, r * size + (c + 1));
      }
    }
  }

  // Vertical neighbor connections: (r, c) <-> (r + 1, c)
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size; c++) {
      const sTop = measureInsetDashStrip(
        rgba,
        lum,
        pw,
        ph,
        gridRect,
        size,
        r,
        c,
        'bottom',
        cellBgs[r][c]
      );
      const sBot = measureInsetDashStrip(
        rgba,
        lum,
        pw,
        ph,
        gridRect,
        size,
        r + 1,
        c,
        'top',
        cellBgs[r + 1][c]
      );
      const hasWall =
        (sTop.density >= 0.24 && sTop.transitions >= 2) ||
        (sBot.density >= 0.24 && sBot.transitions >= 2) ||
        sTop.density + sBot.density >= 0.42;
      if (!hasWall) {
        unite(r * size + c, (r + 1) * size + c);
      }
    }
  }

  // Group cells by Union-Find root
  const groups = new Map<number, [number, number][]>();
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      const root = find(r * size + c);
      const list = groups.get(root) || [];
      list.push([r, c]);
      groups.set(root, list);
    }
  }

  const digitCodes0to9 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  const cellW = gridRect.w / size;
  const cellH = gridRect.h / size;
  const cages: KillerCage[] = [];
  const cageAlts: { cageIdx: number; altSum: number; margin: number }[] = [];
  let nextId = 1;

  for (const cells of groups.values()) {
    const tempCage: KillerCage = { id: nextId, sum: 0, cells };
    const head = getCageHeadCell(tempCage);
    let parsedSum = 0;
    const localAlts: { altSum: number; margin: number }[] = [];

    // If every cell in this cage already has a clearly scanned big given digit,
    // its true sum is mathematically guaranteed to equal the sum of those givens!
    let allGiven = cells.length > 0;
    let givenSum = 0;
    for (const [r, c] of cells) {
      const v = scannedBoard[r]?.[c] ?? 0;
      if (v <= 0) {
        allGiven = false;
        break;
      }
      givenSum += v;
    }

    if (allGiven) {
      parsedSum = givenSum;
    } else if (head) {
      const [hr, hc] = head;
      const bgLum = cellBgs[hr][hc];
      const darkBg = bgLum < 110;

      // Top-left corner ROI starting safely near the edge (0.026) so the top arc of tiny '0's
      // right below thick 3x3 dividers is NEVER clipped; solid grid border rows/cols are trimmed dynamically!
      let x0 = Math.max(0, Math.round(gridRect.x + hc * cellW + cellW * 0.026));
      let y0 = Math.max(0, Math.round(gridRect.y + hr * cellH + cellH * 0.026));
      const x1 = Math.min(pw - 1, Math.round(gridRect.x + hc * cellW + cellW * 0.42));
      const y1 = Math.min(ph - 1, Math.round(gridRect.y + hr * cellH + cellH * 0.34));

      // Dynamically strip leading solid border lines (thick 3x3 dividers) without touching digit tops
      const maxTrim = Math.max(3, Math.round(Math.min(cellW, cellH) * 0.065));
      for (let t = 0; t < maxTrim && y0 + 6 < y1; t++) {
        let darkPx = 0;
        const spanX = x1 - x0 + 1;
        for (let x = x0; x <= x1; x++) {
          const d = darkBg ? lum[y0 * pw + x] - bgLum : bgLum - lum[y0 * pw + x];
          if (d >= 45) darkPx++;
        }
        if (darkPx / Math.max(1, spanX) >= 0.7) y0++;
        else break;
      }
      for (let t = 0; t < maxTrim && x0 + 6 < x1; t++) {
        let darkPx = 0;
        const spanY = y1 - y0 + 1;
        for (let y = y0; y <= y1; y++) {
          const d = darkBg ? lum[y * pw + x0] - bgLum : bgLum - lum[y * pw + x0];
          if (d >= 45) darkPx++;
        }
        if (darkPx / Math.max(1, spanY) >= 0.7) x0++;
        else break;
      }

      const rw = x1 - x0 + 1;
      const rh = y1 - y0 + 1;

      if (rw >= 6 && rh >= 6) {
        const diffs = new Float32Array(rw * rh);
        let maxDiff = 0;
        for (let y = 0; y < rh; y++) {
          for (let x = 0; x < rw; x++) {
            const v = lum[(y0 + y) * pw + (x0 + x)];
            const diff = Math.max(0, darkBg ? v - bgLum : bgLum - v);
            diffs[y * rw + x] = diff;
            if (x >= 1 && y >= 1 && diff > maxDiff) maxDiff = diff;
          }
        }

        const fg = new Float32Array(rw * rh);
        const bin = new Uint8Array(rw * rh);
        const normDenom = Math.max(85, Math.min(185, maxDiff));
        const binThresh = Math.min(72, Math.max(40, maxDiff * 0.42));
        for (let i = 0; i < rw * rh; i++) {
          if (diffs[i] > 12) {
            fg[i] = Math.min(1, diffs[i] / normDenom);
          }
          if (diffs[i] >= binThresh) {
            bin[i] = 1;
          }
        }

        // Extract 4-connected components (keeps adjacent tiny digits like "11", "13", "14" cleanly separated!)
        const visited = new Uint8Array(rw * rh);
        const qx = new Int32Array(rw * rh);
        const qy = new Int32Array(rw * rh);
        const rawComps: {
          count: number;
          minX: number;
          maxX: number;
          minY: number;
          maxY: number;
        }[] = [];

        for (let y = 0; y < rh; y++) {
          for (let x = 0; x < rw; x++) {
            const sIdx = y * rw + x;
            if (bin[sIdx] === 0 || visited[sIdx]) continue;
            let headQ = 0;
            let tailQ = 0;
            qx[tailQ] = x;
            qy[tailQ] = y;
            tailQ++;
            visited[sIdx] = 1;

            let minX = x;
            let maxX = x;
            let minY = y;
            let maxY = y;
            let cnt = 0;

            while (headQ < tailQ) {
              const cx = qx[headQ];
              const cy = qy[headQ];
              headQ++;
              cnt++;
              if (cx < minX) minX = cx;
              if (cx > maxX) maxX = cx;
              if (cy < minY) minY = cy;
              if (cy > maxY) maxY = cy;

              const nbs: [number, number][] = [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
              ];
              for (const [dx, dy] of nbs) {
                const nx = cx + dx;
                const ny = cy + dy;
                if (nx < 0 || nx >= rw || ny < 0 || ny >= rh) continue;
                const nIdx = ny * rw + nx;
                if (bin[nIdx] === 1 && !visited[nIdx]) {
                  visited[nIdx] = 1;
                  qx[tailQ] = nx;
                  qy[tailQ] = ny;
                  tailQ++;
                }
              }
            }

            const bw = maxX - minX + 1;
            const bh = maxY - minY + 1;
            const isFlatDash = bh <= 3 && bw >= bh * 1.6;
            const isTinySpeck = cnt < 5 || bh < Math.max(5, cellH * 0.085);
            if (
              !isFlatDash &&
              !isTinySpeck &&
              bh <= cellH * 0.25 &&
              bw <= cellW * 0.34
            ) {
              rawComps.push({ count: cnt, minX, maxX, minY, maxY });
            }
          }
        }

        // Split any merged 2-digit blob (e.g. "11", "14", "17" touching by 1px) at its vertical ink valley
        const splitComps: {
          minX: number;
          maxX: number;
          minY: number;
          maxY: number;
        }[] = [];
        rawComps.sort((a, b) => a.minX - b.minX);
        for (const comp of rawComps) {
          const bw = comp.maxX - comp.minX + 1;
          const bh = comp.maxY - comp.minY + 1;
          if (bw > bh * 0.98 && bw >= 12) {
            const xStart = comp.minX + Math.max(2, Math.floor(bw * 0.28));
            const xEnd = comp.minX + Math.min(bw - 3, Math.ceil(bw * 0.72));
            let bestSplitX = Math.floor((comp.minX + comp.maxX) / 2);
            let minColMass = Infinity;
            for (let sx = xStart; sx <= xEnd; sx++) {
              let colMass = 0;
              for (let sy = comp.minY; sy <= comp.maxY; sy++) {
                colMass += fg[sy * rw + sx];
              }
              if (colMass < minColMass) {
                minColMass = colMass;
                bestSplitX = sx;
              }
            }
            // Guard against splitting a single hollow digit ('0', '8', '4') across its center loop:
            // a hollow digit has strong ink in BOTH its top and bottom thirds along bestSplitX.
            const thirdH = Math.max(2, Math.round(bh * 0.3));
            let topArcInk = 0;
            let botArcInk = 0;
            for (let sy = comp.minY; sy < comp.minY + thirdH; sy++) {
              topArcInk += fg[sy * rw + bestSplitX];
            }
            for (let sy = comp.maxY - thirdH + 1; sy <= comp.maxY; sy++) {
              botArcInk += fg[sy * rw + bestSplitX];
            }
            const cutsClosedLoop =
              bw < bh * 1.2 && topArcInk >= 0.85 && botArcInk >= 0.85;
            const hasTrueValley = !cutsClosedLoop && minColMass <= bh * 0.3;

            if (hasTrueValley) {
              const pushHalf = (hx0: number, hx1: number) => {
                let tMinX = hx1;
                let tMaxX = hx0;
                let tMinY = comp.maxY;
                let tMaxY = comp.minY;
                for (let sy = comp.minY; sy <= comp.maxY; sy++) {
                  for (let sx = hx0; sx <= hx1; sx++) {
                    if (fg[sy * rw + sx] >= 0.35) {
                      if (sx < tMinX) tMinX = sx;
                      if (sx > tMaxX) tMaxX = sx;
                      if (sy < tMinY) tMinY = sy;
                      if (sy > tMaxY) tMaxY = sy;
                    }
                  }
                }
                if (tMaxX >= tMinX && tMaxY - tMinY + 1 >= Math.max(5, bh * 0.65)) {
                  splitComps.push({
                    minX: tMinX,
                    maxX: tMaxX,
                    minY: tMinY,
                    maxY: tMaxY,
                  });
                }
              };
              pushHalf(comp.minX, bestSplitX);
              pushHalf(bestSplitX + 1, comp.maxX);
            } else {
              splitComps.push(comp);
            }
          } else {
            splitComps.push(comp);
          }
        }

        // Keep up to 2 horizontally aligned digits closest to top-left (excluding far-right border dashes)
        splitComps.sort((a, b) => a.minX - b.minX);
        const digitComps = splitComps
          .filter((comp) => comp.minX < rw * 0.72)
          .slice(0, 2);

        const digitMatches: {
          code: number;
          conf: number;
          secondCode: number;
          secondConf: number;
        }[] = [];

        for (const comp of digitComps) {
          const cw = comp.maxX - comp.minX + 1;
          const ch = comp.maxY - comp.minY + 1;
          const crop = new Float32Array(cw * ch);
          for (let y = 0; y < ch; y++) {
            for (let x = 0; x < cw; x++) {
              crop[y * cw + x] = fg[(comp.minY + y) * rw + (comp.minX + x)];
            }
          }
          const sig = buildGlyphSignatureFromCrop(crop, cw, ch, 0);
          const match = classifyGlyph(sig, templates, digitCodes0to9);
          if (match.code >= 0 && match.confidence >= 0.25) {
            digitMatches.push({
              code: match.code,
              conf: match.confidence,
              secondCode: match.secondCode,
              secondConf: match.secondConfidence,
            });
          }
        }

        const numStr = digitMatches.map((m) => String(m.code)).join('');
        const val = parseInt(numStr, 10);
        const maxPossible = (cells.length * (2 * size - cells.length + 1)) / 2;
        const minPossible = (cells.length * (cells.length + 1)) / 2;
        if (!Number.isNaN(val) && val >= minPossible && val <= maxPossible) {
          parsedSum = val;
        }

        // Record plausible close runner-up sums (e.g. tiny '10' vs '11', '16' vs '18') for global 405 sum verification
        for (let di = 0; di < digitMatches.length; di++) {
          const dm = digitMatches[di];
          const margin = dm.conf - dm.secondConf;
          if (dm.secondCode >= 0 && margin <= 0.24) {
            const altDigits = digitMatches.map((m, idx) =>
              idx === di ? dm.secondCode : m.code
            );
            const altVal = parseInt(altDigits.map(String).join(''), 10);
            if (
              !Number.isNaN(altVal) &&
              altVal !== parsedSum &&
              altVal >= minPossible &&
              altVal <= maxPossible
            ) {
              localAlts.push({ altSum: altVal, margin });
            }
          }
        }
      }
    }

    const cageIdx = cages.length;
    cages.push({
      id: nextId++,
      sum: parsedSum,
      cells,
    });
    for (const a of localAlts) {
      cageAlts.push({ cageIdx, altSum: a.altSum, margin: a.margin });
    }
  }

  // Global Killer Sudoku mathematical invariant check:
  // If cages form a complete partition of all N*N cells, the sum of all cage sums MUST equal N * N * (N + 1) / 2 (405 for 9x9).
  const coveredCells = cages.reduce((acc, cg) => acc + cg.cells.length, 0);
  const expectedBoardTotal = (size * size * (size + 1)) / 2;
  const currentTotal = cages.reduce((acc, cg) => acc + cg.sum, 0);

  if (
    coveredCells === size * size &&
    currentTotal !== expectedBoardTotal &&
    cageAlts.length > 0
  ) {
    const neededDelta = expectedBoardTotal - currentTotal;
    // Sort candidate single-digit OCR alternatives by smallest confidence margin (most ambiguous first)
    cageAlts.sort((a, b) => a.margin - b.margin);
    const pool = cageAlts.slice(0, 14);

    // Search subsets of size 1..3 matching neededDelta that make the Killer Sudoku legally solvable
    let bestCombo: { cageIdx: number; altSum: number; margin: number }[] = [];
    let bestPenalty = Infinity;

    const tryCombo = (combo: typeof pool) => {
      const usedCages = new Set<number>();
      let delta = 0;
      let pen = 0;
      for (const item of combo) {
        if (usedCages.has(item.cageIdx)) return;
        usedCages.add(item.cageIdx);
        delta += item.altSum - cages[item.cageIdx].sum;
        pen += item.margin;
      }
      if (delta !== neededDelta || pen >= bestPenalty) return;

      const testCages = cages.map((cg, idx) => {
        const hit = combo.find((c) => c.cageIdx === idx);
        return hit ? { ...cg, sum: hit.altSum } : cg;
      });
      if (findConflicts(scannedBoard, { size, cages: testCages }).size > 0) return;
      const check = solveSudoku(scannedBoard, { size, cages: testCages });
      if (check.solved) {
        bestPenalty = pen;
        bestCombo = combo;
      }
    };

    for (let i = 0; i < pool.length; i++) {
      tryCombo([pool[i]]);
    }
    if (bestCombo.length === 0) {
      for (let i = 0; i < pool.length; i++) {
        for (let j = i + 1; j < pool.length; j++) {
          tryCombo([pool[i], pool[j]]);
        }
      }
    }
    if (bestCombo.length === 0) {
      for (let i = 0; i < Math.min(pool.length, 10); i++) {
        for (let j = i + 1; j < Math.min(pool.length, 10); j++) {
          for (let k = j + 1; k < Math.min(pool.length, 10); k++) {
            tryCombo([pool[i], pool[j], pool[k]]);
          }
        }
      }
    }

    if (bestCombo.length > 0) {
      for (const item of bestCombo) {
        cages[item.cageIdx] = {
          ...cages[item.cageIdx],
          sum: item.altSum,
        };
      }
    }
  }

  return cages;
}

/**
 * Scans an uploaded Sudoku screenshot HTMLImageElement in-browser:
 * - Auto-detects board size (4x4, 6x6, 8x8, 9x9, 12x12, 16x16) or honors `sizeHint`
 * - Auto-detects Killer Sudoku dashed cages + sums or honors `variantHint`
 * - Recognizes all symbols (1..9 and A..G for 12x12/16x16)
 */
export function scanSudokuFromImage(
  img: HTMLImageElement,
  options?: SudokuScanOptions
): SudokuScanResult {
  const sizeHint = options?.sizeHint ?? 'auto';
  const variantHint = options?.variantHint ?? 'auto';

  // High resolution so 16x16 cells (~50px each) and small Killer cage sums stay sharp
  const maxDim = 1800;
  const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
  const pw = Math.max(120, Math.round(img.width * scale));
  const ph = Math.max(120, Math.round(img.height * scale));

  const fallbackSize: SudokuSize = sizeHint === 'auto' ? 9 : sizeHint;
  const fallbackBoxDims = getBoxDims(fallbackSize);
  const fallbackVariant: SudokuVariant = variantHint === 'auto' ? 'classic' : variantHint;

  const canvas = document.createElement('canvas');
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return {
      size: fallbackSize,
      boxDims: fallbackBoxDims,
      variant: fallbackVariant,
      board: createEmptyGrid(fallbackSize),
      cages: [],
      confidences: createEmptyGrid(fallbackSize),
      gridRect: null,
      detectedCount: 0,
      detectedCageCount: 0,
      imageWidth: pw,
      imageHeight: ph,
    };
  }

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, pw, ph);
  const rgba = ctx.getImageData(0, 0, pw, ph).data;

  const lum = new Uint8Array(pw * ph);
  for (let i = 0; i < pw * ph; i++) {
    const idx = i * 4;
    lum[i] = Math.round(
      0.299 * rgba[idx] + 0.587 * rgba[idx + 1] + 0.114 * rgba[idx + 2]
    );
  }

  const gridInfo = findSudokuGridAndSize(rgba, lum, pw, ph, sizeHint);
  if (!gridInfo) {
    return {
      size: fallbackSize,
      boxDims: fallbackBoxDims,
      variant: fallbackVariant,
      board: createEmptyGrid(fallbackSize),
      cages: [],
      confidences: createEmptyGrid(fallbackSize),
      gridRect: null,
      detectedCount: 0,
      detectedCageCount: 0,
      imageWidth: pw,
      imageHeight: ph,
    };
  }

  const { rect: gridRect, size, boxDims, isDarkTheme } = gridInfo;
  const templates = getSymbolTemplates();
  const cellBgs: number[][] = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) =>
      estimateCellBgLum(lum, pw, ph, gridRect, size, r, c, isDarkTheme)
    )
  );

  const isKiller =
    variantHint === 'killer'
      ? true
      : variantHint === 'classic'
        ? false
        : detectIsKillerSudoku(rgba, lum, pw, ph, gridRect, size, cellBgs);

  const variant: SudokuVariant = isKiller ? 'killer' : 'classic';

  const allowedSymbolCodes = Array.from({ length: size }, (_, i) => i + 1);
  const board = createEmptyGrid(size);
  const confidences: number[][] = Array.from({ length: size }, () =>
    Array(size).fill(0)
  );
  let detectedCount = 0;

  const cellW = gridRect.w / size;
  const cellH = gridRect.h / size;

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      // Slightly larger inset in Killer mode to stay strictly inside the dashed cage borders
      const insetFrac = isKiller ? 0.145 : size >= 12 ? 0.11 : 0.135;
      const insetX = Math.max(2, Math.round(cellW * insetFrac));
      const insetY = Math.max(2, Math.round(cellH * insetFrac));
      const x0 = Math.max(0, Math.round(gridRect.x + c * cellW) + insetX);
      const y0 = Math.max(0, Math.round(gridRect.y + r * cellH) + insetY);
      const x1 = Math.min(pw - 1, Math.round(gridRect.x + (c + 1) * cellW) - insetX);
      const y1 = Math.min(ph - 1, Math.round(gridRect.y + (r + 1) * cellH) - insetY);
      const rw = x1 - x0 + 1;
      const rh = y1 - y0 + 1;
      if (rw < 6 || rh < 6) continue;

      const cellBgLum = cellBgs[r][c];
      const darkCellBg = cellBgLum < 110;

      const diffs = new Float32Array(rw * rh);
      let cellMaxDiff = 0;
      for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) {
          const v = lum[(y0 + y) * pw + (x0 + x)];
          const diff = Math.max(0, darkCellBg ? v - cellBgLum : cellBgLum - v);
          diffs[y * rw + x] = diff;
          if (diff > cellMaxDiff) cellMaxDiff = diff;
        }
      }
      if (cellMaxDiff < 38) continue;

      const fg = new Float32Array(rw * rh);
      const bin = new Uint8Array(rw * rh);
      const normDenom = Math.max(
        78,
        Math.min(darkCellBg ? 220 : 210, cellMaxDiff)
      );
      const thresh = Math.max(
        30,
        Math.min(size >= 12 ? 40 : 46, cellMaxDiff * 0.36)
      );
      let fgCount = 0;

      for (let i = 0; i < rw * rh; i++) {
        const diff = diffs[i];
        if (diff > 12) {
          fg[i] = Math.min(1, diff / normDenom);
        }
        if (diff >= thresh) {
          bin[i] = 1;
          fgCount++;
        }
      }

      if (fgCount < Math.max(8, rw * rh * 0.014)) continue;

      const visited = new Uint8Array(rw * rh);
      const qx = new Int32Array(rw * rh);
      const qy = new Int32Array(rw * rh);
      let bestComp: {
        count: number;
        minX: number;
        maxX: number;
        minY: number;
        maxY: number;
      } | null = null;

      for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) {
          const sIdx = y * rw + x;
          if (bin[sIdx] === 0 || visited[sIdx]) continue;
          let head = 0;
          let tail = 0;
          qx[tail] = x;
          qy[tail] = y;
          tail++;
          visited[sIdx] = 1;

          let minX = x;
          let maxX = x;
          let minY = y;
          let maxY = y;
          let cnt = 0;

          while (head < tail) {
            const cx = qx[head];
            const cy = qy[head];
            head++;
            cnt++;
            if (cx < minX) minX = cx;
            if (cx > maxX) maxX = cx;
            if (cy < minY) minY = cy;
            if (cy > maxY) maxY = cy;

            const nbs: [number, number][] = [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
              [1, 1],
              [-1, -1],
              [1, -1],
              [-1, 1],
            ];
            for (const [dx, dy] of nbs) {
              const nx = cx + dx;
              const ny = cy + dy;
              if (nx < 0 || nx >= rw || ny < 0 || ny >= rh) continue;
              const nIdx = ny * rw + nx;
              if (bin[nIdx] === 1 && !visited[nIdx]) {
                visited[nIdx] = 1;
                qx[tail] = nx;
                qy[tail] = ny;
                tail++;
              }
            }
          }

          const bh = maxY - minY + 1;
          const bw = maxX - minX + 1;
          // In Killer mode, ignore small cage-sum digits in the top-left corner
          const minHeightFrac = isKiller ? 0.38 : 0.28;
          if (bh < rh * minHeightFrac || bw > rw * 0.96) continue;
          if (isKiller && maxY < rh * 0.38 && maxX < rw * 0.45) continue;

          if (!bestComp || cnt > bestComp.count) {
            bestComp = { count: cnt, minX, maxX, minY, maxY };
          }
        }
      }

      if (!bestComp) continue;

      const cw = bestComp.maxX - bestComp.minX + 1;
      const ch = bestComp.maxY - bestComp.minY + 1;
      const crop = new Float32Array(cw * ch);
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          crop[y * cw + x] = fg[(bestComp.minY + y) * rw + (bestComp.minX + x)];
        }
      }

      const sig = buildGlyphSignatureFromCrop(crop, cw, ch, 0);
      const match = classifyGlyph(sig, templates, allowedSymbolCodes);
      if (match.code >= 1 && match.code <= size && match.confidence >= 0.32) {
        board[r][c] = match.code;
        confidences[r][c] = match.confidence;
        detectedCount++;
      }
    }
  }

  // Extract Killer cages AFTER scanning big digits so fully-given cages cross-verify their sum cleanly
  const cages: KillerCage[] = isKiller
    ? extractKillerCages(
        rgba,
        lum,
        pw,
        ph,
        gridRect,
        size,
        cellBgs,
        templates,
        board
      )
    : [];

  return {
    size,
    boxDims,
    variant,
    board,
    cages,
    confidences,
    gridRect,
    detectedCount,
    detectedCageCount: cages.length,
    imageWidth: pw,
    imageHeight: ph,
  };
}
