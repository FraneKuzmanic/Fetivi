import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { eq, inArray, or, type SQL } from 'drizzle-orm';
import type { Executor } from '../db/client';
import { blockMedia } from '../db/schema/block-media';
import { infoBlocks } from '../db/schema/info-blocks';
import { units } from '../db/schema/properties';
import { MEDIA_TYPES, type MediaContentType } from '../property/vocabulary';

/** Where media bytes live. Local disk now; an object store can implement the same interface. */
export interface MediaStore {
  readonly dir: string;
  put(fileName: string, bytes: Uint8Array): Promise<void>;
  /** Missing files are ignored. */
  remove(fileNames: readonly string[]): Promise<void>;
}

export const mediaFileName = (id: string, contentType: MediaContentType) =>
  `${id}.${MEDIA_TYPES[contentType].ext}`;

/** `dir` is resolved against the working directory. */
export function createLocalMediaStore(relativeDir: string): MediaStore {
  const dir = path.resolve(relativeDir);
  const file = (name: string) => path.join(dir, path.basename(name));
  return {
    dir,
    async put(fileName, bytes) {
      await mkdir(dir, { recursive: true });
      // Written aside, then renamed: a reader never sees a half-written file.
      const tmp = `${file(fileName)}.tmp`;
      await writeFile(tmp, bytes);
      await rename(tmp, file(fileName));
    },
    async remove(fileNames) {
      await Promise.all(fileNames.map((name) => rm(file(name), { force: true })));
    },
  };
}

/**
 * The file names of the media an owner's blocks hold, read before a delete so the files can be
 * removed after it. A property owns its own blocks and those of its units.
 */
export async function mediaFilesOf(
  db: Executor,
  owner: { blockIds: string[] } | { propertyId: string } | { unitId: string },
): Promise<string[]> {
  let where: SQL | undefined;
  if ('blockIds' in owner) {
    if (owner.blockIds.length === 0) return [];
    where = inArray(blockMedia.blockId, owner.blockIds);
  } else if ('unitId' in owner) {
    where = eq(infoBlocks.unitId, owner.unitId);
  } else {
    const unitIds = db
      .select({ id: units.id })
      .from(units)
      .where(eq(units.propertyId, owner.propertyId));
    where = or(eq(infoBlocks.propertyId, owner.propertyId), inArray(infoBlocks.unitId, unitIds));
  }
  const rows = await db
    .select({ id: blockMedia.id, contentType: blockMedia.contentType })
    .from(blockMedia)
    .innerJoin(infoBlocks, eq(infoBlocks.id, blockMedia.blockId))
    .where(where);
  return rows.map((r) => mediaFileName(r.id, r.contentType as MediaContentType));
}
