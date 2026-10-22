import type { DayPlanPayload } from '@fetivi/ui/payloads';
import { api } from '../../api';

/** The day plan of every Stay day; also after checkout. */
export const getPlan = () => api<{ plan: DayPlanPayload }>('/api/plan');
