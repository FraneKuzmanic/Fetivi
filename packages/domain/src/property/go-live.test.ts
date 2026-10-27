import { describe, expect, it } from 'vitest';
import { allBlocksPublished, GO_LIVE_FIELD_ITEMS, GO_LIVE_TARGETS, goLiveCheck } from './go-live';
import { facts, MINIMUM } from './wizard.fixtures';
import type { WizardValues } from './wizard-config';

const approved = { approved: true };

/** The values that, when cleared, make each field item missing. */
const CLEAR: Record<(typeof GO_LIVE_FIELD_ITEMS)[number], Partial<WizardValues>> = {
  address: { city: null },
  check_in_time: { checkInTime: null },
  check_in_method: { checkInMethod: null },
  access_instructions: { accessInstructions: null },
  checkout_time: { checkoutTime: null },
  wifi: { noWifi: false },
  host_phone: { hostPhone: null },
};

describe('goLiveCheck', () => {
  it('is ready when approved, the minimum is met and blocks are published', () => {
    expect(goLiveCheck(facts(MINIMUM, approved))).toEqual({ ready: true, missing: [] });
  });

  it.each(GO_LIVE_FIELD_ITEMS)('misses %s on its own', (item) => {
    const check = goLiveCheck(facts({ ...MINIMUM, ...CLEAR[item] }, approved));
    expect(check).toEqual({ ready: false, missing: [item] });
  });

  it('needs approval', () => {
    expect(goLiveCheck(facts(MINIMUM)).missing).toEqual(['approval']);
  });

  it('accepts "no Wi-Fi", or a network with a password, but not a network alone', () => {
    const wifi = (v: Partial<WizardValues>) =>
      goLiveCheck(facts({ ...MINIMUM, noWifi: false, ...v }, approved)).missing;
    expect(wifi({ noWifi: true })).toEqual([]);
    expect(wifi({ wifiNetwork: 'Mare', wifiPassword: 'pw' })).toEqual([]);
    expect(wifi({ wifiNetwork: 'Mare' })).toEqual(['wifi']);
  });

  it('waits for the translations of a pending block', () => {
    const pending = facts(MINIMUM, {
      ...approved,
      blocks: [{ wizardKey: null, category: 'how_tos', revision: 2, publishedRevision: 1 }],
    });
    expect(goLiveCheck(pending).missing).toEqual(['translations']);
  });

  it('lists everything for an empty unit', () => {
    expect(goLiveCheck(facts()).missing).toEqual([
      'approval',
      'address',
      'check_in_time',
      'check_in_method',
      'access_instructions',
      'checkout_time',
      'wifi',
      'host_phone',
    ]);
  });
});

describe('allBlocksPublished', () => {
  it('is true for no blocks and for current revisions only', () => {
    expect(allBlocksPublished([])).toBe(true);
    expect(allBlocksPublished([{ revision: 1, publishedRevision: 1 }])).toBe(true);
    expect(allBlocksPublished([{ revision: 1, publishedRevision: null }])).toBe(false);
  });
});

describe('GO_LIVE_TARGETS', () => {
  it('links field items to their step and leaves approval and translations unlinked', () => {
    expect(GO_LIVE_TARGETS.wifi).toEqual({ stepId: 'wifi_essentials', fieldId: 'wifi' });
    expect(GO_LIVE_TARGETS.host_phone?.stepId).toBe('contacts_emergency');
    expect(GO_LIVE_TARGETS.approval).toBeNull();
    expect(GO_LIVE_TARGETS.translations).toBeNull();
  });
});
