import { describe, it, expect } from 'vitest';
import {
  CODE_GENERATOR_TARGETS,
  generateCodeSnippet,
  type CodeGeneratorTarget,
} from './codeGenerator';
import {
  createDefaultGraphQLRequest,
  createDefaultHttpRequest,
} from './collectionSchema';

describe('codeGenerator', () => {
  const sampleHttpReq = createDefaultHttpRequest({
    name: 'Create Order',
    method: 'POST',
    url: '{{baseUrl}}/v1/users/:userId/orders?source={{channel}}',
    pathParams: [{ key: 'userId', value: '{{activeUserId}}' }],
    queryParams: [{ key: 'source', value: '{{channel}}', enabled: true }],
    headers: [{ key: 'X-Trace-Id', value: 'trace-{{env}}', enabled: true }],
    auth: {
      type: 'bearer',
      bearer: { token: '{{apiToken}}', prefix: 'Bearer' },
    },
    body: {
      mode: 'json',
      content: '{"sku":"SKU-100","qty":2}',
    },
  });

  const interpolationContext = {
    environmentVariables: [
      { key: 'baseUrl', value: 'https://api.orders.example.com', enabled: true },
      { key: 'activeUserId', value: 'usr_99', enabled: true },
      { key: 'channel', value: 'mobile', enabled: true },
      { key: 'env', value: 'prod', enabled: true },
      { key: 'apiToken', value: 'tok_live_abc', enabled: true },
    ],
  };

  it('preserves {{variables}} when resolveVariables is false and resolves them when resolveVariables is true', () => {
    const unresolvedCurl = generateCodeSnippet({
      request: sampleHttpReq,
      target: 'curl-bash',
      resolveVariables: false,
      interpolationContext,
    });

    expect(unresolvedCurl).toContain('{{baseUrl}}/v1/users/{{activeUserId}}/orders?source={{channel}}');
    expect(unresolvedCurl).toContain('Authorization: Bearer {{apiToken}}');
    expect(unresolvedCurl).toContain('X-Trace-Id: trace-{{env}}');

    const resolvedCurl = generateCodeSnippet({
      request: sampleHttpReq,
      target: 'curl-bash',
      resolveVariables: true,
      interpolationContext,
    });

    expect(resolvedCurl).toContain(
      'https://api.orders.example.com/v1/users/usr_99/orders?source=mobile',
    );
    expect(resolvedCurl).toContain('Authorization: Bearer tok_live_abc');
    expect(resolvedCurl).toContain('X-Trace-Id: trace-prod');
  });

  it('generates valid snippets across all 9 supported language targets', () => {
    const targets: CodeGeneratorTarget[] = CODE_GENERATOR_TARGETS.map(t => t.id);

    for (const target of targets) {
      const snippet = generateCodeSnippet({
        request: sampleHttpReq,
        target,
        resolveVariables: true,
        interpolationContext,
      });
      expect(snippet.length).toBeGreaterThan(20);
      expect(snippet).toContain('https://api.orders.example.com/v1/users/usr_99/orders?source=mobile');
    }

    const ps = generateCodeSnippet({
      request: sampleHttpReq,
      target: 'curl-powershell',
      resolveVariables: true,
      interpolationContext,
    });
    expect(ps).toContain('curl.exe -X POST');

    const fetchSnippet = generateCodeSnippet({
      request: sampleHttpReq,
      target: 'js-fetch',
      resolveVariables: true,
      interpolationContext,
    });
    expect(fetchSnippet).toContain('await fetch(');

    const axiosSnippet = generateCodeSnippet({
      request: sampleHttpReq,
      target: 'js-axios',
      resolveVariables: true,
      interpolationContext,
    });
    expect(axiosSnippet).toContain('await axios.request(');

    const pyRequests = generateCodeSnippet({
      request: sampleHttpReq,
      target: 'python-requests',
      resolveVariables: true,
      interpolationContext,
    });
    expect(pyRequests).toContain('requests.request("POST"');

    const pyHttpx = generateCodeSnippet({
      request: sampleHttpReq,
      target: 'python-httpx',
      resolveVariables: true,
      interpolationContext,
    });
    expect(pyHttpx).toContain('httpx.request("POST"');

    const goSnippet = generateCodeSnippet({
      request: sampleHttpReq,
      target: 'go-net-http',
      resolveVariables: true,
      interpolationContext,
    });
    expect(goSnippet).toContain('http.NewRequest("POST"');

    const csharpSnippet = generateCodeSnippet({
      request: sampleHttpReq,
      target: 'csharp-httpclient',
      resolveVariables: true,
      interpolationContext,
    });
    expect(csharpSnippet).toContain('new HttpRequestMessage(new HttpMethod("POST")');

    const rustSnippet = generateCodeSnippet({
      request: sampleHttpReq,
      target: 'rust-reqwest',
      resolveVariables: true,
      interpolationContext,
    });
    expect(rustSnippet).toContain('reqwest::Client::new()');
  });

  it('generates GraphQL POST JSON payload snippets accurately', () => {
    const gqlReq = createDefaultGraphQLRequest({
      url: 'https://api.example.com/graphql',
      graphql: {
        operationName: 'GetOrder',
        query: 'query GetOrder($id: ID!) { order(id: $id) { id total } }',
        variables: '{"id": "ord_42"}',
      },
    });

    const snippet = generateCodeSnippet({
      request: gqlReq,
      target: 'js-fetch',
      resolveVariables: true,
    });

    expect(snippet).toContain('"Content-Type": "application/json"');
    expect(snippet).toContain('GetOrder');
    expect(snippet).toContain('ord_42');
  });
});
