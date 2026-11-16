/* ============================================================================
 * Z-DSO 2104 — front-panel UI (standalone, no framework, no build step)
 * ----------------------------------------------------------------------------
 * Depends on z-dso.js (engine). Exposes:
 *   ZDSO.createScopeUI(container)   -> mounts the full instrument panel + API console
 *   ZDSO.createSimDemoUI(container) -> mounts the reference circuit-simulator demo
 * ==========================================================================*/
(function (global) {
  'use strict';
  var Z = global.ZDSO;
  var C = Z.constants;
  var fmtEng = Z.fmtEng, nearestStep = Z.nearestStep, ceilStep = Z.ceilStep;
  var CH_COLORS = C.CH_COLORS, CH_NAMES = C.CH_NAMES;
  var SCREEN_W = C.SCREEN_W, SCREEN_H = C.SCREEN_H;
  var H_DIVS = C.H_DIVS, V_DIVS = C.V_DIVS, DISP_PTS = C.DISP_PTS;
  var TIME_STEPS = C.TIME_STEPS, VOLT_STEPS = C.VOLT_STEPS, FREQ_STEPS = C.FREQ_STEPS;

  var FONT = "11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  var FONT_S = "9.5px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  var BG = '#05080c';

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

  function cyc(arr, cur) {
    var i = arr.indexOf(cur);
    return arr[(i + 1) % arr.length];
  }

  /* ======================================================================
   * Knob — drag up/down to turn, wheel to step, double-click reset,
   * arrow keys when focused. Each ~7px of vertical drag = one detent step.
   * ==================================================================== */
  function createKnob(opts) {
    var size = opts.size || 64;
    var state = { angle: -30, onStep: opts.onStep };
    var unit = h('div', { class: 'knob-unit' });
    var holder = h('div', { style: { position: 'relative', width: (size + 18) + 'px', height: (size + 18) + 'px' } });
    var ticks = h('div', { class: 'knob-ticks' });
    for (var i = 0; i < (opts.ticks || 11); i++) {
      var a = -135 + (270 * i) / ((opts.ticks || 11) - 1);
      ticks.appendChild(h('i', { style: { transform: 'rotate(' + a + 'deg) translateY(-' + (size / 2 + 5) + 'px)', transformOrigin: '50% 0' } }));
    }
    var knobEl = h('div', {
      class: 'knob', role: 'slider', tabindex: '0',
      'aria-label': opts.label || 'knob',
      style: { width: size + 'px', height: size + 'px', margin: '9px' }
    }, h('div', { class: 'ridges' }), h('div', { class: 'knob-cap' }));
    var pointer = h('div', {
      class: 'pointer',
      style: { top: '3px', height: (size * 0.3) + 'px', transformOrigin: '2px ' + (size / 2 - 3) + 'px' }
    });
    if (opts.pointerColor) pointer.style.background = 'linear-gradient(180deg, ' + opts.pointerColor + ', ' + opts.pointerColor + 'aa)';
    knobEl.appendChild(pointer);
    holder.appendChild(ticks); holder.appendChild(knobEl);
    unit.appendChild(holder);

    var labelEl = null, valueEl = null;
    if (opts.label) { labelEl = h('div', { class: 'knob-label', text: opts.label }); unit.appendChild(labelEl); }
    if (opts.value !== undefined) { valueEl = h('div', { class: 'knob-value', text: opts.value }); unit.appendChild(valueEl); }

    function step(dir, fine) {
      state.angle = Math.max(-135, Math.min(135, state.angle + dir * (fine ? 4 : 15)));
      pointer.style.transform = 'rotate(' + state.angle + 'deg)';
      state.onStep(dir, !!fine);
    }

    var drag = null;
    knobEl.addEventListener('pointerdown', function (e) {
      knobEl.setPointerCapture(e.pointerId);
      drag = { y: e.clientY, acc: 0 };
    });
    knobEl.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var dy = drag.y - e.clientY;
      drag.y = e.clientY;
      drag.acc += dy;
      var thresh = 7;
      while (drag.acc > thresh) { drag.acc -= thresh; step(1, e.shiftKey); }
      while (drag.acc < -thresh) { drag.acc += thresh; step(-1, e.shiftKey); }
    });
    function endDrag() { drag = null; }
    knobEl.addEventListener('pointerup', endDrag);
    knobEl.addEventListener('pointercancel', endDrag);
    // React attaches onWheel passively; here we bind natively so the page
    // doesn't scroll while turning the knob.
    knobEl.addEventListener('wheel', function (e) {
      e.preventDefault();
      step(e.deltaY < 0 ? 1 : -1, e.shiftKey);
    }, { passive: false });
    knobEl.addEventListener('dblclick', function () { if (opts.onReset) opts.onReset(); });
    knobEl.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { e.preventDefault(); step(1); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { e.preventDefault(); step(-1); }
    });

    return {
      el: unit,
      setLabel: function (t) { if (labelEl) labelEl.textContent = t; },
      setValue: function (t, dim) {
        if (!valueEl) return;
        valueEl.textContent = t;
        valueEl.classList.toggle('dim', !!dim);
      },
      onStep: function (fn) { state.onStep = fn; }
    };
  }

  /* ======================================================================
   * PanelButton — front-panel push button with LED
   * ==================================================================== */
  function createPanelButton(opts) {
    var variantClass =
      opts.variant === 'ch' ? 'ch-btn' :
      opts.variant === 'run' ? 'run-btn' :
      opts.variant === 'util' ? 'util-btn' :
      opts.variant === 'mini' ? 'mini-btn' : '';
    var led = h('span', { class: 'led' });
    var legend = h('span', { class: 'btn-legend' },
      h('span', { text: opts.label }),
      opts.sub ? h('span', { class: 'btn-sub', text: opts.sub }) : null);
    var btn = h('button', {
      type: 'button', class: 'panel-btn ' + variantClass,
      title: opts.title || '', 'aria-pressed': 'false'
    }, led, legend);
    btn.style.setProperty('--led', opts.ledColor || '#45e873');
    if (opts.onPress) btn.addEventListener('click', opts.onPress);
    var stopMode = false;
    return {
      el: btn,
      setLit: function (v) {
        btn.classList.toggle('led-on', !!v);
        btn.setAttribute('aria-pressed', v ? 'true' : 'false');
      },
      setActive: function (v) { btn.classList.toggle('active-ch', !!v); },
      setRun: function (running) {
        btn.classList.toggle('run-on', !!running);
        btn.classList.toggle('stop-on', stopMode && !running);
      },
      setStopMode: function (v) { stopMode = !!v; },
      setLabel: function (t) { legend.firstChild.textContent = t; }
    };
  }

  /* ======================================================================
   * Screen — graticule, glowing traces, persistence, trigger markers,
   * cursors, FFT, XY mode, on-screen readouts, pointer interaction.
   * ==================================================================== */
  function yOfVolt(v, voltsDiv, offset) {
    return SCREEN_H / 2 - (v + offset) * (SCREEN_H / V_DIVS / voltsDiv);
  }

  function createScreen(engine, getPowerOn) {
    var wrap = h('div', {
      style: { position: 'relative', width: SCREEN_W + 'px', height: SCREEN_H + 'px', cursor: 'crosshair', lineHeight: '0' }
    });
    var gridCv = h('canvas', { width: SCREEN_W, height: SCREEN_H, style: { width: SCREEN_W + 'px', height: SCREEN_H + 'px' } });
    var traceCv = h('canvas', { width: SCREEN_W, height: SCREEN_H, style: { position: 'absolute', inset: '0', width: SCREEN_W + 'px', height: SCREEN_H + 'px' } });
    var markCv = h('canvas', { width: SCREEN_W, height: SCREEN_H, style: { position: 'absolute', inset: '0', width: SCREEN_W + 'px', height: SCREEN_H + 'px' } });
    wrap.appendChild(gridCv); wrap.appendChild(traceCv); wrap.appendChild(markCv);
    wrap.appendChild(h('div', { class: 'screen-glass' }));
    var standby = h('div', { class: 'screen-off', text: 'STANDBY', style: { display: 'none' } });
    wrap.appendChild(standby);

    var persistCv = null;
    var hits = { trigY: -99, grounds: [], curX: { a: -99, b: -99 }, curY: { a: -99, b: -99 } };
    var drag = null;
    var lastTs = 0;

    /* ----- graticule ----- */
    function drawGrid() {
      var ctx = gridCv.getContext('2d');
      var dpr = window.devicePixelRatio || 1;
      if (gridCv.width !== SCREEN_W * dpr) {
        gridCv.width = SCREEN_W * dpr;
        gridCv.height = SCREEN_H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
      var dw = SCREEN_W / H_DIVS, dh = SCREEN_H / V_DIVS;
      var grid = engine.display.grid;
      if (grid !== 'none') {
        ctx.strokeStyle = grid === 'full' ? '#182430' : '#101820';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (var i = 1; i < H_DIVS; i++) { ctx.moveTo(i * dw + 0.5, 0); ctx.lineTo(i * dw + 0.5, SCREEN_H); }
        for (var j = 1; j < V_DIVS; j++) { ctx.moveTo(0, j * dh + 0.5); ctx.lineTo(SCREEN_W, j * dh + 0.5); }
        ctx.stroke();
        if (grid === 'full') {
          ctx.strokeStyle = '#223242';
          ctx.beginPath();
          for (var i2 = 0; i2 < H_DIVS * 5; i2++) {
            var x = (i2 * SCREEN_W) / (H_DIVS * 5) + 0.5;
            ctx.moveTo(x, SCREEN_H / 2 - 3); ctx.lineTo(x, SCREEN_H / 2 + 3);
          }
          for (var j2 = 0; j2 < V_DIVS * 5; j2++) {
            var y = (j2 * SCREEN_H) / (V_DIVS * 5) + 0.5;
            ctx.moveTo(SCREEN_W / 2 - 3, y); ctx.lineTo(SCREEN_W / 2 + 3, y);
          }
          ctx.stroke();
        }
      }
      ctx.strokeStyle = '#2b3d50';
      ctx.beginPath();
      ctx.moveTo(0, SCREEN_H / 2 + 0.5); ctx.lineTo(SCREEN_W, SCREEN_H / 2 + 0.5);
      ctx.moveTo(SCREEN_W / 2 + 0.5, 0); ctx.lineTo(SCREEN_W / 2 + 0.5, SCREEN_H);
      ctx.stroke();
      ctx.strokeStyle = '#31404f';
      ctx.strokeRect(0.5, 0.5, SCREEN_W - 1, SCREEN_H - 1);
    }

    /* ----- traces ----- */
    function drawTraces(dt) {
      var ctx = traceCv.getContext('2d');
      var dpr = window.devicePixelRatio || 1;
      if (traceCv.width !== SCREEN_W * dpr) {
        traceCv.width = SCREEN_W * dpr;
        traceCv.height = SCREEN_H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      var pers = engine.display.persistence;
      var view = engine.getView();
      var intensity = engine.display.intensity;

      if (!persistCv) {
        persistCv = document.createElement('canvas');
        persistCv.width = SCREEN_W; persistCv.height = SCREEN_H;
      }
      var pctx = persistCv.getContext('2d');

      if (pers <= 0) {
        ctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
        pctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
      } else {
        var fade = pers === Infinity ? 0 : Math.min(0.4, (dt / pers) * 2.2);
        if (fade > 0) {
          pctx.globalCompositeOperation = 'source-over';
          pctx.fillStyle = 'rgba(5,8,12,' + fade + ')';
          pctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
        }
      }

      var target = pers > 0 ? pctx : ctx;
      if (pers > 0) {
        ctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
        ctx.drawImage(persistCv, 0, 0, SCREEN_W, SCREEN_H);
      }

      function drawPath(arr, color, voltsDiv, offset, lineW) {
        var n = Math.min(arr.length, DISP_PTS);
        target.strokeStyle = color;
        target.lineWidth = lineW || 1.6;
        target.shadowColor = color;
        target.shadowBlur = 8 * intensity;
        target.globalAlpha = 0.35 + 0.65 * intensity;
        target.beginPath();
        var started = false, i, x, y;
        for (i = 0; i < n; i++) {
          x = (i / (DISP_PTS - 1)) * SCREEN_W;
          y = yOfVolt(arr[i], voltsDiv, offset);
          if (!isFinite(y)) { started = false; continue; }
          if (!started) { target.moveTo(x, y); started = true; }
          else target.lineTo(x, y);
        }
        target.stroke();
        target.shadowBlur = 0;
        target.globalAlpha = 1;
      }

      var i, c;
      if (engine.display.xy) {
        var a = view.channels[0], b = view.channels[1];
        if (a.cfg.enabled && b.cfg.enabled) {
          target.strokeStyle = '#5cf0ff';
          target.lineWidth = 1.4;
          target.shadowColor = '#5cf0ff';
          target.shadowBlur = 8 * intensity;
          target.beginPath();
          var ppvA = SCREEN_W / H_DIVS / a.cfg.voltsDiv;
          for (i = 0; i < DISP_PTS; i++) {
            var x2 = SCREEN_W / 2 - (a.disp[i] + a.cfg.offset) * -ppvA;
            var y2 = yOfVolt(b.disp[i], b.cfg.voltsDiv, b.cfg.offset);
            if (i === 0) target.moveTo(x2, y2); else target.lineTo(x2, y2);
          }
          target.stroke();
          target.shadowBlur = 0;
        }
      } else {
        view.channels.forEach(function (ch, idx) {
          if (!ch.cfg.enabled) return;
          drawPath(ch.disp, CH_COLORS[idx], ch.cfg.voltsDiv, ch.cfg.offset);
          if (ch.peakLo && ch.peakHi) {
            target.strokeStyle = CH_COLORS[idx];
            target.lineWidth = 1;
            target.shadowColor = CH_COLORS[idx];
            target.shadowBlur = 4;
            target.globalAlpha = 0.8;
            var m = ch.peakLo.length;
            target.beginPath();
            for (c = 0; c < m; c++) {
              var xh = (c / (m - 1)) * SCREEN_W;
              var yh = yOfVolt(ch.peakHi[c], ch.cfg.voltsDiv, ch.cfg.offset);
              if (c === 0) target.moveTo(xh, yh); else target.lineTo(xh, yh);
            }
            for (c = m - 1; c >= 0; c--) {
              var xl = (c / (m - 1)) * SCREEN_W;
              var yl = yOfVolt(ch.peakLo[c], ch.cfg.voltsDiv, ch.cfg.offset);
              target.lineTo(xl, yl);
            }
            target.closePath();
            target.globalAlpha = 0.35;
            target.fillStyle = CH_COLORS[idx] + '30';
            target.fill();
            target.globalAlpha = 1;
            target.shadowBlur = 0;
          }
        });
        if (view.math) {
          var mx = 1e-9;
          for (i = 0; i < DISP_PTS; i++) mx = Math.max(mx, Math.abs(view.math.disp[i]));
          var vdiv = Math.max(1e-3, mx / 3);
          drawPath(view.math.disp, C.MATH_COLOR, vdiv, 0, 1.4);
        }
        if (engine.fftResult) {
          var fr = engine.fftResult;
          var bandTop = SCREEN_H * 0.52, bandH = SCREEN_H * 0.4;
          target.fillStyle = 'rgba(0,0,0,0.62)';
          target.fillRect(4, bandTop, SCREEN_W - 8, bandH);
          target.strokeStyle = '#1c2a38';
          target.strokeRect(4.5, bandTop + 0.5, SCREEN_W - 9, bandH);
          target.strokeStyle = C.FFT_COLOR;
          target.lineWidth = 1.2;
          target.shadowColor = C.FFT_COLOR;
          target.shadowBlur = 6;
          target.beginPath();
          var nb = fr.db.length;
          for (var k = 0; k < nb; k++) {
            var xf = (k / (nb - 1)) * (SCREEN_W - 12) + 6;
            var db = Math.max(-80, Math.min(0, fr.db[k]));
            var yf = bandTop + bandH - ((db + 80) / 80) * (bandH - 8) - 4;
            if (k === 0) target.moveTo(xf, yf); else target.lineTo(xf, yf);
          }
          target.stroke();
          target.shadowBlur = 0;
          target.fillStyle = C.FFT_COLOR;
          target.font = FONT_S;
          var bw = engine.windowDur > 0 ? (DISP_PTS - 1) / engine.windowDur / 2 : 0;
          target.fillText('FFT  CH' + (fr.src + 1) + '   0 – ' + fmtEng(bw, 'Hz', 2) + '   10dB/div', 12, bandTop + 14);
        }
      }
    }

    /* ----- markers & text ----- */
    function drawMarkers() {
      var ctx = markCv.getContext('2d');
      var dpr = window.devicePixelRatio || 1;
      if (markCv.width !== SCREEN_W * dpr) {
        markCv.width = SCREEN_W * dpr;
        markCv.height = SCREEN_H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
      ctx.font = FONT;
      ctx.textBaseline = 'middle';

      var view = engine.getView();
      var win = view.win;
      hits.grounds = [];

      function xOfTime(t) { return ((t - win.t0) / win.window) * SCREEN_W; }

      // channel ground markers (right edge)
      view.channels.forEach(function (ch, i) {
        if (!ch.cfg.enabled) return;
        var ppv = SCREEN_H / V_DIVS / ch.cfg.voltsDiv;
        var y = Math.max(10, Math.min(SCREEN_H - 10, SCREEN_H / 2 - ch.cfg.offset * ppv));
        hits.grounds.push({ ch: i, y: y });
        ctx.fillStyle = CH_COLORS[i];
        ctx.beginPath();
        ctx.moveTo(SCREEN_W - 1, y); ctx.lineTo(SCREEN_W - 11, y - 6); ctx.lineTo(SCREEN_W - 11, y + 6);
        ctx.closePath(); ctx.fill();
        ctx.font = 'bold 10px sans-serif';
        ctx.fillText(String(i + 1), SCREEN_W - 26, y);
        ctx.font = FONT;
      });

      // trigger marker T (top) + level arrow (right)
      var tx = view.trig.x * SCREEN_W;
      ctx.fillStyle = '#e8edf3';
      ctx.beginPath();
      ctx.moveTo(tx, 2); ctx.lineTo(tx - 5, 10); ctx.lineTo(tx + 5, 10);
      ctx.closePath(); ctx.fill();
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText('T', tx + 7, 8);
      ctx.font = FONT;

      var src = view.channels[view.trig.source];
      if (src.cfg.enabled) {
        var ty = Math.max(10, Math.min(SCREEN_H - 10, yOfVolt(view.trig.level, src.cfg.voltsDiv, src.cfg.offset)));
        hits.trigY = ty;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(SCREEN_W - 1, ty); ctx.lineTo(SCREEN_W - 11, ty - 6); ctx.lineTo(SCREEN_W - 11, ty + 6);
        ctx.closePath(); ctx.fill();
        ctx.fillText('T', SCREEN_W - 26, ty);
      }

      // cursors
      var cur = engine.cursors;
      if (cur.enabled) {
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 1.2;
        var xa = Math.max(0, Math.min(SCREEN_W, xOfTime(cur.vA)));
        var xb = Math.max(0, Math.min(SCREEN_W, xOfTime(cur.vB)));
        hits.curX = { a: xa, b: xb };
        ctx.strokeStyle = C.CURSOR_A_COLOR;
        ctx.beginPath(); ctx.moveTo(xa + 0.5, 0); ctx.lineTo(xa + 0.5, SCREEN_H); ctx.stroke();
        ctx.fillStyle = C.CURSOR_A_COLOR;
        ctx.fillText('A', xa + 4, 14);
        ctx.strokeStyle = C.CURSOR_B_COLOR;
        ctx.beginPath(); ctx.moveTo(xb + 0.5, 0); ctx.lineTo(xb + 0.5, SCREEN_H); ctx.stroke();
        ctx.fillStyle = C.CURSOR_B_COLOR;
        ctx.fillText('B', xb + 4, 28);
        var srcVd = src.cfg.voltsDiv;
        var ppv = SCREEN_H / V_DIVS / srcVd;
        var ya = Math.max(0, Math.min(SCREEN_H, SCREEN_H / 2 - cur.hA * ppv));
        var yb = Math.max(0, Math.min(SCREEN_H, SCREEN_H / 2 - cur.hB * ppv));
        hits.curY = { a: ya, b: yb };
        ctx.strokeStyle = C.CURSOR_A_COLOR;
        ctx.beginPath(); ctx.moveTo(0, ya + 0.5); ctx.lineTo(SCREEN_W, ya + 0.5); ctx.stroke();
        ctx.fillStyle = C.CURSOR_A_COLOR;
        ctx.fillText('A', 6, ya - 8);
        ctx.strokeStyle = C.CURSOR_B_COLOR;
        ctx.beginPath(); ctx.moveTo(0, yb + 0.5); ctx.lineTo(SCREEN_W, yb + 0.5); ctx.stroke();
        ctx.fillStyle = C.CURSOR_B_COLOR;
        ctx.fillText('B', 6, yb - 8);
        ctx.setLineDash([]);

        var dT = Math.abs(cur.vB - cur.vA);
        var dV = Math.abs(cur.hB - cur.hA);
        var label = 'ΔV=' + fmtEng(dV, 'V', 2) + '  ΔT=' + fmtEng(dT, 's', 2) + '  1/ΔT=' + (dT > 0 ? fmtEng(1 / dT, 'Hz', 2) : '--');
        ctx.font = FONT_S;
        var w = ctx.measureText(label).width + 14;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(SCREEN_W - w - 8, 40, w, 18);
        ctx.strokeStyle = '#2c3742';
        ctx.strokeRect(SCREEN_W - w - 7.5, 40.5, w - 1, 17);
        ctx.fillStyle = '#dfe7ef';
        ctx.fillText(label, SCREEN_W - w, 49);
        ctx.font = FONT;
      }

      // text readouts — channel info (top-left)
      var iy = 14;
      view.channels.forEach(function (ch, i) {
        if (!ch.cfg.enabled) return;
        ctx.fillStyle = CH_COLORS[i];
        var info = CH_NAMES[i] + '  ' + fmtEng(ch.cfg.voltsDiv, 'V', 1) + '/div  ' + ch.cfg.coupling + (ch.cfg.probe > 1 ? ' 10X' : '') + (ch.cfg.invert ? ' ⤺' : '') + (ch.cfg.bwLimit ? ' BW' : '');
        ctx.fillText(info, 8, iy);
        iy += 15;
      });
      if (view.math) {
        ctx.fillStyle = C.MATH_COLOR;
        ctx.fillText('MATH  ' + engine.math.op, 8, iy);
        iy += 15;
      }

      // trigger status (top-right)
      var status = view.trigStatus;
      var statusColor =
        status === "TRIG'D" ? '#45e873' :
        status === 'AUTO' ? '#f5c518' :
        status === 'STOP' ? '#f0685f' :
        status === 'WAIT' ? '#ff9d45' : '#f5c518';
      ctx.font = 'bold 12px sans-serif';
      ctx.fillStyle = statusColor;
      var tw = ctx.measureText(status).width;
      ctx.fillText(status, SCREEN_W - tw - 8, 14);
      ctx.font = FONT;

      // bottom-left: timebase
      ctx.fillStyle = '#e8edf3';
      ctx.fillText('H: ' + fmtEng(engine.time.timeDiv, 's', 1) + '/div', 8, SCREEN_H - 10);
      // bottom-right: trigger info
      var tinfo = 'Trig ' + CH_NAMES[view.trig.source] + ' ' + (view.trig.edge === 'rising' ? '↑' : '↓') + ' ' + fmtEng(view.trig.level, 'V', 2);
      var tiw = ctx.measureText(tinfo).width;
      ctx.fillStyle = '#cfd6de';
      ctx.fillText(tinfo, SCREEN_W - tiw - 8, SCREEN_H - 10);

      // auto-measure chips (bottom, above timebase line)
      var enabledIdx = [0, 1, 2, 3].filter(function (i) { return view.channels[i].cfg.enabled; });
      if (enabledIdx.length) {
        var metrics = enabledIdx.length > 2
          ? [['Vpp', function (m) { return fmtEng(m.vpp, 'V', 2); }],
             ['Freq', function (m) { return m.freq > 0 ? fmtEng(m.freq, 'Hz', 2) : '----'; }]]
          : [['Vpp', function (m) { return fmtEng(m.vpp, 'V', 2); }],
             ['Vrms', function (m) { return fmtEng(m.vrms, 'V', 2); }],
             ['Freq', function (m) { return m.freq > 0 ? fmtEng(m.freq, 'Hz', 2) : '----'; }],
             ['Per', function (m) { return m.period > 0 ? fmtEng(m.period, 's', 2) : '----'; }]];
        var chipH = enabledIdx.length > 2 ? 15 : 24;
        ctx.font = FONT_S;
        enabledIdx.forEach(function (ci, k) {
          var m = engine.channels[ci].meas;
          var txt = metrics.map(function (p) { return p[0] + ':' + p[1](m); }).join('  ');
          var w = ctx.measureText(txt).width + 34;
          var chipY = SCREEN_H - 18 - (k + 1) * chipH - k * 3;
          ctx.fillStyle = 'rgba(0,0,0,0.55)';
          ctx.fillRect(6, chipY, w, chipH);
          ctx.strokeStyle = CH_COLORS[ci] + '55';
          ctx.strokeRect(6.5, chipY + 0.5, w, chipH);
          ctx.fillStyle = CH_COLORS[ci];
          ctx.fillText(CH_NAMES[ci], 12, chipY + chipH / 2 + 1);
          ctx.fillStyle = '#e6ecf2';
          ctx.fillText(txt, 34, chipY + chipH / 2 + 1);
        });
      }
    }

    /* ----- main render loop ----- */
    var raf = 0;
    function loop(ts) {
      raf = requestAnimationFrame(loop);
      var dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.05) : 1 / 60;
      lastTs = ts;
      engine.tick(dt);
      if (!getPowerOn()) { return; }
      drawTraces(dt);
      drawMarkers();
    }
    raf = requestAnimationFrame(loop);
    // Background fallback: rAF is suspended in hidden tabs, which would stop
    // the engine heartbeat — a streaming simulator page in another tab then
    // reports the scope as "not detected". This interval keeps acquisition +
    // heartbeat alive while hidden (throttled to ~1 Hz; measure real dt).
    var lastBg = 0;
    var iv = setInterval(function () {
      if (!document.hidden) { lastBg = 0; return; }
      var now = performance.now();
      var dt = lastBg ? Math.min((now - lastBg) / 1000, 0.5) : 0.1;
      lastBg = now;
      engine.tick(dt);
    }, 100);

    var lastGrid = engine.display.grid;
    var gridPoll = setInterval(function () {
      if (engine.display.grid !== lastGrid) { lastGrid = engine.display.grid; drawGrid(); }
    }, 120);
    drawGrid();

    /* ----- pointer interaction ----- */
    function toCanvas(e) {
      var rect = traceCv.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) / rect.width) * SCREEN_W,
        y: ((e.clientY - rect.top) / rect.height) * SCREEN_H
      };
    }
    wrap.addEventListener('pointerdown', function (e) {
      wrap.setPointerCapture(e.pointerId);
      var p = toCanvas(e);
      var mode = { kind: 'pan' };
      function near(a, b, tol) { return Math.abs(a - b) < (tol || 8); }
      if (engine.cursors.enabled) {
        if (near(p.x, hits.curX.a, 7)) mode = { kind: 'curT', which: 'vA' };
        else if (near(p.x, hits.curX.b, 7)) mode = { kind: 'curT', which: 'vB' };
        else if (near(p.y, hits.curY.a, 7)) mode = { kind: 'curV', which: 'hA' };
        else if (near(p.y, hits.curY.b, 7)) mode = { kind: 'curV', which: 'hB' };
      }
      if (mode.kind === 'pan') {
        if (p.x > SCREEN_W - 40 && near(p.y, hits.trigY, 9)) mode = { kind: 'trigLevel' };
        else {
          for (var i = 0; i < hits.grounds.length; i++) {
            if (p.x > SCREEN_W - 40 && near(p.y, hits.grounds[i].y, 9)) { mode = { kind: 'offset', ch: hits.grounds[i].ch }; break; }
          }
        }
      }
      drag = { mode: mode, x: p.x, y: p.y };
    });
    wrap.addEventListener('pointermove', function (e) {
      if (!drag) return;
      var p = toCanvas(e);
      var dx = p.x - drag.x, dy = p.y - drag.y;
      drag.x = p.x; drag.y = p.y;
      var win = engine.windowDur;
      switch (drag.mode.kind) {
        case 'pan':
          engine.nudgeHOffset(-dx * (win / SCREEN_W));
          break;
        case 'trigLevel': {
          var src = engine.channels[engine.trig.source];
          var ppv = SCREEN_H / V_DIVS / src.cfg.voltsDiv;
          engine.nudgeTriggerLevel(-dy / ppv);
          break;
        }
        case 'offset': {
          var ch = engine.channels[drag.mode.ch];
          var ppv2 = SCREEN_H / V_DIVS / ch.cfg.voltsDiv;
          engine.nudgeChannelOffset(drag.mode.ch, -dy / ppv2);
          break;
        }
        case 'curT':
          engine.nudgeCursor(drag.mode.which, dx * (win / SCREEN_W));
          break;
        case 'curV': {
          var src2 = engine.channels[engine.trig.source];
          var ppv3 = SCREEN_H / V_DIVS / src2.cfg.voltsDiv;
          engine.nudgeCursor(drag.mode.which, -dy / ppv3);
          break;
        }
      }
    });
    function endDrag2() { drag = null; }
    wrap.addEventListener('pointerup', endDrag2);
    wrap.addEventListener('pointercancel', endDrag2);
    wrap.addEventListener('dblclick', function () { engine.autoSet(); });
    wrap.addEventListener('wheel', function (e) {
      e.preventDefault();
      var idx = nearestStep(TIME_STEPS, engine.time.timeDiv);
      var next = Math.max(0, Math.min(TIME_STEPS.length - 1, idx + (e.deltaY < 0 ? 1 : -1)));
      engine.setHorizontal({ timeDiv: TIME_STEPS[next] });
    }, { passive: false });

    return {
      el: wrap,
      setPowerOn: function (on) { standby.style.display = on ? 'none' : 'flex'; drawGrid(); },
      dispose: function () { cancelAnimationFrame(raf); clearInterval(iv); clearInterval(gridPoll); }
    };
  }

  /* ======================================================================
   * SCOPE PANEL — the full instrument front panel + API console
   * ==================================================================== */
  var WAVE_CYCLE = ['off', 'sine', 'square', 'triangle', 'sawtooth', 'pulse', 'dc', 'noise', 'am'];
  var PERSIST_CYCLE = [0, 0.5, 2, Infinity];

  var EXAMPLES = [
    ['AutoSet', '{"cmd":"autoSet","args":[]}'],
    ['CH2 square 2k', '{"cmd":"setGenerator","args":[1,{"type":"square","freq":2000,"amp":1.5}]}'],
    ['CH3 on', '{"cmd":"setChannel","args":[2,{"enabled":true}]}'],
    ['10ms/div', '{"cmd":"setHorizontal","args":[{"timeDiv":0.01}]}'],
    ['Trig CH2 ↑1V', '{"cmd":"setTrigger","args":[{"source":1,"level":1,"edge":"rising"}]}'],
    ['Persist ∞', '{"cmd":"setDisplay","args":[{"persistence":1e9}]}'],
    ['XY mode', '{"cmd":"setDisplay","args":[{"xy":true}]}'],
    ['FFT', '{"cmd":"setDisplay","args":[{"fft":true}]}'],
    ['Peak detect', '{"cmd":"setAcquisition","args":[{"mode":"peak"}]}'],
    ['Cursors on', '{"cmd":"setCursors","args":[{"enabled":true,"vA":-0.001,"vB":0.001}]}'],
    ['Measurements', '{"cmd":"getMeasurements","args":[]}'],
    ['State', '{"cmd":"getState","args":[]}'],
    ['Help', '{"cmd":"help","args":[]}']
  ];

  function isFileProtocol() { return location.protocol === 'file:'; }

  function createScopeUI(container, engineIn) {
    var engine = engineIn || new Z.OscEngine();

    /* ----- UI-local state (mirrors the React version) ----- */
    var selected = 0;
    var menu = 'ch';
    var knobParam = 'genFreq'; // null = nothing selected
    var running = engine.running;
    var armed = engine.armed;
    var powerOn = engine.powerOn;

    /* ----- root & scaling ----- */
    var app = h('div', { class: 'osc-app' });
    container.appendChild(app);
    var scaleWrap = h('div', { class: 'osc-scale-wrap' });
    app.appendChild(scaleWrap);
    var panel = h('div', { class: 'scope-panel' });
    scaleWrap.appendChild(panel);

    /* ----- top strip ----- */
    var pwrCtl = createPanelButton({ label: 'PWR', ledColor: '#38e05f' });
    pwrCtl.el.className = 'power-btn' + (powerOn ? '' : ' off');
    pwrCtl.el.innerHTML = '<span class="led"></span>PWR';
    pwrCtl.el.addEventListener('click', function () {
      powerOn = !powerOn;
      engine.setPower(powerOn);
      syncUI();
    });
    panel.appendChild(h('div', { class: 'scope-top' },
      h('div', { class: 'handle-slot' }),
      pwrCtl.el,
      h('div', { class: 'brand' },
        h('div', { class: 'name', html: 'Z-DSO <span class="accent">2104</span>' }),
        h('div', { class: 'sub', text: '4-CH · 100 MHz · 1 GSa/s Digital Storage Oscilloscope' })),
      h('div', { class: 'handle-slot' })));
    // add screws
    ['tl', 'tr', 'bl', 'br'].forEach(function (p) { panel.appendChild(h('span', { class: 'screw ' + p })); });

    /* ----- main row: screen + softkeys ----- */
    var screenHolder = h('div', { class: 'screen-holder' });
    var screenCtl = createScreen(engine, function () { return powerOn; });
    screenHolder.appendChild(screenCtl.el);

    var softkeysEl = h('div', { class: 'softkeys' });
    var softKeyBtns = [];
    var softKeyDefs = [];
    for (var si = 0; si < 5; si++) {
      (function (idx) {
        var lbl = h('span');
        var val = h('span', { class: 'sk-val', style: { display: 'none' } });
        var on = h('span', { class: 'sk-on', style: { display: 'none' }, text: '● ON' });
        var arrow = h('span', { class: 'sk-arrow', style: { display: 'none' }, text: '▶▶' });
        var b = h('button', { type: 'button', class: 'softkey', title: '' }, lbl, val, on, arrow);
        b.addEventListener('click', function () {
          if (softKeyDefs[idx] && softKeyDefs[idx].press) softKeyDefs[idx].press();
          syncUI();
        });
        softKeyBtns.push({ btn: b, lbl: lbl, val: val, on: on, arrow: arrow });
        softkeysEl.appendChild(b);
      })(si);
    }

    var menuCol = h('div', { class: 'menu-col' });
    var menuBtns = {};
    [['cur', 'Cursor'], ['acq', 'Acquire'], ['disp', 'Display'], ['ch', 'Channel'], ['gen', 'Demo Gen']].forEach(function (p) {
      var b = h('button', { type: 'button', class: 'menu-btn', text: p[1] });
      b.addEventListener('click', function () { menu = p[0]; syncUI(); });
      menuBtns[p[0]] = b;
      menuCol.appendChild(b);
    });

    /* ----- vertical section ----- */
    var chBtns = [];
    var chGrid = h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' } });
    CH_NAMES.forEach(function (name, i) {
      var b = createPanelButton({
        label: name, variant: 'ch', ledColor: CH_COLORS[i],
        title: 'Klik: pilih kanal · klik lagi: On/Off kanal'
      });
      b.el.addEventListener('click', function () {
        if (selected === i) {
          // second press on the already-selected channel toggles it
          engine.setChannel(i, { enabled: !engine.channels[i].cfg.enabled });
        } else {
          selected = i;
          menu = 'ch';
        }
        syncUI();
      });
      chBtns.push(b);
      chGrid.appendChild(b.el);
    });
    var mathBtn = createPanelButton({ label: 'MATH', variant: 'mini', ledColor: '#9d7bff' });
    mathBtn.el.addEventListener('click', function () {
      engine.setMath({ enabled: !engine.math.enabled });
      syncUI();
    });
    mathBtn.el.style.marginTop = '4px';

    var vScale = createKnob({ size: 58, label: 'Scale', value: '1 V/div', pointerColor: CH_COLORS[0] });
    var vPos = createKnob({ size: 58, label: 'Position', value: '0.00 V', pointerColor: CH_COLORS[0] });
    var vWrap = h('div', { style: { display: 'flex', gap: '2px', marginTop: '4px' } }, vScale.el, vPos.el);

    function clampIdx(i, len) { return Math.max(0, Math.min(len - 1, i)); }
    function stepVScale(dir, fine) {
      var ch = engine.channels[selected];
      var i = nearestStep(VOLT_STEPS, ch.cfg.voltsDiv);
      engine.setChannel(selected, { voltsDiv: VOLT_STEPS[clampIdx(i + dir, VOLT_STEPS.length)] });
    }
    function stepVPos(dir, fine) {
      var ch = engine.channels[selected];
      var s = ch.cfg.voltsDiv * (fine ? 0.02 : 0.1);
      engine.setChannel(selected, {
        offset: Math.max(-4 * ch.cfg.voltsDiv, Math.min(4 * ch.cfg.voltsDiv, ch.cfg.offset + dir * s))
      });
    }
    function stepHScale(dir, fine) {
      var i = nearestStep(TIME_STEPS, engine.time.timeDiv);
      engine.setHorizontal({ timeDiv: TIME_STEPS[clampIdx(i + dir, TIME_STEPS.length)] });
    }
    function stepHPos(dir, fine) {
      var win = engine.windowDur;
      var s = engine.time.timeDiv * (fine ? 0.02 : 0.1);
      engine.setHorizontal({ hOffset: Math.max(-win * 5, Math.min(win * 5, engine.time.hOffset + dir * s)) });
    }
    function stepLevel(dir, fine) {
      var src = engine.channels[engine.trig.source];
      var s = src.cfg.voltsDiv * (fine ? 0.02 : 0.1);
      engine.setTrigger({ level: engine.trig.level + dir * s });
    }
    vScale.onStep(stepVScale);
    vPos.onStep(stepVPos);
    vPos.el.addEventListener('dblclick', function () { engine.setChannel(selected, { offset: 0 }); }, true);

    var verticalSection = h('div', { class: 'section', style: { minWidth: '158px' } },
      h('div', { class: 'section-title', text: 'Vertical' }),
      chGrid, mathBtn.el, vWrap);

    var mainRow = h('div', { class: 'scope-main' },
      h('div', { class: 'screen-group' }, screenHolder, softkeysEl),
      menuCol,
      verticalSection);
    panel.appendChild(mainRow);

    /* ----- bottom row ----- */
    var hScale = createKnob({ size: 62, label: 'S/div', value: '500 µs/div' });
    var hPos = createKnob({ size: 62, label: 'Position', value: '0.00 s' });
    hScale.onStep(stepHScale);
    hPos.onStep(stepHPos);
    var horizSection = h('div', { class: 'section', style: { flex: '1.15' } },
      h('div', { class: 'section-title', text: 'Horizontal' }),
      h('div', { style: { display: 'flex', gap: '4px' } }, hScale.el, hPos.el));

    var tLevel = createKnob({ size: 62, label: 'Level', value: '0.00 V' });
    tLevel.onStep(stepLevel);
    var edgeBtn = createPanelButton({ label: '↑ Rise', variant: 'mini', ledColor: '#f5c518', lit: true });
    edgeBtn.el.addEventListener('click', function () {
      engine.setTrigger({ edge: engine.trig.edge === 'rising' ? 'falling' : 'rising' });
      syncUI();
    });
    var trigModeBtn = createPanelButton({ label: 'Mode', variant: 'mini', ledColor: '#f5c518' });
    trigModeBtn.el.addEventListener('click', function () { menu = 'trig'; syncUI(); });
    var sweepBtn = createPanelButton({ label: 'Auto', variant: 'mini' });
    sweepBtn.el.addEventListener('click', function () {
      engine.setTrigger({ sweep: cyc(['auto', 'normal', 'single'], engine.trig.sweep) });
      syncUI();
    });
    var fiftyBtn = createPanelButton({ label: '50%', variant: 'mini' });
    fiftyBtn.el.addEventListener('click', function () {
      var m = engine.channels[engine.trig.source].meas;
      engine.setTrigger({ level: (m.vmax + m.vmin) / 2 });
      syncUI();
    });
    var trigSection = h('div', { class: 'section', style: { flex: '1.35' } },
      h('div', { class: 'section-title', text: 'Trigger' }),
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
        tLevel.el,
        h('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
          h('div', { style: { display: 'flex', gap: '4px' } }, edgeBtn.el, trigModeBtn.el),
          h('div', { style: { display: 'flex', gap: '4px' } }, sweepBtn.el, fiftyBtn.el))));

    var autoBtn = createPanelButton({ label: 'Auto', variant: 'run', ledColor: '#f5c518' });
    autoBtn.el.addEventListener('click', function () { engine.autoSet(); syncUI(); });
    var runBtn = createPanelButton({ label: 'RUN', variant: 'run', ledColor: '#45e873' });
    runBtn.setStopMode(true);
    runBtn.el.addEventListener('click', function () {
      if (running) engine.stop(); else engine.run();
      syncUI();
    });
    var singleBtn = createPanelButton({ label: 'Single', variant: 'run', ledColor: '#ff9d45' });
    singleBtn.el.addEventListener('click', function () { engine.single(); syncUI(); });
    var runSection = h('div', { class: 'section', style: { flex: '1' } },
      h('div', { class: 'section-title', text: 'Run Control' }),
      h('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' } },
        autoBtn.el,
        h('div', { style: { display: 'flex', gap: '6px' } }, runBtn.el, singleBtn.el)));

    var navKnob = createKnob({ size: 86, label: 'Adjust', value: '—', pointerColor: '#f5c518' });
    function stepAdjust(dir, fine) {
      var gen = engine.channels[selected].gen;
      switch (knobParam) {
        case 'genFreq': {
          if (fine) { engine.setGenerator(selected, { freq: Math.max(0.01, Math.min(2e7, gen.freq * (dir > 0 ? 1.02 : 0.98))) }); break; }
          var i = nearestStep(FREQ_STEPS, gen.freq);
          engine.setGenerator(selected, { freq: FREQ_STEPS[clampIdx(i + dir, FREQ_STEPS.length)] });
          break;
        }
        case 'genAmp': {
          var s = fine ? 0.02 : 0.2;
          engine.setGenerator(selected, { amp: Math.max(0, Math.min(10, gen.amp + dir * s)) });
          break;
        }
        case 'genOffset': {
          var s2 = fine ? 0.02 : 0.1;
          engine.setGenerator(selected, { offset: Math.max(-10, Math.min(10, gen.offset + dir * s2)) });
          break;
        }
        case 'genDuty': {
          var s3 = fine ? 0.01 : 0.05;
          engine.setGenerator(selected, { duty: Math.max(0.02, Math.min(0.98, gen.duty + dir * s3)) });
          break;
        }
        case 'genNoise': {
          var s4 = fine ? 0.01 : 0.05;
          engine.setGenerator(selected, { noise: Math.max(0, Math.min(2, gen.noise + dir * s4)) });
          break;
        }
        case 'curA_t':
        case 'curB_t': {
          var d = dir * engine.time.timeDiv * (fine ? 0.05 : 0.25);
          if (knobParam === 'curA_t') engine.setCursors({ vA: engine.cursors.vA + d });
          else engine.setCursors({ vB: engine.cursors.vB + d });
          break;
        }
        case 'curA_v':
        case 'curB_v': {
          var vd = engine.channels[engine.trig.source].cfg.voltsDiv;
          var d2 = dir * vd * (fine ? 0.05 : 0.25);
          if (knobParam === 'curA_v') engine.setCursors({ hA: engine.cursors.hA + d2 });
          else engine.setCursors({ hB: engine.cursors.hB + d2 });
          break;
        }
        case 'intensity':
          engine.setDisplay({ intensity: Math.max(0.15, Math.min(1, engine.display.intensity + dir * (fine ? 0.02 : 0.08))) });
          break;
        case 'trigLevel':
          stepLevel(dir, fine);
          break;
      }
    }
    navKnob.onStep(stepAdjust);
    function adjustValue() {
      var gen = engine.channels[selected].gen;
      switch (knobParam) {
        case 'genFreq': return fmtEng(gen.freq, 'Hz');
        case 'genAmp': return gen.amp.toFixed(2) + ' V';
        case 'genOffset': return gen.offset.toFixed(2) + ' V';
        case 'genDuty': return (gen.duty * 100).toFixed(0) + ' %';
        case 'genNoise': return gen.noise.toFixed(2) + ' V';
        case 'curA_t': return fmtEng(engine.cursors.vA, 's');
        case 'curB_t': return fmtEng(engine.cursors.vB, 's');
        case 'curA_v': return fmtEng(engine.cursors.hA, 'V');
        case 'curB_v': return fmtEng(engine.cursors.hB, 'V');
        case 'intensity': return (engine.display.intensity * 100).toFixed(0) + ' %';
        case 'trigLevel': return fmtEng(engine.trig.level, 'V');
        default: return '—';
      }
    }
    var navSection = h('div', { class: 'section', style: { flex: '0.9' } },
      h('div', { class: 'section-title', text: 'Navigate' }),
      navKnob.el);

    var bottomRow = h('div', { class: 'scope-bottom' }, horizSection, trigSection, runSection, navSection);
    panel.appendChild(bottomRow);
    panel.appendChild(h('div', {
      style: { textAlign: 'center', fontSize: '8px', letterSpacing: '2px', color: '#6a727d', marginTop: '10px', textTransform: 'uppercase' },
      text: 'Virtual instrument — every control is scriptable via window.OSC · postMessage · BroadcastChannel'
    }));

    /* ----- softkey menu definitions ----- */
    function buildMenu() {
      var ch = engine.channels[selected];
      var gen = ch.gen;
      switch (menu) {
        case 'ch':
          return [
            { label: 'Coupling', value: ch.cfg.coupling, press: function () { engine.setChannel(selected, { coupling: cyc(['DC', 'AC', 'GND'], ch.cfg.coupling) }); } },
            { label: 'Invert', value: ch.cfg.invert ? 'On' : 'Off', on: ch.cfg.invert, press: function () { engine.setChannel(selected, { invert: !ch.cfg.invert }); } },
            { label: 'BW Limit', value: ch.cfg.bwLimit ? '20M' : 'Off', on: ch.cfg.bwLimit, press: function () { engine.setChannel(selected, { bwLimit: !ch.cfg.bwLimit }); } },
            { label: 'Probe', value: ch.cfg.probe + 'X', press: function () { engine.setChannel(selected, { probe: ch.cfg.probe === 1 ? 10 : 1 }); } },
            { label: 'Demo Gen', arrow: true, press: function () { menu = 'gen'; } }
          ];
        case 'gen':
          return [
            { label: 'Type', value: gen.type, press: function () { engine.setGenerator(selected, { type: cyc(WAVE_CYCLE, gen.type) }); } },
            { label: 'Freq', value: fmtEng(gen.freq, 'Hz'), dim: knobParam !== 'genFreq', press: function () { knobParam = 'genFreq'; } },
            { label: 'Amplitude', value: gen.amp.toFixed(2) + ' V', dim: knobParam !== 'genAmp', press: function () { knobParam = 'genAmp'; } },
            { label: 'Offset', value: gen.offset.toFixed(2) + ' V', dim: knobParam !== 'genOffset', press: function () { knobParam = 'genOffset'; } },
            gen.type === 'square' || gen.type === 'pulse'
              ? { label: 'Duty', value: (gen.duty * 100).toFixed(0) + ' %', dim: knobParam !== 'genDuty', press: function () { knobParam = 'genDuty'; } }
              : { label: 'Noise', value: gen.noise.toFixed(2) + ' V', dim: knobParam !== 'genNoise', press: function () { knobParam = 'genNoise'; } }
          ];
        case 'trig':
          return [
            { label: 'Slope', value: engine.trig.edge === 'rising' ? 'Rising ↑' : 'Falling ↓', press: function () { engine.setTrigger({ edge: engine.trig.edge === 'rising' ? 'falling' : 'rising' }); } },
            { label: 'Sweep', value: engine.trig.sweep, press: function () { engine.setTrigger({ sweep: cyc(['auto', 'normal', 'single'], engine.trig.sweep) }); } },
            { label: 'Source', value: CH_NAMES[engine.trig.source], press: function () { engine.setTrigger({ source: (engine.trig.source + 1) % 4 }); } },
            { label: 'Force', press: function () { engine.forceTrigger(); } },
            { label: 'Set 50%', press: function () { var m = engine.channels[engine.trig.source].meas; engine.setTrigger({ level: (m.vmax + m.vmin) / 2 }); } }
          ];
        case 'acq':
          return [
            { label: 'Mode', value: engine.acq.mode, press: function () { engine.setAcquisition({ mode: cyc(['sample', 'peak', 'average'], engine.acq.mode) }); } },
            { label: 'Average', value: engine.acq.avgCount + '×', press: function () { engine.setAcquisition({ avgCount: cyc([4, 16, 64, 128], engine.acq.avgCount) }); } },
            { label: running ? 'Stop' : 'Run', on: running, press: function () { if (running) engine.stop(); else engine.run(); } },
            { label: 'Single', on: armed, press: function () { engine.single(); } },
            { label: 'AutoSet', press: function () { engine.autoSet(); } }
          ];
        case 'disp':
          return [
            { label: 'Persist', value: engine.display.persistence === Infinity ? '∞' : engine.display.persistence > 0 ? engine.display.persistence + 's' : 'Off', press: function () { engine.setDisplay({ persistence: cyc(PERSIST_CYCLE, engine.display.persistence) }); } },
            { label: 'Type', value: engine.display.dots ? 'Dots' : 'Vectors', press: function () { engine.setDisplay({ dots: !engine.display.dots }); } },
            { label: 'Grid', value: engine.display.grid, press: function () { engine.setDisplay({ grid: cyc(['full', 'half', 'none'], engine.display.grid) }); } },
            { label: 'XY Mode', value: engine.display.xy ? 'On' : 'Off', on: engine.display.xy, press: function () { engine.setDisplay({ xy: !engine.display.xy }); } },
            { label: engine.display.fft ? 'FFT src CH' + (engine.display.fftSource + 1) : 'FFT', value: engine.display.fft ? 'On' : 'Off', on: engine.display.fft, press: function () { engine.setDisplay(engine.display.fft ? { fft: false } : { fft: true, fftSource: selected }); } }
          ];
        case 'cur':
          return [
            { label: 'Cursors', value: engine.cursors.enabled ? 'Manual' : 'Off', on: engine.cursors.enabled, press: function () { engine.setCursors({ enabled: !engine.cursors.enabled }); } },
            { label: 'Cursor A', value: fmtEng(engine.cursors.vA, 's'), dim: knobParam !== 'curA_t', press: function () { engine.setCursors({ enabled: true, active: 'a' }); knobParam = 'curA_t'; } },
            { label: 'Cursor B', value: fmtEng(engine.cursors.vB, 's'), dim: knobParam !== 'curB_t', press: function () { engine.setCursors({ enabled: true, active: 'b' }); knobParam = 'curB_t'; } },
            { label: 'Volt ' + engine.cursors.active.toUpperCase(), value: fmtEng(engine.cursors.active === 'a' ? engine.cursors.hA : engine.cursors.hB, 'V'), dim: knobParam !== (engine.cursors.active === 'a' ? 'curA_v' : 'curB_v'), press: function () { knobParam = engine.cursors.active === 'a' ? 'curA_v' : 'curB_v'; } },
            { label: 'Select', value: engine.cursors.active.toUpperCase(), press: function () { engine.setCursors({ active: engine.cursors.active === 'a' ? 'b' : 'a' }); } }
          ];
        default: return [];
      }
    }

    /* ----- API console ----- */
    var consoleLog = [];
    var logEl = h('div', { class: 'log' });
    var consoleOpen = false;
    var consoleEl = null;
    var cmdInput = null;

    function log(text, cls) {
      consoleLog.push({ cls: cls || 'dim', text: text });
      if (consoleLog.length > 260) consoleLog = consoleLog.slice(-200);
      if (consoleEl) {
        var line = h('div', { class: cls || 'dim', text: text });
        logEl.appendChild(line);
        while (logEl.children.length > 260) logEl.removeChild(logEl.firstChild);
        logEl.scrollTop = logEl.scrollHeight;
      }
    }

    function fmtRes(r) {
      if (!r.ok) return '✗ ' + r.error;
      var s = JSON.stringify(r.data);
      return '✓ ' + (s === undefined ? 'null' : s.length > 400 ? s.slice(0, 400) + '…' : s);
    }

    function runJson(text) {
      try {
        var obj = JSON.parse(text);
        var res = engine.handleCommand(obj.cmd, obj.args || []);
        log('▸ ' + obj.cmd + ' → ' + fmtRes(res), res.ok ? 'cmd' : 'err');
      } catch (e) {
        log('✗ parse error: ' + (e && e.message ? e.message : String(e)), 'err');
      }
    }

    var fab = h('button', { type: 'button', class: 'api-fab', text: '⌘ API Console' });
    app.appendChild(fab); // floating button lives outside the scaled panel
    fab.addEventListener('click', function () {
      consoleOpen = !consoleOpen;
      if (consoleOpen && !consoleEl) buildConsole();
      if (consoleEl) consoleEl.style.display = consoleOpen ? 'block' : 'none';
      fab.textContent = consoleOpen ? '✕ close API console' : '⌘ API Console';
      if (consoleOpen) logEl.scrollTop = logEl.scrollHeight;
    });

    function buildConsole() {
      var badges = h('span', {},
        h('span', { class: 'badge', text: 'window.OSC ✓' }),
        h('span', { class: 'badge', text: 'postMessage ✓' }),
        h('span', { class: 'badge' + (isFileProtocol() ? ' off' : ''), text: 'BroadcastChannel( osc-bridge )' + (isFileProtocol() ? ' ✗ (file://)' : ' ✓') }));
      var sendBtn = h('button', { type: 'button', class: 'send', text: 'RUN' });
      cmdInput = h('input', { type: 'text', value: '{"cmd":"help","args":[]}', placeholder: '{"cmd":"autoSet","args":[]}', 'aria-label': 'API command' });
      cmdInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') runJson(cmdInput.value); });
      sendBtn.addEventListener('click', function () { runJson(cmdInput.value); });
      var examples = h('div', { class: 'examples' });
      EXAMPLES.forEach(function (ex) {
        var b = h('button', { type: 'button', class: 'ex', text: ex[0], title: ex[1] });
        b.addEventListener('click', function () { cmdInput.value = ex[1]; runJson(ex[1]); });
        examples.appendChild(b);
      });
      consoleEl = h('div', { class: 'api-console' },
        h('div', { class: 'head' },
          h('span', { class: 'title', text: 'OSC API CONSOLE' }),
          badges,
          h('span', { style: { fontSize: '10px', color: '#8f97a1' }, text: 'format: {"cmd":"<command>","args":[...]}' }),
          (function () { var c = h('button', { type: 'button', class: 'close', text: 'close' }); c.addEventListener('click', function () { consoleOpen = false; consoleEl.style.display = 'none'; fab.textContent = '⌘ API Console'; }); return c; })()),
        h('div', { class: 'body' },
          h('div', { class: 'left' },
            h('div', { class: 'cmdrow' }, cmdInput, sendBtn),
            examples,
            h('div', { style: { fontSize: '10px', color: '#5c6570' }, html: 'Tips: buka <b>sim-demo.html</b> untuk melihat simulator sirkuit mengirim data ke osiloskop ini.' })),
          logEl));
      document.body.appendChild(consoleEl);
      consoleLog.forEach(function (l) { logEl.appendChild(h('div', { class: l.cls, text: l.text })); });
    }

    /* ----- transports (postMessage + BroadcastChannel + window.OSC) ----- */
    global.OSC = engine;

    var bc = null;
    try {
      bc = new BroadcastChannel('osc-bridge');
    } catch (e) {
      bc = null; // file:// in some browsers — direct JS & postMessage still work
    }

    function dispatch(cmd, args) {
      return engine.handleCommand(cmd, Array.isArray(args) ? args : []);
    }

    var lastDataLog = 0;
    function throttledDataLog(prefix, ch) {
      var now = performance.now();
      if (now - lastDataLog > 2000) {
        lastDataLog = now;
        log(prefix + ' setChannelData CH' + ((ch || 0) + 1) + ' (streaming…)', 'ev');
      }
    }

    var onMsg = function (ev) {
      var d = ev.data;
      if (!d || d.__osc !== true || typeof d.cmd !== 'string') return;
      var res = dispatch(d.cmd, d.args || []);
      if (d.id !== undefined && ev.source) {
        ev.source.postMessage(Object.assign({ __osc: true, __oscReply: true, id: d.id }, res), '*');
      }
      if (d.cmd === 'setChannelData') throttledDataLog('postMessage ◂', d.args && d.args[0]);
      else log('postMessage ◂ ' + d.cmd + ' → ' + fmtRes(res), res.ok ? 'cmd' : 'err');
    };
    window.addEventListener('message', onMsg);

    if (bc) {
      bc.onmessage = function (ev) {
        var d = ev.data;
        if (!d || d.__osc !== true || typeof d.cmd !== 'string') return;
        var res = dispatch(d.cmd, d.args || []);
        if (d.id !== undefined) {
          bc.postMessage(Object.assign({ __osc: true, __oscReply: true, id: d.id }, res));
        }
        if (d.cmd === 'setChannelData') throttledDataLog('BC ◂', d.args && d.args[0]);
        else log('BC ◂ ' + d.cmd + ' → ' + fmtRes(res), res.ok ? 'cmd' : 'err');
      };
    }

    // engine events → UI sync + BC broadcast of state/heartbeat
    var subs = [];
    function sub(ev, cb) { engine.on(ev, cb); subs.push([ev, cb]); }
    // file:// (and window.open flows without BroadcastChannel): events must
    // also reach the opener so its connection indicator can react.
    function postToOpener(ev, data) {
      try {
        var op = (window.opener && window.opener !== window) ? window.opener : null;
        if (op) op.postMessage({ __osc: true, __oscEvent: true, event: ev, data: data }, '*');
      } catch (e) { /* cross-origin opener — ignore */ }
    }
    sub('state', function (s) {
      if (bc) { try { bc.postMessage({ __osc: true, __oscEvent: true, event: 'state', data: s }); } catch (e) { /* structured clone err */ } }
      postToOpener('state', s);
      syncUI();
    });
    sub('heartbeat', function (d) {
      if (bc) { try { bc.postMessage({ __osc: true, __oscEvent: true, event: 'heartbeat', data: d }); } catch (e) { /* ignore */ } }
      postToOpener('heartbeat', d);
    });
    sub('data-received', function (d) {
      var now = performance.now();
      if (now - lastDataLog > 2000) {
        lastDataLog = now;
        log('◂ data CH' + (d.ch + 1) + ' — ' + d.samples + ' samples buffered', 'ev');
      }
    });
    sub('single-captured', function () { running = false; armed = false; });
    sub('run', function () { running = true; });
    sub('stopped', function () { running = false; });
    sub('arm', function () { armed = true; });
    sub('power-changed', function (d) { powerOn = d.on; screenCtl.setPowerOn(powerOn); });

    log('Z-DSO 2104 engine v' + Z.VERSION + ' ready', 'ok');
    log('transports: window.OSC · postMessage' + (bc ? ' · BroadcastChannel("osc-bridge")' : ' (BroadcastChannel unavailable on file://)'), 'dim');

    /* ----- responsive scaling ----- */
    var scale = 1, panelH = 760;
    function onResize() {
      var w = app.clientWidth || window.innerWidth;
      scale = Math.min(1, w / 1180);
      panelH = panel.offsetHeight || 760;
      panel.style.transform = scale < 1 ? 'scale(' + scale + ')' : '';
      panel.style.transformOrigin = 'top center';
      scaleWrap.style.height = (panelH * scale) + 'px';
    }
    window.addEventListener('resize', onResize);
    setTimeout(onResize, 0);
    setTimeout(onResize, 300);

    /* ----- full UI sync from engine state ----- */
    function syncUI() {
      var st = engine.getState();

      // power
      pwrCtl.el.classList.toggle('off', !powerOn);
      // channel buttons
      for (var i = 0; i < 4; i++) {
        chBtns[i].setLit(engine.channels[i].cfg.enabled);
        chBtns[i].setActive(selected === i);
      }
      // math
      mathBtn.setLit(engine.math.enabled);
      // menu buttons
      Object.keys(menuBtns).forEach(function (k) { menuBtns[k].classList.toggle('lit', menu === k); });
      // vertical knobs
      var ch = engine.channels[selected];
      vScale.setValue(fmtEng(ch.cfg.voltsDiv, 'V', 1) + '/div');
      vPos.setValue(fmtEng(ch.cfg.offset, 'V', 2));
      // horizontal knobs
      hScale.setValue(fmtEng(engine.time.timeDiv, 's', 1) + '/div');
      hPos.setValue(fmtEng(engine.time.hOffset, 's', 2));
      // trigger
      tLevel.setValue(fmtEng(engine.trig.level, 'V', 2));
      edgeBtn.setLabel(engine.trig.edge === 'rising' ? '↑ Rise' : '↓ Fall');
      trigModeBtn.setLit(menu === 'trig');
      sweepBtn.setLabel(engine.trig.sweep === 'auto' ? 'Auto' : engine.trig.sweep === 'normal' ? 'Norm' : 'Single');
      // run control
      runBtn.setLabel(running ? 'RUN' : 'STOP');
      runBtn.setRun(running);
      runBtn.el.style.setProperty('--led', running ? '#45e873' : '#f0685f');
      singleBtn.setLit(armed);
      // navigate knob
      navKnob.setLabel(knobParam ? 'Adjust: ' + knobParam : 'Adjust');
      navKnob.setValue(adjustValue());
      // softkeys
      softKeyDefs = buildMenu();
      for (var s = 0; s < 5; s++) {
        var def = softKeyDefs[s];
        var ui = softKeyBtns[s];
        if (!def) { ui.btn.style.visibility = 'hidden'; continue; }
        ui.btn.style.visibility = 'visible';
        ui.lbl.textContent = def.label;
        ui.btn.title = def.label;
        if (def.value !== undefined) { ui.val.style.display = ''; ui.val.textContent = def.value; }
        else ui.val.style.display = 'none';
        ui.on.style.display = def.on ? '' : 'none';
        ui.arrow.style.display = def.arrow ? '' : 'none';
        ui.btn.classList.toggle('dim', !!def.dim);
      }
    }

    // initial sync + power state
    syncUI();
    screenCtl.setPowerOn(powerOn);

    return {
      engine: engine,
      syncUI: syncUI,
      dispose: function () {
        subs.forEach(function (p) { engine.off(p[0], p[1]); });
        window.removeEventListener('message', onMsg);
        window.removeEventListener('resize', onResize);
        screenCtl.dispose();
        if (bc) bc.close();
        delete global.OSC;
      }
    };
  }

  /* ======================================================================
   * SIM DEMO — reference circuit simulator (RC low-pass) that streams
   * Vin/Vout into the scope through BroadcastChannel (http) or
   * window.postMessage (file:// fallback).
   * ==================================================================== */
  function waveSample(type, freq, amp, t) {
    if (type === 'sine') return amp * Math.sin(2 * Math.PI * freq * t);
    var frac = (((t * freq) % 1) + 1) % 1;
    return amp * (frac < 0.5 ? 1 : -1);
  }
  function rcLowpass(type, freq, amp, t, R, C) {
    var tau = R * C;
    var fc = 1 / (2 * Math.PI * tau);
    if (type === 'sine') {
      var w = 2 * Math.PI * freq;
      var H = 1 / Math.sqrt(1 + Math.pow(freq / fc, 2));
      var phi = -Math.atan(w * tau);
      return amp * H * Math.sin(w * t + phi);
    }
    var out = 0;
    for (var k = 1; k <= 15; k += 2) {
      var fk = freq * k;
      var wk = 2 * Math.PI * fk;
      var Hk = 1 / Math.sqrt(1 + Math.pow(fk / fc, 2));
      var phik = -Math.atan(wk * tau);
      out += ((4 / Math.PI) * (amp / k)) * Hk * Math.sin(wk * t + phik);
    }
    return out;
  }

  function createSimDemoUI(container) {
    var N = 1200;
    var app = h('div', { class: 'sim-app' });
    container.appendChild(app);

    var state = { waveType: 'sine', fSlider: 600, amp: 2, rSlider: 400, cSlider: 500, streaming: true };
    var connected = false;

    var freq = 0, R = 0, Cv = 0, fc = 0, gainDb = 0, phaseDeg = 0;
    function calc() {
      freq = Math.pow(10, (state.fSlider / 1000) * 6);             // 1 Hz .. 1 MHz
      R = Math.pow(10, 2 + (state.rSlider / 1000) * 3);            // 100 Ω .. 100 kΩ
      Cv = Math.pow(10, -9 + (state.cSlider / 1000) * 4);          // 1 nF .. 10 µF
      fc = 1 / (2 * Math.PI * R * Cv);
      gainDb = -20 * Math.log10(Math.sqrt(1 + Math.pow(freq / fc, 2)));
      phaseDeg = (-Math.atan(2 * Math.PI * freq * R * Cv) * 180) / Math.PI;
    }
    calc();

    /* ----- transport: BroadcastChannel on http(s), postMessage on file:// ----- */
    var useFile = isFileProtocol();
    var bc = null;
    var scopeWin = null;
    if (!useFile) {
      try { bc = new BroadcastChannel('osc-bridge'); } catch (e) { bc = null; }
    }
    function send(cmd, args) {
      var msg = { __osc: true, cmd: cmd, args: args };
      if (bc) bc.postMessage(msg);
      else if (scopeWin && !scopeWin.closed) scopeWin.postMessage(msg, '*');
    }

    function sendConfig() {
      var timeDiv = ceilStep(TIME_STEPS, 2.5 / freq / 10);
      winDur = timeDiv * 10;
      send('setHorizontal', [{ timeDiv: timeDiv }]);
      var vdiv = ceilStep(VOLT_STEPS, (2 * state.amp) / 4.8);
      send('setChannel', [0, { enabled: true, voltsDiv: vdiv, offset: 0, coupling: 'DC', probe: 1 }]);
      send('setChannel', [1, { enabled: true, voltsDiv: vdiv, offset: 0, coupling: 'DC', probe: 1 }]);
      send('setChannel', [2, { enabled: false }]);
      send('setChannel', [3, { enabled: false }]);
      send('setTrigger', [{ source: 0, level: 0, edge: 'rising', sweep: 'auto' }]);
    }
    var winDur = 0.01;
    var lastCfgKey = '';

    /* ----- UI ----- */
    var header = h('header', { style: { textAlign: 'center' } },
      h('h1', { style: { fontSize: '22px', margin: '0', letterSpacing: '0.5px' }, html: 'Simulator Sirkuit Demo — <span style="color:#f5c518">RC Low-Pass Filter</span>' }),
      h('p', { style: { fontSize: '13px', color: '#8f97a1', marginTop: '6px' }, html: 'Referensi integrasi: halaman ini mensimulasikan sirkuit dan mengirim Vin/Vout ke osiloskop Z-DSO 2104 lewat <code style="color:#7ec8ff">' + (useFile ? 'window.postMessage' : 'BroadcastChannel("osc-bridge")') + '</code>.' }));
    app.appendChild(header);

    var cardWrap = h('div', { style: { display: 'flex', gap: '18px', flexWrap: 'wrap', justifyContent: 'center', width: '100%', maxWidth: '1080px' } });
    app.appendChild(cardWrap);

    // circuit card
    var svgNS = 'http://www.w3.org/2000/svg';
    function svgEl(tag, attrs, text) {
      var e = document.createElementNS(svgNS, tag);
      Object.keys(attrs).forEach(function (k) { e.setAttribute(k, attrs[k]); });
      if (text !== undefined) e.textContent = text;
      return e;
    }
    var svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('viewBox', '0 0 340 190');
    svg.style.width = '100%';
    function wire(d, color) { svg.appendChild(svgEl('path', { d: d, stroke: color, 'stroke-width': '2', fill: 'none' })); }
    wire('M30 95 H80', '#7ec8ff');
    wire('M130 95 H180', '#48e07a');
    wire('M240 95 H300', '#48e07a');
    wire('M180 95 V150 M180 150 H235', '#5c6570');
    svg.appendChild(svgEl('circle', { cx: '55', cy: '95', r: '22', stroke: '#7ec8ff', 'stroke-width': '2', fill: '#0d1014' }));
    svg.appendChild(svgEl('path', { d: 'M43 95 q6 -10 12 0 q6 10 12 0', stroke: '#7ec8ff', 'stroke-width': '2', fill: 'none' }));
    svg.appendChild(svgEl('text', { x: '40', y: '135', fill: '#7ec8ff', 'font-size': '11' }, 'Vin'));
    svg.appendChild(svgEl('path', { d: 'M80 95 l6 -10 l10 20 l10 -20 l10 20 l10 -20 l4 10', stroke: '#f5c518', 'stroke-width': '2', fill: 'none' }));
    var rLabel = svgEl('text', { x: '92', y: '70', fill: '#f5c518', 'font-size': '11' }, '');
    svg.appendChild(rLabel);
    svg.appendChild(svgEl('path', { d: 'M235 138 v-14 M265 138 v-14', stroke: '#ea5be0', 'stroke-width': '3' }));
    svg.appendChild(svgEl('path', { d: 'M235 124 h30 M235 152 h30', stroke: '#ea5be0', 'stroke-width': '2' }));
    svg.appendChild(svgEl('path', { d: 'M250 152 v12 M238 164 h24 M243 170 h14 M248 176 h4', stroke: '#5c6570', 'stroke-width': '2' }));
    var cLabel = svgEl('text', { x: '272', y: '132', fill: '#ea5be0', 'font-size': '11' }, '');
    svg.appendChild(cLabel);
    svg.appendChild(svgEl('circle', { cx: '300', cy: '95', r: '5', fill: '#48e07a' }));
    svg.appendChild(svgEl('text', { x: '288', y: '78', fill: '#48e07a', 'font-size': '11' }, 'Vout'));
    var fcLabel = svgEl('text', { x: '12', y: '180', fill: '#5c6570', 'font-size': '10' }, '');
    svg.appendChild(fcLabel);

    var statsRow = h('div', { style: { display: 'flex', gap: '14px', flexWrap: 'wrap', marginTop: '6px', fontSize: '12px' } });
    var statFc = h('b', { style: { color: '#f5c518' } });
    var statH = h('b', { style: { color: '#48e07a' } });
    var statPhi = h('b', { style: { color: '#ea5be0' } });
    statsRow.appendChild(h('span', {}, 'fc: ', statFc));
    statsRow.appendChild(h('span', {}, '|H(f)|: ', statH));
    statsRow.appendChild(h('span', {}, 'φ: ', statPhi));

    cardWrap.appendChild(h('div', { style: { flex: '1 1 380px', background: '#15191f', border: '1px solid #262c34', borderRadius: '14px', padding: '18px' } },
      h('div', { style: { fontSize: '11px', letterSpacing: '2px', color: '#8f97a1', marginBottom: '10px', textTransform: 'uppercase' }, text: 'Sirkuit' }),
      svg, statsRow));

    // controls card
    var waveBtns = {};
    var ctrlCard = h('div', { style: { flex: '1 1 380px', background: '#15191f', border: '1px solid #262c34', borderRadius: '14px', padding: '18px' } });
    ctrlCard.appendChild(h('div', { style: { fontSize: '11px', letterSpacing: '2px', color: '#8f97a1', marginBottom: '12px', textTransform: 'uppercase' }, text: 'Kontrol Sumber' }));
    var waveRow = h('div', { style: { display: 'flex', gap: '8px', marginBottom: '14px' } });
    ['sine', 'square'].forEach(function (w) {
      var b = h('button', {
        type: 'button', class: 'sim-btn', text: w === 'sine' ? 'Sine' : 'Square'
      });
      b.addEventListener('click', function () { state.waveType = w; refresh(); sendConfig(); });
      waveBtns[w] = b;
      waveRow.appendChild(b);
    });
    ctrlCard.appendChild(waveRow);

    var sliders = {};
    [['Frekuensi', 'fSlider', function () { return fmtEng(freq, 'Hz', 2); }],
     ['Amplitudo', 'amp', function () { return state.amp.toFixed(2) + ' Vpk'; }],
     ['R', 'rSlider', function () { return fmtEng(R, 'Ω', 1); }],
     ['C', 'cSlider', function () { return fmtEng(Cv, 'F', 1); }]].forEach(function (p) {
      var label = p[0], key = p[1], disp = p[2];
      var valLabel = h('b', { style: { color: '#f5c518' } });
      var input = h('input', { type: 'range', min: '0', max: '1000', value: '0', 'aria-label': label, style: { width: '100%', accentColor: '#f5c518' } });
      input.addEventListener('input', function () {
        if (key === 'amp') state.amp = 0.1 + (Number(input.value) / 1000) * 4.9;
        else state[key] = Number(input.value);
        calc();
        valLabel.textContent = disp();
        scheduleConfig();
      });
      sliders[key] = { input: input, valLabel: valLabel };
      ctrlCard.appendChild(h('div', { style: { marginBottom: '12px' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', marginBottom: '4px' } },
          h('span', { text: label }), valLabel),
        input));
    });

    var streamBtn = h('button', { type: 'button', class: 'sim-btn sim-primary', text: '■ Stop streaming' });
    streamBtn.addEventListener('click', function () {
      state.streaming = !state.streaming;
      refresh();
    });
    var openBtn = h('button', { type: 'button', class: 'sim-btn', text: 'Buka Osiloskop ↗', style: { color: '#ffe17a' } });
    openBtn.addEventListener('click', function () {
      scopeWin = window.open('index.html', 'z-dso', 'width=1290,height=1000');
      if (scopeWin) scopeWin.focus();
    });
    ctrlCard.appendChild(h('div', { style: { display: 'flex', gap: '10px', marginTop: '16px', flexWrap: 'wrap' } }, streamBtn, openBtn));

    var statusB = h('b', { style: { color: '#f0685f' }, text: useFile ? 'klik "Buka Osiloskop" dulu (mode file://)' : 'belum terdeteksi' });
    ctrlCard.appendChild(h('div', { style: { marginTop: '14px', fontSize: '12.5px' } }, 'Status osiloskop: ', statusB));
    cardWrap.appendChild(ctrlCard);

    // integration snippet card
    app.appendChild(h('div', {
      style: { width: '100%', maxWidth: '1080px', background: '#0d1014', border: '1px solid #262c34', borderRadius: '14px', padding: '18px', fontFamily: 'ui-monospace, monospace', fontSize: '12px', lineHeight: '1.7', color: '#9fb6cc', overflowX: 'auto' }
    },
      h('div', { style: { color: '#8f97a1', marginBottom: '8px' }, text: '// inti integrasi — sama seperti yang dipakai halaman ini:' }),
      h('div', { html: '<span style="color:#7ec8ff">const</span> bc = <span style="color:#7ec8ff">new</span> BroadcastChannel(<span style="color:#48e07a">"osc-bridge"</span>);' }),
      h('div', { html: 'bc.postMessage({ __osc: <span style="color:#7ec8ff">true</span>, cmd: <span style="color:#48e07a">"setChannelData"</span>,' }),
      h('div', { html: '&nbsp;&nbsp;args: [0, vinFloat32Array, { sampleRate, tStart, align: <span style="color:#48e07a">"none"</span> }] });' }),
      h('div', { style: { color: '#5c6570' }, text: '// kontrol penuh: setGenerator · setChannel · setHorizontal · setTrigger · run/stop/autoSet · getMeasurements …' })));

    function refresh() {
      ['sine', 'square'].forEach(function (w) {
        var on = state.waveType === w;
        waveBtns[w].style.border = on ? '1px solid #f5c518' : '1px solid #2b323b';
        waveBtns[w].style.background = on ? '#2a2413' : '#1a2027';
        waveBtns[w].style.color = on ? '#ffe17a' : '#9fb6cc';
      });
      streamBtn.textContent = state.streaming ? '■ Stop streaming' : '▶ Start streaming';
      streamBtn.style.background = state.streaming ? 'linear-gradient(180deg,#58e878,#23b84a)' : '#1a2027';
      streamBtn.style.color = state.streaming ? '#052d12' : '#9fb6cc';
      streamBtn.style.border = '1px solid #0f5a26';
      sliders.fSlider.input.value = String(state.fSlider);
      sliders.fSlider.valLabel.textContent = fmtEng(freq, 'Hz', 2);
      sliders.amp.input.value = String(Math.round(((state.amp - 0.1) / 4.9) * 1000));
      sliders.amp.valLabel.textContent = state.amp.toFixed(2) + ' Vpk';
      sliders.rSlider.input.value = String(state.rSlider);
      sliders.rSlider.valLabel.textContent = fmtEng(R, 'Ω', 1);
      sliders.cSlider.input.value = String(state.cSlider);
      sliders.cSlider.valLabel.textContent = fmtEng(Cv, 'F', 1);
      statFc.textContent = fmtEng(fc, 'Hz', 2);
      statH.textContent = gainDb.toFixed(1) + ' dB';
      statPhi.textContent = phaseDeg.toFixed(0) + '°';
      rLabel.textContent = 'R = ' + fmtEng(R, 'Ω', 1);
      cLabel.textContent = 'C = ' + fmtEng(Cv, 'F', 1);
      fcLabel.textContent = 'fc = ' + fmtEng(fc, 'Hz', 2);
    }
    refresh();

    var cfgTimer = 0;
    function scheduleConfig() {
      // re-configure when frequency changes a lot
      var wantWin = 2.5 / freq;
      if (Math.abs(wantWin - winDur) / wantWin > 0.5) sendConfig();
      clearTimeout(cfgTimer);
      cfgTimer = setTimeout(function () {
        var key = state.waveType + '|' + freq.toPrecision(4) + '|' + state.amp + '|' + R.toPrecision(4) + '|' + Cv.toPrecision(4);
        if (key !== lastCfgKey) { lastCfgKey = key; sendConfig(); }
      }, 120);
    }

    // connection watchdog (heartbeat)
    var hbSeen = 0;
    function onEvent(d) {
      if (d && d.__osc && d.__oscEvent && d.event === 'heartbeat') {
        hbSeen = Date.now();
        if (!connected) { connected = true; statusB.textContent = 'terhubung ✓ (heartbeat diterima)'; statusB.style.color = '#45e873'; }
      }
    }
    if (bc) {
      bc.onmessage = function (ev) { onEvent(ev.data); };
    } else {
      window.addEventListener('message', function (ev) { onEvent(ev.data); });
    }
    var wd = setInterval(function () {
      if (connected && Date.now() - hbSeen > 2500) {
        connected = false;
        statusB.textContent = 'belum terdeteksi';
        statusB.style.color = '#f0685f';
      }
    }, 1000);

    // acquisition loop (~30 fps)
    var tSim = 0, last = performance.now(), frame = 0;
    var vin = new Float32Array(N), vout = new Float32Array(N);
    var raf = 0;
    function loop(ts) {
      raf = requestAnimationFrame(loop);
      var dt = Math.min((ts - last) / 1000, 0.05);
      last = ts;
      if (!state.streaming) return;
      var wantWin = 2.5 / freq;
      if (Math.abs(wantWin - winDur) / wantWin > 0.5) sendConfig();
      tSim += dt;
      var win = winDur;
      var rate = (N - 1) / win;
      for (var i = 0; i < N; i++) {
        var t = tSim - win + (i / (N - 1)) * win;
        vin[i] = waveSample(state.waveType, freq, state.amp, t);
        vout[i] = rcLowpass(state.waveType, freq, state.amp, t, R, Cv);
      }
      if (frame++ % 2 === 0) { // ~30 fps
        send('setChannelData', [0, vin, { sampleRate: rate, tStart: tSim - win, align: 'none' }]);
        send('setChannelData', [1, vout, { sampleRate: rate, tStart: tSim - win, align: 'none' }]);
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
  Z.createScopeUI = createScopeUI;
  Z.createSimDemoUI = createSimDemoUI;
  Z.ui = { createKnob: createKnob, createPanelButton: createPanelButton, createScreen: createScreen };
})(window);

