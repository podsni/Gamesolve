export type SudokuSize = 4 | 6 | 8 | 9 | 12 | 16;
export type SudokuVariant = 'classic' | 'killer';
export type SudokuGrid = number[][]; // size x size, 0 = empty, 1..size = filled

export interface BoxDims {
  boxRows: number;
  boxCols: number;
}

export interface KillerCage {
  id: number;
  sum: number;
  cells: [number, number][];
}

export interface SudokuSolveOptions {
  size?: SudokuSize;
  cages?: KillerCage[];
}

export interface SudokuSolveResult {
  solved: boolean;
  solution: SudokuGrid | null;
  hasMultipleSolutions: boolean;
  invalidReason: string | null;
  solveTimeMs: number;
}

export interface SudokuHint {
  row: number;
  col: number;
  value: number;
  symbol: string;
  technique: 'Killer Cage' | 'Naked Single' | 'Hidden Single' | 'Logika Lanjutan';
  reason: string;
}

export interface SudokuPreset {
  key: string;
  label: string;
  difficulty: string;
  size: SudokuSize;
  variant: SudokuVariant;
  board: SudokuGrid;
  cages?: KillerCage[];
}

export const SUPPORTED_SUDOKU_SIZES: SudokuSize[] = [4, 6, 8, 9, 12, 16];

export function getBoxDims(size: SudokuSize): BoxDims {
  switch (size) {
    case 4:
      return { boxRows: 2, boxCols: 2 };
    case 6:
      return { boxRows: 2, boxCols: 3 };
    case 8:
      return { boxRows: 2, boxCols: 4 };
    case 9:
      return { boxRows: 3, boxCols: 3 };
    case 12:
      return { boxRows: 3, boxCols: 4 };
    case 16:
      return { boxRows: 4, boxCols: 4 };
  }
}

export function isSupportedSize(n: number): n is SudokuSize {
  return n === 4 || n === 6 || n === 8 || n === 9 || n === 12 || n === 16;
}

export function inferGridSize(grid: SudokuGrid): SudokuSize {
  const n = grid.length;
  return isSupportedSize(n) ? n : 9;
}

/**
 * Formats an internal 1..16 value to its display symbol: 1..9, A..G.
 */
export function digitToSymbol(val: number): string {
  if (val <= 0) return '';
  if (val <= 9) return String(val);
  if (val <= 16) return String.fromCharCode(65 + (val - 10)); // 10->A .. 16->G
  return String(val);
}

/**
 * Parses a user-typed character ('1'..'9', 'A'..'G'/'a'..'g') to 1..size, or null if invalid.
 */
export function symbolToDigit(ch: string, size: SudokuSize): number | null {
  const up = ch.trim().toUpperCase();
  if (up.length !== 1) return null;
  let val = 0;
  if (up >= '1' && up <= '9') {
    val = up.charCodeAt(0) - 48;
  } else if (up >= 'A' && up <= 'G') {
    val = 10 + (up.charCodeAt(0) - 65);
  }
  return val >= 1 && val <= size ? val : null;
}

export function createEmptyGrid(size: SudokuSize = 9): SudokuGrid {
  return Array.from({ length: size }, () => Array(size).fill(0));
}

export function cloneGrid(grid: SudokuGrid): SudokuGrid {
  return grid.map((row) => row.slice());
}

export function countFilledCells(grid: SudokuGrid): number {
  let count = 0;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid[r].length; c++) {
      if (grid[r][c] >= 1) count++;
    }
  }
  return count;
}

/**
 * Returns the canonical top-left cell of a Killer cage (smallest row, then smallest col).
 */
export function getCageHeadCell(cage: KillerCage): [number, number] | null {
  if (cage.cells.length === 0) return null;
  let best = cage.cells[0];
  for (let i = 1; i < cage.cells.length; i++) {
    const [r, c] = cage.cells[i];
    if (r < best[0] || (r === best[0] && c < best[1])) {
      best = [r, c];
    }
  }
  return best;
}

/**
 * Minimum possible sum of `k` distinct digits selected from bitmask `availMask` (bits 0..size-1).
 */
function minDistinctSum(availMask: number, k: number, size: number): number {
  if (k <= 0) return 0;
  let sum = 0;
  let picked = 0;
  for (let d = 1; d <= size && picked < k; d++) {
    if (availMask & (1 << (d - 1))) {
      sum += d;
      picked++;
    }
  }
  return picked === k ? sum : 99999;
}

/**
 * Maximum possible sum of `k` distinct digits selected from bitmask `availMask` (bits 0..size-1).
 */
function maxDistinctSum(availMask: number, k: number, size: number): number {
  if (k <= 0) return 0;
  let sum = 0;
  let picked = 0;
  for (let d = size; d >= 1 && picked < k; d--) {
    if (availMask & (1 << (d - 1))) {
      sum += d;
      picked++;
    }
  }
  return picked === k ? sum : -99999;
}

/**
 * Returns a Set of `"r,c"` keys for every cell that violates row/col/box uniqueness
 * OR Killer cage uniqueness/sum rules.
 */
export function findConflicts(
  grid: SudokuGrid,
  options?: SudokuSolveOptions
): Set<string> {
  const size = options?.size ?? inferGridSize(grid);
  const { boxRows, boxCols } = getBoxDims(size);
  const conflicts = new Set<string>();

  // Rows
  for (let r = 0; r < size; r++) {
    const seen = new Map<number, number[]>();
    for (let c = 0; c < size; c++) {
      const v = grid[r][c];
      if (v < 1 || v > size) continue;
      const list = seen.get(v) || [];
      list.push(c);
      seen.set(v, list);
    }
    for (const cols of seen.values()) {
      if (cols.length > 1) {
        for (const c of cols) conflicts.add(`${r},${c}`);
      }
    }
  }

  // Columns
  for (let c = 0; c < size; c++) {
    const seen = new Map<number, number[]>();
    for (let r = 0; r < size; r++) {
      const v = grid[r][c];
      if (v < 1 || v > size) continue;
      const list = seen.get(v) || [];
      list.push(r);
      seen.set(v, list);
    }
    for (const rows of seen.values()) {
      if (rows.length > 1) {
        for (const r of rows) conflicts.add(`${r},${c}`);
      }
    }
  }

  // Boxes (boxRows x boxCols)
  for (let br = 0; br < size; br += boxRows) {
    for (let bc = 0; bc < size; bc += boxCols) {
      const seen = new Map<number, [number, number][]>();
      for (let dr = 0; dr < boxRows; dr++) {
        for (let dc = 0; dc < boxCols; dc++) {
          const r = br + dr;
          const c = bc + dc;
          const v = grid[r][c];
          if (v < 1 || v > size) continue;
          const list = seen.get(v) || [];
          list.push([r, c]);
          seen.set(v, list);
        }
      }
      for (const coords of seen.values()) {
        if (coords.length > 1) {
          for (const [r, c] of coords) conflicts.add(`${r},${c}`);
        }
      }
    }
  }

  // Killer cages (uniqueness + exact/partial sum bounds)
  const cages = options?.cages;
  if (cages && cages.length > 0) {
    const fullMask = (1 << size) - 1;
    for (const cage of cages) {
      if (!cage.cells.length || cage.sum <= 0) continue;
      const seen = new Map<number, [number, number][]>();
      let usedMask = 0;
      let filledSum = 0;
      let emptyCount = 0;

      for (const [r, c] of cage.cells) {
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const v = grid[r][c];
        if (v >= 1 && v <= size) {
          filledSum += v;
          usedMask |= 1 << (v - 1);
          const list = seen.get(v) || [];
          list.push([r, c]);
          seen.set(v, list);
        } else {
          emptyCount++;
        }
      }

      // Duplicate digit inside cage
      for (const coords of seen.values()) {
        if (coords.length > 1) {
          for (const [r, c] of coords) conflicts.add(`${r},${c}`);
        }
      }

      // Sum violation
      const rem = cage.sum - filledSum;
      if (emptyCount === 0) {
        if (rem !== 0) {
          for (const [r, c] of cage.cells) conflicts.add(`${r},${c}`);
        }
      } else {
        const availMask = fullMask & ~usedMask;
        const minRem = minDistinctSum(availMask, emptyCount, size);
        const maxRem = maxDistinctSum(availMask, emptyCount, size);
        if (rem < minRem || rem > maxRem) {
          for (const [r, c] of cage.cells) conflicts.add(`${r},${c}`);
        }
      }
    }
  }

  return conflicts;
}

export function getCellCandidates(
  grid: SudokuGrid,
  row: number,
  col: number,
  options?: SudokuSolveOptions
): number[] {
  const size = options?.size ?? inferGridSize(grid);
  if (grid[row][col] !== 0) return [];
  const { boxRows, boxCols } = getBoxDims(size);
  const fullMask = (1 << size) - 1;

  let usedMask = 0;
  for (let i = 0; i < size; i++) {
    const rv = grid[row][i];
    if (rv >= 1 && rv <= size) usedMask |= 1 << (rv - 1);
    const cv = grid[i][col];
    if (cv >= 1 && cv <= size) usedMask |= 1 << (cv - 1);
  }
  const br = Math.floor(row / boxRows) * boxRows;
  const bc = Math.floor(col / boxCols) * boxCols;
  for (let dr = 0; dr < boxRows; dr++) {
    for (let dc = 0; dc < boxCols; dc++) {
      const bv = grid[br + dr][bc + dc];
      if (bv >= 1 && bv <= size) usedMask |= 1 << (bv - 1);
    }
  }

  let cageForCell: KillerCage | null = null;
  if (options?.cages) {
    for (const cage of options.cages) {
      if (cage.cells.some(([r, c]) => r === row && c === col)) {
        cageForCell = cage;
        break;
      }
    }
  }

  let cageUsed = 0;
  let cageFilledSum = 0;
  let cageEmptyCount = 0;
  if (cageForCell && cageForCell.sum > 0) {
    for (const [r, c] of cageForCell.cells) {
      const v = grid[r][c];
      if (v >= 1 && v <= size) {
        cageUsed |= 1 << (v - 1);
        cageFilledSum += v;
      } else {
        cageEmptyCount++;
      }
    }
    usedMask |= cageUsed;
  }

  const res: number[] = [];
  for (let d = 1; d <= size; d++) {
    const bit = 1 << (d - 1);
    if (usedMask & bit) continue;

    if (cageForCell && cageForCell.sum > 0) {
      const remAfter = cageForCell.sum - cageFilledSum - d;
      const otherEmpty = cageEmptyCount - 1;
      if (otherEmpty === 0) {
        if (remAfter !== 0) continue;
      } else {
        const availAfter = fullMask & ~(cageUsed | bit);
        const lo = minDistinctSum(availAfter, otherEmpty, size);
        const hi = maxDistinctSum(availAfter, otherEmpty, size);
        if (remAfter < lo || remAfter > hi) continue;
      }
    }
    res.push(d);
  }
  return res;
}

function popcount16(mask: number): number {
  let c = 0;
  let m = mask;
  while (m) {
    m &= m - 1;
    c++;
  }
  return c;
}

/**
 * High-speed bitmask + constraint-propagation (Naked Singles + Hidden Singles + Killer cage bounds)
 * + MRV backtracking solver supporting 4x4, 6x6, 8x8, 9x9, 12x12, 16x16 and Killer Sudoku!
 */
export function solveSudoku(
  grid: SudokuGrid,
  options?: SudokuSolveOptions
): SudokuSolveResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const size = options?.size ?? inferGridSize(grid);
  const { boxRows, boxCols } = getBoxDims(size);
  const boxesPerRow = size / boxCols;
  const cages = (options?.cages ?? []).filter(
    (c) => c.cells.length > 0 && c.sum > 0
  );

  const conflicts = findConflicts(grid, { size, cages });
  if (conflicts.size > 0) {
    return {
      solved: false,
      solution: null,
      hasMultipleSolutions: false,
      invalidReason:
        cages.length > 0
          ? 'Terdapat konflik angka duplikat atau jumlah sangkar Killer yang tidak cocok (ditandai merah). Perbaiki dulu sebelum di-solve.'
          : 'Terdapat angka duplikat pada baris, kolom, atau kotak (ditandai merah). Perbaiki dulu sebelum di-solve.',
      solveTimeMs: 0,
    };
  }

  const N = size;
  const totalCells = N * N;
  const FULL_MASK = (1 << N) - 1;

  // Map each cell index -> box index and optional cage index
  const cellBox = new Int32Array(totalCells);
  const cellCage = new Int32Array(totalCells).fill(-1);
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      cellBox[r * N + c] =
        Math.floor(r / boxRows) * boxesPerRow + Math.floor(c / boxCols);
    }
  }

  const cageCellsIdx: number[][] = [];
  const cageTargetSum = new Int32Array(cages.length);
  for (let i = 0; i < cages.length; i++) {
    cageTargetSum[i] = cages[i].sum;
    const idxs: number[] = [];
    for (const [r, c] of cages[i].cells) {
      if (r >= 0 && r < N && c >= 0 && c < N) {
        const idx = r * N + c;
        cellCage[idx] = i;
        idxs.push(idx);
      }
    }
    cageCellsIdx.push(idxs);
  }

  const board = new Int32Array(totalCells);
  const rowMask = new Int32Array(N);
  const colMask = new Int32Array(N);
  const boxMask = new Int32Array(N);
  const cageMask = new Int32Array(cages.length);
  const cageSum = new Int32Array(cages.length);
  const cageEmpty = new Int32Array(cages.length);
  for (let i = 0; i < cages.length; i++) cageEmpty[i] = cageCellsIdx[i].length;

  let initialFilled = 0;
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const v = grid[r][c];
      if (v >= 1 && v <= N) {
        const idx = r * N + c;
        const bit = 1 << (v - 1);
        board[idx] = v;
        rowMask[r] |= bit;
        colMask[c] |= bit;
        boxMask[cellBox[idx]] |= bit;
        const cg = cellCage[idx];
        if (cg !== -1) {
          cageMask[cg] |= bit;
          cageSum[cg] += v;
          cageEmpty[cg]--;
        }
        initialFilled++;
      }
    }
  }

  // Undo trail for fast O(1) placement & rollback during propagation + search
  const trailIdx = new Int32Array(totalCells * 2);
  const trailVal = new Int32Array(totalCells * 2);
  let trailLen = 0;

  function place(idx: number, digit: number): boolean {
    const r = Math.floor(idx / N);
    const c = idx - r * N;
    const b = cellBox[idx];
    const bit = 1 << (digit - 1);
    if ((rowMask[r] | colMask[c] | boxMask[b]) & bit) return false;

    const cg = cellCage[idx];
    if (cg !== -1) {
      if (cageMask[cg] & bit) return false;
      const newSum = cageSum[cg] + digit;
      const newEmpty = cageEmpty[cg] - 1;
      const rem = cageTargetSum[cg] - newSum;
      if (newEmpty === 0) {
        if (rem !== 0) return false;
      } else {
        const avail = FULL_MASK & ~(cageMask[cg] | bit);
        const lo = minDistinctSum(avail, newEmpty, N);
        const hi = maxDistinctSum(avail, newEmpty, N);
        if (rem < lo || rem > hi) return false;
      }
      cageMask[cg] |= bit;
      cageSum[cg] = newSum;
      cageEmpty[cg] = newEmpty;
    }

    board[idx] = digit;
    rowMask[r] |= bit;
    colMask[c] |= bit;
    boxMask[b] |= bit;
    trailIdx[trailLen] = idx;
    trailVal[trailLen] = digit;
    trailLen++;
    return true;
  }

  function rollback(targetLen: number) {
    while (trailLen > targetLen) {
      trailLen--;
      const idx = trailIdx[trailLen];
      const digit = trailVal[trailLen];
      const r = Math.floor(idx / N);
      const c = idx - r * N;
      const b = cellBox[idx];
      const bit = 1 << (digit - 1);
      board[idx] = 0;
      rowMask[r] ^= bit;
      colMask[c] ^= bit;
      boxMask[b] ^= bit;
      const cg = cellCage[idx];
      if (cg !== -1) {
        cageMask[cg] ^= bit;
        cageSum[cg] -= digit;
        cageEmpty[cg]++;
      }
    }
  }

  function getCellMask(idx: number): number {
    const r = Math.floor(idx / N);
    const c = idx - r * N;
    const b = cellBox[idx];
    let avail = FULL_MASK & ~(rowMask[r] | colMask[c] | boxMask[b]);
    const cg = cellCage[idx];
    if (cg !== -1 && avail !== 0) {
      avail &= ~cageMask[cg];
      if (avail === 0) return 0;
      const remNeeded = cageTargetSum[cg] - cageSum[cg];
      const emptyLeft = cageEmpty[cg];
      if (emptyLeft === 1) {
        if (remNeeded < 1 || remNeeded > N) return 0;
        avail &= 1 << (remNeeded - 1);
      } else {
        // Filter digits that exceed killer min/max remaining bounds
        let filtered = 0;
        let m = avail;
        while (m) {
          const bit = m & -m;
          m ^= bit;
          const d = Math.clz32(1) - Math.clz32(bit) + 1;
          const remAfter = remNeeded - d;
          const restMask = FULL_MASK & ~(cageMask[cg] | bit);
          const lo = minDistinctSum(restMask, emptyLeft - 1, N);
          const hi = maxDistinctSum(restMask, emptyLeft - 1, N);
          if (remAfter >= lo && remAfter <= hi) {
            filtered |= bit;
          }
        }
        avail = filtered;
      }
    }
    return avail;
  }

  /**
   * Propagates forced moves (Naked Singles + Killer 1-cell remainders + Hidden Singles in rows/cols/boxes).
   * Returns false immediately on contradiction.
   */
  function propagate(): boolean {
    let changed = true;
    while (changed) {
      changed = false;

      // 1. Naked Singles (also checks contradictions)
      for (let idx = 0; idx < totalCells; idx++) {
        if (board[idx] !== 0) continue;
        const avail = getCellMask(idx);
        if (avail === 0) return false;
        if ((avail & (avail - 1)) === 0) {
          const digit = Math.clz32(1) - Math.clz32(avail) + 1;
          if (!place(idx, digit)) return false;
          changed = true;
        }
      }
      if (changed) continue;

      // 2. Hidden Singles in Rows
      for (let r = 0; r < N; r++) {
        const missing = FULL_MASK & ~rowMask[r];
        if (missing === 0) continue;
        let once = 0;
        let multi = 0;
        const pos = new Int32Array(N);
        for (let c = 0; c < N; c++) {
          const idx = r * N + c;
          if (board[idx] !== 0) continue;
          const avail = getCellMask(idx);
          if (avail === 0) return false;
          multi |= once & avail;
          once |= avail;
          let m = avail;
          while (m) {
            const bit = m & -m;
            m ^= bit;
            pos[Math.clz32(1) - Math.clz32(bit)] = idx;
          }
        }
        if ((once & missing) !== missing) return false;
        let singles = once & ~multi & missing;
        while (singles) {
          const bit = singles & -singles;
          singles ^= bit;
          const dIdx = Math.clz32(1) - Math.clz32(bit);
          if (!place(pos[dIdx], dIdx + 1)) return false;
          changed = true;
        }
      }
      if (changed) continue;

      // 3. Hidden Singles in Columns
      for (let c = 0; c < N; c++) {
        const missing = FULL_MASK & ~colMask[c];
        if (missing === 0) continue;
        let once = 0;
        let multi = 0;
        const pos = new Int32Array(N);
        for (let r = 0; r < N; r++) {
          const idx = r * N + c;
          if (board[idx] !== 0) continue;
          const avail = getCellMask(idx);
          if (avail === 0) return false;
          multi |= once & avail;
          once |= avail;
          let m = avail;
          while (m) {
            const bit = m & -m;
            m ^= bit;
            pos[Math.clz32(1) - Math.clz32(bit)] = idx;
          }
        }
        if ((once & missing) !== missing) return false;
        let singles = once & ~multi & missing;
        while (singles) {
          const bit = singles & -singles;
          singles ^= bit;
          const dIdx = Math.clz32(1) - Math.clz32(bit);
          if (!place(pos[dIdx], dIdx + 1)) return false;
          changed = true;
        }
      }
      if (changed) continue;

      // 4. Hidden Singles in Boxes
      for (let b = 0; b < N; b++) {
        const missing = FULL_MASK & ~boxMask[b];
        if (missing === 0) continue;
        const br = Math.floor(b / boxesPerRow) * boxRows;
        const bc = (b % boxesPerRow) * boxCols;
        let once = 0;
        let multi = 0;
        const pos = new Int32Array(N);
        for (let dr = 0; dr < boxRows; dr++) {
          for (let dc = 0; dc < boxCols; dc++) {
            const idx = (br + dr) * N + (bc + dc);
            if (board[idx] !== 0) continue;
            const avail = getCellMask(idx);
            if (avail === 0) return false;
            multi |= once & avail;
            once |= avail;
            let m = avail;
            while (m) {
              const bit = m & -m;
              m ^= bit;
              pos[Math.clz32(1) - Math.clz32(bit)] = idx;
            }
          }
        }
        if ((once & missing) !== missing) return false;
        let singles = once & ~multi & missing;
        while (singles) {
          const bit = singles & -singles;
          singles ^= bit;
          const dIdx = Math.clz32(1) - Math.clz32(bit);
          if (!place(pos[dIdx], dIdx + 1)) return false;
          changed = true;
        }
      }
    }
    return true;
  }

  let firstSolution: SudokuGrid | null = null;
  let solutionCount = 0;
  let nodesVisited = 0;
  const MAX_NODES = N >= 12 ? 450_000 : 350_000;

  function toGrid2D(): SudokuGrid {
    const out: SudokuGrid = [];
    for (let r = 0; r < N; r++) {
      const row: number[] = [];
      for (let c = 0; c < N; c++) row.push(board[r * N + c]);
      out.push(row);
    }
    return out;
  }

  function search(): boolean {
    if (++nodesVisited > MAX_NODES) return solutionCount >= 1;

    const mark = trailLen;
    if (!propagate()) {
      rollback(mark);
      return false;
    }

    // Find empty cell with fewest valid candidates (MRV)
    let bestIdx = -1;
    let bestCount = N + 1;
    let bestAvail = 0;

    for (let idx = 0; idx < totalCells; idx++) {
      if (board[idx] !== 0) continue;
      const avail = getCellMask(idx);
      if (avail === 0) {
        rollback(mark);
        return false;
      }
      const cnt = popcount16(avail);
      if (cnt < bestCount) {
        bestCount = cnt;
        bestIdx = idx;
        bestAvail = avail;
        if (cnt === 2) break; // Propagation already handled cnt === 1
      }
    }

    if (bestIdx === -1) {
      // Every cell filled!
      solutionCount++;
      if (!firstSolution) {
        firstSolution = toGrid2D();
      }
      rollback(mark);
      return solutionCount >= 2;
    }

    let m = bestAvail;
    while (m) {
      const bit = m & -m;
      m ^= bit;
      const digit = Math.clz32(1) - Math.clz32(bit) + 1;
      const stepMark = trailLen;
      if (place(bestIdx, digit)) {
        if (search()) {
          rollback(mark);
          return true;
        }
      }
      rollback(stepMark);
    }

    rollback(mark);
    return false;
  }

  if (initialFilled === totalCells) {
    firstSolution = toGrid2D();
    solutionCount = 1;
  } else {
    search();
  }

  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();

  if (!firstSolution) {
    return {
      solved: false,
      solution: null,
      hasMultipleSolutions: false,
      invalidReason:
        cages.length > 0
          ? 'Tidak ada solusi valid untuk susunan angka dan sangkar Killer ini. Cek kembali angka soal atau jumlah sangkar hasil scan.'
          : 'Tidak ada solusi yang valid untuk susunan angka ini. Cek kembali apakah ada simbol hasil scan yang keliru.',
      solveTimeMs: Math.max(0, t1 - t0),
    };
  }

  return {
    solved: true,
    solution: firstSolution,
    hasMultipleSolutions: solutionCount >= 2,
    invalidReason: null,
    solveTimeMs: Math.max(0, t1 - t0),
  };
}

/**
 * Finds the clearest single next logical step (Killer Cage -> Naked Single -> Hidden Single -> Solver deduction).
 */
export function getNextSudokuHint(
  grid: SudokuGrid,
  options?: SudokuSolveOptions
): SudokuHint | null {
  const size = options?.size ?? inferGridSize(grid);
  const { boxRows, boxCols } = getBoxDims(size);
  const cages = options?.cages ?? [];

  const solved = solveSudoku(grid, { size, cages });
  if (!solved.solved || !solved.solution) return null;

  // 0. Killer Cage with exactly 1 empty cell left
  for (const cage of cages) {
    if (cage.sum <= 0 || cage.cells.length === 0) continue;
    let emptyCell: [number, number] | null = null;
    let emptyCount = 0;
    let currentSum = 0;
    for (const [r, c] of cage.cells) {
      if (grid[r][c] === 0) {
        emptyCell = [r, c];
        emptyCount++;
      } else {
        currentSum += grid[r][c];
      }
    }
    if (emptyCount === 1 && emptyCell) {
      const [r, c] = emptyCell;
      const val = cage.sum - currentSum;
      if (val >= 1 && val <= size) {
        const sym = digitToSymbol(val);
        return {
          row: r,
          col: c,
          value: val,
          symbol: sym,
          technique: 'Killer Cage',
          reason: `Sangkar berjumlah ${cage.sum} menyisakan 1 sel di Baris ${r + 1}, Kolom ${c + 1}, sehingga nilainya pasti ${sym} (${cage.sum} − ${currentSum}).`,
        };
      }
    }
  }

  // 1. Naked Single
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] !== 0) continue;
      const cands = getCellCandidates(grid, r, c, { size, cages });
      if (cands.length === 1) {
        const sym = digitToSymbol(cands[0]);
        return {
          row: r,
          col: c,
          value: cands[0],
          symbol: sym,
          technique: 'Naked Single',
          reason: `Baris ${r + 1}, Kolom ${c + 1} hanya memiliki satu kandidat yang sah, yaitu ${sym}.`,
        };
      }
    }
  }

  const candGrid: number[][][] = Array.from({ length: size }, (_, r) =>
    Array.from({ length: size }, (_, c) =>
      getCellCandidates(grid, r, c, { size, cages })
    )
  );

  // 2a. Hidden Single in Rows
  for (let r = 0; r < size; r++) {
    for (let d = 1; d <= size; d++) {
      const spots: number[] = [];
      for (let c = 0; c < size; c++) {
        if (candGrid[r][c].includes(d)) spots.push(c);
      }
      if (spots.length === 1) {
        const c = spots[0];
        const sym = digitToSymbol(d);
        return {
          row: r,
          col: c,
          value: d,
          symbol: sym,
          technique: 'Hidden Single',
          reason: `Di Baris ${r + 1}, simbol ${sym} hanya bisa ditempatkan pada Kolom ${c + 1}.`,
        };
      }
    }
  }

  // 2b. Hidden Single in Columns
  for (let c = 0; c < size; c++) {
    for (let d = 1; d <= size; d++) {
      const spots: number[] = [];
      for (let r = 0; r < size; r++) {
        if (candGrid[r][c].includes(d)) spots.push(r);
      }
      if (spots.length === 1) {
        const r = spots[0];
        const sym = digitToSymbol(d);
        return {
          row: r,
          col: c,
          value: d,
          symbol: sym,
          technique: 'Hidden Single',
          reason: `Di Kolom ${c + 1}, simbol ${sym} hanya bisa ditempatkan pada Baris ${r + 1}.`,
        };
      }
    }
  }

  // 2c. Hidden Single in Boxes
  for (let br = 0; br < size; br += boxRows) {
    for (let bc = 0; bc < size; bc += boxCols) {
      for (let d = 1; d <= size; d++) {
        const spots: [number, number][] = [];
        for (let dr = 0; dr < boxRows; dr++) {
          for (let dc = 0; dc < boxCols; dc++) {
            const r = br + dr;
            const c = bc + dc;
            if (candGrid[r][c].includes(d)) spots.push([r, c]);
          }
        }
        if (spots.length === 1) {
          const [r, c] = spots[0];
          const sym = digitToSymbol(d);
          return {
            row: r,
            col: c,
            value: d,
            symbol: sym,
            technique: 'Hidden Single',
            reason: `Di Kotak ${boxRows}×${boxCols} (${Math.floor(br / boxRows) + 1},${Math.floor(bc / boxCols) + 1}), simbol ${sym} hanya cocok di Baris ${r + 1}, Kolom ${c + 1}.`,
          };
        }
      }
    }
  }

  // 3. Fallback: pick empty cell with fewest candidates from full solver
  let bestR = -1;
  let bestC = -1;
  let bestLen = size + 1;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (grid[r][c] !== 0) continue;
      const len = candGrid[r][c].length;
      if (len < bestLen) {
        bestLen = len;
        bestR = r;
        bestC = c;
      }
    }
  }
  if (bestR === -1) return null;
  const val = solved.solution[bestR][bestC];
  const sym = digitToSymbol(val);
  return {
    row: bestR,
    col: bestC,
    value: val,
    symbol: sym,
    technique: 'Logika Lanjutan',
    reason: `Eliminasi lanjutan menempatkan simbol ${sym} pada Baris ${bestR + 1}, Kolom ${bestC + 1}.`,
  };
}

/**
 * Helper to build a 16x16 grid from compact row strings ('.' = 0, '1'-'9', 'A'-'G').
 */
export function parseSymbolRows(rows: string[], size: SudokuSize): SudokuGrid {
  return rows.slice(0, size).map((rowStr) => {
    const clean = rowStr.replace(/\s+/g, '');
    return Array.from({ length: size }, (_, c) => {
      const ch = clean[c] || '.';
      return symbolToDigit(ch, size) ?? 0;
    });
  });
}

// Pure 0-clue Killer Sudoku 9x9 sample (solvable purely from cage sums + Sudoku rules!)
const SAMPLE_KILLER_CAGES: KillerCage[] = [
  { id: 1, sum: 3, cells: [[0, 0], [0, 1]] },
  { id: 2, sum: 15, cells: [[0, 2], [0, 3], [0, 4]] },
  { id: 3, sum: 22, cells: [[0, 5], [1, 4], [1, 5], [2, 4]] },
  { id: 4, sum: 4, cells: [[0, 6], [1, 6]] },
  { id: 5, sum: 16, cells: [[0, 7], [1, 7]] },
  { id: 6, sum: 15, cells: [[0, 8], [1, 8], [2, 8], [3, 8]] },
  { id: 7, sum: 25, cells: [[1, 0], [1, 1], [2, 0], [2, 1]] },
  { id: 8, sum: 17, cells: [[1, 2], [1, 3]] },
  { id: 9, sum: 9, cells: [[2, 2], [2, 3], [3, 3]] },
  { id: 10, sum: 8, cells: [[2, 5], [3, 5], [4, 5]] },
  { id: 11, sum: 20, cells: [[2, 6], [2, 7], [3, 6]] },
  { id: 12, sum: 6, cells: [[3, 0], [4, 0]] },
  { id: 13, sum: 14, cells: [[3, 1], [3, 2]] },
  { id: 14, sum: 17, cells: [[3, 4], [4, 4], [5, 4]] },
  { id: 15, sum: 17, cells: [[3, 7], [4, 6], [4, 7]] },
  { id: 16, sum: 13, cells: [[4, 1], [4, 2], [5, 1]] },
  { id: 17, sum: 20, cells: [[4, 3], [5, 3], [6, 3]] },
  { id: 18, sum: 12, cells: [[4, 8], [5, 8]] },
  { id: 19, sum: 27, cells: [[5, 0], [6, 0], [7, 0], [8, 0]] },
  { id: 20, sum: 6, cells: [[5, 2], [6, 1], [6, 2]] },
  { id: 21, sum: 20, cells: [[5, 5], [6, 5], [6, 6]] },
  { id: 22, sum: 6, cells: [[5, 6], [5, 7]] },
  { id: 23, sum: 10, cells: [[6, 4], [7, 3], [7, 4], [8, 3]] },
  { id: 24, sum: 14, cells: [[6, 7], [6, 8], [7, 7], [7, 8]] },
  { id: 25, sum: 8, cells: [[7, 1], [8, 1]] },
  { id: 26, sum: 16, cells: [[7, 2], [8, 2]] },
  { id: 27, sum: 15, cells: [[7, 5], [7, 6]] },
  { id: 28, sum: 13, cells: [[8, 4], [8, 5], [8, 6]] },
  { id: 29, sum: 17, cells: [[8, 7], [8, 8]] },
];

export const SUDOKU_PRESETS: SudokuPreset[] = [
  {
    key: 'classic-9-easy',
    label: '9×9 Mudah',
    difficulty: '9×9 Mudah',
    size: 9,
    variant: 'classic',
    board: [
      [8, 3, 0, 0, 0, 0, 1, 0, 0],
      [0, 0, 0, 0, 0, 2, 3, 0, 0],
      [1, 0, 0, 0, 5, 0, 0, 0, 4],
      [9, 8, 0, 1, 0, 5, 0, 7, 2],
      [2, 5, 7, 9, 0, 0, 0, 3, 1],
      [6, 1, 3, 7, 2, 8, 0, 4, 0],
      [4, 2, 0, 5, 0, 1, 0, 0, 3],
      [0, 7, 8, 0, 0, 9, 0, 0, 5],
      [0, 6, 0, 4, 0, 0, 0, 0, 0],
    ],
  },
  {
    key: 'killer-9-classic',
    label: 'Killer 9×9',
    difficulty: 'Killer 9×9',
    size: 9,
    variant: 'killer',
    board: createEmptyGrid(9),
    cages: SAMPLE_KILLER_CAGES,
  },
  {
    key: 'classic-16-hex',
    label: '16×16 (1–G)',
    difficulty: '16×16',
    size: 16,
    variant: 'classic',
    board: parseSymbolRows(
      [
        '..G....81C......',
        '..3.B..1....84.6',
        '.CB......F...3.1',
        '65.7..4..B.....F',
        '...297E..48.B...',
        '.E..6........F..',
        '9.5..2....E.47..',
        '.7.B5..C...A9...',
        'D.EF......1.....',
        '......15....CD28',
        '....7C3...2.....',
        '...8..G.7.D.AE..',
        '7.9..5...2..GC34',
        '..612.9..E.....5',
        '.D...GF.9...E..B',
        '4....B..8.FC..1.',
      ],
      16
    ),
  },
  {
    key: 'classic-4-mini',
    label: '4×4 Mini',
    difficulty: '4×4 Mini',
    size: 4,
    variant: 'classic',
    board: [
      [0, 2, 0, 4],
      [3, 0, 1, 0],
      [0, 1, 0, 3],
      [4, 0, 2, 0],
    ],
  },
  {
    key: 'classic-6-junior',
    label: '6×6 Klasik',
    difficulty: '6×6',
    size: 6,
    variant: 'classic',
    board: [
      [0, 0, 3, 0, 1, 0],
      [5, 6, 0, 3, 2, 0],
      [0, 5, 4, 2, 0, 3],
      [2, 0, 6, 4, 5, 0],
      [0, 1, 2, 0, 4, 5],
      [0, 4, 0, 1, 0, 0],
    ],
  },
  {
    key: 'classic-9-hard',
    label: '9×9 Sulit',
    difficulty: '9×9 Sulit',
    size: 9,
    variant: 'classic',
    board: [
      [0, 0, 5, 3, 0, 0, 0, 0, 0],
      [8, 0, 0, 0, 0, 0, 0, 2, 0],
      [0, 7, 0, 0, 1, 0, 5, 0, 0],
      [4, 0, 0, 0, 0, 5, 3, 0, 0],
      [0, 1, 0, 0, 7, 0, 0, 0, 6],
      [0, 0, 3, 2, 0, 0, 0, 8, 0],
      [0, 6, 0, 5, 0, 0, 0, 0, 9],
      [0, 0, 4, 0, 0, 0, 0, 3, 0],
      [0, 0, 0, 0, 0, 9, 7, 0, 0],
    ],
  },
];
