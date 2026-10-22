import type {
  GuestNotifyDeps,
  HostNotifyDeps,
  NotifyDeps,
  TranslationJobDeps,
} from '@fetivi/domain';
import type { JobDefinition } from '../runner';
import { type DailyTipsDeps, dailyTipsJob } from './daily-tips';
import { guestNotifyJob, guestRemindersJob } from './guest-notify';
import { hostDigestsJob, hostNotifyJob } from './host-notify';
import { orderNotifyJob } from './orders/notify';
import { orderTimerJob } from './orders/timer';
import {
  type CalendarJobDeps,
  pollCalendarJob,
  pollCalendarsJob,
  stayNotifyJob,
} from './poll-calendars';
import { type SafetyAlertsDeps, safetyAlertsJob } from './safety-alerts';
import { spaceEmailJob } from './space-email';
import { translateBlockJob } from './translate-block';
import { translateCatalogRecordJob } from './translate-catalog-record';
import { type HandoffJobDeps, translateHandoffJob } from './translate-handoff';
import { translateOfferJob } from './translate-offer';

// Later tickets add retention.
export function createJobs(
  deps: TranslationJobDeps &
    NotifyDeps &
    GuestNotifyDeps &
    HostNotifyDeps &
    CalendarJobDeps &
    HandoffJobDeps &
    SafetyAlertsDeps &
    DailyTipsDeps,
): JobDefinition[] {
  // The runner hands each handler the data its own queue was sent.
  return [
    translateBlockJob(deps) as JobDefinition,
    translateCatalogRecordJob(deps) as JobDefinition,
    translateOfferJob(deps) as JobDefinition,
    orderTimerJob(deps) as JobDefinition,
    orderNotifyJob(deps) as JobDefinition,
    pollCalendarsJob(deps),
    pollCalendarJob(deps) as JobDefinition,
    stayNotifyJob(deps) as JobDefinition,
    translateHandoffJob(deps) as JobDefinition,
    guestNotifyJob(deps) as JobDefinition,
    guestRemindersJob(deps),
    hostNotifyJob(deps) as JobDefinition,
    hostDigestsJob(deps),
    spaceEmailJob(deps) as JobDefinition,
    safetyAlertsJob(deps),
    dailyTipsJob(deps),
  ];
}
