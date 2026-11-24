export const LOGICAL_W = 400;
export const LOGICAL_H = 680;
export const BALL_SPEED_NORMAL = 640;
export const MAX_BOUNCES = 120;
export const EPS = 1e-4;
export const GRID_STEP = 5;

export interface Point {
  x: number;
  y: number;
}

export type ShapeType = 'target' | 'wall';

export interface Shape {
  id: number;
  type: ShapeType;
  vertices: Point[];
  alive: boolean;
  flash: number;
  /** Thin white strings/threads in Okay? are destroyed on contact and let the ball pass straight through without bouncing. */
  passThrough?: boolean;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  alpha: number;
  color: string;
}

export interface ImpactRipple {
  x: number;
  y: number;
  r: number;
  alpha: number;
  color: string;
}

export type ToolMode = 'play' | 'pan' | 'edit';
export type TabKey = 'solve' | 'scan' | 'edit';

export interface CameraState {
  zoom: number;
  panX: number;
  panY: number;
  minZoom: number;
  maxZoom: number;
}

export interface HitEvent {
  pointIdx: number;
  shapeId: number;
  hitX: number;
  hitY: number;
  type: ShapeType;
  passThrough?: boolean;
}

export interface SimResult {
  sx: number;
  sy: number;
  angle: number;
  points: Point[];
  hitEvents: HitEvent[];
  targetsHit: number;
  totalTargets: number;
  bounces: number;
  solved: boolean;
  score: number;
}

export type EaseTier = 'very-easy' | 'easy' | 'medium' | 'precise';

export interface SolutionAnalysis {
  easeScore: number;
  angleTolDeg: number;
  posTolPx: number;
  spawnClearance: number;
  isStraight: boolean;
  isDiagonal45: boolean;
  tier: EaseTier;
  tierLabel: string;
  reasonText: string;
}

export interface AnalyzedSolution {
  sx: number;
  sy: number;
  angle: number;
  simResult: SimResult;
  solved: boolean;
  analysis: SolutionAnalysis | null;
  badges: string[];
}

export interface ImageRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PresetDefinition {
  key: string;
  name: string;
  shortLabel: string;
  bgColor: string;
  ballRadius: number;
  build: (allocateId: () => number) => Shape[];
}

export interface SolverProgress {
  title: string;
  subtitle: string;
  percent: number;
}
