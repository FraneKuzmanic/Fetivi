import { ClipboardText } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { type AuditEntry, admin } from '../api';
import { formatMoment } from '../forms/datetime';
import { i18next } from '../i18n';
import { EmptyState } from '../shell/EmptyState';
import { Pager } from '../shell/Pager';
import { usePageTitle } from '../shell/PageTitle';
import { SearchBox } from '../shell/SearchBox';
import { useAction } from '../useAction';

const PAGE = 50;

/** Requests that read best as their own sentence. */
const SENTENCES = {
  '/api/admin/act-as': 'actAs',
  '/api/admin/act-as/stop': 'stopActing',
  '/api/host/inbox/:id/read': 'readMessage',
  '/api/host/inbox/:id/reply': 'replied',
  '/api/host/units/:id/go-live': 'goLive',
  '/api/host/probe': 'probe',
  '/api/host/payments/stripe/disconnect': 'stripeDisconnect',
  '/api/host/payments/stripe/onboarding-link': 'stripeOnboarding',
  '/api/host/stay-proposals/:id/confirm': 'confirmProposal',
  '/api/host/stay-proposals/:id/dismiss': 'dismissProposal',
  '/api/host/orders/:id/actions': 'orderAction',
  '/api/host/stays/:id/keep': 'keepStay',
  '/api/host/properties/:id/booking-links-approved': 'bookingLinks',
  '/api/host/payments/stripe/refresh': 'stripeRefresh',
} as const;

/** The thing a request touched, by the last named part of its path. */
const THINGS = [
  [/\/translations/, 'translation'],
  [/\/amenities$/, 'amenities'],
  [/\/hidden-blocks$/, 'hiddenBlocks'],
  [/\/(picks|added-places|host-places)/, 'picks'],
  [/\/calendars/, 'calendar'],
  [/\/allotment-slots|\/slots/, 'slots'],
  [/\/blocks/, 'block'],
  [/\/stays/, 'stay'],
  [/\/units/, 'unit'],
  [/\/offers/, 'offer'],
  [/\/orders/, 'order'],
  [/\/media/, 'media'],
  [/\/providers|\/provider-suggestions/, 'provider'],
  [/\/notification-settings|\/push/, 'notifications'],
  [/\/payments/, 'payments'],
  [/\/properties/, 'property'],
] as const;

const t = i18next.getFixedT(null, 'admin', 'audit');

/** "Started acting as the host", "Changed a property": an audit line in words. */
export function auditAction(entry: Pick<AuditEntry, 'method' | 'route'>): string {
  const sentence = SENTENCES[entry.route as keyof typeof SENTENCES];
  if (sentence) return t(sentence);
  const thing = t(THINGS.find(([pattern]) => pattern.test(entry.route))?.[1] ?? 'account');
  if (/\/retry$/.test(entry.route)) return t('retried', { thing });
  if (entry.method === 'DELETE') return t('deleted', { thing });
  if (entry.method === 'POST' && !entry.route.endsWith(':id')) {
    return /\/:id\/[a-z-]+$|^\/api\/host\/[a-z-]+$/.test(entry.route)
      ? t('added', { thing })
      : t('updated', { thing });
  }
  return t('changed', { thing });
}

const failed = (code: number | null) => code !== null && code >= 400;

/** /admin/audit: everything done while acting as a host, newest first. */
export function AuditPage() {
  useTranslation('admin');
  const { t: tc } = useTranslation();
  const { error, run } = useAction();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);
  const [query, setQuery] = useState('');
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    void run(async () => setEntries((await admin.audit()).entries));
  }, [run]);

  const needle = query.trim().toLowerCase();
  const shown =
    entries?.filter(
      (e) =>
        e.hostEmail.toLowerCase().includes(needle) ||
        (e.adminEmail ?? '').toLowerCase().includes(needle),
    ) ?? [];
  const page = shown.slice(offset, offset + PAGE);

  usePageTitle(t('title'));

  return (
    <>
      <p className="muted">{t('intro')}</p>
      {error ? <p role="alert">{error}</p> : null}
      {entries === null && !error ? <p className="muted">{tc('loading')}</p> : null}
      {entries?.length === 0 ? (
        <EmptyState icon={ClipboardText} title={t('none')}>
          {t('noneBody')}
        </EmptyState>
      ) : null}
      {entries && entries.length > 0 ? (
        <>
          <div className="toolbar">
            <SearchBox
              label={t('search')}
              value={query}
              placeholder={t('searchPlaceholder')}
              onChange={(v) => {
                setQuery(v);
                setOffset(0);
              }}
            />
          </div>
          {shown.length === 0 ? (
            <EmptyState
              icon={ClipboardText}
              title={t('noMatch', { query: query.trim() })}
              action={
                <button type="button" onClick={() => setQuery('')}>
                  {tc('table.clearSearch')}
                </button>
              }
            />
          ) : (
            <>
              <div className="table-frame">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">{t('when')}</th>
                      <th scope="col">{t('what')}</th>
                      <th scope="col">{t('host')}</th>
                      <th scope="col" className="wide-only">
                        {t('by')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.map((e) => (
                      <tr key={e.id}>
                        <td className="nowrap">{formatMoment(e.createdAt)}</td>
                        <td>
                          {auditAction(e)}
                          {failed(e.statusCode) ? (
                            <>
                              {' '}
                              <span className="chip fail">{t('failed')}</span>
                            </>
                          ) : null}
                        </td>
                        <td>{e.hostEmail}</td>
                        <td className="wide-only">{e.adminEmail ?? t('removedAdmin')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {shown.length > PAGE ? (
                <Pager offset={offset} total={shown.length} size={PAGE} onChange={setOffset} />
              ) : null}
            </>
          )}
        </>
      ) : null}
    </>
  );
}
