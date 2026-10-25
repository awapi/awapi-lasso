import { describe, it, expect } from 'vitest';
import { importOpenApiSpec } from './openapiImporter';
import type { FolderItem, RequestItem } from './collectionSchema';

describe('openapiImporter', () => {
  it('imports an OpenAPI 3.0 YAML specification with tag folders, parameters, sample JSON bodies, security schemes, and {{baseUrl}}', () => {
    const openapiYaml = `
openapi: 3.0.3
info:
  title: Orders Platform API
  description: Manage customer orders and inventory
  version: 2.1.0
servers:
  - url: https://api.orders.example.com/v2
    description: production
  - url: http://localhost:{port}/v2
    description: local
    variables:
      port:
        default: "8080"
tags:
  - name: Orders
    description: Order endpoints
components:
  securitySchemes:
    BearerAuth:
      type: http
      scheme: bearer
    ApiKeyAuth:
      type: apiKey
      in: header
      name: X-Api-Key
    OAuth2CC:
      type: oauth2
      flows:
        clientCredentials:
          tokenUrl: https://auth.orders.example.com/oauth/token
          scopes:
            orders:read: Read orders
            orders:write: Write orders
  schemas:
    CreateOrderInput:
      type: object
      properties:
        sku:
          type: string
          example: SKU-900
        quantity:
          type: integer
          default: 3
        urgent:
          type: boolean
        tags:
          type: array
          items:
            type: string
            enum: [priority, standard]
security:
  - BearerAuth: []
paths:
  /orders/{orderId}:
    get:
      tags: [Orders]
      summary: Get Order by ID
      parameters:
        - name: orderId
          in: path
          required: true
          schema:
            type: string
            example: ord_123
        - name: includeItems
          in: query
          required: true
          schema:
            type: boolean
            default: true
        - name: X-Trace-Id
          in: header
          schema:
            type: string
            example: tr_01
      responses:
        "200":
          description: OK
  /orders:
    post:
      tags: [Orders]
      summary: Create Order
      security:
        - OAuth2CC: [orders:write]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/CreateOrderInput"
      responses:
        "201":
          description: Created
  /health:
    get:
      summary: Health Check
      security: []
      responses:
        "200":
          description: Healthy
`;

    const collection = importOpenApiSpec(openapiYaml);

    expect(collection.kind).toBe('Collection');
    expect(collection.metadata.name).toBe('Orders Platform API');
    expect(collection.metadata.version).toBe('2.1.0');
    expect(collection.defaults?.baseUrl).toBe('{{baseUrl}}');
    expect(collection.defaults?.auth).toEqual({
      type: 'bearer',
      bearer: { token: '{{bearerToken}}', prefix: 'Bearer' },
    });

    // Environments & {{baseUrl}}
    expect(collection.environments).toHaveLength(2);
    expect(collection.environments?.[0].name).toBe('production');
    expect(collection.environments?.[0].variables).toEqual([
      { key: 'baseUrl', value: 'https://api.orders.example.com/v2', enabled: true },
    ]);
    expect(collection.environments?.[1].name).toBe('local');
    expect(collection.environments?.[1].variables).toEqual([
      { key: 'baseUrl', value: 'http://localhost:8080/v2', enabled: true },
    ]);

    // Auth profiles
    expect(collection.authProfiles).toHaveLength(3);
    expect(collection.authProfiles?.map(p => p.type)).toEqual(['bearer', 'apikey', 'oauth2']);

    // Items: 1 Folder ("Orders") + 1 untagged Request ("Health Check")
    expect(collection.items).toHaveLength(2);
    const ordersFolder = collection.items[0] as FolderItem;
    expect(ordersFolder.kind).toBe('folder');
    expect(ordersFolder.name).toBe('Orders');
    expect(ordersFolder.description).toBe('Order endpoints');
    expect(ordersFolder.items).toHaveLength(2);

    const getOrderReq = ordersFolder.items[0] as RequestItem;
    expect(getOrderReq.name).toBe('Get Order by ID');
    expect(getOrderReq.method).toBe('GET');
    expect(getOrderReq.url).toBe('{{baseUrl}}/orders/:orderId?includeItems=true');
    expect(getOrderReq.pathParams).toEqual([{ key: 'orderId', value: 'ord_123' }]);
    expect(getOrderReq.queryParams).toEqual([
      { key: 'includeItems', value: 'true', enabled: true },
    ]);
    expect(getOrderReq.headers).toEqual([
      { key: 'X-Trace-Id', value: 'tr_01', enabled: true },
    ]);

    const createOrderReq = ordersFolder.items[1] as RequestItem;
    expect(createOrderReq.name).toBe('Create Order');
    expect(createOrderReq.method).toBe('POST');
    expect(createOrderReq.auth?.type).toBe('oauth2');
    expect(createOrderReq.auth?.oauth2?.grantType).toBe('client_credentials');
    expect(createOrderReq.body?.mode).toBe('json');
    expect(JSON.parse(createOrderReq.body?.content ?? '{}')).toEqual({
      sku: 'SKU-900',
      quantity: 3,
      urgent: true,
      tags: ['priority'],
    });

    const healthReq = collection.items[1] as RequestItem;
    expect(healthReq.name).toBe('Health Check');
    expect(healthReq.auth).toEqual({ type: 'none' });
  });

  it('imports a Swagger 2.0 JSON specification with basic auth and body/formData parameters', () => {
    const swagger2Json = JSON.stringify({
      swagger: '2.0',
      info: { title: 'Legacy Inventory Swagger', version: '1.0.0' },
      host: 'inventory.example.com',
      basePath: '/api/v1',
      schemes: ['https'],
      securityDefinitions: {
        BasicAuth: { type: 'basic' },
      },
      definitions: {
        StockAdjustment: {
          type: 'object',
          properties: {
            delta: { type: 'integer', example: 10 },
            reason: { type: 'string', default: 'restock' },
          },
        },
      },
      paths: {
        '/stock/{itemId}': {
          put: {
            operationId: 'adjustStock',
            security: [{ BasicAuth: [] }],
            parameters: [
              { name: 'itemId', in: 'path', required: true, type: 'string', default: 'itm_7' },
              {
                name: 'body',
                in: 'body',
                schema: { $ref: '#/definitions/StockAdjustment' },
              },
            ],
          },
        },
      },
    });

    const col = importOpenApiSpec(swagger2Json);
    expect(col.metadata.name).toBe('Legacy Inventory Swagger');
    expect(col.environments?.[0].variables[0].value).toBe(
      'https://inventory.example.com/api/v1',
    );
    expect(col.items).toHaveLength(1);
    const req = col.items[0] as RequestItem;
    expect(req.name).toBe('adjustStock');
    expect(req.method).toBe('PUT');
    expect(req.url).toBe('{{baseUrl}}/stock/:itemId');
    expect(req.pathParams).toEqual([{ key: 'itemId', value: 'itm_7' }]);
    expect(req.auth?.type).toBe('basic');
    expect(JSON.parse(req.body?.content ?? '{}')).toEqual({
      delta: 10,
      reason: 'restock',
    });
  });
});
