// The Inbox page tells the shell when the unread count may have changed, so the nav badge is not
// left showing a message the host has just opened.
const EVENT = 'fetivi:inbox-changed';

export const inboxChanged = () => window.dispatchEvent(new Event(EVENT));

export function onInboxChanged(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

/** A push reached this phone: the service worker asks open windows to check the inbox. */
export function onPushMessage(listener: () => void): () => void {
  const container = typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
  if (!container) return () => {};
  const handle = (event: MessageEvent) => {
    // The message type public/sw.js posts after a push; keep the two in step.
    if ((event.data as { type?: string } | null)?.type === 'fetivi-host-inbox') listener();
  };
  container.addEventListener('message', handle);
  return () => container.removeEventListener('message', handle);
}
