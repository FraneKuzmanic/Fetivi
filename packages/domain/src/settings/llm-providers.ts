import type { Egress } from '@fetivi/egress';
import type { LlmKeyCheckError, LlmProvider } from './vocabulary';

// The admin pastes any provider's key (71): the provider is recognised from the key's prefix,
// and the key is checked with that provider's models list, which bills no tokens and fills the
// model picker. Mistral keys have no prefix, so an unknown key is tried against Mistral.

export type LlmKeyCheckResult =
  | { ok: true; provider: LlmProvider; models: string[] }
  | { ok: false; error: LlmKeyCheckError };

/** The provider a key's prefix names; null when it has none (Mistral, or unknown). */
export function detectLlmProvider(key: string): LlmProvider | null {
  if (key.startsWith('sk-ant-')) return 'anthropic';
  if (key.startsWith('sk-')) return 'openai';
  if (key.startsWith('AIza')) return 'google';
  return null;
}

interface ModelsRequest {
  url: string;
  headers: Record<string, string>;
  /** The text-generating model ids in the provider's answer. */
  ids(body: unknown): string[];
}

type Listed = { data?: { id: string; capabilities?: { completion_chat?: boolean } }[] };
type GoogleListed = { models?: { name: string; supportedGenerationMethods?: string[] }[] };

/** OpenAI lists every kind of model; only these families write text. */
const OPENAI_CHAT = /^(gpt-|o\d|chatgpt-)/;
const OPENAI_NOT_TEXT = /(audio|realtime|transcribe|tts|image|search)/;

const MODELS: Record<LlmProvider, (key: string) => ModelsRequest> = {
  anthropic: (key) => ({
    url: 'https://api.anthropic.com/v1/models?limit=1000',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    ids: (body) => ((body as Listed).data ?? []).map((m) => m.id),
  }),
  openai: (key) => ({
    url: 'https://api.openai.com/v1/models',
    headers: { Authorization: `Bearer ${key}` },
    ids: (body) =>
      ((body as Listed).data ?? [])
        .map((m) => m.id)
        .filter((id) => OPENAI_CHAT.test(id) && !OPENAI_NOT_TEXT.test(id)),
  }),
  google: (key) => ({
    // The key goes in a header, never in the URL, so it stays out of request logs.
    url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
    headers: { 'x-goog-api-key': key },
    ids: (body) =>
      ((body as GoogleListed).models ?? [])
        .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
        .map((m) => m.name.replace(/^models\//, '')),
  }),
  mistral: (key) => ({
    url: 'https://api.mistral.ai/v1/models',
    headers: { Authorization: `Bearer ${key}` },
    ids: (body) =>
      ((body as Listed).data ?? [])
        .filter((m) => m.capabilities?.completion_chat !== false)
        .map((m) => m.id),
  }),
};

async function listModels(
  provider: LlmProvider,
  key: string,
  fetch: Egress['fetch'],
): Promise<{ ok: true; models: string[] } | { ok: false; error: 'rejected' | 'unreachable' }> {
  const request = MODELS[provider](key);
  let response: Response;
  try {
    response = await fetch(request.url, { headers: request.headers });
  } catch {
    return { ok: false, error: 'unreachable' };
  }
  if (response.status === 400 || response.status === 401 || response.status === 403) {
    return { ok: false, error: 'rejected' };
  }
  if (!response.ok) return { ok: false, error: 'unreachable' };
  return { ok: true, models: [...new Set(request.ids(await response.json()))].sort() };
}

/** Recognises the key's provider, checks the key and lists the provider's models. */
export async function checkLlmKey(
  key: string | undefined,
  fetch: Egress['fetch'],
): Promise<LlmKeyCheckResult> {
  if (!key) return { ok: false, error: 'not-configured' };
  const named = detectLlmProvider(key);
  const provider = named ?? 'mistral';
  const listed = await listModels(provider, key, fetch);
  if (listed.ok) return { ok: true, provider, models: listed.models };
  if (!named && listed.error === 'rejected') return { ok: false, error: 'unrecognised' };
  return { ok: false, error: listed.error };
}
