'use client';

import { useSearchParams } from 'next/navigation';
import Oscilloscope from './Oscilloscope';
import SimDemo from './SimDemo';

/**
 * Route switcher on the single exposed route:
 *   `/`            -> the Z-DSO 2104 oscilloscope (open in a dedicated window)
 *   `/?view=sim`   -> reference circuit-simulator demo (RC filter) that
 *                     streams into the scope via BroadcastChannel
 */
export default function ScopeApp() {
  const sp = useSearchParams();
  if (sp.get('view') === 'sim') return <SimDemo />;
  return <Oscilloscope />;
}
