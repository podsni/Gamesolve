export type SudokuGrid = number[][]; // 9x9, 0 = empty, 1..9 = filled

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
  technique: 'Naked Single' | 'Hidden Single' | 'Logika Lanjutan';
  reason: string;
}

export interface SudokuPreset {
  key: string;
  label: string;
  difficulty: string;
  board: SudokuGrid;
}

export function createEmptyGrid(): SudokuGrid {
  return Array.from({ length: 9 }, () => Array(9).fill(0));
}

export function cloneGrid(grid: SudokuGrid): SudokuGrid {
  return grid.map((row) => row.slice());
}

export function countFilledCells(grid: SudokuGrid): number {
  let count = 0;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (grid[r][c] >= 1 && grid[r][c] <= 9) count++;
    }
  }
  return count;
}

/**
 * Returns a Set of `"r,c"` keys for every cell that violates Sudoku row/col/box uniqueness.
 */
export function findConflicts(grid: SudokuGrid): Set<string> {
  const conflicts = new Set<string>();

  // Rows
  for (let r = 0; r < 9; r++) {
    const seen = new Map<number, number[]>();
    for (let c = 0; c < 9; c++) {
      const v = grid[r][c];
      if (v < 1 || v > 9) continue;
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
  for (let c = 0; c < 9; c++) {
    const seen = new Map<number, number[]>();
    for (let r = 0; r < 9; r++) {
      const v = grid[r][c];
      if (v < 1 || v > 9) continue;
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

  // 3x3 Boxes
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const seen = new Map<number, [number, number][]>();
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) {
          const r = br * 3 + dr;
          const c = bc * 3 + dc;
          const v = grid[r][c];
          if (v < 1 || v > 9) continue;
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

  return conflicts;
}

export function getCellCandidates(grid: SudokuGrid, row: number, col: number): number[] {
  if (grid[row][col] !== 0) return [];
  let usedMask = 0;
  for (let i = 0; i < 9; i++) {
    const rv = grid[row][i];
    if (rv >= 1 && rv <= 9) usedMask |= 1 << rv;
    const cv = grid[i][col];
    if (cv >= 1 && cv <= 9) usedMask |= 1 << cv;
  }
  const br = Math.floor(row / 3) * 3;
  const bc = Math.floor(col / 3) * 3;
  for (let dr = 0; dr < 3; dr++) {
    for (let dc = 0; dc < 3; dc++) {
      const bv = grid[br + dr][bc + dc];
      if (bv >= 1 && bv <= 9) usedMask |= 1 << bv;
    }
  }
  const res: number[] = [];
  for (let d = 1; d <= 9; d++) {
    if ((usedMask & (1 << d)) === 0) res.push(d);
  }
  return res;
}

function popcount9(mask: number): number {
  let c = 0;
  let m = mask;
  while (m) {
    m &= m - 1;
    c++;
  }
  return c;
}

/**
 * Fast bitmask + Minimum Remaining Values (MRV) Sudoku solver.
 * Finds a complete solution and checks whether the puzzle has a unique solution.
 */
export function solveSudoku(grid: SudokuGrid): SudokuSolveResult {
  const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const conflicts = findConflicts(grid);
  if (conflicts.size > 0) {
    return {
      solved: false,
      solution: null,
      hasMultipleSolutions: false,
      invalidReason:
        'Terdapat angka duplikat pada baris, kolom, atau kotak 3×3 (ditandai merah). Perbaiki dulu sebelum di-solve.',
      solveTimeMs: 0,
    };
  }

  const board = cloneGrid(grid);
  const rowMask = new Int32Array(9);
  const colMask = new Int32Array(9);
  const boxMask = new Int32Array(9);
  const empties: [number, number][] = [];

  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      const v = board[r][c];
      if (v >= 1 && v <= 9) {
        const bit = 1 << (v - 1);
        const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
        rowMask[r] |= bit;
        colMask[c] |= bit;
        boxMask[b] |= bit;
      } else {
        empties.push([r, c]);
      }
    }
  }

  const FULL_MASK = 0x1ff; // 9 bits
  let firstSolution: SudokuGrid | null = null;
  let solutionCount = 0;
  let nodesVisited = 0;
  const MAX_NODES = 350_000;

  function backtrack(remaining: number): boolean {
    if (remaining === 0) {
      solutionCount++;
      if (!firstSolution) {
        firstSolution = cloneGrid(board);
      }
      return solutionCount >= 2;
    }
    if (++nodesVisited > MAX_NODES) return solutionCount >= 1;

    // Pick empty cell with fewest valid candidates (MRV heuristic)
    let bestIdx = -1;
    let bestCount = 10;
    let bestAvail = 0;

    for (let i = 0; i < empties.length; i++) {
      const [r, c] = empties[i];
      if (board[r][c] !== 0) continue;
      const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
      const avail = FULL_MASK & ~(rowMask[r] | colMask[c] | boxMask[b]);
      if (avail === 0) return false; // Dead end
      const cnt = popcount9(avail);
      if (cnt < bestCount) {
        bestCount = cnt;
        bestIdx = i;
        bestAvail = avail;
        if (cnt === 1) break;
      }
    }

    if (bestIdx === -1) return false;
    const [r, c] = empties[bestIdx];
    const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);

    let avail = bestAvail;
    while (avail) {
      const bit = avail & -avail;
      avail ^= bit;
      const digit = Math.clz32(1) - Math.clz32(bit) + 1;

      board[r][c] = digit;
      rowMask[r] |= bit;
      colMask[c] |= bit;
      boxMask[b] |= bit;

      if (backtrack(remaining - 1)) {
        // Restore before bubbling up
        board[r][c] = 0;
        rowMask[r] ^= bit;
        colMask[c] ^= bit;
        boxMask[b] ^= bit;
        return true;
      }

      board[r][c] = 0;
      rowMask[r] ^= bit;
      colMask[c] ^= bit;
      boxMask[b] ^= bit;
    }

    return false;
  }

  backtrack(empties.length);
  const t1 = typeof performance !== 'undefined' ? performance.now() : Date.now();

  if (!firstSolution) {
    return {
      solved: false,
      solution: null,
      hasMultipleSolutions: false,
      invalidReason:
        'Tidak ada solusi yang valid untuk susunan angka ini. Cek kembali apakah ada angka hasil scan yang keliru.',
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
 * Finds the clearest single next logical step (Naked Single -> Hidden Single -> Solver deduction).
 */
export function getNextSudokuHint(grid: SudokuGrid): SudokuHint | null {
  const solved = solveSudoku(grid);
  if (!solved.solved || !solved.solution) return null;

  // 1. Naked Single: cell with exactly 1 candidate
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (grid[r][c] !== 0) continue;
      const cands = getCellCandidates(grid, r, c);
      if (cands.length === 1) {
        return {
          row: r,
          col: c,
          value: cands[0],
          technique: 'Naked Single',
          reason: `Baris ${r + 1}, Kolom ${c + 1} hanya memiliki satu kandidat yang sah, yaitu angka ${cands[0]}.`,
        };
      }
    }
  }

  // 2. Hidden Single in Row, Column, or 3x3 Box
  const candGrid: number[][][] = Array.from({ length: 9 }, (_, r) =>
    Array.from({ length: 9 }, (_, c) => getCellCandidates(grid, r, c))
  );

  // Check rows
  for (let r = 0; r < 9; r++) {
    for (let d = 1; d <= 9; d++) {
      const spots: number[] = [];
      for (let c = 0; c < 9; c++) {
        if (candGrid[r][c].includes(d)) spots.push(c);
      }
      if (spots.length === 1) {
        const c = spots[0];
        return {
          row: r,
          col: c,
          value: d,
          technique: 'Hidden Single',
          reason: `Di Baris ${r + 1}, angka ${d} hanya bisa ditempatkan pada Kolom ${c + 1}.`,
        };
      }
    }
  }

  // Check columns
  for (let c = 0; c < 9; c++) {
    for (let d = 1; d <= 9; d++) {
      const spots: number[] = [];
      for (let r = 0; r < 9; r++) {
        if (candGrid[r][c].includes(d)) spots.push(r);
      }
      if (spots.length === 1) {
        const r = spots[0];
        return {
          row: r,
          col: c,
          value: d,
          technique: 'Hidden Single',
          reason: `Di Kolom ${c + 1}, angka ${d} hanya bisa ditempatkan pada Baris ${r + 1}.`,
        };
      }
    }
  }

  // Check 3x3 boxes
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      for (let d = 1; d <= 9; d++) {
        const spots: [number, number][] = [];
        for (let dr = 0; dr < 3; dr++) {
          for (let dc = 0; dc < 3; dc++) {
            const r = br * 3 + dr;
            const c = bc * 3 + dc;
            if (candGrid[r][c].includes(d)) spots.push([r, c]);
          }
        }
        if (spots.length === 1) {
          const [r, c] = spots[0];
          return {
            row: r,
            col: c,
            value: d,
            technique: 'Hidden Single',
            reason: `Di Kotak 3×3 (${br + 1},${bc + 1}), angka ${d} hanya cocok di Baris ${r + 1}, Kolom ${c + 1}.`,
          };
        }
      }
    }
  }

  // 3. Fallback: pick empty cell with fewest candidates from full solver
  let bestR = -1;
  let bestC = -1;
  let bestLen = 10;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
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
  return {
    row: bestR,
    col: bestC,
    value: val,
    technique: 'Logika Lanjutan',
    reason: `Eliminasi lanjutan menempatkan angka ${val} pada Baris ${bestR + 1}, Kolom ${bestC + 1}.`,
  };
}

export const SUDOKU_PRESETS: SudokuPreset[] = [
  {
    key: 'easy',
    label: 'Mudah (Klasik)',
    difficulty: 'Mudah',
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
    key: 'medium',
    label: 'Sedang',
    difficulty: 'Sedang',
    board: [
      [0, 0, 0, 2, 6, 0, 7, 0, 1],
      [6, 8, 0, 0, 7, 0, 0, 9, 0],
      [1, 9, 0, 0, 0, 4, 5, 0, 0],
      [8, 2, 0, 1, 0, 0, 0, 4, 0],
      [0, 0, 4, 6, 0, 2, 9, 0, 0],
      [0, 5, 0, 0, 0, 3, 0, 2, 8],
      [0, 0, 9, 3, 0, 0, 0, 7, 4],
      [0, 4, 0, 0, 5, 0, 0, 3, 6],
      [7, 0, 3, 0, 1, 8, 0, 0, 0],
    ],
  },
  {
    key: 'hard',
    label: 'Sulit (Master)',
    difficulty: 'Sulit',
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
