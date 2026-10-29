import type { Egress } from '@fetivi/egress';
import { type ModelMessage, streamText } from 'ai';
import { expect, it } from 'vitest';
import { systemInstructions } from '../prompt/prompt';
import { CHAT_PROVIDER_OPTIONS, createChatModel } from './model';

/** Every `cache_control` value anywhere in the request body. */
function cacheControls(value: unknown): unknown[] {
  if (Array.isArray(value)) return value.flatMap(cacheControls);
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, inner]) =>
    key === 'cache_control' ? [inner] : cacheControls(inner),
  );
}

it('sends the system breakpoint and the automatic history breakpoint, nothing on messages', async () => {
  const bodies: Record<string, unknown>[] = [];
  const stub = (async (_url: string, init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)));
    // A 400 is not retried, so the provider calls fetch once.
    return new Response(
      JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'stub' } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
  }) as Egress['fetch'];
  const model = createChatModel({ apiKey: 'test', fetch: stub });
  if (!model) throw new Error('no model');
  const messages: ModelMessage[] = [
    { role: 'user', content: 'Wi-Fi?' },
    { role: 'assistant', content: 'Net-1, password W-1.' },
    { role: 'user', content: 'Where do I park?' },
    { role: 'system', content: 'The guest switched to Croatian.' },
  ];

  const run = streamText({
    model,
    instructions: systemInstructions('frozen system'),
    messages,
    allowSystemInMessages: true,
    providerOptions: CHAT_PROVIDER_OPTIONS,
    onError: () => {},
  });
  await run.consumeStream();

  expect(bodies).toHaveLength(1);
  const body = bodies[0] as {
    cache_control?: unknown;
    system: { cache_control?: unknown }[];
    messages: unknown[];
  };
  expect(body.cache_control).toEqual({ type: 'ephemeral' });
  expect(body.system[0]?.cache_control).toEqual({ type: 'ephemeral' });
  expect(cacheControls(body.messages)).toEqual([]);
  // Anthropic allows 4 per request.
  expect(cacheControls(body)).toHaveLength(2);
});
