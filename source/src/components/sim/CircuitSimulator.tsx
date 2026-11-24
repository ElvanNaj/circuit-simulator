'use client';

// CircuitSimulator — Falstad-style interactive editor backed by the Rust/WASM engine.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from 'next-themes';
import { CircuitEngine, type RawElem } from '@/lib/circuit/engine';
import {
  ELEMENT_META,
  CATEGORIES,
  F_CLOSED,
  T,
  fmtValue,
  isProbeType,
  metaByType,
  type ElemMeta,
} from '@/lib/circuit/elements';
import { drawElement, drawCurrentDots, elementLabels, probeHandleRect, setCanvasTheme, canvasPalette, type ElmLabel } from '@/lib/circuit/draw';
import { APP_THEMES, normalizeTheme, withAlpha, type AppTheme } from '@/lib/circuit/theme';
import { PRESETS } from '@/lib/circuit/presets';
import {
  circuitFileName,
  parseCircuitFile,
  serializeCircuitFile,
} from '@/lib/circuit/file-format';
import { ZDsoBridge, resampleScope, type ZDsoState } from '@/lib/z-dso/bridge';
import {
  AvoBridge,
  AVO_MODES,
  type AvoMode,
  type AvoReading,
  type AvoState,
  type AvoMeasurement,
} from '@/lib/z-avo/bridge';
import { ScopePanel } from './ScopePanel';
import { EditDialog } from './EditDialog';
import { ComponentPalette } from './ComponentPalette';
import { ShortcutsDialog } from './ShortcutsDialog';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useToast } from '@/hooks/use-toast';
import {
  Play, Pause, RotateCcw, Undo2, Trash2, ZoomIn, ZoomOut, Crosshair, Eye,
  Save, FolderOpen, Activity, Monitor, Search, Keyboard, Maximize2, Redo2,
  Gauge, Power, SlidersHorizontal, PanelLeftClose, PanelLeftOpen,
  Sun, Moon, Palette,
} from 'lucide-react';

const GRID = 20;
const POT_WIPER_OFFSET = 40; // 2 grid steps — keeps the wiper pin wire-connectable
const SCOPE_WIRE = new Set<number>([T.WIRE, T.GROUND]);

const AVO_FRAME_MS = 100; // ~10 Hz measurement stream
const AVO_SAMPLE_COUNT = 4096; // DC/AC window
const AVO_FREQ_SAMPLE_COUNT = 16384; // more history so Hz/duty can see full cycles
const AVO_MODE_LABELS: Record<AvoMode, string> = {
  OFF: 'Off',
  DCV: 'DC V',
  ACV: 'AC V',
  DCA: 'DC A',
  ACA: 'AC A',
  OHM: 'Ω',
  CONT: 'Continuity',
  DIODE: 'Diode',
  CAP: 'Capacitance',
  HZ: 'Hz',
  DUTY: 'Duty %',
};

/** Two-terminal parts that can be measured with the red/black probes. */
const RESISTIVE_TYPES = new Set<number>([T.RESISTOR, T.LAMP, T.POT]);
const CAPACITIVE_TYPES = new Set<number>([T.CAPACITOR]);
const DIODE_TYPES = new Set<number>([T.DIODE, T.LED, T.ZENER]);

const ZDSO_TIME_DIVS = [20e-6, 50e-6, 100e-6, 200e-6, 500e-6, 1e-3, 2e-3, 5e-3];
const ZDSO_SAMPLES = 1200;
const ZDSO_WINDOW_DIVS = 10; // scope screen is 10 horizontal divisions
const ZDSO_FRAME_MS = 33; // ~30 fps

function fmtTimeDiv(v: number): string {
  if (v >= 1) return `${+v.toFixed(3)} s`;
  if (v >= 1e-3) return `${+(v * 1e3).toFixed(3)} ms`;
  if (v >= 1e-6) return `${+(v * 1e6).toFixed(3)} µs`;
  return `${+(v * 1e9).toFixed(3)} ns`;
}

export interface CircuitElm {
  id: number;
  type: number;
  flags: number;
  posts: [number, number][];
  params: number[];
  /** User-dragged offset for the element's value label (world units). */
  labelOff?: [number, number];
}

let nextId = 1;

function snap(v: number): number {
  return Math.round(v / GRID) * GRID;
}

/** Pixel size from a canvas font shorthand, which may start with a weight. */
function fontSizeOf(font: string): number {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  return m ? parseFloat(m[1]) : 10;
}

function defaultElm(meta: ElemMeta, posts: [number, number][]): CircuitElm {
  return {
    id: nextId++,
    type: meta.type,
    flags: meta.defaults.flags ?? 0,
    posts,
    params: [...meta.defaults.params],
  };
}

/** Deep-enough copy for undo/redo snapshots (posts and params are mutated in place otherwise). */
function cloneElements(elms: CircuitElm[]): CircuitElm[] {
  return elms.map((e) => ({
    ...e,
    posts: e.posts.map((p) => [...p] as [number, number]),
    params: [...e.params],
    labelOff: e.labelOff ? [e.labelOff[0], e.labelOff[1]] : undefined,
  }));
}

/** Auto-layout multi-post elements from a drag S→E. */
function layoutPosts(meta: ElemMeta, s: [number, number], e: [number, number]): [number, number][] {
  const dx = e[0] - s[0];
  const dy = e[1] - s[1];
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const ux = horizontal ? Math.sign(dx) || 1 : 0;
  const uy = horizontal ? 0 : Math.sign(dy) || 1;
  const px = -uy, py = ux; // perpendicular
  const n = meta.posts;
  const posts: [number, number][] = [];
  const type = meta.type;
  // chips (DFF/ADC/DAC) keep a fixed footprint — the drag only sets their
  // orientation and lead length, exactly like Falstad's ChipElm
  const dragLen = Math.hypot(dx, dy);
  const chipLen = Math.min(Math.max(dragLen, 40), 60);
  // A click with no drag still needs a usable body: give multi-post elements a
  // default length instead of stacking every post on the same point (which
  // collapsed the NPN/PNP symbol to a dot).
  const needDefaultEnd = dragLen < 1;
  const E: [number, number] = (type === T.DFF || type === T.ADC || type === T.DAC || needDefaultEnd)
    ? [
        snap(s[0] + (dragLen < 1e-6 ? chipLen : (dx / dragLen) * chipLen)),
        snap(s[1] + (dragLen < 1e-6 ? 0 : (dy / dragLen) * chipLen)),
      ]
    : e;
  if (type === T.POT) {
    // Potentiometer: the two ends live at the drag start/end, the wiper is a
    // short side pin at 50 %. Previously the generic 3-post spread put the
    // wiper on the drag endpoint, so it trailed the mouse while sizing.
    const click = Math.hypot(dx, dy) < 1;
    const end: [number, number] = click ? [s[0] + GRID * 2, s[1]] : [snap(e[0]), snap(e[1])];
    const bx = end[0] - s[0];
    const by = end[1] - s[1];
    const len = Math.hypot(bx, by) || 1;
    const ux2 = bx / len;
    const uy2 = by / len;
    // wiper sits on the side opposite the value label and stays on the grid
    const wx = s[0] + bx * 0.5 + uy2 * POT_WIPER_OFFSET;
    const wy = s[1] + by * 0.5 - ux2 * POT_WIPER_OFFSET;
    return [
      [s[0], s[1]],
      [end[0], end[1]],
      [snap(wx), snap(wy)],
    ];
  }
  if (type === T.OPAMP || type === T.COMPARATOR) {
    // inputs straddle the drag start, output at drag end
    return [
      [snap(s[0] - px * 20), snap(s[1] - py * 20)],
      [snap(s[0] + px * 20), snap(s[1] + py * 20)],
      [E[0], E[1]],
    ];
  }
  if (type === T.TRANSISTOR || type === T.MOSFET) {
    // base/gate at start, collector/drain and emitter/source straddling end
    return [
      [s[0], s[1]],
      [E[0] + px * 20, E[1] + py * 20],
      [E[0] - px * 20, E[1] - py * 20],
    ];
  }
  if (type === T.DFF) {
    return [
      [s[0], s[1]],
      [s[0] + px * 40 + ux * 0, s[1] + py * 40 + uy * 0],
      [E[0], E[1]],
      [E[0] + px * 40, E[1] + py * 40],
    ];
  }
  if (type === T.ADC || type === T.DAC) {
    const m = (n - 1) / 2;
    for (let i = 0; i < n; i++) {
      posts.push([s[0] + px * (i - m) * 20, s[1] + py * (i - m) * 20]);
    }
    // last post on the opposite side (output)
    posts[n - 1] = [E[0] + px * (n - 1 - m) * 20 * -1, E[1] + py * (n - 1 - m) * 20 * -1];
    posts[n - 1] = [E[0], E[1]];
    return posts;
  }
  if (type === T.IC_DUMMY) {
    // Four pins stacked along the drag's perpendicular (pin 1 → pin 4). The
    // symbol derives the body direction from that order, so the box always
    // extends to the right of the pins, including after a click with no drag.
    for (let i = 0; i < 4; i++) {
      posts.push([snap(s[0] + px * (i - 1.5) * 20), snap(s[1] + py * (i - 1.5) * 20)]);
    }
    return posts;
  }
  if (type === T.TRANSFORMER) {
    return [
      [s[0], s[1]],
      [E[0], E[1]],
      [s[0] + px * 80 + ux * 0, s[1] + py * 80 + uy * 0],
      [E[0] + px * 80 + ux * 0, E[1] + py * 80 + uy * 0],
    ];
  }
  if (type === T.AND || type === T.OR || type === T.NAND || type === T.NOR || type === T.XOR || type === T.XNOR) {
    const nIn = Math.max(2, (meta.defaults.flags ?? 2) & 0xff);
    const m = (nIn - 1) / 2;
    for (let i = 0; i < nIn; i++) {
      posts.push([s[0] + px * (i - m) * 40, s[1] + py * (i - m) * 40]);
    }
    posts.push([E[0], E[1]]);
    return posts;
  }
  // generic: spread along drag (or the default length when clicked)
  const ex = E[0] - s[0], ey = E[1] - s[1];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0 : i / (n - 1);
    posts.push([s[0] + ex * t, s[1] + ey * t]);
  }
  return posts.map((p) => [snap(p[0]), snap(p[1])]) as [number, number][];
}

/** Mirror of the engine's union-find so JS knows post→node (for wire voltage coloring). */
function computeNodeMap(elms: RawElem[]): { elmNodes: number[][]; nodeCount: number } {
  const key = (p: [number, number]) => `${p[0]},${p[1]}`;
  const postId = new Map<string, number>();
  const postList: [number, number][] = [];
  const elmPosts: number[][] = [];
  for (const e of elms) {
    const ids: number[] = [];
    for (const p of e.posts) {
      const k = key(p);
      let id = postId.get(k);
      if (id === undefined) {
        id = postList.length;
        postId.set(k, id);
        postList.push(p);
      }
      ids.push(id);
    }
    elmPosts.push(ids);
  }
  const parent = postList.map((_, i) => i);
  const find = (a: number): number => {
    while (parent[a] !== a) {
      parent[a] = parent[parent[a]];
      a = parent[a];
    }
    return a;
  };
  const union = (a: number, b: number) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  for (let i = 0; i < elms.length; i++) {
    const e = elms[i];
    if (e.etype === T.WIRE) union(elmPosts[i][0], elmPosts[i][1]);
    if (e.etype === T.SWITCH && e.flags & F_CLOSED && (e.params[0] ?? 0) <= 0) {
      union(elmPosts[i][0], elmPosts[i][1]);
    }
  }
  const nodeOfRoot = new Map<number, number>();
  // grounds → node 0
  for (let i = 0; i < elms.length; i++) {
    if (elms[i].etype === T.GROUND) nodeOfRoot.set(find(elmPosts[i][0]), 0);
  }
  let next = 1;
  const nodeOfPost: number[] = new Array(postList.length).fill(-1);
  for (let p = 0; p < postList.length; p++) {
    const r = find(p);
    if (!nodeOfRoot.has(r)) {
      nodeOfRoot.set(r, next++);
    }
    nodeOfPost[p] = nodeOfRoot.get(r)!;
  }
  const elmNodes = elmPosts.map((ids) => ids.map((id) => nodeOfPost[id]));
  return { elmNodes, nodeCount: next };
}

/**
 * Scope channel layout: the four Z-DSO channels come first, followed by the
 * private Z-AVO channels (red probe differential voltage, first ammeter).
 */
function scopeChannels(elms: CircuitElm[], scopeIds: number[]) {
  const idxs = scopeIds
    .map((id) => elms.findIndex((e) => e.id === id))
    .filter((i) => i >= 0);
  // Reuse an existing channel when the element is already on the scope.
  const channelFor = (idx: number): number => {
    const at = idxs.indexOf(idx);
    if (at >= 0) return at;
    idxs.push(idx);
    return idxs.length - 1;
  };
  let voltCh = -1;
  let ammCh = -1;
  const redIdx = elms.findIndex((e) => e.type === T.PROBE_RED);
  if (redIdx >= 0) voltCh = channelFor(redIdx);
  const ammIdx = elms.findIndex((e) => e.type === T.AMMETER);
  if (ammIdx >= 0) ammCh = channelFor(ammIdx);
  return { idxs, voltCh, ammCh };
}

/** Convert an engine scope ring ([t,v,i] stride 3) into a meter payload. */
function avoWaveFromSamples(
  samples: Float64Array,
  valueOffset: 1 | 2,
  maxCount = AVO_SAMPLE_COUNT
): { data: Float32Array; sampleRate: number; tStart: number } | null {
  const total = Math.floor(samples.length / 3);
  if (total < 2) return null;
  const count = Math.min(total, maxCount);
  const start = total - count;
  const data = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    data[i] = samples[(start + i) * 3 + valueOffset];
  }
  const t0 = samples[start * 3];
  const t1 = samples[(start + count - 1) * 3];
  const sampleRate = t1 > t0 ? (count - 1) / (t1 - t0) : 0;
  return { data, sampleRate, tStart: t0 };
}

/**
 * Frequency from interpolated zero crossings using the real sample timestamps.
 * Returns null when there are too few cycles to measure reliably.
 */
function estimateFrequency(
  data: Float32Array,
  sampleRate: number,
  tStart: number
): number | null {
  if (data.length < 4 || !(sampleRate > 0)) return null;
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i];
  const mean = sum / data.length;
  const crossings: number[] = [];
  for (let i = 1; i < data.length; i++) {
    const a = data[i - 1] - mean;
    const b = data[i] - mean;
    if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) {
      const frac = a === b ? 0 : a / (a - b);
      crossings.push(tStart + (i - 1 + frac) / sampleRate);
    }
  }
  if (crossings.length < 3) return null;
  const periods = (crossings.length - 1) / 2;
  const span = crossings[crossings.length - 1] - crossings[0];
  if (!(span > 0) || !(periods > 0)) return null;
  return periods / span;
}

function probeNodes(elmNodes: number[][], redIdx: number): [number, number] | null {
  const n = elmNodes[redIdx];
  if (!n || n.length < 2) return null;
  return [n[0], n[1]];
}

function pairMatches(n: number[], i: number, j: number, red: number, black: number): boolean {
  return (n[i] === red && n[j] === black) || (n[i] === black && n[j] === red);
}

/** Resistance seen between the probe tips (R/lamp/pot, or 0 when shorted). */
function resistanceBetween(elms: CircuitElm[], elmNodes: number[][], redIdx: number): number | null {
  const pair = probeNodes(elmNodes, redIdx);
  if (!pair) return null;
  const [red, black] = pair;
  if (red === black) return 0;
  for (let i = 0; i < elms.length; i++) {
    const e = elms[i];
    if (!RESISTIVE_TYPES.has(e.type)) continue;
    const n = elmNodes[i];
    if (!n) continue;
    if (e.type === T.POT) {
      if (n.length < 3) continue;
      const r = Math.max(0, e.params[0] ?? 0);
      const pos = Math.min(1, Math.max(0, e.params[1] ?? 0.5));
      if (pairMatches(n, 0, 1, red, black)) return r;
      if (pairMatches(n, 0, 2, red, black)) return r * pos;
      if (pairMatches(n, 1, 2, red, black)) return r * (1 - pos);
      continue;
    }
    if (n.length >= 2 && pairMatches(n, 0, 1, red, black)) {
      return Math.max(0, e.params[0] ?? 0);
    }
  }
  return null;
}

function capacitanceBetween(elms: CircuitElm[], elmNodes: number[][], redIdx: number): number | null {
  const pair = probeNodes(elmNodes, redIdx);
  if (!pair) return null;
  const [red, black] = pair;
  for (let i = 0; i < elms.length; i++) {
    const e = elms[i];
    if (!CAPACITIVE_TYPES.has(e.type)) continue;
    const n = elmNodes[i];
    if (n && n.length >= 2 && pairMatches(n, 0, 1, red, black)) {
      return Math.max(0, e.params[0] ?? 0);
    }
  }
  return null;
}

function diodeBetween(
  elms: CircuitElm[],
  elmNodes: number[][],
  redIdx: number
): { elm: CircuitElm; index: number } | null {
  const pair = probeNodes(elmNodes, redIdx);
  if (!pair) return null;
  const [red, black] = pair;
  for (let i = 0; i < elms.length; i++) {
    const e = elms[i];
    if (!DIODE_TYPES.has(e.type)) continue;
    const n = elmNodes[i];
    if (n && n.length >= 2 && pairMatches(n, 0, 1, red, black)) return { elm: e, index: i };
  }
  return null;
}

/** Use the live diode drop when forward-biased, else estimate it at ~1 mA. */
function diodeForwardVoltage(e: CircuitElm, measuredVd: number): number {
  const live = Math.abs(measuredVd);
  if (live > 0.05) return live;
  const is = (e.params[0] ?? 0) > 0 ? e.params[0] : 1e-12;
  const n = (e.params[3] ?? 0) > 0 ? e.params[3] : 1;
  const vf = n * 0.025852 * Math.log(1e-3 / is);
  return Number.isFinite(vf) ? Math.min(3.9, Math.max(0, vf)) : 0;
}

/** A probe tip is connected when it shares a post or lies on a wire. */
function probeTipConnected(tip: [number, number], elms: CircuitElm[], selfId: number): boolean {
  for (const e of elms) {
    if (e.id === selfId) continue;
    for (const p of e.posts) {
      if (p[0] === tip[0] && p[1] === tip[1]) return true;
    }
  }
  for (const e of elms) {
    if (e.id === selfId || e.type !== T.WIRE || e.posts.length < 2) continue;
    if (distToSeg(tip[0], tip[1], e.posts[0], e.posts[1]) < 0.5) return true;
  }
  return false;
}

/** Snap a probe tip to the closest post or wire point within `tol` world units. */
function nearestProbePoint(
  wx: number,
  wy: number,
  elms: CircuitElm[],
  tol: number,
  excludeId = -1
): [number, number] | null {
  let best: [number, number] | null = null;
  let bestD = tol;
  const consider = (p: [number, number]) => {
    const d = Math.hypot(p[0] - wx, p[1] - wy);
    if (d < bestD) {
      bestD = d;
      best = [p[0], p[1]];
    }
  };
  for (const e of elms) {
    if (e.id === excludeId) continue;
    for (const p of e.posts) consider(p);
    if (e.type === T.WIRE && e.posts.length >= 2) {
      const [a, b] = e.posts;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l2 = dx * dx + dy * dy;
      if (l2 > 0) {
        let t = ((wx - a[0]) * dx + (wy - a[1]) * dy) / l2;
        t = Math.max(0, Math.min(1, t));
        consider([a[0] + t * dx, a[1] + t * dy]);
      }
    }
  }
  return best;
}

/** Diodes carry Is even in reverse; tiny leakage is not worth animating. */
function animatedCurrent(type: number, params: number[], cur: number): number {
  if (type === T.DIODE || type === T.LED || type === T.ZENER) {
    const noise = Math.max(1e-9, Math.abs(params[0] ?? 0) * 50);
    if (Math.abs(cur) < noise) return 0;
  }
  return cur;
}

/**
 * Sub-microamp currents (diode reverse leakage, numerical residue, ...) would
 * still crawl along the wires at a visible speed, so they are not animated.
 * Real educational circuits run in the mA range, comfortably above this.
 */
const WIRE_DOT_MIN = 1e-6;

/**
 * Wire currents for the flow animation.
 *
 * Wires are ideal (zero ohm), so the current through an individual wire is not
 * unique in general. We treat the wire network as a graph: component currents
 * inject/extract at its vertices, and a spanning tree distributes those currents
 * over the wires. This keeps the animation correct across wire-to-wire junctions
 * (previously a wire whose start touched another wire always showed zero) and
 * makes the dot direction independent of the order the wire was drawn.
 */
function computeWireCurrents(elms: CircuitElm[], outs: Float64Array): Map<number, number> {
  const result = new Map<number, number>();
  const key = (p: [number, number]) => `${p[0]},${p[1]}`;
  // external current at each coordinate: sum of currents INTO elements (loads)
  const inflow = new Map<string, number>();
  for (let i = 0; i < elms.length; i++) {
    const e = elms[i];
    if (e.type === T.WIRE) continue;
    // ignore diode reverse leakage so it does not put dots on the wires either
    if ((e.type === T.DIODE || e.type === T.LED || e.type === T.ZENER) &&
        animatedCurrent(e.type, e.params, outs[i * 8 + 3] ?? 0) === 0) {
      continue;
    }
    for (let k = 0; k < e.posts.length; k++) {
      const into = -(outs[i * 8 + 2 + k] ?? 0); // out[2+k] = current out of element into post
      inflow.set(key(e.posts[k]), (inflow.get(key(e.posts[k])) ?? 0) + into);
    }
  }

  // build the wire graph (vertices = snapped post coordinates)
  const edges = new Map<number, { a: string; b: string }>();
  const adj = new Map<string, { to: string; id: number }[]>();
  const link = (from: string, to: string, id: number) => {
    const list = adj.get(from);
    if (list) list.push({ to, id });
    else adj.set(from, [{ to, id }]);
  };
  for (const w of elms) {
    if (w.type !== T.WIRE || w.posts.length < 2) continue;
    const a = key(w.posts[0]);
    const b = key(w.posts[1]);
    if (a === b) continue;
    edges.set(w.id, { a, b });
    link(a, b, w.id);
    link(b, a, w.id);
  }
  // Ground symbols are ideal returns: the engine does not report their current,
  // so the current the circuit dumps into ground has to be reconstructed from
  // KCL for the wire network around each ground post.
  const groundAt = new Set<string>();
  for (const e of elms) {
    if (e.type !== T.GROUND) continue;
    for (const p of e.posts) groundAt.add(key(p));
  }

  const visited = new Set<string>();
  for (const start of adj.keys()) {
    if (visited.has(start)) continue;
    // BFS spanning tree for this wire network
    const order: string[] = [];
    const parent = new Map<string, { p: string; id: number } | null>();
    const queue: string[] = [start];
    visited.add(start);
    parent.set(start, null);
    for (let qi = 0; qi < queue.length; qi++) {
      const v = queue[qi];
      order.push(v);
      for (const { to, id } of adj.get(v) ?? []) {
        if (visited.has(to)) continue;
        visited.add(to);
        parent.set(to, { p: v, id });
        queue.push(to);
      }
    }
    // Balance the residual at a ground post in this wire island (if any).
    // Without this, current entering a grounded wire end looks like it has to
    // flow back out of the same island and the dots point the wrong way (or
    // vanish on the last wire before ground).
    let residual = 0;
    for (const v of order) residual += inflow.get(v) ?? 0;
    if (Math.abs(residual) > 0) {
      const g = order.find((v) => groundAt.has(v));
      if (g) inflow.set(g, (inflow.get(g) ?? 0) - residual);
    }
    // subtree sums: current that must flow through the edge into each subtree
    const sum = new Map<string, number>();
    for (const v of order) sum.set(v, inflow.get(v) ?? 0);
    for (let i = order.length - 1; i >= 0; i--) {
      const v = order[i];
      const par = parent.get(v);
      if (!par) continue;
      sum.set(par.p, (sum.get(par.p) ?? 0) + (sum.get(v) ?? 0));
    }
    for (const v of order) {
      const par = parent.get(v);
      if (!par) continue;
      const edge = edges.get(par.id);
      if (!edge) continue;
      const s = sum.get(v) ?? 0;
      // wire current is defined along its own post0 -> post1 direction
      const flow = edge.a === par.p && edge.b === v ? s : -s;
      result.set(par.id, Math.abs(flow) < WIRE_DOT_MIN ? 0 : flow);
    }
  }
  return result;
}

export function CircuitSimulator() {
  const [ready, setReady] = useState(false);
  const [elements, setElements] = useState<CircuitElm[]>([]);
  const [running, setRunning] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [animSpeed, setAnimSpeed] = useState(1);
  const [simTime, setSimTime] = useState(0);
  const [stopMsg, setStopMsg] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [toolMeta, setToolMeta] = useState<ElemMeta | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      return localStorage.getItem('circuit-sim-sidebar') !== '0';
    } catch {
      return true;
    }
  });
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [showValues, setShowValues] = useState(true);
  const [flowAnim, setFlowAnim] = useState(() => {
    if (typeof window === 'undefined') return true;
    try {
      return localStorage.getItem('circuit-sim-flow-anim') !== '0';
    } catch {
      return true;
    }
  });
  const [scopeIds, setScopeIds] = useState<number[]>([]);
  const [statusHint, setStatusHint] = useState('Drag on empty canvas to select. Drag from a post to wire.');
  const [zConnected, setZConnected] = useState(false);
  const [zTimeDiv, setZTimeDiv] = useState(200e-6);
  const [zSignal, setZSignal] = useState<'voltage' | 'current'>('voltage');
  const [avoConnected, setAvoConnected] = useState(false);
  const [avoMode, setAvoMode] = useState<AvoMode>('DCV');
  const [avoPower, setAvoPower] = useState(true);
  const [avoHold, setAvoHold] = useState(false);
  const [avoReading, setAvoReading] = useState<AvoReading | null>(null);
  const [avoProbes, setAvoProbes] = useState<{ red: string | null; black: string | null }>({
    red: null,
    black: null,
  });
  const [avoPaused, setAvoPaused] = useState(false);

  // Theme: next-themes owns the <html> class; the canvas renderer needs the
  // same choice synchronously, so keep it in a ref and push it on change.
  const { theme, setTheme } = useTheme();
  const themeRef = useRef<AppTheme>('dark');
  const activeTheme = normalizeTheme(theme);
  useEffect(() => {
    themeRef.current = activeTheme;
    setCanvasTheme(activeTheme);
  }, [activeTheme]);

  const { toast } = useToast();
  const engineRef = useRef<CircuitEngine | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const circuitNameRef = useRef('circuit');
  const elementsRef = useRef<CircuitElm[]>([]);
  const viewRef = useRef({ x: 0, y: 0, zoom: 1 });
  const frameRef = useRef<{ outs: Float64Array; flags: Uint32Array; nv: Float64Array }>({
    outs: new Float64Array(0),
    flags: new Uint32Array(0),
    nv: new Float64Array(0),
  });
  const dragRef = useRef<null | {
    kind: 'wire' | 'move' | 'post' | 'place' | 'pan' | 'select' | 'label';
    start: [number, number];
    last: [number, number];
    postId?: number;
    elmId?: number;
    elmIds?: number[];
    origs?: Record<number, [number, number][]>;
    baseSel?: number[];
    /** Label drags keep the pre-drag offset plus a snapshot for undo. */
    origLabelOff?: [number, number];
    before?: CircuitElm[];
    moved?: boolean;
  }>(null);
  const hoverRef = useRef<number | null>(null);
  const undoRef = useRef<CircuitElm[][]>([]);
  const redoRef = useRef<CircuitElm[][]>([]);
  const scopeIdsRef = useRef<number[]>([]);
  const runningRef = useRef(true);
  const speedRef = useRef(1);
  const animSpeedRef = useRef(1);
  const flowAnimRef = useRef(flowAnim);
  const dotPhaseRef = useRef(0);
  const nodeMapRef = useRef<{ elmNodes: number[][]; nodeCount: number }>({ elmNodes: [], nodeCount: 0 });
  const wireCurRef = useRef<Map<number, number>>(new Map());
  const zBridgeRef = useRef<ZDsoBridge | null>(null);
  const zTimeDivRef = useRef(200e-6);
  const zSignalRef = useRef<'voltage' | 'current'>('voltage');
  const zLastStreamRef = useRef(0);
  const zTestUntilRef = useRef(0);
  const zTestActiveRef = useRef(false);
  const zPrevScopeCountRef = useRef(0);
  const zIgnoreStateUntilRef = useRef(0);
  const zConfigSentRef = useRef(false);
  const avoBridgeRef = useRef<AvoBridge | null>(null);
  const avoModeRef = useRef<AvoMode>('DCV');
  const avoVoltChRef = useRef(-1);
  const avoAmmChRef = useRef(-1);
  const avoLastStreamRef = useRef(0);
  const avoAttachedRef = useRef<{ red: string | null; black: string | null }>({
    red: null,
    black: null,
  });
  const avoStreamingRef = useRef(false);
  const avoPausedRef = useRef(false);
  const lastScopeKeyRef = useRef('');

  elementsRef.current = elements;
  scopeIdsRef.current = scopeIds;
  runningRef.current = running;
  speedRef.current = speed;
  animSpeedRef.current = animSpeed;

  useEffect(() => {
    flowAnimRef.current = flowAnim;
  }, [flowAnim]);

  useEffect(() => {
    zSignalRef.current = zSignal;
  }, [zSignal]);

  useEffect(() => {
    avoPausedRef.current = avoPaused;
  }, [avoPaused]);

  // ---- Z-DSO oscilloscope bridge ----
  const applyScopeState = useCallback((state: ZDsoState) => {
    // A freshly-opened scope broadcasts its previous/default timebase before
    // our configuration lands; don't let that overwrite the app's setting.
    if (!zConfigSentRef.current) return;
    if (performance.now() < zIgnoreStateUntilRef.current) return;
    const td = state.horizontal?.timeDiv;
    if (typeof td === 'number' && Number.isFinite(td) && td > 0) {
      zTimeDivRef.current = td;
      setZTimeDiv((prev) => (Math.abs(prev - td) > 1e-12 ? td : prev));
    }
  }, []);

  useEffect(() => {
    const bridge = new ZDsoBridge();
    zBridgeRef.current = bridge;
    bridge.onConnectionChange = (connected) => {
      if (connected) zIgnoreStateUntilRef.current = performance.now() + 500;
      else zConfigSentRef.current = false;
      setZConnected(connected);
    };
    bridge.onState = applyScopeState;
    return () => {
      bridge.dispose();
      if (zBridgeRef.current === bridge) zBridgeRef.current = null;
    };
  }, [applyScopeState]);

  // Re-apply our timebase/trigger whenever the scope (re)appears.
  useEffect(() => {
    if (!zConnected) return;
    const bridge = zBridgeRef.current;
    if (!bridge) return;
    zConfigSentRef.current = false;
    zIgnoreStateUntilRef.current = performance.now() + 500;
    bridge.send('setHorizontal', [
      { timeDiv: zTimeDivRef.current, hOffset: 0, trigPos: 0.5 },
    ]);
    bridge.send('setTrigger', [
      { source: 0, level: 0, edge: 'rising', sweep: 'auto' },
    ]);
    void bridge.request('getState').then((reply) => {
      if (reply.ok && reply.data && typeof reply.data === 'object') {
        applyScopeState(reply.data as ZDsoState);
      }
    });
    const timer = window.setTimeout(() => {
      zConfigSentRef.current = true;
    }, 500);
    return () => window.clearTimeout(timer);
  }, [zConnected, applyScopeState]);

  // Release scope channels that no longer have a matching simulator scope.
  useEffect(() => {
    const bridge = zBridgeRef.current;
    if (!bridge) return;
    const prev = zPrevScopeCountRef.current;
    const n = scopeIds.length;
    for (let ch = n; ch < Math.max(prev, n); ch++) {
      bridge.send('clearChannelData', [ch]);
    }
    zPrevScopeCountRef.current = n;
  }, [scopeIds]);

  // ---- Z-AVO multimeter bridge ----
  const applyAvoState = useCallback((state: AvoState) => {
    if (typeof state.power === 'boolean') setAvoPower(state.power);
    if (state.mode) {
      avoModeRef.current = state.mode;
      setAvoMode(state.mode);
    }
    if (typeof state.hold === 'boolean') setAvoHold(state.hold);
    if (state.probes) {
      const red = state.probes.red ?? null;
      const black = state.probes.black ?? null;
      setAvoProbes((prev) =>
        prev.red === red && prev.black === black ? prev : { red, black }
      );
    }
  }, []);

  useEffect(() => {
    const bridge = new AvoBridge();
    avoBridgeRef.current = bridge;
    bridge.onConnectionChange = (connected) => {
      setAvoConnected(connected);
      // Force a re-attach: messages sent before the meter window finished
      // loading are lost, so the next stream must re-announce the probes.
      if (connected) avoAttachedRef.current = { red: null, black: null };
    };
    bridge.onState = applyAvoState;
    bridge.onReading = setAvoReading;
    bridge.onHeartbeat = (hb) => {
      if (!hb) return;
      if (hb.mode) {
        avoModeRef.current = hb.mode;
        setAvoMode(hb.mode);
      }
      if (typeof hb.power === 'boolean') setAvoPower(hb.power);
    };
    return () => {
      bridge.dispose();
      if (avoBridgeRef.current === bridge) avoBridgeRef.current = null;
      avoAttachedRef.current = { red: null, black: null };
      avoStreamingRef.current = false;
    };
  }, [applyAvoState]);

  // Pull the meter's current mode/power/probe state when it (re)connects.
  useEffect(() => {
    if (!avoConnected) return;
    const bridge = avoBridgeRef.current;
    if (!bridge) return;
    void bridge.request('getState').then((reply) => {
      if (reply.ok && reply.data && typeof reply.data === 'object') {
        applyAvoState(reply.data as AvoState);
      }
    });
  }, [avoConnected, applyAvoState]);

  // ---- engine boot ----
  useEffect(() => {
    (async () => {
      const eng = new CircuitEngine();
      await eng.load();
      engineRef.current = eng;
      (window as unknown as { __engine?: CircuitEngine }).__engine = eng;
      (window as unknown as { __elementsRef?: { current: CircuitElm[] } }).__elementsRef = elementsRef;
      (window as unknown as { __wireCurRef?: { current: Map<number, number> } }).__wireCurRef = wireCurRef;
      // load saved circuit or default preset
      const saved = localStorage.getItem('circuit-sim-elements');
      if (saved) {
        try {
          const parsed = JSON.parse(saved) as CircuitElm[];
          if (Array.isArray(parsed) && parsed.length > 0) {
            nextId = Math.max(...parsed.map((e) => e.id)) + 1;
            const cleaned = splitWiresAtPosts(parsed);
            setElements(cleaned);
            applyToEngine(cleaned);
            setReady(true);
            return;
          }
        } catch { /* fall through to preset */ }
      }
      loadPreset(0);
      setReady(true);
    })();
  }, []);
  const applyToEngine = useCallback((elms: CircuitElm[]) => {
    // Z-AVO probes are JS-only 1-post markers. Map them onto engine elements so
    // the WASM element indices keep matching the editor list 1:1:
    //   red   -> 1 GΩ differential voltmeter between the two probe tips
    //   black -> same-node voltmeter (a mathematically exact no-op)
    const blackTip = elms.find((e) => e.type === T.PROBE_BLACK)?.posts[0] ?? null;
    const raw: RawElem[] = elms.map((e) => {
      if (e.type === T.PROBE_RED) {
        const tip = e.posts[0];
        return { etype: T.VOLTMETER, flags: 0, posts: [tip, blackTip ?? tip], params: [] };
      }
      if (e.type === T.PROBE_BLACK) {
        const tip = e.posts[0];
        return { etype: T.VOLTMETER, flags: 0, posts: [tip, tip], params: [] };
      }
      if (e.type === T.BATTERY_DC) {
        // Params already use the VOLTAGE source layout [freq, peak, ...], so
        // this is a direct mapping and stays correct after in-place edits.
        return { etype: T.VOLTAGE, flags: e.flags, posts: e.posts, params: e.params };
      }
      return { etype: e.type, flags: e.flags, posts: e.posts, params: e.params };
    });
    nodeMapRef.current = computeNodeMap(raw);
    const eng = engineRef.current;
    if (!eng) return;
    const err = eng.loadElements(raw);
    setStopMsg(err);
    const ch = scopeChannels(elms, scopeIdsRef.current);
    avoVoltChRef.current = ch.voltCh;
    avoAmmChRef.current = ch.ammCh;
    lastScopeKeyRef.current = ch.idxs.join(',');
    eng.setScope(ch.idxs);
  }, []);

  /** Recompute the engine scope list (Z-DSO channels + private Z-AVO channels). */
  const syncScope = useCallback(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const ch = scopeChannels(elementsRef.current, scopeIdsRef.current);
    avoVoltChRef.current = ch.voltCh;
    avoAmmChRef.current = ch.ammCh;
    const key = ch.idxs.join(',');
    // Element drags only move posts; do not reset the scope ring buffers when
    // the channel layout is unchanged.
    if (key === lastScopeKeyRef.current) return;
    lastScopeKeyRef.current = key;
    eng.setScope(ch.idxs);
  }, []);

  const commit = useCallback((next: CircuitElm[], pushUndo = true) => {
    if (pushUndo) {
      undoRef.current.push(cloneElements(elementsRef.current));
      if (undoRef.current.length > 100) undoRef.current.shift();
    }
    // any new edit invalidates the redo branch
    redoRef.current = [];
    const cleaned = splitWiresAtPosts(next);
    setElements(cleaned);
    elementsRef.current = cleaned;
    applyToEngine(cleaned);
    localStorage.setItem('circuit-sim-elements', JSON.stringify(cleaned));
  }, [applyToEngine]);

  const loadPreset = useCallback((i: number) => {
    const elms = splitWiresAtPosts(
      PRESETS[i].build().map((r) => ({
        id: nextId++,
        type: r.etype,
        flags: r.flags,
        posts: r.posts,
        params: r.params,
      }))
    );
    undoRef.current = [];
    setScopeIds([]);
    scopeIdsRef.current = [];
    setElements(elms);
    elementsRef.current = elms;
    applyToEngine(elms);
    setSelectedIds([]);
    circuitNameRef.current = PRESETS[i].name;
    localStorage.setItem('circuit-sim-elements', JSON.stringify(elms));
    setStatusHint(`Loaded: ${PRESETS[i].name}`);
  }, [applyToEngine]);

  /** Center and scale a circuit so it is visible after loading a file. */
  const fitViewToElements = useCallback((elms: CircuitElm[]) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (!w || !h) return;
    if (elms.length === 0) {
      viewRef.current = { x: 0, y: 0, zoom: 1 };
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const e of elms) {
      for (const p of e.posts) {
        minX = Math.min(minX, p[0]);
        minY = Math.min(minY, p[1]);
        maxX = Math.max(maxX, p[0]);
        maxY = Math.max(maxY, p[1]);
      }
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return;
    const pad = 64;
    const bw = Math.max(maxX - minX, GRID * 4);
    const bh = Math.max(maxY - minY, GRID * 4);
    const zoom = Math.min(
      1.5,
      Math.max(0.4, Math.min((w - pad * 2) / bw, (h - pad * 2) / bh))
    );
    viewRef.current = {
      x: w / 2 - ((minX + maxX) / 2) * zoom,
      y: h / 2 - ((minY + maxY) / 2) * zoom,
      zoom,
    };
  }, []);

  const saveToFile = useCallback(() => {
    const elms = elementsRef.current;
    const name = circuitNameRef.current || 'circuit';
    const text = serializeCircuitFile(elms, {
      name,
      view: { ...viewRef.current },
      scopeIds: scopeIdsRef.current,
    });
    const fileName = circuitFileName(name);
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatusHint(`Saved ${elms.length} elements to ${fileName}`);
    toast({
      title: 'Circuit saved',
      description: `${elms.length} elements · ${fileName}`,
    });
  }, [toast]);

  const openFileDialog = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const loadFromFile = useCallback(async (file: File) => {
    try {
      if (file.size > 5 * 1024 * 1024) {
        throw new Error('File is too large (maximum 5 MB).');
      }
      const parsed = parseCircuitFile(await file.text());
      const cleaned = splitWiresAtPosts(parsed.elements);
      nextId = Math.max(0, ...cleaned.map((e) => e.id)) + 1;
      undoRef.current = [];
      const validIds = new Set(cleaned.map((e) => e.id));
      const scope = parsed.scopeIds.filter((id) => validIds.has(id));
      setScopeIds(scope);
      scopeIdsRef.current = scope;
      setSelectedIds([]);
      setToolMeta(null);
      setEditOpen(false);
      setElements(cleaned);
      elementsRef.current = cleaned;
      applyToEngine(cleaned);
      engineRef.current?.reset();
      setSimTime(0);
      setRunning(true);
      circuitNameRef.current = parsed.name;
      localStorage.setItem('circuit-sim-elements', JSON.stringify(cleaned));
      if (parsed.view) {
        viewRef.current = { ...parsed.view };
      } else {
        fitViewToElements(cleaned);
      }
      const extra = parsed.warnings.length > 0 ? ` · ${parsed.warnings.join(' ')}` : '';
      setStatusHint(`Loaded ${cleaned.length} elements from ${file.name}${extra}`);
      toast({
        title: 'Circuit loaded',
        description: `${cleaned.length} elements · ${file.name}${extra}`,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error while reading the file.';
      setStatusHint(`Open failed: ${message}`);
      toast({
        variant: 'destructive',
        title: 'Could not open file',
        description: message,
      });
    }
  }, [applyToEngine, fitViewToElements, toast]);

  const onFileInputChange = useCallback(async (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    ev.target.value = '';
    if (file) await loadFromFile(file);
  }, [loadFromFile]);

  const onFileDrop = useCallback(async (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    const file = ev.dataTransfer.files?.[0];
    if (file) await loadFromFile(file);
  }, [loadFromFile]);

  const onFileDragOver = useCallback((ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
  }, []);

  // ---- Z-DSO streaming + controls ----
  const streamZDso = useCallback((eng: CircuitEngine) => {
    const bridge = zBridgeRef.current;
    if (!bridge) return;
    const timeDiv = zTimeDivRef.current;
    const win = timeDiv * ZDSO_WINDOW_DIVS;
    const n = ZDSO_SAMPLES;
    const now = performance.now();

    // Test signal temporarily owns CH1 so the instrument can be verified
    // without wiring a scope probe on the circuit.
    if (now < zTestUntilRef.current) {
      zTestActiveRef.current = true;
      const tEnd = now / 1000;
      const tStart = tEnd - win;
      const sine = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        sine[i] = Math.sin(2 * Math.PI * 1000 * (tStart + (win * i) / (n - 1)));
      }
      bridge.send('setChannelData', [
        0, sine,
        { sampleRate: (n - 1) / win, tStart, align: 'none' },
      ]);
      return;
    }
    if (zTestActiveRef.current) {
      zTestActiveRef.current = false;
      if (scopeIdsRef.current.length === 0) bridge.send('clearChannelData', [0]);
    }
    if (!runningRef.current || elementsRef.current.length === 0) return;

    const ids = scopeIdsRef.current;
    if (ids.length === 0) return;

    const tEnd = eng.time;
    const tStart = tEnd - win;
    const valueOffset: 1 | 2 = zSignalRef.current === 'current' ? 2 : 1;
    const scale = zSignalRef.current === 'current' ? 1000 : 1;
    const rate = (n - 1) / win;

    for (let ch = 0; ch < ids.length && ch < 4; ch++) {
      let samples = eng.readScope(ch, 8192);
      if (samples.length >= 8192 * 3) {
        // A large time/div may need more than 8192 samples of history.
        const coverage = samples[samples.length - 3] - samples[0];
        if (coverage < win * 1.05) samples = eng.readScope(ch, 32768);
      }
      const data = resampleScope(samples, tEnd, win, n, valueOffset, scale);
      if (data) {
        bridge.send('setChannelData', [
          ch, data,
          { sampleRate: rate, tStart, align: 'none' },
        ]);
      }
    }
  }, []);

  const openZDso = useCallback(() => {
    const bridge = zBridgeRef.current;
    if (!bridge) return;
    const win = bridge.open();
    if (!win) {
      toast({
        variant: 'destructive',
        title: 'Popup blocked',
        description: 'Allow popups for this site, then open the oscilloscope again.',
      });
    }
  }, [toast]);

  const setZDsoTimeDiv = useCallback((td: number) => {
    zTimeDivRef.current = td;
    setZTimeDiv(td);
    zBridgeRef.current?.send('setHorizontal', [
      { timeDiv: td, hOffset: 0, trigPos: 0.5 },
    ]);
  }, []);

  const zDsoCommand = useCallback((cmd: string, args: unknown[] = []) => {
    zBridgeRef.current?.send(cmd, args);
  }, []);

  const startZDsoTestSignal = useCallback(() => {
    zBridgeRef.current?.send('setChannel', [
      0,
      { enabled: true, voltsDiv: 1, offset: 0, coupling: 'DC', invert: false, probe: 1 },
    ]);
    setZDsoTimeDiv(200e-6);
    zTestUntilRef.current = performance.now() + 3000;
    toast({
      title: 'Test signal streaming',
      description: 'CH1 · 1 kHz sine · 2 Vpp for 3 seconds',
    });
  }, [setZDsoTimeDiv, toast]);

  const clearZDsoChannels = useCallback(() => {
    zTestUntilRef.current = 0;
    zTestActiveRef.current = false;
    zBridgeRef.current?.clearAll();
  }, []);

  // ---- Z-AVO streaming + controls ----
  const streamAvo = useCallback((eng: CircuitEngine) => {
    const bridge = avoBridgeRef.current;
    if (!bridge) return;

    // Paused: leave the meter on its internal demo until streaming is resumed.
    if (avoPausedRef.current) {
      if (
        avoStreamingRef.current ||
        avoAttachedRef.current.red !== null ||
        avoAttachedRef.current.black !== null
      ) {
        bridge.clearAll();
        avoStreamingRef.current = false;
        avoAttachedRef.current = { red: null, black: null };
        setAvoProbes({ red: null, black: null });
      }
      return;
    }

    const elms = elementsRef.current;
    const red = elms.find((e) => e.type === T.PROBE_RED) ?? null;
    const black = elms.find((e) => e.type === T.PROBE_BLACK) ?? null;

    // No probes → return the meter to its local demo source.
    if (!red || !black) {
      if (
        avoStreamingRef.current ||
        avoAttachedRef.current.red !== null ||
        avoAttachedRef.current.black !== null
      ) {
        bridge.clearAll();
        avoStreamingRef.current = false;
        avoAttachedRef.current = { red: null, black: null };
        setAvoProbes({ red: null, black: null });
      }
      return;
    }

    const redTip = red.posts[0];
    const blackTip = black.posts[0];
    const redNode = `${redTip[0]},${redTip[1]}`;
    const blackNode = `${blackTip[0]},${blackTip[1]}`;

    // Attach only when a tip moves to a new node.
    if (avoAttachedRef.current.red !== redNode) {
      bridge.send('detachProbe', ['red']);
      bridge.send('attachProbe', ['red', redNode]);
    }
    if (avoAttachedRef.current.black !== blackNode) {
      bridge.send('detachProbe', ['black']);
      bridge.send('attachProbe', ['black', blackNode]);
    }
    avoAttachedRef.current = { red: redNode, black: blackNode };
    avoStreamingRef.current = true;
    setAvoProbes((prev) =>
      prev.red === redNode && prev.black === blackNode ? prev : { red: redNode, black: blackNode }
    );

    const mode = avoModeRef.current;
    if (mode === 'OFF') return;

    const probes = { red: redNode, black: blackNode };
    const send = (payload: AvoMeasurement) => bridge.setMeasurement({ ...payload, probes });
    const sendEmpty = (type: AvoMeasurement['type']) => send({ type });

    const redConnected = probeTipConnected(redTip, elms, red.id);
    const blackConnected = probeTipConnected(blackTip, elms, black.id);

    if (mode === 'DCV' || mode === 'ACV' || mode === 'HZ' || mode === 'DUTY') {
      const emptyType: AvoMeasurement['type'] =
        mode === 'HZ' ? 'frequency' : mode === 'DUTY' ? 'duty' : 'voltage';
      if (!redConnected || !blackConnected) { sendEmpty(emptyType); return; }
      const ch = avoVoltChRef.current;
      if (ch < 0) { sendEmpty(emptyType); return; }
      const maxCount =
        mode === 'HZ' || mode === 'DUTY' ? AVO_FREQ_SAMPLE_COUNT : AVO_SAMPLE_COUNT;
      const wave = avoWaveFromSamples(eng.readScope(ch, maxCount), 1, maxCount);
      if (!wave || !(wave.sampleRate > 0)) { sendEmpty(emptyType); return; }
      if (mode === 'HZ') {
        // The meter's own zero-crossing counter over-estimates on short
        // windows, so send the pre-computed scalar (the meter accepts a
        // scalar for any mode) alongside the waveform.
        const f = estimateFrequency(wave.data, wave.sampleRate, wave.tStart);
        send({
          type: 'frequency',
          samples: wave.data,
          sampleRate: wave.sampleRate,
          tStart: wave.tStart,
          ...(f !== null && Number.isFinite(f) && f > 0 ? { scalar: f } : {}),
        });
        return;
      }
      send({
        type: emptyType,
        samples: wave.data,
        sampleRate: wave.sampleRate,
        tStart: wave.tStart,
      });
      return;
    }

    if (mode === 'DCA' || mode === 'ACA') {
      if (!redConnected || !blackConnected) { sendEmpty('current'); return; }
      const ch = avoAmmChRef.current;
      if (ch < 0) { sendEmpty('current'); return; }
      const wave = avoWaveFromSamples(eng.readScope(ch, AVO_SAMPLE_COUNT), 2, AVO_SAMPLE_COUNT);
      if (!wave || !(wave.sampleRate > 0)) { sendEmpty('current'); return; }
      send({
        type: 'current',
        samples: wave.data,
        sampleRate: wave.sampleRate,
        tStart: wave.tStart,
      });
      return;
    }

    // OHM / CONT / CAP / DIODE need a component sitting between the probe nodes.
    const emptyType: AvoMeasurement['type'] =
      mode === 'CAP' ? 'capacitance' : mode === 'DIODE' ? 'diode' : 'resistance';
    if (!redConnected || !blackConnected) { sendEmpty(emptyType); return; }
    const redIdx = elms.findIndex((e) => e.id === red.id);
    if (redIdx < 0) { sendEmpty(emptyType); return; }

    if (mode === 'OHM' || mode === 'CONT') {
      const r = resistanceBetween(elms, nodeMapRef.current.elmNodes, redIdx);
      if (r === null) sendEmpty('resistance');
      else send({ type: 'resistance', scalar: r });
      return;
    }
    if (mode === 'CAP') {
      const c = capacitanceBetween(elms, nodeMapRef.current.elmNodes, redIdx);
      if (c === null) sendEmpty('capacitance');
      else send({ type: 'capacitance', scalar: c });
      return;
    }
    if (mode === 'DIODE') {
      const d = diodeBetween(elms, nodeMapRef.current.elmNodes, redIdx);
      if (!d) { sendEmpty('diode'); return; }
      const vf = diodeForwardVoltage(d.elm, frameRef.current.outs[d.index * 8] ?? 0);
      send({ type: 'diode', scalar: vf, meta: { Vf: vf } });
    }
  }, []);

  const openAvo = useCallback(() => {
    const bridge = avoBridgeRef.current;
    if (!bridge) return;
    const win = bridge.open();
    if (!win) {
      toast({
        variant: 'destructive',
        title: 'Popup blocked',
        description: 'Allow popups for this site, then open the multimeter again.',
      });
    }
  }, [toast]);

  const avoCommand = useCallback((cmd: string, args: unknown[] = []) => {
    avoBridgeRef.current?.send(cmd, args);
  }, []);

  const applyAvoMode = useCallback((mode: AvoMode) => {
    avoModeRef.current = mode;
    setAvoMode(mode);
    avoBridgeRef.current?.send('setMode', [mode]);
  }, []);

  const toggleAvoStreaming = useCallback(() => {
    const next = !avoPausedRef.current;
    avoPausedRef.current = next;
    setAvoPaused(next);
    avoAttachedRef.current = { red: null, black: null };
    if (next) {
      avoBridgeRef.current?.clearAll();
      avoStreamingRef.current = false;
      setAvoProbes({ red: null, black: null });
      setStatusHint('Z-AVO streaming paused — meter is showing its internal demo');
    } else {
      setStatusHint('Z-AVO streaming resumed');
    }
  }, []);

  const armProbe = useCallback((color: 'red' | 'black') => {
    const type = color === 'red' ? T.PROBE_RED : T.PROBE_BLACK;
    const existing = elementsRef.current.find((e) => e.type === type);
    if (existing) {
      setSelectedIds([existing.id]);
      setToolMeta(null);
      setStatusHint(
        `${color === 'red' ? 'Red' : 'Black'} probe is already placed — drag its handle onto a post or wire.`
      );
      return;
    }
    const meta = ELEMENT_META.find((m) => m.type === type);
    if (!meta) return;
    setToolMeta(meta);
    setSelectedIds([]);
    setStatusHint(`Placing ${meta.name} — click a post or wire to attach the tip (Esc cancels)`);
  }, []);

  // ---- main loop ----
  useEffect(() => {
    if (!ready) return;
    let raf = 0;
    let lastPerf = performance.now();
    const loop = () => {
      const eng = engineRef.current;
      const now = performance.now();
      const dtReal = Math.min(now - lastPerf, 100);
      lastPerf = now;
      if (eng && runningRef.current && elementsRef.current.length > 0) {
        const dtMax = 5e-6;
        eng.setDtMax(dtMax);
        const steps = Math.max(1, Math.round(55 * speedRef.current * (dtReal / 16.7)));
        const done = eng.run(steps, 12);
        if (done === 0) {
          const err = eng.getError();
          if (err) {
            setStopMsg(err);
            setRunning(false);
          }
        } else {
          setStopMsg(null);
        }
        frameRef.current.outs = eng.elemOutputs();
        frameRef.current.flags = eng.elemFlags();
        frameRef.current.nv = eng.nodeVoltages();
        // dot animation is decoupled from sim steps: ~1px/frame at 1× so the
        // motion stays smooth and readable regardless of the Speed slider.
        // When the user turns the flow animation off, the phase is frozen so
        // no work is spent and the dots resume exactly where they stopped.
        if (flowAnimRef.current) {
          dotPhaseRef.current += (dtReal / 16.7) * animSpeedRef.current;
        }
        wireCurRef.current = computeWireCurrents(elementsRef.current, frameRef.current.outs);
        setSimTime(eng.time);
        if (eng.needsAnalyze()) {
          eng.analyze();
        }
      }
      if (eng && now - zLastStreamRef.current >= ZDSO_FRAME_MS) {
        zLastStreamRef.current = now;
        streamZDso(eng);
      }
      if (eng && now - avoLastStreamRef.current >= AVO_FRAME_MS) {
        avoLastStreamRef.current = now;
        streamAvo(eng);
      }
      draw();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [ready, streamZDso, streamAvo]);

  // ---- drawing ----
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const dpr = window.devicePixelRatio || 1;
    const w = wrap.clientWidth;
    const h = wrap.clientHeight;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const view = viewRef.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // pick up the active theme palette for this frame
    setCanvasTheme(themeRef.current);
    const pal = canvasPalette();
    ctx.fillStyle = pal.background;
    ctx.fillRect(0, 0, w, h);
    ctx.translate(view.x, view.y);
    ctx.scale(view.zoom, view.zoom);

    // grid dots
    const gx0 = Math.floor((-view.x / view.zoom) / GRID) * GRID;
    const gy0 = Math.floor((-view.y / view.zoom) / GRID) * GRID;
    const gx1 = gx0 + w / view.zoom + GRID * 2;
    const gy1 = gy0 + h / view.zoom + GRID * 2;
    ctx.fillStyle = pal.grid;
    for (let gx = gx0; gx < gx1; gx += GRID) {
      for (let gy = gy0; gy < gy1; gy += GRID) {
        ctx.fillRect(gx - 1, gy - 1, 2, 2);
      }
    }

    const elms = elementsRef.current;
    const fr = frameRef.current;
    const tool = toolRef.current;

    // voltage color for wires (via JS-side node map)
    const nm = nodeMapRef.current;
    const wireColor = (elmIdx: number): string => {
      const nodes = nm.elmNodes[elmIdx];
      const v = nodes && nodes.length > 0 && nodes[0] < fr.nv.length ? fr.nv[nodes[0]] : 0;
      const mag = Math.min(Math.abs(v) / 5, 1);
      if (v >= 0) return withAlpha(pal.wirePositive, 0.55 + mag * 0.45);
      return withAlpha(pal.wireNegative, 0.55 + mag * 0.45);
    };

    // draw elements (pass 1); current dots collected and overlaid afterwards (pass 2)
    const dotSegs: { a: [number, number]; b: [number, number]; cur: number }[] = [];
    elms.forEach((e, idx) => {
      const meta = metaByType(e.type, e.flags);
      const stFlags = fr.flags[idx * 2] ?? 0;
      const out = [
        fr.outs[idx * 8] ?? 0, fr.outs[idx * 8 + 1] ?? 0, fr.outs[idx * 8 + 2] ?? 0,
        fr.outs[idx * 8 + 3] ?? 0, fr.outs[idx * 8 + 4] ?? 0, fr.outs[idx * 8 + 5] ?? 0,
        fr.outs[idx * 8 + 6] ?? 0, 0,
      ];
      const isWire = e.type === T.WIRE;
      const common = {
        selected: selSetRef.current.has(e.id),
        hover: hoverRef.current === e.id,
        stateFlags: e.type === T.LAMP ? out[6] : stFlags,
        vd: out[0],
        current: out[3],
        showValues: showValuesRef.current,
        nodeV: 0,
      };
      if (isWire) {
        ctx.save();
        ctx.strokeStyle = wireColor(idx);
        ctx.lineWidth = selSetRef.current.has(e.id) ? 3 : 2.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(e.posts[0][0], e.posts[0][1]);
        ctx.lineTo(e.posts[1][0], e.posts[1][1]);
        ctx.stroke();
        ctx.restore();
        const wCur = wireCurRef.current.get(e.id) ?? 0;
        dotSegs.push({ a: e.posts[0], b: e.posts[1], cur: wCur });
      } else if (meta) {
        drawElement(ctx, e.type, e.flags, e.posts, e.params, common);
        // collect dot segments: full body for 2-terminal, leads for multi-post
        if (e.posts.length === 2 && !([T.GROUND, T.RAIL, T.LOGIC_INPUT, T.CLOCK_INPUT, T.LOGIC_OUTPUT] as readonly number[]).includes(e.type)) {
          // Diodes always carry their reverse saturation current (Is); it is
          // physically real but visually meaningless. Hide anything at or below
          // the leakage floor so a reverse-biased diode shows no moving dots,
          // while forward current and Zener breakdown still animate.
          dotSegs.push({ a: e.posts[0], b: e.posts[1], cur: animatedCurrent(e.type, e.params, out[3]) });
        } else if (e.posts.length > 2) {
          // leads: post toward element centroid, ~40% of the way
          const cx = e.posts.reduce((s2, p) => s2 + p[0], 0) / e.posts.length;
          const cy = e.posts.reduce((s2, p) => s2 + p[1], 0) / e.posts.length;
          for (let k = 0; k < e.posts.length; k++) {
            const into = -(out[2 + k] ?? 0); // current INTO element at post k
            const p = e.posts[k];
            const bx = p[0] + (cx - p[0]) * 0.4;
            const by = p[1] + (cy - p[1]) * 0.4;
            dotSegs.push({ a: p, b: [bx, by], cur: into });
          }
        }
      }
    });

    // pass 2: all current dots on top of everything (below posts). The user
    // can hide the animated dots without affecting the simulation, wire
    // voltage colours, or value readouts.
    if (flowAnimRef.current) {
      for (const d of dotSegs) {
        drawCurrentDots(ctx, d.a, d.b, d.cur, dotPhaseRef.current);
      }
    }

    // pass 3: text labels — always rendered last so no component fill can cover
    // them. Collect first so live meter/probe readouts can be lifted above the
    // ordinary component-value labels.
    ctx.textBaseline = 'middle';
    const drawnLabels: { L: ElmLabel; x: number; y: number }[] = [];
    for (let idx = 0; idx < elms.length; idx++) {
      const e = elms[idx];
      const off = e.labelOff;
      const labels = elementLabels(
        e.type,
        e.flags,
        e.posts,
        e.params,
        showValuesRef.current,
        selSetRef.current.has(e.id),
        { vd: fr.outs[idx * 8] ?? 0, cur: fr.outs[idx * 8 + 3] ?? 0 }
      );
      for (const L of labels) {
        // value labels can be dragged clear of wires; structural labels stick
        const dx = L.movable === false || !off ? 0 : off[0];
        const dy = L.movable === false || !off ? 0 : off[1];
        drawnLabels.push({ L, x: L.x + dx, y: L.y + dy });
      }
    }
    // stable boolean sort puts every readout after the regular labels
    drawnLabels.sort(
      (a, b) => Number(a.L.kind === 'readout') - Number(b.L.kind === 'readout')
    );
    for (const { L, x, y } of drawnLabels) {
      ctx.font = L.font;
      ctx.textAlign = L.align;
      // live meter/probe readouts get a dark pill so they pop out over the
      // canvas and read as instruments rather than component values
      if (L.kind === 'readout') {
        const w = ctx.measureText(L.text).width;
        const h = fontSizeOf(L.font) + 8;
        const padX = 5;
        const left = L.align === 'left' ? x : L.align === 'right' ? x - w : x - w / 2;
        ctx.beginPath();
        ctx.roundRect(left - padX, y - h / 2, w + padX * 2, h, 5);
        ctx.fillStyle = pal.readoutPill;
        ctx.fill();
        ctx.strokeStyle = pal.readoutBorder;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.fillStyle = L.color;
      ctx.fillText(L.text, x, y);
    }

    // drag preview
    const drag = dragRef.current;
    if (drag && drag.kind === 'wire') {
      ctx.save();
      ctx.strokeStyle = pal.accent;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(drag.start[0], drag.start[1]);
      ctx.lineTo(drag.last[0], drag.last[1]);
      ctx.stroke();
      ctx.restore();
    }
    if (drag && drag.kind === 'place' && tool) {
      const posts = layoutPosts(tool, drag.start, drag.last);
      drawElement(ctx, tool.type, tool.defaults.flags ?? 0, posts, tool.defaults.params, {
        selected: true, hover: false, stateFlags: 0, vd: 0, current: 0, showValues: false, nodeV: 0,
      });
    }
    if (drag && drag.kind === 'select') {
      ctx.save();
      ctx.strokeStyle = pal.accent;
      ctx.fillStyle = pal.marqueeFill;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      const rx = Math.min(drag.start[0], drag.last[0]);
      const ry = Math.min(drag.start[1], drag.last[1]);
      const rw = Math.abs(drag.last[0] - drag.start[0]);
      const rh = Math.abs(drag.last[1] - drag.start[1]);
      ctx.fillRect(rx, ry, rw, rh);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.restore();
    }

    // posts
    ctx.fillStyle = pal.post;
    for (const e of elms) {
      for (const p of e.posts) {
        ctx.beginPath();
        ctx.arc(p[0], p[1], 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  // refs mirroring state for the animation loop
  const selectedIdsRef = useRef<number[]>([]);
  const selSetRef = useRef<Set<number>>(new Set());
  const toolRef = useRef<ElemMeta | null>(null);
  const showValuesRef = useRef(true);
  selectedIdsRef.current = selectedIds;
  selSetRef.current = new Set(selectedIds);
  toolRef.current = toolMeta;
  showValuesRef.current = showValues;

  // ---- coordinate helpers ----
  const toWorld = useCallback((mx: number, my: number): [number, number] => {
    const rect = canvasRef.current!.getBoundingClientRect();
    const view = viewRef.current;
    return [
      (mx - rect.left - view.x) / view.zoom,
      (my - rect.top - view.y) / view.zoom,
    ];
  }, []);

  const hitElement = useCallback((wx: number, wy: number): CircuitElm | null => {
    let best: CircuitElm | null = null;
    let bestD = 12 / viewRef.current.zoom;
    for (const e of elementsRef.current) {
      if (e.type === T.WIRE) {
        // distance to segment
        for (let k = 0; k < e.posts.length - 1; k++) {
          const d = distToSeg(wx, wy, e.posts[k], e.posts[k + 1]);
          if (d < bestD) { bestD = d; best = e; }
        }
      } else {
        for (const p of e.posts) {
          const d = Math.hypot(p[0] - wx, p[1] - wy);
          if (d < bestD) { bestD = d; best = e; }
        }
        if (isProbeType(e.type)) {
          // the probe handle sits above the tip; make the whole body grabbable
          const r = probeHandleRect(e.posts[0]);
          if (wx >= r.x - 2 && wx <= r.x + r.w + 2 && wy >= r.y - 2 && wy <= r.y + r.h + 2) {
            bestD = 0;
            best = e;
          }
          continue;
        }
        // body proximity for 2-terminal
        if (e.posts.length === 2) {
          const d = distToSeg(wx, wy, e.posts[0], e.posts[1]);
          if (d < bestD) { bestD = d; best = e; }
        } else {
          // multi-post (gates/chips/transistors): bounding-box body hit so the
          // symbol itself is grabbable, not just its posts
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (const p of e.posts) {
            x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]);
            y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]);
          }
          if (e.type === T.IC_DUMMY && e.posts.length >= 4) {
            // The IC body extends past the pin line; include it so the box is
            // grabbable, not only the four pins.
            const p0 = e.posts[0], p3 = e.posts[3];
            const vx = p3[0] - p0[0], vy = p3[1] - p0[1];
            const len = Math.hypot(vx, vy);
            if (len > 0) {
              const far = [p0[0] + (vy / len) * 64, p0[1] + (-vx / len) * 64];
              x0 = Math.min(x0, far[0]); x1 = Math.max(x1, far[0]);
              y0 = Math.min(y0, far[1]); y1 = Math.max(y1, far[1]);
            }
          }
          if (wx >= x0 - 6 && wx <= x1 + 6 && wy >= y0 - 6 && wy <= y1 + 6 && bestD > 6 / viewRef.current.zoom) {
            bestD = 0;
            best = e;
          }
        }
      }
    }
    return best;
  }, []);

  const hitPost = useCallback((wx: number, wy: number): { elm: CircuitElm; post: number } | null => {
    const tol = 8 / viewRef.current.zoom;
    for (const e of elementsRef.current) {
      for (let k = 0; k < e.posts.length; k++) {
        if (Math.hypot(e.posts[k][0] - wx, e.posts[k][1] - wy) < tol) return { elm: e, post: k };
      }
    }
    return null;
  }, []);

  /**
   * Hit-test the draggable value labels. Structural labels are skipped, and the
   * boxes are measured with the same font/alignment used by the render pass so
   * clicking exactly on the visible text grabs it.
   */
  const hitLabel = useCallback((wx: number, wy: number): CircuitElm | null => {
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return null;
    const elms = elementsRef.current;
    const fr = frameRef.current;
    const pad = 4 / viewRef.current.zoom;
    const test = (readoutPass: boolean): CircuitElm | null => {
      for (let idx = elms.length - 1; idx >= 0; idx--) {
        const e = elms[idx];
        const off = e.labelOff;
        const labels = elementLabels(
          e.type,
          e.flags,
          e.posts,
          e.params,
          showValuesRef.current,
          selSetRef.current.has(e.id),
          { vd: fr.outs[idx * 8] ?? 0, cur: fr.outs[idx * 8 + 3] ?? 0 }
        );
        for (const L of labels) {
          if (L.movable === false) continue;
          // readouts are rendered above regular labels, so they also win the
          // hit-test when both overlap
          if ((L.kind === 'readout') !== readoutPass) continue;
          const x = L.x + (off ? off[0] : 0);
          const y = L.y + (off ? off[1] : 0);
          ctx.font = L.font;
          const w = ctx.measureText(L.text).width;
          const h = fontSizeOf(L.font);
          const left = L.align === 'left' ? x : L.align === 'right' ? x - w : x - w / 2;
          const top = y - h / 2;
          if (wx >= left - pad && wx <= left + w + pad && wy >= top - pad && wy <= top + h + pad) {
            return e;
          }
        }
      }
      return null;
    };
    return test(true) ?? test(false);
  }, []);

  // ---- mouse handlers ----
  const onMouseDown = useCallback((ev: React.MouseEvent) => {
    if (!ready) return;
    // clicking the canvas should return keyboard focus to the document so
    // shortcuts keep working after using a toolbar button
    if (document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
    const [wx, wy] = toWorld(ev.clientX, ev.clientY);
    if (ev.button === 1 || ev.altKey) {
      dragRef.current = { kind: 'pan', start: [ev.clientX, ev.clientY], last: [ev.clientX, ev.clientY] };
      return;
    }
    if (ev.button !== 0) return;

    // tool placement
    if (toolMeta) {
      if (toolMeta.posts === 1) {
        let point: [number, number] = [snap(wx), snap(wy)];
        let snapped = false;
        const probe = isProbeType(toolMeta.type);
        if (probe) {
          const tol = Math.max(GRID * 0.6, 10 / viewRef.current.zoom);
          const near = nearestProbePoint(wx, wy, elementsRef.current, tol);
          if (near) {
            point = near;
            snapped = true;
          }
        }
        const elm = defaultElm(toolMeta, [point]);
        // a real meter has exactly one red and one black probe
        const others = probe
          ? elementsRef.current.filter((e) => e.type !== toolMeta.type)
          : elementsRef.current;
        commit([...others, elm]);
        if (toolMeta.type !== T.GROUND && toolMeta.type !== T.LOGIC_OUTPUT) {
          setSelectedIds([elm.id]);
        }
        if (probe) {
          setStatusHint(
            snapped
              ? `${toolMeta.name} connected — open Z-AVO and select a measurement mode`
              : `${toolMeta.name} placed but not connected — drop the tip on a post or wire`
          );
        }
        setToolMeta(null);
        return;
      }
      dragRef.current = { kind: 'place', start: [snap(wx), snap(wy)], last: [snap(wx), snap(wy)] };
      return;
    }

    // draggable value label: grabbed before posts/elements so text sitting over
    // a wire or another symbol can always be moved out of the way
    const lbl = hitLabel(wx, wy);
    if (lbl) {
      if (!ev.shiftKey && !ev.ctrlKey && !ev.metaKey) setSelectedIds([lbl.id]);
      dragRef.current = {
        kind: 'label',
        start: [wx, wy],
        last: [wx, wy],
        elmId: lbl.id,
        origLabelOff: lbl.labelOff ? [lbl.labelOff[0], lbl.labelOff[1]] : [0, 0],
        before: cloneElements(elementsRef.current),
        moved: false,
      };
      return;
    }

    // post grab (move single post)
    const hp = hitPost(wx, wy);
    if (hp && hp.elm.type !== T.GROUND) {
      setSelectedIds([hp.elm.id]);
      dragRef.current = {
        kind: 'post',
        start: [wx, wy],
        last: [wx, wy],
        elmId: hp.elm.id,
        postId: hp.post,
        origs: { [hp.elm.id]: hp.elm.posts.map((p) => [...p] as [number, number]) },
      };
      return;
    }

    const hit = hitElement(wx, wy);
    if (hit) {
      // shift/ctrl-click toggles membership in the multi-selection
      if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
        const has = selSetRef.current.has(hit.id);
        setSelectedIds(
          has ? selectedIdsRef.current.filter((id) => id !== hit.id) : [...selectedIdsRef.current, hit.id]
        );
        return;
      }
      if (!selSetRef.current.has(hit.id)) setSelectedIds([hit.id]);
      const activeSel = selSetRef.current.has(hit.id) ? selectedIdsRef.current : [hit.id];
      // probes drag by their tip so the snap logic below keeps them connected
      if (isProbeType(hit.type)) {
        dragRef.current = {
          kind: 'post',
          start: [wx, wy],
          last: [wx, wy],
          elmId: hit.id,
          postId: 0,
          origs: { [hit.id]: hit.posts.map((p) => [...p] as [number, number]) },
        };
        return;
      }
      // interactive toggle on click
      if (hit.type === T.SWITCH || hit.type === T.LOGIC_INPUT) {
        const next = elementsRef.current.map((e) =>
          e.id === hit.id ? { ...e, flags: e.flags ^ F_CLOSED } : e
        );
        commit(next, false);
        return;
      }
      // drag moves the whole active selection
      const origs: Record<number, [number, number][]> = {};
      for (const id of activeSel) {
        const elm = elementsRef.current.find((e) => e.id === id);
        if (elm) origs[id] = elm.posts.map((p) => [...p] as [number, number]);
      }
      dragRef.current = {
        kind: 'move',
        start: [wx, wy],
        last: [wx, wy],
        elmIds: activeSel,
        origs,
      };
      return;
    }

    // empty canvas: rubber-band select (shift adds to the existing selection)
    dragRef.current = {
      kind: 'select',
      start: [wx, wy],
      last: [wx, wy],
      baseSel: ev.shiftKey ? [...selectedIdsRef.current] : [],
    };
    if (!ev.shiftKey) setSelectedIds([]);
  }, [ready, toolMeta, toWorld, hitLabel, hitPost, hitElement, commit]);

  const onMouseMove = useCallback((ev: React.MouseEvent) => {
    const [wx, wy] = toWorld(ev.clientX, ev.clientY);
    const drag = dragRef.current;
    if (drag) {
      if (drag.kind === 'pan') {
        const view = viewRef.current;
        view.x += ev.clientX - drag.last[0];
        view.y += ev.clientY - drag.last[1];
        drag.last = [ev.clientX, ev.clientY];
        return;
      }
      if (drag.kind === 'wire' || drag.kind === 'place') {
        drag.last = [snap(wx), snap(wy)];
        return;
      }
      if (drag.kind === 'select') {
        drag.last = [wx, wy];
        return;
      }
      if (drag.kind === 'label') {
        drag.last = [wx, wy];
        const dx = wx - drag.start[0];
        const dy = wy - drag.start[1];
        if (!drag.moved && Math.hypot(dx, dy) < 1) return;
        drag.moved = true;
        const off: [number, number] = [
          (drag.origLabelOff?.[0] ?? 0) + dx,
          (drag.origLabelOff?.[1] ?? 0) + dy,
        ];
        const next = elementsRef.current.map((e) =>
          e.id === drag.elmId ? { ...e, labelOff: off } : e
        );
        elementsRef.current = next;
        setElements(next);
        return;
      }
      if (drag.kind === 'move' || drag.kind === 'post') {
        drag.last = [wx, wy];
        const dx = snap(wx - drag.start[0]);
        const dy = snap(wy - drag.start[1]);
        const ids = drag.kind === 'move' ? drag.elmIds! : [drag.elmId!];
        const next = elementsRef.current.map((e) => {
          if (!ids.includes(e.id)) return e;
          if (drag.kind === 'move') {
            return { ...e, posts: drag.origs![e.id].map((p) => [p[0] + dx, p[1] + dy] as [number, number]) };
          }
          let target: [number, number] = [snap(wx), snap(wy)];
          if (isProbeType(e.type)) {
            const tol = Math.max(GRID * 0.6, 10 / viewRef.current.zoom);
            const near = nearestProbePoint(wx, wy, elementsRef.current, tol, e.id);
            if (near) target = near;
          }
          const posts = e.posts.map((p, k) =>
            k === drag.postId ? target : p
          );
          return { ...e, posts };
        });
        elementsRef.current = next;
        setElements(next);
        return;
      }
    }
    // hover
    const labelHit = !toolMeta ? hitLabel(wx, wy) : null;
    if (canvasRef.current && !toolMeta) {
      canvasRef.current.style.cursor = labelHit ? 'move' : '';
    }
    const hit = hitElement(wx, wy);
    hoverRef.current = hit ? hit.id : null;
    if (labelHit && !dragRef.current) {
      const meta = metaByType(labelHit.type, labelHit.flags);
      setStatusHint(
        `${meta?.name ?? 'Element'} value label — drag to reposition, double-click to reset`
      );
    } else if (hit && !toolMeta) {
      const meta = metaByType(hit.type, hit.flags);
      const idx = elementsRef.current.findIndex((e) => e.id === hit.id);
      const fr = frameRef.current;
      const vd = fr.outs[idx * 8] ?? 0;
      const cur = fr.outs[idx * 8 + 3] ?? 0;
      setStatusHint(`${meta?.name ?? 'Element'} — V: ${fmtValue(vd, 'V')}, I: ${fmtValue(cur, 'A')} (double-click to edit)`);
    } else if (!toolMeta && !dragRef.current) {
      setStatusHint('Drag on empty canvas to select. Drag from a post to wire.');
    }
  }, [toWorld, hitLabel, hitElement, toolMeta]);

  const onMouseUp = useCallback(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    if (drag.kind === 'wire') {
      if (Math.hypot(drag.last[0] - drag.start[0], drag.last[1] - drag.start[1]) >= GRID) {
        const wire = defaultElm(ELEMENT_META.find((m) => m.type === T.WIRE)!, [drag.start, drag.last]);
        commit([...elementsRef.current, wire]);
      }
    } else if (drag.kind === 'place' && toolRef.current) {
      const meta = toolRef.current;
      let posts = layoutPosts(meta, drag.start, drag.last);
      // Falstad behaviour: a click with (almost) no drag still places the
      // component at its default size instead of a zero-length degenerate
      if (meta.posts === 2) {
        const [p0, p1] = posts;
        if (Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 1) {
          posts = [p0, [p0[0] + GRID * 2, p0[1]]];
        }
      }
      const elm = defaultElm(meta, posts);
      commit([...elementsRef.current, elm]);
      setSelectedIds([elm.id]);
      setToolMeta(null);
    } else if (drag.kind === 'label') {
      if (drag.moved) {
        if (drag.before) {
          undoRef.current.push(drag.before);
          if (undoRef.current.length > 100) undoRef.current.shift();
        }
        commit(elementsRef.current, false);
      }
    } else if (drag.kind === 'select') {
      const tiny = Math.hypot(drag.last[0] - drag.start[0], drag.last[1] - drag.start[1]) < 3;
      const base = drag.baseSel ?? [];
      if (tiny) {
        // plain click on empty space: keep base selection (shift) or clear
        setSelectedIds(base);
      } else {
        const r = {
          x0: Math.min(drag.start[0], drag.last[0]),
          y0: Math.min(drag.start[1], drag.last[1]),
          x1: Math.max(drag.start[0], drag.last[0]),
          y1: Math.max(drag.start[1], drag.last[1]),
        };
        const found: number[] = [];
        for (const e of elementsRef.current) {
          if (elementInRect(e, r)) found.push(e.id);
        }
        setSelectedIds(Array.from(new Set([...base, ...found])));
      }
    } else if (drag.kind === 'move' || drag.kind === 'post') {
      commit(elementsRef.current, false);
      const movedId = drag.kind === 'post' ? drag.elmId : drag.elmIds?.[0];
      const moved = elementsRef.current.find((e) => e.id === movedId);
      if (moved && isProbeType(moved.type)) {
        const name = metaByType(moved.type)?.name ?? 'Probe';
        const connected = probeTipConnected(moved.posts[0], elementsRef.current, moved.id);
        setStatusHint(
          connected
            ? `${name} connected — open Z-AVO to read the measurement`
            : `${name} not connected — drop the tip on a post or wire`
        );
      }
    }
  }, [commit]);

  const onDoubleClick = useCallback((ev: React.MouseEvent) => {
    const [wx, wy] = toWorld(ev.clientX, ev.clientY);
    const lbl = hitLabel(wx, wy);
    if (lbl && lbl.labelOff) {
      const next = elementsRef.current.map((e) =>
        e.id === lbl.id ? { ...e, labelOff: undefined } : e
      );
      commit(next);
      setStatusHint('Label position reset');
      return;
    }
    const sel = lbl ?? elementsRef.current.find((e) => e.id === selectedIdsRef.current[0]);
    if (sel && metaByType(sel.type, sel.flags)?.edits) {
      setSelectedIds([sel.id]);
      setEditOpen(true);
    }
  }, [toWorld, hitLabel, commit]);

  const onWheel = useCallback((ev: React.WheelEvent) => {
    ev.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = ev.clientX - rect.left;
    const my = ev.clientY - rect.top;
    const view = viewRef.current;
    const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12;
    const newZoom = Math.min(3, Math.max(0.4, view.zoom * factor));
    view.x = mx - ((mx - view.x) * newZoom) / view.zoom;
    view.y = my - ((my - view.y) * newZoom) / view.zoom;
    view.zoom = newZoom;
  }, []);

  // ---- editing helpers (undo/redo, rotate, duplicate, fit) ----
  const restoreSnapshot = useCallback((elms: CircuitElm[]) => {
    const copy = cloneElements(elms);
    setElements(copy);
    elementsRef.current = copy;
    applyToEngine(copy);
    localStorage.setItem('circuit-sim-elements', JSON.stringify(copy));
  }, [applyToEngine]);

  const doUndo = useCallback(() => {
    const prev = undoRef.current.pop();
    if (!prev) {
      setStatusHint('Nothing left to undo');
      return;
    }
    redoRef.current.push(cloneElements(elementsRef.current));
    if (redoRef.current.length > 100) redoRef.current.shift();
    restoreSnapshot(prev);
    setSelectedIds([]);
    setStatusHint('Undo');
  }, [restoreSnapshot]);

  const doRedo = useCallback(() => {
    const next = redoRef.current.pop();
    if (!next) {
      setStatusHint('Nothing to redo');
      return;
    }
    undoRef.current.push(cloneElements(elementsRef.current));
    if (undoRef.current.length > 100) undoRef.current.shift();
    restoreSnapshot(next);
    setSelectedIds([]);
    setStatusHint('Redo');
  }, [restoreSnapshot]);

  const fitCircuitView = useCallback(() => {
    const n = elementsRef.current.length;
    fitViewToElements(elementsRef.current);
    setStatusHint(n > 0 ? `Zoomed to fit ${n} element(s) (F)` : 'Nothing to fit yet');
  }, [fitViewToElements]);

  const rotateSelection = useCallback(() => {
    const ids = new Set(selectedIdsRef.current);
    if (ids.size === 0) {
      setStatusHint('Select an element first, then press R to rotate it.');
      return;
    }
    const next = elementsRef.current.map((e) => {
      if (!ids.has(e.id) || e.posts.length < 2) return e;
      // rotate 90° clockwise around the element's first post (keeps it anchored)
      const [ax, ay] = e.posts[0];
      return {
        ...e,
        posts: e.posts.map((p) => [
          snap(ax - (p[1] - ay)),
          snap(ay + (p[0] - ax)),
        ] as [number, number]),
      };
    });
    commit(next);
    setStatusHint(`Rotated ${ids.size} element(s) 90° (R)`);
  }, [commit]);

  const duplicateSelection = useCallback(() => {
    const ids = new Set(selectedIdsRef.current);
    if (ids.size === 0) {
      setStatusHint('Select something first, then press Ctrl+D to duplicate it.');
      return;
    }
    const clones = elementsRef.current
      .filter((e) => ids.has(e.id))
      .map((e) => ({
        ...e,
        id: nextId++,
        posts: e.posts.map((p) => [p[0] + GRID * 2, p[1] + GRID * 2] as [number, number]),
        params: [...e.params],
      }));
    commit([...elementsRef.current, ...clones]);
    setSelectedIds(clones.map((c) => c.id));
    setStatusHint(`Duplicated ${clones.length} element(s) — drag to reposition (Ctrl+D)`);
  }, [commit]);

  const pickComponent = useCallback((meta: ElemMeta) => {
    setToolMeta(meta);
    setEditOpen(false);
    setPaletteOpen(false);
    setStatusHint(`Placing ${meta.name} — click the canvas to place it, drag to size it (Esc cancels)`);
  }, []);

  const toggleSidebar = useCallback(() => setSidebarOpen((open) => !open), []);

  useEffect(() => {
    try {
      localStorage.setItem('circuit-sim-sidebar', sidebarOpen ? '1' : '0');
    } catch {
      /* storage unavailable — sidebar preference simply won't persist */
    }
  }, [sidebarOpen]);

  useEffect(() => {
    try {
      localStorage.setItem('circuit-sim-flow-anim', flowAnim ? '1' : '0');
    } catch {
      /* storage unavailable — flow animation preference won't persist */
    }
  }, [flowAnim]);

  // ---- keyboard ----
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      const target = ev.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      // dialogs own the keyboard while they are open
      if (paletteOpen || shortcutsOpen || editOpen) return;
      const key = ev.key;
      // let focused buttons/links handle their own Enter/Space activation
      if ((tag === 'BUTTON' || tag === 'A') && (key === 'Enter' || key === ' ')) return;
      const mod = ev.ctrlKey || ev.metaKey;

      if (key === 'Delete' || key === 'Backspace') {
        const sel = selectedIdsRef.current;
        if (sel.length > 0) {
          if (key === 'Backspace') ev.preventDefault();
          const s = new Set(sel);
          commit(elementsRef.current.filter((e) => !s.has(e.id)));
          setSelectedIds([]);
        }
      } else if (mod && (key === 'a' || key === 'A')) {
        ev.preventDefault();
        setSelectedIds(elementsRef.current.map((e) => e.id));
      } else if (mod && ev.shiftKey && (key === 'z' || key === 'Z')) {
        ev.preventDefault();
        doRedo();
      } else if (mod && (key === 'z' || key === 'Z')) {
        ev.preventDefault();
        doUndo();
      } else if (mod && (key === 'y' || key === 'Y')) {
        ev.preventDefault();
        doRedo();
      } else if (mod && (key === 'd' || key === 'D')) {
        ev.preventDefault();
        duplicateSelection();
      } else if (mod && (key === 's' || key === 'S')) {
        ev.preventDefault();
        saveToFile();
      } else if (mod && (key === 'o' || key === 'O')) {
        ev.preventDefault();
        openFileDialog();
      } else if (key === ' ') {
        ev.preventDefault();
        setRunning((r) => !r);
      } else if (!mod && !ev.altKey && (key === 'p' || key === 'P')) {
        ev.preventDefault();
        setPaletteOpen(true);
      } else if (!mod && !ev.altKey && key === '[') {
        ev.preventDefault();
        toggleSidebar();
      } else if (key === '?' || key === 'F1') {
        ev.preventDefault();
        setShortcutsOpen(true);
      } else if (!mod && !ev.altKey && (key === 'f' || key === 'F')) {
        fitCircuitView();
      } else if (!mod && !ev.altKey && (key === 'r' || key === 'R')) {
        rotateSelection();
      } else if (key === 'Enter') {
        const sel = selectedIdsRef.current;
        if (sel.length === 1) {
          const elm = elementsRef.current.find((e) => e.id === sel[0]);
          if (elm && metaByType(elm.type, elm.flags)?.edits?.length) {
            ev.preventDefault();
            setEditOpen(true);
          }
        }
      } else if (key === 'Escape') {
        setToolMeta(null);
        setSelectedIds([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    commit, saveToFile, openFileDialog, doUndo, doRedo, duplicateSelection,
    rotateSelection, fitCircuitView, paletteOpen, shortcutsOpen, editOpen, toggleSidebar,
  ]);

  // ---- scope wiring ----
  useEffect(() => {
    syncScope();
  }, [scopeIds, elements, syncScope]);

  const addToScope = useCallback((id: number) => {
    setScopeIds((prev) => (prev.includes(id) ? prev : [...prev, id].slice(-4)));
  }, []);

  const removeFromScope = useCallback((id: number) => {
    setScopeIds((prev) => prev.filter((x) => x !== id));
  }, []);

  const selectedElm = useMemo(
    () => (selectedIds.length === 1 ? elements.find((e) => e.id === selectedIds[0]) ?? null : null),
    [elements, selectedIds]
  );

  const avoProbeEls = useMemo(() => {
    const red = elements.find((e) => e.type === T.PROBE_RED) ?? null;
    const black = elements.find((e) => e.type === T.PROBE_BLACK) ?? null;
    return { red, black };
  }, [elements]);

  const avoStatus = useMemo(() => {
    const red = avoProbeEls.red
      ? probeTipConnected(avoProbeEls.red.posts[0], elements, avoProbeEls.red.id)
      : false;
    const black = avoProbeEls.black
      ? probeTipConnected(avoProbeEls.black.posts[0], elements, avoProbeEls.black.id)
      : false;
    return { red, black };
  }, [avoProbeEls, elements]);

  const avoDisplay = avoReading?.display?.trim() || '----';

  const doReset = useCallback(() => {
    engineRef.current?.reset();
    setSimTime(0);
    setStopMsg(null);
  }, []);

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* toolbar */}
      <header className="flex flex-wrap items-center gap-2 border-b border-border bg-card px-3 py-2">
        <div className="mr-2 flex items-center gap-2">
          <ZapIcon />
          <span className="text-sm font-semibold tracking-tight">CircuitSim <span className="text-muted-foreground">Rust/WASM</span></span>
        </div>
        <select
          className="h-8 rounded-md border border-border bg-muted px-2 text-xs"
          onChange={(e) => {
            if (e.target.value === '') return;
            loadPreset(Number(e.target.value));
            e.target.value = '';
          }}
          defaultValue=""
        >
          <option value="">Load preset…</option>
          {PRESETS.map((p, i) => (
            <option key={p.name} value={i}>{p.name}</option>
          ))}
        </select>
        <Button
          size="sm"
          variant="outline"
          onClick={saveToFile}
          className="h-8 gap-1.5"
          title="Save circuit as a .circuit.json file (Ctrl+S)"
        >
          <Save size={14} /> Save file
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={openFileDialog}
          className="h-8 gap-1.5"
          title="Open a .circuit.json file (Ctrl+O)"
        >
          <FolderOpen size={14} /> Open file
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setPaletteOpen(true)}
          className="h-8 gap-1.5 border-brand/50 text-brand hover:bg-brand/10 hover:text-brand"
          title="Quick component search (P)"
        >
          <Search size={14} /> Add
          <kbd className="ml-0.5 rounded border border-brand/40 px-1 font-mono text-[9px] opacity-80">P</kbd>
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onClick={(ev) => { ev.currentTarget.value = ''; }}
          onChange={onFileInputChange}
        />
        <Button size="sm" variant={running ? 'secondary' : 'default'} onClick={() => setRunning((r) => !r)} className="h-8 gap-1.5">
          {running ? <Pause size={14} /> : <Play size={14} />}
          {running ? 'Pause' : 'Run'}
        </Button>
        <Button size="sm" variant="outline" onClick={doReset} className="h-8 gap-1.5">
          <RotateCcw size={14} /> Reset
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              title="Colour theme — dark, light or pink"
              aria-label="Colour theme"
            >
              <Palette size={14} className="text-brand" />
              {APP_THEMES.find((t) => t.id === activeTheme)?.label ?? 'Theme'}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-40">
            <DropdownMenuLabel className="text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
              Theme
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={activeTheme}
              onValueChange={(v) => setTheme(normalizeTheme(v))}
            >
              {APP_THEMES.map((t) => (
                <DropdownMenuRadioItem key={t.id} value={t.id} className="gap-2">
                  <ThemeIcon id={t.id} />
                  {t.label}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              title="Z-DSO 2104 — stream scope channels to a dedicated oscilloscope window"
            >
              <Activity size={14} className={zConnected ? 'text-emerald-500 dark:text-emerald-400' : 'text-muted-foreground'} />
              Z-DSO
              <span
                className={`h-1.5 w-1.5 rounded-full ${zConnected ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-muted-foreground/40'}`}
                title={zConnected ? 'Scope connected' : 'Scope not connected'}
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>Z-DSO 2104</span>
              <span className={`text-[10px] font-normal ${zConnected ? 'text-emerald-500 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                {zConnected ? 'connected' : 'not connected'}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={openZDso}>
              <Monitor size={14} /> {zConnected ? 'Focus scope window' : 'Open oscilloscope'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
              Capture
            </DropdownMenuLabel>
            <DropdownMenuItem disabled={!zConnected} onSelect={() => zDsoCommand('run')}>
              <Play size={14} /> Run
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!zConnected} onSelect={() => zDsoCommand('stop')}>
              <Pause size={14} /> Stop
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!zConnected} onSelect={() => zDsoCommand('autoSet')}>
              <Crosshair size={14} /> Auto set
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span>Time/div</span>
                <span className="ml-auto pl-3 text-[11px] tabular-nums text-muted-foreground">
                  {fmtTimeDiv(zTimeDiv)}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={String(zTimeDiv)}
                  onValueChange={(v) => setZDsoTimeDiv(Number(v))}
                >
                  {ZDSO_TIME_DIVS.map((td) => (
                    <DropdownMenuRadioItem key={td} value={String(td)}>
                      {fmtTimeDiv(td)}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <span>Signal</span>
                <span className="ml-auto pl-3 text-[11px] text-muted-foreground">
                  {zSignal === 'current' ? 'Current ×1000' : 'Voltage'}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={zSignal}
                  onValueChange={(v) => setZSignal(v as 'voltage' | 'current')}
                >
                  <DropdownMenuRadioItem value="voltage">Voltage (V)</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="current">
                    Current (1 mV ↔ 1 mA)
                  </DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={startZDsoTestSignal}>
              <Activity size={14} /> Test sine · 1 kHz, 2 Vpp
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={clearZDsoChannels}>
              <RotateCcw size={14} /> Clear channels (demo)
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5"
              title="Z-AVO 800 — virtual multimeter with red/black probes"
            >
              <Gauge size={14} className={avoConnected ? 'text-brand' : 'text-muted-foreground'} />
              Z-AVO
              <span
                className={`h-1.5 w-1.5 rounded-full ${avoConnected ? 'bg-emerald-500 dark:bg-emerald-400' : 'bg-muted-foreground/40'}`}
                title={avoConnected ? 'Multimeter connected' : 'Multimeter not connected'}
              />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel className="flex items-center justify-between">
              <span>Z-AVO 800</span>
              <span className={`text-[10px] font-normal ${avoConnected ? 'text-emerald-500 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                {avoConnected ? 'connected' : 'not connected'}
              </span>
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={openAvo}>
              <Monitor size={14} /> {avoConnected ? 'Focus meter window' : 'Open multimeter'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
              Reading
            </DropdownMenuLabel>
            <div className="px-2 pb-2">
              <div className="flex items-center justify-between rounded border border-border bg-background px-2 py-1.5 font-mono text-sm tabular-nums text-brand">
                <span className="truncate">{avoPower ? avoDisplay : 'power off'}</span>
                {avoHold && (
                  <span className="ml-2 shrink-0 text-[9px] uppercase tracking-wider text-brand">
                    hold
                  </span>
                )}
              </div>
              <div className="mt-1 flex items-center gap-3 text-[10px] text-muted-foreground">
                <span className={avoStatus.red ? 'text-emerald-500 dark:text-emerald-400' : ''}>
                  red {avoStatus.red ? 'connected' : 'open'}
                </span>
                <span className={avoStatus.black ? 'text-emerald-500 dark:text-emerald-400' : ''}>
                  black {avoStatus.black ? 'connected' : 'open'}
                </span>
                <span className="ml-auto">{AVO_MODE_LABELS[avoMode]}</span>
              </div>
            </div>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
              Probes
            </DropdownMenuLabel>
            <DropdownMenuItem onSelect={() => armProbe('red')}>
              <span className="h-3 w-3 rounded-full border border-red-300/40 bg-[#d8321f]" />
              {avoProbeEls.red ? 'Select red probe (VΩHz)' : 'Place red probe (VΩHz)'}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => armProbe('black')}>
              <span className="h-3 w-3 rounded-full border border-zinc-500 bg-[#15171a]" />
              {avoProbeEls.black ? 'Select black probe (COM)' : 'Place black probe (COM)'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <SlidersHorizontal size={14} />
                <span>Mode</span>
                <span className="ml-auto pl-3 text-[11px] text-muted-foreground">
                  {AVO_MODE_LABELS[avoMode]}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={avoMode}
                  onValueChange={(v) => applyAvoMode(v as AvoMode)}
                >
                  {AVO_MODES.map((m) => (
                    <DropdownMenuRadioItem key={m} value={m}>
                      {AVO_MODE_LABELS[m]}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuItem disabled={!avoConnected} onSelect={() => avoCommand('hold')}>
              <Pause size={14} /> {avoHold ? 'Release hold' : 'Hold reading'}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!avoConnected} onSelect={() => avoCommand('rel')}>
              <RotateCcw size={14} /> Relative (REL)
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!avoConnected} onSelect={() => avoCommand('select')}>
              <Crosshair size={14} /> Select / range step
            </DropdownMenuItem>
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <Power size={14} />
                <span>Power</span>
                <span className="ml-auto pl-3 text-[11px] text-muted-foreground">
                  {avoPower ? 'On' : 'Off'}
                </span>
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                <DropdownMenuRadioGroup
                  value={avoPower ? 'on' : 'off'}
                  onValueChange={(v) => avoCommand('setPower', [v === 'on'])}
                >
                  <DropdownMenuRadioItem value="on">Power on</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="off">Power off</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
              </DropdownMenuSubContent>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={toggleAvoStreaming}>
              {avoPaused ? <Play size={14} /> : <Pause size={14} />}
              {avoPaused ? 'Resume measurements' : 'Pause measurements (demo)'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <div className="flex items-center gap-2 px-2">
          <span className="text-[11px] text-muted-foreground">Speed</span>
          <Slider
            value={[Math.log10(speed)]}
            min={-2}
            max={2}
            step={0.05}
            className="w-28"
            onValueChange={([v]) => setSpeed(Number(Math.pow(10, v).toPrecision(2)))}
          />
          <span className="w-14 text-[11px] tabular-nums text-muted-foreground">{speed >= 1 ? `${speed.toFixed(1)}×` : `${speed.toFixed(2)}×`}</span>
        </div>
        <div className="flex items-center gap-2 px-2">
          <span className={`text-[11px] ${flowAnim ? 'text-muted-foreground' : 'text-muted-foreground/70'}`}>Flow</span>
          <Slider
            value={[animSpeed]}
            min={0}
            max={3}
            step={0.05}
            disabled={!flowAnim}
            className="w-24"
            onValueChange={([v]) => setAnimSpeed(Number(v.toFixed(2)))}
          />
          <span className="w-10 text-[11px] tabular-nums text-muted-foreground">{animSpeed.toFixed(2)}×</span>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => { viewRef.current.zoom = Math.min(3, viewRef.current.zoom * 1.2); }}><ZoomIn size={14} /></Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={() => { viewRef.current.zoom = Math.max(0.4, viewRef.current.zoom / 1.2); }}><ZoomOut size={14} /></Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Fit circuit to view (F)" onClick={fitCircuitView}><Maximize2 size={14} /></Button>
          <Button size="sm" variant="ghost" className="h-8 w-8 p-0" title="Reset view" onClick={() => { viewRef.current = { x: 0, y: 0, zoom: 1 }; }}><Crosshair size={14} /></Button>
          <Button size="sm" variant="ghost" className={`h-8 w-8 p-0 ${showValues ? 'text-brand' : ''}`} title="Show/hide values" onClick={() => setShowValues((v) => !v)}><Eye size={14} /></Button>
          <Button
            size="sm"
            variant="ghost"
            className={`h-8 w-8 p-0 ${flowAnim ? 'text-brand' : 'text-muted-foreground'}`}
            title={flowAnim ? 'Turn off current animation (hide moving dots)' : 'Turn on current animation (show moving dots)'}
            aria-label="Toggle current animation"
            aria-pressed={flowAnim}
            onClick={() => {
              const next = !flowAnim;
              setFlowAnim(next);
              setStatusHint(
                next
                  ? 'Current animation on'
                  : 'Current animation off — simulation, wire colours, and values stay live'
              );
            }}
          >
            <Activity size={14} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            title="Undo (Ctrl+Z)"
            onClick={doUndo}
          ><Undo2 size={14} /></Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            title="Redo (Ctrl+Shift+Z)"
            onClick={doRedo}
          ><Redo2 size={14} /></Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0"
            title="Keyboard shortcuts (?)"
            onClick={() => setShortcutsOpen(true)}
          ><Keyboard size={14} /></Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-destructive"
            title={selectedIds.length > 0 ? `Delete ${selectedIds.length} selected` : 'Select elements first'}
            onClick={() => {
              if (selectedIds.length > 0) {
                const s = new Set(selectedIds);
                commit(elementsRef.current.filter((e) => !s.has(e.id)));
                setSelectedIds([]);
              }
            }}
          ><Trash2 size={14} /></Button>
        </div>
        <div className="ml-auto flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="tabular-nums">t = {(simTime * 1000).toFixed(2)} ms</span>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        {/* component palette sidebar (collapsible) */}
        <aside
          className={`flex shrink-0 flex-col overflow-hidden border-r border-border bg-card transition-[width] duration-200 ${
            sidebarOpen ? 'w-44' : 'w-10'
          }`}
          aria-label="Component palette"
        >
          <div
            className={`flex shrink-0 items-center border-b border-border/80 py-1 ${
              sidebarOpen ? 'justify-between pl-2 pr-1' : 'justify-center'
            }`}
          >
            {sidebarOpen && (
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Components
              </span>
            )}
            <button
              type="button"
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              onClick={toggleSidebar}
              title={sidebarOpen ? 'Collapse sidebar ( [ )' : 'Expand sidebar ( [ )'}
              aria-label={sidebarOpen ? 'Collapse component sidebar' : 'Expand component sidebar'}
              aria-expanded={sidebarOpen}
              data-sidebar-toggle
            >
              {sidebarOpen ? <PanelLeftClose size={15} /> : <PanelLeftOpen size={15} />}
            </button>
          </div>

          {sidebarOpen ? (
            <div className="min-h-0 flex-1 overflow-y-auto p-2" data-sidebar-panel>
              {CATEGORIES.map((cat) => (
                <div key={cat} className="mb-3">
                  <div className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{cat}</div>
                  <div className="flex flex-col gap-0.5">
                    {ELEMENT_META.filter((m) => m.category === cat).map((m) => {
                      const key = `${m.type}-${m.name}`;
                      const active = toolMeta?.name === m.name && toolMeta?.type === m.type;
                      return (
                        <button
                          key={key}
                          className={`rounded px-2 py-1.5 text-left text-xs transition-colors ${
                            active ? 'bg-brand/20 text-brand' : 'text-foreground/90 hover:bg-accent'
                          }`}
                          onClick={() => setToolMeta(active ? null : m)}
                          data-tool={m.name}
                        >
                          {m.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              <div className="mt-2 rounded bg-muted/60 p-2 text-[10px] leading-relaxed text-muted-foreground">
                <b className="text-foreground/90">Tips</b>
                <br /><span className="text-brand">P</span> = quick add · <span className="text-brand">?</span> = shortcuts
                <br /><span className="text-brand">[</span> = toggle sidebar
                <br />Drag empty space = select
                <br />Drag from a post = wire
                <br />Shift+click = add to selection
                <br />Ctrl+D = duplicate · R = rotate
                <br />Enter = edit · Del = delete
                <br />F = fit view · Ctrl+A = select all
                <br />Click switch = toggle
                <br />Wheel = zoom · Alt+drag = pan
                <br />Ctrl+S = save · Ctrl+O = open
                <br />Drop a .json file on canvas
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="flex min-h-0 flex-1 flex-col items-center gap-3 py-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground/90"
              onClick={toggleSidebar}
              title="Expand sidebar ( [ )"
              aria-label="Expand component sidebar"
              data-sidebar-rail
            >
              <span className="select-none [writing-mode:vertical-rl] rotate-180">Components</span>
            </button>
          )}
        </aside>

        {/* canvas */}
        <div
          ref={wrapRef}
          className="relative min-w-0 flex-1"
          onDragOver={onFileDragOver}
          onDrop={onFileDrop}
        >
          <canvas
            ref={canvasRef}
            className={`absolute inset-0 ${toolMeta ? 'cursor-crosshair' : 'cursor-default'}`}
            onMouseDown={onMouseDown}
            onMouseMove={onMouseMove}
            onMouseUp={onMouseUp}
            onMouseLeave={onMouseUp}
            onDoubleClick={onDoubleClick}
            onWheel={onWheel}
            onContextMenu={(e) => e.preventDefault()}
          />
          {toolMeta && (
            <div className="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-full bg-brand/20 px-3 py-1 text-xs text-brand">
              Placing: {toolMeta.name} — click to place · drag to size · Esc to cancel
            </div>
          )}
          {stopMsg && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded bg-destructive/15 px-3 py-1.5 text-xs text-destructive shadow">
              ⚠ {stopMsg}
            </div>
          )}
          {!ready && (
            <div className="absolute inset-0 flex items-center justify-center bg-background/80 text-sm text-muted-foreground">
              Loading WASM engine…
            </div>
          )}
        </div>

        {/* scope */}
        <ScopePanel
          elements={elements}
          scopeIds={scopeIds}
          engineRef={engineRef}
          onRemove={removeFromScope}
        />
      </div>

      {/* status bar */}
      <footer className="flex items-center justify-between border-t border-border bg-card px-3 py-1.5 text-[11px] text-muted-foreground">
        <span className="truncate">{statusHint}</span>
        <span className="shrink-0 text-muted-foreground/70">
          {elements.length} elements · engine: Rust→WASM · MNA + LU + Newton-Raphson
        </span>
      </footer>

      {/* edit dialog */}
      {selectedElm && (
        <EditDialog
          key={`${selectedElm.id}-${editOpen}`}
          open={editOpen}
          onOpenChange={setEditOpen}
          elm={selectedElm}
          onApply={(params, flags, posts) => {
            const next = elementsRef.current.map((e) =>
              e.id === selectedElm.id ? { ...e, params, flags, posts: posts ?? e.posts } : e
            );
            const structural = posts !== undefined;
            if (structural) {
              commit(next, false);
            } else {
              // value/flag edit: update engine in place, re-stamp without reset
              setElements(next);
              elementsRef.current = next;
              const eng = engineRef.current;
              const idx = next.findIndex((e) => e.id === selectedElm.id);
              if (eng && idx >= 0) {
                next[idx].params.forEach((v, k) => eng.setParam(idx, k, v));
                eng.setFlags(idx, next[idx].flags);
                const err = eng.analyze();
                if (err) setStopMsg(err);
              }
              localStorage.setItem('circuit-sim-elements', JSON.stringify(next));
            }
          }}
        />
      )}

      {/* quick component palette + shortcut help */}
      <ComponentPalette open={paletteOpen} onOpenChange={setPaletteOpen} onPick={pickComponent} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      {/* scope add button for selection */}
      {selectedElm && !editOpen && !isProbeType(selectedElm.type) && (
        <button
          className="fixed bottom-10 right-64 z-40 rounded bg-brand px-3 py-1.5 text-xs font-medium text-brand-foreground shadow hover:bg-brand/90"
          onClick={() => addToScope(selectedElm.id)}
        >
          + View in Scope
        </button>
      )}
    </div>
  );
}

function ThemeIcon({ id }: { id: AppTheme }) {
  if (id === 'light') return <Sun size={13} />;
  if (id === 'pink') return <Palette size={13} className="text-pink-500" />;
  return <Moon size={13} />;
}

function ZapIcon() {
  return (
    <svg className="text-brand" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" fill="currentColor" />
    </svg>
  );
}

function distToSeg(px: number, py: number, a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(px - a[0], py - a[1]);
  let t = ((px - a[0]) * dx + (py - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

interface Rect { x0: number; y0: number; x1: number; y1: number }

/** Selection hit test: any post inside the rect, or the body crossing it. */
function elementInRect(e: CircuitElm, r: Rect): boolean {
  for (const p of e.posts) {
    if (p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1) return true;
  }
  if (e.posts.length === 2) {
    return segIntersectsRect(e.posts[0], e.posts[1], r);
  }
  return false;
}

function segIntersectsRect(a: [number, number], b: [number, number], r: Rect): boolean {
  const inside = (p: [number, number]) => p[0] >= r.x0 && p[0] <= r.x1 && p[1] >= r.y0 && p[1] <= r.y1;
  if (inside(a) || inside(b)) return true;
  const c1: [number, number] = [r.x0, r.y0];
  const c2: [number, number] = [r.x1, r.y0];
  const c3: [number, number] = [r.x1, r.y1];
  const c4: [number, number] = [r.x0, r.y1];
  return segSegIntersect(a, b, c1, c2) || segSegIntersect(a, b, c2, c3)
    || segSegIntersect(a, b, c3, c4) || segSegIntersect(a, b, c4, c1);
}

function segSegIntersect(
  a: [number, number], b: [number, number], c: [number, number], d: [number, number]
): boolean {
  const orient = (p: [number, number], q: [number, number], s: [number, number]) =>
    Math.sign((q[0] - p[0]) * (s[1] - p[1]) - (q[1] - p[1]) * (s[0] - p[0]));
  return orient(a, b, c) !== orient(a, b, d) && orient(c, d, a) !== orient(c, d, b);
}

/** Split wires so that any element post lying on a wire becomes a shared endpoint. */
function splitWiresAtPosts(elms: CircuitElm[]): CircuitElm[] {
  let wires = elms.filter((e) => e.type === T.WIRE);
  const others = elms.filter((e) => e.type !== T.WIRE);
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 10) {
    changed = false;
    const posts: [number, number][] = [];
    for (const e of others) for (const p of e.posts) posts.push(p);
    // Wire endpoints count as junction points too: a wire ending on the middle
    // of another wire is a T-junction, not a crossing. Splitting there makes it
    // electrically connected (the engine only merges exact post coordinates)
    // and lets the flow animation carry current across the junction.
    for (const w of wires) for (const p of w.posts) posts.push(p);
    const nextWires: CircuitElm[] = [];
    for (const w of wires) {
      let segments: [number, number][][] = [[w.posts[0], w.posts[1]]];
      for (const p of posts) {
        const newSegs: [number, number][][] = [];
        for (const [a, b] of segments) {
          const t = projT(p, a, b);
          if (t > 0.02 && t < 0.98 && distToSeg(p[0], p[1], a, b) < 0.5) {
            newSegs.push([a, [p[0], p[1]]], [[p[0], p[1]], b]);
            changed = true;
          } else {
            newSegs.push([a, b]);
          }
        }
        segments = newSegs;
      }
      let first = true;
      for (const [a, b] of segments) {
        // keep the original id on the first fragment and give the rest new
        // ids so split wires never collide in selection/scope/file data
        nextWires.push({ ...w, id: first ? w.id : nextId++, posts: [a, b] });
        first = false;
      }
    }
    wires = nextWires;
  }
  return [...others, ...wires];
}

function projT(p: [number, number], a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return 0;
  return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
}
