import { CURATION_LIMITS } from '@fetivi/domain/curation-vocabulary';
import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { type HostProvider, host } from '../../api';
import { CheckboxField, SelectField, TextArea, TextField } from '../../forms/fields';
import { useAction } from '../../useAction';

const offersLabel = (n: number) => (n === 1 ? '1 offer' : `${n} offers`);

function ProviderRow({
  provider,
  onChanged,
}: {
  provider: HostProvider;
  onChanged: (provider: HostProvider) => void;
}) {
  const { busy, error, run } = useAction();
  return (
    <li className="host-provider-row">
      <span className="block-text">
        <strong>{provider.name}</strong>
        <span className="muted">
          {[...provider.destinations, offersLabel(provider.offerCount)].join(' · ')}
        </span>
      </span>
      <span className="host-provider-toggle">
        {provider.hidden ? <span className="chip neutral">Hidden</span> : null}
        <CheckboxField
          label={
            <>
              Shown to your guests
              <span className="visually-hidden"> ({provider.name})</span>
            </>
          }
          checked={!provider.hidden}
          disabled={busy}
          onChange={(shown) =>
            void run(async () => onChanged(await host.setProviderHidden(provider.id, !shown)))
          }
        />
      </span>
      {error ? <p role="alert">{error}</p> : null}
    </li>
  );
}

/** /services/providers: hide approved Providers from your guests, or suggest one (38). */
export function ProvidersPage() {
  const { error, run } = useAction();
  const [providers, setProviders] = useState<HostProvider[] | null>(null);
  const [destinations, setDestinations] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    void run(async () => {
      const list = await host.providers();
      setProviders(list.providers);
      setDestinations(list.destinations);
    });
  }, [run]);

  const replace = (updated: HostProvider) =>
    setProviders((list) => list?.map((p) => (p.id === updated.id ? updated : p)) ?? list);

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/services">Services</Link>
      </nav>
      <div className="page-head">
        <h1>Providers your guests see</h1>
      </div>
      <p className="muted">
        Every approved Provider near your property is shown to your guests unless you hide it.
        Hiding never changes orders already made.
      </p>
      {error ? <p role="alert">{error}</p> : null}
      {providers === null && !error ? <p className="muted">Loading…</p> : null}
      {providers?.length === 0 ? (
        <p className="muted">
          {destinations.length === 0
            ? 'Fetivi has no Providers near your properties yet.'
            : 'No approved Providers near your properties yet.'}
        </p>
      ) : null}
      {providers && providers.length > 0 ? (
        <ul className="rows" aria-label="Providers">
          {providers.map((p) => (
            <ProviderRow key={p.id} provider={p} onChanged={replace} />
          ))}
        </ul>
      ) : null}
      <SuggestForm destinations={destinations} />
    </>
  );
}

function SuggestForm({ destinations }: { destinations: { id: string; name: string }[] }) {
  const { busy, error, run } = useAction();
  const [name, setName] = useState<string | null>(null);
  const [contact, setContact] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [destinationId, setDestinationId] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    setSent(false);
    void run(async () => {
      await host.suggestProvider({
        name: name ?? '',
        contact,
        note,
        // With one destination there is nothing to choose: it is that one.
        destinationId: destinations.length === 1 ? (destinations[0]?.id ?? null) : destinationId,
      });
      setName(null);
      setContact(null);
      setNote(null);
      setSent(true);
    });
  }

  return (
    <section className="panel narrow" aria-labelledby="suggest-provider">
      <h2 id="suggest-provider">Suggest a provider</h2>
      <p className="muted">
        A local business you trust. The Fetivi team checks it before guests see it.
      </p>
      <form onSubmit={submit}>
        <div className="fields">
          <TextField
            label="Name"
            value={name}
            maxLength={CURATION_LIMITS.suggestionName}
            required
            onChange={setName}
          />
          <TextField
            label="Contact"
            hint="Phone, email or website, if you have one."
            value={contact}
            maxLength={CURATION_LIMITS.suggestionContact}
            onChange={setContact}
          />
          <TextArea
            label="Why you recommend them"
            value={note}
            maxLength={CURATION_LIMITS.suggestionNote}
            rows={3}
            onChange={setNote}
          />
          {destinations.length > 1 ? (
            <SelectField
              label="Area"
              value={destinationId}
              options={destinations.map((d) => d.id)}
              labels={Object.fromEntries(destinations.map((d) => [d.id, d.name]))}
              emptyLabel="Not sure"
              onChange={setDestinationId}
            />
          ) : null}
        </div>
        {error ? <p role="alert">{error}</p> : null}
        <div className="section-foot">
          {sent && !error ? (
            <output className="saved" aria-live="polite">
              Thanks — the Fetivi team will review it.
            </output>
          ) : null}
          <button type="submit" className="primary" disabled={busy}>
            Send suggestion
          </button>
        </div>
      </form>
    </section>
  );
}
