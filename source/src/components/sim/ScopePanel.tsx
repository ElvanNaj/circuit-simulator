'use client';

// Realtime oscilloscope panel — stacked plots fed by engine scope ring buffers.

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { fmtValue, metaByType } from '@/lib/circuit/elements';
import type { CircuitEngine } from '@/lib/circuit/engine';
import type { CircuitElm } from './CircuitSimulator';

interface Props {
  elements: CircuitElm[];
  scopeIds: number[];
  engineRef: React.MutableRefObject<CircuitEngine | null>;
  onRemove: (id: number) => void;
}

const MAX_SAMPLES = 4096;

export function ScopePanel({ elements, scopeIds, engineRef, onRemove }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const drawLoop = () => {
      draw();
      raf = requestAnimationFrame(drawLoop);
    };
    raf = requestAnimationFrame(drawLoop);
    return () => cancelAnimationFrame(raf);
  }, [scopeIds, elements]);

  const draw = () => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (w === 0 || h === 0) return;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0c0c0f';
    ctx.fillRect(0, 0, w, h);

    const eng = engineRef.current;
    const n = scopeIds.length;
    if (n === 0 || !eng) {
      ctx.fillStyle = '#52525b';
      ctx.font = '11px ui-sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('Select an element, then “View in Scope”', w / 2, h / 2);
      return;
    }

    const plotH = h / n;
    for (let ch = 0; ch < n; ch++) {
      const y0 = ch * plotH;
      ctx.fillStyle = '#101013';
      ctx.fillRect(0, y0, w, plotH - 1);
      ctx.strokeStyle = '#1f1f24';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let gx = 0; gx < w; gx += 40) {
        ctx.moveTo(gx, y0);
        ctx.lineTo(gx, y0 + plotH - 1);
      }
      for (let gy = y0 + plotH / 4; gy < y0 + plotH - 1; gy += plotH / 4) {
        ctx.moveTo(0, gy);
        ctx.lineTo(w, gy);
      }
      ctx.stroke();

      const samples = eng.readScope(ch, MAX_SAMPLES);
      const elm = elements.find((e) => e.id === scopeIds[ch]);
      const meta = elm ? metaByType(elm.type, elm.flags) : null;
      if (samples.length < 6) {
        ctx.fillStyle = '#52525b';
        ctx.font = '10px ui-monospace';
        ctx.textAlign = 'left';
        ctx.fillText(`${meta?.name ?? 'ch' + ch} — waiting…`, 8, y0 + 12);
        continue;
      }
      let vMin = Infinity, vMax = -Infinity, iMin = Infinity, iMax = -Infinity;
      for (let k = 0; k < samples.length; k += 3) {
        const v = samples[k + 1], i = samples[k + 2];
        if (v < vMin) vMin = v;
        if (v > vMax) vMax = v;
        if (i < iMin) iMin = i;
        if (i > iMax) iMax = i;
      }
      if (vMax - vMin < 1e-6) { vMax += 0.5; vMin -= 0.5; }
      if (iMax - iMin < 1e-9) { iMax += 1e-6; iMin -= 1e-6; }
      const vPad = (vMax - vMin) * 0.12, iPad = (iMax - iMin) * 0.12;
      vMin -= vPad; vMax += vPad; iMin -= iPad; iMax += iPad;

      const t0 = samples[0], t1 = samples[samples.length - 3];
      const toX = (t: number) => ((t - t0) / Math.max(t1 - t0, 1e-12)) * (w - 2) + 1;
      const toVy = (v: number) => y0 + plotH - 4 - ((v - vMin) / (vMax - vMin)) * (plotH - 10);
      const toIy = (i: number) => y0 + plotH - 4 - ((i - iMin) / (iMax - iMin)) * (plotH - 10);

      ctx.strokeStyle = '#34d399';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < samples.length; k += 3) {
        const x = toX(samples[k]), y = toIy(samples[k + 2]);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      for (let k = 0; k < samples.length; k += 3) {
        const x = toX(samples[k]), y = toVy(samples[k + 1]);
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();

      ctx.font = '10px ui-monospace';
      ctx.textAlign = 'left';
      ctx.fillStyle = '#fde047';
      ctx.fillText(`V ${fmtValue(vMax - vPad * 2, 'V')}`, 8, y0 + 11);
      ctx.fillStyle = '#34d399';
      ctx.fillText(`I ${fmtValue(iMax - iPad * 2, 'A')}`, 8, y0 + 22);
      ctx.fillStyle = '#a1a1aa';
      const win = t1 - t0;
      ctx.fillText(
        `${meta?.name ?? ''}  ${win >= 1 ? `${win.toFixed(1)}s` : win >= 1e-3 ? `${(win * 1000).toFixed(0)}ms` : `${(win * 1e6).toFixed(0)}µs`}`,
        90,
        y0 + 11
      );
    }
  };

  return (
    <aside ref={wrapRef} className="relative w-72 shrink-0 border-l border-border bg-[#0c0c0f]">
      <canvas ref={canvasRef} className="absolute inset-0" />
      <div className="absolute right-1 top-1 z-10 flex flex-col gap-1">
        {scopeIds.map((id) => {
          const elm = elements.find((e) => e.id === id);
          const meta = elm ? metaByType(elm.type, elm.flags) : null;
          return (
            <button
              key={id}
              className="flex items-center gap-1 rounded bg-muted/90 px-1.5 py-0.5 text-[10px] text-foreground/90 hover:bg-accent"
              onClick={() => onRemove(id)}
              title="Remove from scope"
            >
              {meta?.name ?? 'elem'}
              <X size={10} />
            </button>
          );
        })}
      </div>
      <div className="pointer-events-none absolute bottom-1 left-2 text-[9px] text-muted-foreground/70">
        <span className="text-yellow-300">—</span> voltage · <span className="text-emerald-400">—</span> current
      </div>
    </aside>
  );
}
