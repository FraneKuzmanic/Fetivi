import { z } from 'zod';
import { spaceEmail, tokenBody } from '../email/schemas';

export const recoveryRequestBody = z.object({ email: spaceEmail });

export const restoreBody = tokenBody;
