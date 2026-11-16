// TypeScript wrapper for the Rust circuit engine WASM module (manual ABI).

export const I32_STRIDE = 14; // [etype, flags, x0,y0, x1,y1, x2,y2, x3,y3, x4,y4, x5,y5]
export const F64_STRIDE = 8; // [p0..p7]

export interface RawElem {
  etype: number;
  flags: number;
  posts: [number, number][];
  params: number[];
}

export class CircuitEngine {
  private exports: Record<string, any> | null = null;
  private sim = 0;
  private i32Buf = new Int32Array(0);
  private f64Buf = new Float64Array(0);

  async load(url = '/wasm/circuit_engine.wasm'): Promise<void> {
    const bytes = await fetch(url).then((r) => r.arrayBuffer());
    const { instance } = await WebAssembly.instantiate(bytes, {
      env: { perf_now: () => performance.now() },
    });
    this.exports = instance.exports as Record<string, any>;
    this.sim = this.exports.sim_new();
  }

  get ready(): boolean {
    return this.exports !== null && this.sim !== 0;
  }

  /** Upload element list and re-analyze. Returns error message or null. */
  loadElements(elements: RawElem[]): string | null {
    const w = this.exports!;
    const n = elements.length;
    if (this.i32Buf.length < n * I32_STRIDE) this.i32Buf = new Int32Array(n * I32_STRIDE);
    if (this.f64Buf.length < n * F64_STRIDE) this.f64Buf = new Float64Array(n * F64_STRIDE);
    for (let k = 0; k < n; k++) {
      const e = elements[k];
      const b = k * I32_STRIDE;
      this.i32Buf[b] = e.etype;
      this.i32Buf[b + 1] = e.flags;
      for (let j = 0; j < 6; j++) {
        this.i32Buf[b + 2 + j * 2] = e.posts[j]?.[0] ?? 0;
        this.i32Buf[b + 3 + j * 2] = e.posts[j]?.[1] ?? 0;
      }
      for (let j = 0; j < 8; j++) this.f64Buf[k * F64_STRIDE + j] = e.params[j] ?? 0;
    }
    this.resetScratch();
    const p1 = w.sim_alloc(this.sim, this.i32Buf.byteLength);
    new Uint8Array(w.memory.buffer, p1, this.i32Buf.byteLength).set(
      new Uint8Array(this.i32Buf.buffer, 0, this.i32Buf.byteLength)
    );
    const p2 = w.sim_alloc(this.sim, this.f64Buf.byteLength);
    new Uint8Array(w.memory.buffer, p2, this.f64Buf.byteLength).set(
      new Uint8Array(this.f64Buf.buffer, 0, this.f64Buf.byteLength)
    );
    w.sim_load(this.sim, p1, p2, n);
    const r = w.sim_analyze(this.sim);
    if (r !== 0) return this.error();
    return null;
  }

  /** Recycle the WASM scratch arena before a new transfer. */
  private resetScratch(): void {
    const w = this.exports!;
    if (typeof w.sim_scratch_reset === 'function') w.sim_scratch_reset(this.sim);
  }

  private error(): string {
    const w = this.exports!;
    const ptr = w.sim_error(this.sim);
    if (!ptr) return 'unknown error';
    const bytes = new Uint8Array(w.memory.buffer, ptr);
    let len = 0;
    while (len < bytes.length && bytes[len] !== 0) len++;
    return new TextDecoder().decode(bytes.subarray(0, len));
  }

  clearError(): void {
    this.exports!.sim_clear_error(this.sim);
  }

  run(steps: number, budgetMs: number): number {
    return this.exports!.sim_run(this.sim, steps, budgetMs);
  }

  reset(): void {
    this.exports!.sim_reset(this.sim);
  }

  setDtMax(dt: number): void {
    this.exports!.sim_set_dt_max(this.sim, dt);
  }

  get time(): number {
    return this.exports!.sim_time(this.sim);
  }

  /** Copy of node voltages. */
  nodeVoltages(): Float64Array {
    const w = this.exports!;
    const n = w.sim_node_count(this.sim);
    if (n <= 0) return new Float64Array(0);
    const ptr = w.sim_nodes_ptr(this.sim);
    return new Float64Array(w.memory.buffer, ptr, n).slice();
  }

  /** Per-element outputs: stride 8 [vd, power, i0, i1, i2, i3, extra, spare]. */
  elemOutputs(): Float64Array {
    const w = this.exports!;
    const n = w.sim_elem_count(this.sim);
    if (n <= 0) return new Float64Array(0);
    const ptr = w.sim_elem_out_ptr(this.sim);
    return new Float64Array(w.memory.buffer, ptr, n * 8).slice();
  }

  /** Per-element flags: stride 2 [stateFlags, configFlags]. */
  elemFlags(): Uint32Array {
    const w = this.exports!;
    const n = w.sim_elem_count(this.sim);
    if (n <= 0) return new Uint32Array(0);
    const ptr = w.sim_elem_flags_ptr(this.sim);
    return new Uint32Array(w.memory.buffer, ptr, n * 2).slice();
  }

  setParam(idx: number, paramIdx: number, value: number): void {
    this.exports!.sim_set_param(this.sim, idx, paramIdx, value);
  }

  setFlags(idx: number, flags: number): void {
    this.exports!.sim_set_flags(this.sim, idx, flags);
  }

  setScope(elementIndices: number[]): void {
    const w = this.exports!;
    const arr = new Int32Array(elementIndices);
    this.resetScratch();
    const ptr = w.sim_alloc(this.sim, arr.byteLength);
    new Uint8Array(w.memory.buffer, ptr, arr.byteLength).set(new Uint8Array(arr.buffer));
    w.sim_set_scope(this.sim, ptr, elementIndices.length);
  }

  /** Copy newest scope samples for a channel; stride 3 [t, v, i]. */
  readScope(ch: number, maxSamples: number): Float64Array {
    const w = this.exports!;
    const avail = w.sim_scope_count(this.sim, ch);
    const want = Math.min(avail, maxSamples);
    if (want <= 0) return new Float64Array(0);
    const out = new Float64Array(want * 3);
    this.resetScratch();
    const ptr = w.sim_alloc(this.sim, out.byteLength);
    const n = w.sim_scope_read(this.sim, ch, ptr, want);
    out.set(new Float64Array(w.memory.buffer, ptr, n * 3));
    return out;
  }

  /** Per-element node indices (stride 6). */
  elemNodes(): Uint32Array {
    const w = this.exports!;
    const n = w.sim_elem_count(this.sim);
    if (n <= 0) return new Uint32Array(0);
    this.resetScratch();
    const ptr = w.sim_elem_nodes_ptr(this.sim);
    return new Uint32Array(w.memory.buffer, ptr, n * 6).slice();
  }

  needsAnalyze(): boolean {
    return this.exports!.sim_needs_analyze(this.sim) !== 0;
  }

  /** Re-analyze without resetting element state (for value/flag edits). */
  analyze(): string | null {
    const r = this.exports!.sim_analyze(this.sim);
    if (r !== 0) return this.error();
    return null;
  }

  getError(): string | null {
    const w = this.exports!;
    const ptr = w.sim_error(this.sim);
    if (!ptr) return null;
    const bytes = new Uint8Array(w.memory.buffer, ptr);
    let len = 0;
    while (len < bytes.length && bytes[len] !== 0) len++;
    return len > 0 ? new TextDecoder().decode(bytes.subarray(0, len)) : null;
  }
}
