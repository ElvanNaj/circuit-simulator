// Headless verification for the new Probe elements + fixes.
import { readFileSync } from 'node:fs';

const wasmBytes = readFileSync(new URL('../public/wasm/circuit_engine.wasm', import.meta.url));
const { instance } = await WebAssembly.instantiate(wasmBytes, {
  env: { perf_now: () => performance.now() },
});
const w = instance.exports;
const sim = w.sim_new();

const I32_STRIDE = 14, F64_STRIDE = 8;

function load(elms) {
  const n = elms.length;
  const i32 = new Int32Array(n * I32_STRIDE);
  const f64 = new Float64Array(n * F64_STRIDE);
  elms.forEach((e, k) => {
    const b = k * I32_STRIDE;
    i32[b] = e.etype; i32[b + 1] = e.flags ?? 0;
    (e.posts ?? []).forEach((p, j) => {
      i32[b + 2 + j * 2] = p[0]; i32[b + 3 + j * 2] = p[1];
    });
    (e.params ?? []).forEach((v, j) => { f64[k * F64_STRIDE + j] = v; });
  });
  const p1 = w.sim_alloc(sim, i32.byteLength);
  new Uint8Array(w.memory.buffer, p1, i32.byteLength).set(new Uint8Array(i32.buffer));
  const p2 = w.sim_alloc(sim, f64.byteLength);
  new Uint8Array(w.memory.buffer, p2, f64.byteLength).set(new Uint8Array(f64.buffer));
  const r = w.sim_load(sim, p1, p2, n);
  if (r !== 0) return 'load failed';
  const ra = w.sim_analyze(sim);
  return ra === 0 ? null : errText();
}

function errText() {
  const ptr = w.sim_error(sim);
  if (!ptr) return 'unknown error';
  const bytes = new Uint8Array(w.memory.buffer, ptr);
  let len = 0; while (len < bytes.length && bytes[len] !== 0) len++;
  return new TextDecoder().decode(bytes.subarray(0, len));
}

const outs = () => {
  const n = w.sim_elem_count(sim);
  if (n <= 0) return new Float64Array(0);
  const ptr = w.sim_elem_out_ptr(sim);
  return new Float64Array(w.memory.buffer, ptr, n * 8).slice();
};

const nodes = () => {
  const n = w.sim_node_count(sim);
  if (n <= 0) return new Float64Array(0);
  return new Float64Array(w.memory.buffer, w.sim_nodes_ptr(sim), n).slice();
};

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name} ${detail}`); }
  else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}

const T = { WIRE: 1, GROUND: 2, RESISTOR: 3, VOLTAGE: 6, RAIL: 8, VOLTMETER: 36, OHMMETER: 37 };

// ---- Test 1: empty circuit loads without error (Delete-all fix) ----
console.log('Test 1: empty circuit');
{
  const err = load([]);
  check('analyze([]) returns no error', err === null, err ?? '');
  w.sim_run(sim, 10, 5); // must not crash
  check('run on empty is a no-op', true);
}

// ---- Test 2: Voltmeter reads ~5V across series circuit, undisturbed ----
console.log('Test 2: voltmeter');
{
  // 5V source, 1k resistor, voltmeter across the resistor, ground
  const err = load([
    { etype: T.VOLTAGE, flags: 0, posts: [[0, 0], [0, 100]], params: [0, 5, 0, 0, 0.5] },
    { etype: T.GROUND, flags: 0, posts: [[0, 0]], params: [] },
    { etype: T.RESISTOR, flags: 0, posts: [[0, 100], [200, 100]], params: [1000] },
    { etype: T.WIRE, flags: 0, posts: [[200, 100], [200, 0]], params: [] },
    { etype: T.WIRE, flags: 0, posts: [[200, 0], [0, 0]], params: [] },
    { etype: T.VOLTMETER, flags: 0, posts: [[0, 100], [200, 100]], params: [] },
  ]);
  check('analyze ok', err === null, err ?? '');
  w.sim_run(sim, 100, 20);
  const o = outs();
  const vd = o[5 * 8 + 0];
  check('voltmeter reads ~5.00 V', Math.abs(vd - 5) < 0.01, `got ${vd.toFixed(4)} V`);
  const nv = nodes();
  // source current should be ~5mA (voltmeter draws only 5nA)
  const iSrc = o[0 * 8 + 3];
  check('circuit undisturbed (I ≈ 5mA)', Math.abs(iSrc - 0.005) < 1e-4, `got ${(iSrc * 1e3).toFixed(4)} mA`);
}

// ---- Test 3: Ohmmeter measures 1kΩ across a resistor network ----
console.log('Test 3: ohmmeter');
{
  // passive network: just a 1k resistor; ohmmeter across it (open posts shunt to ground via 1G)
  const err = load([
    { etype: T.RESISTOR, flags: 0, posts: [[0, 100], [200, 100]], params: [1000] },
    { etype: T.OHMMETER, flags: 0, posts: [[0, 100], [200, 100]], params: [] },
  ]);
  check('analyze ok', err === null, err ?? '');
  w.sim_run(sim, 100, 20);
  const o = outs();
  const vd = o[1 * 8 + 0];
  const cur = o[1 * 8 + 3];
  const r = vd / cur;
  check('ohmmeter reads ~1.00 kΩ', Math.abs(r - 1000) / 1000 < 0.001, `got ${r.toFixed(1)} Ω (I=${cur} A)`);
}

// ---- Test 4: Ohmmeter on series pair 1k + 2.2k = 3.2k ----
console.log('Test 4: ohmmeter series network');
{
  const err = load([
    { etype: T.RESISTOR, flags: 0, posts: [[0, 100], [200, 100]], params: [1000] },
    { etype: T.RESISTOR, flags: 0, posts: [[200, 100], [400, 100]], params: [2200] },
    { etype: T.OHMMETER, flags: 0, posts: [[0, 100], [400, 100]], params: [] },
  ]);
  check('analyze ok', err === null, err ?? '');
  w.sim_run(sim, 100, 20);
  const o = outs();
  const r = o[2 * 8 + 0] / o[2 * 8 + 3];
  check('R ≈ 3.20 kΩ', Math.abs(r - 3200) / 3200 < 0.001, `got ${r.toFixed(1)} Ω`);
}

// ---- Test 5: ohmmeter on open posts → huge R, no singular matrix ----
console.log('Test 5: ohmmeter open posts');
{
  const err = load([
    { etype: T.OHMMETER, flags: 0, posts: [[0, 100], [200, 100]], params: [] },
  ]);
  check('analyze ok', err === null, err ?? '');
  w.sim_run(sim, 50, 10);
  const o = outs();
  const vd = o[0 * 8 + 0];
  check('open leads → ~1GΩ (no crash)', vd > 1e6, `V=${vd.toExponential(2)}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
