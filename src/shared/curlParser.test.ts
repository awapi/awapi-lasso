import { describe, it, expect } from 'vitest';
import {
  curlToRequestItem,
  isCurlCommand,
  parseCurlCommand,
  tokenizeCurlArgs,
} from './curlParser';

describe('curlParser', () => {
  it('identifies curl commands accurately', () => {
    expect(isCurlCommand('curl https://api.example.com/v1/users')).toBe(true);
    expect(isCurlCommand('  curl.exe -X POST https://api.example.com/items')).toBe(true);
    expect(isCurlCommand('curl \\\n  https://api.example.com')).toBe(true);
    expect(isCurlCommand('https://api.example.com/curl')).toBe(false);
    expect(isCurlCommand('')).toBe(false);
  });

  it('tokenizes single-line and multi-line commands with backslash and caret continuations', () => {
    const bashCmd = `curl -X POST \\
      'https://api.example.com/v1/orders' \\
      -H "Content-Type: application/json" \\
      -d '{"item":"book","qty":2}'`;
    const tokens = tokenizeCurlArgs(bashCmd);
    expect(tokens).toEqual([
      'curl',
      '-X',
      'POST',
      'https://api.example.com/v1/orders',
      '-H',
      'Content-Type: application/json',
      '-d',
      '{"item":"book","qty":2}',
    ]);

    const cmdExe = `curl -X PUT ^
      "https://api.example.com/v1/orders/10" ^
      -H "X-Trace: abc"`;
    expect(tokenizeCurlArgs(cmdExe)).toEqual([
      'curl',
      '-X',
      'PUT',
      'https://api.example.com/v1/orders/10',
      '-H',
      'X-Trace: abc',
    ]);
  });

  it('parses GET request with query and path parameters and headers', () => {
    const parsed = parseCurlCommand(
      'curl "https://api.example.com/v1/users/:userId?role=admin&limit=25" -H "Accept: application/json" -H "X-Request-Id: {{$uuid}}"',
    );
    expect(parsed.method).toBe('GET');
    expect(parsed.url).toBe('https://api.example.com/v1/users/:userId?role=admin&limit=25');
    expect(parsed.queryParams).toEqual([
      { key: 'role', value: 'admin', enabled: true },
      { key: 'limit', value: '25', enabled: true },
    ]);
    expect(parsed.pathParams).toEqual([{ key: 'userId', value: '' }]);
    expect(parsed.headers).toEqual([
      { key: 'Accept', value: 'application/json', enabled: true },
      { key: 'X-Request-Id', value: '{{$uuid}}', enabled: true },
    ]);
    expect(parsed.body).toEqual({ mode: 'none' });
  });

  it('parses basic auth (-u / --user) and JSON body (-d / --data-raw) with implicit POST', () => {
    const parsed = parseCurlCommand(
      `curl https://api.example.com/v1/login -u admin:s3cr3t --data-raw '{"scope":"read:all"}'`,
    );
    expect(parsed.method).toBe('POST');
    expect(parsed.auth).toEqual({
      type: 'basic',
      basic: {
        username: 'admin',
        password: 's3cr3t',
      },
    });
    expect(parsed.body.mode).toBe('json');
    expect(JSON.parse(parsed.body.content!)).toEqual({ scope: 'read:all' });
  });

  it('parses URL-encoded body (--data-urlencode) and -G query conversion', () => {
    const postEncoded = parseCurlCommand(
      'curl https://api.example.com/oauth/token --data-urlencode "grant_type=client_credentials" --data-urlencode "scope=orders:write"',
    );
    expect(postEncoded.method).toBe('POST');
    expect(postEncoded.body).toEqual({
      mode: 'form-urlencoded',
      urlEncoded: [
        { key: 'grant_type', value: 'client_credentials', enabled: true },
        { key: 'scope', value: 'orders:write', enabled: true },
      ],
    });

    const getWithData = parseCurlCommand(
      'curl -G https://api.example.com/search -d "q=lasso" --data-urlencode "page=2"',
    );
    expect(getWithData.method).toBe('GET');
    expect(getWithData.url).toBe('https://api.example.com/search?q=lasso&page=2');
    expect(getWithData.queryParams).toEqual([
      { key: 'q', value: 'lasso', enabled: true },
      { key: 'page', value: '2', enabled: true },
    ]);
    expect(getWithData.body.mode).toBe('none');
  });

  it('parses multipart form fields (-F / --form) including @file uploads and contentType', () => {
    const parsed = parseCurlCommand(
      'curl -X POST https://api.example.com/upload -F "title=Quarterly Report" -F "document=@/tmp/report.pdf;type=application/pdf"',
    );
    expect(parsed.method).toBe('POST');
    expect(parsed.body).toEqual({
      mode: 'multipart-form',
      formData: [
        {
          key: 'title',
          type: 'text',
          value: 'Quarterly Report',
          enabled: true,
        },
        {
          key: 'document',
          type: 'file',
          filePath: '/tmp/report.pdf',
          contentType: 'application/pdf',
          enabled: true,
        },
      ],
    });
  });

  it('converts a curl command into a full RequestItem via curlToRequestItem', () => {
    const req = curlToRequestItem(
      'curl -X PATCH https://api.example.com/v1/items/42 -H "Authorization: Bearer tok_123" -d \'{"active":true}\'',
    );
    expect(req.kind).toBe('request');
    expect(req.method).toBe('PATCH');
    expect(req.name).toBe('PATCH /v1/items/42');
    expect(req.headers).toEqual([
      { key: 'Authorization', value: 'Bearer tok_123', enabled: true },
    ]);
    expect(req.body?.mode).toBe('json');
  });
});
