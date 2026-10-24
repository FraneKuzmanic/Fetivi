import type { SourceFailure } from './vocabulary';

/** One source could not be imported; the code lands on the import row, never the message. */
export class SourceError extends Error {
  constructor(readonly failure: SourceFailure) {
    super(failure);
    this.name = 'SourceError';
  }
}

export type SeedingRuleCode = 'not-found' | 'invalid-state' | 'import-running' | 'invalid-input';

export class SeedingRuleError extends Error {
  constructor(readonly code: SeedingRuleCode) {
    super(code);
    this.name = 'SeedingRuleError';
  }
}
