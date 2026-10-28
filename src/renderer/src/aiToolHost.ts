import type { AwjcCollection, CollectionTreeItem, FolderItem, RequestItem } from '../../shared/collectionSchema';
import type { AiToolCall, AiToolResult } from '../../shared/aiTypes';
import type { HttpResponseResult } from '../../shared/httpTypes';
import { redactUrl } from '../../shared/aiContext';
import {
  applyRequestChanges,
  applyVariableChanges,
  buildRequestFromSpec,
  changedUrlVariables,
  changesUrlOrigin,
  describeTreeForAi,
  sanitizeRequestForAi,
  sanitizeResponseForAi,
  sanitizeVariablesForAi,
} from '../../shared/aiSanitize';
import { getAiTool } from '../../shared/aiTools';
import { describeSchemaForAi, validateGraphqlForAi } from '../../shared/aiGraphql';
import type { AiGraphqlSchema } from './aiGraphqlSchema';

export interface AiToolTab {
  id: string;
  collectionPath: string | null;
  request: RequestItem;
  isDirty?: boolean;
}

export interface AiToolCollectionEntry {
  filePath: string;
  collection: AwjcCollection;
}

/** The slice of app state and actions the assistant's tools may use. Auth and secret stores are not exposed. */
export interface AiToolWorkspace {
  getCollections: () => AiToolCollectionEntry[];
  getActiveCollectionPath: () => string | null;
  getTabs: () => AiToolTab[];
  getActiveTabId: () => string | null;
  getResponse: (tabId: string) => HttpResponseResult | null;
  /** Schema loaded by the GraphQL workspace of the active request, if any. */
  getGraphqlSchema: () => AiGraphqlSchema | null;
  /** Plaintext secret values currently known to the app; used only to scrub tool output. */
  getSecretValues: () => string[];
  /** Replaces a request (open tab and/or collection tree item) and marks it unsaved. */
  updateRequest: (requestId: string, next: RequestItem) => void;
  updateCollection: (filePath: string, updater: (c: AwjcCollection) => AwjcCollection) => void;
  /** Inserts a request into the collection tree and opens it in a tab. */
  addRequest: (filePath: string, parentFolderId: string | undefined, request: RequestItem) => void;
  openRequest: (requestId: string) => boolean;
  /** Sends the active tab's request exactly as the Send button would. */
  sendActiveRequest: () => Promise<HttpResponseResult | null>;
}

export interface AiApprovalRequest {
  tool: string;
  risk: 'write' | 'run';
  title: string;
  lines: string[];
  /** Why this change is risky. Set for changes that could redirect requests; always asks, even with auto-apply. */
  warning?: string;
}

export interface AiToolHost {
  workspace: AiToolWorkspace;
  requestApproval: (request: AiApprovalRequest) => Promise<boolean>;
  getApprovalPolicy: () => Promise<{
    autoApplyEdits: boolean;
    confirmBeforeRun: boolean;
    /** When false, environment variable values are withheld from the assistant. Defaults to true. */
    shareEnvironmentValues?: boolean;
  }>;
}

const ok = (value: unknown): AiToolResult => ({ ok: true, content: JSON.stringify(value) });
const fail = (message: string): AiToolResult => ({ ok: false, content: message });

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function findInTree(items: CollectionTreeItem[], id: string): CollectionTreeItem | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    if (item.kind === 'folder') {
      const found = findInTree(item.items, id);
      if (found) return found;
    }
  }
  return undefined;
}

function resolveCollection(host: AiToolHost, id: unknown): AiToolCollectionEntry | string {
  const ws = host.workspace;
  const collections = ws.getCollections();
  const wanted = str(id);
  const entry = wanted
    ? collections.find(c => c.collection.metadata.id === wanted)
    : collections.find(c => c.filePath === ws.getActiveCollectionPath());
  if (entry) return entry;
  return wanted
    ? `No collection with id "${wanted}". Use get_workspace_overview to list collections.`
    : 'No collection is open.';
}

interface RequestLocation {
  request: RequestItem;
  tab?: AiToolTab;
  collectionPath: string | null;
}

function resolveRequest(host: AiToolHost, requestId: unknown): RequestLocation | string {
  const ws = host.workspace;
  const wanted = str(requestId);
  const tabs = ws.getTabs();
  if (!wanted) {
    const tab = tabs.find(t => t.id === ws.getActiveTabId());
    return tab
      ? { request: tab.request, tab, collectionPath: tab.collectionPath }
      : 'There is no active request tab.';
  }
  const tab = tabs.find(t => t.request.id === wanted);
  if (tab) return { request: tab.request, tab, collectionPath: tab.collectionPath };
  for (const entry of ws.getCollections()) {
    const item = findInTree(entry.collection.items, wanted);
    if (item?.kind === 'request') return { request: item, collectionPath: entry.filePath };
  }
  return `No request with id "${wanted}". Use list_collection_items to find ids.`;
}

async function approve(host: AiToolHost, request: AiApprovalRequest): Promise<boolean> {
  if (request.warning) return host.requestApproval(request);
  const policy = await host.getApprovalPolicy();
  if (request.risk === 'write' && policy.autoApplyEdits) return true;
  if (request.risk === 'run' && !policy.confirmBeforeRun) return true;
  return host.requestApproval(request);
}

const NO_SCHEMA =
  'No GraphQL schema is loaded. Open a GraphQL request and ask the user to load or discover its schema in the GraphQL tab (introspection or a schema file).';

const HOST_CHANGE_WARNING =
  'This points the request at a different host. Check it is a server you trust before applying; this always asks, even when edits are applied automatically.';

const DECLINED = 'The user declined this action. Do not retry it unchanged; ask what they would like instead.';

async function runTool(call: AiToolCall, host: AiToolHost): Promise<AiToolResult> {
  const ws = host.workspace;
  const args = call.arguments;
  const secrets = ws.getSecretValues();

  switch (call.name) {
    case 'get_workspace_overview': {
      const activeTabId = ws.getActiveTabId();
      return ok({
        activeCollectionId:
          ws.getCollections().find(c => c.filePath === ws.getActiveCollectionPath())?.collection.metadata.id ?? null,
        collections: ws.getCollections().map(({ collection }) => ({
          id: collection.metadata.id,
          name: collection.metadata.name,
          environments: (collection.environments ?? []).map(e => e.name),
          activeEnvironment: collection.activeEnvironment ?? null,
        })),
        tabs: ws.getTabs().map(t => ({
          requestId: t.request.id,
          name: t.request.name,
          method: t.request.method,
          url: redactUrl(t.request.url, secrets),
          unsavedChanges: Boolean(t.isDirty),
          active: t.id === activeTabId,
        })),
      });
    }

    case 'get_request': {
      const found = resolveRequest(host, args.requestId);
      if (typeof found === 'string') return fail(found);
      return ok({ ...sanitizeRequestForAi(found.request, secrets), unsavedChanges: Boolean(found.tab?.isDirty) });
    }

    case 'get_response': {
      const tabId = ws.getActiveTabId();
      const response = tabId ? ws.getResponse(tabId) : null;
      if (!response) return ok({ message: 'The active request has no response yet. Use send_request or ask the user to send it.' });
      return ok(
        sanitizeResponseForAi(response, secrets, {
          offset: typeof args.offset === 'number' ? args.offset : undefined,
          maxChars: typeof args.maxChars === 'number' ? args.maxChars : undefined,
        }),
      );
    }

    case 'list_environments': {
      const entry = resolveCollection(host, args.collectionId);
      if (typeof entry === 'string') return fail(entry);
      const { collection } = entry;
      const hideAllValues = (await host.getApprovalPolicy()).shareEnvironmentValues === false;
      return ok({
        collectionId: collection.metadata.id,
        activeEnvironment: collection.activeEnvironment ?? null,
        ...(hideAllValues ? { valuesHidden: 'The user chose not to share environment values; only names are available.' } : {}),
        environments: (collection.environments ?? []).map(e => ({
          name: e.name,
          variables: sanitizeVariablesForAi(e.variables, secrets, { hideAllValues }),
        })),
        collectionVariables: sanitizeVariablesForAi(collection.variables, secrets, { hideAllValues }),
      });
    }

    case 'list_collection_items': {
      const entry = resolveCollection(host, args.collectionId);
      if (typeof entry === 'string') return fail(entry);
      return ok({
        collectionId: entry.collection.metadata.id,
        name: entry.collection.metadata.name,
        ...describeTreeForAi(entry.collection.items, secrets),
      });
    }

    case 'open_request': {
      const id = str(args.requestId);
      if (!id) return fail('requestId is required.');
      const found = resolveRequest(host, id);
      if (typeof found === 'string') return fail(found);
      if (!ws.openRequest(id)) return fail('Could not open that request.');
      return ok({ opened: true, request: sanitizeRequestForAi(found.request, secrets) });
    }

    case 'get_graphql_schema': {
      const schema = ws.getGraphqlSchema();
      if (!schema) return fail(NO_SCHEMA);
      const described = describeSchemaForAi(schema.metadata, {
        typeName: str(args.typeName),
        search: str(args.search),
      });
      return described.ok ? ok(described.value) : fail(described.error);
    }

    case 'validate_graphql_query': {
      const query = typeof args.query === 'string' ? args.query : '';
      if (query.trim() === '') return fail('query is required.');
      const schema = ws.getGraphqlSchema();
      if (!schema) return fail(NO_SCHEMA);
      return ok(
        validateGraphqlForAi(schema.introspection, query, typeof args.variables === 'string' ? args.variables : undefined),
      );
    }

    case 'update_request': {
      const found = resolveRequest(host, args.requestId);
      if (typeof found === 'string') return fail(found);
      const applied = applyRequestChanges(found.request, args.changes);
      if (!applied.ok) return fail(applied.error);
      const approved = await approve(host, {
        tool: call.name,
        risk: 'write',
        title: `Edit request "${found.request.name}"`,
        lines: applied.summary,
        ...(changesUrlOrigin(found.request.url, applied.value.url) ? { warning: HOST_CHANGE_WARNING } : {}),
      });
      if (!approved) return fail(DECLINED);
      ws.updateRequest(found.request.id, applied.value);
      return ok({ updated: true, request: sanitizeRequestForAi(applied.value, secrets) });
    }

    case 'create_request': {
      const entry = resolveCollection(host, args.collectionId);
      if (typeof entry === 'string') return fail(entry);
      const folderId = str(args.folderId);
      if (folderId) {
        const folder = findInTree(entry.collection.items, folderId);
        if (folder?.kind !== 'folder') return fail(`No folder with id "${folderId}" in this collection.`);
      }
      const built = buildRequestFromSpec(args.protocol, args.request);
      if (!built.ok) return fail(built.error);
      const folderName = folderId ? (findInTree(entry.collection.items, folderId) as FolderItem).name : null;
      const approved = await approve(host, {
        tool: call.name,
        risk: 'write',
        title: `Add request to "${entry.collection.metadata.name}"${folderName ? ` / ${folderName}` : ''}`,
        lines: built.summary,
      });
      if (!approved) return fail(DECLINED);
      ws.addRequest(entry.filePath, folderId, built.value);
      return ok({ created: true, request: sanitizeRequestForAi(built.value, secrets) });
    }

    case 'set_environment_variables': {
      const entry = resolveCollection(host, args.collectionId);
      if (typeof entry === 'string') return fail(entry);
      const { collection } = entry;
      const target = str(args.environment) ?? collection.activeEnvironment;
      if (!target) return fail('No environment specified and none is active.');
      const isCollectionScope = target === 'collection';
      const env = isCollectionScope ? undefined : (collection.environments ?? []).find(e => e.name === target);
      if (!isCollectionScope && !env) return fail(`No environment named "${target}".`);

      const applied = applyVariableChanges(isCollectionScope ? collection.variables : env?.variables, args.variables);
      if (!applied.ok) return fail(applied.error);
      const urlVariables = changedUrlVariables(isCollectionScope ? collection.variables : env?.variables, applied.value);
      const approved = await approve(host, {
        tool: call.name,
        risk: 'write',
        title: isCollectionScope ? 'Edit collection variables' : `Edit environment "${target}"`,
        lines: applied.summary,
        ...(urlVariables.length
          ? {
              warning: `Changes URL variable${urlVariables.length > 1 ? 's' : ''} ${urlVariables.join(', ')}, which can send requests to a different host. This always asks, even when edits are applied automatically.`,
            }
          : {}),
      });
      if (!approved) return fail(DECLINED);
      ws.updateCollection(entry.filePath, c =>
        isCollectionScope
          ? { ...c, variables: applied.value }
          : { ...c, environments: (c.environments ?? []).map(e => (e.name === target ? { ...e, variables: applied.value } : e)) },
      );
      return ok({ updated: true, variables: sanitizeVariablesForAi(applied.value, secrets) });
    }

    case 'send_request': {
      const tabId = ws.getActiveTabId();
      const tab = ws.getTabs().find(t => t.id === tabId);
      if (!tab) return fail('There is no active request tab. Use open_request first.');
      const approved = await approve(host, {
        tool: call.name,
        risk: 'run',
        title: `Send ${tab.request.method} ${redactUrl(tab.request.url, secrets)}`,
        lines: ['This sends a real network request and may change data on the server.'],
      });
      if (!approved) return fail(DECLINED);
      const response = await ws.sendActiveRequest();
      return response ? ok(sanitizeResponseForAi(response, secrets)) : fail('The request could not be sent.');
    }

    default:
      return fail(`Unknown tool "${call.name}".`);
  }
}

/** Executes one assistant tool call against the workspace. Never throws; failures become error results. */
export async function executeAiTool(call: AiToolCall, host: AiToolHost): Promise<AiToolResult> {
  if (!getAiTool(call.name)) return fail(`Unknown tool "${call.name}".`);
  try {
    return await runTool(call, host);
  } catch (error) {
    return fail(`Tool failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
