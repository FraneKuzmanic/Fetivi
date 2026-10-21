import { format, useWizardCopy } from './copy';

/** Required and Recommended fields answered, as a thin bar with the count. */
export function CompletenessBar({
  percent,
  filled,
  total,
}: {
  percent: number;
  filled: number;
  total: number;
}) {
  const { ui } = useWizardCopy();
  const label = format(ui.completeness, { percent });
  return (
    <div className="completeness">
      <div className="completeness-head">
        <strong>{label}</strong>
        <span className="muted">{format(ui.completenessCount, { filled, total })}</span>
      </div>
      <div
        className="completeness-track"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div className="completeness-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
