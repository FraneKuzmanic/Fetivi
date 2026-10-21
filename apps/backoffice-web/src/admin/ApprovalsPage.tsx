import { useCallback, useEffect, useState } from 'react';
import { type AdminPropertyRow, admin } from '../api';
import { useAction } from '../useAction';

type Status = 'pending' | 'approved';

export function ApprovalsPage() {
  const { busy, error, run } = useAction();
  const [status, setStatus] = useState<Status>('pending');
  const [rows, setRows] = useState<AdminPropertyRow[] | null>(null);

  const load = useCallback(
    () =>
      run(async () => {
        setRows(null);
        setRows((await admin.properties(status)).properties);
      }),
    [run, status],
  );

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <div className="page-head">
        <h1>Approvals</h1>
        <div className="segmented" role="tablist" aria-label="Status">
          {(['pending', 'approved'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              aria-selected={status === s}
              onClick={() => setStatus(s)}
            >
              {s === 'pending' ? 'Pending' : 'Approved'}
            </button>
          ))}
        </div>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {rows === null && !error ? <p className="muted">Loading…</p> : null}
      {rows?.length === 0 ? (
        <p className="muted">
          {status === 'pending' ? 'No properties waiting for approval.' : 'Nothing approved yet.'}
        </p>
      ) : null}
      {rows && rows.length > 0 ? (
        <ul className="rows">
          {rows.map((p) => (
            <li key={p.id} className="block-row">
              <div className="block-text">
                <strong>
                  {p.name}
                  {p.city ? <span className="muted"> · {p.city}</span> : null}
                </strong>
                <span className="muted">
                  {p.hostEmail} · {p.unitCount === 1 ? '1 unit' : `${p.unitCount} units`} · added{' '}
                  {new Date(p.createdAt).toLocaleDateString()}
                  {p.approvedAt
                    ? ` · approved ${new Date(p.approvedAt).toLocaleDateString()}`
                    : null}
                </span>
              </div>
              {status === 'pending' ? (
                <div className="actions">
                  <button
                    type="button"
                    className="primary"
                    disabled={busy}
                    onClick={() => {
                      if (
                        window.confirm(
                          `Approve ${p.name}? Units that meet the go-live minimum get their QR links now; the others when they go live.`,
                        )
                      ) {
                        void run(async () => {
                          await admin.approve(p.id);
                          setRows((await admin.properties(status)).properties);
                        });
                      }
                    }}
                  >
                    Approve
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
