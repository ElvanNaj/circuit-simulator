import { readFileSync } from 'fs';
const wasmBytes = readFileSync(new URL('../public/wasm/circuit_engine.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(wasmBytes, { env: { perf_now: () => performance.now() } });
const w = instance.exports;
const S = 14, F = 8;
const T = { GROUND:2, RES:3, CAP:4, VOLT:6, WIRE:1 };
function bench(nSections) {
  const elms = [{ etype: T.VOLT, flags: 0, posts: [[0,0],[100,0]], params: [0,1,0,0,0] }];
  let x = 100;
  for (let i = 0; i < nSections; i++) {
    elms.push({ etype: T.RES, flags: 0, posts: [[x,0],[x+100,0]], params: [1000] });
    elms.push({ etype: T.CAP, flags: 0, posts: [[x+100,0],[x+100,100]], params: [1e-9, 0.001] });
    x += 100;
  }
  elms.push({ etype: T.WIRE, flags: 0, posts: [[0,0],[0,100]] });
  elms.push({ etype: T.GROUND, flags: 0, posts: [[0,100]] });
  const sim = w.sim_new();
  const i32 = new Int32Array(elms.length*S), f64 = new Float64Array(elms.length*F);
  elms.forEach((e,k) => {
    i32[k*S]=e.etype; i32[k*S+1]=e.flags;
    for (let j=0;j<6;j++){ i32[k*S+2+j*2]=e.posts[j]?.[0]||0; i32[k*S+3+j*2]=e.posts[j]?.[1]||0; }
    for (let j=0;j<8;j++) f64[k*F+j]=(e.params||[])[j]||0;
  });
  const p1 = w.sim_alloc(sim, i32.byteLength); new Uint8Array(w.memory.buffer,p1,i32.byteLength).set(new Uint8Array(i32.buffer));
  const p2 = w.sim_alloc(sim, f64.byteLength); new Uint8Array(w.memory.buffer,p2,f64.byteLength).set(new Uint8Array(f64.buffer));
  w.sim_load(sim, p1, p2, elms.length);
  w.sim_analyze(sim);
  w.sim_set_dt_max(sim, 5e-6);
  const t0 = performance.now();
  const done = w.sim_run(sim, 5000, 600000);
  const ms = performance.now() - t0;
  console.log(`sections=${nSections} nodes≈${nSections+1}: ${done} steps in ${ms.toFixed(0)}ms → ${(ms/done*1000).toFixed(1)}µs/step`);
}
bench(10); bench(50); bench(100); bench(200); bench(300);
