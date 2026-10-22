import type { HostMessageSentPayload } from '../../payloads';

export interface HostSentLabels {
  heading: string;
  /** "Sent · 14:05". */
  sentAt: (sentAt: string) => string;
  /** The host opened it. Never "seen". */
  read: string;
  urgent: string;
}

/**
 * A sent Host message: the guest's words and whether the host has opened it. The status line is
 * plain text; the parent announces a change once, so it is not re-read on every render.
 */
export function HostMessageSent({
  message,
  status,
  labels,
}: {
  message: HostMessageSentPayload['message'];
  status: 'sent' | 'read';
  labels: HostSentLabels;
}) {
  return (
    <article className="fv-receipt fv-host-sent">
      <h3 className="fv-receipt-title">{labels.heading}</h3>
      <blockquote className="fv-host-sent-text">{message.text}</blockquote>
      <p className="fv-host-sent-status">
        <span className="fv-status">
          <span
            className="fv-status-dot"
            data-tone={status === 'read' ? 'good' : 'wait'}
            aria-hidden="true"
          />
          {status === 'read' ? labels.read : labels.sentAt(message.sentAt)}
        </span>
        {message.urgency === 'urgent' && (
          <span className="fv-host-sent-urgent">{labels.urgent}</span>
        )}
      </p>
    </article>
  );
}
