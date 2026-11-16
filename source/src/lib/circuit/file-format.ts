// Circuit file format — read/write `.circuit.json` documents.
//
// The on-disk format is intentionally small and self-describing so a saved
// circuit can be inspected/edited by hand.  Parsing is defensive: everything
// that comes from disk is untrusted and is validated before it reaches the
// WASM engine.

import { ELEMENT_META, metaByType } from './elements';

export const CIRCUIT_FILE_FORMAT = 'circuit-sim';
export const CIRCUIT_FILE_VERSION = 1;

/** Engine limit: 6 posts and 8 params per element (see engine.ts). */
const MAX_POSTS = 6;
const MAX_PARAMS = 8;
const MAX_ELEMENTS = 10_000;
const KNOWN_TYPES = new Set(ELEMENT_META.map((m) => m.type));

export interface CircuitFileElement {
  id: number;
  type: number;
  flags: number;
  posts: [number, number][];
  params: number[];
  /** Optional user-dragged offset for the element's value label. */
  labelOff?: [number, number];
}

export interface CircuitFileView {
  x: number;
  y: number;
  zoom: number;
}

export interface CircuitFile {
  format: typeof CIRCUIT_FILE_FORMAT;
  version: number;
  app: string;
  name: string;
  savedAt: string;
  view: CircuitFileView | null;
  scopeIds: number[];
  elements: CircuitFileElement[];
}

export interface ParsedCircuit {
  name: string;
  elements: CircuitFileElement[];
  scopeIds: number[];
  view: CircuitFileView | null;
  warnings: string[];
}

export interface CreateCircuitFileOptions {
  name?: string;
  view?: CircuitFileView | null;
  scopeIds?: number[];
  savedAt?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function cloneElement(e: CircuitFileElement): CircuitFileElement {
  return {
    id: e.id,
    type: e.type,
    flags: e.flags,
    posts: e.posts.map((p) => [p[0], p[1]] as [number, number]),
    params: [...e.params],
    ...(e.labelOff ? { labelOff: [e.labelOff[0], e.labelOff[1]] as [number, number] } : {}),
  };
}

function cleanName(raw: unknown): string {
  if (typeof raw !== 'string') return 'Imported circuit';
  const name = raw.replace(/\s+/g, ' ').trim();
  return name ? name.slice(0, 80) : 'Imported circuit';
}

function cleanView(raw: unknown): CircuitFileView | null {
  if (!isRecord(raw)) return null;
  if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y) || !isFiniteNumber(raw.zoom)) return null;
  return {
    x: raw.x,
    y: raw.y,
    zoom: Math.min(3, Math.max(0.4, raw.zoom)),
  };
}

function parsePosts(raw: unknown, label: string): [number, number][] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_POSTS) {
    throw new Error(`${label}: "posts" must contain 1–${MAX_POSTS} points.`);
  }
  return raw.map((post, i) => {
    if (!Array.isArray(post) || post.length < 2 || !isFiniteNumber(post[0]) || !isFiniteNumber(post[1])) {
      throw new Error(`${label}: post ${i + 1} must be [x, y] with finite numbers.`);
    }
    return [post[0], post[1]] as [number, number];
  });
}

function parseParams(raw: unknown, fallback: number[], label: string): number[] {
  if (raw === undefined) return [...fallback];
  if (!Array.isArray(raw)) throw new Error(`${label}: "params" must be an array.`);
  if (raw.length > MAX_PARAMS) {
    throw new Error(`${label}: at most ${MAX_PARAMS} params are supported (got ${raw.length}).`);
  }
  const params = raw.map((value, i) => {
    if (!isFiniteNumber(value)) throw new Error(`${label}: param ${i + 1} must be a finite number.`);
    return value;
  });
  // Older files may omit trailing params; fill them with the element defaults.
  for (let i = params.length; i < fallback.length; i++) params.push(fallback[i]);
  return params;
}

function parseLabelOff(raw: unknown, label: string): [number, number] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw) || raw.length !== 2 || !isFiniteNumber(raw[0]) || !isFiniteNumber(raw[1])) {
    throw new Error(`${label}: "labelOff" must be [x, y] with finite numbers.`);
  }
  return [raw[0], raw[1]];
}

/** Build the JSON document written by "Save file". */
export function createCircuitFile(
  elements: readonly CircuitFileElement[],
  options: CreateCircuitFileOptions = {}
): CircuitFile {
  return {
    format: CIRCUIT_FILE_FORMAT,
    version: CIRCUIT_FILE_VERSION,
    app: 'CircuitSim Rust/WASM',
    name: cleanName(options.name),
    savedAt: options.savedAt ?? new Date().toISOString(),
    view: cleanView(options.view),
    scopeIds: (options.scopeIds ?? []).filter((id) => Number.isInteger(id) && id > 0),
    elements: elements.map(cloneElement),
  };
}

export function serializeCircuitFile(
  elements: readonly CircuitFileElement[],
  options: CreateCircuitFileOptions = {}
): string {
  return `${JSON.stringify(createCircuitFile(elements, options), null, 2)}\n`;
}

/** Suggested download name, e.g. `my-circuit-20261101-133000.circuit.json`. */
export function circuitFileName(name?: string, date = new Date()): string {
  const slug = (name ?? 'circuit')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'circuit';
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${slug}-${stamp}.circuit.json`;
}

/**
 * Parse and validate a circuit file.
 *
 * Accepts the native document (`{ format, version, elements, ... }`) and the
 * legacy bare-array form previously stored in localStorage.  Throws a
 * user-facing `Error` when the file cannot be used.
 */
export function parseCircuitFile(text: string): ParsedCircuit {
  const source = text.replace(/^\uFEFF/, '').trim();
  if (!source) throw new Error('The selected file is empty.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    throw new Error('Not a CircuitSim JSON file (invalid JSON).');
  }

  const warnings: string[] = [];
  let rawElements: unknown;
  let rawScopeIds: unknown;
  let rawView: unknown;
  let name = 'Imported circuit';

  if (Array.isArray(parsed)) {
    // Legacy: localStorage used to store just the element array.
    rawElements = parsed;
    warnings.push('Loaded a legacy raw element list.');
  } else if (isRecord(parsed)) {
    if (parsed.format !== undefined && parsed.format !== CIRCUIT_FILE_FORMAT) {
      throw new Error(`Unsupported file format "${String(parsed.format)}".`);
    }
    if (isFiniteNumber(parsed.version) && parsed.version > CIRCUIT_FILE_VERSION) {
      warnings.push(`File version ${parsed.version} is newer than supported version ${CIRCUIT_FILE_VERSION}.`);
    }
    name = cleanName(parsed.name);
    rawElements = parsed.elements;
    rawScopeIds = parsed.scopeIds;
    rawView = parsed.view;
  } else {
    throw new Error('Unrecognised circuit file structure.');
  }

  if (!Array.isArray(rawElements)) throw new Error('The file has no "elements" array.');
  if (rawElements.length > MAX_ELEMENTS) {
    throw new Error(`The file contains too many elements (limit ${MAX_ELEMENTS}).`);
  }

  const validated: { rawId: number | null; element: CircuitFileElement }[] = [];
  rawElements.forEach((raw, index) => {
    const label = `Element ${index + 1}`;
    if (!isRecord(raw)) throw new Error(`${label}: expected an object.`);

    const type = raw.type ?? raw.etype;
    if (!isFiniteNumber(type) || !Number.isInteger(type) || !KNOWN_TYPES.has(type)) {
      throw new Error(`${label}: unknown element type ${String(type)}.`);
    }

    const meta = metaByType(type);
    const flags = raw.flags === undefined ? (meta?.defaults.flags ?? 0) : raw.flags;
    if (!isFiniteNumber(flags) || !Number.isInteger(flags)) {
      throw new Error(`${label}: "flags" must be an integer.`);
    }

    const posts = parsePosts(raw.posts, label);
    const params = parseParams(raw.params, meta?.defaults.params ?? [], label);
    const labelOff = parseLabelOff(raw.labelOff, label);
    const rawId = isFiniteNumber(raw.id) && Number.isSafeInteger(raw.id) && raw.id > 0 ? raw.id : null;

    validated.push({
      rawId,
      element: { id: 0, type, flags, posts, params, ...(labelOff ? { labelOff } : {}) },
    });
  });

  // Preserve valid ids when possible; repair missing/duplicate ids so React
  // keys and scope references stay unambiguous.
  const maxValidId = validated.reduce((max, v) => (v.rawId !== null ? Math.max(max, v.rawId) : max), 0);
  let nextId = maxValidId + 1;
  const usedIds = new Set<number>();
  let repairedIds = 0;
  for (const item of validated) {
    let id = item.rawId;
    if (id === null || usedIds.has(id)) {
      id = nextId++;
      repairedIds++;
    }
    usedIds.add(id);
    item.element.id = id;
  }
  if (repairedIds > 0) warnings.push(`Repaired ${repairedIds} missing or duplicate element id(s).`);

  const elements = validated.map((v) => v.element);

  let scopeIds: number[] = [];
  if (Array.isArray(rawScopeIds)) {
    const wanted = new Set(rawScopeIds.filter(isFiniteNumber).map((id) => Math.trunc(id)));
    const available = new Set(elements.map((e) => e.id));
    const valid = Array.from(wanted).filter((id) => available.has(id));
    if (valid.length !== wanted.size) {
      warnings.push('Some scope channels referenced missing elements and were removed.');
    }
    scopeIds = valid.slice(-4);
  }

  return {
    name,
    elements,
    scopeIds,
    view: cleanView(rawView),
    warnings,
  };
}
