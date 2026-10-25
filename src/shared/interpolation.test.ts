import { describe, it, expect } from 'vitest';
import {
  interpolateText,
  resolveVariable,
  inspectVariablesInText,
  type VariableInterpolationContext,
} from './interpolation';

describe('interpolation engine', () => {
  it('enforces the 6-level variable precedence (Global < Collection < Environment < Folder outer..inner < Captured < Dynamic)', () => {
    const context: VariableInterpolationContext = {
      globalVariables: [
        { key: 'host', value: 'global.example.com', enabled: true },
        { key: 'onlyGlobal', value: 'g-val', enabled: true },
      ],
      collectionVariables: [
        { key: 'host', value: 'collection.example.com', enabled: true },
        { key: 'apiVersion', value: 'v1', enabled: true },
      ],
      environmentVariables: [
        { key: 'host', value: 'env.example.com', enabled: true },
        { key: 'envToken', value: 'secret-env-token', secret: true, enabled: true },
      ],
      folderVariablesChain: [
        [{ key: 'host', value: 'outer-folder.example.com', enabled: true }],
        [{ key: 'host', value: 'inner-folder.example.com', enabled: true }],
      ],
      capturedVariables: [{ key: 'host', value: 'captured.example.com', enabled: true }],
      dynamicOverrides: {
        $uuid: () => '00000000-0000-4000-8000-000000000001',
      },
    };

    expect(resolveVariable('onlyGlobal', context)).toMatchObject({
      value: 'g-val',
      source: 'global',
      isResolved: true,
    });
    expect(resolveVariable('apiVersion', context)).toMatchObject({
      value: 'v1',
      source: 'collection',
    });
    expect(resolveVariable('envToken', context)).toMatchObject({
      value: 'secret-env-token',
      source: 'environment',
      isSecret: true,
    });
    expect(resolveVariable('host', context)).toMatchObject({
      value: 'captured.example.com',
      source: 'captured',
    });

    // Without captured, inner folder wins over outer folder and environment
    const withoutCaptured: VariableInterpolationContext = {
      ...context,
      capturedVariables: [],
    };
    expect(resolveVariable('host', withoutCaptured)).toMatchObject({
      value: 'inner-folder.example.com',
      source: 'folder',
    });

    const url = interpolateText('https://{{host}}/{{apiVersion}}/items?req={{$uuid}}', context);
    expect(url).toBe(
      'https://captured.example.com/v1/items?req=00000000-0000-4000-8000-000000000001',
    );
  });

  it('expands nested variables recursively and guards against circular references', () => {
    const context: VariableInterpolationContext = {
      environmentVariables: [
        { key: 'protocol', value: 'https', enabled: true },
        { key: 'domain', value: 'api.awapi.io', enabled: true },
        { key: 'port', value: '8443', enabled: true },
        { key: 'baseUrl', value: '{{protocol}}://{{domain}}:{{port}}', enabled: true },
        // Circular cycle: a -> b -> a
        { key: 'cycleA', value: 'prefix-{{cycleB}}', enabled: true },
        { key: 'cycleB', value: '{{cycleA}}-suffix', enabled: true },
      ],
    };

    expect(interpolateText('{{baseUrl}}/v1/users', context)).toBe(
      'https://api.awapi.io:8443/v1/users',
    );

    // Circular reference must terminate cleanly without throwing or hanging
    expect(() => interpolateText('{{cycleA}}', context)).not.toThrow();
  });

  it('supports all built-in dynamic variables ($uuid, $timestamp, $timestampMs, $isoTimestamp, $randomInt, $randomEmail, $randomString)', () => {
    const rendered = interpolateText(
      '{{$uuid}}|{{$timestamp}}|{{$timestampMs}}|{{$isoTimestamp}}|{{$randomInt}}|{{$randomEmail}}|{{$randomString}}',
    );
    const parts = rendered.split('|');
    expect(parts).toHaveLength(7);
    expect(parts[0]).toMatch(/^[0-9a-f-]{36}$/i);
    expect(Number(parts[1])).toBeGreaterThan(1700000000);
    expect(Number(parts[2])).toBeGreaterThan(1700000000000);
    expect(parts[3]).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(Number.isInteger(Number(parts[4]))).toBe(true);
    expect(parts[5]).toContain('@example.test');
    expect(parts[6]).toHaveLength(16);
  });

  it('hydrates secret values from secretValues map and marks inspect tokens accurately', () => {
    const context: VariableInterpolationContext = {
      environmentVariables: [
        { key: 'baseUrl', value: 'https://api.example.com', enabled: true },
        { key: 'clientSecret', secret: true, enabled: true },
      ],
      secretValues: {
        clientSecret: 'hydrated-from-keychain-123',
      },
    };

    const tokens = inspectVariablesInText(
      '{{baseUrl}}/token?secret={{clientSecret}}&missing={{unknownVar}}',
      context,
    );
    expect(tokens).toHaveLength(3);
    expect(tokens[0]).toMatchObject({
      name: 'baseUrl',
      resolvedValue: 'https://api.example.com',
      source: 'environment',
      isSecret: false,
      isResolved: true,
    });
    expect(tokens[1]).toMatchObject({
      name: 'clientSecret',
      resolvedValue: 'hydrated-from-keychain-123',
      source: 'environment',
      isSecret: true,
      isResolved: true,
    });
    expect(tokens[2]).toMatchObject({
      name: 'unknownVar',
      resolvedValue: '{{unknownVar}}',
      source: 'unresolved',
      isSecret: false,
      isResolved: false,
    });
  });
});
