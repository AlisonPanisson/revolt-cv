export type CarId = 'rc_bandit' | 'toyeca' | 'sprinter_xl' | 'volken_cv';

export type TrackId = 'lia_lab' | 'toy_room' | 'robotics_lab';

export type PickupType = 'rocket' | 'turbo' | 'shockwave' | 'oil';

export interface CarSpec {
  id: CarId;
  name: string;
  classTag: string;
  tagline: string;
  bodyColor: string;
  accentColor: string;
  wheelScale: number;
  bodyStyle: 'buggy' | 'gt' | 'truggy' | 'lab_proto';
  // Display stats (0-100)
  statSpeed: number;
  statAccel: number;
  statGrip: number;
  // Physics tuning
  maxEngineForce: number;
  topSpeedMps: number;
  maxSteerRad: number;
  frictionSlip: number;
  suspensionStiffness: number;
  massKg: number;
}

export interface SplineNode {
  x: number;
  y: number;
  z: number;
}

export interface TrackRampDef {
  splineT: number;
  lateralOffset: number;
  width: number;
  length: number;
  height: number;
  color: string;
  label?: string;
}

export interface TrackDefinition {
  id: TrackId;
  name: string;
  subtitle: string;
  description: string;
  previewUrl: string;
  laps: number;
  roadWidth: number;
  theme: 'lia_lab' | 'toy_room' | 'robotics_lab';
  skyTop: string;
  skyBottom: string;
  floorPrimary: string;
  floorSecondary: string;
  curbColorA: string;
  curbColorB: string;
  waypoints: SplineNode[];
  pickupTs: number[];
  ramps: TrackRampDef[];
}

export interface ControlState {
  steer: number; // -1 (left) .. +1 (right), Wait: in Three/Cannon we map positive/negative clearly
  throttle: number; // 0 .. 1
  brake: number; // 0 .. 1
  reverse: number; // 0 .. 1
  fireItem: boolean; // edge-triggered or held
  resetCar: boolean;
  source: 'cv' | 'cv_sim' | 'keyboard';
  gestureLabel: string;
  detectedHands: number;
  wheelAngleDeg: number;
}

export interface RacerProgress {
  id: string;
  name: string;
  color: string;
  isPlayer: boolean;
  lap: number;
  splineT: number;
  totalProgress: number;
  finished: boolean;
  finishTimeSec: number | null;
  bestLapSec: number | null;
}
