import { describe, it, expect } from 'vitest';
import {
  resolveEffectiveAuth,
  resolveRequestHierarchyInCollection,
  parseDigestChallenge,
  buildDigestAuthorizationHeader,
  injectRequestAuth,
} from './authEngine';
import {
  createEmptyCollection,
  createDefaultFolder,
  createDefaultHttpRequest,
} from '../shared/collectionSchema';

describe('resolveEffectiveAuth & resolveRequestHierarchyInCollection', () => {
  it('walks Request -> Innermost Folder -> Outermost Folder -> Collection Defaults -> AuthProfile', () => {
    const reqInherit = createDefaultHttpRequest({
      id: 'req-inherit',
      name: 'Inherits Folder Auth',
      auth: { type: 'inherit' },
    });
    const reqNone = createDefaultHttpRequest({
      id: 'req-none',
      name: 'Overrides with None',
      auth: { type: 'none' },
    });
    const reqProfile = createDefaultHttpRequest({
      id: 'req-profile',
      name: 'Uses Named Profile',
      auth: { type: 'profile', profileId: 'prof-oauth' },
    });

    const innerFolder = createDefaultFolder('Inner Folder', [reqInherit, reqNone, reqProfile], {
      id: 'fld-inner',
      auth: { type: 'inherit' },
      headers: [{ key: 'X-Folder', value: 'inner', enabled: true }],
      variables: [{ key: 'region', value: 'eu-west-1', enabled: true }],
    });

    const outerFolder = createDefaultFolder('Outer Folder', [innerFolder], {
      id: 'fld-outer',
      auth: {
        type: 'bearer',
        bearer: { token: '{{apiToken}}', prefix: 'Bearer' },
      },
      headers: [
        { key: 'X-Folder', value: 'outer', enabled: true },
        { key: 'X-Outer-Only', value: '1', enabled: true },
      ],
    });

    const collection = createEmptyCollection('Auth Test Collection', {
      defaults: {
        headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
        auth: {
          type: 'basic',
          basic: { username: 'root', password: 'secret' },
        },
      },
      authProfiles: [
        {
          id: 'prof-oauth',
          name: 'Corp OAuth',
          type: 'bearer',
          bearer: { token: 'profile-token-xyz' },
        },
      ],
      items: [outerFolder],
    });

    const ctxInherit = resolveRequestHierarchyInCollection(collection, 'req-inherit');
    expect(ctxInherit).not.toBeNull();
    expect(ctxInherit!.effectiveAuth.config.type).toBe('bearer');
    expect(ctxInherit!.effectiveAuth.sourceOwnerId).toBe('fld-outer');
    expect(ctxInherit!.inheritedHeaders).toEqual([
      { key: 'Accept', value: 'application/json', enabled: true },
      { key: 'X-Folder', value: 'inner', enabled: true },
      { key: 'X-Outer-Only', value: '1', enabled: true },
    ]);

    const ctxNone = resolveRequestHierarchyInCollection(collection, 'req-none');
    expect(ctxNone!.effectiveAuth.config.type).toBe('none');

    const ctxProfile = resolveRequestHierarchyInCollection(collection, 'req-profile');
    expect(ctxProfile!.effectiveAuth.config.type).toBe('bearer');
    expect(ctxProfile!.effectiveAuth.config.bearer?.token).toBe('profile-token-xyz');
    expect(ctxProfile!.effectiveAuth.sourceOwnerId).toBe('prof-oauth');
  });

  it('falls back to collection default auth when all folders inherit', () => {
    const resolved = resolveEffectiveAuth({
      requestAuth: { type: 'inherit' },
      ancestorAuthChain: [{ type: 'inherit' }],
      collectionDefaultAuth: {
        type: 'apikey',
        apikey: { key: 'X-API-Key', value: 'col-key', in: 'header' },
      },
      collectionId: 'col-1',
    });
    expect(resolved.config.type).toBe('apikey');
    expect(resolved.sourceOwnerId).toBe('col-1');
  });
});

describe('injectRequestAuth', () => {
  const context = {
    environmentVariables: [
      { key: 'token', value: 'my-secret-jwt', enabled: true },
      { key: 'user', value: 'alice', enabled: true },
      { key: 'pass', value: 'p@ssw0rd', enabled: true },
      { key: 'apiKeyVal', value: 'k_live_999', enabled: true },
    ],
  };

  it('injects Bearer token with customizable prefix and {{variable}} interpolation', () => {
    const res = injectRequestAuth({
      auth: {
        type: 'bearer',
        bearer: { token: '{{token}}', prefix: 'Token' },
      },
      method: 'GET',
      url: 'https://api.example.com/v1/items',
      headers: {},
      context,
    });
    expect(res.headers.Authorization).toBe('Token my-secret-jwt');
  });

  it('injects Basic auth base64(username:password)', () => {
    const res = injectRequestAuth({
      auth: {
        type: 'basic',
        basic: { username: '{{user}}', password: '{{pass}}' },
      },
      method: 'GET',
      url: 'https://api.example.com/v1/items',
      headers: {},
      context,
    });
    const expectedB64 = Buffer.from('alice:p@ssw0rd', 'utf-8').toString('base64');
    expect(res.headers.Authorization).toBe(`Basic ${expectedB64}`);
  });

  it('injects API key into either Request Header or Query Parameter', () => {
    const headerRes = injectRequestAuth({
      auth: {
        type: 'apikey',
        apikey: { key: 'X-API-Key', value: '{{apiKeyVal}}', in: 'header' },
      },
      method: 'GET',
      url: 'https://api.example.com/v1/items',
      headers: {},
      context,
    });
    expect(headerRes.headers['X-API-Key']).toBe('k_live_999');

    const queryRes = injectRequestAuth({
      auth: {
        type: 'apikey',
        apikey: { key: 'api_key', value: '{{apiKeyVal}}', in: 'query' },
      },
      method: 'GET',
      url: 'https://api.example.com/v1/items?page=1',
      headers: {},
      context,
    });
    expect(queryRes.url).toBe('https://api.example.com/v1/items?page=1&api_key=k_live_999');
  });

  it('parses WWW-Authenticate Digest challenge and computes MD5 and SHA-256 Digest headers', () => {
    const challenge = parseDigestChallenge(
      'Digest realm="testrealm@host.com", qop="auth,auth-int", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", opaque="5ccc069c403ebaf9f0171e9517f40e41", algorithm=MD5',
    );
    expect(challenge).toEqual({
      realm: 'testrealm@host.com',
      qop: 'auth,auth-int',
      nonce: 'dcd98b7102dd2f0e8b11d0f600bfb0c093',
      opaque: '5ccc069c403ebaf9f0171e9517f40e41',
      algorithm: 'MD5',
      stale: false,
    });

    // RFC 2617 classic test vector (Mufasa / Circle Of Life)
    const headerVal = buildDigestAuthorizationHeader({
      config: {
        username: 'Mufasa',
        password: 'Circle Of Life',
      },
      method: 'GET',
      requestUrl: 'http://www.nowhere.org/dir/index.html',
      challenge: challenge!,
      nc: '00000001',
      cnonce: '0a4f113b',
    });

    expect(headerVal).toContain('username="Mufasa"');
    expect(headerVal).toContain('realm="testrealm@host.com"');
    expect(headerVal).toContain('uri="/dir/index.html"');
    expect(headerVal).toContain('response="6629fae49393a05397450978507c4ef1"');
    expect(headerVal).toContain('opaque="5ccc069c403ebaf9f0171e9517f40e41"');

    // SHA-256 Digest challenge
    const shaChallenge = parseDigestChallenge(
      'Digest realm="api", qop="auth", nonce="n123", algorithm=SHA-256',
    );
    const shaRes = injectRequestAuth({
      auth: {
        type: 'digest',
        digest: { username: '{{user}}', password: '{{pass}}' },
      },
      method: 'POST',
      url: 'https://api.example.com/orders',
      headers: {},
      context,
      digestChallenge: shaChallenge!,
    });
    expect(shaRes.headers.Authorization).toMatch(/^Digest username="alice", realm="api"/);
    expect(shaRes.headers.Authorization).toContain('algorithm=SHA-256');
  });

  it('signs requests with AWS Signature v4 headers', () => {
    const res = injectRequestAuth({
      auth: {
        type: 'awsv4',
        awsv4: {
          accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
          secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
          sessionToken: 'AQoDYXdzEJr...',
          region: 'us-east-1',
          service: 's3',
        },
      },
      method: 'GET',
      url: 'https://example.amazonaws.com/test.txt?lifecycle=1',
      headers: {},
      awsAmzDate: '20260524T000000Z',
    });

    expect(res.headers['x-amz-date']).toBe('20260524T000000Z');
    expect(res.headers['x-amz-security-token']).toBe('AQoDYXdzEJr...');
    expect(res.headers['x-amz-content-sha256']).toHaveLength(64);
    expect(res.headers.Authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20260524\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date;x-amz-security-token, Signature=[0-9a-f]{64}$/,
    );
  });
});
