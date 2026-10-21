import { pgEnum } from 'drizzle-orm/pg-core';
import { GUEST_LANGUAGES } from '../../property/vocabulary';

// Enums shared by tables that would otherwise import each other in a cycle.
export const guestLanguage = pgEnum('guest_language', GUEST_LANGUAGES);
