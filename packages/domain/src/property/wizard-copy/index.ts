import type { GuestLanguage } from '../vocabulary';
import { de } from './de';
import { en } from './en';
import { fr } from './fr';
import { hr } from './hr';
import { hu } from './hu';
import { it } from './it';
import { pl } from './pl';
import type { WizardCopy } from './types';

export type { WizardCopy } from './types';

/** The wizard's copy in every back-office language. */
export const WIZARD_COPY: Record<GuestLanguage, WizardCopy> = { en, hr, de, it, pl, hu, fr };
