import type { ReactNode } from 'react';
import { Mascot } from '../shell/Mascot';

/**
 * The onboarding's centre: Fetivi standing in a pale porthole, his speech balloon above him.
 * `large` on the first screen, where he introduces himself; `medium` on the steps after it.
 */
export function FetiviStage({
  size = 'medium',
  children,
}: {
  size?: 'large' | 'medium';
  children: ReactNode;
}) {
  return (
    <div className="stage" data-size={size}>
      <div className="stage-speech">{children}</div>
      <div className="stage-porthole">
        <Mascot className="stage-mascot" />
      </div>
    </div>
  );
}
