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


