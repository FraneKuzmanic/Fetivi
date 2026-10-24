import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { type HostSuggestion, host } from '../../api';
import { useAction } from '../../useAction';

/**
 * What guests asked Fetivi about that the host's setup does not cover (44 AC 3): Fetivi's
 * sentence and a link to the wizard field, never what guests wrote (AC 4).
 */
export function SuggestionsPage() {
  const { error, run } = useAction();
  const [suggestions, setSuggestions] = useState<HostSuggestion[] | null>(null);

  useEffect(() => {
    void run(async () => setSuggestions((await host.suggestions()).suggestions));
  }, [run]);

  return (
    <>
      <div className="page-head">
        <h1>Suggestions</h1>
      </div>
      <p className="muted">
        What guests asked Fetivi about that your setup does not cover yet. You never see what guests
        wrote.
      </p>
      {suggestions === null ? (
        error ? (
          <p role="alert">{error}</p>
        ) : (
          <p className="muted">Loading…</p>
        )
      ) : suggestions.length > 0 ? (
        <ul className="rows">
          {suggestions.map((s) => (
            <li key={s.id} className="block-row">
              <div className="block-text">
                <strong>{s.text}</strong>
                <span className="muted">
                  {s.propertyName} · {s.unitName}
                </span>
              </div>
              <Link className="button primary" to={s.wizardPath}>
                Add it in setup
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p>
          Nothing missing right now. When guests ask about something your setup does not cover, it
          shows up here.
        </p>
      )}
    </>
  );
}
