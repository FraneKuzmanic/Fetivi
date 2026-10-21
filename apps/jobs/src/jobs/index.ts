import type { NotifyDeps, TranslationJobDeps } from '@fetivi/domain';
import type { JobDefinition } from '../runner';
import { orderNotifyJob } from './orders/notify';
import { orderTimerJob } from './orders/timer';
import { translateBlockJob } from './translate-block';
import { translateCatalogRecordJob } from './translate-catalog-record';
import { translateOfferJob } from './translate-offer';

// Later tickets add calendar polling, digests and retention.
export function createJobs(deps: TranslationJobDeps & NotifyDeps): JobDefinition[] {
  // The runner hands each handler the data its own queue was sent.
  return [
    translateBlockJob(deps) as JobDefinition,
    translateCatalogRecordJob(deps) as JobDefinition,
    translateOfferJob(deps) as JobDefinition,
    orderTimerJob(deps) as JobDefinition,
    orderNotifyJob(deps) as JobDefinition,
  ];
}
