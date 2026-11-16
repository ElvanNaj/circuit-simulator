// Element definitions and behaviors.
// Ported from circuitjs1 (Falstad/Iain Sharp, GPLv2) — stamp/doStep equations
// follow the original MNA formulations (see INTERNALS.md).

pub const VT: f64 = 0.025865; // thermal voltage at 27C (matches original)
pub const VZCOEF: f64 = 1.0 / VT;

// ---- element type ids (stable ABI) ----
pub const T_WIRE: u32 = 1;
pub const T_GROUND: u32 = 2;
pub const T_RESISTOR: u32 = 3;
pub const T_CAPACITOR: u32 = 4;
pub const T_INDUCTOR: u32 = 5;
pub const T_VOLTAGE: u32 = 6; // waveform source: DC/AC/square/tri/saw/pulse via flags
pub const T_CURRENT: u32 = 7;
pub const T_RAIL: u32 = 8;
pub const T_SWITCH: u32 = 9;
pub const T_POT: u32 = 10;
pub const T_LAMP: u32 = 11;
pub const T_DIODE: u32 = 12;
pub const T_LED: u32 = 13;
pub const T_ZENER: u32 = 14;
pub const T_TRANSISTOR: u32 = 15; // NPN/PNP via flags
pub const T_MOSFET: u32 = 16; // NMOS/PMOS via flags
pub const T_OPAMP: u32 = 17;
pub const T_COMPARATOR: u32 = 18;
pub const T_AND: u32 = 19;
pub const T_OR: u32 = 20;
pub const T_NAND: u32 = 21;
pub const T_NOR: u32 = 22;
pub const T_XOR: u32 = 23;
pub const T_XNOR: u32 = 24;
pub const T_INVERTER: u32 = 25;
pub const T_BUFFER: u32 = 26;
pub const T_LOGIC_INPUT: u32 = 27;
pub const T_CLOCK_INPUT: u32 = 28;
pub const T_LOGIC_OUTPUT: u32 = 29;
pub const T_DFF: u32 = 30;
pub const T_ADC: u32 = 31;
pub const T_DAC: u32 = 32;
pub const T_TRANSFORMER: u32 = 33;
pub const T_SPARK_GAP: u32 = 34;
pub const T_AMMETER: u32 = 35;
pub const T_VOLTMETER: u32 = 36; // 1G-ohm shunt; shows voltage across it
pub const T_OHMMETER: u32 = 37;  // 1A current source (+1G shunt); R = V/I

// ---- flag bits ----
pub const F_CLOSED: u32 = 1; // switch closed / logic input high / spark gap conducting
pub const F_MOMENTARY: u32 = 2;
pub const F_PNP: u32 = 0x100; // transistor pnp / mosfet p-channel
// waveform selector for T_VOLTAGE lives in flags & 0xFF
pub const WF_DC: u32 = 0;
pub const WF_AC: u32 = 1;
pub const WF_SQUARE: u32 = 2;
pub const WF_TRIANGLE: u32 = 3;
pub const WF_SAWTOOTH: u32 = 4;
pub const WF_PULSE: u32 = 5;

// gate input count in flags & 0xFF (2..4)

// ---- per-element output layout (f64, stride 8) ----
// [0] voltage diff, [1] power, [2..5] current out into post 0..3, [6] extra (mode/brightness), [7] spare
// per-element flags out (u32, stride 2): [0] state bits, [1] reserved

#[derive(Clone, Copy)]
pub struct Elem {
    pub etype: u32,
    pub flags: u32,
    pub posts: [[i32; 2]; 6],
    pub nposts: usize,
    pub p: [f64; 8],  // params
    pub s: [f64; 16], // state
    pub nodes: [usize; 6], // node index per post (0 = ground)
    pub vs_base: i32, // first voltage-source index, -1 if none
    pub out: [f64; 8],
    pub flags_out: u32,
}

impl Elem {
    pub fn new(etype: u32, flags: u32) -> Elem {
        Elem {
            etype,
            flags,
            posts: [[0, 0]; 6],
            nposts: 0,
            p: [0.0; 8],
            s: [0.0; 16],
            nodes: [0; 6],
            vs_base: -1,
            out: [0.0; 8],
            flags_out: 0,
        }
    }
    pub fn pnp(&self) -> f64 {
        if self.flags & F_PNP != 0 { -1.0 } else { 1.0 }
    }
}

pub fn post_count(etype: u32, flags: u32) -> usize {
    match etype {
        T_WIRE | T_RESISTOR | T_CAPACITOR | T_INDUCTOR | T_VOLTAGE | T_CURRENT | T_SWITCH
        | T_LAMP | T_DIODE | T_LED | T_ZENER | T_SPARK_GAP | T_AMMETER | T_VOLTMETER
        | T_OHMMETER => 2,
        T_GROUND | T_RAIL | T_LOGIC_INPUT | T_CLOCK_INPUT | T_LOGIC_OUTPUT => 1,
        T_POT => 3,
        T_TRANSISTOR | T_MOSFET | T_OPAMP | T_COMPARATOR | T_TRANSFORMER => 3,
        T_AND | T_OR | T_NAND | T_NOR | T_XOR | T_XNOR => {
            let n = (flags & 0xFF) as usize;
            let n_in = if n < 2 { 2 } else if n > 4 { 4 } else { n };
            n_in + 1 // inputs + output
        }
        T_INVERTER | T_BUFFER => 2,
        T_DFF => 4,  // clk, d, q, qbar
        T_ADC => 5,  // in, b0..b3
        T_DAC => 5,  // b0..b3, out
        _ => 2,
    }
}

// number of MNA voltage-source rows used by this element
pub fn vs_count(e: &Elem) -> usize {
    match e.etype {
        T_VOLTAGE | T_RAIL | T_OPAMP | T_COMPARATOR | T_LOGIC_INPUT | T_CLOCK_INPUT | T_AMMETER
        | T_DAC => 1,
        T_AND | T_OR | T_NAND | T_NOR | T_XOR | T_XNOR | T_INVERTER | T_BUFFER => 1,
        T_DFF => 2,
        T_ADC => 4,
        _ => 0,
    }
}

pub fn non_linear(e: &Elem) -> bool {
    matches!(
        e.etype,
        T_DIODE | T_LED | T_ZENER | T_TRANSISTOR | T_MOSFET | T_OPAMP
    )
}

// does this element provide a DC current path between its posts a and b?
// (used to detect unconnected node groups, mirrors getConnection() semantics)
pub fn connects(e: &Elem, a: usize, b: usize) -> bool {
    match e.etype {
        T_WIRE | T_RESISTOR | T_LAMP | T_DIODE | T_LED | T_ZENER | T_AMMETER | T_VOLTMETER
        | T_OHMMETER => true,
        T_INDUCTOR | T_TRANSFORMER => true,
        T_SWITCH | T_SPARK_GAP => e.flags & F_CLOSED != 0 || e.p[0] > 0.0, // closed, or has on-resistance when closed
        T_VOLTAGE => true,
        T_CURRENT | T_CAPACITOR => false,
        T_RAIL => false, // single post to ground (handled via has-ground)
        T_TRANSISTOR => true, // junctions provide paths between terminals
        T_MOSFET => a != 0 && b != 0, // gate isolated, drain-source connected
        T_OPAMP | T_COMPARATOR | T_AND | T_OR | T_NAND | T_NOR | T_XOR | T_XNOR | T_INVERTER
        | T_BUFFER | T_DFF | T_ADC | T_DAC | T_LOGIC_INPUT | T_CLOCK_INPUT => false,
        T_LOGIC_OUTPUT => false,
        T_GROUND => false,
        _ => false,
    }
}

pub fn has_ground_connection(e: &Elem, post: usize) -> bool {
    match e.etype {
        T_GROUND => true,
        T_RAIL => true,
        T_OPAMP | T_COMPARATOR => post == output_post(e),
        T_AND | T_OR | T_NAND | T_NOR | T_XOR | T_XNOR | T_INVERTER | T_BUFFER | T_DFF | T_ADC
        | T_DAC | T_LOGIC_INPUT | T_CLOCK_INPUT => post == output_post(e),
        _ => false,
    }
}

fn output_post(e: &Elem) -> usize {
    match e.etype {
        T_OPAMP | T_COMPARATOR => 2,
        T_AND | T_OR | T_NAND | T_NOR | T_XOR | T_XNOR => e.nposts - 1,
        T_INVERTER | T_BUFFER => 1,
        T_DFF => 2, // q
        T_ADC => 1, // first output bit
        T_DAC => 4,
        _ => 0,
    }
}

// ---------------- waveforms ----------------

fn triangle_func(x: f64) -> f64 {
    const PI: f64 = std::f64::consts::PI;
    if x < PI {
        x * (2.0 / PI) - 1.0
    } else {
        1.0 - (x - PI) * (2.0 / PI)
    }
}

pub fn voltage_wave(e: &Elem, t: f64) -> f64 {
    const PI: f64 = std::f64::consts::PI;
    let freq = e.p[0];
    let maxv = e.p[1];
    let bias = e.p[2];
    let phase = e.p[3];
    let duty = e.p[4];
    let ftz = e.s[10]; // freqTimeZero
    let w = 2.0 * PI * (t - ftz) * freq + phase;
    match e.flags & 0xFF {
        WF_DC => maxv + bias,
        WF_AC => w.sin() * maxv + bias,
        WF_SQUARE => {
            let wm = w % (2.0 * PI);
            let duty_phase = 2.0 * PI * duty;
            bias + if wm > duty_phase { -maxv } else { maxv }
        }
        WF_TRIANGLE => bias + triangle_func(w % (2.0 * PI)) * maxv,
        WF_SAWTOOTH => bias + (w % (2.0 * PI)) * (maxv / PI) - maxv,
        WF_PULSE => {
            let wm = w % (2.0 * PI);
            let duty_phase = 2.0 * PI * duty;
            if wm < duty_phase { maxv + bias } else { bias }
        }
        _ => 0.0,
    }
}

// ---------------- diode model helpers ----------------

pub struct DiodeModel {
    pub leakage: f64,
    pub zvoltage: f64,
    pub vdcoef: f64,
    pub vscale: f64,
    pub vcrit: f64,
    pub vzcrit: f64,
    pub zoffset: f64,
}

// ec = emission coefficient N (default model in circuitjs1 uses N=2)
pub fn diode_model(leakage: f64, zvoltage: f64, ec: f64) -> DiodeModel {
    let vscale = if ec > 0.0 { ec * VT } else { VT };
    let vdcoef = 1.0 / vscale;
    let vcrit = vscale * (vscale / (std::f64::consts::SQRT_2 * leakage)).ln();
    let vzcrit = VT * (VT / (std::f64::consts::SQRT_2 * leakage)).ln();
    let zoffset = if zvoltage == 0.0 {
        0.0
    } else {
        // offset giving 5mA at zvoltage (matches original)
        let i = -0.005f64;
        zvoltage - (-(1.0 + i / leakage)).ln() / VZCOEF
    };
    DiodeModel {
        leakage,
        zvoltage,
        vdcoef,
        vscale,
        vcrit,
        vzcrit,
        zoffset,
    }
}

pub fn diode_limit_step(dm: &DiodeModel, mut vnew: f64, vold: f64, converged: &mut bool) -> f64 {
    if vnew > dm.vcrit && (vnew - vold).abs() > (dm.vscale + dm.vscale) {
        if vold > 0.0 {
            let arg = 1.0 + (vnew - vold) / dm.vscale;
            vnew = if arg > 0.0 {
                vold + dm.vscale * arg.ln()
            } else {
                dm.vcrit
            };
        } else {
            vnew = dm.vscale * (vnew / dm.vscale).ln();
        }
        *converged = false;
    } else if vnew < 0.0 && dm.zoffset != 0.0 {
        // Zener breakdown limiting (translated voltages)
        let mut vnz = -vnew - dm.zoffset;
        let mut vnz_old = -vold - dm.zoffset;
        if vnz > dm.vzcrit && (vnz - vnz_old).abs() > (VT + VT) {
            if vnz_old > 0.0 {
                let arg = 1.0 + (vnz - vnz_old) / VT;
                vnz = if arg > 0.0 {
                    vnz_old + VT * arg.ln()
                } else {
                    dm.vzcrit
                };
            } else {
                vnz = VT * (vnz / VT).ln();
            }
            *converged = false;
        }
        vnew = -(vnz + dm.zoffset);
    }
    vnew
}

pub fn diode_current(dm: &DiodeModel, vd: f64) -> f64 {
    if vd >= 0.0 || dm.zvoltage == 0.0 {
        dm.leakage * ((vd * dm.vdcoef).exp() - 1.0)
    } else {
        dm.leakage
            * ((vd * dm.vdcoef).exp() - ((-vd - dm.zoffset) * VZCOEF).exp() - 1.0)
    }
}
