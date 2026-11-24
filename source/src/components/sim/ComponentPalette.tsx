'use client';

// Quick component palette — press P, type a name, press Enter, then click the
// canvas to place it. Search matches the display name, category and aliases.

import { useMemo, useState } from 'react';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { CATEGORIES, ELEMENT_META, type ElemMeta } from '@/lib/circuit/elements';

const RECENT_KEY = 'circuit-sim-recent-components';
const RECENT_MAX = 6;

/** Extra search words so "res", "gnd", "npn", "cap" … all find the right part. */
const SEARCH_ALIASES: Record<string, string> = {
  Wire: 'w wire line connect net trace',
  Resistor: 'r res resistance ohm',
  Capacitor: 'c cap capacitance farad farad',
  Inductor: 'l ind inductance henry coil',
  Potentiometer: 'pot pot variable resistor trimmer',
  Switch: 'sw switch toggle contact',
  Lamp: 'lamp bulb light globe',
  Ground: 'gnd ground earth 0v reference return',
  'Voltage Source': 'v vsrc source battery supply generator dc ac sine square triangle sawtooth pulse',
  'DC Battery': 'battery batt dc cell supply source power',
  'Current Source': 'i isrc current source generator',
  'Voltage Rail': 'rail vcc vdd supply power',
  Diode: 'd diode rectifier',
  LED: 'led light emitting diode bulb',
  'Zener Diode': 'zener zener diode regulator breakdown',
  'NPN Transistor': 'npn bjt transistor q',
  'PNP Transistor': 'pnp bjt transistor q',
  'N-MOSFET': 'nmos n-channel mosfet fet transistor',
  'P-MOSFET': 'pmos p-channel mosfet fet transistor',
  'Op-Amp': 'opamp op-amp operational amplifier comparator',
  Comparator: 'comparator cmp opamp',
  Transformer: 'transformer coil coupled inductor',
  'Generic IC': 'ic chip dummy placeholder 4pin four pin',
  'Spark Gap': 'spark gap arc ignition',
  Ammeter: 'ammeter amp meter current probe',
  Voltmeter: 'voltmeter volt meter voltage probe',
  Ohmmeter: 'ohmmeter ohm meter resistance probe',
  'Probe Red': 'probe red multimeter avo vhz voltage volt ohm hz test lead',
  'Probe Black': 'probe black multimeter avo com common ground test lead',
  'AND Gate': 'and gate logic',
  'OR Gate': 'or gate logic',
  'NAND Gate': 'nand gate logic',
  'NOR Gate': 'nor gate logic',
  'XOR Gate': 'xor gate logic',
  'XNOR Gate': 'xnor gate logic',
  Inverter: 'not inverter gate logic',
  Buffer: 'buffer gate logic',
  'Logic Input': 'logic input switch bit',
  'Clock Input': 'clock input generator square',
  'Logic Output': 'logic output probe led',
  'D Flip-Flop': 'dff d flip flop latch register',
  'ADC (4-bit)': 'adc analog digital converter',
  'DAC (4-bit)': 'dac digital analog converter',
};

function searchValue(m: ElemMeta): string {
  return `${m.name} ${m.category} ${SEARCH_ALIASES[m.name] ?? ''}`.toLowerCase();
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (meta: ElemMeta) => void;
}

/** Reads the recent list once per mount — the dialog content unmounts when closed. */
function loadRecentNames(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((n): n is string => typeof n === 'string') : [];
  } catch {
    return [];
  }
}

export function ComponentPalette({ open, onOpenChange, onPick }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl gap-0 overflow-hidden border-border bg-card p-0 text-foreground shadow-2xl"
        showCloseButton={false}
      >
        <DialogTitle className="sr-only">Quick component</DialogTitle>
        <DialogDescription className="sr-only">
          Search for a component, press Enter, then click the canvas to place it.
        </DialogDescription>
        <PaletteBody onPick={onPick} onClose={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  );
}

function PaletteBody({ onPick, onClose }: { onPick: (m: ElemMeta) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [recentNames, setRecentNames] = useState<string[]>(loadRecentNames);

  const recent = useMemo(
    () =>
      recentNames
        .map((name) => ELEMENT_META.find((m) => m.name === name))
        .filter((m): m is ElemMeta => m !== undefined),
    [recentNames]
  );

  const pick = (meta: ElemMeta) => {
    const next = [meta.name, ...recentNames.filter((n) => n !== meta.name)].slice(0, RECENT_MAX);
    setRecentNames(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable — recents simply won't persist */
    }
    onPick(meta);
    onClose();
  };

  return (
  <Command loop className="bg-card text-foreground">
    <CommandInput
      autoFocus
      value={query}
      onValueChange={setQuery}
      placeholder="Search components…  (res, cap, gnd, npn)"
      className="text-foreground placeholder:text-muted-foreground"
    />
    <CommandList className="max-h-[380px]">
      <CommandEmpty className="py-8 text-center text-sm text-muted-foreground">
        No component matches “{query}”.
      </CommandEmpty>
      {recent.length > 0 && query.trim() === '' && (
        <CommandGroup heading="Recent">
          {recent.map((m) => (
            <PaletteRow key={`recent-${m.type}-${m.name}`} meta={m} onPick={pick} />
          ))}
        </CommandGroup>
      )}
      {CATEGORIES.map((cat) => (
        <CommandGroup key={cat} heading={cat}>
          {ELEMENT_META.filter((m) => m.category === cat).map((m) => (
            <PaletteRow key={`${m.type}-${m.name}`} meta={m} onPick={pick} />
          ))}
        </CommandGroup>
      ))}
    </CommandList>
    <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[10px] text-muted-foreground">
      <span>↑↓ navigate · ↵ arm for placement · Esc close</span>
      <span>{ELEMENT_META.length} components</span>
    </div>
  </Command>
  );
}

function PaletteRow({ meta, onPick }: { meta: ElemMeta; onPick: (m: ElemMeta) => void }) {
  return (
    <CommandItem
      value={searchValue(meta)}
      onSelect={() => onPick(meta)}
      className="cursor-pointer gap-2 text-foreground data-[selected=true]:bg-brand/20 data-[selected=true]:text-brand"
    >
      <span className="w-5 shrink-0 text-right font-mono text-[10px] text-muted-foreground">{meta.posts}p</span>
      <span className="truncate">{meta.name}</span>
      <span className="ml-auto shrink-0 text-[9px] uppercase tracking-wider text-muted-foreground">
        {meta.category}
      </span>
    </CommandItem>
  );
}
