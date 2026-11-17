// The admin's platform-wide settings. Imports nothing.

/** Guest chat messages per Space per property day when the admin has set nothing. */
export const DEFAULT_DAILY_MESSAGE_CAP = 60;
export const MESSAGE_CAP_LIMITS = { min: 1, max: 1000 } as const;

/** Where the Anthropic key in use comes from: the admin's Settings, the environment, or nowhere (68). */
export const LLM_KEY_SOURCES = ['settings', 'environment', 'none'] as const;
export type LlmKeySource = (typeof LLM_KEY_SOURCES)[number];
/** Length bounds for a typed key; catches paste mistakes, the Test button is the real check. */
export const LLM_KEY_LIMITS = { min: 20, max: 300 } as const;
export const LLM_KEY_CHECK_ERRORS = ['not-configured', 'rejected', 'unreachable'] as const;
export type LlmKeyCheckError = (typeof LLM_KEY_CHECK_ERRORS)[number];
