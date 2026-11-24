import { LOGICAL_H, LOGICAL_W, PresetDefinition, Shape } from './types';
import { makeRectShape, makeRightTriangle } from './geometry';

export const PRESETS: PresetDefinition[] = [
  {
    key: 'triangles4x5',
    name: 'Grid Segitiga 4×5',
    shortLabel: 'Segitiga 4×5',
    bgColor: '#3f4957',
    ballRadius: 4.8,
    build(allocId) {
      const shapes: Shape[] = [];
      const size = 50;
      const gap = 12;
      const cols = 4;
      const rows = 5;
      const totalW = cols * size + (cols - 1) * gap;
      const totalH = rows * size + (rows - 1) * gap;
      const startX = (LOGICAL_W - totalW) * 0.5;
      const startY = (LOGICAL_H - totalH) * 0.5 - 12;
      const wallSet = new Set(['0,0', '0,2', '3,0', '4,3']);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = startX + c * (size + gap);
          const y = startY + r * (size + gap);
          const type = wallSet.has(`${r},${c}`) ? 'wall' : 'target';
          shapes.push(makeRightTriangle(allocId(), x, y, size, type));
        }
      }
      return shapes;
    },
  },
  {
    key: 'level30',
    name: 'Level 30 (Lorong 2 Garis)',
    shortLabel: 'Level 30',
    bgColor: '#3f4957',
    ballRadius: 5.5,
    build(allocId) {
      return [
        makeRectShape(allocId(), 258, 388, 13, 132, 0, 'wall'),
        makeRectShape(allocId(), 296, 388, 13, 132, 0, 'wall'),
        makeRectShape(allocId(), 288, 224, 58, 86, 24, 'target'),
        makeRectShape(allocId(), 210, 355, 40, 56, 0, 'target'),
        makeRectShape(allocId(), 166, 275, 72, 20, -20, 'target'),
        makeRectShape(allocId(), 154, 358, 56, 42, 0, 'target'),
        makeRectShape(allocId(), 160, 214, 64, 58, -10, 'target'),
        makeRectShape(allocId(), 206, 436, 78, 20, -52, 'target'),
        makeRectShape(allocId(), 110, 422, 104, 28, 45, 'target'),
      ];
    },
  },
  {
    key: 'level1',
    name: 'Level 1 (Zig-Zag Dasar)',
    shortLabel: 'Level 1',
    bgColor: '#434d5c',
    ballRadius: 5.5,
    build(allocId) {
      return [
        makeRectShape(allocId(), 125, 250, 96, 24, -45, 'target'),
        makeRectShape(allocId(), 275, 250, 96, 24, 45, 'target'),
        makeRectShape(allocId(), 200, 425, 110, 24, 0, 'target'),
      ];
    },
  },
  {
    key: 'level14',
    name: 'Level 14 (Pantulan Hitam)',
    shortLabel: 'Level 14',
    bgColor: '#3a4454',
    ballRadius: 5.5,
    build(allocId) {
      return [
        makeRectShape(allocId(), 96, 330, 18, 210, 0, 'wall'),
        makeRectShape(allocId(), 304, 330, 18, 210, 0, 'wall'),
        makeRectShape(allocId(), 200, 210, 82, 24, 0, 'target'),
        makeRectShape(allocId(), 156, 305, 58, 22, -25, 'target'),
        makeRectShape(allocId(), 244, 365, 58, 22, 25, 'target'),
        makeRectShape(allocId(), 200, 455, 86, 24, 0, 'target'),
      ];
    },
  },
  {
    key: 'level24',
    name: 'Level 24 (Berlian 5 Balok)',
    shortLabel: 'Level 24',
    bgColor: '#364152',
    ballRadius: 5.5,
    build(allocId) {
      return [
        makeRectShape(allocId(), 200, 195, 72, 22, 0, 'target'),
        makeRectShape(allocId(), 118, 305, 72, 22, -55, 'target'),
        makeRectShape(allocId(), 282, 305, 72, 22, 55, 'target'),
        makeRectShape(allocId(), 146, 430, 74, 22, 32, 'target'),
        makeRectShape(allocId(), 254, 430, 74, 22, -32, 'target'),
        makeRectShape(allocId(), 200, 325, 44, 44, 45, 'wall'),
      ];
    },
  },
];

export function getPresetByKey(key: string): PresetDefinition | undefined {
  return PRESETS.find((p) => p.key === key);
}
