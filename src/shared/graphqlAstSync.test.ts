import { describe, it, expect } from 'vitest';
import { loadSchemaFromSdl } from './graphqlSchemaLoader';
import {
  extractSelectionStateFromAst,
  prettifyGraphQLQuery,
  setFieldArgument,
  setNestedArgumentValue,
  toggleFieldSelection,
  toggleInlineFragment,
  toggleVariableBinding,
  toInlineFragmentSegment,
} from './graphqlAstSync';

const TEST_SDL = `
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
    NAME
    UNIT_PRICE
    AVAILABLE_QUANTITY
  }

  input IntComparisonFilter {
    eq: Int
    gt: Int
    gte: Int
    lt: Int
    lte: Int
  }

  input StringComparisonFilter {
    eq: String
    contains: String
    startsWith: String
  }

  input InventoryWhereInput {
    sku: StringComparisonFilter
    name: StringComparisonFilter
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

  interface CatalogNode {
    id: ID!
    updatedAt: String!
  }

  type Warehouse implements CatalogNode {
    id: ID!
    name: String!
    region: String!
    updatedAt: String!
  }

  type InventoryItem implements CatalogNode {
    id: ID!
    sku: ID!
    name: String!
    category: ProductCategory!
    availableQuantity: Int!
    inStock: Boolean!
    warehouse: Warehouse
    updatedAt: String!
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
  }

  type Mutation {
    adjustInventoryStock(input: AdjustStockInput!): InventoryItem!
  }
`;

const { metadata } = loadSchemaFromSdl(TEST_SDL);

describe('graphqlAstSync — two-way Query Designer <-> Monaco AST synchronization', () => {
  it('checks an object field on an empty document and auto-selects its primary scalar field (`id`)', () => {
    const query = toggleFieldSelection({
      queryText: '',
      fieldPath: ['inventoryItem'],
      checked: true,
      metadata,
      operationType: 'query',
      operationName: 'GetWarehouseStock',
    });

    expect(query).toContain('query GetWarehouseStock');
    expect(query).toContain('inventoryItem {');
    expect(query).toContain('id');

    const extracted = extractSelectionStateFromAst(query);
    expect(extracted.valid).toBe(true);
    expect(extracted.operationName).toBe('GetWarehouseStock');
    expect(extracted.selectedFieldPaths).toEqual([
      'inventoryItem',
      'inventoryItem.id',
    ]);
  });

  it('checks nested fields (`inventoryItem.warehouse.region`) and unchecks/prunes empty ancestors cleanly', () => {
    let query = toggleFieldSelection({
      queryText: '',
      fieldPath: ['inventoryItem', 'sku'],
      checked: true,
      metadata,
    });
    query = toggleFieldSelection({
      queryText: query,
      fieldPath: ['inventoryItem', 'warehouse', 'region'],
      checked: true,
      metadata,
    });

    expect(query).toContain('sku');
    expect(query).toContain('warehouse {');
    expect(query).toContain('region');

    // Uncheck `region` -> `warehouse` has no remaining child selections so `warehouse` is pruned
    query = toggleFieldSelection({
      queryText: query,
      fieldPath: ['inventoryItem', 'warehouse', 'region'],
      checked: false,
      metadata,
    });
    expect(query).not.toContain('warehouse');
    expect(query).toContain('sku');

    // Uncheck `sku` -> `inventoryItem` has no remaining selections so document empties
    query = toggleFieldSelection({
      queryText: query,
      fieldPath: ['inventoryItem', 'sku'],
      checked: false,
      metadata,
    });
    expect(query).toBe('');
  });

  it('sets literal field arguments (String, Int, Enum) and promotes/demotes `$variable` bindings with Variables JSON', () => {
    let query = setFieldArgument({
      queryText: '',
      fieldPath: ['inventoryItems'],
      argName: 'category',
      value: 'ELECTRONICS',
      metadata,
    });
    query = setFieldArgument({
      queryText: query,
      fieldPath: ['inventoryItems'],
      argName: 'limit',
      value: '50',
      metadata,
    });

    expect(query).toContain('inventoryItems(category: ELECTRONICS, limit: 50)');

    // Promote `category` to `$category: ProductCategory`
    const promoted = toggleVariableBinding({
      queryText: query,
      variablesJson: '{}',
      fieldPath: ['inventoryItems'],
      argName: 'category',
      enabled: true,
      metadata,
    });

    expect(promoted.queryText).toContain(
      'query NewQuery($category: ProductCategory)',
    );
    expect(promoted.queryText).toContain('category: $category');
    expect(JSON.parse(promoted.variablesJson)).toEqual({
      category: 'ELECTRONICS',
    });

    // Extract AST state and verify variable binding is reported
    const state = extractSelectionStateFromAst(promoted.queryText);
    expect(state.fieldArguments.inventoryItems.category).toEqual({
      value: '$category',
      isVariable: true,
      variableName: 'category',
    });
    expect(state.fieldArguments.inventoryItems.limit).toEqual({
      value: '50',
      isVariable: false,
    });

    // Demote `$category` back to literal value from variablesJson
    const demoted = toggleVariableBinding({
      queryText: promoted.queryText,
      variablesJson: promoted.variablesJson,
      fieldPath: ['inventoryItems'],
      argName: 'category',
      enabled: false,
      metadata,
    });
    expect(demoted.queryText).not.toContain('$category');
    expect(demoted.queryText).toContain('category: ELECTRONICS');
  });

  it('supports Union & Interface inline fragments (`... on InventoryItem`) in both directions', () => {
    let query = toggleInlineFragment({
      queryText: '',
      parentFieldPath: ['searchCatalog'],
      typeName: 'InventoryItem',
      checked: true,
      metadata,
    });

    expect(query).toContain('searchCatalog {');
    expect(query).toContain('... on InventoryItem {');
    expect(query).toContain('id');

    // Add another field inside the inline fragment
    query = toggleFieldSelection({
      queryText: query,
      fieldPath: [
        'searchCatalog',
        toInlineFragmentSegment('InventoryItem'),
        'sku',
      ],
      checked: true,
      metadata,
    });
    expect(query).toContain('sku');

    const extracted = extractSelectionStateFromAst(query);
    expect(extracted.inlineFragmentPaths).toContain(
      'searchCatalog.... on InventoryItem',
    );
    expect(extracted.selectedFieldPaths).toContain(
      'searchCatalog.... on InventoryItem.sku',
    );

    // Unchecking the inline fragment removes it
    query = toggleInlineFragment({
      queryText: query,
      parentFieldPath: ['searchCatalog'],
      typeName: 'InventoryItem',
      checked: false,
      metadata,
    });
    expect(query).toBe('');
  });

  it('preserves leading comments, field aliases, and directives (`@include`, `@skip`), and retains previous state on syntax errors', () => {
    const initial = `# Warehouse inventory query\nquery GetStock($includeWh: Boolean!) {\n  itemAlias: inventoryItem(sku: "SKU-100") {\n    sku\n    warehouse @include(if: $includeWh) {\n      name\n    }\n  }\n}\n`;

    const updated = toggleFieldSelection({
      queryText: initial,
      fieldPath: ['inventoryItem', 'availableQuantity'],
      checked: true,
      metadata,
      operationName: 'GetStock',
    });

    expect(updated).toContain('# Warehouse inventory query');
    expect(updated).toContain('itemAlias: inventoryItem(sku: "SKU-100")');
    expect(updated).toContain('warehouse @include(if: $includeWh)');
    expect(updated).toContain('availableQuantity');

    const validState = extractSelectionStateFromAst(updated);
    expect(validState.valid).toBe(true);

    // Simulate user mid-keystroke with an unclosed brace
    const brokenText = `${updated}\n  broken {`;
    const fallbackState = extractSelectionStateFromAst(brokenText, {
      previousState: validState,
    });
    expect(fallbackState.valid).toBe(false);
    expect(fallbackState.syntaxError?.message).toBeTruthy();
    // Retains previous selected field paths!
    expect(fallbackState.selectedFieldPaths).toEqual(validState.selectedFieldPaths);

    // Prettify formats cleanly
    expect(prettifyGraphQLQuery(updated)).toContain('availableQuantity');
  });

  it('builds and extracts nested `where` filter input objects and `orderBy` sort lists via setNestedArgumentValue', () => {
    let query = setNestedArgumentValue({
      queryText: '',
      fieldPath: ['inventoryItems'],
      argName: 'where',
      nestedPath: ['availableQuantity', 'gte'],
      value: '10',
      metadata,
    });
    query = setNestedArgumentValue({
      queryText: query,
      fieldPath: ['inventoryItems'],
      argName: 'where',
      nestedPath: ['category'],
      value: 'ELECTRONICS',
      metadata,
    });
    query = setNestedArgumentValue({
      queryText: query,
      fieldPath: ['inventoryItems'],
      argName: 'orderBy',
      nestedPath: [0, 'field'],
      value: 'UNIT_PRICE',
      metadata,
    });
    query = setNestedArgumentValue({
      queryText: query,
      fieldPath: ['inventoryItems'],
      argName: 'orderBy',
      nestedPath: [0, 'direction'],
      value: 'DESC',
      metadata,
    });

    expect(query).toContain(
      'where: {availableQuantity: {gte: 10}, category: ELECTRONICS}',
    );
    expect(query).toContain('orderBy: [{field: UNIT_PRICE, direction: DESC}]');

    const extracted = extractSelectionStateFromAst(query);
    expect(extracted.fieldArguments.inventoryItems.where.nestedValues).toEqual({
      'availableQuantity.gte': '10',
      category: 'ELECTRONICS',
    });
    expect(extracted.fieldArguments.inventoryItems.orderBy.nestedValues).toEqual({
      '0.field': 'UNIT_PRICE',
      '0.direction': 'DESC',
    });

    // Clearing a nested filter operator prunes its parent object when empty
    query = setNestedArgumentValue({
      queryText: query,
      fieldPath: ['inventoryItems'],
      argName: 'where',
      nestedPath: ['availableQuantity', 'gte'],
      value: '',
      metadata,
    });
    query = setNestedArgumentValue({
      queryText: query,
      fieldPath: ['inventoryItems'],
      argName: 'where',
      nestedPath: ['category'],
      value: '',
      metadata,
    });
    expect(query).not.toContain('where:');
  });
});
