'use client';

import { useEffect, useRef } from 'react';
import type { OscEngine } from '@/lib/osc/engine';
import {
  CH_COLORS, CH_NAMES, CURSOR_A_COLOR, CURSOR_B_COLOR, DISP_PTS, FFT_COLOR,
  H_DIVS, MATH_COLOR, SCREEN_H, SCREEN_W, TIME_STEPS, V_DIVS,
  fmtEng, nearestStep,
} from '@/lib/osc/types';

interface ScreenProps {
  engine: OscEngine;
  powerOn: boolean;
}

const FONT = "11px 'Geist Mono', ui-monospace, monospace";
const FONT_S = "9.5px 'Geist Mono', ui-monospace, monospace";
const BG = '#05080c';

type DragMode =
  | { kind: 'pan' }
  | { kind: 'trigLevel' }
  | { kind: 'offset'; ch: number }
  | { kind: 'curT'; which: 'vA' | 'vB' }
  | { kind: 'curV'; which: 'hA' | 'hB' };

/**
 * The oscilloscope display: graticule, glowing traces with persistence,
 * trigger markers, cursors, FFT, XY mode and on-screen readouts.
 */
export default function Screen({ engine, powerOn }: ScreenProps) {
  const gridRef = useRef<HTMLCanvasElement>(null);
  const traceRef = useRef<HTMLCanvasElement>(null);
  const markRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const persistRef = useRef<HTMLCanvasElement | null>(null);
  const hitRef = useRef<{
    trigY: number; grounds: { ch: number; y: number }[];
    curX: { a: number; b: number }; curY: { a: number; b: number };
  }>({ trigY: -99, grounds: [], curX: { a: -99, b: -99 }, curY: { a: -99, b: -99 } });
  const dragRef = useRef<{ mode: DragMode; x: number; y: number } | null>(null);
  const lastTs = useRef(0);

  const yOfVolt = (v: number, voltsDiv: number, offset: number) =>
    SCREEN_H / 2 - (v + offset) * (SCREEN_H / V_DIVS / voltsDiv);

  /* ---------------- graticule ---------------- */
  const drawGrid = () => {
    const cv = gridRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== SCREEN_W * dpr) {
      cv.width = SCREEN_W * dpr;
      cv.height = SCREEN_H * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

    const dw = SCREEN_W / H_DIVS;
    const dh = SCREEN_H / V_DIVS;
    const grid = engine.display.grid;

    if (grid !== 'none') {
      ctx.strokeStyle = grid === 'full' ? '#182430' : '#101820';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < H_DIVS; i++) {
        ctx.moveTo(i * dw + 0.5, 0);
        ctx.lineTo(i * dw + 0.5, SCREEN_H);
      }
      for (let j = 1; j < V_DIVS; j++) {
        ctx.moveTo(0, j * dh + 0.5);
        ctx.lineTo(SCREEN_W, j * dh + 0.5);
      }
      ctx.stroke();

      if (grid === 'full') {
        // minor ticks on center axes
        ctx.strokeStyle = '#223242';
        ctx.beginPath();
        for (let i = 0; i < H_DIVS * 5; i++) {
          const x = (i * SCREEN_W) / (H_DIVS * 5) + 0.5;
          ctx.moveTo(x, SCREEN_H / 2 - 3);
          ctx.lineTo(x, SCREEN_H / 2 + 3);
        }
        for (let j = 0; j < V_DIVS * 5; j++) {
          const y = (j * SCREEN_H) / (V_DIVS * 5) + 0.5;
          ctx.moveTo(SCREEN_W / 2 - 3, y);
          ctx.lineTo(SCREEN_W / 2 + 3, y);
        }
        ctx.stroke();
      }
    }
    // center axes brighter
    ctx.strokeStyle = '#2b3d50';
    ctx.beginPath();
    ctx.moveTo(0, SCREEN_H / 2 + 0.5);
    ctx.lineTo(SCREEN_W, SCREEN_H / 2 + 0.5);
    ctx.moveTo(SCREEN_W / 2 + 0.5, 0);
    ctx.lineTo(SCREEN_W / 2 + 0.5, SCREEN_H);
    ctx.stroke();
    // border
    ctx.strokeStyle = '#31404f';
    ctx.strokeRect(0.5, 0.5, SCREEN_W - 1, SCREEN_H - 1);
  };

  /* ---------------- traces ---------------- */
  const drawTraces = (dt: number) => {
    const cv = traceRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== SCREEN_W * dpr) {
      cv.width = SCREEN_W * dpr;
      cv.height = SCREEN_H * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pers = engine.display.persistence;
    const view = engine.getView();
    const intensity = engine.display.intensity;

    if (!persistRef.current) {
      persistRef.current = document.createElement('canvas');
      persistRef.current.width = SCREEN_W;
      persistRef.current.height = SCREEN_H;
    }
    const pcv = persistRef.current;
    const pctx = pcv.getContext('2d')!;

    if (pers <= 0) {
      ctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
      pctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
    } else {
      const fade = pers === Infinity ? 0 : Math.min(0.4, (dt / pers) * 2.2);
      if (fade > 0) {
        pctx.globalCompositeOperation = 'source-over';
        pctx.fillStyle = `rgba(5,8,12,${fade})`;
        pctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
      }
    }

    const target = pers > 0 ? pctx : ctx;
    if (pers > 0) {
      ctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
      ctx.drawImage(pcv, 0, 0, SCREEN_W, SCREEN_H);
    }

    const drawPath = (arr: Float32Array, color: string, voltsDiv: number, offset: number, lineW = 1.6) => {
      const n = Math.min(arr.length, DISP_PTS);
      target.strokeStyle = color;
      target.lineWidth = lineW;
      target.shadowColor = color;
      target.shadowBlur = 8 * intensity;
      target.globalAlpha = 0.35 + 0.65 * intensity;
      target.beginPath();
      const ppv = SCREEN_H / V_DIVS / voltsDiv;
      let started = false;
      for (let i = 0; i < n; i++) {
        const x = (i / (DISP_PTS - 1)) * SCREEN_W;
        const y = yOfVolt(arr[i], voltsDiv, offset);
        if (!isFinite(y)) { started = false; continue; }
        if (!started) { target.moveTo(x, y); started = true; }
        else target.lineTo(x, y);
      }
      target.stroke();
      target.shadowBlur = 0;
      target.globalAlpha = 1;
    };

    if (engine.display.xy) {
      // XY mode: CH1 = X, CH2 = Y
      const a = view.channels[0];
      const b = view.channels[1];
      if (a.cfg.enabled && b.cfg.enabled) {
        target.strokeStyle = '#5cf0ff';
        target.lineWidth = 1.4;
        target.shadowColor = '#5cf0ff';
        target.shadowBlur = 8 * intensity;
        target.beginPath();
        const ppvA = SCREEN_W / H_DIVS / a.cfg.voltsDiv;
        const ppvB = SCREEN_H / V_DIVS / b.cfg.voltsDiv;
        for (let i = 0; i < DISP_PTS; i++) {
          const x = SCREEN_W / 2 - (a.disp[i] + a.cfg.offset) * -ppvA;
          const y = yOfVolt(b.disp[i], b.cfg.voltsDiv, b.cfg.offset);
          if (i === 0) target.moveTo(x, y); else target.lineTo(x, y);
        }
        target.stroke();
        target.shadowBlur = 0;
      }
    } else {
      view.channels.forEach((ch, i) => {
        if (!ch.cfg.enabled) return;
        drawPath(ch.disp, CH_COLORS[i], ch.cfg.voltsDiv, ch.cfg.offset);
        if (ch.peakLo && ch.peakHi) {
          // peak-detect envelope
          target.strokeStyle = CH_COLORS[i];
          target.lineWidth = 1;
          target.shadowColor = CH_COLORS[i];
          target.shadowBlur = 4;
          target.globalAlpha = 0.8;
          const m = ch.peakLo.length;
          target.beginPath();
          for (let c = 0; c < m; c++) {
            const x = (c / (m - 1)) * SCREEN_W;
            const y = yOfVolt(ch.peakHi[c], ch.cfg.voltsDiv, ch.cfg.offset);
            if (c === 0) target.moveTo(x, y); else target.lineTo(x, y);
          }
          for (let c = m - 1; c >= 0; c--) {
            const x = (c / (m - 1)) * SCREEN_W;
            const y = yOfVolt(ch.peakLo[c], ch.cfg.voltsDiv, ch.cfg.offset);
            target.lineTo(x, y);
          }
          target.closePath();
          target.globalAlpha = 0.35;
          target.fillStyle = CH_COLORS[i] + '30';
          target.fill();
          target.globalAlpha = 1;
          target.shadowBlur = 0;
        }
      });
      if (view.math) {
        // auto-scale math trace
        let mx = 1e-9;
        for (let i = 0; i < DISP_PTS; i++) mx = Math.max(mx, Math.abs(view.math.disp[i]));
        const vdiv = Math.max(1e-3, mx / 3);
        drawPath(view.math.disp, MATH_COLOR, vdiv, 0, 1.4);
      }
      if (engine.fftResult) {
        const fr = engine.fftResult;
        const bandTop = SCREEN_H * 0.52;
        const bandH = SCREEN_H * 0.4;
        target.fillStyle = 'rgba(0,0,0,0.62)';
        target.fillRect(4, bandTop, SCREEN_W - 8, bandH);
        target.strokeStyle = '#1c2a38';
        target.strokeRect(4.5, bandTop + 0.5, SCREEN_W - 9, bandH);
        target.strokeStyle = FFT_COLOR;
        target.lineWidth = 1.2;
        target.shadowColor = FFT_COLOR;
        target.shadowBlur = 6;
        target.beginPath();
        const nb = fr.db.length;
        for (let k = 0; k < nb; k++) {
          const x = (k / (nb - 1)) * (SCREEN_W - 12) + 6;
          const db = Math.max(-80, Math.min(0, fr.db[k]));
          const y = bandTop + bandH - ((db + 80) / 80) * (bandH - 8) - 4;
          if (k === 0) target.moveTo(x, y); else target.lineTo(x, y);
        }
        target.stroke();
        target.shadowBlur = 0;
        target.fillStyle = FFT_COLOR;
        target.font = FONT_S;
        const bw = engine.windowDur > 0 ? (DISP_PTS - 1) / engine.windowDur / 2 : 0;
        target.fillText(`FFT  CH${fr.src + 1}   0 – ${fmtEng(bw, 'Hz', 2)}   10dB/div`, 12, bandTop + 14);
      }
    }
  };

  /* ---------------- markers & text ---------------- */
  const drawMarkers = () => {
    const cv = markRef.current;
    if (!cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    if (cv.width !== SCREEN_W * dpr) {
      cv.width = SCREEN_W * dpr;
      cv.height = SCREEN_H * dpr;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SCREEN_W, SCREEN_H);
    ctx.font = FONT;
    ctx.textBaseline = 'middle';

    const view = engine.getView();
    const win = view.win;
    const hits = hitRef.current;
    hits.grounds = [];

    const xOfTime = (t: number) => ((t - win.t0) / win.window) * SCREEN_W;

    // channel ground markers (right edge)
    view.channels.forEach((ch, i) => {
      if (!ch.cfg.enabled) return;
      const ppv = SCREEN_H / V_DIVS / ch.cfg.voltsDiv;
      const y = Math.max(10, Math.min(SCREEN_H - 10, SCREEN_H / 2 - ch.cfg.offset * ppv));
      hits.grounds.push({ ch: i, y });
      ctx.fillStyle = CH_COLORS[i];
      ctx.beginPath();
      ctx.moveTo(SCREEN_W - 1, y);
      ctx.lineTo(SCREEN_W - 11, y - 6);
      ctx.lineTo(SCREEN_W - 11, y + 6);
      ctx.closePath();
      ctx.fill();
      ctx.font = 'bold 10px sans-serif';
      ctx.fillText(String(i + 1), SCREEN_W - 26, y);
      ctx.font = FONT;
    });

    // trigger marker T (top) + level arrow (right)
    const tx = view.trig.x * SCREEN_W;
    ctx.fillStyle = '#e8edf3';
    ctx.beginPath();
    ctx.moveTo(tx, 2);
    ctx.lineTo(tx - 5, 10);
    ctx.lineTo(tx + 5, 10);
    ctx.closePath();
    ctx.fill();
    ctx.font = 'bold 10px sans-serif';
    ctx.fillText('T', tx + 7, 8);
    ctx.font = FONT;

    const src = view.channels[view.trig.source];
    if (src.cfg.enabled) {
      const ppv = SCREEN_H / V_DIVS / src.cfg.voltsDiv;
      const ty = Math.max(10, Math.min(SCREEN_H - 10, yOfVolt(view.trig.level, src.cfg.voltsDiv, src.cfg.offset)));
      hits.trigY = ty;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(SCREEN_W - 1, ty);
      ctx.lineTo(SCREEN_W - 11, ty - 6);
      ctx.lineTo(SCREEN_W - 11, ty + 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillText('T', SCREEN_W - 26, ty);
    }

    // cursors
    const cur = engine.cursors;
    if (cur.enabled) {
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.2;
      // time cursors
      const xa = Math.max(0, Math.min(SCREEN_W, xOfTime(cur.vA)));
      const xb = Math.max(0, Math.min(SCREEN_W, xOfTime(cur.vB)));
      hits.curX = { a: xa, b: xb };
      ctx.strokeStyle = CURSOR_A_COLOR;
      ctx.beginPath(); ctx.moveTo(xa + 0.5, 0); ctx.lineTo(xa + 0.5, SCREEN_H); ctx.stroke();
      ctx.fillStyle = CURSOR_A_COLOR;
      ctx.fillText('A', xa + 4, 14);
      ctx.strokeStyle = CURSOR_B_COLOR;
      ctx.beginPath(); ctx.moveTo(xb + 0.5, 0); ctx.lineTo(xb + 0.5, SCREEN_H); ctx.stroke();
      ctx.fillStyle = CURSOR_B_COLOR;
      ctx.fillText('B', xb + 4, 28);
      // voltage cursors
      const srcVd = src.cfg.voltsDiv;
      const ppv = SCREEN_H / V_DIVS / srcVd;
      const ya = Math.max(0, Math.min(SCREEN_H, SCREEN_H / 2 - cur.hA * ppv));
      const yb = Math.max(0, Math.min(SCREEN_H, SCREEN_H / 2 - cur.hB * ppv));
      hits.curY = { a: ya, b: yb };
      ctx.strokeStyle = CURSOR_A_COLOR;
      ctx.beginPath(); ctx.moveTo(0, ya + 0.5); ctx.lineTo(SCREEN_W, ya + 0.5); ctx.stroke();
      ctx.fillStyle = CURSOR_A_COLOR;
      ctx.fillText('A', 6, ya - 8);
      ctx.strokeStyle = CURSOR_B_COLOR;
      ctx.beginPath(); ctx.moveTo(0, yb + 0.5); ctx.lineTo(SCREEN_W, yb + 0.5); ctx.stroke();
      ctx.fillStyle = CURSOR_B_COLOR;
      ctx.fillText('B', 6, yb - 8);
      ctx.setLineDash([]);

      // cursor readout box
      const dT = Math.abs(cur.vB - cur.vA);
      const dV = Math.abs(cur.hB - cur.hA);
      const label = `ΔV=${fmtEng(dV, 'V', 2)}  ΔT=${fmtEng(dT, 's', 2)}  1/ΔT=${dT > 0 ? fmtEng(1 / dT, 'Hz', 2) : '--'}`;
      ctx.font = FONT_S;
      const w = ctx.measureText(label).width + 14;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(SCREEN_W - w - 8, 40, w, 18);
      ctx.strokeStyle = '#2c3742';
      ctx.strokeRect(SCREEN_W - w - 7.5, 40.5, w - 1, 17);
      ctx.fillStyle = '#dfe7ef';
      ctx.fillText(label, SCREEN_W - w, 49);
      ctx.font = FONT;
    }

    // ---- text readouts ----
    // channel info (top-left)
    let iy = 14;
    view.channels.forEach((ch, i) => {
      if (!ch.cfg.enabled) return;
      ctx.fillStyle = CH_COLORS[i];
      const info = `${CH_NAMES[i]}  ${fmtEng(ch.cfg.voltsDiv, 'V', 1)}/div  ${ch.cfg.coupling}${ch.cfg.probe > 1 ? ' 10X' : ''}${ch.cfg.invert ? ' ⤺' : ''}${ch.cfg.bwLimit ? ' BW' : ''}`;
      ctx.fillText(info, 8, iy);
      iy += 15;
    });
    if (view.math) {
      ctx.fillStyle = MATH_COLOR;
      ctx.fillText(`MATH  ${engine.math.op}`, 8, iy);
      iy += 15;
    }

    // trigger status (top-right)
    const status = view.trigStatus;
    const statusColor =
      status === "TRIG'D" ? '#45e873' :
      status === 'AUTO' ? '#f5c518' :
      status === 'STOP' ? '#f0685f' :
      status === 'WAIT' ? '#ff9d45' : '#f5c518';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillStyle = statusColor;
    const tw = ctx.measureText(status).width;
    ctx.fillText(status, SCREEN_W - tw - 8, 14);
    ctx.font = FONT;

    // bottom-left: timebase
    ctx.fillStyle = '#e8edf3';
    ctx.fillText(`H: ${fmtEng(engine.time.timeDiv, 's', 1)}/div`, 8, SCREEN_H - 10);
    // bottom-right: trigger info
    const tinfo = `Trig ${CH_NAMES[view.trig.source]} ${view.trig.edge === 'rising' ? '↑' : '↓'} ${fmtEng(view.trig.level, 'V', 2)}`;
    const tiw = ctx.measureText(tinfo).width;
    ctx.fillStyle = '#cfd6de';
    ctx.fillText(tinfo, SCREEN_W - tiw - 8, SCREEN_H - 10);

    // auto-measure chips (bottom, above timebase line)
    const enabledIdx = [0, 1, 2, 3].filter((i) => view.channels[i].cfg.enabled);
    if (enabledIdx.length) {
      const metrics: [string, (m: Record<string, number>) => string][] = enabledIdx.length > 2
        ? [
            ['Vpp', (m) => fmtEng(m.vpp, 'V', 2)],
            ['Freq', (m) => (m.freq > 0 ? fmtEng(m.freq, 'Hz', 2) : '----')],
          ]
        : [
            ['Vpp', (m) => fmtEng(m.vpp, 'V', 2)],
            ['Vrms', (m) => fmtEng(m.vrms, 'V', 2)],
            ['Freq', (m) => (m.freq > 0 ? fmtEng(m.freq, 'Hz', 2) : '----')],
            ['Per', (m) => (m.period > 0 ? fmtEng(m.period, 's', 2) : '----')],
          ];
      const chipH = enabledIdx.length > 2 ? 15 : 24;
      ctx.font = FONT_S;
      enabledIdx.forEach((ci, k) => {
        const m = engine.channels[ci].meas as unknown as Record<string, number>;
        const txt = metrics.map(([kk, f]) => `${kk}:${f(m)}`).join('  ');
        const w = ctx.measureText(txt).width + 34;
        const chipY = SCREEN_H - 18 - (k + 1) * chipH - k * 3;
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
  };

  /* ---------------- main render loop (after draw fns) ---------------- */
  useEffect(() => {
    let raf = 0;
    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const dt = lastTs.current ? Math.min((ts - lastTs.current) / 1000, 0.05) : 1 / 60;
      lastTs.current = ts;
      engine.tick(dt);
      if (!powerOn) return;
      drawTraces(dt);
      drawMarkers();
    };
    raf = requestAnimationFrame(loop);
    // Background fallback: requestAnimationFrame is suspended in hidden tabs,
    // which used to stop the engine heartbeat — a streaming simulator page in
    // another tab then reported the scope as "not detected". This interval
    // keeps acquisition + heartbeat alive while the window is hidden (browsers
    // throttle hidden-tab timers to ~1 Hz, so measure real elapsed time).
    let lastBg = 0;
    const iv = window.setInterval(() => {
      if (!document.hidden) { lastBg = 0; return; }
      const now = performance.now();
      const dt = lastBg ? Math.min((now - lastBg) / 1000, 0.5) : 0.1;
      lastBg = now;
      engine.tick(dt);
    }, 100);
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(iv);
    };
  }, [engine, powerOn]);

  useEffect(() => { drawGrid(); }, [engine.display.grid, powerOn]);

  /* ---------------- pointer interaction ---------------- */
  const toCanvas = (e: React.PointerEvent | React.MouseEvent | React.WheelEvent) => {
    const cv = traceRef.current!;
    const rect = cv.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * SCREEN_W,
      y: ((e.clientY - rect.top) / rect.height) * SCREEN_H,
      sx: rect.width / SCREEN_W,
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const { x, y } = toCanvas(e);
    const hits = hitRef.current;
    let mode: DragMode = { kind: 'pan' };
    const near = (a: number, b: number, tol = 8) => Math.abs(a - b) < tol;
    if (engine.cursors.enabled) {
      if (near(x, hits.curX.a, 7)) mode = { kind: 'curT', which: 'vA' };
      else if (near(x, hits.curX.b, 7)) mode = { kind: 'curT', which: 'vB' };
      else if (near(y, hits.curY.a, 7)) mode = { kind: 'curV', which: 'hA' };
      else if (near(y, hits.curY.b, 7)) mode = { kind: 'curV', which: 'hB' };
    }
    if (mode.kind === 'pan') {
      if (x > SCREEN_W - 40 && near(y, hits.trigY, 9)) mode = { kind: 'trigLevel' };
      else {
        for (const g of hits.grounds) {
          if (x > SCREEN_W - 40 && near(y, g.y, 9)) { mode = { kind: 'offset', ch: g.ch }; break; }
        }
      }
    }
    dragRef.current = { mode, x, y };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const { x, y } = toCanvas(e);
    const dx = x - d.x;
    const dy = y - d.y;
    d.x = x; d.y = y;
    const win = engine.windowDur;
    switch (d.mode.kind) {
      case 'pan':
        engine.nudgeHOffset(-dx * (win / SCREEN_W));
        break;
      case 'trigLevel': {
        const src = engine.channels[engine.trig.source];
        const ppv = SCREEN_H / V_DIVS / src.cfg.voltsDiv;
        engine.nudgeTriggerLevel(-dy / ppv);
        break;
      }
      case 'offset': {
        const ch = engine.channels[d.mode.ch];
        const ppv = SCREEN_H / V_DIVS / ch.cfg.voltsDiv;
        engine.nudgeChannelOffset(d.mode.ch, -dy / ppv);
        break;
      }
      case 'curT':
        engine.nudgeCursor(d.mode.which, dx * (win / SCREEN_W));
        break;
      case 'curV': {
        const src = engine.channels[engine.trig.source];
        const ppv = SCREEN_H / V_DIVS / src.cfg.voltsDiv;
        engine.nudgeCursor(d.mode.which, -dy / ppv);
        break;
      }
    }
  };

  const onPointerUp = () => { dragRef.current = null; };

  // React attaches onWheel as a passive listener, so e.preventDefault() inside
  // it is ignored and the page scrolls while rolling the timebase. Bind a
  // native non-passive listener instead.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const idx = nearestStep(TIME_STEPS, engine.time.timeDiv);
      const next = Math.max(0, Math.min(TIME_STEPS.length - 1, idx + (e.deltaY < 0 ? 1 : -1)));
      engine.setHorizontal({ timeDiv: TIME_STEPS[next] });
    };
    el.addEventListener('wheel', onWheelNative, { passive: false });
    return () => el.removeEventListener('wheel', onWheelNative);
  }, [engine]);

  return (
    <div
      ref={wrapRef}
      style={{ position: 'relative', width: SCREEN_W, height: SCREEN_H, cursor: 'crosshair' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => engine.autoSet()}
    >
      <canvas ref={gridRef} style={{ width: SCREEN_W, height: SCREEN_H }} />
      <canvas ref={traceRef} style={{ position: 'absolute', inset: 0, width: SCREEN_W, height: SCREEN_H }} />
      <canvas ref={markRef} style={{ position: 'absolute', inset: 0, width: SCREEN_W, height: SCREEN_H }} />
      <div className="screen-glass" />
      {!powerOn && <div className="screen-off">STANDBY</div>}
    </div>
  );
}
