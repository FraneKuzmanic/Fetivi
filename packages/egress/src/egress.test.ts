import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createEgress, EgressBlockedError, type EgressOptions, isAllowedUrl } from './index';

interface Seen {
  method: string;
  url: string;
  headers: IncomingHttpHeaders;
  body: string;
}

let server: Server;
let port: number;
let seen: Seen[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body });
      const path = req.url ?? '/';
      if (path === '/hello') {
        res.end('hello');
      } else if (path === '/to-hello') {
        res.writeHead(302, { location: '/hello' }).end();
      } else if (path === '/to-evil') {
        res.writeHead(302, { location: 'https://evil.example.net/' }).end();
      } else if (path === '/loop') {
        res.writeHead(302, { location: '/loop' }).end();
      } else if (path === '/to-localhost') {
        res.writeHead(307, { location: `http://localhost:${port}/hello` }).end();
      } else if (path === '/see-other') {
        res.writeHead(303, { location: '/hello' }).end();
      } else {
        res.writeHead(404).end();
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

beforeEach(() => {
  seen = [];
});

const local = () =>
  createEgress({ allowlist: ['127.0.0.1', 'localhost'], allowInsecureLocalhost: true });

async function blocked(promise: Promise<unknown>): Promise<EgressBlockedError> {
  const error = await promise.then(
    () => {
      throw new Error('expected EgressBlockedError');
    },
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(EgressBlockedError);
  return error as EgressBlockedError;
}

describe('createEgress', () => {
  it('fetches an allowed host', async () => {
    const response = await local().fetch(`http://127.0.0.1:${port}/hello`);
    expect(await response.text()).toBe('hello');
  });

  it('blocks a host that is not on the allowlist without sending a request', async () => {
    const egress = createEgress({ allowlist: ['localhost'], allowInsecureLocalhost: true });
    const error = await blocked(egress.fetch(`http://127.0.0.1:${port}/hello`));
    expect(error.reason).toBe('host');
    expect(seen).toHaveLength(0);
  });

  it('blocks http to a non-local host', async () => {
    const egress = createEgress({ allowlist: ['api.example.com'], allowInsecureLocalhost: true });
    expect((await blocked(egress.fetch('http://api.example.com/'))).reason).toBe('protocol');
  });

  it('blocks http to localhost unless insecure localhost is allowed', async () => {
    const egress = createEgress({ allowlist: ['127.0.0.1'] });
    expect((await blocked(egress.fetch(`http://127.0.0.1:${port}/hello`))).reason).toBe('protocol');
    expect(seen).toHaveLength(0);
  });

  it('rejects an unparseable URL', async () => {
    expect((await blocked(local().fetch('not a url'))).reason).toBe('invalid-url');
  });

  it('follows a redirect to an allowed URL', async () => {
    const response = await local().fetch(`http://127.0.0.1:${port}/to-hello`);
    expect(await response.text()).toBe('hello');
    expect(seen.map((s) => s.url)).toEqual(['/to-hello', '/hello']);
  });

  it('refuses a redirect to a host that is not allowed', async () => {
    const error = await blocked(local().fetch(`http://127.0.0.1:${port}/to-evil`));
    expect(error.reason).toBe('host');
    expect(error.url).toBe('https://evil.example.net/');
  });

  it('stops a redirect loop', async () => {
    const egress = createEgress({
      allowlist: ['127.0.0.1'],
      allowInsecureLocalhost: true,
      maxRedirects: 3,
    });
    expect((await blocked(egress.fetch(`http://127.0.0.1:${port}/loop`))).reason).toBe(
      'redirect-limit',
    );
    expect(seen).toHaveLength(4);
  });

  it('drops credentials on a cross-origin redirect', async () => {
    await local().fetch(`http://127.0.0.1:${port}/to-localhost`, {
      headers: { authorization: 'Bearer secret', cookie: 'a=b', 'x-keep': '1' },
    });
    expect(seen[0]?.headers.authorization).toBe('Bearer secret');
    expect(seen[1]?.headers.host).toBe(`localhost:${port}`);
    expect(seen[1]?.headers.authorization).toBeUndefined();
    expect(seen[1]?.headers.cookie).toBeUndefined();
    expect(seen[1]?.headers['x-keep']).toBe('1');
  });

  it('switches to GET without a body after a 303', async () => {
    await local().fetch(`http://127.0.0.1:${port}/see-other`, { method: 'POST', body: 'payload' });
    expect(seen[0]).toMatchObject({ method: 'POST', body: 'payload' });
    expect(seen[1]).toMatchObject({ method: 'GET', body: '', url: '/hello' });
  });

  it('keeps allowlists separate per instance', async () => {
    const a = createEgress({ allowlist: ['127.0.0.1'], allowInsecureLocalhost: true });
    const b = createEgress({ allowlist: ['localhost'], allowInsecureLocalhost: true });
    expect((await a.fetch(`http://127.0.0.1:${port}/hello`)).status).toBe(200);
    expect((await blocked(b.fetch(`http://127.0.0.1:${port}/hello`))).reason).toBe('host');
  });
});

describe('isAllowedUrl', () => {
  const options: EgressOptions = { allowlist: ['*.example.com', 'api.other.org'] };

  it.each([
    ['https://a.example.com/', null],
    ['https://a.b.example.com/', null],
    ['https://example.com/', 'host'],
    ['https://notexample.com/', 'host'],
    ['https://A.EXAMPLE.COM/', null],
    ['https://a.example.com./', null],
    ['https://api.other.org:8443/x', null],
    ['https://www.other.org/', 'host'],
    ['ftp://a.example.com/', 'protocol'],
    ['file:///etc/passwd', 'protocol'],
  ])('%s → %s', (url, expected) => {
    expect(isAllowedUrl(new URL(url), options)).toBe(expected);
  });

  it.each(['https://x.com', 'x.com/path', 'x.com:443', '*evil.com', 'a.*.com', '*', '*.', ''])(
    'rejects the allowlist entry %j at creation',
    (entry) => {
      expect(() => createEgress({ allowlist: [entry] })).toThrow(/Invalid egress allowlist entry/);
    },
  );
});
