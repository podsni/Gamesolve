import { createEmptyGrid, SudokuGrid } from './sudokuSolver';

export interface SudokuGridRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SudokuScanResult {
  board: SudokuGrid;
  confidences: number[][];
  gridRect: SudokuGridRect | null;
  detectedCount: number;
  imageWidth: number;
  imageHeight: number;
}

interface GlyphSignature {
  digit: number;
  pixels: Float32Array; // 24x24 zero-mean unit-norm vector
  binary: Uint8Array;   // 24x24 binary mask (0 or 1)
  aspect: number;       // original bbox w / h
  holes: HoleInfo[];
}

interface HoleInfo {
  area: number;
  cyNorm: number; // 0 (top) .. 1 (bottom)
  cxNorm: number; // 0 (left) .. 1 (right)
}

const GLYPH_SIZE = 24;

/**
 * Flood-fills the background around a 24x24 binary glyph (with 1px padding)
 * to discover enclosed topological holes and their vertical positions.
 * - '8' has 2 holes (top + bottom)
 * - '0', '4', '6', '9' have 1 hole (9 top, 6 bottom, 4 mid-low)
 * - '1', '2', '3', '5', '7' have 0 holes
 */
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

  // Mark exterior background starting from padded corner (0,0)
  bfs(0, 0);

  const holes: HoleInfo[] = [];
  for (let y = 1; y <= size; y++) {
    for (let x = 1; x <= size; x++) {
      const idx = y * pw + x;
      if (pad[idx] === 0 && !visited[idx]) {
        const comp = bfs(x, y);
        if (comp.count >= 4) {
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

/**
 * Normalizes a tight binary/grayscale crop into a 24x24 aspect-preserving glyph signature.
 */
function buildGlyphSignatureFromCrop(
  crop: Float32Array,
  cw: number,
  ch: number,
  digit: number
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
      binary[y * N + x] = v >= 0.42 ? 1 : 0;
    }
  }

  // Zero-mean unit-norm for Normalized Cross-Correlation (NCC)
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
    digit,
    pixels,
    binary,
    aspect: cw / Math.max(1, ch),
    holes: analyzeGlyphHoles(binary, N),
  };
}

let cachedTemplates: GlyphSignature[] | null = null;

/**
 * Generates multi-font sans-serif reference templates (digits 1..9) on an offscreen canvas.
 */
function getDigitTemplates(): GlyphSignature[] {
  if (cachedTemplates) return cachedTemplates;
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
  ];

  for (const font of fontSpecs) {
    for (let digit = 1; digit <= 9; digit++) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 64, 64);
      ctx.fillStyle = '#000000';
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(digit), 32, 33);

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
      const ch = maxY - minY + 1;
      const crop = new Float32Array(cw * ch);
      for (let y = 0; y < ch; y++) {
        for (let x = 0; x < cw; x++) {
          crop[y * cw + x] = 1 - d[((minY + y) * 64 + (minX + x)) * 4] / 255;
        }
      }
      templates.push(buildGlyphSignatureFromCrop(crop, cw, ch, digit));
    }
  }

  cachedTemplates = templates;
  return templates;
}

function classifyGlyph(
  sig: GlyphSignature,
  templates: GlyphSignature[]
): { digit: number; confidence: number } {
  const bestPerDigit = new Float32Array(10).fill(-999);

  for (const tpl of templates) {
    // 1. Normalized Cross-Correlation (NCC) in [-1, 1]
    let dot = 0;
    const a = sig.pixels;
    const b = tpl.pixels;
    for (let i = 0; i < a.length; i++) dot += a[i] * b[i];

    // 2. Aspect ratio penalty (helps distinguish narrow '1' cleanly)
    const aspectDiff = Math.abs(sig.aspect - tpl.aspect);
    const aspectPenalty = aspectDiff * 0.16;

    // 3. Topological hole consistency bonus/penalty
    let topoAdjust = 0;
    const hCount = sig.holes.length;
    const tCount = tpl.holes.length;

    if (tpl.digit === 8) {
      if (hCount === 2) topoAdjust += 0.14;
      else if (hCount === 0) topoAdjust -= 0.18;
    } else if (tpl.digit === 6) {
      if (hCount === 1 && sig.holes[0].cyNorm > 0.52) topoAdjust += 0.12;
      else if (hCount === 1 && sig.holes[0].cyNorm < 0.42) topoAdjust -= 0.16;
      else if (hCount === 2) topoAdjust -= 0.12;
    } else if (tpl.digit === 9) {
      if (hCount === 1 && sig.holes[0].cyNorm < 0.48) topoAdjust += 0.12;
      else if (hCount === 1 && sig.holes[0].cyNorm > 0.58) topoAdjust -= 0.16;
      else if (hCount === 2) topoAdjust -= 0.12;
    } else if (tpl.digit === 4) {
      if (hCount === 1 && sig.holes[0].cyNorm >= 0.32 && sig.holes[0].cyNorm <= 0.68) {
        topoAdjust += 0.08;
      }
    } else if (tCount === 0) {
      if (hCount === 0) topoAdjust += 0.05;
      else if (hCount >= 2) topoAdjust -= 0.18;
      else if (hCount === 1) topoAdjust -= 0.09;
    }

    const score = dot - aspectPenalty + topoAdjust;
    if (score > bestPerDigit[tpl.digit]) {
      bestPerDigit[tpl.digit] = score;
    }
  }

  let bestDigit = 0;
  let bestScore = -999;
  for (let d = 1; d <= 9; d++) {
    if (bestPerDigit[d] > bestScore) {
      bestScore = bestPerDigit[d];
      bestDigit = d;
    }
  }

  return {
    digit: bestDigit,
    confidence: Math.max(0, Math.min(1, bestScore)),
  };
}

/**
 * Locates the exact 9x9 square Sudoku board in a screenshot by finding the largest
 * dark-bordered square grid (ignoring status bar, top stats, bottom keypad & ad banners).
 */
function findSudokuGridRect(
  lum: Uint8Array,
  pw: number,
  ph: number
): SudokuGridRect | null {
  // Determine dominant light/dark board luminance from middle 55% of image
  const hist = new Int32Array(256);
  const yStart = Math.floor(ph * 0.15);
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

  // Compute grid-line pixel mask: pixels clearly contrasting with board background
  const isLinePx = (x: number, y: number): boolean => {
    const v = lum[y * pw + x];
    return isDarkTheme ? v > bgLum + 38 : v < bgLum - 45;
  };

  // Horizontal line score per row (fraction of width that is dark/line pixel)
  const rowScore = new Float32Array(ph);
  for (let y = 0; y < ph; y++) {
    let cnt = 0;
    for (let x = 0; x < pw; x++) {
      if (isLinePx(x, y)) cnt++;
    }
    rowScore[y] = cnt / pw;
  }

  // Find candidate strong horizontal grid lines (spanning >= 55% of screenshot width)
  const hLines: number[] = [];
  for (let y = Math.floor(ph * 0.06); y < Math.floor(ph * 0.88); y++) {
    if (rowScore[y] >= 0.55) {
      // Collapse thick multi-pixel lines to their midpoint
      let yEndRun = y;
      while (yEndRun + 1 < ph && rowScore[yEndRun + 1] >= 0.45) yEndRun++;
      hLines.push((y + yEndRun) * 0.5);
      y = yEndRun;
    }
  }

  // Search for a pair of horizontal lines (top, bottom) whose span matches a square grid
  // and has evenly spaced intermediate grid lines at 1/3, 2/3 (or 1/9..8/9).
  let bestRect: SudokuGridRect | null = null;
  let bestScore = -1;

  for (let i = 0; i < hLines.length; i++) {
    for (let j = i + 1; j < hLines.length; j++) {
      const top = hLines[i];
      const bot = hLines[j];
      const h = bot - top;
      if (h < pw * 0.58 || h > pw * 1.06) continue;

      // Measure vertical line profile strictly inside [top..bot]
      const y0 = Math.max(0, Math.round(top));
      const y1 = Math.min(ph - 1, Math.round(bot));
      const colScore = new Float32Array(pw);
      for (let x = 0; x < pw; x++) {
        let cnt = 0;
        for (let y = y0; y <= y1; y += 2) {
          if (isLinePx(x, y)) cnt++;
        }
        colScore[x] = cnt / Math.max(1, (y1 - y0) / 2);
      }

      let left = -1;
      let right = -1;
      for (let x = 0; x < pw; x++) {
        if (colScore[x] >= 0.65) {
          left = x;
          break;
        }
      }
      for (let x = pw - 1; x >= 0; x--) {
        if (colScore[x] >= 0.65) {
          right = x;
          break;
        }
      }
      if (left < 0 || right <= left) continue;
      const w = right - left;
      const aspectErr = Math.abs(w - h) / Math.max(w, h);
      if (aspectErr > 0.08) continue;

      // Score internal 9x9 grid lines (especially thick 3x3 lines at k = 0, 3, 6, 9)
      let internalScore = 0;
      for (let k = 1; k <= 8; k++) {
        const ey = Math.round(top + (h * k) / 9);
        const ex = Math.round(left + (w * k) / 9);
        let maxR = 0;
        let maxC = 0;
        for (let d = -3; d <= 3; d++) {
          if (ey + d >= 0 && ey + d < ph) maxR = Math.max(maxR, rowScore[ey + d]);
          if (ex + d >= 0 && ex + d < pw) maxC = Math.max(maxC, colScore[ex + d]);
        }
        const weight = k % 3 === 0 ? 2.2 : 1.0;
        internalScore += (maxR + maxC) * weight;
      }

      const totalScore = internalScore * (1 - aspectErr * 2) + (w / pw) * 2;
      if (totalScore > bestScore) {
        bestScore = totalScore;
        bestRect = { x: left, y: top, w, h };
      }
    }
  }

  return bestRect;
}

/**
 * Scans an uploaded Sudoku screenshot HTMLImageElement in-browser:
 * detects the 9x9 grid, extracts each cell's centered digit, and classifies 1..9.
 */
export function scanSudokuFromImage(img: HTMLImageElement): SudokuScanResult {
  const maxDim = 1080;
  const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
  const pw = Math.max(120, Math.round(img.width * scale));
  const ph = Math.max(120, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = pw;
  canvas.height = ph;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    return {
      board: createEmptyGrid(),
      confidences: createEmptyGrid(),
      gridRect: null,
      detectedCount: 0,
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

  const gridRect = findSudokuGridRect(lum, pw, ph);
  if (!gridRect) {
    return {
      board: createEmptyGrid(),
      confidences: createEmptyGrid(),
      gridRect: null,
      detectedCount: 0,
      imageWidth: pw,
      imageHeight: ph,
    };
  }

  const templates = getDigitTemplates();
  const board = createEmptyGrid();
  const confidences: number[][] = Array.from({ length: 9 }, () => Array(9).fill(0));
  let detectedCount = 0;

  const cellW = gridRect.w / 9;
  const cellH = gridRect.h / 9;

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      // Inset by ~14% per side to cleanly exclude cell border lines (even thick 3x3 borders)
      const insetX = Math.max(3, Math.round(cellW * 0.14));
      const insetY = Math.max(3, Math.round(cellH * 0.14));
      const x0 = Math.max(0, Math.round(gridRect.x + c * cellW) + insetX);
      const y0 = Math.max(0, Math.round(gridRect.y + r * cellH) + insetY);
      const x1 = Math.min(pw - 1, Math.round(gridRect.x + (c + 1) * cellW) - insetX);
      const y1 = Math.min(ph - 1, Math.round(gridRect.y + (r + 1) * cellH) - insetY);
      const rw = x1 - x0 + 1;
      const rh = y1 - y0 + 1;
      if (rw < 8 || rh < 8) continue;

      // Estimate local cell background luminance from the cell's border ring
      // (robust across white cells, gray highlighted cells, AND blue selected cells!)
      const ringSamples: number[] = [];
      for (let x = x0; x <= x1; x++) {
        ringSamples.push(lum[y0 * pw + x], lum[y1 * pw + x]);
      }
      for (let y = y0; y <= y1; y++) {
        ringSamples.push(lum[y * pw + x0], lum[y * pw + x1]);
      }
      ringSamples.sort((a, b) => a - b);
      const cellBgLum = ringSamples[Math.floor(ringSamples.length * 0.65)];
      const darkCellBg = cellBgLum < 110;

      // Compute foreground intensity map relative to cell background
      const fg = new Float32Array(rw * rh);
      const bin = new Uint8Array(rw * rh);
      const thresh = 48;
      let fgCount = 0;

      for (let y = 0; y < rh; y++) {
        for (let x = 0; x < rw; x++) {
          const v = lum[(y0 + y) * pw + (x0 + x)];
          const diff = darkCellBg ? v - cellBgLum : cellBgLum - v;
          if (diff > 12) {
            const norm = Math.min(1, diff / Math.max(95, darkCellBg ? 245 - cellBgLum : cellBgLum - 15));
            fg[y * rw + x] = norm;
          }
          if (diff >= thresh) {
            bin[y * rw + x] = 1;
            fgCount++;
          }
        }
      }

      if (fgCount < Math.max(10, rw * rh * 0.015)) continue;

      // Extract connected components to pick the main centered digit (ignores stray specks/notes)
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
          // Main Sudoku digit spans ~35%..95% of inner cell height
          if (bh < rh * 0.3 || bw > rw * 0.96) continue;
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
      const match = classifyGlyph(sig, templates);
      if (match.digit >= 1 && match.digit <= 9 && match.confidence >= 0.35) {
        board[r][c] = match.digit;
        confidences[r][c] = match.confidence;
        detectedCount++;
      }
    }
  }

  return {
    board,
    confidences,
    gridRect,
    detectedCount,
    imageWidth: pw,
    imageHeight: ph,
  };
}
