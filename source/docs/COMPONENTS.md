# Referensi Komponen

Total **38 tipe engine** (`T.*` 1–37 plus `IC_DUMMY = 103`, mirror `engine/src/elements.rs`).
`ELEMENT_META` punya **43 entri palette** karena NPN/PNP dan N/P-MOSFET berbagi tipe engine
(15/16) dengan flag `F_PNP = 0x100`, plus probe **JS-only** untuk multimeter Z-AVO
(`PROBE_RED = 101`, `PROBE_BLACK = 102`) dan `BATTERY_DC = 104` yang dipetakan ke elemen
voltmeter/sumber tegangan saat dikirim ke engine. Kategori sidebar:
`Passive, Sources, Probes, Active, Logic, Other`.

## Flag & Waveform

| Flag | Nilai | Arti |
|---|---|---|
| `F_CLOSED` | 1 | Switch/logic input dalam keadaan tertutup |
| `F_MOMENTARY` | 2 | Switch momentary (kembali terbuka setelah dilepas) |
| `F_PNP` | 0x100 | Transistor/MOSFET tipe P |
| Waveform | flags & 0xFF | 0 DC, 1 AC/sine, 2 square, 3 triangle, 4 sawtooth, 5 pulse |
| Jumlah input gerbang | flags & 0xFF | 2–4 (tipe 19–26) |

## Kategori & Komponen

### Passive (7)
| Komponen | Tipe | Parameter (default) | Field edit |
|---|---|---|---|
| Wire | `T.WIRE = 1` | — | — |
| Resistor | 3 | `[1000]` | Resistance (Ω) |
| Capacitor | 4 | `[1e-5, 0.001]` | Capacitance (F), Initial Voltage (V) |
| Inductor | 5 | `[0.001, 0]` | Inductance (H), Initial Current (A) |
| Potentiometer | 10 | `[1000, 0.5]` | Resistance (Ω), Wiper Position (0–1); seret untuk menentukan kedua ujung, pin wiper otomatis di sisi body |
| Switch | 9 | `[0]` | On Resistance (Ω); klik = toggle |
| Lamp | 11 | `[100]` | Resistance (Ω) |

### Sources (5)
| Komponen | Tipe | Parameter (default) | Field edit |
|---|---|---|---|
| Ground | 2 | — | — |
| Voltage Source | 6 | `[40, 5, 0, 0, 0.5]` | Waveform (DC/AC/Square/Triangle/Saw/Pulse), Frequency (Hz), Peak Voltage (V), DC Offset (V), Duty Cycle |
| DC Battery | 104 → 6 | `[0, 5, 0, 0, 0.5]`, `WF_DC` | Voltage (V); simbol sel baterai, dipetakan ke sumber tegangan DC |
| Current Source | 7 | `[0.01]` | Current (A) |
| Voltage Rail | 8 | `[5]` | Voltage (V) |

### Probes (3)
| Komponen | Tipe | Prinsip kerja | Field edit |
|---|---|---|---|
| Ammeter | 35 | Sumber tegangan 0 V — arus dibaca dari variabel MNA | — |
| Voltmeter | 36 | Shunt 1 GΩ; menampilkan tegangan antar-kaki | — |
| Ohmmeter | 37 | Sumber arus uji 10 mA + shunt 1 GΩ; `R = V/I` | — |

### Active (11)
| Komponen | Tipe | Parameter (default) | Field edit |
|---|---|---|---|
| Diode | 12 | `[Is=1.714e-7, 0, 0, N=2]` | Saturation Current (A), Breakdown (V), Emission Coeff N |
| LED | 13 | `[2.76e-34, 0, 0, N=1]` (drop ±2 V) | Saturation Current (A) |
| Zener Diode | 14 | `[1.714e-7, 5.1, 0, 2]` | Sat. Current, Breakdown (V), N |
| NPN / PNP Transistor | 15 (flag 0/0x100) | `[beta=100, Is=1e-13]` | Beta hFE, Saturation Current (A) |
| N-MOSFET / P-MOSFET | 16 (flag 0/0x100) | `[Vt=1.5, beta=0.02]` | Threshold Voltage (V), Beta (A/V²) |
| Op-Amp | 17 | `[15, -15, 1e5]` | Max Output (V), Min Output (V), Gain |
| Comparator | 18 | `[15, -15]` | High Output (V), Low Output (V) |
| Transformer | 33 | `[0.004, 1, 0.999]` | Primary Inductance (H), Turns Ratio, Coupling |
| Generic IC | 103 | — | —; 4 pin dummy di sisi kiri, tidak melakukan stamping |

### Logic (14)
| Komponen | Tipe | Parameter (default) | Field edit |
|---|---|---|---|
| AND / OR / NAND / NOR / XOR / XNOR | 19–24 | `[5]`, flags 2 | Input Count (2/3/4), High Logic Voltage (V) |
| Inverter | 25 | `[5]` | High Logic Voltage (V) |
| Buffer | 26 | `[5]` | High Logic Voltage (V) |
| Logic Input | 27 | `[5]` | High Voltage (V); klik = toggle |
| Clock Input | 28 | `[5, 100]` | High Voltage (V), Frequency (Hz) |
| Logic Output | 29 | `[5]` | — |
| D Flip-Flop | 30 | `[5]` | High Voltage (V) |
| ADC (4-bit) | 31 | `[5]` | Full Scale Voltage (V) |
| DAC (4-bit) | 32 | `[5]` | Max Output Voltage (V) |

### Other (1)
| Komponen | Tipe | Parameter | Field edit |
|---|---|---|---|
| Spark Gap | 34 | `[1000]` | Breakdown Voltage (V) |

## Mekanisme Dialog Edit

Semua spesifikasi field edit hidup di sisi JS (`ELEMENT_META[].edits`), bentuk
`EditField = { label, param, unit, kind?, choices?, flagsMask?, step? }`:

- `param >= 0` → menulis `params[param]` via `sim_set_param`.
- `param = -1` → nilai disimpan ke **flags** (waveform) melalui `flagsMask`.
- `param = -2` → jumlah input gerbang (flags); mengubahnya memicu relayout posisi post
  struktural (tipe 19–26) dan `onApply(params, flags, posts)`.

Engine tidak menyimpan spesifikasi edit — hanya menerima angka mentah, sehingga ABI tetap
ramping dan UI bebas berevolusi.
