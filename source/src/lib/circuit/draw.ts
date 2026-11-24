// Canvas rendering for circuit elements — vector symbols in the spirit of
// circuitjs1. 2-terminal elements draw in a rotated frame; multi-post
// elements draw in world coordinates.

import { T, F_CLOSED, F_PNP, F_CT, WF_AC, WF_SQUARE, WF_TRIANGLE, WF_SAWTOOTH, WF_PULSE } from './elements';
import { fmtValue } from './elements';
import { CANVAS_PALETTES, type AppTheme, type CanvasPalette } from './theme';

// The active palette. Every colour below is looked up at draw time so a theme
// switch only needs to call `setCanvasTheme()` before the next frame.
let palette: CanvasPalette = CANVAS_PALETTES.dark;

/** Select the palette used by all canvas symbol and label drawing. */
export function setCanvasTheme(theme: AppTheme): void {
  palette = CANVAS_PALETTES[theme] ?? CANVAS_PALETTES.dark;
}

/** Read-only access for other renderers (e.g. the scope panel). */
export function canvasPalette(): CanvasPalette {
  return palette;
}

export interface DrawOpt {
  selected: boolean;
  hover: boolean;
  stateFlags: number; // per-frame engine state (lamp brightness, gate out, diode on…)
  vd: number;
  current: number;
  showValues: boolean;
  nodeV: number; // absolute voltage at post0 (for sources/labels)
}

function base(opt: DrawOpt): string {
  if (opt.selected) return palette.select;
  if (opt.hover) return palette.hover;
  return palette.base;
}

function mid(a: [number, number], b: [number, number]): [number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function dist(a: [number, number], b: [number, number]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

function norm(a: [number, number], b: [number, number]): [number, number] {
  const d = Math.max(dist(a, b), 1e-6);
  return [(b[0] - a[0]) / d, (b[1] - a[1]) / d];
}

function line(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number]) {
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
}

/** Point where the segment a→b leaves a circle (used to place BJT arrows outside the body). */
function circleExit(
  a: [number, number],
  b: [number, number],
  center: [number, number],
  r: number
): [number, number] {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const aa = dx * dx + dy * dy;
  if (aa < 1e-9) return a;
  const fx = a[0] - center[0], fy = a[1] - center[1];
  const bb = 2 * (fx * dx + fy * dy);
  const cc = fx * fx + fy * fy - r * r;
  const disc = bb * bb - 4 * aa * cc;
  if (disc < 0) return a;
  const t = (-bb + Math.sqrt(disc)) / (2 * aa);
  return t >= 0 && t <= 1 ? [a[0] + dx * t, a[1] + dy * t] : a;
}

/**
 * Falstad-style element geometry (`CircuitElm.calcLeads`): the symbol body
 * keeps a FIXED size while the leads stretch. Returns the two points between
 * which the body should be drawn, centered on the post-to-post segment.
 * If the posts are closer than `bodyLen` the body compresses to fit.
 */
function calcLeads(
  a: [number, number],
  b: [number, number],
  bodyLen: number
): { l1: [number, number]; l2: [number, number] } {
  const L = dist(a, b);
  if (L <= bodyLen) return { l1: a, l2: b };
  const f = (L - bodyLen) / (2 * L);
  return {
    l1: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f],
    l2: [b[0] + (a[0] - b[0]) * f, b[1] + (a[1] - b[1]) * f],
  };
}

export function drawElement(
  ctx: CanvasRenderingContext2D,
  type: number,
  flags: number,
  posts: [number, number][],
  params: number[],
  opt: DrawOpt
): void {
  ctx.save();
  ctx.strokeStyle = base(opt);
  ctx.fillStyle = base(opt);
  ctx.lineWidth = opt.selected ? 2.4 : 1.7;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  switch (type) {
    case T.WIRE: {
      line(ctx, posts[0], posts[1]);
      break;
    }
    case T.RESISTOR: drawZigzag(ctx, posts[0], posts[1]); break;
    case T.CAPACITOR: drawCapacitor(ctx, posts[0], posts[1]); break;
    case T.INDUCTOR: drawInductor(ctx, posts[0], posts[1]); break;
    case T.POT: drawPot(ctx, posts, params); break;
    case T.SWITCH: drawSwitch(ctx, posts[0], posts[1], flags); break;
    case T.SPARK_GAP: drawSparkGap(ctx, posts[0], posts[1], flags); break;
    case T.LAMP: drawLamp(ctx, posts[0], posts[1], opt); break;
    case T.AMMETER: drawCircleMeter(ctx, posts[0], posts[1]); break;
    case T.VOLTMETER: drawCircleMeter(ctx, posts[0], posts[1]); break;
    case T.OHMMETER: drawCircleMeter(ctx, posts[0], posts[1]); break;
    case T.PROBE_RED: drawProbe(ctx, posts[0], '#d8321f', false); break;
    case T.PROBE_BLACK: drawProbe(ctx, posts[0], '#15171a', true); break;
    case T.DIODE: drawDiode(ctx, posts[0], posts[1], 'diode', false); break;
    case T.LED: drawDiode(ctx, posts[0], posts[1], 'led', opt.stateFlags !== 0); break;
    case T.ZENER: drawDiode(ctx, posts[0], posts[1], 'zener', false); break;
    case T.TRANSISTOR: drawBjt(ctx, posts, flags, opt); break;
    case T.MOSFET: drawMosfet(ctx, posts, flags, opt); break;
    case T.OPAMP: drawOpamp(ctx, posts, false); break;
    case T.COMPARATOR: drawOpamp(ctx, posts, true); break;
    case T.AND: case T.OR: case T.NAND: case T.NOR: case T.XOR: case T.XNOR:
      drawGate(ctx, posts, type, opt); break;
    case T.INVERTER: drawInverterBuffer(ctx, posts, true, opt); break;
    case T.BUFFER: drawInverterBuffer(ctx, posts, false, opt); break;
    case T.DFF: drawChipBox(ctx, posts, 'DFF', ['D', '>', 'Q', 'Q\u0305'], [0, 1], [2, 3], opt); break;
    case T.ADC: drawChipBox(ctx, posts, 'ADC', ['IN', '0', '1', '2', '3'], [0], [1, 2, 3, 4], opt); break;
    case T.DAC: drawChipBox(ctx, posts, 'DAC', ['0', '1', '2', '3', 'OUT'], [0, 1, 2, 3], [4], opt); break;
    case T.TRANSFORMER: drawTransformer(ctx, posts, flags); break;
    case T.IC_DUMMY: drawGenericIc(ctx, posts); break;
    case T.VOLTAGE: drawVoltageSource(ctx, posts[0], posts[1], flags, params, opt); break;
    case T.BATTERY_DC: drawBattery(ctx, posts[0], posts[1]); break;
    case T.CURRENT: drawCurrentSource(ctx, posts[0], posts[1]); break;
    case T.RAIL: drawRail(ctx, posts[0], params, opt); break;
    case T.GROUND: drawGround(ctx, posts[0]); break;
    case T.LOGIC_INPUT: drawLogicInput(ctx, posts[0], flags, params, opt); break;
    case T.CLOCK_INPUT: drawClockInput(ctx, posts[0], params, opt); break;
    case T.LOGIC_OUTPUT: drawLogicOutput(ctx, posts[0], opt); break;
  }
  ctx.restore();

  void params;
}

// ---------------- 2-terminal symbols ----------------

const RES_BODY = 32; // fixed zigzag body length (Falstad calcLeads(32))

function drawZigzag(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number]) {
  const { l1, l2 } = calcLeads(a, b, RES_BODY);
  const L = dist(l1, l2);
  const [ux, uy] = norm(l1, l2);
  const px = -uy, py = ux;
  const segs = 6;
  const h = Math.min(6.5, L * 0.28);
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(l1[0], l1[1]);
  for (let i = 0; i < segs; i++) {
    const t = ((i + 0.5) * L) / segs;
    const s = i % 2 === 0 ? -h : h;
    ctx.lineTo(l1[0] + ux * t + px * s, l1[1] + uy * t + py * s);
  }
  ctx.lineTo(l2[0], l2[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
}

function drawCapacitor(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number]) {
  const L = dist(a, b);
  const [ux, uy] = norm(a, b);
  const px = -uy, py = ux;
  const m = mid(a, b);
  const gap = Math.min(5, L * 0.16);
  const pl = Math.min(10, L * 0.32);
  const p1: [number, number] = [m[0] - ux * gap, m[1] - uy * gap];
  const p2: [number, number] = [m[0] + ux * gap, m[1] + uy * gap];
  line(ctx, a, p1);
  line(ctx, p2, b);
  line(ctx, [p1[0] + px * pl, p1[1] + py * pl], [p1[0] - px * pl, p1[1] - py * pl]);
  line(ctx, [p2[0] + px * pl, p2[1] + py * pl], [p2[0] - px * pl, p2[1] - py * pl]);
}

const IND_BODY = 36; // fixed coil body length (4 humps of r=4.5, Falstad-style)

function drawInductor(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number]) {
  const { l1, l2 } = calcLeads(a, b, IND_BODY);
  line(ctx, a, l1);
  line(ctx, l2, b);
  const L = dist(l1, l2);
  const humps = 4;
  const w = L / humps;
  const ang = Math.atan2(l2[1] - l1[1], l2[0] - l1[0]);
  // draw the coil in a local frame so the semicircular humps are exact at any angle
  ctx.save();
  ctx.translate(l1[0], l1[1]);
  ctx.rotate(ang);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  for (let i = 0; i < humps; i++) {
    // semicircle from π→2π bulges "up" (left of the a→b direction)
    ctx.arc(w * (i + 0.5), 0, w / 2, Math.PI, 2 * Math.PI, false);
  }
  ctx.restore();
  ctx.stroke();
}

function drawPot(ctx: CanvasRenderingContext2D, posts: [number, number][], params: number[]) {
  const [a, b, w] = posts;
  drawZigzag(ctx, a, b);
  const { l1, l2 } = calcLeads(a, b, RES_BODY);
  const pos = Math.max(0, Math.min(1, params[1] !== undefined ? params[1] : 0.5));
  // wiper travels along the fixed-size body (10%..90%), not the whole span
  const t = 0.1 + 0.8 * pos;
  const m: [number, number] = [l1[0] + (l2[0] - l1[0]) * t, l1[1] + (l2[1] - l1[1]) * t];
  const [ux, uy] = norm(m, w); // body contact -> wiper post
  // lead stops just short of the zigzag so the arrow reads as a sliding contact
  const tip: [number, number] = [m[0] + ux * 4, m[1] + uy * 4];
  line(ctx, w, tip);
  // filled arrowhead with its apex at the tip, pointing at the resistive body
  const px = -uy, py = ux;
  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(tip[0] + ux * 6 + px * 4, tip[1] + uy * 6 + py * 4);
  ctx.lineTo(tip[0] + ux * 6 - px * 4, tip[1] + uy * 6 - py * 4);
  ctx.closePath();
  ctx.fill();
}

const SW_BODY = 32; // fixed switch body length

function drawSwitch(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number], flags: number) {
  const { l1, l2 } = calcLeads(a, b, SW_BODY);
  line(ctx, a, l1);
  line(ctx, l2, b);
  if (flags & F_CLOSED) {
    line(ctx, l1, l2);
  } else {
    // open lever: l2 swung ~28° about the hinge at l1 (stays fixed-size)
    const len = dist(l1, l2);
    const ang = Math.atan2(l2[1] - l1[1], l2[0] - l1[0]);
    const tipAng = ang - Math.PI / 6.5;
    line(ctx, l1, [
      l1[0] + Math.cos(tipAng) * len * 0.97,
      l1[1] + Math.sin(tipAng) * len * 0.97,
    ]);
  }
}

function drawSparkGap(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number], flags: number) {
  const L = dist(a, b);
  const [ux, uy] = norm(a, b);
  const m = mid(a, b);
  const gap = Math.min(5, L * 0.18);
  const e1: [number, number] = [m[0] - ux * gap, m[1] - uy * gap];
  const e2: [number, number] = [m[0] + ux * gap, m[1] + uy * gap];
  line(ctx, a, e1);
  line(ctx, b, e2);
  ctx.beginPath(); ctx.arc(e1[0], e1[1], 3, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(e2[0], e2[1], 3, 0, Math.PI * 2); ctx.stroke();
  if (flags & F_CLOSED) {
    ctx.save();
    ctx.strokeStyle = palette.select;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(e1[0], e1[1]);
    ctx.lineTo(m[0] + ux * 1 - uy * 1, m[1] + uy * 1 + ux * 1);
    ctx.lineTo(e2[0], e2[1]);
    ctx.stroke();
    ctx.restore();
  }
}

function drawLamp(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number], opt: DrawOpt) {
  const L = dist(a, b);
  const [ux, uy] = norm(a, b);
  const r = Math.min(9, L * 0.3);
  const c: [number, number] = [a[0] + ux * (L / 2), a[1] + uy * (L / 2)];
  line(ctx, a, [c[0] - ux * r, c[1] - uy * r]);
  line(ctx, [c[0] + ux * r, c[1] + uy * r], b);
  ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI * 2); ctx.stroke();
  const d = r * 0.62;
  line(ctx, [c[0] - d, c[1] - d], [c[0] + d, c[1] + d]);
  line(ctx, [c[0] - d, c[1] + d], [c[0] + d, c[1] - d]);
  if (opt.stateFlags > 0.02) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.85, opt.stateFlags / 1.5);
    ctx.fillStyle = palette.on;
    ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function drawCircleMeter(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number]) {
  const L = dist(a, b);
  const [ux, uy] = norm(a, b);
  const r = Math.min(10, L * 0.3);
  const c: [number, number] = [a[0] + ux * (L / 2), a[1] + uy * (L / 2)];
  line(ctx, a, [c[0] - ux * r, c[1] - uy * r]);
  line(ctx, [c[0] + ux * r, c[1] + uy * r], b);
  ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI * 2); ctx.stroke();
}

function drawDiode(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number], kind: 'diode' | 'led' | 'zener', on: boolean) {
  const L = dist(a, b);
  const [ux, uy] = norm(a, b);
  const px = -uy, py = ux;
  const h = Math.min(9, L * 0.2);
  const m = mid(a, b);
  const bar: [number, number] = [m[0] + ux * h * 0.6, m[1] + uy * h * 0.6];
  const tip: [number, number] = [m[0] + ux * h * 0.6, m[1] + uy * h * 0.6];
  line(ctx, a, [m[0] - ux * h, m[1] - uy * h]);
  line(ctx, bar, b);
  // triangle
  ctx.beginPath();
  ctx.moveTo(m[0] - ux * h + px * h, m[1] - uy * h + py * h);
  ctx.lineTo(m[0] - ux * h - px * h, m[1] - uy * h - py * h);
  ctx.lineTo(tip[0], tip[1]);
  ctx.closePath();
  ctx.fill();
  // bar
  const bl = h;
  line(ctx, [bar[0] + px * bl, bar[1] + py * bl], [bar[0] - px * bl, bar[1] - py * bl]);
  if (kind === 'zener') {
    line(ctx, [bar[0] + px * bl, bar[1] + py * bl], [bar[0] + px * (bl - 4) + ux * 4, bar[1] + py * (bl - 4) + uy * 4]);
    line(ctx, [bar[0] - px * bl, bar[1] - py * bl], [bar[0] - px * (bl - 4) - ux * 4, bar[1] - py * (bl - 4) - uy * 4]);
  }
  if (kind === 'led') {
    ctx.save();
    ctx.strokeStyle = on ? palette.accent : palette.hover;
    ctx.lineWidth = 1.3;
    for (const s of [-1, 1]) {
      const bx = bar[0] + px * s * (h + 3) - ux * 2;
      const by = bar[1] + py * s * (h + 3) - uy * 2;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + ux * 5 + px * s * 3, by + uy * 5 + py * s * 3);
      ctx.stroke();
    }
    ctx.restore();
  }
}

// ---------------- multi-post symbols ----------------

interface IcGeom {
  cx: number; cy: number;       // midpoint of the pin line
  dx: number; dy: number;       // body direction (away from the pins)
  vx: number; vy: number;       // pin-line direction (pin 1 → pin 4)
  sx: number; sy: number;       // body edge where the leads enter
  ex: number; ey: number;       // far edge of the body
  halfH: number;
  offsets: number[];            // pin position along the pin line
}

/**
 * Shared geometry for the dummy IC symbol and its labels. Post order is
 * pin 1 → pin 4 along the drag's perpendicular, so rotating the pin vector by
 * −90° recovers the body direction. That keeps the four pins on the left at
 * every rotation without needing a fifth "orientation" post.
 */
function icGeometry(posts: [number, number][]): IcGeom | null {
  if (posts.length < 4) return null;
  const p0 = posts[0], p3 = posts[3];
  const span = dist(p0, p3);
  if (span < 1) return null;
  const [vx, vy] = norm(p0, p3);
  const dx = vy, dy = -vx;
  const cx = (p0[0] + p3[0]) / 2;
  const cy = (p0[1] + p3[1]) / 2;
  const lead = 12;
  const bodyLen = 52;
  const halfH = Math.max(30, span / 2 + 10);
  const sx = cx + dx * lead, sy = cy + dy * lead;
  return {
    cx, cy, dx, dy, vx, vy, sx, sy,
    ex: sx + dx * bodyLen, ey: sy + dy * bodyLen,
    halfH,
    offsets: posts.slice(0, 4).map((p) => (p[0] - cx) * vx + (p[1] - cy) * vy),
  };
}

function drawGenericIc(ctx: CanvasRenderingContext2D, posts: [number, number][]) {
  const g = icGeometry(posts);
  if (!g) return;
  const corners: [number, number][] = [
    [g.sx - g.vx * g.halfH, g.sy - g.vy * g.halfH],
    [g.ex - g.vx * g.halfH, g.ey - g.vy * g.halfH],
    [g.ex + g.vx * g.halfH, g.ey + g.vy * g.halfH],
    [g.sx + g.vx * g.halfH, g.sy + g.vy * g.halfH],
  ];
  ctx.beginPath();
  ctx.moveTo(corners[0][0], corners[0][1]);
  for (let i = 1; i < corners.length; i++) ctx.lineTo(corners[i][0], corners[i][1]);
  ctx.closePath();
  ctx.save();
  ctx.fillStyle = palette.body;
  ctx.fill();
  ctx.restore();
  ctx.stroke();

  // Four short leads from the posts to the left edge of the body.
  for (let i = 0; i < 4; i++) {
    line(ctx, posts[i], [g.sx + g.vx * g.offsets[i], g.sy + g.vy * g.offsets[i]]);
  }
  // Pin-1 marker just inside the body.
  const dot: [number, number] = [
    g.sx + g.dx * 20 + g.vx * g.offsets[0],
    g.sy + g.dy * 20 + g.vy * g.offsets[0],
  ];
  ctx.beginPath();
  ctx.arc(dot[0], dot[1], 2.4, 0, Math.PI * 2);
  ctx.fill();
}

function drawBjt(ctx: CanvasRenderingContext2D, posts: [number, number][], flags: number, opt: DrawOpt) {
  const b = posts[0], c = posts[1], e = posts[2];
  const ce = mid(c, e);
  let [ux, uy] = norm(b, ce);
  let px = -uy, py = ux;
  let dTotal = dist(b, ce);

  // A click with no drag can put the base exactly at the C/E midpoint. In that
  // case the C/E spread is perpendicular to the body axis — use it to recover
  // the orientation instead of collapsing every point onto the base.
  if (dTotal < 1e-6) {
    const spread = norm(ce, c);
    px = spread[0]; py = spread[1];
    ux = py; uy = -px;
    dTotal = dist(b, c);
  }

  // Fixed-size body: the bar is tangent to the circle, so stretching the posts
  // only stretches the leads (Falstad-style).
  const r = Math.max(7, Math.min(12, dTotal * 0.42));
  const circDist = Math.max(r + 6, Math.min(dTotal - r - 2, Math.max(r + 10, dTotal * 0.72)));
  const barDist = Math.max(circDist - r, 2);
  const barC: [number, number] = [b[0] + ux * barDist, b[1] + uy * barDist];
  const circleC: [number, number] = [b[0] + ux * circDist, b[1] + uy * circDist];
  const barHalf = 10;

  // Assign bar ends by perpendicular projection: the collector end is always
  // on the collector's side of the axis, so the C/E leads never cross.
  const sc = (c[0] - barC[0]) * px + (c[1] - barC[1]) * py;
  const se = (e[0] - barC[0]) * px + (e[1] - barC[1]) * py;
  const side = sc >= se ? 1 : -1;
  const cEnd: [number, number] = [barC[0] + px * barHalf * side, barC[1] + py * barHalf * side];
  const eEnd: [number, number] = [barC[0] - px * barHalf * side, barC[1] - py * barHalf * side];

  // Leads.
  line(ctx, b, barC);
  line(ctx, cEnd, eEnd);
  const cDir = norm(cEnd, c);
  line(ctx, cEnd, [c[0] - cDir[0] * 2, c[1] - cDir[1] * 2]);
  const eDir = norm(eEnd, e);
  line(ctx, eEnd, [e[0] - eDir[0] * 2, e[1] - eDir[1] * 2]);

  // Circle fill hides the inner part of the leads, like circuitjs1.
  ctx.save();
  ctx.fillStyle = palette.body;
  ctx.beginPath(); ctx.arc(circleC[0], circleC[1], r, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  ctx.beginPath(); ctx.arc(circleC[0], circleC[1], r, 0, Math.PI * 2); ctx.stroke();

  // Emitter arrow, drawn last so it is never covered by the body fill:
  // NPN points away from the bar (outward), PNP points toward it (inward).
  const exit = circleExit(eEnd, e, circleC, r);
  const gap = dist(exit, e);
  const offset = Math.min(gap * 0.55, 9);
  const ax0: [number, number] = [exit[0] + eDir[0] * offset, exit[1] + eDir[1] * offset];
  const sign = (flags & F_PNP) !== 0 ? -1 : 1;
  const ax = eDir[0] * sign, ay = eDir[1] * sign;
  const nx = -ay, ny = ax;
  const h = 4.5;
  ctx.beginPath();
  ctx.moveTo(ax0[0] + ax * h, ax0[1] + ay * h);
  ctx.lineTo(ax0[0] - ax * h + nx * h, ax0[1] - ay * h + ny * h);
  ctx.lineTo(ax0[0] - ax * h - nx * h, ax0[1] - ay * h - ny * h);
  ctx.closePath();
  ctx.fill();
  void opt;
}

function drawMosfet(ctx: CanvasRenderingContext2D, posts: [number, number][], flags: number, opt: DrawOpt) {
  const g = posts[0], d = posts[1], s = posts[2];
  const ds = mid(d, s);
  const [ux, uy] = norm(g, ds);
  const px = -uy, py = ux;
  const dTotal = dist(g, ds);
  // clamped positions keep the symbol compact; stretching posts stretches lead
  const chDist = Math.min(Math.max(dTotal * 0.6, 16), Math.max(dTotal - 4, 10));
  const gbDist = Math.max(chDist - 8, 2);
  const ch: [number, number] = [g[0] + ux * chDist, g[1] + uy * chDist]; // channel bar center
  const gb: [number, number] = [g[0] + ux * gbDist, g[1] + uy * gbDist]; // gate bar center
  const chHalf = 12, gbHalf = 8;
  // channel bar (3 segments look)
  line(ctx, [ch[0] + px * chHalf, ch[1] + py * chHalf], [ch[0] - px * chHalf, ch[1] - py * chHalf]);
  // gate bar + gate lead
  line(ctx, [gb[0] + px * gbHalf, gb[1] + py * gbHalf], [gb[0] - px * gbHalf, gb[1] - py * gbHalf]);
  line(ctx, g, gb);
  // drain / source leads from bar ends
  const dEnd: [number, number] = [ch[0] + px * chHalf, ch[1] + py * chHalf];
  const sEnd: [number, number] = [ch[0] - px * chHalf, ch[1] - py * chHalf];
  line(ctx, dEnd, d);
  line(ctx, sEnd, s);
  // arrow on source (N: pointing toward channel; P: away)
  const pnp = (flags & F_PNP) !== 0;
  const dirS = norm(sEnd, s);
  const at = pnp ? [sEnd[0] + dirS[0] * 9, sEnd[1] + dirS[1] * 9] : [s[0] - dirS[0] * 9, s[1] - dirS[1] * 9];
  const ad = pnp ? [-dirS[0], -dirS[1]] : dirS;
  ctx.beginPath();
  ctx.moveTo(at[0] + ad[0] * 5 + px * 4, at[1] + ad[1] * 5 + py * 4);
  ctx.lineTo(at[0], at[1]);
  ctx.lineTo(at[0] + ad[0] * 5 - px * 4, at[1] + ad[1] * 5 - py * 4);
  ctx.closePath();
  ctx.fill();
  void opt;
}

function drawOpamp(ctx: CanvasRenderingContext2D, posts: [number, number][], comparator: boolean) {
  const inMinus = posts[0], inPlus = posts[1], out = posts[2];
  // order left edge: two input posts
  const top = inMinus[1] < inPlus[1] ? inMinus : inPlus;
  const bot = inMinus[1] < inPlus[1] ? inPlus : inMinus;
  const baseC: [number, number] = mid(top, bot);
  const [ux, uy] = norm(baseC, out);
  const dOut = dist(baseC, out);
  // fixed-size triangle body (max 34), lead stretches to the output post
  const body = Math.min(Math.max(dOut - 4, 10), 34);
  const apex: [number, number] = [baseC[0] + ux * body, baseC[1] + uy * body];
  ctx.beginPath();
  ctx.moveTo(top[0], top[1]);
  ctx.lineTo(apex[0], apex[1]);
  ctx.lineTo(bot[0], bot[1]);
  ctx.closePath();
  ctx.stroke();
  line(ctx, apex, out);
  void comparator;
}

function drawGate(ctx: CanvasRenderingContext2D, posts: [number, number][], type: number, opt: DrawOpt) {
  // Geometry mirrors circuitjs1 GateElm (MIL-STD-806B tuned bezier fractions),
  // drawn in a local frame (input centroid → output post) so gates work at any
  // orientation: +x = toward output, y = perpendicular.
  const nIn = posts.length - 1;
  const out = posts[nIn];
  let cx = 0, cy = 0;
  for (let i = 0; i < nIn; i++) {
    cx += posts[i][0];
    cy += posts[i][1];
  }
  cx /= nIn;
  cy /= nIn;
  const len0 = Math.max(dist([cx, cy], out), 20);
  const ang = Math.atan2(out[1] - cy, out[0] - cx);
  const ca = Math.cos(-ang), sa = Math.sin(-ang);
  // local coordinates of input posts; half-height = max |perp offset|
  const localIn: [number, number][] = [];
  let hs2 = 14;
  for (let i = 0; i < nIn; i++) {
    const dx = posts[i][0] - cx, dy = posts[i][1] - cy;
    const ly = dx * sa + dy * ca;
    localIn.push([dx * ca - dy * sa, ly]);
    hs2 = Math.max(hs2, Math.abs(ly));
  }

  const inv = type === T.NAND || type === T.NOR || type === T.XNOR;
  const xor = type === T.XOR || type === T.XNOR;
  // fixed-size gate body (Falstad GateElm keeps the shape constant); only the
  // output lead stretches. Cap the body so short drags stay valid.
  const maxBody = inv ? len0 - 14 : len0 - 6;
  const bodyEnd = Math.max(Math.min(inv ? 40 : 44, maxBody), 10);
  const isAnd = type === T.AND || type === T.NAND;

  // x of the concave back curve at |y| (OR family); closed form from the
  // original's backCurveX(): quadratic bezier P0=(0,-hs2) C=(k*len,0) P3=(0,hs2)
  const backX = (lyAbs: number): number => {
    if (isAnd) return 0;
    const k = Math.min((Math.abs(lyAbs) / hs2) * 0.999, 1);
    const disc = Math.sqrt(4 * k * k + 1);
    const s = Math.cbrt(2 * k + disc) + Math.cbrt(2 * k - disc);
    const t = (s + 1) / 2;
    return 3 * t * (1 - t) * 0.195 * bodyEnd;
  };
  const toWorld = (lx: number, ly: number): [number, number] => [
    cx + lx * Math.cos(ang) - ly * Math.sin(ang),
    cy + lx * Math.sin(ang) + ly * Math.cos(ang),
  ];

  // input leads: post → back edge
  for (let i = 0; i < nIn; i++) {
    const [lx, ly] = localIn[i];
    const bx = backX(Math.abs(ly)) - (xor ? 8 : 0);
    line(ctx, posts[i], toWorld(bx, ly));
  }

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(ang);
  ctx.beginPath();
  if (isAnd) {
    const rad = Math.min(hs2, Math.max(bodyEnd * 0.6, 4));
    ctx.moveTo(0, -hs2);
    ctx.lineTo(bodyEnd - rad, -hs2);
    ctx.arc(bodyEnd - rad, 0, rad, -Math.PI / 2, Math.PI / 2);
    ctx.lineTo(0, hs2);
    ctx.closePath();
  } else {
    // OR family — fractions from GateElm.setPoints(): flat 0.134,
    // front control 0.664 / 0.8372·hs2, concave back control 0.195·len
    const f1 = 0.134, fc = 0.664, k = 0.8372, back = 0.195;
    ctx.moveTo(0, -hs2);
    ctx.lineTo(f1 * bodyEnd, -hs2);
    ctx.bezierCurveTo(fc * bodyEnd, -hs2 * k, fc * bodyEnd, -hs2 * k, bodyEnd, 0);
    ctx.bezierCurveTo(fc * bodyEnd, hs2 * k, fc * bodyEnd, hs2 * k, f1 * bodyEnd, hs2);
    ctx.lineTo(0, hs2);
    ctx.quadraticCurveTo(back * bodyEnd, 0, 0, -hs2);
    ctx.closePath();
  }
  ctx.save();
  ctx.fillStyle = palette.body;
  ctx.fill();
  ctx.restore();
  ctx.stroke();

  if (xor) {
    const xe = -(0.05 * bodyEnd + 8);
    ctx.beginPath();
    ctx.moveTo(xe, hs2);
    ctx.quadraticCurveTo(0.1 * bodyEnd - 8, 0, xe, -hs2);
    ctx.stroke();
  }
  if (inv) {
    ctx.beginPath();
    ctx.arc(bodyEnd + 3.5, 0, 3.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  // output lead (from body/bubble to the output post at (len0, 0))
  line(ctx, [Math.min(inv ? bodyEnd + 7 : bodyEnd, len0 - 1), 0], [len0, 0]);
  ctx.restore();

  // gate output state glow
  if (opt.stateFlags & 1) {
    ctx.save();
    ctx.fillStyle = palette.on;
    ctx.beginPath(); ctx.arc(out[0] + 4, out[1], 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function drawInverterBuffer(ctx: CanvasRenderingContext2D, posts: [number, number][], invert: boolean, opt: DrawOpt) {
  const inp = posts[0], out = posts[1];
  // fixed-size body centered between the posts; leads stretch (Falstad-style).
  // Inverter body length includes the bubble.
  const BODY = invert ? 29 : 26;
  const { l1, l2 } = calcLeads(inp, out, BODY);
  line(ctx, inp, l1);
  line(ctx, l2, out);
  const L = dist(l1, l2);
  const [ux, uy] = norm(l1, l2);
  const px = -uy, py = ux;
  const h = Math.min(11, L * 0.4);
  const triEnd = invert ? [l2[0] - ux * 7, l2[1] - uy * 7] as [number, number] : l2;
  ctx.beginPath();
  ctx.moveTo(l1[0] + px * h, l1[1] + py * h);
  ctx.lineTo(l1[0] - px * h, l1[1] - py * h);
  ctx.lineTo(triEnd[0], triEnd[1]);
  ctx.closePath();
  ctx.save();
  ctx.fillStyle = palette.body;
  ctx.fill();
  ctx.restore();
  ctx.stroke();
  if (invert) {
    ctx.beginPath();
    ctx.arc(l2[0] - ux * 3.5, l2[1] - uy * 3.5, 3.5, 0, Math.PI * 2);
    ctx.stroke();
  }
  if (opt.stateFlags & 1) {
    ctx.save();
    ctx.fillStyle = palette.on;
    ctx.beginPath(); ctx.arc(out[0] + 4, out[1], 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
}

function drawChipBox(
  ctx: CanvasRenderingContext2D,
  posts: [number, number][],
  label: string,
  pinLabels: string[],
  leftPins: number[],
  rightPins: number[],
  opt: DrawOpt
) {
  // bbox from all posts
  let left = Infinity, right = -Infinity, top = Infinity, bot = -Infinity;
  for (const p of posts) {
    left = Math.min(left, p[0]); right = Math.max(right, p[0]);
    top = Math.min(top, p[1]); bot = Math.max(bot, p[1]);
  }
  const pad = 10;
  const bx = left + pad, by = top + pad, bw = right - left - pad * 2, bh = bot - top - pad * 2;
  ctx.beginPath();
  ctx.rect(bx, by, bw, bh);
  ctx.save();
  ctx.fillStyle = palette.body;
  ctx.fill();
  ctx.restore();
  ctx.stroke();
  for (const i of leftPins) {
    line(ctx, posts[i], [bx, posts[i][1]]);
  }
  for (const i of rightPins) {
    line(ctx, posts[i], [bx + bw, posts[i][1]]);
  }
  void opt; void label; void pinLabels;
}

function drawTransformer(ctx: CanvasRenderingContext2D, posts: [number, number][], flags: number) {
  const [p0, p1, p2, p3] = posts;
  if (!p0 || !p1 || !p2 || !p3) return;
  // p0→p2 is the primary winding, p1→p3 the secondary. Both axes are parallel
  // in layoutPosts, so the primary direction drives every lead and core line.
  const [ux, uy] = norm(p0, p2);
  const px = -uy, py = ux;
  const sep = (p1[0] - p0[0]) * px + (p1[1] - p0[1]) * py;
  const side = sep >= 0 ? 1 : -1; // +px points toward the secondary
  const L = dist(p0, p2);
  const lead = Math.max(6, Math.min(12, L * 0.18));

  const priA: [number, number] = [p0[0] + ux * lead, p0[1] + uy * lead];
  const priB: [number, number] = [p2[0] - ux * lead, p2[1] - uy * lead];
  const secA: [number, number] = [p1[0] + ux * lead, p1[1] + uy * lead];
  const secB: [number, number] = [p3[0] - ux * lead, p3[1] - uy * lead];

  // Leads now follow the post axis at any rotation (the old version drew them
  // straight down, which left them detached from a rotated coil).
  line(ctx, p0, priA); line(ctx, priB, p2);
  line(ctx, p1, secA); line(ctx, secB, p3);

  const drawCoil = (a: [number, number], b: [number, number], bulge: number) => {
    const len = dist(a, b);
    const [cx, cy] = norm(a, b);
    const ox = -cy * bulge, oy = cx * bulge;
    const humps = Math.max(3, Math.round(len / 12));
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    for (let i = 0; i < humps; i++) {
      const t0 = (len * i) / humps, t1 = (len * (i + 1)) / humps;
      const hx = a[0] + cx * ((t0 + t1) / 2) + ox;
      const hy = a[1] + cy * ((t0 + t1) / 2) + oy;
      ctx.quadraticCurveTo(hx, hy, a[0] + cx * t1, a[1] + cy * t1);
    }
    ctx.stroke();
  };

  const isCT = (flags & F_CT) !== 0;
  if (isCT) {
    // A CT primary is a single straight conductor through the core.
    line(ctx, priA, priB);
    const am = mid(priA, priB);
    const ah = 6;
    line(ctx, [am[0] - ux * ah + px * ah * 0.6, am[1] - uy * ah + py * ah * 0.6], am);
    line(ctx, [am[0] - ux * ah - px * ah * 0.6, am[1] - uy * ah - py * ah * 0.6], am);
  } else {
    drawCoil(priA, priB, -side * 8);
  }
  drawCoil(secA, secB, side * 8);

  // Two core lines between the windings, parallel to the winding axis offset.
  const gap = 4;
  const c0: [number, number] = [priA[0] + px * side * gap, priA[1] + py * side * gap];
  const c1: [number, number] = [secA[0] - px * side * gap, secA[1] - py * side * gap];
  const d0: [number, number] = [priB[0] + px * side * gap, priB[1] + py * side * gap];
  const d1: [number, number] = [secB[0] - px * side * gap, secB[1] - py * side * gap];
  const off = Math.min(5, L * 0.08);
  line(ctx, c0, c1); line(ctx, d0, d1);
  line(ctx, [c0[0] + ux * off, c0[1] + uy * off], [c1[0] + ux * off, c1[1] + uy * off]);
  line(ctx, [d0[0] + ux * off, d0[1] + uy * off], [d1[0] + ux * off, d1[1] + uy * off]);
}

// ---------------- sources & single-post ----------------

/** Two-cell DC battery: long/short plate pairs, positive plate by post 0. */
function drawBattery(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number]) {
  const L = dist(a, b);
  if (L < 1) return;
  const [ux, uy] = norm(a, b);
  const px = -uy, py = ux;
  const scale = Math.min(1, L / 48);
  const gap = 6 * scale;
  const c = mid(a, b);
  const centers: [number, number][] = [-1.5, -0.5, 0.5, 1.5].map(
    (t) => [c[0] + ux * gap * t, c[1] + uy * gap * t]
  );
  const half = [13, 7, 13, 7].map((h) => h * scale);

  line(ctx, a, centers[0]);
  for (let i = 0; i < centers.length; i++) {
    const p = centers[i];
    line(ctx, [p[0] - px * half[i], p[1] - py * half[i]], [p[0] + px * half[i], p[1] + py * half[i]]);
  }
  line(ctx, centers[centers.length - 1], b);
}

function drawVoltageSource(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number], flags: number, params: number[], opt: DrawOpt) {
  const L = dist(a, b);
  const [ux, uy] = norm(a, b);
  const r = Math.min(13, L * 0.3);
  const c: [number, number] = [a[0] + ux * (L / 2), a[1] + uy * (L / 2)];
  line(ctx, a, [c[0] - ux * r, c[1] - uy * r]);
  line(ctx, [c[0] + ux * r, c[1] + uy * r], b);
  ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI * 2); ctx.stroke();
  const wf = flags & 0xff;
  if (wf === WF_AC) {
    ctx.beginPath();
    for (let i = 0; i <= 16; i++) {
      const t = i / 16;
      const x = c[0] - 7 + t * 14;
      const y = c[1] - Math.sin(t * Math.PI * 2) * 6;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else if (wf === WF_SQUARE) {
    ctx.beginPath();
    ctx.moveTo(c[0] - 7, c[1] + 4);
    ctx.lineTo(c[0] - 3, c[1] + 4);
    ctx.lineTo(c[0] - 3, c[1] - 4);
    ctx.lineTo(c[0] + 2, c[1] - 4);
    ctx.lineTo(c[0] + 2, c[1] + 4);
    ctx.lineTo(c[0] + 7, c[1] + 4);
    ctx.stroke();
  } else if (wf === WF_TRIANGLE) {
    ctx.beginPath();
    ctx.moveTo(c[0] - 7, c[1] + 4);
    ctx.lineTo(c[0] - 2, c[1] - 4);
    ctx.lineTo(c[0] + 3, c[1] + 4);
    ctx.lineTo(c[0] + 7, c[1] - 4);
    ctx.stroke();
  } else if (wf === WF_SAWTOOTH) {
    ctx.beginPath();
    ctx.moveTo(c[0] - 7, c[1] + 4);
    ctx.lineTo(c[0] + 2, c[1] - 4);
    ctx.lineTo(c[0] + 2, c[1] + 4);
    ctx.lineTo(c[0] + 7, c[1] - 2);
    ctx.stroke();
  } else if (wf === WF_PULSE) {
    ctx.beginPath();
    ctx.moveTo(c[0] - 7, c[1] + 4);
    ctx.lineTo(c[0] - 4, c[1] + 4);
    ctx.lineTo(c[0] - 4, c[1] - 4);
    ctx.lineTo(c[0] + 1, c[1] - 4);
    ctx.lineTo(c[0] + 1, c[1] + 4);
    ctx.stroke();
  } else {
    // DC battery plates
    line(ctx, [c[0] - 3, c[1] - 6], [c[0] - 3, c[1] + 6]);
    line(ctx, [c[0] + 3, c[1] - 3], [c[0] + 3, c[1] + 3]);
  }
  void params; void opt;
}

function drawCurrentSource(ctx: CanvasRenderingContext2D, a: [number, number], b: [number, number]) {
  const L = dist(a, b);
  const [ux, uy] = norm(a, b);
  const px = -uy, py = ux;
  const r = Math.min(13, L * 0.3);
  const c: [number, number] = [a[0] + ux * (L / 2), a[1] + uy * (L / 2)];
  line(ctx, a, [c[0] - ux * r, c[1] - uy * r]);
  line(ctx, [c[0] + ux * r, c[1] + uy * r], b);
  ctx.beginPath(); ctx.arc(c[0], c[1], r, 0, Math.PI * 2); ctx.stroke();
  // arrow
  ctx.beginPath();
  ctx.moveTo(c[0] - ux * 6 + px * 3.5, c[1] - uy * 6 + py * 3.5);
  ctx.lineTo(c[0] + ux * 6, c[1] + uy * 6);
  ctx.lineTo(c[0] - ux * 6 - px * 3.5, c[1] - uy * 6 - py * 3.5);
  ctx.closePath();
  ctx.fill();
}

function drawRail(ctx: CanvasRenderingContext2D, p: [number, number], params: number[], opt: DrawOpt) {
  const v = params[0] ?? 5;
  // T bar pointing down toward the post (post at bottom)
  line(ctx, [p[0] - 9, p[1] - 10], [p[0] + 9, p[1] - 10]);
  line(ctx, [p[0], p[1] - 10], p);
  void v; void opt;
}

function drawGround(ctx: CanvasRenderingContext2D, p: [number, number]) {
  line(ctx, p, [p[0], p[1] + 8]);
  line(ctx, [p[0] - 10, p[1] + 8], [p[0] + 10, p[1] + 8]);
  line(ctx, [p[0] - 6, p[1] + 12], [p[0] + 6, p[1] + 12]);
  line(ctx, [p[0] - 2.5, p[1] + 16], [p[0] + 2.5, p[1] + 16]);
}

/** Handle rectangle for a Z-AVO probe tip (shared with hit-testing). */
export function probeHandleRect(p: [number, number]): { x: number; y: number; w: number; h: number } {
  return { x: p[0] + 7, y: p[1] - 32, w: 46, h: 18 };
}

function drawProbe(
  ctx: CanvasRenderingContext2D,
  p: [number, number],
  color: string,
  dark: boolean
) {
  const r = probeHandleRect(p);
  const cy = r.y + r.h / 2;
  // lead from the tip up to the handle
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  ctx.lineTo(r.x + 5, cy);
  ctx.strokeStyle = dark ? palette.probeBlackLead : color;
  ctx.lineWidth = 2;
  ctx.stroke();
  // handle
  ctx.beginPath();
  ctx.roundRect(r.x, r.y, r.w, r.h, 5);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = dark ? palette.probeBlackStroke : '#fca5a5';
  ctx.lineWidth = 1;
  ctx.stroke();
  // tip contact
  ctx.beginPath();
  ctx.arc(p[0], p[1], 4, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = palette.probeTip;
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

function drawLogicInput(ctx: CanvasRenderingContext2D, p: [number, number], flags: number, params: number[], opt: DrawOpt) {
  const hi = (flags & F_CLOSED) !== 0;
  ctx.beginPath();
  ctx.rect(p[0] - 14, p[1] - 24, 28, 18);
  ctx.save();
  ctx.fillStyle = hi ? palette.logicHigh : palette.body;
  ctx.fill();
  ctx.restore();
  ctx.stroke();
  line(ctx, p, [p[0], p[1] - 6]);
  ctx.fillStyle = base(opt);
  void params;
}

function drawClockInput(ctx: CanvasRenderingContext2D, p: [number, number], params: number[], opt: DrawOpt) {
  ctx.beginPath();
  ctx.rect(p[0] - 14, p[1] - 24, 28, 18);
  ctx.save();
  ctx.fillStyle = palette.body;
  ctx.fill();
  ctx.restore();
  ctx.stroke();
  // clock glyph
  ctx.beginPath();
  ctx.moveTo(p[0] - 9, p[1] - 9);
  ctx.lineTo(p[0] - 4, p[1] - 9);
  ctx.lineTo(p[0] - 4, p[1] - 21);
  ctx.lineTo(p[0] + 3, p[1] - 21);
  ctx.lineTo(p[0] + 3, p[1] - 9);
  ctx.lineTo(p[0] + 9, p[1] - 9);
  ctx.stroke();
  line(ctx, p, [p[0], p[1] - 6]);
}

function drawLogicOutput(ctx: CanvasRenderingContext2D, p: [number, number], opt: DrawOpt) {
  const hi = (opt.stateFlags & 1) !== 0;
  ctx.beginPath();
  ctx.rect(p[0] - 14, p[1] - 24, 28, 18);
  ctx.save();
  ctx.fillStyle = palette.body;
  ctx.fill();
  ctx.restore();
  ctx.stroke();
  ctx.save();
  ctx.fillStyle = hi ? palette.on : palette.off;
  ctx.beginPath();
  ctx.arc(p[0], p[1] - 15, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  line(ctx, p, [p[0], p[1] - 6]);
}

// ---------------- labels ----------------

// ---------------- text labels (drawn in a dedicated pass so they are never covered) ----------------

export interface ElmLabel {
  text: string;
  x: number;
  y: number;
  color: string;
  font: string;
  align: CanvasTextAlign;
  /**
   * Value labels (readouts such as "1 kΩ" or "5 V") can be dragged by the user
   * so they can be moved away from wires or nearby components. Structural
   * labels (pin names, "+"/"-", meter letters) stay pinned to the symbol.
   */
  movable?: boolean;
  /**
   * "readout" marks live instrument measurements (A/V/Ω meters, probe
   * voltage). They are rendered with a brighter, heavier style and a small
   * dark pill so they stand out from ordinary component values.
   */
  kind?: 'value' | 'readout';
}

const FONT_VALUE = '10px ui-monospace, monospace';
const FONT_UI = '10px ui-sans-serif, system-ui';
const FONT_SMALL = '9px ui-sans-serif';
const FONT_METER = '11px ui-sans-serif, system-ui';
const FONT_READOUT = '600 11px ui-monospace, monospace';

/**
 * All text labels for one element. Rendered in a separate top-most pass by the
 * simulator so component fills can never cover them. `measured` carries the
 * live per-frame outputs (vd across the element, current through it).
 */
export function elementLabels(
  type: number,
  flags: number,
  posts: [number, number][],
  params: number[],
  showValues: boolean,
  selected: boolean,
  measured: { vd: number; cur: number }
): ElmLabel[] {
  const out: ElmLabel[] = [];
  const baseColor = selected ? palette.select : palette.base;
  const a = posts[0];
  const b = posts[1];
  const push = (
    text: string,
    x: number,
    y: number,
    color: string,
    font: string = FONT_VALUE,
    align: CanvasTextAlign = 'center',
    movable = true
  ) => out.push({ text, x, y, color, font, align, movable });

  /** Live measurement readout: brighter, bolder, and drawn on a small pill. */
  const pushReadout = (text: string, x: number, y: number, align: CanvasTextAlign = 'center') =>
    out.push({
      text,
      x,
      y,
      color: palette.readout,
      font: FONT_READOUT,
      align,
      movable: true,
      kind: 'readout',
    });

  switch (type) {
    case T.POT: {
      if (!showValues || !b) break;
      const m = mid(a, b);
      const [ux, uy] = norm(a, b);
      const pos = Math.max(0, Math.min(1, params[1] !== undefined ? params[1] : 0.5));
      push(`${fmtValue(params[0], 'Ω')} · ${Math.round(pos * 100)}%`, m[0] + -uy * 26, m[1] + ux * 26, palette.value);
      break;
    }
    case T.RESISTOR:
    case T.LAMP:
    case T.CURRENT:
    case T.SPARK_GAP: {
      if (!showValues || !b) break;
      const m = mid(a, b);
      const [ux, uy] = norm(a, b);
      const text =
        type === T.CURRENT ? fmtValue(params[0], 'A')
        : type === T.SPARK_GAP ? fmtValue(params[0], 'V')
        : fmtValue(params[0], 'Ω');
      // meter circles (r=13) need a wider offset so the text clears the symbol
      const d = type === T.CURRENT ? 36 : 26;
      push(text, m[0] + -uy * d, m[1] + ux * d, palette.value);
      break;
    }
    case T.CAPACITOR: {
      if (!showValues || !b) break;
      const m = mid(a, b);
      const [ux, uy] = norm(a, b);
      push(fmtValue(params[0], 'F'), m[0] + -uy * 26, m[1] + ux * 26, palette.value);
      break;
    }
    case T.INDUCTOR: {
      if (!showValues || !b) break;
      const m = mid(a, b);
      const [ux, uy] = norm(a, b);
      push(fmtValue(params[0], 'H'), m[0] + -uy * 26, m[1] + ux * 26, palette.value);
      break;
    }
    case T.TRANSFORMER: {
      const m = mid(a, b);
      if ((flags & F_CT) !== 0 && posts[2]) {
        const c = mid(a, posts[2]);
        const [ux, uy] = norm(a, posts[2]);
        push('CT', c[0] - uy * 15, c[1] + ux * 15, baseColor, FONT_SMALL, 'center', false);
      }
      if (showValues) push(`1:${params[1] ?? 1}`, m[0], m[1], palette.value);
      break;
    }
    case T.VOLTAGE: {
      if (!showValues || !b) break;
      const m = mid(a, b);
      const [ux, uy] = norm(a, b);
      const wf = flags & 0xff;
      const text = wf === 0 ? fmtValue(params[1], 'V') : `${fmtValue(params[1], 'V')} ${fmtValue(params[0], 'Hz')}`;
      push(text, m[0] + -uy * 36, m[1] + ux * 36, palette.value);
      break;
    }
    case T.BATTERY_DC: {
      if (!b) break;
      const m = mid(a, b);
      const [ux, uy] = norm(a, b);
      const px = -uy, py = ux;
      const gap = Math.min(6, dist(a, b) / 8);
      const plus: [number, number] = [m[0] - ux * gap * 1.5 + px * 17, m[1] - uy * gap * 1.5 + py * 17];
      const minus: [number, number] = [m[0] + ux * gap * 1.5 + px * 17, m[1] + uy * gap * 1.5 + py * 17];
      push('+', plus[0], plus[1], baseColor, FONT_UI, 'center', false);
      push('\u2212', minus[0], minus[1], baseColor, FONT_UI, 'center', false);
      if (showValues) push(fmtValue(params[1], 'V'), m[0] + px * 36, m[1] + py * 36, palette.value);
      break;
    }
    case T.RAIL: {
      const v = params[0] ?? 5;
      push(fmtValue(v, 'V'), a[0], a[1] - 20, v >= 0 ? palette.wirePositive : palette.wireNegative, FONT_UI);
      break;
    }
    case T.LOGIC_INPUT: {
      const hi = (flags & F_CLOSED) !== 0;
      push(hi ? 'H 1' : 'L 0', a[0], a[1] - 15, hi ? palette.logicHighText : palette.value, FONT_VALUE);
      break;
    }
    case T.CLOCK_INPUT: {
      push(fmtValue(params[1] ?? 100, 'Hz'), a[0], a[1] - 30, palette.value, FONT_SMALL);
      break;
    }
    case T.OPAMP:
    case T.COMPARATOR: {
      const minus = posts[0], plus = posts[1], outP = posts[2];
      const dx = outP[0] >= minus[0] ? 8 : -8;
      push('-', minus[0] + dx, minus[1], baseColor, FONT_UI, 'center', false);
      push('+', plus[0] + dx, plus[1], baseColor, FONT_UI, 'center', false);
      break;
    }
    case T.AMMETER: {
      const m = b ? mid(a, b) : a;
      push('A', m[0], m[1], baseColor, FONT_METER, 'center', false);
      if (showValues) pushReadout(fmtValue(measured.cur, 'A'), m[0], m[1] + 25);
      break;
    }
    case T.VOLTMETER: {
      const m = b ? mid(a, b) : a;
      push('V', m[0], m[1], baseColor, FONT_METER, 'center', false);
      if (showValues) pushReadout(fmtValue(measured.vd, 'V'), m[0], m[1] + 25);
      break;
    }
    case T.OHMMETER: {
      const m = b ? mid(a, b) : a;
      push('R', m[0], m[1], baseColor, FONT_METER, 'center', false);
      if (showValues) {
        const r = Math.abs(measured.cur) > 1e-12 ? measured.vd / measured.cur : Infinity;
        pushReadout(Number.isFinite(r) ? fmtValue(r, 'Ω') : '∞ Ω', m[0], m[1] + 25);
      }
      break;
    }
    case T.PROBE_RED: {
      const r = probeHandleRect(a);
      push('VΩHz', r.x + r.w / 2, r.y + r.h / 2, '#fff5f5', FONT_SMALL, 'center', false);
      if (showValues) {
        pushReadout(fmtValue(measured.vd, 'V'), r.x + r.w + 5, r.y + r.h / 2, 'left');
      }
      break;
    }
    case T.PROBE_BLACK: {
      const r = probeHandleRect(a);
      push('COM', r.x + r.w / 2, r.y + r.h / 2, '#e4e4e7', FONT_SMALL, 'center', false);
      break;
    }
    case T.DFF:
    case T.ADC:
    case T.DAC: {
      const cfg = type === T.DFF
        ? { label: 'DFF', pins: ['D', '>', 'Q', 'Q\u0305'], left: [0, 1], right: [2, 3] }
        : type === T.ADC
          ? { label: 'ADC', pins: ['IN', '0', '1', '2', '3'], left: [0], right: [1, 2, 3, 4] }
          : { label: 'DAC', pins: ['0', '1', '2', '3', 'OUT'], left: [0, 1, 2, 3], right: [4] };
      let left = Infinity, right = -Infinity, top = Infinity;
      for (const p of posts) {
        left = Math.min(left, p[0]);
        right = Math.max(right, p[0]);
        top = Math.min(top, p[1]);
      }
      const pad = 10;
      const bx = left + pad, by = top + pad, bw = right - left - pad * 2;
      push(cfg.label, bx + bw / 2, by + 8, baseColor, FONT_UI, 'center', false);
      for (const i of cfg.left) {
        if (cfg.pins[i]) push(cfg.pins[i], bx + 4, posts[i][1], baseColor, FONT_UI, 'left', false);
      }
      for (const i of cfg.right) {
        if (cfg.pins[i]) push(cfg.pins[i], bx + bw - 4, posts[i][1], baseColor, FONT_UI, 'right', false);
      }
      break;
    }
    case T.IC_DUMMY: {
      const g = icGeometry(posts);
      if (!g) break;
      push('IC', (g.sx + g.ex) / 2, (g.sy + g.ey) / 2, baseColor, FONT_UI, 'center', false);
      for (let i = 0; i < 4; i++) {
        push(
          String(i + 1),
          g.sx + g.dx * 9 + g.vx * g.offsets[i],
          g.sy + g.dy * 9 + g.vy * g.offsets[i],
          baseColor, FONT_SMALL, 'center', false
        );
      }
      break;
    }
  }
  return out;
}

// current dots (animated) for 2-terminal elements
export function drawCurrentDots(
  ctx: CanvasRenderingContext2D,
  a: [number, number],
  b: [number, number],
  current: number,
  phase: number
): void {
  const L = dist(a, b);
  if (L < 10 || Math.abs(current) < 1e-10) return;
  const [ux, uy] = norm(a, b);
  const spacing = 22;
  const n = Math.floor(L / spacing);
  const dir = current >= 0 ? 1 : -1;
  // log-scaled speed so µA..A ranges all stay visible; gentle baseline so
  // ordinary mA currents drift at a calm pace (phase advances ~1px/frame)
  const speed = Math.min(2, 0.3 + (1.5 * Math.log10(1 + Math.abs(current) / 1e-6)) / 6);
  ctx.save();
  for (let i = 0; i <= n; i++) {
    let t = (i * spacing + (phase * speed) % spacing) / L;
    if (dir < 0) t = 1 - t;
    if (t < 0 || t > 1) continue;
    const x = a[0] + ux * L * t;
    const y = a[1] + uy * L * t;
    ctx.fillStyle = palette.dotTrail;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = palette.dot;
    ctx.beginPath();
    ctx.arc(x, y, 2.2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
