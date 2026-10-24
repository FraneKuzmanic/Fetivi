import { describe, expect, it } from 'vitest';
import {
  CURATION_KIND_ACTIONS,
  CURATION_KINDS,
  curationItemActions,
  isRecordKind,
} from './vocabulary';

describe('CURATION_KIND_ACTIONS', () => {
  it('offers Edit exactly on the kinds tied to a record', () => {
    for (const kind of CURATION_KINDS) {
      expect(CURATION_KIND_ACTIONS[kind].includes('edit')).toBe(isRecordKind(kind));
      expect(CURATION_KIND_ACTIONS[kind]).toEqual(expect.arrayContaining(['approve', 'reject']));
    }
  });
});

describe('curationItemActions', () => {
  it('offers only Reject on a draft that waits for its record', () => {
    expect(curationItemActions('draft', false)).toEqual(['reject']);
  });

  it('offers the kind actions otherwise', () => {
    for (const kind of CURATION_KINDS) {
      expect(curationItemActions(kind, true)).toEqual(CURATION_KIND_ACTIONS[kind]);
    }
    expect(curationItemActions('fallback_topic_cluster', false)).toEqual(
      CURATION_KIND_ACTIONS.fallback_topic_cluster,
    );
  });
});
