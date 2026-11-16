'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { TIME_STEPS, VOLT_STEPS, ceilStep, fmtEng } from '@/lib/osc/types';

/**
 * Reference integration: a small "circuit simulator" (RC low-pass filter,
 * solved analytically) that streams Vin/Vout waveforms into the Z-DSO 2104
 * oscilloscope through a BroadcastChannel bridge.
 *
 * This page is the living documentation for the agent integration prompt:
 * open `/` (the oscilloscope) in another window and watch the traces appear.
 */

const N = 1200; // samples per frame per channel

function waveSample(type: 'sine' | 'square', freq: number, amp: number, t: number): number {
  if (type === 'sine') return amp * Math.sin(2 * Math.PI * freq * t);
  const frac = ((t * freq) % 1 + 1) % 1;
  return amp * (frac < 0.5 ? 1 : -1);
}

/** RC low-pass output for one input sample, computed analytically. */
function rcLowpass(
  type: 'sine' | 'square', freq: number, amp: number, t: number, R: number, C: number
): number {
  const tau = R * C;
  const fc = 1 / (2 * Math.PI * tau);
  if (type === 'sine') {
    const w = 2 * Math.PI * freq;
    const H = 1 / Math.sqrt(1 + (freq / fc) ** 2);
    const phi = -Math.atan(w * tau);
    return amp * H * Math.sin(w * t + phi);
  }
  // square wave: sum odd harmonics through H(jω)
  let out = 0;
  for (let k = 1; k <= 15; k += 2) {
    const fk = freq * k;
    const w = 2 * Math.PI * fk;
    const H = 1 / Math.sqrt(1 + (fk / fc) ** 2);
    const phi = -Math.atan(w * tau);
    out += ((4 / Math.PI) * (amp / k)) * H * Math.sin(w * t + phi);
  }
  return out;
}

export default function SimDemo() {
  const [waveType, setWaveType] = useState<'sine' | 'square'>('sine');
  const [fSlider, setFSlider] = useState(600); // 0..1000 log 1Hz..1MHz
  const [amp, setAmp] = useState(2);
  const [rSlider, setRSlider] = useState(400); // log 100Ω..100kΩ
  const [cSlider, setCSlider] = useState(500); // log 1nF..10µF
  const [streaming, setStreaming] = useState(true);
  const [connected, setConnected] = useState(false);

  const freq = 10 ** (fSlider / 1000 * 6);            // 1 Hz .. 1 MHz
  const R = 10 ** (2 + (rSlider / 1000) * 3);          // 100 Ω .. 100 kΩ
  const C = 10 ** (-9 + (cSlider / 1000) * 4);         // 1 nF .. 10 µF
  const fc = 1 / (2 * Math.PI * R * C);
  const gainDb = -20 * Math.log10(Math.sqrt(1 + (freq / fc) ** 2));
  const phaseDeg = (-Math.atan((2 * Math.PI * freq * R * C)) * 180) / Math.PI;

  const bcRef = useRef<BroadcastChannel | null>(null);
  const winRef = useRef({ dur: 0.01 });
  const stateRef = useRef({ waveType, freq, amp, R, C, streaming });
  stateRef.current = { waveType, freq, amp, R, C, streaming };
  const lastCfg = useRef('');

  const send = useCallback((cmd: string, args: unknown[]) => {
    bcRef.current?.postMessage({ __osc: true, cmd, args });
  }, []);

  const sendConfig = useCallback(() => {
    const s = stateRef.current;
    // pick the quantized scope timebase (~2.5 periods on screen) and make our
    // sample windows match it exactly, so buffers cover the whole screen
    const timeDiv = ceilStep(TIME_STEPS, 2.5 / s.freq / 10);
    winRef.current.dur = timeDiv * 10;
    send('setHorizontal', [{ timeDiv }]);
    const vdiv = ceilStep(VOLT_STEPS, (2 * s.amp) / 4.8);
    send('setChannel', [0, { enabled: true, voltsDiv: vdiv, offset: 0, coupling: 'DC', probe: 1 }]);
    send('setChannel', [1, { enabled: true, voltsDiv: vdiv, offset: 0, coupling: 'DC', probe: 1 }]);
    send('setChannel', [2, { enabled: false }]);
    send('setChannel', [3, { enabled: false }]);
    send('setTrigger', [{ source: 0, level: 0, edge: 'rising', sweep: 'auto' }]);
  }, [send]);

  useEffect(() => {
    const bc = new BroadcastChannel('osc-bridge');
    bcRef.current = bc;
    let alive = true;
    let hbSeen = 0;

    bc.onmessage = (ev: MessageEvent) => {
      const d = ev.data as { __osc?: boolean; __oscEvent?: boolean; event?: string };
      if (d?.__osc && d.__oscEvent && d.event === 'heartbeat') {
        hbSeen = Date.now();
        if (alive) setConnected(true);
      }
    };
    // connection watchdog
    const wd = setInterval(() => {
      if (alive && Date.now() - hbSeen > 2500) setConnected(false);
    }, 1000);

    // acquisition loop (~30 fps)
    let tSim = 0;
    let last = performance.now();
    let frame = 0;
    let raf = 0;
    const vin = new Float32Array(N);
    const vout = new Float32Array(N);

    const loop = (ts: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min((ts - last) / 1000, 0.05);
      last = ts;
      const s = stateRef.current;
      if (!s.streaming) return;

      // re-configure when frequency changes a lot
      const wantWin = 2.5 / s.freq;
      if (Math.abs(wantWin - winRef.current.dur) / wantWin > 0.5) {
        sendConfig();
      }

      tSim += dt;
      const win = winRef.current.dur;
      const rate = (N - 1) / win;
      for (let i = 0; i < N; i++) {
        const t = tSim - win + (i / (N - 1)) * win;
        vin[i] = waveSample(s.waveType, s.freq, s.amp, t);
        vout[i] = rcLowpass(s.waveType, s.freq, s.amp, t, s.R, s.C);
      }
      if (frame++ % 2 === 0) { // ~30 fps
        send('setChannelData', [0, vin, { sampleRate: rate, tStart: tSim - win, align: 'none' }]);
        send('setChannelData', [1, vout, { sampleRate: rate, tStart: tSim - win, align: 'none' }]);
      }
    };
    raf = requestAnimationFrame(loop);

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      clearInterval(wd);
      bc.close();
      bcRef.current = null;
    };
  }, [send, sendConfig]);

  // push config whenever parameters change
  useEffect(() => {
    const key = `${waveType}|${freq.toPrecision(4)}|${amp}|${R.toPrecision(4)}|${C.toPrecision(4)}`;
    if (key !== lastCfg.current) {
      lastCfg.current = key;
      sendConfig();
    }
  }, [waveType, freq, amp, R, C, sendConfig]);

  const openScope = () => window.open('/', 'z-dso', 'width=1290,height=1000');

  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(1000px 500px at 50% -80px, #1d232b 0%, #101418 55%, #0a0d10 100%)',
      color: '#d7dee6',
      fontFamily: 'var(--font-geist-sans), Arial, sans-serif',
      padding: '28px 18px 60px',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 22,
    }}>
      <header style={{ textAlign: 'center' }}>
        <h1 style={{ fontSize: 22, margin: 0, letterSpacing: 0.5 }}>
          Simulator Sirkuit Demo — <span style={{ color: '#f5c518' }}>RC Low-Pass Filter</span>
        </h1>
        <p style={{ fontSize: 13, color: '#8f97a1', marginTop: 6 }}>
          Referensi integrasi: halaman ini mensimulasikan sirkuit dan mengirim Vin/Vout ke osiloskop
          Z-DSO 2104 lewat <code style={{ color: '#7ec8ff' }}>BroadcastChannel(&quot;osc-bridge&quot;)</code>.
        </p>
      </header>

      <div style={{
        display: 'flex', gap: 18, flexWrap: 'wrap', justifyContent: 'center',
        width: '100%', maxWidth: 1080,
      }}>
        {/* circuit card */}
        <div style={{
          flex: '1 1 380px', background: '#15191f', border: '1px solid #262c34',
          borderRadius: 14, padding: 18,
        }}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: '#8f97a1', marginBottom: 10, textTransform: 'uppercase' }}>Sirkuit</div>
          <svg viewBox="0 0 340 190" style={{ width: '100%' }}>
            {/* wires */}
            <path d="M30 95 H80" stroke="#7ec8ff" strokeWidth="2" fill="none" />
            <path d="M130 95 H180" stroke="#48e07a" strokeWidth="2" fill="none" />
            <path d="M240 95 H300" stroke="#48e07a" strokeWidth="2" fill="none" />
            <path d="M180 95 V150 M180 150 H235" stroke="#5c6570" strokeWidth="2" fill="none" />
            {/* source */}
            <circle cx="55" cy="95" r="22" stroke="#7ec8ff" strokeWidth="2" fill="#0d1014" />
            <path d="M43 95 q6 -10 12 0 q6 10 12 0" stroke="#7ec8ff" strokeWidth="2" fill="none" />
            <text x="40" y="135" fill="#7ec8ff" fontSize="11">Vin</text>
            {/* resistor */}
            <path d="M80 95 l6 -10 l10 20 l10 -20 l10 20 l10 -20 l4 10" stroke="#f5c518" strokeWidth="2" fill="none" />
            <text x="92" y="70" fill="#f5c518" fontSize="11">R = {fmtEng(R, 'Ω', 1)}</text>
            {/* capacitor */}
            <path d="M235 138 v-14 M265 138 v-14" stroke="#ea5be0" strokeWidth="3" />
            <path d="M235 124 h30 M235 152 h30" stroke="#ea5be0" strokeWidth="2" />
            <path d="M250 152 v12 M238 164 h24 M243 170 h14 M248 176 h4" stroke="#5c6570" strokeWidth="2" />
            <text x="272" y="132" fill="#ea5be0" fontSize="11">C = {fmtEng(C, 'F', 1)}</text>
            {/* output */}
            <circle cx="300" cy="95" r="5" fill="#48e07a" />
            <text x="288" y="78" fill="#48e07a" fontSize="11">Vout</text>
            <text x="12" y="180" fill="#5c6570" fontSize="10">fc = {fmtEng(fc, 'Hz', 2)}</text>
          </svg>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 6, fontSize: 12 }}>
            <span>fc: <b style={{ color: '#f5c518' }}>{fmtEng(fc, 'Hz', 2)}</b></span>
            <span>|H(f)|: <b style={{ color: '#48e07a' }}>{gainDb.toFixed(1)} dB</b></span>
            <span>φ: <b style={{ color: '#ea5be0' }}>{phaseDeg.toFixed(0)}°</b></span>
          </div>
        </div>

        {/* controls card */}
        <div style={{
          flex: '1 1 380px', background: '#15191f', border: '1px solid #262c34',
          borderRadius: 14, padding: 18,
        }}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: '#8f97a1', marginBottom: 12, textTransform: 'uppercase' }}>Kontrol Sumber</div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            {(['sine', 'square'] as const).map((w) => (
              <button
                key={w}
                type="button"
                onClick={() => setWaveType(w)}
                style={{
                  padding: '7px 18px', borderRadius: 8, cursor: 'pointer', fontSize: 13,
                  border: waveType === w ? '1px solid #f5c518' : '1px solid #2b323b',
                  background: waveType === w ? '#2a2413' : '#1a2027',
                  color: waveType === w ? '#ffe17a' : '#9fb6cc',
                }}
              >
                {w === 'sine' ? 'Sine' : 'Square'}
              </button>
            ))}
          </div>

          {([
            ['Frekuensi', fSlider, setFSlider, fmtEng(freq, 'Hz', 2)],
            ['Amplitudo', Math.round(((amp - 0.1) / 4.9) * 1000), (v: number) => setAmp(0.1 + (v / 1000) * 4.9), `${amp.toFixed(2)} Vpk`],
            ['R', rSlider, setRSlider, fmtEng(R, 'Ω', 1)],
            ['C', cSlider, setCSlider, fmtEng(C, 'F', 1)],
          ] as [string, number, (v: number) => void, string][]).map(([label, val, set, disp]) => (
            <div key={label} style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 4 }}>
                <span>{label}</span><b style={{ color: '#f5c518' }}>{disp}</b>
              </div>
              <input
                type="range"
                min={0}
                max={1000}
                value={val}
                onChange={(e) => set(Number(e.target.value))}
                style={{ width: '100%', accentColor: '#f5c518' }}
                aria-label={label}
              />
            </div>
          ))}

          <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => setStreaming((s) => !s)}
              style={{
                padding: '9px 18px', borderRadius: 8, cursor: 'pointer', fontWeight: 700,
                border: '1px solid #0f5a26',
                background: streaming ? 'linear-gradient(180deg,#58e878,#23b84a)' : '#1a2027',
                color: streaming ? '#052d12' : '#9fb6cc',
              }}
            >
              {streaming ? '■ Stop streaming' : '▶ Start streaming'}
            </button>
            <button
              type="button"
              onClick={openScope}
              style={{
                padding: '9px 18px', borderRadius: 8, cursor: 'pointer',
                border: '1px solid #2b323b', background: '#1a2027', color: '#ffe17a',
              }}
            >
              Buka Osiloskop ↗
            </button>
          </div>

          <div style={{ marginTop: 14, fontSize: 12.5 }}>
            Status osiloskop:{' '}
            <b style={{ color: connected ? '#45e873' : '#f0685f' }}>
              {connected ? 'terhubung ✓ (heartbeat diterima)' : 'belum terdeteksi'}
            </b>
          </div>
        </div>
      </div>

      {/* integration snippet */}
      <div style={{
        width: '100%', maxWidth: 1080, background: '#0d1014', border: '1px solid #262c34',
        borderRadius: 14, padding: 18, fontFamily: 'var(--font-geist-mono), monospace', fontSize: 12,
        lineHeight: 1.7, color: '#9fb6cc', overflowX: 'auto',
      }}>
        <div style={{ color: '#8f97a1', marginBottom: 8 }}>{'// inti integrasi — sama seperti yang dipakai halaman ini:'}</div>
        <div><span style={{ color: '#7ec8ff' }}>const</span> bc = <span style={{ color: '#7ec8ff' }}>new</span> BroadcastChannel(<span style={{ color: '#48e07a' }}>&quot;osc-bridge&quot;</span>);</div>
        <div>bc.postMessage({'{'} __osc: <span style={{ color: '#7ec8ff' }}>true</span>, cmd: <span style={{ color: '#48e07a' }}>&quot;setChannelData&quot;</span>,</div>
        <div>&nbsp;&nbsp;args: [0, vinFloat32Array, {'{'} sampleRate, tStart, align: <span style={{ color: '#48e07a' }}>&quot;none&quot;</span> {'}'}] {'}'});</div>
        <div style={{ color: '#5c6570' }}>{'// kontrol penuh: setGenerator · setChannel · setHorizontal · setTrigger · run/stop/autoSet · getMeasurements …'}</div>
      </div>
    </div>
  );
}
