# Build, Pengujian & Performa

## Prasyarat

- **Rust** (stable; project dibangun dengan rustc 1.99.1) + target `wasm32-unknown-unknown`
- **Node.js** (Next.js 16.1.1, React 19) — package manager: npm/bun

## Build Engine WASM

```bash
cd engine
cargo build --release --target wasm32-unknown-unknown
cp target/wasm32-unknown-unknown/release/circuit_engine.wasm ../public/wasm/
```

Crate **zero-dependency** (`Cargo.toml` tanpa `[dependencies]`), `crate-type = ["cdylib", "rlib"]`,
profil release: `opt-level = 3`, `lto = true`, `codegen-units = 1`, `panic = "abort"`.
Hasil akhir ± 86,7 KB.

## Menjalankan Aplikasi

```bash
npm run dev     # http://localhost:3000 (dev.log)
npm run build   # next build + standalone bundle
npm start       # jalankan standalone server
npm run lint    # eslint
```

`next.config.ts`: `output: "standalone"`, `reactStrictMode: false`.
Halaman memuat simulator via `dynamic(..., { ssr: false })`.

## Pengujian Headless (tanpa browser)

```bash
node scripts/engine-test.mjs    # 10 test fisika
node scripts/test-probes.mjs    # 5 test probe & regresi
```

### engine-test.mjs — 10 Test Fisika

| # | Test | Target | Toleransi |
|---|---|---|---|
| 1 | Voltage divider | titik tengah 2,5 V | ±1e-6 V |
| 2 | RC exponential (RC = 1 ms) | 4,96631 V @ 5 ms | ±0,01 V |
| 3 | Dioda konduksi | I 2–6 mA, Vd 0,3–0,7 V | range |
| 4 | NPN switch saturasi | kolektor ≈ 0 V | ±0,5 V |
| 5 | NMOS inverter | drain ≈ 0 V | ±0,15 V |
| 6 | Op-amp gain 10 | output 5,0 V (input 0,5 V) | ±0,2 V |
| 7 | AND gate 2 input | output 5,0 V | ±0,01 V |
| 8 | LC tank osilasi | tegangan kapasitor @1 ms | 0,01–12 V |
| 9 | Switch + lamp 100 Ω | arus lamp 50 mA | ±1e-4 A |
| 10 | Performa: ladder RC 300 seksi, 20.000 langkah | > 500k langkah/s | cetak µs/langkah |

### test-probes.mjs — 5 Test Probe

| # | Test | Target |
|---|---|---|
| 1 | Rangkaian kosong valid | `analyze([])` + `run` tanpa error (regresi delete-all) |
| 2 | Voltmeter | membaca 5,00 V ± 0,01; arus sumber tetap 5 mA (meter hanya menarik ~5 nA) |
| 3 | Ohmmeter | R ≈ 1,00 kΩ ± 0,1% |
| 4 | Ohmmeter seri 1k + 2,2k | R ≈ 3,20 kΩ ± 0,1% |
| 5 | Ohmmeter kaki terbuka | V > 1e6 tanpa singular matrix / crash |

Kedua skrip keluar non-zero bila ada kegagalan (`RESULT: X passed, Y failed`).

## Pengujian Browser (manual)

Skenario yang telah diverifikasi via browser headless: osilasi astable multivibrator
(LED ~3,4 ↔ 9,4 mA), half-wave rectifier (riak sesuai RC), CMOS inverter berubah state
saat logic input di-klik, drag-select, undo, autosave reload.

Regresi tambahan (Playwright): drag/reset label nilai & readout meter, toggle nilai,
toggle animasi arus (dots hilang tanpa mematikan simulasi/warna/readout), collapse sidebar,
menu Z-AVO, serta **tema Dark/Light/Pink** (class `<html>`, latar & garis kanvas, warna
readout, persistensi setelah reload).

## Catatan Performa

- Engine diberi **budget 12 ms/frame**; langkah per frame `≈ 55 · speed · dtReal/16,7`.
- Rangkaian linier ter-cache faktor LU-nya → langkah berikutnya hanya substitusi.
- Test 10 mencatat `analyze` ms, langkah/detik, dan µs/langkah untuk regresi performa.
