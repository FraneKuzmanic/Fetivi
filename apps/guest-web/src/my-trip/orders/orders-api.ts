import type { OrderSummaryPayload } from '@fetivi/ui/payloads';
import { useCallback, useState } from 'react';
import { api } from '../../api';

/** Every Order of the space, newest first; also after checkout. */
export const getOrders = () => api<{ orders: OrderSummaryPayload[] }>('/api/orders');

export type CheckoutReply =
  | { state: 'ready'; url: string }
  | { state: 'preparing' }
  | { state: 'closed' };

/** The stored Stripe Checkout URL of a pay-online Order; the server decides, never the chat part. */
export const requestCheckout = (orderId: string) =>
  api<CheckoutReply>(`/api/orders/${encodeURIComponent(orderId)}/checkout`, { method: 'POST' });

const PREPARING_RETRY_MS = 1000;
const PREPARING_LIMIT_MS = 15_000;

export interface CheckoutEnv {
  assign: (url: string) => void;
  wait: (ms: number) => Promise<void>;
}

const browser: CheckoutEnv = {
  assign: (url) => window.location.assign(url),
  wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Opens the secure payment page: asks again every second while the payment job is still opening
 * it (up to 15 s), then leaves for Stripe. `closed` when the payment window has passed; throws
 * when the server can't be reached or the page never got ready.
 */
export async function startCheckout(
  orderId: string,
  env: CheckoutEnv = browser,
): Promise<'opened' | 'closed'> {
  for (let waited = 0; ; waited += PREPARING_RETRY_MS) {
    const reply = await requestCheckout(orderId);
    if (reply.state === 'ready') {
      env.assign(reply.url);
      return 'opened';
    }
    if (reply.state === 'closed') return 'closed';
    if (waited >= PREPARING_LIMIT_MS) throw new Error('checkout-not-ready');
    await env.wait(PREPARING_RETRY_MS);
  }
}

/** Why Pay now did not open the payment page. */
export type PayNoticeKey = 'order.checkoutClosed' | 'error.network';

/**
 * The Pay now button's state for a list of receipts: which Order is opening, and a notice line
 * (an i18n key) for the Order whose payment could not open.
 */
export function usePay(onClosed?: () => void) {
  const [paying, setPaying] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ orderId: string; key: PayNoticeKey } | null>(null);
  const pay = useCallback(
    async (orderId: string) => {
      setPaying(orderId);
      setNotice(null);
      try {
        // Opened: the page leaves for Stripe, so the button stays busy.
        if ((await startCheckout(orderId)) === 'opened') return;
        setNotice({ orderId, key: 'order.checkoutClosed' });
        onClosed?.();
      } catch {
        setNotice({ orderId, key: 'error.network' });
      }
      setPaying(null);
    },
    [onClosed],
  );
  return { paying, notice, pay };
}
