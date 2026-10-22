import { describe, expect, it } from 'vitest';
import { hostNotificationSettingsInput } from './settings';

const parse = (value: unknown) => hostNotificationSettingsInput.safeParse(value);

describe('host notification settings input', () => {
  it('sorts and dedupes the digest times', () => {
    const result = parse({ mode: 'digest', digestTimes: ['19:00', '09:00', '19:00', '14:00'] });
    expect(result.success && result.data).toEqual({
      mode: 'digest',
      digestTimes: ['09:00', '14:00', '19:00'],
    });
  });

  it.each([['24:00'], ['9:00'], ['09:60'], ['']])('rejects the time %j', (time) => {
    expect(parse({ mode: 'digest', digestTimes: [time] }).success).toBe(false);
  });

  it('rejects an empty list and more than six times', () => {
    expect(parse({ mode: 'digest', digestTimes: [] }).success).toBe(false);
    const seven = ['01:00', '02:00', '03:00', '04:00', '05:00', '06:00', '07:00'];
    expect(parse({ mode: 'digest', digestTimes: seven }).success).toBe(false);
  });

  it('rejects an unknown mode and unknown keys', () => {
    expect(parse({ mode: 'weekly', digestTimes: ['09:00'] }).success).toBe(false);
    expect(parse({ mode: 'digest', digestTimes: ['09:00'], sms: true }).success).toBe(false);
  });

  it('accepts Immediate with times kept', () => {
    expect(parse({ mode: 'immediate', digestTimes: ['09:00'] }).success).toBe(true);
  });
});
