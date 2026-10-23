export type SandboxConfig = { host: string; port: number; appOrigin: string };

/** Reads the proxy's settings; a bad value stops the process at boot rather than serving a broken page. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): SandboxConfig {
  const port = Number(env.PORT ?? 5175);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be a port number, got ${env.PORT}`);
  }
  const raw = env.APP_ORIGIN ?? 'http://localhost:5173';
  let appOrigin: string;
  try {
    appOrigin = new URL(raw).origin;
  } catch {
    throw new Error(`APP_ORIGIN must be an origin, got ${raw}`);
  }
  if (appOrigin === 'null' || appOrigin !== raw.replace(/\/$/, '')) {
    throw new Error(`APP_ORIGIN must be a bare origin such as https://app.example.com, got ${raw}`);
  }
  return { host: env.HOST ?? '127.0.0.1', port, appOrigin };
}
