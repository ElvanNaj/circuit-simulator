# PROMPT AGENT — Integrasi Osiloskop Web "Z-DSO 2104" ke Proyek Simulasi Sirkuit

> Salin seluruh teks di bawah garis ini ke agent Anda. Prompt ini self-contained:
> agent tidak perlu membaca file lain untuk berhasil mengintegrasikan.
> Paket: folder standalone (index.html + z-dso.js + z-dso-ui.js + z-dso.css) — tanpa build, tanpa npm.

---

Kamu akan mengintegrasikan **osiloskop digital virtual "Z-DSO 2104"** (aplikasi web standalone yang sudah jadi) dengan **aplikasi simulasi sirkuit** milik saya. Osiloskop berjalan di **window browser dedicated** (terpisah dari aplikasi simulasimu). Tugasmu: menambahkan kode pada proyek simulasi sirkuitku agar ia **mengirim data waveform ke osiloskop** dan **bisa mengendalikan osiloskop** — persis seperti sinyal probe nyata.

## ARSITEKTUR

- Osiloskop adalah halaman statis (`index.html` di folder paket ini). Tidak perlu build, server, atau dependency apa pun.
- Osiloskop mendengarkan perintah lewat **3 transport sekaligus** (semua sudah aktif, tidak perlu setup):
  1. **BroadcastChannel `"osc-bridge"`** ← GUNAKAN INI untuk dua window terpisah (paling sederhana & andal). Syarat: kedua halaman dilayani dari origin yang sama (`http://localhost`). Jalankan `start.py`/`start.sh`/`start.bat` atau server statis apa pun.
  2. `window.postMessage` — jika kamu memegang referensi window scope dari `window.open()` atau iframe. Juga fallback untuk mode `file://`.
  3. `window.OSC` — objek JS global di dalam halaman scope (hanya jika kode berjalan di halaman yang sama / iframe same-origin).
- Halaman scope: `index.html` (window dedicated). Contoh implementasi referensi yang SUDAH berfungsi: buka `sim-demo.html` — halaman simulator RC low-pass yang mengirim Vin/Vout ke scope; buka juga `examples/minimal-integration.html` untuk versi paling minimal. Tiru polanya.

## FORMAT PESAN

Tambahkan flag `__osc: true` pada setiap pesan agar tidak tertukar dengan pesan lain.

```js
// Perintah (sim → scope)
{ __osc: true, id: "uuid-opsional", cmd: "<namaPerintah>", args: [ ... ] }
// Balasan (scope → pengirim; hanya jika `id` diberikan)
{ __osc: true, __oscReply: true, id, ok: true, data: ... }        // sukses
{ __osc: true, __oscReply: true, id, ok: false, error: "..." }    // gagal
// Event broadcast dari scope (tiap perubahan konfigurasi + heartbeat ±1 dtk)
{ __osc: true, __oscEvent: true, event: "state" | "heartbeat" | "data-received", data: ... }
```

## MENGIRIM DATA WAVEFORM (fungsi utama)

```js
const bc = new BroadcastChannel("osc-bridge");
const N = 1200;                       // sampel per frame
let timeDiv = 0.0001;                 // detik/div — sinkronkan dengan scope (lihat bawah)
const win = timeDiv * 10;             // durasi satu layar

function kirimFrame(tNow, vinFloat32, voutFloat32) {
  bc.postMessage({ __osc: true, cmd: "setChannelData", args: [0, vinFloat32,
    { sampleRate: (N - 1) / win, tStart: tNow - win, align: "none" }] });
  bc.postMessage({ __osc: true, cmd: "setChannelData", args: [1, voutFloat32,
    { sampleRate: (N - 1) / win, tStart: tNow - win, align: "none" }] });
}
// panggil ±30×/detik dari loop simulasimu. Float32Array, JANGAN Array biasa.
```

Aturan `setChannelData(ch, samples, meta)`:
- `ch` indeks 0–3 = CH1–CH4. Pengiriman otomatis menyalakan channel & mematikan generator internal channel tsb.
- `meta.sampleRate` (sampel/detik), `meta.tStart` (waktu sampel pertama, detik), `meta.align`:
  - `"none"` (default): buffer = **tepat satu window layar**, ditampilkan apa adanya. ← pakai ini untuk streaming real-time.
  - `"trigger"`: scope mencari crossing trigger di dalam buffer lalu meng-align-nya.
  - `"center"`: buffer dipasang di tengah window.
- **PENTING — sinkronisasi window**: kirim `setHorizontal` dengan `timeDiv` pilihanmu, lalu buat panjang buffer-mu persis `win = timeDiv*10` detik (`sampleRate = (N-1)/win`). Jika buffer lebih pendek dari window, sisa layar menampilkan nilai ujung buffer (datar).
- `clearChannelData(ch)` mengembalikan channel ke generator internal.

## DAFTAR PERINTAH (semua via format pesan di atas; `{"cmd":"help","args":[]}` mencetak daftar ini dari scope)

- **Data**: `setChannelData(ch, samples, meta?)` · `clearChannelData(ch)`
- **Vertikal**: `setChannel(ch, {enabled?, voltsDiv?, offset?, coupling?: "DC"|"AC"|"GND", invert?, bwLimit?, probe?: 1|10})`
- **Generator internal** (untuk demo/test tanpa sim): `setGenerator(ch, {type?: "sine"|"square"|"triangle"|"sawtooth"|"pulse"|"dc"|"noise"|"am"|"off", freq?, amp?, offset?, duty?, phase?, noise?})`
- **Horizontal**: `setHorizontal({timeDiv?, hOffset?, trigPos?})` — timeDiv otomatis di-snap ke deret 1-2-5 (satuan detik/div)
- **Trigger**: `setTrigger({source?: 0..3, level?, edge?: "rising"|"falling", sweep?: "auto"|"normal"|"single"})`
- **Tampilan**: `setDisplay({persistence?, dots?, grid?: "full"|"half"|"none", intensity?, xy?, fft?, fftSource?})`
- **Akuisisi**: `setAcquisition({mode?: "sample"|"peak"|"average", avgCount?})` · `run()` · `stop()` · `single()` · `forceTrigger()` · `autoSet()`
- **Math & kursor**: `setMath({enabled?, op?: "A+B"|"A-B"|"A*B"})` · `setCursors({enabled?, hA?, hB?, vA?, vB?, active?: "a"|"b"})`
- **Lain-lain**: `setPower(bool)` · `getChannel(ch)` · `getGenerator(ch)` · `getMeasurements(ch?)` · `getState()` · `help()`
- Satuan: **volt** dan **detik**; frekuensi Hz. `ch` 0–3.
- `getMeasurements()` mengembalikan per channel: `vpp, vmax, vmin, vamp, vavg, vrms, freq, period, duty, rise, fall, valid` — gunakan untuk verifikasi bahwa sinyal yang sampai benar.

## POLA KONEKSI YANG DIANJURKAN

1. Dari aplikasi simulasimu: `const scopeWin = window.open("scope/index.html", "z-dso", "width=1290,height=1000");` (sesuaikan path relatif tempat folder paket ini diekstrak).
2. Sambungkan `const bc = new BroadcastChannel("osc-bridge");` (bila keduanya dilayani via http://localhost — jalankan `start.py` dari folder paket bila perlu).
3. Tunggu event `heartbeat` (±1 dtk) pada `bc.onmessage` → tanda scope hidup & terhubung. Tampilkan indikator status di UI sim.
4. Kirim konfigurasi awal (`setHorizontal`, `setChannel`, `setTrigger`), lalu stream `setChannelData` tiap frame.
5. Untuk membaca hasil (request/response), sertakan `id` unik dan tunggu balasan `__oscReply` dengan `id` yang sama.
6. Fallback bila BroadcastChannel tidak sampai (mode `file://`, window beda profile/incognito): kirim perintah yang sama via `scopeWin.postMessage({...}, "*")` — scope membalas ke `event.source`.

## ATURAN PENTING

- JANGAN mengubah file osiloskop (`z-dso.js`, `z-dso-ui.js`, `z-dso.css`, `index.html`) — anggap instrumen hitung (black box). Semua integrasi cukup lewat pesan.
- Satu frame sim = satu pasang panggilan `setChannelData` (per channel). Jangan kirim lebih cepat dari 60 fps.
- Selalu kirim `Float32Array`. Buffer minimum 2 sampel.
- Trigger level default 0 V; untuk sinyal ber-offset, set `setTrigger({level})` ke tengah amplitude sinyal, atau gunakan `autoSet()`.
- Kursor & pengukuran otomatis berjalan sendiri — tidak perlu dikonfigurasi.
- Jika proyekmu Next.js/React dan kamu ingin instrumen sebagai komponen (bukan window terpisah), folder `react-nextjs-source/` berisi versi komponen yang sama — tapi pola window+BroadcastChannel TETAP yang direkomendasikan.

## VERIFIKASI WAJIB (lakukan berurutan, laporkan hasilnya)

1. Buka scope di window dedicated (jalankan `start.py` atau buka `index.html`); pastikan trace demo default (CH1 sine 1 kHz, CH2 square) tampil.
2. Dari kode simulasimu, kirim sinyal uji sederhana (sine 1 kHz 2 Vpp ke CH1) selama 3 detik → pastikan trace berubah sesuai.
3. Jalankan `getMeasurements` → pastikan `freq ≈ 1000` dan `vpp ≈ 2.0` (toleransi ±3%).
4. Uji kendali: `stop()`, `run()`, `autoSet()`, ganti `timeDiv` → layar scope merespons.
5. Lepas kirim data & panggil `clearChannelData(0..3)` saat menutup sim agar scope kembali ke demo internal.

Jika ada langkah yang gagal, cetak balasan error dari scope (`error` field) dan perbaiki parameter perintahmu — scope mengirim pesan kesalahan yang jelas (mis. `channel index 5 out of range 0..3`).
