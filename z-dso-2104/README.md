# Z-DSO 2104 — Osiloskop Virtual 4-Kanal (Paket Standalone)

Osiloskop digital virtual bergaya instrumen nyata: 4 kanal, generator sinyal internal,
trigger, FFT, XY mode, kursor, pengukuran otomatis, persistence — **semua kontrol
(front panel) bisa dikendalikan lewat API JavaScript**.

**Tidak butuh install apa pun.** Tidak ada `npm install`, tidak ada build.

---

## Cara menjalankan lokal

### Opsi A — klik dua kali `index.html` (paling cepat)
Buka `index.html` langsung di browser (Chrome/Edge/Firefox). Instrumen lengkap jalan,
API `window.OSC` aktif, dan API Console (tombol kanan-bawah) bisa dipakai.

> Catatan mode `file://`: halaman scope berfungsi penuh, tetapi komunikasi antar-window
> memakai `window.postMessage` (otomatis — tombol **Buka Osiloskop** di `sim-demo.html`
> sudah menangani ini). Agar `BroadcastChannel` jalan, pakai Opsi B.

### Opsi B — server lokal 1 perintah (mode 2-window penuh)
```bash
# Linux / macOS
./start.sh
# Windows
start.bat
# atau langsung:
python3 start.py            # port lain: python3 start.py 9000
```
Lalu terbuka `http://127.0.0.1:8123/index.html` (osiloskop) dan
`http://127.0.0.1:8123/sim-demo.html` (simulator sirkuit demo). Mode ini
mendukung `BroadcastChannel("osc-bridge")` — jalur integrasi yang paling andal.

### Opsi C — taruh di project Anda (iframe / window)
Ekstrak folder ini di dalam project Anda (mis. `public/scope/` atau `static/scope/`),
lalu buka lewat `window.open('scope/index.html', 'z-dso', 'width=1290,height=1000')`
atau embed `<iframe src="scope/index.html">`. Semua transport tetap aktif.

---

## Isi paket

| File | Fungsi |
|---|---|
| `index.html` | Osiloskop (buka di window dedicated) |
| `sim-demo.html` | Simulator sirkuit RC low-pass — **contoh integrasi yang sudah berfungsi** |
| `z-dso.js` | Engine instrumen (murni JS, UI-independent, full command API) |
| `z-dso-ui.js` | UI front panel + API console + sim demo (vanilla JS) |
| `z-dso.css` | Gaya tampilan instrumen |
| `examples/minimal-integration.html` | Contoh integrasi paling kecil (±40 baris JS) |
| `AGENT_PROMPT.md` | **Prompt siap-jalankan untuk AI agent** (integrasi ke project Anda) |
| `INTEGRATION.md` | Referensi API lengkap (format pesan, daftar perintah, contoh) |
| `start.py` / `start.sh` / `start.bat` | Launcher server lokal |
| `react-nextjs-source/` | Versi komponen React/Next.js dari instrumen yang sama (opsional) |

---

## 3 transport API (semuanya aktif bersamaan)

1. **`BroadcastChannel("osc-bridge")`** — kendalikan scope dari window/tab lain (rekomendasi utama).
2. **`window.postMessage`** — jika Anda memegang referensi window dari `window.open()` / iframe.
3. **`window.OSC`** — objek global di halaman scope; panggil method langsung dari DevTools/konsol.

Contoh 10 detik (jalankan di console halaman `sim-demo.html`, atau dari kode Anda):
```js
const bc = new BroadcastChannel("osc-bridge");
bc.postMessage({ __osc: true, cmd: "setGenerator", args: [0, { type: "sine", freq: 1000, amp: 1 }] });
bc.postMessage({ __osc: true, cmd: "autoSet", args: [] });
```

## Integrasi dengan project simulasi sirkuit Anda

Buka `AGENT_PROMPT.md` → salin seluruh isinya ke AI agent Anda (Claude, Cursor, dll).
Prompt itu self-contained: agent tidak perlu membaca file lain untuk berhasil
menyambungkan simulator sirkuit Anda ke osiloskop ini.

## Verifikasi cepat (30 detik)

1. Buka `index.html` → dua trace tampil (CH1 sine 1 kHz kuning, CH2 square cyan).
2. Klik **RUN/STOP** → trace berhenti/jalan; klik **Auto** → tampilan dioptimalkan otomatis.
3. Buka API Console (kanan bawah) → klik contoh `10ms/div` → timebase berubah.
4. Buka `sim-demo.html` → klik **Buka Osiloskop ↗** → Vin/Vout dari simulator tampil di scope.
