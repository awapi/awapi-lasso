import * as http from 'http';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import {
  generatePkcePair,
  decodeJwtToken,
  acquireOAuth2Token,
  refreshOAuth2Token,
  getCachedOAuth2Token,
  clearCachedOAuth2Token,
  clearAllMemoryOAuth2Tokens,
  cacheOAuth2Token,
  listCachedOAuth2TokenValues,
  resolveOAuth2AccessTokenForRequest,
} from './oauth2Engine';
import type { SecretStoreDeps } from './secretStore';

function createSampleJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }), 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  const payload = Buffer.from(JSON.stringify(claims), 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${header}.${payload}.sig_placeholder_123`;
}

function createMemorySecretDeps(): SecretStoreDeps {
  const files = new Map<string, string>();
  const dirs = new Set<string>(['/userdata']);
  return {
    userDataDir: '/userdata',
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => Buffer.from(`enc:${plain}`, 'utf-8'),
    decryptString: (buf: Buffer) => buf.toString('utf-8').replace(/^enc:/, ''),
    exists: p => files.has(p) || dirs.has(p),
    readFile: p => files.get(p) ?? '',
    writeFile: (p, c) => {
      files.set(p, c);
    },
    mkdir: p => {
      dirs.add(p);
    },
  };
}

describe('oauth2Engine', () => {
  let server: http.Server;
  let baseUrl = '';
  let lastTokenRequestHeaders: http.IncomingHttpHeaders = {};
  let lastTokenRequestParams: Record<string, string> = {};

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url?.startsWith('/oauth/token') && req.method === 'POST') {
        const chunks: Buffer[] = [];
        req.on('data', c => chunks.push(Buffer.from(c)));
        req.on('end', () => {
          lastTokenRequestHeaders = req.headers;
          const bodyStr = Buffer.concat(chunks).toString('utf-8');
          const params = new URLSearchParams(bodyStr);
          const parsed: Record<string, string> = {};
          params.forEach((v, k) => {
            parsed[k] = v;
          });
          lastTokenRequestParams = parsed;

          if (parsed.grant_type === 'password' && parsed.password === 'wrong') {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                error: 'invalid_grant',
                error_description: 'Invalid resource owner credentials',
              }),
            );
            return;
          }

          const jwt = createSampleJwt({
            sub: parsed.username || parsed.client_id || 'svc-account',
            iss: baseUrl,
            aud: parsed.audience || 'https://api.awapi.test',
            scp: (parsed.scope || 'read:all').split(' '),
            iat: 1700000000,
            exp: 1900000000,
          });

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              access_token: jwt,
              token_type: 'Bearer',
              expires_in: 3600,
              refresh_token: `refresh_for_${parsed.grant_type}`,
              scope: parsed.scope || 'read:all',
            }),
          );
        });
        return;
      }

      res.writeHead(404);
      res.end();
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

  beforeEach(() => {
    clearAllMemoryOAuth2Tokens();
    lastTokenRequestHeaders = {};
    lastTokenRequestParams = {};
  });

  it('generates valid PKCE S256 and plain pairs (RFC 7636 test vector)', () => {
    // RFC 7636 Appendix B test vector
    const rfcVerifier = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
    const s256 = generatePkcePair('S256', rfcVerifier);
    expect(s256.codeVerifier).toBe(rfcVerifier);
    expect(s256.codeChallenge).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
    expect(s256.codeChallengeMethod).toBe('S256');

    const plain = generatePkcePair('plain', rfcVerifier);
    expect(plain.codeChallenge).toBe(rfcVerifier);
    expect(plain.codeChallengeMethod).toBe('plain');
  });

  it('decodes JWT headers, claims, scopes, and expiration status safely', () => {
    const nowMs = 1800000000 * 1000;
    const jwt = createSampleJwt({
      sub: 'user-42',
      iss: 'https://login.example.com',
      aud: ['api://orders', 'api://inventory'],
      scope: 'orders.read orders.write',
      iat: 1799990000,
      exp: 1800003600,
    });

    const decoded = decodeJwtToken(jwt, nowMs);
    expect(decoded.isJwt).toBe(true);
    expect(decoded.header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(decoded.subject).toBe('user-42');
    expect(decoded.issuer).toBe('https://login.example.com');
    expect(decoded.audience).toEqual(['api://orders', 'api://inventory']);
    expect(decoded.scopes).toEqual(['orders.read', 'orders.write']);
    expect(decoded.isExpired).toBe(false);
    expect(decoded.expiresInSeconds).toBe(3600);

    const opaque = decodeJwtToken('opaque_access_token_without_dots');
    expect(opaque.isJwt).toBe(false);
  });

  it('executes password grant with {{variable}} interpolation and basic_header auth', async () => {
    const secretDeps = createMemorySecretDeps();
    const coord = {
      collectionId: 'col-1',
      environmentId: 'env-local',
      profileOrRequestId: 'req-login',
    };

    const result = await acquireOAuth2Token(
      {
        config: {
          grantType: 'password',
          accessTokenUrl: '{{authServer}}/oauth/token',
          clientId: '{{clientId}}',
          clientSecret: '{{clientSecret}}',
          username: '{{user}}',
          password: '{{pass}}',
          scope: 'orders.read orders.write',
          clientAuthMethod: 'basic_header',
          extraParams: [{ key: 'audience', value: '{{aud}}', enabled: true }],
        },
        coordinate: coord,
        interpolationContext: {
          environmentVariables: [
            { key: 'authServer', value: baseUrl, enabled: true },
            { key: 'clientId', value: 'lasso-cli', enabled: true },
            { key: 'clientSecret', value: 'top-secret', enabled: true },
            { key: 'user', value: 'omer@awapi.dev', enabled: true },
            { key: 'pass', value: 'correct-horse', enabled: true },
            { key: 'aud', value: 'https://orders.awapi.dev', enabled: true },
          ],
        },
      },
      { secretDeps },
    );

    expect(result.ok).toBe(true);
    expect(lastTokenRequestHeaders.authorization).toBe(
      `Basic ${Buffer.from('lasso-cli:top-secret').toString('base64')}`,
    );
    expect(lastTokenRequestParams).toMatchObject({
      grant_type: 'password',
      username: 'omer@awapi.dev',
      password: 'correct-horse',
      scope: 'orders.read orders.write',
      audience: 'https://orders.awapi.dev',
    });
    expect(result.token?.decodedJwt?.subject).toBe('omer@awapi.dev');
    expect(result.token?.refreshToken).toBe('refresh_for_password');

    // Verify token was persisted to secretStore and survives memory clear
    clearAllMemoryOAuth2Tokens();
    const fromVault = getCachedOAuth2Token(coord, { secretDeps });
    expect(fromVault?.accessToken).toBe(result.token?.accessToken);

    expect(clearCachedOAuth2Token(coord, { secretDeps })).toBe(true);
    expect(getCachedOAuth2Token(coord, { secretDeps })).toBeNull();
  });

  it('executes client_credentials grant with request_body client authentication', async () => {
    const result = await acquireOAuth2Token({
      config: {
        grantType: 'client_credentials',
        accessTokenUrl: `${baseUrl}/oauth/token`,
        clientId: 'svc-worker',
        clientSecret: 'worker-secret-99',
        scope: 'warehouse:admin',
        clientAuthMethod: 'request_body',
        extraParams: [{ key: 'resource', value: 'https://graph.example.com', enabled: true }],
      },
    });

    expect(result.ok).toBe(true);
    expect(lastTokenRequestHeaders.authorization).toBeUndefined();
    expect(lastTokenRequestParams).toEqual({
      client_id: 'svc-worker',
      client_secret: 'worker-secret-99',
      grant_type: 'client_credentials',
      scope: 'warehouse:admin',
      resource: 'https://graph.example.com',
    });
  });

  it('executes authorization_code_pkce grant via local loopback callback listener', async () => {
    let capturedAuthUrl = '';

    const result = await acquireOAuth2Token(
      {
        config: {
          grantType: 'authorization_code_pkce',
          authorizationUrl: `${baseUrl}/oauth/authorize`,
          accessTokenUrl: `${baseUrl}/oauth/token`,
          clientId: 'pkce-desktop-client',
          scope: 'openid profile',
          pkceCodeChallengeMethod: 'S256',
          clientAuthMethod: 'request_body',
        },
      },
      {
        openExternalUrl: async url => {
          capturedAuthUrl = url;
          const parsedAuth = new URL(url);
          const redirectUri = parsedAuth.searchParams.get('redirect_uri')!;
          const state = parsedAuth.searchParams.get('state')!;

          // Simulate browser redirect back to loopback listener
          await new Promise<void>((resolve, reject) => {
            http
              .get(`${redirectUri}?code=auth_code_xyz_789&state=${encodeURIComponent(state)}`, res => {
                res.resume();
                res.on('end', () => resolve());
              })
              .on('error', reject);
          });
        },
      },
    );

    expect(result.ok).toBe(true);
    expect(capturedAuthUrl).toContain('code_challenge=');
    expect(capturedAuthUrl).toContain('code_challenge_method=S256');
    expect(lastTokenRequestParams.grant_type).toBe('authorization_code');
    expect(lastTokenRequestParams.code).toBe('auth_code_xyz_789');
    expect(lastTokenRequestParams.code_verifier).toBeTruthy();
  });

  it('executes refresh_token grant and auto-refreshes expired tokens when autoRefresh is true', async () => {
    const secretDeps = createMemorySecretDeps();
    const coord = {
      collectionId: 'col-auto',
      environmentId: 'env-1',
      profileOrRequestId: 'prof-1',
    };

    // Acquire an initial token at t = 1_000_000_000_000 (expires in 3600s)
    const initialNow = 1_000_000_000_000;
    const initial = await acquireOAuth2Token(
      {
        config: {
          grantType: 'client_credentials',
          accessTokenUrl: `${baseUrl}/oauth/token`,
          clientId: 'auto-client',
          clientSecret: 'auto-secret',
          autoRefresh: true,
        },
        coordinate: coord,
      },
      { secretDeps, now: () => initialNow },
    );
    expect(initial.ok).toBe(true);

    // Advance clock past expiration (initialNow + 4000s) and resolve token
    const expiredNow = initialNow + 4000 * 1000;
    const resolvedToken = await resolveOAuth2AccessTokenForRequest(
      {
        config: {
          grantType: 'client_credentials',
          accessTokenUrl: `${baseUrl}/oauth/token`,
          clientId: 'auto-client',
          clientSecret: 'auto-secret',
          autoRefresh: true,
        },
        coordinate: coord,
      },
      { secretDeps, now: () => expiredNow },
    );

    expect(resolvedToken).toBeTruthy();
    expect(lastTokenRequestParams.grant_type).toBe('refresh_token');
    expect(lastTokenRequestParams.refresh_token).toBe('refresh_for_client_credentials');

    // Also test explicit refreshOAuth2Token call
    const explicitRefresh = await refreshOAuth2Token(
      {
        config: {
          grantType: 'refresh_token',
          accessTokenUrl: `${baseUrl}/oauth/token`,
          clientId: 'auto-client',
          clientSecret: 'auto-secret',
        },
        refreshToken: 'custom_rt_55',
        coordinate: coord,
      },
      { secretDeps },
    );
    expect(explicitRefresh.ok).toBe(true);
    expect(lastTokenRequestParams.refresh_token).toBe('custom_rt_55');
  });
});

describe('listCachedOAuth2TokenValues', () => {
  it('lists access, refresh and id tokens held in memory', () => {
    clearAllMemoryOAuth2Tokens();
    expect(listCachedOAuth2TokenValues()).toEqual([]);
    cacheOAuth2Token(
      { collectionId: 'c', profileOrRequestId: 'p' },
      { accessToken: 'at-1', refreshToken: 'rt-1', idToken: 'id-1', tokenType: 'Bearer', acquiredAt: 'now', rawResponse: {} },
    );
    cacheOAuth2Token(
      { collectionId: 'c', profileOrRequestId: 'q' },
      { accessToken: 'at-2', tokenType: 'Bearer', acquiredAt: 'now', rawResponse: {} },
    );
    expect(listCachedOAuth2TokenValues().sort()).toEqual(['at-1', 'at-2', 'id-1', 'rt-1']);
    clearAllMemoryOAuth2Tokens();
  });
});
