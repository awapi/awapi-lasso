import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ThemeProvider } from '../context/ThemeContext';
import { loadSchemaFromSdl } from '../../../shared/graphqlSchemaLoader';
import type { GraphQLConfig } from '../../../shared/collectionSchema';
import {
  buildGraphQLCompletionItems,
  GraphQLWorkspace,
} from './GraphQLWorkspace';

const SAMPLE_SDL = `
  enum ProductCategory {
    ELECTRONICS
    ACCESSORIES
  }

  type Warehouse {
    id: ID!
    name: String!
    region: String!
  }

  type InventoryItem {
    id: ID!
    sku: ID!
    name: String!
    category: ProductCategory!
    availableQuantity: Int!
    warehouse: Warehouse
  }

  type Query {
    inventoryItem(sku: ID!, warehouseId: ID): InventoryItem
    warehouses(activeOnly: Boolean): [Warehouse!]!
  }
`;

const bundle = loadSchemaFromSdl(SAMPLE_SDL);

const mockCachedRecord = {
  coordinateKey: 'col_1::local::http://127.0.0.1:8080/graphql',
  collectionId: 'col_1',
  environmentId: 'local',
  endpointUrl: 'http://127.0.0.1:8080/graphql',
  fetchedAt: '2026-10-25T05:00:00Z',
  sourceFormat: 'introspection_json' as const,
  sourceLabel: 'http://127.0.0.1:8080/graphql',
  introspection: bundle.introspection,
  metadata: bundle.metadata,
  diffSummary: {
    hasChanges: false,
    addedTypes: [],
    removedTypes: [],
    modifiedTypes: [],
    addedFields: [],
    removedFields: [],
    summaryText: 'Initial schema snapshot',
  },
};

const ControlledHarness: React.FC<{ initial?: GraphQLConfig }> = ({ initial }) => {
  const [gql, setGql] = useState<GraphQLConfig>(
    initial ?? {
      operationName: 'GetWarehouseStock',
      query: 'query GetWarehouseStock {\n  inventoryItem {\n    sku\n  }\n}\n',
      variables: '{}',
      schemaSource: {
        mode: 'introspect',
        autoIntrospectOnOpen: true,
      },
    },
  );
  return (
    <ThemeProvider>
      <GraphQLWorkspace
        graphql={gql}
        onChange={setGql}
        url="http://127.0.0.1:8080/graphql"
        collectionId="col_1"
        environmentId="local"
        interpolationContext={{
          environmentVariables: [{ key: 'baseUrl', value: 'http://127.0.0.1:8080', enabled: true }],
        }}
      />
    </ThemeProvider>
  );
};

describe('GraphQLWorkspace component', () => {
  beforeEach(() => {
    window.electronAPI = {
      ...window.electronAPI,
      getCachedGraphQLSchema: vi.fn().mockResolvedValue(null),
      introspectGraphQLSchema: vi.fn().mockResolvedValue({
        ok: true,
        record: mockCachedRecord,
      }),
      loadLocalGraphQLSchema: vi.fn().mockResolvedValue({
        ok: true,
        record: mockCachedRecord,
      }),
      openGraphQLSchemaFileDialog: vi.fn().mockResolvedValue('/workspace/schema.graphql'),
    } as unknown as Window['electronAPI'];
  });

  it('auto-introspects schema on mount, displays schema status badge, and performs two-way AST synchronization between Query Designer and Query Editor', async () => {
    render(<ControlledHarness />);

    await waitFor(() => {
      expect(screen.getByTestId('graphql-schema-status-badge')).toHaveTextContent(
        `Loaded • ${bundle.metadata.typeCount} types`,
      );
    });

    // `sku` is already checked from the initial query
    const skuCheckbox = screen.getByTestId(
      'designer-checkbox-inventoryItem.sku',
    ) as HTMLInputElement;
    expect(skuCheckbox.checked).toBe(true);

    // Check `availableQuantity` in the Designer -> updates Query Editor textarea
    fireEvent.click(
      screen.getByTestId('designer-checkbox-inventoryItem.availableQuantity'),
    );

    const queryTextarea = screen.getByTestId(
      'graphql-query-textarea',
    ) as HTMLTextAreaElement;
    expect(queryTextarea.value).toContain('availableQuantity');

    // Edit Query Editor textarea directly -> updates Designer checkbox (`name`)
    fireEvent.change(queryTextarea, {
      target: {
        value: 'query GetWarehouseStock {\n  inventoryItem {\n    sku\n    name\n  }\n}\n',
      },
    });

    const nameCheckbox = screen.getByTestId(
      'designer-checkbox-inventoryItem.name',
    ) as HTMLInputElement;
    expect(nameCheckbox.checked).toBe(true);
  });

  it('shows actionable error banner with Try Again button when introspection fails and recovers on retry', async () => {
    window.electronAPI.introspectGraphQLSchema = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: 'Introspection network error: connect ECONNREFUSED',
      })
      .mockResolvedValueOnce({
        ok: true,
        record: mockCachedRecord,
      });

    render(<ControlledHarness />);

    await waitFor(() => {
      expect(screen.getByTestId('graphql-schema-error-banner')).toHaveTextContent(
        'Introspection network error: connect ECONNREFUSED',
      );
    });

    // Click Try Again
    fireEvent.click(screen.getByTestId('graphql-schema-try-again-btn'));

    await waitFor(() => {
      expect(
        screen.queryByTestId('graphql-schema-error-banner'),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId('graphql-schema-status-badge')).toHaveTextContent(
        `Loaded • ${bundle.metadata.typeCount} types`,
      );
    });
  });

  it('opens Docs Explorer drawer and generates a starter query into the editor', async () => {
    render(<ControlledHarness />);

    await waitFor(() => {
      expect(screen.getByTestId('graphql-schema-status-badge')).toHaveTextContent(
        'Loaded',
      );
    });

    fireEvent.click(screen.getByTestId('graphql-docs-toggle-btn'));
    expect(screen.getByTestId('graphql-docs-drawer')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('schema-explorer-generate-btn-warehouses'));
    const queryTextarea = screen.getByTestId(
      'graphql-query-textarea',
    ) as HTMLTextAreaElement;
    expect(queryTextarea.value).toContain('query GetWarehouses($activeOnly: Boolean)');
  });

  it('builds schema-aware Monaco completion items including fields, args, types, directives, and {{variables}}', () => {
    const completions = buildGraphQLCompletionItems(bundle.metadata, {
      environmentVariables: [{ key: 'baseUrl', value: 'http://localhost:8080', enabled: true }],
    });

    expect(completions.some(c => c.kind === 'field' && c.label === 'inventoryItem')).toBe(
      true,
    );
    expect(completions.some(c => c.kind === 'argument' && c.label === 'sku')).toBe(true);
    expect(completions.some(c => c.kind === 'type' && c.label === 'Warehouse')).toBe(
      true,
    );
    expect(completions.some(c => c.kind === 'variable' && c.label === '{{baseUrl}}')).toBe(
      true,
    );
  });

  it('places GraphQL Query / Mutation and GraphQL Variables side-by-side with a vertical splitter and two-way collapse', () => {
    render(<ControlledHarness />);

    const splitPane = screen.getByTestId('graphql-query-variables-split');
    const resizer = screen.getByTestId('graphql-query-variables-split-resizer');
    const queryPane = screen.getByTestId('graphql-query-variables-split-first');
    const variablesPane = screen.getByTestId('graphql-query-variables-split-second');

    expect(splitPane).toHaveAttribute('data-direction', 'horizontal');
    expect(resizer).toHaveAttribute('aria-orientation', 'vertical');
    expect(resizer).toHaveStyle({ cursor: 'col-resize' });
    expect(variablesPane).toHaveStyle({ width: '280px' });

    // Collapse Query pane (`‹`), then expand it (`›`)
    fireEvent.click(
      screen.getByTestId('graphql-query-variables-split-collapse-first-btn'),
    );
    expect(queryPane).toHaveAttribute('data-collapsed', 'true');
    fireEvent.click(
      screen.getByTestId('graphql-query-variables-split-collapse-first-btn'),
    );
    expect(queryPane).toHaveAttribute('data-collapsed', 'false');

    // Collapse Variables pane (`›`), then expand it (`‹`)
    fireEvent.click(
      screen.getByTestId('graphql-query-variables-split-collapse-second-btn'),
    );
    expect(variablesPane).toHaveAttribute('data-collapsed', 'true');
    fireEvent.click(
      screen.getByTestId('graphql-query-variables-split-collapse-second-btn'),
    );
    expect(variablesPane).toHaveAttribute('data-collapsed', 'false');
  });
});
