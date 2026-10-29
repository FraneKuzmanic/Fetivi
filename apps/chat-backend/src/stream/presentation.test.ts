import { convertToModelMessages, type StepResult, type ToolSet, type UIMessage } from 'ai';
import { describe, expect, it } from 'vitest';
import {
  chipsAfterText,
  endsWithPresentation,
  presentationTools,
  textAfterSilentChips,
} from './presentation';

/** A step with these calls ('!' marks an invalid one); it has text unless `silent`. */
const step = (...names: string[]) => stepWith('Some text.', names);
const silent = (...names: string[]) => stepWith('', names);
const stepWith = (text: string, names: string[]) =>
  ({
    text,
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

  it('lets the model write its answer when it showed chips without any text', async () => {
    expect(await endsWithPresentation({ steps: [silent('suggest_replies')] })).toBe(false);
    expect(
      await endsWithPresentation({ steps: [step('search_places'), silent('suggest_replies')] }),
    ).toBe(true);
    // A choice card asks its own question.
    expect(await endsWithPresentation({ steps: [silent('ask_choice')] })).toBe(true);
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

  it('leaves every other step alone', () => {
    expect(prepare([])).toBeUndefined();
    expect(prepare([silent('search_places')])).toBeUndefined();
    expect(prepare([step('search_places'), silent('suggest_replies')])).toBeUndefined();
    // An invalid call goes back to the model to correct, with the tools.
    expect(prepare([silent('suggest_replies!')])).toBeUndefined();
    expect(prepare([silent('ask_choice')])).toBeUndefined();
  });
});

describe('presentationTools', () => {
  it('only acknowledges, and validates its input with the payload schema', async () => {
    const tools = presentationTools({
      readProjection: () => Promise.reject(new Error('not read')),
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
  });
});

describe('chipsAfterText', () => {
  const ss = { type: 'step-start' };
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
  const answer = (...parts: unknown[]) =>
    ({ id: 'a1', role: 'assistant', parts }) as unknown as UIMessage;
  const user = { id: 'u1', role: 'user', parts: [text('Where should we eat?')] } as UIMessage;

  it('moves chips shown before the text to right after it', () => {
    const input = answer(
      ss,
      search,
      card('place-carousel'),
      ss,
      chips,
      card('follow-up-chips'),
      ss,
      text('Try Konoba Mala.'),
    );
    const copy = structuredClone(input);
    expect(chipsAfterText(input)).toEqual(
      answer(
        ss,
        search,
        card('place-carousel'),
        ss,
        card('follow-up-chips'),
        ss,
        text('Try Konoba Mala.'),
        chips,
      ),
    );
    expect(input).toEqual(copy);
  });

  it('leaves text-then-chips, chips-only and user messages as they are', () => {
    const ordered = answer(ss, search, ss, text('Try Konoba Mala.'), chips);
    expect(chipsAfterText(ordered)).toBe(ordered);
    const chipsOnly = answer(ss, search, ss, chips);
    expect(chipsAfterText(chipsOnly)).toBe(chipsOnly);
    // Whitespace is no answer, like the guard's own check.
    const blank = answer(ss, search, ss, chips, ss, text('  '));
    expect(chipsAfterText(blank)).toBe(blank);
    expect(chipsAfterText(user)).toBe(user);
  });

  it('never moves a choice card', () => {
    const choiceFirst = answer(ss, search, ss, askChoice, text('Pick one.'));
    expect(chipsAfterText(choiceFirst)).toBe(choiceFirst);
    expect(chipsAfterText(answer(ss, chips, ss, text('Hi.'), askChoice))).toEqual(
      answer(ss, ss, text('Hi.'), chips, askChoice),
    );
  });

  it('keeps every tool call followed by its result in the model request', async () => {
    const messages = await convertToModelMessages([
      user,
      chipsAfterText(answer(ss, search, ss, chips, ss, text('Try Konoba Mala.'))),
    ]);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant', 'tool']);
    const content = (i: number) => messages[i]?.content as { type: string; toolCallId?: string }[];
    expect(content(3).map((c) => c.type)).toEqual(['text', 'tool-call']);
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
