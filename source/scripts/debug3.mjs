import { readFileSync } from 'fs';
const wasmBytes = readFileSync(new URL('../public/wasm/circuit_engine.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(wasmBytes, { env: { perf_now: () => performance.now() } });
const w = instance.exports;
const S = 14, F = 8;
const T = { WIRE:1, GROUND:2, RES:3, VOLT:6, DIODE:12 };
function load(elements) {
  const sim = w.sim_new();
  const i32 = new Int32Array(elements.length * S), f64 = new Float64Array(elements.length * F);
  elements.forEach((e, k) => {
    i32[k*S] = e.etype; i32[k*S+1] = e.flags;
    for (let j = 0; j < 6; j++) { i32[k*S+2+j*2] = e.posts[j]?.[0]||0; i32[k*S+3+j*2] = e.posts[j]?.[1]||0; }
    for (let j = 0; j < 8; j++) f64[k*F+j] = (e.params||[])[j] || 0;
  });
  const p1 = w.sim_alloc(sim, i32.byteLength); new Uint8Array(w.memory.buffer, p1, i32.byteLength).set(new Uint8Array(i32.buffer));
  const p2 = w.sim_alloc(sim, f64.byteLength); new Uint8Array(w.memory.buffer, p2, f64.byteLength).set(new Uint8Array(f64.buffer));
  w.sim_load(sim, p1, p2, elements.length);
  return sim;
}
const sim = load([
  { etype: T.VOLT, flags: 0, posts: [[0,0],[100,0]], params: [0,5,0,0,0] },
  { etype: T.DIODE, flags: 0, posts: [[100,0],[200,0]], params: [1.7143528192808883e-7, 0, 0] },
  { etype: T.RES, flags: 0, posts: [[200,0],[300,0]], params: [1000] },
  { etype: T.WIRE, flags: 0, posts: [[0,0],[300,0]] },
  { etype: T.GROUND, flags: 0, posts: [[300,0]] }
]);
console.log('analyze:', w.sim_analyze(sim));
w.sim_dbg_enable(sim, 1);
w.sim_set_dt_max(sim, 5e-6);
const done = w.sim_run(sim, 1, 10000);
console.log('done:', done);
const len = w.sim_dbg_trace_len(sim);
const trace = new Float64Array(w.memory.buffer, w.sim_dbg_trace_ptr(sim), len);
console.log('sub |  vd_raw   |  s0       |  limited  | conv |  V1       |  V2');
for (let k = 0; k < Math.min(len/8, 20); k++) {
  const b = k*8;
  console.log(`${trace[b].toFixed(0).padStart(3)} | ${trace[b+1].toPrecision(8)} | ${trace[b+2].toPrecision(8)} | ${trace[b+3].toPrecision(8)} | ${(trace[b+4]).toFixed(0)}    | ${trace[b+5].toPrecision(8)} | ${trace[b+6].toPrecision(8)}`);
}
const err = w.sim_error(sim);
console.log('error:', err ? new TextDecoder().decode(new Uint8Array(w.memory.buffer, err)).split('\0')[0] : 'none');
