'use client';

// Bridge to the standalone "Z-DSO 2104" oscilloscope window.
//
// The scope page (public/z-dso/index.html) listens on BroadcastChannel
// ("osc-bridge") and, when it was opened through window.open(), also accepts
// window.postMessage. We use BroadcastChannel as the primary transport and
// postMessage as the fallback (e.g. file:// where BroadcastChannel is absent).

const CHANNEL_NAME = 'osc-bridge';
const DEFAULT_SCOPE_PATH = '/z-dso/index.html';
const HEARTBEAT_TIMEOUT_MS = 3000;

export interface ZDsoReply {
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface ZDsoMeasurement {
  vpp: number;
  vmax: number;
  vmin: number;
  vamp: number;
  vavg: number;
  vrms: number;
  freq: number;
  period: number;
  duty: number;
  rise: number;
  fall: number;
  valid: boolean;
}

export interface ZDsoState {
  running?: boolean;
  simTime?: number;
  channels?: Array<{
    name: string;
    source: 'external' | 'internal-generator' | string;
    cfg: {
      enabled: boolean;
      voltsDiv: number;
      offset: number;
      coupling: string;
      invert: boolean;
      probe: number;
    };
    measurements: ZDsoMeasurement;
  }>;
  horizontal?: { timeDiv: number; hOffset: number; trigPos: number };
  trigger?: { source: number; level: number; edge: string; sweep: string };
}

interface PendingRequest {
  resolve: (reply: ZDsoReply) => void;
  timer: ReturnType<typeof setTimeout>;
}

function makeId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `zdso-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export class ZDsoBridge {
  private bc: BroadcastChannel | null = null;
  private win: Window | null = null;
  private pending = new Map<string, PendingRequest>();
  private lastHeartbeat = 0;
  private connected = false;
  private disposed = false;
  private connectionTimer: ReturnType<typeof setInterval> | null = null;

  /** Called whenever the heartbeat-based connection state changes. */
  onConnectionChange: ((connected: boolean) => void) | null = null;
  /** Called for every "state" event broadcast by the scope. */
  onState: ((state: ZDsoState) => void) | null = null;
  /** Called for every "heartbeat" event (roughly once per second). */
  onHeartbeat: ((data: { t: number; running: boolean }) => void) | null = null;

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
    // Leave the scope back on its internal demo generators when the simulator
    // goes away, otherwise it would keep showing a frozen external trace.
    this.clearAll();
  };

  private handleMessage(data: unknown): void {
    if (!data || typeof data !== 'object') return;
    const d = data as Record<string, unknown>;
    if (d.__osc !== true) return;

    if (d.__oscReply === true && typeof d.id === 'string') {
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

    if (d.__oscEvent === true) {
      if (d.event === 'heartbeat') {
        this.lastHeartbeat = performance.now();
        this.setConnected(true);
        if (d.data && typeof d.data === 'object') {
          this.onHeartbeat?.(d.data as { t: number; running: boolean });
        }
      } else if (d.event === 'state' && d.data && typeof d.data === 'object') {
        this.onState?.(d.data as ZDsoState);
      }
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

  /** Open (or focus) the scope in a dedicated window. */
  open(path: string = DEFAULT_SCOPE_PATH): Window | null {
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
      'z-dso-2104',
      'width=1290,height=1000,resizable=yes,scrollbars=yes'
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

  /** Command with a reply (scope echoes our unique id). */
  request(cmd: string, args: unknown[] = [], timeoutMs = 1500): Promise<ZDsoReply> {
    if (!this.canSend()) {
      return Promise.resolve({ ok: false, error: 'oscilloscope is not connected' });
    }
    const id = makeId();
    return new Promise<ZDsoReply>((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        resolve({ ok: false, error: 'timeout waiting for scope reply' });
      }, timeoutMs);
      this.pending.set(id, { resolve, timer });
      this.post({ cmd, args, id });
    });
  }

  /** Restore the internal demo generators on all four channels. */
  clearAll(): void {
    for (let ch = 0; ch < 4; ch++) this.send('clearChannelData', [ch]);
  }

  private canSend(): boolean {
    if (this.bc) return true;
    return !!(this.win && !this.win.closed);
  }

  private post(payload: Record<string, unknown>): void {
    const msg = { __osc: true, ...payload };
    if (this.bc) {
      try {
        this.bc.postMessage(msg);
        return;
      } catch {
        /* structured-clone failed — try the popup reference below */
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

/**
 * Resample the engine's scope ring buffer to a fixed number of display points
 * covering exactly one screen window. `samples` is the engine layout
 * stride-3 [t, v, i]; `valueOffset` is 1 for voltage and 2 for current.
 *
 * Values before the oldest sample / after the newest sample are held flat,
 * which keeps the trace stable when the engine has not produced a full window
 * of history yet.
 */
export function resampleScope(
  samples: Float64Array,
  tEnd: number,
  windowSec: number,
  count: number,
  valueOffset: 1 | 2,
  scale = 1
): Float32Array | null {
  const n = Math.floor(samples.length / 3);
  if (n < 2 || count < 2 || !(windowSec > 0)) return null;

  const out = new Float32Array(count);
  const t0 = tEnd - windowSec;
  const step = windowSec / (count - 1);
  const last = n - 1;
  const firstT = samples[0];
  const lastT = samples[last * 3];
  let j = 0;

  for (let i = 0; i < count; i++) {
    const t = t0 + step * i;
    if (t <= firstT) {
      out[i] = samples[valueOffset] * scale;
    } else if (t >= lastT) {
      out[i] = samples[last * 3 + valueOffset] * scale;
    } else {
      while (j < last - 1 && samples[(j + 1) * 3] < t) j++;
      const ta = samples[j * 3];
      const tb = samples[(j + 1) * 3];
      const f = tb > ta ? (t - ta) / (tb - ta) : 0;
      const va = samples[j * 3 + valueOffset];
      const vb = samples[(j + 1) * 3 + valueOffset];
      out[i] = (va + (vb - va) * f) * scale;
    }
  }
  return out;
}
