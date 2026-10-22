import { useId } from 'react';
import { host } from '../../../api';
import { useAction } from '../../../useAction';
import { CopyButton } from '../StayPage';

/**
 * The one-time Booking.com step: approve Fetivi's guest domain, so Booking.com does not strip the
 * link from the hand-over message. The extranet's menu wording is not verified, so it stays loose.
 */
export function BookingLinksStep({
  domain,
  propertyId,
  propertyName,
  onDone,
}: {
  domain: string;
  propertyId: string;
  /** Shown when the host has several properties. */
  propertyName?: string;
  onDone: () => void;
}) {
  const headingId = useId();
  const { busy, error, run } = useAction();
  return (
    <section className="panel booking-step" aria-labelledby={headingId}>
      <h2 id={headingId}>
        Approve Fetivi's link on Booking.com{propertyName ? ` · ${propertyName}` : ''}
      </h2>
      <p className="muted">
        Booking.com removes links to sites it does not know. Approve Fetivi's guest link once, so
        the message with the link reaches your guests.
      </p>
      <ol className="steps-list">
        <li>
          In the Booking.com extranet, open your property's messaging or security settings and find
          "Your approved links".
        </li>
        <li>
          Add <strong className="mono-text">{domain}</strong>
          <CopyButton text={domain} label="Copy domain" />
        </li>
        <li>Come back here and tap Done.</li>
      </ol>
      {error ? <p role="alert">{error}</p> : null}
      <div className="actions">
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await host.approveBookingLinks(propertyId);
              onDone();
            })
          }
        >
          Done
        </button>
      </div>
    </section>
  );
}
