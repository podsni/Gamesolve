import { SudokuGrid } from './sudokuSolver';
import { SudokuGridRect } from './sudokuScanner';

export interface PersistedSudokuState {
  version: 1;
  savedAt: number;
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

function isGrid9x9(raw: unknown): raw is SudokuGrid {
  return (
    Array.isArray(raw) &&
    raw.length === 9 &&
    raw.every((row) => Array.isArray(row) && row.length === 9)
  );
}

export function isValidPersistedSudoku(raw: unknown): raw is PersistedSudokuState {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) return false;
  if (!isGrid9x9(obj.givens) || !isGrid9x9(obj.userEntries)) return false;
  return true;
}

export async function saveSudokuState(state: PersistedSudokuState): Promise<boolean> {
  const payload: PersistedSudokuState = {
    ...state,
    version: 1,
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
    if (isValidPersistedSudoku(rec)) return rec;
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(LS_FALLBACK_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (isValidPersistedSudoku(parsed)) return parsed;
      }
    }
  } catch {
    // Ignore
  }
  return null;
}
