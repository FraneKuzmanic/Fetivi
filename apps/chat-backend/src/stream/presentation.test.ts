import type { StepResult, ToolSet } from 'ai';
import { describe, expect, it } from 'vitest';
import { endsWithPresentation, presentationTools } from './presentation';

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

  it('lets the model write its answer when it showed chips without any text', async () => {
    expect(await endsWithPresentation({ steps: [silent('suggest_replies')] })).toBe(false);
    expect(
      await endsWithPresentation({ steps: [step('search_places'), silent('suggest_replies')] }),
    ).toBe(true);
    // A choice card asks its own question.
    expect(await endsWithPresentation({ steps: [silent('ask_choice')] })).toBe(true);
  });
});

describe('presentationTools', () => {
  it('only acknowledges, and validates its input with the payload schema', async () => {
    const tools = presentationTools();
    const execute = tools.suggest_replies?.execute;
    expect(
      await execute?.({ replies: ['Yes'] }, { toolCallId: 'c', messages: [] } as never),
    ).toEqual({ shown: true });
    const schema = tools.ask_choice?.inputSchema as unknown as {
      safeParse: (v: unknown) => { success: boolean };
    };
    expect(schema.safeParse({ question: 'Which?', options: ['a'] }).success).toBe(false);
    expect(schema.safeParse({ question: 'Which?', options: ['a', 'b'] }).success).toBe(true);
  });
});
