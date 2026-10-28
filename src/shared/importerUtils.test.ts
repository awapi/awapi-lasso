import { describe, it, expect } from 'vitest';
import {
  WarningCollector,
  convertTestScript,
  looksSecret,
  mapDynamicVariables,
  toJsonPath,
  type ScriptDialect,
} from './importerUtils';

describe('importerUtils', () => {
  it('groups per-item warnings and keeps one-off warnings unique', () => {
    const w = new WarningCollector();
    w.add('Once.');
    w.add('Once.');
    for (let i = 0; i < 6; i++) w.addFor('Kind', `R${i}`);
    w.addFor('Kind', 'R0');
    expect(w.list()).toEqual(['Once.', 'Kind (6: R0, R1, R2, R3, R4, +1 more)']);
  });

  it('flags literal credentials but not variable references or plain URLs', () => {
    expect(looksSecret('password', 'hunter2')).toBe(true);
    expect(looksSecret('password', '{{pw}}')).toBe(false);
    expect(looksSecret('region', 'eu', true)).toBe(true);
    expect(looksSecret('authBaseUrl', 'https://auth.test')).toBe(false);
    expect(looksSecret('authUrl', 'https://u:p@auth.test')).toBe(true);
  });

  it('maps dynamic variables deeply and reports unknown ones', () => {
    const unsupported = new Set<string>();
    expect(
      mapDynamicVariables({ a: ['{{$guid}}', '{{ $randomUUID }}'], b: { c: '{{$timestamp}} {{$randomCity}}' }, n: 1 }, unsupported),
    ).toEqual({ a: ['{{$uuid}}', '{{$uuid}}'], b: { c: '{{$timestamp}} {{$randomCity}}' }, n: 1 });
    expect([...unsupported]).toEqual(['$randomCity']);
  });

  it('converts JS property chains to JSONPath', () => {
    expect(toJsonPath('.data["user-id"][0]')).toBe("$.data['user-id'][0]");
    expect(toJsonPath('')).toBe('$');
  });

  it('converts scripts for an arbitrary dialect', () => {
    const dialect: ScriptDialect = {
      statusPatterns: [/check\((\d{3})\)/g],
      bodySources: [String.raw`body\(\)`],
      headerReads: [String.raw`hdr\(\s*'([^']+)'\s*\)`],
      setter: String.raw`save\.(env|run)`,
      setterScopes: { env: 'environment', run: 'runtime' },
      testWrapper: /it\(\s*'[^']*'\s*,\s*\(\)\s*=>\s*\{/g,
    };
    const result = convertTestScript(
      "it('x', () => {\n  check(204);\n});\nconst b = body();\nsave.env('id', b.id);\nsave.run('etag', hdr('ETag'));",
      dialect,
    );
    expect(result).toEqual({
      assertions: [{ target: 'status', operator: 'equals', expected: 204, enabled: true }],
      captures: [
        { variable: 'id', scope: 'environment', source: 'jsonpath', expression: '$.id', enabled: true },
        { variable: 'etag', scope: 'runtime', source: 'header', expression: 'ETag', enabled: true },
      ],
      fullyConverted: true,
    });
    expect(convertTestScript('check(200); doMore();', dialect).fullyConverted).toBe(false);
  });
});
