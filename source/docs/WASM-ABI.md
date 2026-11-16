# Spesifikasi ABI WASM

ABI dirancang **manual tanpa wasm-bindgen** supaya biner kecil dan tanpa dependensi. Satu-satunya
import dari JS adalah `env.perf_now` (dipetakan ke `performance.now()`, satuan ms).

## Layout Memori

Semua transfer JS ↔ WASM lewat alokator scratch `sim_alloc(sim, size)` (align 16 byte).

| Struktur | Tipe | Stride | Format |
|---|---|---|---|
| Record elemen | `i32` | 14 | `[etype, flags, x0, y0, x1, y1, x2, y2, x3, y3, x4, y4, x5, y5]` |
| Parameter elemen | `f64` | 8 | `[p0..p7]` per elemen |
| Output elemen | `f64` | 8 | `[vd, power, i0, i1, i2, i3, extra, spare]` |
| Flags output | `u32` | 2 | `[stateFlags, configFlags]` |
| Node per elemen | `u32` | 6 | indeks simpul, padding `0xFFFFFFFF` |
| Sampel scope | `f64` | 3 | `[t, v, i]` |

## Fungsi Ekspor (32)

### Siklus hidup
| Fungsi | Tanda tangan | Tujuan |
|---|---|---|
| `sim_new` | `() -> *mut Sim` | Alokasikan Sim (reserve scratch 1 MB) |
| `sim_free` | `(*mut Sim)` | Drop Sim |
| `sim_alloc` | `(*mut Sim, usize) -> *mut u8` | Alokasi scratch align-16 |

### Muat & analisis
| Fungsi | Tujuan |
|---|---|
| `sim_load(sim, i32_ptr, f64_ptr, count) -> i32` | Parsing record elemen + reset state, `t = 0` |
| `sim_analyze(sim) -> i32` | Merge simpul, stamp, LU; 0 ok / −1 gagal |
| `sim_reset(sim)` | Reset seluruh state (nol V/I, t=0) + refresh output |
| `sim_needs_analyze(sim) -> i32` | 1 bila butuh analisis ulang struktural (mis. spark gap) |
| `sim_set_param(sim, idx, pidx, val)` | Tulis `e.p[pidx]` |
| `sim_set_flags(sim, idx, flags)` | Timpa flags elemen (toggle switch, dsb.) |

### Eksekusi
| Fungsi | Tujuan |
|---|---|
| `sim_run(sim, steps, budget_ms) -> i32` | Jalankan timestep; kembalikan jumlah langkah tereksekusi |
| `sim_time(sim) -> f64` | Waktu simulasi `t` |
| `sim_set_dt_max(sim, dt)` | Set `dt_max` (re-stamp + re-factor bila linier) |
| `sim_set_adjust(sim, on)` | Toggle timestep adaptif |

### Baca hasil
| Fungsi | Tujuan |
|---|---|
| `sim_node_count(sim) -> i32` / `sim_nodes_ptr(sim)` | Jumlah & pointer tegangan simpul |
| `sim_elem_count(sim) -> i32` / `sim_elem_out_ptr(sim)` | Jumlah & pointer output elemen (stride 8) |
| `sim_elem_flags_ptr(sim) -> *const u32` | Pointer flags output (stride 2) |
| `sim_elem_nodes_ptr(sim) -> *const u32` | Pointer node indeks per elemen (stride 6) |

### Scope
| Fungsi | Tujuan |
|---|---|
| `sim_set_scope(sim, idx_ptr, n)` | Set channel scope (indeks elemen) + alokasi ring |
| `sim_scope_count(sim, ch) -> i32` | Jumlah sampel tersedia |
| `sim_scope_read(sim, ch, out, max) -> i32` | Salin sampel terbaru `(t, v, i)` |

### Error & debug
| Fungsi | Tujuan |
|---|---|
| `sim_error(sim) -> *const u8` | String error statis (NUL-terminated) atau null |
| `sim_clear_error(sim)` | Bersihkan `stop_msg` |
| `sim_dbg_subiter / _dt / _good / _nonlinear / _size` | Getter diagnostik |
| `sim_dbg_enable(sim, on)` + `sim_dbg_trace_ptr/_len` | Trace buffer subiterasi Newton |
| `now_ms_extern() -> f64` | Wrapper import `env.perf_now` |

## Wrapper JS (`engine.ts`)

Class `CircuitEngine` membungkus semua panggilan di atas:

```ts
await eng.load('/wasm/circuit_engine.wasm')  // instantiate + sim_new
eng.loadElements(elements)                    // pack i32/f64 → sim_load → sim_analyze
eng.run(steps, budgetMs)                      // sim_run, hasil = langkah tereksekusi
eng.setDtMax(dt); eng.reset(); eng.analyze()
eng.setParam(idx, pidx, v); eng.setFlags(idx, flags)
eng.nodeVoltages(); eng.elemOutputs(); eng.elemFlags(); eng.elemNodes()
eng.setScope([...]); eng.readScope(ch, 4096)
eng.needsAnalyze(); eng.getError(); eng.clearError()
```

`loadElements` mengembalikan `string` error atau `null`. Wrapper juga menormalkan catatan:
rangkaian kosong adalah keadaan valid (hasil delete-all), sehingga `analyze([])` tidak error.
