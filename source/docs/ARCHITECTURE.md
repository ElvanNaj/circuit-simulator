# Arsitektur Sistem

## Gambaran Umum

Aplikasi terdiri dari empat lapisan yang berkomunikasi melalui memori linear WASM. Semua
perhitungan fisika berat berada di sisi Rust (terkompilasi ke WASM), sementara React hanya
bertugas sebagai renderer canvas + pengelola state UI. Tidak ada framework WASM (wasm-bindgen
dsb.) — ABI dirancang manual agar biner tetap kecil (86,7 KB) dan bebas dependensi.

```
┌────────────────────────────────────────────────────────┐
│  React UI (CircuitSimulator.tsx)                       │
│  toolbar · palette · canvas 2D · scope · edit dialog   │
├────────────────────────────────────────────────────────┤
│  Wrapper (engine.ts, class CircuitEngine)              │
│  packing buffer · memanggil ekspor sim_* · baca output │
├────────────────────────────────────────────────────────┤
│  Memori linear WASM (i32 elemen / f64 param & output)  │
├────────────────────────────────────────────────────────┤
│  Engine Rust (circuit_engine.wasm, ~2.500 baris)       │
│  MNA · LU · Newton-Raphson · scope ring buffer         │
└────────────────────────────────────────────────────────┘
```

## Alur Data per Frame

Loop utama berjalan di `requestAnimationFrame` (jalan terus, juga saat pause, agar render
tetap hidup). Satu frame:

1. **Hitung `dtReal`** sejak frame sebelumnya → `steps = max(1, round(55 · speed · dtReal/16.7))`.
   Budget waktu engine: **12 ms/frame** (`sim_run(steps, 12)`).
2. **`eng.run()`** → engine menjalankan timestep MNA sampai langkah habis atau budget habis.
   Fase `dotPhase` animasi arus ditekan terpisah (`dtReal/16.7 · animSpeed`) sehingga kecepatan
   dot tidak tergantung laju langkah simulasi.
3. **Baca hasil**: `elemOutputs()` (stride 8), `elemFlags()` (stride 2), `nodeVoltages()`.
   Semua disalin sekali per frame ke `frameRef`.
4. **Hitung arus kabel** di JS: `computeWireCurrents()` memodelkan jaringan kabel sebagai graf.
   Arus komponen (`-out[2+k]` per kaki) disuntikkan/diserap di tiap simpul, lalu spanning tree
   (BFS) membagi arus ke setiap kabel; arus kabel selalu didefinisikan sepanjang `post0 → post1`
   sehingga arahnya tidak bergantung urutan penggambaran. Arus yang dibuang ke ground
   direkonstruksi dari KCL per pulau kabel (engine tidak melaporkan arus ground), dan arus
   di bawah **1 µA** (leakage dioda, sisa numerik) tidak dianimasikan.
5. **Render 3-pass** di canvas:
   - Pass 1 — grid + semua elemen (kabel diwarnai tegangan via union-find JS `computeNodeMap`).
   - Pass 2 — semua titik arus (dots) digambar di atas segala elemen, di bawah post. Animasi bisa
     dimatikan lewat tombol **Activity** tanpa menghentikan simulasi atau mengubah warna/readout.
   - Pass 3 — semua label teks (`elementLabels()`) digambar terakhir sehingga tidak mungkin
     tertutup komponen mana pun. Label nilai menyimpan offset per elemen (`labelOff`) yang bisa
     dipindah dengan drag, sehingga pengguna dapat membersihkan teks yang menutupi kabel atau
     simbol lain; label struktural (pin, tanda `+`/`−`, huruf meter) tetap menempel. Readout
     live meter/probe memakai `kind: 'readout'` sehingga dirender lebih cerah dan dengan pill
     gelap, berbeda dari nilai komponen biasa.
6. **Tema**: `next-themes` memasang class `.dark` / `.light` / `.pink` pada `<html>` dan
   menyimpan pilihan di `localStorage` (`theme`). Chrome memakai token CSS semantik
   (`--background`, `--card`, `--muted`, `--foreground`, `--brand`, …), sedangkan kanvas
   memakai `CANVAS_PALETTES` di `src/lib/circuit/theme.ts`. `draw()` memanggil
   `setCanvasTheme()` sebelum menggambar sehingga `drawElement()`/`elementLabels()` membaca
   palet aktif untuk latar, grid, garis komponen, label, readout, kabel, glow, dan dots.
6. **Scope**: jika ada channel, `eng.readScope(ch, 4096)` → gambar trace V (kuning) + I (hijau).

## Pembagian Tanggung Jawab

| Modul | Tanggung jawab | Lokasi |
|---|---|---|
| `CircuitSimulator.tsx` (1.188 baris) | State rangkaian, mouse/keyboard, loop rAF, render 3-pass, autosave | `src/components/sim/` |
| `engine.ts` (178 baris) | Wrapper WASM: load module, packing/unpacking memori, error string | `src/lib/circuit/` |
| `elements.ts` (497 baris) | Konstanta tipe `T.*`, metadata + parameter edit (ELEMENT_META), kategori palette | `src/lib/circuit/` |
| `draw.ts` (930 baris) | Simbol vektor 2D per tipe, label, dots arus, layout post otomatis | `src/lib/circuit/` |
| `presets.ts` (200 baris) | 9 builder preset rangkaian | `src/lib/circuit/` |
| `file-format.ts` (~250 baris) | Serializer/parser `.circuit.json`, validasi elemen dari file | `src/lib/circuit/` |
| `lib.rs` (317 baris) | 32 fungsi ekspor ABI + alokator scratch 16-byte-aligned | `engine/src/` |
| `sim.rs` (1.762 baris) | Solver: stamping, LU, Newton-Raphson, timestep, scope, model nonlinear | `engine/src/` |
| `elements.rs` (300 baris) | Konstanta tipe Rust (mirror `T.*`), konstanta fisika (VT, vcrit) | `engine/src/` |
| `lu.rs` (121 baris) | Faktorisasi LU metode Crout + partial pivoting | `engine/src/` |

## Keputusan Arsitektur Penting

- **Cached factorization**: untuk rangkaian murni linier, matriks tidak di-faktorisasi ulang
  selama komposisinya stabil (`skip_solve`); companion model C/L hanya berubah saat `dt`
  berubah — hemat banyak CPU pada rangkaian pasif.
- **Sinkronisasi struktur**: perubahan struktural (tambah/hapus elemen, ubah jumlah input gate)
  memicu `loadElements` → `analyze` penuh; perubahan nilai hanya memanggil `setParam` +
  `analyze` ringan (state tidak di-reset).
- **Node merging di-replika di JS** (union-find `computeNodeMap`) semata untuk pewarnaan kabel,
  agar tidak perlu transfer peta simpul dari engine.
- **Autosave** `localStorage` pada setiap `commit()` (tambah/hapus/pindah), preset load, undo,
  dan edit nilai — key `circuit-sim-elements`.
