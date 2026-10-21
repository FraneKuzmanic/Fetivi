import type { OrderSummaryPayload } from '@fetivi/ui/payloads';
import { api } from '../../api';

/** Every Order of the space, newest first; also after checkout. */
export const getOrders = () => api<{ orders: OrderSummaryPayload[] }>('/api/orders');
