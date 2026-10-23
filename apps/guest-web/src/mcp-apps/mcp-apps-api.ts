import type { CallToolResult } from '@modelcontextprotocol/client';
import type { McpUiResourceCsp } from '@modelcontextprotocol/ext-apps/app-bridge';
import { api } from '../api';

export interface Widget {
  html: string;
  csp?: McpUiResourceCsp;
  pinHash: string;
}

// A widget is about 500 KB: one fetch per page for each widget and pin, however often it shows.
// The pin is in the URL too, so the browser's HTTP cache is keyed the same way.
const widgets = new Map<string, Promise<Widget>>();

export function fetchWidget(uri: string, pinHash: string): Promise<Widget> {
  const key = `${uri}#${pinHash}`;
  let widget = widgets.get(key);
  if (!widget) {
    widget = api<Widget>(
      `/api/mcp-apps/ferryhopper/widget?uri=${encodeURIComponent(uri)}&pin=${encodeURIComponent(pinHash)}`,
    );
    widget.catch(() => widgets.delete(key));
    widgets.set(key, widget);
  }
  return widget;
}

/** A call the widget makes; the backend runs it through its own client and the pinned tool list. */
export const callWidgetTool = (name: string, args: Record<string, unknown>) =>
  api<CallToolResult>('/api/mcp-apps/ferryhopper/call', {
    method: 'POST',
    body: { name, arguments: args },
  });
