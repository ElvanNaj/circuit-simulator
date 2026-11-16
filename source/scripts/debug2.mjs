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
    for (let j = 0; j < 8; j++) f64[k*F+j] = ((e.params||[])[j] || 0);
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
console.log('size:', w.sim_dbg_size(sim), 'nonlinear:', w.sim_dbg_nonlinear(sim));
const done = w.sim_run(sim, 1, 10000);
console.log('done:', done, 'subiter:', w.sim_dbg_subiter(sim), 'dt:', w.sim_dbg_dt(sim), 'good:', w.sim_dbg_good(sim));
const err = w.sim_error(sim);
console.log('error:', err ? new TextDecoder().decode(new Uint8Array(w.memory.buffer, err)).split('\0')[0] : 'none');
