// WASM ABI for the circuit engine — manual, zero-dependency interface.
// Data flows through flat typed arrays in WASM linear memory.

pub mod elements;
pub mod lu;
pub mod sim;

use elements::{post_count, Elem};
use sim::{reset_elem, Sim};

// imported from JS: performance.now() in milliseconds
#[link(wasm_import_module = "env")]
extern "C" {
    fn perf_now() -> f64;
}

#[no_mangle]
pub unsafe fn now_ms_extern() -> f64 {
    perf_now()
}

// element i32 record layout, stride 14:
// [etype, flags, x0, y0, x1, y1, x2, y2, x3, y3, x4, y4, x5, y5]
const I32_STRIDE: usize = 14;
// params f64 record, stride 8
const F64_STRIDE: usize = 8;

#[no_mangle]
pub extern "C" fn sim_new() -> *mut Sim {
    let mut sim = Box::new(Sim::new());
    sim.scratch.reserve(1 << 20); // 1MB initial scratch
    Box::into_raw(sim)
}

#[no_mangle]
pub extern "C" fn sim_free(sim: *mut Sim) {
    if !sim.is_null() {
        unsafe {
            drop(Box::from_raw(sim));
        }
    }
}

/// Allocate scratch memory for JS->WASM transfers. Returns pointer.
#[no_mangle]
pub extern "C" fn sim_alloc(sim: *mut Sim, size: usize) -> *mut u8 {
    let sim = unsafe { &mut *sim };
    // align to 16
    let needed = (sim.scratch.len() + 15) & !15;
    sim.scratch.resize(needed + size, 0);
    sim.scratch.as_mut_ptr().wrapping_add(needed)
}

/// Reuse the scratch arena for the next transfer. Pointers returned by
/// `sim_alloc` are only valid until the next call that resets or grows the
/// arena, so JS resets it before each independent operation instead of
/// bump-allocating forever (which used to grow the WASM heap without bound).
#[no_mangle]
pub extern "C" fn sim_scratch_reset(sim: *mut Sim) {
    if sim.is_null() {
        return;
    }
    let sim = unsafe { &mut *sim };
    sim.scratch.clear();
}

/// Current scratch length (diagnostics / tests).
#[no_mangle]
pub extern "C" fn sim_scratch_len(sim: *mut Sim) -> usize {
    if sim.is_null() {
        return 0;
    }
    unsafe { (*sim).scratch.len() }
}

/// Load element list. Returns 0 on success.
#[no_mangle]
pub extern "C" fn sim_load(
    sim: *mut Sim,
    i32_ptr: *const i32,
    f64_ptr: *const f64,
    count: i32,
) -> i32 {
    let sim = unsafe { &mut *sim };
    let count = count as usize;
    let i32s = unsafe { std::slice::from_raw_parts(i32_ptr, count * I32_STRIDE) };
    let f64s = unsafe { std::slice::from_raw_parts(f64_ptr, count * F64_STRIDE) };
    sim.elms.clear();
    for k in 0..count {
        let base = k * I32_STRIDE;
        let etype = i32s[base] as u32;
        let flags = i32s[base + 1] as u32;
        let mut e = Elem::new(etype, flags);
        e.nposts = post_count(etype, flags).min(6);
        for j in 0..e.nposts {
            e.posts[j][0] = i32s[base + 2 + j * 2];
            e.posts[j][1] = i32s[base + 3 + j * 2];
        }
        for j in 0..8 {
            e.p[j] = f64s[k * F64_STRIDE + j];
        }
        reset_elem(&mut e);
        sim.elms.push(e);
    }
    sim.t = 0.0;
    0
}

/// Analyze circuit (node merging, stamping, LU). Returns 0 on success, -1 on error.
#[no_mangle]
pub extern "C" fn sim_analyze(sim: *mut Sim) -> i32 {
    let sim = unsafe { &mut *sim };
    match crate::sim::analyze(sim) {
        Ok(()) => 0,
        Err(_) => -1,
    }
}

/// Reset all state (t=0, zero currents/voltages).
#[no_mangle]
pub extern "C" fn sim_reset(sim: *mut Sim) {
    let sim = unsafe { &mut *sim };
    sim.reset_all();
    sim.refresh_outputs();
}

#[no_mangle]
pub extern "C" fn sim_set_dt_max(sim: *mut Sim, dt: f64) {
    let sim = unsafe { &mut *sim };
    if dt > 0.0 && dt != sim.dt_max {
        sim.dt_max = dt;
        sim.dt = dt;
        // companion models depend on dt: re-stamp + re-factor
        if sim.size > 0 {
            let _ = crate::sim::stamp_circuit(sim);
            if !sim.nonlinear {
                let mut matrix = std::mem::take(&mut sim.matrix);
                let mut ipvt = std::mem::take(&mut sim.ipvt);
                let _ = crate::lu::lu_factor(&mut matrix, sim.size, &mut ipvt);
                sim.matrix = matrix;
                sim.ipvt = ipvt;
            }
        }
    }
}

#[no_mangle]
pub extern "C" fn sim_set_adjust(sim: *mut Sim, on: i32) {
    let sim = unsafe { &mut *sim };
    sim.adjust_timestep = on != 0;
}

/// Run timesteps. Returns steps executed (may be less if budget exhausted or stopped).
#[no_mangle]
pub extern "C" fn sim_run(sim: *mut Sim, steps: i32, budget_ms: f64) -> i32 {
    let sim = unsafe { &mut *sim };
    sim::run_circuit(sim, steps, budget_ms)
}

#[no_mangle]
pub extern "C" fn sim_time(sim: *mut Sim) -> f64 {
    unsafe { (*sim).t }
}

#[no_mangle]
pub extern "C" fn sim_node_count(sim: *mut Sim) -> i32 {
    unsafe { (*sim).node_v.len() as i32 }
}

/// Pointer to node voltages (f64 array, length = sim_node_count)
#[no_mangle]
pub extern "C" fn sim_nodes_ptr(sim: *mut Sim) -> *const f64 {
    unsafe { (*sim).node_v.as_ptr() }
}

#[no_mangle]
pub extern "C" fn sim_elem_count(sim: *mut Sim) -> i32 {
    unsafe { (*sim).elms.len() as i32 }
}

/// Pointer to per-element outputs (f64 array, stride 8: [vd, power, i0, i1, i2, i3, extra, spare])
#[no_mangle]
pub extern "C" fn sim_elem_out_ptr(sim: *mut Sim) -> *const f64 {
    unsafe { (*sim).out_buf.as_ptr() }
}

/// Pointer to per-element flags (u32 array, stride 2: [state_flags, config_flags])
#[no_mangle]
pub extern "C" fn sim_elem_flags_ptr(sim: *mut Sim) -> *const u32 {
    unsafe { (*sim).flags_buf.as_ptr() }
}

#[no_mangle]
pub extern "C" fn sim_set_flags(sim: *mut Sim, idx: i32, flags: u32) {
    let sim = unsafe { &mut *sim };
    let idx = idx as usize;
    if idx < sim.elms.len() {
        sim.elms[idx].flags = flags;
    }
}

#[no_mangle]
pub extern "C" fn sim_set_param(sim: *mut Sim, idx: i32, param_idx: i32, value: f64) {
    let sim = unsafe { &mut *sim };
    let idx = idx as usize;
    if idx < sim.elms.len() && param_idx >= 0 && (param_idx as usize) < 8 {
        sim.elms[idx].p[param_idx as usize] = value;
    }
}

/// Set scope channels (element indices). Returns 0.
#[no_mangle]
pub extern "C" fn sim_set_scope(sim: *mut Sim, idx_ptr: *const i32, n: i32) {
    let sim = unsafe { &mut *sim };
    let n = n as usize;
    let idxs = unsafe { std::slice::from_raw_parts(idx_ptr, n) };
    sim.scope_channels = idxs.iter().map(|&x| x as usize).collect();
    sim.scope_rings = (0..n).map(|_| sim::ScopeRing::new_default()).collect();
}

/// Number of samples available in scope channel ch.
#[no_mangle]
pub extern "C" fn sim_scope_count(sim: *mut Sim, ch: i32) -> i32 {
    let sim = unsafe { &*sim };
    let ch = ch as usize;
    if ch < sim.scope_rings.len() {
        sim.scope_rings[ch].count as i32
    } else {
        0
    }
}

/// Copy newest `max` samples of channel ch into out (chronological order, stride 3: t, v, i).
/// Returns number of samples copied.
#[no_mangle]
pub extern "C" fn sim_scope_read(sim: *mut Sim, ch: i32, out: *mut f64, max: i32) -> i32 {
    let sim = unsafe { &mut *sim };
    let ch = ch as usize;
    if ch >= sim.scope_rings.len() || max <= 0 {
        return 0;
    }
    let ring = &mut sim.scope_rings[ch];
    let want = (max as usize).min(ring.count);
    if want == 0 {
        return 0;
    }
    let start = (ring.head + sim::SCOPE_CAP - want) % sim::SCOPE_CAP;
    let out_slice = unsafe { std::slice::from_raw_parts_mut(out, want * 3) };
    for k in 0..want {
        let src = ((start + k) % sim::SCOPE_CAP) * 3;
        out_slice[k * 3] = ring.data[src];
        out_slice[k * 3 + 1] = ring.data[src + 1];
        out_slice[k * 3 + 2] = ring.data[src + 2];
    }
    want as i32
}

/// Get error message pointer (static, NUL-terminated) or null.
#[no_mangle]
pub extern "C" fn sim_error(sim: *mut Sim) -> *const u8 {
    let sim = unsafe { &*sim };
    match sim.stop_msg {
        Some(msg) => msg.as_ptr(),
        None => std::ptr::null(),
    }
}

#[no_mangle]
pub extern "C" fn sim_clear_error(sim: *mut Sim) {
    let sim = unsafe { &mut *sim };
    sim.stop_msg = None;
}

/// Returns 1 if the engine needs re-analysis (structural change like spark gap).
#[no_mangle]
pub extern "C" fn sim_needs_analyze(sim: *mut Sim) -> i32 {
    let sim = unsafe { &*sim };
    sim.needs_analyze as i32
}

// ---- debug exports ----
#[no_mangle]
pub extern "C" fn sim_dbg_subiter(sim: *mut Sim) -> i32 {
    unsafe { (*sim).subiter as i32 }
}
#[no_mangle]
pub extern "C" fn sim_dbg_dt(sim: *mut Sim) -> f64 {
    unsafe { (*sim).dt }
}
#[no_mangle]
pub extern "C" fn sim_dbg_good(sim: *mut Sim) -> i32 {
    unsafe { (*sim).good_iterations }
}
#[no_mangle]
pub extern "C" fn sim_dbg_nonlinear(sim: *mut Sim) -> i32 {
    unsafe { (*sim).nonlinear as i32 }
}
#[no_mangle]
pub extern "C" fn sim_dbg_size(sim: *mut Sim) -> i32 {
    unsafe { (*sim).size as i32 }
}

#[no_mangle]
pub extern "C" fn sim_dbg_enable(sim: *mut Sim, on: i32) {
    let sim = unsafe { &mut *sim };
    sim.dbg_on = on != 0;
    sim.dbg_trace.clear();
}
#[no_mangle]
pub extern "C" fn sim_dbg_trace_ptr(sim: *mut Sim) -> *const f64 {
    unsafe { (*sim).dbg_trace.as_ptr() }
}
#[no_mangle]
pub extern "C" fn sim_dbg_trace_len(sim: *mut Sim) -> i32 {
    unsafe { (*sim).dbg_trace.len() as i32 }
}

/// Per-element node indices (u32, stride 6).
#[no_mangle]
pub extern "C" fn sim_elem_nodes_ptr(sim: *mut Sim) -> *const u32 {
    let sim = unsafe { &mut *sim };
    // build a fresh buffer in scratch (bump-allocated; JS reads immediately)
    let n = sim.elms.len();
    if n == 0 {
        return std::ptr::null();
    }
    let bytes_needed = n * 6 * 4;
    let aligned = (sim.scratch.len() + 15) & !15;
    sim.scratch.resize(aligned + bytes_needed, 0);
    let ptr = unsafe { sim.scratch.as_mut_ptr().add(aligned) as *mut u32 };
    for (k, e) in sim.elms.iter().enumerate() {
        for j in 0..6 {
            unsafe {
                *ptr.add(k * 6 + j) = if j < e.nposts { e.nodes[j] as u32 } else { u32::MAX };
            }
        }
    }
    ptr
}
