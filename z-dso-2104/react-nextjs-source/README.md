# Versi React / Next.js (opsional)

Folder ini berisi **instrumen yang sama** dalam bentuk komponen React (dipakai
oleh proyek Next.js aslinya). Gunakan ini HANYA bila Anda ingin menaruh
osiloskop langsung sebagai komponen di aplikasi Next.js — untuk integrasi
antara-window, pakai versi standalone di folder induk (`index.html` +
`BroadcastChannel`), yang lebih sederhana dan bebas build.

## Struktur

```
lib/osc/
  types.ts      — konstanta & tipe (VOLT_STEPS, TIME_STEPS, dll.)
  engine.ts     — engine instrumen (pure TypeScript, UI-independent)
components/osc/
  Oscilloscope.tsx — front panel + API console (client component)
  Screen.tsx       — layar CRT canvas (trace, kursor, FFT, XY)
  Knob.tsx         — knob putar (drag / wheel / keyboard)
  PanelButton.tsx  — tombol panel dengan LED
  ScopeApp.tsx     — switcher route: '/' scope, '/?view=sim' sim demo
  SimDemo.tsx      — simulator RC low-pass (contoh integrasi)
  osc.css          — gaya tampilan
```

## Cara pakai di proyek Next.js (App Router)

1. Salin `lib/osc/` ke `src/lib/osc/` dan `components/osc/` ke `src/components/osc/`.
2. Buat halaman:

```tsx
// src/app/page.tsx
import { Suspense } from 'react';
import ScopeApp from '@/components/osc/ScopeApp';

export default function Home() {
  return (
    <Suspense fallback={<div style={{ minHeight: '100vh', background: '#0b0d10' }} />}>
      <ScopeApp />
    </Suspense>
  );
}
```

3. Tidak ada dependency tambahan — hanya React. Tailwind tidak wajib.
4. Setelah halaman dibuka, `window.OSC` tersedia dan transport
   `postMessage` + `BroadcastChannel("osc-bridge")` aktif — API-nya identik
   dengan versi standalone (lihat `../INTEGRATION.md`).

API engine: `new OscEngine()`, `handleCommand(cmd, args)`, `getState()`,
`on('state'|'heartbeat'|...)`. Semua perintah sama persis dengan tabel di
`INTEGRATION.md`.
