import { describe, it, expect } from 'vitest';
import { introspectionFromSchema, buildSchema } from 'graphql';
import {
  diffSchemaMetadata,
  extractSchemaMetadata,
  generateStarterOperationForField,
  loadGraphQLSchemaAuto,
  loadSchemaFromIntrospection,
  loadSchemaFromSdl,
  unwrapIntrospectionPayload,
} from './graphqlSchemaLoader';

const SAMPLE_SDL = `
  """Product category in the warehouse catalog"""
  enum ProductCategory {
    ELECTRONICS
    ACCESSORIES
    LEGACY_CAT @deprecated(reason: "Merged into ACCESSORIES")
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
    warehouse: Warehouse
    availableQuantity: Int!
    inStock: Boolean!
    updatedAt: String!
    legacyCode: String @deprecated(reason: "Use sku instead")
  }

  union SearchResult = InventoryItem | Warehouse

  input AdjustStockInput {
    sku: ID!
    deltaAvailable: Int!
    reason: String = "manual"
  }

  type Query {
    inventoryItem(sku: ID!, warehouseId: ID): InventoryItem
    inventoryItems(category: ProductCategory, limit: Int = 20): [InventoryItem!]!
    searchCatalog(text: String!): [SearchResult!]!
  }

  type Mutation {
    adjustInventoryStock(input: AdjustStockInput!): InventoryItem!
  }
`;

describe('graphqlSchemaLoader', () => {
  it('loads schema from SDL and extracts normalized root types, fields, args, interfaces, unions, enums, and @deprecated markers', () => {
    const bundle = loadSchemaFromSdl(SAMPLE_SDL);
    expect(bundle.sourceFormat).toBe('sdl');

    const { metadata } = bundle;
    expect(metadata.queryTypeName).toBe('Query');
    expect(metadata.mutationTypeName).toBe('Mutation');
    expect(metadata.subscriptionTypeName).toBeNull();
    expect(metadata.typeCount).toBeGreaterThanOrEqual(7);

    // Check Query fields & arguments
    const queryType = metadata.types.Query;
    expect(queryType.kind).toBe('OBJECT');
    const itemField = queryType.fields?.find(f => f.name === 'inventoryItem');
    expect(itemField).toBeDefined();
    expect(itemField?.namedType).toBe('InventoryItem');
    expect(itemField?.isNonNull).toBe(false);
    expect(itemField?.args).toHaveLength(2);
    expect(itemField?.args[0]).toMatchObject({
      name: 'sku',
      typeSignature: 'ID!',
      namedType: 'ID',
      isNonNull: true,
      isList: false,
    });

    const listField = queryType.fields?.find(f => f.name === 'inventoryItems');
    expect(listField?.isList).toBe(true);
    expect(listField?.isNonNull).toBe(true);
    const limitArg = listField?.args.find(a => a.name === 'limit');
    expect(limitArg?.defaultValue).toBe('20');

    // Check @deprecated field on InventoryItem
    const invType = metadata.types.InventoryItem;
    expect(invType.interfaces).toEqual(['CatalogNode']);
    const legacyField = invType.fields?.find(f => f.name === 'legacyCode');
    expect(legacyField?.isDeprecated).toBe(true);
    expect(legacyField?.deprecationReason).toBe('Use sku instead');

    // Check Interface possibleTypes
    const nodeInterface = metadata.types.CatalogNode;
    expect(nodeInterface.kind).toBe('INTERFACE');
    expect(nodeInterface.possibleTypes).toEqual(
      expect.arrayContaining(['Warehouse', 'InventoryItem']),
    );

    // Check Union possibleTypes
    const unionType = metadata.types.SearchResult;
    expect(unionType.kind).toBe('UNION');
    expect(unionType.possibleTypes).toEqual(['InventoryItem', 'Warehouse']);

    // Check Enum & deprecated enum value
    const enumType = metadata.types.ProductCategory;
    expect(enumType.kind).toBe('ENUM');
    expect(enumType.enumValues?.find(v => v.name === 'LEGACY_CAT')).toMatchObject({
      isDeprecated: true,
      deprecationReason: 'Merged into ACCESSORIES',
    });

    // Check Input Object
    const inputType = metadata.types.AdjustStockInput;
    expect(inputType.kind).toBe('INPUT_OBJECT');
    expect(inputType.inputFields?.map(f => f.name)).toEqual([
      'sku',
      'deltaAvailable',
      'reason',
    ]);
  });

  it('loads schema from IntrospectionQuery JSON (both direct and wrapped in { data: { __schema } })', () => {
    const rawSchema = buildSchema(SAMPLE_SDL);
    const introspection = introspectionFromSchema(rawSchema);

    const directLoaded = loadSchemaFromIntrospection(introspection);
    expect(directLoaded.sourceFormat).toBe('introspection_json');
    expect(directLoaded.metadata.queryTypeName).toBe('Query');

    const wrappedJson = JSON.stringify({ data: introspection });
    const wrappedLoaded = loadGraphQLSchemaAuto(wrappedJson, 'schema.json');
    expect(wrappedLoaded.sourceFormat).toBe('introspection_json');
    expect(wrappedLoaded.metadata.types.InventoryItem.fields?.length).toBeGreaterThan(0);
  });

  it('throws descriptive errors on empty SDL or malformed introspection payloads', () => {
    expect(() => loadSchemaFromSdl('   ')).toThrow(/cannot be empty/i);
    expect(() => unwrapIntrospectionPayload(null)).toThrow(/expected an object/i);
    expect(() => unwrapIntrospectionPayload({ hello: 'world' })).toThrow(
      /missing "__schema"/i,
    );
  });

  it('computes schema diffs accurately between two schema snapshots', () => {
    const first = loadSchemaFromSdl(SAMPLE_SDL).metadata;
    const noChangeDiff = diffSchemaMetadata(first, first);
    expect(noChangeDiff.hasChanges).toBe(false);
    expect(noChangeDiff.summaryText).toBe('No schema changes detected');

    const updatedSdl = `${SAMPLE_SDL}\n  type Supplier { id: ID! name: String! }\n`;
    const second = loadSchemaFromSdl(updatedSdl).metadata;
    const diff = diffSchemaMetadata(first, second);
    expect(diff.hasChanges).toBe(true);
    expect(diff.addedTypes).toEqual(['Supplier']);
    expect(diff.summaryText).toContain('+1 type(s)');
  });

  it('generates valid starter Query and Mutation operations with sample variables JSON', () => {
    const { metadata } = loadSchemaFromSdl(SAMPLE_SDL);

    const starterQuery = generateStarterOperationForField(
      metadata,
      'query',
      'inventoryItem',
    );
    expect(starterQuery.operationName).toBe('GetInventoryItem');
    expect(starterQuery.query).toContain(
      'query GetInventoryItem($sku: ID!, $warehouseId: ID)',
    );
    expect(starterQuery.query).toContain('inventoryItem(sku: $sku, warehouseId: $warehouseId)');
    expect(starterQuery.query).toContain('sku');
    expect(JSON.parse(starterQuery.variablesJson)).toEqual({
      sku: '',
      warehouseId: '',
    });

    const starterMutation = generateStarterOperationForField(
      metadata,
      'mutation',
      'adjustInventoryStock',
    );
    expect(starterMutation.operationName).toBe('AdjustInventoryStockMutation');
    expect(starterMutation.query).toContain(
      'mutation AdjustInventoryStockMutation($input: AdjustStockInput!)',
    );
    expect(JSON.parse(starterMutation.variablesJson)).toEqual({
      input: {
        sku: '',
        deltaAvailable: 0,
        reason: 'manual',
      },
    });
  });
});
