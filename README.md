# CircuitSim

Simulator rangkaian elektronik interaktif di browser — gaya [Falstad Circuit Simulator](https://github.com/pfalstad/circuitjs1),
dengan **engine Rust → WebAssembly** dan **frontend Next.js + React**.

![engine](https://img.shields.io/badge/engine-Rust%20%E2%86%92%20WASM-dea584)
![frontend](https://img.shields.io/badge/frontend-Next.js%2016%20%2B%20React%2019-151513)

![CircuitSim](source/public/icon.svg)

## Fitur

- **37 tipe komponen** (41 entri palette): pasif, sumber, probe, aktif, gerbang logika, ADC/DAC, transformator, spark gap.
- **Engine MNA** — LU factorization (Crout + partial pivoting), Newton–Raphson dengan voltage limiting, companion model trapezoidal untuk C/L.
- **Tema UI** — dark (default), light, dan pink, termasuk warna kanvas.
- **Osiloskop** internal 4 channel + integrasi instrumen eksternal:
  - **Z-DSO 2104** — osiloskop 4 channel di jendela terpisah (`BroadcastChannel`).
  - **Z-AVO 800** — multimeter gaya Sanwa CD800a, probe merah/hitam sebagai komponen (11 mode).
- **Interaksi**: select, rubber-band, drag, pan, zoom, edit nilai, undo/redo, rotate, duplicate.
- **Quick add (P)**, cheat-sheet (**?**), collapse sidebar (**[**), 9 preset rangkaian.
- **Penyimpanan**: autosave `localStorage` + export/import `.circuit.json` (Ctrl+S / Ctrl+O, drag-and-drop).

## Menjalankan

Butuh **Node.js 20 LTS** atau lebih baru.

### Cara cepat (launcher)

| Sistem | Perintah |
|---|---|
| Linux / macOS | `./start.sh` |
| macOS | dobel-klik `Start Circuit Simulator.command` |
| Windows | dobel-klik `Start Circuit Simulator.bat` |

Launcher akan memakai build yang ada; jika belum ada, ia menjalankan `npm install` + `npm run build`
di `source/` sekali, lalu membuka `http://localhost:3000`.

### Mode pengembangan

```bash
cd source
npm install
npm run dev          # http://localhost:3000
```

### Build mandiri

```bash
cd source
npm run build        # menghasilkan .next/standalone/
node .next/standalone/server.js
```

## Struktur Repo

```
start.sh, *.bat, *.command   # launcher lokal
source/                      # aplikasi Next.js + engine Rust
  engine/                    # crate Rust (MNA solver)
  public/wasm/               # circuit_engine.wasm (binary hasil build)
  src/lib/circuit/           # engine wrapper, renderer, preset, file format
  src/components/sim/        # UI simulator
  docs/                      # dokumentasi teknis
  scripts/                   # test headless engine & probe
z-avo-800/                   # paket instrumen Z-AVO 800 (standalone, black box)
z-dso-2104/                  # paket instrumen Z-DSO 2104 (standalone, black box)
```

Dokumentasi lengkap: [`source/README.md`](source/README.md) dan [`source/docs/`](source/docs).

## Catatan Build

Repo ini **tidak** menyertakan artefak build. Folder `node_modules/`, `.next/`, `target/`,
`server.js`, dan file `.env` di-ignore (lihat [`.gitignore`](.gitignore)) dan dibuat ulang
oleh perintah di atas. Binary engine `source/public/wasm/circuit_engine.wasm` sudah disertakan
sehingga aplikasi bisa langsung jalan tanpa toolchain Rust.

## Kredit

Di-reverse engineer dari [circuitjs1](https://github.com/pfalstad/circuitjs1) karya Paul Falstad —
ditulis ulang dari nol di Rust, bukan fork kode.
