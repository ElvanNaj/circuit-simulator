# CircuitSim

An interactive, browser-based circuit simulator in the style of [Falstad Circuit Simulator](https://github.com/pfalstad/circuitjs1),
built with a **Rust → WebAssembly engine** and a **Next.js + React** frontend.

![engine](https://img.shields.io/badge/engine-Rust%20%E2%86%92%20WASM-dea584)
![frontend](https://img.shields.io/badge/frontend-Next.js%2016%20%2B%20React%2019-151513)

![CircuitSim](source/public/icon.svg)

## Features

- **37 component types** (41 palette entries): passives, sources, probes, active devices, logic gates, ADC/DAC, transformers, spark gaps.
- **MNA engine** — LU factorization (Crout with partial pivoting), Newton–Raphson with voltage limiting, trapezoidal companion models for C and L.
- **UI themes** — dark (default), light, and pink, including canvas colours.
- **Built-in 4-channel oscilloscope** plus external instrument integration:
  - **Z-DSO 2104** — 4-channel oscilloscope in a dedicated window (`BroadcastChannel`).
  - **Z-AVO 800** — Sanwa CD800a-style multimeter, with red/black probes as regular circuit components (11 modes).
- **Interaction**: select, rubber-band selection, drag, pan, zoom, inline value editing, undo/redo, rotate, duplicate.
- **Quick add (P)**, shortcut cheat-sheet (**?**), collapsible sidebar (**[**), 9 circuit presets.
- **Persistence**: `localStorage` autosave + `.circuit.json` export/import (Ctrl+S / Ctrl+O, drag-and-drop).

## Running

Requires **Node.js 20 LTS** or newer.

### Quick start (launcher)

| Platform | Command |
|---|---|
| Linux / macOS | `./start.sh` |
| macOS | double-click `Start Circuit Simulator.command` |
| Windows | double-click `Start Circuit Simulator.bat` |

The launcher uses an existing build. If none is found, it runs `npm install` + `npm run build`
inside `source/` once, then opens `http://localhost:3000`.

### Development mode

```bash
cd source
npm install
npm run dev          # http://localhost:3000
```

### Standalone build

```bash
cd source
npm run build        # produces .next/standalone/
node .next/standalone/server.js
```

## Repository Layout

```
start.sh, *.bat, *.command   # local launchers
source/                      # Next.js app + Rust engine
  engine/                    # Rust crate (MNA solver)
  public/wasm/               # circuit_engine.wasm (prebuilt binary)
  src/lib/circuit/           # engine wrapper, renderer, presets, file format
  src/components/sim/        # simulator UI
  docs/                      # technical documentation
  scripts/                   # headless engine and probe tests
z-avo-800/                   # Z-AVO 800 instrument package (standalone, black box)
z-dso-2104/                  # Z-DSO 2104 instrument package (standalone, black box)
```

Full documentation: [`source/README.md`](source/README.md) and [`source/docs/`](source/docs).

## Build Notes

This repository does **not** ship build artifacts. `node_modules/`, `.next/`, `target/`,
`server.js`, and `.env` are ignored (see [`.gitignore`](.gitignore)) and are recreated by the
commands above. The engine binary `source/public/wasm/circuit_engine.wasm` is included, so the
app runs without a Rust toolchain.

## Credits

Reverse-engineered from [circuitjs1](https://github.com/pfalstad/circuitjs1) by Paul Falstad —
rewritten from scratch in Rust, not a code fork.
