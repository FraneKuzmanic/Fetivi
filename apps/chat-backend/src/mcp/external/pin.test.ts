import type { Tool } from '@modelcontextprotocol/client';
import { describe, expect, it } from 'vitest';
import { checkCall, FERRYHOPPER_PINNED_TOOLS, modelVisible, pinTools } from './pin';

const def = (name: string, extra: Partial<Tool> = {}): Tool => ({
  name,
  description: `${name} tool`,
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true },
  ...extra,
});

// Ferryhopper's own order, with the deprecated search_trips in the middle.
const listing = [
  def('get_ports'),
  def('get_disruptions'),
  def('get_direct_connections_for_ports'),
  def('search_trips'),
  def('search_ferry_trips'),
  def('trip_details'),
];

describe('pinTools', () => {
  it('keeps the five pinned tools in pin order and drops the rest', () => {
    const pin = pinTools(listing);
    expect(pin.tools.map((t) => t.name)).toEqual([...FERRYHOPPER_PINNED_TOOLS]);
    expect(pin.byName.has('search_trips')).toBe(false);
  });

  it('hashes the same definitions the same, whatever the key order', () => {
    const reordered = listing.map((t) => ({
      annotations: t.annotations,
      inputSchema: { properties: {}, type: 'object' as const },
      description: t.description,
      name: t.name,
    }));
    expect(pinTools(reordered).hash).toBe(pinTools(listing).hash);
  });

  it('changes the hash when a description changes', () => {
    const changed = listing.map((t) =>
      t.name === 'get_ports' ? { ...t, description: 'Lists every port' } : t,
    );
    expect(pinTools(changed).hash).not.toBe(pinTools(listing).hash);
  });

  it('ignores tools outside the pin in the hash', () => {
    expect(pinTools([...listing, def('create_booking')]).hash).toBe(pinTools(listing).hash);
  });
});

describe('checkCall', () => {
  const pin = pinTools(listing);

  it('allows a pinned read-only tool for both callers', () => {
    expect(checkCall(pin, 'get_ports', 'model')).toMatchObject({ ok: true });
    expect(checkCall(pin, 'get_ports', 'app')).toMatchObject({ ok: true });
  });

  it('blocks tools outside the pin', () => {
    expect(checkCall(pin, 'search_trips', 'model')).toEqual({ ok: false, reason: 'not-pinned' });
    expect(checkCall(pin, 'create_booking', 'app')).toEqual({ ok: false, reason: 'not-pinned' });
  });

  it('blocks a pinned tool that is not marked read-only', () => {
    const p = pinTools([def('get_ports', { annotations: {} })]);
    expect(checkCall(p, 'get_ports', 'model')).toEqual({ ok: false, reason: 'not-read-only' });
  });

  it('blocks a caller the tool is not visible to', () => {
    const p = pinTools([def('trip_details', { _meta: { ui: { visibility: ['model'] } } })]);
    expect(checkCall(p, 'trip_details', 'app')).toEqual({ ok: false, reason: 'not-visible' });
    expect(checkCall(p, 'trip_details', 'model')).toMatchObject({ ok: true });
  });
});

describe('modelVisible', () => {
  it('hides an app-only tool from the model', () => {
    expect(modelVisible(def('trip_details', { _meta: { ui: { visibility: ['app'] } } }))).toBe(
      false,
    );
    expect(modelVisible(def('trip_details'))).toBe(true);
  });
});
