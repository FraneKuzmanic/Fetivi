import { pgEnum } from 'drizzle-orm/pg-core';
import { PROVIDER_CARD_STATUSES } from '../../payments/vocabulary';
import { GUEST_LANGUAGES } from '../../property/vocabulary';

// Enums shared by tables that would otherwise import each other in a cycle.
export const guestLanguage = pgEnum('guest_language', GUEST_LANGUAGES);
export const providerCardStatus = pgEnum('provider_card_status', PROVIDER_CARD_STATUSES);
