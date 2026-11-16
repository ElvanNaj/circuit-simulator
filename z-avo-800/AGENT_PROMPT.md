# PROMPT AGENT — Integrasi AVOmeter Virtual "Z-AVO 800" ke Proyek Simulasi Sirkuit

> Salin seluruh teks di bawah garis ini ke agent Anda. Prompt ini self-contained:
> agent tidak perlu membaca file lain untuk berhasil mengintegrasikan.
> Paket: folder standalone (index.html + z-avo.js + z-avo-ui.js + z-avo.css) — tanpa build, tanpa npm.

---

Kamu akan mengintegrasikan **AVOmeter digital virtual "Z-AVO 800"** (aplikasi web
standalone yang sudah jadi, tampilan 1:1 meniru Sanwa CD800a) dengan **aplikasi
simulasi sirkuit** milik saya. AVOmeter berjalan di **window browser dedicated**
(terpisah dari aplikasi simulasimu). Tugasmu: menambahkan kode pada proyek
simulasi sirkuitku agar ia **mengirim pengukuran ke AVOmeter** dan **bisa
mengendalikan AVOmeter** — persis seperti probe multimeter nyata.

## ARSITEKTUR

- AVOmeter adalah halaman statis (`index.html` di folder paket ini). Tidak perlu build, server, atau dependency apa pun.
- AVOmeter mendengarkan perintah lewat **3 transport sekaligus** (semua sudah aktif, tidak perlu setup):
  1. **BroadcastChannel `"avo-bridge"`** ← GUNAKAN INI untuk dua window terpisah (paling sederhana & andal). Syarat: kedua halaman dilayani dari origin yang sama (`http://localhost`). Jalankan `start.py`/`start.sh`/`start.bat` atau server statis apa pun.
  2. `window.postMessage` — jika kamu memegang referensi window AVOmeter dari `window.open()` atau iframe. Juga fallback untuk mode `file://`.
  3. `window.AVO` — objek JS global di dalam halaman AVOmeter (hanya jika kode berjalan di halaman yang sama / iframe same-origin).
- Halaman AVOmeter: `index.html` (window dedicated). Contoh implementasi referensi yang SUDAH berfungsi: buka `sim-demo.html` — halaman simulator voltage divider yang mengirim V(red)−V(black) ke AVOmeter; buka juga `examples/minimal-integration.html` untuk versi paling minimal. Tiru polanya.

## KONSEP PROBE — "DITARUH SEPERTI KOMPONEN BIASA"

Inti integrasi: **probe adalah komponen sirkuit biasa di simulator Anda**, bukan
objek khusus AVOmeter. Simulator mendefinisikan DUA komponen probe di palette:

| Probe | Warna | Input jack AVOmeter | Fungsi |
|---|---|---|---|
| Probe merah | `#d8321f` | V/Ω/Hz (kanan COM) | positif pengukuran |
| Probe hitam | `#15171a` | COM | common / negatif |

Cara kerja di simulator Anda:
1. Komponen **Probe merah** ditaruh ke schematic, tip-nya menyentuh sebuah node (mis. `nA`). Lakukan seperti menaruh resistor — drag dari palette, klik untuk posisi, klik node untuk connect.
2. Komponen **Probe hitam** ditaruh ke node lain (mis. `nB` / GND).
3. Saat simulasi berjalan, simulator menghitung besaran listrik di pasangan node tersebut, lalu mengirim ke AVOmeter via `setMeasurement`.

Mode pengukuran (DCV/ACV/Ω/DCA/ACA/CONT/DIODE/CAP/Hz/DUTY) **ditentukan oleh
posisi rotary selector di AVOmeter**, bukan oleh probe. Simulator cukup
mengirim `samples` mentah (atau `scalar`) — AVOmeter yang menghitung tampilan
akhir sesuai modenya.

> Pengecualian: untuk **DCA/ACA** probe harus disisipkan **in-series** di
> simulator (mirip amperemeter). Simulator mengetahui arus yang lewat probe dan
> mengirimkannya sebagai `samples` arus.

## FORMAT PESAN

Tambahkan flag `__avo: true` pada setiap pesan agar tidak tertukar dengan pesan lain.

```js
// Perintah (sim → AVO)
{ __avo: true, id: "uuid-opsional", cmd: "<namaPerintah>", args: [ ... ] }
// Balasan (AVOmeter → pengirim; hanya jika `id` diberikan)
{ __avo: true, __avoReply: true, id, ok: true, data: ... }        // sukses
{ __avo: true, __avoReply: true, id, ok: false, error: "..." }    // gagal
// Event broadcast dari AVOmeter (state/reading/beep + heartbeat ±1 dtk)
{ __avo: true, __avoEvent: true, event: "state"|"reading"|"beep"|"heartbeat", data: ... }
```

## MENGIRIM PENGUKURAN (fungsi utama)

```js
const bc = new BroadcastChannel("avo-bridge");

// Voltage (DCV/ACV): kirim V = Vred - Vblack dari analisis nodal
function sendVoltage(Vred, Vblack) {
  const v = Vred - Vblack;
  const N = 64, buf = new Float32Array(N);
  for (let i = 0; i < N; i++) buf[i] = v;       // Float32Array, JANGAN Array biasa
  bc.postMessage({
    __avo: true, cmd: "setMeasurement",
    args: [{ type: "voltage", samples: buf, sampleRate: 1000, scalar: v,
             probes: { red: "nA", black: "nB" } }]
  });
}

// Current (DCA/ACA): probe merah in-series, kirim arus yang lewat
function sendCurrent(I) {
  const buf = new Float32Array(64);
  for (let i = 0; i < buf.length; i++) buf[i] = I;
  bc.postMessage({
    __avo: true, cmd: "setMeasurement",
    args: [{ type: "current", samples: buf, sampleRate: 1000, scalar: I,
             probes: { red: "nA_series", black: "nB" } }]
  });
}

// Resistance (OHM/CONT): matikan sumber, injeksi 1 mA, ukur V, R = V/I
function sendResistance(R) {
  bc.postMessage({
    __avo: true, cmd: "setMeasurement",
    args: [{ type: "resistance", scalar: R, meta: { R: R },
             probes: { red: "nA", black: "nB" } }]
  });
}

// Capacitance (CAP): dari model komponen simulator
function sendCapacitance(C) {
  bc.postMessage({
    __avo: true, cmd: "setMeasurement",
    args: [{ type: "capacitance", scalar: C, meta: { C: C } }]
  });
}

// Frequency/Duty: stream sampel tegangan periodik + sampleRate
function sendFreqSample(samples, sampleRate) {
  bc.postMessage({
    __avo: true, cmd: "setMeasurement",
    args: [{ type: "frequency", samples, sampleRate, probes: { red: "nA", black: "nB" } }]
  });
}
```

Aturan `setMeasurement(payload)`:

| Field | Wajib | Keterangan |
|---|---|---|
| `type` | ya | `"voltage"` \| `"current"` \| `"resistance"` \| `"capacitance"` \| `"frequency"` \| `"duty"` \| `"diode"` \| `"continuity"` |
| `samples` | ya* | `Float32Array` berisi sampel mentah tegangan/arus. *Bisa dilewati bila `scalar` diberikan. |
| `sampleRate` | kondisional | sampel/detik (wajib bila AVOmeter harus menghitung freq/duty dari samples) |
| `tStart` | opsional | waktu sampel pertama, detik |
| `scalar` | opsional | nilai skalar hasil hitungan simulator. Bila diberikan, dipakai langsung untuk display — samples hanya cadangan. |
| `probes` | opsional | `{ red: "nodeId", black: "nodeId" }` — agar AVOmeter tahu node mana yang sedang diukur |
| `meta` | opsional | `{ R, C, Vf }` — untuk mode yang butuh besaran turunan (Ω, CAP, DIODE) |

Aturan mode ↔ payload:
- **DCV/ACV**: kirim `samples` tegangan (atau `scalar` untuk DC konstan). AVOmeter menghitung mean (DCV) atau RMS AC (ACV).
- **DCA/ACA**: kirim `samples` arus (probe in-series) atau `scalar`.
- **OHM**: kirim `scalar` resistance (simulator menghitung V/I saat sirkuit unpowered), atau `meta.R`.
- **CONT**: sama dengan OHM. AVOmeter otomatis membunyikan beep bila R < 50 Ω.
- **DIODE**: kirim `meta.Vf` (forward voltage drop) atau `scalar`.
- **CAP**: kirim `scalar` capacitance atau `meta.C`.
- **HZ**: kirim `samples` tegangan periodik + `sampleRate`. AVOmeter mendeteksi frekuensi via zero-crossing.
- **DUTY**: kirim `samples` sinyal kotak. AVOmeter menghitung duty cycle.

`clearMeasurement()` mengembalikan AVOmeter ke sumber demo internal.

## DAFTAR PERINTAH (semua via format pesan di atas; `{"cmd":"help","args":[]}` mencetak daftar ini dari AVOmeter)

- **Pengukuran**: `setMeasurement(payload)` · `clearMeasurement()`
- **Probe**: `attachProbe("red"|"black", nodeId)` · `detachProbe("red"|"black")` · `getProbes()`
- **Mode**: `setMode(mode)` — `mode` salah satu dari `"OFF"\|"DCV"\|"ACV"\|"DCA"\|"ACA"\|"OHM"\|"CONT"\|"DIODE"\|"CAP"\|"HZ"\|"DUTY"`
- **Range**: `setRange(range|"auto")` · `cycleRange()` · `autoRange()`
- **Tombol**: `setPower(bool)` · `hold()` · `rel()` · `select()` (cycle DCV↔ACV, DCA↔ACA, HZ↔DUTY, CONT↔DIODE)
- **Query**: `getState()` · `getReading()` · `help()`
- Satuan: **volt, ampere, ohm, farad, hertz, detik**. Display 4000 counts (OL bila melebihi range).

## PROBE COMPONENT SPEC (definisi untuk simulator Anda)

Tambahkan dua komponen probe di palette komponen simulator Anda. Pola implementasi
(sesuaikan ke framework simulator Anda):

```js
// Probe merah — tip menyentuh sebuah node, body handle untuk drag
const ProbeRed = {
  id: "probe_red",
  label: "Probe V/Ω/Hz (merah)",
  category: "instrument",
  color: "#d8321f",
  glyph: "VΩHz",
  terminals: 1,                   // 1 tip yang menyentuh node
  onPlace:  (comp, sim) => {
    sim.attachProbe("red", comp.tipNode);
    bc.postMessage({ __avo: true, cmd: "attachProbe", args: ["red", comp.tipNode] });
  },
  onMove:   (comp, sim) => {
    sim.attachProbe("red", comp.tipNode);
    bc.postMessage({ __avo: true, cmd: "attachProbe", args: ["red", comp.tipNode] });
  },
  onRemove: (comp, sim) => {
    sim.detachProbe("red");
    bc.postMessage({ __avo: true, cmd: "detachProbe", args: ["red"] });
  }
};

// Probe hitam — sama polanya, color "#15171a", glyph "COM"
const ProbeBlack = { /* ... id: "probe_black", color: "#15171a", glyph: "COM" ... */ };
```

**Tampilan visual probe** (gambar SVG/CSS):
- Probe merah: handle persegi panjang rounded `#d8321f` dengan teks "VΩHz" putih, garis tip merah ke node.
- Probe hitam: handle `#15171a` dengan teks "COM" putih, garis tip hitam ke node.
- Tip: lingkaran kecil berwarna sesuai probe, berdenyut saat live measurement sedang dikirim.

**Loop simulasi** — saat user menjalankan simulasi, kirim pengukuran ~10–30 Hz:
- Baca mode AVOmeter dari event `state` (atau cache dari `getState()`) untuk tahu apa yang harus dikirim.
- Voltage: hitung `V(red) - V(black)` dari analisis nodal, kirim `sendVoltage(vRed, vBlack)`.
- Current: pastikan probe merah in-series; baca arus yang lewat; kirim `sendCurrent(I)`.
- Resistance: matikan sumber, injeksi 1 mA antara probe, ukur V, R = V/I; kirim `sendResistance(R)`.
- Diode: injeksi arus test forward, ukur Vf; kirim `{ type:"diode", scalar: Vf }`.
- Capacitance: hitung dari model komponen; kirim `sendCapacitance(C)`.
- Frequency/Duty: stream sampel tegangan periodik dengan `sampleRate` tinggi (mis. 48 kHz, 256 sampel).

## POLA KONEKSI YANG DIANJURKAN

1. Dari aplikasi simulasimu: `const avoWin = window.open("avo/index.html", "z-avo", "width=720,height=900");` (sesuaikan path relatif tempat folder paket ini diekstrak).
2. Sambungkan `const bc = new BroadcastChannel("avo-bridge");` (bila keduanya dilayani via http://localhost — jalankan `start.py` dari folder paket bila perlu).
3. Tunggu event `heartbeat` (±1 dtk) pada `bc.onmessage` → tanda AVOmeter hidup & terhubung. Tampilkan indikator status di UI sim.
4. Kirim konfigurasi awal (`setMode`, `attachProbe`), lalu stream `setMeasurement` tiap frame.
5. Tangani event `reading` dari AVOmeter → bisa dipakai untuk menampilkan nilai AVOmeter sebagai tooltip/label di sisi probe di schematic.
6. Tangani event `beep` → mainkan suara continuity di simulator juga (atau biarkan AVOmeter yang membunyikan).
7. Untuk membaca hasil (request/response), sertakan `id` unik dan tunggu balasan `__avoReply` dengan `id` yang sama.
8. Fallback bila BroadcastChannel tidak sampai (mode `file://`, window beda profile/incognito): kirim perintah yang sama via `avoWin.postMessage({...}, "*")` — AVOmeter membalas ke `event.source`.

## ATURAN PENTING

- JANGAN mengubah file AVOmeter (`z-avo.js`, `z-avo-ui.js`, `z-avo.css`, `index.html`) — anggap instrumen hitup (black box). Semua integrasi cukup lewat pesan.
- Satu frame sim = satu panggilan `setMeasurement`. Jangan kirim lebih cepat dari 60 fps.
- Selalu kirim `Float32Array` untuk `samples` (bukan Array biasa).
- Probe merah & hitam adalah komponen biasa di simulator — ditaruh, dipindah, dihapus seperti resistor.
- Mode AVOmeter diubah user lewat rotary selector di window AVOmeter; simulator hanya membaca event `state` untuk tahu mode aktif (jangan memaksakan mode dari simulator kecuali user eksplisit memintanya).
- Untuk DCA/ACA, JANGAN kirim tegangan — kirim arus (probe merah harus in-series di schematic).
- Bila simulator ditutup / probe dihapus, kirim `clearMeasurement()` + `detachProbe("red")` + `detachProbe("black")` agar AVOmeter kembali ke mode demo.

## VERIFIKASI WAJIB (lakukan berurutan, laporkan hasilnya)

1. Buka AVOmeter di window dedicated (jalankan `start.py` atau buka `index.html`); pastikan LCD menyala hijau, mode default DCV, pembacaan demo ~1.5 V.
2. Dari kode simulasimu, taruh probe merah di node `nA` dan probe hitam di node `nB` dari voltage divider sederhana (V+ = 5 V, R1 = 1 kΩ, R2 = 2.2 kΩ) → kirim `attachProbe` lalu `setMeasurement` dengan `scalar: 3.448 V` (V(nA) = 5 × 2.2/(1+2.2)).
3. Verifikasi: `getReading` mengembalikan `display ≈ "3.448"`, `unit = "V"` (toleransi ±0.5%).
4. Uji kendali: kirim `setMode("OHM")` → LCD AVOmeter harus berubah ke mode Ω dan menampilkan resistance yang dikirim.
5. Uji `setPower(false)` → LCD standby. `setPower(true)` → kembali menyala.
6. Uji `hold()` → nilai terkunci (ikon HOLD menyala di LCD). `hold()` lagi → lepas.
7. Uji `select()` dari mode DCV → harus pindah ke ACV; dari HZ → DUTY.
8. Uji continuity: set mode `CONT`, kirim `scalar: 27` (Ω) → event `beep` harus dipancarkan dan LCD menampilkan ~27 Ω dengan ikon ♪.
9. Lepas probe & panggil `clearMeasurement()` saat menutup sim agar AVOmeter kembali ke demo internal.

Jika ada langkah yang gagal, cetak balasan error dari AVOmeter (`error` field) dan perbaiki parameter perintahmu — AVOmeter mengirim pesan kesalahan yang jelas (mis. `unknown mode: FOO` atau `range 9999 not valid for mode DCV`).
