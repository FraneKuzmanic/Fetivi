import Anthropic, { type ClientOptions } from '@anthropic-ai/sdk';
import type { Egress } from '@fetivi/egress';
import type { LlmKeyCheckError } from './vocabulary';

export type LlmKeyCheckResult = { ok: true } | { ok: false; error: LlmKeyCheckError };

/** Checks a key with one models-list call, which bills no tokens (68). */
export async function checkAnthropicKey(
  key: string | undefined,
  fetch: Egress['fetch'],
): Promise<LlmKeyCheckResult> {
  if (!key) return { ok: false, error: 'not-configured' };
  const client = new Anthropic({
    apiKey: key,
    fetch: fetch as ClientOptions['fetch'],
    maxRetries: 0,
  });
  try {
    await client.models.list({ limit: 1 });
    return { ok: true };
  } catch (error) {
    if (
      error instanceof Anthropic.AuthenticationError ||
      error instanceof Anthropic.PermissionDeniedError
    ) {
      return { ok: false, error: 'rejected' };
    }
    if (error instanceof Anthropic.AnthropicError) return { ok: false, error: 'unreachable' };
    throw error;
  }
}
