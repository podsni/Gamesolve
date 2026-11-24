import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BoxDims,
  cloneGrid,
  countFilledCells,
  createEmptyGrid,
  digitToSymbol,
  findConflicts,
  getCellCandidates,
  getNextSudokuHint,
  KillerCage,
  parseSymbolRows,
  resolveBoxDims,
  solveSudoku,
  SUDOKU_PRESETS,
  SudokuGrid,
  SudokuSize,
  symbolToDigit,
} from './sudokuSolver';
import { isValidPersistedSudoku } from './sudokuPersistence';

function assertValidCompleteSudoku(
  grid: SudokuGrid,
  size: SudokuSize,
  cages?: KillerCage[],
  boxDims?: BoxDims
) {
  const { boxRows, boxCols } = resolveBoxDims(size, boxDims);
  assert.equal(grid.length, size);
  for (let r = 0; r < size; r++) {
    const rowSet = new Set(grid[r]);
    assert.equal(rowSet.size, size, `Row ${r} must have ${size} unique symbols`);
    for (let d = 1; d <= size; d++) {
      assert.ok(rowSet.has(d), `Row ${r} missing symbol ${d}`);
    }
  }
  for (let c = 0; c < size; c++) {
    const colSet = new Set<number>();
    for (let r = 0; r < size; r++) colSet.add(grid[r][c]);
    assert.equal(colSet.size, size, `Col ${c} must have ${size} unique symbols`);
  }
  for (let br = 0; br < size; br += boxRows) {
    for (let bc = 0; bc < size; bc += boxCols) {
      const boxSet = new Set<number>();
      for (let dr = 0; dr < boxRows; dr++) {
        for (let dc = 0; dc < boxCols; dc++) {
          boxSet.add(grid[br + dr][bc + dc]);
        }
      }
      assert.equal(
        boxSet.size,
        size,
        `Box (${br},${bc}) must have ${size} unique symbols`
      );
    }
  }
  if (cages && cages.length > 0) {
    for (const cage of cages) {
      const seen = new Set<number>();
      let sum = 0;
      for (const [r, c] of cage.cells) {
        const v = grid[r][c];
        assert.ok(!seen.has(v), `Duplicate ${v} inside Killer cage #${cage.id}`);
        seen.add(v);
        sum += v;
      }
      assert.equal(
        sum,
        cage.sum,
        `Killer cage #${cage.id} expected sum ${cage.sum}, got ${sum}`
      );
    }
  }
}

test('symbol helpers convert 1..16 <-> 1..9, A..G cleanly', () => {
  assert.equal(digitToSymbol(1), '1');
  assert.equal(digitToSymbol(9), '9');
  assert.equal(digitToSymbol(10), 'A');
  assert.equal(digitToSymbol(16), 'G');
  assert.equal(symbolToDigit('g', 16), 16);
  assert.equal(symbolToDigit('A', 9), null);
  assert.equal(symbolToDigit('5', 4), null);
});

test('solveSudoku solves ALL presets (4x4, 6x6, 9x9 Easy/Hard, Killer 9x9, and 16x16 IMG_5197) with unique solutions', () => {
  for (const preset of SUDOKU_PRESETS) {
    const res = solveSudoku(preset.board, {
      size: preset.size,
      cages: preset.cages,
    });
    assert.equal(
      res.solved,
      true,
      `Preset ${preset.key} (${preset.size}x${preset.size}) must solve`
    );
    assert.equal(
      res.hasMultipleSolutions,
      false,
      `Preset ${preset.key} must have a unique solution`
    );
    assert.equal(res.invalidReason, null);
    assert.ok(res.solution);
    assertValidCompleteSudoku(res.solution, preset.size, preset.cages);

    // Verify original givens are preserved
    for (let r = 0; r < preset.size; r++) {
      for (let c = 0; c < preset.size; c++) {
        if (preset.board[r][c] !== 0) {
          assert.equal(res.solution[r][c], preset.board[r][c]);
        }
      }
    }
  }
});

test('solveSudoku handles 8x8 and 12x12 boards cleanly', () => {
  const g8 = createEmptyGrid(8);
  g8[0][0] = 1;
  g8[0][7] = 8;
  const r8 = solveSudoku(g8, { size: 8 });
  assert.equal(r8.solved, true);
  assert.ok(r8.solution);
  assertValidCompleteSudoku(r8.solution, 8);

  const g12 = createEmptyGrid(12);
  g12[0][0] = 12;
  const r12 = solveSudoku(g12, { size: 12 });
  assert.equal(r12.solved, true);
  assert.ok(r12.solution);
  assertValidCompleteSudoku(r12.solution, 12);
});

test('findConflicts detects row, col, box, AND Killer cage sum/duplicate violations', () => {
  const grid = createEmptyGrid(9);
  grid[0][0] = 5;
  grid[0][1] = 5; // duplicate in row AND cage
  const cages: KillerCage[] = [{ id: 1, sum: 9, cells: [[0, 0], [0, 1]] }];

  const conflicts = findConflicts(grid, { size: 9, cages });
  assert.ok(conflicts.has('0,0'));
  assert.ok(conflicts.has('0,1'));

  // Distinct digits in cage that violate exact sum (5 + 6 = 11 != 9)
  grid[0][1] = 6;
  const sumConflicts = findConflicts(grid, { size: 9, cages });
  assert.ok(sumConflicts.has('0,0'));
  assert.ok(sumConflicts.has('0,1'));

  const res = solveSudoku(grid, { size: 9, cages });
  assert.equal(res.solved, false);
  assert.ok(res.invalidReason);
});

test('getCellCandidates and getNextSudokuHint work for Classic 9x9, Killer 9x9, and 16x16', () => {
  // Classic 9x9
  const easy = SUDOKU_PRESETS.find((p) => p.key === 'classic-9-easy')!;
  const board9 = cloneGrid(easy.board);
  assert.equal(countFilledCells(board9), 38);
  const full9 = solveSudoku(board9, { size: 9 });
  assert.ok(full9.solution);
  const hint9 = getNextSudokuHint(board9, { size: 9 });
  assert.ok(hint9);
  assert.equal(hint9.value, full9.solution[hint9.row][hint9.col]);

  // Killer 9x9 cage remainder hint
  const killer = SUDOKU_PRESETS.find((p) => p.key === 'killer-9-classic')!;
  const fullK = solveSudoku(killer.board, { size: 9, cages: killer.cages });
  assert.ok(fullK.solution);
  const partialK = cloneGrid(killer.board);
  // Fill one cell of the 2-cell cage (0,0)-(0,1) sum=3 -> should give Killer Cage hint!
  partialK[0][0] = fullK.solution[0][0];
  const hintK = getNextSudokuHint(partialK, { size: 9, cages: killer.cages });
  assert.ok(hintK);
  assert.equal(hintK.technique, 'Killer Cage');
  assert.equal(hintK.row, 0);
  assert.equal(hintK.col, 1);
  assert.equal(hintK.value, fullK.solution[0][1]);

  // 16x16 candidates & hint
  const hex16 = SUDOKU_PRESETS.find((p) => p.key === 'classic-16-hex')!;
  const full16 = solveSudoku(hex16.board, { size: 16 });
  assert.ok(full16.solution);
  const cands16 = getCellCandidates(hex16.board, 0, 0, { size: 16 });
  assert.ok(cands16.includes(full16.solution[0][0]));
  const hint16 = getNextSudokuHint(hex16.board, { size: 16 });
  assert.ok(hint16);
  assert.equal(hint16.value, full16.solution[hint16.row][hint16.col]);
});

test('isValidPersistedSudoku accepts v2 multi-size/Killer payloads and legacy v1 payloads', () => {
  assert.equal(isValidPersistedSudoku(null), false);
  assert.equal(isValidPersistedSudoku({ version: 3 }), false);
  assert.equal(
    isValidPersistedSudoku({
      version: 1,
      savedAt: Date.now(),
      givens: createEmptyGrid(9),
      userEntries: createEmptyGrid(9),
      solution: null,
    }),
    true
  );
  assert.equal(
    isValidPersistedSudoku({
      version: 2,
      savedAt: Date.now(),
      size: 16,
      boxDims: { boxRows: 4, boxCols: 4 },
      variant: 'classic',
      cages: [],
      givens: createEmptyGrid(16),
      userEntries: createEmptyGrid(16),
      solution: null,
      uploadedImageDataUrl: null,
      gridRect: null,
      imageWidth: 0,
      imageHeight: 0,
      detectedCount: 0,
      showCandidates: false,
    }),
    true
  );
});

test('solveSudoku supports transposed boxDims (3x2 vs 2x3 on 6x6) and solves real user boards uniquely', () => {
  // IMG_5195 (Sudoku Bliss Hard 6x6 with 3x2 boxes: 3 rows x 2 cols)
  const img5195 = parseSymbolRows(
    ['....4.', '.45...', '264...', '...512', '...35.', '.2....'],
    6
  );
  const res5195 = solveSudoku(img5195, {
    size: 6,
    boxDims: { boxRows: 3, boxCols: 2 },
  });
  assert.equal(res5195.solved, true);
  assert.equal(res5195.hasMultipleSolutions, false);
  assert.ok(res5195.solution);
  assertValidCompleteSudoku(res5195.solution, 6, undefined, {
    boxRows: 3,
    boxCols: 2,
  });

  // IMG_5202 (Dark Navy 6x6 with 2x3 boxes: 2 rows x 3 cols)
  const img5202 = parseSymbolRows(
    ['...512', '.52..4', '.1.2.6', '..6153', '26143.', '534621'],
    6
  );
  const res5202 = solveSudoku(img5202, {
    size: 6,
    boxDims: { boxRows: 2, boxCols: 3 },
  });
  assert.equal(res5202.solved, true);
  assert.equal(res5202.hasMultipleSolutions, false);
  assert.ok(res5202.solution);
  assertValidCompleteSudoku(res5202.solution, 6, undefined, {
    boxRows: 2,
    boxCols: 3,
  });

  // IMG_5201 (Faint-line 9x9) & IMG_5203 (Dark Navy 9x9)
  const img5201 = parseSymbolRows(
    [
      '...61.4..',
      '.5...46.3',
      '.8...7...',
      '......74.',
      '7.1...2.5',
      '.94......',
      '...1...2.',
      '5.74...8.',
      '..2.95...',
    ],
    9
  );
  const res5201 = solveSudoku(img5201, { size: 9 });
  assert.equal(res5201.solved, true);
  assert.equal(res5201.hasMultipleSolutions, false);
  assert.ok(res5201.solution);
  assertValidCompleteSudoku(res5201.solution, 9);

  const img5203 = parseSymbolRows(
    [
      '.2.76...9',
      '.1..5....',
      '.......83',
      '5....1.2.',
      '.7.3...58',
      '3...76...',
      '.....2...',
      '.34....6.',
      '.......1.',
    ],
    9
  );
  const res5203 = solveSudoku(img5203, { size: 9 });
  assert.equal(res5203.solved, true);
  assert.equal(res5203.hasMultipleSolutions, false);
  assert.ok(res5203.solution);
  assertValidCompleteSudoku(res5203.solution, 9);
});
