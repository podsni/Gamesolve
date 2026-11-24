import {
  AnalyzedSolution,
  ImageRect,
  Shape,
  TabKey,
} from './types';

export interface PersistedWorkspaceState {
  version: 1;
  savedAt: number;
  activePresetKey: string | null;
  activeTab: TabKey;
  bgColor: string;
  ballRadius: number;
  shapes: Shape[];
  uploadedImageDataUrl: string | null;
  uploadedRect: ImageRect;
  showImageOverlay: boolean;
  imageOverlayAlpha: number;
  detectSensitivity: number;
  ignoreStatusBars: boolean;
  swapTargetWall: boolean;
  detectedTargets: number;
  detectedThinTargets: number;
  detectedWalls: number;
  solutions: AnalyzedSolution[];
  activeSolutionIdx: number;
  showGrid: boolean;
  snapToGrid: boolean;
  showGuide: boolean;
  showSafeZone: boolean;
  showAltPaths: boolean;
}

const DB_NAME = 'okay_simulator_workspace_db';
const DB_VERSION = 1;
const STORE_NAME = 'workspace';
const RECORD_KEY = 'current_v1';
const LS_FALLBACK_KEY = 'okay_simulator_workspace_v1';

function openWorkspaceDb(): Promise<IDBDatabase | null> {
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

/**
 * Pure sanitization helper (also unit-testable in Node) that prepares a workspace
 * snapshot for serialization (resets transient hit/alive flags cleanly).
 */
export function sanitizeWorkspaceForSave(
  state: PersistedWorkspaceState
): PersistedWorkspaceState {
  return {
    ...state,
    version: 1,
    savedAt: Date.now(),
    shapes: state.shapes.map((s) => ({
      id: s.id,
      type: s.type,
      vertices: s.vertices.map((v) => ({ x: v.x, y: v.y })),
      alive: true,
      flash: 0,
      ...(s.passThrough ? { passThrough: true } : {}),
    })),
  };
}

/**
 * Validates an arbitrary parsed object before hydrating engine state.
 */
export function isValidPersistedWorkspace(
  raw: unknown
): raw is PersistedWorkspaceState {
  if (!raw || typeof raw !== 'object') return false;
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) return false;
  if (!Array.isArray(obj.shapes)) return false;
  if (typeof obj.bgColor !== 'string') return false;
  if (typeof obj.ballRadius !== 'number' || !Number.isFinite(obj.ballRadius)) {
    return false;
  }
  return true;
}

/**
 * Persists the current workspace (including high-res uploaded screenshot) to IndexedDB,
 * with graceful fallback to localStorage when IndexedDB is unavailable.
 */
export async function saveWorkspaceState(
  state: PersistedWorkspaceState
): Promise<boolean> {
  const clean = sanitizeWorkspaceForSave(state);

  const db = await openWorkspaceDb();
  if (db) {
    const saved = await new Promise<boolean>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(clean, RECORD_KEY);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
    db.close();
    if (saved) return true;
  }

  // Fallback to localStorage (only when payload fits reasonably)
  try {
    if (typeof localStorage !== 'undefined') {
      const json = JSON.stringify(clean);
      if (json.length < 3_800_000) {
        localStorage.setItem(LS_FALLBACK_KEY, json);
        return true;
      }
    }
  } catch {
    // Ignore storage quota errors cleanly
  }
  return false;
}

/**
 * Loads the persisted workspace state from IndexedDB (or localStorage fallback).
 */
export async function loadWorkspaceState(): Promise<PersistedWorkspaceState | null> {
  const db = await openWorkspaceDb();
  if (db) {
    const record = await new Promise<unknown>((resolve) => {
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
    if (isValidPersistedWorkspace(record)) {
      return record;
    }
  }

  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem(LS_FALLBACK_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (isValidPersistedWorkspace(parsed)) {
          return parsed;
        }
      }
    }
  } catch {
    // Ignore malformed fallback data
  }

  return null;
}

export async function clearWorkspaceState(): Promise<void> {
  const db = await openWorkspaceDb();
  if (db) {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(RECORD_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
    db.close();
  }
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LS_FALLBACK_KEY);
    }
  } catch {
    // Ignore
  }
}
