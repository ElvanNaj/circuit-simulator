/**
 * Z-DSO 2104 — Oscilloscope Engine
 *
 * Pure-TypeScript instrument engine, UI-independent. Exposes a full command
 * API (`handleCommand`), a state snapshot (`getState`), an event bus and a
 * transport-agnostic command dispatcher used by window.postMessage and
 * BroadcastChannel bridges.
 */

import {
  AcqCfg, CH_NAMES, ChannelCfg, CursorsCfg, DEFAULTS, DISP_PTS, DisplayCfg,
  ExtMeta, GEN_PTS, GenCfg, MathCfg, MeasResult, TIME_STEPS, TriggerCfg,
  V_DIVS, VOLT_STEPS, WindowInfo, ceilStep, defaultChannel, defaultGen,
  emptyMeas, RenderState,
} from './types';

/* ------------------------------------------------------------------ */
/* Tiny event emitter                                                  */
/* ------------------------------------------------------------------ */
export class Emitter {
  private map = new Map<string, Set<(data?: unknown) => void>>();
  on(ev: string, cb: (data?: unknown) => void): void {
    if (!this.map.has(ev)) this.map.set(ev, new Set());
    this.map.get(ev)!.add(cb);
  }
  off(ev: string, cb: (data?: unknown) => void): void {
    this.map.get(ev)?.delete(cb);
  }
  emit(ev: string, data?: unknown): void {
    this.map.get(ev)?.forEach((cb) => {
      try { cb(data); } catch { /* listener error ignored */ }
    });
  }
}

/* ------------------------------------------------------------------ */
/* Waveform generation                                                 */
/* ------------------------------------------------------------------ */
function genValue(g: GenCfg, t: number): number {
  const ph = (g.phase * Math.PI) / 180;
  const w = 2 * Math.PI * g.freq;
  let v = 0;
  switch (g.type) {
    case 'off': return 0;
    case 'sine': v = Math.sin(w * t + ph); break;
    case 'square': {
      const frac = ((t * g.freq + g.phase / 360) % 1 + 1) % 1;
      v = frac < g.duty ? 1 : -1;
      break;
    }
    case 'pulse': {
      const frac = ((t * g.freq + g.phase / 360) % 1 + 1) % 1;
      v = frac < g.duty ? 1 : 0;
      break;
    }
    case 'triangle': {
      const frac = ((t * g.freq + g.phase / 360) % 1 + 1) % 1;
      v = frac < 0.25 ? frac * 4 : frac < 0.75 ? 2 - frac * 4 : frac * 4 - 4;
      break;
    }
    case 'sawtooth': {
      const frac = ((t * g.freq + g.phase / 360) % 1 + 1) % 1;
      v = frac * 2 - 1;
      break;
    }
    case 'dc': v = 1; break;
    case 'am': {
      const car = Math.sin(w * t + ph);
      const mod = Math.sin((w * t) / 20 + ph);
      v = car * (0.75 + 0.25 * mod);
      break;
    }
    case 'noise': v = 0; break;
  }
  let out = v * g.amp + g.offset;
  if (g.noise > 0) {
    const u1 = Math.max(Math.random(), 1e-12);
    const u2 = Math.random();
    out += Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * g.noise;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Measurements                                                        */
/* ------------------------------------------------------------------ */
export function measure(disp: Float32Array, dt: number): MeasResult {
  const m = emptyMeas();
  const n = disp.length;
  if (n < 8) return m;

  let vmax = -Infinity, vmin = Infinity, sum = 0, sq = 0;
  for (let i = 0; i < n; i++) {
    const v = disp[i];
    if (!isFinite(v)) return m;
    if (v > vmax) vmax = v;
    if (v < vmin) vmin = v;
    sum += v;
    sq += v * v;
  }
  const vavg = sum / n;
  m.vmax = vmax; m.vmin = vmin;
  m.vpp = vmax - vmin;
  m.vamp = m.vpp / 2;
  m.vavg = vavg;
  m.vrms = Math.sqrt(sq / n);
  if (m.vpp <= 1e-12) return m;

  // frequency / period / duty via hysteresis midpoint crossings
  const mid = (vmax + vmin) / 2;
  const h = m.vpp * 0.08;
  const riseT: number[] = [];
  const fallT: number[] = [];
  let armedRise = true, armedFall = true;
  for (let i = 1; i < n; i++) {
    const t = i * dt;
    if (armedRise && disp[i - 1] < mid - h && disp[i] >= mid - h) {
      riseT.push(t); armedRise = false; armedFall = true;
    } else if (armedFall && disp[i - 1] > mid + h && disp[i] <= mid + h) {
      fallT.push(t); armedFall = false; armedRise = true;
    }
  }

  if (riseT.length >= 2) {
    m.period = (riseT[riseT.length - 1] - riseT[0]) / (riseT.length - 1);
    m.freq = 1 / m.period;
  } else if (fallT.length >= 2) {
    m.period = (fallT[fallT.length - 1] - fallT[0]) / (fallT.length - 1);
    m.freq = 1 / m.period;
  }
  if (m.period > 0 && fallT.length >= 1 && riseT.length >= 1) {
    let dutySum = 0, cnt = 0;
    for (const rt of riseT) {
      let next = -1;
      for (const ft of fallT) { if (ft > rt) { next = ft; break; } }
      if (next > 0) { dutySum += (next - rt) / m.period; cnt++; }
    }
    if (cnt) m.duty = dutySum / cnt;
  }

  // rise / fall time (10% ↔ 90%)
  const lo = vmin + m.vpp * 0.1;
  const hi = vmin + m.vpp * 0.9;
  let rise = 0, fall = 0, riseFound = false, fallFound = false;
  let state: 0 | 1 | 2 = 0;
  let tLo = 0, tHi = 0;
  for (let i = 0; i < n; i++) {
    const v = disp[i];
    if (state === 0 && v >= lo && v <= hi) { state = 1; tLo = i * dt; }
    else if (state === 1 && v >= hi) { state = 2; tHi = i * dt; rise = tHi - tLo; riseFound = true; break; }
    else if (state === 1 && v < lo) { state = 0; }
  }
  state = 0;
  for (let i = 0; i < n; i++) {
    const v = disp[i];
    if (state === 0 && v <= hi && v >= lo) { state = 1; tHi = i * dt; }
    else if (state === 1 && v <= lo) { state = 2; tLo = i * dt; fall = tLo - tHi; fallFound = true; break; }
    else if (state === 1 && v > hi) { state = 0; }
  }
  m.rise = riseFound ? rise : 0;
  m.fall = fallFound ? fall : 0;
  m.valid = true;
  return m;
}

/* ------------------------------------------------------------------ */
/* FFT (radix-2, Hann window)                                          */
/* ------------------------------------------------------------------ */
export function fftMagDb(samples: Float32Array): { db: Float32Array; fRes: number } {
  const N = samples.length; // power of two
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
    re[i] = samples[i] * w;
  }
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < N; i += len) {
      let curRe = 1, curIm = 0;
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k], uIm = im[i + k];
        const oRe = re[i + k + len / 2], oIm = im[i + k + len / 2];
        const vRe = oRe * curRe - oIm * curIm;
        const vIm = oRe * curIm + oIm * curRe;
        re[i + k] = uRe + vRe; im[i + k] = uIm + vIm;
        re[i + k + len / 2] = uRe - vRe; im[i + k + len / 2] = uIm - vIm;
        const nRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe; curRe = nRe;
      }
    }
  }
  const db = new Float32Array(N / 2);
  for (let k = 0; k < N / 2; k++) {
    const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]) / (N / 2);
    db[k] = mag > 1e-9 ? 20 * Math.log10(mag) : -180;
  }
  return { db, fRes: 1 / N }; // × real sample rate by caller
}

/* ------------------------------------------------------------------ */
/* Engine                                                              */
/* ------------------------------------------------------------------ */
interface ChRuntime {
  cfg: ChannelCfg;
  gen: GenCfg;
  lastGen: GenCfg | null;
  ext: Float32Array | null;
  extRate: number;
  extT0: number;
  extAlign: NonNullable<ExtMeta['align']>;
  disp: Float32Array;
  peakLo: Float32Array | null;
  peakHi: Float32Array | null;
  genBuf: Float32Array;
  genT0: number;
  genDt: number;
  natT0: number;
  avgRing: Float32Array[];
  meas: MeasResult;
}

export type CommandResult = { ok: true; data?: unknown } | { ok: false; error: string };

export class OscEngine extends Emitter {
  static readonly VERSION = '1.0.0';
  static readonly MODEL = 'Z-DSO 2104';
  /** instance-level aliases so `window.OSC.version` is discoverable */
  version = OscEngine.VERSION;
  model = OscEngine.MODEL;

  channels: ChRuntime[] = [];
  trig: TriggerCfg = { source: 0, level: 0, edge: 'rising', sweep: 'auto' };
  time: { timeDiv: number; hOffset: number; trigPos: number } = {
    timeDiv: 5e-4, hOffset: 0, trigPos: 0.5,
  };
  display: DisplayCfg = { ...DEFAULTS.display };
  acq: AcqCfg = { ...DEFAULTS.acquisition };
  math: MathCfg = { ...DEFAULTS.math };
  cursors: CursorsCfg = { ...DEFAULTS.cursors };
  running = true;
  armed = false;
  powerOn = true;
  simTime = 0;
  trigFound = false;
  trigX = 0.5;
  trigStatus: RenderState['trigStatus'] = 'AUTO';
  fftResult: { db: Float32Array; fMin: number; fMax: number; src: number } | null = null;

  private avgIdx = 0;
  private lastFrame = 0;
  private rafId = 0;
  private ownLoop = false;
  private disposed = false;
  private lastEvtBroadcast = 0;
  private heartbeat = 0;
  private lastWinT0 = 0;
  private mathBuf: Float32Array | null = null;
  private commands: Record<string, (...args: never[]) => unknown> = {};

  constructor() {
    super();
    for (let i = 0; i < 4; i++) {
      this.channels.push({
        cfg: defaultChannel(i),
        gen: defaultGen(i),
        lastGen: null,
        ext: null, extRate: 0, extT0: 0, extAlign: 'none',
        disp: new Float32Array(DISP_PTS),
        peakLo: null, peakHi: null,
        genBuf: new Float32Array(GEN_PTS + 1),
        genT0: 0, genDt: 1, natT0: 0,
        avgRing: [],
        meas: emptyMeas(),
      });
    }
    this.initCommands();
  }

  /* ---------------- lifecycle ---------------- */
  start(): void {
    if (this.ownLoop) return;
    this.disposed = false; // allow restart after dispose()
    this.ownLoop = true;
    this.lastFrame = 0;
    const loop = (ts: number) => {
      if (this.disposed) return;
      if (!this.lastFrame) this.lastFrame = ts;
      const dt = Math.min((ts - this.lastFrame) / 1000, 0.05);
      this.lastFrame = ts;
      this.tick(dt);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.ownLoop = false;
  }

  /** advance the simulation by dt seconds; call from an external render loop */
  tick(dt: number): void {
    if (this.running && !this.armed) this.simTime += dt;
    this.acquire();
    this.heartbeat += dt;
    if (this.heartbeat > 1) {
      this.heartbeat = 0;
      this.emit('heartbeat', { t: this.simTime, running: this.running });
    }
    this.maybeEmitState();
  }

  /** total seconds shown across the 10 horizontal divisions (public: UI reads it) */
  get windowDur(): number { return this.time.timeDiv * 10; }

  /* ---------------- acquisition ---------------- */
  private applyChannelTransform(rt: ChRuntime, raw: Float32Array, out: Float32Array): void {
    const cfg = rt.cfg;
    const n = Math.min(raw.length, out.length);
    let mean = 0;
    if (cfg.coupling === 'AC') {
      for (let i = 0; i < n; i++) mean += raw[i];
      mean /= n;
    }
    let prev = raw[0];
    const a = cfg.bwLimit ? 0.55 : 1;
    for (let i = 0; i < n; i++) {
      let v = raw[i];
      if (cfg.coupling === 'AC') v -= mean;
      if (cfg.coupling === 'GND') { out[i] = 0; prev = 0; continue; }
      if (cfg.bwLimit) { v = prev + a * (v - prev); prev = v; }
      v *= cfg.probe;
      if (cfg.invert) v = -v;
      out[i] = v;
    }
  }

  /** natural window start for a channel */
  private naturalT0(rt: ChRuntime): number {
    const win = this.windowDur;
    if (!rt.ext) return this.simTime - win;
    const rate = rt.extRate > 0 ? rt.extRate : DISP_PTS / win;
    const dur = (rt.ext.length - 1) / rate;
    switch (rt.extAlign) {
      case 'none': return rt.extT0 + dur - win;
      case 'center': return rt.extT0 + (dur - win) / 2;
      case 'trigger': return rt.extT0 + dur - win;
    }
  }

  private buildWindow(rt: ChRuntime, t0w: number, wDur: number): WindowInfo {
    const out = rt.disp;
    const n = out.length;
    if (rt.ext) {
      const buf = rt.ext;
      const rate = rt.extRate > 0 ? rt.extRate : n / wDur;
      const tStart = rt.extT0;
      for (let i = 0; i < n; i++) {
        const t = t0w + (i / (n - 1)) * wDur;
        const idx = (t - tStart) * rate;
        if (idx <= 0) out[i] = buf[0];
        else if (idx >= buf.length - 1) out[i] = buf[buf.length - 1];
        else {
          const i0 = Math.floor(idx);
          const f = idx - i0;
          out[i] = buf[i0] * (1 - f) + buf[i0 + 1] * f;
        }
      }
    } else if (rt.gen.type === 'off') {
      out.fill(0);
    } else {
      const tEnd = rt.genT0 + GEN_PTS * rt.genDt;
      for (let i = 0; i < n; i++) {
        const t = Math.max(rt.genT0, Math.min(tEnd, t0w + (i / (n - 1)) * wDur));
        const idx = (t - rt.genT0) / rt.genDt;
        const i0 = Math.floor(idx);
        const f = idx - i0;
        const b = rt.genBuf;
        out[i] = b[i0] * (1 - f) + b[Math.min(b.length - 1, i0 + 1)] * f;
      }
    }
    this.applyChannelTransform(rt, out, out);
    return { t0: t0w, dt: wDur / (n - 1), window: wDur };
  }

  private searchTrigger(d: Float32Array, w: WindowInfo): number {
    const n = d.length;
    const level = this.trig.level;
    const h = Math.max(1e-9, Math.abs(level) * 0.02 + 1e-4);
    const rising = this.trig.edge === 'rising';
    let armed = false;
    for (let i = 1; i < n; i++) {
      if (rising) {
        if (!armed && d[i - 1] < level - h) armed = true;
        if (armed && d[i] >= level) return w.t0 + i * w.dt;
      } else {
        if (!armed && d[i - 1] > level + h) armed = true;
        if (armed && d[i] <= level) return w.t0 + i * w.dt;
      }
    }
    return NaN;
  }

  private acquire(): void {
    const win = this.windowDur;
    const tNow = this.simTime;

    // 1) refresh internal generation buffers: coverage [tNow - 2*win, tNow + win]
    for (const rt of this.channels) {
      if (rt.cfg.enabled && !rt.ext && rt.gen.type !== 'off') {
        const t0 = tNow - 2 * win;
        const dt = (3 * win) / GEN_PTS;
        const buf = rt.genBuf;
        for (let i = 0; i <= GEN_PTS; i++) buf[i] = genValue(rt.gen, t0 + i * dt);
        rt.genT0 = t0;
        rt.genDt = dt;
      }
    }

    // 2) build each channel's natural window
    for (const rt of this.channels) {
      if (!rt.cfg.enabled) continue;
      rt.natT0 = this.naturalT0(rt);
      this.buildWindow(rt, rt.natT0, win);
    }

    // 3) trigger search on source (only if source can be trigger-aligned)
    const srcRt = this.channels[Math.max(0, Math.min(3, this.trig.source))];
    const alignable = !srcRt.ext || srcRt.extAlign === 'trigger';
    let trigTime = NaN;
    if (alignable && srcRt.cfg.enabled) {
      trigTime = this.searchTrigger(srcRt.disp, { t0: srcRt.natT0, dt: win / (DISP_PTS - 1), window: win });
      if (isFinite(trigTime)) this.trigFound = true;
      else this.trigFound = false;
    } else {
      this.trigFound = false;
    }

    // 4) decide final t0 per channel
    let finalT0 = tNow - win + this.time.hOffset;
    if (this.trigFound) {
      let t0 = trigTime - this.time.trigPos * win;
      if (!srcRt.ext) {
        const minT0 = srcRt.genT0;
        const maxT0 = srcRt.genT0 + GEN_PTS * srcRt.genDt - win;
        t0 = Math.max(minT0, Math.min(maxT0, t0));
      }
      finalT0 = t0 + this.time.hOffset;
    }
    this.lastWinT0 = finalT0;

    for (const rt of this.channels) {
      if (!rt.cfg.enabled) { rt.meas = emptyMeas(); rt.peakLo = null; rt.peakHi = null; continue; }
      const useAligned = this.trigFound && (!rt.ext || rt.extAlign === 'trigger');
      const t0ch = useAligned ? finalT0 : this.naturalT0(rt);
      this.buildWindow(rt, t0ch, win);

      // peak-detect envelope (internal sources only)
      if (this.acq.mode === 'peak' && !rt.ext && rt.gen.type !== 'off') {
        const per = DISP_PTS * 2;
        const lo = new Float32Array(per);
        const hi = new Float32Array(per);
        const covStart = rt.genT0;
        const covEnd = rt.genT0 + GEN_PTS * rt.genDt;
        for (let c = 0; c < per; c++) {
          const t = Math.max(covStart, Math.min(covEnd, t0ch + (c / (per - 1)) * win));
          const i0 = Math.max(0, Math.min(GEN_PTS - 1, Math.floor((t - rt.genT0) / rt.genDt)));
          let mn = Infinity, mx = -Infinity;
          for (let k = -2; k <= 2; k++) {
            const v = rt.genBuf[Math.max(0, Math.min(GEN_PTS, i0 + k))];
            if (v < mn) mn = v;
            if (v > mx) mx = v;
          }
          lo[c] = mn; hi[c] = mx;
        }
        rt.peakLo = lo; rt.peakHi = hi;
      } else {
        rt.peakLo = null; rt.peakHi = null;
      }

      // averaging
      if (this.acq.mode === 'average') {
        if (rt.avgRing.length !== this.acq.avgCount) {
          rt.avgRing = Array.from({ length: this.acq.avgCount }, () => new Float32Array(rt.disp));
        } else {
          rt.avgRing[this.avgIdx].set(rt.disp);
        }
        const out = rt.disp;
        for (let i = 0; i < out.length; i++) {
          let s = 0;
          for (const frame of rt.avgRing) s += frame[i];
          out[i] = s / this.acq.avgCount;
        }
      } else if (rt.avgRing.length) {
        rt.avgRing = [];
      }

      rt.meas = measure(rt.disp, win / (DISP_PTS - 1));
    }
    if (this.acq.mode === 'average') this.avgIdx = (this.avgIdx + 1) % this.acq.avgCount;

    // 5) math
    if (this.math.enabled && this.channels[0].cfg.enabled && this.channels[1].cfg.enabled) {
      const a = this.channels[0].disp, b = this.channels[1].disp;
      const m = new Float32Array(DISP_PTS);
      for (let i = 0; i < DISP_PTS; i++) {
        m[i] = this.math.op === 'A+B' ? a[i] + b[i] : this.math.op === 'A-B' ? a[i] - b[i] : a[i] * b[i];
      }
      this.mathBuf = m;
    } else this.mathBuf = null;

    // 6) FFT
    if (this.display.fft && !this.display.xy) {
      const src = this.channels[Math.max(0, Math.min(3, this.display.fftSource))];
      if (src.cfg.enabled) {
        const N = 1024;
        const inp = new Float32Array(N);
        const step = DISP_PTS / N;
        for (let i = 0; i < N; i++) inp[i] = src.disp[Math.floor(i * step)];
        const { db } = fftMagDb(inp);
        const fs = (DISP_PTS - 1) / win;
        this.fftResult = { db, fMin: 0, fMax: fs / 2, src: this.display.fftSource };
      } else this.fftResult = null;
    } else this.fftResult = null;

    // 7) trigger status + single capture
    if (!this.running) this.trigStatus = 'STOP';
    else if (this.armed) this.trigStatus = this.trigFound ? "TRIG'D" : 'WAIT';
    else if (this.trigFound) this.trigStatus = "TRIG'D";
    else this.trigStatus = this.trig.sweep === 'auto' ? 'AUTO' : 'TRIG?';

    this.trigX = this.trigFound ? (trigTime - finalT0) / win : this.time.trigPos;

    if (this.armed && this.trigFound) {
      this.armed = false;
      this.running = false;
      this.emit('single-captured', { time: trigTime });
      this.emit('stopped', { reason: 'single' });
    }
  }

  /* ---------------- render state ---------------- */
  getView(): RenderState {
    return {
      channels: this.channels.map((rt) => ({
        disp: rt.disp, peakLo: rt.peakLo, peakHi: rt.peakHi, cfg: rt.cfg,
      })),
      math: this.mathBuf ? { disp: this.mathBuf, cfg: this.math } : null,
      win: { t0: this.lastWinT0, dt: this.windowDur / (DISP_PTS - 1), window: this.windowDur },
      trig: {
        found: this.trigFound,
        x: Math.max(0, Math.min(1, this.trigX)),
        time: this.lastWinT0 + this.trigX * this.windowDur,
        level: this.trig.level,
        source: this.trig.source,
        edge: this.trig.edge,
      },
      trigStatus: this.trigStatus,
      running: this.running,
      armed: this.armed,
      simTime: this.simTime,
    };
  }

  getMeasurements(ch?: number): Record<string, MeasResult> {
    const out: Record<string, MeasResult> = {};
    if (ch === undefined) {
      for (let i = 0; i < 4; i++) out[CH_NAMES[i]] = { ...this.channels[i].meas };
    } else {
      const rt = this.channels[ch];
      if (!rt) throw new Error(`channel index ${ch} out of range 0..3`);
      out[CH_NAMES[ch]] = { ...rt.meas };
    }
    return out;
  }

  getState(): Record<string, unknown> {
    return {
      model: OscEngine.MODEL,
      version: OscEngine.VERSION,
      running: this.running,
      armed: this.armed,
      powerOn: this.powerOn,
      simTime: this.simTime,
      channels: this.channels.map((rt, i) => ({
        name: CH_NAMES[i],
        cfg: { ...rt.cfg },
        generator: { ...rt.gen },
        source: rt.ext ? 'external' : 'internal-generator',
        extSamples: rt.ext ? rt.ext.length : 0,
        extSampleRate: rt.extRate,
        measurements: { ...rt.meas },
      })),
      horizontal: { ...this.time },
      trigger: { ...this.trig },
      display: { ...this.display },
      acquisition: { ...this.acq },
      math: { ...this.math },
      cursors: { ...this.cursors },
    };
  }

  /* ---------------- public API commands ---------------- */
  run(): void {
    this.running = true; this.armed = false;
    this.emit('run', { running: true });
    this.maybeEmitState(true);
  }
  stop(): void {
    this.running = false; this.armed = false;
    this.emit('stopped', { reason: 'manual' });
    this.maybeEmitState(true);
  }
  single(): void {
    this.running = true; this.armed = true;
    this.emit('arm', {});
    this.maybeEmitState(true);
  }
  forceTrigger(): void {
    this.trigFound = true;
    this.emit('force-trigger', {});
  }
  setPower(on: boolean): void {
    this.powerOn = !!on;
    this.emit('power-changed', { on: this.powerOn });
    this.maybeEmitState(true);
  }

  /* interactive nudges (used by knobs & screen drag; also scriptable) */
  nudgeHOffset(ds: number): void {
    const win = this.windowDur;
    this.time.hOffset = Math.max(-win * 5, Math.min(win * 5, this.time.hOffset + ds));
  }
  nudgeTriggerLevel(dv: number): void {
    this.trig.level += dv;
  }
  nudgeChannelOffset(ch: number, dv: number): void {
    const rt = this.channels[ch];
    if (!rt) return;
    rt.cfg.offset = Math.max(-4 * rt.cfg.voltsDiv, Math.min(4 * rt.cfg.voltsDiv, rt.cfg.offset + dv));
  }
  nudgeCursor(key: 'vA' | 'vB' | 'hA' | 'hB', d: number): void {
    this.cursors[key] += d;
  }

  setChannel(ch: number, cfg: Partial<ChannelCfg>): void {
    const rt = this.channels[ch];
    if (!rt) throw new Error(`channel index ${ch} out of range 0..3`);
    Object.assign(rt.cfg, cfg);
    this.emit('channel-changed', { ch, cfg: { ...rt.cfg } });
    this.maybeEmitState(true);
  }

  setHorizontal(cfg: { timeDiv?: number; hOffset?: number; trigPos?: number }): void {
    if (cfg.timeDiv !== undefined) this.time.timeDiv = ceilStep(TIME_STEPS, cfg.timeDiv);
    if (cfg.hOffset !== undefined) this.time.hOffset = cfg.hOffset;
    if (cfg.trigPos !== undefined) this.time.trigPos = Math.max(0, Math.min(1, cfg.trigPos));
    this.emit('horizontal-changed', { ...this.time });
    this.maybeEmitState(true);
  }

  setTrigger(cfg: Partial<TriggerCfg>): void {
    Object.assign(this.trig, cfg);
    this.emit('trigger-changed', { ...this.trig });
    this.maybeEmitState(true);
  }

  setDisplay(cfg: Partial<DisplayCfg>): void {
    Object.assign(this.display, cfg);
    this.emit('display-changed', { ...this.display });
    this.maybeEmitState(true);
  }

  setAcquisition(cfg: Partial<AcqCfg>): void {
    Object.assign(this.acq, cfg);
    if (cfg.avgCount !== undefined) this.channels.forEach((rt) => (rt.avgRing = []));
    this.emit('acquisition-changed', { ...this.acq });
    this.maybeEmitState(true);
  }

  setMath(cfg: Partial<MathCfg>): void {
    Object.assign(this.math, cfg);
    this.emit('math-changed', { ...this.math });
    this.maybeEmitState(true);
  }

  setCursors(cfg: Partial<CursorsCfg>): void {
    Object.assign(this.cursors, cfg);
    this.emit('cursors-changed', { ...this.cursors });
    this.maybeEmitState(true);
  }

  setGenerator(ch: number, cfg: Partial<GenCfg>): void {
    const rt = this.channels[ch];
    if (!rt) throw new Error(`channel index ${ch} out of range 0..3`);
    Object.assign(rt.gen, cfg);
    if (rt.gen.type !== 'off' && rt.ext) {
      rt.ext = null; rt.extRate = 0; // generator takes over the input
    }
    this.emit('generator-changed', { ch, gen: { ...rt.gen } });
    this.maybeEmitState(true);
  }

  getChannel(ch: number): Record<string, unknown> {
    const rt = this.channels[ch];
    if (!rt) throw new Error(`channel index ${ch} out of range 0..3`);
    return {
      name: CH_NAMES[ch], cfg: { ...rt.cfg }, generator: { ...rt.gen },
      source: rt.ext ? 'external' : 'internal-generator',
      extSamples: rt.ext ? rt.ext.length : 0,
      measurements: { ...rt.meas },
    };
  }

  getGenerator(ch: number): GenCfg {
    const rt = this.channels[ch];
    if (!rt) throw new Error(`channel index ${ch} out of range 0..3`);
    return { ...rt.gen };
  }

  /** Feed external waveform data (e.g. from a circuit simulator). */
  setChannelData(ch: number, samples: number[] | Float32Array, meta?: ExtMeta): void {
    const rt = this.channels[ch];
    if (!rt) throw new Error(`channel index ${ch} out of range 0..3`);
    const buf = samples instanceof Float32Array ? samples : Float32Array.from(samples);
    if (buf.length < 2) throw new Error('need at least 2 samples');
    const rate = meta?.sampleRate ?? DISP_PTS / this.windowDur;
    if (rt.gen.type !== 'off' && !rt.lastGen) rt.lastGen = { ...rt.gen };
    rt.ext = buf;
    rt.extRate = rate;
    rt.extT0 = meta?.tStart ?? this.simTime - (buf.length - 1) / rate;
    rt.extAlign = meta?.align ?? 'none';
    rt.gen.type = 'off';
    if (!rt.cfg.enabled) rt.cfg.enabled = true;
    this.emit('data-received', { ch, samples: buf.length, sampleRate: rate });
  }

  clearChannelData(ch: number): void {
    const rt = this.channels[ch];
    if (!rt) throw new Error(`channel index ${ch} out of range 0..3`);
    rt.ext = null;
    rt.extRate = 0;
    if (rt.lastGen) {
      rt.gen = { ...rt.lastGen };
      rt.lastGen = null;
    }
    this.emit('data-cleared', { ch });
    this.maybeEmitState(true);
  }

  autoSet(): void {
    let ch = this.channels.findIndex((rt) => rt.cfg.enabled);
    if (ch < 0) { this.setChannel(0, { enabled: true }); ch = 0; }
    const rt = this.channels[ch];
    const m = rt.meas.valid ? rt.meas : measure(rt.disp, this.windowDur / (DISP_PTS - 1));
    const vpp = m.vpp > 1e-9 ? m.vpp : rt.gen.type !== 'off' ? 2 * rt.gen.amp : 1;
    const targetDiv = vpp / (V_DIVS * 0.6);
    this.setChannel(ch, { voltsDiv: ceilStep(VOLT_STEPS, targetDiv), offset: 0 });
    const per = m.freq > 0 ? 1 / m.freq : 0;
    const wantWin = per > 0 ? per * 2.5 : 1e-2;
    this.setHorizontal({ timeDiv: wantWin / 10, hOffset: 0, trigPos: 0.5 });
    this.setTrigger({
      source: ch,
      level: rt.gen.type !== 'off' && !rt.ext ? rt.gen.offset : (m.vmax + m.vmin) / 2,
      edge: 'rising', sweep: 'auto',
    });
    this.run();
    this.emit('autoset', { channel: ch });
  }

  /* ---------------- command dispatch (transport layer) ---------------- */
  private initCommands(): void {
    const self = this as unknown as Record<string, unknown>;
    const fn = (name: string) => {
      const f = self[name];
      if (typeof f !== 'function') throw new Error(`missing method ${name}`);
      return (f as (...a: never[]) => unknown).bind(this);
    };
    this.commands = {
      run: fn('run'), stop: fn('stop'), single: fn('single'),
      forceTrigger: fn('forceTrigger'), autoSet: fn('autoSet'),
      setChannel: fn('setChannel'), setChannelData: fn('setChannelData'),
      clearChannelData: fn('clearChannelData'),
      setHorizontal: fn('setHorizontal'), setTrigger: fn('setTrigger'),
      setDisplay: fn('setDisplay'), setAcquisition: fn('setAcquisition'),
      setMath: fn('setMath'), setCursors: fn('setCursors'),
      setGenerator: fn('setGenerator'), setPower: fn('setPower'),
      getChannel: fn('getChannel'), getGenerator: fn('getGenerator'),
      getMeasurements: fn('getMeasurements'), getState: fn('getState'),
      help: fn('help'),
    };
  }

  handleCommand(cmd: string, args: unknown[] = []): CommandResult {
    try {
      const f = this.commands[cmd];
      if (!f) return { ok: false, error: `unknown command "${cmd}" (try "help")` };
      const data = f(...(args as never[]));
      return { ok: true, data: data ?? null };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  help(): unknown {
    return {
      model: OscEngine.MODEL,
      transports: ['window.OSC (direct JS)', 'window.postMessage', "BroadcastChannel('osc-bridge')"],
      commands: {
        setChannelData: ['ch 0..3', 'samples number[]', 'meta? {sampleRate?, tStart?, align?: none|trigger|center}'],
        clearChannelData: ['ch'],
        setChannel: ['ch', '{enabled?, voltsDiv?, offset?, coupling?: DC|AC|GND, invert?, bwLimit?, probe?: 1|10}'],
        setGenerator: ['ch', '{type?: off|sine|square|triangle|sawtooth|pulse|dc|noise|am, freq?, amp?, offset?, duty?, phase?, noise?}'],
        setHorizontal: ['{timeDiv?, hOffset?, trigPos?}'],
        setTrigger: ['{source?, level?, edge?: rising|falling, sweep?: auto|normal|single}'],
        setDisplay: ['{persistence?, dots?, grid?: full|half|none, intensity?, xy?, fft?, fftSource?}'],
        setAcquisition: ['{mode?: sample|peak|average, avgCount?}'],
        setMath: ['{enabled?, op?: A+B|A-B|A*B}'],
        setCursors: ['{enabled?, hA?, hB?, vA?, vB?, active?: a|b}'],
        setPower: ['boolean'],
        run: [], stop: [], single: [], forceTrigger: [], autoSet: [],
        getChannel: ['ch'], getGenerator: ['ch'], getMeasurements: ['ch?'], getState: [],
        help: [],
      },
      units: 'volts & seconds; frequency Hz; sampleRate samples/second',
    };
  }

  /* ---------------- throttled state event ---------------- */
  private lastStateHash = '';
  /**
   * Emit the `state` event so the React UI re-syncs.
   *
   * `force = true` bypasses the throttle — used by every public setter so a
   * toggle press is reflected on the front panel immediately (the same tick).
   * Without force the call is throttled to ~4×/s and only fires when the
   * full state hash changed (used by the per-frame tick and drag nudges).
   */
  private maybeEmitState(force = false): void {
    const now = performance.now();
    if (!force && now - this.lastEvtBroadcast < 250) return;
    // hash EVERYTHING the front panel displays — a partial hash used to hide
    // changes (invert / coupling / probe / bw / gen freq-amp-offset / hOffset)
    // so toggles appeared dead on the UI.
    const s = JSON.stringify([
      this.running, this.armed, this.powerOn, this.trigStatus,
      this.channels.map((rt) => [rt.cfg, rt.gen, rt.ext ? rt.ext.length : 0]),
      this.time, this.trig, this.display, this.acq, this.math, this.cursors,
    ]);
    if (force || s !== this.lastStateHash) {
      this.lastStateHash = s;
      this.lastEvtBroadcast = now;
      this.emit('state', this.getState());
    }
  }
}
