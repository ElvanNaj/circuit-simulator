'use client';

// Keyboard shortcut cheat-sheet — opened with ? or the toolbar keyboard button.

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

const GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: 'Components',
    items: [
      ['P', 'Quick component search'],
      ['Enter', 'Edit selected element'],
      ['Esc', 'Cancel tool / clear selection'],
      ['R', 'Rotate selection 90°'],
      ['Ctrl+D', 'Duplicate selection'],
      ['Del / Backspace', 'Delete selection'],
      ['Ctrl+A', 'Select all'],
      ['Shift+click', 'Add or remove from selection'],
      ['Double-click', 'Edit element value'],
    ],
  },
  {
    title: 'Simulation & view',
    items: [
      ['Space', 'Run / pause simulation'],
      ['F', 'Fit circuit to view'],
      ['[', 'Collapse / expand component sidebar'],
      ['Wheel', 'Zoom at cursor'],
      ['Alt+drag / middle-drag', 'Pan the canvas'],
    ],
  },
  {
    title: 'Files & history',
    items: [
      ['Ctrl+S', 'Save circuit file'],
      ['Ctrl+O', 'Open circuit file'],
      ['Ctrl+Z', 'Undo'],
      ['Ctrl+Shift+Z / Ctrl+Y', 'Redo'],
      ['?', 'Show this help'],
    ],
  },
];

export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md border-border bg-card text-foreground">
        <DialogTitle className="text-base">Keyboard shortcuts</DialogTitle>
        <DialogDescription className="sr-only">
          All keyboard shortcuts available in the circuit simulator.
        </DialogDescription>
        <div className="grid gap-4 py-1">
          {GROUPS.map((group) => (
            <div key={group.title}>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                {group.title}
              </div>
              <div className="grid gap-1">
                {group.items.map(([keys, label]) => (
                  <div key={keys} className="flex items-center justify-between gap-4 text-xs">
                    <span className="text-muted-foreground">{label}</span>
                    <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground/90">
                      {keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-muted-foreground/70">
          Shortcuts are ignored while typing in a field or while a dialog is open.
        </p>
      </DialogContent>
    </Dialog>
  );
}
