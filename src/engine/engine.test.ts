import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMinAreaOBB,
  convexHull,
  makeRectShape,
  makeRightTriangle,
  mirrorShapeX,
  pointInPolygon,
  polygonCentroid,
  rotateShape,
  scaleShape,
  translateShape,
} from './geometry';
import {
  isPointClearOfShapes,
  rayCircleVsSegment,
  simulateShot,
} from './physics';
import { analyzeAndCenterSolution, solveLevelAsync } from './solver';
import { getPresetByKey } from './presets';
import { extractShapesFromImageData } from './cvDetector';
import {
  isValidPersistedWorkspace,
  PersistedWorkspaceState,
  sanitizeWorkspaceForSave,
} from './persistence';

test('geometry: rectangle and triangle construction, containment, and transforms', () => {
  const rect = makeRectShape(1, 200, 300, 80, 40, 0, 'target');
  assert.equal(pointInPolygon(200, 300, rect.vertices), true);
  assert.equal(pointInPolygon(100, 100, rect.vertices), false);

  translateShape(rect, 20, -10);
  const c1 = polygonCentroid(rect.vertices);
  assert.ok(Math.abs(c1.x - 220) < 1e-6);
  assert.ok(Math.abs(c1.y - 290) < 1e-6);

  rotateShape(rect, 90);
  const c2 = polygonCentroid(rect.vertices);
  assert.ok(Math.abs(c2.x - 220) < 1e-6);
  assert.ok(Math.abs(c2.y - 290) < 1e-6);

  scaleShape(rect, 1.5);
  assert.equal(pointInPolygon(220, 290, rect.vertices), true);

  const tri = makeRightTriangle(2, 100, 100, 50, 'target');
  assert.equal(tri.vertices.length, 3);
  assert.equal(pointInPolygon(140, 140, tri.vertices), true);
  mirrorShapeX(tri);
  assert.equal(tri.vertices.length, 3);
});

test('geometry: convex hull and min-area OBB recover crisp rectangle', () => {
  const pts = [
    { x: 10, y: 10 },
    { x: 50, y: 10 },
    { x: 50, y: 30 },
    { x: 10, y: 30 },
    { x: 30, y: 20 },
  ];
  const hull = convexHull(pts);
  assert.equal(hull.length, 4);
  const obb = computeMinAreaOBB(hull);
  assert.ok(Math.abs(obb.area - 800) < 1e-3);
  assert.equal(obb.corners?.length, 4);
});

test('physics: rayCircleVsSegment reflects accurately and prevents grazing tunneling', () => {
  // Horizontal segment y=200 from x=100..300; ball moving down from (200, 150) with R=5
  const hit = rayCircleVsSegment(200, 150, 0, 1, 100, 200, 300, 200, 5);
  assert.ok(hit !== null);
  assert.ok(Math.abs(hit.t - 45) < 1e-4);
  assert.ok(Math.abs(hit.nx) < 1e-4);
  assert.ok(Math.abs(hit.ny - -1) < 1e-4);

  // Grazing contact slightly within [R - 0.08, R] should still collide rather than tunnel
  const grazing = rayCircleVsSegment(200, 195.02, 0, 1, 100, 200, 300, 200, 5);
  assert.ok(grazing !== null, 'grazing contact must still register a bounce');
  assert.ok(grazing.t > 0);
});

test('physics: simulateShot destroys targets and bounces off walls cleanly', () => {
  const shapes = [
    makeRectShape(1, 200, 250, 80, 20, 0, 'target'),
    makeRectShape(2, 200, 120, 80, 20, 0, 'wall'),
  ];
  assert.equal(isPointClearOfShapes(200, 350, shapes, 5.5), true);
  assert.equal(isPointClearOfShapes(200, 250, shapes, 5.5), false);

  // Shoot straight up at the target
  const sim = simulateShot(200, 350, -Math.PI / 2, shapes, 5.5, false);
  assert.equal(sim.solved, true);
  assert.equal(sim.targetsHit, 1);
  assert.equal(sim.totalTargets, 1);
  assert.ok(sim.bounces >= 1);
});

test('solver: solves Level 1 and Level 14 with safe-zone centering and valid ease metrics', async () => {
  for (const key of ['level1', 'level14', 'level24']) {
    const preset = getPresetByKey(key);
    assert.ok(preset, `preset ${key} must exist`);
    let id = 1;
    const shapes = preset.build(() => id++);

    const result = await solveLevelAsync({
      shapes,
      ballRadius: preset.ballRadius,
      yieldFrame: async () => {},
    });

    assert.equal(result.cancelled, false);
    assert.ok(result.solutions.length >= 1, `${key} should produce at least 1 solution`);
    const best = result.solutions[0];
    assert.equal(best.solved, true, `${key} best solution should clear 100% of targets`);
    assert.ok(best.analysis !== null);
    assert.ok(best.analysis.easeScore >= 5 && best.analysis.easeScore <= 99);
    assert.ok(best.analysis.angleTolDeg >= 0.05);
    assert.ok(best.analysis.posTolPx >= 0.5);

    // Re-verifying the centered shot directly through simulateShot must still solve 100%
    const verify = simulateShot(
      best.sx,
      best.sy,
      best.angle,
      shapes,
      preset.ballRadius,
      false
    );
    assert.equal(verify.solved, true);
    assert.equal(verify.targetsHit, verify.totalTargets);

    // Re-analyzing preserves solved invariant
    const reAnalyzed = analyzeAndCenterSolution(verify, shapes, preset.ballRadius);
    assert.equal(reAnalyzed.solved, true);
  }
});

test('solver: solves default Grid Segitiga 4x5 preset', async () => {
  const preset = getPresetByKey('triangles4x5');
  assert.ok(preset);
  let id = 1;
  const shapes = preset.build(() => id++);
  assert.equal(shapes.filter((s) => s.type === 'target').length, 16);
  assert.equal(shapes.filter((s) => s.type === 'wall').length, 4);

  const result = await solveLevelAsync({
    shapes,
    ballRadius: preset.ballRadius,
    yieldFrame: async () => {},
  });

  assert.equal(result.cancelled, false);
  assert.ok(result.solutions.length >= 1);
  assert.equal(result.solutions[0].solved, true, 'Grid Segitiga 4x5 must solve 100%');
});

test('cvDetector: detects ultra-thin 1px and 2px white target lines plus dark walls while ignoring shadows', () => {
  const pw = 240;
  const ph = 520;
  const buf = new Uint8ClampedArray(pw * ph * 4);
  // Fill dark slate background rgb(63, 72, 86)
  for (let i = 0; i < pw * ph; i++) {
    buf[i * 4] = 63;
    buf[i * 4 + 1] = 72;
    buf[i * 4 + 2] = 86;
    buf[i * 4 + 3] = 255;
  }
  const fillRect = (x0: number, y0: number, x1: number, y1: number, r: number, g: number, b: number) => {
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const i = (y * pw + x) * 4;
        buf[i] = r;
        buf[i + 1] = g;
        buf[i + 2] = b;
      }
    }
  };

  // Top 1px ultra-thin white line
  fillRect(50, 120, 190, 120, 255, 255, 255);
  // Bottom 2px thin white line
  fillRect(50, 380, 190, 381, 255, 255, 255);
  // Dark wall with subtle drop shadow (shadow should be rejected, wall detected)
  fillRect(92, 222, 148, 254, 52, 60, 72); // shadow
  fillRect(90, 220, 146, 252, 19, 23, 31); // dark wall

  let id = 1;
  const res = extractShapesFromImageData({
    imgData: buf,
    pw,
    ph,
    detectSensitivity: 36,
    ignoreStatusBars: true,
    swapTargetWall: false,
    allocateId: () => id++,
  });

  assert.equal(res.targetCount, 2, 'must detect both 1px and 2px thin white target lines');
  assert.equal(res.thinTargetCount, 2, 'must auto-classify ultra-thin white lines as passThrough strings');
  assert.equal(res.wallCount, 1, 'must detect the dark wall and ignore its subtle shadow');
  for (const sh of res.shapes) {
    assert.equal(sh.vertices.length, 4, 'thin lines and rectangular wall must fit crisp 4-corner OBBs');
    if (sh.type === 'target') {
      assert.equal(sh.passThrough, true, 'thin white line target must be passThrough');
    }
  }
});

test('physics: passThrough thin white string is destroyed without bouncing the ball', () => {
  const topString = {
    ...makeRectShape(1, 200, 200, 160, 2, 0, 'target'),
    passThrough: true,
  };
  const bottomString = {
    ...makeRectShape(2, 200, 420, 160, 2, 0, 'target'),
    passThrough: true,
  };
  // Shoot straight down from above topString: must slice through topString AND bottomString without bouncing!
  const sim = simulateShot(200, 100, Math.PI / 2, [topString, bottomString], 5, false);
  assert.equal(sim.solved, true, 'ball must slice through both thin white strings');
  assert.equal(sim.targetsHit, 2);
  assert.equal(sim.bounces, 0, 'slicing through passThrough strings must not count as bounces');
  assert.equal(sim.hitEvents.length, 2);
  assert.equal(sim.hitEvents[0].passThrough, true);
  assert.equal(sim.hitEvents[1].passThrough, true);
  // Final exit point must be below bottomString (y > 420), confirming straight pass-through
  const exitPt = sim.points[sim.points.length - 1];
  assert.ok(exitPt.y > 450, `ball should pass straight down past bottom string, got y=${exitPt.y}`);
});

test('persistence: sanitizeWorkspaceForSave resets transient hit flags and validates payloads', () => {
  const sample: PersistedWorkspaceState = {
    version: 1,
    savedAt: 0,
    activePresetKey: null,
    activeTab: 'scan',
    bgColor: 'rgb(63, 72, 86)',
    ballRadius: 4.8,
    shapes: [
      {
        ...makeRectShape(7, 200, 160, 170, 2, 0, 'target'),
        alive: false,
        flash: 0.8,
        passThrough: true,
      },
    ],
    uploadedImageDataUrl: 'data:image/png;base64,AAAA',
    uploadedRect: { x: 40, y: 0, w: 320, h: 680 },
    showImageOverlay: true,
    imageOverlayAlpha: 0.35,
    detectSensitivity: 36,
    ignoreStatusBars: true,
    swapTargetWall: false,
    detectedTargets: 1,
    detectedThinTargets: 1,
    detectedWalls: 0,
    solutions: [],
    activeSolutionIdx: -1,
    showGrid: false,
    snapToGrid: false,
    showGuide: true,
    showSafeZone: true,
    showAltPaths: false,
  };

  const clean = sanitizeWorkspaceForSave(sample);
  assert.equal(isValidPersistedWorkspace(clean), true);
  assert.equal(clean.shapes[0].alive, true, 'saved shapes must restore alive=true');
  assert.equal(clean.shapes[0].flash, 0, 'saved shapes must restore flash=0');
  assert.equal(clean.shapes[0].passThrough, true, 'passThrough flag must be preserved');
  assert.equal(clean.uploadedImageDataUrl, 'data:image/png;base64,AAAA');
  assert.equal(isValidPersistedWorkspace(null), false);
  assert.equal(isValidPersistedWorkspace({ version: 2 }), false);
});

test('cvDetector: preserves 45-degree beveled trapezoids and strips bottom UI toolbar & hollow hint button', () => {
  const pw = 240;
  const ph = 520;
  const buf = new Uint8ClampedArray(pw * ph * 4);
  for (let i = 0; i < pw * ph; i++) {
    buf[i * 4] = 66;
    buf[i * 4 + 1] = 74;
    buf[i * 4 + 2] = 86;
    buf[i * 4 + 3] = 255;
  }
  const setPx = (x: number, y: number, r: number, g: number, b: number) => {
    const i = (y * pw + x) * 4;
    buf[i] = r;
    buf[i + 1] = g;
    buf[i + 2] = b;
  };

  // 1. Draw a 45-degree beveled white trapezoid (top edge y=140, x=60..180; bottom edge y=164, x=84..156)
  for (let y = 140; y <= 164; y++) {
    const inset = y - 140;
    for (let x = 60 + inset; x <= 180 - inset; x++) {
      setPx(x, y, 255, 255, 255);
    }
  }

  // 2. Draw a hollow dark button outline ("watch ad for hint") at y=410..440, x=70..170
  for (let x = 70; x <= 170; x++) {
    setPx(x, 410, 15, 18, 24);
    setPx(x, 411, 15, 18, 24);
    setPx(x, 439, 15, 18, 24);
    setPx(x, 440, 15, 18, 24);
  }
  for (let y = 410; y <= 440; y++) {
    setPx(70, y, 15, 18, 24);
    setPx(71, y, 15, 18, 24);
    setPx(169, y, 15, 18, 24);
    setPx(170, y, 15, 18, 24);
  }

  // 3. Draw a full-width white footer toolbar at bottom 12% (y=458..519)
  for (let y = 458; y < ph; y++) {
    for (let x = 0; x < pw; x++) {
      setPx(x, y, 255, 255, 255);
    }
  }

  let id = 1;
  const res = extractShapesFromImageData({
    imgData: buf,
    pw,
    ph,
    detectSensitivity: 36,
    ignoreStatusBars: true,
    swapTargetWall: false,
    allocateId: () => id++,
  });

  assert.equal(res.targetCount, 1, 'must detect ONLY the white trapezoid, stripping the white footer toolbar');
  assert.equal(res.wallCount, 0, 'must reject the hollow hint button outline');
  const trap = res.shapes[0];
  // Verify top edge is wider than bottom edge (proving 45-degree bevel was preserved, not crushed to 90-deg box)
  const ys = trap.vertices.map((v) => v.y);
  const midY = (Math.min(...ys) + Math.max(...ys)) * 0.5;
  const topXs = trap.vertices.filter((v) => v.y < midY).map((v) => v.x);
  const botXs = trap.vertices.filter((v) => v.y >= midY).map((v) => v.x);
  const topWidth = Math.max(...topXs) - Math.min(...topXs);
  const botWidth = Math.max(...botXs) - Math.min(...botXs);
  assert.ok(
    topWidth - botWidth > 35,
    `beveled trapezoid must preserve wider top (${topWidth.toFixed(1)}) vs shorter bottom (${botWidth.toFixed(1)})`
  );
});




