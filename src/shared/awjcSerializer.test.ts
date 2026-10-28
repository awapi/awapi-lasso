import { describe, it, expect } from 'vitest';
import {
  createEmptyCollection,
  createDefaultHttpRequest,
  createDefaultGraphQLRequest,
  createDefaultFolder,
} from './collectionSchema';
import {
  parseCollectionFile,
  serializeCollectionToYaml,
} from './awjcSerializer';
import sampleOrdersYaml from '../../samples/orders-and-inventory.awjc?raw';
import samplePublicApisYaml from '../../samples/public-apis.awjc?raw';

describe('awjcSerializer', () => {
  it('round-trips a complex collection through YAML while preserving folders, HTTP, and GraphQL requests', () => {
    const httpReq = createDefaultHttpRequest({
      id: 'req_1',
      name: 'Get Orders',
      method: 'GET',
      url: '{{baseUrl}}/v1/orders',
      queryParams: [{ key: 'limit', value: '10', enabled: true }],
    });
    const gqlReq = createDefaultGraphQLRequest({
      id: 'req_2',
      name: 'Query Stock',
      url: '{{baseUrl}}/graphql',
    });
    const folder = createDefaultFolder('Orders Folder', [httpReq, gqlReq], { id: 'fld_1' });

    const col = createEmptyCollection('Orders Platform', {
      metadata: {
        id: 'col_orders_01',
        name: 'Orders Platform',
        description: 'Orders REST and GraphQL',
      },
      items: [folder],
    });

    const yamlText = serializeCollectionToYaml(col);
    expect(yamlText).toContain('awapiLasso: "1.0"');
    expect(yamlText).toContain('kind: Collection');

    const parsed = parseCollectionFile(yamlText);
    expect(parsed.collection.metadata.id).toBe('col_orders_01');
    expect(parsed.collection.items).toHaveLength(1);
    const parsedFolder = parsed.collection.items[0];
    expect(parsedFolder.kind).toBe('folder');
    if (parsedFolder.kind === 'folder') {
      expect(parsedFolder.items).toHaveLength(2);
      expect(parsedFolder.items[0].name).toBe('Get Orders');
      expect(parsedFolder.items[1].name).toBe('Query Stock');
    }
  });

  it('strips plaintext values from secret: true variables and auth configs on YAML serialization', () => {
    const col = createEmptyCollection('Secrets Test', {
      metadata: { id: 'col_sec_1', name: 'Secrets Test' },
      variables: [
        { key: 'publicKey', value: 'pub-123', enabled: true },
        { key: 'masterSecret', value: 'DO_NOT_WRITE_ME_TO_DISK', secret: true, enabled: true },
      ],
      environments: [
        {
          id: 'env_prod',
          name: 'production',
          variables: [
            { key: 'apiPassword', value: 'SUPER_SECRET_PASSWORD', secret: true, enabled: true },
            { key: 'baseUrl', value: 'https://api.example.com', enabled: true },
          ],
        },
      ],
      defaults: {
        baseUrl: '{{baseUrl}}',
        auth: {
          type: 'oauth2',
          oauth2: {
            grantType: 'client_credentials',
            accessTokenUrl: '{{baseUrl}}/oauth/token',
            clientId: 'my-client',
            clientSecret: 'OAUTH_CLIENT_SECRET_VALUE',
            clientSecretIsSecret: true,
          },
        },
      },
    });

    const yamlOut = serializeCollectionToYaml(col);
    expect(yamlOut).not.toContain('DO_NOT_WRITE_ME_TO_DISK');
    expect(yamlOut).not.toContain('SUPER_SECRET_PASSWORD');
    expect(yamlOut).not.toContain('OAUTH_CLIENT_SECRET_VALUE');
    expect(yamlOut).toContain('secret: true');
    expect(yamlOut).toContain('pub-123');

    const parsedFromYaml = parseCollectionFile(yamlOut);
    expect(parsedFromYaml.collection.variables?.[1].secret).toBe(true);
    expect(parsedFromYaml.collection.variables?.[1].value).toBeUndefined();
  });

  it('extracts plaintext secrets on load when a hand-edited YAML file includes value on a secret: true entry', () => {
    const handEditedYaml = `
awapiLasso: "1.0"
kind: Collection
metadata:
  id: "col_migrate"
  name: "Hand Edited"
environments:
  - id: "env_local"
    name: "local"
    variables:
      - key: "apiKey"
        value: "plain-secret-key-999"
        secret: true
        enabled: true
items: []
`;
    const result = parseCollectionFile(handEditedYaml);
    expect(result.extractedSecrets).toEqual([
      {
        collectionId: 'col_migrate',
        scopeId: 'env:env_local',
        key: 'apiKey',
        value: 'plain-secret-key-999',
      },
    ]);
  });

  it('throws descriptive errors for empty or invalid files', () => {
    expect(() => parseCollectionFile('   ')).toThrow(/empty/i);
    expect(() => parseCollectionFile('kind: NotACollection')).toThrow(/Invalid \.awjc collection schema/i);
  });

  it('validates and parses samples/orders-and-inventory.awjc and samples/public-apis.awjc cleanly', () => {
    const parsed = parseCollectionFile(sampleOrdersYaml);
    expect(parsed.collection.metadata.id).toBe('col_orders_platform_01');
    expect(parsed.collection.authProfiles).toHaveLength(2);
    expect(parsed.collection.environments).toHaveLength(2);
    expect(parsed.collection.items).toHaveLength(2);

    const parsedPublic = parseCollectionFile(samplePublicApisYaml);
    expect(parsedPublic.collection.metadata.id).toBe('col_public_apis_01');
    expect(parsedPublic.collection.items).toHaveLength(3);
  });

  it('keeps hideFromAi flags and their values when saving (unlike secret)', () => {
    const req = createDefaultHttpRequest({
      id: 'req_h',
      headers: [{ key: 'X-Tenant', value: 'acme', enabled: true, hideFromAi: true }],
    });
    const col = createEmptyCollection('Hidden', {
      items: [req],
      variables: [{ key: 'accountId', value: '12345', enabled: true, hideFromAi: true }],
      environments: [{ id: 'e', name: 'dev', variables: [{ key: 'region', value: 'eu', enabled: true, hideFromAi: true }] }],
    });
    const yamlText = serializeCollectionToYaml(col);
    expect(yamlText).toContain('hideFromAi: true');
    const { collection, extractedSecrets } = parseCollectionFile(yamlText);
    expect(collection.variables?.[0]).toMatchObject({ value: '12345', hideFromAi: true });
    expect(collection.environments?.[0].variables[0]).toMatchObject({ value: 'eu', hideFromAi: true });
    expect(collection.items[0]).toMatchObject({ headers: [{ value: 'acme', hideFromAi: true }] });
    expect(extractedSecrets).toEqual([]);
  });
});
