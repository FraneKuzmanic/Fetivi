import type { BackofficeLanguage } from '../../../property/vocabulary';
import { en } from './en';
import { hr } from './hr';
import type { HostCopy } from './types';

export type { AccountMailCopy, HostCopy } from './types';

/** The emails and pushes to hosts in each back-office language (ticket 53). */
export const HOST_COPY: Record<BackofficeLanguage, HostCopy> = { en, hr };
