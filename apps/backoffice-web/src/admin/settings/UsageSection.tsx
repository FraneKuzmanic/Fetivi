import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { admin, type UsageEstimate } from '../../api';
import { Section } from '../../forms/fields';
import { i18next, localeOf } from '../../i18n';
import { useLabels } from '../../i18n/useLabels';
import { useAction } from '../../useAction';

const usd = (amount: number) => {
  const format = (n: number) =>
    new Intl.NumberFormat(localeOf(i18next.language), {
      style: 'currency',
      currency: 'USD',
      currencyDisplay: 'narrowSymbol',
    }).format(n);
  return amount > 0 && amount < 0.005
    ? i18next.t('admin:settings.lessThan', { amount: format(0.01) })
    : format(amount);
};

const checkedOn = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString(localeOf(i18next.language), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

/** Read-only estimate of Fetivi's Anthropic spend, today and this month, by use (52 AC 5). */
export function UsageSection() {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const labels = useLabels();
  const { error, run } = useAction();
  const [usage, setUsage] = useState<UsageEstimate | null>(null);

  useEffect(() => {
    void run(async () => setUsage(await admin.usage()));
  }, [run]);

  return (
    <Section
      title={t('settings.usage')}
      description={
        usage
          ? t('settings.usageHintChecked', { date: checkedOn(usage.pricesCheckedOn) })
          : t('settings.usageHint')
      }
    >
      {usage ? (
        <>
          <div className="table-frame">
            <table className="data-table keep-columns">
              <thead>
                <tr>
                  <th scope="col">{t('settings.use')}</th>
                  <th scope="col" className="num">
                    {t('settings.today')}
                  </th>
                  <th scope="col" className="num">
                    {t('settings.month')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {usage.month.byUse.map((month) => (
                  <tr key={month.use}>
                    <th scope="row">{labels.modelUse[month.use]}</th>
                    <td className="num">
                      {usd(usage.today.byUse.find((t) => t.use === month.use)?.costUsd ?? 0)}
                    </td>
                    <td className="num">{usd(month.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row">{t('settings.total')}</th>
                  <td className="num">{usd(usage.today.totalUsd)}</td>
                  <td className="num">{usd(usage.month.totalUsd)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          {usage.unpricedCalls > 0 ? (
            <p className="muted">{t('settings.unpriced', { count: usage.unpricedCalls })}</p>
          ) : null}
        </>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : (
        <p className="muted">{t('common:loading')}</p>
      )}
    </Section>
  );
}
