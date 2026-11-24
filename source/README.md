# CircuitSim Rust/WASM

Simulator rangkaian elektronik interaktif di browser — tiruan (reverse engineering) dari
[Falstad Circuit Simulator](https://github.com/pfalstad/circuitjs1) yang ditulis ulang dengan
**engine Rust → WebAssembly** dan **frontend Next.js + React**, untuk performa simulasi yang
jauh lebih efisien tanpa kehilangan gaya interaksi aslinya.

![stack](https://img.shields.io/badge/engine-Rust%20%E2%86%92%20WASM-dea584) ![stack](https://img.shields.io/badge/frontend-Next.js%2016%20%2B%20React%2019-151513) ![test](https://img.shields.io/badge/tests-15%2F15%20pass-529067)

## Fitur Utama

| Area | Kemampuan |
|---|---|
| Engine | Modified Nodal Analysis (MNA), LU factorization (Crout + partial pivoting), Newton–Raphson + voltage limiting, companion model trapezoidal untuk C/L |
| Komponen | 37 tipe engine (41 entri palette): pasif, sumber, probe (Ammeter/Voltmeter/Ohmmeter), probe multimeter merah/hitam, aktif, gerbang logika, ADC/DAC, transformator, spark gap |
| Interaksi | Klik-select, drag-to-select (rubber band), drag pindah, pan, zoom, edit nilai via dialog, undo/redo, delete, rotate, duplicate |
| Sidebar | Panel komponen kiri bisa di-collapse (`[` atau tombol panah) menjadi rail 40 px; kanvas melebar otomatis, preferensi tersimpan di `localStorage` |
| Quick add | Tekan **P** → cari komponen (nama/alias: `res`, `cap`, `gnd`, `npn`), **Enter**, klik kanvas untuk menaruh; daftar "Recent" tersimpan di `localStorage` |
| Shortcut | **?** membuka cheat-sheet; `F` fit view, `R` rotate, `Ctrl+D` duplicate, `Enter` edit, `Ctrl+Shift+Z` redo |
| Visual | Animasi titik arus (kecepatan bisa diatur lewat slider *Flow*), pewarnaan kabel berdasarkan tegangan, label nilai live |
| Osiloskop | Hingga 4 channel, trace tegangan + arus, readout V/I real-time |
| Osiloskop eksternal | Integrasi **Z-DSO 2104** — stream 4 channel ke jendela osiloskop terpisah via `BroadcastChannel`, kontrol run/stop/auto-set/timebase dari toolbar |
| Multimeter eksternal | Integrasi **Z-AVO 800** — probe merah/hitam sebagai komponen, stream pengukuran ±10 Hz ke jendela multimeter CD800a (`BroadcastChannel("avo-bridge")`), 11 mode (DCV/ACV/DCA/ACA/Ω/CONT/DIODE/CAP/Hz/DUTY/OFF), continuity beep |
| Preset | 9 rangkaian contoh: pembagi tegangan, RC charging, LC tank, rectifier, penguat CE, CMOS inverter, op-amp, astable multivibrator, D flip-flop |
| Persistensi | Autosave otomatis ke `localStorage` (key `circuit-sim-elements`) + simpan/buka file `.circuit.json` (tombol **Save file** / **Open file**, drag-and-drop, `Ctrl+S` / `Ctrl+O`) |

## Struktur Proyek

```
engine/                    # Crate Rust (zero-dependency) → circuit_engine.wasm
  src/lib.rs               #   ABI WASM (32 fungsi sim_*)
  src/sim.rs               #   Solver MNA, Newton-Raphson, stamping
  src/elements.rs          #   Definisi 37 tipe elemen
  src/lu.rs                #   LU factorization Crout + pivoting
public/wasm/               #   circuit_engine.wasm (artifact build)
src/lib/circuit/
  engine.ts                #   Wrapper WASM (class CircuitEngine)
  elements.ts              #   Konstanta tipe T.*, ELEMENT_META, CATEGORIES
  draw.ts                  #   Renderer canvas 2D (simbol vektor, dots, label)
  presets.ts               #   9 preset rangkaian
  file-format.ts           #   Simpan/buka .circuit.json + validasi file
  z-dso/bridge.ts          #   Jembatan BroadcastChannel ke osiloskop Z-DSO 2104
  z-avo/bridge.ts          #   Jembatan BroadcastChannel ke multimeter Z-AVO 800
src/components/sim/
  CircuitSimulator.tsx     #   Komponen utama (toolbar, kanvas, loop rAF, stream Z-DSO/Z-AVO)
  ComponentPalette.tsx     #   Quick add (P): pencarian komponen + recent
  ShortcutsDialog.tsx      #   Cheat-sheet keyboard (?)
  EditDialog.tsx           #   Dialog edit parameter
  ScopePanel.tsx           #   Panel osiloskop
public/z-dso/              #   Halaman instrumen Z-DSO 2104 (tanpa build)
public/z-avo/              #   Halaman instrumen Z-AVO 800 (tanpa build)
scripts/
  engine-test.mjs          #   10 test fisika engine (headless WASM)
  test-probes.mjs          #   5 test probe (voltmeter/ohmmeter/empty)
docs/                      #   Dokumentasi teknis lengkap (markdown)
```

## Menjalankan

```bash
# Frontend (dev server di http://localhost:3000)
npm run dev

# Build engine WASM (butuh Rust + target wasm32-unknown-unknown)
cd engine && cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/circuit_engine.wasm ../public/wasm/

# Test engine (headless, tanpa browser)
node scripts/engine-test.mjs    # 10 test fisika
node scripts/test-probes.mjs    # 5 test probe
```

## Dokumentasi Lengkap

| Dokumen | Isi |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Arsitektur sistem & alur data per frame |
| [docs/ENGINE.md](docs/ENGINE.md) | Fisika engine: MNA, LU, Newton–Raphson, companion model |
| [docs/WASM-ABI.md](docs/WASM-ABI.md) | Spesifikasi ABI memory & 32 fungsi ekspor |
| [docs/COMPONENTS.md](docs/COMPONENTS.md) | Referensi 39 komponen + parameter |
| [docs/UI-GUIDE.md](docs/UI-GUIDE.md) | Panduan antarmuka & interaksi |
| [docs/BUILD-TEST.md](docs/BUILD-TEST.md) | Build, pengujian, & performa |

## Kredit

Di-reverse engineer dari [circuitjs1](https://github.com/pfalstad/circuitjs1) karya Paul Falstad
(dibangun ulang dari nol di Rust — bukan fork kode, melainkan tiruan algoritma & perilaku).
