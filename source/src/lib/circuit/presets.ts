// Preset circuits — element lists on a 20px grid.
// Post conventions: VOLT post1 = "+", 2-terminal current flows post0 → post1.

import { T, WF_AC } from './elements';
import type { RawElem } from './engine';

export interface Preset {
  name: string;
  desc: string;
  build: () => RawElem[];
}

function el(etype: number, flags: number, posts: [number, number][], params: number[] = []): RawElem {
  return { etype, flags, posts, params };
}

function batt(a: [number, number], b: [number, number], v: number): RawElem {
  // post1 = positive terminal
  return el(T.VOLTAGE, 0, [a, b], [40, v, 0, 0, 0.5]);
}

function ac(a: [number, number], b: [number, number], v: number, f: number): RawElem {
  return el(T.VOLTAGE, WF_AC, [a, b], [f, v, 0, 0, 0.5]);
}

export const PRESETS: Preset[] = [
  {
    name: 'Voltage Divider',
    desc: 'Two resistors split 5 V into 2.5 V — Ohm\u2019s law in action',
    build: () => [
      batt([100, 200], [100, 100], 5),
      el(T.WIRE, 0, [[100, 100], [300, 100]]),
      el(T.RESISTOR, 0, [[300, 100], [300, 160]], [1000]),
      el(T.RESISTOR, 0, [[300, 160], [300, 220]], [1000]),
      el(T.WIRE, 0, [[100, 200], [300, 220]]),
      el(T.GROUND, 0, [[300, 220]]),
    ],
  },
  {
    name: 'RC Charging',
    desc: 'Capacitor charges through a resistor — flip the switch',
    build: () => [
      batt([100, 160], [100, 100], 5),
      el(T.WIRE, 0, [[100, 100], [160, 100]]),
      el(T.SWITCH, 1, [[160, 100], [220, 100]]),
      el(T.RESISTOR, 0, [[220, 100], [280, 100]], [1000]),
      el(T.CAPACITOR, 0, [[280, 100], [280, 160]], [1e-6, 0.001]),
      el(T.WIRE, 0, [[100, 160], [280, 160]]),
      el(T.GROUND, 0, [[280, 160]]),
    ],
  },
  {
    name: 'LC Resonant Tank',
    desc: 'Inductor + capacitor oscillate at f = 1/(2\u03c0\u221aLC) \u2248 503 Hz',
    build: () => [
      ac([100, 160], [100, 100], 5, 50),
      el(T.WIRE, 0, [[100, 100], [300, 100]]),
      el(T.INDUCTOR, 0, [[200, 100], [200, 160]], [0.001, 0]),
      el(T.CAPACITOR, 0, [[300, 100], [300, 160]], [1e-6, 0.001]),
      el(T.WIRE, 0, [[100, 160], [300, 160]]),
      el(T.GROUND, 0, [[300, 160]]),
    ],
  },
  {
    name: 'Half-Wave Rectifier',
    desc: 'Diode + filter capacitor turn AC into DC',
    build: () => [
      ac([100, 160], [100, 100], 10, 50),
      el(T.WIRE, 0, [[100, 100], [160, 100]]),
      el(T.DIODE, 0, [[160, 100], [220, 100]], [1.7143528192808883e-7, 0, 0, 2]),
      el(T.WIRE, 0, [[220, 100], [280, 100]]),
      el(T.WIRE, 0, [[280, 100], [340, 100]]),
      el(T.CAPACITOR, 0, [[280, 100], [280, 160]], [1e-5, 0.001]),
      el(T.RESISTOR, 0, [[340, 100], [340, 160]], [1000]),
      el(T.WIRE, 0, [[100, 160], [280, 160]]),
      el(T.WIRE, 0, [[280, 160], [340, 160]]),
      el(T.GROUND, 0, [[340, 160]]),
    ],
  },
  {
    name: 'Common-Emitter Amplifier',
    desc: 'Single NPN stage with ~30\u00d7 voltage gain',
    build: () => [
      el(T.RAIL, 0, [[200, 60]], [9]),
      el(T.WIRE, 0, [[200, 60], [140, 60]]),
      el(T.WIRE, 0, [[200, 60], [260, 60]]),
      el(T.RESISTOR, 0, [[260, 60], [260, 100]], [3300]),
      el(T.RESISTOR, 0, [[140, 60], [140, 140]], [470000]),
      el(T.TRANSISTOR, 0, [[140, 140], [260, 100], [260, 140]], [100, 1e-13]),
      el(T.RESISTOR, 0, [[260, 140], [260, 180]], [1000]),
      el(T.CAPACITOR, 0, [[260, 180], [320, 180]], [1e-4, 0.001]),
      el(T.WIRE, 0, [[260, 180], [320, 180]]),
      el(T.WIRE, 0, [[140, 140], [140, 160]]),
      el(T.CAPACITOR, 0, [[60, 160], [140, 160]], [1e-5, 0.001]),
      ac([40, 100], [40, 160], 0.01, 1000),
      el(T.WIRE, 0, [[40, 160], [60, 160]]),
      el(T.GROUND, 0, [[40, 100]]),
      el(T.WIRE, 0, [[260, 180], [260, 200]]),
      el(T.WIRE, 0, [[260, 200], [340, 200]]),
      el(T.GROUND, 0, [[340, 200]]),
      el(T.CAPACITOR, 0, [[260, 100], [320, 100]], [1e-5, 0.001]),
      el(T.RESISTOR, 0, [[320, 100], [320, 160]], [10000]),
      el(T.WIRE, 0, [[320, 160], [320, 200]]),
    ],
  },
  {
    name: 'CMOS Inverter',
    desc: 'PMOS + NMOS — the building block of digital logic',
    build: () => [
      el(T.RAIL, 0, [[200, 40]], [5]),
      el(T.WIRE, 0, [[200, 40], [260, 40]]),
      el(T.MOSFET, 0x100, [[200, 100], [260, 40], [260, 100]], [1.5, 0.02]),
      el(T.MOSFET, 0, [[200, 180], [260, 180], [260, 220]], [1.5, 0.02]),
      el(T.WIRE, 0, [[260, 100], [260, 140]]),
      el(T.WIRE, 0, [[260, 140], [260, 180]]),
      el(T.WIRE, 0, [[260, 220], [300, 220]]),
      el(T.GROUND, 0, [[300, 220]]),
      el(T.WIRE, 0, [[160, 100], [200, 100]]),
      el(T.WIRE, 0, [[160, 100], [160, 140]]),
      el(T.WIRE, 0, [[160, 140], [200, 180]]),
      el(T.WIRE, 0, [[100, 140], [160, 140]]),
      el(T.LOGIC_INPUT, 0, [[100, 140]], [5]),
      el(T.LOGIC_OUTPUT, 0, [[320, 140]], [5]),
      el(T.WIRE, 0, [[260, 140], [320, 140]]),
    ],
  },
  {
    name: 'Op-Amp Amplifier',
    desc: 'Non-inverting stage, gain = 1 + Rf/Rg = 10\u00d7',
    build: () => [
      el(T.RAIL, 0, [[100, 120]], [0.5]),
      el(T.OPAMP, 0, [[160, 120], [100, 120], [240, 120]], [15, -15, 100000]),
      el(T.WIRE, 0, [[240, 120], [280, 120]]),
      el(T.RESISTOR, 0, [[280, 120], [320, 120]], [9000]),
      el(T.WIRE, 0, [[320, 120], [320, 160]]),
      el(T.RESISTOR, 0, [[320, 160], [320, 200]], [1000]),
      el(T.WIRE, 0, [[320, 160], [160, 160]]),
      el(T.WIRE, 0, [[160, 120], [160, 160]]),
      el(T.GROUND, 0, [[320, 200]]),
    ],
  },
  {
    name: 'Astable Multivibrator',
    desc: 'Two BJT flip the LEDs back and forth — a classic blinker',
    build: () => {
      const E: RawElem[] = [];
      E.push(el(T.RAIL, 0, [[200, 40]], [5]));
      E.push(el(T.WIRE, 0, [[200, 40], [160, 40]]));
      E.push(el(T.WIRE, 0, [[160, 40], [120, 40]]));
      E.push(el(T.WIRE, 0, [[200, 40], [240, 40]]));
      E.push(el(T.WIRE, 0, [[240, 40], [280, 40]]));
      // left side (mirrors falstad multivib-a.txt: RB=1020, RC=330+LED, C=18u)
      E.push(el(T.RESISTOR, 0, [[120, 40], [120, 80]], [330]));
      E.push(el(T.LED, 0, [[120, 80], [120, 120]], [2.61e-34, 0, 0, 1]));
      E.push(el(T.RESISTOR, 0, [[240, 40], [240, 140]], [1020]));
      E.push(el(T.TRANSISTOR, 0, [[240, 140], [120, 120], [120, 160]], [100, 1e-13]));
      // right side
      E.push(el(T.RESISTOR, 0, [[280, 40], [280, 80]], [330]));
      E.push(el(T.LED, 0, [[280, 80], [280, 120]], [2.61e-34, 0, 0, 1]));
      E.push(el(T.RESISTOR, 0, [[160, 40], [160, 140]], [1020]));
      E.push(el(T.TRANSISTOR, 0, [[160, 140], [280, 120], [280, 160]], [100, 1e-13]));
      // emitters + ground
      E.push(el(T.WIRE, 0, [[120, 160], [120, 220]]));
      E.push(el(T.WIRE, 0, [[280, 160], [280, 220]]));
      E.push(el(T.WIRE, 0, [[120, 220], [280, 220]]));
      E.push(el(T.GROUND, 0, [[200, 220]]));
      // cross-coupling caps (cross the ground wire mid-segment — no junction)
      // initial conditions from the original: one charged +3.7V, the other -0.56V
      E.push(el(T.WIRE, 0, [[120, 120], [60, 120]]));
      E.push(el(T.WIRE, 0, [[60, 120], [60, 260]]));
      E.push(el(T.CAPACITOR, 0, [[60, 260], [160, 260]], [1.8e-5, 3.7024]));
      E.push(el(T.WIRE, 0, [[160, 260], [160, 140]]));
      E.push(el(T.WIRE, 0, [[280, 120], [340, 120]]));
      E.push(el(T.WIRE, 0, [[340, 120], [340, 260]]));
      E.push(el(T.CAPACITOR, 0, [[340, 260], [240, 260]], [1.8e-5, -0.5571]));
      E.push(el(T.WIRE, 0, [[240, 260], [240, 140]]));
      return E;
    },
  },
  {
    name: 'D Flip-Flop Divider',
    desc: 'Q\u0305 fed back to D turns a DFF into a \u00f72 counter',
    build: () => [
      el(T.CLOCK_INPUT, 0, [[100, 100]], [5, 1000]),
      el(T.WIRE, 0, [[100, 100], [140, 100]]),
      el(T.DFF, 0, [[140, 100], [140, 140], [240, 100], [240, 140]], [5]),
      el(T.LOGIC_OUTPUT, 0, [[300, 100]], [5]),
      el(T.WIRE, 0, [[240, 100], [300, 100]]),
      // feedback: Qbar → D
      el(T.WIRE, 0, [[240, 140], [200, 140]]),
      el(T.WIRE, 0, [[200, 140], [200, 180]]),
      el(T.WIRE, 0, [[200, 180], [140, 180]]),
      el(T.WIRE, 0, [[140, 180], [140, 140]]),
      // LED on Q (lights when Q is high)
      el(T.LED, 0, [[300, 100], [300, 160]], [2.61e-34, 0, 0, 1]),
      el(T.RESISTOR, 0, [[300, 160], [300, 200]], [470]),
      el(T.GROUND, 0, [[300, 200]]),
    ],
  },
];
