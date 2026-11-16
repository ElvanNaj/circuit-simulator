# Engine Simulasi (Rust)

Dokumen ini menjelaskan inti fisika di `engine/src/sim.rs` (1.762 baris), `lu.rs`, dan
`elements.rs`. Tujuannya meniru perilaku numerik circuitjs1 (Falstad) sedetail mungkin,
termasuk leniensi konvergensinya.

## Modified Nodal Analysis (MNA)

Setiap elemen memberi kontribusi ke matriks konduktansi `G` dan vektor arus `z` sehingga
sistem `G·v = z` menghasilkan tegangan semua simpul. Elemen dua-kaki men-stamp konduktansi
`1/R` ke diagonal + off-diagonal pasangannya. Sumber tegangan ditangani dengan baris/ kolom
tambahan (variabel arus sumber) — arus sumber tegangan ke-n dibaca dari
`solution[(n_nodes-1)+vs]` melalui helper `vs_current()`, bukan dari baris matriks (bug klasik
yang menghasilkan arus palsu 5 A bila salah indeks).

- Simpul tak terhubung otomatis diberi resistor **1 GΩ ke ground** (`stamp_unconnected_resistors`)
  agar matriks tidak singular.
- Voltmeter realisasi = shunt **1 GΩ**; Ohmmeter = sumber arus uji **10 mA + shunt 1 GΩ**
  sehingga `R = V/I` dan pembacaan tidak mengganggu rangkaian (hanya ~5 nA pada 5 V).

## LU Factorization

`lu.rs` (121 baris) melakukan faktorisasi **Crout dengan partial pivoting**. Matriks kecil
(dense) cukup cepat: test 300-section RC ladder menganalisis dalam hitungan milidetik.

**Cached factorization** — jika rangkaian linier murni dan komposisinya stabil, faktor LU
di-cache dan langkah berikutnya hanya substitusi maju/mundur (`skip_solve`). Cache dibatalkan
(re-stamp + re-factor) saat: struktur berubah, `dt` berubah (`sim_set_dt_max`), atau `reset`.

## Newton–Raphson + Voltage Limiting

Elemen nonlinear (dioda, BJT, MOSFET, op-amp) diiterasi. Setiap subiterasi:

1. Hitung tegangan percobaan, **limit per-junction** ala circuitjs1:
   - Dioda: limiting logaritmik di atas `vcrit = VT·ln(VT/(√2·Is))`; breakdown Zener via
     `vzcrit`/`zoffset` (di-tune agar 5 mA tepat di tegangan zener).
   - Transistor: `transistor_limit_step` per junction B-E dan B-C.
   - Gmin ramp: dioda mulai `leakage·0.01` tumbuh eksponensial maks 3.000 subiter (cap 0,1);
     transistor mulai 1e-12 selama 300 subiter.
2. Stamp model linearisasi, faktorisasi, solusi.
3. Cek konvergensi: `|vd − vd_sebelumnya| > 0,01 V` → belum konvergen (dioda/BJT), MOSFET
   memakai `mosfet_nonconvergence` yang makin longgar: setelah subiter 10 ambang menjadi
   `|v|·0,001`, setelah 100 menjadi `0,01 + (subiter−100)·0,0001` — persis original.

`max_subiter = 5000` (default `adjust_timestep = false`, mode brute-force ala original) atau
100 saat adaptif. Mode adaptif menggandakan `dt` setelah ≥ 3 iterasi "good" dan membagi dua
saat gagal (batas bawah `dt_min = 1e-12`, maks 8 kegagalan beruntun). Kegagalan total
menyetel pesan `"Convergence failed!"`; matriks singular → `"Singular matrix!"`.

## Companion Model Trapezoidal

Kapasitor dan induktor dimodelkan sebagai resistor + sumber arus riwayat (companion model):

| Elemen | Resistansi companion | Catatan |
|---|---|---|
| Kapasitor C | `R = dt / (2C)` | Setengah-langkah trapezoidal |
| Induktor L | `R = 2L / dt` | Idem |

Karena `R` bergantung `dt`, setiap perubahan `dt` **wajib re-stamp + re-factor** — inilah
penyebab bug LC tank 50× terlalu cepat saat `sim_set_dt_max` belum re-stamp (sudah diperbaiki).
Kondisi awal (tegangan kapasitor / arus induktor) diisi dari parameter elemen saat `reset`.

## Model Semikonduktor

- **Dioda/LED/Zener**: `Is`, breakdown, koefisien emisi `N` (default dioda N=2), `VT = 0,025865 V`.
- **BJT (NPN/PNP via flag `F_PNP`)**: beta (default 100), Is (1e-13); `realvgs` dihitung
  **sebelum** tanda pnp diterapkan agar linearisasi konsisten (bug CMOS pull-up 5.000 V).
- **MOSFET (N/P)**: threshold `Vt` (1,5 V), beta (0,02 A/V²); keadaan off tetap bocor
  `ids = vds·1e-8` agar matriks tidak kosong.
- **Op-amp**: gain 100.000, saturasi slope `dx = 1e-4`, rentang output dari parameter
  (default ±15 V).
- **Gerbang logika**: model sumber tegangan + resistansi, ambang `v > highV·0,5`; anti-osilasi
  tie-break xorshift setelah > 50 flip searah.

## Timestep & Scope

- `dt = dt_max = 5 µs`, `dt_min = 1e-12`; `dt` di-reset ke `dt_max` tiap `analyze()`.
- Scope: ring buffer **32.768 sampel/channel** berformat `(t, v, i)`; maksimal 4 channel dari UI.
- Output per elemen (stride 8): `[vd, power, i0..i3, extra, spare]` — indeks arus per kaki
  digunakan KCL di JS untuk arah dots.
