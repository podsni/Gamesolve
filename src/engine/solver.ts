import {
  AnalyzedSolution,
  EaseTier,
  LOGICAL_H,
  LOGICAL_W,
  Point,
  Shape,
  SimResult,
  SolverProgress,
} from './types';
import {
  cloneShape,
  distPointToSegmentSq,
  normalizeAngleDeg,
  polygonCentroid,
} from './geometry';
import {
  castCircleAgainstShapes,
  isPointClearOfShapes,
  simulateShot,
} from './physics';

export interface Stage1Candidate {
  contactX: number;
  contactY: number;
  angle: number;
}

export function getSolutionSignature(sim: SimResult): string {
  const firstHits = sim.hitEvents
    .slice(0, 3)
    .map((e) => e.shapeId)
    .join('-');
  const angBucket = Math.round(normalizeAngleDeg(sim.angle) / 14);
  const posBucket = `${Math.round(sim.sx / 55)}_${Math.round(sim.sy / 55)}`;
  return `${firstHits}|${angBucket}|${posBucket}`;
}

export function analyzeAndCenterSolution(
  sim: SimResult,
  shapes: Shape[],
  ballRadius: number
): AnalyzedSolution {
  let sx = sim.sx;
  let sy = sim.sy;
  let angle = sim.angle;
  const requireSolved = sim.solved;
  const minHits = sim.targetsHit;

  const isStillGood = (testSim: SimResult) =>
    requireSolved ? testSim.solved : testSim.targetsHit >= minHits;

  // 1. Measure angular tolerance window (up to ±6.0° in 0.12° steps)
  const angStep = (0.12 * Math.PI) / 180;
  const maxAngSteps = 50;
  let negAngSteps = 0;
  for (let k = 1; k <= maxAngSteps; k++) {
    if (isStillGood(simulateShot(sx, sy, angle - k * angStep, shapes, ballRadius, false))) {
      negAngSteps = k;
    } else {
      break;
    }
  }
  let posAngSteps = 0;
  for (let k = 1; k <= maxAngSteps; k++) {
    if (isStillGood(simulateShot(sx, sy, angle + k * angStep, shapes, ballRadius, false))) {
      posAngSteps = k;
    } else {
      break;
    }
  }

  // Re-center angle at exact midpoint of the safe cone
  const centeredAngle = angle + (posAngSteps - negAngSteps) * 0.5 * angStep;
  const verifyCenteredAng = simulateShot(sx, sy, centeredAngle, shapes, ballRadius, false);
  if (isStillGood(verifyCenteredAng)) {
    angle = centeredAngle;
  }
  const angleTolDeg = Math.max(0.05, (negAngSteps + posAngSteps) * 0.5 * 0.12);

  // 2. Measure perpendicular finger-placement tolerance (up to ±20px in 1.0px steps)
  const perpX = -Math.sin(angle);
  const perpY = Math.cos(angle);
  const posStep = 1.0;
  const maxPosSteps = 20;
  let negPosSteps = 0;
  for (let k = 1; k <= maxPosSteps; k++) {
    const tx = sx - perpX * (k * posStep);
    const ty = sy - perpY * (k * posStep);
    if (tx < 8 || tx > LOGICAL_W - 8 || ty < 8 || ty > LOGICAL_H - 8) break;
    if (!isPointClearOfShapes(tx, ty, shapes, ballRadius)) break;
    if (isStillGood(simulateShot(tx, ty, angle, shapes, ballRadius, false))) {
      negPosSteps = k;
    } else {
      break;
    }
  }
  let posPosSteps = 0;
  for (let k = 1; k <= maxPosSteps; k++) {
    const tx = sx + perpX * (k * posStep);
    const ty = sy + perpY * (k * posStep);
    if (tx < 8 || tx > LOGICAL_W - 8 || ty < 8 || ty > LOGICAL_H - 8) break;
    if (!isPointClearOfShapes(tx, ty, shapes, ballRadius)) break;
    if (isStillGood(simulateShot(tx, ty, angle, shapes, ballRadius, false))) {
      posPosSteps = k;
    } else {
      break;
    }
  }

  // Re-center spawn point at midpoint of safe corridor
  const shiftPerp = (posPosSteps - negPosSteps) * 0.5 * posStep;
  const centeredSx = sx + perpX * shiftPerp;
  const centeredSy = sy + perpY * shiftPerp;
  let finalSim = simulateShot(sx, sy, angle, shapes, ballRadius, false);
  if (isPointClearOfShapes(centeredSx, centeredSy, shapes, ballRadius)) {
    const centeredSim = simulateShot(centeredSx, centeredSy, angle, shapes, ballRadius, false);
    if (isStillGood(centeredSim)) {
      sx = centeredSx;
      sy = centeredSy;
      finalSim = centeredSim;
    }
  }
  const posTolPx = Math.max(0.5, (negPosSteps + posPosSteps) * 0.5 * posStep);

  // 3. Measure spawn clearance
  let nearestDistSq = Infinity;
  for (const sh of shapes) {
    for (let i = 0; i < sh.vertices.length; i++) {
      const a = sh.vertices[i];
      const b = sh.vertices[(i + 1) % sh.vertices.length];
      const dSq = distPointToSegmentSq(sx, sy, a.x, a.y, b.x, b.y);
      if (dSq < nearestDistSq) nearestDistSq = dSq;
    }
  }
  const spawnClearance = Math.min(80, Math.sqrt(nearestDistSq));

  // 4. Measure visual aiming alignment
  const deg = normalizeAngleDeg(angle);
  const distTo90 = Math.min(deg % 90, 90 - (deg % 90));
  const distTo45 = Math.min(deg % 45, 45 - (deg % 45));
  const isStraight = distTo90 <= 3.5;
  const isDiagonal45 = !isStraight && distTo45 <= 3.5;

  // 5. Weighted Ease Score (0–100)
  const angScore = Math.min(40, (Math.log1p(angleTolDeg * 2.2) / Math.log1p(9)) * 40);
  const posScore = Math.min(28, (Math.log1p(posTolPx * 0.7) / Math.log1p(12)) * 28);
  const clearScore = Math.min(12, (spawnClearance / 45) * 12);
  const alignScore = isStraight
    ? 10
    : isDiagonal45
      ? 7
      : Math.max(0, 4 - distTo45 * 0.18);
  const extraBounces = Math.max(0, finalSim.bounces - finalSim.totalTargets);
  const bounceScore = Math.max(0, 10 - extraBounces * 1.1);

  let easeScore = Math.round(
    angScore + posScore + clearScore + alignScore + bounceScore
  );
  if (!finalSim.solved) {
    easeScore = Math.min(
      55,
      Math.round(easeScore * (finalSim.targetsHit / Math.max(1, finalSim.totalTargets)))
    );
  }
  easeScore = Math.max(5, Math.min(99, easeScore));

  let tier: EaseTier = 'precise';
  let tierLabel = 'Presisi Tinggi';
  if (easeScore >= 78) {
    tier = 'very-easy';
    tierLabel = 'Sangat Mudah';
  } else if (easeScore >= 60) {
    tier = 'easy';
    tierLabel = 'Mudah';
  } else if (easeScore >= 42) {
    tier = 'medium';
    tierLabel = 'Sedang';
  }

  const hints: string[] = [];
  if (isStraight) {
    hints.push('arah tembakan nyaris lurus vertikal/horizontal sehingga mudah dibidik mata');
  } else if (isDiagonal45) {
    hints.push('menggunakan sudut diagonal 45° yang rapi');
  }
  if (angleTolDeg >= 1.0) {
    hints.push(`toleransi meleset sudut lebar (±${angleTolDeg.toFixed(2)}°)`);
  } else if (angleTolDeg >= 0.4) {
    hints.push(`toleransi sudut cukup aman (±${angleTolDeg.toFixed(2)}°)`);
  } else {
    hints.push(`butuh tarikan garis yang stabil (±${angleTolDeg.toFixed(2)}°)`);
  }
  if (posTolPx >= 5) {
    hints.push(`ruang posisi jari longgar (±${posTolPx.toFixed(1)} px)`);
  }
  if (spawnClearance >= 26) {
    hints.push('titik sentuh awal berada di ruang terbuka');
  }

  const reasonText = finalSim.solved
    ? `Tembakan sudah dipusatkan di tengah zona aman: ${hints.join(', ')}.`
    : `Solusi parsial (${finalSim.targetsHit}/${finalSim.totalTargets} target). Geser sedikit di Kalibrasi Presisi atau sesuaikan balok di tab Atur Posisi.`;

  return {
    sx,
    sy,
    angle,
    simResult: finalSim,
    solved: finalSim.solved,
    analysis: {
      easeScore,
      angleTolDeg,
      posTolPx,
      spawnClearance,
      isStraight,
      isDiagonal45,
      tier,
      tierLabel,
      reasonText,
    },
    badges: [],
  };
}

export function findComfortableSpawn(
  hitX: number,
  hitY: number,
  angleRad: number,
  shapes: Shape[],
  ballRadius: number
): Point | null {
  const R = ballRadius;
  const backDx = -Math.cos(angleRad);
  const backDy = -Math.sin(angleRad);
  const startX = hitX + backDx * 0.6;
  const startY = hitY + backDy * 0.6;
  const backHit = castCircleAgainstShapes(
    startX,
    startY,
    backDx,
    backDy,
    shapes,
    null,
    R + 0.12
  );

  const pad = 22;
  let tMargin = 500;
  if (backDx > 1e-6) tMargin = Math.min(tMargin, (LOGICAL_W - pad - startX) / backDx);
  else if (backDx < -1e-6) tMargin = Math.min(tMargin, (pad - startX) / backDx);
  if (backDy > 1e-6) tMargin = Math.min(tMargin, (LOGICAL_H - pad - startY) / backDy);
  else if (backDy < -1e-6) tMargin = Math.min(tMargin, (pad - startY) / backDy);

  const maxClear = Math.min(backHit ? backHit.t - 1.2 : 500, tMargin);
  if (maxClear < 2.0) return null;

  const preferred =
    maxClear > 200 ? Math.min(maxClear * 0.68, 220) : maxClear * 0.55;
  const candX = startX + backDx * preferred;
  const candY = startY + backDy * preferred;

  if (
    candX >= 10 &&
    candX <= LOGICAL_W - 10 &&
    candY >= 10 &&
    candY <= LOGICAL_H - 10 &&
    isPointClearOfShapes(candX, candY, shapes, R)
  ) {
    return { x: candX, y: candY };
  }
  const mid = maxClear * 0.5;
  const mx = startX + backDx * mid;
  const my = startY + backDy * mid;
  if (
    mx >= 10 &&
    mx <= LOGICAL_W - 10 &&
    my >= 10 &&
    my <= LOGICAL_H - 10 &&
    isPointClearOfShapes(mx, my, shapes, R)
  ) {
    return { x: mx, y: my };
  }
  return null;
}

export function buildStage1Candidates(
  shapes: Shape[],
  ballRadius: number
): Stage1Candidate[] {
  const R = ballRadius;
  const candidates: Stage1Candidate[] = [];
  const principalAngles = [0, 45, 90, 135, 180, 225, 270, 315].map(
    (d) => (d * Math.PI) / 180
  );

  const orderedIndices = [
    ...shapes
      .map((s, i) => ({ s, i }))
      .filter((o) => o.s.type === 'target')
      .map((o) => o.i),
    ...shapes
      .map((s, i) => ({ s, i }))
      .filter((o) => o.s.type === 'wall')
      .map((o) => o.i),
  ];

  const targetCount = shapes.filter((s) => s.type === 'target').length;
  const sparseTargets = targetCount > 0 && targetCount <= 4;

  for (const sIdx of orderedIndices) {
    const isTarget = shapes[sIdx].type === 'target';
    const verts = shapes[sIdx].vertices;
    const n = verts.length;
    const cent = polygonCentroid(verts);

    for (let i = 0; i < n; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % n];
      const ex = b.x - a.x;
      const ey = b.y - a.y;
      const len = Math.hypot(ex, ey);
      if (len < 6) continue;

      let nx = -ey / len;
      let ny = ex / len;
      const midX = (a.x + b.x) * 0.5;
      const midY = (a.y + b.y) * 0.5;
      if ((midX - cent.x) * nx + (midY - cent.y) * ny < 0) {
        nx = -nx;
        ny = -ny;
      }

      const normalAngle = Math.atan2(ny, nx);
      let samples: number[];
      if (isTarget && sparseTargets && len > 110) {
        samples = [0.08, 0.2, 0.32, 0.44, 0.56, 0.68, 0.8, 0.92];
      } else if (isTarget && sparseTargets && len > 55) {
        samples = [0.14, 0.32, 0.5, 0.68, 0.86];
      } else {
        samples = len > 65 ? [0.16, 0.34, 0.5, 0.66, 0.84] : [0.24, 0.5, 0.76];
      }

      for (const u of samples) {
        const contactX = a.x + ex * u + nx * (R + 0.35);
        const contactY = a.y + ey * u + ny * (R + 0.35);

        for (const pAng of principalAngles) {
          const dot = Math.cos(pAng) * nx + Math.sin(pAng) * ny;
          if (dot < -0.1) {
            candidates.push({ contactX, contactY, angle: pAng });
          }
        }

        const baseInAngle = normalAngle + Math.PI;
        const stepDeg =
          isTarget && sparseTargets
            ? 2
            : shapes.length > 14
              ? 4
              : 3;
        for (let deg = -82; deg <= 82; deg += stepDeg) {
          candidates.push({
            contactX,
            contactY,
            angle: baseInAngle + (deg * Math.PI) / 180,
          });
        }
      }
    }
  }
  return candidates;
}

export interface SolveOptions {
  shapes: Shape[];
  ballRadius: number;
  shouldCancel?: () => boolean;
  onProgress?: (progress: SolverProgress) => void;
  yieldFrame?: () => Promise<void>;
}

export async function solveLevelAsync({
  shapes,
  ballRadius,
  shouldCancel = () => false,
  onProgress,
  yieldFrame = () =>
    typeof requestAnimationFrame === 'function'
      ? new Promise((res) => requestAnimationFrame(() => res()))
      : Promise.resolve(),
}: SolveOptions): Promise<{ cancelled: boolean; solutions: AnalyzedSolution[] }> {
  const shapesSnapshot = shapes.map((s) => ({
    ...cloneShape(s),
    alive: true,
    flash: 0,
  }));
  const targets = shapesSnapshot.filter((s) => s.type === 'target');
  const totalTargets = targets.length;
  if (totalTargets === 0) {
    return { cancelled: false, solutions: [] };
  }

  onProgress?.({
    title: 'Tahap 1/3: Mencari Beragam Solusi...',
    subtitle: 'Memindai berbagai arah & sudut tembakan',
    percent: 5,
  });

  const bestState: { sim: SimResult | null } = { sim: null };
  const topPool: { key: string; sim: SimResult }[] = [];
  const winningMap = new Map<string, SimResult>();
  const TARGET_DISTINCT_SOLUTIONS = 14;

  function recordCandidate(sim: SimResult) {
    if (!bestState.sim || sim.score > bestState.sim.score) bestState.sim = sim;

    if (sim.solved) {
      const sig = getSolutionSignature(sim);
      const prev = winningMap.get(sig);
      if (!prev || sim.bounces < prev.bounces) {
        winningMap.set(sig, sim);
      }
      return;
    }

    if (sim.targetsHit > 0) {
      const firstHitId =
        sim.hitEvents.length > 0 ? sim.hitEvents[0].shapeId : -1;
      const angleBucket = Math.round(((sim.angle * 180) / Math.PI) / 5);
      const key = `${firstHitId}_${angleBucket}`;
      const idx = topPool.findIndex((item) => item.key === key);
      if (idx >= 0) {
        if (sim.score > topPool[idx].sim.score) topPool[idx].sim = sim;
      } else {
        topPool.push({ key, sim });
      }
    }
  }

  // STAGE 1: Face-guided backward ray sweep
  const stage1List = buildStage1Candidates(shapesSnapshot, ballRadius);
  const CHUNK = 300;

  for (let i = 0; i < stage1List.length; i++) {
    if (shouldCancel()) return { cancelled: true, solutions: [] };
    const c = stage1List[i];
    const spawn = findComfortableSpawn(
      c.contactX,
      c.contactY,
      c.angle,
      shapesSnapshot,
      ballRadius
    );
    if (spawn) {
      const sim = simulateShot(spawn.x, spawn.y, c.angle, shapesSnapshot, ballRadius, true);
      recordCandidate(sim);
      if (
        winningMap.size >= TARGET_DISTINCT_SOLUTIONS &&
        i > stage1List.length * 0.72
      ) {
        break;
      }
    }
    if (i % CHUNK === 0) {
      const pct = Math.min(46, Math.round((i / Math.max(1, stage1List.length)) * 46));
      onProgress?.({
        title: 'Tahap 1/3: Mencari Beragam Solusi...',
        subtitle:
          winningMap.size > 0
            ? `Ditemukan ${winningMap.size} jalur solusi berbeda (${i}/${stage1List.length})`
            : bestState.sim
              ? `Terbaik: ${bestState.sim.targetsHit}/${totalTargets} target (${i} lintasan)`
              : `Mengecek ${i}/${stage1List.length} lintasan...`,
        percent: Math.max(5, pct),
      });
      await yieldFrame();
    }
  }

  // STAGE 2: Multi-resolution local refinement
  if (!shouldCancel() && winningMap.size < 4 && topPool.length > 0) {
    topPool.sort((a, b) => b.sim.score - a.sim.score);
    const maxSeeds = winningMap.size === 0 ? 48 : 22;
    const seeds = topPool.slice(0, maxSeeds).map((item) => item.sim);

    const refineRounds = [
      { dAngDeg: 3.5, stepAngDeg: 0.35, dPerp: 12, stepPerp: 2.4 },
      { dAngDeg: 0.6, stepAngDeg: 0.06, dPerp: 3.2, stepPerp: 0.65 },
      { dAngDeg: 0.12, stepAngDeg: 0.015, dPerp: 0.9, stepPerp: 0.22 },
    ];

    for (let sIdx = 0; sIdx < seeds.length; sIdx++) {
      if (shouldCancel()) return { cancelled: true, solutions: [] };
      if (winningMap.size >= TARGET_DISTINCT_SOLUTIONS) break;
      let current = seeds[sIdx];
      let seedSolved = false;

      for (const r of refineRounds) {
        let improved = current;
        const perpX = -Math.sin(current.angle);
        const perpY = Math.cos(current.angle);

        for (let da = -r.dAngDeg; da <= r.dAngDeg + 1e-6; da += r.stepAngDeg) {
          const testAngle = current.angle + (da * Math.PI) / 180;
          for (let dp = -r.dPerp; dp <= r.dPerp + 1e-6; dp += r.stepPerp) {
            const tx = current.sx + perpX * dp;
            const ty = current.sy + perpY * dp;
            if (tx < 10 || tx > LOGICAL_W - 10 || ty < 10 || ty > LOGICAL_H - 10) continue;
            if (!isPointClearOfShapes(tx, ty, shapesSnapshot, ballRadius)) continue;

            const sim = simulateShot(tx, ty, testAngle, shapesSnapshot, ballRadius, true);
            if (sim.score > improved.score) improved = sim;
            if (sim.solved) {
              recordCandidate(sim);
              seedSolved = true;
              break;
            }
          }
          if (seedSolved) break;
        }
        current = improved;
        if (!bestState.sim || current.score > bestState.sim.score) bestState.sim = current;
        if (seedSolved) break;
      }

      const pct = 46 + Math.round(((sIdx + 1) / seeds.length) * 30);
      onProgress?.({
        title: 'Tahap 2/3: Kalibrasi & Cari Alternatif...',
        subtitle:
          winningMap.size > 0
            ? `Ditemukan ${winningMap.size} solusi berbeda · Kandidat ${sIdx + 1}/${seeds.length}`
            : `Menyempurnakan kandidat ${sIdx + 1}/${seeds.length} · Terbaik: ${bestState.sim ? bestState.sim.targetsHit : 0}/${totalTargets}`,
        percent: pct,
      });
      await yieldFrame();
    }
  }

  // STAGE 3: Global exploration if fewer than 2 winning solutions found
  if (!shouldCancel() && winningMap.size < 2) {
    const totalTries = winningMap.size === 0 ? 9500 : 3000;
    const title =
      winningMap.size === 0
        ? 'Tahap 3/3: Eksplorasi Mendalam...'
        : 'Tahap 3/3: Mencari Jalur Alternatif...';

    // Deterministic LCG PRNG so solver exploration is reproducible
    let seed = 133791;
    const nextRand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };

    // Keep top diverse near-miss corridors for multi-basin perturbation
    topPool.sort((a, b) => b.sim.score - a.sim.score);
    const diverseSeeds = topPool.slice(0, 14).map((item) => item.sim);
    if (bestState.sim && diverseSeeds.length === 0) {
      diverseSeeds.push(bestState.sim);
    }

    for (let t = 0; t < totalTries; t++) {
      if (shouldCancel()) return { cancelled: true, solutions: [] };

      let sx: number;
      let sy: number;
      let ang: number;
      if (diverseSeeds.length > 0 && winningMap.size === 0 && nextRand() < 0.72) {
        const base =
          t % 2 === 0 && bestState.sim
            ? bestState.sim
            : diverseSeeds[Math.floor(nextRand() * diverseSeeds.length)];
        const spreadPos = t % 3 === 0 ? 32 : 8;
        const spreadAng = t % 3 === 0 ? 0.18 : 0.025;
        sx = base.sx + (nextRand() - 0.5) * 2 * spreadPos;
        sy = base.sy + (nextRand() - 0.5) * 2 * spreadPos;
        ang = base.angle + (nextRand() - 0.5) * 2 * spreadAng;
      } else {
        const tgt = targets[Math.floor(nextRand() * targets.length)];
        const tv = tgt.vertices;
        const eIdx = Math.floor(nextRand() * tv.length);
        const p0 = tv[eIdx];
        const p1 = tv[(eIdx + 1) % tv.length];
        const u = nextRand();
        const aimX = p0.x + (p1.x - p0.x) * u;
        const aimY = p0.y + (p1.y - p0.y) * u;
        sx = 16 + nextRand() * (LOGICAL_W - 32);
        sy = 16 + nextRand() * (LOGICAL_H - 32);
        ang = Math.atan2(aimY - sy, aimX - sx) + (nextRand() - 0.5) * 0.45;
      }

      if (sx < 10 || sx > LOGICAL_W - 10 || sy < 10 || sy > LOGICAL_H - 10) continue;
      if (!isPointClearOfShapes(sx, sy, shapesSnapshot, ballRadius)) continue;

      const sim = simulateShot(sx, sy, ang, shapesSnapshot, ballRadius, true);
      recordCandidate(sim);
      if (winningMap.size >= 3) break;

      if (t % 360 === 0) {
        const pct = 76 + Math.round((t / totalTries) * 14);
        onProgress?.({
          title,
          subtitle:
            winningMap.size > 0
              ? `${winningMap.size} solusi ditemukan · Mencari alternatif lebih mudah...`
              : `Eksplorasi lanjutan · Terbaik: ${bestState.sim ? bestState.sim.targetsHit : 0}/${totalTargets} target`,
          percent: pct,
        });
        await yieldFrame();
      }
    }
  }

  if (shouldCancel()) return { cancelled: true, solutions: [] };

  // STAGE 4: Analyze, center in safe zone & rank by ease
  onProgress?.({
    title: 'Menganalisis Kemudahan & Margin Aman...',
    subtitle: 'Mengukur toleransi sudut & posisi jari setiap solusi',
    percent: 94,
  });
  await yieldFrame();

  let rawToAnalyze: SimResult[] = Array.from(winningMap.values()).sort(
    (a, b) => a.bounces - b.bounces
  );
  if (rawToAnalyze.length === 0 && bestState.sim) {
    const fallbackBest = bestState.sim;
    topPool.sort((a, b) => b.sim.score - a.sim.score);
    rawToAnalyze = [fallbackBest];
    for (const item of topPool) {
      if (rawToAnalyze.length >= 3) break;
      if (
        Math.hypot(item.sim.sx - fallbackBest.sx, item.sim.sy - fallbackBest.sy) > 25
      ) {
        rawToAnalyze.push(item.sim);
      }
    }
  }

  if (rawToAnalyze.length === 0) {
    return { cancelled: false, solutions: [] };
  }

  const analyzedList: AnalyzedSolution[] = [];
  for (const rawSim of rawToAnalyze.slice(0, 14)) {
    let baseSim = rawSim;
    if (rawSim.hitEvents.length > 0) {
      const firstHit = rawSim.hitEvents[0];
      const comfy = findComfortableSpawn(
        firstHit.hitX,
        firstHit.hitY,
        rawSim.angle,
        shapesSnapshot,
        ballRadius
      );
      if (comfy) {
        const verified = simulateShot(
          comfy.x,
          comfy.y,
          rawSim.angle,
          shapesSnapshot,
          ballRadius,
          false
        );
        if (
          (rawSim.solved && verified.solved) ||
          (!rawSim.solved && verified.targetsHit >= rawSim.targetsHit)
        ) {
          baseSim = verified;
        }
      }
    }
    analyzedList.push(analyzeAndCenterSolution(baseSim, shapesSnapshot, ballRadius));
  }

  const uniqueAnalyzed: AnalyzedSolution[] = [];
  for (const item of analyzedList) {
    const isDup = uniqueAnalyzed.some((other) => {
      const distPos = Math.hypot(item.sx - other.sx, item.sy - other.sy);
      const angDiff = Math.abs(
        Math.atan2(
          Math.sin(item.angle - other.angle),
          Math.cos(item.angle - other.angle)
        )
      );
      return distPos < 20 && angDiff < (8 * Math.PI) / 180;
    });
    if (!isDup) uniqueAnalyzed.push(item);
  }

  uniqueAnalyzed.sort((a, b) => {
    if (a.solved !== b.solved) return a.solved ? -1 : 1;
    const scoreA = a.analysis?.easeScore ?? 0;
    const scoreB = b.analysis?.easeScore ?? 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    const tolA = a.analysis?.angleTolDeg ?? 0;
    const tolB = b.analysis?.angleTolDeg ?? 0;
    if (tolB !== tolA) return tolB - tolA;
    return a.simResult.bounces - b.simResult.bounces;
  });

  const finalSolutions = uniqueAnalyzed.slice(0, 6);

  if (finalSolutions.length > 0 && finalSolutions[0].solved) {
    finalSolutions[0].badges.push('Cara Termudah');

    let widestIdx = 0;
    let shortestIdx = 0;
    for (let i = 1; i < finalSolutions.length; i++) {
      if (!finalSolutions[i].solved) continue;
      if (
        (finalSolutions[i].analysis?.angleTolDeg ?? 0) >
        (finalSolutions[widestIdx].analysis?.angleTolDeg ?? 0)
      ) {
        widestIdx = i;
      }
      if (
        finalSolutions[i].simResult.bounces <
        finalSolutions[shortestIdx].simResult.bounces
      ) {
        shortestIdx = i;
      }
    }
    if (widestIdx !== 0) {
      finalSolutions[widestIdx].badges.push('Toleransi Terlebar');
    }
    if (shortestIdx !== 0 && finalSolutions[shortestIdx].badges.length === 0) {
      finalSolutions[shortestIdx].badges.push('Pantulan Tersingkat');
    }
    for (let i = 1; i < finalSolutions.length; i++) {
      if (
        finalSolutions[i].analysis?.isStraight &&
        finalSolutions[i].badges.length === 0
      ) {
        finalSolutions[i].badges.push('Sudut Lurus');
      }
    }
  }

  return { cancelled: false, solutions: finalSolutions };
}
