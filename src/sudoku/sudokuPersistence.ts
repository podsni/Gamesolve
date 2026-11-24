import {
  BoxDims,
  isSupportedSize,
  KillerCage,
  resolveBoxDims,
  SudokuGrid,
  SudokuSize,
  SudokuVariant,
} from './sudokuSolver';
import { SudokuGridRect } from './sudokuScanner';

export interface PersistedSudokuState {
  version: 2;
  savedAt: number;
  size: SudokuSize;
  boxDims?: BoxDims;
  variant: SudokuVariant;
  cages: KillerCage[];
  givens: SudokuGrid;
  userEntries: SudokuGrid;
  solution: SudokuGrid | null;
  uploadedImageDataUrl: string | null;
  gridRect: SudokuGridRect | null;
  imageWidth: number;
  imageHeight: number;
  detectedCount: number;
  showCandidates: boolean;
}

const DB_NAME = 'okay_simulator_sudoku_db';
const DB_VERSION = 1;
const STORE_NAME = 'sudoku_workspace';
const RECORD_KEY = 'current_v1';
const LS_FALLBACK_KEY = 'okay_simulator_sudoku_v1';

function openSudokuDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function isGridNxN(raw: unknown, size: number): raw is SudokuGrid {
  return (
    Array.isArray(raw) &&
    raw.length === size &&
    raw.every((row) => Array.isArray(row) && row.length === size)
  );
}

/**
 * Validates both current v2 (multi-size + Killer) and legacy v1 (9x9) persisted records.
 */
export function isValidPersistedSudoku(raw: unknown): raw is PersistedSudokuState {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  if (obj.version === 1) {
    return isGridNxN(obj.givens, 9) && isGridNxN(obj.userEntries, 9);
  }
  if (obj.version === 2) {
    if (typeof obj.size !== 'number' || !isSupportedSize(obj.size)) return false;
    if (obj.variant !== 'classic' && obj.variant !== 'killer') return false;
    if (!isGridNxN(obj.givens, obj.size) || !isGridNxN(obj.userEntries, obj.size)) {
      return false;
    }
    if (!Array.isArray(obj.cages)) return false;
    return true;
  }
  return false;
}

function upgradeToV2(raw: Record<string, unknown>): PersistedSudokuState {
  if (raw.version === 2) {
    const typed = raw as unknown as PersistedSudokuState;
    return {
      ...typed,
      boxDims: resolveBoxDims(typed.size, typed.boxDims),
    };
  }
  return {
    version: 2,
    savedAt: typeof raw.savedAt === 'number' ? raw.savedAt : Date.now(),
    size: 9,
    boxDims: { boxRows: 3, boxCols: 3 },
    variant: 'classic',
    cages: [],
    givens: raw.givens as SudokuGrid,
    userEntries: raw.userEntries as SudokuGrid,
    solution: (raw.solution as SudokuGrid | null) ?? null,
    uploadedImageDataUrl: (raw.uploadedImageDataUrl as string | null) ?? null,
    gridRect: (raw.gridRect as SudokuGridRect | null) ?? null,
    imageWidth: typeof raw.imageWidth === 'number' ? raw.imageWidth : 0,
    imageHeight: typeof raw.imageHeight === 'number' ? raw.imageHeight : 0,
    detectedCount: typeof raw.detectedCount === 'number' ? raw.detectedCount : 0,
    showCandidates: Boolean(raw.showCandidates),
  };
}

export async function saveSudokuState(state: PersistedSudokuState): Promise<boolean> {
  const payload: PersistedSudokuState = {
    ...state,
    version: 2,
    savedAt: Date.now(),
  };

  const db = await openSudokuDb();
  if (db) {
    const ok = await new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(payload, RECORD_KEY);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
    db.close();
    if (ok) return true;
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const json = JSON.stringify(payload);
      if (json.length < 3_800_000) {
        localStorage.setItem(LS_FALLBACK_KEY, json);
        return true;
      }
    }
  } catch {
    // Ignore quota errors
  }
  return false;
}

export async function loadSudokuState(): Promise<PersistedSudokuState | null> {
  const db = await openSudokuDb();
  if (db) {
    const rec = await new Promise<unknown>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(RECORD_KEY);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    db.close();
    if (isValidPersistedSudoku(rec)) {
      return upgradeToV2(rec as unknown as Record<string, unknown>);
    }
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(LS_FALLBACK_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (isValidPersistedSudoku(parsed)) {
          return upgradeToV2(parsed as unknown as Record<string, unknown>);
        }
      }
    }
  } catch {
    // Ignore
  }
  return null;
}
