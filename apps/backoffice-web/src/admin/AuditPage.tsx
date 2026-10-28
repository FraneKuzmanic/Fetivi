import { ClipboardText } from '@phosphor-icons/react';
import { useEffect, useState } from 'react';
import { type AuditEntry, admin } from '../api';
import { formatMoment } from '../forms/datetime';
import { EmptyState } from '../shell/EmptyState';
import { Pager } from '../shell/Pager';
import { usePageTitle } from '../shell/PageTitle';
import { SearchBox } from '../shell/SearchBox';
import { useAction } from '../useAction';

const PAGE = 50;

/** Requests that read best as their own sentence. */
const SENTENCES: Record<string, string> = {
  '/api/admin/act-as': 'Started acting as the host',
  '/api/admin/act-as/stop': 'Stopped acting as the host',
  '/api/host/inbox/:id/read': 'Read a guest message',
  '/api/host/inbox/:id/reply': 'Replied to a guest',
  '/api/host/units/:id/go-live': 'Put a unit live',
  '/api/host/probe': 'Checked the host account',
  '/api/host/payments/stripe/disconnect': 'Disconnected online payments',
  '/api/host/payments/stripe/onboarding-link': 'Started online payments setup',
  '/api/host/stay-proposals/:id/confirm': 'Confirmed a proposed stay',
  '/api/host/stay-proposals/:id/dismiss': 'Dismissed a proposed stay',
  '/api/host/orders/:id/actions': 'Answered an order',
  '/api/host/stays/:id/keep': 'Kept a stay',
  '/api/host/properties/:id/booking-links-approved': 'Approved booking links',
  '/api/host/payments/stripe/refresh': 'Checked online payments',
};

/** The thing a request touched, by the last named part of its path. */
const THINGS: [RegExp, string][] = [
  [/\/translations/, 'a translation'],
  [/\/amenities$/, 'amenities'],
  [/\/hidden-blocks$/, 'which guide entries the unit hides'],
  [/\/(picks|added-places|host-places)/, "the host's picks"],
  [/\/calendars/, 'a calendar'],
  [/\/allotment-slots|\/slots/, 'time slots'],
  [/\/blocks/, 'a guide entry'],
  [/\/stays/, 'a stay'],
  [/\/units/, 'a unit'],
  [/\/offers/, 'a service'],
  [/\/orders/, 'an order'],
  [/\/media/, 'a photo'],
  [/\/providers|\/provider-suggestions/, 'a provider'],
  [/\/notification-settings|\/push/, 'notification settings'],
  [/\/payments/, 'online payments'],
  [/\/properties/, 'a property'],
];

/** "Started acting as the host", "Changed a property": an audit line in words. */
export function auditAction(entry: Pick<AuditEntry, 'method' | 'route'>): string {
  const sentence = SENTENCES[entry.route];
  if (sentence) return sentence;
  const thing = THINGS.find(([pattern]) => pattern.test(entry.route))?.[1] ?? 'the account';
  if (/\/retry$/.test(entry.route)) return `Retried ${thing}`;
  if (entry.method === 'DELETE') return `Deleted ${thing}`;
  if (entry.method === 'POST' && !entry.route.endsWith(':id')) {
    return /\/:id\/[a-z-]+$|^\/api\/host\/[a-z-]+$/.test(entry.route)
      ? `Added ${thing}`
      : `Updated ${thing}`;
  }
  return `Changed ${thing}`;
}

const failed = (code: number | null) => code !== null && code >= 400;

/** /admin/audit: everything done while acting as a host, newest first. */
export function AuditPage() {
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

  usePageTitle('Audit log');

  return (
    <>
      <p className="muted">Everything done while acting as a host, newest first.</p>
      {error ? <p role="alert">{error}</p> : null}
      {entries === null && !error ? <p className="muted">Loading…</p> : null}
      {entries?.length === 0 ? (
        <EmptyState icon={ClipboardText} title="Nothing logged yet">
          When you act as a host, every change you make in their account is listed here.
        </EmptyState>
      ) : null}
      {entries && entries.length > 0 ? (
        <>
          <div className="toolbar">
            <SearchBox
              label="Search the log"
              value={query}
              placeholder="Host or admin email"
              onChange={(v) => {
                setQuery(v);
                setOffset(0);
              }}
            />
          </div>
          {shown.length === 0 ? (
            <EmptyState
              icon={ClipboardText}
              title={`Nothing logged for “${query.trim()}”`}
              action={
                <button type="button" onClick={() => setQuery('')}>
                  Clear search
                </button>
              }
            />
          ) : (
            <>
              <div className="table-frame">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">What happened</th>
                      <th scope="col">Host</th>
                      <th scope="col" className="wide-only">
                        By
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
                              <span className="chip fail">Didn’t go through</span>
                            </>
                          ) : null}
                        </td>
                        <td>{e.hostEmail}</td>
                        <td className="wide-only">{e.adminEmail ?? 'A removed admin'}</td>
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
