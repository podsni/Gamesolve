import {
  AnalyzedSolution,
  BALL_SPEED_NORMAL,
  CameraState,
  ImageRect,
  ImpactRipple,
  LOGICAL_H,
  LOGICAL_W,
  Particle,
  Point,
  Shape,
  SimResult,
  ToolMode,
} from './types';
import { polygonCentroid } from './geometry';
import { audioEngine } from './audio';
import { RenderState } from './renderer';

export interface EngineCallbacks {
  onHudChange: (alive: number, total: number) => void;
  onZoomChange: (zoomPercent: number) => void;
  onWin: (bounces: number) => void;
  onWinClear: () => void;
  onSelectShape: (shapeId: number | null) => void;
  onShapeMutated: () => void;
  onManualShot: (sim: SimResult) => void;
  onSelectAltSolution: (index: number) => void;
  onToast: (message: string) => void;
}

export class OkayEngineController {
  public bgColor = '#3f4957';
  public ballRadius = 5.5;
  public shapes: Shape[] = [];
  public particles: Particle[] = [];
  public impacts: ImpactRipple[] = [];

  public toolMode: ToolMode = 'play';
  public showGrid = false;
  public showRuler = true;
  public snapToGrid = false;

  public cam: CameraState = {
    zoom: 1.0,
    panX: 0,
    panY: 0,
    minZoom: 0.75,
    maxZoom: 4.5,
  };

  public selectedShapeId: number | null = null;

  public aiming = false;
  public aimStart: Point = { x: 0, y: 0 };
  public aimCurrent: Point = { x: 0, y: 0 };
  public aimPreviewSim: SimResult | null = null;

  public simPlaying = false;
  public simPath: SimResult | null = null;
  public simSegmentIdx = 0;
  public simSegmentDist = 0;
  public simBallPos: Point | null = null;
  public simTrail: Point[] = [];
  public slowMo = false;
  public showGuide = true;
  public showSafeZone = true;
  public showAltPaths = false;
  public restoreTimer: ReturnType<typeof setTimeout> | null = null;

  public solutionShot: AnalyzedSolution | null = null;
  public solutions: AnalyzedSolution[] = [];
  public activeSolutionIdx = -1;
  public solving = false;
  public cancelSolveFlag = false;

  public uploadedImage: HTMLImageElement | null = null;
  public uploadedImageDataUrl: string | null = null;
  public uploadedRect: ImageRect = { x: 0, y: 0, w: LOGICAL_W, h: LOGICAL_H };
  public showImageOverlay = true;
  public imageOverlayAlpha = 0.35;
  public detectSensitivity = 36;
  public ignoreStatusBars = true;
  public swapTargetWall = false;

  public hitCombo = 0;
  private nextShapeId = 1;
  public callbacks: EngineCallbacks;

  constructor(callbacks: EngineCallbacks) {
    this.callbacks = callbacks;
  }

  public allocateId = (): number => {
    return this.nextShapeId++;
  };

  public syncNextShapeId(): void {
    let maxId = 0;
    for (const s of this.shapes) {
      if (s.id > maxId) maxId = s.id;
    }
    this.nextShapeId = Math.max(this.nextShapeId, maxId + 1);
  }

  public getRenderState(): RenderState {
    return {
      bgColor: this.bgColor,
      ballRadius: this.ballRadius,
      shapes: this.shapes,
      particles: this.particles,
      impacts: this.impacts,
      toolMode: this.toolMode,
      showGrid: this.showGrid,
      showRuler: this.showRuler,
      cam: this.cam,
      selectedShapeId: this.selectedShapeId,
      aiming: this.aiming,
      aimStart: this.aimStart,
      aimCurrent: this.aimCurrent,
      aimPreviewSim: this.aimPreviewSim,
      simBallPos: this.simBallPos,
      simTrail: this.simTrail,
      showGuide: this.showGuide,
      showSafeZone: this.showSafeZone,
      showAltPaths: this.showAltPaths,
      solutionShot: this.solutionShot,
      solutions: this.solutions,
      activeSolutionIdx: this.activeSolutionIdx,
      uploadedImage: this.uploadedImage,
      uploadedRect: this.uploadedRect,
      showImageOverlay: this.showImageOverlay,
      imageOverlayAlpha: this.imageOverlayAlpha,
    };
  }

  public clampCamera(): void {
    const c = this.cam;
    c.zoom = Math.max(c.minZoom, Math.min(c.maxZoom, c.zoom));
    const maxPanX = LOGICAL_W * c.zoom * 0.65;
    const maxPanY = LOGICAL_H * c.zoom * 0.65;
    c.panX = Math.max(-maxPanX, Math.min(maxPanX, c.panX));
    c.panY = Math.max(-maxPanY, Math.min(maxPanY, c.panY));
    this.callbacks.onZoomChange(Math.round(c.zoom * 100));
  }

  public zoomAtStagePoint(newZoom: number, stageX: number, stageY: number): void {
    const c = this.cam;
    const clampedZoom = Math.max(c.minZoom, Math.min(c.maxZoom, newZoom));
    const lx = (stageX - LOGICAL_W * 0.5 - c.panX) / c.zoom + LOGICAL_W * 0.5;
    const ly = (stageY - LOGICAL_H * 0.5 - c.panY) / c.zoom + LOGICAL_H * 0.5;
    c.zoom = clampedZoom;
    c.panX = stageX - LOGICAL_W * 0.5 - (lx - LOGICAL_W * 0.5) * c.zoom;
    c.panY = stageY - LOGICAL_H * 0.5 - (ly - LOGICAL_H * 0.5) * c.zoom;
    this.clampCamera();
  }

  public resetCamera(): void {
    this.cam.zoom = 1.0;
    this.cam.panX = 0;
    this.cam.panY = 0;
    this.clampCamera();
  }

  public focusCameraOnSolutionStart(): void {
    if (!this.solutionShot) return;
    const sol = this.solutionShot;
    const focusX = sol.sx + Math.cos(sol.angle) * 28;
    const focusY = sol.sy + Math.sin(sol.angle) * 28;
    const targetZoom = 2.15;
    this.cam.zoom = targetZoom;
    this.cam.panX = -(focusX - LOGICAL_W * 0.5) * targetZoom;
    this.cam.panY = -(focusY - LOGICAL_H * 0.5) * targetZoom;
    this.clampCamera();
  }

  public emitHudCounts(): void {
    let total = 0;
    let alive = 0;
    for (const s of this.shapes) {
      if (s.type === 'target') {
        total++;
        if (s.alive) alive++;
      }
    }
    this.callbacks.onHudChange(alive, total);
  }

  public stopSimulation(restoreShapes = true): void {
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
    this.simPlaying = false;
    this.simPath = null;
    this.simBallPos = null;
    this.simTrail = [];
    this.aimPreviewSim = null;
    this.impacts = [];
    this.hitCombo = 0;
    this.callbacks.onWinClear();
    if (restoreShapes) {
      for (const s of this.shapes) {
        s.alive = true;
        s.flash = 0;
      }
    }
    this.emitHudCounts();
  }

  public launchSimulation(simResult: SimResult): void {
    this.stopSimulation(true);
    this.simPath = simResult;
    this.simPlaying = true;
    this.simSegmentIdx = 0;
    this.simSegmentDist = 0;
    this.simBallPos = {
      x: simResult.points[0].x,
      y: simResult.points[0].y,
    };
    this.simTrail = [
      { x: simResult.points[0].x, y: simResult.points[0].y },
    ];
    this.hitCombo = 0;
  }

  private spawnBurstParticles(shape: Shape): void {
    const c = polygonCentroid(shape.vertices);
    const color = shape.type === 'target' ? '#ffffff' : '#94a3b8';
    for (let i = 0; i < 12; i++) {
      const ang = (Math.PI * 2 * i) / 12 + (Math.random() - 0.5) * 0.4;
      const spd = 60 + Math.random() * 130;
      this.particles.push({
        x: c.x + (Math.random() - 0.5) * 14,
        y: c.y + (Math.random() - 0.5) * 14,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: 2.2 + Math.random() * 3,
        alpha: 1,
        color,
      });
    }
  }

  public step(dt: number): void {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.94;
      p.vy *= 0.94;
      p.alpha -= dt * 2.5;
      if (p.alpha <= 0) this.particles.splice(i, 1);
    }

    for (const s of this.shapes) {
      if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 4);
    }

    for (let i = this.impacts.length - 1; i >= 0; i--) {
      const imp = this.impacts[i];
      imp.r += dt * 70;
      imp.alpha -= dt * 3.2;
      if (imp.alpha <= 0) this.impacts.splice(i, 1);
    }

    if (!this.simPlaying || !this.simPath) return;

    const speed = this.slowMo ? BALL_SPEED_NORMAL * 0.36 : BALL_SPEED_NORMAL;
    let distToAdvance = speed * dt;
    const pts = this.simPath.points;

    while (distToAdvance > 0 && this.simSegmentIdx < pts.length - 1) {
      const a = pts[this.simSegmentIdx];
      const b = pts[this.simSegmentIdx + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      const remaining = segLen - this.simSegmentDist;

      if (distToAdvance < remaining) {
        this.simSegmentDist += distToAdvance;
        const frac = segLen > 1e-6 ? this.simSegmentDist / segLen : 0;
        this.simBallPos = {
          x: a.x + (b.x - a.x) * frac,
          y: a.y + (b.y - a.y) * frac,
        };
        distToAdvance = 0;
      } else {
        distToAdvance -= remaining;
        this.simSegmentIdx++;
        this.simSegmentDist = 0;
        this.simBallPos = { x: b.x, y: b.y };

        const hitEv = this.simPath.hitEvents.find(
          (ev) => ev.pointIdx === this.simSegmentIdx
        );
        if (hitEv) {
          const shape = this.shapes.find((s) => s.id === hitEv.shapeId);
          if (shape) {
            this.impacts.push({
              x: hitEv.hitX,
              y: hitEv.hitY,
              r: this.ballRadius * 0.9,
              alpha: 0.9,
              color: shape.type === 'target' ? '#34d399' : '#94a3b8',
            });
            if (shape.type === 'target' && shape.alive) {
              shape.alive = false;
              this.spawnBurstParticles(shape);
              audioEngine.playTargetNote(this.hitCombo++);
              this.emitHudCounts();
            } else if (shape.type === 'wall') {
              shape.flash = 1;
              audioEngine.playWallThud();
            }
          }
        }
      }
    }

    if (this.simBallPos) {
      this.simTrail.push({ x: this.simBallPos.x, y: this.simBallPos.y });
      if (this.simTrail.length > 26) this.simTrail.shift();
    }

    if (this.simSegmentIdx >= pts.length - 1) {
      this.simPlaying = false;
      if (this.simPath.solved) {
        audioEngine.playWinChord();
        this.callbacks.onWin(this.simPath.bounces);
      } else {
        if (this.restoreTimer) clearTimeout(this.restoreTimer);
        this.restoreTimer = setTimeout(() => {
          this.restoreTimer = null;
          if (!this.simPlaying && !this.aiming && !this.solving) {
            for (const s of this.shapes) s.alive = true;
            this.simBallPos = null;
            this.simTrail = [];
            this.emitHudCounts();
          }
        }, 650);
      }
    }
  }

  public dispose(): void {
    if (this.restoreTimer) {
      clearTimeout(this.restoreTimer);
      this.restoreTimer = null;
    }
  }
}
