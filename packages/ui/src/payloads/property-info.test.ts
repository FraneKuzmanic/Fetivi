import { describe, expect, it } from 'vitest';
import { projection } from '../components/fixtures';
import { propertyInfo, propertyInfoCard } from './property-info';

const keys = (card: ReturnType<typeof propertyInfo>) => card.fields.map((f) => f.key);
const media = (n: number, prefix: string) =>
  Array.from({ length: n }, (_, i) => ({
    id: `${prefix}${i}`,
    kind: 'image' as const,
    caption: 'c',
  }));

describe('propertyInfo', () => {
  it('holds arrival details back before the release and says when they appear', () => {
    const card = propertyInfo(projection(false), 'arrival');
    expect(card.releaseAt).toBe('2026-10-19T22:00:00.000Z');
    expect(keys(card)).toEqual(['checkInTime', 'checkInMethod']);
    expect(card.fields[0]).toEqual({ key: 'checkInTime', value: '15:00', action: 'text' });
  });

  it('says nothing about a release when nothing is held back', () => {
    const quiet = projection(false, {
      stay: { ...projection(false).stay, arrivalDetailsPending: false },
    });
    for (const topic of ['arrival', 'wifi', 'contacts'] as const) {
      const card = propertyInfo(quiet, topic);
      expect(card.releaseAt).toBeNull();
      expect(card.fields).toEqual(propertyInfo(projection(false), topic).fields);
    }
  });

  it('shows the codes with copy buttons after the release', () => {
    const card = propertyInfo(projection(true), 'arrival');
    expect(card.releaseAt).toBeNull();
    expect(card.fields.filter((f) => f.action === 'copy')).toEqual([
      { key: 'buildingDoorCode', value: 'B-1234', action: 'copy' },
      { key: 'lockboxCode', value: 'L-9020', action: 'copy' },
    ]);
  });

  it('shows only 112 and the contact name in contacts before the release', () => {
    const card = propertyInfo(projection(false), 'contacts');
    expect(card.fields).toEqual([
      { key: 'emergencyNumber', value: '112', action: 'tel' },
      { key: 'emergencyContactName', value: 'Ana', action: 'text' },
    ]);
    const after = propertyInfo(projection(true), 'contacts');
    expect(keys(after)).toEqual([
      'emergencyNumber',
      'hostPhone',
      'emergencyContactName',
      'emergencyContact',
    ]);
  });

  it('gives the network before the release and the password after', () => {
    expect(propertyInfo(projection(false), 'wifi').fields).toEqual([
      { key: 'wifiNetwork', value: 'Mare', action: 'copy' },
    ]);
    expect(keys(propertyInfo(projection(true), 'wifi'))).toEqual(['wifiNetwork', 'wifiPassword']);
  });

  it('has no fields and nothing gated when the unit has no Wi-Fi', () => {
    const card = propertyInfo(projection(true, { wifi: null }), 'wifi');
    expect(card.fields).toEqual([]);
    expect(card.releaseAt).toBeNull();
  });

  it('labels house rules as yes or no and skips unset ones', () => {
    const card = propertyInfo(projection(false), 'checkout');
    expect(card.releaseAt).toBeNull();
    expect(card.fields).toEqual([
      { key: 'checkoutTime', value: '10:00', action: 'text' },
      { key: 'quietHours', value: '22:00–08:00', action: 'text' },
      { key: 'pets', value: 'no', action: 'text' },
      { key: 'parties', value: 'no', action: 'text' },
      { key: 'houseRulesNotes', value: 'Shoes off inside.', action: 'text' },
    ]);
  });

  it("takes up to six media items from the topic's section only", () => {
    const p = projection(true, {
      blocks: [
        { category: 'how_tos', title: 'T', body: 'B', media: media(2, 'h') },
        { category: 'wifi_essentials', title: 'T', body: 'B', media: media(4, 'w') },
        { category: 'wifi_essentials', title: 'T2', body: 'B', media: media(4, 'x') },
      ],
    });
    const card = propertyInfo(p, 'wifi');
    expect(card.media.map((m) => m.id)).toEqual(['w0', 'w1', 'w2', 'w3', 'x0', 'x1']);
    expect(propertyInfo(p, 'arrival').media).toEqual([]);
  });

  it('builds payloads that pass the contract', () => {
    for (const released of [false, true]) {
      for (const topic of ['arrival', 'wifi', 'checkout', 'contacts'] as const) {
        expect(propertyInfoCard.safeParse(propertyInfo(projection(released), topic)).success).toBe(
          true,
        );
      }
    }
  });
});
