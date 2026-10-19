import { createMcpFastifyApp } from '@modelcontextprotocol/fastify';
import type { Config } from './config';

export function buildApp(config: Pick<Config, 'HOST' | 'MCP_ALLOWED_HOSTS'>) {
  const app = createMcpFastifyApp({ host: config.HOST, allowedHosts: config.MCP_ALLOWED_HOSTS });
  app.get('/health', async () => ({ status: 'ok', service: 'mcp-servers' }));
  return app;
}
