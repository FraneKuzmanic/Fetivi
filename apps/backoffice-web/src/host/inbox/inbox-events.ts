// The Inbox page tells the shell when the unread count may have changed, so the nav badge is not
// left showing a message the host has just opened.
const EVENT = 'fetivi:inbox-changed';

export const inboxChanged = () => window.dispatchEvent(new Event(EVENT));

export function onInboxChanged(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
