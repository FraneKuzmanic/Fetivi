import type { StepResult, ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';
import { endsWithPresentation, presentationTools, textAfterSilentChips } from './presentation';

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
