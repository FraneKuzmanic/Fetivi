import { afterEach, describe, expect, it, vi } from 'vitest';
import { isFerryhopperLink, openFerryhopperLink } from './links';

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

describe('openFerryhopperLink', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refuses a link outside the allowlist without opening anything', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    for (const url of ['https://www.ferryhopper.com.evil.io/x', 'javascript:alert(1)']) {
      expect(openFerryhopperLink(url), url).toEqual({ isError: true });
    }
    expect(open).not.toHaveBeenCalled();
  });

  it('opens an allowed link unchanged in a new tab with no opener', () => {
    const open = vi.fn();
    vi.stubGlobal('window', { open });
    const url = 'https://www.ferryhopper.com/en/booking/results?utm_source=llm_mcp&aff_uid=mcpint';
    expect(openFerryhopperLink(url)).toEqual({});
    expect(open).toHaveBeenCalledWith(url, '_blank', 'noopener,noreferrer');
  });
});
