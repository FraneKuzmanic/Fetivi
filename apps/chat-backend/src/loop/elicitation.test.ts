import { ORDER_DRAFT_META_KEY } from '@fetivi/domain';
import type { Client } from '@modelcontextprotocol/client';
import { describe, expect, it, vi } from 'vitest';
import type { TurnClients } from '../mcp/clients';
import { answer, firstHalf, guestAnswer } from './elicitation';

// The halves pass the definition without its output schema, so an input_required result passes.
const OPTIONS = {
  allowInputRequired: true,
  toolDefinition: { name: 'create_order', inputSchema: { type: 'object' } },
};

const DRAFT = {
  pendingId: 'p-1',
  offerId: 'o-1',
  offerTitle: 'Blue Lagoon boat trip',
  language: 'en',
  date: '2026-10-22',
  slotId: 's-1',
  startsAt: '2026-10-22T07:00:00.000Z',
  startsAtLocal: '2026-10-22T09:00',
  quantity: 2,
  priceMinor: 9000,
  currency: 'EUR',
  priceUnit: 'person',
  paymentMode: 'direct',
  availabilityMode: 'allotment',
  cancellationPolicy: 'Free cancellation up to 24 hours before.',
  contactFields: 'name',
};

const SCHEMA = {
  type: 'object',
  properties: { email: { type: 'string', format: 'email' }, name: { type: 'string' } },
  required: ['email', 'name'],
};

const inputRequired = (meta: unknown = { [ORDER_DRAFT_META_KEY]: DRAFT }) => ({
  resultType: 'input_required',
  inputRequests: {
    confirm: {
      method: 'elicitation/create',
      params: { message: 'Book it?', requestedSchema: SCHEMA, _meta: meta },
    },
  },
  requestState: 'sealed.state',
});

function fake(reply: () => unknown) {
  const callTool = vi.fn(async (_params: unknown, _options?: unknown) => reply());
  const clients: TurnClients = {
    get: async () => ({ callTool }) as unknown as Client,
    mcpMs: 0,
    timed: (run) => run(),
    close: async () => {},
  };
  const call = {
    clients,
    listed: {
      server: 'services' as const,
      tool: {
        name: 'create_order',
        inputSchema: { type: 'object' as const },
        outputSchema: { type: 'object' as const },
      },
    },
    toolCallId: 'call-1',
    toolName: 'create_order',
    input: { offerId: 'o-1', date: '2026-10-22', quantity: 2 },
  };
  return { call, callTool };
}

describe('firstHalf', () => {
  it('turns input_required into a card with the draft and the state', async () => {
    const { call, callTool } = fake(() => inputRequired());
    expect(await firstHalf(call)).toEqual({
      kind: 'ask',
      payload: {
        toolCallId: 'call-1',
        toolName: 'create_order',
        key: 'confirm',
        message: 'Book it?',
        requestedSchema: SCHEMA,
        requestState: 'sealed.state',
        draft: DRAFT,
      },
    });
    expect(callTool).toHaveBeenCalledWith({ name: 'create_order', arguments: call.input }, OPTIONS);
  });

  it('refuses a card whose draft cannot be shown', async () => {
    const { call } = fake(() =>
      inputRequired({ [ORDER_DRAFT_META_KEY]: { ...DRAFT, quantity: 'two' } }),
    );
    expect(await firstHalf(call)).toEqual({
      kind: 'error',
      errorText: 'The confirmation could not be shown; nothing was booked.',
    });
  });

  it('passes a tool error and a structured result through', async () => {
    const refused = fake(() => ({ isError: true, content: [{ type: 'text', text: 'Sold out.' }] }));
    expect(await firstHalf(refused.call)).toEqual({ kind: 'error', errorText: 'Sold out.' });
    const done = fake(() => ({
      structuredContent: { outcome: 'not_ordered', order: null },
      content: [],
    }));
    expect(await firstHalf(done.call)).toEqual({
      kind: 'output',
      output: { outcome: 'not_ordered', order: null },
    });
  });
});

describe('answer', () => {
  it('sends the answer and the stored state back untouched', async () => {
    const { call, callTool } = fake(() => ({
      structuredContent: { outcome: 'ordered' },
      content: [],
    }));
    const content = { email: 'a@b.test', name: 'Ana' };
    await answer({ ...call, requestState: 'sealed.state', answer: { action: 'accept', content } });
    expect(callTool).toHaveBeenCalledWith(
      {
        name: 'create_order',
        arguments: call.input,
        inputResponses: { confirm: { action: 'accept', content } },
        requestState: 'sealed.state',
      },
      OPTIONS,
    );
  });

  it('sends no content with a decline', async () => {
    const { call, callTool } = fake(() => ({
      structuredContent: { outcome: 'not_ordered' },
      content: [],
    }));
    await answer({
      ...call,
      requestState: 's',
      answer: { action: 'decline', content: { email: 'a@b.test' } },
    });
    expect(callTool.mock.calls[0]?.[0]).toMatchObject({
      inputResponses: { confirm: { action: 'decline' } },
    });
    expect(JSON.stringify(callTool.mock.calls[0]?.[0])).not.toContain('a@b.test');
  });

  it('reads an expired or altered state as expired, and rethrows anything else', async () => {
    const expired = fake(() => {
      throw Object.assign(new Error('Invalid or expired requestState'), { code: -32602 });
    });
    expect(
      await answer({ ...expired.call, requestState: 'x', answer: { action: 'accept' } }),
    ).toEqual({ kind: 'error', errorText: 'The confirmation expired; nothing was booked.' });
    const down = fake(() => {
      throw new Error('network');
    });
    await expect(
      answer({ ...down.call, requestState: 'x', answer: { action: 'accept' } }),
    ).rejects.toThrow('network');
  });
});

describe('guestAnswer', () => {
  it('takes an action and short string fields only', () => {
    expect(
      guestAnswer.safeParse({ toolCallId: 'c', action: 'accept', content: { email: 'a@b.test' } })
        .success,
    ).toBe(true);
    for (const bad of [
      { toolCallId: 'c', action: 'maybe' },
      { toolCallId: '', action: 'cancel' },
      { toolCallId: 'c', action: 'accept', content: { email: 'x'.repeat(255) } },
      {
        toolCallId: 'c',
        action: 'accept',
        content: { a: '1', b: '2', c: '3', d: '4', e: '5', f: '6' },
      },
      { toolCallId: 'c', action: 'accept', requestState: 'forged' },
    ]) {
      expect(guestAnswer.safeParse(bad).success).toBe(false);
    }
  });
});
