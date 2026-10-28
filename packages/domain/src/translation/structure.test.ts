import { describe, expect, it } from 'vitest';
import { checkStructure } from './structure';

const source = {
  title: 'Parking and the {{gate_code}}',
  body: [
    '## Parking',
    '',
    'The gate code is {{gate_code}}.',
    '',
    '1. Drive to the gate.',
    '2. Enter the code.',
    '3. Park in spot 4.',
    '',
    '### Nearby',
    '',
    '- Public garage: [map](https://maps.example.com/garage)',
    '- Street parking, see https://split.example.hr/zones',
  ].join('\n'),
};

const withBody = (from: string, to: string) => ({
  ...source,
  body: source.body.replace(from, to),
});

describe('checkStructure', () => {
  it('passes a source against itself', () => {
    expect(checkStructure(source, source)).toEqual([]);
  });

  it('passes a translation that keeps the structure', () => {
    const translated = {
      title: 'Parkiranje i {{gate_code}}',
      body: [
        '## Parkiranje',
        '',
        'Kod vrata je {{gate_code}}.',
        '',
        '1. Vozite do vrata.',
        '2. Unesite kod.',
        '3. Parkirajte na mjesto 4.',
        '',
        '### U blizini',
        '',
        '- Javna garaža: [karta](https://maps.example.com/garage)',
        '- Parkiranje na ulici, vidi https://split.example.hr/zones',
      ].join('\n'),
    };
    expect(checkStructure(source, translated)).toEqual([]);
  });

  it('fails a dropped heading', () => {
    expect(checkStructure(source, withBody('### Nearby\n', ''))).toEqual([
      'body: headings [2,3] vs [2]',
    ]);
  });

  it('fails a changed heading level', () => {
    expect(checkStructure(source, withBody('### Nearby', '## Nearby'))).toEqual([
      'body: headings [2,3] vs [2,2]',
    ]);
  });

  it('fails a dropped list item', () => {
    expect(checkStructure(source, withBody('- Public garage', 'Public garage'))).toEqual([
      'body: list items 2 vs 1',
    ]);
  });

  it('fails a renumbered step', () => {
    expect(checkStructure(source, withBody('3. Park', '4. Park'))).toEqual([
      'body: steps [1,2,3] vs [1,2,4]',
    ]);
  });

  it('fails a changed link URL', () => {
    const problems = checkStructure(source, withBody('/garage)', '/garaza)'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^body: links/);
  });

  it('fails a translated placeholder name', () => {
    const problems = checkStructure(source, withBody('is {{gate_code}}', 'is {{kod_vrata}}'));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^body: placeholders/);
  });

  it('fails a dropped brace', () => {
    const problems = checkStructure(source, withBody('is {{gate_code}}', 'is {gate_code}}'));
    expect(problems).toContain("body: '{' count 2 vs 1");
  });

  it('checks placeholders and links in the title', () => {
    const problems = checkStructure(source, { ...source, title: 'Parking and the gate code' });
    expect(problems.some((p) => p.startsWith('title: placeholders'))).toBe(true);
  });

  it('ignores headings and lists in the title', () => {
    const plain = { title: '# Wi-Fi', body: 'x' };
    expect(checkStructure(plain, { title: 'Wi-Fi', body: 'y' })).toEqual([]);
  });
});

describe('checkStructure links', () => {
  const block = (body: string) => ({ title: 'Kontakti', body });
  const check = (source: string, output: string) =>
    checkStructure(block(source), { title: 'Contacts', body: output });

  it.each([
    ['a plain URL ending a sentence', 'Book at https://x.hr.', 'Rezervirajte na https://x.hr.'],
    [
      'a plain URL moved away from the full stop',
      'Rezervirajte na https://x.hr.',
      'Foglaljon a https://x.hr oldalon.',
    ],
    ['a plain URL in brackets', 'Pharmacy (https://x.hr/a).', 'Ljekarna (https://x.hr/a).'],
    ['a Markdown link', 'See the [map](https://m.hr/p?q=1).', 'Vidi [kartu](https://m.hr/p?q=1).'],
    ['a tel: link', '[Call](tel:+385911234567)', '[Nazovite](tel:+385911234567)'],
    ['a mailto: link', '[Email](mailto:a@b.hr)', '[E-pošta](mailto:a@b.hr)'],
    ['an angle-bracket autolink', 'Web: <https://x.hr>', 'Web: <https://x.hr>'],
    ['an unfinished toolbar link', '[KBC Split](https://)', '[KBC Split](https://)'],
    [
      'several links',
      '- [194](tel:194)\n- https://x.hr, 0-24\n- [mail](mailto:a@b.hr) or [chat](https://wa.me/1)',
      '- [194](tel:194)\n- https://x.hr, 0-24\n- [e-mail](mailto:a@b.hr) ili [chat](https://wa.me/1)',
    ],
    [
      'a plain URL the model wrapped as a link',
      'Pharmacy: https://x.hr',
      'Ljekarna: [https://x.hr](https://x.hr)',
    ],
  ])('passes %s', (_name, source, output) => {
    expect(check(source, output)).toEqual([]);
  });

  it.each([
    ['a changed URL', 'See https://x.hr/a', 'Vidi https://x.hr/b'],
    ['a dropped link', '[map](https://m.hr) and https://x.hr', 'karta i https://x.hr'],
    ['a changed tel: number', '[Call](tel:+385911234567)', '[Nazovite](tel:+385911234568)'],
    ['a changed mailto: address', '[Email](mailto:a@b.hr)', '[E-pošta](mailto:b@b.hr)'],
    ['an added link', 'Call the host.', 'Nazovite [domaćina](tel:+385911234567).'],
    [
      'links in another order',
      '[a](https://a.hr) [b](https://b.hr)',
      '[b](https://b.hr) [a](https://a.hr)',
    ],
  ])('fails %s', (_name, source, output) => {
    const problems = check(source, output);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^body: links/);
  });
});
