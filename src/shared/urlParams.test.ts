import { describe, it, expect } from 'vitest';
import {
  syncQueryParamsFromUrl,
  syncUrlFromQueryParams,
  extractPathParamNames,
  syncPathParamsFromUrl,
  buildResolvedRequestUrl,
} from './urlParams';

describe('urlParams synchronization and resolution', () => {
  it('syncs query params from URL while preserving disabled rows and descriptions', () => {
    const existing = [
      { key: 'status', value: 'old', enabled: true, description: 'Order status filter' },
      { key: 'debug', value: 'true', enabled: false, description: 'Disabled debug flag' },
    ];

    const synced = syncQueryParamsFromUrl(
      '{{baseUrl}}/v1/orders?status=shipped&limit={{pageSize}}',
      existing,
    );

    expect(synced).toEqual([
      { key: 'status', value: 'shipped', enabled: true, description: 'Order status filter' },
      { key: 'limit', value: '{{pageSize}}', enabled: true },
      { key: 'debug', value: 'true', enabled: false, description: 'Disabled debug flag' },
    ]);
  });

  it('rebuilds URL from queryParams while keeping {{variables}} unescaped and omitting disabled rows', () => {
    const url = syncUrlFromQueryParams('{{baseUrl}}/v1/orders?old=1', [
      { key: 'status', value: 'pending', enabled: true },
      { key: 'cursor', value: '{{nextCursor}}', enabled: true },
      { key: 'debug', value: '1', enabled: false },
    ]);

    expect(url).toBe('{{baseUrl}}/v1/orders?status=pending&cursor={{nextCursor}}');
  });

  it('extracts :param and {param} path variables while ignoring :port and {{variables}}', () => {
    const names = extractPathParamNames(
      'http://localhost:8080/{{apiVersion}}/orgs/:orgId/users/{userId}/orders/:orderId',
    );
    expect(names).toEqual(['orgId', 'userId', 'orderId']);

    const synced = syncPathParamsFromUrl(
      '{{baseUrl}}/orgs/:orgId/users/{userId}',
      [{ key: 'orgId', value: 'org_42', description: 'Organization ID' }],
    );
    expect(synced).toEqual([
      { key: 'orgId', value: 'org_42', description: 'Organization ID' },
      { key: 'userId', value: '' },
    ]);
  });

  it('builds the final resolved URL by interpolating {{variables}}, substituting :pathParams, and encoding queryParams', () => {
    const finalUrl = buildResolvedRequestUrl({
      rawUrl: '{{baseUrl}}/{{apiVersion}}/orders/:orderId/items/{itemId}',
      pathParams: [
        { key: 'orderId', value: '{{lastOrderId}}' },
        { key: 'itemId', value: 'item #7' },
      ],
      queryParams: [
        { key: 'locale', value: '{{locale}}', enabled: true },
        { key: 'includeDrafts', value: 'true', enabled: false },
      ],
      context: {
        collectionVariables: [{ key: 'apiVersion', value: 'v1', enabled: true }],
        environmentVariables: [
          { key: 'baseUrl', value: 'https://api.example.com:8443', enabled: true },
          { key: 'locale', value: 'en-US', enabled: true },
        ],
        capturedVariables: [{ key: 'lastOrderId', value: 'ord_900', enabled: true }],
      },
    });

    expect(finalUrl).toBe(
      'https://api.example.com:8443/v1/orders/ord_900/items/item%20%237?locale=en-US',
    );
  });
});
