import { Mascot } from './Mascot';

/** The Fetivi name with the mascot as its logo mark; the page's own heading follows it. */
export function Wordmark() {
  return (
    <p className="wordmark">
      <Mascot className="wordmark-mascot" />
      Fetivi
    </p>
  );
}
