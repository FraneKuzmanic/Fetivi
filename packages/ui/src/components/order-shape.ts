import type { AvailabilityMode, OrderKind } from '@fetivi/domain/offer-vocabulary';

/** Who accepts the Order and is paid directly: the host for the host's own Offers. */
export type OrderOwner = 'provider' | 'host';

/** How the guest's cards word an Order: a purchase stays an order even when it waits for a yes. */
export type OrderShape = 'booking' | 'request' | 'purchase';

export function orderShape(kind: OrderKind, availability: AvailabilityMode): OrderShape {
  if (kind === 'purchase') return 'purchase';
  return kind === 'request' || availability === 'on_request' ? 'request' : 'booking';
}
