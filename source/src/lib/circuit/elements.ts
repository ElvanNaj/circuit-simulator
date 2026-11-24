// Element metadata: type ids (must match engine/src/elements.rs), names,
// categories, default params, and edit dialog fields.

export const T = {
  WIRE: 1,
  GROUND: 2,
  RESISTOR: 3,
  CAPACITOR: 4,
  INDUCTOR: 5,
  VOLTAGE: 6,
  CURRENT: 7,
  RAIL: 8,
  SWITCH: 9,
  POT: 10,
  LAMP: 11,
  DIODE: 12,
  LED: 13,
  ZENER: 14,
  TRANSISTOR: 15,
  MOSFET: 16,
  OPAMP: 17,
  COMPARATOR: 18,
  AND: 19,
  OR: 20,
  NAND: 21,
  NOR: 22,
  XOR: 23,
  XNOR: 24,
  INVERTER: 25,
  BUFFER: 26,
  LOGIC_INPUT: 27,
  CLOCK_INPUT: 28,
  LOGIC_OUTPUT: 29,
  DFF: 30,
  ADC: 31,
  DAC: 32,
  TRANSFORMER: 33,
  SPARK_GAP: 34,
  AMMETER: 35,
  VOLTMETER: 36,
  OHMMETER: 37,
  // 4-pin visual placeholder. The engine reserves this type as a no-op with
  // four independent nodes, so wires on all four pins stay aligned with JS.
  IC_DUMMY: 103,
  // JS-only "instrument" elements: they are never sent to the engine as-is.
  // The simulator maps them to no-op / voltmeter elements when building the
  // WASM element list, so they can mark a node without disturbing the circuit.
  PROBE_RED: 101,
  PROBE_BLACK: 102,
  // Drawn as a DC battery; sent to the engine as T.VOLTAGE with identical
  // params, so in-place value edits and scope channels keep working.
  BATTERY_DC: 104,
} as const;

/** True for elements that exist only in the editor (Z-AVO probes). */
export function isProbeType(type: number): boolean {
  return type === T.PROBE_RED || type === T.PROBE_BLACK;
}

// flag bits (must match engine)
export const F_CLOSED = 1;
export const F_MOMENTARY = 2;
export const F_PNP = 0x100;
export const WF_DC = 0,
  WF_AC = 1,
  WF_SQUARE = 2,
  WF_TRIANGLE = 3,
  WF_SAWTOOTH = 4,
  WF_PULSE = 5;

export interface EditField {
  label: string;
  param: number; // index into params[]
  unit: string;
  kind?: 'number' | 'choice';
  choices?: { label: string; value: number }[]; // for waveform selection (writes flags)
  flagsMask?: number; // for choice fields stored in flags
  step?: string;
}

export interface ElemMeta {
  type: number;
  name: string;
  category: 'Passive' | 'Sources' | 'Probes' | 'Active' | 'Logic' | 'Other';
  posts: number;
  defaults: { params: number[]; flags?: number };
  edits?: EditField[];
  scopeable?: boolean;
}

const waveformField: EditField = {
  label: 'Waveform',
  param: -1,
  unit: '',
  kind: 'choice',
  choices: [
    { label: 'DC', value: WF_DC },
    { label: 'AC (Sine)', value: WF_AC },
    { label: 'Square', value: WF_SQUARE },
    { label: 'Triangle', value: WF_TRIANGLE },
    { label: 'Sawtooth', value: WF_SAWTOOTH },
    { label: 'Pulse', value: WF_PULSE },
  ],
  flagsMask: 0xff,
};

export const ELEMENT_META: ElemMeta[] = [
  {
    type: T.WIRE,
    name: 'Wire',
    category: 'Passive',
    posts: 2,
    defaults: { params: [] },
  },
  {
    type: T.RESISTOR,
    name: 'Resistor',
    category: 'Passive',
    posts: 2,
    defaults: { params: [1000] },
    edits: [{ label: 'Resistance', param: 0, unit: 'Ω' }],
    scopeable: true,
  },
  {
    type: T.CAPACITOR,
    name: 'Capacitor',
    category: 'Passive',
    posts: 2,
    defaults: { params: [1e-5, 0.001] },
    edits: [
      { label: 'Capacitance', param: 0, unit: 'F' },
      { label: 'Initial Voltage', param: 1, unit: 'V' },
    ],
    scopeable: true,
  },
  {
    type: T.INDUCTOR,
    name: 'Inductor',
    category: 'Passive',
    posts: 2,
    defaults: { params: [0.001, 0] },
    edits: [
      { label: 'Inductance', param: 0, unit: 'H' },
      { label: 'Initial Current', param: 1, unit: 'A' },
    ],
    scopeable: true,
  },
  {
    type: T.POT,
    name: 'Potentiometer',
    category: 'Passive',
    posts: 3,
    defaults: { params: [1000, 0.5] },
    edits: [
      { label: 'Resistance', param: 0, unit: 'Ω' },
      { label: 'Wiper Position', param: 1, unit: '0–1' },
    ],
    scopeable: true,
  },
  {
    type: T.SWITCH,
    name: 'Switch',
    category: 'Passive',
    posts: 2,
    defaults: { params: [0], flags: 0 },
    edits: [{ label: 'On Resistance', param: 0, unit: 'Ω' }],
    scopeable: true,
  },
  {
    type: T.LAMP,
    name: 'Lamp',
    category: 'Passive',
    posts: 2,
    defaults: { params: [100] },
    edits: [{ label: 'Resistance', param: 0, unit: 'Ω' }],
    scopeable: true,
  },
  {
    type: T.GROUND,
    name: 'Ground',
    category: 'Sources',
    posts: 1,
    defaults: { params: [] },
  },
  {
    type: T.VOLTAGE,
    name: 'Voltage Source',
    category: 'Sources',
    posts: 2,
    defaults: { params: [40, 5, 0, 0, 0.5], flags: WF_DC },
    edits: [
      waveformField,
      { label: 'Frequency', param: 0, unit: 'Hz' },
      { label: 'Peak Voltage', param: 1, unit: 'V' },
      { label: 'DC Offset / Bias', param: 2, unit: 'V' },
      { label: 'Phase Shift', param: 3, unit: '°', step: 'any' },
      { label: 'Duty Cycle', param: 4, unit: '' },
    ],
    scopeable: true,
  },
  {
    type: T.BATTERY_DC,
    name: 'DC Battery',
    category: 'Sources',
    posts: 2,
    // Same layout as T.VOLTAGE: [freq, peak, offset, phase, duty]. Only the
    // peak voltage is editable and flags stay WF_DC.
    defaults: { params: [0, 5, 0, 0, 0.5], flags: WF_DC },
    edits: [{ label: 'Voltage', param: 1, unit: 'V' }],
    scopeable: true,
  },
  {
    type: T.CURRENT,
    name: 'Current Source',
    category: 'Sources',
    posts: 2,
    defaults: { params: [0.01] },
    edits: [{ label: 'Current', param: 0, unit: 'A' }],
    scopeable: true,
  },
  {
    type: T.RAIL,
    name: 'Voltage Rail',
    category: 'Sources',
    posts: 1,
    defaults: { params: [5] },
    edits: [{ label: 'Voltage', param: 0, unit: 'V' }],
    scopeable: true,
  },
  {
    type: T.DIODE,
    name: 'Diode',
    category: 'Active',
    posts: 2,
    defaults: { params: [1.7143528192808883e-7, 0, 0, 2] }, // Is, breakdown, seriesR, N
    edits: [
      { label: 'Saturation Current', param: 0, unit: 'A' },
      { label: 'Breakdown Voltage', param: 1, unit: 'V' },
      { label: 'Emission Coeff N', param: 3, unit: '' },
    ],
    scopeable: true,
  },
  {
    type: T.LED,
    name: 'LED',
    category: 'Active',
    posts: 2,
    defaults: { params: [2.7625090758684215e-34, 0, 0, 1] }, // fwdrop 2V @ N=1
    edits: [{ label: 'Saturation Current', param: 0, unit: 'A' }],
    scopeable: true,
  },
  {
    type: T.ZENER,
    name: 'Zener Diode',
    category: 'Active',
    posts: 2,
    defaults: { params: [1.7143528192808883e-7, 5.1, 0, 2] },
    edits: [
      { label: 'Saturation Current', param: 0, unit: 'A' },
      { label: 'Breakdown Voltage', param: 1, unit: 'V' },
    ],
    scopeable: true,
  },
  {
    type: T.TRANSISTOR,
    name: 'NPN Transistor',
    category: 'Active',
    posts: 3,
    defaults: { params: [100, 1e-13], flags: 0 }, // beta, Is
    edits: [
      { label: 'Beta (hFE)', param: 0, unit: '' },
      { label: 'Saturation Current', param: 1, unit: 'A' },
    ],
    scopeable: true,
  },
  {
    type: T.MOSFET,
    name: 'N-MOSFET',
    category: 'Active',
    posts: 3,
    defaults: { params: [1.5, 0.02], flags: 0 }, // Vt, beta
    edits: [
      { label: 'Threshold Voltage', param: 0, unit: 'V' },
      { label: 'Beta', param: 1, unit: 'A/V²' },
    ],
    scopeable: true,
  },
  {
    type: T.OPAMP,
    name: 'Op-Amp',
    category: 'Active',
    posts: 3,
    defaults: { params: [15, -15, 100000] }, // max, min, gain
    edits: [
      { label: 'Max Output', param: 0, unit: 'V' },
      { label: 'Min Output', param: 1, unit: 'V' },
      { label: 'Gain', param: 2, unit: '' },
    ],
    scopeable: true,
  },
  {
    type: T.COMPARATOR,
    name: 'Comparator',
    category: 'Active',
    posts: 3,
    defaults: { params: [15, -15] }, // high, low
    edits: [
      { label: 'High Output', param: 0, unit: 'V' },
      { label: 'Low Output', param: 1, unit: 'V' },
    ],
    scopeable: true,
  },
  {
    type: T.TRANSFORMER,
    name: 'Transformer',
    category: 'Active',
    posts: 4,
    defaults: { params: [0.004, 1, 0.999] }, // L1, ratio, coupling
    edits: [
      { label: 'Primary Inductance', param: 0, unit: 'H' },
      { label: 'Turns Ratio', param: 1, unit: '' },
      { label: 'Coupling Coefficient', param: 2, unit: '' },
    ],
    scopeable: true,
  },
  {
    type: T.IC_DUMMY,
    name: 'Generic IC',
    category: 'Active',
    posts: 4,
    // Dummy footprint: four pins on the left edge, no parameters, no scope.
    defaults: { params: [] },
  },
  {
    type: T.SPARK_GAP,
    name: 'Spark Gap',
    category: 'Other',
    posts: 2,
    defaults: { params: [1000] },
    edits: [{ label: 'Breakdown Voltage', param: 0, unit: 'V' }],
    scopeable: true,
  },
  {
    type: T.AMMETER,
    name: 'Ammeter',
    category: 'Probes',
    posts: 2,
    defaults: { params: [] },
    scopeable: true,
  },
  {
    type: T.VOLTMETER,
    name: 'Voltmeter',
    category: 'Probes',
    posts: 2,
    defaults: { params: [] },
    scopeable: true,
  },
  {
    type: T.OHMMETER,
    name: 'Ohmmeter',
    category: 'Probes',
    posts: 2,
    defaults: { params: [] },
    scopeable: true,
  },
  {
    type: T.PROBE_RED,
    name: 'Probe Red',
    category: 'Probes',
    posts: 1,
    defaults: { params: [] },
  },
  {
    type: T.PROBE_BLACK,
    name: 'Probe Black',
    category: 'Probes',
    posts: 1,
    defaults: { params: [] },
  },
  // PNP / PMOS variants (same engine types, PNP flag set)
  {
    type: T.TRANSISTOR,
    name: 'PNP Transistor',
    category: 'Active',
    posts: 3,
    defaults: { params: [100, 1e-13], flags: F_PNP },
    edits: [
      { label: 'Beta (hFE)', param: 0, unit: '' },
      { label: 'Saturation Current', param: 1, unit: 'A' },
    ],
    scopeable: true,
  },
  {
    type: T.MOSFET,
    name: 'P-MOSFET',
    category: 'Active',
    posts: 3,
    defaults: { params: [1.5, 0.02], flags: F_PNP },
    edits: [
      { label: 'Threshold Voltage', param: 0, unit: 'V' },
      { label: 'Beta', param: 1, unit: 'A/V²' },
    ],
    scopeable: true,
  },
  // Logic
  ...[
    [T.AND, 'AND Gate'],
    [T.OR, 'OR Gate'],
    [T.NAND, 'NAND Gate'],
    [T.NOR, 'NOR Gate'],
    [T.XOR, 'XOR Gate'],
    [T.XNOR, 'XNOR Gate'],
  ].map(([type, name]) => ({
    type: type as number,
    name: name as string,
    category: 'Logic' as const,
    posts: 3,
    defaults: { params: [5], flags: 2 }, // 2 inputs
    edits: [
      { label: 'Input Count', param: -2, unit: '', kind: 'choice' as const, choices: [2, 3, 4].map((n) => ({ label: String(n), value: n })), flagsMask: 0xff },
      { label: 'High Logic Voltage', param: 0, unit: 'V' },
    ],
    scopeable: true,
  })),
  {
    type: T.INVERTER,
    name: 'Inverter',
    category: 'Logic',
    posts: 2,
    defaults: { params: [5] },
    edits: [{ label: 'High Logic Voltage', param: 0, unit: 'V' }],
    scopeable: true,
  },
  {
    type: T.BUFFER,
    name: 'Buffer',
    category: 'Logic',
    posts: 2,
    defaults: { params: [5] },
    edits: [{ label: 'High Logic Voltage', param: 0, unit: 'V' }],
    scopeable: true,
  },
  {
    type: T.LOGIC_INPUT,
    name: 'Logic Input',
    category: 'Logic',
    posts: 1,
    defaults: { params: [5], flags: 0 },
    edits: [{ label: 'High Voltage', param: 0, unit: 'V' }],
    scopeable: true,
  },
  {
    type: T.CLOCK_INPUT,
    name: 'Clock Input',
    category: 'Logic',
    posts: 1,
    defaults: { params: [5, 100] },
    edits: [
      { label: 'High Voltage', param: 0, unit: 'V' },
      { label: 'Frequency', param: 1, unit: 'Hz' },
    ],
    scopeable: true,
  },
  {
    type: T.LOGIC_OUTPUT,
    name: 'Logic Output',
    category: 'Logic',
    posts: 1,
    defaults: { params: [5] },
    edits: [{ label: 'High Voltage', param: 0, unit: 'V' }],
    scopeable: true,
  },
  {
    type: T.DFF,
    name: 'D Flip-Flop',
    category: 'Logic',
    posts: 4,
    defaults: { params: [5] },
    edits: [{ label: 'High Voltage', param: 0, unit: 'V' }],
    scopeable: true,
  },
  {
    type: T.ADC,
    name: 'ADC (4-bit)',
    category: 'Logic',
    posts: 5,
    defaults: { params: [5] },
    edits: [{ label: 'Full Scale Voltage', param: 0, unit: 'V' }],
    scopeable: true,
  },
  {
    type: T.DAC,
    name: 'DAC (4-bit)',
    category: 'Logic',
    posts: 5,
    defaults: { params: [5] },
    edits: [{ label: 'Max Output Voltage', param: 0, unit: 'V' }],
    scopeable: true,
  },
];

export function metaByType(type: number, flags?: number): ElemMeta | undefined {
  if (type === T.TRANSISTOR) {
    return flags !== undefined && flags & F_PNP
      ? ELEMENT_META.find((m) => m.type === T.TRANSISTOR && m.name.startsWith('PNP'))
      : ELEMENT_META.find((m) => m.type === T.TRANSISTOR && m.name.startsWith('NPN'));
  }
  if (type === T.MOSFET) {
    return flags !== undefined && flags & F_PNP
      ? ELEMENT_META.find((m) => m.type === T.MOSFET && m.name.startsWith('P-'))
      : ELEMENT_META.find((m) => m.type === T.MOSFET && m.name.startsWith('N-'));
  }
  return ELEMENT_META.find((m) => m.type === type);
}

export const CATEGORIES: ElemMeta['category'][] = ['Passive', 'Sources', 'Probes', 'Active', 'Logic', 'Other'];

// ---- formatting helpers ----
export function fmtValue(v: number, unit: string): string {
  if (v === 0) return `0 ${unit}`;
  const abs = Math.abs(v);
  const prefixes: [number, string][] = [
    [1e9, 'G'],
    [1e6, 'M'],
    [1e3, 'k'],
    [1, ''],
    [1e-3, 'm'],
    [1e-6, 'µ'],
    [1e-9, 'n'],
    [1e-12, 'p'],
  ];
  for (const [scale, prefix] of prefixes) {
    if (abs >= scale || (scale === 1e-12 && abs < 1e-12)) {
      const val = v / scale;
      const a = Math.abs(val);
      let text: string;
      if (a >= 100) text = val.toFixed(0);
      else if (a >= 10) text = val.toFixed(1);
      else if (a >= 1) text = val.toFixed(2);
      else text = val.toPrecision(2);
      return `${text} ${prefix}${unit}`;
    }
  }
  return `${v.toPrecision(3)} ${unit}`;
}
