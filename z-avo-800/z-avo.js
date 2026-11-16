/* ============================================================================
 * Z-AVO 800 — Virtual Digital AVOmeter (Multimeter) ENGINE
 * Modeled 1:1 after the Sanwa CD800a front panel.
 * ----------------------------------------------------------------------------
 * Pure-JavaScript instrument engine, UI-independent. Exposes:
 *   - full command API  -> engine.handleCommand(cmd, args)
 *   - state snapshot    -> engine.getState()
 *   - event bus         -> engine.on('state'|'reading'|'heartbeat'|'beep', cb)
 *   - transports        -> window.AVO (direct), window.postMessage, BroadcastChannel("avo-bridge")
 * Units: volts, amperes, ohms, farads, hertz, seconds (all SI).
 * ==========================================================================*/
(function (global) {
  'use strict';

  /* ---------------- constants ---------------- */

  // Modes laid out around the rotary selector (same order as Sanwa CD800a).
  // Each entry: selectorId, modeKey, label, group, defaultRange, ranges[], unit, decimals
  var MODES = {
    OFF:    { id: 'OFF',    label: 'OFF',          group: 'off',   unit: '',     ranges: [] },
    DCV:    { id: 'DCV',    label: 'DC V',         group: 'volt',  unit: 'V',    decimals: { 0.4:1, 4:3, 40:2, 400:1, 600:0 },
              ranges: [0.4, 4, 40, 400, 600] },
    ACV:    { id: 'ACV',    label: 'AC V',         group: 'volt',  unit: 'V',    decimals: { 4:3, 40:2, 400:1, 600:0 },
              ranges: [4, 40, 400, 600] },
    DCA:    { id: 'DCA',    label: 'DC A',         group: 'amp',   unit: 'A',    decimals: { 0.04:5, 0.4:4 },
              ranges: [0.04, 0.4] },
    ACA:    { id: 'ACA',    label: 'AC A',         group: 'amp',   unit: 'A',    decimals: { 0.04:5, 0.4:4 },
              ranges: [0.04, 0.4] },
    OHM:    { id: 'OHM',    label: '\u03A9',       group: 'ohm',   unit: '\u03A9', decimals: { 400:1, 4000:1, 40000:0, 400000:0, 4000000:2, 40000000:1 },
              ranges: [400, 4000, 40000, 400000, 4000000, 40000000] },
    CONT:   { id: 'CONT',   label: '\u2022\u2014\u2022',  group: 'ohm', unit: '\u03A9', decimals: { 400:1 }, ranges: [400] },
    DIODE:  { id: 'DIODE',  label: '\u2192|',      group: 'ohm',   unit: 'V',    decimals: { 4:3 }, ranges: [4] },
    CAP:    { id: 'CAP',    label: 'CAP',          group: 'cap',   unit: 'F',    decimals: { 50e-9:1, 500e-9:1, 5e-6:2, 50e-6:1, 100e-6:1 },
              ranges: [50e-9, 500e-9, 5e-6, 50e-6, 100e-6] },
    HZ:     { id: 'HZ',     label: 'Hz',           group: 'freq',  unit: 'Hz',   decimals: { 100000:2, 1000000:1 },
              ranges: [100000, 1000000] },
    DUTY:   { id: 'DUTY',   label: '%',            group: 'freq',  unit: '%',    decimals: { 100:1 },
              ranges: [100] }
  };

  // Order around the selector knob — clockwise starting at OFF (12 o'clock)
  var SELECTOR_ORDER = [
    'OFF', 'DCV', 'ACV', 'HZ', 'DUTY',   // right side
    'CAP', 'DIODE', 'CONT', 'OHM',       // bottom
    'DCA', 'ACA'                          // left side
  ];

  // Sanwa color palette (used by both engine constants & UI).
  var COLORS = {
    CASE_YELLOW:    '#fdb813',  // Sanwa signature yellow (Pantone ~116C)
    CASE_YELLOW_HI: '#ffd24a',
    CASE_YELLOW_LO: '#c69000',
    PANEL_DARK:     '#1a1d20',
    PANEL_DARK_HI:  '#2a2e33',
    KNOB_BODY:      '#15171a',
    KNOB_RING:      '#3a3f46',
    POINTER:        '#f5f5f5',
    BUTTON_GREY:    '#3b4046',
    BUTTON_GREY_HI: '#4a5058',
    BUTTON_LABEL:   '#f0f3f7',
    BUTTON_ACCENT:  '#ffd24a',
    LCD_BG:         '#9bb6a3',  // greenish-gray
    LCD_BG_HI:      '#a9c4b1',
    LCD_DIGIT:      '#0c1410',
    LCD_DIM:        '#41544b',
    LCD_LABEL:      '#1d2a23',
    JACK_BLACK:     '#15171a',
    JACK_RED:       '#d8321f',
    JACK_YELLOW:    '#fdb813',
    BEEP_GREEN:     '#38e05f'
  };

  // 4000-count display
  var MAX_COUNT = 3999;

  var DEFAULTS = {
    power: true,
    mode: 'DCV',
    rangeIndex: -1,        // -1 = auto-range
    hold: false,
    holdValue: null,
    relActive: false,
    relRef: null,
    hzDutyMode: null,      // when on HZ position, second click cycles Hz/DUTY
    autoPowerOff: true,
    backlight: false
  };

  /* ---------------- helpers ---------------- */

  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function mean(arr) { var s = 0, n = arr.length; for (var i = 0; i < n; i++) s += arr[i]; return s / n; }
  function rms(arr) {
    var s = 0, n = arr.length; for (var i = 0; i < n; i++) s += arr[i] * arr[i];
    return Math.sqrt(s / n);
  }
  function acRms(arr) {
    var m = mean(arr), s = 0, n = arr.length;
    for (var i = 0; i < n; i++) { var d = arr[i] - m; s += d * d; }
    return Math.sqrt(s / n);
  }
  function fmtEng(v, unit, decimals) {
    if (v === null || v === undefined || Number.isNaN(v)) return '----';
    var abs = Math.abs(v);
    var sign = v < 0 ? '-' : '';
    var u = unit;
    var val = abs;
    if (abs === 0) return sign + '0.000' + (u ? ' ' + u : '');
    if (abs < 1e-9)        { val = abs * 1e12; u = 'p' + unit; }
    else if (abs < 1e-6)   { val = abs * 1e9;  u = 'n' + unit; }
    else if (abs < 1e-3)   { val = abs * 1e6;  u = '\u00B5' + unit; }
    else if (abs < 1)      { val = abs * 1e3;  u = 'm' + unit; }
    else if (abs < 1e3)    { val = abs;        u = unit; }
    else if (abs < 1e6)    { val = abs / 1e3;  u = 'k' + unit; }
    else if (abs < 1e9)    { val = abs / 1e6;  u = 'M' + unit; }
    else                   { val = abs / 1e9;  u = 'G' + unit; }
    var d = decimals === undefined ? 3 : decimals;
    return sign + val.toFixed(d) + (u ? ' ' + u : '');
  }
  function nearestStep(steps, val) {
    var best = steps[0], bd = Math.abs(steps[0] - val);
    for (var i = 1; i < steps.length; i++) { var d = Math.abs(steps[i] - val); if (d < bd) { bd = d; best = steps[i]; } }
    return best;
  }

  /* ========================================================================
   * Engine
   * ====================================================================== */

  function createEngine() {
    var state = JSON.parse(JSON.stringify(DEFAULTS));
    state.selectorIndex = SELECTOR_ORDER.indexOf(state.mode);
    state.rangeIndex = -1;
    state.connected = false;
    state.lastInputAt = 0;
    state.lastReading = { value: null, display: '----', unit: '', beep: false, ov: false, ol: false };
    state.probes = { red: null, black: null };   // node ids from simulator
    state.input = null;                          // last raw input payload
    state.demoT = 0;

    var listeners = { state: [], reading: [], heartbeat: [], beep: [], connect: [] };
    function emit(name, data) { (listeners[name] || []).forEach(function (cb) { try { cb(data); } catch (e) {} }); }

    /* ----- internal demo source (when no sim attached) ----- */
    function demoReading() {
      var m = MODES[state.mode];
      if (state.mode === 'OFF' || !state.power) return { value: null, display: '', unit: '', beep: false, ov: false, ol: false };
      state.demoT += 0.05;
      var v;
      switch (state.mode) {
        case 'DCV':  v = 1.5 + 0.001 * Math.sin(state.demoT * 7); break;
        case 'ACV':  v = Math.sqrt(2) * 6 * Math.sin(state.demoT * 50); break;
        case 'DCA':  v = 0.012 + 0.0001 * Math.sin(state.demoT * 3); break;
        case 'ACA':  v = Math.sqrt(2) * 0.05 * Math.sin(state.demoT * 50); break;
        case 'OHM':  v = 470 + 0.5 * Math.sin(state.demoT); break;
        case 'CONT': v = 27; break;
        case 'DIODE':v = 0.67; break;
        case 'CAP':  v = 47e-9; break;
        case 'HZ':   v = 1000; break;
        case 'DUTY': v = 50; break;
        default: v = 0;
      }
      return computeReadingFromScalar(v);
    }

    /* ----- compute a reading from a raw scalar (demo or sim scalar) ----- */
    function computeReadingFromScalar(v) {
      var m = MODES[state.mode];
      var beep = false, ov = false, ol = false;
      var range = pickRange(v, m);
      var ref = state.relActive && state.relRef != null ? state.relRef : 0;
      var disp = v - ref;
      // OL detection
      if (range > 0 && Math.abs(disp) > range * 0.9995) ol = true;
      // Continuity beep threshold ~50Ω (CD800a: buzzer at 10..120Ω)
      if (state.mode === 'CONT' && v >= 0 && v < 50) beep = true;
      // Display formatting (4000 count)
      var decimals = m.decimals && m.decimals[range] !== undefined ? m.decimals[range] : 3;
      var display = ol ? '  OL' : fmtEng(disp, m.unit, decimals);
      return { value: disp, display: display, unit: m.unit, beep: beep, ov: ov, ol: ol, range: range, decimals: decimals };
    }

    /* ----- pick range (auto or manual) ----- */
    function pickRange(v, m) {
      if (!m.ranges || m.ranges.length === 0) return 0;
      if (state.rangeIndex >= 0 && state.rangeIndex < m.ranges.length) return m.ranges[state.rangeIndex];
      // auto: smallest range that fits
      var a = Math.abs(v);
      for (var i = 0; i < m.ranges.length; i++) {
        if (a <= m.ranges[i] * 0.9995) return m.ranges[i];
      }
      return m.ranges[m.ranges.length - 1];
    }

    /* ----- compute reading from external samples payload ----- */
    function computeReadingFromInput(payload) {
      var m = MODES[state.mode];
      if (state.mode === 'OFF' || !state.power) return { value: null, display: '', unit: '', beep: false, ov: false, ol: false };
      // Direct scalar shortcut: simulator may pre-compute (e.g., resistance, capacitance).
      if (payload && payload.scalar !== undefined && payload.scalar !== null) {
        return computeReadingFromScalar(Number(payload.scalar));
      }
      if (!payload || !payload.samples || !payload.samples.length) {
        return { value: null, display: '----', unit: m.unit, beep: false, ov: false, ol: false };
      }
      var s = payload.samples;
      var v;
      switch (state.mode) {
        case 'DCV':  v = mean(s); break;
        case 'ACV':  v = acRms(s); break;
        case 'DCA':  v = mean(s); break;
        case 'ACA':  v = acRms(s); break;
        case 'OHM':  v = payload.meta && payload.meta.R != null ? payload.meta.R : null; break;
        case 'CONT': v = payload.meta && payload.meta.R != null ? payload.meta.R : null; break;
        case 'DIODE':v = payload.meta && payload.meta.Vf != null ? payload.meta.Vf : mean(s); break;
        case 'CAP':  v = payload.meta && payload.meta.C != null ? payload.meta.C : null; break;
        case 'HZ':   v = frequencyFromSamples(s, payload.sampleRate); break;
        case 'DUTY': v = dutyFromSamples(s); break;
        default: v = mean(s);
      }
      if (v == null || Number.isNaN(v)) return { value: null, display: '----', unit: m.unit, beep: false, ov: false, ol: false };
      return computeReadingFromScalar(v);
    }

    function frequencyFromSamples(s, rate) {
      if (!rate || s.length < 4) return null;
      var n = s.length;
      var m = mean(s);
      var crossings = 0, lastSign = 0, firstT = -1, lastT = -1;
      for (var i = 0; i < n; i++) {
        var sign = s[i] > m ? 1 : (s[i] < m ? -1 : 0);
        if (sign !== 0 && lastSign !== 0 && sign !== lastSign) {
          crossings++;
          var t = i / rate;
          if (firstT < 0) firstT = t;
          lastT = t;
        }
        if (sign !== 0) lastSign = sign;
      }
      if (crossings < 2 || lastT <= firstT) return null;
      // # rising+falling crossings -> periods = crossings/2
      var periods = crossings / 2;
      return periods / (lastT - firstT);
    }

    function dutyFromSamples(s) {
      if (s.length < 4) return null;
      var m = mean(s);
      var high = 0, total = 0;
      for (var i = 0; i < s.length; i++) {
        if (s[i] > m) high++;
        if (s[i] !== m) total++;
      }
      if (!total) return null;
      return (high / s.length) * 100;
    }

    /* ----- refresh: produce a new reading ----- */
    function refresh() {
      var reading;
      var tNow = Date.now();
      if (state.hold && state.holdValue != null) {
        reading = state.holdValue;
      } else if (state.input && (tNow - state.lastInputAt) < 1500) {
        reading = computeReadingFromInput(state.input);
      } else {
        reading = demoReading();
      }
      state.lastReading = reading;
      emit('reading', reading);
      if (reading.beep) emit('beep', { freq: 4000, dur: 0.06 });
      return reading;
    }

    /* ----- state mutation helpers ----- */
    function setMode(mode) {
      if (!MODES[mode]) return false;
      state.mode = mode;
      state.selectorIndex = SELECTOR_ORDER.indexOf(mode);
      state.rangeIndex = -1;     // back to auto when switching mode
      state.hold = false;
      state.holdValue = null;
      state.relActive = false;
      state.relRef = null;
      // Hz/DUTY sharing: if HZ pressed twice, switch to DUTY (matches SELECT button behavior on CD800a)
      emit('state', getState());
      return true;
    }
    function cycleRange() {
      var m = MODES[state.mode];
      if (!m.ranges || m.ranges.length === 0) return;
      state.rangeIndex = (state.rangeIndex + 1) % (m.ranges.length + 1);
      if (state.rangeIndex >= m.ranges.length) state.rangeIndex = -1; // -1 = auto
      emit('state', getState());
    }
    function toggleHold() {
      state.hold = !state.hold;
      if (state.hold) state.holdValue = state.lastReading;
      else state.holdValue = null;
      emit('state', getState());
    }
    function toggleRel() {
      if (!state.relActive) {
        state.relActive = true;
        state.relRef = state.lastReading && state.lastReading.value != null ? state.lastReading.value : 0;
      } else {
        state.relActive = false;
        state.relRef = null;
      }
      emit('state', getState());
    }
    function pressSelect() {
      // SELECT cycles alternate functions on a single selector position
      // (e.g., DCV↔ACV on the same range slot, Hz↔DUTY, CONT↔DIODE).
      switch (state.mode) {
        case 'DCV': setMode('ACV'); break;
        case 'ACV': setMode('DCV'); break;
        case 'DCA': setMode('ACA'); break;
        case 'ACA': setMode('DCA'); break;
        case 'HZ':  setMode('DUTY'); break;
        case 'DUTY':setMode('HZ'); break;
        case 'CONT':setMode('DIODE'); break;
        case 'DIODE':setMode('CONT'); break;
        default: break;
      }
    }
    function setPower(on) {
      state.power = !!on;
      if (!on) { state.hold = false; state.relActive = false; }
      emit('state', getState());
    }

    /* ----- public command handler ----- */
    function handleCommand(cmd, args) {
      args = args || [];
      try {
        switch (cmd) {
          case 'setMode':         return ok(setMode(args[0]));
          case 'setRange': {
            var m = MODES[state.mode];
            if (!m.ranges || m.ranges.length === 0) return ok(true);
            var idx = m.ranges.indexOf(args[0]);
            if (idx < 0) {
              if (args[0] === 'auto' || args[0] === -1) { state.rangeIndex = -1; emit('state', getState()); return ok(true); }
              return err('range ' + args[0] + ' not valid for mode ' + state.mode);
            }
            state.rangeIndex = idx;
            emit('state', getState());
            return ok(true);
          }
          case 'cycleRange':      cycleRange(); return ok(true);
          case 'autoRange':       state.rangeIndex = -1; emit('state', getState()); return ok(true);
          case 'setPower':        return ok(setPower(args[0]));
          case 'hold':            toggleHold(); return ok(state.hold);
          case 'rel':             toggleRel();  return ok(state.relActive);
          case 'select':          pressSelect(); return ok(state.mode);
          case 'setMeasurement':  return ok(setMeasurement(args[0]));
          case 'clearMeasurement':return ok(clearMeasurement());
          case 'attachProbe':     return ok(attachProbe(args[0], args[1]));
          case 'detachProbe':     return ok(detachProbe(args[0]));
          case 'getState':        return ok(getState());
          case 'getReading':      return ok(refresh());
          case 'getProbes':       return ok(state.probes);
          case 'help':            return ok(listCommands());
          default:                return err('unknown command: ' + cmd);
        }
      } catch (e) {
        return err(String(e && e.message || e));
      }
    }

    function setMeasurement(payload) {
      if (!payload) return false;
      state.input = payload;
      state.lastInputAt = Date.now();
      if (payload.probes) {
        state.probes = Object.assign({}, state.probes, payload.probes);
      }
      return true;
    }
    function clearMeasurement() {
      state.input = null;
      state.lastInputAt = 0;
      return true;
    }
    function attachProbe(color, nodeId) {
      if (color !== 'red' && color !== 'black') return false;
      state.probes[color] = nodeId;
      emit('state', getState());
      return true;
    }
    function detachProbe(color) {
      if (color !== 'red' && color !== 'black') return false;
      state.probes[color] = null;
      emit('state', getState());
      return true;
    }

    function getState() {
      var m = MODES[state.mode];
      return {
        power: state.power,
        mode: state.mode,
        modeLabel: m.label,
        group: m.group,
        unit: m.unit,
        selectorIndex: state.selectorIndex,
        selectorOrder: SELECTOR_ORDER.slice(),
        rangeIndex: state.rangeIndex,
        rangeAuto: state.rangeIndex === -1,
        range: state.rangeIndex >= 0 && m.ranges ? m.ranges[state.rangeIndex] : null,
        ranges: m.ranges ? m.ranges.slice() : [],
        hold: state.hold,
        relActive: state.relActive,
        relRef: state.relRef,
        connected: state.connected,
        probes: { red: state.probes.red, black: state.probes.black },
        lastReading: state.lastReading,
        lastInputAt: state.lastInputAt
      };
    }

    function listCommands() {
      return [
        'setMode(mode)',
        'setRange(range|"auto")',
        'cycleRange() / autoRange()',
        'setPower(bool)',
        'hold() / rel() / select()',
        'setMeasurement(payload) — payload: {type, samples, sampleRate, tStart, redNode, blackNode, probes, scalar, meta}',
        'clearMeasurement()',
        'attachProbe("red"|"black", nodeId) / detachProbe(color)',
        'getState() / getReading() / getProbes()',
        'help()'
      ];
    }

    function ok(data) { return { ok: true, data: data }; }
    function err(msg) { return { ok: false, error: msg }; }

    /* ----- heartbeat ----- */
    var hbTimer = setInterval(function () {
      emit('heartbeat', { t: Date.now(), power: state.power, mode: state.mode });
    }, 1000);

    /* ----- reading refresh loop ----- */
    var readTimer = setInterval(function () { refresh(); }, 120); // ~8 Hz, like a real DMM

    /* ----- public engine API ----- */
    var engine = {
      constants: { MODES: MODES, SELECTOR_ORDER: SELECTOR_ORDER, COLORS: COLORS, MAX_COUNT: MAX_COUNT },
      handleCommand: handleCommand,
      getState: getState,
      getReading: function () { return state.lastReading; },
      on: function (name, cb) { (listeners[name] = listeners[name] || []).push(cb); return function () {
        var i = listeners[name].indexOf(cb); if (i >= 0) listeners[name].splice(i, 1);
      }; },
      off: function (name, cb) {
        var i = (listeners[name] || []).indexOf(cb); if (i >= 0) listeners[name].splice(i, 1);
      },
      dispose: function () { clearInterval(hbTimer); clearInterval(readTimer); },
      fmtEng: fmtEng,
      nearestStep: nearestStep
    };

    return engine;
  }

  /* ========================================================================
   * Transports — wire engine to BroadcastChannel, postMessage, window.AVO
   * ====================================================================== */

  function mountTransports(engine) {
    // direct global
    global.AVO = {
      handleCommand: engine.handleCommand,
      getState: engine.getState,
      getReading: engine.getReading,
      on: engine.on,
      off: engine.off,
      engine: engine
    };

    var pending = Object.create(null); // id -> {resolve, timeout}

    function reply(target, msg) {
      try { target.postMessage(msg, '*'); } catch (e) {}
    }

    function dispatch(data, source) {
      if (!data || data.__avo !== true) return;
      // reply
      if (data.__avoReply === true || data.__avoEvent === true) return; // not for us
      var id = data.id || null;
      var res = engine.handleCommand(data.cmd, data.args || []);
      if (id) {
        var msg = { __avo: true, __avoReply: true, id: id, ok: !!res.ok };
        if (res.ok) msg.data = res.data; else msg.error = res.error;
        if (source) reply(source, msg);
        else if (bc) bc.postMessage(msg);
      }
    }

    // BroadcastChannel
    var bc = null;
    try { bc = new BroadcastChannel('avo-bridge'); } catch (e) { bc = null; }
    if (bc) {
      bc.onmessage = function (ev) { dispatch(ev.data, null); };
    }

    // window.postMessage (from window.open or iframe)
    global.addEventListener('message', function (ev) {
      if (!ev.data || ev.data.__avo !== true) return;
      dispatch(ev.data, ev.source);
    });

    // event broadcast to listeners (sim-side)
    function broadcast(name, data) {
      var msg = { __avo: true, __avoEvent: true, event: name, data: data };
      if (bc) try { bc.postMessage(msg); } catch (e) {}
      // also re-broadcast to same-window listeners (iframe / window.open child path)
      try { global.postMessage(msg, '*'); } catch (e) {}
    }

    engine.on('state',     function (d) { broadcast('state', d); });
    engine.on('reading',   function (d) { broadcast('reading', d); });
    engine.on('heartbeat', function (d) { broadcast('heartbeat', d); });
    engine.on('beep',      function (d) { broadcast('beep', d); });

    return { bc: bc, broadcast: broadcast };
  }

  /* ---------------- exports ---------------- */

  global.ZAVO = {
    createEngine: createEngine,
    mountTransports: mountTransports,
    constants: { MODES: MODES, SELECTOR_ORDER: SELECTOR_ORDER, COLORS: COLORS, MAX_COUNT: MAX_COUNT },
    fmtEng: fmtEng
  };

  // Auto-mount when loaded as a standalone page (engine + transports).
  if (global.document && global.window === global) {
    var engine = createEngine();
    mountTransports(engine);
    global.ZAVO.engine = engine;
  }
})(typeof window !== 'undefined' ? window : this);
