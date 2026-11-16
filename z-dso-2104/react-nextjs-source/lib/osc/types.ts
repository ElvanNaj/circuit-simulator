/**
 * Z-DSO 2104 — Virtual Digital Storage Oscilloscope
 * Shared types & constants for the engine and UI.
 */

export const H_DIVS = 10;
export const V_DIVS = 8;
export const DISP_PTS = 1200; // display points across screen width
export const GEN_PTS = 7200; // internal generation resolution (6x oversample for peak-detect)
export const SCREEN_W = 800;
export const SCREEN_H = 480;

/** 1-2-5 sequence, V/div */
export const VOLT_STEPS = [
  0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10,
];

/** 1-2-5 sequence, s/div */
export const TIME_STEPS = [
  1e-8, 2e-8, 5e-8,
  1e-7, 2e-7, 5e-7,
  1e-6, 2e-6, 5e-6,
  1e-5, 2e-5, 5e-5,
  1e-4, 2e-4, 5e-4,
  1e-3, 2e-3, 5e-3,
  0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10,
];

/** 1-2-5 sequence, generator frequency (Hz) */
export const FREQ_STEPS = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50,
  100, 200, 500, 1e3, 2e3, 5e3, 1e4, 2e4, 5e4,
  1e5, 2e5, 5e5, 1e6, 2e6, 5e6, 1e7, 2e7,
];

export const CH_COLORS = ['#f5c518', '#3fd8e8', '#ea5be0', '#48e07a'] as const;
export const CH_NAMES = ['CH1', 'CH2', 'CH3', 'CH4'] as const;
export const MATH_COLOR = '#9d7bff';
export const FFT_COLOR = '#ff9d45';
export const CURSOR_A_COLOR = '#ff5fd2';
export const CURSOR_B_COLOR = '#ffa53d';

export type Coupling = 'DC' | 'AC' | 'GND';
export type WaveType =
  | 'off' | 'sine' | 'square' | 'triangle' | 'sawtooth'
  | 'pulse' | 'dc' | 'noise' | 'am';
export type AcqMode = 'sample' | 'peak' | 'average';
export type Sweep = 'auto' | 'normal' | 'single';
export type Edge = 'rising' | 'falling';
export type MathOp = 'A+B' | 'A-B' | 'A*B';
export type GridMode = 'full' | 'half' | 'none';
export type CursorActive = 'a' | 'b';
export type ExtAlign = 'none' | 'trigger' | 'center';

export interface ChannelCfg {
  enabled: boolean;
  voltsDiv: number;
  /** vertical position offset in volts (positive = trace moves up) */
  offset: number;
  coupling: Coupling;
  invert: boolean;
  bwLimit: boolean;
  probe: 1 | 10;
}

export interface GenCfg {
  type: WaveType;
  freq: number;   // Hz
  amp: number;    // peak volts
  offset: number; // DC offset volts
  duty: number;   // 0..1 (square/pulse)
  phase: number;  // degrees 0..360
  noise: number;  // gaussian noise rms, volts
}

export interface TriggerCfg {
  source: number; // 0..3 channel index
  level: number;  // volts
  edge: Edge;
  sweep: Sweep;
}

export interface DisplayCfg {
  persistence: number; // seconds, 0 = off, Infinity = infinite
  dots: boolean;
  grid: GridMode;
  intensity: number; // 0..1
  xy: boolean;
  fft: boolean;
  fftSource: number; // channel index
}

export interface AcqCfg {
  mode: AcqMode;
  avgCount: number;
}

export interface MathCfg {
  enabled: boolean;
  op: MathOp;
}

export interface CursorsCfg {
  enabled: boolean;
  /** horizontal (voltage) cursors, volts */
  hA: number;
  hB: number;
  /** vertical (time) cursors, seconds */
  vA: number;
  vB: number;
  active: CursorActive;
}

export interface MeasResult {
  vpp: number; vmax: number; vmin: number; vamp: number;
  vavg: number; vrms: number;
  freq: number; period: number; duty: number;
  rise: number; fall: number;
  valid: boolean;
}

export interface ExtMeta {
  sampleRate?: number;
  /** time of first sample, engine-time base */
  tStart?: number;
  /** none = buffer already represents exactly one screen window (default);
   *  trigger = search a trigger crossing in the buffer and align it;
   *  center = center the buffer in the window */
  align?: ExtAlign;
}

export interface WindowInfo {
  t0: number;       // window start time (engine base, seconds)
  dt: number;       // seconds per display point
  window: number;   // t0 .. t0 + window covers the screen
}

export interface RenderState {
  channels: {
    disp: Float32Array;      // display samples (transformed: coupling/invert/probe/bw applied)
    peakLo: Float32Array | null; // peak-detect envelope
    peakHi: Float32Array | null;
    cfg: ChannelCfg;
  }[];
  math: { disp: Float32Array; cfg: MathCfg } | null;
  win: WindowInfo;
  trig: { found: boolean; x: number; time: number; level: number; source: number; edge: Edge };
  trigStatus: "TRIG'D" | 'AUTO' | 'TRIG?' | 'STOP' | 'WAIT';
  running: boolean;
  armed: boolean;
  simTime: number;
}

export const emptyMeas = (): MeasResult => ({
  vpp: 0, vmax: 0, vmin: 0, vamp: 0, vavg: 0, vrms: 0,
  freq: 0, period: 0, duty: 0, rise: 0, fall: 0, valid: false,
});

export const defaultChannel = (i: number): ChannelCfg => ({
  enabled: i < 2,
  voltsDiv: i === 0 ? 0.5 : i === 1 ? 0.5 : 0.1,
  offset: 0,
  coupling: 'DC',
  invert: false,
  bwLimit: false,
  probe: 1,
});

export const defaultGen = (i: number): GenCfg => ({
  type: i === 0 ? 'sine' : i === 1 ? 'square' : 'off',
  freq: i === 0 ? 1000 : i === 1 ? 1000 : 10000,
  amp: 1,
  offset: 0,
  duty: 0.5,
  phase: 0,
  noise: 0,
});

export const DEFAULTS = {
  display: {
    persistence: 0,
    dots: false,
    grid: 'full',
    intensity: 0.85,
    xy: false,
    fft: false,
    fftSource: 0,
  } as DisplayCfg,
  acquisition: { mode: 'sample', avgCount: 16 } as AcqCfg,
  math: { enabled: false, op: 'A+B' } as MathCfg,
  cursors: {
    enabled: false,
    hA: 1, hB: -1,
    vA: 0, vB: 0,
    active: 'a',
  } as CursorsCfg,
};

/** Format an engineering value with SI prefix, e.g. 470e-6 s -> "470 µs" */
export function fmtEng(value: number, unit: string, digits = 3): string {
  if (!isFinite(value)) return '∞';
  if (value === 0) return `0 ${unit}`;
  const av = Math.abs(value);
  if (av >= 1e9) return `${(value / 1e9).toFixed(digits)} G${unit}`;
  if (av >= 1e6) return `${(value / 1e6).toFixed(digits)} M${unit}`;
  if (av >= 1e3) return `${(value / 1e3).toFixed(digits)} k${unit}`;
  if (av >= 1) return `${value.toFixed(digits)} ${unit}`;
  if (av >= 1e-3) return `${(value * 1e3).toFixed(digits)} m${unit}`;
  if (av >= 1e-6) return `${(value * 1e6).toFixed(digits)} µ${unit}`;
  if (av >= 1e-9) return `${(value * 1e9).toFixed(digits)} n${unit}`;
  if (av >= 1e-12) return `${(value * 1e12).toFixed(digits)} p${unit}`;
  return `${value.toExponential(2)} ${unit}`;
}

export function nearestStep(arr: number[], v: number): number {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < arr.length; i++) {
    const d = Math.abs(Math.log(arr[i]) - Math.log(Math.max(v, 1e-15)));
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

/** smallest step >= v */
export function ceilStep(arr: number[], v: number): number {
  for (const s of arr) if (s >= v) return s;
  return arr[arr.length - 1];
}
