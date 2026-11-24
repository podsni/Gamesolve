import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cloneGrid,
  countFilledCells,
  createEmptyGrid,
  findConflicts,
  getCellCandidates,
  getNextSudokuHint,
  solveSudoku,
  SUDOKU_PRESETS,
  SudokuGrid,
} from './sudokuSolver';
import { isValidPersistedSudoku } from './sudokuPersistence';

function assertValidCompleteSudoku(grid: SudokuGrid) {
  assert.equal(grid.length, 9);
  for (let r = 0; r < 9; r++) {
    const rowSet = new Set(grid[r]);
    assert.equal(rowSet.size, 9, `Row ${r} must have 9 unique digits`);
    for (let d = 1; d <= 9; d++) {
      assert.ok(rowSet.has(d), `Row ${r} missing digit ${d}`);
    }
  }
  for (let c = 0; c < 9; c++) {
    const colSet = new Set<number>();
    for (let r = 0; r < 9; r++) colSet.add(grid[r][c]);
    assert.equal(colSet.size, 9, `Col ${c} must have 9 unique digits`);
  }
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const boxSet = new Set<number>();
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) {
          boxSet.add(grid[br * 3 + dr][bc * 3 + dc]);
        }
      }
      assert.equal(boxSet.size, 9, `Box (${br},${bc}) must have 9 unique digits`);
    }
  }
}

test('solveSudoku solves the attached IMG_5184 38-clue board with a unique solution', () => {
  const board = SUDOKU_PRESETS[0].board;
  assert.equal(countFilledCells(board), 38);

  const res = solveSudoku(board);
  assert.equal(res.solved, true);
  assert.equal(res.hasMultipleSolutions, false);
  assert.equal(res.invalidReason, null);
  assert.ok(res.solution);

  assertValidCompleteSudoku(res.solution);

  // Verify every original clue is preserved verbatim
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if (board[r][c] !== 0) {
        assert.equal(res.solution[r][c], board[r][c]);
      }
    }
  }
});

test('solveSudoku solves medium and hard presets with unique solutions', () => {
  for (const preset of SUDOKU_PRESETS.slice(1)) {
    const res = solveSudoku(preset.board);
    assert.equal(res.solved, true, `Preset ${preset.key} should solve`);
    assert.equal(
      res.hasMultipleSolutions,
      false,
      `Preset ${preset.key} should have a unique solution`
    );
    assert.ok(res.solution);
    assertValidCompleteSudoku(res.solution);
  }
});

test('findConflicts detects row, column, and 3x3 box duplicates and solveSudoku rejects them', () => {
  const grid = createEmptyGrid();
  grid[0][0] = 5;
  grid[0][4] = 5; // row duplicate
  grid[4][0] = 5; // col duplicate
  grid[1][1] = 5; // box duplicate

  const conflicts = findConflicts(grid);
  assert.ok(conflicts.has('0,0'));
  assert.ok(conflicts.has('0,4'));
  assert.ok(conflicts.has('4,0'));
  assert.ok(conflicts.has('1,1'));

  const res = solveSudoku(grid);
  assert.equal(res.solved, false);
  assert.equal(res.solution, null);
  assert.ok(res.invalidReason);
});

test('getCellCandidates and getNextSudokuHint produce valid logical steps matching the solution', () => {
  const board = cloneGrid(SUDOKU_PRESETS[0].board);
  const full = solveSudoku(board);
  assert.ok(full.solution);

  const cands = getCellCandidates(board, 5, 8);
  assert.ok(cands.includes(full.solution[5][8]));

  const hint = getNextSudokuHint(board);
  assert.ok(hint);
  assert.equal(board[hint.row][hint.col], 0);
  assert.equal(hint.value, full.solution[hint.row][hint.col]);
  assert.ok(
    hint.technique === 'Naked Single' || hint.technique === 'Hidden Single',
    `Expected basic logical technique on easy board, got ${hint.technique}`
  );
});

test('isValidPersistedSudoku validates persisted snapshots', () => {
  assert.equal(isValidPersistedSudoku(null), false);
  assert.equal(isValidPersistedSudoku({ version: 2 }), false);
  assert.equal(
    isValidPersistedSudoku({
      version: 1,
      savedAt: Date.now(),
      givens: createEmptyGrid(),
      userEntries: createEmptyGrid(),
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
