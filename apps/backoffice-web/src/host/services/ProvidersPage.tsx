import { CURATION_LIMITS } from '@fetivi/domain/curation-vocabulary';
import { type FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { type HostProvider, host } from '../../api';
import { CheckboxField, SelectField, TextArea, TextField } from '../../forms/fields';
import { i18next } from '../../i18n';
import { usePageTitle } from '../../shell/PageTitle';
import { useAction } from '../../useAction';

const offersLabel = (n: number) => i18next.t('host:services.offers', { count: n });

function ProviderRow({
  provider,
  onChanged,
}: {
  provider: HostProvider;
  onChanged: (provider: HostProvider) => void;
}) {
  const { t } = useTranslation(['host', 'common']);
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
        {provider.hidden ? <span className="chip neutral">{t('services.hidden')}</span> : null}
        <CheckboxField
          label={
            <>
              {t('services.shown')}
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
  const { t } = useTranslation(['host', 'common']);
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

  usePageTitle(t('services.providersSeen'));

  return (
    <>
      <nav className="crumbs" aria-label={t('common:page.breadcrumb')}>
        <Link to="/services">{t('services.title')}</Link>
      </nav>
      <p className="muted">{t('services.providersIntro')}</p>
      {error ? <p role="alert">{error}</p> : null}
      {providers === null && !error ? <p className="muted">{t('common:loading')}</p> : null}
      {providers?.length === 0 ? (
        <p className="muted">
          {destinations.length === 0 ? t('services.noProvidersAtAll') : t('services.noProviders')}
        </p>
      ) : null}
      {providers && providers.length > 0 ? (
        <ul className="rows" aria-label={t('services.local')}>
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
  const { t } = useTranslation(['host', 'common']);
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
      <h2 id="suggest-provider">{t('services.suggest')}</h2>
      <p className="muted">{t('services.suggestIntro')}</p>
      <form onSubmit={submit}>
        <div className="fields">
          <TextField
            label={t('services.name')}
            value={name}
            maxLength={CURATION_LIMITS.suggestionName}
            required
            onChange={setName}
          />
          <TextField
            label={t('services.contact')}
            hint={t('services.contactHint')}
            value={contact}
            maxLength={CURATION_LIMITS.suggestionContact}
            onChange={setContact}
          />
          <TextArea
            label={t('services.why')}
            value={note}
            maxLength={CURATION_LIMITS.suggestionNote}
            rows={3}
            onChange={setNote}
          />
          {destinations.length > 1 ? (
            <SelectField
              label={t('services.area')}
              value={destinationId}
              options={destinations.map((d) => d.id)}
              labels={Object.fromEntries(destinations.map((d) => [d.id, d.name]))}
              emptyLabel={t('services.notSure')}
              onChange={setDestinationId}
            />
          ) : null}
        </div>
        {error ? <p role="alert">{error}</p> : null}
        <div className="section-foot">
          {sent && !error ? (
            <output className="saved" aria-live="polite">
              {t('services.thanks')}
            </output>
          ) : null}
          <button type="submit" className="primary" disabled={busy}>
            {t('services.sendSuggestion')}
          </button>
        </div>
      </form>
    </section>
  );
}
