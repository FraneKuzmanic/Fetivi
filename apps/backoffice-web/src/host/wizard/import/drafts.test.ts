import { WIZARD_COPY } from '@fetivi/domain/wizard';
import { describe, expect, it } from 'vitest';
import type { ManualDraftItem, ManualImport } from '../../../api';
import type { DraftValues } from '../targets';
import {
  columnInput,
  formatDraftValue,
  groupByStep,
  pendingByStep,
  savedSummary,
  summaryCounts,
} from './drafts';

const en = WIZARD_COPY.en;

const field = (
  id: string,
  fieldId: Extract<ManualDraftItem, { kind: 'field' }>['fieldId'],
  values: Extract<ManualDraftItem, { kind: 'field' }>['values'],
  status: ManualDraftItem['status'] = 'pending',
): ManualDraftItem => ({ id, status, kind: 'field', fieldId, values });

const block = (id: string, category: 'how_tos' | 'arrival_access'): ManualDraftItem => ({
  id,
  status: 'pending',
  kind: 'block',
  category,
  wizardKey: null,
  title: 'T',
  body: 'B',
  scrubbed: false,
  warnings: [],
});

const ITEMS: ManualDraftItem[] = [
  block('d1', 'how_tos'),
  field('d2', 'checkout_time', { checkoutTime: '10:00' }),
  field('d3', 'check_in_time', { checkInTime: '15:00' }, 'confirmed'),
  { id: 'd4', status: 'pending', kind: 'amenities', amenities: [{ amenity: 'ac', note: null }] },
  { id: 'd5', status: 'pending', kind: 'unmapped', text: 'Cat', fieldId: null },
  block('d6', 'arrival_access'),
];

const manualImport = (items: ManualDraftItem[]): ManualImport => ({
  id: 'i1',
  source: 'paste',
  createdAt: '2026-10-22T10:00:00Z',
  items,
});

describe('import review helpers', () => {
  it('groups drafts by wizard step in wizard order, unmapped apart', () => {
    const { steps, unmapped } = groupByStep(ITEMS);
    expect(steps.map(([step, items]) => [step, items.map((i) => i.id)])).toEqual([
      ['arrival_access', ['d3', 'd6']],
      ['wifi_essentials', ['d4']],
      ['house_rules_checkout', ['d2']],
      ['how_tos', ['d1']],
    ]);
    expect(unmapped.map((i) => i.id)).toEqual(['d5']);
  });

  it('counts pending drafts per step, ignoring resolved ones', () => {
    expect(pendingByStep(manualImport(ITEMS))).toEqual({
      total: 5,
      byStep: { arrival_access: 1, wifi_essentials: 1, house_rules_checkout: 1, how_tos: 1 },
    });
    expect(pendingByStep(null)).toEqual({ total: 0, byStep: {} });
    expect(summaryCounts(ITEMS)).toEqual({ pending: 5, confirmed: 1, dismissed: 0 });
  });

  it('formats values for the host', () => {
    expect(formatDraftValue('checkInTime', '15:00:00', en)).toBe('15:00');
    expect(formatDraftValue('checkInMethod', 'keypad', en)).toBe(en.checkInMethods.keypad);
    expect(formatDraftValue('parkingType', 'free_street', en)).toBe(en.parkingTypes.free_street);
    expect(formatDraftValue('petsAllowed', false, en)).toBe('No');
    expect(formatDraftValue('noWifi', true, en)).toBe('Yes');
    expect(
      formatDraftValue(
        'beds',
        [
          { type: 'double', count: 2 },
          { type: 'single', count: 1 },
        ],
        en,
      ),
    ).toBe(`2 × ${en.bedTypes.double}, 1 × ${en.bedTypes.single}`);
    expect(formatDraftValue('hostPhone', null, en)).toBe(en.ui.notSet);
    expect(formatDraftValue('wifiPassword', 'sunce2024', en)).toBe('sunce2024');
  });

  it('picks an input per column', () => {
    expect(columnInput('checkoutTime')).toBe('time');
    expect(columnInput('parkingType')).toBe('enum');
    expect(columnInput('smokingAllowed')).toBe('tri');
    expect(columnInput('noWifi')).toBe('bool');
    expect(columnInput('bedrooms')).toBe('int');
    expect(columnInput('houseRulesNotes')).toBe('long');
    expect(columnInput('emergencyContactPhone')).toBe('phone');
    expect(columnInput('beds')).toBe('beds');
    expect(columnInput('wifiNetwork')).toBe('text');
  });

  it('shows the saved value only when one is set and differs', () => {
    const loaded = { checkoutTime: '11:00:00', checkInTime: '15:00:00', city: null } as DraftValues;
    const draft = field('d1', 'checkout_time', { checkoutTime: '10:00' });
    if (draft.kind !== 'field') throw new Error('field');
    expect(savedSummary(draft, loaded, en)).toBe('11:00');
    const same = field('d2', 'check_in_time', { checkInTime: '15:00' });
    if (same.kind !== 'field') throw new Error('field');
    expect(savedSummary(same, loaded, en)).toBeNull();
    const unset = field('d3', 'address', { city: 'Trogir' });
    if (unset.kind !== 'field') throw new Error('field');
    expect(savedSummary(unset, loaded, en)).toBeNull();
  });

  it('labels the saved value of a draft that holds one column of a multi-column field', () => {
    const loaded = { quietHoursFrom: '22:00:00', quietHoursTo: '07:30:00' } as DraftValues;
    const draft = field('d1', 'quiet_hours', { quietHoursTo: '07:00' });
    if (draft.kind !== 'field') throw new Error('field');
    expect(savedSummary(draft, loaded, en)).toBe('Until 07:30');
  });
});
