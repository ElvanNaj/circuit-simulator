/* ============================================================================
 * Z-AVO 800 — front-panel UI (standalone, no framework, no build step)
 * ----------------------------------------------------------------------------
 * Depends on z-avo.js (engine). Exposes:
 *   ZAVO.createAVOUI(container)   -> mounts the full AVOmeter panel + API console
 *   ZAVO.createSimDemoUI(container) -> mounts the reference circuit-simulator demo
 * ==========================================================================*/
(function (global) {
  'use strict';
  var Z = global.ZAVO;
  var C = Z.constants;
  var MODES = C.MODES;
  var SELECTOR_ORDER = C.SELECTOR_ORDER;
  var COLORS = C.COLORS;
  var fmtEng = Z.fmtEng;

  /* ---------------- tiny DOM helpers ---------------- */
  function h(tag, props) {
    var el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach(function (k) {
        var v = props[k];
        if (k === 'class') el.className = v;
        else if (k === 'style') Object.assign(el.style, v);
        else if (k === 'text') el.textContent = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v !== undefined && v !== null) el.setAttribute(k, v);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) c.forEach(function (cc) { if (cc) el.appendChild(cc); });
      else if (typeof c === 'string') el.appendChild(document.createTextNode(c));
      else el.appendChild(c);
    }
    return el;
  }
  function svgEl(tag, attrs, text) {
    var e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text !== undefined) e.textContent = text;
    return e;
  }

  /* ======================================================================
   * LCD renderer — greenish-gray background, big 7-seg-style digits,
   * status flags, analog bar, standby overlay
   * ==================================================================== */
  function createLCD(engine) {
    var lcd = h('div', { class: 'lcd' });
    var topRow = h('div', { class: 'lcd-top-row' });
    var flags = {
      AUTO: h('span', { class: 'lcd-flag auto', text: 'AUTO' }),
      AC:   h('span', { class: 'lcd-flag ac',   text: 'AC' }),
      DC:   h('span', { class: 'lcd-flag dc',   text: 'DC' }),
      HOLD: h('span', { class: 'lcd-flag',      text: 'HOLD' }),
      REL:  h('span', { class: 'lcd-flag',      text: 'REL' }),
      BATT: h('span', { class: 'lcd-flag',      text: '\u25A4' }),
      MIN:  h('span', { class: 'lcd-flag',      text: 'MIN' })
    };
    var flagWrap = h('div', { class: 'lcd-flags' },
      flags.AUTO, flags.AC, flags.DC, flags.HOLD, flags.REL, flags.MIN);
    var beepFlag = h('span', { class: 'lcd-flag beep', text: '\u266A', style: { fontSize: '14px', fontWeight: '900' } });
    topRow.appendChild(flagWrap);
    topRow.appendChild(beepFlag);
    lcd.appendChild(topRow);

    var main = h('div', { class: 'lcd-main' });
    var sign = h('span', { class: 'lcd-sign', text: '-' });
    var digits = h('span', { class: 'lcd-digits', text: '0.000' });
    var unit = h('span', { class: 'lcd-unit', text: 'V' });
    main.appendChild(sign);
    main.appendChild(digits);
    main.appendChild(unit);
    lcd.appendChild(main);

    var bar = h('div', { class: 'lcd-bar' });
    for (var i = 0; i < 40; i++) bar.appendChild(h('i'));
    lcd.appendChild(bar);

    var bottomRow = h('div', { class: 'lcd-bottom-row' });
    var left = h('span', { text: '' });
    var right = h('span', { text: '4000 COUNTS' });
    bottomRow.appendChild(left);
    bottomRow.appendChild(right);
    lcd.appendChild(bottomRow);

    var standby = h('div', { class: 'lcd-standby', text: 'STANDBY', style: { display: 'none' } });
    lcd.appendChild(standby);

    function setFlags(st, reading) {
      var mode = MODES[st.mode] || {};
      var isAC = (st.mode === 'ACV' || st.mode === 'ACA');
      var isDC = (st.mode === 'DCV' || st.mode === 'DCA' || st.mode === 'DIODE');
      flags.AUTO.classList.toggle('on', st.rangeAuto && st.power && st.mode !== 'OFF');
      flags.AC.classList.toggle('on', isAC && st.power);
      flags.DC.classList.toggle('on', isDC && st.power);
      flags.HOLD.classList.toggle('on', st.hold);
      flags.REL.classList.toggle('on', st.relActive);
      flags.BATT.classList.toggle('on', st.power);
      beepFlag.classList.toggle('on', !!(reading && reading.beep));
      left.textContent = st.power && st.mode !== 'OFF' ? (mode.label || st.mode) : '';
    }

    function setReading(reading) {
      if (!reading) { digits.textContent = '----'; sign.classList.remove('on'); return; }
      // also update beep flag (continuity indicator) per-reading, not just per-state
      beepFlag.classList.toggle('on', !!reading.beep);
      if (reading.display === '  OL') {
        digits.textContent = '   OL';
        sign.classList.remove('on');
      } else if (reading.display === '----' || reading.value == null) {
        digits.textContent = '----';
        sign.classList.remove('on');
      } else {
        var v = reading.value;
        var d = reading.decimals == null ? 3 : reading.decimals;
        var abs = Math.abs(v);
        // produce a fixed-width 5-char field with up to 4 significant digits
        var txt = formatDigits(abs, d);
        digits.textContent = txt;
        sign.classList.toggle('on', v < 0);
      }
      unit.textContent = reading.unit || '';
      // analog bar
      var segs = bar.children;
      var filled = 0;
      if (reading && reading.range && reading.value != null) {
        var ratio = Math.min(1, Math.abs(reading.value) / reading.range);
        filled = Math.round(ratio * segs.length);
      }
      for (var i = 0; i < segs.length; i++) segs[i].classList.toggle('on', i < filled);
    }

    function formatDigits(abs, decimals) {
      // 4000 count → show up to 4 digits with proper decimal point
      if (abs === 0) return '  0.000';
      var d = Math.min(3, Math.max(0, decimals == null ? 3 : decimals));
      // pick representation: 0.000 / 0.000 / 00.00 / 000.0 / 0000
      var s;
      if (abs < 1)            s = abs.toFixed(3);          // 0.000
      else if (abs < 10)      s = abs.toFixed(3);          // 1.234
      else if (abs < 100)     s = abs.toFixed(2);          // 12.34
      else if (abs < 1000)    s = abs.toFixed(1);          // 123.4
      else if (abs < 10000)   s = abs.toFixed(0);          // 1234
      else                    s = abs.toExponential(2);    // OL fallback
      // pad to 5 chars
      while (s.length < 5) s = ' ' + s;
      return s.slice(0, 5);
    }

    function setPower(on) {
      standby.style.display = on ? 'none' : 'flex';
    }

    return { el: lcd, setFlags: setFlags, setReading: setReading, setPower: setPower };
  }

  /* ======================================================================
   * Rotary selector — Sanwa-style knob with labels around it.
   * Click to rotate to next position; drag to rotate; wheel to step.
   * ==================================================================== */
  function createRotarySelector(engine) {
    var area = h('div', { class: 'knob-area' });
    var ring = h('div', { class: 'knob-ring' });
    var labels = h('div', { class: 'knob-labels' });
    var knobBody = h('div', { class: 'knob-body', role: 'slider', tabindex: '0', 'aria-label': 'Mode selector' });
    knobBody.appendChild(h('div', { class: 'knob-ridges' }));
    knobBody.appendChild(h('div', { class: 'knob-cap' }));
    var pointer = h('div', { class: 'knob-pointer' });
    knobBody.appendChild(pointer);

    area.appendChild(ring);
    area.appendChild(labels);
    area.appendChild(knobBody);

    // Compute label/tick positions: spread SELECTOR_ORDER around 330° (skip 30° gap at bottom)
    var total = SELECTOR_ORDER.length;
    var startDeg = -90; // start at top
    var sweep = 300;    // 300° arc, leaving 60° gap at bottom (typical Sanwa layout)
    var stepDeg = sweep / (total - 1);

    var labelEls = {};
    SELECTOR_ORDER.forEach(function (modeKey, i) {
      var deg = startDeg + stepDeg * i;
      var rad = deg * Math.PI / 180;
      var radius = 78;
      var x = Math.cos(rad) * radius;
      var y = Math.sin(rad) * radius;
      var m = MODES[modeKey];
      var cls = 'knob-label ' + (m.group || '') + (modeKey === 'OFF' ? ' off' : '');
      var lab = h('div', { class: cls, style: {
        transform: 'translate(' + x + 'px,' + y + 'px) translate(-50%, -50%)'
      } });
      if (modeKey === 'OFF') {
        lab.appendChild(h('span', { text: 'OFF' }));
      } else if (modeKey === 'OHM') {
        lab.appendChild(h('span', { class: 'gly', text: '\u03A9' }));
      } else if (modeKey === 'CONT') {
        lab.appendChild(h('span', { class: 'gly', text: '\u266B' }));
      } else if (modeKey === 'DIODE') {
        lab.appendChild(h('span', { class: 'gly', text: '\u2192|' }));
      } else if (modeKey === 'CAP') {
        lab.appendChild(h('span', { class: 'gly', text: '\u2502\u2501' }));
        lab.appendChild(h('span', { text: ' CAP' }));
      } else if (modeKey === 'HZ') {
        lab.appendChild(h('span', { class: 'gly', text: 'Hz' }));
      } else if (modeKey === 'DUTY') {
        lab.appendChild(h('span', { class: 'gly', text: '%' }));
      } else {
        lab.appendChild(h('span', { class: 'gly', text: m.label }));
      }
      labels.appendChild(lab);
      labelEls[modeKey] = lab;

      // tick mark (rotate by clock angle = screen angle + 90°)
      var tickDeg = deg + 90;
      var tick = h('div', { class: 'knob-tick' + (i % 2 === 0 ? ' major' : ''), style: {
        transform: 'rotate(' + tickDeg + 'deg) translateY(-78px)'
      } });
      labels.appendChild(tick);
    });

    function angleForIndex(i) {
      return startDeg + stepDeg * i;
    }
    function applyState(st) {
      var idx = st.selectorIndex >= 0 ? st.selectorIndex : 0;
      // Labels use screen angle (math convention); the pointer & ticks
      // start pointing UP (12 o'clock) at rotate(0), so add 90° to convert
      // from screen angle (0°=right) to clock angle (0°=up).
      var ang = angleForIndex(idx) + 90;
      pointer.style.transform = 'rotate(' + ang + 'deg)';
      // highlight active label
      Object.keys(labelEls).forEach(function (k) {
        labelEls[k].classList.toggle('active', k === st.mode && st.mode !== 'OFF');
      });
    }

    // interactions
    function step(dir) {
      var st = engine.getState();
      var next = (st.selectorIndex + dir + SELECTOR_ORDER.length) % SELECTOR_ORDER.length;
      engine.handleCommand('setMode', [SELECTOR_ORDER[next]]);
    }
    knobBody.addEventListener('wheel', function (e) {
      e.preventDefault();
      step(e.deltaY < 0 ? 1 : -1);
    }, { passive: false });
    knobBody.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); step(1); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); step(-1); }
    });
    // drag-to-rotate
    var drag = null;
    knobBody.addEventListener('pointerdown', function (e) {
      knobBody.setPointerCapture(e.pointerId);
      var rect = area.getBoundingClientRect();
      var cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
      drag = { cx: cx, cy: cy, lastAng: Math.atan2(e.clientY - cy, e.clientX - cx), acc: 0 };
    });
    knobBody.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var ang = Math.atan2(e.clientY - drag.cy, e.clientX - drag.cx);
      var d = ang - drag.lastAng;
      // wrap
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      drag.acc += d;
      drag.lastAng = ang;
      var thresh = (stepDeg * Math.PI / 180) * 0.6;
      while (drag.acc > thresh) { drag.acc -= thresh; step(1); }
      while (drag.acc < -thresh) { drag.acc += thresh; step(-1); }
    });
    function endDrag() { drag = null; }
    knobBody.addEventListener('pointerup', endDrag);
    knobBody.addEventListener('pointercancel', endDrag);

    // click on a label → jump to that mode
    Object.keys(labelEls).forEach(function (k) {
      labelEls[k].style.pointerEvents = 'auto';
      labelEls[k].style.cursor = 'pointer';
      labelEls[k].addEventListener('click', function () {
        engine.handleCommand('setMode', [k]);
      });
    });

    return { el: area, applyState: applyState };
  }

  /* ======================================================================
   * Function buttons (POWER / HOLD / RANGE / REL / SELECT)
   * ==================================================================== */
  function createFnButton(opts) {
    var led = opts.led ? h('span', { class: 'led' }) : null;
    var label = h('span', { class: 'primary', text: opts.label });
    var sub = opts.sub ? h('span', { class: 'secondary', text: opts.sub }) : null;
    var btn = h('button', { type: 'button', class: 'fn-btn' + (opts.variant ? ' ' + opts.variant : '') },
      led, label, sub);
    btn.style.setProperty('--led', opts.ledColor || '#38e05f');
    if (opts.onPress) btn.addEventListener('click', opts.onPress);
    return {
      el: btn,
      setLit: function (v) { btn.classList.toggle('led-on', !!v); },
      setOn:  function (v) { btn.classList.toggle('off', !v); }
    };
  }

  /* ======================================================================
   * Input jacks row (4 jacks: COM / VΩHz / mA / 10A-style)
   * ==================================================================== */
  function createJacks(engine) {
    var row = h('div', { class: 'jacks-row' });
    function jack(color, mainLabel, sub) {
      var j = h('div', { class: 'jack' });
      j.appendChild(h('div', { class: 'jack-ring ' + color }));
      return h('div', { class: 'jack-unit' },
        j,
        h('div', { class: 'jack-label ' + (sub || '') },
          h('div', { class: 'gly', text: mainLabel }),
          h('div', { text: sub || '' })));
    }
    row.appendChild(jack('black',  'COM',  'com'));
    row.appendChild(jack('red',    'V\u03A9Hz', 'vohm'));
    row.appendChild(jack('yellow', 'mA',   'ma'));
    row.appendChild(jack('blue',   '\u00B5A', 'amp'));
    return row;
  }

  /* ======================================================================
   * Status pill (live connection indicator)
   * ==================================================================== */
  function createStatusPill() {
    var dot = h('span', { class: 'dot' });
    var txt = h('span', { text: 'LIVE' });
    var pill = h('div', { class: 'status-pill off' }, dot, txt);
    return {
      el: pill,
      setConnected: function (v) {
        pill.classList.toggle('off', !v);
        txt.textContent = v ? 'LIVE' : 'IDLE';
      }
    };
  }

  /* ======================================================================
   * API console (mirrors Z-DSO pattern)
   * ==================================================================== */
  function createAPIConsole(engine) {
    var fab = h('button', { class: 'api-fab', text: '\u226F API \u226E' });
    var panel = h('div', { class: 'api-console', style: { display: 'none' } });

    var input = h('input', { type: 'text', placeholder: 'contoh: setMode("OHM")' });
    var sendBtn = h('button', { class: 'send', text: 'Kirim' });
    var logEl = h('div', { class: 'log' });
    var examples = h('div', { class: 'examples' });
    var exList = [
      'setMode("DCV")', 'setMode("ACV")', 'setMode("OHM")', 'setMode("CONT")',
      'setMode("DIODE")', 'setMode("CAP")', 'setMode("HZ")', 'setMode("DUTY")',
      'setMode("DCA")', 'setMode("ACA")', 'setMode("OFF")',
      'cycleRange()', 'autoRange()', 'hold()', 'rel()', 'select()',
      'setPower(true)', 'setPower(false)',
      'getState()', 'getReading()',
      'setMeasurement({type:"voltage",samples:new Float32Array([5,5,5,5]),sampleRate:1000,scalar:5})',
      'clearMeasurement()'
    ];
    exList.forEach(function (t) {
      var b = h('button', { class: 'ex', text: t });
      b.addEventListener('click', function () { input.value = t; run(); });
      examples.appendChild(b);
    });

    panel.appendChild(h('div', { class: 'head' },
      h('span', { class: 'badge', text: 'AVO API' }),
      h('span', { class: 'title', text: 'Console' }),
      h('span', { class: 'dim', style: { color: '#8f97a1', fontSize: '11px' }, text: 'format: cmd(arg1, arg2, ...)' }),
      h('button', { class: 'close', text: 'X', onclick: function () { panel.style.display = 'none'; } })));
    panel.appendChild(h('div', { class: 'body' },
      h('div', { class: 'left' },
        h('div', { class: 'cmdrow' }, input, sendBtn),
        examples),
      logEl));

    function parseCall(line) {
      line = line.trim();
      var m = line.match(/^(\w+)\s*\(([\s\S]*)\)\s*;?\s*$/);
      if (!m) return { cmd: line, args: [] };
      var cmd = m[1], raw = m[2].trim();
      if (!raw) return { cmd: cmd, args: [] };
      // safe-ish arg parse: handle strings, numbers, true/false, null, JSON-ish
      try {
        // try JSON first if it looks like an array/object
        if (raw[0] === '{' || raw[0] === '[') {
          return { cmd: cmd, args: [JSON.parse(raw)] };
        }
        // split top-level commas
        var args = [];
        var depth = 0, cur = '', inStr = false, q = '';
        for (var i = 0; i < raw.length; i++) {
          var ch = raw[i];
          if (inStr) {
            cur += ch;
            if (ch === '\\') { cur += raw[++i] || ''; continue; }
            if (ch === q) inStr = false;
            continue;
          }
          if (ch === '"' || ch === "'") { inStr = true; q = ch; cur += ch; continue; }
          if (ch === '(' || ch === '[' || ch === '{') { depth++; cur += ch; continue; }
          if (ch === ')' || ch === ']' || ch === '}') { depth--; cur += ch; continue; }
          if (ch === ',' && depth === 0) { args.push(cur.trim()); cur = ''; continue; }
          cur += ch;
        }
        if (cur.trim()) args.push(cur.trim());
        args = args.map(function (a) {
          a = a.trim();
          if (a === 'true') return true;
          if (a === 'false') return false;
          if (a === 'null') return null;
          if (a === 'undefined') return undefined;
          if (a[0] === '"' || a[0] === "'") return a.slice(1, -1);
          if (a[0] === '{' || a[0] === '[') return JSON.parse(a);
          if (/^-?\d/.test(a) && !isNaN(Number(a))) return Number(a);
          return a;
        });
        return { cmd: cmd, args: args };
      } catch (e) {
        return { cmd: cmd, args: [raw] };
      }
    }

    function logLine(cls, text) {
      var line = h('div', { class: cls, text: text });
      logEl.appendChild(line);
      logEl.scrollTop = logEl.scrollHeight;
      while (logEl.children.length > 200) logEl.removeChild(logEl.firstChild);
    }

    function run() {
      var line = input.value.trim();
      if (!line) return;
      var parsed = parseCall(line);
      logLine('cmd', '> ' + line);
      var res = engine.handleCommand(parsed.cmd, parsed.args);
      if (res.ok) logLine('ok', '\u2713 ' + (typeof res.data === 'object' ? JSON.stringify(res.data) : String(res.data)));
      else logLine('err', '\u00D7 ' + res.error);
      input.value = '';
    }
    sendBtn.addEventListener('click', run);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') run(); });
    fab.addEventListener('click', function () { panel.style.display = panel.style.display === 'none' ? 'block' : 'none'; });

    // also log events broadcast by the engine
    engine.on('reading', function (r) {
      // throttle: only log if display text changed
      if (r && r.display !== run._lastDisp) {
        run._lastDisp = r.display;
        // logEl too noisy — skip
      }
    });

    return { fab: fab, panel: panel };
  }

  /* ======================================================================
   * Beep audio (continuity)
   * ==================================================================== */
  function createBeep() {
    var ctx = null;
    function ensure() {
      if (!ctx) {
        try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; }
      }
      return ctx;
    }
    return function beep(freq, dur) {
      var c = ensure(); if (!c) return;
      try {
        var osc = c.createOscillator();
        var gain = c.createGain();
        osc.type = 'square';
        osc.frequency.value = freq || 4000;
        gain.gain.value = 0.0001;
        osc.connect(gain).connect(c.destination);
        var t = c.currentTime;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.18, t + 0.005);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + (dur || 0.06));
        osc.start(t);
        osc.stop(t + (dur || 0.06) + 0.01);
      } catch (e) {}
    };
  }

  /* ======================================================================
   * Full instrument UI
   * ==================================================================== */
  function createAVOUI(container) {
    var engine = global.ZAVO.engine;
    var beep = createBeep();

    var app = h('div', { class: 'avo-app' });
    var wrap = h('div', { class: 'avo-scale-wrap' });
    app.appendChild(wrap);
    container.appendChild(app);

    var dmmCase = h('div', { class: 'dmm-case' });
    dmmCase.appendChild(h('div', { class: 'bumper tl' }));
    dmmCase.appendChild(h('div', { class: 'bumper tr' }));
    dmmCase.appendChild(h('div', { class: 'bumper bl' }));
    dmmCase.appendChild(h('div', { class: 'bumper br' }));
    wrap.appendChild(dmmCase);

    // top brand strip
    var brand = h('div', { class: 'brand-sanwa' },
      h('span', { class: 'name', text: 'SANWA' }),
      h('span', { class: 'sub', text: 'Electric Instrument Co., Ltd.' }));
    var model = h('div', { class: 'brand-model' },
      h('span', { class: 'model', text: 'CD800a' }),
      h('span', { class: 'tag', text: 'Z-AVO 800 virtual' }));
    var statusPill = createStatusPill();
    dmmCase.appendChild(h('div', { class: 'dmm-top' }, brand, model));
    dmmCase.appendChild(statusPill.el);

    // panel
    var panel = h('div', { class: 'dmm-panel' });
    dmmCase.appendChild(panel);

    var lcd = createLCD(engine);
    panel.appendChild(lcd.el);

    // knob row: left buttons | knob | right buttons
    var knobRow = h('div', { class: 'knob-row' });
    var leftCol = h('div', { class: 'btn-col left' });
    var rightCol = h('div', { class: 'btn-col right' });
    var rotary = createRotarySelector(engine);
    knobRow.appendChild(leftCol);
    knobRow.appendChild(rotary.el);
    knobRow.appendChild(rightCol);
    panel.appendChild(knobRow);

    // function buttons (Sanwa CD800a layout: POWER, HOLD top; RANGE, REL, SELECT bottom)
    var powerBtn = createFnButton({ label: 'POWER', variant: 'power', led: true, ledColor: '#ffd24a',
      onPress: function () { var st = engine.getState(); engine.handleCommand('setPower', [!st.power]); } });
    var holdBtn = createFnButton({ label: 'HOLD', led: true, ledColor: '#38e05f',
      onPress: function () { engine.handleCommand('hold', []); } });
    var rangeBtn = createFnButton({ label: 'RANGE', sub: 'AUTO/MAN', led: false,
      onPress: function () { engine.handleCommand('cycleRange', []); } });
    var relBtn = createFnButton({ label: 'REL', sub: '\u0394', led: true, ledColor: '#38e05f',
      onPress: function () { engine.handleCommand('rel', []); } });
    var selectBtn = createFnButton({ label: 'SELECT', sub: 'FUNC', led: false,
      onPress: function () { engine.handleCommand('select', []); } });
    var hzDutyBtn = createFnButton({ label: 'Hz/DUTY', led: false,
      onPress: function () {
        var st = engine.getState();
        if (st.mode === 'HZ') engine.handleCommand('setMode', ['DUTY']);
        else if (st.mode === 'DUTY') engine.handleCommand('setMode', ['HZ']);
        else engine.handleCommand('setMode', ['HZ']);
      } });

    leftCol.appendChild(powerBtn.el);
    leftCol.appendChild(holdBtn.el);
    leftCol.appendChild(rangeBtn.el);
    rightCol.appendChild(relBtn.el);
    rightCol.appendChild(selectBtn.el);
    rightCol.appendChild(hzDutyBtn.el);

    // jacks
    panel.appendChild(createJacks(engine));

    // bezel
    dmmCase.appendChild(h('div', { class: 'dmm-bezel' },
      h('span', { text: 'CAT III 600V / CAT II 600V' }),
      h('span', { class: 'cat', text: '\u26A1 4000 COUNTS' })));

    // API console
    var apiConsole = createAPIConsole(engine);
    app.appendChild(apiConsole.fab);
    app.appendChild(apiConsole.panel);

    /* ----- sync UI to engine state ----- */
    function applyState(st) {
      // power
      lcd.setPower(st.power);
      powerBtn.setOn(st.power);
      // flags + button LEDs
      lcd.setFlags(st, st.lastReading);
      holdBtn.setLit(st.hold);
      relBtn.setLit(st.relActive);
      // knob position
      rotary.applyState(st);
      // status pill (live if last input recent)
      var live = st.lastInputAt > 0 && (Date.now() - st.lastInputAt) < 1500;
      statusPill.setConnected(live);
    }
    function applyReading(r) {
      lcd.setReading(r);
    }

    engine.on('state', applyState);
    engine.on('reading', applyReading);
    engine.on('beep', function (b) { beep(b.freq, b.dur); });

    // initial paint
    applyState(engine.getState());
    applyReading(engine.getReading());

    // responsive scaling (fit to viewport width)
    function rescale() {
      var pad = 24;
      var availW = window.innerWidth - pad;
      var scale = Math.min(1, availW / 560);
      wrap.style.transform = 'scale(' + scale + ')';
    }
    rescale();
    window.addEventListener('resize', rescale);

    return {
      engine: engine,
      dispose: function () { engine.dispose(); }
    };
  }

  /* ======================================================================
   * Sim demo UI — RC low-pass + voltage divider streaming into the AVOmeter
   * Two probe components placed on the schematic like real probe tips.
   * ==================================================================== */
  function createSimDemoUI(container) {
    var engine = global.ZAVO.engine;

    var app = h('div', { class: 'sim-app' });
    container.appendChild(app);

    // ---- demo circuit state ----
    var state = {
      streaming: true,
      waveType: 'dc',
      vSupply: 5,
      r1: 1000,
      r2: 2200,
      redNode: 'nA',  // node the red probe touches
      blackNode: 'nB'
    };
    var N = 64;
    var tSim = 0, last = performance.now(), frame = 0;
    var lastCfgKey = '';
    var winDur = 0.01;

    // ---- transport ----
    var useFile = location.protocol === 'file:';
    var bc = null;
    var avoWin = null;
    if (!useFile) {
      try { bc = new BroadcastChannel('avo-bridge'); } catch (e) { bc = null; }
    }
    function send(cmd, args) {
      var msg = { __avo: true, cmd: cmd, args: args };
      if (bc) bc.postMessage(msg);
      else if (avoWin && !avoWin.closed) avoWin.postMessage(msg, '*');
    }
    function onEvent(d) {
      if (d && d.__avo && d.__avoEvent && d.event === 'heartbeat') {
        hbSeen = Date.now();
        if (!connected) { connected = true; statusB.textContent = 'terhubung \u2713 (heartbeat)'; statusB.style.color = '#45e873'; }
      }
    }
    if (bc) bc.onmessage = function (ev) { onEvent(ev.data); };
    else window.addEventListener('message', function (ev) { onEvent(ev.data); });
    var connected = false, hbSeen = 0;
    var wd = setInterval(function () {
      if (connected && Date.now() - hbSeen > 2500) {
        connected = false;
        statusB.textContent = useFile ? 'klik "Buka AVOmeter" dulu (mode file://)' : 'belum terdeteksi';
        statusB.style.color = '#f0685f';
      }
    }, 1000);

    // ---- header ----
    app.appendChild(h('header', { style: { textAlign: 'center' } },
      h('h1', { style: { fontSize: '22px', margin: '0', letterSpacing: '0.5px' },
        html: 'Simulator Sirkuit Demo — <span style="color:#ffd24a">Z-AVO 800 Probe Integration</span>' }),
      h('p', { style: { fontSize: '13px', color: '#8f97a1', marginTop: '6px' },
        html: 'Referensi integrasi: probe merah & hitam ditempatkan pada node sirkuit seperti komponen biasa. Halaman ini mengirim pengukuran ke AVOmeter virtual lewat <code style="color:#7ec8ff">' + (useFile ? 'window.postMessage' : 'BroadcastChannel("avo-bridge")') + '</code>.' })));

    var cardWrap = h('div', { style: { display: 'flex', gap: '18px', flexWrap: 'wrap', justifyContent: 'center', width: '100%', maxWidth: '1080px' } });
    app.appendChild(cardWrap);

    // ---- circuit card (SVG schematic with probe tips) ----
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 380 220');
    svg.style.width = '100%';
    svg.style.background = '#0d1014';
    svg.style.borderRadius = '8px';

    function wire(d, color) { svg.appendChild(svgEl('path', { d: d, stroke: color, 'stroke-width': '2', fill: 'none' })); }

    // schematic: voltage divider R1 (top) -- nA -- R2 (bottom) -- nB -- GND
    // Vsupply at top, GND at bottom
    wire('M50 30 H120', '#7ec8ff'); // supply rail
    wire('M120 30 V70', '#7ec8ff');
    wire('M120 70 H180 M180 70 V100', '#f5c518'); // R1 zigzag (top)
    svg.appendChild(svgEl('path', { d: 'M180 70 l5 -10 l10 20 l10 -20 l10 20 l10 -20 l5 10', stroke: '#f5c518', 'stroke-width': '2', fill: 'none' }));
    wire('M180 100 H120', '#f5c518'); // to nA
    // node A label dot
    svg.appendChild(svgEl('circle', { cx: '120', cy: '100', r: '4', fill: '#ffd24a' }));
    var nALabel = svgEl('text', { x: '92', y: '95', fill: '#ffd24a', 'font-size': '11', 'font-weight': 'bold' }, 'nA');
    svg.appendChild(nALabel);

    // continue down from nA through R2 to nB
    wire('M120 100 V130', '#f5c518');
    wire('M120 130 H180 M180 130 V160', '#ea5be0');
    svg.appendChild(svgEl('path', { d: 'M180 130 l5 -10 l10 20 l10 -20 l10 20 l10 -20 l5 10', stroke: '#ea5be0', 'stroke-width': '2', fill: 'none' }));
    wire('M180 160 H120', '#ea5be0');
    svg.appendChild(svgEl('circle', { cx: '120', cy: '160', r: '4', fill: '#48e07a' }));
    var nBLabel = svgEl('text', { x: '92', y: '155', fill: '#48e07a', 'font-size': '11', 'font-weight': 'bold' }, 'nB');
    svg.appendChild(nBLabel);

    // GND
    wire('M120 160 V195', '#5c6570');
    svg.appendChild(svgEl('path', { d: 'M108 195 H132 M112 200 H128 M116 205 H124', stroke: '#5c6570', 'stroke-width': '2' }));
    svg.appendChild(svgEl('text', { x: '136', y: '200', fill: '#5c6570', 'font-size': '10' }, 'GND'));

    // supply label
    svg.appendChild(svgEl('circle', { cx: '50', cy: '30', r: '4', fill: '#7ec8ff' }));
    svg.appendChild(svgEl('text', { x: '20', y: '25', fill: '#7ec8ff', 'font-size': '11' }, 'V+'));

    // R labels
    svg.appendChild(svgEl('text', { x: '195', y: '88', fill: '#f5c518', 'font-size': '11' }, 'R1'));
    svg.appendChild(svgEl('text', { x: '195', y: '148', fill: '#ea5be0', 'font-size': '11' }, 'R2'));

    // ---- probes (placed like components) ----
    // Red probe tip touches nA
    var redProbeX = 120, redProbeY = 100;
    var redTipX = redProbeX, redTipY = redProbeY;
    // Red probe body to the right
    svg.appendChild(svgEl('line', { x1: '120', y1: '100', x2: '260', y2: '60', stroke: '#d8321f', 'stroke-width': '3' }));
    var redBody = svgEl('rect', { x: '255', y: '48', width: '36', height: '14', rx: '5', fill: '#d8321f', stroke: '#7a1b10' });
    svg.appendChild(redBody);
    svg.appendChild(svgEl('text', { x: '262', y: '59', fill: '#fff', 'font-size': '9', 'font-weight': 'bold' }, 'V\u03A9Hz'));
    // tip dot at nA
    svg.appendChild(svgEl('circle', { cx: '120', cy: '100', r: '6', fill: '#d8321f', stroke: '#7a1b10', 'stroke-width': '1.5' }));
    var redTipPulse = svgEl('circle', { cx: '120', cy: '100', r: '4', fill: '#fff', opacity: '0.7' });
    svg.appendChild(redTipPulse);

    // Black probe tip touches nB
    svg.appendChild(svgEl('line', { x1: '120', y1: '160', x2: '260', y2: '200', stroke: '#15171a', 'stroke-width': '3' }));
    var blackBody = svgEl('rect', { x: '255', y: '192', width: '36', height: '14', rx: '5', fill: '#15171a', stroke: '#000' });
    svg.appendChild(blackBody);
    svg.appendChild(svgEl('text', { x: '262', y: '203', fill: '#fff', 'font-size': '9', 'font-weight': 'bold' }, 'COM'));
    svg.appendChild(svgEl('circle', { cx: '120', cy: '160', r: '6', fill: '#15171a', stroke: '#000', 'stroke-width': '1.5' }));
    var blackTipPulse = svgEl('circle', { cx: '120', cy: '160', r: '4', fill: '#fff', opacity: '0.7' });
    svg.appendChild(blackTipPulse);

    // ---- stats row ----
    var statsRow = h('div', { style: { display: 'flex', gap: '14px', flexWrap: 'wrap', marginTop: '6px', fontSize: '12px' } });
    var statV = h('b', { style: { color: '#ffd24a' } });
    var statVA = h('b', { style: { color: '#48e07a' } });
    var statVB = h('b', { style: { color: '#48e07a' } });
    statsRow.appendChild(h('span', {}, 'V+ : ', statV));
    statsRow.appendChild(h('span', {}, 'V(nA) : ', statVA));
    statsRow.appendChild(h('span', {}, 'V(nB) : ', statVB));

    cardWrap.appendChild(h('div', { style: { flex: '1 1 380px', background: '#15191f', border: '1px solid #262c34', borderRadius: '14px', padding: '18px' } },
      h('div', { style: { fontSize: '11px', letterSpacing: '2px', color: '#8f97a1', marginBottom: '10px', textTransform: 'uppercase' }, text: 'Sirkuit (probe aktif: merah \u2192 nA, hitam \u2192 nB)' }),
      svg, statsRow));

    // ---- controls card ----
    var ctrlCard = h('div', { style: { flex: '1 1 380px', background: '#15191f', border: '1px solid #262c34', borderRadius: '14px', padding: '18px' } });
    ctrlCard.appendChild(h('div', { style: { fontSize: '11px', letterSpacing: '2px', color: '#8f97a1', marginBottom: '12px', textTransform: 'uppercase' }, text: 'Kontrol Sumber & Probe' }));

    var sliders = {};
    [['V supply', 'vSupply', function () { return state.vSupply.toFixed(2) + ' V'; }, 0, 12, 0.01],
     ['R1',       'r1',       function () { return fmtEng(state.r1, '\u03A9', 1); }, 100, 10000, 10],
     ['R2',       'r2',       function () { return fmtEng(state.r2, '\u03A9', 1); }, 100, 10000, 10]
    ].forEach(function (p) {
      var label = p[0], key = p[1], disp = p[2], mn = p[3], mx = p[4], stp = p[5];
      var valLabel = h('b', { style: { color: '#ffd24a' } });
      var input = h('input', { type: 'range', min: String(mn), max: String(mx), step: String(stp), value: String(state[key]),
        'aria-label': label, style: { width: '100%', accentColor: '#ffd24a' } });
      input.addEventListener('input', function () {
        state[key] = Number(input.value);
        valLabel.textContent = disp();
        scheduleConfig();
      });
      sliders[key] = { input: input, valLabel: valLabel };
      ctrlCard.appendChild(h('div', { style: { marginBottom: '12px' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '4px' } },
          h('span', { text: label }), valLabel),
        input));
    });

    // probe target selector
    var redSel = h('select', { style: { padding: '5px 8px', background: '#1a2027', color: '#d7dee6', border: '1px solid #2b323b', borderRadius: '5px' } });
    [['nA', 'nA (atas R2)'], ['nB', 'nB (GND)'], ['V+', 'V+ supply'], ['GND', 'GND']].forEach(function (o) {
      redSel.appendChild(h('option', { value: o[0], text: o[1] }));
    });
    redSel.value = state.redNode;
    redSel.addEventListener('change', function () {
      state.redNode = redSel.value;
      send('attachProbe', ['red', state.redNode]);
      scheduleConfig();
    });
    var blackSel = h('select', { style: { padding: '5px 8px', background: '#1a2027', color: '#d7dee6', border: '1px solid #2b323b', borderRadius: '5px' } });
    [['nB', 'nB (GND)'], ['nA', 'nA (atas R2)'], ['GND', 'GND']].forEach(function (o) {
      blackSel.appendChild(h('option', { value: o[0], text: o[1] }));
    });
    blackSel.value = state.blackNode;
    blackSel.addEventListener('change', function () {
      state.blackNode = blackSel.value;
      send('attachProbe', ['black', state.blackNode]);
      scheduleConfig();
    });
    ctrlCard.appendChild(h('div', { style: { display: 'flex', gap: '14px', marginTop: '6px', marginBottom: '12px', flexWrap: 'wrap' } },
      h('div', {}, h('div', { style: { fontSize: '11px', color: '#8f97a1', marginBottom: '3px' }, text: 'Probe merah (\u2192 V\u03A9Hz)' }), redSel),
      h('div', {}, h('div', { style: { fontSize: '11px', color: '#8f97a1', marginBottom: '3px' }, text: 'Probe hitam (\u2192 COM)' }), blackSel)));

    // mode quick-set buttons
    var modeRow = h('div', { style: { display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' } });
    [['DCV', 'DC V'], ['ACV', 'AC V'], ['OHM', '\u03A9'], ['CONT', 'Continuity'], ['DIODE', 'Diode'], ['DCA', 'DC A'], ['HZ', 'Hz'], ['DUTY', '%'], ['CAP', 'Cap']].forEach(function (p) {
      var b = h('button', { type: 'button', class: 'sim-btn', text: p[1], style: { padding: '5px 10px', fontSize: '11px' } });
      b.addEventListener('click', function () { send('setMode', [p[0]]); });
      modeRow.appendChild(b);
    });
    ctrlCard.appendChild(modeRow);

    var streamBtn = h('button', { type: 'button', class: 'sim-btn sim-primary', text: '\u25A0 Stop streaming' });
    streamBtn.addEventListener('click', function () { state.streaming = !state.streaming; refresh(); });
    var openBtn = h('button', { type: 'button', class: 'sim-btn', text: 'Buka AVOmeter \u2197', style: { color: '#ffd24a' } });
    openBtn.addEventListener('click', function () {
      avoWin = window.open('index.html', 'z-avo', 'width=720,height=900');
      if (avoWin) avoWin.focus();
    });
    ctrlCard.appendChild(h('div', { style: { display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' } }, streamBtn, openBtn));

    var statusB = h('b', { style: { color: '#f0685f' }, text: useFile ? 'klik "Buka AVOmeter" dulu (mode file://)' : 'belum terdeteksi' });
    ctrlCard.appendChild(h('div', { style: { marginTop: '14px', fontSize: '12.5px' } }, 'Status AVOmeter: ', statusB));
    cardWrap.appendChild(ctrlCard);

    // integration snippet card
    app.appendChild(h('div', {
      style: { width: '100%', maxWidth: '1080px', background: '#0d1014', border: '1px solid #262c34', borderRadius: '14px', padding: '18px', fontFamily: 'ui-monospace, monospace', fontSize: '12px', lineHeight: '1.7', color: '#9fb6cc', overflowX: 'auto' }
    },
      h('div', { style: { color: '#8f97a1', marginBottom: '8px' }, text: '// inti integrasi \u2014 sama seperti yang dipakai halaman ini:' }),
      h('div', { html: '<span style="color:#7ec8ff">const</span> bc = <span style="color:#7ec8ff">new</span> BroadcastChannel(<span style="color:#48e07a">"avo-bridge"</span>);' }),
      h('div', { html: 'bc.postMessage({ __avo: <span style="color:#7ec8ff">true</span>, cmd: <span style="color:#48e07a">"setMeasurement"</span>,' }),
      h('div', { html: '&nbsp;&nbsp;args: [{ type: <span style="color:#48e07a">"voltage"</span>, samples: float32Array, sampleRate, scalar: Vred-Vblack, probes: { red: <span style="color:#48e07a">"nA"</span>, black: <span style="color:#48e07a">"nB"</span> } }] });' }),
      h('div', { style: { color: '#5c6570' }, text: '// kendali penuh: setMode \u00b7 setRange \u00b7 hold \u00b7 rel \u00b7 select \u00b7 setPower \u00b7 attachProbe \u00b7 getState \u00b7 getReading \u2026' })));

    function refresh() {
      streamBtn.textContent = state.streaming ? '\u25A0 Stop streaming' : '\u25B6 Start streaming';
      streamBtn.style.background = state.streaming ? 'linear-gradient(180deg,#58e878,#23b84a)' : '#1a2027';
      streamBtn.style.color = state.streaming ? '#052d12' : '#9fb6cc';
      streamBtn.style.border = '1px solid #0f5a26';
      sliders.vSupply.input.value = String(state.vSupply);
      sliders.vSupply.valLabel.textContent = state.vSupply.toFixed(2) + ' V';
      sliders.r1.input.value = String(state.r1);
      sliders.r1.valLabel.textContent = fmtEng(state.r1, '\u03A9', 1);
      sliders.r2.input.value = String(state.r2);
      sliders.r2.valLabel.textContent = fmtEng(state.r2, '\u03A9', 1);
    }
    refresh();

    /* ----- compute node voltages ----- */
    function nodeVoltages() {
      // voltage divider: V(nA) = V+ * R2/(R1+R2), V(nB) = 0
      var vPlus = state.vSupply;
      var vA = vPlus * state.r2 / (state.r1 + state.r2);
      var vB = 0;
      return { 'V+': vPlus, 'nA': vA, 'nB': vB, 'GND': 0 };
    }

    function sendConfig() {
      // tell AVOmeter which probes are attached
      send('attachProbe', ['red', state.redNode]);
      send('attachProbe', ['black', state.blackNode]);
      send('setMode', ['DCV']);
    }
    var cfgTimer = 0;
    function scheduleConfig() {
      clearTimeout(cfgTimer);
      cfgTimer = setTimeout(function () {
        var key = state.vSupply + '|' + state.r1 + '|' + state.r2 + '|' + state.redNode + '|' + state.blackNode;
        if (key !== lastCfgKey) { lastCfgKey = key; sendConfig(); }
      }, 120);
    }

    /* ----- animation loop: ~30 fps, send measurement ----- */
    var raf = 0;
    function loop(ts) {
      raf = requestAnimationFrame(loop);
      var dt = Math.min((ts - last) / 1000, 0.05);
      last = ts;
      if (!state.streaming) return;
      tSim += dt;

      var nodes = nodeVoltages();
      var vRed = nodes[state.redNode] != null ? nodes[state.redNode] : 0;
      var vBlack = nodes[state.blackNode] != null ? nodes[state.blackNode] : 0;
      var vDiff = vRed - vBlack;

      // update stats display
      statV.textContent = state.vSupply.toFixed(2) + ' V';
      statVA.textContent = nodes.nA.toFixed(3) + ' V';
      statVB.textContent = nodes.nB.toFixed(3) + ' V';

      // pulse the probe tips to show they're alive
      var pulse = 0.5 + 0.5 * Math.sin(tSim * 6);
      redTipPulse.setAttribute('opacity', String(0.4 + pulse * 0.4));
      blackTipPulse.setAttribute('opacity', String(0.4 + pulse * 0.4));

      if (frame++ % 2 === 0) {
        // build a small Float32Array of the measured voltage (constant DC)
        var s = new Float32Array(N);
        for (var i = 0; i < N; i++) s[i] = vDiff;
        send('setMeasurement', [{
          type: 'voltage',
          samples: s,
          sampleRate: N / winDur,
          tStart: tSim - winDur,
          scalar: vDiff,
          probes: { red: state.redNode, black: state.blackNode }
        }]);
      }
    }
    raf = requestAnimationFrame(loop);
    sendConfig();

    return {
      dispose: function () {
        cancelAnimationFrame(raf);
        clearInterval(wd);
        clearTimeout(cfgTimer);
        if (bc) bc.close();
      }
    };
  }

  /* ---------------- exports ---------------- */
  Z.createAVOUI = createAVOUI;
  Z.createSimDemoUI = createSimDemoUI;
})(window);
