import { readFileSync } from 'fs';
const wasmBytes = readFileSync(new URL('../public/wasm/circuit_engine.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(wasmBytes, { env: { perf_now: () => performance.now() } });
const w = instance.exports;
const S = 14, F = 8;
const T = { GROUND:2, CAP:4, IND:5, WIRE:1 };
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
  w.sim_analyze(sim);
  w.sim_set_dt_max(sim, 1e-7); // small dt for clean 5kHz waveform
  return sim;
}
// Ideal LC tank: C charged to 5V, no resistance -> should ring at 5.03 kHz FOREVER
const sim = load([
  { etype: T.CAP, flags: 0, posts: [[100,0],[100,100]], params: [1e-6, 5.0] },   // initial 5V
  { etype: T.IND, flags: 0, posts: [[100,0],[100,100]], params: [0.001, 0] },    // parallel L
  { etype: T.WIRE, flags: 0, posts: [[100,100],[200,100]] },
  { etype: T.GROUND, flags: 0, posts: [[200,100]] }
]);
// measure cap voltage every 10µs
const f0 = 1/(2*Math.PI*Math.sqrt(1e-3*1e-6));
console.log('expected f0 =', f0.toFixed(0), 'Hz, period =', (1e6/f0).toFixed(0), 'µs');
const vlog = [];
for (let k = 0; k < 25; k++) {
  const outs = new Float64Array(w.memory.buffer, w.sim_elem_out_ptr(sim), 8);
  vlog.push(+outs[0].toFixed(3));
  w.sim_run(sim, 20, 100); // 2µs per step × 20 = 2... wait dt=1e-7 → 20 steps = 2µs
}
console.log('cap V (every 2µs):', vlog.join(' '));
// after ~100µs (half period), voltage should be ≈ -5V (energy swapped to inductor)
