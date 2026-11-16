CIRCUIT SIMULATOR (Rust/WASM engine) — LOCAL ONE-CLICK PACKAGE
==============================================================

WHAT IS THIS?
  A fully offline build of the CircuitSim app — a Falstad-style
  circuit simulator with a Rust compiled to WebAssembly engine
  (Modified Nodal Analysis + LU factorization + Newton-Raphson).
  No internet connection is needed. Circuits are saved
  automatically in your browser (localStorage).

QUICK START
  1) Install Node.js 20 LTS or newer  (one time only):
        https://nodejs.org
  2) Double-click the launcher for your system:
        Windows :  Start Circuit Simulator.bat
        macOS   :  Start Circuit Simulator.command
        Linux   :  start.sh
  3) Your browser opens http://localhost:3000 — done!

  A browser window opens automatically ~3 seconds after the
  server starts. If it does not, open the URL manually.

STOPPING
  Close the launcher window, or press Ctrl+C inside it.

CHANGE PORT
  If port 3000 is already in use:
    Windows   : edit the line  set PORT=3000  inside the .bat
    macOS/Lin : run  PORT=3001 ./start.sh

MACOS GATEKEEPER
  If macOS refuses to open the .command file: right-click it
  and choose "Open", or run once in Terminal:
     chmod +x "Start Circuit Simulator.command"

TROUBLESHOOTING
  - "Node.js is not installed"  -> install from https://nodejs.org
  - Port already in use         -> change PORT (see above)
  - Antivirus/firewall prompt   -> the server binds to 127.0.0.1
                                   (localhost only). Nothing is
                                   accessible from the network.

CONTENTS
  server.js, .next/, node_modules/, public/   the offline app
  source/                                     full source code
      run-dev.bat / run-dev.sh                dev mode with hot
      reload (first run runs "npm install" automatically; the
      WASM engine binary is already included in source/public/)

KEYBOARD & MOUSE (same spirit as Falstad)
  - Press P for the quick component search: type a name
    (res, cap, gnd, npn …), Enter, then click the canvas
  - Press ? to see every shortcut
  - Press [ to collapse/expand the component sidebar
  - Drag from a component post to draw a wire
  - Drag on empty canvas = rubber-band selection
  - Double-click an element (or Enter) to edit its values
  - Ctrl+D duplicate, R rotate, F fit view
  - Delete / Backspace removes the selection
  - Ctrl+Z undo, Ctrl+Shift+Z (or Ctrl+Y) redo
  - Mouse wheel zoom, middle-drag / Alt+drag pan
  - Save file / Open file export and import .circuit.json
    (Ctrl+S / Ctrl+O, or drop a file onto the canvas)

EXTERNAL OSCILLOSCOPE (Z-DSO 2104)
  - Click "Z-DSO" in the toolbar -> "Open oscilloscope".
  - A dedicated 4-channel scope window opens and mirrors the
    channels selected with "+ View in Scope" (max 4).
  - The same menu controls Run, Stop, Auto set, Time/div
    (20 us - 5 ms), Voltage/Current signal, a 1 kHz 2 Vpp
    test sine, and "Clear channels" (restore demo generators).
  - Closing/leaving the simulator clears all scope channels.
  - If the window does not open, allow popups for localhost:3000.

EXTERNAL MULTIMETER (Z-AVO 800)
  - Click "Z-AVO" in the toolbar -> "Open multimeter".
  - This opens a separate Sanwa CD800a-style meter window. Use its
    rotary selector for DCV, ACV, DCA, ACA, Ohm, Continuity, Diode,
    Capacitance, Hz, or Duty.
  - The red and black probes are normal components: press P and
    search "red probe" / "black probe" (or use the Z-AVO menu),
    then click a post or wire. A probe snaps to the nearest
    connection; drag its handle to move it. Red = V/Ohm/Hz,
    black = COM.
  - The live reading appears on the meter's LCD and in the Z-AVO
    toolbar menu. The menu can also change mode, hold/rel, power,
    and pause/resume the measurement stream (pause returns the
    meter to its internal demo).
  - Continuity beeps when the probes are shorted (<50 ohm).
  - Removing either probe, closing the simulator, or pausing the
    stream detaches both probes so the meter returns to demo mode.
  - If the window does not open, allow popups for localhost:3000.


================================================================
 PANDUAN SINGKAT (Bahasa Indonesia)
================================================================

APAKAH INI?
  Versi offline penuh dari aplikasi CircuitSim — simulator
  rangkaian bergaya Falstad dengan engine Rust→WebAssembly
  (Modified Nodal Analysis + LU + Newton-Raphson). Tidak butuh
  internet. Rangkaian tersimpan otomatis di browser Anda.

CARA PAKAI
  1) Pasang Node.js 20 LTS dari https://nodejs.org (sekali saja)
  2) Klik dua kali launcher sesuai sistem:
        Windows :  Start Circuit Simulator.bat
        macOS   :  Start Circuit Simulator.command
        Linux   :  start.sh
  3) Browser terbuka otomatis di http://localhost:3000 — selesai!

CATATAN
  - Untuk menghentikan server: tutup jendela launcher (atau Ctrl+C).
  - Jika port 3000 terpakai: ubah nilai PORT di dalam script.
  - Server hanya berjalan di 127.0.0.1 (lokal), tidak diakses
    dari jaringan luar.
  - Tombol Save file / Open file menyimpan dan membuka rangkaian
    sebagai file .circuit.json (Ctrl+S / Ctrl+O, atau drop file
    ke kanvas). Rangkaian tetap tersimpan otomatis di browser.
  - Tekan P untuk pencarian komponen cepat: ketik nama
    (res, cap, gnd, npn …), Enter, lalu klik kanvas untuk
    menaruhnya. Tekan ? untuk daftar lengkap shortcut.
  - Tekan [ untuk menciutkan/membuka sidebar komponen.
  - Pintasan lain: Ctrl+D duplikat, R putar 90°, F pas-kan
    tampilan, Enter edit nilai, Ctrl+Shift+Z / Ctrl+Y redo.
  - Osiloskop eksternal: klik "Z-DSO" di toolbar lalu
    "Open oscilloscope". Jendela scope 4 channel akan mengikuti
    channel yang dipilih lewat "+ View in Scope" (maks 4).
    Menu yang sama mengatur Run, Stop, Auto set, Time/div
    (20 us - 5 ms), sinyal Voltage/Current, sinyal uji
    1 kHz 2 Vpp, dan "Clear channels" (kembali ke demo).
    Menutup/meninggalkan simulator otomatis membersihkan
    semua channel scope. Izinkan popup untuk localhost:3000
    bila jendela scope tidak terbuka.
  - Multimeter eksternal: klik "Z-AVO" di toolbar lalu
    "Open multimeter". Jendela multimeter gaya Sanwa CD800a
    terbuka terpisah; putar selector-nya untuk DCV, ACV, DCA,
    ACA, Ohm, Continuity, Diode, Capacitance, Hz, atau Duty.
  - Probe merah/hitam adalah komponen biasa: tekan P lalu cari
    "red probe" / "black probe" (atau lewat menu Z-AVO), klik
    post atau kabel. Ujung probe menempel otomatis ke koneksi
    terdekat; geser handle-nya untuk memindahkan. Merah =
    V/Ohm/Hz, hitam = COM.
  - Nilai pengukuran tampil live di LCD meter dan di menu
    toolbar Z-AVO. Menu itu juga bisa ganti mode, hold/rel,
    power, serta pause/resume aliran pengukuran (pause
    mengembalikan meter ke demo internal).
  - Continuity berbunyi saat probe dihubung-singkat (<50 ohm).
  - Menghapus salah satu probe, menutup simulator, atau
    mem-pause aliran akan melepas kedua probe sehingga meter
    kembali ke mode demo.
  - Izinkan popup untuk localhost:3000 bila jendela meter
    tidak terbuka.
  - Folder source/ berisi kode lengkap. Mode pengembangan:
    jalankan run-dev.bat (Windows) atau run-dev.sh (Mac/Linux) —
    npm install berjalan otomatis saat pertama kali.
