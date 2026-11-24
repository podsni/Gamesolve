import React, { useEffect, useRef } from 'react';
import {
  Crosshair,
  Hand,
  Pencil,
  Plus,
  Minus,
  CheckCircle2,
  X,
} from 'lucide-react';
import { OkayEngineController } from '../engine/controller';
import {
  GRID_STEP,
  LOGICAL_H,
  LOGICAL_W,
  Point,
  SolverProgress,
  ToolMode,
} from '../engine/types';
import {
  pointInPolygon,
  polygonCentroid,
  translateShape,
} from '../engine/geometry';
import { isPointClearOfShapes, simulateShot } from '../engine/physics';
import { getRotateHandlePos, renderScene } from '../engine/renderer';
import { audioEngine } from '../engine/audio';

interface StageCanvasProps {
  engine: OkayEngineController;
  toolMode: ToolMode;
  onToolModeChange: (mode: ToolMode) => void;
  targetsAlive: number;
  targetsTotal: number;
  zoomPercent: number;
  solving: boolean;
  solverProgress: SolverProgress | null;
  onCancelSolve: () => void;
  winBounces: number | null;
  onDeleteSelectedKey: () => void;
  onSwitchToEditTab: () => void;
}

export const StageCanvas: React.FC<StageCanvasProps> = ({
  engine,
  toolMode,
  onToolModeChange,
  targetsAlive,
  targetsTotal,
  zoomPercent,
  solving,
  solverProgress,
  onCancelSolve,
  winBounces,
  onDeleteSelectedKey,
  onSwitchToEditTab,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onDeleteKeyRef = useRef(onDeleteSelectedKey);
  const onSwitchEditRef = useRef(onSwitchToEditTab);

  useEffect(() => {
    onDeleteKeyRef.current = onDeleteSelectedKey;
    onSwitchEditRef.current = onSwitchToEditTab;
  }, [onDeleteSelectedKey, onSwitchToEditTab]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // HiDPI responsive resize via ResizeObserver
    const resizeCanvas = () => {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
    };

    resizeCanvas();
    const ro = new ResizeObserver(resizeCanvas);
    ro.observe(container);

    // Pointer / gesture tracking local to the canvas effect
    const activePointers = new Map<number, { clientX: number; clientY: number }>();
    let pinchStartDist = 0;
    let pinchStartZoom = 1;
    let pinchPrevMid: Point | null = null;
    let isPanning = false;
    let panPrevClient: Point | null = null;
    let spacePressed = false;

    let draggingShape = false;
    let rotatingShape = false;
    let dragStartLogical: Point | null = null;
    let dragOriginalVerts: Point[] | null = null;
    let rotCenter: Point | null = null;
    let rotStartAngle = 0;
    let rotOriginalVerts: Point[] | null = null;

    const clientToStageUnzoomed = (clientX: number, clientY: number): Point => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((clientX - rect.left) / rect.width) * LOGICAL_W,
        y: ((clientY - rect.top) / rect.height) * LOGICAL_H,
      };
    };

    const clientToLogical = (clientX: number, clientY: number): Point => {
      const s = clientToStageUnzoomed(clientX, clientY);
      const c = engine.cam;
      return {
        x: (s.x - LOGICAL_W * 0.5 - c.panX) / c.zoom + LOGICAL_W * 0.5,
        y: (s.y - LOGICAL_H * 0.5 - c.panY) / c.zoom + LOGICAL_H * 0.5,
      };
    };

    const findShapeAtPoint = (px: number, py: number) => {
      for (let i = engine.shapes.length - 1; i >= 0; i--) {
        if (pointInPolygon(px, py, engine.shapes[i].vertices)) {
          return engine.shapes[i];
        }
      }
      return null;
    };

    const getSelectedShape = () =>
      engine.shapes.find((s) => s.id === engine.selectedShapeId) || null;

    const updateSpaceCursor = (active: boolean) => {
      spacePressed = active;
      canvas.dataset.spacePan = active ? 'true' : 'false';
    };

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.14 : 1 / 1.14;
      const stagePt = clientToStageUnzoomed(e.clientX, e.clientY);
      engine.zoomAtStagePoint(engine.cam.zoom * factor, stagePt.x, stagePt.y);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName ?? '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        updateSpaceCursor(true);
        return;
      }

      if (engine.toolMode === 'edit' && engine.selectedShapeId !== null) {
        const sel = getSelectedShape();
        if (!sel) return;
        const step = e.shiftKey ? 5 : 1;
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          translateShape(sel, 0, -step);
          engine.callbacks.onShapeMutated();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          translateShape(sel, 0, step);
          engine.callbacks.onShapeMutated();
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          translateShape(sel, -step, 0);
          engine.callbacks.onShapeMutated();
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          translateShape(sel, step, 0);
          engine.callbacks.onShapeMutated();
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          onDeleteKeyRef.current();
        } else if (e.key === 'Escape') {
          engine.selectedShapeId = null;
          engine.callbacks.onSelectShape(null);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        updateSpaceCursor(false);
        isPanning = false;
        panPrevClient = null;
      }
    };

    const handleWindowBlur = () => {
      updateSpaceCursor(false);
      isPanning = false;
      panPrevClient = null;
      draggingShape = false;
      rotatingShape = false;
      engine.aiming = false;
      activePointers.clear();
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (engine.solving) return;
      e.preventDefault();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // Ignore if pointer capture isn't supported in synthetic test events
      }
      audioEngine.ensureAudio();

      activePointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });

      // Two-finger pinch-to-zoom & pan
      if (activePointers.size === 2) {
        engine.aiming = false;
        draggingShape = false;
        rotatingShape = false;
        isPanning = false;
        const pts = Array.from(activePointers.values());
        pinchStartDist =
          Math.hypot(pts[1].clientX - pts[0].clientX, pts[1].clientY - pts[0].clientY) || 1;
        pinchStartZoom = engine.cam.zoom;
        pinchPrevMid = {
          x: (pts[0].clientX + pts[1].clientX) * 0.5,
          y: (pts[0].clientY + pts[1].clientY) * 0.5,
        };
        return;
      }

      if (activePointers.size > 2) return;

      // Single pointer Pan Mode, Middle Click, or Spacebar Drag
      if (engine.toolMode === 'pan' || e.button === 1 || spacePressed) {
        isPanning = true;
        panPrevClient = { x: e.clientX, y: e.clientY };
        return;
      }

      const pt = clientToLogical(e.clientX, e.clientY);

      // Edit Mode
      if (engine.toolMode === 'edit') {
        const sel = getSelectedShape();
        if (sel) {
          const handle = getRotateHandlePos(sel, engine.cam.zoom);
          if (Math.hypot(pt.x - handle.x, pt.y - handle.y) <= 13 / engine.cam.zoom) {
            rotatingShape = true;
            rotCenter = polygonCentroid(sel.vertices);
            rotStartAngle = Math.atan2(pt.y - rotCenter.y, pt.x - rotCenter.x);
            rotOriginalVerts = sel.vertices.map((v) => ({ ...v }));
            return;
          }
        }

        const hit = findShapeAtPoint(pt.x, pt.y);
        if (hit) {
          engine.selectedShapeId = hit.id;
          draggingShape = true;
          dragStartLogical = pt;
          dragOriginalVerts = hit.vertices.map((v) => ({ ...v }));
          engine.callbacks.onSelectShape(hit.id);
          onSwitchEditRef.current();
        } else {
          engine.selectedShapeId = null;
          draggingShape = false;
          engine.callbacks.onSelectShape(null);
        }
        return;
      }

      // Play / Aim Mode: tap directly on ghost alternative start dot
      if (engine.showGuide && engine.showAltPaths && engine.solutions.length > 1) {
        for (let idx = 0; idx < engine.solutions.length; idx++) {
          if (idx === engine.activeSolutionIdx) continue;
          const alt = engine.solutions[idx];
          if (Math.hypot(pt.x - alt.sx, pt.y - alt.sy) <= 13 / Math.sqrt(engine.cam.zoom)) {
            engine.callbacks.onSelectAltSolution(idx);
            return;
          }
        }
      }

      engine.stopSimulation(true);
      if (!isPointClearOfShapes(pt.x, pt.y, engine.shapes, engine.ballRadius)) {
        engine.callbacks.onToast('Mulai sentuhan di ruang kosong (bukan di atas balok).');
        return;
      }
      engine.aiming = true;
      engine.aimStart = pt;
      engine.aimCurrent = pt;
      engine.aimPreviewSim = null;
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (engine.solving) return;
      if (activePointers.has(e.pointerId)) {
        activePointers.set(e.pointerId, { clientX: e.clientX, clientY: e.clientY });
      }

      // Two-finger pinch zoom & pan
      if (activePointers.size === 2) {
        const pts = Array.from(activePointers.values());
        const dist =
          Math.hypot(pts[1].clientX - pts[0].clientX, pts[1].clientY - pts[0].clientY) || 1;
        const midClient = {
          x: (pts[0].clientX + pts[1].clientX) * 0.5,
          y: (pts[0].clientY + pts[1].clientY) * 0.5,
        };

        if (pinchPrevMid) {
          const rect = canvas.getBoundingClientRect();
          const dxStage = ((midClient.x - pinchPrevMid.x) / rect.width) * LOGICAL_W;
          const dyStage = ((midClient.y - pinchPrevMid.y) / rect.height) * LOGICAL_H;
          engine.cam.panX += dxStage;
          engine.cam.panY += dyStage;
        }
        pinchPrevMid = midClient;

        const targetZoom = pinchStartZoom * (dist / pinchStartDist);
        const midStage = clientToStageUnzoomed(midClient.x, midClient.y);
        engine.zoomAtStagePoint(targetZoom, midStage.x, midStage.y);
        return;
      }

      // Single-finger pan drag
      if (isPanning && panPrevClient) {
        const rect = canvas.getBoundingClientRect();
        const dxStage = ((e.clientX - panPrevClient.x) / rect.width) * LOGICAL_W;
        const dyStage = ((e.clientY - panPrevClient.y) / rect.height) * LOGICAL_H;
        engine.cam.panX += dxStage;
        engine.cam.panY += dyStage;
        panPrevClient = { x: e.clientX, y: e.clientY };
        engine.clampCamera();
        return;
      }

      const pt = clientToLogical(e.clientX, e.clientY);

      // On-canvas shape rotation
      if (engine.toolMode === 'edit' && rotatingShape) {
        const sel = getSelectedShape();
        if (sel && rotOriginalVerts && rotCenter) {
          const curAng = Math.atan2(pt.y - rotCenter.y, pt.x - rotCenter.x);
          let delta = curAng - rotStartAngle;
          if (engine.snapToGrid) {
            const stepRad = (15 * Math.PI) / 180;
            delta = Math.round(delta / stepRad) * stepRad;
          }
          const cos = Math.cos(delta);
          const sin = Math.sin(delta);
          sel.vertices = rotOriginalVerts.map((v) => {
            const rx = v.x - rotCenter!.x;
            const ry = v.y - rotCenter!.y;
            return {
              x: rotCenter!.x + rx * cos - ry * sin,
              y: rotCenter!.y + rx * sin + ry * cos,
            };
          });
          engine.callbacks.onShapeMutated();
        }
        return;
      }

      // On-canvas shape dragging
      if (engine.toolMode === 'edit' && draggingShape) {
        const sel = getSelectedShape();
        if (sel && dragOriginalVerts && dragStartLogical) {
          let dx = pt.x - dragStartLogical.x;
          let dy = pt.y - dragStartLogical.y;
          if (engine.snapToGrid) {
            const origC = polygonCentroid(dragOriginalVerts);
            const snappedX = Math.round((origC.x + dx) / GRID_STEP) * GRID_STEP;
            const snappedY = Math.round((origC.y + dy) / GRID_STEP) * GRID_STEP;
            dx = snappedX - origC.x;
            dy = snappedY - origC.y;
          }
          sel.vertices = dragOriginalVerts.map((v) => ({ x: v.x + dx, y: v.y + dy }));
          engine.callbacks.onShapeMutated();
        }
        return;
      }

      if (engine.aiming) {
        engine.aimCurrent = pt;
        const dx = pt.x - engine.aimStart.x;
        const dy = pt.y - engine.aimStart.y;
        if (Math.hypot(dx, dy) > 6 / engine.cam.zoom) {
          const ang = Math.atan2(dy, dx);
          engine.aimPreviewSim = simulateShot(
            engine.aimStart.x,
            engine.aimStart.y,
            ang,
            engine.shapes,
            engine.ballRadius,
            false
          );
        } else {
          engine.aimPreviewSim = null;
        }
      }
    };

    const finishPointer = (e: PointerEvent) => {
      activePointers.delete(e.pointerId);
      if (activePointers.size < 2) {
        pinchPrevMid = null;
      }

      if (isPanning) {
        isPanning = false;
        panPrevClient = null;
        return;
      }

      if (engine.toolMode === 'edit') {
        draggingShape = false;
        rotatingShape = false;
        return;
      }

      if (!engine.aiming) return;
      engine.aiming = false;
      const cachedSim = engine.aimPreviewSim;
      engine.aimPreviewSim = null;

      const dx = engine.aimCurrent.x - engine.aimStart.x;
      const dy = engine.aimCurrent.y - engine.aimStart.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 7 / engine.cam.zoom) return;

      const angle = Math.atan2(dy, dx);
      const sim =
        cachedSim ||
        simulateShot(
          engine.aimStart.x,
          engine.aimStart.y,
          angle,
          engine.shapes,
          engine.ballRadius,
          false
        );
      engine.callbacks.onManualShot(sim);
    };

    canvas.addEventListener('wheel', handleWheel, { passive: false });
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', finishPointer);
    canvas.addEventListener('pointercancel', finishPointer);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleWindowBlur);

    // 60fps decoupled render & simulation loop
    let rafId = 0;
    let lastTime = 0;
    const tick = (timeMs: number) => {
      if (!lastTime) lastTime = timeMs;
      const dt = Math.min((timeMs - lastTime) / 1000, 0.045);
      lastTime = timeMs;

      engine.step(dt);
      renderScene(ctx, canvas.width, canvas.height, engine.getRenderState(), timeMs);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      canvas.removeEventListener('wheel', handleWheel);
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', finishPointer);
      canvas.removeEventListener('pointercancel', finishPointer);
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [engine]);

  const hintText =
    toolMode === 'play'
      ? 'Tarik untuk membidik · Scroll atau cubit 2 jari untuk zoom'
      : toolMode === 'pan'
        ? 'Seret layar untuk menggeser kanvas yang diperbesar'
        : 'Ketuk bentuk untuk memilih · Seret untuk geser · Tarik titik hijau untuk putar';

  const cursorClass =
    toolMode === 'play'
      ? 'cursor-crosshair'
      : toolMode === 'pan'
        ? 'cursor-grab active:cursor-grabbing'
        : 'cursor-default';

  return (
    <div className="flex flex-col items-center gap-2.5 w-full">
      {/* Stage Mode Segmented Switcher */}
      <div
        role="group"
        aria-label="Mode interaksi kanvas"
        className="w-full max-w-[420px] lg:max-w-[356px] xl:max-w-[372px] bg-slate-900/90 border border-white/10 p-1 rounded-2xl grid grid-cols-3 gap-1"
      >
        <button
          type="button"
          onClick={() => onToolModeChange('play')}
          aria-pressed={toolMode === 'play'}
          className={`py-2 px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors duration-100 ${
            toolMode === 'play'
              ? 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
              : 'text-slate-300 hover:text-white hover:bg-white/5'
          }`}
        >
          <Crosshair className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Tembak</span>
        </button>

        <button
          type="button"
          onClick={() => onToolModeChange('pan')}
          aria-pressed={toolMode === 'pan'}
          className={`py-2 px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors duration-100 ${
            toolMode === 'pan'
              ? 'bg-sky-400 text-slate-950 font-bold shadow-sm'
              : 'text-slate-300 hover:text-white hover:bg-white/5'
          }`}
        >
          <Hand className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Geser</span>
        </button>

        <button
          type="button"
          onClick={() => onToolModeChange('edit')}
          aria-pressed={toolMode === 'edit'}
          className={`py-2 px-2.5 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors duration-100 ${
            toolMode === 'edit'
              ? 'bg-pink-400 text-slate-950 font-bold shadow-sm'
              : 'text-slate-300 hover:text-white hover:bg-white/5'
          }`}
        >
          <Pencil className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
          <span>Edit Posisi</span>
        </button>
      </div>

      {/* Interactive Zoomable Stage Frame */}
      <div
        ref={containerRef}
        data-testid="stage-container"
        data-targets-alive={targetsAlive}
        data-targets-total={targetsTotal}
        data-zoom={zoomPercent}
        data-tool={toolMode}
        className="relative w-full max-w-[420px] lg:max-w-[356px] xl:max-w-[372px] aspect-[400/680] rounded-[22px] overflow-hidden bg-[#1e2530] border border-white/15 shadow-[0_24px_60px_-16px_rgba(0,0,0,0.75)] select-none touch-none"
      >
        <canvas
          ref={canvasRef}
          data-testid="game-canvas"
          className={`block w-full h-full touch-none ${cursorClass}`}
        />

        {/* Top HUD overlay inside canvas (solid translucent rgba, no backdrop-blur over live canvas) */}
        <div className="pointer-events-none absolute top-3 left-3 right-3 flex items-center justify-between gap-2">
          <div className="bg-slate-950/85 border border-white/15 px-3 py-1.5 rounded-xl flex items-center gap-2 shadow-md">
            <span className="w-2.5 h-2.5 rounded-[2px] bg-white inline-block shrink-0" />
            <span
              data-testid="hud-target-count"
              className="text-xs font-bold text-white font-mono tabular-nums"
            >
              {targetsAlive} / {targetsTotal}
            </span>
            <span className="text-[11px] text-slate-300">Target</span>
          </div>

          <div
            data-testid="hud-zoom-badge"
            className="bg-slate-950/85 border border-white/15 px-2.5 py-1.5 rounded-xl text-[11px] font-mono font-bold text-sky-300 tabular-nums shadow-md"
          >
            {zoomPercent}%
          </div>
        </div>

        {/* Floating Zoom Controls (Bottom-Right) */}
        <div className="absolute bottom-3 right-3 flex flex-col gap-1.5 z-10">
          <button
            type="button"
            aria-label="Zoom In"
            onClick={() =>
              engine.zoomAtStagePoint(
                engine.cam.zoom * 1.3,
                LOGICAL_W * 0.5,
                LOGICAL_H * 0.5
              )
            }
            className="w-9 h-9 rounded-xl bg-slate-950/90 hover:bg-slate-900 border border-white/15 text-white flex items-center justify-center shadow-lg active:scale-95 transition"
            title="Perbesar (+)"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            aria-label="Reset Zoom"
            onClick={() => engine.resetCamera()}
            className="w-9 h-9 rounded-xl bg-slate-950/90 hover:bg-slate-900 border border-white/15 text-sky-300 text-[10px] font-mono font-bold flex items-center justify-center shadow-lg active:scale-95 transition"
            title="Reset Zoom (100%)"
          >
            FIT
          </button>
          <button
            type="button"
            aria-label="Zoom Out"
            onClick={() =>
              engine.zoomAtStagePoint(
                engine.cam.zoom / 1.3,
                LOGICAL_W * 0.5,
                LOGICAL_H * 0.5
              )
            }
            className="w-9 h-9 rounded-xl bg-slate-950/90 hover:bg-slate-900 border border-white/15 text-white flex items-center justify-center shadow-lg active:scale-95 transition"
            title="Perkecil (−)"
          >
            <Minus className="w-4 h-4" />
          </button>
        </div>

        {/* Solver Progress Overlay */}
        {solving && (
          <div
            role="status"
            aria-live="polite"
            className="absolute inset-0 bg-slate-950/80 flex flex-col items-center justify-center p-6 text-center z-20"
          >
            <div className="w-11 h-11 rounded-full border-4 border-emerald-400/25 border-t-emerald-400 animate-spin mb-3" />
            <p className="text-sm font-bold text-white mb-1">
              {solverProgress?.title ?? 'Mencari Solusi Optimal...'}
            </p>
            <p className="text-xs text-slate-300 mb-3 max-w-[260px]">
              {solverProgress?.subtitle ?? 'Memindai lintasan pantulan...'}
            </p>
            <div className="w-52 h-2 bg-slate-800 rounded-full overflow-hidden mb-4">
              <div
                className="h-full bg-emerald-400 transition-all duration-150"
                style={{ width: `${solverProgress?.percent ?? 8}%` }}
              />
            </div>
            <button
              type="button"
              onClick={onCancelSolve}
              className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/15 text-xs font-semibold text-rose-300 hover:text-white flex items-center gap-1.5 transition"
            >
              <X className="w-3.5 h-3.5" />
              <span>Batalkan</span>
            </button>
          </div>
        )}

        {/* Victory Banner */}
        {winBounces !== null && (
          <div
            data-testid="win-banner"
            className="pointer-events-none absolute top-14 left-3 right-3 bg-emerald-500 text-slate-950 px-3.5 py-2.5 rounded-2xl shadow-xl flex items-center justify-between z-10"
          >
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-xs font-extrabold tracking-tight leading-none">
                  Level Selesai
                </p>
                <p className="text-[11px] font-semibold text-emerald-950/85 mt-0.5">
                  Semua target tersapu bersih
                </p>
              </div>
            </div>
            <span className="text-xs font-mono font-extrabold bg-slate-950/15 px-2.5 py-1 rounded-lg tabular-nums">
              {winBounces} pantulan
            </span>
          </div>
        )}
      </div>

      <p className="w-full max-w-[420px] lg:max-w-[356px] xl:max-w-[372px] text-[11px] text-slate-400 text-center leading-snug">
        {hintText}
      </p>
    </div>
  );
};
