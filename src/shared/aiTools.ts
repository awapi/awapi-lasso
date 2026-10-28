import type { AiToolDefinition } from './aiTypes';

const requestIdProp = {
  type: 'string',
  description: 'Request id. Omit to use the request open in the active tab.',
};
const collectionIdProp = {
  type: 'string',
  description: 'Collection id from get_workspace_overview. Omit to use the active collection.',
};

const keyValueEntry = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    value: { type: 'string' },
    enabled: { type: 'boolean', description: 'Defaults to true.' },
    description: { type: 'string' },
  },
  required: ['key'],
};

const keyValuePatch = (what: string) => ({
  type: 'object',
  description: `Upserts (by key) and/or removes ${what}. Entries you do not mention are left untouched, including ones whose values are hidden.`,
  properties: {
    set: { type: 'array', items: keyValueEntry },
    remove: { type: 'array', items: { type: 'string' }, description: 'Keys to remove.' },
  },
});

const requestFields = {
  name: { type: 'string' },
  description: { type: 'string' },
  method: { type: 'string', description: 'HTTP method, e.g. GET, POST.' },
  url: { type: 'string', description: 'May contain {{variables}} and :pathParams.' },
  queryParams: keyValuePatch('query parameters'),
  pathParams: keyValuePatch('path parameters'),
  headers: keyValuePatch('headers'),
  body: {
    type: 'object',
    description:
      'Replaces the whole body. For json/text/xml/html/yaml set `content`; for form-urlencoded set `urlEncoded`.',
    properties: {
      mode: {
        type: 'string',
        enum: ['none', 'json', 'yaml', 'xml', 'html', 'text', 'form-urlencoded'],
      },
      content: { type: 'string' },
      urlEncoded: { type: 'array', items: keyValueEntry },
    },
    required: ['mode'],
  },
  graphql: {
    type: 'object',
    description:
      'GraphQL operation fields (only for protocol "graphql"). To edit an existing request\'s query, prefer update_graphql_operation.',
    properties: {
      query: { type: 'string' },
      variables: { type: 'string', description: 'JSON object text.' },
      operationName: { type: 'string' },
    },
  },
  captures: {
    type: 'array',
    description: 'Replaces all response captures.',
    items: {
      type: 'object',
      properties: {
        variable: { type: 'string' },
        scope: { type: 'string', enum: ['environment', 'collection', 'runtime'] },
        source: { type: 'string', enum: ['jsonpath', 'header', 'cookie', 'status', 'body'] },
        expression: { type: 'string' },
        enabled: { type: 'boolean' },
      },
      required: ['variable', 'scope', 'source'],
    },
  },
  assertions: {
    type: 'array',
    description: 'Replaces all response assertions.',
    items: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['status', 'responseTime', 'header', 'jsonpath', 'body'] },
        path: { type: 'string' },
        headerName: { type: 'string' },
        operator: {
          type: 'string',
          enum: [
            'equals',
            'notEquals',
            'contains',
            'notContains',
            'matchesRegex',
            'lessThan',
            'greaterThan',
            'in',
            'isDefined',
            'isUndefined',
            'isEmpty',
            'isNotEmpty',
            'isArray',
          ],
        },
        expected: {},
        enabled: { type: 'boolean' },
      },
      required: ['target', 'operator'],
    },
  },
};

export const AI_TOOLS: readonly AiToolDefinition[] = [
  {
    name: 'get_workspace_overview',
    risk: 'read',
    description:
      'List open collections (ids, names), open request tabs, which request is active, and the active environment. Start here to find ids.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_request',
    risk: 'read',
    description:
      'Read a request: method, url, query/path params, headers, body, GraphQL query/variables, captures, assertions and the auth *type* only. Auth credentials and secret values are never available; hidden values show as [REDACTED].',
    parameters: { type: 'object', properties: { requestId: requestIdProp } },
  },
  {
    name: 'get_response',
    risk: 'read',
    description:
      'Read the last response of the active request tab: status, timing, headers, body (paged), captures and assertion results. Credentials and cookie values are redacted.',
    parameters: {
      type: 'object',
      properties: {
        offset: { type: 'integer', description: 'Body character offset to start from (default 0).' },
        maxChars: { type: 'integer', description: 'Max body characters to return (default 8000, max 20000).' },
      },
    },
  },
  {
    name: 'list_environments',
    risk: 'read',
    description:
      'List environments and collection variables with their variable names and non-secret values. Secret values are hidden.',
    parameters: { type: 'object', properties: { collectionId: collectionIdProp } },
  },
  {
    name: 'list_collection_items',
    risk: 'read',
    description: 'List the folders and requests (ids, names, methods, urls) of a collection.',
    parameters: { type: 'object', properties: { collectionId: collectionIdProp } },
  },
  {
    name: 'get_graphql_schema',
    risk: 'read',
    description:
      'Read the GraphQL schema loaded for the active request. With no arguments: root Query/Mutation/Subscription fields and type names. With typeName: that type\'s fields, args, enum values or input fields. With search: matching type and field names. Use before writing queries; never guess field names.',
    parameters: {
      type: 'object',
      properties: {
        typeName: { type: 'string', description: 'Exact type name, e.g. "User".' },
        search: { type: 'string', description: 'Case-insensitive text to find in type and field names.' },
      },
    },
  },
  {
    name: 'validate_graphql_query',
    risk: 'read',
    description:
      'Validate a GraphQL query/mutation (and optional variables JSON) against the loaded schema. Returns errors with line/column; fix them and validate again before proposing the query with update_graphql_operation.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        variables: { type: 'string', description: 'JSON object text.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'open_request',
    risk: 'read',
    description: 'Open a request in a tab and make it the active request (needed before send_request).',
    parameters: {
      type: 'object',
      properties: { requestId: { type: 'string' } },
      required: ['requestId'],
    },
  },
  {
    name: 'update_request',
    risk: 'write',
    description:
      'Edit a request. Only the fields present in `changes` are modified. The user is asked to approve the edit. You cannot read or change auth. For anything secret, reference a {{variable}} instead of a literal value.',
    parameters: {
      type: 'object',
      properties: {
        requestId: requestIdProp,
        changes: { type: 'object', properties: requestFields },
      },
      required: ['changes'],
    },
  },
  {
    // Flat string parameters: some local models/servers drop multi-line strings nested inside `changes`.
    name: 'update_graphql_operation',
    risk: 'write',
    description:
      'Replace the GraphQL query, variables and/or operationName of a GraphQL request. Prefer this over update_request for GraphQL. Pass the complete new query document, not a fragment. The user is asked to approve the edit.',
    parameters: {
      type: 'object',
      properties: {
        requestId: requestIdProp,
        query: { type: 'string', description: 'The complete GraphQL document (query or mutation).' },
        variables: { type: 'string', description: 'JSON object text, e.g. {"id": "1"}.' },
        operationName: { type: 'string' },
      },
    },
  },
  {
    name: 'create_request',
    risk: 'write',
    description: 'Add a new request to a collection (optionally inside a folder) and open it. Requires user approval.',
    parameters: {
      type: 'object',
      properties: {
        collectionId: collectionIdProp,
        folderId: { type: 'string', description: 'Folder id from list_collection_items. Omit for the collection root.' },
        protocol: { type: 'string', enum: ['http', 'graphql'], description: 'Defaults to http.' },
        request: { type: 'object', properties: requestFields },
      },
      required: ['request'],
    },
  },
  {
    name: 'set_environment_variables',
    risk: 'write',
    description:
      'Add or update non-secret variables in an environment (or collection variables when `environment` is "collection"). Requires approval. Secret values cannot be set or read here; you may add a variable with secret=true and no value for the user to fill in.',
    parameters: {
      type: 'object',
      properties: {
        collectionId: collectionIdProp,
        environment: {
          type: 'string',
          description: 'Environment name, or "collection" for collection-level variables. Defaults to the active environment.',
        },
        variables: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              key: { type: 'string' },
              value: { type: 'string' },
              enabled: { type: 'boolean' },
              secret: { type: 'boolean' },
              description: { type: 'string' },
            },
            required: ['key'],
          },
        },
      },
      required: ['variables'],
    },
  },
  {
    name: 'load_graphql_schema',
    risk: 'run',
    description:
      'Discover the schema of the GraphQL request open in the active tab (introspection query to the server, falling back to its configured local schema file). Requires user approval because it sends a request. Returns the same overview as get_graphql_schema.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'send_request',
    risk: 'run',
    description:
      'Send the active request (it really hits the network and may change server data). Requires user approval. Returns the same data as get_response.',
    parameters: { type: 'object', properties: {} },
  },
];

export const AI_TOOL_NAMES: ReadonlySet<string> = new Set(AI_TOOLS.map(t => t.name));

export function getAiTool(name: string): AiToolDefinition | undefined {
  return AI_TOOLS.find(t => t.name === name);
}
