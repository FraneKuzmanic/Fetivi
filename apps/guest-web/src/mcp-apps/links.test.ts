import { describe, expect, it } from 'vitest';
import { isFerryhopperLink } from './links';

describe('isFerryhopperLink', () => {
  it("accepts Ferryhopper's booking link as recorded", () => {
    expect(
      isFerryhopperLink(
        'https://www.ferryhopper.com/en/booking/results?utm_source=llm_mcp&aff_uid=mcpint&IDSCode=abc',
      ),
    ).toBe(true);
    expect(isFerryhopperLink('https://ferryhopper.com/')).toBe(true);
  });

  it('refuses everything else', () => {
    for (const url of [
      'https://evil.example',
      'https://ferryhopper.com.evil.example',
      'https://evilferryhopper.com',
      'http://www.ferryhopper.com',
      'javascript:alert(1)',
      'not a url',
    ]) {
      expect(isFerryhopperLink(url), url).toBe(false);
    }
  });
});
