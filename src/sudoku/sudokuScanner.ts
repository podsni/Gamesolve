import {
  createEmptyGrid,
  digitToSymbol,
  getBoxDims,
  getCageHeadCell,
  KillerCage,
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
  for (let y = Math.floor(ch * 0.34); y <= Math.floor(ch * 0.66); y++) {
    for (let x = Math.floor(cw * 0.34); x <= Math.floor(cw * 0.66); x++) {
      cSum += crop[y * cw + x];
      cCnt++;
    }
  }
  const centerMean = cSum / Math.max(1, cCnt);
  const topMid = crop[Math.floor(cw * 0.5)] + crop[Math.min(ch - 1, 1) * cw + Math.floor(cw * 0.5)];
  const botMid =
    crop[(ch - 1) * cw + Math.floor(cw * 0.5)] +
    crop[Math.max(0, ch - 2) * cw + Math.floor(cw * 0.5)];
  const leftMid =
    crop[Math.floor(ch * 0.5) * cw] +
    crop[Math.floor(ch * 0.5) * cw + Math.min(cw - 1, 1)];
  const rightMid =
    crop[Math.floor(ch * 0.5) * cw + (cw - 1)] +
    crop[Math.floor(ch * 0.5) * cw + Math.max(0, cw - 2)];
  const centerHollow =
    cw / Math.max(1, ch) >= 0.48 &&
    centerMean < 0.28 &&
    topMid >= 0.5 &&
    botMid >= 0.5 &&
    leftMid >= 0.5 &&
    rightMid >= 0.5;

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
): { code: number; confidence: number } {
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
  for (const code of allowedCodes) {
    if (bestPerCode[code] > bestScore) {
      bestScore = bestPerCode[code];
      bestCode = code;
    }
  }

  return {
    code: bestCode,
    confidence: Math.max(0, Math.min(1, bestScore)),
  };
}

interface DetectedGridInfo {
  rect: SudokuGridRect;
  size: SudokuSize;
  isDarkTheme: boolean;
  bgLum: number;
}

/**
 * Evaluates how strongly a candidate size `N` (4, 6, 8, 9, 12, 16) matches the internal
 * horizontal & vertical grid lines inside `rect`, subtracting midpoint line energy so that
 * divisors like 4 or 8 NEVER outscore a true 16x16 grid!
 */
function scoreCandidateGridSize(
  rowScore: Float32Array,
  colScore: Float32Array,
  rect: SudokuGridRect,
  size: SudokuSize,
  pw: number,
  ph: number
): number {
  const { boxRows, boxCols } = getBoxDims(size);
  const cellH = rect.h / size;
  const cellW = rect.w / size;
  const searchRadius = Math.max(2, Math.min(5, Math.round(Math.min(cellW, cellH) * 0.08)));

  let lineSum = 0;
  let lineWeightSum = 0;
  let missingLines = 0;
  for (let k = 1; k < size; k++) {
    const ey = Math.round(rect.y + k * cellH);
    const ex = Math.round(rect.x + k * cellW);
    let maxR = 0;
    let maxC = 0;
    for (let d = -searchRadius; d <= searchRadius; d++) {
      if (ey + d >= 0 && ey + d < ph) maxR = Math.max(maxR, rowScore[ey + d]);
      if (ex + d >= 0 && ex + d < pw) maxC = Math.max(maxC, colScore[ex + d]);
    }
    if (maxR < 0.42) missingLines++;
    if (maxC < 0.42) missingLines++;
    const wR = k % boxRows === 0 ? 1.55 : 1.0;
    const wC = k % boxCols === 0 ? 1.55 : 1.0;
    lineSum += maxR * wR + maxC * wC;
    lineWeightSum += wR + wC;
  }
  const avgLine = lineSum / Math.max(1, lineWeightSum);
  const missingPenalty = (missingLines / Math.max(1, (size - 1) * 2)) * 1.4;

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
      if (my + d >= 0 && my + d < ph) maxR = Math.max(maxR, rowScore[my + d]);
      if (mx + d >= 0 && mx + d < pw) maxC = Math.max(maxC, colScore[mx + d]);
    }
    midSum += (maxR + maxC) * 0.5;
  }
  const avgMid = midSum / size;

  // Also check 1/3 and 2/3 interior points so N=4 on a 12x12 doesn't get fooled
  let thirdPenalty = 0;
  if (size <= 8) {
    let tSum = 0;
    for (let k = 0; k < size; k++) {
      const ty = Math.round(rect.y + (k + 0.333) * cellH);
      const tx = Math.round(rect.x + (k + 0.333) * cellW);
      let mr = 0;
      let mc = 0;
      for (let d = -2; d <= 2; d++) {
        if (ty + d >= 0 && ty + d < ph) mr = Math.max(mr, rowScore[ty + d]);
        if (tx + d >= 0 && tx + d < pw) mc = Math.max(mc, colScore[tx + d]);
      }
      tSum += (mr + mc) * 0.5;
    }
    const avgThird = tSum / size;
    if (avgThird > 0.45) thirdPenalty = (avgThird - 0.35) * 0.8;
  }

  return avgLine - avgMid * 1.15 - thirdPenalty - missingPenalty;
}

/**
 * Locates the square Sudoku board and auto-detects its grid size (4, 6, 8, 9, 12, or 16).
 */
function findSudokuGridAndSize(
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

  const isLinePx = (x: number, y: number): boolean => {
    const v = lum[y * pw + x];
    return isDarkTheme ? v > bgLum + 32 : v < bgLum - 35;
  };

  // Horizontal line score per row (fraction of screenshot width that is line-colored)
  const rowScoreGlobal = new Float32Array(ph);
  for (let y = 0; y < ph; y++) {
    let cnt = 0;
    for (let x = 0; x < pw; x++) {
      if (isLinePx(x, y)) cnt++;
    }
    rowScoreGlobal[y] = cnt / pw;
  }

  const hLines: number[] = [];
  const maxGridLineThickness = Math.max(12, Math.round(ph * 0.014));
  for (let y = Math.floor(ph * 0.05); y < Math.floor(ph * 0.92); y++) {
    if (rowScoreGlobal[y] >= 0.52) {
      let yEndRun = y;
      while (yEndRun + 1 < ph && rowScoreGlobal[yEndRun + 1] >= 0.42) yEndRun++;
      // Reject thick solid UI banners/headers (real Sudoku borders are thin lines <= ~12px)
      if (yEndRun - y <= maxGridLineThickness) {
        hLines.push((y + yEndRun) * 0.5);
      }
      y = yEndRun;
    }
  }

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
      const colScore = new Float32Array(pw);
      const yStep = Math.max(1, Math.floor((y1 - y0) / 360));
      let samplesY = 0;
      for (let y = y0; y <= y1; y += yStep) samplesY++;
      for (let x = 0; x < pw; x++) {
        let cnt = 0;
        for (let y = y0; y <= y1; y += yStep) {
          if (isLinePx(x, y)) cnt++;
        }
        colScore[x] = cnt / Math.max(1, samplesY);
      }

      let left = -1;
      let right = -1;
      for (let x = 0; x < pw; x++) {
        if (colScore[x] >= 0.78) {
          left = x;
          break;
        }
      }
      for (let x = pw - 1; x >= 0; x--) {
        if (colScore[x] >= 0.78) {
          right = x;
          break;
        }
      }
      if (left < 0 || right <= left) continue;
      const w = right - left;
      const aspectErr = Math.abs(w - h) / Math.max(w, h);
      if (aspectErr > 0.25) continue;

      // Verify left & right borders are continuous in BOTH the top 12% and bottom 12%
      const capH = Math.max(6, Math.round((y1 - y0) * 0.12));
      let topCapL = 0;
      let topCapR = 0;
      let botCapL = 0;
      let botCapR = 0;
      for (let dy = 0; dy < capH; dy++) {
        if (isLinePx(left, y0 + dy) || isLinePx(Math.min(pw - 1, left + 1), y0 + dy)) topCapL++;
        if (isLinePx(right, y0 + dy) || isLinePx(Math.max(0, right - 1), y0 + dy)) topCapR++;
        if (isLinePx(left, y1 - dy) || isLinePx(Math.min(pw - 1, left + 1), y1 - dy)) botCapL++;
        if (isLinePx(right, y1 - dy) || isLinePx(Math.max(0, right - 1), y1 - dy)) botCapR++;
      }
      if (
        topCapL / capH < 0.75 ||
        topCapR / capH < 0.75 ||
        botCapL / capH < 0.75 ||
        botCapR / capH < 0.75
      ) {
        continue;
      }

      // Compute exact horizontal line profile strictly inside [left..right]
      const rowScoreLocal = new Float32Array(ph);
      const xStep = Math.max(1, Math.floor(w / 360));
      let samplesX = 0;
      for (let x = left; x <= right; x += xStep) samplesX++;
      for (let y = y0; y <= y1; y++) {
        let cnt = 0;
        for (let x = left; x <= right; x += xStep) {
          if (isLinePx(x, y)) cnt++;
        }
        rowScoreLocal[y] = cnt / Math.max(1, samplesX);
      }

      // Outer top & bottom edges must be solid continuous board borders
      if (rowScoreLocal[y0] < 0.78 || rowScoreLocal[y1] < 0.78) continue;

      const rect: SudokuGridRect = { x: left, y: top, w, h };

      for (const sz of candidateSizes) {
        const gridScore = scoreCandidateGridSize(
          rowScoreLocal,
          colScore,
          rect,
          sz,
          pw,
          ph
        );
        const borderBonus =
          (rowScoreLocal[y0] + rowScoreLocal[y1] + colScore[left] + colScore[right]) *
          0.06;
        const totalScore =
          gridScore * (1 - aspectErr * 0.35) + borderBonus + (w / pw) * 0.12;
        if (totalScore > bestTotalScore) {
          bestTotalScore = totalScore;
          bestInfo = {
            rect,
            size: sz,
            isDarkTheme,
            bgLum,
          };
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
  c: number
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
  if (samples.length === 0) return 255;
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length * 0.72)];
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
  templates: GlyphSignature[]
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
  let nextId = 1;

  for (const cells of groups.values()) {
    const tempCage: KillerCage = { id: nextId, sum: 0, cells };
    const head = getCageHeadCell(tempCage);
    let parsedSum = 0;

    if (head) {
      const [hr, hc] = head;
      const bgLum = cellBgs[hr][hc];
      const darkBg = bgLum < 110;

      // Top-left corner ROI where small cage sum (e.g. "13", "8", "14", "10", "11") sits.
      // Inset slightly more on thick box-divider edges so the thick black 3x3 line never leaks into the ROI.
      const { boxRows, boxCols } = getBoxDims(size);
      const xInsetFrac = hc > 0 && hc % boxCols === 0 ? 0.062 : 0.04;
      const yInsetFrac = hr > 0 && hr % boxRows === 0 ? 0.062 : 0.04;
      const x0 = Math.max(0, Math.round(gridRect.x + hc * cellW + cellW * xInsetFrac));
      const y0 = Math.max(0, Math.round(gridRect.y + hr * cellH + cellH * yInsetFrac));
      const x1 = Math.min(pw - 1, Math.round(gridRect.x + hc * cellW + cellW * 0.42));
      const y1 = Math.min(ph - 1, Math.round(gridRect.y + hr * cellH + cellH * 0.34));
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
          if (bw > bh * 0.86 && bw >= 10) {
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
            // Trim both halves tightly around ink pixels without discarding thin stroke columns
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
        }

        // Keep up to 2 horizontally aligned digits closest to top-left (excluding far-right border dashes)
        splitComps.sort((a, b) => a.minX - b.minX);
        const digitComps = splitComps
          .filter((comp) => comp.minX < rw * 0.72)
          .slice(0, 2);

        let numStr = '';
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
            numStr += String(match.code);
          }
        }
        const val = parseInt(numStr, 10);
        const maxPossible = (cells.length * (2 * size - cells.length + 1)) / 2;
        const minPossible = (cells.length * (cells.length + 1)) / 2;
        if (!Number.isNaN(val) && val >= minPossible && val <= maxPossible) {
          parsedSum = val;
        }
      }
    }

    cages.push({
      id: nextId++,
      sum: parsedSum,
      cells,
    });
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
  const fallbackVariant: SudokuVariant = variantHint === 'auto' ? 'classic' : variantHint;

  const canvas = document.createElement('canvas');
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return {
      size: fallbackSize,
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

  const gridInfo = findSudokuGridAndSize(lum, pw, ph, sizeHint);
  if (!gridInfo) {
    return {
      size: fallbackSize,
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

  const { rect: gridRect, size } = gridInfo;
  const templates = getSymbolTemplates();
  const cellBgs: number[][] = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) =>
      estimateCellBgLum(lum, pw, ph, gridRect, size, r, c)
    )
  );

  const isKiller =
    variantHint === 'killer'
      ? true
      : variantHint === 'classic'
        ? false
        : detectIsKillerSudoku(rgba, lum, pw, ph, gridRect, size, cellBgs);

  const variant: SudokuVariant = isKiller ? 'killer' : 'classic';
  const cages: KillerCage[] = isKiller
    ? extractKillerCages(rgba, lum, pw, ph, gridRect, size, cellBgs, templates)
    : [];

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

      const fg = new Float32Array(rw * rh);
      const bin = new Uint8Array(rw * rh);
      const thresh = size >= 12 ? 40 : 46;
      let fgCount = 0;

      for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) {
          const v = lum[(y0 + y) * pw + (x0 + x)];
          const diff = darkCellBg ? v - cellBgLum : cellBgLum - v;
          if (diff > 12) {
            fg[y * rw + x] = Math.min(
              1,
              diff / Math.max(92, darkCellBg ? 245 - cellBgLum : cellBgLum - 15)
            );
          }
          if (diff >= thresh) {
            bin[y * rw + x] = 1;
            fgCount++;
          }
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
          const minHeightFrac = isKiller ? 0.38 : 0.3;
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

  return {
    size,
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
