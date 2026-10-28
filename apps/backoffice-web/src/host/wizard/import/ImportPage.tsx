import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  type ConfirmBody,
  host,
  type ManualImport,
  type PropertyDetail,
  type UnitDetail,
} from '../../../api';
import { usePageTitle } from '../../../shell/PageTitle';
import { useAction } from '../../../useAction';
import { format, useWizardCopy } from '../copy';
import { loadedValues } from '../targets';
import { DraftItem } from './DraftItem';
import { groupByStep, summaryCounts } from './drafts';
import { type ManualInput, ManualSource } from './ManualSource';
import { UnmappedItem } from './UnmappedItem';

interface Loaded {
  detail: UnitDetail;
  property: PropertyDetail;
  manualImport: ManualImport | null;
}

/** /units/:id/setup/import: paste or upload a house manual, then review its drafts one by one. */
export function ImportPage() {
  const { id = '' } = useParams();
  const copy = useWizardCopy();
  const mi = copy.manualImport;
  const { busy, error, run } = useAction();
  const [data, setData] = useState<Loaded | null>(null);
  const [replacing, setReplacing] = useState(false);

  const loadUnit = useCallback(async () => {
    const detail = await host.unit(id);
    const property = await host.property(detail.propertyId);
    return { detail, property };
  }, [id]);

  useEffect(() => {
    void run(async () => {
      const [unit, result] = await Promise.all([loadUnit(), host.manualImport(id)]);
      setData({ ...unit, manualImport: result.import });
    });
  }, [run, loadUnit, id]);

  const loaded = useMemo(() => data && loadedValues(data.detail, data.property), [data]);

  // A link from a step (#step-x) scrolls to that step's drafts once they are shown.
  const ready = data !== null;
  useEffect(() => {
    if (!ready || !window.location.hash.startsWith('#step-')) return;
    document.getElementById(window.location.hash.slice(1))?.scrollIntoView({ block: 'start' });
  }, [ready]);

  usePageTitle(mi.title);

  if (!data || !loaded)
    return error ? <p role="alert">{error}</p> : <p className="muted">Loading…</p>;
  const { detail, manualImport } = data;
  const setImport = (next: ManualImport) => setData((d) => d && { ...d, manualImport: next });

  const start = (input: ManualInput) =>
    void run(async () => {
      const result =
        input.kind === 'paste'
          ? await host.pasteManual(id, input.text)
          : await host.uploadManual(id, input.file);
      setImport(result.import);
      setReplacing(false);
    });

  async function confirm(itemId: string, body: ConfirmBody) {
    const result = await host.confirmDraft(id, itemId, body);
    setImport(result.import);
    // The saved values changed: "Now: …" reads them.
    const unit = await loadUnit();
    setData((d) => d && { ...d, ...unit });
    return result.warnings;
  }

  async function dismiss(itemId: string) {
    setImport((await host.dismissDraft(id, itemId)).import);
  }

  const items = manualImport?.items ?? [];
  const counts = summaryCounts(items);
  const { steps, unmapped } = groupByStep(items);
  const setupPath = `/units/${id}/setup`;

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to={`/properties/${detail.propertyId}`}>{detail.propertyName}</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/units/${id}`}>{detail.name}</Link>
        <span aria-hidden="true">/</span>
        <Link to={setupPath}>{copy.ui.setup}</Link>
      </nav>
      <p className="muted">{mi.intro}</p>

      {manualImport === null || replacing ? (
        <ManualSource
          busy={busy}
          error={error}
          pendingDrafts={counts.pending}
          onStart={start}
          {...(replacing ? { onCancel: () => setReplacing(false) } : {})}
        />
      ) : (
        <>
          <div className="manual-summary">
            <p>
              {format(mi.summary, {
                pending: counts.pending,
                confirmed: counts.confirmed,
                dismissed: counts.dismissed,
              })}
            </p>
            <button type="button" onClick={() => setReplacing(true)}>
              {mi.importAnother}
            </button>
          </div>
          {error ? <p role="alert">{error}</p> : null}
          {items.length === 0 ? <p className="panel">{mi.nothingFound}</p> : null}
          {items.length > 0 && counts.pending === 0 ? (
            <div className="panel manual-done" role="status">
              <p>{mi.allReviewed}</p>
              <Link className="button primary" to={setupPath}>
                {mi.backToSetup}
              </Link>
            </div>
          ) : null}

          {steps.map(([stepId, ofStep]) => (
            <section key={stepId} className="panel" aria-labelledby={`step-${stepId}`}>
              <h2 id={`step-${stepId}`}>{copy.steps[stepId].title}</h2>
              <ul className="manual-list">
                {ofStep.map((item) =>
                  item.kind === 'unmapped' ? null : (
                    <DraftItem
                      key={item.id}
                      item={item}
                      loaded={loaded}
                      onConfirm={(body) => confirm(item.id, body)}
                      onDismiss={() => dismiss(item.id)}
                    />
                  ),
                )}
              </ul>
            </section>
          ))}

          {unmapped.length > 0 ? (
            <section className="panel" aria-labelledby="step-unmapped">
              <h2 id="step-unmapped">{mi.unmappedTitle}</h2>
              <p className="muted">{mi.unmappedIntro}</p>
              <ul className="manual-list">
                {unmapped.map((item) =>
                  item.kind === 'unmapped' ? (
                    <UnmappedItem
                      key={item.id}
                      item={item}
                      onConfirm={(body) => confirm(item.id, body)}
                      onDismiss={() => dismiss(item.id)}
                    />
                  ) : null,
                )}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </>
  );
}
