import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Grid3X3,
  Volume2,
  VolumeX,
  RotateCcw,
  Zap,
  ImageUp,
  Play,
  Gauge,
  Compass,
  Focus,
  Target,
  ScanLine,
  Pencil,
} from 'lucide-react';
import {
  AnalyzedSolution,
  LOGICAL_H,
  LOGICAL_W,
  Shape,
  SimResult,
  SolverProgress,
  TabKey,
  ToolMode,
} from './engine/types';
import { OkayEngineController } from './engine/controller';
import {
  makeRectShape,
  makeRightTriangle,
  mirrorShapeX,
  normalizeAngleDeg,
  polygonCentroid,
  rotateShape,
  scaleShape,
  translateShape,
} from './engine/geometry';
import { isPointClearOfShapes, simulateShot } from './engine/physics';
import { analyzeAndCenterSolution, solveLevelAsync } from './engine/solver';
import { getPresetByKey, PRESETS } from './engine/presets';
import { extractShapesFromImage } from './engine/cvDetector';
import { audioEngine } from './engine/audio';
import {
  loadWorkspaceState,
  PersistedWorkspaceState,
  saveWorkspaceState,
} from './engine/persistence';
import { StageCanvas } from './components/StageCanvas';
import { SolveTab } from './components/SolveTab';
import { ScanTab } from './components/ScanTab';
import { EditTab, SelectedShapeInfo } from './components/EditTab';

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>('solve');
  const [toolMode, setToolMode] = useState<ToolMode>('play');
  const [activePresetKey, setActivePresetKey] = useState<string | null>(
    'triangles4x5'
  );

  // HUD & visual toggles
  const [targetsAlive, setTargetsAlive] = useState(16);
  const [targetsTotal, setTargetsTotal] = useState(16);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [showGrid, setShowGrid] = useState(false);
  const [muted, setMuted] = useState(false);
  const [slowMo, setSlowMo] = useState(false);
  const [showGuide, setShowGuide] = useState(true);
  const [showSafeZone, setShowSafeZone] = useState(true);
  const [showAltPaths, setShowAltPaths] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(false);

  // Playback & Solver state
  const [solving, setSolving] = useState(false);
  const [solverProgress, setSolverProgress] = useState<SolverProgress | null>(
    null
  );
  const [winBounces, setWinBounces] = useState<number | null>(null);
  const [solutions, setSolutions] = useState<AnalyzedSolution[]>([]);
  const [activeSolutionIdx, setActiveSolutionIdx] = useState(-1);
  const [solutionShot, setSolutionShot] = useState<AnalyzedSolution | null>(
    null
  );

  // Precision Shot Fine-Tuner state
  const [fineX, setFineX] = useState(200);
  const [fineY, setFineY] = useState(340);
  const [fineAng, setFineAng] = useState(0);
  const [fineBlocked, setFineBlocked] = useState(false);

  // Uploaded Screenshot Scan Calibration state
  const [hasUploadedImage, setHasUploadedImage] = useState(false);
  const [detectedTargets, setDetectedTargets] = useState(0);
  const [detectedThinTargets, setDetectedThinTargets] = useState(0);
  const [detectedWalls, setDetectedWalls] = useState(0);
  const [showImageOverlay, setShowImageOverlay] = useState(true);
  const [detectSensitivity, setDetectSensitivity] = useState(36);
  const [overlayAlphaPercent, setOverlayAlphaPercent] = useState(35);
  const [ignoreStatusBars, setIgnoreStatusBars] = useState(true);
  const [ballRadius, setBallRadius] = useState(4.8);

  // Selected shape in Edit Mode
  const [selectedShapeId, setSelectedShapeId] = useState<number | null>(null);
  const [shapeRevision, setShapeRevision] = useState(0);

  // Toast message & persistence refs
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToastMsg(null);
      toastTimerRef.current = null;
    }, 3200);
  }, []);

  const syncFineTuneFromShot = useCallback(
    (sx: number, sy: number, angle: number) => {
      setFineX(Math.max(10, Math.min(LOGICAL_W - 10, sx)));
      setFineY(Math.max(10, Math.min(LOGICAL_H - 10, sy)));
      setFineAng(normalizeAngleDeg(angle));
      setFineBlocked(false);
    },
    []
  );

  const applyAnalyzedSolution = useCallback(
    (
      engine: OkayEngineController,
      entry: AnalyzedSolution,
      idx: number,
      autoPlay: boolean
    ) => {
      engine.solutionShot = entry;
      engine.activeSolutionIdx = idx;
      engine.showGuide = true;
      setSolutionShot(entry);
      setActiveSolutionIdx(idx);
      setShowGuide(true);
      syncFineTuneFromShot(entry.sx, entry.sy, entry.angle);
      if (autoPlay) {
        engine.launchSimulation(entry.simResult);
      }
    },
    [syncFineTuneFromShot]
  );

  const engineRef = useRef<OkayEngineController | null>(null);
  if (!engineRef.current) {
    engineRef.current = new OkayEngineController({
      onHudChange: (alive, total) => {
        setTargetsAlive(alive);
        setTargetsTotal(total);
      },
      onZoomChange: (pct) => setZoomPercent(pct),
      onWin: (bounces) => setWinBounces(bounces),
      onWinClear: () => setWinBounces(null),
      onSelectShape: (id) => {
        setSelectedShapeId(id);
        setShapeRevision((r) => r + 1);
      },
      onShapeMutated: () => {
        const eng = engineRef.current;
        if (!eng) return;
        eng.solutionShot = null;
        eng.solutions = [];
        eng.activeSolutionIdx = -1;
        setSolutionShot(null);
        setSolutions([]);
        setActiveSolutionIdx(-1);
        setFineBlocked(false);
        setShapeRevision((r) => r + 1);
      },
      onManualShot: (sim: SimResult) => {
        const eng = engineRef.current;
        if (!eng) return;
        const analyzed = analyzeAndCenterSolution(
          sim,
          eng.shapes,
          eng.ballRadius
        );
        applyAnalyzedSolution(eng, analyzed, -1, true);
      },
      onSelectAltSolution: (idx: number) => {
        const eng = engineRef.current;
        if (!eng || idx < 0 || idx >= eng.solutions.length) return;
        applyAnalyzedSolution(eng, eng.solutions[idx], idx, true);
        showToast(`Beralih ke Solusi #${idx + 1}`);
      },
      onToast: (msg) => showToast(msg),
    });
  }
  const engine = engineRef.current;

  const invalidateSolution = useCallback(() => {
    engine.solutionShot = null;
    engine.solutions = [];
    engine.activeSolutionIdx = -1;
    setSolutionShot(null);
    setSolutions([]);
    setActiveSolutionIdx(-1);
    setFineBlocked(false);
  }, [engine]);

  const buildPersistedSnapshot = useCallback(
    (overrides?: Partial<PersistedWorkspaceState>): PersistedWorkspaceState => ({
      version: 1,
      savedAt: Date.now(),
      activePresetKey,
      activeTab,
      bgColor: engine.bgColor,
      ballRadius: engine.ballRadius,
      shapes: engine.shapes,
      uploadedImageDataUrl: engine.uploadedImageDataUrl,
      uploadedRect: engine.uploadedRect,
      showImageOverlay: engine.showImageOverlay,
      imageOverlayAlpha: engine.imageOverlayAlpha,
      detectSensitivity: engine.detectSensitivity,
      ignoreStatusBars: engine.ignoreStatusBars,
      swapTargetWall: engine.swapTargetWall,
      detectedTargets,
      detectedThinTargets,
      detectedWalls,
      solutions: engine.solutions,
      activeSolutionIdx: engine.activeSolutionIdx,
      showGrid: engine.showGrid,
      snapToGrid: engine.snapToGrid,
      showGuide: engine.showGuide,
      showSafeZone: engine.showSafeZone,
      showAltPaths: engine.showAltPaths,
      ...overrides,
    }),
    [
      activePresetKey,
      activeTab,
      detectedTargets,
      detectedThinTargets,
      detectedWalls,
      engine,
    ]
  );

  const loadPreset = useCallback(
    (key: string) => {
      const preset = getPresetByKey(key);
      if (!preset) return;
      engine.uploadedImage = null;
      engine.uploadedImageDataUrl = null;
      setHasUploadedImage(false);
      setDetectedTargets(0);
      setDetectedThinTargets(0);
      setDetectedWalls(0);
      engine.bgColor = preset.bgColor;
      engine.ballRadius = preset.ballRadius;
      setBallRadius(preset.ballRadius);

      engine.shapes = preset.build(engine.allocateId);
      engine.selectedShapeId = null;
      setSelectedShapeId(null);
      setActivePresetKey(key);
      invalidateSolution();
      engine.resetCamera();
      engine.stopSimulation(true);
      setShapeRevision((r) => r + 1);
    },
    [engine, invalidateSolution]
  );

  // Hydrate persisted workspace (uploaded screenshot, shapes, settings & solutions) on mount,
  // falling back to default preset only on first visit.
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      const saved = await loadWorkspaceState();
      if (cancelled) return;

      if (saved && (saved.uploadedImageDataUrl || saved.shapes.length > 0)) {
        engine.bgColor = saved.bgColor;
        engine.ballRadius = saved.ballRadius;
        setBallRadius(saved.ballRadius);

        engine.shapes = saved.shapes.map((s) => ({
          ...s,
          vertices: s.vertices.map((v) => ({ x: v.x, y: v.y })),
          alive: true,
          flash: 0,
        }));
        engine.syncNextShapeId();

        engine.uploadedRect = saved.uploadedRect || {
          x: 0,
          y: 0,
          w: LOGICAL_W,
          h: LOGICAL_H,
        };
        engine.showImageOverlay = saved.showImageOverlay ?? true;
        engine.imageOverlayAlpha = saved.imageOverlayAlpha ?? 0.35;
        engine.detectSensitivity = saved.detectSensitivity ?? 36;
        engine.ignoreStatusBars = saved.ignoreStatusBars ?? true;
        engine.swapTargetWall = saved.swapTargetWall ?? false;
        engine.showGrid = saved.showGrid ?? false;
        engine.snapToGrid = saved.snapToGrid ?? false;
        engine.showGuide = saved.showGuide ?? true;
        engine.showSafeZone = saved.showSafeZone ?? true;
        engine.showAltPaths = saved.showAltPaths ?? false;

        setShowImageOverlay(engine.showImageOverlay);
        setOverlayAlphaPercent(Math.round(engine.imageOverlayAlpha * 100));
        setDetectSensitivity(engine.detectSensitivity);
        setIgnoreStatusBars(engine.ignoreStatusBars);
        setShowGrid(engine.showGrid);
        setSnapToGrid(engine.snapToGrid);
        setShowGuide(engine.showGuide);
        setShowSafeZone(engine.showSafeZone);
        setShowAltPaths(engine.showAltPaths);
        setActivePresetKey(saved.activePresetKey ?? null);
        setActiveTab(saved.activeTab ?? 'solve');

        const restoredTargets = engine.shapes.filter((s) => s.type === 'target').length;
        const restoredThin = engine.shapes.filter(
          (s) => s.type === 'target' && Boolean(s.passThrough)
        ).length;
        const restoredWalls = engine.shapes.filter((s) => s.type === 'wall').length;
        setDetectedTargets(saved.detectedTargets ?? restoredTargets);
        setDetectedThinTargets(saved.detectedThinTargets ?? restoredThin);
        setDetectedWalls(saved.detectedWalls ?? restoredWalls);

        // Restore uploaded screenshot image for overlay & re-scan capability
        if (saved.uploadedImageDataUrl) {
          engine.uploadedImageDataUrl = saved.uploadedImageDataUrl;
          setHasUploadedImage(true);
          const img = new Image();
          img.onload = () => {
            if (!cancelled) {
              engine.uploadedImage = img;
            }
          };
          img.src = saved.uploadedImageDataUrl;
        } else {
          engine.uploadedImage = null;
          engine.uploadedImageDataUrl = null;
          setHasUploadedImage(false);
        }

        // Restore previously computed solutions if present
        if (Array.isArray(saved.solutions) && saved.solutions.length > 0) {
          engine.solutions = saved.solutions;
          setSolutions(saved.solutions);
          const idx =
            saved.activeSolutionIdx >= 0 &&
            saved.activeSolutionIdx < saved.solutions.length
              ? saved.activeSolutionIdx
              : 0;
          applyAnalyzedSolution(engine, saved.solutions[idx], idx, false);
        } else {
          invalidateSolution();
        }

        engine.resetCamera();
        engine.stopSimulation(true);
        setShapeRevision((r) => r + 1);
      } else {
        loadPreset('triangles4x5');
      }

      hydratedRef.current = true;
    };

    void hydrate();

    return () => {
      cancelled = true;
      engine.dispose();
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    };
  }, [engine, loadPreset, applyAnalyzedSolution, invalidateSolution]);

  // Automatically persist workspace mutations after initial hydration
  useEffect(() => {
    if (!hydratedRef.current) return;
    if (persistTimerRef.current) clearTimeout(persistTimerRef.current);
    persistTimerRef.current = setTimeout(() => {
      persistTimerRef.current = null;
      void saveWorkspaceState(buildPersistedSnapshot());
    }, 180);
  }, [
    buildPersistedSnapshot,
    shapeRevision,
    solutions,
    activeSolutionIdx,
    activePresetKey,
    activeTab,
    ballRadius,
    detectSensitivity,
    overlayAlphaPercent,
    ignoreStatusBars,
    showImageOverlay,
    hasUploadedImage,
    showGrid,
    snapToGrid,
    showGuide,
    showSafeZone,
    showAltPaths,
  ]);

  const runImageExtraction = useCallback(
    (
      img: HTMLImageElement,
      opts?: {
        sensitivity?: number;
        ignoreBars?: boolean;
        swap?: boolean;
      }
    ) => {
      const sens = opts?.sensitivity ?? engine.detectSensitivity;
      const ignoreBars = opts?.ignoreBars ?? engine.ignoreStatusBars;
      const swap = opts?.swap ?? engine.swapTargetWall;

      const res = extractShapesFromImage({
        img,
        detectSensitivity: sens,
        ignoreStatusBars: ignoreBars,
        swapTargetWall: swap,
        allocateId: engine.allocateId,
      });

      engine.bgColor = res.bgColor;
      engine.uploadedRect = res.uploadedRect;
      engine.shapes = res.shapes;
      engine.selectedShapeId = null;
      setSelectedShapeId(null);
      setActivePresetKey(null);
      setDetectedTargets(res.targetCount);
      setDetectedThinTargets(res.thinTargetCount);
      setDetectedWalls(res.wallCount);
      invalidateSolution();
      engine.stopSimulation(true);
      setShapeRevision((r) => r + 1);
      return res;
    },
    [engine, invalidateSolution]
  );

  const handleImageFile = useCallback(
    (file: File | null | undefined) => {
      if (!file || !file.type.startsWith('image/')) {
        showToast('Pilih file gambar (PNG / JPG / WebP).');
        return;
      }
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result;
        if (typeof result !== 'string') return;
        const img = new Image();
        img.onload = () => {
          engine.uploadedImage = img;
          engine.uploadedImageDataUrl = result;
          engine.showImageOverlay = true;
          setHasUploadedImage(true);
          setShowImageOverlay(true);
          engine.resetCamera();
          const res = runImageExtraction(img);
          setActiveTab('scan');
          // Commit immediately to IndexedDB so even an instant refresh preserves the uploaded image & shapes
          hydratedRef.current = true;
          void saveWorkspaceState(
            buildPersistedSnapshot({
              activePresetKey: null,
              activeTab: 'scan',
              bgColor: res.bgColor,
              shapes: res.shapes,
              uploadedImageDataUrl: result,
              uploadedRect: res.uploadedRect,
              showImageOverlay: true,
              detectedTargets: res.targetCount,
              detectedThinTargets: res.thinTargetCount,
              detectedWalls: res.wallCount,
              solutions: [],
              activeSolutionIdx: -1,
            })
          );
          showToast('Screenshot berhasil dipindai & tersimpan otomatis.');
        };
        img.onerror = () => showToast('Gagal membaca file gambar.');
        img.src = result;
      };
      reader.readAsDataURL(file);
    },
    [engine, runImageExtraction, buildPersistedSnapshot, showToast]
  );

  // Global clipboard paste support for screenshots
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          handleImageFile(items[i].getAsFile());
          break;
        }
      }
    };
    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [handleImageFile]);

  const handleToolModeChange = useCallback(
    (mode: ToolMode) => {
      engine.toolMode = mode;
      setToolMode(mode);
      if (mode === 'edit') {
        engine.stopSimulation(true);
        setActiveTab('edit');
      }
    },
    [engine]
  );

  const handleTabChange = useCallback(
    (tab: TabKey) => {
      setActiveTab(tab);
      setToastMsg(null);
      if (tab === 'edit') {
        engine.toolMode = 'edit';
        setToolMode('edit');
        engine.stopSimulation(true);
      } else if (engine.toolMode === 'edit') {
        engine.toolMode = 'play';
        setToolMode('play');
      }
    },
    [engine]
  );

  const handleAutoSolve = useCallback(async () => {
    const targets = engine.shapes.filter((s) => s.type === 'target');
    if (targets.length === 0) {
      showToast('Tidak ada bentuk putih (target) untuk diselesaikan.');
      return;
    }
    if (engine.solving) return;

    audioEngine.ensureAudio();
    setActiveTab('solve');
    engine.toolMode = 'play';
    setToolMode('play');
    engine.stopSimulation(true);

    engine.solving = true;
    engine.cancelSolveFlag = false;
    setSolving(true);
    setSolverProgress({
      title: 'Tahap 1/3: Mencari Beragam Solusi...',
      subtitle: 'Memindai berbagai arah & sudut tembakan',
      percent: 5,
    });

    try {
      const result = await solveLevelAsync({
        shapes: engine.shapes,
        ballRadius: engine.ballRadius,
        shouldCancel: () => engine.cancelSolveFlag,
        onProgress: (p) => setSolverProgress(p),
      });

      if (result.cancelled) {
        showToast('Pencarian Auto-Solve dibatalkan.');
        return;
      }

      if (result.solutions.length === 0) {
        showToast(
          'Tidak ditemukan lintasan valid. Pastikan ada ruang kosong untuk bola.'
        );
        return;
      }

      engine.solutions = result.solutions;
      setSolutions(result.solutions);
      applyAnalyzedSolution(engine, result.solutions[0], 0, true);

      const solvedCount = result.solutions.filter((s) => s.solved).length;
      if (solvedCount > 1) {
        showToast(
          `Ditemukan ${solvedCount} solusi berbeda. Solusi #1 dipilih sebagai cara termudah.`
        );
      } else if (solvedCount === 1) {
        showToast(
          `Solusi ditemukan dan dipusatkan ke zona aman (Skor ${result.solutions[0].analysis?.easeScore ?? 0}/100).`
        );
      } else {
        showToast(
          `Terbaik: ${result.solutions[0].simResult.targetsHit}/${result.solutions[0].simResult.totalTargets} target. Cek Kalibrasi Presisi.`
        );
      }
    } finally {
      engine.solving = false;
      setSolving(false);
      setSolverProgress(null);
    }
  }, [engine, applyAnalyzedSolution, showToast]);

  const handleSelectSolution = useCallback(
    (index: number) => {
      if (index < 0 || index >= engine.solutions.length) return;
      audioEngine.ensureAudio();
      applyAnalyzedSolution(engine, engine.solutions[index], index, true);
    },
    [engine, applyAnalyzedSolution]
  );

  const handleFineTuneChange = useCallback(
    (sx: number, sy: number, deg: number) => {
      if (engine.solving) return;
      setFineX(sx);
      setFineY(sy);
      setFineAng(deg);

      if (!isPointClearOfShapes(sx, sy, engine.shapes, engine.ballRadius)) {
        setFineBlocked(true);
        return;
      }
      setFineBlocked(false);
      const angRad = (deg * Math.PI) / 180;
      const sim = simulateShot(
        sx,
        sy,
        angRad,
        engine.shapes,
        engine.ballRadius,
        false
      );
      const customEntry: AnalyzedSolution = {
        sx,
        sy,
        angle: angRad,
        simResult: sim,
        solved: sim.solved,
        analysis: null,
        badges: [],
      };
      engine.solutionShot = customEntry;
      engine.activeSolutionIdx = -1;
      engine.showGuide = true;
      setSolutionShot(customEntry);
      setActiveSolutionIdx(-1);
      setShowGuide(true);
    },
    [engine]
  );

  const handleAnalyzeFineTune = useCallback(() => {
    if (!engine.solutionShot || engine.solving) return;
    const analyzed = analyzeAndCenterSolution(
      engine.solutionShot.simResult,
      engine.shapes,
      engine.ballRadius
    );
    applyAnalyzedSolution(engine, analyzed, -1, false);
    showToast(
      `Analisis selesai · Skor ${analyzed.analysis?.easeScore ?? 0}/100 (Sudut ±${(analyzed.analysis?.angleTolDeg ?? 0).toFixed(2)}°).`
    );
  }, [engine, applyAnalyzedSolution, showToast]);

  const handleFireFineTune = useCallback(() => {
    if (!engine.solutionShot || engine.solving) return;
    audioEngine.ensureAudio();
    const reSim = simulateShot(
      engine.solutionShot.sx,
      engine.solutionShot.sy,
      engine.solutionShot.angle,
      engine.shapes,
      engine.ballRadius,
      false
    );
    engine.launchSimulation(reSim);
  }, [engine]);

  // Shape editor operations
  const selectedShapeInfo: SelectedShapeInfo | null = useMemo(() => {
    void shapeRevision;
    if (selectedShapeId === null) return null;
    const s = engine.shapes.find((sh) => sh.id === selectedShapeId);
    if (!s) return null;
    const c = polygonCentroid(s.vertices);
    const kindLabel = s.passThrough
      ? 'Benang Putih'
      : s.vertices.length === 3
        ? 'Segitiga'
        : s.vertices.length === 4
          ? 'Balok'
          : 'Poligon';
    const roleLabel =
      s.type === 'target'
        ? s.passThrough
          ? 'Target Nembus'
          : 'Target Putih'
        : 'Dinding Hitam';
    return {
      id: s.id,
      kindLabel,
      roleLabel,
      type: s.type,
      passThrough: Boolean(s.passThrough),
      cx: c.x,
      cy: c.y,
    };
  }, [engine, selectedShapeId, shapeRevision]);

  const addAndSelectShape = useCallback(
    (shape: Shape) => {
      engine.shapes.push(shape);
      engine.selectedShapeId = shape.id;
      engine.toolMode = 'edit';
      setSelectedShapeId(shape.id);
      setToolMode('edit');
      invalidateSolution();
      engine.emitHudCounts();
      setShapeRevision((r) => r + 1);
    },
    [engine, invalidateSolution]
  );

  const mutateSelected = useCallback(
    (fn: (shape: Shape) => void) => {
      const s = engine.shapes.find((sh) => sh.id === engine.selectedShapeId);
      if (!s) return;
      fn(s);
      invalidateSolution();
      engine.emitHudCounts();
      setShapeRevision((r) => r + 1);
    },
    [engine, invalidateSolution]
  );

  const handleDeleteSelected = useCallback(() => {
    if (engine.selectedShapeId === null) return;
    engine.shapes = engine.shapes.filter((s) => s.id !== engine.selectedShapeId);
    engine.selectedShapeId = null;
    setSelectedShapeId(null);
    invalidateSolution();
    engine.emitHudCounts();
    setShapeRevision((r) => r + 1);
  }, [engine, invalidateSolution]);

  return (
    <div className="min-h-screen flex flex-col">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleImageFile(file);
          e.target.value = '';
        }}
      />

      <div className="w-full max-w-6xl mx-auto px-3 sm:px-6 py-3 sm:py-4 flex flex-col gap-4">
        {/* Clean Header */}
        <header className="flex flex-wrap items-center justify-between gap-4 pb-2 border-b border-white/10">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/15 border border-emerald-400/35 flex items-center justify-center shrink-0">
              <svg
                className="w-5 h-5 text-emerald-400"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="6" cy="18" r="2.5" fill="currentColor" />
                <path d="M8 16L17 7L12 4" strokeDasharray="2.5 2.5" />
                <polygon
                  points="15 4 21 4 21 10"
                  fill="currentColor"
                  stroke="none"
                />
              </svg>
            </div>
            <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-white whitespace-nowrap">
              Okay?{' '}
              <span className="text-emerald-400 font-semibold">
                Simulator & Auto-Solver
              </span>
            </h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              aria-pressed={showGrid}
              onClick={() => {
                const next = !showGrid;
                engine.showGrid = next;
                setShowGrid(next);
              }}
              className={`px-3 py-2 rounded-xl text-xs font-semibold border flex items-center gap-1.5 whitespace-nowrap transition ${
                showGrid
                  ? 'bg-sky-500/20 border-sky-400/60 text-sky-200'
                  : 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10'
              }`}
              title="Tampilkan Grid Bantu"
            >
              <Grid3X3 className="w-3.5 h-3.5" aria-hidden="true" />
              <span className="hidden sm:inline">Grid</span>
            </button>

            <button
              type="button"
              aria-pressed={muted}
              aria-label={muted ? 'Aktifkan Suara' : 'Bisukan Suara'}
              onClick={() => {
                const next = !muted;
                audioEngine.muted = next;
                setMuted(next);
              }}
              className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200 flex items-center gap-1.5 whitespace-nowrap transition"
              title="Suara Kalimba"
            >
              {muted ? (
                <VolumeX className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">Suara</span>
            </button>

            <button
              type="button"
              onClick={() => {
                engine.stopSimulation(true);
                engine.resetCamera();
                showToast('Papan & tampilan zoom direset.');
              }}
              className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-semibold text-slate-200 flex items-center gap-1.5 whitespace-nowrap transition"
              title="Reset Papan & Zoom"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Reset</span>
            </button>
          </div>
        </header>

        {/* Main 2-Column Workspace */}
        <main className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* LEFT COLUMN: Interactive Zoomable Stage + Actions */}
          <section className="lg:col-span-5 flex flex-col items-center gap-3 w-full">
            <StageCanvas
              engine={engine}
              toolMode={toolMode}
              onToolModeChange={handleToolModeChange}
              targetsAlive={targetsAlive}
              targetsTotal={targetsTotal}
              zoomPercent={zoomPercent}
              solving={solving}
              solverProgress={solverProgress}
              onCancelSolve={() => {
                engine.cancelSolveFlag = true;
              }}
              winBounces={winBounces}
              onDeleteSelectedKey={handleDeleteSelected}
              onSwitchToEditTab={() => setActiveTab('edit')}
            />

            {/* Primary Actions */}
            <div className="w-full max-w-[420px] lg:max-w-[356px] xl:max-w-[372px] grid grid-cols-2 gap-2">
              <button
                type="button"
                disabled={solving}
                onClick={handleAutoSolve}
                className="py-2.5 px-3.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 active:scale-[0.98] disabled:opacity-50 text-slate-950 text-sm font-bold flex items-center justify-center gap-2 whitespace-nowrap shadow-[0_8px_22px_-6px_rgba(16,185,129,0.55)] transition"
              >
                <Zap className="w-4 h-4 fill-current" aria-hidden="true" />
                <span>Auto Solve</span>
              </button>

              <button
                type="button"
                disabled={solving}
                onClick={() => fileInputRef.current?.click()}
                className="py-2.5 px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-[0.98] disabled:opacity-50 border border-white/15 text-white text-sm font-semibold flex items-center justify-center gap-2 whitespace-nowrap transition"
              >
                <ImageUp className="w-4 h-4 text-sky-300" aria-hidden="true" />
                <span>Upload Screenshot</span>
              </button>
            </div>

            {/* Secondary Playback & Display Bar */}
            <div className="w-full max-w-[420px] lg:max-w-[356px] xl:max-w-[372px] grid grid-cols-2 sm:grid-cols-4 gap-1.5">
              <button
                type="button"
                disabled={!solutionShot || solving}
                onClick={handleFireFineTune}
                className="py-2 px-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-semibold text-slate-200 disabled:opacity-40 flex items-center justify-center gap-1 whitespace-nowrap transition"
              >
                <Play className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Ulang</span>
              </button>

              <button
                type="button"
                aria-pressed={slowMo}
                onClick={() => {
                  const next = !slowMo;
                  engine.slowMo = next;
                  setSlowMo(next);
                }}
                className={`py-2 px-2 rounded-xl border text-[11px] font-semibold flex items-center justify-center gap-1 whitespace-nowrap transition ${
                  slowMo
                    ? 'bg-sky-500/20 border-sky-400/60 text-sky-200'
                    : 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10'
                }`}
              >
                <Gauge className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>{slowMo ? '0.4x' : '1x'}</span>
              </button>

              <button
                type="button"
                aria-pressed={showGuide}
                onClick={() => {
                  const next = !showGuide;
                  engine.showGuide = next;
                  setShowGuide(next);
                }}
                className={`py-2 px-2 rounded-xl border text-[11px] font-semibold flex items-center justify-center gap-1 whitespace-nowrap transition ${
                  showGuide
                    ? 'bg-emerald-500/20 border-emerald-400/60 text-emerald-200'
                    : 'bg-white/5 border-white/10 text-slate-200 hover:bg-white/10'
                }`}
              >
                <Compass className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Jalur</span>
              </button>

              <button
                type="button"
                disabled={!solutionShot}
                onClick={() => {
                  engine.focusCameraOnSolutionStart();
                  showToast('Zoom difokuskan ke titik mulai & arah tembak.');
                }}
                className="py-2 px-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-[11px] font-semibold text-sky-300 disabled:opacity-40 flex items-center justify-center gap-1 whitespace-nowrap transition"
                title="Zoom otomatis ke titik mulai & panah bidik"
              >
                <Focus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>Fokus Awal</span>
              </button>
            </div>
          </section>

          {/* RIGHT COLUMN: Organized Tabbed Workspace */}
          <section className="lg:col-span-7 flex flex-col gap-4 w-full">
            {/* Segmented Tab Bar */}
            <div
              role="tablist"
              aria-label="Panel alat"
              className="bg-slate-900/90 border border-white/10 p-1 rounded-2xl grid grid-cols-3 gap-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'solve'}
                onClick={() => handleTabChange('solve')}
                className={`py-2.5 px-2 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 whitespace-nowrap transition ${
                  activeTab === 'solve'
                    ? 'bg-slate-800 text-white border border-white/15 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                <Target className="w-4 h-4 text-emerald-400" aria-hidden="true" />
                <span>Solve & Level</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'scan'}
                onClick={() => handleTabChange('scan')}
                className={`py-2.5 px-2 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 whitespace-nowrap transition ${
                  activeTab === 'scan'
                    ? 'bg-slate-800 text-white border border-white/15 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                <ScanLine className="w-4 h-4 text-sky-400" aria-hidden="true" />
                <span>Scan Gambar</span>
              </button>

              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'edit'}
                onClick={() => handleTabChange('edit')}
                className={`py-2.5 px-2 rounded-xl text-xs sm:text-sm font-bold flex items-center justify-center gap-1.5 whitespace-nowrap transition ${
                  activeTab === 'edit'
                    ? 'bg-slate-800 text-white border border-white/15 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 border border-transparent'
                }`}
              >
                <Pencil className="w-4 h-4 text-pink-400" aria-hidden="true" />
                <span>Atur Posisi</span>
              </button>
            </div>

            {activeTab === 'solve' && (
              <SolveTab
                presets={PRESETS}
                activePresetKey={activePresetKey}
                onSelectPreset={(key) => {
                  if (!solving) loadPreset(key);
                }}
                solutions={solutions}
                activeSolutionIdx={activeSolutionIdx}
                solutionShot={solutionShot}
                onSelectSolution={handleSelectSolution}
                showSafeZone={showSafeZone}
                onToggleSafeZone={() => {
                  const next = !showSafeZone;
                  engine.showSafeZone = next;
                  setShowSafeZone(next);
                }}
                showAltPaths={showAltPaths}
                onToggleAltPaths={() => {
                  const next = !showAltPaths;
                  engine.showAltPaths = next;
                  setShowAltPaths(next);
                }}
                fineX={fineX}
                fineY={fineY}
                fineAng={fineAng}
                fineBlocked={fineBlocked}
                onFineTuneChange={handleFineTuneChange}
                onAnalyzeFineTune={handleAnalyzeFineTune}
                onFireFineTune={handleFireFineTune}
                totalTargets={targetsTotal}
                solving={solving}
              />
            )}

            {activeTab === 'scan' && (
              <ScanTab
                hasUploadedImage={hasUploadedImage}
                detectedTargets={detectedTargets}
                detectedThinTargets={detectedThinTargets}
                detectedWalls={detectedWalls}
                showImageOverlay={showImageOverlay}
                onToggleImageOverlay={() => {
                  const next = !showImageOverlay;
                  engine.showImageOverlay = next;
                  setShowImageOverlay(next);
                }}
                onSwapTargetWall={() => {
                  engine.swapTargetWall = !engine.swapTargetWall;
                  if (engine.uploadedImage) {
                    runImageExtraction(engine.uploadedImage, {
                      swap: engine.swapTargetWall,
                    });
                    showToast('Target & Dinding ditukar.');
                  }
                }}
                detectSensitivity={detectSensitivity}
                onChangeSensitivity={(val) => {
                  engine.detectSensitivity = val;
                  setDetectSensitivity(val);
                  if (engine.uploadedImage) {
                    runImageExtraction(engine.uploadedImage, {
                      sensitivity: val,
                    });
                  }
                }}
                overlayAlphaPercent={overlayAlphaPercent}
                onChangeOverlayAlpha={(pct) => {
                  engine.imageOverlayAlpha = pct / 100;
                  setOverlayAlphaPercent(pct);
                }}
                ignoreStatusBars={ignoreStatusBars}
                onChangeIgnoreStatusBars={(checked) => {
                  engine.ignoreStatusBars = checked;
                  setIgnoreStatusBars(checked);
                  if (engine.uploadedImage) {
                    runImageExtraction(engine.uploadedImage, {
                      ignoreBars: checked,
                    });
                  }
                }}
                onRescan={() => {
                  if (engine.uploadedImage) {
                    runImageExtraction(engine.uploadedImage);
                    showToast('Screenshot di-scan ulang.');
                  }
                }}
                ballRadius={ballRadius}
                onChangeBallRadius={(r) => {
                  engine.ballRadius = r;
                  setBallRadius(r);
                  if (engine.solutionShot) {
                    const sim = simulateShot(
                      engine.solutionShot.sx,
                      engine.solutionShot.sy,
                      engine.solutionShot.angle,
                      engine.shapes,
                      r,
                      false
                    );
                    const analyzed = analyzeAndCenterSolution(
                      sim,
                      engine.shapes,
                      r
                    );
                    applyAnalyzedSolution(engine, analyzed, -1, false);
                  }
                }}
                onTriggerFilePicker={() => fileInputRef.current?.click()}
                onFileDropped={handleImageFile}
              />
            )}

            {activeTab === 'edit' && (
              <EditTab
                snapToGrid={snapToGrid}
                onChangeSnapToGrid={(checked) => {
                  engine.snapToGrid = checked;
                  setSnapToGrid(checked);
                  if (checked && !engine.showGrid) {
                    engine.showGrid = true;
                    setShowGrid(true);
                  }
                }}
                selectedShape={selectedShapeInfo}
                onAddRectTarget={() =>
                  addAndSelectShape(
                    makeRectShape(
                      engine.allocateId(),
                      200,
                      340,
                      68,
                      26,
                      0,
                      'target'
                    )
                  )
                }
                onAddThinTarget={() =>
                  addAndSelectShape({
                    ...makeRectShape(
                      engine.allocateId(),
                      200,
                      340,
                      170,
                      2.2,
                      0,
                      'target'
                    ),
                    passThrough: true,
                  })
                }
                onAddTriTarget={() =>
                  addAndSelectShape(
                    makeRightTriangle(
                      engine.allocateId(),
                      175,
                      315,
                      50,
                      'target'
                    )
                  )
                }
                onAddRectWall={() =>
                  addAndSelectShape(
                    makeRectShape(
                      engine.allocateId(),
                      200,
                      340,
                      18,
                      120,
                      0,
                      'wall'
                    )
                  )
                }
                onAddTriWall={() =>
                  addAndSelectShape(
                    makeRightTriangle(engine.allocateId(), 175, 315, 50, 'wall')
                  )
                }
                onFlipType={() =>
                  mutateSelected((s) => {
                    s.type = s.type === 'target' ? 'wall' : 'target';
                    if (s.type === 'wall') s.passThrough = false;
                  })
                }
                onTogglePassThrough={() =>
                  mutateSelected((s) => {
                    if (s.type === 'target') {
                      s.passThrough = !s.passThrough;
                    }
                  })
                }
                onDuplicate={() => {
                  const s = engine.shapes.find(
                    (sh) => sh.id === engine.selectedShapeId
                  );
                  if (!s) return;
                  addAndSelectShape({
                    id: engine.allocateId(),
                    type: s.type,
                    passThrough: s.passThrough,
                    vertices: s.vertices.map((v) => ({
                      x: v.x + 18,
                      y: v.y + 18,
                    })),
                    alive: true,
                    flash: 0,
                  });
                }}
                onDelete={handleDeleteSelected}
                onNudge={(dx, dy) =>
                  mutateSelected((s) => translateShape(s, dx, dy))
                }
                onCenterShape={() =>
                  mutateSelected((s) => {
                    const c = polygonCentroid(s.vertices);
                    translateShape(
                      s,
                      LOGICAL_W * 0.5 - c.x,
                      LOGICAL_H * 0.5 - c.y
                    );
                  })
                }
                onRotate={(deg) => mutateSelected((s) => rotateShape(s, deg))}
                onScale={(factor) =>
                  mutateSelected((s) => scaleShape(s, factor))
                }
                onMirrorX={() => mutateSelected((s) => mirrorShapeX(s))}
                onClearAll={() => {
                  engine.shapes = [];
                  engine.selectedShapeId = null;
                  setSelectedShapeId(null);
                  engine.stopSimulation(true);
                  invalidateSolution();
                  setShapeRevision((r) => r + 1);
                }}
              />
            )}
          </section>
        </main>
      </div>

      {/* Non-blocking Toast (top-right on desktop so it never overlaps CTA buttons) */}
      {toastMsg && (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed bottom-4 left-1/2 -translate-x-1/2 lg:bottom-auto lg:top-4 lg:left-auto lg:right-6 lg:translate-x-0 z-50 bg-slate-900 border border-emerald-400/35 text-white px-4 py-2.5 rounded-xl shadow-2xl text-xs font-semibold max-w-[92vw] lg:max-w-sm text-center lg:text-left"
        >
          {toastMsg}
        </div>
      )}
    </div>
  );
}
