import { WIZARD_STEP_IDS } from '@fetivi/domain/wizard';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { WizardStatus } from '../../api';
import { SessionProvider } from '../../session';
import { GoLivePanel } from './GoLivePanel';
import { WizardOverview } from './WizardOverview';

const steps = {} as WizardStatus['progress']['steps'];
for (const s of WIZARD_STEP_IDS) {
  steps[s] = { filled: 0, total: 0, missingRequired: [], missingRecommended: [] };
}

const status = (over: Partial<WizardStatus> = {}): WizardStatus => ({
  unitId: 'u1',
  propertyId: 'p1',
  unitName: 'Studio',
  propertyName: 'Villa',
  propertyType: 'villa',
  approved: true,
  live: false,
  fields: {},
  progress: {
    percent: 100,
    filled: 0,
    total: 0,
    steps,
  },
  resumeStep: null,
  goLive: { ready: false, missing: [] },
  ...over,
});

const render = (node: React.ReactNode) =>
  renderToString(
    <MemoryRouter>
      <SessionProvider>{node}</SessionProvider>
    </MemoryRouter>,
  );

const panel = (s: WizardStatus) =>
  render(<GoLivePanel status={s} busy={false} onGoLive={() => {}} onRefresh={async () => {}} />);

describe('GoLivePanel', () => {
  it('links to the QR code once the unit is live', () => {
    expect(panel(status({ live: true }))).toContain('href="/api/host/units/u1/qr?format=svg"');
    expect(panel(status())).not.toContain('/qr?format=svg');
  });

  it('links pending translations to the unit page blocks', () => {
    const html = panel(status({ goLive: { ready: false, missing: ['translations'] } }));
    expect(html).toContain('href="/units/u1#guest-information"');
  });
});

describe('WizardOverview', () => {
  it('does not mark a step without questions as done', () => {
    const html = render(
      <WizardOverview status={status()} busy={false} onTypeChange={() => {}} goLivePanel={null} />,
    );
    expect(html).toContain('Nothing to fill in');
    // Every other step has no missing fields here, so it is Done.
    expect(html.match(/>Done</g)).toHaveLength(WIZARD_STEP_IDS.length - 1);
  });
});
