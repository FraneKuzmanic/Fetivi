import { describe, expect, it } from 'vitest';
import { topicsOf, withTopicHeadings } from './BlockBody';

const HOW_TOS = [
  'Washing machine',
  '',
  'Put the clothes in the drum. Pick 30 °C.',
  '',
  'Iron',
  '',
  'Set up the board first.',
].join('\n');

describe('topic lines', () => {
  it("finds the host's short title lines and makes them headings", () => {
    expect(topicsOf(HOW_TOS)).toEqual(['Washing machine', 'Iron']);
    expect(withTopicHeadings(HOW_TOS)).toBe(
      '# Washing machine\n\nPut the clothes in the drum. Pick 30 °C.\n\n# Iron\n\nSet up the board first.',
    );
  });

  it('leaves sentences, a last line, Markdown and raw HTML alone', () => {
    const body = [
      'Check-in is at 15:00.',
      '',
      '<script>window.hacked = true</script>',
      '',
      '- Load it',
      '',
      '[Manual](https://example.com)',
      '',
      '![x](http://evil.example/a.png)',
      '',
      'Thanks',
    ].join('\n');
    expect(topicsOf(body)).toEqual([]);
    expect(withTopicHeadings(body)).not.toContain('# ');
  });

  it('keeps the line breaks inside a paragraph', () => {
    expect(withTopicHeadings('Phone: 091 000\nE-mail: a@b.hr')).toBe(
      'Phone: 091 000  \nE-mail: a@b.hr',
    );
  });
});
