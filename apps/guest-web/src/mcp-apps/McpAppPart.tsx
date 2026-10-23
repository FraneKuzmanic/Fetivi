import { mcpAppPart } from '@fetivi/ui/payloads';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { McpAppFrame } from './McpAppFrame';

/** A widget from an external server, checked again (a stored part may predate a schema change). */
export function McpAppPart({ data, reveal }: { data: unknown; reveal: boolean }) {
  const { t } = useTranslation();
  const parsed = useMemo(() => mcpAppPart.safeParse(data), [data]);
  if (!parsed.success) return null;
  return (
    <section className="mcp-app" aria-label={t('mcpApps.frameTitle')}>
      <p className="mcp-app-caption">{t('mcpApps.from')}</p>
      <McpAppFrame part={parsed.data} reveal={reveal} />
    </section>
  );
}
