import { describe, expect, it } from 'vitest';
import {
  TIPS_UNSUBSCRIBE_TOKEN,
  tipsUnsubscribeToken,
  tipsUnsubscribeUrls,
  verifyTipsUnsubscribe,
} from './unsubscribe';

const SECRET = 'x'.repeat(32);
const SPACE = '6f1c2a3b-4d5e-4f60-8a71-92b3c4d5e6f7';
const OTHER = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

describe('tips unsubscribe token', () => {
  it('is deterministic, 43 characters, and verifies for its own space', () => {
    const token = tipsUnsubscribeToken(SECRET, SPACE);
    expect(token).toMatch(TIPS_UNSUBSCRIBE_TOKEN);
    expect(tipsUnsubscribeToken(SECRET, SPACE)).toBe(token);
    expect(verifyTipsUnsubscribe(SECRET, SPACE, token)).toBe(true);
  });

  it('fails for another space, another secret, or a token of the wrong length', () => {
    const token = tipsUnsubscribeToken(SECRET, SPACE);
    expect(verifyTipsUnsubscribe(SECRET, OTHER, token)).toBe(false);
    expect(verifyTipsUnsubscribe('y'.repeat(32), SPACE, token)).toBe(false);
    expect(verifyTipsUnsubscribe(SECRET, SPACE, token.slice(1))).toBe(false);
    expect(verifyTipsUnsubscribe(SECRET, SPACE, '')).toBe(false);
  });

  it('builds the page and one-click URLs without the email address', () => {
    const token = tipsUnsubscribeToken(SECRET, SPACE);
    expect(tipsUnsubscribeUrls('https://app.fetivi.hr/', SPACE, token)).toEqual({
      page: `https://app.fetivi.hr/unsubscribe-tips?space=${SPACE}&token=${token}`,
      oneClick: `https://app.fetivi.hr/api/email/tips/unsubscribe?space=${SPACE}&token=${token}`,
    });
  });
});
