import {
  type BlockMediaRow,
  type BlockRow,
  blockMedia,
  type Db,
  enqueueTranslation,
  infoBlocks,
  type JobQueue,
  LIMITS,
  MEDIA_TYPES,
  type MediaContentType,
  mediaFileName,
  type Tx,
} from '@fetivi/domain';
import { and, eq, sql } from 'drizzle-orm';
import { HttpError } from '../http-error';
import { ownedBlockCondition } from '../properties/store';

// Adding an item or changing a caption is a new block revision, so the captions are translated
// and published with the block (ADR 0003). Removing one needs no translation: no bump.

const notFound = () => new HttpError(404, 'not-found');

async function lockOwnedBlock(tx: Tx, hostId: string, blockId: string) {
  const [block] = await tx
    .select()
    .from(infoBlocks)
    .where(and(eq(infoBlocks.id, blockId), ownedBlockCondition(tx, hostId)))
    .for('update');
  if (!block) throw notFound();
  return block;
}

/** The new revision, pending translation, with its job enqueued in the same transaction. */
async function bumpRevision(tx: Tx, queue: JobQueue, current: BlockRow, now: Date) {
  const [block] = await tx
    .update(infoBlocks)
    .set({
      revision: current.revision + 1,
      translationStatus: 'pending',
      translationError: null,
      sourceLanguage: null,
      updatedAt: now,
    })
    .where(eq(infoBlocks.id, current.id))
    .returning();
  if (!block) throw notFound();
  await enqueueTranslation(tx, queue, block);
  return block;
}

export async function addMedia(
  db: Db,
  queue: JobQueue,
  input: {
    id: string;
    blockId: string;
    hostId: string;
    contentType: MediaContentType;
    bytes: number;
    caption: string;
    now: Date;
  },
): Promise<{ media: BlockMediaRow; block: BlockRow }> {
  return db.transaction(async (tx) => {
    const current = await lockOwnedBlock(tx, input.hostId, input.blockId);
    const [count] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(blockMedia)
      .where(eq(blockMedia.blockId, current.id));
    const n = count?.n ?? 0;
    if (n >= LIMITS.mediaPerBlock) throw new HttpError(400, 'too-many-media');
    const [media] = await tx
      .insert(blockMedia)
      .values({
        id: input.id,
        blockId: current.id,
        kind: MEDIA_TYPES[input.contentType].kind,
        contentType: input.contentType,
        bytes: input.bytes,
        caption: input.caption,
        addedRevision: current.revision + 1,
        position: n,
        createdAt: input.now,
      })
      .returning();
    if (!media) throw new Error('media insert returned nothing');
    return { media, block: await bumpRevision(tx, queue, current, input.now) };
  });
}

async function findOwnedMedia(tx: Tx, hostId: string, mediaId: string) {
  const [row] = await tx
    .select({ media: blockMedia })
    .from(blockMedia)
    .innerJoin(infoBlocks, eq(infoBlocks.id, blockMedia.blockId))
    .where(and(eq(blockMedia.id, mediaId), ownedBlockCondition(tx, hostId)));
  if (!row) throw notFound();
  return row.media;
}

/** A changed caption is a new revision; the same caption changes nothing. */
export async function updateCaption(
  db: Db,
  queue: JobQueue,
  input: { mediaId: string; hostId: string; caption: string; now: Date },
): Promise<{ media: BlockMediaRow; block: BlockRow }> {
  return db.transaction(async (tx) => {
    const found = await findOwnedMedia(tx, input.hostId, input.mediaId);
    const current = await lockOwnedBlock(tx, input.hostId, found.blockId);
    if (found.caption === input.caption) return { media: found, block: current };
    const [media] = await tx
      .update(blockMedia)
      .set({ caption: input.caption })
      .where(eq(blockMedia.id, found.id))
      .returning();
    if (!media) throw notFound();
    return { media, block: await bumpRevision(tx, queue, current, input.now) };
  });
}

/** Removes the row and returns the file name to remove after the commit. */
export async function deleteMedia(
  db: Db,
  input: { mediaId: string; hostId: string },
): Promise<string> {
  return db.transaction(async (tx) => {
    const found = await findOwnedMedia(tx, input.hostId, input.mediaId);
    await tx.delete(blockMedia).where(eq(blockMedia.id, found.id));
    return mediaFileName(found.id, found.contentType as MediaContentType);
  });
}

/** A media item the host owns, for the preview. */
export async function findOwnedMediaFile(db: Db, hostId: string, mediaId: string) {
  const found = await db.transaction((tx) => findOwnedMedia(tx, hostId, mediaId));
  const contentType = found.contentType as MediaContentType;
  return { fileName: mediaFileName(found.id, contentType), contentType };
}
