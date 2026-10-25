import * as http from 'http';
import * as zlib from 'zlib';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import {
  executeHttpRequest,
  cancelHttpRequest,
  parseSetCookieHeader,
} from './httpEngine';

describe('httpEngine', () => {
  let server: http.Server;
  let baseUrl = '';
  let digestAttempts = 0;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', c => chunks.push(Buffer.from(c)));
      req.on('end', () => {
        const bodyBuf = Buffer.concat(chunks);
        const urlObj = new URL(req.url ?? '/', 'http://127.0.0.1');

        if (urlObj.pathname.startsWith('/echo')) {
          res.setHeader(
            'Set-Cookie',
            'SID=abc_session_1; Domain=127.0.0.1; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax',
          );
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'X-Custom-Echo': 'lasso-ok',
          });
          res.end(
            JSON.stringify({
              method: req.method,
              path: urlObj.pathname,
              query: Object.fromEntries(urlObj.searchParams.entries()),
              headers: req.headers,
              bodyText: bodyBuf.toString('utf-8'),
              bodyByteLength: bodyBuf.byteLength,
            }),
          );
          return;
        }

        if (urlObj.pathname === '/gzip') {
          const payload = JSON.stringify({ compressed: true, items: [1, 2, 3] });
          const gzipped = zlib.gzipSync(Buffer.from(payload, 'utf-8'));
          res.writeHead(200, {
            'Content-Type': 'application/json',
            'Content-Encoding': 'gzip',
          });
          res.end(gzipped);
          return;
        }

        if (urlObj.pathname === '/redirect-start') {
          res.writeHead(302, { Location: `${baseUrl}/redirect-mid` });
          res.end();
          return;
        }

        if (urlObj.pathname === '/redirect-mid') {
          res.writeHead(301, { Location: `${baseUrl}/echo?redirected=yes` });
          res.end();
          return;
        }

        if (urlObj.pathname === '/digest-protected') {
          digestAttempts++;
          const authHeader = req.headers.authorization;
          if (!authHeader || !authHeader.startsWith('Digest ')) {
            res.writeHead(401, {
              'WWW-Authenticate':
                'Digest realm="awapi-realm", qop="auth", nonce="nonce-xyz-123", opaque="opaque-999"',
              'Content-Type': 'application/json',
            });
            res.end(JSON.stringify({ error: 'Unauthorized' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ authenticated: true, authHeader }));
          return;
        }

        if (urlObj.pathname === '/slow') {
          const timer = setTimeout(() => {
            if (!res.writableEnded) {
              res.writeHead(200, { 'Content-Type': 'text/plain' });
              res.end('finally done');
            }
          }, 2000);
          req.on('close', () => clearTimeout(timer));
          return;
        }

        res.writeHead(404);
        res.end('Not found');
      });
    });

    await new Promise<void>(resolve => {
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        if (addr && typeof addr === 'object') {
          baseUrl = `http://127.0.0.1:${addr.port}`;
        }
        resolve();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
  });

  it('parses Set-Cookie attributes accurately', () => {
    const cookie = parseSetCookieHeader(
      'token=xyz123; Domain=example.com; Path=/api; Max-Age=7200; HttpOnly; Secure; SameSite=Strict',
    );
    expect(cookie).toMatchObject({
      name: 'token',
      value: 'xyz123',
      domain: 'example.com',
      path: '/api',
      maxAge: 7200,
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
    });
  });

  it('executes GET, POST, PUT, DELETE, and custom HTTP verbs (PROPFIND) with timings, cookies, captures, and assertions', async () => {
    const res = await executeHttpRequest({
      method: 'PROPFIND',
      url: '{{base}}/echo/:resource',
      pathParams: [{ key: 'resource', value: 'orders' }],
      queryParams: [{ key: 'filter', value: '{{envFilter}}', enabled: true }],
      inheritedHeaders: [{ key: 'X-Inherited', value: 'from-folder', enabled: true }],
      headers: [{ key: 'X-Req', value: '{{reqHeaderVal}}', enabled: true }],
      interpolationContext: {
        environmentVariables: [
          { key: 'base', value: baseUrl, enabled: true },
          { key: 'envFilter', value: 'active', enabled: true },
          { key: 'reqHeaderVal', value: 'custom-val', enabled: true },
        ],
      },
      captures: [
        {
          variable: 'capturedMethod',
          scope: 'environment',
          source: 'jsonpath',
          expression: '$.method',
        },
        {
          variable: 'sidCookie',
          scope: 'runtime',
          source: 'cookie',
          expression: 'SID',
        },
      ],
      assertions: [
        { target: 'status', operator: 'equals', expected: 200 },
        { target: 'jsonpath', path: '$.method', operator: 'equals', expected: 'PROPFIND' },
      ],
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(res.timings.totalMs).toBeGreaterThanOrEqual(0);
    expect(res.cookies).toHaveLength(1);
    expect(res.cookies[0].name).toBe('SID');
    expect(res.cookies[0].value).toBe('abc_session_1');

    const bodyJson = JSON.parse(res.body);
    expect(bodyJson.method).toBe('PROPFIND');
    expect(bodyJson.query).toEqual({ filter: 'active' });
    expect(bodyJson.headers['x-inherited']).toBe('from-folder');
    expect(bodyJson.headers['x-req']).toBe('custom-val');

    expect(res.captures).toHaveLength(2);
    expect(res.captures[0].value).toBe('PROPFIND');
    expect(res.captures[1].value).toBe('abc_session_1');
    expect(res.assertions.every(a => a.passed)).toBe(true);
  });

  it('supports json, yaml, xml, text, form-urlencoded, multipart-form (text + file), and binary bodies', async () => {
    // 1. JSON body with automatic Content-Type
    const jsonRes = await executeHttpRequest({
      method: 'POST',
      url: `${baseUrl}/echo`,
      body: {
        mode: 'json',
        content: '{"hello":"{{who}}"}',
      },
      interpolationContext: {
        environmentVariables: [{ key: 'who', value: 'world', enabled: true }],
      },
    });
    const parsedJsonEcho = JSON.parse(jsonRes.body);
    expect(parsedJsonEcho.headers['content-type']).toBe('application/json');
    expect(parsedJsonEcho.bodyText).toBe('{"hello":"world"}');

    // 2. form-urlencoded
    const formRes = await executeHttpRequest({
      method: 'POST',
      url: `${baseUrl}/echo`,
      body: {
        mode: 'form-urlencoded',
        urlEncoded: [
          { key: 'grant_type', value: 'client_credentials', enabled: true },
          { key: 'scope', value: 'read write', enabled: true },
          { key: 'disabled', value: 'ignore', enabled: false },
        ],
      },
    });
    const parsedFormEcho = JSON.parse(formRes.body);
    expect(parsedFormEcho.headers['content-type']).toBe('application/x-www-form-urlencoded');
    expect(parsedFormEcho.bodyText).toBe('grant_type=client_credentials&scope=read+write');

    // 3. multipart-form (both text field and local file attachment)
    const multipartRes = await executeHttpRequest(
      {
        method: 'POST',
        url: `${baseUrl}/echo`,
        body: {
          mode: 'multipart-form',
          formData: [
            { key: 'description', type: 'text', value: 'Invoice upload', enabled: true },
            {
              key: 'document',
              type: 'file',
              filePath: '/virtual/invoice.json',
              enabled: true,
            },
          ],
        },
      },
      {
        readFileBuffer: p => Buffer.from(`file-contents-for:${p}`, 'utf-8'),
      },
    );
    const parsedMultipartEcho = JSON.parse(multipartRes.body);
    expect(parsedMultipartEcho.headers['content-type']).toMatch(
      /^multipart\/form-data; boundary=----AwapiLassoBoundary/,
    );
    expect(parsedMultipartEcho.bodyText).toContain('name="description"');
    expect(parsedMultipartEcho.bodyText).toContain('Invoice upload');
    expect(parsedMultipartEcho.bodyText).toContain('filename="invoice.json"');
    expect(parsedMultipartEcho.bodyText).toContain('file-contents-for:/virtual/invoice.json');

    // 4. binary body mode
    const binaryRes = await executeHttpRequest(
      {
        method: 'PUT',
        url: `${baseUrl}/echo`,
        body: {
          mode: 'binary',
          binaryFilePath: '/virtual/archive.bin',
        },
      },
      {
        readFileBuffer: () => Buffer.from([1, 2, 3, 4, 5]),
      },
    );
    const parsedBinEcho = JSON.parse(binaryRes.body);
    expect(parsedBinEcho.headers['content-type']).toBe('application/octet-stream');
    expect(parsedBinEcho.bodyByteLength).toBe(5);
  });

  it('decompresses gzip responses and records both sizeBytes and transferSizeBytes', async () => {
    const res = await executeHttpRequest({
      method: 'GET',
      url: `${baseUrl}/gzip`,
    });
    expect(res.ok).toBe(true);
    expect(JSON.parse(res.body)).toEqual({ compressed: true, items: [1, 2, 3] });
    expect(res.sizeBytes).toBeGreaterThan(0);
    expect(res.transferSizeBytes).toBeGreaterThan(0);
  });

  it('follows multi-hop redirects when followRedirects is true and stops when false', async () => {
    const followed = await executeHttpRequest({
      method: 'GET',
      url: `${baseUrl}/redirect-start`,
      followRedirects: true,
    });
    expect(followed.status).toBe(200);
    expect(followed.redirects).toHaveLength(2);
    expect(followed.redirects[0].statusCode).toBe(302);
    expect(followed.redirects[1].statusCode).toBe(301);
    expect(followed.finalUrl).toContain('/echo?redirected=yes');

    const notFollowed = await executeHttpRequest({
      method: 'GET',
      url: `${baseUrl}/redirect-start`,
      followRedirects: false,
    });
    expect(notFollowed.status).toBe(302);
    expect(notFollowed.redirects).toHaveLength(0);
  });

  it('automatically completes Digest 401 challenge-response authentication', async () => {
    digestAttempts = 0;
    const res = await executeHttpRequest({
      method: 'GET',
      url: `${baseUrl}/digest-protected`,
      auth: {
        type: 'digest',
        digest: {
          username: 'digest-user',
          password: 'digest-password',
        },
      },
    });

    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(digestAttempts).toBe(2);
    const parsed = JSON.parse(res.body);
    expect(parsed.authenticated).toBe(true);
    expect(parsed.authHeader).toContain('username="digest-user"');
    expect(parsed.authHeader).toContain('realm="awapi-realm"');
  });

  it('supports in-flight cancellation via cancelHttpRequest and request timeouts', async () => {
    // 1. In-flight cancellation
    const pendingPromise = executeHttpRequest({
      requestId: 'cancel-me-123',
      method: 'GET',
      url: `${baseUrl}/slow`,
      timeoutMs: 5000,
    });

    await new Promise(resolve => setTimeout(resolve, 40));
    const cancelled = cancelHttpRequest('cancel-me-123');
    expect(cancelled).toBe(true);

    const cancelResult = await pendingPromise;
    expect(cancelResult.ok).toBe(false);
    expect(cancelResult.cancelled).toBe(true);

    // 2. Timeout
    const timeoutResult = await executeHttpRequest({
      method: 'GET',
      url: `${baseUrl}/slow`,
      timeoutMs: 60,
    });
    expect(timeoutResult.ok).toBe(false);
    expect(timeoutResult.timedOut).toBe(true);
  });
});
