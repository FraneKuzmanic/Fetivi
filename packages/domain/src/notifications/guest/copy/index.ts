import type { GuestLanguage } from '../../../property/vocabulary';
import { de } from './de';
import { en } from './en';
import { fr } from './fr';
import { hr } from './hr';
import { hu } from './hu';
import { it } from './it';
import { pl } from './pl';
import type { GuestCopy } from './types';

export type { GuestCopy, KindCopy } from './types';

/** The guest notifications' email and push text in every guest language. */
export const GUEST_COPY: Record<GuestLanguage, GuestCopy> = { en, hr, de, it, pl, hu, fr };
