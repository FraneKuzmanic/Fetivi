import type { GuestProjection } from '@fetivi/domain';
import { describe, expect, it } from 'vitest';
import { componentFor } from './parts';
import { endsWithPresentation, isPresentationTool, presentationTools } from './presentation';

const card = {
  topic: 'wifi',
  releaseAt: '2026-10-20T22:00:00.000Z',
  timezone: 'Europe/Zagreb',
  fields: [{ key: 'wifiNetwork', value: 'Mare', action: 'copy' }],
  media: [],
};

/** Only the parts of a projection the Wi-Fi card reads. */
const projection = {
  property: { timezone: 'Europe/Zagreb' },
  stay: {
    arrivalDetailsReleased: false,
    arrivalDetailsPending: true,
    arrivalDetailsReleaseAt: '2026-10-20T22:00:00.000Z',
  },
  wifi: { network: 'Mare', password: null },
  blocks: [],
} as unknown as GuestProjection;

describe('show_property_info', () => {
  it('fills the card from the unit record, whatever the model says', async () => {
    const tools = presentationTools({ readProjection: async () => projection });
    const output = await tools.show_property_info?.execute?.({ topic: 'wifi' }, {
      toolCallId: 'c',
      messages: [],
    } as never);
    expect(output).toEqual(card);
  });

  it('maps its output to a property-info component part', () => {
    expect(componentFor('show_property_info', card)).toEqual({
      name: 'property-info',
      payload: card,
    });
  });

  it('drops an output that is not a valid card', () => {
    expect(componentFor('show_property_info', { topic: 'pool' })).toBeNull();
    expect(componentFor('show_property_info', null)).toBeNull();
  });

  it('ends the turn after its text, though it is not a presentation tool', () => {
    expect(isPresentationTool('show_property_info')).toBe(false);
    const step = { text: 'Here it is.', toolCalls: [{ toolName: 'show_property_info' }] };
    expect(endsWithPresentation({ steps: [step] } as never)).toBe(true);
  });
});
