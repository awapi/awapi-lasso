import { describe, it, expect } from 'vitest';
import { bruDict, bruDictValue, bruList, bruText, isBruMethodBlock, parseBru } from './bruParser';

describe('bruParser', () => {
  it('parses dict, text, and list blocks with disabled entries', () => {
    const blocks = parseBru(
      [
        'meta {',
        '  name: Create Order',
        '  type: http',
        '  seq: 3',
        '}',
        '',
        'post {',
        '  url: {{baseUrl}}/orders?expand=items',
        '  body: json',
        '  auth: bearer',
        '}',
        '',
        'headers {',
        '  Content-Type: application/json',
        '  ~X-Debug: 1',
        '}',
        '',
        'body:json {',
        '  {',
        '    "sku": "SKU-100",',
        '    "quantity": 2',
        '  }',
        '}',
        '',
        'vars:secret [',
        '  token,',
        '  ~old',
        ']',
        '',
      ].join('\r\n'),
    );

    expect(blocks.map(b => [b.kind, b.name])).toEqual([
      ['dict', 'meta'],
      ['dict', 'post'],
      ['dict', 'headers'],
      ['text', 'body:json'],
      ['list', 'vars:secret'],
    ]);
    expect(bruDictValue(blocks, 'meta', 'seq')).toBe('3');
    expect(bruDictValue(blocks, 'post', 'url')).toBe('{{baseUrl}}/orders?expand=items');
    expect(bruDict(blocks, 'headers')).toEqual([
      { key: 'Content-Type', value: 'application/json', enabled: true },
      { key: 'X-Debug', value: '1', enabled: false },
    ]);
    expect(bruText(blocks, 'body:json')).toBe('{\n  "sku": "SKU-100",\n  "quantity": 2\n}');
    expect(bruList(blocks, 'vars:secret')).toEqual([
      { value: 'token', enabled: true },
      { value: 'old', enabled: false },
    ]);
  });

  it('handles quoted keys, multiline values, values containing colons, and empty blocks', () => {
    const blocks = parseBru(
      [
        'headers {',
        '  "X-Odd:Key": a:b',
        '  Accept: */*',
        '}',
        'vars:pre-request {',
        "  payload: '''",
        '    line one',
        '    line two',
        "  '''",
        '  after: 1',
        '}',
        'params:query {}',
        'auth:oauth2 {',
        '  access_token_url: https://id.test/token',
        '}',
      ].join('\n'),
    );
    expect(bruDict(blocks, 'headers')).toEqual([
      { key: 'X-Odd:Key', value: 'a:b', enabled: true },
      { key: 'Accept', value: '*/*', enabled: true },
    ]);
    expect(bruDict(blocks, 'vars:pre-request')).toEqual([
      { key: 'payload', value: 'line one\nline two', enabled: true },
      { key: 'after', value: '1', enabled: true },
    ]);
    expect(bruDict(blocks, 'params:query')).toEqual([]);
    expect(bruDictValue(blocks, 'auth:oauth2', 'access_token_url')).toBe('https://id.test/token');
  });

  it('keeps nested braces of text blocks and unknown blocks intact', () => {
    const blocks = parseBru(
      [
        'script:post-response {',
        '  if (res.status === 200) {',
        '    bru.setVar("ok", true);',
        '  }',
        '}',
        'example {',
        '  name: Saved',
        '  response {',
        '    status: 200',
        '  }',
        '}',
        'docs {',
        '  # Title',
        '}',
      ].join('\n'),
    );
    expect(bruText(blocks, 'script:post-response')).toBe(
      'if (res.status === 200) {\n  bru.setVar("ok", true);\n}',
    );
    expect(blocks.map(b => b.name)).toEqual(['script:post-response', 'example', 'docs']);
    expect(bruText(blocks, 'docs')).toBe('# Title');
  });

  it('returns empty results for missing blocks and recognizes method blocks', () => {
    expect(bruDict([], 'headers')).toEqual([]);
    expect(bruText([], 'docs')).toBeUndefined();
    expect(bruList([], 'vars:secret')).toEqual([]);
    expect(isBruMethodBlock('patch')).toBe(true);
    expect(isBruMethodBlock('meta')).toBe(false);
  });
});
