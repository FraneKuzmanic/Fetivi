import type { PropertyType } from '@fetivi/domain/vocabulary';
import { isWizardStepId } from '@fetivi/domain/wizard';
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { host, type PropertyDetail, type UnitDetail, type WizardStatus } from '../../api';
import { useAction } from '../../useAction';
import { format, useWizardCopy } from './copy';
import { GoLivePanel } from './GoLivePanel';
import { LanguagePicker } from './LanguagePicker';
import { WizardOverview } from './WizardOverview';
import { WizardStep } from './WizardStep';

interface Loaded {
  detail: UnitDetail;
  property: PropertyDetail;
  status: WizardStatus;
}

/** /units/:id/setup and /units/:id/setup/:stepId. Progress lives in the saved data only. */
export function WizardPage() {
  const { id = '', stepId } = useParams();
  const { ui } = useWizardCopy();
  const { busy, error, run } = useAction();
  const [data, setData] = useState<Loaded | null>(null);

  const reload = useCallback(async () => {
    const [detail, status] = await Promise.all([host.unit(id), host.wizard(id)]);
    const property = await host.property(detail.propertyId);
    setData({ detail, property, status });
  }, [id]);

  useEffect(() => {
    void run(reload);
  }, [run, reload]);

  if (stepId !== undefined && !isWizardStepId(stepId)) {
    return <Navigate to={`/units/${id}/setup`} replace />;
  }
  if (!data) return error ? <p role="alert">{error}</p> : <p className="muted">Loading…</p>;

  const { detail, property, status } = data;
  const goLivePanel = (
    <GoLivePanel
      status={status}
      busy={busy}
      onGoLive={() =>
        void run(async () => {
          await host.goLive(id);
          await reload();
        })
      }
      onRefresh={async () => {
        const fresh = await host.wizard(id);
        setData((d) => d && { ...d, status: fresh });
      }}
    />
  );

  if (stepId) {
    return (
      <WizardStep
        key={stepId}
        stepId={stepId}
        status={status}
        detail={detail}
        property={property}
        reload={reload}
      />
    );
  }

  const setType = (propertyType: PropertyType) =>
    void run(async () => {
      await host.updateProperty(detail.propertyId, { propertyType });
      await reload();
    });

  return (
    <>
      <nav className="crumbs" aria-label="Breadcrumb">
        <Link to="/">Properties</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/properties/${detail.propertyId}`}>{detail.propertyName}</Link>
        <span aria-hidden="true">/</span>
        <Link to={`/units/${id}`}>{detail.name}</Link>
      </nav>
      <div className="page-head">
        <div>
          <h1>{format(ui.overviewTitle, { unit: detail.name })}</h1>
          <p className="muted">{ui.overviewIntro}</p>
        </div>
        <LanguagePicker />
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <WizardOverview
        status={status}
        busy={busy}
        onTypeChange={setType}
        goLivePanel={goLivePanel}
      />
    </>
  );
}
