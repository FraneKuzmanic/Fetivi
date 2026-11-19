// The admin's platform-wide settings. Imports nothing.

/** Guest chat messages per Space per property day when the admin has set nothing. */
export const DEFAULT_DAILY_MESSAGE_CAP = 60;
export const MESSAGE_CAP_LIMITS = { min: 1, max: 1000 } as const;

/**
 * The language model providers whose key the admin can paste (71). One provider, model and key
 * serve every text-generating task; embeddings stay on Voyage.
 */
export const LLM_PROVIDERS = ['anthropic', 'openai', 'google', 'mistral'] as const;
export type LlmProvider = (typeof LLM_PROVIDERS)[number];
/** The API host of each provider; every model caller's egress allowlist holds all of them. */
export const LLM_PROVIDER_HOSTS: Record<LlmProvider, string> = {
  anthropic: 'api.anthropic.com',
  openai: 'api.openai.com',
  google: 'generativelanguage.googleapis.com',
  mistral: 'api.mistral.ai',
};

/** Where the model key in use comes from: the admin's Settings, the environment, or nowhere (68). */
export const LLM_KEY_SOURCES = ['settings', 'environment', 'none'] as const;
export type LlmKeySource = (typeof LLM_KEY_SOURCES)[number];
/** Length bounds for a typed key; catches paste mistakes, the Test button is the real check. */
export const LLM_KEY_LIMITS = { min: 20, max: 300 } as const;
/** `unrecognised`: no known provider accepts the key. */
export const LLM_KEY_CHECK_ERRORS = [
  'not-configured',
  'rejected',
  'unreachable',
  'unrecognised',
] as const;
export type LlmKeyCheckError = (typeof LLM_KEY_CHECK_ERRORS)[number];
