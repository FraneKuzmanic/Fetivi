import type { ReactNode } from 'react';
import { Mascot } from '../shell/Mascot';

/**
 * The onboarding's centre: Fetivi standing in a pale porthole, his speech balloon above him.
 * The same on every step (intro, language, PIN).
 */
export function FetiviStage({ children }: { children: ReactNode }) {
  return (
    <div className="stage">
      <div className="stage-speech">{children}</div>
      <div className="stage-porthole">
        <Mascot className="stage-mascot" />
      </div>
    </div>
  );
}
