/* ============================================================================
 * Z-DSO 2104 — Virtual Digital Storage Oscilloscope ENGINE (standalone, no build)
 * ----------------------------------------------------------------------------
 * Pure-JavaScript instrument engine, UI-independent. Exposes:
 *   - full command API  -> engine.handleCommand(cmd, args)
 *   - state snapshot    -> engine.getState()
 *   - event bus         -> engine.on('state'|'heartbeat'|..., cb)
 *   - transports        -> window.OSC (direct), window.postMessage, BroadcastChannel("osc-bridge")
 * Units: volts & seconds; frequency in Hz. Channels are indexed 0..3 (CH1..CH4).
 * ==========================================================================*/
(function (global) {
  'use strict';

  /* ---------------- constants ---------------- */
  var H_DIVS = 10, V_DIVS = 8;
  var DISP_PTS = 1200;   // display points across screen width
  var GEN_PTS = 7200;    // internal generation resolution (6x oversample)
  var SCREEN_W = 800, SCREEN_H = 480;

  var VOLT_STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];
  var TIME_STEPS = [
    1e-8, 2e-8, 5e-8, 1e-7, 2e-7, 5e-7, 1e-6, 2e-6, 5e-6,
    1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 5e-3,
    0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10
  ];
  var FREQ_STEPS = [
    0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500,
    1e3, 2e3, 5e3, 1e4, 2e4, 5e4, 1e5, 2e5, 5e5, 1e6, 2e6, 5e6, 1e7, 2e7
  ];

  var CH_COLORS = ['#f5c518', '#3fd8e8', '#ea5be0', '#48e07a'];
  var CH_NAMES = ['CH1', 'CH2', 'CH3', 'CH4'];
  var MATH_COLOR = '#9d7bff', FFT_COLOR = '#ff9d45';
  var CURSOR_A_COLOR = '#ff5fd2', CURSOR_B_COLOR = '#ffa53d';

  var DEFAULTS = {
    display: { persistence: 0, dots: false, grid: 'full', intensity: 0.85, xy: false, fft: false, fftSource: 0 },
    acq: { mode: 'sample', avgCount: 16 },
    math: { enabled: false, op: 'A+B' },
    cursors: { enabled: false, hA: 1, hB: -1, vA: 0, vB: 0, active: 'a' }
  };

  function emptyMeas() {
    return { vpp: 0, vmax: 0, vmin: 0, vamp: 0, vavg: 0, vrms: 0, freq: 0, period: 0, duty: 0, rise: 0, fall: 0, valid: false };
  }
  function defaultChannel(i) {
    return { enabled: i < 2, voltsDiv: i === 0 ? 0.5 : i === 1 ? 0.5 : 0.1, offset: 0, coupling: 'DC', invert: false, bwLimit: false, probe: 1 };
  }
  function defaultGen(i) {
    return { type: i === 0 ? 'sine' : i === 1 ? 'square' : 'off', freq: i === 0 ? 1000 : i === 1 ? 1000 : 10000, amp: 1, offset: 0, duty: 0.5, phase: 0, noise: 0 };
  }

  /** Format an engineering value with SI prefix, e.g. 470e-6 s -> "470 µs" */
  function fmtEng(value, unit, digits) {
    if (digits === undefined) digits = 3;
    if (!isFinite(value)) return '∞';
    if (value === 0) return '0 ' + unit;
    var av = Math.abs(value);
    if (av >= 1e9) return (value / 1e9).toFixed(digits) + ' G' + unit;
    if (av >= 1e6) return (value / 1e6).toFixed(digits) + ' M' + unit;
    if (av >= 1e3) return (value / 1e3).toFixed(digits) + ' k' + unit;
    if (av >= 1) return value.toFixed(digits) + ' ' + unit;
    if (av >= 1e-3) return (value * 1e3).toFixed(digits) + ' m' + unit;
    if (av >= 1e-6) return (value * 1e6).toFixed(digits) + ' µ' + unit;
    if (av >= 1e-9) return (value * 1e9).toFixed(digits) + ' n' + unit;
    if (av >= 1e-12) return (value * 1e12).toFixed(digits) + ' p' + unit;
    return value.toExponential(2) + ' ' + unit;
  }

  function nearestStep(arr, v) {
    var best = 0, bd = Infinity;
    for (var i = 0; i < arr.length; i++) {
      var d = Math.abs(Math.log(arr[i]) - Math.log(Math.max(v, 1e-15)));
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }
  /** smallest step >= v */
  function ceilStep(arr, v) {
    for (var i = 0; i < arr.length; i++) if (arr[i] >= v) return arr[i];
    return arr[arr.length - 1];
  }

  /* ---------------- tiny event emitter ---------------- */
  function Emitter() { this.map = new Map(); }
  Emitter.prototype.on = function (ev, cb) {
    if (!this.map.has(ev)) this.map.set(ev, new Set());
    this.map.get(ev).add(cb);
  };
  Emitter.prototype.off = function (ev, cb) {
    var s = this.map.get(ev); if (s) s.delete(cb);
  };
  Emitter.prototype.emit = function (ev, data) {
    var s = this.map.get(ev);
    if (!s) return;
    s.forEach(function (cb) { try { cb(data); } catch (e) { /* listener error ignored */ } });
  };

  /* ---------------- waveform generation ---------------- */
  function genValue(g, t) {
    var ph = (g.phase * Math.PI) / 180;
    var w = 2 * Math.PI * g.freq;
    var v = 0;
    switch (g.type) {
      case 'off': return 0;
      case 'sine': v = Math.sin(w * t + ph); break;
      case 'square': {
        var fq = (((t * g.freq + g.phase / 360) % 1) + 1) % 1;
        v = fq < g.duty ? 1 : -1; break;
      }
      case 'pulse': {
        var fp = (((t * g.freq + g.phase / 360) % 1) + 1) % 1;
        v = fp < g.duty ? 1 : 0; break;
      }
      case 'triangle': {
        var ft = (((t * g.freq + g.phase / 360) % 1) + 1) % 1;
        v = ft < 0.25 ? ft * 4 : ft < 0.75 ? 2 - ft * 4 : ft * 4 - 4; break;
      }
      case 'sawtooth': {
        var fs = (((t * g.freq + g.phase / 360) % 1) + 1) % 1;
        v = fs * 2 - 1; break;
      }
      case 'dc': v = 1; break;
      case 'am': {
        var car = Math.sin(w * t + ph);
        var mod = Math.sin((w * t) / 20 + ph);
        v = car * (0.75 + 0.25 * mod); break;
      }
      case 'noise': v = 0; break;
    }
    var out = v * g.amp + g.offset;
    if (g.noise > 0) {
      var u1 = Math.max(Math.random(), 1e-12);
      var u2 = Math.random();
      out += Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * g.noise;
    }
    return out;
  }

  /* ---------------- measurements ---------------- */
  function measure(disp, dt) {
    var m = emptyMeas();
    var n = disp.length;
    if (n < 8) return m;
    var vmax = -Infinity, vmin = Infinity, sum = 0, sq = 0, i, v;
    for (i = 0; i < n; i++) {
      v = disp[i];
      if (!isFinite(v)) return m;
      if (v > vmax) vmax = v;
      if (v < vmin) vmin = v;
      sum += v; sq += v * v;
    }
    m.vmax = vmax; m.vmin = vmin;
    m.vpp = vmax - vmin;
    m.vamp = m.vpp / 2;
    m.vavg = sum / n;
    m.vrms = Math.sqrt(sq / n);
    if (m.vpp <= 1e-12) return m;

    // frequency / period / duty via hysteresis midpoint crossings
    var mid = (vmax + vmin) / 2;
    var h = m.vpp * 0.08;
    var riseT = [], fallT = [];
    var armedRise = true, armedFall = true;
    for (i = 1; i < n; i++) {
      var t = i * dt;
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
      var dutySum = 0, cnt = 0, ri, fi;
      for (ri = 0; ri < riseT.length; ri++) {
        var next = -1;
        for (fi = 0; fi < fallT.length; fi++) { if (fallT[fi] > riseT[ri]) { next = fallT[fi]; break; } }
        if (next > 0) { dutySum += (next - riseT[ri]) / m.period; cnt++; }
      }
      if (cnt) m.duty = dutySum / cnt;
    }

    // rise / fall time (10% <-> 90%)
    var lo = vmin + m.vpp * 0.1;
    var hi = vmin + m.vpp * 0.9;
    var rise = 0, fall = 0, riseFound = false, fallFound = false;
    var state = 0, tLo = 0, tHi = 0;
    for (i = 0; i < n; i++) {
      v = disp[i];
      if (state === 0 && v >= lo && v <= hi) { state = 1; tLo = i * dt; }
      else if (state === 1 && v >= hi) { state = 2; tHi = i * dt; rise = tHi - tLo; riseFound = true; break; }
      else if (state === 1 && v < lo) { state = 0; }
    }
    state = 0;
    for (i = 0; i < n; i++) {
      v = disp[i];
      if (state === 0 && v <= hi && v >= lo) { state = 1; tHi = i * dt; }
      else if (state === 1 && v <= lo) { state = 2; tLo = i * dt; fall = tLo - tHi; fallFound = true; break; }
      else if (state === 1 && v > hi) { state = 0; }
    }
    m.rise = riseFound ? rise : 0;
    m.fall = fallFound ? fall : 0;
    m.valid = true;
    return m;
  }

  /* ---------------- FFT (radix-2, Hann window) ---------------- */
  function fftMagDb(samples) {
    var N = samples.length; // power of two
    var re = new Float64Array(N), im = new Float64Array(N);
    var i, j;
    for (i = 0; i < N; i++) {
      var w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
      re[i] = samples[i] * w;
    }
    for (i = 1, j = 0; i < N; i++) {
      var bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        var tr = re[i]; re[i] = re[j]; re[j] = tr;
        var ti = im[i]; im[i] = im[j]; im[j] = ti;
      }
    }
    for (var len = 2; len <= N; len <<= 1) {
      var ang = (-2 * Math.PI) / len;
      var wRe = Math.cos(ang), wIm = Math.sin(ang);
      for (i = 0; i < N; i += len) {
        var curRe = 1, curIm = 0;
        for (var k = 0; k < len / 2; k++) {
          var uRe = re[i + k], uIm = im[i + k];
          var oRe = re[i + k + len / 2], oIm = im[i + k + len / 2];
          var vRe = oRe * curRe - oIm * curIm;
          var vIm = oRe * curIm + oIm * curRe;
          re[i + k] = uRe + vRe; im[i + k] = uIm + vIm;
          re[i + k + len / 2] = uRe - vRe; im[i + k + len / 2] = uIm - vIm;
          var nRe = curRe * wRe - curIm * wIm;
          curIm = curRe * wIm + curIm * wRe; curRe = nRe;
        }
      }
    }
    var db = new Float32Array(N / 2);
    for (var k2 = 0; k2 < N / 2; k2++) {
      var mag = Math.sqrt(re[k2] * re[k2] + im[k2] * im[k2]) / (N / 2);
      db[k2] = mag > 1e-9 ? 20 * Math.log10(mag) : -180;
    }
    return { db: db, fRes: 1 / N }; // × real sample rate by caller
  }

  /* ---------------- engine ---------------- */
  var VERSION = '1.1.0';
  var MODEL = 'Z-DSO 2104';

  function OscEngine() {
    Emitter.call(this);
    this.version = VERSION;
    this.model = MODEL;
    this.channels = [];
    for (var i = 0; i < 4; i++) {
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
        meas: emptyMeas()
      });
    }
    this.trig = { source: 0, level: 0, edge: 'rising', sweep: 'auto' };
    this.time = { timeDiv: 5e-4, hOffset: 0, trigPos: 0.5 };
    this.display = Object.assign({}, DEFAULTS.display);
    this.acq = Object.assign({}, DEFAULTS.acq);
    this.math = Object.assign({}, DEFAULTS.math);
    this.cursors = Object.assign({}, DEFAULTS.cursors);
    this.running = true;
    this.armed = false;
    this.powerOn = true;
    this.simTime = 0;
    this.trigFound = false;
    this.trigX = 0.5;
    this.trigStatus = 'AUTO';
    this.fftResult = null;

    this._avgIdx = 0;
    this._lastFrame = 0;
    this._rafId = 0;
    this._ownLoop = false;
    this._disposed = false;
    this._lastEvtBroadcast = 0;
    this._heartbeat = 0;
    this._lastWinT0 = 0;
    this._mathBuf = null;
    this._lastStateHash = '';
    this._initCommands();
  }
  OscEngine.prototype = Object.create(Emitter.prototype);
  OscEngine.prototype.constructor = OscEngine;
  OscEngine.VERSION = VERSION;
  OscEngine.MODEL = MODEL;

  OscEngine.prototype._initCommands = function () {
    var self = this;
    var names = ['run', 'stop', 'single', 'forceTrigger', 'autoSet',
      'setChannel', 'setChannelData', 'clearChannelData',
      'setHorizontal', 'setTrigger', 'setDisplay', 'setAcquisition',
      'setMath', 'setCursors', 'setGenerator', 'setPower',
      'getChannel', 'getGenerator', 'getMeasurements', 'getState', 'help'];
    this._commands = {};
    names.forEach(function (n) {
      if (typeof self[n] !== 'function') throw new Error('missing method ' + n);
      self._commands[n] = self[n].bind(self);
    });
  };

  /* ----- lifecycle ----- */
  OscEngine.prototype.start = function () {
    if (this._ownLoop) return;
    this._disposed = false;
    this._ownLoop = true;
    this._lastFrame = 0;
    var self = this;
    var loop = function (ts) {
      if (self._disposed) return;
      if (!self._lastFrame) self._lastFrame = ts;
      var dt = Math.min((ts - self._lastFrame) / 1000, 0.05);
      self._lastFrame = ts;
      self.tick(dt);
      self._rafId = requestAnimationFrame(loop);
    };
    this._rafId = requestAnimationFrame(loop);
  };

  OscEngine.prototype.dispose = function () {
    this._disposed = true;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._ownLoop = false;
  };

  /** advance the simulation by dt seconds; call from an external render loop */
  OscEngine.prototype.tick = function (dt) {
    if (this.running && !this.armed) this.simTime += dt;
    this._acquire();
    this._heartbeat += dt;
    if (this._heartbeat > 1) {
      this._heartbeat = 0;
      this.emit('heartbeat', { t: this.simTime, running: this.running });
    }
    this._maybeEmitState();
  };

  Object.defineProperty(OscEngine.prototype, 'windowDur', {
    get: function () { return this.time.timeDiv * 10; }
  });

  /* ----- acquisition (private) ----- */
  OscEngine.prototype._applyChannelTransform = function (rt, raw, out) {
    var cfg = rt.cfg;
    var n = Math.min(raw.length, out.length);
    var mean = 0, i;
    if (cfg.coupling === 'AC') {
      for (i = 0; i < n; i++) mean += raw[i];
      mean /= n;
    }
    var prev = raw[0];
    var a = cfg.bwLimit ? 0.55 : 1;
    for (i = 0; i < n; i++) {
      var v = raw[i];
      if (cfg.coupling === 'AC') v -= mean;
      if (cfg.coupling === 'GND') { out[i] = 0; prev = 0; continue; }
      if (cfg.bwLimit) { v = prev + a * (v - prev); prev = v; }
      v *= cfg.probe;
      if (cfg.invert) v = -v;
      out[i] = v;
    }
  };

  OscEngine.prototype._naturalT0 = function (rt) {
    var win = this.windowDur;
    if (!rt.ext) return this.simTime - win;
    var rate = rt.extRate > 0 ? rt.extRate : DISP_PTS / win;
    var dur = (rt.ext.length - 1) / rate;
    switch (rt.extAlign) {
      case 'none': return rt.extT0 + dur - win;
      case 'center': return rt.extT0 + (dur - win) / 2;
      case 'trigger': return rt.extT0 + dur - win;
    }
    return rt.extT0 + dur - win;
  };

  OscEngine.prototype._buildWindow = function (rt, t0w, wDur) {
    var out = rt.disp;
    var n = out.length;
    var i, t, idx, i0, f;
    if (rt.ext) {
      var buf = rt.ext;
      var rate = rt.extRate > 0 ? rt.extRate : n / wDur;
      var tStart = rt.extT0;
      for (i = 0; i < n; i++) {
        t = t0w + (i / (n - 1)) * wDur;
        idx = (t - tStart) * rate;
        if (idx <= 0) out[i] = buf[0];
        else if (idx >= buf.length - 1) out[i] = buf[buf.length - 1];
        else {
          i0 = Math.floor(idx); f = idx - i0;
          out[i] = buf[i0] * (1 - f) + buf[i0 + 1] * f;
        }
      }
    } else if (rt.gen.type === 'off') {
      out.fill(0);
    } else {
      var tEnd = rt.genT0 + GEN_PTS * rt.genDt;
      for (i = 0; i < n; i++) {
        t = Math.max(rt.genT0, Math.min(tEnd, t0w + (i / (n - 1)) * wDur));
        idx = (t - rt.genT0) / rt.genDt;
        i0 = Math.floor(idx); f = idx - i0;
        var b = rt.genBuf;
        out[i] = b[i0] * (1 - f) + b[Math.min(b.length - 1, i0 + 1)] * f;
      }
    }
    this._applyChannelTransform(rt, out, out);
    return { t0: t0w, dt: wDur / (n - 1), window: wDur };
  };

  OscEngine.prototype._searchTrigger = function (d, w) {
    var n = d.length;
    var level = this.trig.level;
    var h = Math.max(1e-9, Math.abs(level) * 0.02 + 1e-4);
    var rising = this.trig.edge === 'rising';
    var armed = false;
    for (var i = 1; i < n; i++) {
      if (rising) {
        if (!armed && d[i - 1] < level - h) armed = true;
        if (armed && d[i] >= level) return w.t0 + i * w.dt;
      } else {
        if (!armed && d[i - 1] > level + h) armed = true;
        if (armed && d[i] <= level) return w.t0 + i * w.dt;
      }
    }
    return NaN;
  };

  OscEngine.prototype._acquire = function () {
    var win = this.windowDur;
    var tNow = this.simTime;
    var i, rt;

    // 1) refresh internal generation buffers: coverage [tNow - 2*win, tNow + win]
    for (i = 0; i < this.channels.length; i++) {
      rt = this.channels[i];
      if (rt.cfg.enabled && !rt.ext && rt.gen.type !== 'off') {
        var t0 = tNow - 2 * win;
        var dt = (3 * win) / GEN_PTS;
        var buf = rt.genBuf;
        for (var s = 0; s <= GEN_PTS; s++) buf[s] = genValue(rt.gen, t0 + s * dt);
        rt.genT0 = t0; rt.genDt = dt;
      }
    }

    // 2) build each channel's natural window
    for (i = 0; i < this.channels.length; i++) {
      rt = this.channels[i];
      if (!rt.cfg.enabled) continue;
      rt.natT0 = this._naturalT0(rt);
      this._buildWindow(rt, rt.natT0, win);
    }

    // 3) trigger search on source (only if source can be trigger-aligned)
    var srcRt = this.channels[Math.max(0, Math.min(3, this.trig.source))];
    var alignable = !srcRt.ext || srcRt.extAlign === 'trigger';
    var trigTime = NaN;
    if (alignable && srcRt.cfg.enabled) {
      trigTime = this._searchTrigger(srcRt.disp, { t0: srcRt.natT0, dt: win / (DISP_PTS - 1), window: win });
      this.trigFound = isFinite(trigTime);
    } else {
      this.trigFound = false;
    }

    // 4) decide final t0 per channel
    var finalT0 = tNow - win + this.time.hOffset;
    if (this.trigFound) {
      var t0a = trigTime - this.time.trigPos * win;
      if (!srcRt.ext) {
        var minT0 = srcRt.genT0;
        var maxT0 = srcRt.genT0 + GEN_PTS * srcRt.genDt - win;
        t0a = Math.max(minT0, Math.min(maxT0, t0a));
      }
      finalT0 = t0a + this.time.hOffset;
    }
    this._lastWinT0 = finalT0;

    for (i = 0; i < this.channels.length; i++) {
      rt = this.channels[i];
      if (!rt.cfg.enabled) { rt.meas = emptyMeas(); rt.peakLo = null; rt.peakHi = null; continue; }
      var useAligned = this.trigFound && (!rt.ext || rt.extAlign === 'trigger');
      var t0ch = useAligned ? finalT0 : this._naturalT0(rt);
      this._buildWindow(rt, t0ch, win);

      // peak-detect envelope (internal sources only)
      if (this.acq.mode === 'peak' && !rt.ext && rt.gen.type !== 'off') {
        var per = DISP_PTS * 2;
        var lo = new Float32Array(per), hi = new Float32Array(per);
        var covStart = rt.genT0, covEnd = rt.genT0 + GEN_PTS * rt.genDt;
        for (var c = 0; c < per; c++) {
          var t = Math.max(covStart, Math.min(covEnd, t0ch + (c / (per - 1)) * win));
          var i0 = Math.max(0, Math.min(GEN_PTS - 1, Math.floor((t - rt.genT0) / rt.genDt)));
          var mn = Infinity, mx = -Infinity;
          for (var k = -2; k <= 2; k++) {
            var v = rt.genBuf[Math.max(0, Math.min(GEN_PTS, i0 + k))];
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
          rt.avgRing = [];
          for (var f2 = 0; f2 < this.acq.avgCount; f2++) {
            var copy = new Float32Array(rt.disp.length);
            copy.set(rt.disp);
            rt.avgRing.push(copy);
          }
        } else {
          rt.avgRing[this._avgIdx].set(rt.disp);
        }
        var out = rt.disp;
        for (var oi = 0; oi < out.length; oi++) {
          var sum = 0;
          for (var fr = 0; fr < rt.avgRing.length; fr++) sum += rt.avgRing[fr][oi];
          out[oi] = sum / this.acq.avgCount;
        }
      } else if (rt.avgRing.length) {
        rt.avgRing = [];
      }

      rt.meas = measure(rt.disp, win / (DISP_PTS - 1));
    }
    if (this.acq.mode === 'average') this._avgIdx = (this._avgIdx + 1) % this.acq.avgCount;

    // 5) math
    if (this.math.enabled && this.channels[0].cfg.enabled && this.channels[1].cfg.enabled) {
      var a = this.channels[0].disp, b = this.channels[1].disp;
      var m = new Float32Array(DISP_PTS);
      for (var mi = 0; mi < DISP_PTS; mi++) {
        m[mi] = this.math.op === 'A+B' ? a[mi] + b[mi] : this.math.op === 'A-B' ? a[mi] - b[mi] : a[mi] * b[mi];
      }
      this._mathBuf = m;
    } else this._mathBuf = null;

    // 6) FFT
    if (this.display.fft && !this.display.xy) {
      var src = this.channels[Math.max(0, Math.min(3, this.display.fftSource))];
      if (src.cfg.enabled) {
        var N = 1024;
        var inp = new Float32Array(N);
        var step = DISP_PTS / N;
        for (var fi = 0; fi < N; fi++) inp[fi] = src.disp[Math.floor(fi * step)];
        var res = fftMagDb(inp);
        var fs = (DISP_PTS - 1) / win;
        this.fftResult = { db: res.db, fMin: 0, fMax: fs / 2, src: this.display.fftSource };
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
  };

  /* ----- render state ----- */
  OscEngine.prototype.getView = function () {
    var self = this;
    return {
      channels: this.channels.map(function (rt) {
        return { disp: rt.disp, peakLo: rt.peakLo, peakHi: rt.peakHi, cfg: rt.cfg };
      }),
      math: this._mathBuf ? { disp: this._mathBuf, cfg: this.math } : null,
      win: { t0: this._lastWinT0, dt: this.windowDur / (DISP_PTS - 1), window: this.windowDur },
      trig: {
        found: this.trigFound,
        x: Math.max(0, Math.min(1, this.trigX)),
        time: this._lastWinT0 + this.trigX * this.windowDur,
        level: this.trig.level,
        source: this.trig.source,
        edge: this.trig.edge
      },
      trigStatus: this.trigStatus,
      running: this.running,
      armed: this.armed,
      simTime: this.simTime
    };
  };

  OscEngine.prototype.getMeasurements = function (ch) {
    var out = {};
    if (ch === undefined || ch === null) {
      for (var i = 0; i < 4; i++) out[CH_NAMES[i]] = Object.assign({}, this.channels[i].meas);
    } else {
      var rt = this.channels[ch];
      if (!rt) throw new Error('channel index ' + ch + ' out of range 0..3');
      out[CH_NAMES[ch]] = Object.assign({}, rt.meas);
    }
    return out;
  };

  OscEngine.prototype.getState = function () {
    return {
      model: MODEL,
      version: VERSION,
      running: this.running,
      armed: this.armed,
      powerOn: this.powerOn,
      simTime: this.simTime,
      channels: this.channels.map(function (rt, i) {
        return {
          name: CH_NAMES[i],
          cfg: Object.assign({}, rt.cfg),
          generator: Object.assign({}, rt.gen),
          source: rt.ext ? 'external' : 'internal-generator',
          extSamples: rt.ext ? rt.ext.length : 0,
          extSampleRate: rt.extRate,
          measurements: Object.assign({}, rt.meas)
        };
      }),
      horizontal: Object.assign({}, this.time),
      trigger: Object.assign({}, this.trig),
      display: Object.assign({}, this.display),
      acquisition: Object.assign({}, this.acq),
      math: Object.assign({}, this.math),
      cursors: Object.assign({}, this.cursors)
    };
  };

  /* ----- public API commands ----- */
  OscEngine.prototype.run = function () {
    this.running = true; this.armed = false;
    this.emit('run', { running: true });
    this._maybeEmitState(true);
  };
  OscEngine.prototype.stop = function () {
    this.running = false; this.armed = false;
    this.emit('stopped', { reason: 'manual' });
    this._maybeEmitState(true);
  };
  OscEngine.prototype.single = function () {
    this.running = true; this.armed = true;
    this.emit('arm', {});
    this._maybeEmitState(true);
  };
  OscEngine.prototype.forceTrigger = function () {
    this.trigFound = true;
    this.emit('force-trigger', {});
  };
  OscEngine.prototype.setPower = function (on) {
    this.powerOn = !!on;
    this.emit('power-changed', { on: this.powerOn });
    this._maybeEmitState(true);
  };

  /* interactive nudges (used by knobs & screen drag; also scriptable) */
  OscEngine.prototype.nudgeHOffset = function (ds) {
    var win = this.windowDur;
    this.time.hOffset = Math.max(-win * 5, Math.min(win * 5, this.time.hOffset + ds));
  };
  OscEngine.prototype.nudgeTriggerLevel = function (dv) {
    this.trig.level += dv;
  };
  OscEngine.prototype.nudgeChannelOffset = function (ch, dv) {
    var rt = this.channels[ch];
    if (!rt) return;
    rt.cfg.offset = Math.max(-4 * rt.cfg.voltsDiv, Math.min(4 * rt.cfg.voltsDiv, rt.cfg.offset + dv));
  };
  OscEngine.prototype.nudgeCursor = function (key, d) {
    this.cursors[key] += d;
  };

  OscEngine.prototype.setChannel = function (ch, cfg) {
    var rt = this.channels[ch];
    if (!rt) throw new Error('channel index ' + ch + ' out of range 0..3');
    Object.assign(rt.cfg, cfg);
    this.emit('channel-changed', { ch: ch, cfg: Object.assign({}, rt.cfg) });
    this._maybeEmitState(true);
  };

  OscEngine.prototype.setHorizontal = function (cfg) {
    if (cfg.timeDiv !== undefined) this.time.timeDiv = ceilStep(TIME_STEPS, cfg.timeDiv);
    if (cfg.hOffset !== undefined) this.time.hOffset = cfg.hOffset;
    if (cfg.trigPos !== undefined) this.time.trigPos = Math.max(0, Math.min(1, cfg.trigPos));
    this.emit('horizontal-changed', Object.assign({}, this.time));
    this._maybeEmitState(true);
  };

  OscEngine.prototype.setTrigger = function (cfg) {
    Object.assign(this.trig, cfg);
    this.emit('trigger-changed', Object.assign({}, this.trig));
    this._maybeEmitState(true);
  };

  OscEngine.prototype.setDisplay = function (cfg) {
    Object.assign(this.display, cfg);
    this.emit('display-changed', Object.assign({}, this.display));
    this._maybeEmitState(true);
  };

  OscEngine.prototype.setAcquisition = function (cfg) {
    Object.assign(this.acq, cfg);
    if (cfg.avgCount !== undefined) this.channels.forEach(function (rt) { rt.avgRing = []; });
    this.emit('acquisition-changed', Object.assign({}, this.acq));
    this._maybeEmitState(true);
  };

  OscEngine.prototype.setMath = function (cfg) {
    Object.assign(this.math, cfg);
    this.emit('math-changed', Object.assign({}, this.math));
    this._maybeEmitState(true);
  };

  OscEngine.prototype.setCursors = function (cfg) {
    Object.assign(this.cursors, cfg);
    this.emit('cursors-changed', Object.assign({}, this.cursors));
    this._maybeEmitState(true);
  };

  OscEngine.prototype.setGenerator = function (ch, cfg) {
    var rt = this.channels[ch];
    if (!rt) throw new Error('channel index ' + ch + ' out of range 0..3');
    Object.assign(rt.gen, cfg);
    if (rt.gen.type !== 'off' && rt.ext) {
      rt.ext = null; rt.extRate = 0; // generator takes over the input
    }
    this.emit('generator-changed', { ch: ch, gen: Object.assign({}, rt.gen) });
    this._maybeEmitState(true);
  };

  OscEngine.prototype.getChannel = function (ch) {
    var rt = this.channels[ch];
    if (!rt) throw new Error('channel index ' + ch + ' out of range 0..3');
    return {
      name: CH_NAMES[ch], cfg: Object.assign({}, rt.cfg), generator: Object.assign({}, rt.gen),
      source: rt.ext ? 'external' : 'internal-generator',
      extSamples: rt.ext ? rt.ext.length : 0,
      measurements: Object.assign({}, rt.meas)
    };
  };

  OscEngine.prototype.getGenerator = function (ch) {
    var rt = this.channels[ch];
    if (!rt) throw new Error('channel index ' + ch + ' out of range 0..3');
    return Object.assign({}, rt.gen);
  };

  /** Feed external waveform data (e.g. from a circuit simulator). */
  OscEngine.prototype.setChannelData = function (ch, samples, meta) {
    meta = meta || {};
    var rt = this.channels[ch];
    if (!rt) throw new Error('channel index ' + ch + ' out of range 0..3');
    var buf = samples instanceof Float32Array ? samples : Float32Array.from(samples);
    if (buf.length < 2) throw new Error('need at least 2 samples');
    var rate = meta.sampleRate !== undefined ? meta.sampleRate : DISP_PTS / this.windowDur;
    if (rt.gen.type !== 'off' && !rt.lastGen) rt.lastGen = Object.assign({}, rt.gen);
    rt.ext = buf;
    rt.extRate = rate;
    rt.extT0 = meta.tStart !== undefined ? meta.tStart : this.simTime - (buf.length - 1) / rate;
    rt.extAlign = meta.align !== undefined ? meta.align : 'none';
    rt.gen.type = 'off';
    if (!rt.cfg.enabled) rt.cfg.enabled = true;
    this.emit('data-received', { ch: ch, samples: buf.length, sampleRate: rate });
  };

  OscEngine.prototype.clearChannelData = function (ch) {
    var rt = this.channels[ch];
    if (!rt) throw new Error('channel index ' + ch + ' out of range 0..3');
    rt.ext = null;
    rt.extRate = 0;
    if (rt.lastGen) {
      rt.gen = Object.assign({}, rt.lastGen);
      rt.lastGen = null;
    }
    this.emit('data-cleared', { ch: ch });
    this._maybeEmitState(true);
  };

  OscEngine.prototype.autoSet = function () {
    var ch = -1;
    for (var i = 0; i < 4; i++) { if (this.channels[i].cfg.enabled) { ch = i; break; } }
    if (ch < 0) { this.setChannel(0, { enabled: true }); ch = 0; }
    var rt = this.channels[ch];
    var m = rt.meas.valid ? rt.meas : measure(rt.disp, this.windowDur / (DISP_PTS - 1));
    var vpp = m.vpp > 1e-9 ? m.vpp : rt.gen.type !== 'off' ? 2 * rt.gen.amp : 1;
    var targetDiv = vpp / (V_DIVS * 0.6);
    this.setChannel(ch, { voltsDiv: ceilStep(VOLT_STEPS, targetDiv), offset: 0 });
    var per = m.freq > 0 ? 1 / m.freq : 0;
    var wantWin = per > 0 ? per * 2.5 : 1e-2;
    this.setHorizontal({ timeDiv: wantWin / 10, hOffset: 0, trigPos: 0.5 });
    this.setTrigger({
      source: ch,
      level: rt.gen.type !== 'off' && !rt.ext ? rt.gen.offset : (m.vmax + m.vmin) / 2,
      edge: 'rising', sweep: 'auto'
    });
    this.run();
    this.emit('autoset', { channel: ch });
  };

  /* ----- command dispatch (transport layer) ----- */
  OscEngine.prototype.handleCommand = function (cmd, args) {
    try {
      var f = this._commands[cmd];
      if (!f) return { ok: false, error: 'unknown command "' + cmd + '" (try "help")' };
      var data = f.apply(this, args || []);
      return { ok: true, data: data === undefined ? null : data };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };

  OscEngine.prototype.help = function () {
    return {
      model: MODEL,
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
        help: []
      },
      units: 'volts & seconds; frequency Hz; sampleRate samples/second'
    };
  };

  /* ----- throttled state event ----- */
  /**
   * Emit the `state` event so the UI re-syncs.
   * force=true bypasses the throttle — used by every public setter so a
   * toggle press is reflected on the front panel immediately.
   * Without force the call is throttled to ~4×/s and only fires when the
   * full state hash changed (used by the per-frame tick and drag nudges).
   * The hash covers EVERYTHING the front panel displays — a partial hash
   * used to hide changes (invert/coupling/probe/bw/gen/hOffset) so toggles
   * appeared dead on the UI.
   */
  OscEngine.prototype._maybeEmitState = function (force) {
    var now = performance.now();
    if (!force && now - this._lastEvtBroadcast < 250) return;
    var s = JSON.stringify([
      this.running, this.armed, this.powerOn, this.trigStatus,
      this.channels.map(function (rt) { return [rt.cfg, rt.gen, rt.ext ? rt.ext.length : 0]; }),
      this.time, this.trig, this.display, this.acq, this.math, this.cursors
    ]);
    if (force || s !== this._lastStateHash) {
      this._lastStateHash = s;
      this._lastEvtBroadcast = now;
      this.emit('state', this.getState());
    }
  };

  /* ---------------- exports ---------------- */
  var ZDSO = {
    OscEngine: OscEngine,
    Emitter: Emitter,
    fmtEng: fmtEng,
    nearestStep: nearestStep,
    ceilStep: ceilStep,
    measure: measure,
    VERSION: VERSION,
    MODEL: MODEL,
    constants: {
      H_DIVS: H_DIVS, V_DIVS: V_DIVS, DISP_PTS: DISP_PTS, GEN_PTS: GEN_PTS,
      SCREEN_W: SCREEN_W, SCREEN_H: SCREEN_H,
      VOLT_STEPS: VOLT_STEPS, TIME_STEPS: TIME_STEPS, FREQ_STEPS: FREQ_STEPS,
      CH_COLORS: CH_COLORS, CH_NAMES: CH_NAMES,
      MATH_COLOR: MATH_COLOR, FFT_COLOR: FFT_COLOR,
      CURSOR_A_COLOR: CURSOR_A_COLOR, CURSOR_B_COLOR: CURSOR_B_COLOR,
      DEFAULTS: DEFAULTS
    }
  };

  global.ZDSO = ZDSO;
})(typeof window !== 'undefined' ? window : this);
