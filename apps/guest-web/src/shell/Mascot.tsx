import { Mascot } from '@fetivi/ui';
import type { ReactNode } from 'react';

export { Mascot };

/** Fetivi beside a speech line. */
export function MascotSays({ children }: { children: ReactNode }) {
  return (
    <div className="mascot-says">
      <Mascot />
      <p className="speech">{children}</p>
    </div>
  );
}
