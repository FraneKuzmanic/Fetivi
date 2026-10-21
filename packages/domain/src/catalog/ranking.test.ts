import { describe, expect, it } from 'vitest';
import { type RankCandidate, rankPlaces } from './ranking';

const candidate = (over: Partial<RankCandidate> & { id: string }): RankCandidate => ({
  category: 'sight',
  textScore: null,
  staleness: 'fresh',
  distanceM: 1000,
  ...over,
});
const ids = (list: RankCandidate[]) => list.map((c) => c.id);

describe('rankPlaces', () => {
  it('puts a better text match above a closer place', () => {
    const near = candidate({ id: 'near', textScore: 0.4, distanceM: 100 });
    const match = candidate({ id: 'match', textScore: 0.9, distanceM: 8000 });
    expect(ids(rankPlaces([near, match], null))).toEqual(['match', 'near']);
  });

  it('orders fresh, stale, never verified with equal text', () => {
    const list = [
      candidate({ id: 'n', staleness: 'never_verified' }),
      candidate({ id: 's', staleness: 'stale' }),
      candidate({ id: 'f', staleness: 'fresh' }),
    ];
    expect(ids(rankPlaces(list, null))).toEqual(['f', 's', 'n']);
  });

  it('puts the closer place first and unknown distance last', () => {
    const list = [
      candidate({ id: 'unknown', distanceM: null }),
      candidate({ id: 'far', distanceM: 5000 }),
      candidate({ id: 'close', distanceM: 200 }),
    ];
    expect(ids(rankPlaces(list, null))).toEqual(['close', 'far', 'unknown']);
  });

  it('lets an About me weight move a beach above an equal sight', () => {
    const sightFirst = [
      candidate({ id: 'a-sight' }),
      candidate({ id: 'b-beach', category: 'beach' }),
    ];
    expect(ids(rankPlaces(sightFirst, null))).toEqual(['a-sight', 'b-beach']);
    expect(ids(rankPlaces(sightFirst, { categoryWeights: { beach: 1 } }))).toEqual([
      'b-beach',
      'a-sight',
    ]);
  });

  it('gives the same order for no About me and empty weights', () => {
    const list = [
      candidate({ id: 'a', distanceM: 300, staleness: 'stale' }),
      candidate({ id: 'b', distanceM: 900 }),
      candidate({ id: 'c', distanceM: null, textScore: 0.5 }),
    ];
    expect(ids(rankPlaces(list, null))).toEqual(ids(rankPlaces(list, { categoryWeights: {} })));
  });

  it('does not mutate the input', () => {
    const list = [
      candidate({ id: 'far', distanceM: 9000 }),
      candidate({ id: 'near', distanceM: 1 }),
    ];
    const copy = [...list];
    rankPlaces(list, null);
    expect(list).toEqual(copy);
  });

  it('breaks exact ties by id', () => {
    const list = [candidate({ id: 'z' }), candidate({ id: 'a' }), candidate({ id: 'm' })];
    expect(ids(rankPlaces(list, null))).toEqual(['a', 'm', 'z']);
  });
});
