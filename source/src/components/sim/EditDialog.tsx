'use client';

// Edit dialog for element parameters, driven by ELEMENT_META edit fields.

import { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { metaByType, fmtValue } from '@/lib/circuit/elements';
import type { CircuitElm } from './CircuitSimulator';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  elm: CircuitElm;
  onApply: (params: number[], flags: number, posts?: [number, number][]) => void;
}

export function EditDialog({ open, onOpenChange, elm, onApply }: Props) {
  const meta = metaByType(elm.type, elm.flags);
  // state initialized from props; component is keyed by parent so it remounts per element
  const [values, setValues] = useState<string[]>(() =>
    (meta?.defaults.params ?? []).map((_, k) => String(elm.params[k] ?? meta?.defaults.params[k] ?? ''))
  );
  const [choiceFlags, setChoiceFlags] = useState<number>(elm.flags);

  if (!meta) return null;
  const edits = meta.edits ?? [];

  const apply = () => {
    const nextParams = [...elm.params];
    let flags = elm.flags;
    for (const f of edits) {
      if (f.kind === 'choice' && f.param === -2) {
        // input count for gates: store in flags & 0xff, adjust post count structurally
        flags = (flags & ~0xff) | (choiceFlags & 0xff);
        continue;
      }
      if (f.kind === 'choice' && f.flagsMask !== undefined) {
        // waveform stored in flags
        const sel = choiceFlags & f.flagsMask;
        flags = (flags & ~f.flagsMask) | sel;
        continue;
      }
      const v = parseFloat(values[f.param] ?? '');
      if (!Number.isNaN(v)) nextParams[f.param] = v;
    }
    // structural change (gate input count) → caller reloads everything
    if (meta.type >= 19 && meta.type <= 26) {
      const nIn = flags & 0xff;
      const oldNIn = elm.flags & 0xff;
      if (nIn !== oldNIn && elm.posts.length > 2) {
        // relayout posts: keep first input & output, spread inputs vertically
        const out = elm.posts[elm.posts.length - 1];
        const firstIn = elm.posts[0];
        const m = (nIn - 1) / 2;
        const posts: [number, number][] = [];
        for (let i = 0; i < nIn; i++) {
          posts.push([firstIn[0], firstIn[1] + (i - m) * 40]);
        }
        posts.push(out);
        onApply(nextParams, flags, posts);
        onOpenChange(false);
        return;
      }
    }
    onApply(nextParams, flags);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm bg-card text-foreground sm:rounded-lg">
        <DialogHeader>
          <DialogTitle className="text-base">Edit {meta.name}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-2">
          {edits.map((f) => {
            if (f.kind === 'choice') {
              const current =
                f.param === -2 || (f.flagsMask !== undefined && f.flagsMask === 0xff)
                  ? choiceFlags & 0xff
                  : elm.params[f.param];
              return (
                <div key={f.label} className="grid grid-cols-3 items-center gap-2">
                  <Label className="text-xs text-muted-foreground">{f.label}</Label>
                  <select
                    className="col-span-2 h-8 rounded-md border border-border bg-muted px-2 text-xs"
                    value={current}
                    onChange={(e) => setChoiceFlags(Number(e.target.value))}
                  >
                    {(f.choices ?? []).map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
              );
            }
            return (
              <div key={f.label} className="grid grid-cols-3 items-center gap-2">
                <Label className="text-xs text-muted-foreground">
                  {f.label} {f.unit && <span className="text-muted-foreground/70">({f.unit})</span>}
                </Label>
                <Input
                  className="col-span-2 h-8 border-border bg-muted text-xs"
                  type="number"
                  step={f.step ?? 'any'}
                  value={values[f.param] ?? ''}
                  onChange={(e) => {
                    const next = [...values];
                    next[f.param] = e.target.value;
                    setValues(next);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && apply()}
                />
              </div>
            );
          })}
          {edits.length === 0 && (
            <p className="text-xs text-muted-foreground">This element has no editable parameters.</p>
          )}
          <p className="text-[10px] text-muted-foreground/70">
            Current: V = {fmtValue(elm.params[0] ?? 0, '')} · double-click any element to edit
          </p>
        </div>
        <DialogFooter>
          <Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={apply}>Apply</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
