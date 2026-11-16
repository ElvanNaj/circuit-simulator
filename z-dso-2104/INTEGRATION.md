# Z-DSO 2104 — Panduan Integrasi Osiloskop Web (Paket Standalone)

Osiloskop virtual 4-kanal ini bisa dikendalikan penuh dari jendela/halaman lain.
Ada **3 transport** yang bisa dipakai (pilih satu, semuanya aktif bersamaan):

| Transport | Cocok untuk | Cara |
|---|---|---|
| `BroadcastChannel("osc-bridge")` | **Dua window/tab terpisah (rekomendasi utama)** | `new BroadcastChannel("osc-bridge")` lalu `postMessage` |
| `window.postMessage` | Scope dibuka via `window.open()` / iframe, komunikasi 1-to-1, fallback `file://` | Kirim objek perintah ke window scope |
| `window.OSC` (JS langsung) | Skrip yang berjalan DI DALAM halaman scope / iframe same-origin | Panggil method langsung |

File halaman: `index.html` = osiloskop · `sim-demo.html` = contoh simulator sirkuit (RC low-pass) yang sudah terintegrasi — **jadikan referensi pola kodenya** · `examples/minimal-integration.html` = versi paling minimal.

> **Catatan `file://`:** BroadcastChannel tidak menyeberang antar halaman `file://`.
> Untuk 2 window gunakan server lokal (`start.py`/`start.sh`/`start.bat`, atau
> `npx serve .`) — atau biarkan `sim-demo.html` otomatis memakai `window.postMessage`.

---

## 1. Format pesan (BroadcastChannel & postMessage)

Semua pesan memakai flag `__osc: true` agar tidak bentrok dengan pesan lain.

```js
// PERINTAH (sim → scope)
{ __osc: true, id: "opsi-unik-1", cmd: "setChannelData", args: [0, float32Array, { sampleRate, tStart, align: "none" }] }

// BALASAN (scope → pengirim, hanya jika `id` disertakan)
{ __osc: true, __oscReply: true, id: "opsi-unik-1", ok: true, data: ... }
{ __osc: true, __oscReply: true, id: "opsi-unik-1", ok: false, error: "pesan kesalahan" }

// EVENT (scope → semua listener, broadcast berkala)
{ __osc: true, __oscEvent: true, event: "state",     data: { ...state lengkap } }  // saat ada perubahan
{ __osc: true, __oscEvent: true, event: "heartbeat", data: { t, running } }        // tiap ±1 detik
```

- `postMessage`: scope membalas ke `event.source` (window pengirim).
- `BroadcastChannel`: scope membalas ke channel yang sama.
- Tanpa `id` = fire-and-forget (tidak ada balasan).

## 2. Mengirim data waveform (paling penting)

```js
const bc = new BroadcastChannel("osc-bridge");
const N = 1200;                              // jumlah sampel per frame
const win = 0.001;                           // durasi layar dalam detik = timeDiv × 10

setInterval(() => {
  const vin = new Float32Array(N);           // hitung dari sim sirkuit Anda
  for (let i = 0; i < N; i++) {
    const t = tNow - win + (i / (N - 1)) * win;
    vin[i] = Math.sin(2 * Math.PI * 1000 * t);
  }
  bc.postMessage({
    __osc: true,
    cmd: "setChannelData",
    args: [0, vin, { sampleRate: (N - 1) / win, tStart: tNow - win, align: "none" }],
  });
}, 33); // ±30 fps
```

Konvensi `meta` pada `setChannelData(ch, samples, meta)`:
- `sampleRate` — sampel/detik. Default: `1200 / (timeDiv*10)` (satu layar penuh).
- `tStart` — waktu sampel pertama (basis detik). Default: "tepat sekarang".
- `align`:
  - `"none"` (default) — buffer dianggap **sudah satu window layar utuh**; scope menampilkannya apa adanya. *Paling mudah untuk streaming real-time.*
  - `"trigger"` — scope mencari crossing trigger di buffer dan mengalinya (align) bersama channel lain.
  - `"center"` — buffer dipasang di tengah window.
- Mengirim `setChannelData` otomatis: menyalakan channel, mematikan generator internal channel itu.
- `clearChannelData(ch)` mengembalikan channel ke generator internal.
- Kirim `Float32Array` (bukan Array) — lebih cepat karena tidak di-serialize ke JSON.

**Tips window:** agar data pas satu layar, samakan `win` Anda dengan timebase scope: baca `timeDiv` dari event `state`, atau set sendiri lewat `setHorizontal` lalu gunakan `win = timeDiv*10`.

## 3. Daftar perintah lengkap

Panggil `{"cmd":"help","args":[]}` kapan saja untuk daftar ini dari dalam scope
(API Console di halaman scope pun punya tombol contoh).

| Perintah | args | Keterangan |
|---|---|---|
| `setChannelData` | `ch, samples, meta?` | Kirim data waveform eksternal (lihat §2) |
| `clearChannelData` | `ch` | Kembali ke generator internal |
| `setChannel` | `ch, {enabled?, voltsDiv?, offset?, coupling?, invert?, bwLimit?, probe?}` | Konfigurasi vertikal. `coupling`: DC/AC/GND; `offset` dalam volt (positif = naik); `probe`: 1\|10 |
| `setGenerator` | `ch, {type?, freq?, amp?, offset?, duty?, phase?, noise?}` | Generator internal: sine, square, triangle, sawtooth, pulse, dc, noise, am, off |
| `setHorizontal` | `{timeDiv?, hOffset?, trigPos?}` | Timebase (detik/div, otomatis di-snap ke deret 1-2-5), posisi horisontal, posisi trigger 0..1 |
| `setTrigger` | `{source?, level?, edge?, sweep?}` | source: 0–3; edge: rising/falling; sweep: auto/normal/single |
| `setDisplay` | `{persistence?, dots?, grid?, intensity?, xy?, fft?, fftSource?}` | persistence detik (0=off, Infinity=beku); grid: full/half/none |
| `setAcquisition` | `{mode?, avgCount?}` | mode: sample/peak/average |
| `setMath` | `{enabled?, op?}` | op: "A+B" \| "A-B" \| "A*B" (CH1, CH2) |
| `setCursors` | `{enabled?, hA?, hB?, vA?, vB?, active?}` | kursor tegangan (volt) & waktu (detik) |
| `setPower` | `bool` | Layar on/off (akuisisi tetap jalan) |
| `run` / `stop` / `single` | `[]` | Kontrol akuisisi; `single` menangkap satu trigger lalu berhenti |
| `forceTrigger` | `[]` | Paksa trigger |
| `autoSet` | `[]` | Set otomatis timebase/volt/trigger |
| `getChannel` | `ch` | Konfigurasi + pengukuran channel |
| `getGenerator` | `ch` | Konfigurasi generator |
| `getMeasurements` | `ch?` | `{CH1:{vpp,vmax,vmin,vamp,vavg,vrms,freq,period,duty,rise,fall,valid}, ...}` |
| `getState` | `[]` | Snapshot lengkap semua konfigurasi |
| `help` | `[]` | Daftar perintah |

`ch` = indeks 0–3 (CH1–CH4). Satuan: **volt** dan **detik**; frekuensi Hz.

## 4. Menerima state & event

```js
bc.onmessage = (ev) => {
  const d = ev.data;
  if (d?.__osc && d.__oscEvent) {
    if (d.event === "state")     console.log("konfigurasi berubah:", d.data);
    if (d.event === "heartbeat") console.log("scope hidup, t =", d.data.t); // indikator koneksi
  }
};
```

## 5. Contoh lengkap (pola yang dipakai `sim-demo.html`)

```js
const bc = new BroadcastChannel("osc-bridge");

// 1) konfigurasi awal
bc.postMessage({ __osc: true, cmd: "setHorizontal", args: [{ timeDiv: 0.0001 }] });
bc.postMessage({ __osc: true, cmd: "setChannel", args: [0, { enabled: true, voltsDiv: 1 }] });
bc.postMessage({ __osc: true, cmd: "setChannel", args: [1, { enabled: true, voltsDiv: 1 }] });

// 2) stream data tiap frame (lihat §2)
// 3) baca hasil pengukuran kapan saja dengan request/response:
const m = await new Promise((res) => {
  const id = crypto.randomUUID();
  const h = (ev) => {
    const d = ev.data;
    if (d?.__oscReply && d.id === id) { bc.removeEventListener("message", h); res(d); }
  };
  bc.addEventListener("message", h);
  bc.postMessage({ __osc: true, id, cmd: "getMeasurements", args: [] });
});
```

## 6. Checklist integrasi agent

- [ ] Buka scope di window dedicated: `window.open("index.html", "z-dso", "width=1290,height=1000")`
- [ ] Sambungkan `BroadcastChannel("osc-bridge")`, tunggu event `heartbeat` → tanda terhubung
- [ ] Kirim `setHorizontal` + `setChannel` awal, lalu stream `setChannelData` ±30 fps
- [ ] Window scope harus sejajar dengan window sim (BroadcastChannel butuh origin sama, browser profile sama); untuk `file://` pakai `postMessage`
- [ ] Verifikasi: `getMeasurements` mengembalikan freq/vpp yang sesuai sumber
- [ ] Bila window terisolasi (mode incognito berbeda / profile berbeda), pakai `postMessage` dengan referensi `window.open()`
