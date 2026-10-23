import { describe, expect, it } from 'vitest';
import { CURATION_KIND_ACTIONS, CURATION_KINDS, isRecordKind } from './vocabulary';

describe('CURATION_KIND_ACTIONS', () => {
  it('offers Edit exactly on the kinds tied to a record', () => {
    for (const kind of CURATION_KINDS) {
      expect(CURATION_KIND_ACTIONS[kind].includes('edit')).toBe(isRecordKind(kind));
      expect(CURATION_KIND_ACTIONS[kind]).toEqual(expect.arrayContaining(['approve', 'reject']));
    }
  });
});
