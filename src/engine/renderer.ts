import {
  AnalyzedSolution,
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
import { polygonBounds, polygonCentroid, normalizeAngleDeg } from './geometry';

export interface RenderState {
  bgColor: string;
  ballRadius: number;
  shapes: Shape[];
  particles: Particle[];
  impacts: ImpactRipple[];
  toolMode: ToolMode;
  showGrid: boolean;
  showRuler: boolean;
  cam: CameraState;
  selectedShapeId: number | null;
  aiming: boolean;
  aimStart: Point;
  aimCurrent: Point;
  aimPreviewSim: SimResult | null;
  simBallPos: Point | null;
  simTrail: Point[];
  showGuide: boolean;
  showSafeZone: boolean;
  showAltPaths: boolean;
  solutionShot: AnalyzedSolution | null;
  solutions: AnalyzedSolution[];
  activeSolutionIdx: number;
  uploadedImage: HTMLImageElement | null;
  uploadedRect: ImageRect;
  showImageOverlay: boolean;
  imageOverlayAlpha: number;
}

export function getRotateHandlePos(shape: Shape, zoom: number): Point {
  const b = polygonBounds(shape.vertices);
  const c = polygonCentroid(shape.vertices);
  return { x: c.x, y: b.minY - 22 / zoom };
}

export function renderScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  state: RenderState,
  timeMs: number
): void {
  const scaleX = width / LOGICAL_W;
  const scaleY = height / LOGICAL_H;
  const zoom = state.cam.zoom;

  // Clear outer backdrop (visible when zoomed out or panned past board edge)
  ctx.save();
  ctx.fillStyle = '#0e1420';
  ctx.fillRect(0, 0, width, height);

  // Base DPR Scale + Camera Zoom/Pan Transform
  ctx.scale(scaleX, scaleY);
  ctx.translate(
    LOGICAL_W * 0.5 + state.cam.panX,
    LOGICAL_H * 0.5 + state.cam.panY
  );
  ctx.scale(zoom, zoom);
  ctx.translate(-LOGICAL_W * 0.5, -LOGICAL_H * 0.5);

  // 1. Playfield Board Background & Subtle Vignette
  ctx.fillStyle = state.bgColor;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  const vig = ctx.createRadialGradient(
    LOGICAL_W * 0.5,
    LOGICAL_H * 0.45,
    60,
    LOGICAL_W * 0.5,
    LOGICAL_H * 0.5,
    LOGICAL_H * 0.75
  );
  vig.addColorStop(0, 'rgba(255,255,255,0.03)');
  vig.addColorStop(1, 'rgba(0,0,0,0.2)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, LOGICAL_W, LOGICAL_H);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.14)';
  ctx.lineWidth = 1.5 / zoom;
  ctx.strokeRect(0, 0, LOGICAL_W, LOGICAL_H);

  // 2. Uploaded Screenshot Overlay (restored!)
  if (state.uploadedImage && state.showImageOverlay && state.imageOverlayAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = state.imageOverlayAlpha;
    const r = state.uploadedRect;
    ctx.drawImage(state.uploadedImage, r.x, r.y, r.w, r.h);
    ctx.restore();
  }

  // 3. Precision Helper Grid Overlay (restored!)
  if (state.showGrid) {
    ctx.save();
    const minorStep = 20;
    const majorStep = 100;

    ctx.beginPath();
    for (let x = minorStep; x < LOGICAL_W; x += minorStep) {
      if (x % majorStep === 0) continue;
      ctx.moveTo(x, 0);
      ctx.lineTo(x, LOGICAL_H);
    }
    for (let y = minorStep; y < LOGICAL_H; y += minorStep) {
      if (y % majorStep === 0) continue;
      ctx.moveTo(0, y);
      ctx.lineTo(LOGICAL_W, y);
    }
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.lineWidth = 1 / zoom;
    ctx.stroke();

    ctx.beginPath();
    for (let x = majorStep; x < LOGICAL_W; x += majorStep) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, LOGICAL_H);
    }
    for (let y = majorStep; y < LOGICAL_H; y += majorStep) {
      ctx.moveTo(0, y);
      ctx.lineTo(LOGICAL_W, y);
    }
    ctx.strokeStyle = 'rgba(56, 189, 248, 0.18)';
    ctx.lineWidth = 1.2 / zoom;
    ctx.stroke();
    ctx.restore();
  }

  // 1B. Subtle Edge Percentage Ticks (25%, 50%, 75%)
  if (state.showRuler) {
    ctx.save();
    ctx.fillStyle = 'rgba(226, 232, 240, 0.42)';
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.28)';
    ctx.lineWidth = 1 / zoom;
    ctx.font = `600 ${8 / Math.sqrt(zoom)}px "JetBrains Mono", monospace`;
    const pcts = [0.25, 0.5, 0.75];
    const tick = 5 / zoom;
    for (const p of pcts) {
      const tx = LOGICAL_W * p;
      const ty = LOGICAL_H * p;
      ctx.beginPath();
      ctx.moveTo(tx, 0);
      ctx.lineTo(tx, tick);
      ctx.moveTo(tx, LOGICAL_H);
      ctx.lineTo(tx, LOGICAL_H - tick);
      ctx.moveTo(0, ty);
      ctx.lineTo(tick, ty);
      ctx.moveTo(LOGICAL_W, ty);
      ctx.lineTo(LOGICAL_W - tick, ty);
      ctx.stroke();

      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(`${Math.round(p * 100)}%`, tx, LOGICAL_H - tick - 2 / zoom);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`${Math.round(p * 100)}%`, tick + 2 / zoom, ty);
    }
    ctx.restore();
  }

  // 4. Render All Board Shapes (Target White Blocks & Black Walls) + Edit Selection Handles (restored!)
  for (const s of state.shapes) {
    if (!s.alive) continue;
    const verts = s.vertices;
    if (verts.length < 3) continue;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) {
      ctx.lineTo(verts[i].x, verts[i].y);
    }
    ctx.closePath();

    // Subtle elevation shadow matching Okay? aesthetic
    ctx.shadowColor = 'rgba(0, 0, 0, 0.26)';
    ctx.shadowBlur = 7;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 3;

    if (s.type === 'target') {
      if (s.passThrough) {
        ctx.shadowColor = 'rgba(255, 255, 255, 0.45)';
        ctx.shadowBlur = 4;
        ctx.shadowOffsetY = 0;
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = 'rgba(186, 230, 253, 0.55)';
        ctx.lineWidth = 0.8 / zoom;
        ctx.stroke();
      } else {
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.shadowColor = 'transparent';
        ctx.strokeStyle = 'rgba(15, 23, 42, 0.14)';
        ctx.lineWidth = 1 / zoom;
        ctx.stroke();
      }
    } else {
      const flashAlpha = s.flash > 0 ? Math.min(1, s.flash) : 0;
      ctx.fillStyle =
        flashAlpha > 0
          ? `rgb(${Math.round(14 + flashAlpha * 70)}, ${Math.round(18 + flashAlpha * 82)}, ${Math.round(26 + flashAlpha * 98)})`
          : '#0e121a';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle =
        flashAlpha > 0
          ? `rgba(148, 163, 184, ${0.4 + flashAlpha * 0.5})`
          : 'rgba(255, 255, 255, 0.12)';
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();
    }

    // Selection outline, vertex markers, and rotation knob in Edit Mode
    if (state.toolMode === 'edit' && s.id === state.selectedShapeId) {
      ctx.shadowColor = 'transparent';
      ctx.strokeStyle = '#f472b6';
      ctx.lineWidth = 2.2 / zoom;
      ctx.stroke();

      // Vertex dots
      for (const v of verts) {
        ctx.beginPath();
        ctx.arc(v.x, v.y, 3.2 / Math.sqrt(zoom), 0, Math.PI * 2);
        ctx.fillStyle = '#f472b6';
        ctx.fill();
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1 / zoom;
        ctx.stroke();
      }

      // Rotation stem & green handle knob above shape
      const b = polygonBounds(verts);
      const c = polygonCentroid(verts);
      const handle = getRotateHandlePos(s, zoom);

      ctx.beginPath();
      ctx.moveTo(c.x, b.minY);
      ctx.lineTo(handle.x, handle.y);
      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 1.6 / zoom;
      ctx.setLineDash([3 / zoom, 2 / zoom]);
      ctx.stroke();
      ctx.setLineDash([]);

      ctx.beginPath();
      ctx.arc(handle.x, handle.y, 7 / Math.sqrt(zoom), 0, Math.PI * 2);
      ctx.fillStyle = '#10b981';
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6 / zoom;
      ctx.stroke();

      // Tiny rotation arc icon inside knob
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, 3.2 / Math.sqrt(zoom), 0.4, Math.PI * 1.65);
      ctx.strokeStyle = '#022c22';
      ctx.lineWidth = 1.3 / Math.sqrt(zoom);
      ctx.stroke();
    }

    ctx.restore();
  }

  // 5. Solution Guide Trajectory + Safe Zone + Alternative Ghost Paths
  if (state.solutionShot && state.showGuide && state.toolMode !== 'edit') {
    ctx.save();
    if (state.aiming) {
      ctx.globalAlpha = 0.25;
    }
    // 5A. Ghost Preview of Alternative Solutions
    if (state.showAltPaths && state.solutions.length > 1) {
      ctx.save();
      state.solutions.forEach((alt, idx) => {
        if (idx === state.activeSolutionIdx) return;
        const apts = alt.simResult.points;
        ctx.beginPath();
        for (let i = 0; i < apts.length; i++) {
          if (i === 0) ctx.moveTo(apts[i].x, apts[i].y);
          else ctx.lineTo(apts[i].x, apts[i].y);
        }
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.34)';
        ctx.lineWidth = 1.5 / zoom;
        ctx.setLineDash([4 / zoom, 6 / zoom]);
        ctx.stroke();
        ctx.setLineDash([]);

        ctx.beginPath();
        ctx.arc(alt.sx, alt.sy, 7.5 / Math.sqrt(zoom), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.75)';
        ctx.lineWidth = 1.2 / zoom;
        ctx.stroke();

        ctx.fillStyle = '#e2e8f0';
        ctx.font = `700 ${7.5 / Math.sqrt(zoom)}px "Plus Jakarta Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(idx + 1), alt.sx, alt.sy + 0.5 / zoom);
      });
      ctx.restore();
    }

    const sol = state.solutionShot;
    const pts = sol.simResult.points;
    const mainColor = sol.solved ? '#34d399' : '#fbbf24';

    ctx.save();

    // 5B. Safe Aiming Cone & Finger Tolerance Halo (Zona Aman)
    if (state.showSafeZone && sol.analysis && sol.solved) {
      const tolRad = Math.max(0.008, (sol.analysis.angleTolDeg * Math.PI) / 180);
      const coneLen = Math.min(130, 75 / Math.sqrt(zoom) + 38);

      ctx.beginPath();
      ctx.moveTo(sol.sx, sol.sy);
      ctx.arc(sol.sx, sol.sy, coneLen, sol.angle - tolRad, sol.angle + tolRad);
      ctx.closePath();
      ctx.fillStyle = 'rgba(52, 211, 153, 0.22)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(52, 211, 153, 0.58)';
      ctx.lineWidth = 1 / zoom;
      ctx.stroke();

      if (sol.analysis.posTolPx >= 1.2) {
        ctx.beginPath();
        ctx.arc(sol.sx, sol.sy, Math.min(26, sol.analysis.posTolPx), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(56, 189, 248, 0.16)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(56, 189, 248, 0.58)';
        ctx.lineWidth = 1.1 / zoom;
        ctx.setLineDash([3 / zoom, 3 / zoom]);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // High-contrast dark halo under dashed path
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      if (i === 0) ctx.moveTo(pts[i].x, pts[i].y);
      else ctx.lineTo(pts[i].x, pts[i].y);
    }
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.48)';
    ctx.lineWidth = 4.2 / zoom;
    ctx.stroke();

    ctx.strokeStyle = sol.solved
      ? 'rgba(52, 211, 153, 0.92)'
      : 'rgba(251, 191, 36, 0.92)';
    ctx.lineWidth = 2.0 / zoom;
    ctx.setLineDash([6 / zoom, 5 / zoom]);
    ctx.stroke();
    ctx.setLineDash([]);

    // Numbered bounce markers
    const maxLabels = zoom >= 1.4 ? pts.length - 1 : Math.min(pts.length - 1, 10);
    for (let i = 1; i < pts.length - 1; i++) {
      const p = pts[i];
      if (i <= maxLabels) {
        const r = 6.2 / Math.sqrt(zoom);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = '#0f172a';
        ctx.fill();
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 1.4 / zoom;
        ctx.stroke();

        ctx.fillStyle = '#ffffff';
        ctx.font = `700 ${Math.max(6.5, 7.8 / Math.sqrt(zoom))}px "Plus Jakarta Sans", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(i), p.x, p.y + 0.5 / zoom);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 2.6 / Math.sqrt(zoom), 0, Math.PI * 2);
        ctx.fillStyle = mainColor;
        ctx.fill();
      }
    }

    // Pulsing Start Circle + Crisp Direction Arrow
    const pulse = 1 + Math.sin(timeMs * 0.006) * 0.16;
    ctx.beginPath();
    ctx.arc(sol.sx, sol.sy, (14 / Math.sqrt(zoom)) * pulse, 0, Math.PI * 2);
    ctx.strokeStyle = mainColor;
    ctx.lineWidth = 2 / zoom;
    ctx.stroke();

    const arrowLen = 46 / Math.sqrt(zoom);
    const ax = sol.sx + Math.cos(sol.angle) * arrowLen;
    const ay = sol.sy + Math.sin(sol.angle) * arrowLen;
    ctx.beginPath();
    ctx.moveTo(sol.sx, sol.sy);
    ctx.lineTo(ax, ay);
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 5.5 / zoom;
    ctx.stroke();
    ctx.strokeStyle = mainColor;
    ctx.lineWidth = 3 / zoom;
    ctx.stroke();

    const headLen = 10 / Math.sqrt(zoom);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(
      ax - headLen * Math.cos(sol.angle - 0.45),
      ay - headLen * Math.sin(sol.angle - 0.45)
    );
    ctx.lineTo(
      ax - headLen * Math.cos(sol.angle + 0.45),
      ay - headLen * Math.sin(sol.angle + 0.45)
    );
    ctx.closePath();
    ctx.fillStyle = mainColor;
    ctx.fill();

    // Start Dot
    ctx.beginPath();
    ctx.arc(sol.sx, sol.sy, state.ballRadius, 0, Math.PI * 2);
    ctx.fillStyle = sol.solved ? '#10b981' : '#f59e0b';
    ctx.fill();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.8 / zoom;
    ctx.stroke();

    ctx.restore();
    ctx.restore();
  }

  // 6. Live Real-Time Multi-Bounce Aim Prediction
  if (state.aiming && state.toolMode === 'play') {
    const dx = state.aimCurrent.x - state.aimStart.x;
    const dy = state.aimCurrent.y - state.aimStart.y;
    const dist = Math.hypot(dx, dy);
    const sim = state.aimPreviewSim;

    ctx.save();

    if (dist > 6 / zoom && sim && sim.points.length >= 2) {
      const ang = Math.atan2(dy, dx);
      const isSolved = sim.solved;
      const hitsAnyTarget = sim.targetsHit > 0;
      const beamColor = isSolved
        ? '#34d399'
        : hitsAnyTarget
          ? '#38bdf8'
          : 'rgba(241, 245, 249, 0.88)';
      const glowColor = isSolved
        ? 'rgba(52, 211, 153, 0.32)'
        : hitsAnyTarget
          ? 'rgba(56, 189, 248, 0.26)'
          : 'rgba(15, 23, 42, 0.45)';

      // 6A. Highlight targets that will be destroyed along this predicted shot
      const predictedTargetIds = new Set(
        sim.hitEvents.filter((ev) => ev.type === 'target').map((ev) => ev.shapeId)
      );
      if (predictedTargetIds.size > 0) {
        for (const s of state.shapes) {
          if (!s.alive || !predictedTargetIds.has(s.id) || s.vertices.length < 3) continue;
          ctx.beginPath();
          ctx.moveTo(s.vertices[0].x, s.vertices[0].y);
          for (let i = 1; i < s.vertices.length; i++) {
            ctx.lineTo(s.vertices[i].x, s.vertices[i].y);
          }
          ctx.closePath();
          ctx.strokeStyle = isSolved ? '#34d399' : '#38bdf8';
          ctx.lineWidth = 3.2 / zoom;
          ctx.shadowColor = isSolved ? 'rgba(52, 211, 153, 0.7)' : 'rgba(56, 189, 248, 0.65)';
          ctx.shadowBlur = 10 / zoom;
          ctx.stroke();
          ctx.shadowColor = 'transparent';
        }
      }

      // 6B. Full multi-bounce predicted trajectory with animated marching dashes
      const pts = sim.points;
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(15, 23, 42, 0.55)';
      ctx.lineWidth = 4.6 / zoom;
      ctx.stroke();

      ctx.strokeStyle = glowColor;
      ctx.lineWidth = 7 / zoom;
      ctx.stroke();

      ctx.strokeStyle = beamColor;
      ctx.lineWidth = 2.2 / zoom;
      ctx.setLineDash([7 / zoom, 5 / zoom]);
      ctx.lineDashOffset = -(timeMs * 0.04) / zoom;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.lineDashOffset = 0;

      // 6C. Bounce markers (targets highlighted larger, walls subtle crisp dots)
      const maxMarkers = Math.min(sim.hitEvents.length, 28);
      for (let i = 0; i < maxMarkers; i++) {
        const ev = sim.hitEvents[i];
        const isTgt = ev.type === 'target';
        const r = (isTgt ? 5.2 : 3.0) / Math.sqrt(zoom);
        ctx.beginPath();
        ctx.arc(ev.hitX, ev.hitY, r, 0, Math.PI * 2);
        ctx.fillStyle = isTgt ? (isSolved ? '#10b981' : '#0ea5e9') : '#0f172a';
        ctx.fill();
        ctx.strokeStyle = isTgt ? '#ffffff' : beamColor;
        ctx.lineWidth = (isTgt ? 1.5 : 1.2) / zoom;
        ctx.stroke();

        if (isTgt && i < 12) {
          ctx.fillStyle = '#ffffff';
          ctx.font = `700 ${Math.max(6, 7 / Math.sqrt(zoom))}px "Plus Jakarta Sans", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(i + 1), ev.hitX, ev.hitY + 0.4 / zoom);
        }
      }

      // 6D. Subtle drag tether from start ball to pointer
      ctx.beginPath();
      ctx.moveTo(state.aimStart.x, state.aimStart.y);
      ctx.lineTo(state.aimCurrent.x, state.aimCurrent.y);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
      ctx.lineWidth = 1.2 / zoom;
      ctx.stroke();

      // 6E. Live angle + target prediction HUD pill near cursor (clamped inside stage)
      const deg = normalizeAngleDeg(ang);
      const hitLabel = isSolved
        ? `${sim.targetsHit}/${sim.totalTargets} OK!`
        : `${sim.targetsHit}/${sim.totalTargets}`;
      const labelText = `${deg.toFixed(1)}° · ${hitLabel}`;
      const fontSize = 9.5 / zoom;
      ctx.font = `700 ${fontSize}px "JetBrains Mono", monospace`;
      const textW = ctx.measureText(labelText).width;
      const padX = 7 / zoom;
      const boxW = textW + padX * 2;
      const boxH = 20 / zoom;
      let bx = state.aimCurrent.x + 12 / zoom;
      let by = state.aimCurrent.y - 24 / zoom;
      if (bx + boxW > LOGICAL_W - 6) bx = state.aimCurrent.x - boxW - 12 / zoom;
      if (bx < 6) bx = 6;
      if (by < 6) by = state.aimCurrent.y + 14 / zoom;
      if (by + boxH > LOGICAL_H - 6) by = LOGICAL_H - boxH - 6;

      ctx.fillStyle = isSolved ? 'rgba(6, 78, 59, 0.94)' : 'rgba(15, 23, 42, 0.92)';
      ctx.fillRect(bx, by, boxW, boxH);
      ctx.strokeStyle = isSolved
        ? 'rgba(52, 211, 153, 0.85)'
        : hitsAnyTarget
          ? 'rgba(56, 189, 248, 0.7)'
          : 'rgba(148, 163, 184, 0.45)';
      ctx.lineWidth = 1.2 / zoom;
      ctx.strokeRect(bx, by, boxW, boxH);

      ctx.fillStyle = isSolved ? '#6ee7b7' : hitsAnyTarget ? '#7dd3fc' : '#e2e8f0';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, bx + boxW * 0.5, by + boxH * 0.5);
    }

    // Glowing start ball dot
    ctx.beginPath();
    ctx.arc(state.aimStart.x, state.aimStart.y, state.ballRadius, 0, Math.PI * 2);
    ctx.fillStyle = sim?.solved ? '#34d399' : '#ffffff';
    ctx.shadowColor = sim?.solved ? 'rgba(52, 211, 153, 0.7)' : 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.2 / zoom;
    ctx.stroke();

    ctx.restore();
  }

  // 7. Active Ball Trail & Active Ball (restored & syntax-fixed!)
  if (state.simTrail.length > 1) {
    ctx.save();
    for (let i = 1; i < state.simTrail.length; i++) {
      const frac = i / state.simTrail.length;
      ctx.beginPath();
      ctx.moveTo(state.simTrail[i - 1].x, state.simTrail[i - 1].y);
      ctx.lineTo(state.simTrail[i].x, state.simTrail[i].y);
      ctx.strokeStyle = `rgba(255, 255, 255, ${frac * 0.48})`;
      ctx.lineWidth = state.ballRadius * 1.45 * frac;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
    ctx.restore();
  }

  if (state.simBallPos) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(state.simBallPos.x, state.simBallPos.y, state.ballRadius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(16, 185, 129, 0.55)';
    ctx.shadowBlur = 10;
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.25)';
    ctx.lineWidth = 1 / zoom;
    ctx.stroke();
    ctx.restore();
  }

  // 8. Impact Ripples & Burst Particles
  for (const imp of state.impacts) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, imp.alpha);
    ctx.beginPath();
    ctx.arc(imp.x, imp.y, imp.r, 0, Math.PI * 2);
    ctx.strokeStyle = imp.color;
    ctx.lineWidth = 2 / zoom;
    ctx.stroke();
    ctx.restore();
  }

  for (const p of state.particles) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, p.alpha);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size * 0.5, p.y - p.size * 0.5, p.size, p.size);
    ctx.restore();
  }

  ctx.restore();
}
