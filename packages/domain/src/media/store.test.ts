import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createLocalMediaStore, mediaFileName } from './store';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'fetivi-media-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('createLocalMediaStore', () => {
  it('writes a file that reads back, with no temp file left', async () => {
    const store = createLocalMediaStore(path.join(dir, 'nested'));
    await store.put('a.png', new Uint8Array([1, 2, 3]));
    expect([...(await readFile(path.join(dir, 'nested', 'a.png')))]).toEqual([1, 2, 3]);
    expect(await readdir(path.join(dir, 'nested'))).toEqual(['a.png']);
  });

  it('removes files and ignores missing ones', async () => {
    const store = createLocalMediaStore(dir);
    await store.put('a.png', new Uint8Array([1]));
    await store.remove(['a.png', 'missing.jpg']);
    expect(await readdir(dir)).toEqual([]);
  });

  it('never writes outside its directory', async () => {
    const store = createLocalMediaStore(path.join(dir, 'inner'));
    await store.put('../escape.png', new Uint8Array([1]));
    expect(await readdir(path.join(dir, 'inner'))).toEqual(['escape.png']);
  });
});

describe('mediaFileName', () => {
  it('uses the extension of the content type', () => {
    expect(mediaFileName('id1', 'video/webm')).toBe('id1.webm');
    expect(mediaFileName('id1', 'image/jpeg')).toBe('id1.jpg');
  });
});
