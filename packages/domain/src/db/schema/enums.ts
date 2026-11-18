import { pgEnum } from 'drizzle-orm/pg-core';
import { INTERESTS } from '../../about-me/vocabulary';
import { PROVIDER_CARD_STATUSES } from '../../payments/vocabulary';
import { GUEST_LANGUAGES } from '../../property/vocabulary';

// Enums shared by tables that would otherwise import each other in a cycle.
export const language = pgEnum('language', GUEST_LANGUAGES);
export const aboutMeInterest = pgEnum('about_me_interest', INTERESTS);
export const providerCardStatus = pgEnum('provider_card_status', PROVIDER_CARD_STATUSES);
