import { convertToModelMessages, type StepResult, type ToolSet, type UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import {
  chipsAfterText,
  endsWithPresentation,
  presentationTools,
  textAfterSilentChips,
} from './presentation';
import type { TurnResults } from './results';

/** A step with these calls ('!' marks an invalid one); it has text unless `silent`. */
const step = (...names: string[]) => stepWith('Some text.', names);
const silent = (...names: string[]) => stepWith('', names);
const stepWith = (text: string, names: string[], content: { type: string }[] = []) =>
  ({
    text,
    content,
    toolCalls: names.map((name) => ({
      toolName: name.replace('!', ''),
      invalid: name.endsWith('!'),
    })),
  }) as unknown as StepResult<ToolSet>;

describe('endsWithPresentation', () => {
  it('stops only when every call of the last step is a presentation call', async () => {
    expect(await endsWithPresentation({ steps: [step('suggest_replies')] })).toBe(true);
    expect(await endsWithPresentation({ steps: [step('ask_choice')] })).toBe(true);
    expect(await endsWithPresentation({ steps: [step('suggest_replies', 'search_places')] })).toBe(
      false,
    );
    expect(await endsWithPresentation({ steps: [step()] })).toBe(false);
    // An invalid call (e.g. five replies) goes back to the model to correct.
    expect(await endsWithPresentation({ steps: [step('suggest_replies!')] })).toBe(false);
    expect(await endsWithPresentation({ steps: [step('suggest_replies'), step()] })).toBe(false);
    expect(await endsWithPresentation({ steps: [] })).toBe(false);
  });

  it('stops after the property card with text, like chips', async () => {
    expect(await endsWithPresentation({ steps: [step('show_property_info')] })).toBe(true);
    expect(await endsWithPresentation({ steps: [silent('show_property_info')] })).toBe(false);
    expect(
      await endsWithPresentation({ steps: [step('show_property_info', 'search_places')] }),
    ).toBe(false);
  });

  it('stops after the silent gap note with text, and continues otherwise', async () => {
    expect(await endsWithPresentation({ steps: [step('note_missing_info')] })).toBe(true);
    expect(
      await endsWithPresentation({ steps: [step('note_missing_info', 'suggest_replies')] }),
    ).toBe(true);
    expect(await endsWithPresentation({ steps: [silent('note_missing_info')] })).toBe(false);
    expect(
      await endsWithPresentation({ steps: [step('note_missing_info', 'search_places')] }),
    ).toBe(false);
  });

  it('stops after shown results with text, and continues to correct a tool error', async () => {
    expect(await endsWithPresentation({ steps: [step('show_results')] })).toBe(true);
    expect(await endsWithPresentation({ steps: [silent('show_results')] })).toBe(false);
    expect(await endsWithPresentation({ steps: [step('show_results', 'suggest_replies')] })).toBe(
      true,
    );
    expect(await endsWithPresentation({ steps: [step('show_results', 'search_places')] })).toBe(
      false,
    );
    const failed = stepWith('Some text.', ['show_results'], [{ type: 'tool-error' }]);
    expect(await endsWithPresentation({ steps: [failed] })).toBe(false);
  });

  it('lets the model write its answer when it showed chips without any text', async () => {
    expect(await endsWithPresentation({ steps: [silent('suggest_replies')] })).toBe(false);
    expect(
      await endsWithPresentation({ steps: [step('search_places'), silent('suggest_replies')] }),
    ).toBe(true);
  });

  it('lets the model write words for a choice or property card shown without any (ticket 66)', async () => {
    expect(await endsWithPresentation({ steps: [silent('ask_choice')] })).toBe(false);
    expect(
      await endsWithPresentation({ steps: [step('search_places'), silent('ask_choice')] }),
    ).toBe(true);
    expect(await endsWithPresentation({ steps: [silent('show_property_info')] })).toBe(false);
    expect(
      await endsWithPresentation({ steps: [step('get_weather'), silent('show_property_info')] }),
    ).toBe(true);
  });
});

describe('textAfterSilentChips', () => {
  const question = { role: 'user', content: 'Where should we eat?' };
  const search = [
    { role: 'assistant', content: [{ type: 'tool-call', toolName: 'search_places' }] },
    { role: 'tool', content: [{ type: 'tool-result', toolName: 'search_places' }] },
  ];
  const chipsCall = [
    { role: 'assistant', content: [{ type: 'tool-call', toolName: 'suggest_replies' }] },
    { role: 'tool', content: [{ type: 'tool-result', toolName: 'suggest_replies' }] },
  ];
  const prepare = (steps: StepResult<ToolSet>[], messages: unknown[] = []) =>
    textAfterSilentChips({ steps, messages } as unknown as Parameters<
      typeof textAfterSilentChips
    >[0]);

  it('answers in text, without the chips call, after chips shown without any text', () => {
    expect(
      prepare(
        [silent('search_places'), silent('suggest_replies')],
        [question, ...search, ...chipsCall],
      ),
    ).toEqual({ toolChoice: 'none', messages: [question, ...search] });
    expect(prepare([silent('suggest_replies')])).toEqual({ toolChoice: 'none' });
  });

  it('answers in text, without the card call, after a choice or property card without text', () => {
    const shown = (name: string) => [
      { role: 'assistant', content: [{ type: 'tool-call', toolName: name }] },
      { role: 'tool', content: [{ type: 'tool-result', toolName: name }] },
    ];
    for (const name of ['ask_choice', 'show_property_info']) {
      expect(
        prepare([silent('search_places'), silent(name)], [question, ...search, ...shown(name)]),
      ).toEqual({ toolChoice: 'none', messages: [question, ...search] });
    }
    // A step that also searched keeps its calls: the words need the results.
    const mixed = [
      {
        role: 'assistant',
        content: [
          { type: 'tool-call', toolName: 'ask_choice' },
          { type: 'tool-call', toolName: 'search_places' },
        ],
      },
      {
        role: 'tool',
        content: [
          { type: 'tool-result', toolName: 'ask_choice' },
          { type: 'tool-result', toolName: 'search_places' },
        ],
      },
    ];
    expect(prepare([silent('ask_choice', 'search_places')], [question, ...mixed])).toEqual({
      toolChoice: 'none',
    });
  });

  it('answers in text after results shown without any text, keeping only the show_results call', () => {
    const thinking = { type: 'reasoning', text: 'Konoba Mala fits best because' };
    const shown = { type: 'tool-call', toolName: 'show_results' };
    const shownResult = { type: 'tool-result', toolName: 'show_results' };
    const kept = [
      { role: 'assistant', content: [shown] },
      { role: 'tool', content: [shownResult] },
    ];
    const showCall = [
      { role: 'assistant', content: [thinking, shown] },
      { role: 'tool', content: [shownResult] },
    ];
    const earlier = { role: 'assistant', content: [thinking] };
    const thinkingSearch = [
      { role: 'assistant', content: [thinking, ...(search[0]?.content ?? [])] },
      search[1],
    ];
    // The turn's thinking often holds the whole answer; with it resent the model ends empty.
    // Thinking before the guest's message belongs to another turn and stays.
    expect(
      prepare(
        [silent('search_places'), silent('show_results')],
        [earlier, question, ...thinkingSearch, ...showCall],
      ),
    ).toEqual({ toolChoice: 'none', messages: [earlier, question, ...search, ...kept] });
    const withChips = [
      {
        role: 'assistant',
        content: [thinking, shown, { type: 'tool-call', toolName: 'suggest_replies' }],
      },
      {
        role: 'tool',
        content: [shownResult, { type: 'tool-result', toolName: 'suggest_replies' }],
      },
    ];
    expect(
      prepare(
        [silent('search_places'), silent('show_results', 'suggest_replies')],
        [question, ...search, ...withChips],
      ),
    ).toEqual({ toolChoice: 'none', messages: [question, ...search, ...kept] });
  });

  it('leaves every other step alone', () => {
    expect(prepare([])).toBeUndefined();
    expect(prepare([silent('search_places')])).toBeUndefined();
    expect(prepare([step('search_places'), silent('suggest_replies')])).toBeUndefined();
    // An invalid call goes back to the model to correct, with the tools.
    expect(prepare([silent('suggest_replies!')])).toBeUndefined();
    expect(prepare([silent('ask_choice!')])).toBeUndefined();
    expect(prepare([silent('show_results!')])).toBeUndefined();
    expect(prepare([silent('show_results!', 'suggest_replies')])).toBeUndefined();
    // So does a call that failed when run, e.g. show_results with unknown ids.
    const failed = stepWith('', ['show_results'], [{ type: 'tool-error' }]);
    expect(prepare([silent('search_places'), failed])).toBeUndefined();
    expect(prepare([step('search_places'), silent('show_results')])).toBeUndefined();
  });
});

describe('presentationTools', () => {
  it('only acknowledges, and validates its input with the payload schema', async () => {
    const tools = presentationTools({
      readProjection: () => Promise.reject(new Error('not read')),
      results: {} as TurnResults,
    });
    const execute = tools.suggest_replies?.execute;
    expect(
      await execute?.({ replies: ['Yes'] }, { toolCallId: 'c', messages: [] } as never),
    ).toEqual({ shown: true });
    expect(
      await tools.ask_choice?.execute?.({ question: 'Which?', options: ['a', 'b'] }, {
        toolCallId: 'c',
        messages: [],
      } as never),
    ).toEqual({ shown: true });
    const schema = tools.ask_choice?.inputSchema as unknown as {
      safeParse: (v: unknown) => { success: boolean };
    };
    expect(schema.safeParse({ question: 'Which?', options: ['a'] }).success).toBe(false);
    expect(schema.safeParse({ question: 'Which?', options: ['a', 'b'] }).success).toBe(true);
    expect(tools.ask_choice?.description).toContain('Write your sentence first');
    expect(tools.suggest_replies?.description).toContain(
      'Never suggest something the guest declined or passed over earlier',
    );
  });

  it('shows results through the turn store, taking 1 to 5 distinct ids', async () => {
    const shown: unknown[] = [];
    const results = {
      show: (toolCallId: string, kind: string, ids: string[]) => {
        if (ids.includes('x')) throw new Error('Unknown places ids: x.');
        shown.push({ toolCallId, kind, ids });
        return ids.length;
      },
    } as unknown as TurnResults;
    const tools = presentationTools({
      readProjection: () => Promise.reject(new Error('not read')),
      results,
    });
    const options = { toolCallId: 'c', messages: [] } as never;
    const execute = tools.show_results?.execute;
    expect(await execute?.({ kind: 'places', ids: ['b', 'a'] }, options)).toEqual({ shown: 2 });
    expect(shown).toEqual([{ toolCallId: 'c', kind: 'places', ids: ['b', 'a'] }]);
    await expect(execute?.({ kind: 'places', ids: ['x'] }, options)).rejects.toThrow(
      'Unknown places ids: x.',
    );
    const schema = tools.show_results?.inputSchema as unknown as {
      safeParse: (v: unknown) => { success: boolean };
    };
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `id-${i}`);
    expect(schema.safeParse({ kind: 'places', ids: ids(5) }).success).toBe(true);
    expect(schema.safeParse({ kind: 'places', ids: ids(6) }).success).toBe(false);
    expect(schema.safeParse({ kind: 'places', ids: [] }).success).toBe(false);
    expect(schema.safeParse({ kind: 'places', ids: ['a', 'a'] }).success).toBe(false);
    expect(schema.safeParse({ kind: 'offers', ids: ['a'] }).success).toBe(false);
  });
});

describe('chipsAfterText', () => {
  const stepStart = { type: 'step-start' };
  const text = (t: string) => ({ type: 'text', text: t });
  const tool = (name: string, input: unknown = {}) => ({
    type: `tool-${name}`,
    toolCallId: `call-${name}`,
    state: 'output-available',
    input,
    output: { shown: true },
  });
  const card = (name: string) => ({
    type: 'data-component',
    id: `card-${name}`,
    data: { name, payload: {} },
  });
  const search = tool('search_places', { category: 'restaurant' });
  const chips = tool('suggest_replies', { replies: ['Thanks'] });
  const askChoice = tool('ask_choice', { question: 'Which?', options: ['a', 'b'] });
  const showResults = tool('show_results', { kind: 'places', ids: ['p1'] });
  const answer = (...parts: unknown[]) =>
    ({ id: 'a1', role: 'assistant', parts }) as unknown as UIMessage;
  const user = { id: 'u1', role: 'user', parts: [text('Where should we eat?')] } as UIMessage;

  it('moves chips shown before the text to right after it', () => {
    const input = answer(
      stepStart,
      search,
      card('place-carousel'),
      stepStart,
      chips,
      card('follow-up-chips'),
      stepStart,
      text('Try Konoba Mala.'),
    );
    const copy = structuredClone(input);
    expect(chipsAfterText(input)).toEqual(
      answer(
        stepStart,
        search,
        card('place-carousel'),
        stepStart,
        card('follow-up-chips'),
        stepStart,
        text('Try Konoba Mala.'),
        chips,
      ),
    );
    expect(input).toEqual(copy);
  });

  it('moves shown results with the chips, keeping their order', () => {
    expect(
      chipsAfterText(
        answer(
          stepStart,
          search,
          stepStart,
          showResults,
          card('place-carousel'),
          chips,
          card('follow-up-chips'),
          stepStart,
          text('Try Konoba Mala.'),
        ),
      ),
    ).toEqual(
      answer(
        stepStart,
        search,
        stepStart,
        card('place-carousel'),
        card('follow-up-chips'),
        stepStart,
        text('Try Konoba Mala.'),
        showResults,
        chips,
      ),
    );
  });

  it('leaves text-then-chips, chips-only and user messages as they are', () => {
    const ordered = answer(stepStart, search, stepStart, text('Try Konoba Mala.'), chips);
    expect(chipsAfterText(ordered)).toBe(ordered);
    const chipsOnly = answer(stepStart, search, stepStart, chips);
    expect(chipsAfterText(chipsOnly)).toBe(chipsOnly);
    // Whitespace is no answer, like the guard's own check.
    const blank = answer(stepStart, search, stepStart, chips, stepStart, text('  '));
    expect(chipsAfterText(blank)).toBe(blank);
    expect(chipsAfterText(user)).toBe(user);
  });

  // Ticket 66: the guard writes the words after a silent choice or property card, like chips.
  it('moves a choice or property card shown before the text to right after it', () => {
    expect(
      chipsAfterText(answer(stepStart, search, stepStart, askChoice, stepStart, text('Pick one.'))),
    ).toEqual(answer(stepStart, search, stepStart, stepStart, text('Pick one.'), askChoice));
    const info = tool('show_property_info', { topic: 'checkout' });
    expect(
      chipsAfterText(answer(stepStart, info, card('property-info'), stepStart, text('At 10.'))),
    ).toEqual(answer(stepStart, card('property-info'), stepStart, text('At 10.'), info));
    expect(chipsAfterText(answer(stepStart, chips, askChoice, stepStart, text('Hi.')))).toEqual(
      answer(stepStart, stepStart, text('Hi.'), chips, askChoice),
    );
    const ordered = answer(stepStart, text('Hi.'), askChoice);
    expect(chipsAfterText(ordered)).toBe(ordered);
  });

  it('keeps every tool call followed by its result in the model request', async () => {
    const messages = await convertToModelMessages([
      user,
      chipsAfterText(
        answer(
          stepStart,
          search,
          stepStart,
          showResults,
          chips,
          stepStart,
          text('Try Konoba Mala.'),
        ),
      ),
    ]);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool']);
    const content = (i: number) => messages[i]?.content as { type: string; toolCallId?: string }[];
    expect(content(3).map((c) => c.type)).toEqual(['text', 'tool-call', 'tool-call']);
    messages.forEach((m, i) => {
      if (m.role !== 'assistant') return;
      const calls = content(i).filter((c) => c.type === 'tool-call');
      if (calls.length === 0) return;
      expect(messages[i + 1]?.role).toBe('tool');
      expect(
        content(i + 1)
          .filter((c) => c.type === 'tool-result')
          .map((c) => c.toolCallId),
      ).toEqual(calls.map((c) => c.toolCallId));
    });
  });
});
