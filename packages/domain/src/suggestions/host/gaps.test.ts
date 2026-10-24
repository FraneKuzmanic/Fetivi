import { describe, expect, it } from 'vitest';
import type { MessagePart } from '../../db/schema/conversations';
import { wizardField } from '../../property/wizard-config';
import { GAP_TOOL_NAME, gapTopics } from './gaps';
import { GAP_TOPICS, gapTarget } from './vocabulary';

const note = (input: unknown, state = 'output-available'): MessagePart => ({
  type: `tool-${GAP_TOOL_NAME}`,
  toolCallId: 'call-gap',
  state,
  input,
  output: { noted: true },
});
const text: MessagePart = { type: 'text', text: "I don't have that information." };

describe('gapTopics', () => {
  it('takes the topics of successful note_missing_info calls, distinct and in order', () => {
    expect(
      gapTopics([
        text,
        note({ topic: 'laundry' }),
        note({ topic: 'parking' }),
        note({ topic: 'laundry' }),
      ]),
    ).toEqual(['laundry', 'parking']);
  });

  it('ignores failed calls, unknown topics, bad inputs and other tools', () => {
    expect(
      gapTopics([
        text,
        note({ topic: 'laundry' }, 'output-error'),
        note({ topic: 'laundry' }, 'input-available'),
        note({ topic: 'jacuzzi' }),
        note({ topic: 'door_code' }),
        note('laundry'),
        note(null),
        { type: 'tool-show_property_info', state: 'output-available', input: { topic: 'wifi' } },
      ]),
    ).toEqual([]);
  });

  it('records only the enum code, never extra text in the input (AC 4)', () => {
    const topics = gapTopics([note({ topic: 'laundry', note: 'SENTINEL guest words' })]);
    expect(topics).toEqual(['laundry']);
    expect(JSON.stringify(topics)).not.toContain('SENTINEL');
  });
});

describe('gap vocabulary', () => {
  it('maps every topic to its wizard field and step', () => {
    for (const topic of GAP_TOPICS) {
      const field = wizardField(topic);
      expect(field).toBeDefined();
      expect(gapTarget(topic)).toEqual({ stepId: field.step, fieldId: topic });
    }
    expect(gapTarget('laundry')).toEqual({ stepId: 'how_tos', fieldId: 'laundry' });
  });
});
