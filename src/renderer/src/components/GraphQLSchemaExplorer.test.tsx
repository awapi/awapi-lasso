import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ThemeProvider } from '../context/ThemeContext';
import { loadSchemaFromSdl } from '../../../shared/graphqlSchemaLoader';
import { GraphQLSchemaExplorer } from './GraphQLSchemaExplorer';

const SAMPLE_SDL = `
  enum ProductCategory {
    ELECTRONICS
    ACCESSORIES
  }

  """Tracked SKU stock item inside a warehouse"""
  type InventoryItem {
    id: ID!
    sku: ID!
    name: String!
    category: ProductCategory!
    legacyCode: String @deprecated(reason: "Use sku instead")
  }

  input AdjustStockInput {
    sku: ID!
    deltaAvailable: Int!
  }

  type Query {
    """Look up a single inventory item by SKU"""
    inventoryItem(sku: ID!): InventoryItem
  }

  type Mutation {
    adjustInventoryStock(input: AdjustStockInput!): InventoryItem!
  }
`;

const { metadata } = loadSchemaFromSdl(SAMPLE_SDL);

describe('GraphQLSchemaExplorer component', () => {
  it('renders empty state when metadata is null', () => {
    render(
      <ThemeProvider>
        <GraphQLSchemaExplorer metadata={null} onGenerateOperation={vi.fn()} />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('graphql-schema-explorer-empty')).toBeInTheDocument();
  });

  it('browses hyperlinked types, filters by search query, and scaffolds a starter operation', () => {
    const onGenerateOperation = vi.fn();

    render(
      <ThemeProvider>
        <GraphQLSchemaExplorer
          metadata={metadata}
          onGenerateOperation={onGenerateOperation}
        />
      </ThemeProvider>,
    );

    // Defaults to Query root type
    expect(screen.getByTestId('schema-explorer-active-type-name')).toHaveTextContent(
      'Query',
    );
    expect(
      screen.getByTestId('schema-explorer-field-inventoryItem'),
    ).toBeInTheDocument();

    // Generate Starter Query on Query.inventoryItem
    fireEvent.click(screen.getByTestId('schema-explorer-generate-btn-inventoryItem'));
    expect(onGenerateOperation).toHaveBeenCalledTimes(1);
    const arg = onGenerateOperation.mock.calls[0][0];
    expect(arg.operationName).toBe('GetInventoryItem');
    expect(arg.query).toContain('query GetInventoryItem($sku: ID!)');

    // Click hyperlinked return type `InventoryItem`
    fireEvent.click(
      screen.getByTestId('schema-explorer-field-type-link-inventoryItem'),
    );
    expect(screen.getByTestId('schema-explorer-active-type-name')).toHaveTextContent(
      'InventoryItem',
    );
    expect(
      screen.getByTestId('schema-explorer-deprecated-legacyCode'),
    ).toHaveTextContent('Use sku instead');

    // Navigate back to Query
    fireEvent.click(screen.getByTestId('schema-explorer-back-btn'));
    expect(screen.getByTestId('schema-explorer-active-type-name')).toHaveTextContent(
      'Query',
    );

    // Search types
    fireEvent.change(screen.getByTestId('schema-explorer-search'), {
      target: { value: 'AdjustStockInput' },
    });
    expect(
      screen.getByTestId('schema-explorer-type-pill-AdjustStockInput'),
    ).toBeInTheDocument();
  });
});
