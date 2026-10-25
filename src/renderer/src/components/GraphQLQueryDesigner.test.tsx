import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ThemeProvider } from '../context/ThemeContext';
import { loadSchemaFromSdl } from '../../../shared/graphqlSchemaLoader';
import { extractSelectionStateFromAst } from '../../../shared/graphqlAstSync';
import { GraphQLQueryDesigner } from './GraphQLQueryDesigner';

const SAMPLE_SDL = `
  enum ProductCategory {
    ELECTRONICS
    ACCESSORIES
  }

  enum SortDirection {
    ASC
    DESC
  }

  enum InventorySortField {
    SKU
    UNIT_PRICE
    AVAILABLE_QUANTITY
  }

  input IntComparisonFilter {
    eq: Int
    gte: Int
    lte: Int
  }

  input InventoryWhereInput {
    category: ProductCategory
    availableQuantity: IntComparisonFilter
    inStock: Boolean
    AND: [InventoryWhereInput!]
    OR: [InventoryWhereInput!]
  }

  input InventoryOrderByInput {
    field: InventorySortField!
    direction: SortDirection! = ASC
  }

  enum InventoryGroupField {
    CATEGORY
    WAREHOUSE_ID
    IN_STOCK
  }

  type InventoryGroupSummary {
    groupKey: String!
    count: Int!
    totalAvailableQuantity: Int!
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
    legacyCode: String @deprecated(reason: "Use sku instead")
  }

  union SearchResult = InventoryItem | Warehouse

  input AdjustStockInput {
    sku: ID!
    deltaAvailable: Int!
  }

  type Query {
    inventoryItem(sku: ID!, warehouseId: ID): InventoryItem
    inventoryItems(
      category: ProductCategory
      where: InventoryWhereInput
      orderBy: [InventoryOrderByInput!]
      limit: Int = 20
    ): [InventoryItem!]!
    searchCatalog(text: String!): [SearchResult!]!
    inventorySummaryByGroup(
      groupBy: [InventoryGroupField!]!
      where: InventoryWhereInput
    ): [InventoryGroupSummary!]!
  }

  type Mutation {
    adjustInventoryStock(input: AdjustStockInput!): InventoryItem!
  }
`;

const { metadata } = loadSchemaFromSdl(SAMPLE_SDL);

describe('GraphQLQueryDesigner component', () => {
  it('renders empty state when no schema metadata is loaded', () => {
    render(
      <ThemeProvider>
        <GraphQLQueryDesigner
          metadata={null}
          selectionState={extractSelectionStateFromAst('')}
          activeOperationType="query"
          onChangeOperationType={vi.fn()}
          onToggleField={vi.fn()}
          onToggleInlineFragment={vi.fn()}
          onChangeArgument={vi.fn()}
          onToggleVariableBinding={vi.fn()}
        />
      </ThemeProvider>,
    );

    expect(screen.getByTestId('graphql-designer-empty')).toBeInTheDocument();
  });

  it('renders root Query/Mutation tabs, filters fields, toggles checkboxes, and shows @deprecated warnings', () => {
    const onToggleField = vi.fn();
    const onChangeOperationType = vi.fn();
    const selectionState = extractSelectionStateFromAst(
      `query GetItem { inventoryItem { sku legacyCode } }`,
    );

    render(
      <ThemeProvider>
        <GraphQLQueryDesigner
          metadata={metadata}
          selectionState={selectionState}
          activeOperationType="query"
          onChangeOperationType={onChangeOperationType}
          onToggleField={onToggleField}
          onToggleInlineFragment={vi.fn()}
          onChangeArgument={vi.fn()}
          onToggleVariableBinding={vi.fn()}
        />
      </ThemeProvider>,
    );

    // Selected field is automatically expanded and checked
    const rootCheckbox = screen.getByTestId('designer-checkbox-inventoryItem') as HTMLInputElement;
    expect(rootCheckbox.checked).toBe(true);

    const skuCheckbox = screen.getByTestId(
      'designer-checkbox-inventoryItem.sku',
    ) as HTMLInputElement;
    expect(skuCheckbox.checked).toBe(true);

    // Deprecated badge is visible on legacyCode
    expect(
      screen.getByTestId('designer-deprecated-badge-inventoryItem.legacyCode'),
    ).toBeInTheDocument();

    // Check `availableQuantity`
    fireEvent.click(
      screen.getByTestId('designer-checkbox-inventoryItem.availableQuantity'),
    );
    expect(onToggleField).toHaveBeenCalledWith(
      ['inventoryItem', 'availableQuantity'],
      true,
    );

    // Filter fields by search input
    fireEvent.change(screen.getByTestId('designer-field-search'), {
      target: { value: 'searchCatalog' },
    });
    expect(
      screen.getByTestId('designer-field-node-searchCatalog'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('designer-field-node-inventoryItem'),
    ).not.toBeInTheDocument();

    // Switch to Mutation tab
    fireEvent.click(screen.getByTestId('designer-op-tab-mutation'));
    expect(onChangeOperationType).toHaveBeenCalledWith('mutation');
  });

  it('renders arguments directly in the unified tree with ARG badges, reveals inline inputs when checked, and toggles `$var` promotion', () => {
    const onChangeArgument = vi.fn();
    const onToggleVariableBinding = vi.fn();

    render(
      <ThemeProvider>
        <GraphQLQueryDesigner
          metadata={metadata}
          selectionState={extractSelectionStateFromAst('')}
          activeOperationType="query"
          onChangeOperationType={vi.fn()}
          onToggleField={vi.fn()}
          onToggleInlineFragment={vi.fn()}
          onChangeArgument={onChangeArgument}
          onToggleVariableBinding={onToggleVariableBinding}
        />
      </ThemeProvider>,
    );

    // Expand `inventoryItems` in the unified tree -> shows `category`, `where`, `orderBy`, `limit` ARG rows directly
    fireEvent.click(screen.getByTestId('designer-expand-btn-inventoryItems'));
    expect(screen.getByTestId('designer-args-panel-inventoryItems')).toBeInTheDocument();
    expect(
      screen.getByTestId('designer-where-icon-inventoryItems-where'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('designer-orderby-icon-inventoryItems-orderBy'),
    ).toBeInTheDocument();

    // Check `category` ARG checkbox -> populates default enum value and reveals dropdown
    fireEvent.click(
      screen.getByTestId('designer-arg-checkbox-inventoryItems-category'),
    );
    expect(onChangeArgument).toHaveBeenCalledWith(
      ['inventoryItems'],
      'category',
      'ELECTRONICS',
    );

    const categorySelect = screen.getByTestId(
      'designer-arg-input-inventoryItems-category',
    );
    fireEvent.change(categorySelect, { target: { value: 'ACCESSORIES' } });
    expect(onChangeArgument).toHaveBeenCalledWith(
      ['inventoryItems'],
      'category',
      'ACCESSORIES',
    );

    // Check `limit` ARG checkbox and click `$var` button
    fireEvent.click(screen.getByTestId('designer-arg-checkbox-inventoryItems-limit'));
    fireEvent.click(screen.getByTestId('designer-arg-var-btn-inventoryItems-limit'));
    expect(onToggleVariableBinding).toHaveBeenCalledWith(
      ['inventoryItems'],
      'limit',
      true,
    );
  });

  it('expands Union `... on Type` branches and toggles inline fragments', () => {
    const onToggleInlineFragment = vi.fn();

    render(
      <ThemeProvider>
        <GraphQLQueryDesigner
          metadata={metadata}
          selectionState={extractSelectionStateFromAst('')}
          activeOperationType="query"
          onChangeOperationType={vi.fn()}
          onToggleField={vi.fn()}
          onToggleInlineFragment={onToggleInlineFragment}
          onChangeArgument={vi.fn()}
          onToggleVariableBinding={vi.fn()}
        />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByTestId('designer-expand-btn-searchCatalog'));
    const fragmentCheckbox = screen.getByTestId(
      'designer-fragment-checkbox-searchCatalog.... on InventoryItem',
    );
    fireEvent.click(fragmentCheckbox);
    expect(onToggleInlineFragment).toHaveBeenCalledWith(
      ['searchCatalog'],
      'InventoryItem',
      true,
    );
  });

  it('builds nested `where` filters (comparison operators & enums) and `orderBy` sort rules in the unified Postman-style tree', () => {
    const onChangeNestedArgument = vi.fn();

    render(
      <ThemeProvider>
        <GraphQLQueryDesigner
          metadata={metadata}
          selectionState={extractSelectionStateFromAst('')}
          activeOperationType="query"
          onChangeOperationType={vi.fn()}
          onToggleField={vi.fn()}
          onToggleInlineFragment={vi.fn()}
          onChangeArgument={vi.fn()}
          onChangeNestedArgument={onChangeNestedArgument}
          onToggleVariableBinding={vi.fn()}
        />
      </ThemeProvider>,
    );

    // Expand `inventoryItems`
    fireEvent.click(screen.getByTestId('designer-expand-btn-inventoryItems'));

    // Expand `where` and `orderBy` directly in the tree
    fireEvent.click(
      screen.getByTestId('designer-arg-builder-toggle-inventoryItems-where'),
    );
    fireEvent.click(
      screen.getByTestId('designer-arg-builder-toggle-inventoryItems-orderBy'),
    );

    // Expand `where.availableQuantity` and check `gte`
    fireEvent.click(
      screen.getByTestId(
        'designer-nested-expand-btn-inventoryItems-where-availableQuantity',
      ),
    );
    fireEvent.click(
      screen.getByTestId(
        'designer-nested-checkbox-inventoryItems-where-availableQuantity.gte',
      ),
    );
    const gteInput = screen.getByTestId(
      'designer-nested-input-inventoryItems-where-availableQuantity.gte',
    );
    fireEvent.change(gteInput, { target: { value: '10' } });
    expect(onChangeNestedArgument).toHaveBeenCalledWith(
      ['inventoryItems'],
      'where',
      ['availableQuantity', 'gte'],
      '10',
    );

    // Check `orderBy` -> `field` and `direction`
    fireEvent.click(
      screen.getByTestId('designer-nested-checkbox-inventoryItems-orderBy-0.field'),
    );
    const sortFieldSelect = screen.getByTestId(
      'designer-nested-input-inventoryItems-orderBy-0.field',
    );
    fireEvent.change(sortFieldSelect, { target: { value: 'UNIT_PRICE' } });
    expect(onChangeNestedArgument).toHaveBeenCalledWith(
      ['inventoryItems'],
      'orderBy',
      [0, 'field'],
      'UNIT_PRICE',
    );

    fireEvent.click(
      screen.getByTestId(
        'designer-nested-checkbox-inventoryItems-orderBy-0.direction',
      ),
    );
    const sortDirSelect = screen.getByTestId(
      'designer-nested-input-inventoryItems-orderBy-0.direction',
    );
    fireEvent.change(sortDirSelect, { target: { value: 'DESC' } });
    expect(onChangeNestedArgument).toHaveBeenCalledWith(
      ['inventoryItems'],
      'orderBy',
      [0, 'direction'],
      'DESC',
    );
  });

  it('supports `groupBy` multi-enum checkboxes and logical `AND` / `OR` condition groups inside `where`', () => {
    const onChangeArgument = vi.fn();
    const onChangeNestedArgument = vi.fn();

    render(
      <ThemeProvider>
        <GraphQLQueryDesigner
          metadata={metadata}
          selectionState={extractSelectionStateFromAst('')}
          activeOperationType="query"
          onChangeOperationType={vi.fn()}
          onToggleField={vi.fn()}
          onToggleInlineFragment={vi.fn()}
          onChangeArgument={onChangeArgument}
          onChangeNestedArgument={onChangeNestedArgument}
          onToggleVariableBinding={vi.fn()}
        />
      </ThemeProvider>,
    );

    // 1. Expand `inventorySummaryByGroup` and verify `groupBy` Layers icon
    fireEvent.click(
      screen.getByTestId('designer-expand-btn-inventorySummaryByGroup'),
    );
    expect(
      screen.getByTestId('designer-groupby-icon-inventorySummaryByGroup-groupBy'),
    ).toBeInTheDocument();

    // Expand `groupBy` enum list and check `CATEGORY`
    fireEvent.click(
      screen.getByTestId(
        'designer-arg-builder-toggle-inventorySummaryByGroup-groupBy',
      ),
    );
    fireEvent.click(
      screen.getByTestId(
        'designer-arg-enum-checkbox-inventorySummaryByGroup-groupBy-CATEGORY',
      ),
    );
    expect(onChangeArgument).toHaveBeenCalledWith(
      ['inventorySummaryByGroup'],
      'groupBy',
      '[CATEGORY]',
    );

    // 2. Expand `where` -> expand `OR` logical condition group -> "+ Add OR Condition"
    fireEvent.click(
      screen.getByTestId(
        'designer-arg-builder-toggle-inventorySummaryByGroup-where',
      ),
    );
    expect(
      screen.getByTestId(
        'designer-logical-group-icon-inventorySummaryByGroup-where-OR',
      ),
    ).toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId(
        'designer-nested-expand-btn-inventorySummaryByGroup-where-OR',
      ),
    );
    fireEvent.click(
      screen.getByTestId(
        'designer-nested-list-add-inventorySummaryByGroup-where-OR',
      ),
    );
    expect(
      screen.getByTestId(
        'designer-nested-list-item-inventorySummaryByGroup-where-OR-1',
      ),
    ).toBeInTheDocument();
  });
});
