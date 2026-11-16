'use client';

import dynamic from 'next/dynamic';

const CircuitSimulator = dynamic(
  () => import('@/components/sim/CircuitSimulator').then((m) => m.CircuitSimulator),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Loading circuit simulator…
      </div>
    ),
  }
);

export default function Home() {
  return <CircuitSimulator />;
}
