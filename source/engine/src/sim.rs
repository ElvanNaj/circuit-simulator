// Simulation core: Modified Nodal Analysis solver.
// Architecture mirrors circuitjs1's SimulationManager (analyze/stamp/runCircuit),
// rebuilt with flat typed arrays and zero heap allocation in the hot loop.

use crate::elements::*;
use crate::lu::{lu_factor, lu_solve};
use std::collections::HashMap;

pub const SCOPE_CAP: usize = 32768; // samples per scope channel (t, v, i each)

pub struct ScopeRing {
    pub data: Vec<f64>,
    pub head: usize,
    pub count: usize,
}

impl ScopeRing {
    pub fn new_default() -> ScopeRing {
        ScopeRing {
            data: vec![0.0; SCOPE_CAP * 3],
            head: 0,
            count: 0,
        }
    }
    fn new() -> ScopeRing {
        ScopeRing::new_default()
    }
    fn push(&mut self, t: f64, v: f64, i: f64) {
        let base = self.head * 3;
        self.data[base] = t;
        self.data[base + 1] = v;
        self.data[base + 2] = i;
        self.head = (self.head + 1) % SCOPE_CAP;
        if self.count < SCOPE_CAP {
            self.count += 1;
        }
    }
}

pub struct Sim {
    pub elms: Vec<Elem>,
    pub n_nodes: usize, // including ground (node 0)
    pub n_vs: usize,
    pub size: usize, // matrix size = (n_nodes-1) + n_vs
    pub matrix: Vec<f64>,
    pub orig_matrix: Vec<f64>,
    pub rhs: Vec<f64>,
    pub orig_rhs: Vec<f64>,
    pub ipvt: Vec<i32>,
    pub solution: Vec<f64>,
    pub node_v: Vec<f64>,
    pub last_node_v: Vec<f64>,
    pub nonlinear: bool,
    pub converged: bool,
    pub subiter: usize,
    pub dt: f64,
    pub dt_max: f64,
    pub dt_min: f64,
    pub t: f64,
    pub good_iterations: i32,
    pub failure_count: i32,
    pub needs_analyze: bool,
    pub stop_msg: Option<&'static str>,
    pub scope_channels: Vec<usize>,
    pub scope_rings: Vec<ScopeRing>,
    pub adjust_timestep: bool,
    // contiguous output buffers for JS (refreshed at end of each run/analyze)
    pub out_buf: Vec<f64>,
    pub flags_buf: Vec<u32>,
    // scratch arena for JS->WASM data transfer
    pub scratch: Vec<u8>,
    // debug trace: [subiter, vd_raw, s0_before, limited, geq, nc, converged, solve_vd]
    pub dbg_trace: Vec<f64>,
    pub dbg_on: bool,
}

impl Sim {
    pub fn new() -> Sim {
        Sim {
            elms: Vec::new(),
            n_nodes: 1,
            n_vs: 0,
            size: 0,
            matrix: Vec::new(),
            orig_matrix: Vec::new(),
            rhs: Vec::new(),
            orig_rhs: Vec::new(),
            ipvt: Vec::new(),
            solution: Vec::new(),
            node_v: vec![0.0],
            last_node_v: vec![0.0],
            nonlinear: false,
            converged: true,
            subiter: 0,
            dt: 5e-6,
            dt_max: 5e-6,
            dt_min: 1e-12,
            t: 0.0,
            good_iterations: 100,
            failure_count: 0,
            needs_analyze: false,
            stop_msg: None,
            scope_channels: Vec::new(),
            scope_rings: Vec::new(),
            adjust_timestep: false, // match original default: brute-force 5000 subiters + gmin ramp
            out_buf: Vec::new(),
            flags_buf: Vec::new(),
            scratch: Vec::new(),
            dbg_trace: Vec::new(),
            dbg_on: false,
        }
    }

    // ---- matrix stamping helpers (ports of SimulationManager stamps) ----

    #[inline]
    fn mrow(node: usize) -> Option<usize> {
        if node == 0 {
            None
        } else {
            Some(node - 1)
        }
    }

    #[inline]
    fn vsrow(&self, vs: usize) -> usize {
        (self.n_nodes - 1) + vs
    }

    /// stamp value x at node-row a, node-col b (port of stampMatrix)
    #[inline]
    pub fn stamp_nm(&mut self, a: usize, b: usize, x: f64) {
        if let (Some(ra), Some(rb)) = (Self::mrow(a), Self::mrow(b)) {
            self.matrix[ra * self.size + rb] += x;
        }
    }

    pub fn stamp_resistor(&mut self, n0: usize, n1: usize, r: f64) {
        if r == 0.0 || !r.is_finite() {
            return;
        }
        self.stamp_conductance(n0, n1, 1.0 / r);
    }

    pub fn stamp_conductance(&mut self, n0: usize, n1: usize, g: f64) {
        if !g.is_finite() {
            return;
        }
        self.stamp_nm(n0, n0, g);
        self.stamp_nm(n1, n1, g);
        self.stamp_nm(n0, n1, -g);
        self.stamp_nm(n1, n0, -g);
    }

    pub fn stamp_current_source(&mut self, n0: usize, n1: usize, i: f64) {
        if let Some(r) = Self::mrow(n0) {
            self.rhs[r] -= i;
        }
        if let Some(r) = Self::mrow(n1) {
            self.rhs[r] += i;
        }
    }

    /// v: Some(v) = stamp value now; None = value updated in doStep
    pub fn stamp_voltage_source(&mut self, vs: usize, n0: usize, n1: usize, v: Option<f64>) {
        let vr = self.vsrow(vs);
        if let Some(r) = Self::mrow(n0) {
            self.matrix[vr * self.size + r] += -1.0;
            self.matrix[r * self.size + vr] += 1.0;
        }
        if let Some(r) = Self::mrow(n1) {
            self.matrix[vr * self.size + r] += 1.0;
            self.matrix[r * self.size + vr] += -1.0;
        }
        if let Some(v) = v {
            self.rhs[vr] += v;
        }
    }

    pub fn stamp_vs_rhs(&mut self, vs: usize, v: f64) {
        let vr = self.vsrow(vs);
        self.rhs[vr] += v;
    }

    pub fn stamp_vccs(&mut self, cn0: usize, cn1: usize, vn0: usize, vn1: usize, g: f64) {
        self.stamp_nm(cn0, vn0, g);
        self.stamp_nm(cn1, vn1, g);
        self.stamp_nm(cn0, vn1, -g);
        self.stamp_nm(cn1, vn0, -g);
    }

    /// stamp VS constraint row coefficient (used by op-amp NR linearization)
    pub fn stamp_vs_row(&mut self, vs: usize, node: usize, coef: f64) {
        let vr = self.vsrow(vs);
        if let Some(r) = Self::mrow(node) {
            self.matrix[vr * self.size + r] += coef;
        }
    }

    /// stamp node row vs VS column (output current into node)
    pub fn stamp_node_vs(&mut self, node: usize, vs: usize, x: f64) {
        let vr = self.vsrow(vs);
        if let Some(r) = Self::mrow(node) {
            self.matrix[r * self.size + vr] += x;
        }
    }

    pub fn stamp_rhs_node(&mut self, node: usize, x: f64) {
        if let Some(r) = Self::mrow(node) {
            self.rhs[r] += x;
        }
    }

    #[inline]
    pub fn nv(&self, node: usize) -> f64 {
        self.node_v[node]
    }

    /// solved current of voltage source `vs` (row = n_nodes-1 + vs)
    #[inline]
    pub fn vs_current(&self, vs: i32) -> f64 {
        self.solution[(self.n_nodes - 1) + vs as usize]
    }

    pub fn reset_all(&mut self) {
        self.t = 0.0;
        for v in self.node_v.iter_mut() {
            *v = 0.0;
        }
        for v in self.last_node_v.iter_mut() {
            *v = 0.0;
        }
        for i in 0..self.elms.len() {
            let mut e = self.elms[i];
            e.s = [0.0; 16];
            e.out = [0.0; 8];
            e.flags_out = 0;
            reset_elem(&mut e);
            self.elms[i] = e;
        }
        self.good_iterations = 100;
        self.failure_count = 0;
        self.stop_msg = None;
        for ring in self.scope_rings.iter_mut() {
            ring.head = 0;
            ring.count = 0;
        }
        // rebuild cached companion-model fields (compR etc.) and re-factor
        if self.size > 0 {
            let _ = stamp_circuit(self);
            if !self.nonlinear {
                let mut matrix = std::mem::take(&mut self.matrix);
                let mut ipvt = std::mem::take(&mut self.ipvt);
                let _ = lu_factor(&mut matrix, self.size, &mut ipvt);
                self.matrix = matrix;
                self.ipvt = ipvt;
            }
        }
    }

    pub fn refresh_outputs(&mut self) {
        let n = self.elms.len();
        self.out_buf.clear();
        self.out_buf.resize(n * 8, 0.0);
        self.flags_buf.clear();
        self.flags_buf.resize(n * 2, 0);
        for i in 0..n {
            let e = &self.elms[i];
            let base = i * 8;
            self.out_buf[base..base + 8].copy_from_slice(&e.out);
            self.flags_buf[i * 2] = e.flags_out;
            self.flags_buf[i * 2 + 1] = e.flags;
        }
    }
}

// ---------------- element reset ----------------

pub fn reset_elem(e: &mut Elem) {
    match e.etype {
        T_CAPACITOR => {
            e.s[0] = e.p[1]; // voltdiff = initialVoltage (small charge on reset)
        }
        T_INDUCTOR => {
            e.s[0] = e.p[1]; // current = initialCurrent
            e.s[2] = e.p[1]; // curSourceValue
        }
        T_VOLTAGE => {
            e.s[10] = 0.0; // freqTimeZero
        }
        T_SPARK_GAP => {
            e.flags &= !F_CLOSED; // start open
        }
        T_LAMP => e.s[1] = 0.0,
        _ => {}
    }
}

// ---------------- analysis ----------------

pub fn analyze(sim: &mut Sim) -> Result<(), &'static str> {
    sim.stop_msg = None;
    if sim.elms.is_empty() {
        // an empty canvas is a valid state (user deleted everything) — no matrix
        sim.n_nodes = 1;
        sim.n_vs = 0;
        sim.size = 0;
        sim.nonlinear = false;
        sim.node_v = vec![0.0];
        sim.last_node_v = vec![0.0];
        sim.needs_analyze = false;
        sim.refresh_outputs();
        return Ok(());
    }

    // ---- union-find over posts; wires and closed zero-ohm switches merge posts ----
    let n_elm = sim.elms.len();
    let mut post_id: HashMap<(i32, i32), usize> = HashMap::new();
    let mut n_posts = 0usize;
    for i in 0..n_elm {
        let np = sim.elms[i].nposts;
        for k in 0..np {
            let (x, y) = (sim.elms[i].posts[k][0], sim.elms[i].posts[k][1]);
            let next = n_posts;
            let id = *post_id.entry((x, y)).or_insert(next);
            if id == next {
                n_posts += 1;
            }
            sim.elms[i].nodes[k] = id; // temporary: post id
        }
    }
    let mut parent: Vec<usize> = (0..n_posts).collect();
    fn find(p: &mut Vec<usize>, mut a: usize) -> usize {
        while p[a] != a {
            p[a] = p[p[a]];
            a = p[a];
        }
        a
    }
    for i in 0..n_elm {
        let (etype, flags, p0) = {
            let e = &sim.elms[i];
            (e.etype, e.flags, e.p[0])
        };
        match etype {
            T_WIRE => {
                let a = sim.elms[i].nodes[0];
                let b = sim.elms[i].nodes[1];
                let ra = find(&mut parent, a);
                let rb = find(&mut parent, b);
                if ra != rb {
                    parent[rb] = ra;
                }
            }
            T_SWITCH => {
                // closed switch with zero on-resistance behaves like a wire
                if flags & F_CLOSED != 0 && p0 <= 0.0 {
                    let a = sim.elms[i].nodes[0];
                    let b = sim.elms[i].nodes[1];
                    let ra = find(&mut parent, a);
                    let rb = find(&mut parent, b);
                    if ra != rb {
                        parent[rb] = ra;
                    }
                }
            }
            _ => {}
        }
    }

    // ---- ground node assignment ----
    let mut node_of_root: Vec<usize> = vec![usize::MAX; n_posts];
    let mut next_node = 1usize;
    for i in 0..n_elm {
        if sim.elms[i].etype == T_GROUND {
            let root = find(&mut parent, sim.elms[i].nodes[0]);
            node_of_root[root] = 0;
        }
    }
    for p in 0..n_posts {
        let root = find(&mut parent, p);
        if node_of_root[root] == usize::MAX {
            node_of_root[root] = next_node;
            next_node += 1;
        }
    }
    for i in 0..n_elm {
        let np = sim.elms[i].nposts;
        for k in 0..np {
            let root = find(&mut parent, sim.elms[i].nodes[k]);
            sim.elms[i].nodes[k] = node_of_root[root];
        }
    }
    sim.n_nodes = next_node;

    // ---- voltage sources & nonlinearity ----
    let mut vscount = 0usize;
    sim.nonlinear = false;
    for i in 0..n_elm {
        if non_linear(&sim.elms[i]) {
            sim.nonlinear = true;
        }
        let c = vs_count(&sim.elms[i]);
        sim.elms[i].vs_base = if c > 0 { vscount as i32 } else { -1 };
        vscount += c;
    }
    sim.n_vs = vscount;
    sim.size = (sim.n_nodes - 1) + sim.n_vs;
    let size = sim.size;
    if size == 0 {
        return Err("no active circuit");
    }
    sim.matrix = vec![0.0; size * size];
    sim.orig_matrix = vec![0.0; size * size];
    sim.rhs = vec![0.0; size];
    sim.orig_rhs = vec![0.0; size];
    sim.ipvt = vec![0; size];
    sim.solution = vec![0.0; size];
    sim.node_v = vec![0.0; sim.n_nodes];
    sim.last_node_v = vec![0.0; sim.n_nodes];

    sim.dt = sim.dt_max;
    sim.good_iterations = 100;

    // ---- stamp ----
    stamp_circuit(sim)?;

    // ---- factor now if linear ----
    if !sim.nonlinear {
        let ok = {
            let mut matrix = std::mem::take(&mut sim.matrix);
            let mut ipvt = std::mem::take(&mut sim.ipvt);
            let ok = lu_factor(&mut matrix, size, &mut ipvt);
            sim.matrix = matrix;
            sim.ipvt = ipvt;
            ok
        };
        if !ok {
            sim.stop_msg = Some("Singular matrix!");
            return Err("Singular matrix!");
        }
    }
    sim.refresh_outputs();
    Ok(())
}

pub fn stamp_circuit(sim: &mut Sim) -> Result<(), &'static str> {
    for x in sim.matrix.iter_mut() {
        *x = 0.0;
    }
    for x in sim.rhs.iter_mut() {
        *x = 0.0;
    }

    // unconnected node groups: add 1e9 resistor to ground (like connectUnconnectedNodes)
    stamp_unconnected_resistors(sim);

    for i in 0..sim.elms.len() {
        let mut e = sim.elms[i];
        stamp_elem(sim, &mut e);
        sim.elms[i] = e;
    }
    sim.orig_matrix.copy_from_slice(&sim.matrix);
    sim.orig_rhs.copy_from_slice(&sim.rhs);
    Ok(())
}

// find connected node groups (via DC current paths); any group without ground
// gets one 1e9-ohm resistor to ground so the matrix stays solvable
fn stamp_unconnected_resistors(sim: &mut Sim) {
    let n = sim.n_nodes;
    if n <= 1 {
        return;
    }
    let mut parent: Vec<usize> = (0..n).collect();
    fn find(p: &mut Vec<usize>, mut a: usize) -> usize {
        while p[a] != a {
            p[a] = p[p[a]];
            a = p[a];
        }
        a
    }
    for i in 0..sim.elms.len() {
        let (etype, flags, np) = {
            let e = &sim.elms[i];
            (e.etype, e.flags, e.nposts)
        };
        // union via connecting elements
        for a in 0..np {
            for b in (a + 1)..np {
                let nodes = sim.elms[i].nodes;
                if connects_etype(etype, flags, a, b) {
                    let ra = find(&mut parent, nodes[a]);
                    let rb = find(&mut parent, nodes[b]);
                    if ra != rb {
                        parent[rb] = ra;
                    }
                }
            }
        }
        // voltage sources connect their two nodes (current can flow through)
        if etype == T_VOLTAGE && np == 2 {
            let nodes = sim.elms[i].nodes;
            let ra = find(&mut parent, nodes[0]);
            let rb = find(&mut parent, nodes[1]);
            if ra != rb {
                parent[rb] = ra;
            }
        }
        // elements with grounded outputs tie that node to ground group
        if has_ground_connection(etype) {
            let outp = output_post_idx(etype, np);
            if outp < np {
                let nodes = sim.elms[i].nodes;
                let ro = find(&mut parent, nodes[outp]);
                if ro != 0 {
                    parent[ro] = 0;
                }
            }
        }
    }
    // groups without ground contact get a 1e9 resistor to ground
    let mut handled: Vec<bool> = vec![false; n];
    for node in 1..n {
        let root = find(&mut parent, node);
        if root != 0 && !handled[root] {
            handled[root] = true;
            let r0 = node - 1;
            sim.matrix[r0 * sim.size + r0] += 1e-9;
        }
    }
}

fn connects_etype(etype: u32, flags: u32, a: usize, b: usize) -> bool {
    match etype {
        T_WIRE | T_RESISTOR | T_LAMP | T_DIODE | T_LED | T_ZENER | T_AMMETER | T_VOLTMETER
        | T_OHMMETER | T_INDUCTOR | T_TRANSFORMER | T_TRANSISTOR | T_VOLTAGE => true,
        T_SWITCH | T_SPARK_GAP => flags & F_CLOSED != 0,
        T_MOSFET => a != 0 && b != 0,
        _ => false,
    }
}

fn has_ground_connection(etype: u32) -> bool {
    matches!(
        etype,
        T_GROUND | T_RAIL | T_OPAMP | T_COMPARATOR | T_AND | T_OR | T_NAND | T_NOR | T_XOR
            | T_XNOR | T_INVERTER | T_BUFFER | T_DFF | T_ADC | T_DAC | T_LOGIC_INPUT
            | T_CLOCK_INPUT
    )
}

fn output_post_idx(etype: u32, nposts: usize) -> usize {
    match etype {
        T_OPAMP | T_COMPARATOR => 2,
        T_AND | T_OR | T_NAND | T_NOR | T_XOR | T_XNOR => nposts - 1,
        T_INVERTER | T_BUFFER => 1,
        T_DFF => 2,
        T_ADC => 1,
        T_DAC => 4,
        _ => 0,
    }
}

// ---------------- per-element stamping (linear part) ----------------

fn stamp_elem(sim: &mut Sim, e: &mut Elem) {
    match e.etype {
        T_RESISTOR => sim.stamp_resistor(e.nodes[0], e.nodes[1], e.p[0]),
        T_LAMP => sim.stamp_resistor(e.nodes[0], e.nodes[1], e.p[0]),
        T_POT => {
            let r = e.p[0];
            let pos = e.p[1].clamp(0.0, 1.0);
            let ra = (r * pos).max(1e-9);
            let rb = (r * (1.0 - pos)).max(1e-9);
            sim.stamp_resistor(e.nodes[0], e.nodes[2], ra);
            sim.stamp_resistor(e.nodes[2], e.nodes[1], rb);
        }
        T_CAPACITOR => {
            let c = if e.p[0] > 0.0 { e.p[0] } else { 1e-7 };
            let comp_r = sim.dt / (2.0 * c); // trapezoidal
            e.s[1] = comp_r;
            sim.stamp_resistor(e.nodes[0], e.nodes[1], comp_r);
        }
        T_INDUCTOR => {
            let l = if e.p[0] > 0.0 { e.p[0] } else { 1e-6 };
            let comp_r = (2.0 * l) / sim.dt; // trapezoidal
            e.s[1] = comp_r;
            sim.stamp_resistor(e.nodes[0], e.nodes[1], comp_r);
        }
        T_VOLTAGE => {
            if e.flags & 0xFF == WF_DC {
                let v = voltage_wave(e, sim.t);
                sim.stamp_voltage_source(e.vs_base as usize, e.nodes[0], e.nodes[1], Some(v));
            } else {
                sim.stamp_voltage_source(e.vs_base as usize, e.nodes[0], e.nodes[1], None);
            }
        }
        T_RAIL => {
            sim.stamp_voltage_source(e.vs_base as usize, 0, e.nodes[0], Some(e.p[0]));
        }
        T_CURRENT => {
            sim.stamp_current_source(e.nodes[0], e.nodes[1], e.p[0]);
        }
        T_SWITCH => {
            if e.flags & F_CLOSED != 0 && e.p[0] > 0.0 {
                sim.stamp_resistor(e.nodes[0], e.nodes[1], e.p[0]);
            }
        }
        T_SPARK_GAP => {
            if e.flags & F_CLOSED != 0 {
                sim.stamp_resistor(e.nodes[0], e.nodes[1], 0.001);
            } else {
                sim.stamp_resistor(e.nodes[0], e.nodes[1], 1e6);
            }
        }
        T_AMMETER => {
            sim.stamp_voltage_source(e.vs_base as usize, e.nodes[0], e.nodes[1], Some(0.0));
        }
        T_VOLTMETER => {
            // near-ideal meter: 1G-ohm shunt keeps the circuit undisturbed
            sim.stamp_resistor(e.nodes[0], e.nodes[1], 1e9);
        }
        T_OHMMETER => {
            // Falstad OhmMeterElm model: known test current (CurrentElm default 10mA);
            // R = V/I. Parallel 1G shunt keeps the matrix solvable on open posts.
            sim.stamp_current_source(e.nodes[0], e.nodes[1], 0.01);
            sim.stamp_resistor(e.nodes[0], e.nodes[1], 1e9);
        }
        T_OPAMP => {
            // output column only; constraint row comes from doStep (Newton-Raphson)
            sim.stamp_node_vs(e.nodes[2], e.vs_base as usize, 1.0);
        }
        T_DFF => {
            sim.stamp_voltage_source(e.vs_base as usize, 0, e.nodes[2], None); // Q
            sim.stamp_voltage_source((e.vs_base + 1) as usize, 0, e.nodes[3], None); // Qbar
        }
        T_ADC => {
            for k in 0usize..4 {
                sim.stamp_voltage_source((e.vs_base + k as i32) as usize, 0, e.nodes[1 + k], None);
            }
        }
        T_DAC => {
            sim.stamp_voltage_source(e.vs_base as usize, 0, e.nodes[4], None);
        }
        T_LOGIC_INPUT | T_CLOCK_INPUT => {
            sim.stamp_voltage_source(e.vs_base as usize, 0, e.nodes[0], None);
        }
        T_AND | T_OR | T_NAND | T_NOR | T_XOR | T_XNOR | T_INVERTER | T_BUFFER => {
            let outp = e.nposts - 1;
            sim.stamp_voltage_source(e.vs_base as usize, 0, e.nodes[outp], None);
        }
        T_COMPARATOR => {
            sim.stamp_voltage_source(e.vs_base as usize, 0, e.nodes[2], None);
        }
        T_TRANSFORMER => {
            let l1 = if e.p[0] > 0.0 { e.p[0] } else { 1e-3 };
            let ratio = if e.p[1] != 0.0 { e.p[1] } else { 1.0 };
            let l2 = l1 * ratio * ratio;
            let k = e.p[2].clamp(0.0, 0.9999);
            let m = k * (l1 * l2).sqrt();
            let det = l1 * l2 - m * m;
            if det <= 0.0 || det.is_nan() {
                return;
            }
            let a1 = l2 / det;
            let a2 = -m / det;
            let a3 = a2;
            let a4 = l1 / det;
            let first = sim.dt / 2.0; // trapezoidal
            e.s[4] = a1;
            e.s[5] = a2;
            e.s[6] = a3;
            e.s[7] = a4;
            e.s[8] = first;
            let g1 = a1 * first;
            let g4 = a4 * first;
            e.s[2] = if g1 != 0.0 { 1.0 / g1 } else { 1e12 }; // compR1
            e.s[3] = if g4 != 0.0 { 1.0 / g4 } else { 1e12 }; // compR2
            sim.stamp_conductance(e.nodes[0], e.nodes[2], g1);
            sim.stamp_conductance(e.nodes[1], e.nodes[3], g4);
            sim.stamp_vccs(e.nodes[0], e.nodes[2], e.nodes[1], e.nodes[3], a2 * first);
            sim.stamp_vccs(e.nodes[1], e.nodes[3], e.nodes[0], e.nodes[2], a3 * first);
        }
        _ => {}
    }
}

// ---------------- per-timestep iteration start (once per timestep!) ----------------

pub fn start_iteration(sim: &mut Sim, i: usize) {
    let (etype, nodes, s) = { let e = &sim.elms[i]; (e.etype, e.nodes, e.s) };
    match etype {
        T_CAPACITOR => {
            // trapezoidal: I = -vd/compR - current
            sim.elms[i].s[2] = -s[0] / s[1] - s[3];
        }
        T_INDUCTOR => {
            let vd = sim.nv(nodes[0]) - sim.nv(nodes[1]);
            sim.elms[i].s[2] = vd / s[1] + s[0];
        }
        T_TRANSFORMER => {
            // s[0]=i1, s[1]=i2, s[2]=compR1, s[3]=compR2, s[4..8]=a1..a4, s[8]=first
            let v1 = sim.nv(nodes[0]) - sim.nv(nodes[2]);
            let v2 = sim.nv(nodes[1]) - sim.nv(nodes[3]);
            let first = s[8];
            sim.elms[i].s[12] = s[0] + s[4] * first * v1 + s[5] * first * v2;
            sim.elms[i].s[13] = s[1] + s[6] * first * v1 + s[7] * first * v2;
        }
        _ => {}
    }
}

// ---------------- doStep (per Newton iteration) ----------------

pub fn do_step(sim: &mut Sim, i: usize) {
    let (etype, flags, nodes, p, s, vs_base) = {
        let e = &sim.elms[i];
        (e.etype, e.flags, e.nodes, e.p, e.s, e.vs_base)
    };
    let _ = flags;
    match etype {
        T_CAPACITOR => {
            sim.stamp_current_source(nodes[0], nodes[1], s[2]);
        }
        T_INDUCTOR => {
            sim.stamp_current_source(nodes[0], nodes[1], s[2]);
        }
        T_VOLTAGE => {
            if flags & 0xFF != WF_DC {
                let mut e2 = Elem::new(etype, flags);
                e2.p = p;
                e2.s[10] = sim.elms[i].s[10];
                let v = voltage_wave(&e2, sim.t);
                sim.stamp_vs_rhs(vs_base as usize, v);
            }
        }
        T_DIODE | T_LED | T_ZENER => do_step_diode(sim, i),
        T_TRANSISTOR => do_step_transistor(sim, i),
        T_MOSFET => do_step_mosfet(sim, i),
        T_OPAMP => do_step_opamp(sim, i),
        T_COMPARATOR => {
            let out = if sim.nv(nodes[0]) > sim.nv(nodes[1]) { p[0] } else { p[1] };
            sim.stamp_vs_rhs(vs_base as usize, out);
            sim.elms[i].out[6] = out;
        }
        T_AND | T_OR | T_NAND | T_NOR | T_XOR | T_XNOR | T_INVERTER | T_BUFFER => {
            do_step_gate(sim, i)
        }
        T_LOGIC_INPUT => {
            let hi = if p[0] > 0.0 { p[0] } else { 5.0 };
            sim.stamp_vs_rhs(
                vs_base as usize,
                if flags & F_CLOSED != 0 { hi } else { 0.0 },
            );
        }
        T_CLOCK_INPUT => {
            let hi = if p[0] > 0.0 { p[0] } else { 5.0 };
            let freq = if p[1] > 0.0 { p[1] } else { 100.0 };
            let period = 1.0 / freq;
            let phase = sim.t % period;
            sim.stamp_vs_rhs(
                vs_base as usize,
                if phase < period * 0.5 { hi } else { 0.0 },
            );
        }
        T_DFF => do_step_dff(sim, i),
        T_ADC => do_step_adc(sim, i),
        T_DAC => do_step_dac(sim, i),
        T_TRANSFORMER => {
            sim.stamp_current_source(nodes[0], nodes[2], s[12]);
            sim.stamp_current_source(nodes[1], nodes[3], s[13]);
        }
        _ => {}
    }
}

fn do_step_diode(sim: &mut Sim, i: usize) {
    let e = sim.elms[i];
    let dm = diode_model(e.p[0], e.p[1], e.p[3]);
    let mut vd = sim.nv(e.nodes[0]) - sim.nv(e.nodes[1]);
    let vd_raw_pre = vd;
    let s0_before = e.s[0];
    let conv_before = sim.converged;
    if (vd - e.s[0]).abs() > 0.01 {
        sim.converged = false;
    }
    let mut converged = sim.converged;
    vd = diode_limit_step(&dm, vd, e.s[0], &mut converged);
    sim.converged = converged;
    if sim.dbg_on {
        let base = sim.subiter * 8;
        if sim.dbg_trace.len() < base + 8 { sim.dbg_trace.resize(base + 8, 0.0); }
        sim.dbg_trace[base] = sim.subiter as f64;
        sim.dbg_trace[base + 1] = vd_raw_pre;  // raw before limit
        sim.dbg_trace[base + 2] = s0_before;   // lastvoltdiff
        sim.dbg_trace[base + 3] = vd;          // limited
        sim.dbg_trace[base + 4] = converged as i32 as f64;
        sim.dbg_trace[base + 5] = sim.nv(e.nodes[0]);
        sim.dbg_trace[base + 6] = sim.nv(e.nodes[1]);
        sim.dbg_trace[base + 7] = sim.t;
    }

    // gmin ramp for hard-to-converge cases
    let subit = sim.subiter as f64;
    let mut gmin = dm.leakage * 0.01;
    if subit > 100.0 {
        gmin = (-9.0f64.ln() * (1.0 - subit / 3000.0)).exp();
        if gmin > 0.1 {
            gmin = 0.1;
        }
    }

    if vd >= 0.0 || dm.zvoltage == 0.0 {
        let eval_ = (vd * dm.vdcoef).exp();
        let geq = dm.vdcoef * dm.leakage * eval_ + gmin;
        let nc = (eval_ - 1.0) * dm.leakage - geq * vd;
        sim.stamp_conductance(e.nodes[0], e.nodes[1], geq);
        sim.stamp_current_source(e.nodes[0], e.nodes[1], nc);
    } else {
        let geq = dm.leakage
            * (dm.vdcoef * (vd * dm.vdcoef).exp() + VZCOEF * ((-vd - dm.zoffset) * VZCOEF).exp())
            + gmin;
        let nc = dm.leakage
            * ((vd * dm.vdcoef).exp() - ((-vd - dm.zoffset) * VZCOEF).exp() - 1.0)
            + geq * (-vd);
        sim.stamp_conductance(e.nodes[0], e.nodes[1], geq);
        sim.stamp_current_source(e.nodes[0], e.nodes[1], nc);
    }
    let mut e = sim.elms[i];
    e.s[0] = vd;
    e.s[1] = diode_current(&dm, vd);
    sim.elms[i] = e;
}

fn transistor_limit_step(
    vt: f64,
    vcrit: f64,
    mut vnew: f64,
    vold: f64,
    converged: &mut bool,
) -> f64 {
    if vnew > vcrit && (vnew - vold).abs() > (vt + vt) {
        if vold > 0.0 {
            let arg = 1.0 + (vnew - vold) / vt;
            vnew = if arg > 0.0 {
                vold + vt * arg.ln()
            } else {
                vcrit
            };
        } else {
            vnew = vt * (vnew / vt).ln();
        }
        *converged = false;
    }
    vnew
}

fn do_step_transistor(sim: &mut Sim, i: usize) {
    let mut e = sim.elms[i];
    let pnp = e.pnp();
    let beta = if e.p[0] > 0.0 { e.p[0] } else { 100.0 };
    let csat = if e.p[1] > 0.0 { e.p[1] } else { 1e-13 };
    // default model constants (circuitjs1 "default")
    let beta_r = 1.0;
    let em_f = 1.0;
    let em_r = 1.0;
    let oik = 0.0f64;
    let oikr = 0.0f64;
    let c2 = 0.0f64;
    let c4 = 0.0f64;
    let inv_early_f = 0.0f64;
    let inv_early_r = 0.0f64;
    let vte = 1.5 * VT;
    let vtc = 2.0 * VT;

    let vcrit = VT * (VT / (std::f64::consts::SQRT_2 * csat)).ln();

    let mut vbc = pnp * (sim.nv(e.nodes[0]) - sim.nv(e.nodes[1]));
    let mut vbe = pnp * (sim.nv(e.nodes[0]) - sim.nv(e.nodes[2]));
    if (vbc - e.s[0]).abs() > 0.01 || (vbe - e.s[1]).abs() > 0.01 {
        sim.converged = false;
        e.s[2] += 1.0;
    } else {
        e.s[2] = 0.0;
    }

    let mut gmin = 1e-12f64;
    if e.s[2] > 100.0 {
        gmin = (-9.0f64.ln() * (1.0 - e.s[2] / 300.0)).exp();
        if gmin > 0.1 {
            gmin = 0.1;
        }
    }

    let mut converged = sim.converged;
    vbc = transistor_limit_step(VT, vcrit, vbc, e.s[0], &mut converged);
    vbe = transistor_limit_step(VT, vcrit, vbe, e.s[1], &mut converged);
    sim.converged = converged;
    e.s[0] = vbc;
    e.s[1] = vbe;

    let vtn = VT * em_f;
    let cbe: f64;
    let gbe: f64;
    let cben: f64;
    let gben: f64;
    if vbe > -5.0 * vtn {
        let evbe = (vbe / vtn).exp();
        cbe = csat * (evbe - 1.0) + gmin * vbe;
        gbe = csat * evbe / vtn + gmin;
        if c2 == 0.0 {
            cben = 0.0;
            gben = 0.0;
        } else {
            let evben = (vbe / vte).exp();
            cben = c2 * (evben - 1.0);
            gben = c2 * evben / vte;
        }
    } else {
        gbe = -csat / vbe + gmin;
        cbe = gbe * vbe;
        gben = -c2 / vbe;
        cben = gben * vbe;
    }
    let vtn2 = VT * em_r;
    let cbc: f64;
    let gbc: f64;
    let cbcn: f64;
    let gbcn: f64;
    if vbc > -5.0 * vtn2 {
        let evbc = (vbc / vtn2).exp();
        cbc = csat * (evbc - 1.0) + gmin * vbc;
        gbc = csat * evbc / vtn2 + gmin;
        if c4 == 0.0 {
            cbcn = 0.0;
            gbcn = 0.0;
        } else {
            let evbcn = (vbc / vtc).exp();
            cbcn = c4 * (evbcn - 1.0);
            gbcn = c4 * evbcn / vtc;
        }
    } else {
        gbc = -csat / vbc + gmin;
        cbc = gbc * vbc;
        gbcn = -c4 / vbc;
        cbcn = gbcn * vbc;
    }

    let q1 = 1.0 / (1.0 - inv_early_f * vbc - inv_early_r * vbe);
    let qb: f64;
    let dqbdve: f64;
    let dqbdvc: f64;
    if oik == 0.0 && oikr == 0.0 {
        qb = q1;
        dqbdve = q1 * qb * inv_early_r;
        dqbdvc = q1 * qb * inv_early_f;
    } else {
        let q2 = oik * cbe + oikr * cbc;
        let arg = (1.0 + 4.0 * q2).max(0.0);
        let sqarg = arg.sqrt();
        qb = q1 * (1.0 + sqarg) / 2.0;
        dqbdve = q1 * (qb * inv_early_r + oik * gbe / sqarg);
        dqbdvc = q1 * (qb * inv_early_f + oikr * gbc / sqarg);
    }

    let cex = cbe;
    let gex = gbe;
    let cc = (cex - cbc) / qb - cbc / beta_r - cbcn;
    let cb = cbe / beta + cben + cbc / beta_r + cbcn;

    let ic = pnp * cc;
    let ib = pnp * cb;
    let ie = pnp * (-cc - cb);

    let gpi = gbe / beta + gben;
    let gmu = gbc / beta_r + gbcn;
    let go = (gbc + (cex - cbc) * dqbdvc / qb) / qb;
    let gm = (gex - (cex - cbc) * dqbdve / qb) / qb - go;

    let ceqbe = pnp * (cc + cb - vbe * (gm + go + gpi) + vbc * go);
    let ceqbc = pnp * (-cc + vbe * (gm + go) - vbc * (gmu + go));

    if !ic.is_finite() || ic.is_nan() {
        sim.stop_msg = Some("Infinite transistor current!");
    }

    // nodes: 0 = base, 1 = collector, 2 = emitter (ports of stampMatrix)
    let (nb, ncol, ne) = (e.nodes[0], e.nodes[1], e.nodes[2]);
    sim.stamp_nm(ncol, ncol, gmu + go);
    sim.stamp_nm(ncol, nb, -gmu + gm);
    sim.stamp_nm(ncol, ne, -gm - go);
    sim.stamp_nm(nb, nb, gpi + gmu);
    sim.stamp_nm(nb, ne, -gpi);
    sim.stamp_nm(nb, ncol, -gmu);
    sim.stamp_nm(ne, nb, -gpi - gm);
    sim.stamp_nm(ne, ncol, -go);
    sim.stamp_nm(ne, ne, gpi + gm + go);

    sim.stamp_rhs_node(nb, -ceqbe - ceqbc);
    sim.stamp_rhs_node(ncol, ceqbc);
    sim.stamp_rhs_node(ne, ceqbe);

    e.out[6] = ic;
    e.s[3] = ic;
    e.s[4] = ib;
    e.s[5] = ie;
    sim.elms[i] = e;
}

// faithful port of MosfetElm.nonConvergence (progressive leniency!)
fn mosfet_nonconvergence(last: f64, now: f64, beta: f64, subiter: usize) -> bool {
    let mut diff = (last - now).abs();
    // high beta MOSFETs are more sensitive to small differences
    if beta > 1.0 {
        diff *= 100.0;
    }
    // difference of less than 10mV is fine
    if diff < 0.01 {
        return false;
    }
    // larger differences are fine if value is large
    if subiter > 10 && diff < now.abs() * 0.001 {
        return false;
    }
    // if we're having trouble converging, get more lenient
    if subiter > 100 && diff < 0.01 + (subiter - 100) as f64 * 0.0001 {
        return false;
    }
    true
}

fn do_step_mosfet(sim: &mut Sim, i: usize) {
    let mut e = sim.elms[i];
    let pnp = e.pnp();
    let vt = if e.p[0] != 0.0 { e.p[0] } else { 1.5 };
    let beta = if e.p[1] > 0.0 { e.p[1] } else { 0.02 };

    // limit voltage changes to .5V
    let v0 = sim.nv(e.nodes[0]);
    let mut v1 = sim.nv(e.nodes[1]);
    let mut v2 = sim.nv(e.nodes[2]);
    if v1 > e.s[1] + 0.5 {
        v1 = e.s[1] + 0.5;
    }
    if v1 < e.s[1] - 0.5 {
        v1 = e.s[1] - 0.5;
    }
    if v2 > e.s[2] + 0.5 {
        v2 = e.s[2] + 0.5;
    }
    if v2 < e.s[2] - 0.5 {
        v2 = e.s[2] - 0.5;
    }

    let mut source = 1usize;
    let mut drain = 2usize;
    if pnp * v1 > pnp * v2 {
        source = 2;
        drain = 1;
    }
    let vg = if source == 1 { v1 } else { v2 };
    let vd_ = if drain == 1 { v1 } else { v2 };
    // real (un-flipped) voltages for the Newton linearization, like the original
    let realvgs = v0 - vg;
    let realvds = vd_ - vg;
    let vgs = realvgs * pnp;
    let vds = realvds * pnp;
    if mosfet_nonconvergence(e.s[1], v1, beta, sim.subiter)
        || mosfet_nonconvergence(e.s[2], v2, beta, sim.subiter)
        || mosfet_nonconvergence(e.s[0], v0, beta, sim.subiter)
    {
        sim.converged = false;
    }
    e.s[0] = v0;
    e.s[1] = v1;
    e.s[2] = v2;

    let mut ids = 0.0f64;
    let mut gm = 0.0f64;
    let mut gds = 0.0f64;
    if vgs < vt {
        // off: large resistor to avoid singular matrix
        gds = 1e-8;
        ids = vds * gds;
    } else if vds < vgs - vt {
        // linear region
        ids = beta * ((vgs - vt) * vds - vds * vds * 0.5);
        gm = beta * vds;
        gds = beta * (vgs - vds - vt);
    } else {
        // saturation
        let vgs_vt = vgs - vt;
        gm = beta * vgs_vt;
        gds = 0.5 * beta * vgs_vt * vgs_vt * 0.0; // lambda=0
        let mut gds_min = 0.0f64;
        if gds < 1e-8 {
            gds_min = 1e-8 - gds;
            gds = 1e-8;
        }
        ids = 0.5 * beta * vgs_vt * vgs_vt + (vds - vgs_vt) * gds_min;
    }

    let ids0 = ids;
    if (source == 2 && pnp == 1.0) || (source == 1 && pnp == -1.0) {
        ids = -ids;
    }

    let rs = -pnp * ids0 + gds * realvds + gm * realvgs;
    let nd = e.nodes[drain];
    let ns = e.nodes[source];
    let ng = e.nodes[0];
    sim.stamp_nm(nd, nd, gds);
    sim.stamp_nm(nd, ns, -gds - gm);
    sim.stamp_nm(nd, ng, gm);
    sim.stamp_nm(ns, nd, -gds);
    sim.stamp_nm(ns, ns, gds + gm);
    sim.stamp_nm(ns, ng, -gm);
    sim.stamp_rhs_node(nd, rs);
    sim.stamp_rhs_node(ns, -rs);

    e.out[6] = ids;
    e.s[3] = ids;
    sim.elms[i] = e;
}

fn do_step_opamp(sim: &mut Sim, i: usize) {
    let mut e = sim.elms[i];
    let vd = sim.nv(e.nodes[1]) - sim.nv(e.nodes[0]);
    let max_out = e.p[0];
    let min_out = e.p[1];
    let gain = if e.p[2] > 0.0 { e.p[2] } else { 100000.0 };
    let midpoint = (max_out + min_out) * 0.5;
    if (e.s[0] - vd).abs() > 0.1 {
        sim.converged = false;
    } else if sim.nv(e.nodes[2]) > max_out + 0.1 || sim.nv(e.nodes[2]) < min_out - 0.1 {
        sim.converged = false;
    }
    let mut x = 0.0f64;
    let mut dx = 0.0f64;
    let max_adj = max_out - midpoint;
    let min_adj = min_out - midpoint;
    if vd >= max_adj / gain && e.s[0] >= 0.0 {
        dx = 1e-4;
        x = max_out - dx * max_adj / gain;
    } else if vd <= min_adj / gain && e.s[0] <= 0.0 {
        dx = 1e-4;
        x = min_out - dx * min_adj / gain;
    } else {
        dx = gain;
        x = midpoint;
    }
    // newton-raphson stamps
    sim.stamp_vs_row(e.vs_base as usize, e.nodes[0], dx);
    sim.stamp_vs_row(e.vs_base as usize, e.nodes[1], -dx);
    sim.stamp_vs_row(e.vs_base as usize, e.nodes[2], 1.0);
    sim.stamp_vs_rhs(e.vs_base as usize, x);
    e.s[0] = vd;
    sim.elms[i] = e;
}

fn gate_calc(e: &Elem, sim: &Sim) -> bool {
    let n_in = e.nposts - 1;
    let high_v = if e.p[0] > 0.0 { e.p[0] } else { 5.0 };
    let mut result: bool = match e.etype {
        T_AND | T_NAND => true,
        T_OR | T_NOR => false,
        T_XOR | T_XNOR => false,
        _ => false,
    };
    for k in 0..n_in {
        let b = sim.nv(e.nodes[k]) > high_v * 0.5;
        match e.etype {
            T_AND | T_NAND => result = result && b,
            T_OR | T_NOR => result = result || b,
            T_XOR | T_XNOR => result = result ^ b,
            T_INVERTER | T_BUFFER => result = b,
            _ => {}
        }
    }
    result
}

fn do_step_gate(sim: &mut Sim, i: usize) {
    let mut e = sim.elms[i];
    let high_v = if e.p[0] > 0.0 { e.p[0] } else { 5.0 };
    let mut f = gate_calc(&e, sim);
    match e.etype {
        T_NAND | T_NOR | T_XNOR | T_INVERTER => f = !f,
        _ => {}
    }
    // oscillation damping, evaluated once per timestep (like the original)
    let last_out = e.flags_out & F_CLOSED != 0;
    if e.s[3] != sim.t {
        e.s[3] = sim.t;
        if last_out == !f {
            e.s[1] += 1.0;
            if e.s[1] > 50.0 {
                e.s[1] = 0.0;
                // pseudo-random tie-break to break oscillation
                let mut rng = (e.s[2] as u64) | 1;
                rng ^= rng << 13;
                rng ^= rng >> 7;
                rng ^= rng << 17;
                e.s[2] = (rng & 0xFFFF) as f64;
                if rng & 1 == 1 {
                    f = last_out;
                }
            }
        } else {
            e.s[1] = 0.0;
        }
    }
    e.flags_out = if f {
        e.flags_out | F_CLOSED
    } else {
        e.flags_out & !F_CLOSED
    };
    let res = if f { high_v } else { 0.0 };
    let outp = e.nposts - 1;
    sim.stamp_vs_rhs(e.vs_base as usize, res);
    e.out[6] = res;
    e.out[2 + outp] = 0.0; // cleared; actual current set in calculate_current
    sim.elms[i] = e;
}

fn do_step_dff(sim: &mut Sim, i: usize) {
    let mut e = sim.elms[i];
    let hi = if e.p[0] > 0.0 { e.p[0] } else { 5.0 };
    let clk = sim.nv(e.nodes[0]) > hi * 0.5;
    let last_clk = e.s[0] > 0.5;
    if clk && !last_clk {
        let d = sim.nv(e.nodes[1]) > hi * 0.5;
        e.flags_out = if d {
            e.flags_out | F_CLOSED
        } else {
            e.flags_out & !F_CLOSED
        };
    }
    e.s[0] = if clk { 1.0 } else { 0.0 };
    let q = e.flags_out & F_CLOSED != 0;
    sim.stamp_vs_rhs(e.vs_base as usize, if q { hi } else { 0.0 });
    sim.stamp_vs_rhs((e.vs_base + 1) as usize, if q { 0.0 } else { hi });
    e.out[6] = if q { hi } else { 0.0 };
    sim.elms[i] = e;
}

fn do_step_adc(sim: &mut Sim, i: usize) {
    let e = sim.elms[i];
    let hi = if e.p[0] > 0.0 { e.p[0] } else { 5.0 };
    let val = ((sim.nv(e.nodes[0]) / hi) * 16.0)
        .floor()
        .clamp(0.0, 15.0) as u32;
    for k in 0..4 {
        let bit = (val >> k) & 1;
        sim.stamp_vs_rhs((e.vs_base + k) as usize, if bit == 1 { hi } else { 0.0 });
    }
    sim.elms[i].out[6] = val as f64;
}

fn do_step_dac(sim: &mut Sim, i: usize) {
    let e = sim.elms[i];
    let hi = if e.p[0] > 0.0 { e.p[0] } else { 5.0 };
    let mut val = 0u32;
    for k in 0..4 {
        if sim.nv(e.nodes[k]) > hi * 0.5 {
            val |= 1 << k;
        }
    }
    let out = (val as f64 / 16.0) * hi;
    sim.stamp_vs_rhs(e.vs_base as usize, out);
    sim.elms[i].out[6] = out;
}

// ---------------- after-solve current calculations ----------------

pub fn calculate_current(sim: &mut Sim, i: usize) {
    let mut e = sim.elms[i];
    match e.etype {
        T_RESISTOR | T_LAMP => {
            let vd = sim.nv(e.nodes[0]) - sim.nv(e.nodes[1]);
            let cur = vd / e.p[0];
            e.out[0] = vd;
            e.out[1] = vd * cur;
            e.out[2] = -cur; // current into element at post0
            e.out[3] = cur;
            if e.etype == T_LAMP {
                e.s[1] = (vd * cur).abs();
            }
        }
        T_POT => {
            let r = e.p[0];
            let pos = e.p[1].clamp(0.0, 1.0);
            let ra = (r * pos).max(1e-9);
            let rb = (r * (1.0 - pos)).max(1e-9);
            let va = sim.nv(e.nodes[0]) - sim.nv(e.nodes[2]);
            let vb = sim.nv(e.nodes[2]) - sim.nv(e.nodes[1]);
            let ia = va / ra;
            let ib = vb / rb;
            e.out[0] = va;
            e.out[1] = va * ia;
            e.out[2] = -ia;
            e.out[3] = -ib;
            e.out[4] = ia + ib;
        }
        T_CAPACITOR => {
            let vd = sim.nv(e.nodes[0]) - sim.nv(e.nodes[1]);
            e.s[3] = vd / e.s[1] + e.s[2];
            e.out[0] = vd;
            e.out[1] = vd * e.s[3];
            e.out[2] = -e.s[3];
            e.out[3] = e.s[3];
        }
        T_INDUCTOR => {
            let vd = sim.nv(e.nodes[0]) - sim.nv(e.nodes[1]);
            e.s[3] = vd;
            e.out[0] = vd;
            e.out[1] = vd * e.s[0];
            e.out[2] = -e.s[0];
            e.out[3] = e.s[0];
        }
        T_DIODE | T_LED | T_ZENER => {
            let vd = sim.nv(e.nodes[0]) - sim.nv(e.nodes[1]);
            let dm = diode_model(e.p[0], e.p[1], e.p[3]);
            let cur = diode_current(&dm, vd);
            e.s[1] = cur;
            e.out[0] = vd;
            e.out[1] = vd * cur;
            e.out[2] = -cur;
            e.out[3] = cur;
            e.flags_out = if cur > 1e-6 { 1 } else { 0 };
        }
        T_TRANSISTOR => {
            let vbe = sim.nv(e.nodes[0]) - sim.nv(e.nodes[2]);
            let vce = sim.nv(e.nodes[1]) - sim.nv(e.nodes[2]);
            e.out[0] = vbe;
            e.out[1] = vce * e.s[3];
            e.out[2] = -e.s[4]; // ib into base
            e.out[3] = -e.s[3]; // ic into collector
            e.out[4] = -e.s[5]; // ie into emitter
        }
        T_MOSFET => {
            let vgs = sim.nv(e.nodes[0]) - sim.nv(e.nodes[2]);
            let vds = sim.nv(e.nodes[1]) - sim.nv(e.nodes[2]);
            e.out[0] = vgs;
            e.out[1] = e.s[3] * vds;
            e.out[2] = 0.0; // gate
            e.out[3] = -e.s[3];
            e.out[4] = e.s[3];
        }
        T_VOLTAGE => {
            let vd = sim.nv(e.nodes[0]) - sim.nv(e.nodes[1]);
            let cur = sim.vs_current(e.vs_base);
            e.out[0] = vd;
            e.out[1] = vd * cur;
            e.out[2] = -cur;
            e.out[3] = cur;
            e.s[3] = cur;
        }
        T_RAIL => {
            let cur = sim.vs_current(e.vs_base);
            e.out[0] = e.p[0];
            e.out[1] = e.p[0] * cur;
            e.out[2] = cur;
            e.s[3] = cur;
        }
        T_CURRENT => {
            let vd = sim.nv(e.nodes[0]) - sim.nv(e.nodes[1]);
            e.out[0] = vd;
            e.out[1] = vd * e.p[0];
            e.out[2] = -e.p[0];
            e.out[3] = e.p[0];
        }
        T_SWITCH => {
            let vd = sim.nv(e.nodes[0]) - sim.nv(e.nodes[1]);
            let cur = if e.flags & F_CLOSED != 0 && e.p[0] > 0.0 {
                vd / e.p[0]
            } else {
                0.0
            };
            e.out[0] = vd;
            e.out[1] = vd * cur;
            e.out[2] = -cur;
            e.out[3] = cur;
        }
        T_SPARK_GAP => {
            let vd = sim.nv(e.nodes[0]) - sim.nv(e.nodes[1]);
            let r = if e.flags & F_CLOSED != 0 { 0.001 } else { 1e6 };
            let cur = vd / r;
            e.out[0] = vd;
            e.out[1] = vd * cur;
            e.out[2] = -cur;
            e.out[3] = cur;
        }
        T_AMMETER => {
            let cur = sim.vs_current(e.vs_base);
            e.out[0] = sim.nv(e.nodes[0]) - sim.nv(e.nodes[1]);
            e.out[1] = 0.0;
            e.out[2] = -cur;
            e.out[3] = cur;
            e.s[3] = cur;
        }
        T_VOLTMETER => {
            let vd = sim.nv(e.nodes[0]) - sim.nv(e.nodes[1]);
            let cur = vd / 1e9;
            e.out[0] = vd;
            e.out[1] = vd * cur;
            e.out[2] = -cur;
            e.out[3] = cur;
        }
        T_OHMMETER => {
            // mirrors circuitjs1 CurrentElm.getVoltageDiff() which is REVERSED
            // (nodes[1].v - nodes[0].v) so R = out[0]/out[3] is positive on passive nets
            let vd = sim.nv(e.nodes[1]) - sim.nv(e.nodes[0]);
            e.out[0] = vd;
            e.out[1] = 0.0;
            e.out[2] = -0.01;
            e.out[3] = 0.01;
        }
        T_OPAMP => {
            let cur = sim.vs_current(e.vs_base);
            let vd = sim.nv(e.nodes[1]) - sim.nv(e.nodes[0]);
            e.out[0] = vd;
            e.out[1] = sim.nv(e.nodes[2]) * cur;
            e.out[2] = 0.0;
            e.out[3] = 0.0;
            e.out[4] = -cur;
        }
        T_COMPARATOR => {
            let cur = sim.vs_current(e.vs_base);
            e.out[0] = sim.nv(e.nodes[0]) - sim.nv(e.nodes[1]);
            e.out[1] = e.out[6] * cur;
            e.out[2] = 0.0;
            e.out[3] = 0.0;
            e.out[4] = -cur;
        }
        T_AND | T_OR | T_NAND | T_NOR | T_XOR | T_XNOR | T_INVERTER | T_BUFFER => {
            let cur = sim.vs_current(e.vs_base);
            let outp = e.nposts - 1;
            e.out[0] = sim.nv(e.nodes[0]);
            e.out[1] = e.out[6] * cur;
            e.out[2 + outp] = -cur;
        }
        T_LOGIC_INPUT | T_CLOCK_INPUT => {
            let cur = sim.vs_current(e.vs_base);
            e.out[0] = sim.nv(e.nodes[0]);
            e.out[1] = e.out[6] * cur;
            e.out[2] = -cur;
        }
        T_LOGIC_OUTPUT => {
            let hi = if e.p[0] > 0.0 { e.p[0] } else { 5.0 };
            e.out[0] = sim.nv(e.nodes[0]);
            e.flags_out = if sim.nv(e.nodes[0]) > hi * 0.5 { 1 } else { 0 };
        }
        T_DFF => {
            let q_cur = sim.vs_current(e.vs_base);
            let qb_cur = sim.vs_current(e.vs_base + 1);
            e.out[0] = sim.nv(e.nodes[2]);
            e.out[4] = -q_cur;
            e.out[5] = -qb_cur;
        }
        T_ADC => {
            e.out[0] = sim.nv(e.nodes[0]);
            for k in 0usize..4 {
                let cur = sim.vs_current(e.vs_base + k as i32);
                e.out[3 + k] = -cur;
            }
        }
        T_DAC => {
            let cur = sim.vs_current(e.vs_base);
            e.out[0] = sim.nv(e.nodes[4]);
            e.out[1] = e.out[6] * cur;
            e.out[6] = e.out[6]; // keep value
            e.out[2 + 4] = -cur;
        }
        T_TRANSFORMER => {
            let vd1 = sim.nv(e.nodes[0]) - sim.nv(e.nodes[2]);
            let vd2 = sim.nv(e.nodes[1]) - sim.nv(e.nodes[3]);
            e.s[0] = vd1 / e.s[2] + e.s[12];
            e.s[1] = vd2 / e.s[3] + e.s[13];
            e.out[0] = vd1;
            e.out[1] = vd2;
            e.out[2] = -e.s[0];
            e.out[3] = -e.s[1];
            e.out[4] = e.s[0];
            e.out[5] = e.s[1];
        }
        _ => {}
    }
    sim.elms[i] = e;
}

// ---------------- step finished (state updates after timestep) ----------------

pub fn step_finished(sim: &mut Sim, i: usize) {
    match sim.elms[i].etype {
        T_CAPACITOR => {
            let mut e = sim.elms[i];
            e.s[0] = sim.nv(e.nodes[0]) - sim.nv(e.nodes[1]);
            e.s[3] = e.s[0] / e.s[1] + e.s[2];
            sim.elms[i] = e;
        }
        T_INDUCTOR => {
            let mut e = sim.elms[i];
            let vd = sim.nv(e.nodes[0]) - sim.nv(e.nodes[1]);
            e.s[3] = vd;
            e.s[0] = vd / e.s[1] + e.s[2];
            sim.elms[i] = e;
        }
        T_SPARK_GAP => {
            let mut e = sim.elms[i];
            let vd = (sim.nv(e.nodes[0]) - sim.nv(e.nodes[1])).abs();
            let was_closed = e.flags & F_CLOSED != 0;
            if !was_closed && vd > e.p[0] {
                e.flags |= F_CLOSED;
                sim.needs_analyze = true;
            } else if was_closed && vd < e.p[0] * 0.3 {
                e.flags &= !F_CLOSED;
                sim.needs_analyze = true;
            }
            sim.elms[i] = e;
        }
        T_MOSFET => {
            // recompute actual currents with real voltages for display
            let mut e = sim.elms[i];
            let pnp = e.pnp();
            let vt = if e.p[0] != 0.0 { e.p[0] } else { 1.5 };
            let beta = if e.p[1] > 0.0 { e.p[1] } else { 0.02 };
            let v0 = sim.nv(e.nodes[0]);
            let v1 = sim.nv(e.nodes[1]);
            let v2 = sim.nv(e.nodes[2]);
            let mut source = 1usize;
            let mut drain = 2usize;
            if pnp * v1 > pnp * v2 {
                source = 2;
                drain = 1;
            }
            let vg = if source == 1 { v1 } else { v2 };
            let vd_ = if drain == 1 { v1 } else { v2 };
            let vgs = (v0 - vg) * pnp;
            let vds = (vd_ - vg) * pnp;
            let mut ids = 0.0f64;
            if vgs < vt {
                ids = vds * 1e-8;
            } else if vds < vgs - vt {
                ids = beta * ((vgs - vt) * vds - vds * vds * 0.5);
            } else {
                let vgs_vt = vgs - vt;
                ids = 0.5 * beta * vgs_vt * vgs_vt;
            }
            if (source == 2 && pnp == 1.0) || (source == 1 && pnp == -1.0) {
                ids = -ids;
            }
            e.s[3] = ids;
            e.out[3] = -ids;
            e.out[4] = ids;
            sim.elms[i] = e;
        }
        _ => {}
    }
}

// ---------------- run loop ----------------

/// Run up to `steps` timesteps or until `budget_ms` elapsed. Returns steps executed.
pub fn run_circuit(sim: &mut Sim, mut steps: i32, budget_ms: f64) -> i32 {
    if sim.stop_msg.is_some() || sim.elms.is_empty() || sim.size == 0 {
        return 0;
    }
    let start = now_ms();
    let mut executed = 0i32;
    let max_subiter = if sim.adjust_timestep { 100 } else { 5000 };

    while steps > 0 {
        // adaptive timestep: double when things go well
        if sim.adjust_timestep && sim.good_iterations >= 3 && sim.dt < sim.dt_max {
            sim.dt = (sim.dt * 2.0).min(sim.dt_max);
            let _ = stamp_circuit(sim);
            sim.good_iterations = 0;
        }

        // companion sources: computed ONCE per timestep (state from previous step)
        for i in 0..sim.elms.len() {
            start_iteration(sim, i);
        }

        let mut subiter = 0usize;
        let mut retry_needed = false;
        loop {
            sim.converged = true;
            sim.subiter = subiter;
            // restore RHS (and matrix if nonlinear)
            sim.rhs.copy_from_slice(&sim.orig_rhs);
            if sim.nonlinear {
                sim.matrix.copy_from_slice(&sim.orig_matrix);
            }
            for i in 0..sim.elms.len() {
                do_step(sim, i);
                if sim.stop_msg.is_some() {
                    return executed;
                }
            }
            // When converged on a later subiter, the original skips factor+solve+apply
            // entirely and breaks with the node voltages from the previous solve.
            let skip_solve = sim.nonlinear && sim.converged && subiter > 0;
            if !skip_solve {
                // solve
                if sim.nonlinear {
                    let ok = {
                        let mut matrix = std::mem::take(&mut sim.matrix);
                        let mut ipvt = std::mem::take(&mut sim.ipvt);
                        let ok = lu_factor(&mut matrix, sim.size, &mut ipvt);
                        sim.matrix = matrix;
                        sim.ipvt = ipvt;
                        ok
                    };
                    if !ok {
                        sim.stop_msg = Some("Singular matrix!");
                        return executed;
                    }
                }
                {
                    let mut matrix = std::mem::take(&mut sim.matrix);
                    let ipvt = std::mem::take(&mut sim.ipvt);
                    let mut rhs = std::mem::take(&mut sim.rhs);
                    lu_solve(&matrix, sim.size, &ipvt, &mut rhs);
                    sim.matrix = matrix;
                    sim.ipvt = ipvt;
                    sim.rhs = rhs;
                }
                // apply solution: node voltages + currents
                sim.solution.copy_from_slice(&sim.rhs);
                let n_nodes = sim.n_nodes;
                let mut bad = false;
                for j in 0..sim.size {
                    let res = sim.solution[j];
                    if res.is_nan() || !res.is_finite() {
                        bad = true;
                        break;
                    }
                    if j < n_nodes - 1 {
                        sim.node_v[j + 1] = res;
                    }
                }
                if bad {
                    sim.converged = false;
                }
                for i in 0..sim.elms.len() {
                    calculate_current(sim, i);
                }
            }

            if sim.converged && subiter > 0 {
                break;
            }
            if !sim.nonlinear {
                if sim.converged {
                    break;
                }
                // linear circuit produced NaN/Inf: retry like a convergence failure
                if subiter == 0 {
                    retry_needed = true;
                    break;
                }
                break;
            }
            subiter += 1;
            if subiter >= max_subiter {
                retry_needed = true;
                break;
            }
        }

        if retry_needed {
            sim.good_iterations = 0;
            sim.failure_count += 1;
            if sim.adjust_timestep && sim.dt / 2.0 >= sim.dt_min && sim.failure_count < 8 {
                sim.dt /= 2.0;
                sim.node_v.copy_from_slice(&sim.last_node_v);
                let _ = stamp_circuit(sim);
                if !sim.nonlinear {
                    let mut matrix = std::mem::take(&mut sim.matrix);
                    let mut ipvt = std::mem::take(&mut sim.ipvt);
                    let _ = lu_factor(&mut matrix, sim.size, &mut ipvt);
                    sim.matrix = matrix;
                    sim.ipvt = ipvt;
                }
                // retry same timestep (time not advanced)
                if now_ms() - start > budget_ms {
                    break;
                }
                continue;
            } else {
                sim.stop_msg = Some("Convergence failed!");
                return executed;
            }
        }
        sim.failure_count = 0;

        // timestep accepted
        if subiter < 3 {
            sim.good_iterations += 1;
        } else {
            sim.good_iterations = 0;
        }
        sim.t += sim.dt;
        sim.last_node_v.copy_from_slice(&sim.node_v);
        for i in 0..sim.elms.len() {
            step_finished(sim, i);
        }
        sample_scopes(sim);
        if sim.needs_analyze {
            sim.needs_analyze = false;
            let _ = analyze(sim);
        }
        executed += 1;
        steps -= 1;
        if now_ms() - start > budget_ms {
            break;
        }
    }
    sim.refresh_outputs();
    executed
}

fn sample_scopes(sim: &mut Sim) {
    for (ch, &idx) in sim.scope_channels.iter().enumerate() {
        if idx >= sim.elms.len() {
            continue;
        }
        let e = &sim.elms[idx];
        let v = match e.etype {
            T_RAIL => e.p[0],
            T_GROUND => 0.0,
            T_AND | T_OR | T_NAND | T_NOR | T_XOR | T_XNOR | T_INVERTER | T_BUFFER
            | T_LOGIC_INPUT | T_CLOCK_INPUT | T_DFF | T_ADC | T_DAC | T_LOGIC_OUTPUT => {
                if e.nposts > 0 {
                    let p = output_post_idx(e.etype, e.nposts);
                    if p < e.nodes.len() {
                        sim.node_v.get(e.nodes[p]).copied().unwrap_or(0.0)
                    } else {
                        e.out[0]
                    }
                } else {
                    e.out[0]
                }
            }
            _ => e.out[0],
        };
        let cur = match e.etype {
            T_TRANSISTOR => e.s[3], // ic
            T_MOSFET => e.s[3],
            T_DIODE | T_LED | T_ZENER => e.s[1],
            _ => e.out[3],
        };
        sim.scope_rings[ch].push(sim.t, v, cur);
    }
}

fn now_ms() -> f64 {
    unsafe { crate::now_ms_extern() }
}
