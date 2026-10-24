export type DraftingRuleCode = 'not-found' | 'run-running' | 'invalid-input';

export class DraftingRuleError extends Error {
  constructor(readonly code: DraftingRuleCode) {
    super(code);
    this.name = 'DraftingRuleError';
  }
}
