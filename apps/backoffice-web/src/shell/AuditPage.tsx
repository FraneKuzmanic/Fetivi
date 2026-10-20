import { useEffect, useState } from 'react';
import { type AuditEntry, admin } from '../api';
import { useAction } from '../useAction';

export function AuditPage() {
  const { error, run } = useAction();
  const [entries, setEntries] = useState<AuditEntry[] | null>(null);

  useEffect(() => {
    void run(async () => setEntries((await admin.audit()).entries));
  }, [run]);

  return (
    <section>
      <h1>Act-as audit</h1>
      {error ? <p role="alert">{error}</p> : null}
      {entries === null ? <p>Loading…</p> : null}
      {entries?.length === 0 ? <p className="empty">Nothing recorded yet.</p> : null}
      <ul className="list">
        {entries?.map((entry) => (
          <li key={entry.id}>
            <strong>
              {entry.method} {entry.route}
            </strong>
            <span>
              {new Date(entry.createdAt).toLocaleString()} · status {entry.statusCode ?? '?'}
            </span>
            <span>
              Host {entry.hostEmail} · admin {entry.adminId}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
