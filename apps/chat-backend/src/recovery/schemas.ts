import { z } from 'zod';
import { spaceEmail } from '../email/schemas';

export const recoveryRequestBody = z.object({ email: spaceEmail });
