# Z-AVO 800 — Panduan Integrasi AVOmeter Web (Paket Standalone)

AVOmeter virtual ini bisa dikendalikan penuh dari jendela/halaman lain. Ada
**3 transport** yang bisa dipakai (pilih satu, semuanya aktif bersamaan):

| Transport | Cocok untuk | Cara |
|---|---|---|
| `BroadcastChannel("avo-bridge")` | **Dua window/tab terpisah (rekomendasi utama)** | `new BroadcastChannel("avo-bridge")` lalu `postMessage` |
| `window.postMessage` | AVOmeter dibuka via `window.open()` / iframe, komunikasi 1-to-1, fallback `file://` | Kirim objek perintah ke window AVOmeter |
| `window.AVO` (JS langsung) | Skrip yang berjalan DI DALAM halaman AVOmeter / iframe same-origin | Panggil method langsung |

File halaman: `index.html` = AVOmeter · `sim-demo.html` = contoh simulator
sirkuit (voltage divider) yang sudah terintegrasi — **jadikan referensi pola
kodenya** · `examples/minimal-integration.html` = versi paling minimal.

> **Catatan `file://`:** BroadcastChannel tidak menyeberang antar halaman `file://`.
> Untuk 2 window gunakan server lokal (`start.py`/`start.sh`/`start.bat`, atau
> `npx serve .`) — atau biarkan `sim-demo.html` otomatis memakai `window.postMessage`.

---

## 1. Konsep probe — "ditaruh seperti komponen biasa"

Filosofi integrasi: **probe adalah komponen sirkuit biasa di simulator Anda**,
bukan objek khusus AVOmeter. Simulator mendefinisikan dua komponen probe:

| Probe | Warna | Terminal | Input jack AVOmeter | Fungsi |
|---|---|---|---|---|
| Probe merah | `#d8321f` | tip + handle | V/Ω/Hz (kanan COM) | positif pengukuran |
| Probe hitam | `#15171a` | tip + handle | COM | common / negatif |

Cara kerja di simulator Anda:
1. Komponen **Probe merah** ditaruh ke schematic, tip-nya menyentuh sebuah node
   (mis. `nA`). Lakukan seperti menaruh resistor — drag dari palette, klik untuk
   posisi, klik node untuk connect.
2. Komponen **Probe hitam** ditaruh ke node lain (mis. `nB` / GND).
3. Saat simulasi berjalan, simulator menghitung besaran listrik di pasangan node
   tersebut, lalu mengirim ke AVOmeter via `setMeasurement`.

Mode pengukuran (DCV/ACV/Ω/DCA/ACA/CONT/DIODE/CAP/Hz/DUTY) **ditentukan oleh
posisi rotary selector di AVOmeter**, bukan oleh probe. Simulator cukup
mengirim `samples` mentah (atau `scalar`) — AVOmeter yang menghitung tampilan
akhir sesuai modenya.

> Pengecualian: untuk **DCA/ACA** probe harus disisipkan **in-series** di
> simulator (mirip amperemeter). Simulator mengetahui arus yang lewat probe dan
> mengirimkannya sebagai `samples` arus.

---

## 2. Format pesan (BroadcastChannel & postMessage)

Semua pesan memakai flag `__avo: true` agar tidak bentrok dengan pesan lain.

```js
// PERINTAH (sim → AVO)
{ __avo: true, id: "opsi-unik-1", cmd: "setMeasurement", args: [ payload ] }

// BALASAN (AVOmeter → pengirim, hanya jika `id` disertakan)
{ __avo: true, __avoReply: true, id: "opsi-unik-1", ok: true, data: ... }
{ __avo: true, __avoReply: true, id: "opsi-unik-1", ok: false, error: "pesan kesalahan" }

// EVENT (AVOmeter → semua listener, broadcast berkala)
{ __avo: true, __avoEvent: true, event: "state",     data: { ...state lengkap } }  // saat ada perubahan
{ __avo: true, __avoEvent: true, event: "reading",   data: { display, value, unit, range, beep, ol } }
{ __avo: true, __avoEvent: true, event: "heartbeat", data: { t, power, mode } }   // tiap ±1 detik
{ __avo: true, __avoEvent: true, event: "beep",      data: { freq, dur } }        // saat continuity terdeteksi
```

- `postMessage`: AVOmeter membalas ke `event.source` (window pengirim).
- `BroadcastChannel`: AVOmeter membalas ke channel yang sama.
- Tanpa `id` = fire-and-forget (tidak ada balasan).

## 3. Mengirim pengukuran (paling penting)

```js
const bc = new BroadcastChannel("avo-bridge");

// Contoh 1: kirim V = Vred - Vblack sebagai DC voltage (mode DCV di AVOmeter)
const N = 64;
const buf = new Float32Array(N);
for (let i = 0; i < N; i++) buf[i] = vRed - vBlack;
bc.postMessage({
  __avo: true,
  cmd: "setMeasurement",
  args: [{
    type: "voltage",
    samples: buf,
    sampleRate: 1000,
    tStart: tNow - 0.01,
    scalar: vRed - vBlack,            // opsional: shortcut, AVOmeter pakai ini langsung
    probes: { red: "nA", black: "nB" }
  }]
});

// Contoh 2: kirim resistance terhitung dari simulator (mode OHM)
bc.postMessage({
  __avo: true, cmd: "setMeasurement",
  args: [{ type: "resistance", scalar: 470, meta: { R: 470 }, probes: { red: "nA", black: "nB" } }]
});
```

Konvensi `payload` pada `setMeasurement(payload)`:

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

`clearMeasurement()` mengembalikan AVOmeter ke sumber demo internal (~1.5 V, ~470 Ω, dll).

## 4. Daftar perintah lengkap

Panggil `{"cmd":"help","args":[]}` kapan saja untuk daftar ini dari dalam AVOmeter
(API Console di halaman AVOmeter pun punya tombol contoh).

| Perintah | args | Keterangan |
|---|---|---|
| `setMode` | `mode` | Putar selector: `"OFF"\|"DCV"\|"ACV"\|"DCA"\|"ACA"\|"OHM"\|"CONT"\|"DIODE"\|"CAP"\|"HZ"\|"DUTY"` |
| `setRange` | `range` atau `"auto"` | Set range manual (mis. `4` untuk range 4 V) atau kembali ke auto |
| `cycleRange` | `[]` | Pindah ke range berikutnya (atau kembali ke auto) |
| `autoRange` | `[]` | Paksa auto-range |
| `setPower` | `bool` | AVOmeter on/off |
| `hold` | `[]` | Toggle data hold |
| `rel` | `[]` | Toggle mode relatif (REL Δ) — nilai saat ini menjadi referensi |
| `select` | `[]` | Cycle SELECT: DCV↔ACV, DCA↔ACA, HZ↔DUTY, CONT↔DIODE |
| `setMeasurement` | `payload` | Kirim pengukuran dari simulator (lihat §3) |
| `clearMeasurement` | `[]` | Kembali ke sumber demo internal |
| `attachProbe` | `color, nodeId` | `color="red"\|"black"`. Catat node tempat probe menempel di sisi AVOmeter (untuk display). |
| `detachProbe` | `color` | Lepas probe dari AVOmeter |
| `getState` | `[]` | Snapshot lengkap: mode, range, hold, rel, probes, lastReading |
| `getReading` | `[]` | Pembacaan terkini: `{ value, display, unit, range, decimals, beep, ol }` |
| `getProbes` | `[]` | `{ red, black }` node id yang sedang menempel |
| `help` | `[]` | Daftar perintah |

Satuan: **volt, ampere, ohm, farad, hertz, detik**. Mode default `DCV`, range
default `auto`. Display 4000 counts (OL bila melebihi range).

## 5. Menerima state & event

```js
bc.onmessage = (ev) => {
  const d = ev.data;
  if (d?.__avo && d.__avoEvent) {
    if (d.event === "state")     console.log("konfigurasi berubah:", d.data);
    if (d.event === "reading")   console.log("LCD:", d.data.display, d.data.unit);
    if (d.event === "heartbeat") console.log("AVOmeter hidup, mode =", d.data.mode);
    if (d.event === "beep")      playBeep(d.data.freq, d.data.dur);  // continuity!
  }
};
```

## 6. Contoh lengkap (pola yang dipakai `sim-demo.html`)

```js
const bc = new BroadcastChannel("avo-bridge");

// 1) konfigurasi awal
bc.postMessage({ __avo: true, cmd: "setMode", args: ["DCV"] });
bc.postMessage({ __avo: true, cmd: "attachProbe", args: ["red", "nA"] });
bc.postMessage({ __avo: true, cmd: "attachProbe", args: ["black", "nB"] });

// 2) stream pengukuran tiap frame
function sendVoltageMeasurement(vRed, vBlack) {
  const v = vRed - vBlack;
  const N = 64, buf = new Float32Array(N);
  for (let i = 0; i < N; i++) buf[i] = v;
  bc.postMessage({
    __avo: true, cmd: "setMeasurement",
    args: [{ type: "voltage", samples: buf, sampleRate: 1000, scalar: v,
             probes: { red: "nA", black: "nB" } }]
  });
}

// 3) baca hasil pembacaan kapan saja (request/response):
const r = await new Promise((res) => {
  const id = crypto.randomUUID();
  const h = (ev) => {
    const d = ev.data;
    if (d?.__avoReply && d.id === id) { bc.removeEventListener("message", h); res(d); }
  };
  bc.addEventListener("message", h);
  bc.postMessage({ __avo: true, id, cmd: "getReading", args: [] });
});
console.log(r.data.display, r.data.unit);   // mis. "1.545" "V"
```

## 7. Probe component spec (untuk simulator Anda)

Tambahkan dua komponen probe di palette komponen simulator Anda:

```js
// Definisi komponen (pseudo-code, sesuaikan ke framework simulator Anda)
const ProbeRed = {
  id: "probe_red",
  label: "Probe V/Ω/Hz (merah)",
  category: "instrument",
  color: "#d8321f",
  terminals: 1,                  // 1 tip yang menyentuh node
  onPlace: (comp, sim) => {
    sim.attachProbe("red", comp.tipNode);
    bc.postMessage({ __avo: true, cmd: "attachProbe", args: ["red", comp.tipNode] });
  },
  onMove: (comp, sim) => {
    sim.attachProbe("red", comp.tipNode);
    bc.postMessage({ __avo: true, cmd: "attachProbe", args: ["red", comp.tipNode] });
  },
  onRemove: (comp, sim) => {
    sim.detachProbe("red");
    bc.postMessage({ __avo: true, cmd: "detachProbe", args: ["red"] });
  }
};

const ProbeBlack = {
  id: "probe_black",
  label: "Probe COM (hitam)",
  category: "instrument",
  color: "#15171a",
  terminals: 1,
  onPlace: (comp, sim) => {
    sim.attachProbe("black", comp.tipNode);
    bc.postMessage({ __avo: true, cmd: "attachProbe", args: ["black", comp.tipNode] });
  },
  // onMove, onRemove: sama polanya
};
```

Saat loop simulasi berjalan:
- **Voltage** (DCV/ACV): `vRed - vBlack` dari analisis nodal — kirim tiap frame.
- **Current** (DCA/ACA): probe merah HARUS in-series. Simulator mengambil arus
  yang lewat branch tempat probe menempel — kirim sebagai `samples` arus.
- **Resistance** (OHM/CONT): matikan sumber sirkuit, injeksikan arus test 1 mA
  antara probe merah & hitam, ukur V — R = V/I. Kirim `scalar` R.
- **Diode** (DIODE): injeksikan arus test forward, ukur Vf — kirim `meta.Vf`.
- **Capacitance** (CAP): simulator hitung dari model komponen — kirim `scalar` C.
- **Frequency/Duty** (HZ/DUTY): kirim `samples` tegangan periodik + `sampleRate`.

## 8. Checklist integrasi agent

- [ ] Buka AVOmeter di window dedicated: `window.open("index.html", "z-avo", "width=720,height=900")`
- [ ] Sambungkan `BroadcastChannel("avo-bridge")`, tunggu event `heartbeat` → tanda terhubung
- [ ] Definisikan komponen Probe merah & hitam di palette simulator (lihat §7)
- [ ] Saat probe ditaruh/dipindah, kirim `attachProbe` ke AVOmeter
- [ ] Kirim `setMode` awal sesuai pilihan user, lalu stream `setMeasurement` ~10–30 Hz
- [ ] Tangani event `reading` di simulator untuk sinkronisasi UI (mis. tampilkan display AVOmeter sebagai tooltip di probe)
- [ ] Tangani event `beep` untuk feedback continuity
- [ ] Bila simulator ditutup, kirim `clearMeasurement` + `detachProbe` agar AVOmeter kembali ke demo
- [ ] Verifikasi: `getReading` mengembalikan `display` sesuai ekspektasi (mis. "1.545" "V" untuk V = 1.545 V)
