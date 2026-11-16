# Z-AVO 800 — AVOmeter Digital Virtual (Paket Standalone)

AVOmeter digital virtual bergaya instrumen nyata: tampilan 1:1 meniru
**Sanwa CD800a** (warna kuning Sanwa, panel hitam, rotary selector, 4 jack
input, tombol POWER/HOLD/RANGE/REL/SELECT). Probe ditaruh manual pada
schematic simulator seperti menaruh komponen biasa, lalu simulator
mengirim pengukuran ke AVOmeter lewat API JavaScript.

**Tidak butuh install apa pun.** Tidak ada `npm install`, tidak ada build.

---

## Cara menjalankan lokal

### Opsi A — klik dua kali `index.html` (paling cepat)
Buka `index.html` langsung di browser (Chrome/Edge/Firefox). Instrumen lengkap
jalan, API `window.AVO` aktif, dan API Console (tombol kanan-bawah) bisa
dipakai.

> Catatan mode `file://`: halaman AVOmeter berfungsi penuh, tetapi komunikasi
> antar-window memakai `window.postMessage` (otomatis — tombol **Buka AVOmeter**
> di `sim-demo.html` sudah menangani ini). Agar `BroadcastChannel` jalan, pakai
> Opsi B.

### Opsi B — server lokal 1 perintah (mode 2-window penuh)
```bash
# Linux / macOS
./start.sh
# Windows
start.bat
# atau langsung:
python3 start.py            # port lain: python3 start.py 9000
```
Lalu terbuka `http://127.0.0.1:8124/index.html` (AVOmeter) dan
`http://127.0.0.1:8124/sim-demo.html` (simulator sirkuit demo — voltage divider).
Mode ini mendukung `BroadcastChannel("avo-bridge")` — jalur integrasi yang
paling andal.

### Opsi C — taruh di project Anda (iframe / window)
Ekstrak folder ini di dalam project Anda (mis. `public/avo/` atau `static/avo/`),
lalu buka lewat `window.open('avo/index.html', 'z-avo', 'width=720,height=900')`
atau embed `<iframe src="avo/index.html">`. Semua transport tetap aktif.

---

## Isi paket

| File | Fungsi |
|---|---|
| `index.html` | AVOmeter (buka di window dedicated) |
| `sim-demo.html` | Simulator voltage divider dengan probe merah/hitam — **contoh integrasi yang sudah berfungsi** |
| `z-avo.js` | Engine instrumen (murni JS, UI-independent, full command API) |
| `z-avo-ui.js` | UI front panel + API console + sim demo (vanilla JS) |
| `z-avo.css` | Gaya tampilan instrumen (warna Sanwa CD800a 1:1) |
| `examples/minimal-integration.html` | Contoh integrasi paling kecil (~30 baris JS) |
| `AGENT_PROMPT.md` | **Prompt siap-jalankan untuk AI agent** (integrasi ke project Anda) |
| `INTEGRATION.md` | Referensi API lengkap (format pesan, daftar perintah, contoh) |
| `start.py` / `start.sh` / `start.bat` | Launcher server lokal |

---

## 3 transport API (semuanya aktif bersamaan)

1. **`BroadcastChannel("avo-bridge")`** — kendalikan AVOmeter dari window/tab lain (rekomendasi utama).
2. **`window.postMessage`** — jika Anda memegang referensi window dari `window.open()` / iframe.
3. **`window.AVO`** — objek global di halaman AVOmeter; panggil method langsung dari DevTools/konsol.

Contoh 10 detik (jalankan di console halaman `sim-demo.html`, atau dari kode Anda):
```js
const bc = new BroadcastChannel("avo-bridge");
bc.postMessage({ __avo: true, cmd: "setMode", args: ["DCV"] });
bc.postMessage({ __avo: true, cmd: "setMeasurement",
  args: [{ type: "voltage", samples: new Float32Array([4.5,4.5,4.5,4.5]), sampleRate: 1000, scalar: 4.5, probes: { red: "nA", black: "nB" } }] });
```

## Integrasi dengan project simulasi sirkuit Anda

Buka `AGENT_PROMPT.md` → salin seluruh isinya ke AI agent Anda (Claude, Cursor,
dll). Prompt itu self-contained: agent tidak perlu membaca file lain untuk
berhasil menyambungkan simulator sirkuit Anda ke AVOmeter ini.

## Verifikasi cepat (30 detik)

1. Buka `index.html` → LCD menyala hijau, mode default DCV, pembacaan demo
   ~1.5 V (karena belum ada input eksternal).
2. Putar **rotary selector** (klik label sekitar knob, drag knob, atau scroll)
   → mode berubah (DCV/ACV/Ω/CONT/DIODE/CAP/Hz/DUTY/DCA/ACA/OFF).
3. Buka API Console (kanan bawah) → klik contoh `setMode("OHM")` → LCD
   menampilkan ~470 Ω (demo internal).
4. Buka `sim-demo.html` → atur V supply, R1, R2 → klik **Buka AVOmeter ↗** →
   AVOmeter menampilkan V(nA) − V(nB) sesuai pilihan probe.
5. Geser slider V supply → pembacaan di LCD ikut berubah real-time.
