import type { McpAppPart } from '@fetivi/ui/payloads';
import type { CallToolResult } from '@modelcontextprotocol/client';
import type { AppBridge } from '@modelcontextprotocol/ext-apps/app-bridge';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isFerryhopperLink } from './links';
import { callWidgetTool, fetchWidget } from './mcp-apps-api';
import { sandboxUrl } from './sandbox';

// Until the widget reports its size. A widget only reports once it is on screen (S3), so the
// placeholder must be tall enough to be seen.
const PLACEHOLDER_PX = 480;

/**
 * An external server's widget: the sandbox proxy (its own origin) in an iframe, and the host side
 * of the MCP Apps bridge. Anything this handler list leaves out (the view reading resources,
 * sending chat messages, updating the model's context, downloads) is refused by the bridge.
 */
export function McpAppFrame({ part, reveal }: { part: McpAppPart; reveal: boolean }) {
  const { t, i18n } = useTranslation();
  const { resourceUri, pinHash } = part;
  const frame = useRef<HTMLIFrameElement>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(PLACEHOLDER_PX);
  const [failed, setFailed] = useState(false);
  // The stream may hand over a new object for the same part; only a new widget reloads the frame.
  const latest = useRef(part);
  latest.current = part;

  // Only on mount: a history widget never pulls the page; the newest one is brought into view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on mount.
  useEffect(() => {
    if (reveal) wrapper.current?.scrollIntoView({ block: 'nearest' });
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a part is immutable once streamed; the language at load time is enough.
  useEffect(() => {
    let cancelled = false;
    let bridge: AppBridge | undefined;
    const { input, result } = latest.current;
    // The bridge brings the MCP client with it: loaded only when a widget shows.
    Promise.all([
      fetchWidget(resourceUri, pinHash),
      import('@modelcontextprotocol/ext-apps/app-bridge'),
    ])
      .then(async ([widget, { AppBridge, PostMessageTransport }]) => {
        const iframe = frame.current;
        const win = iframe?.contentWindow;
        if (cancelled || !iframe || !win) return;
        const b = new AppBridge(
          null,
          { name: 'Fetivi', version: '0' },
          { openLinks: {}, serverTools: {} },
          {
            hostContext: {
              theme: 'light',
              platform: 'web',
              locale: i18n.language,
              displayMode: 'inline',
              availableDisplayModes: ['inline'],
            },
          },
        );
        bridge = b;
        b.onsandboxready = () => {
          void b.sendSandboxResourceReady({ html: widget.html, csp: widget.csp });
        };
        // Nothing goes to the view before it says it is initialized (spec).
        b.oninitialized = () => {
          void b.sendToolInput({ arguments: input });
          void b.sendToolResult(result as CallToolResult);
        };
        b.onsizechange = ({ height: h }) => {
          if (h) setHeight(Math.ceil(h));
        };
        b.onopenlink = async ({ url }) => {
          if (!isFerryhopperLink(url)) return { isError: true };
          window.open(url, '_blank', 'noopener,noreferrer');
          return {};
        };
        b.oncalltool = (params) => callWidgetTool(params.name, params.arguments ?? {});
        b.onrequestdisplaymode = async () => ({ mode: 'inline' });
        // Listening before the proxy loads, so its ready message is not missed.
        await b.connect(new PostMessageTransport(win, win));
        if (cancelled) return;
        iframe.src = sandboxUrl(widget.csp);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      if (!bridge) return;
      bridge.teardownResource({}).catch(() => {});
      void bridge.close();
    };
  }, [resourceUri, pinHash]);

  if (failed) return <p className="mcp-app-unavailable">{t('mcpApps.unavailable')}</p>;
  return (
    <div ref={wrapper} className="mcp-app-frame">
      <iframe
        ref={frame}
        title={t('mcpApps.frameTitle')}
        sandbox="allow-scripts allow-same-origin allow-forms"
        style={{ width: '100%', height, border: 0 }}
      />
    </div>
  );
}
