import type { TranslationJobDeps } from '@fetivi/domain';
import type { JobDefinition } from '../runner';
import { translateBlockJob } from './translate-block';
import { translateCatalogRecordJob } from './translate-catalog-record';

// Later tickets add calendar polling, response windows, holds, digests and retention.
export function createJobs(deps: TranslationJobDeps): JobDefinition[] {
  // The runner hands each handler the data its own queue was sent.
  return [
    translateBlockJob(deps) as JobDefinition,
    translateCatalogRecordJob(deps) as JobDefinition,
  ];
}
