import { describe, expect, it } from 'vitest';
import {
  AI_SYSTEM_PROMPT,
  AI_TOOLS_PROMPT,
  MAX_BODY_CHARS,
  REDACTED,
  buildSystemPrompt,
  findLiteralSecret,
  isHighEntropyToken,
  isSensitiveName,
  redactHeaderValue,
  redactText,
  redactUrl,
  shrinkBody,
  truncateText,
} from './aiContext';

describe('redactText', () => {
  it('scrubs known secret values, longest first', () => {
    const out = redactText('key=abcd1234 and abcd', ['abcd', 'abcd1234']);
    expect(out).toBe(`key=${REDACTED} and ${REDACTED}`);
  });

  it('ignores very short secret values to avoid mangling text', () => {
    expect(redactText('a b c', ['a'])).toBe('a b c');
  });

  it('scrubs bearer tokens and JWTs', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N';
    expect(redactText(`Authorization: Bearer abcdef123456`)).toBe(`Authorization: Bearer ${REDACTED}`);
    expect(redactText(`token ${jwt} end`)).toBe(`token ${REDACTED} end`);
  });

  it('does not touch prose that merely mentions Basic auth', () => {
    expect(redactText('Basic authentication is required')).toBe('Basic authentication is required');
  });

  it('scrubs secret-looking JSON fields', () => {
    const out = redactText('{"access_token":"abc123","name":"bob","client_secret":"zzz"}');
    expect(out).toContain(`"access_token": "${REDACTED}"`);
    expect(out).toContain(`"client_secret": "${REDACTED}"`);
    expect(out).toContain('"name":"bob"');
  });
});

describe('redactUrl / redactHeaderValue', () => {
  it('redacts sensitive query params but keeps templated variables', () => {
    expect(redactUrl('https://x.test/a?api_key=123456&q=hi&token={{tok}}')).toBe(
      `https://x.test/a?api_key=${REDACTED}&q=hi&token={{tok}}`,
    );
  });

  it('redacts credentials embedded in the URL authority', () => {
    expect(redactUrl('https://user:pa55@host.test/x')).toBe(`https://${REDACTED}@host.test/x`);
    expect(redactUrl('https://host.test/x')).toBe('https://host.test/x');
  });

  it('redacts sensitive headers unless the value is a {{variable}} template', () => {
    expect(redactHeaderValue('Authorization', 'Bearer xyz')).toBe(REDACTED);
    expect(redactHeaderValue('Authorization', '{{token}}')).toBe('{{token}}');
    expect(redactHeaderValue('Accept', 'application/json')).toBe('application/json');
  });

  it('classifies sensitive names', () => {
    expect(isSensitiveName('X-Api-Key')).toBe(true);
    expect(isSensitiveName('Set-Cookie')).toBe(true);
    expect(isSensitiveName('Content-Type')).toBe(false);
    for (const name of ['pwd', 'DB_PASSWD', 'jwt', 'X-Auth', 'oauth_code', 'private_key', 'bearer', 'otp', 'authKey']) {
      expect(isSensitiveName(name), name).toBe(true);
    }
    for (const name of ['author', 'authority', 'x-author-name', 'baseUrl', 'region']) {
      expect(isSensitiveName(name), name).toBe(false);
    }
  });
});

describe('truncation', () => {
  it('truncates long text with a marker', () => {
    const out = truncateText('x'.repeat(50), 10);
    expect(out.startsWith('x'.repeat(10))).toBe(true);
    expect(out).toContain('truncated 40 more characters');
  });

  it('keeps small bodies unchanged', () => {
    expect(shrinkBody('{"a":1}')).toBe('{"a":1}');
  });

  it('collapses long JSON arrays to a few samples', () => {
    const body = JSON.stringify({ items: Array.from({ length: 2000 }, (_, i) => ({ id: i, name: `n${i}` })) });
    const out = shrinkBody(body);
    expect(out.length).toBeLessThanOrEqual(MAX_BODY_CHARS + 80);
    expect(out).toContain('1997 more items omitted');
    expect(out).toContain('"id": 2');
  });

  it('falls back to plain truncation for non-JSON text', () => {
    const out = shrinkBody('y'.repeat(MAX_BODY_CHARS + 500));
    expect(out).toContain('truncated 500 more characters');
  });
});

describe('buildSystemPrompt', () => {
  it('returns only static instructions without context', () => {
    expect(buildSystemPrompt(undefined)).toBe(AI_SYSTEM_PROMPT);
    expect(buildSystemPrompt({})).toBe(AI_SYSTEM_PROMPT);
  });

  it('never includes secret values from the request or response', () => {
    const prompt = buildSystemPrompt({
      secretValues: ['sup3r-s3cret-value'],
      request: {
        method: 'POST',
        url: 'https://api.test/v1?api_key=sup3r-s3cret-value',
        headers: [
          { key: 'Authorization', value: 'Bearer sup3r-s3cret-value', enabled: true },
          { key: 'X-Off', value: 'disabled', enabled: false },
          { key: 'Accept', value: 'application/json', enabled: true },
        ],
        bodyMode: 'json',
        body: '{"password":"sup3r-s3cret-value","name":"x"}',
      },
      response: {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'Set-Cookie': 'sid=abc', 'Content-Type': 'application/json' },
        body: '{"error":"bad token sup3r-s3cret-value"}',
        contentType: 'application/json',
        totalMs: 123.4,
      },
    });
    expect(prompt).not.toContain('sup3r-s3cret-value');
    expect(prompt).not.toContain('sid=abc');
    expect(prompt).not.toContain('X-Off');
    expect(prompt).toContain('POST https://api.test/v1?api_key=[REDACTED]');
    expect(prompt).toContain('Accept: application/json');
    expect(prompt).toContain('Status: 401 Unauthorized');
    expect(prompt).toContain('Time: 123 ms');
  });

  it('includes graphql query, schema and environment variable names only', () => {
    const prompt = buildSystemPrompt({
      request: { protocol: 'graphql', method: 'POST', url: '{{base}}/graphql', graphqlQuery: '{ me { id } }' },
      graphqlSchemaSdl: 'type Query { me: User }',
      environmentVariableNames: ['base', 'token'],
    });
    expect(prompt).toContain('{ me { id } }');
    expect(prompt).toContain('type Query { me: User }');
    expect(prompt).toContain('{{base}}, {{token}}');
  });

  it('reports transport errors', () => {
    const prompt = buildSystemPrompt({ response: { error: 'ECONNREFUSED', status: 0 } });
    expect(prompt).toContain('Transport error: ECONNREFUSED');
    expect(prompt).not.toContain('Status: 0');
  });

  it('adds tool guidance only when tools are enabled', () => {
    expect(buildSystemPrompt(undefined, false)).not.toContain('with tools');
    const withTools = buildSystemPrompt({ request: { url: 'x' } }, true);
    expect(withTools).toContain(AI_TOOLS_PROMPT);
    expect(withTools).toContain('hidden from you');
  });
});

describe('free-text secret detection', () => {
  // Fake keys, assembled at runtime so secret scanners don't flag the test source.
  const fake = (...parts: string[]) => parts.join('');
  const KEYS = {
    openai: fake('sk-', 'proj-', 'Ab3dEf6hIj9kLm2nOp5qRs8t'),
    anthropic: fake('sk-', 'ant-', 'api03-Zx9Yw8Vu7Ts6Rq5Po4Nm'),
    github: fake('ghp', '_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8'),
    aws: fake('AKIA', 'FAKEFAKEFAKE0000'),
    slack: fake('xox', 'b-', '1234567890-abcdefghij'),
    google: fake('AIza', 'SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'),
    stripe: fake('sk', '_live_', 'FAKEfakeFAKEfake0000'),
  };

  it('redacts well-known API key formats anywhere in text', () => {
    for (const key of Object.values(KEYS)) {
      const out = redactText(`config: key=${key} end`);
      expect(out).not.toContain(key);
      expect(out).toContain(REDACTED);
    }
  });

  it('redacts PEM private keys and Basic credentials', () => {
    const pem = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----';
    expect(redactText(`key:\n${pem}\nafter`)).toBe(`key:\n${REDACTED}\nafter`);
    expect(redactText('Authorization: Basic dXNlcjpwYXNzd29yZA==')).toBe(`Authorization: Basic ${REDACTED}`);
  });

  it('redacts long random tokens but keeps ids, hashes, UUIDs and prose', () => {
    const token = 'Q7xLm2Pz9Rt4Vb8Nc1Kd6Wf3Hj5Gs0YaE';
    expect(isHighEntropyToken(token)).toBe(true);
    expect(redactText(`{"id":"${token}"}`)).not.toContain(token);
    for (const safe of [
      '550e8400-e29b-41d4-a716-446655440000',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      'req_lx3k9a_1_ab12cd',
      'getUserAccountSettingsForOrganization',
      'https://api.example.com/v1/Organizations/Org123/Members/456789/Profile',
    ]) {
      expect(redactText(safe)).toBe(safe);
    }
  });

  it('names literal secrets for write rejection', () => {
    expect(findLiteralSecret(`token ${KEYS.github}`)).toBe('GitHub token');
    expect(findLiteralSecret('-----BEGIN PRIVATE KEY-----abc')).toBe('private key');
    expect(findLiteralSecret('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc')).toBe('JWT');
    expect(findLiteralSecret('{{apiKey}} and plain text')).toBeNull();
  });
});
