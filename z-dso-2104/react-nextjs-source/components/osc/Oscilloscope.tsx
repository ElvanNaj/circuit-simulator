'use client';

import './osc.css';
import { useCallback, useEffect, useRef, useState } from 'react';
import { OscEngine } from '@/lib/osc/engine';
import {
  CH_COLORS, CH_NAMES, FREQ_STEPS, TIME_STEPS, VOLT_STEPS,
  fmtEng, nearestStep,
} from '@/lib/osc/types';
import Knob from './Knob';
import PanelButton from './PanelButton';
import Screen from './Screen';

declare global {
  interface Window {
    OSC?: OscEngine;
  }
}

type MenuId = 'ch' | 'trig' | 'acq' | 'disp' | 'cur' | 'gen';
type KnobParam =
  | 'genFreq' | 'genAmp' | 'genOffset' | 'genDuty' | 'genNoise'
  | 'curA_t' | 'curB_t' | 'curA_v' | 'curB_v'
  | 'intensity' | 'trigLevel' | null;

interface SoftKey {
  label: string;
  value?: string;
  on?: boolean;
  arrow?: boolean;
  dim?: boolean;
  press: () => void;
}

const WAVE_CYCLE = ['off', 'sine', 'square', 'triangle', 'sawtooth', 'pulse', 'dc', 'noise', 'am'] as const;
const PERSIST_CYCLE = [0, 0.5, 2, Infinity];

const EXAMPLES: [string, string][] = [
  ['AutoSet', '{"cmd":"autoSet","args":[]}'],
  ['CH2 square 2k', '{"cmd":"setGenerator","args":[1,{"type":"square","freq":2000,"amp":1.5}]}'],
  ['CH3 on', '{"cmd":"setChannel","args":[2,{"enabled":true}]}'],
  ['10ms/div', '{"cmd":"setHorizontal","args":[{"timeDiv":0.01}]}'],
  ['Trig CH2 ↑1V', '{"cmd":"setTrigger","args":[{"source":1,"level":1,"edge":"rising"}]}'],
  ['Persist ∞', '{"cmd":"setDisplay","args":[{"persistence":1e9}]}'],
  ['XY mode', '{"cmd":"setDisplay","args":[{"xy":true}]}'],
  ['FFT', '{"cmd":"setDisplay","args":[{"fft":true}]}'],
  ['Peak detect', '{"cmd":"setAcquisition","args":[{"mode":"peak"}]}'],
  ['Cursors on', '{"cmd":"setCursors","args":[{"enabled":true,"vA":-0.001,"vB":0.001}]}'],
  ['Measurements', '{"cmd":"getMeasurements","args":[]}'],
  ['State', '{"cmd":"getState","args":[]}'],
  ['Help', '{"cmd":"help","args":[]}'],
];

/** Module-level engine singleton (avoids ref access during render). */
let engineSingleton: OscEngine | null = null;
function getEngine(): OscEngine {
  if (!engineSingleton) engineSingleton = new OscEngine();
  return engineSingleton;
}

export default function Oscilloscope() {
  const engine = getEngine();

  const [, setTick] = useState(0);
  const [selected, setSelected] = useState(0);
  const [menu, setMenu] = useState<MenuId>('ch');
  const [knobParam, setKnobParam] = useState<KnobParam>('genFreq');
  const [running, setRunning] = useState(true);
  const [armed, setArmed] = useState(false);
  const [powerOn, setPowerOn] = useState(true);
  const [consoleOpen, setConsoleOpen] = useState(false);
  const [consoleLog, setConsoleLog] = useState<{ cls: string; text: string }[]>(() => [
    { cls: 'ok', text: `Z-DSO 2104 engine v${OscEngine.VERSION} ready` },
    { cls: 'dim', text: 'transports: window.OSC · postMessage · BroadcastChannel("osc-bridge")' },
  ]);
  const [cmdText, setCmdText] = useState('{"cmd":"help","args":[]}');
  const [scale, setScale] = useState(1);
  const [panelH, setPanelH] = useState(760);
  const bcRef = useRef<BroadcastChannel | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const lastDataLog = useRef(0);
  const panelRef = useRef<HTMLDivElement>(null);

  const log = useCallback((text: string, cls = 'dim') => {
    setConsoleLog((l) => {
      const next = l.length > 260 ? l.slice(-200) : l;
      return [...next, { cls, text }];
    });
  }, []);

  const fmtRes = (r: { ok: boolean; data?: unknown; error?: string }) => {
    if (!r.ok) return `✗ ${r.error}`;
    const s = JSON.stringify(r.data);
    return `✓ ${s === undefined ? 'null' : s.length > 400 ? s.slice(0, 400) + '…' : s}`;
  };

  /* ---------------- transports + lifecycle ---------------- */
  useEffect(() => {
    window.OSC = engine;

    const dispatch = (cmd: string, args: unknown[]) => engine.handleCommand(cmd, Array.isArray(args) ? args : []);

    const onMsg = (ev: MessageEvent) => {
      const d = ev.data as { __osc?: boolean; id?: string; cmd?: string; args?: unknown[] };
      if (!d || d.__osc !== true || typeof d.cmd !== 'string') return;
      const res = dispatch(d.cmd, d.args ?? []);
      if (d.id !== undefined && ev.source) {
        (ev.source as Window).postMessage({ __osc: true, __oscReply: true, id: d.id, ...res }, '*');
      }
      if (d.cmd === 'setChannelData') {
        const now = performance.now();
        if (now - lastDataLog.current > 2000) {
          lastDataLog.current = now;
          log(`postMessage ◂ setChannelData CH${((d.args?.[0] as number) ?? 0) + 1} (streaming…)`, 'ev');
        }
      } else {
        log(`postMessage ◂ ${d.cmd} → ${fmtRes(res)}`, res.ok ? 'cmd' : 'err');
      }
    };
    window.addEventListener('message', onMsg);

    const bc = new BroadcastChannel('osc-bridge');
    bcRef.current = bc;
    bc.onmessage = (ev: MessageEvent) => {
      const d = ev.data as { __osc?: boolean; id?: string; cmd?: string; args?: unknown[] };
      if (!d || d.__osc !== true || typeof d.cmd !== 'string') return;
      const res = dispatch(d.cmd, d.args ?? []);
      if (d.id !== undefined) {
        bc.postMessage({ __osc: true, __oscReply: true, id: d.id, ...res });
      }
      if (d.cmd === 'setChannelData') {
        const now = performance.now();
        if (now - lastDataLog.current > 2000) {
          lastDataLog.current = now;
          log(`BC ◂ setChannelData CH${((d.args?.[0] as number) ?? 0) + 1} (streaming…)`, 'ev');
        }
      } else {
        log(`BC ◂ ${d.cmd} → ${fmtRes(res)}`, res.ok ? 'cmd' : 'err');
      }
    };

    // every subscription is tracked so unmount removes it again — stale
    // listeners used to survive remounts (double re-renders / closed channels)
    const subs: [string, (d?: unknown) => void][] = [];
    const sub = (ev: string, cb: (d?: unknown) => void) => { engine.on(ev, cb); subs.push([ev, cb]); };

    // file:// and window.open flows without BroadcastChannel: events must
    // also reach the opener so its connection indicator can react.
    const postToOpener = (event: string, data: unknown) => {
      try {
        const op = window.opener && window.opener !== window ? window.opener : null;
        if (op) op.postMessage({ __osc: true, __oscEvent: true, event, data }, '*');
      } catch { /* cross-origin opener — ignore */ }
    };

    sub('state', (s) => {
      bc.postMessage({ __osc: true, __oscEvent: true, event: 'state', data: s });
      postToOpener('state', s);
      setTick((t) => t + 1);
    });
    sub('heartbeat', (d) => {
      bc.postMessage({ __osc: true, __oscEvent: true, event: 'heartbeat', data: d });
      postToOpener('heartbeat', d);
    });
    sub('data-received', (d) => {
      const { ch, samples } = d as { ch: number; samples: number };
      const now = performance.now();
      if (now - lastDataLog.current > 2000) {
        lastDataLog.current = now;
        log(`◂ data CH${ch + 1} — ${samples} samples buffered`, 'ev');
      }
    });
    sub('single-captured', () => { setRunning(false); setArmed(false); });
    sub('run', () => setRunning(true));
    sub('stopped', () => setRunning(false));
    sub('arm', () => setArmed(true));

    // responsive scaling of the fixed-size panel
    const onResize = () => {
      const app = panelRef.current?.closest('.osc-app') as HTMLElement | null;
      const w = app?.clientWidth ?? window.innerWidth;
      setScale(Math.min(1, w / 1180));
      setPanelH(panelRef.current?.offsetHeight ?? 760);
    };
    onResize();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('message', onMsg);
      window.removeEventListener('resize', onResize);
      subs.forEach(([ev, cb]) => engine.off(ev, cb));
      bc.close();
      bcRef.current = null;
      delete window.OSC;
    };
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [consoleLog, consoleOpen]);

  /* ---------------- knob handlers ---------------- */
  const clampIdx = (i: number, len: number) => Math.max(0, Math.min(len - 1, i));

  const stepVScale = (dir: 1 | -1) => {
    const ch = engine.channels[selected];
    const i = nearestStep(VOLT_STEPS, ch.cfg.voltsDiv);
    engine.setChannel(selected, { voltsDiv: VOLT_STEPS[clampIdx(i + dir, VOLT_STEPS.length)] });
  };
  const stepVPos = (dir: 1 | -1, fine: boolean) => {
    const ch = engine.channels[selected];
    const s = ch.cfg.voltsDiv * (fine ? 0.02 : 0.1);
    engine.setChannel(selected, {
      offset: Math.max(-4 * ch.cfg.voltsDiv, Math.min(4 * ch.cfg.voltsDiv, ch.cfg.offset + dir * s)),
    });
  };
  const stepHScale = (dir: 1 | -1) => {
    const i = nearestStep(TIME_STEPS, engine.time.timeDiv);
    engine.setHorizontal({ timeDiv: TIME_STEPS[clampIdx(i + dir, TIME_STEPS.length)] });
  };
  const stepHPos = (dir: 1 | -1, fine: boolean) => {
    const win = engine.windowDur;
    const s = engine.time.timeDiv * (fine ? 0.02 : 0.1);
    engine.setHorizontal({ hOffset: Math.max(-win * 5, Math.min(win * 5, engine.time.hOffset + dir * s)) });
  };
  const stepLevel = (dir: 1 | -1, fine: boolean) => {
    const src = engine.channels[engine.trig.source];
    const s = src.cfg.voltsDiv * (fine ? 0.02 : 0.1);
    engine.setTrigger({ level: engine.trig.level + dir * s });
  };

  const stepAdjust = (dir: 1 | -1, fine: boolean) => {
    const gen = engine.channels[selected].gen;
    switch (knobParam) {
      case 'genFreq': {
        if (fine) { engine.setGenerator(selected, { freq: Math.max(0.01, Math.min(2e7, gen.freq * (dir > 0 ? 1.02 : 0.98))) }); break; }
        const i = nearestStep(FREQ_STEPS, gen.freq);
        engine.setGenerator(selected, { freq: FREQ_STEPS[clampIdx(i + dir, FREQ_STEPS.length)] });
        break;
      }
      case 'genAmp': {
        const s = fine ? 0.02 : 0.2;
        engine.setGenerator(selected, { amp: Math.max(0, Math.min(10, gen.amp + dir * s)) });
        break;
      }
      case 'genOffset': {
        const s = fine ? 0.02 : 0.1;
        engine.setGenerator(selected, { offset: Math.max(-10, Math.min(10, gen.offset + dir * s)) });
        break;
      }
      case 'genDuty': {
        const s = fine ? 0.01 : 0.05;
        engine.setGenerator(selected, { duty: Math.max(0.02, Math.min(0.98, gen.duty + dir * s)) });
        break;
      }
      case 'genNoise': {
        const s = fine ? 0.01 : 0.05;
        engine.setGenerator(selected, { noise: Math.max(0, Math.min(2, gen.noise + dir * s)) });
        break;
      }
      case 'curA_t':
      case 'curB_t': {
        const d = dir * engine.time.timeDiv * (fine ? 0.05 : 0.25);
        if (knobParam === 'curA_t') engine.setCursors({ vA: engine.cursors.vA + d });
        else engine.setCursors({ vB: engine.cursors.vB + d });
        break;
      }
      case 'curA_v':
      case 'curB_v': {
        const vd = engine.channels[engine.trig.source].cfg.voltsDiv;
        const d = dir * vd * (fine ? 0.05 : 0.25);
        if (knobParam === 'curA_v') engine.setCursors({ hA: engine.cursors.hA + d });
        else engine.setCursors({ hB: engine.cursors.hB + d });
        break;
      }
      case 'intensity':
        engine.setDisplay({ intensity: Math.max(0.15, Math.min(1, engine.display.intensity + dir * (fine ? 0.02 : 0.08))) });
        break;
      case 'trigLevel':
        stepLevel(dir, fine);
        break;
      default:
        break;
    }
  };

  const adjustValue = (): string => {
    const gen = engine.channels[selected].gen;
    switch (knobParam) {
      case 'genFreq': return fmtEng(gen.freq, 'Hz');
      case 'genAmp': return `${gen.amp.toFixed(2)} V`;
      case 'genOffset': return `${gen.offset.toFixed(2)} V`;
      case 'genDuty': return `${(gen.duty * 100).toFixed(0)} %`;
      case 'genNoise': return `${gen.noise.toFixed(2)} V`;
      case 'curA_t': return fmtEng(engine.cursors.vA, 's');
      case 'curB_t': return fmtEng(engine.cursors.vB, 's');
      case 'curA_v': return fmtEng(engine.cursors.hA, 'V');
      case 'curB_v': return fmtEng(engine.cursors.hB, 'V');
      case 'intensity': return `${(engine.display.intensity * 100).toFixed(0)} %`;
      case 'trigLevel': return fmtEng(engine.trig.level, 'V');
      default: return '—';
    }
  };

  /* ---------------- soft menus ---------------- */
  const cyc = <T,>(arr: readonly T[], cur: T): T => arr[(arr.indexOf(cur) + 1) % arr.length];

  const buildMenu = (): SoftKey[] => {
    const ch = engine.channels[selected];
    const gen = ch.gen;
    switch (menu) {
      case 'ch':
        return [
          { label: 'Coupling', value: ch.cfg.coupling, press: () => engine.setChannel(selected, { coupling: cyc(['DC', 'AC', 'GND'] as const, ch.cfg.coupling) }) },
          { label: 'Invert', value: ch.cfg.invert ? 'On' : 'Off', on: ch.cfg.invert, press: () => engine.setChannel(selected, { invert: !ch.cfg.invert }) },
          { label: 'BW Limit', value: ch.cfg.bwLimit ? '20M' : 'Off', on: ch.cfg.bwLimit, press: () => engine.setChannel(selected, { bwLimit: !ch.cfg.bwLimit }) },
          { label: 'Probe', value: `${ch.cfg.probe}X`, press: () => engine.setChannel(selected, { probe: ch.cfg.probe === 1 ? 10 : 1 }) },
          { label: 'Demo Gen', arrow: true, press: () => setMenu('gen') },
        ];
      case 'gen':
        return [
          { label: 'Type', value: gen.type, press: () => engine.setGenerator(selected, { type: cyc(WAVE_CYCLE, gen.type) }) },
          { label: 'Freq', value: fmtEng(gen.freq, 'Hz'), dim: knobParam !== 'genFreq', press: () => setKnobParam('genFreq') },
          { label: 'Amplitude', value: `${gen.amp.toFixed(2)} V`, dim: knobParam !== 'genAmp', press: () => setKnobParam('genAmp') },
          { label: 'Offset', value: `${gen.offset.toFixed(2)} V`, dim: knobParam !== 'genOffset', press: () => setKnobParam('genOffset') },
          gen.type === 'square' || gen.type === 'pulse'
            ? { label: 'Duty', value: `${(gen.duty * 100).toFixed(0)} %`, dim: knobParam !== 'genDuty', press: () => setKnobParam('genDuty') }
            : { label: 'Noise', value: `${gen.noise.toFixed(2)} V`, dim: knobParam !== 'genNoise', press: () => setKnobParam('genNoise') },
        ];
      case 'trig':
        return [
          { label: 'Slope', value: engine.trig.edge === 'rising' ? 'Rising ↑' : 'Falling ↓', press: () => engine.setTrigger({ edge: engine.trig.edge === 'rising' ? 'falling' : 'rising' }) },
          { label: 'Sweep', value: engine.trig.sweep, press: () => engine.setTrigger({ sweep: cyc(['auto', 'normal', 'single'] as const, engine.trig.sweep) }) },
          { label: 'Source', value: CH_NAMES[engine.trig.source], press: () => engine.setTrigger({ source: (engine.trig.source + 1) % 4 }) },
          { label: 'Force', press: () => engine.forceTrigger() },
          { label: 'Set 50%', press: () => { const m = engine.channels[engine.trig.source].meas; engine.setTrigger({ level: (m.vmax + m.vmin) / 2 }); } },
        ];
      case 'acq':
        return [
          { label: 'Mode', value: engine.acq.mode, press: () => engine.setAcquisition({ mode: cyc(['sample', 'peak', 'average'] as const, engine.acq.mode) }) },
          { label: 'Average', value: `${engine.acq.avgCount}×`, press: () => engine.setAcquisition({ avgCount: cyc([4, 16, 64, 128] as const, engine.acq.avgCount) }) },
          { label: running ? 'Stop' : 'Run', on: running, press: () => (running ? engine.stop() : engine.run()) },
          { label: 'Single', on: armed, press: () => engine.single() },
          { label: 'AutoSet', press: () => engine.autoSet() },
        ];
      case 'disp':
        return [
          { label: 'Persist', value: engine.display.persistence === Infinity ? '∞' : engine.display.persistence > 0 ? `${engine.display.persistence}s` : 'Off', press: () => engine.setDisplay({ persistence: cyc(PERSIST_CYCLE, engine.display.persistence) }) },
          { label: 'Type', value: engine.display.dots ? 'Dots' : 'Vectors', press: () => engine.setDisplay({ dots: !engine.display.dots }) },
          { label: 'Grid', value: engine.display.grid, press: () => engine.setDisplay({ grid: cyc(['full', 'half', 'none'] as const, engine.display.grid) }) },
          { label: 'XY Mode', value: engine.display.xy ? 'On' : 'Off', on: engine.display.xy, press: () => engine.setDisplay({ xy: !engine.display.xy }) },
          { label: engine.display.fft ? `FFT src CH${engine.display.fftSource + 1}` : 'FFT', value: engine.display.fft ? 'On' : 'Off', on: engine.display.fft, press: () => engine.setDisplay(engine.display.fft ? { fft: false } : { fft: true, fftSource: selected }) },
        ];
      case 'cur':
        return [
          { label: 'Cursors', value: engine.cursors.enabled ? 'Manual' : 'Off', on: engine.cursors.enabled, press: () => engine.setCursors({ enabled: !engine.cursors.enabled }) },
          { label: 'Cursor A', value: fmtEng(engine.cursors.vA, 's'), dim: knobParam !== 'curA_t', press: () => { engine.setCursors({ enabled: true, active: 'a' }); setKnobParam('curA_t'); } },
          { label: 'Cursor B', value: fmtEng(engine.cursors.vB, 's'), dim: knobParam !== 'curB_t', press: () => { engine.setCursors({ enabled: true, active: 'b' }); setKnobParam('curB_t'); } },
          { label: `Volt ${engine.cursors.active.toUpperCase()}`, value: fmtEng(engine.cursors.active === 'a' ? engine.cursors.hA : engine.cursors.hB, 'V'), dim: knobParam !== (engine.cursors.active === 'a' ? 'curA_v' : 'curB_v'), press: () => setKnobParam(engine.cursors.active === 'a' ? 'curA_v' : 'curB_v') },
          { label: 'Select', value: engine.cursors.active.toUpperCase(), press: () => engine.setCursors({ active: engine.cursors.active === 'a' ? 'b' : 'a' }) },
        ];
      default:
        return [];
    }
  };

  const softKeys = buildMenu();

  /* ---------------- command console ---------------- */
  const runJson = (text: string) => {
    try {
      const obj = JSON.parse(text) as { cmd: string; args?: unknown[] };
      const res = engine.handleCommand(obj.cmd, obj.args ?? []);
      log(`▸ ${obj.cmd} → ${fmtRes(res)}`, res.ok ? 'cmd' : 'err');
    } catch (e) {
      log(`✗ parse error: ${e instanceof Error ? e.message : String(e)}`, 'err');
    }
  };
  const runCmd = () => runJson(cmdText);

  /* ---------------- render ---------------- */
  const ch = engine.channels[selected];

  return (
    <div className="osc-app">
      <div className="osc-scale-wrap" style={{ height: panelH * scale }}>
        <div
          ref={panelRef}
          className="scope-panel"
          style={scale < 1 ? { transform: `scale(${scale})`, transformOrigin: 'top center' } : undefined}
        >
        <span className="screw tl" /><span className="screw tr" />
        <span className="screw bl" /><span className="screw br" />

        {/* top strip */}
        <div className="scope-top">
          <div className="handle-slot" />
          <button
            type="button"
            className={`power-btn${powerOn ? '' : ' off'}`}
            onClick={() => { const on = !powerOn; setPowerOn(on); engine.setPower(on); }}
            title="Power"
          >
            <span className="led" />PWR
          </button>
          <div className="brand">
            <div className="name">Z-DSO <span className="accent">2104</span></div>
            <div className="sub">4-CH · 100 MHz · 1 GSa/s Digital Storage Oscilloscope</div>
          </div>
          <div className="handle-slot" />
        </div>

        {/* main row */}
        <div className="scope-main">
          <div className="screen-group">
            <div className="screen-holder">
              <Screen engine={engine} powerOn={powerOn} />
            </div>
            <div className="softkeys">
              {softKeys.map((sk, i) => (
                <button type="button" key={i} className="softkey" onClick={sk.press} title={sk.label}>
                  <span>{sk.label}</span>
                  {sk.value !== undefined && <span className="sk-val">{sk.value}</span>}
                  {sk.on && <span className="sk-on">● ON</span>}
                  {sk.arrow && <span className="sk-arrow">▶▶</span>}
                </button>
              ))}
            </div>
          </div>

          {/* menu buttons */}
          <div className="menu-col">
            <button type="button" className={`menu-btn${menu === 'cur' ? ' lit' : ''}`} onClick={() => setMenu('cur')}>Cursor</button>
            <button type="button" className={`menu-btn${menu === 'acq' ? ' lit' : ''}`} onClick={() => setMenu('acq')}>Acquire</button>
            <button type="button" className={`menu-btn${menu === 'disp' ? ' lit' : ''}`} onClick={() => setMenu('disp')}>Display</button>
            <button type="button" className={`menu-btn${menu === 'ch' ? ' lit' : ''}`} onClick={() => setMenu('ch')}>Channel</button>
            <button type="button" className={`menu-btn${menu === 'gen' ? ' lit' : ''}`} onClick={() => setMenu('gen')}>Demo Gen</button>
          </div>

          {/* vertical section */}
          <div className="section" style={{ minWidth: 158 }}>
            <div className="section-title">Vertical</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
              {CH_NAMES.map((name, i) => (
                <PanelButton
                  key={name}
                  label={name}
                  variant="ch"
                  ledColor={CH_COLORS[i]}
                  lit={engine.channels[i]?.cfg.enabled ?? false}
                  className={selected === i ? 'active-ch' : ''}
                  title="Klik: pilih kanal · klik lagi: On/Off kanal"
                  onPress={() => {
                    if (selected === i) {
                      // second press on the already-selected channel toggles it
                      engine.setChannel(i, { enabled: !engine.channels[i].cfg.enabled });
                    } else {
                      setSelected(i);
                      setMenu('ch');
                    }
                  }}
                />
              ))}
            </div>
            <PanelButton
              label="MATH"
              variant="mini"
              ledColor="#9d7bff"
              lit={engine.math.enabled}
              onPress={() => engine.setMath({ enabled: !engine.math.enabled })}
            />
            <div style={{ display: 'flex', gap: 2, marginTop: 4 }}>
              <Knob
                size={58}
                label="Scale"
                value={`${fmtEng(ch?.cfg.voltsDiv ?? 1, 'V', 1)}/div`}
                pointerColor={CH_COLORS[selected]}
                onStep={stepVScale}
              />
              <Knob
                size={58}
                label="Position"
                value={fmtEng(ch?.cfg.offset ?? 0, 'V', 2)}
                pointerColor={CH_COLORS[selected]}
                onStep={stepVPos}
                onReset={() => engine.setChannel(selected, { offset: 0 })}
              />
            </div>
          </div>
        </div>

        {/* bottom row */}
        <div className="scope-bottom">
          <div className="section" style={{ flex: 1.15 }}>
            <div className="section-title">Horizontal</div>
            <div style={{ display: 'flex', gap: 4 }}>
              <Knob
                size={62}
                label="S/div"
                value={`${fmtEng(engine.time.timeDiv, 's', 1)}/div`}
                onStep={stepHScale}
              />
              <Knob
                size={62}
                label="Position"
                value={fmtEng(engine.time.hOffset, 's', 2)}
                onStep={stepHPos}
                onReset={() => engine.setHorizontal({ hOffset: 0 })}
              />
            </div>
          </div>

          <div className="section" style={{ flex: 1.35 }}>
            <div className="section-title">Trigger</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Knob
                size={62}
                label="Level"
                value={fmtEng(engine.trig.level, 'V', 2)}
                onStep={stepLevel}
                onReset={() => engine.setTrigger({ level: 0 })}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ display: 'flex', gap: 4 }}>
                  <PanelButton
                    label={engine.trig.edge === 'rising' ? '↑ Rise' : '↓ Fall'}
                    variant="mini"
                    lit
                    ledColor="#f5c518"
                    onPress={() => engine.setTrigger({ edge: engine.trig.edge === 'rising' ? 'falling' : 'rising' })}
                  />
                  <PanelButton
                    label="Mode"
                    variant="mini"
                    lit={menu === 'trig'}
                    ledColor="#f5c518"
                    onPress={() => setMenu('trig')}
                  />
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <PanelButton
                    label={engine.trig.sweep === 'auto' ? 'Auto' : engine.trig.sweep === 'normal' ? 'Norm' : 'Single'}
                    variant="mini"
                    onPress={() => engine.setTrigger({ sweep: cyc(['auto', 'normal', 'single'] as const, engine.trig.sweep) })}
                  />
                  <PanelButton label="50%" variant="mini" onPress={() => { const m = engine.channels[engine.trig.source].meas; engine.setTrigger({ level: (m.vmax + m.vmin) / 2 }); }} />
                </div>
              </div>
            </div>
          </div>

          <div className="section" style={{ flex: 1 }}>
            <div className="section-title">Run Control</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center' }}>
              <PanelButton label="Auto" variant="run" ledColor="#f5c518" onPress={() => engine.autoSet()} />
              <div style={{ display: 'flex', gap: 6 }}>
                <PanelButton
                  label={running ? 'RUN' : 'STOP'}
                  variant="run"
                  lit={running}
                  stopMode={!running}
                  ledColor={running ? '#45e873' : '#f0685f'}
                  className={running ? 'run-on' : ''}
                  onPress={() => (running ? engine.stop() : engine.run())}
                />
                <PanelButton
                  label="Single"
                  variant="run"
                  lit={armed}
                  ledColor="#ff9d45"
                  onPress={() => engine.single()}
                />
              </div>
            </div>
          </div>

          <div className="section" style={{ flex: 0.9 }}>
            <div className="section-title">Navigate</div>
            <Knob
              size={86}
              label={knobParam ? `Adjust: ${knobParam}` : 'Adjust'}
              value={adjustValue()}
              onStep={stepAdjust}
              pointerColor="#f5c518"
            />
          </div>
        </div>

        <div style={{ textAlign: 'center', fontSize: 8, letterSpacing: 2, color: '#6a727d', marginTop: 10, textTransform: 'uppercase' }}>
          Virtual instrument — every control is scriptable via window.OSC · postMessage · BroadcastChannel
        </div>
        </div>
      </div>

      {/* API console */}
      <button type="button" className="api-fab" onClick={() => setConsoleOpen((o) => !o)}>
        {consoleOpen ? '✕ close API console' : '⌘ API Console'}
      </button>

      {consoleOpen && (
        <div className="api-console">
          <div className="head">
            <span className="title">OSC API CONSOLE</span>
            <span className="badge">window.OSC ✓</span>
            <span className="badge">postMessage ✓</span>
            <span className="badge">BroadcastChannel( osc-bridge ) ✓</span>
            <span style={{ fontSize: 10, color: '#8f97a1' }}>
              {`format: {"cmd":"<command>","args":[...]}`}
            </span>
            <button type="button" className="close" onClick={() => setConsoleOpen(false)}>close</button>
          </div>
          <div className="body">
            <div className="left">
              <div className="cmdrow">
                <input
                  type="text"
                  value={cmdText}
                  onChange={(e) => setCmdText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') runCmd(); }}
                  placeholder='{"cmd":"autoSet","args":[]}'
                  aria-label="API command"
                />
                <button type="button" className="send" onClick={runCmd}>RUN</button>
              </div>
              <div className="examples">
                {EXAMPLES.map(([name, json]) => (
                  <button
                    type="button"
                    key={name}
                    className="ex"
                    onClick={() => { setCmdText(json); runJson(json); }}
                    title={json}
                  >
                    {name}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 10, color: '#5c6570' }}>
                Tips: Buka halaman <b>?view=sim</b> untuk melihat simulator sirkuit mengirim data ke osiloskop ini lewat BroadcastChannel.
              </div>
            </div>
            <div className="log" ref={logRef}>
              {consoleLog.map((l, i) => (
                <div key={i} className={l.cls}>{l.text}</div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
