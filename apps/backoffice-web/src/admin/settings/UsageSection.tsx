import { useEffect, useState } from 'react';
import { admin, type UsageEstimate } from '../../api';
import { Section } from '../../forms/fields';
import { MODEL_USE_LABELS } from '../../forms/labels';
import { useAction } from '../../useAction';

const usd = (amount: number) =>
  amount > 0 && amount < 0.005 ? '< $0.01' : `$${amount.toFixed(2)}`;

const checkedOn = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Read-only estimate of Fetivi's Anthropic spend, today and this month, by use (52 AC 5). */
export function UsageSection() {
  const { error, run } = useAction();
  const [usage, setUsage] = useState<UsageEstimate | null>(null);

  useEffect(() => {
    void run(async () => setUsage(await admin.usage()));
  }, [run]);

  return (
    <Section
      title="Anthropic usage"
      description={
        usage
          ? `An estimate: the tokens Fetivi records × Anthropic's published prices (checked ${checkedOn(usage.pricesCheckedOn)}). Your actual bill can differ. Days and months are in UTC.`
          : "An estimate: the tokens Fetivi records × Anthropic's published prices. Your actual bill can differ. Days and months are in UTC."
      }
    >
      {usage ? (
        <>
          <div className="table-frame">
            <table className="data-table keep-columns">
              <thead>
                <tr>
                  <th scope="col">Use</th>
                  <th scope="col" className="num">
                    Today
                  </th>
                  <th scope="col" className="num">
                    This month
                  </th>
                </tr>
              </thead>
              <tbody>
                {usage.month.byUse.map((month) => (
                  <tr key={month.use}>
                    <th scope="row">{MODEL_USE_LABELS[month.use]}</th>
                    <td className="num">
                      {usd(usage.today.byUse.find((t) => t.use === month.use)?.costUsd ?? 0)}
                    </td>
                    <td className="num">{usd(month.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">Total</th>
                  <td className="num">{usd(usage.today.totalUsd)}</td>
                  <td className="num">{usd(usage.month.totalUsd)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {usage.unpricedCalls > 0 ? (
            <p className="muted">
              {usage.unpricedCalls} {usage.unpricedCalls === 1 ? 'call' : 'calls'} used a model
              without a price in the table and {usage.unpricedCalls === 1 ? 'is' : 'are'} not
              counted.
            </p>
          ) : null}
        </>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : (
        <p className="muted">Loading…</p>
      )}
    </Section>
  );
}
