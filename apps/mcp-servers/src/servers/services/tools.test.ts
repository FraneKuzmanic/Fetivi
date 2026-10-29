import { describe, expect, it } from 'vitest';
import { servicesTools } from './tools';

const description = (name: string) => {
  const spec = servicesTools.find((s) => s.name === name);
  if (!spec) throw new Error(`no tool ${name}`);
  return spec.config.description ?? '';
};

describe('services tool descriptions', () => {
  it('list_offers names what to gather before an on_request order, by category', () => {
    const text = description('list_offers');
    for (const part of ['pickup time', 'luggage', 'hand it over', 'never ask again']) {
      expect(text).toContain(part);
    }
  });

  it('create_order asks for the note and says a request is free until accepted', () => {
    const text = description('create_order');
    expect(text).toContain('note');
    expect(text).toContain('until the provider or host accepts');
    expect(text).toContain('before this call, tell the guest the total price');
  });

  it('check_availability says each start carries warnings and the total', () => {
    const text = description('check_availability');
    expect(text).toContain('warnings');
    expect(text).toContain('total price');
  });
});
