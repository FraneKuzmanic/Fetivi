/**
 * Whether this browser may be offered push: Android only (no iPhone push, PRD §8), with a service
 * worker, the Push API and notifications, and not already blocked by the guest.
 */
export function canOfferPush(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    /Android/i.test(navigator.userAgent) &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window &&
    Notification.permission !== 'denied'
  );
}

/** A VAPID public key (base64url) as the bytes `pushManager.subscribe` takes. */
export function applicationServerKey(base64url: string): Uint8Array<ArrayBuffer> {
  const base64 = (base64url + '='.repeat((4 - (base64url.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
