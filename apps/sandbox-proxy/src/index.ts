import { loadConfig } from './config';
import { createSandboxServer } from './server';

const config = loadConfig();
const server = createSandboxServer(config);

server.listen(config.port, config.host, () => {
  console.log(
    `Sandbox proxy on http://${config.host}:${config.port}/sandbox.html for ${config.appOrigin}`,
  );
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
