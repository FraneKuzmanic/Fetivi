import { useTranslation } from 'react-i18next';
/** "51–100 of 230" with Previous and Next, under a long table. */
export function Pager({
  offset,
  total,
  size,
  onChange,
}: {
  offset: number;
  total: number;
  size: number;
  onChange: (offset: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="pager">
      <span>{t('range', { from: offset + 1, to: Math.min(offset + size, total), total })}</span>
      <div className="actions">
        <button type="button" disabled={offset === 0} onClick={() => onChange(offset - size)}>
          {t('previous')}
        </button>
        <button
          type="button"
          disabled={offset + size >= total}
          onClick={() => onChange(offset + size)}
        >
          {t('next')}
        </button>
      </div>
    </div>
  );
}
