import { LIMITS } from '@fetivi/domain';
import { z } from 'zod';
import { line } from '../properties/schemas';

/** Single-line, so each caption is exactly one bullet in the translation call. */
const caption = line(LIMITS.caption);

export const CaptionQuery = z.strictObject({ caption });
export const CaptionPatch = z.strictObject({ caption });
export const IdParams = z.object({ id: z.uuid() });
