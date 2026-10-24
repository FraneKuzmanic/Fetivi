import { describe, expect, it } from 'vitest';
import {
  commonsFileFromTags,
  commonsImageUrl,
  fetchCommonsImage,
  parseCommonsImage,
} from './commons';
import { readRecordedPage } from './testing';

const recorded = () => JSON.parse(readRecordedPage('commons-imageinfo.json'));

const KAMERLENGO = {
  url: 'https://upload.wikimedia.org/wikipedia/commons/8/89/Fortress_Kamerlengo_14.jpg',
  licence: 'CC BY-SA 4.0',
  attribution: 'Krzysztof Bergier',
  sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:Fortress_Kamerlengo_14.jpg',
};

describe('commonsFileFromTags', () => {
  it('reads wikimedia_commons and a Commons file page in image', () => {
    expect(commonsFileFromTags({ wikimedia_commons: 'File:Fortress_Kamerlengo_14.jpg' })).toBe(
      'File:Fortress Kamerlengo 14.jpg',
    );
    expect(
      commonsFileFromTags({
        image: 'https://commons.wikimedia.org/wiki/File:Trogir%20%C5%A0aldun.jpg',
      }),
    ).toBe('File:Trogir Šaldun.jpg');
  });

  it('gives null for a category, a non-Commons image or no tags', () => {
    expect(commonsFileFromTags({ wikimedia_commons: 'Category:Kamerlengo' })).toBeNull();
    expect(commonsFileFromTags({ image: 'https://konobatrs.hr/photo.jpg' })).toBeNull();
    expect(commonsFileFromTags(undefined)).toBeNull();
  });
});

describe('parseCommonsImage', () => {
  it('reads the recorded response: the original on upload.wikimedia.org, licence and artist', () => {
    expect(parseCommonsImage(recorded())).toEqual(KAMERLENGO);
  });

  it('gives null without an Artist', () => {
    const json = recorded();
    delete json.query.pages[0].imageinfo[0].extmetadata.Artist;
    expect(parseCommonsImage(json)).toBeNull();
  });

  it('gives null for a missing file or an unexpected shape', () => {
    expect(parseCommonsImage({ query: { pages: [{ missing: true }] } })).toBeNull();
    expect(parseCommonsImage('nope')).toBeNull();
  });
});

describe('fetchCommonsImage', () => {
  it('asks the Commons API with the user agent and parses the answer', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const image = await fetchCommonsImage(
      async (url, init) => {
        calls.push({ url: String(url), init });
        return new Response(JSON.stringify(recorded()), { status: 200 });
      },
      'Fetivi/test',
      'File:Fortress Kamerlengo 14.jpg',
    );
    expect(image).toEqual(KAMERLENGO);
    expect(calls[0]?.url).toBe(commonsImageUrl('File:Fortress Kamerlengo 14.jpg'));
    expect(new Headers(calls[0]?.init?.headers).get('user-agent')).toBe('Fetivi/test');
  });

  it('gives null on an error', async () => {
    const fail = async () => {
      throw new Error('down');
    };
    expect(await fetchCommonsImage(fail, 'Fetivi/test', 'File:x.jpg')).toBeNull();
  });
});
