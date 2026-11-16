# Panduan Antarmuka

## Toolbar Atas

| Elemen | Fungsi |
|---|---|
| **Load preset…** | Dropdown 9 preset rangkaian siap pakai |
| **Save file** | Unduh rangkaian sebagai `.circuit.json` (`Ctrl/Cmd+S`) |
| **Open file** | Buka file `.circuit.json` (`Ctrl/Cmd+O`); file juga bisa di-drop ke kanvas |
| **Add** (`P`) | Buka **quick component search** (lihat bagian Quick Add) |
| **Pause / Run** | Jeda / lanjut simulasi (juga tombol `Space`) |
| **Reset** | Reset waktu & state semua elemen |
| **Theme** | Pilih tampilan **Dark / Light / Pink**; pilihan disimpan di `localStorage` (`theme`) |
| **Speed** (slider) | Kecepatan simulasi logaritmik **0,01× – 100×** |
| **Flow** (slider) | Kecepatan animasi titik arus **0 – 3×** (0,05×/step; ~1 px/frame pada 1×); nonaktif saat animasi dimatikan |
| **Activity** | Toggle **animasi arus** (titik bergerak). Hanya visual — simulasi, warna kabel, dan nilai tetap live |
| ZoomIn / ZoomOut | Zoom in/out |
| Maximize2 | **Fit circuit to view** (`F`) |
| Crosshair | Reset pandangan (`{x:0, y:0, zoom:1}`) |
| Eye | Toggle label nilai pada kanvas (indikator amber saat aktif) |
| Undo2 / Redo2 | Undo / redo satu langkah (stack maks 100; `Ctrl+Z` / `Ctrl+Shift+Z`) |
| Keyboard | Buka cheat-sheet shortcut (`?`) |
| Trash2 (merah) | Hapus seleksi; tooltip menghitung jumlah terpilih |
| `t = X.XX ms` | Waktu simulasi berjalan |

## Tema (Dark / Light / Pink)

Tombol **Theme** di toolbar membuka pilihan tampilan. Tema dipasang sebagai class pada
`<html>` (`.dark`, `.light`, `.pink`) oleh `next-themes`, disimpan otomatis di
`localStorage` (`theme`), dan bertahan setelah reload. Default-nya **Dark**.

Tema mengubah dua lapisan sekaligus:

- **Chrome simulator** — toolbar, sidebar komponen, dialog (edit, quick add, shortcut),
  status bar, dan tombol memakai token semantik (`bg-background`, `bg-card`, `bg-muted`,
  `text-foreground`, `text-muted-foreground`, `border-border`) plus aksen `bg-brand` /
  `text-brand`. Dark memakai aksen amber, Light amber gelap, Pink magenta.
- **Kanvas** — latar, grid, garis komponen, label nilai, readout instrumen, warna kabel
  (positif/negatif), glow LED/lamp/gerbang, post, dan titik arus mengikuti palet di
  `src/lib/circuit/theme.ts` (`CANVAS_PALETTES`).

Panel **Scope** serta jendela **Z-DSO / Z-AVO** sengaja tetap berlatar gelap agar terbaca
seperti layar alat ukur, terlepas dari tema aplikasi.

## Sidebar Komponen

Panel kiri (176 px) dikelompokkan: **Passive, Sources, Probes, Active, Logic, Other**.
Klik komponen untuk *mengunci* alat (mode place), klik lagi untuk batal. Elemen 1-post
ditempatkan sekali klik; elemen multi-post ditempatkan dengan drag (layout post otomatis:
op-amp, transistor B/C/E, gerbang menyebar sesuai jumlah input).

**Potensiometer** juga ditempatkan dengan drag: ujung drag menjadi kedua terminal
resistif, sedangkan pin wiper otomatis muncul di tengah body (tegak lurus, 2 grid =
40 px ke samping) dan tidak ikut mengikuti ujung drag. Klik tanpa drag membuat pot
standar 40 px. Label menampilkan resistansi dan posisi wiper, mis. `1.0 kΩ · 50%`;
ubah posisi wiper lewat dialog edit (nilai `0–1`).

Sidebar bisa **di-collapse** lewat tombol panah di pojok kanan atas panel, tombol rail
vertikal saat tertutup, atau tombol **`[`** di keyboard. Saat tertutup, panel menyusut
menjadi rail 40 px dan kanvas otomatis melebar. Pilihan ini disimpan di `localStorage`
(`circuit-sim-sidebar`), jadi tetap berlaku setelah reload.

## Quick Add (`P`)

1. Tekan **P** (atau tombol **Add** di toolbar) → dialog pencarian terbuka, kursor langsung
   di kolom input.
2. Ketik nama komponen. Pencarian mencocokkan nama, kategori, dan alias: `res`, `cap`,
   `gnd`, `npn`, `mos`, `vsrc`, `dff`, dll. Navigasi `↑`/`↓`.
3. Tekan **Enter** → dialog tertutup dan alat aktif; banner **“Placing: …”** muncul.
4. **Klik** kanvas untuk menaruh (atau **drag** untuk menentukan ukuran/orientasi),
   **Esc** untuk batal.

Enam komponen terakhir muncul di grup **Recent** (disimpan di `localStorage`
`circuit-sim-recent-components`).

## Interaksi Kanvas

| Aksi | Hasil |
|---|---|
| Klik area kosong + drag | **Rubber-band select** (kotak amber putus-putus); `Shift` menambah ke seleksi |
| Klik elemen + drag | Memindah seluruh seleksi |
| Drag di dekat post | Memindah satu post |
| Klik Switch / Logic Input | Toggle keadaan (`F_CLOSED`) |
| Drag label nilai (mis. `1 kΩ`, `5 V`) | Memindah label menjauh dari kabel/komponen lain (offset per elemen) |
| Double-click label nilai | Reset label ke posisi default |
| Double-click elemen | Buka dialog edit |
| `Alt` + drag / tombol tengah | Pan |
| Wheel | Zoom ke arah kursor (×1,12; batas 0,4×–3×) |
| Klik kanan | Dinonaktifkan (context menu diblokir) |

## Keyboard

| Tombol | Aksi |
|---|---|
| `P` | Quick component search |
| `[` | Collapse / expand sidebar komponen |
| `?` / `F1` | Buka cheat-sheet shortcut |
| `Enter` | Edit elemen yang sedang dipilih (jika punya parameter) |
| `R` | Putar seleksi 90° searah jarum jam (post pertama jadi jangkar) |
| `Ctrl/Cmd + D` | Duplikat seleksi (+40, +40 px) dan pilih hasilnya |
| `F` | Fit seluruh rangkaian ke tampilan |
| `Delete` / `Backspace` | Hapus seleksi |
| `Ctrl/Cmd + A` | Pilih semua |
| `Ctrl/Cmd + Z` | Undo |
| `Ctrl/Cmd + Shift + Z` / `Ctrl/Cmd + Y` | Redo |
| `Ctrl/Cmd + S` | Simpan rangkaian ke file `.circuit.json` |
| `Ctrl/Cmd + O` | Buka file rangkaian `.circuit.json` |
| `Space` | Run/Pause |
| `Escape` | Batalkan alat aktif + kosongkan seleksi |

Shortcut diabaikan saat fokus berada di kolom input/textarea/select atau saat dialog
(palette, edit, help) sedang terbuka. `Enter`/`Space` juga dibiarkan ke tombol yang
sedang fokus agar tidak memicu aksi ganda. Klik kanvas mengembalikan fokus ke dokumen.

## Dialog Edit

Judul `Edit {nama}`. Satu baris per field dari `ELEMENT_META[].edits` (label + unit).
Field angka (`step="any"`, `Enter` = apply) atau dropdown untuk choice (waveform, jumlah
input gerbang 2/3/4). Mengubah jumlah input gerbang merelayout posisi post secara struktural.
Footer menampilkan pembacaan live `Current: V = …`.

## Osiloskop (ScopePanel)

- Pilih elemen → tombol mengapung **“+ View in Scope”** → elemen jadi channel (maks 4).
- Tiap plot: trace **tegangan kuning** + **arus hijau**, grid, readout `V`/`I` via `fmtValue`,
  nama elemen + jendela waktu (s/ms/µs).
- Membaca hingga **4.096 sampel/frame** dari ring buffer engine (32.768 sampel/channel).
- Chip per-channel untuk melepas channel; legend `— voltage · — current`.

## Osiloskop Eksternal — Z-DSO 2104

Tombol **Z-DSO** di toolbar membuka instrumen 4-channel mandiri di jendela browser
terpisah (`/z-dso/index.html`, disalin apa adanya dari paket `z-dso-2104/`).

- Data channel scope yang sedang aktif (maks 4) di-resample ke **1.200 titik** per frame
  (±30 fps) dan dikirim lewat `BroadcastChannel("osc-bridge")` sebagai `Float32Array`.
  Panjang buffer selalu tepat satu layar (`timeDiv × 10`), sehingga trace tidak melar.
- Indikator titik hijau = scope terhubung (heartbeat ±1 dtk). Menu berisi:
  **Open/Focus oscilloscope**, **Run**, **Stop**, **Auto set**,
  **Time/div** (20 µs – 5 ms), **Signal** (Voltage, atau Current ×1000 dengan
  konvensi 1 mV ↔ 1 mA), **Test sine · 1 kHz 2 Vpp**, dan **Clear channels**.
- Saat halaman simulator ditutup/ditinggalkan, semua channel dikirim
  `clearChannelData(0..3)` agar scope kembali ke generator demo internalnya.
- Jika popup diblokir browser, izinkan popup untuk `localhost:3000` lalu coba lagi.

## Multimeter Eksternal — Z-AVO 800

Tombol **Z-AVO** di toolbar membuka instrumen multimeter gaya **Sanwa CD800a** di jendela
terpisah (`/z-avo/index.html`, disalin apa adanya dari paket `z-avo-800/`). Semua komunikasi
lewat `BroadcastChannel("avo-bridge")` (fallback `window.postMessage`), setiap pesan bertanda
`__avo: true` — file instrumen tidak diubah sama sekali.

- **Probe sebagai komponen.** Probe merah (**VΩHz**) dan hitam (**COM**) ada di palette
  kategori *Probes*; tekan **P** lalu cari `red probe` / `black probe`. Ujung probe menempel
  otomatis ke post atau titik terdekat pada kabel (kabel dipecah di titik probe), dan bisa
  digeser lewat handle-nya. Kedua probe harus terhubung agar meter memberi nilai; jika tidak,
  LCD menampilkan `----`.
- **Mode ditentukan selector meter**, bukan oleh probe. Menu Z-AVO hanya meneruskan pilihan
  user: DCV, ACV, DCA, ACA, Ω, Continuity, Diode, Capacitance, Hz, Duty, OFF.
- **Pemetaan pengukuran** (±10 Hz, `setMeasurement`):
  - DCV/ACV → sampel tegangan diferensial probe merah–hitam (`Float32Array` + `sampleRate`).
  - DCA/ACA → sampel arus dari elemen **Ammeter** pertama di rangkaian; probe merah harus
    dirangkai seri seperti ammeter sungguhan.
  - Ω/CONT → resistansi komponen dua-terminal (resistor/lamp/pot) di antara kedua ujung probe;
    node yang sama = 0 Ω dan memicu **beep** continuity (<50 Ω).
  - CAP → kapasitansi kapasitor di antara probe; DIODE → drop maju dioda/LED/zener
    (nilai live `Vf`, atau estimasi Shockley bila arus nol).
  - Hz → sampel tegangan + `scalar` frekuensi hasil zero-crossing ber-timestamp; Duty →
    sampel tegangan untuk dihitung meter.
- **Kontrol toolbar:** buka/fokus meter, indikator terhubung (heartbeat ±1 dtk), nilai live,
  status probe merah/hitam, pilih/taruh probe, ganti mode, **Hold**, **REL**, **Select**
  (DCV↔ACV, HZ↔DUTY, CONT↔DIODE, DCA↔ACA), **Power**, dan **Pause/Resume measurements**.
- Saat stream di-pause, probe dihapus, atau simulator ditutup, simulator mengirim
  `clearMeasurement()` + `detachProbe("red"/"black")` sehingga meter kembali ke demo internal.
- Jika popup diblokir browser, izinkan popup untuk `localhost:3000` lalu coba lagi.


## Pipeline Render (3-pass)

1. **Pass 1** — grid titik 20 px + semua elemen; kabel diwarnai tegangan:
   `|v|/5 V` → hijau (positif) / merah (negatif), makin terang makin besar beda potensial
   (union-find `computeNodeMap` di JS, replika penggabungan simpul engine).
2. **Pass 2** — semua **titik arus** digambar di atas segala elemen (di bawah post), jadi tidak
   pernah tertutup komponen. Kecepatan dot: skala log `min(2, 0.3 + 1.5·log10(1+|I|/1µA)/6)`,
   dikali slider Flow, arah mengikuti tanda arus. Tombol **Activity** bisa menyembunyikan seluruh
   animasi dot tanpa menghentikan simulasi atau mengubah warna/readout. Arus kabel dihitung dari
   graf kabel + spanning tree, jadi dua kabel yang tersambung (termasuk pertemuan T) tetap menampilkan animasi.
   Dioda/LED/Zener tidak menampilkan arus reverse leakage, dan arus < **1 µA** tidak dianimasikan.
3. **Pass 3** — semua **label teks** digambar paling akhir, sehingga label tidak mungkin
   tertutup bentuk komponen mana pun. Readout live dari **Ammeter/Voltmeter/Ohmmeter/probe**
   tampil lebih cerah (amber) dengan pill gelap agar menonjol dibanding nilai komponen; keduanya
   tetap bisa dipindah dengan drag.

## Persistensi

Seluruh rangkaian tersimpan otomatis ke `localStorage` key **`circuit-sim-elements`** pada
setiap perubahan (tambah/hapus/pindah, load preset, undo, edit nilai) dan dimuat kembali saat
halaman dibuka. Preferensi tampilan seperti status sidebar (`circuit-sim-sidebar`) dan
animasi arus (`circuit-sim-flow-anim`) juga diingat.

Untuk berbagi/backup, gunakan **Save file** (unduh `.circuit.json`) dan **Open file** (atau
drag-and-drop file ke kanvas). File menyimpan elemen, id, parameter, flags, channel osiloskop,
nama rangkaian, posisi view, dan offset label nilai. Saat dibuka, isi file divalidasi lebih dulu (tipe elemen,
koordinat post, jumlah parameter, id duplikat) sebelum diteruskan ke engine WASM; file lama
berupa array elemen mentah juga tetap didukung.
