import { readFileSync } from 'fs';
const wasmBytes = readFileSync(new URL('../public/wasm/circuit_engine.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(wasmBytes, { env: { perf_now: () => performance.now() } });
const w = instance.exports;
const S = 14, F = 8;
const T = { RAIL:8, RES:3, MOSFET:16, WIRE:1, GROUND:2, LOGIC_INPUT:27 };
function load(elements) {
  const sim = w.sim_new();
  const i32 = new Int32Array(elements.length*S), f64 = new Float64Array(elements.length*F);
  elements.forEach((e,k) => {
    i32[k*S]=e.etype; i32[k*S+1]=e.flags;
    for (let j=0;j<6;j++){ i32[k*S+2+j*2]=e.posts[j]?.[0]||0; i32[k*S+3+j*2]=e.posts[j]?.[1]||0; }
    for (let j=0;j<8;j++) f64[k*F+j]=(e.params||[])[j]||0;
  });
  const p1 = w.sim_alloc(sim, i32.byteLength); new Uint8Array(w.memory.buffer,p1,i32.byteLength).set(new Uint8Array(i32.buffer));
  const p2 = w.sim_alloc(sim, f64.byteLength); new Uint8Array(w.memory.buffer,p2,f64.byteLength).set(new Uint8Array(f64.buffer));
  w.sim_load(sim, p1, p2, elements.length);
  return sim;
}
// minimal: PMOS pull-up only, gate grounded, drain floats via 1M to gnd
const sim = load([
  { etype: T.RAIL, flags: 0, posts: [[200,40]], params: [5] },
  { etype: T.WIRE, flags: 0, posts: [[200,40],[260,40]] },
  { etype: T.MOSFET, flags: 0x100, posts: [[200,100],[260,40],[260,100]], params: [1.5, 0.02] }, // gate, source(rail), drain(out)
  { etype: T.RES, flags: 0, posts: [[260,100],[260,180]], params: [1e6] },  // weak pull-down load
  { etype: T.WIRE, flags: 0, posts: [[260,180],[300,180]] },
  { etype: T.GROUND, flags: 0, posts: [[300,180]] },
  { etype: T.WIRE, flags: 0, posts: [[200,100],[140,100]] },
  { etype: T.GROUND, flags: 0, posts: [[140,100]] }  // gate grounded -> PMOS on
]);
console.log('analyze:', w.sim_analyze(sim));
w.sim_set_dt_max(sim, 5e-6);
for (let k = 0; k < 8; k++) {
  const done = w.sim_run(sim, 1, 1000);
  const nv = new Float64Array(w.memory.buffer, w.sim_nodes_ptr(sim), w.sim_node_count(sim));
  console.log(`step ${k}: done=${done} out=${Array.from(nv).map(v=>v.toFixed(3)).join(',')}`);
  if (w.sim_error(sim)) { console.log('ERR:', new TextDecoder().decode(new Uint8Array(w.memory.buffer, w.sim_error(sim))).split('\0')[0]); break; }
}
