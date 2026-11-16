import { readFileSync } from 'fs';
const wasmBytes = readFileSync(new URL('../public/wasm/circuit_engine.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(wasmBytes, { env: { perf_now: () => performance.now() } });
const w = instance.exports;
const I32_STRIDE = 14, F64_STRIDE = 8;
const T = { WIRE:1, GROUND:2, RES:3, CAP:4, IND:5, VOLT:6, CUR:7, RAIL:8, SW:9, POT:10, LAMP:11, DIODE:12 };
function el(etype, flags, posts, params) { return { etype, flags, posts, params: params || [] }; }
function load(elements) {
  const sim = w.sim_new();
  const i32 = new Int32Array(elements.length * I32_STRIDE);
  const f64 = new Float64Array(elements.length * F64_STRIDE);
  elements.forEach((e, k) => {
    const b = k * I32_STRIDE;
    i32[b] = e.etype; i32[b+1] = e.flags;
    for (let j = 0; j < 6; j++) { i32[b+2+j*2] = e.posts[j]?.[0]||0; i32[b+3+j*2] = e.posts[j]?.[1]||0; }
    for (let j = 0; j < 8; j++) f64[k*F64_STRIDE+j] = e.params[j]||0;
  });
  const p1 = w.sim_alloc(sim, i32.byteLength); new Uint8Array(w.memory.buffer, p1, i32.byteLength).set(new Uint8Array(i32.buffer));
  const p2 = w.sim_alloc(sim, f64.byteLength); new Uint8Array(w.memory.buffer, p2, f64.byteLength).set(new Uint8Array(f64.buffer));
  w.sim_load(sim, p1, p2, elements.length);
  return sim;
}

const elms = [
  el(T.VOLT, 0, [[0,0],[100,0]], [0, 5, 0, 0, 0]),
  el(T.DIODE, 0, [[100,0],[200,0]], [1.7143528192808883e-7, 0, 0]),
  el(T.RES, 0, [[200,0],[300,0]], [1000]),
  el(T.WIRE, 0, [[0,0],[300,0]]),
  el(T.GROUND, 0, [[300,0]])
];
const sim = load(elms);
console.log('analyze:', w.sim_analyze(sim));
w.sim_set_dt_max(sim, 5e-6);
console.log('node count:', w.sim_node_count(sim), 'elem count:', w.sim_elem_count(sim));
for (let step = 0; step < 6; step++) {
  const done = w.sim_run(sim, 1, 10000);
  const v = new Float64Array(w.memory.buffer, w.sim_nodes_ptr(sim), w.sim_node_count(sim));
  const out = new Float64Array(w.memory.buffer, w.sim_elem_out_ptr(sim), w.sim_elem_count(sim)*8);
  console.log(`step ${step}: done=${done} nodes=[${Array.from(v).map(x=>x.toFixed(4)).join(', ')}] diode.out=[${Array.from(out.slice(8,16)).map(x=>x.toExponential(3)).join(', ')}]`);
}
console.log('error:', w.sim_error(sim) ? new TextDecoder().decode(new Uint8Array(w.memory.buffer, w.sim_error(sim))).split('\0')[0] : 'none');
