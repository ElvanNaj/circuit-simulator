'use client';

// Bridge to the standalone "Z-AVO 800" virtual multimeter window.
//
// The meter page (public/z-avo/index.html) listens on BroadcastChannel
// ("avo-bridge") and, when opened through window.open(), also accepts
// window.postMessage (fallback for file:// or cross-profile windows).
// Every message carries `__avo: true` so it never collides with the
// oscilloscope bridge ("__osc") or application messages.

const CHANNEL_NAME = 'avo-bridge';
const DEFAULT_AVO_PATH = '/z-avo/index.html';
const HEARTBEAT_TIMEOUT_MS = 3000;

export type AvoMode =
  | 'OFF'
  | 'DCV'
  | 'ACV'
  | 'DCA'
  | 'ACA'
  | 'OHM'
  | 'CONT'
  | 'DIODE'
  | 'CAP'
  | 'HZ'
  | 'DUTY';

export const AVO_MODES: AvoMode[] = [
  'OFF',
  'DCV',
  'ACV',
  'DCA',
  'ACA',
  'OHM',
  'CONT',
  'DIODE',
  'CAP',
  'HZ',
  'DUTY',
];

export interface AvoReading {
  value: number | null;
  display: string;
  unit: string;
  range?: number;
  decimals?: number;
  beep?: boolean;
  ov?: boolean;
  ol?: boolean;
}

export interface AvoState {
  power: boolean;
  mode: AvoMode;
  modeLabel?: string;
  unit?: string;
  hold: boolean;
  relActive: boolean;
  rangeAuto?: boolean;
  range?: number | null;
  probes: { red: string | null; black: string | null };
  lastReading?: AvoReading;
  lastInputAt?: number;
}

export interface AvoReply {
  ok: boolean;
  data?: unknown;
  error?: string;
}

/** Payload accepted by the meter's `setMeasurement` command. */
export interface AvoMeasurement {
  type: 'voltage' | 'current' | 'resistance' | 'capacitance' | 'frequency' | 'duty' | 'diode' | 'continuity';
  samples?: Float32Array;
  sampleRate?: number;
  tStart?: number;
  scalar?: number;
  probes?: { red: string | null; black: string | null };
  meta?: { R?: number; C?: number; Vf?: number };
}

interface PendingRequest {
  resolve: (reply: AvoReply) => void;
  timer: ReturnType<typeof setTimeout>;
}

function makeId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `zavo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export class AvoBridge {
  private bc: BroadcastChannel | null = null;
  private win: Window | null = null;
  private pending = new Map<string, PendingRequest>();
  private lastHeartbeat = 0;
  private connected = false;
  private disposed = false;
  private connectionTimer: ReturnType<typeof setInterval> | null = null;

  /** Called whenever the heartbeat-based connection state changes. */
  onConnectionChange: ((connected: boolean) => void) | null = null;
  /** Called for every "state" event broadcast by the meter. */
  onState: ((state: AvoState) => void) | null = null;
  /** Called for every "reading" event (roughly 8 Hz). */
  onReading: ((reading: AvoReading) => void) | null = null;
  /** Called for every "heartbeat" event (roughly once per second). */
  onHeartbeat: ((data: { t: number; power: boolean; mode: AvoMode }) => void) | null = null;
  /** Called when continuity detection fires (R < 50 Ω). */
  onBeep: ((data: { freq: number; dur: number }) => void) | null = null;

  constructor() {
    if (typeof window === 'undefined') return;

    if (typeof BroadcastChannel !== 'undefined') {
      try {
        this.bc = new BroadcastChannel(CHANNEL_NAME);
        this.bc.onmessage = (ev: MessageEvent) => this.handleMessage(ev.data);
      } catch {
        this.bc = null;
      }
    }
    window.addEventListener('message', this.onWindowMessage);
    window.addEventListener('beforeunload', this.onBeforeUnload);
    window.addEventListener('pagehide', this.onBeforeUnload);

    this.connectionTimer = setInterval(() => this.refreshConnection(), 1000);
  }

  private onWindowMessage = (ev: MessageEvent) => {
    this.handleMessage(ev.data);
  };

  private onBeforeUnload = () => {
    // Leave the meter showing its internal demo values instead of a frozen
    // last measurement once the simulator goes away.
    this.clearAll();
  };

  private handleMessage(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const d = data as Record<string, unknown>;
    if (d.__avo !== true) return;

    if (d.__avoReply === true && typeof d.id === 'string') {
      const p = this.pending.get(d.id);
      if (!p) return;
      clearTimeout(p.timer);
      this.pending.delete(d.id);
      p.resolve({
        ok: d.ok === true,
        data: d.data,
        error: typeof d.error === 'string' ? d.error : undefined,
      });
      return;
    }

    if (d.__avoEvent !== true) return;
    const payload = (d.data ?? {}) as Record<string, unknown>;
    switch (d.event) {
      case 'heartbeat':
        this.lastHeartbeat = performance.now();
        this.setConnected(true);
        this.onHeartbeat?.(payload as { t: number; power: boolean; mode: AvoMode });
        break;
      case 'state':
        this.onState?.(payload as unknown as AvoState);
        break;
      case 'reading':
        this.onReading?.(payload as unknown as AvoReading);
        break;
      case 'beep':
        this.onBeep?.(payload as { freq: number; dur: number });
        break;
    }
  }

  private setConnected(next: boolean): void {
    if (this.connected === next) return;
    this.connected = next;
    this.onConnectionChange?.(next);
  }

  private refreshConnection(): void {
    if (this.disposed) return;
    const alive = this.lastHeartbeat > 0
      && performance.now() - this.lastHeartbeat < HEARTBEAT_TIMEOUT_MS;
    this.setConnected(alive);
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Open (or focus) the multimeter in a dedicated window. */
  open(path: string = DEFAULT_AVO_PATH): Window | null {
    if (typeof window === 'undefined') return null;
    if (this.win && !this.win.closed) {
      try {
        this.win.focus();
      } catch {
        /* ignore */
      }
      return this.win;
    }
    const url = new URL(path, window.location.href).href;
    this.win = window.open(
      url,
      'z-avo-800',
      'width=760,height=1000,resizable=yes,scrollbars=yes'
    );
    if (this.win) {
      try {
        this.win.focus();
      } catch {
        /* ignore */
      }
    }
    return this.win;
  }

  /** Fire-and-forget command. */
  send(cmd: string, args: unknown[] = []): void {
    this.post({ cmd, args });
  }

  /** Command with a reply (the meter echoes our unique id). */
  request(cmd: string, args: unknown[] = [], timeoutMs = 1500): Promise<AvoReply> {
    if (!this.canSend()) {
      return Promise.resolve({ ok: false, error: 'multimeter is not connected' });
    }
    const id = makeId();
    return new Promise<AvoReply>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: 'timeout waiting for meter reply' });
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.post({ cmd, args, id });
    });
  }

  /** Push one measurement frame to the meter. */
  setMeasurement(payload: AvoMeasurement): void {
    this.send('setMeasurement', [payload]);
  }

  /** Clear probes + measurement and return the meter to its demo source. */
  clearAll(): void {
    this.send('clearMeasurement');
    this.send('detachProbe', ['red']);
    this.send('detachProbe', ['black']);
  }

  private canSend(): boolean {
    if (this.bc) return true;
    return !!(this.win && !this.win.closed);
  }

  private post(payload: Record<string, unknown>): void {
    const msg = { __avo: true, ...payload };
    if (this.bc) {
      try {
        this.bc.postMessage(msg);
        return;
      } catch {
        /* structured clone failed — try the popup reference below */
      }
    }
    if (this.win && !this.win.closed) {
      try {
        this.win.postMessage(msg, '*');
      } catch {
        /* ignore */
      }
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearAll();
    if (this.connectionTimer !== null) {
      clearInterval(this.connectionTimer);
      this.connectionTimer = null;
    }
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.resolve({ ok: false, error: 'bridge disposed' });
    }
    this.pending.clear();
    window.removeEventListener('message', this.onWindowMessage);
    window.removeEventListener('beforeunload', this.onBeforeUnload);
    window.removeEventListener('pagehide', this.onBeforeUnload);
    if (this.bc) {
      try {
        this.bc.close();
      } catch {
        /* ignore */
      }
      this.bc = null;
    }
    this.win = null;
    this.connected = false;
  }
}
