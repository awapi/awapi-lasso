import * as crypto from 'crypto';
import * as http from 'http';
import * as zlib from 'zlib';
import {
  buildSchema,
  graphql,
  type GraphQLSchema,
} from 'graphql';

// ---------------------------------------------------------------------------
// Data Models & Seeded Mock Data
// ---------------------------------------------------------------------------

export interface OrderLineItem {
  sku: string;
  name?: string;
  quantity: number;
  unitPrice: number;
}

export interface OrderAttachment {
  id: string;
  orderId: string;
  documentType: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface OrderRecord {
  id: string;
  customerId: string;
  status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled';
  currency: string;
  totalAmount: number;
  notes?: string;
  requestedAt: string;
  updatedAt: string;
  items: OrderLineItem[];
  attachments: OrderAttachment[];
}

export interface InventoryItemRecord {
  sku: string;
  name: string;
  category: 'ELECTRONICS' | 'ACCESSORIES' | 'HARDWARE' | 'SOFTWARE';
  warehouseId: string;
  availableQuantity: number;
  reservedQuantity: number;
  unitPrice: number;
  inStock: boolean;
  tags: string[];
  updatedAt: string;
}

export interface WarehouseRecord {
  id: string;
  name: string;
  region: string;
  capacity: number;
  active: boolean;
}

export interface SampleApiStore {
  orders: Map<string, OrderRecord>;
  inventory: Map<string, InventoryItemRecord>;
  warehouses: Map<string, WarehouseRecord>;
  nextOrderSeq: number;
  nextAttachmentSeq: number;
  digestNonces: Set<string>;
}

export const SAMPLE_GRAPHQL_SDL = `
  """Product category in the warehouse catalog"""
  enum ProductCategory {
    ELECTRONICS
    ACCESSORIES
    HARDWARE
    SOFTWARE
  }

  """Order lifecycle status"""
  enum OrderStatus {
    PENDING
    PROCESSING
    SHIPPED
    DELIVERED
    CANCELLED
  }

  """Common interface for all catalog & warehouse entities"""
  interface CatalogNode {
    id: ID!
    updatedAt: String!
  }

  """Physical fulfillment warehouse"""
  type Warehouse implements CatalogNode {
    id: ID!
    name: String!
    region: String!
    capacity: Int!
    active: Boolean!
    items: [InventoryItem!]!
    updatedAt: String!
  }

  """Tracked SKU stock item inside a warehouse"""
  type InventoryItem implements CatalogNode {
    id: ID!
    sku: ID!
    name: String!
    category: ProductCategory!
    warehouseId: ID!
    warehouse: Warehouse
    availableQuantity: Int!
    reservedQuantity: Int!
    unitPrice: Float!
    inStock: Boolean!
    tags: [String!]!
    updatedAt: String!
    legacyCode: String @deprecated(reason: "Use sku instead")
  }

  """Line item inside a customer order"""
  type OrderItemGql {
    sku: ID!
    name: String
    quantity: Int!
    unitPrice: Float!
  }

  """Customer order exposed via GraphQL"""
  type OrderGql implements CatalogNode {
    id: ID!
    customerId: String!
    status: String!
    currency: String!
    totalAmount: Float!
    notes: String
    requestedAt: String!
    updatedAt: String!
    items: [OrderItemGql!]!
  }

  """Union result returned by global catalog search"""
  union SearchResult = InventoryItem | Warehouse | OrderGql

  """Sort direction for orderBy clauses"""
  enum SortDirection {
    ASC
    DESC
  }

  """Sortable fields on InventoryItem"""
  enum InventorySortField {
    SKU
    NAME
    CATEGORY
    AVAILABLE_QUANTITY
    UNIT_PRICE
    UPDATED_AT
  }

  """Sortable fields on OrderGql"""
  enum OrderSortField {
    ID
    CUSTOMER_ID
    STATUS
    TOTAL_AMOUNT
    REQUESTED_AT
    UPDATED_AT
  }

  """String comparison filter operators"""
  input StringComparisonFilter {
    eq: String
    contains: String
    startsWith: String
  }

  """Integer comparison filter operators"""
  input IntComparisonFilter {
    eq: Int
    gt: Int
    gte: Int
    lt: Int
    lte: Int
  }

  """Float comparison filter operators"""
  input FloatComparisonFilter {
    eq: Float
    gt: Float
    gte: Float
    lt: Float
    lte: Float
  }

  """Structured where filter for inventory items"""
  input InventoryWhereInput {
    sku: StringComparisonFilter
    name: StringComparisonFilter
    warehouseId: ID
    category: ProductCategory
    inStock: Boolean
    availableQuantity: IntComparisonFilter
    unitPrice: FloatComparisonFilter
    AND: [InventoryWhereInput!]
    OR: [InventoryWhereInput!]
  }

  """OrderBy clause for inventory items"""
  input InventoryOrderByInput {
    field: InventorySortField!
    direction: SortDirection! = ASC
  }

  """Structured where filter for customer orders"""
  input OrderWhereInput {
    id: StringComparisonFilter
    customerId: StringComparisonFilter
    status: String
    currency: String
    totalAmount: FloatComparisonFilter
    AND: [OrderWhereInput!]
    OR: [OrderWhereInput!]
  }

  """OrderBy clause for customer orders"""
  input OrderOrderByInput {
    field: OrderSortField!
    direction: SortDirection! = ASC
  }

  """Groupable dimensions on InventoryItem"""
  enum InventoryGroupField {
    CATEGORY
    WAREHOUSE_ID
    IN_STOCK
  }

  """Groupable dimensions on OrderGql"""
  enum OrderGroupField {
    STATUS
    CURRENCY
    CUSTOMER_ID
  }

  """Aggregated metrics for a grouped inventory bucket"""
  type InventoryGroupSummary {
    groupKey: String!
    category: ProductCategory
    warehouseId: ID
    inStock: Boolean
    count: Int!
    totalAvailableQuantity: Int!
    totalReservedQuantity: Int!
    avgUnitPrice: Float!
    minUnitPrice: Float!
    maxUnitPrice: Float!
    items: [InventoryItem!]!
  }

  """Aggregated metrics for a grouped customer order bucket"""
  type OrderGroupSummary {
    groupKey: String!
    status: String
    currency: String
    customerId: String
    count: Int!
    totalAmountSum: Float!
    avgTotalAmount: Float!
    orders: [OrderGql!]!
  }

  """Input payload for adjusting SKU inventory stock"""
  input AdjustStockInput {
    sku: ID!
    warehouseId: ID
    deltaAvailable: Int!
    deltaReserved: Int
  }

  """Input payload for creating a new SKU in the catalog"""
  input CreateInventoryItemInput {
    sku: ID!
    name: String!
    category: ProductCategory!
    warehouseId: ID!
    availableQuantity: Int!
    reservedQuantity: Int
    unitPrice: Float!
    tags: [String!]
  }

  type Query {
    """Look up a single inventory item by SKU and optional warehouse ID"""
    inventoryItem(sku: ID!, warehouseId: ID): InventoryItem

    """List inventory items with optional filtering (where), sorting (orderBy), warehouse, category, or stock status"""
    inventoryItems(
      warehouseId: ID
      category: ProductCategory
      inStockOnly: Boolean
      where: InventoryWhereInput
      orderBy: [InventoryOrderByInput!]
      limit: Int = 20
    ): [InventoryItem!]!

    """List all fulfillment warehouses"""
    warehouses(activeOnly: Boolean): [Warehouse!]!

    """Get a single warehouse by ID"""
    warehouse(id: ID!): Warehouse

    """List customer orders from GraphQL with optional where filter and orderBy sorting"""
    orders(
      status: String
      where: OrderWhereInput
      orderBy: [OrderOrderByInput!]
      limit: Int = 25
    ): [OrderGql!]!

    """Get a customer order by ID"""
    order(id: ID!): OrderGql

    """Search across inventory items, warehouses, and orders"""
    searchCatalog(text: String!): [SearchResult!]!

    """Group inventory items by category, warehouseId, or inStock with aggregated counts, sums, and averages"""
    inventorySummaryByGroup(
      groupBy: [InventoryGroupField!]!
      where: InventoryWhereInput
    ): [InventoryGroupSummary!]!

    """Group customer orders by status, currency, or customerId with aggregated counts and revenue totals"""
    ordersSummaryByGroup(
      groupBy: [OrderGroupField!]!
      where: OrderWhereInput
    ): [OrderGroupSummary!]!
  }

  type Mutation {
    """Adjust available or reserved stock for a SKU"""
    adjustInventoryStock(input: AdjustStockInput!): InventoryItem!

    """Create a new inventory item in a warehouse"""
    createInventoryItem(input: CreateInventoryItemInput!): InventoryItem!

    """Update the status of an existing order"""
    updateOrderStatus(id: ID!, status: String!): OrderGql
  }
`;

export function createInitialStore(): SampleApiStore {
  const warehouses = new Map<string, WarehouseRecord>([
    [
      'WH-EAST-01',
      {
        id: 'WH-EAST-01',
        name: 'East Coast Fulfillment Center',
        region: 'us-east-1',
        capacity: 50000,
        active: true,
      },
    ],
    [
      'WH-WEST-02',
      {
        id: 'WH-WEST-02',
        name: 'West Coast Logistics Hub',
        region: 'us-west-2',
        capacity: 35000,
        active: true,
      },
    ],
    [
      'WH-EU-01',
      {
        id: 'WH-EU-01',
        name: 'Frankfurt Central Depot',
        region: 'eu-central-1',
        capacity: 25000,
        active: false,
      },
    ],
  ]);

  const inventory = new Map<string, InventoryItemRecord>([
    [
      'SKU-100',
      {
        sku: 'SKU-100',
        name: 'Mechanical Wireless Keyboard Pro',
        category: 'ELECTRONICS',
        warehouseId: 'WH-EAST-01',
        availableQuantity: 140,
        reservedQuantity: 12,
        unitPrice: 129.99,
        inStock: true,
        tags: ['peripherals', 'wireless', 'featured'],
        updatedAt: '2026-10-24T12:00:00Z',
      },
    ],
    [
      'SKU-200',
      {
        sku: 'SKU-200',
        name: 'UltraWide 34" USB-C Monitor',
        category: 'ELECTRONICS',
        warehouseId: 'WH-EAST-01',
        availableQuantity: 38,
        reservedQuantity: 4,
        unitPrice: 549.0,
        inStock: true,
        tags: ['display', 'usb-c', '4k'],
        updatedAt: '2026-10-24T12:15:00Z',
      },
    ],
    [
      'SKU-300',
      {
        sku: 'SKU-300',
        name: 'Thunderbolt 4 Docking Station',
        category: 'ACCESSORIES',
        warehouseId: 'WH-WEST-02',
        availableQuantity: 0,
        reservedQuantity: 5,
        unitPrice: 219.5,
        inStock: false,
        tags: ['dock', 'thunderbolt'],
        updatedAt: '2026-10-24T13:00:00Z',
      },
    ],
    [
      'SKU-400',
      {
        sku: 'SKU-400',
        name: 'AwapiLasso Enterprise Team License',
        category: 'SOFTWARE',
        warehouseId: 'WH-EAST-01',
        availableQuantity: 999,
        reservedQuantity: 0,
        unitPrice: 49.0,
        inStock: true,
        tags: ['license', 'devtools'],
        updatedAt: '2026-10-24T14:00:00Z',
      },
    ],
  ]);

  const orders = new Map<string, OrderRecord>([
    [
      'ord_1001',
      {
        id: 'ord_1001',
        customerId: 'cust_901',
        status: 'pending',
        currency: 'USD',
        totalAmount: 259.98,
        notes: 'Deliver to loading dock B',
        requestedAt: '2026-10-24T10:00:00Z',
        updatedAt: '2026-10-24T10:05:00Z',
        items: [
          {
            sku: 'SKU-100',
            name: 'Mechanical Wireless Keyboard Pro',
            quantity: 2,
            unitPrice: 129.99,
          },
        ],
        attachments: [],
      },
    ],
    [
      'ord_1002',
      {
        id: 'ord_1002',
        customerId: 'cust_902',
        status: 'shipped',
        currency: 'USD',
        totalAmount: 549.0,
        notes: 'Priority overnight courier',
        requestedAt: '2026-10-23T09:30:00Z',
        updatedAt: '2026-10-24T08:15:00Z',
        items: [
          {
            sku: 'SKU-200',
            name: 'UltraWide 34" USB-C Monitor',
            quantity: 1,
            unitPrice: 549.0,
          },
        ],
        attachments: [],
      },
    ],
    [
      'ord_1003',
      {
        id: 'ord_1003',
        customerId: 'cust_903',
        status: 'processing',
        currency: 'EUR',
        totalAmount: 219.5,
        requestedAt: '2026-10-24T11:20:00Z',
        updatedAt: '2026-10-24T11:45:00Z',
        items: [
          {
            sku: 'SKU-300',
            name: 'Thunderbolt 4 Docking Station',
            quantity: 1,
            unitPrice: 219.5,
          },
        ],
        attachments: [],
      },
    ],
  ]);

  return {
    orders,
    inventory,
    warehouses,
    nextOrderSeq: 1004,
    nextAttachmentSeq: 1,
    digestNonces: new Set<string>(),
  };
}

// ---------------------------------------------------------------------------
// Helpers: JWT, Multipart Parser, and GraphQL Resolver Map
// ---------------------------------------------------------------------------

export function createMockJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'sample-api-key-1' }),
    'utf-8',
  )
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  const payload = Buffer.from(JSON.stringify(claims), 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  const signature = crypto
    .createHmac('sha256', 'awapi-lasso-sample-secret')
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
  return `${header}.${payload}.${signature}`;
}

interface ParsedMultipartPart {
  name: string;
  filename?: string;
  contentType: string;
  data: Buffer;
}

function parseMultipartForm(bodyBuffer: Buffer, contentTypeHeader: string): ParsedMultipartPart[] {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentTypeHeader);
  if (!match) return [];
  const boundary = (match[1] || match[2] || '').trim();
  if (!boundary) return [];

  const rawText = bodyBuffer.toString('latin1');
  const delimiter = `--${boundary}`;
  const rawParts = rawText.split(delimiter).slice(1);
  const parts: ParsedMultipartPart[] = [];

  for (const part of rawParts) {
    if (part.startsWith('--')) break;
    const trimmedStart = part.startsWith('\r\n') ? part.slice(2) : part;
    const headerEndIdx = trimmedStart.indexOf('\r\n\r\n');
    if (headerEndIdx === -1) continue;

    const headerSection = trimmedStart.slice(0, headerEndIdx);
    let contentSection = trimmedStart.slice(headerEndIdx + 4);
    if (contentSection.endsWith('\r\n')) {
      contentSection = contentSection.slice(0, -2);
    }

    const nameMatch = /name="([^"]+)"/i.exec(headerSection);
    if (!nameMatch) continue;
    const filenameMatch = /filename="([^"]+)"/i.exec(headerSection);
    const ctMatch = /Content-Type:\s*([^\r\n]+)/i.exec(headerSection);

    parts.push({
      name: nameMatch[1],
      filename: filenameMatch?.[1],
      contentType: ctMatch?.[1]?.trim() || 'text/plain',
      data: Buffer.from(contentSection, 'latin1'),
    });
  }

  return parts;
}

function matchesStringFilter(val: string, filter: Record<string, unknown>): boolean {
  const lowerVal = val.toLowerCase();
  if (typeof filter.eq === 'string' && val !== filter.eq) return false;
  if (
    typeof filter.contains === 'string' &&
    !lowerVal.includes(filter.contains.toLowerCase())
  ) {
    return false;
  }
  if (
    typeof filter.startsWith === 'string' &&
    !lowerVal.startsWith(filter.startsWith.toLowerCase())
  ) {
    return false;
  }
  return true;
}

function matchesNumberFilter(val: number, filter: Record<string, unknown>): boolean {
  if (typeof filter.eq === 'number' && val !== filter.eq) return false;
  if (typeof filter.gt === 'number' && !(val > filter.gt)) return false;
  if (typeof filter.gte === 'number' && !(val >= filter.gte)) return false;
  if (typeof filter.lt === 'number' && !(val < filter.lt)) return false;
  if (typeof filter.lte === 'number' && !(val <= filter.lte)) return false;
  return true;
}

function matchesInventoryWhere(
  item: InventoryItemRecord,
  where: Record<string, unknown>,
): boolean {
  if (where.sku && typeof where.sku === 'object') {
    if (!matchesStringFilter(item.sku, where.sku as Record<string, unknown>)) return false;
  }
  if (where.name && typeof where.name === 'object') {
    if (!matchesStringFilter(item.name, where.name as Record<string, unknown>)) return false;
  }
  if (typeof where.warehouseId === 'string' && item.warehouseId !== where.warehouseId) {
    return false;
  }
  if (typeof where.category === 'string' && item.category !== where.category) {
    return false;
  }
  if (typeof where.inStock === 'boolean' && item.inStock !== where.inStock) {
    return false;
  }
  if (where.availableQuantity && typeof where.availableQuantity === 'object') {
    if (
      !matchesNumberFilter(
        item.availableQuantity,
        where.availableQuantity as Record<string, unknown>,
      )
    ) {
      return false;
    }
  }
  if (where.unitPrice && typeof where.unitPrice === 'object') {
    if (!matchesNumberFilter(item.unitPrice, where.unitPrice as Record<string, unknown>)) {
      return false;
    }
  }
  if (Array.isArray(where.AND)) {
    for (const sub of where.AND as Array<Record<string, unknown>>) {
      if (!matchesInventoryWhere(item, sub)) return false;
    }
  }
  if (Array.isArray(where.OR) && where.OR.length > 0) {
    const anyMatch = (where.OR as Array<Record<string, unknown>>).some(sub =>
      matchesInventoryWhere(item, sub),
    );
    if (!anyMatch) return false;
  }
  return true;
}

function compareInventoryByOrder(
  a: InventoryItemRecord,
  b: InventoryItemRecord,
  orderBy: Array<{ field: string; direction?: 'ASC' | 'DESC' }>,
): number {
  for (const rule of orderBy) {
    const dir = rule.direction === 'DESC' ? -1 : 1;
    let cmp = 0;
    switch (rule.field) {
      case 'SKU':
        cmp = a.sku.localeCompare(b.sku);
        break;
      case 'NAME':
        cmp = a.name.localeCompare(b.name);
        break;
      case 'CATEGORY':
        cmp = a.category.localeCompare(b.category);
        break;
      case 'AVAILABLE_QUANTITY':
        cmp = a.availableQuantity - b.availableQuantity;
        break;
      case 'UNIT_PRICE':
        cmp = a.unitPrice - b.unitPrice;
        break;
      case 'UPDATED_AT':
        cmp = a.updatedAt.localeCompare(b.updatedAt);
        break;
    }
    if (cmp !== 0) return cmp * dir;
  }
  return 0;
}

function matchesOrderWhere(ord: OrderRecord, where: Record<string, unknown>): boolean {
  if (where.id && typeof where.id === 'object') {
    if (!matchesStringFilter(ord.id, where.id as Record<string, unknown>)) return false;
  }
  if (where.customerId && typeof where.customerId === 'object') {
    if (!matchesStringFilter(ord.customerId, where.customerId as Record<string, unknown>)) {
      return false;
    }
  }
  if (
    typeof where.status === 'string' &&
    ord.status.toLowerCase() !== where.status.toLowerCase()
  ) {
    return false;
  }
  if (
    typeof where.currency === 'string' &&
    ord.currency.toLowerCase() !== where.currency.toLowerCase()
  ) {
    return false;
  }
  if (where.totalAmount && typeof where.totalAmount === 'object') {
    if (
      !matchesNumberFilter(
        ord.totalAmount,
        where.totalAmount as Record<string, unknown>,
      )
    ) {
      return false;
    }
  }
  if (Array.isArray(where.AND)) {
    for (const sub of where.AND as Array<Record<string, unknown>>) {
      if (!matchesOrderWhere(ord, sub)) return false;
    }
  }
  if (Array.isArray(where.OR) && where.OR.length > 0) {
    const anyMatch = (where.OR as Array<Record<string, unknown>>).some(sub =>
      matchesOrderWhere(ord, sub),
    );
    if (!anyMatch) return false;
  }
  return true;
}

function compareOrderByOrder(
  a: OrderRecord,
  b: OrderRecord,
  orderBy: Array<{ field: string; direction?: 'ASC' | 'DESC' }>,
): number {
  for (const rule of orderBy) {
    const dir = rule.direction === 'DESC' ? -1 : 1;
    let cmp = 0;
    switch (rule.field) {
      case 'ID':
        cmp = a.id.localeCompare(b.id);
        break;
      case 'CUSTOMER_ID':
        cmp = a.customerId.localeCompare(b.customerId);
        break;
      case 'STATUS':
        cmp = a.status.localeCompare(b.status);
        break;
      case 'TOTAL_AMOUNT':
        cmp = a.totalAmount - b.totalAmount;
        break;
      case 'REQUESTED_AT':
        cmp = a.requestedAt.localeCompare(b.requestedAt);
        break;
      case 'UPDATED_AT':
        cmp = a.updatedAt.localeCompare(b.updatedAt);
        break;
    }
    if (cmp !== 0) return cmp * dir;
  }
  return 0;
}

function buildGraphQLRootValue(store: SampleApiStore, schema: GraphQLSchema) {
  // Attach __resolveType for CatalogNode interface & SearchResult union
  const catalogNodeType = schema.getType('CatalogNode');
  if (catalogNodeType && 'resolveType' in catalogNodeType) {
    catalogNodeType.resolveType = (obj: unknown) => {
      const rec = obj as Record<string, unknown>;
      if ('sku' in rec) return 'InventoryItem';
      if ('region' in rec) return 'Warehouse';
      return 'OrderGql';
    };
  }
  const searchResultType = schema.getType('SearchResult');
  if (searchResultType && 'resolveType' in searchResultType) {
    searchResultType.resolveType = (obj: unknown) => {
      const rec = obj as Record<string, unknown>;
      if ('sku' in rec) return 'InventoryItem';
      if ('region' in rec) return 'Warehouse';
      return 'OrderGql';
    };
  }

  const enrichInventoryItem = (item: InventoryItemRecord) => ({
    ...item,
    id: item.sku,
    legacyCode: `LEGACY-${item.sku}`,
    warehouse: () => {
      const wh = store.warehouses.get(item.warehouseId);
      return wh ? enrichWarehouse(wh) : null;
    },
  });

  const enrichWarehouse = (wh: WarehouseRecord) => ({
    ...wh,
    updatedAt: '2026-10-24T12:00:00Z',
    items: () =>
      Array.from(store.inventory.values())
        .filter(i => i.warehouseId === wh.id)
        .map(enrichInventoryItem),
  });

  return {
    inventoryItem: ({ sku, warehouseId }: { sku: string; warehouseId?: string }) => {
      const item = store.inventory.get(sku);
      if (!item) return null;
      if (warehouseId && item.warehouseId !== warehouseId) return null;
      return enrichInventoryItem(item);
    },

    inventoryItems: ({
      warehouseId,
      category,
      inStockOnly,
      where,
      orderBy,
      limit = 20,
    }: {
      warehouseId?: string;
      category?: string;
      inStockOnly?: boolean;
      where?: Record<string, unknown>;
      orderBy?: Array<{ field: string; direction?: 'ASC' | 'DESC' }>;
      limit?: number;
    }) => {
      let list = Array.from(store.inventory.values());
      if (warehouseId) list = list.filter(i => i.warehouseId === warehouseId);
      if (category) list = list.filter(i => i.category === category);
      if (inStockOnly) list = list.filter(i => i.inStock && i.availableQuantity > 0);
      if (where) {
        list = list.filter(item => matchesInventoryWhere(item, where));
      }
      if (Array.isArray(orderBy) && orderBy.length > 0) {
        list = [...list].sort((a, b) => compareInventoryByOrder(a, b, orderBy));
      }
      return list.slice(0, limit).map(enrichInventoryItem);
    },

    warehouses: ({ activeOnly }: { activeOnly?: boolean }) => {
      let list = Array.from(store.warehouses.values());
      if (activeOnly) list = list.filter(w => w.active);
      return list.map(enrichWarehouse);
    },

    warehouse: ({ id }: { id: string }) => {
      const wh = store.warehouses.get(id);
      return wh ? enrichWarehouse(wh) : null;
    },

    orders: ({
      status,
      where,
      orderBy,
      limit = 25,
    }: {
      status?: string;
      where?: Record<string, unknown>;
      orderBy?: Array<{ field: string; direction?: 'ASC' | 'DESC' }>;
      limit?: number;
    }) => {
      let list = Array.from(store.orders.values());
      if (status) {
        list = list.filter(o => o.status.toLowerCase() === status.toLowerCase());
      }
      if (where) {
        list = list.filter(ord => matchesOrderWhere(ord, where));
      }
      if (Array.isArray(orderBy) && orderBy.length > 0) {
        list = [...list].sort((a, b) => compareOrderByOrder(a, b, orderBy));
      }
      return list.slice(0, limit);
    },

    order: ({ id }: { id: string }) => {
      return store.orders.get(id) ?? null;
    },

    inventorySummaryByGroup: ({
      groupBy,
      where,
    }: {
      groupBy: Array<'CATEGORY' | 'WAREHOUSE_ID' | 'IN_STOCK'>;
      where?: Record<string, unknown>;
    }) => {
      let list = Array.from(store.inventory.values());
      if (where) {
        list = list.filter(item => matchesInventoryWhere(item, where));
      }

      const buckets = new Map<string, InventoryItemRecord[]>();
      for (const item of list) {
        const keyParts = groupBy.map(dim => {
          if (dim === 'CATEGORY') return item.category;
          if (dim === 'WAREHOUSE_ID') return item.warehouseId;
          return String(item.inStock);
        });
        const bucketKey = keyParts.join(' | ');
        const arr = buckets.get(bucketKey) ?? [];
        arr.push(item);
        buckets.set(bucketKey, arr);
      }

      return Array.from(buckets.entries()).map(([groupKey, items]) => {
        const first = items[0];
        const prices = items.map(i => i.unitPrice);
        const totalAvailableQuantity = items.reduce(
          (sum, i) => sum + i.availableQuantity,
          0,
        );
        const totalReservedQuantity = items.reduce(
          (sum, i) => sum + i.reservedQuantity,
          0,
        );
        const avgUnitPrice =
          prices.reduce((sum, p) => sum + p, 0) / Math.max(1, prices.length);

        return {
          groupKey,
          category: groupBy.includes('CATEGORY') ? first?.category ?? null : null,
          warehouseId: groupBy.includes('WAREHOUSE_ID')
            ? first?.warehouseId ?? null
            : null,
          inStock: groupBy.includes('IN_STOCK') ? first?.inStock ?? null : null,
          count: items.length,
          totalAvailableQuantity,
          totalReservedQuantity,
          avgUnitPrice: Number(avgUnitPrice.toFixed(2)),
          minUnitPrice: Math.min(...prices),
          maxUnitPrice: Math.max(...prices),
          items: items.map(enrichInventoryItem),
        };
      });
    },

    ordersSummaryByGroup: ({
      groupBy,
      where,
    }: {
      groupBy: Array<'STATUS' | 'CURRENCY' | 'CUSTOMER_ID'>;
      where?: Record<string, unknown>;
    }) => {
      let list = Array.from(store.orders.values());
      if (where) {
        list = list.filter(ord => matchesOrderWhere(ord, where));
      }

      const buckets = new Map<string, OrderRecord[]>();
      for (const ord of list) {
        const keyParts = groupBy.map(dim => {
          if (dim === 'STATUS') return ord.status;
          if (dim === 'CURRENCY') return ord.currency;
          return ord.customerId;
        });
        const bucketKey = keyParts.join(' | ');
        const arr = buckets.get(bucketKey) ?? [];
        arr.push(ord);
        buckets.set(bucketKey, arr);
      }

      return Array.from(buckets.entries()).map(([groupKey, orders]) => {
        const first = orders[0];
        const totalAmountSum = orders.reduce((sum, o) => sum + o.totalAmount, 0);
        const avgTotalAmount = totalAmountSum / Math.max(1, orders.length);

        return {
          groupKey,
          status: groupBy.includes('STATUS') ? first?.status ?? null : null,
          currency: groupBy.includes('CURRENCY') ? first?.currency ?? null : null,
          customerId: groupBy.includes('CUSTOMER_ID')
            ? first?.customerId ?? null
            : null,
          count: orders.length,
          totalAmountSum: Number(totalAmountSum.toFixed(2)),
          avgTotalAmount: Number(avgTotalAmount.toFixed(2)),
          orders,
        };
      });
    },

    searchCatalog: ({ text }: { text: string }) => {
      const q = text.toLowerCase();
      const results: Array<Record<string, unknown>> = [];
      for (const item of store.inventory.values()) {
        if (
          item.sku.toLowerCase().includes(q) ||
          item.name.toLowerCase().includes(q) ||
          item.tags.some(t => t.toLowerCase().includes(q))
        ) {
          results.push(enrichInventoryItem(item));
        }
      }
      for (const wh of store.warehouses.values()) {
        if (wh.id.toLowerCase().includes(q) || wh.name.toLowerCase().includes(q)) {
          results.push(enrichWarehouse(wh));
        }
      }
      for (const ord of store.orders.values()) {
        if (ord.id.toLowerCase().includes(q) || ord.customerId.toLowerCase().includes(q)) {
          results.push({ ...ord });
        }
      }
      return results;
    },

    adjustInventoryStock: ({
      input,
    }: {
      input: {
        sku: string;
        warehouseId?: string;
        deltaAvailable: number;
        deltaReserved?: number;
      };
    }) => {
      const existing = store.inventory.get(input.sku);
      if (!existing) {
        throw new Error(`Inventory SKU "${input.sku}" not found`);
      }
      const nextAvailable = Math.max(0, existing.availableQuantity + input.deltaAvailable);
      const nextReserved = Math.max(
        0,
        existing.reservedQuantity + (input.deltaReserved ?? 0),
      );
      const updated: InventoryItemRecord = {
        ...existing,
        ...(input.warehouseId ? { warehouseId: input.warehouseId } : {}),
        availableQuantity: nextAvailable,
        reservedQuantity: nextReserved,
        inStock: nextAvailable > 0,
        updatedAt: new Date().toISOString(),
      };
      store.inventory.set(updated.sku, updated);
      return enrichInventoryItem(updated);
    },

    createInventoryItem: ({
      input,
    }: {
      input: {
        sku: string;
        name: string;
        category: InventoryItemRecord['category'];
        warehouseId: string;
        availableQuantity: number;
        reservedQuantity?: number;
        unitPrice: number;
        tags?: string[];
      };
    }) => {
      const created: InventoryItemRecord = {
        sku: input.sku,
        name: input.name,
        category: input.category,
        warehouseId: input.warehouseId,
        availableQuantity: input.availableQuantity,
        reservedQuantity: input.reservedQuantity ?? 0,
        unitPrice: input.unitPrice,
        inStock: input.availableQuantity > 0,
        tags: input.tags ?? [],
        updatedAt: new Date().toISOString(),
      };
      store.inventory.set(created.sku, created);
      return enrichInventoryItem(created);
    },

    updateOrderStatus: ({ id, status }: { id: string; status: OrderRecord['status'] }) => {
      const ord = store.orders.get(id);
      if (!ord) return null;
      const updated: OrderRecord = {
        ...ord,
        status,
        updatedAt: new Date().toISOString(),
      };
      store.orders.set(id, updated);
      return updated;
    },
  };
}

// ---------------------------------------------------------------------------
// Sample API Server Factory
// ---------------------------------------------------------------------------

export interface SampleApiServerInstance {
  server: http.Server;
  store: SampleApiStore;
  schema: GraphQLSchema;
  /** Starts listening on the given port (`0` for an ephemeral random port) and returns the base URL. */
  start: (port?: number, host?: string) => Promise<string>;
  /** Stops the HTTP server cleanly. */
  stop: () => Promise<void>;
  /** Resets all mocked orders, inventory, and warehouses back to initial seed state. */
  reset: () => void;
  /** Current base URL when running (e.g. `http://127.0.0.1:8080`). */
  readonly baseUrl: string;
}

export function createSampleApiServer(): SampleApiServerInstance {
  let store = createInitialStore();
  const schema = buildSchema(SAMPLE_GRAPHQL_SDL);
  let rootValue = buildGraphQLRootValue(store, schema);
  let currentBaseUrl = 'http://127.0.0.1:8080';

  const reset = () => {
    store = createInitialStore();
    rootValue = buildGraphQLRootValue(store, schema);
  };

  const sendJson = (
    res: http.ServerResponse,
    status: number,
    payload: unknown,
    extraHeaders: Record<string, string> = {},
  ) => {
    const body = JSON.stringify(payload, null, 2);
    res.writeHead(status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'X-Sample-Server': 'AwapiLasso-Sample-API/1.0',
      ...extraHeaders,
    });
    res.end(body);
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', chunk => chunks.push(Buffer.from(chunk)));
    req.on('end', async () => {
      const bodyBuffer = Buffer.concat(chunks);
      const bodyText = bodyBuffer.toString('utf-8');
      const method = (req.method || 'GET').toUpperCase();
      const urlObj = new URL(req.url || '/', currentBaseUrl);
      const pathname = urlObj.pathname;

      // 1. CORS / OPTIONS preflight & discovery
      if (method === 'OPTIONS') {
        res.writeHead(204, {
          Allow: 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS',
          'Access-Control-Allow-Headers': '*',
          'X-Sample-Server': 'AwapiLasso-Sample-API/1.0',
        });
        res.end();
        return;
      }

      // 2. Root & Health Check (`GET /`, `GET /health`, `GET /v1/health`, `HEAD /v1/health`)
      if (pathname === '/' || pathname === '/health' || pathname === '/v1/health') {
        const healthPayload = {
          status: 'ok',
          service: 'awapi-lasso-sample-api',
          version: '1.0.0',
          timestamp: new Date().toISOString(),
          counts: {
            orders: store.orders.size,
            inventoryItems: store.inventory.size,
            warehouses: store.warehouses.size,
          },
          endpoints: {
            restOrders: '/v1/orders',
            graphql: '/graphql',
            oauthToken: '/oauth/token',
            echo: '/v1/echo',
          },
        };
        if (method === 'HEAD') {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Health-Status': 'healthy',
            'X-Order-Count': String(store.orders.size),
          });
          res.end();
          return;
        }
        sendJson(res, 200, healthPayload, { 'X-Health-Status': 'healthy' });
        return;
      }

      // 3. Reset state (`POST /v1/reset`)
      if (pathname === '/v1/reset' && method === 'POST') {
        reset();
        sendJson(res, 200, { reset: true, ordersCount: store.orders.size });
        return;
      }

      // 4. OAuth 2.0 Token Endpoint (`POST /oauth/token`)
      if (pathname === '/oauth/token' && method === 'POST') {
        const contentType = String(req.headers['content-type'] || '');
        let params: Record<string, string> = {};
        if (contentType.includes('application/json') && bodyText.trim()) {
          try {
            params = JSON.parse(bodyText) as Record<string, string>;
          } catch {
            // ignore
          }
        } else {
          const searchParams = new URLSearchParams(bodyText);
          searchParams.forEach((v, k) => {
            params[k] = v;
          });
        }

        // Extract Basic client credentials if sent in Authorization header
        let basicClientId: string | undefined;
        const authHeader = req.headers.authorization;
        if (authHeader && authHeader.startsWith('Basic ')) {
          const decoded = Buffer.from(authHeader.slice(6).trim(), 'base64').toString('utf-8');
          const colonIdx = decoded.indexOf(':');
          basicClientId = colonIdx === -1 ? decoded : decoded.slice(0, colonIdx);
        }

        const grantType = params.grant_type || 'client_credentials';
        const clientId = basicClientId || params.client_id || 'sample-client';

        if (grantType === 'password' && params.password === 'invalid_password') {
          sendJson(res, 401, {
            error: 'invalid_grant',
            error_description: 'Invalid resource owner credentials',
          });
          return;
        }

        const scope = params.scope || 'orders:read orders:write inventory:read';
        const nowSec = Math.floor(Date.now() / 1000);
        const accessToken = createMockJwt({
          iss: currentBaseUrl,
          sub: params.username || clientId,
          aud: params.audience || `${currentBaseUrl}/v1`,
          client_id: clientId,
          grant_type: grantType,
          scp: scope.split(/\s+/).filter(Boolean),
          iat: nowSec,
          exp: nowSec + 3600,
        });

        sendJson(res, 200, {
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 3600,
          refresh_token: `sample_refresh_${grantType}_${Date.now()}`,
          scope,
        });
        return;
      }

      // 5. Auth Playground Endpoints (`/v1/auth/basic`, `/v1/auth/apikey`, `/v1/auth/digest`, `/v1/auth/bearer`)
      if (pathname === '/v1/auth/basic') {
        const auth = req.headers.authorization || '';
        if (!auth.startsWith('Basic ')) {
          sendJson(
            res,
            401,
            { error: 'Missing Basic Authorization header' },
            { 'WWW-Authenticate': 'Basic realm="AwapiLasso-Sample"' },
          );
          return;
        }
        const credentials = Buffer.from(auth.slice(6).trim(), 'base64').toString('utf-8');
        const [user] = credentials.split(':');
        sendJson(res, 200, { authenticated: true, scheme: 'basic', user });
        return;
      }

      if (pathname === '/v1/auth/apikey') {
        const headerKey = req.headers['x-api-key'];
        const queryKey = urlObj.searchParams.get('api_key');
        const apiKey = (Array.isArray(headerKey) ? headerKey[0] : headerKey) || queryKey;
        if (!apiKey) {
          sendJson(res, 401, { error: 'Missing API key in X-API-Key header or api_key query param' });
          return;
        }
        sendJson(res, 200, {
          authenticated: true,
          scheme: 'apikey',
          location: headerKey ? 'header' : 'query',
          apiKeyPreview: `${String(apiKey).slice(0, 4)}***`,
        });
        return;
      }

      if (pathname === '/v1/auth/digest') {
        const auth = req.headers.authorization || '';
        if (!auth.startsWith('Digest ')) {
          const nonce = 'sample-nonce-12345';
          store.digestNonces.add(nonce);
          sendJson(
            res,
            401,
            { error: 'Digest authentication required' },
            {
              'WWW-Authenticate': `Digest realm="awapi-sample-realm", qop="auth", nonce="${nonce}", opaque="sample-opaque-99"`,
            },
          );
          return;
        }
        sendJson(res, 200, {
          authenticated: true,
          scheme: 'digest',
          authorizationHeader: auth,
        });
        return;
      }

      if (pathname === '/v1/auth/bearer') {
        const auth = req.headers.authorization || '';
        if (!auth.startsWith('Bearer ')) {
          sendJson(res, 401, { error: 'Bearer token required' });
          return;
        }
        sendJson(res, 200, {
          authenticated: true,
          scheme: 'bearer',
          tokenPreview: `${auth.slice(7, 22)}...`,
        });
        return;
      }

      // 6. Echo, Gzip, Redirect & Cookie test endpoints
      if (pathname.startsWith('/v1/echo')) {
        let parsedJson: unknown = undefined;
        if (bodyText.trim()) {
          try {
            parsedJson = JSON.parse(bodyText);
          } catch {
            // keep undefined if not JSON
          }
        }
        res.setHeader(
          'Set-Cookie',
          'awapi_sample_sid=sess_mock_98765; Path=/; Max-Age=3600; HttpOnly; SameSite=Lax',
        );
        sendJson(res, 200, {
          method,
          path: pathname,
          query: Object.fromEntries(urlObj.searchParams.entries()),
          headers: req.headers,
          bodyText,
          bodyJson: parsedJson,
          byteLength: bodyBuffer.byteLength,
        });
        return;
      }

      if (pathname === '/v1/gzip') {
        const payload = JSON.stringify({
          compressed: true,
          encoding: 'gzip',
          items: Array.from(store.inventory.values()),
        });
        const compressed = zlib.gzipSync(Buffer.from(payload, 'utf-8'));
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Encoding': 'gzip',
        });
        res.end(compressed);
        return;
      }

      if (pathname === '/v1/redirect') {
        const hops = Number.parseInt(urlObj.searchParams.get('hops') || '1', 10);
        if (hops > 1) {
          res.writeHead(302, { Location: `${currentBaseUrl}/v1/redirect?hops=${hops - 1}` });
          res.end();
          return;
        }
        res.writeHead(302, { Location: `${currentBaseUrl}/v1/echo?redirected=true` });
        res.end();
        return;
      }

      // 7. REST Orders Collection & CRUD (`/v1/orders`, `/v1/orders/:orderId`, `/v1/orders/:orderId/attachments`)
      if (pathname === '/v1/orders') {
        if (method === 'HEAD') {
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Total-Count': String(store.orders.size),
          });
          res.end();
          return;
        }

        if (method === 'GET') {
          const statusFilter = urlObj.searchParams.get('status');
          const customerFilter = urlObj.searchParams.get('customerId');
          const limit = Number.parseInt(urlObj.searchParams.get('limit') || '25', 10);

          let list = Array.from(store.orders.values());
          if (statusFilter) {
            list = list.filter(o => o.status.toLowerCase() === statusFilter.toLowerCase());
          }
          if (customerFilter) {
            list = list.filter(o => o.customerId === customerFilter);
          }
          const sliced = list.slice(0, Number.isNaN(limit) ? 25 : limit);

          res.setHeader(
            'Set-Cookie',
            'orders_last_query=active; Path=/v1/orders; Max-Age=1800; SameSite=Lax',
          );
          sendJson(
            res,
            200,
            {
              data: sliced,
              meta: {
                total: list.length,
                limit: Number.isNaN(limit) ? 25 : limit,
              },
            },
            { 'X-Total-Count': String(list.length) },
          );
          return;
        }

        if (method === 'POST') {
          let payload: Partial<OrderRecord> = {};
          try {
            payload = bodyText.trim() ? (JSON.parse(bodyText) as Partial<OrderRecord>) : {};
          } catch {
            sendJson(res, 400, { error: 'Invalid JSON request body' });
            return;
          }

          const id = payload.id || `ord_${store.nextOrderSeq++}`;
          const now = new Date().toISOString();
          const rawItems = Array.isArray(payload.items) && payload.items.length > 0
            ? payload.items
            : [{ sku: 'SKU-100', quantity: 1, unitPrice: 129.99 }];

          const enrichedItems: OrderLineItem[] = rawItems.map(item => {
            const skuRecord = store.inventory.get(item.sku);
            const unitPrice =
              typeof item.unitPrice === 'number'
                ? item.unitPrice
                : skuRecord?.unitPrice ?? 99.0;
            return {
              sku: item.sku,
              name: item.name || skuRecord?.name || item.sku,
              quantity: item.quantity ?? 1,
              unitPrice,
            };
          });

          const computedTotal = Number(
            enrichedItems
              .reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
              .toFixed(2),
          );

          const created: OrderRecord = {
            id,
            customerId: payload.customerId || 'cust_guest',
            status: payload.status || 'pending',
            currency: payload.currency || 'USD',
            totalAmount: payload.totalAmount ?? computedTotal,
            notes: payload.notes,
            requestedAt: payload.requestedAt || now,
            updatedAt: now,
            items: enrichedItems,
            attachments: [],
          };

          store.orders.set(id, created);
          sendJson(
            res,
            201,
            { data: created },
            { Location: `${currentBaseUrl}/v1/orders/${id}` },
          );
          return;
        }
      }

      // Match `/v1/orders/:orderId/attachments`
      const attachmentMatch = /^\/v1\/orders\/([^/]+)\/attachments$/.exec(pathname);
      if (attachmentMatch) {
        const orderId = decodeURIComponent(attachmentMatch[1]);
        const order = store.orders.get(orderId);
        if (!order) {
          sendJson(res, 404, { error: `Order "${orderId}" not found` });
          return;
        }

        if (method === 'GET') {
          sendJson(res, 200, { data: order.attachments });
          return;
        }

        if (method === 'POST') {
          const ct = String(req.headers['content-type'] || '');
          let documentType = 'invoice';
          let fileName = 'attachment.bin';
          let partContentType = 'application/octet-stream';
          let sizeBytes = bodyBuffer.byteLength;

          if (ct.includes('multipart/form-data')) {
            const parts = parseMultipartForm(bodyBuffer, ct);
            for (const part of parts) {
              if (part.name === 'documentType') {
                documentType = part.data.toString('utf-8').trim() || 'invoice';
              } else if (part.filename) {
                fileName = part.filename;
                partContentType = part.contentType;
                sizeBytes = part.data.byteLength;
              }
            }
          }

          const attachment: OrderAttachment = {
            id: `att_${store.nextAttachmentSeq++}`,
            orderId,
            documentType,
            fileName,
            contentType: partContentType,
            sizeBytes,
            uploadedAt: new Date().toISOString(),
          };
          order.attachments.push(attachment);
          order.updatedAt = attachment.uploadedAt;
          sendJson(res, 201, { data: attachment });
          return;
        }
      }

      // Match `/v1/orders/:orderId`
      const orderIdMatch = /^\/v1\/orders\/([^/]+)$/.exec(pathname);
      if (orderIdMatch) {
        const orderId = decodeURIComponent(orderIdMatch[1]);
        const existing = store.orders.get(orderId);

        if (method === 'HEAD') {
          if (!existing) {
            res.writeHead(404);
            res.end();
            return;
          }
          res.writeHead(200, {
            'Content-Type': 'application/json; charset=utf-8',
            'X-Order-Status': existing.status,
          });
          res.end();
          return;
        }

        if (method === 'GET') {
          if (!existing) {
            sendJson(res, 404, { error: `Order "${orderId}" not found` });
            return;
          }
          sendJson(res, 200, { data: existing });
          return;
        }

        if (method === 'PUT') {
          let payload: Partial<OrderRecord> = {};
          try {
            payload = bodyText.trim() ? (JSON.parse(bodyText) as Partial<OrderRecord>) : {};
          } catch {
            sendJson(res, 400, { error: 'Invalid JSON request body' });
            return;
          }
          const now = new Date().toISOString();
          const rawItems = Array.isArray(payload.items)
            ? payload.items
            : existing?.items ?? [{ sku: 'SKU-100', quantity: 1, unitPrice: 129.99 }];

          const enrichedItems: OrderLineItem[] = rawItems.map(item => {
            const skuRecord = store.inventory.get(item.sku);
            const unitPrice =
              typeof item.unitPrice === 'number'
                ? item.unitPrice
                : skuRecord?.unitPrice ?? 99.0;
            return {
              sku: item.sku,
              name: item.name || skuRecord?.name || item.sku,
              quantity: item.quantity ?? 1,
              unitPrice,
            };
          });

          const computedTotal = Number(
            enrichedItems
              .reduce((sum, item) => sum + item.quantity * item.unitPrice, 0)
              .toFixed(2),
          );

          const replaced: OrderRecord = {
            id: orderId,
            customerId: payload.customerId || existing?.customerId || 'cust_901',
            status: payload.status || existing?.status || 'processing',
            currency: payload.currency || existing?.currency || 'USD',
            totalAmount: payload.totalAmount ?? computedTotal,
            notes: payload.notes !== undefined ? payload.notes : existing?.notes,
            requestedAt: existing?.requestedAt || now,
            updatedAt: now,
            items: enrichedItems,
            attachments: existing?.attachments || [],
          };
          store.orders.set(orderId, replaced);
          sendJson(res, 200, { data: replaced });
          return;
        }

        if (method === 'PATCH') {
          if (!existing) {
            sendJson(res, 404, { error: `Order "${orderId}" not found` });
            return;
          }
          let patchPayload: Partial<OrderRecord> = {};
          const ct = String(req.headers['content-type'] || '');
          if (ct.includes('application/x-www-form-urlencoded')) {
            const form = new URLSearchParams(bodyText);
            if (form.has('status')) {
              patchPayload.status = form.get('status') as OrderRecord['status'];
            }
            if (form.has('notes')) {
              patchPayload.notes = form.get('notes') ?? undefined;
            }
          } else if (bodyText.trim()) {
            try {
              patchPayload = JSON.parse(bodyText) as Partial<OrderRecord>;
            } catch {
              sendJson(res, 400, { error: 'Invalid JSON request body' });
              return;
            }
          }

          const patched: OrderRecord = {
            ...existing,
            ...(patchPayload.customerId !== undefined
              ? { customerId: patchPayload.customerId }
              : {}),
            ...(patchPayload.status !== undefined ? { status: patchPayload.status } : {}),
            ...(patchPayload.currency !== undefined
              ? { currency: patchPayload.currency }
              : {}),
            ...(patchPayload.notes !== undefined ? { notes: patchPayload.notes } : {}),
            ...(patchPayload.totalAmount !== undefined
              ? { totalAmount: patchPayload.totalAmount }
              : {}),
            ...(Array.isArray(patchPayload.items) ? { items: patchPayload.items } : {}),
            updatedAt: new Date().toISOString(),
          };
          store.orders.set(orderId, patched);
          sendJson(res, 200, { data: patched });
          return;
        }

        if (method === 'DELETE') {
          if (!existing) {
            sendJson(res, 404, { error: `Order "${orderId}" not found` });
            return;
          }
          store.orders.delete(orderId);
          sendJson(res, 200, {
            deleted: true,
            id: orderId,
            data: existing,
          });
          return;
        }
      }

      // 8. REST Inventory Endpoints (`GET /v1/inventory`, `GET /v1/inventory/:sku`)
      if (pathname === '/v1/inventory' && method === 'GET') {
        const warehouseId = urlObj.searchParams.get('warehouseId');
        let list = Array.from(store.inventory.values());
        if (warehouseId) {
          list = list.filter(i => i.warehouseId === warehouseId);
        }
        sendJson(res, 200, { data: list, total: list.length });
        return;
      }

      const inventorySkuMatch = /^\/v1\/inventory\/([^/]+)$/.exec(pathname);
      if (inventorySkuMatch && method === 'GET') {
        const sku = decodeURIComponent(inventorySkuMatch[1]);
        const item = store.inventory.get(sku);
        if (!item) {
          sendJson(res, 404, { error: `Inventory SKU "${sku}" not found` });
          return;
        }
        sendJson(res, 200, { data: item });
        return;
      }

      // 9. GraphQL Endpoint (`POST /graphql` & `GET /graphql`)
      if (pathname === '/graphql') {
        let query = '';
        let variables: Record<string, unknown> | undefined = undefined;
        let operationName: string | undefined = undefined;

        if (method === 'GET') {
          query = urlObj.searchParams.get('query') || '';
          operationName = urlObj.searchParams.get('operationName') || undefined;
          const rawVars = urlObj.searchParams.get('variables');
          if (rawVars) {
            try {
              variables = JSON.parse(rawVars) as Record<string, unknown>;
            } catch {
              sendJson(res, 400, { errors: [{ message: 'Invalid GraphQL variables JSON' }] });
              return;
            }
          }
        } else if (method === 'POST') {
          try {
            const parsed = bodyText.trim()
              ? (JSON.parse(bodyText) as {
                  query?: string;
                  variables?: Record<string, unknown> | string;
                  operationName?: string;
                })
              : {};
            query = parsed.query || '';
            operationName = parsed.operationName || undefined;
            if (typeof parsed.variables === 'string' && parsed.variables.trim()) {
              variables = JSON.parse(parsed.variables) as Record<string, unknown>;
            } else if (parsed.variables && typeof parsed.variables === 'object') {
              variables = parsed.variables;
            }
          } catch {
            sendJson(res, 400, { errors: [{ message: 'Invalid JSON in GraphQL POST body' }] });
            return;
          }
        } else {
          sendJson(res, 405, { errors: [{ message: `Method ${method} not allowed on /graphql` }] });
          return;
        }

        if (!query.trim()) {
          sendJson(res, 400, { errors: [{ message: 'GraphQL query string is required' }] });
          return;
        }

        const result = await graphql({
          schema,
          source: query,
          rootValue,
          variableValues: variables,
          operationName,
        });

        sendJson(res, 200, result);
        return;
      }

      // Fallback 404
      sendJson(res, 404, {
        error: 'Not Found',
        method,
        path: pathname,
      });
    });
  });

  return {
    server,
    get store() {
      return store;
    },
    schema,
    get baseUrl() {
      return currentBaseUrl;
    },
    start(port = 0, host = '127.0.0.1') {
      return new Promise<string>((resolve, reject) => {
        const onError = (err: Error) => {
          server.removeListener('error', onError);
          reject(err);
        };
        server.once('error', onError);
        server.listen(port, host, () => {
          server.removeListener('error', onError);
          const addr = server.address();
          if (addr && typeof addr === 'object') {
            currentBaseUrl = `http://${host}:${addr.port}`;
          }
          resolve(currentBaseUrl);
        });
      });
    },
    stop() {
      return new Promise<void>((resolve, reject) => {
        if (!server.listening) {
          resolve();
          return;
        }
        server.close(err => (err ? reject(err) : resolve()));
      });
    },
    reset,
  };
}

// ---------------------------------------------------------------------------
// Standalone CLI Entrypoint (`pnpm run sample-api`)
// ---------------------------------------------------------------------------

export function startSampleApiCli(): SampleApiServerInstance {
  const portArg = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 8080;
  const hostArg = process.env.HOST || '127.0.0.1';
  const instance = createSampleApiServer();

  instance
    .start(portArg, hostArg)
    .then(url => {
      console.log(`\n🚀 AwapiLasso Sample REST + GraphQL + OAuth2 API running at ${url}`);
      console.log(`   • Health Check:       GET    ${url}/v1/health`);
      console.log(`   • Orders REST CRUD:   GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS ${url}/v1/orders`);
      console.log(`   • Order Attachments:  POST   ${url}/v1/orders/:orderId/attachments`);
      console.log(`   • Inventory REST:     GET    ${url}/v1/inventory`);
      console.log(`   • GraphQL Endpoint:   POST|GET ${url}/graphql (Introspection enabled)`);
      console.log(`   • OAuth 2.0 Token:    POST   ${url}/oauth/token`);
      console.log(`   • Auth Playground:    GET    ${url}/v1/auth/{basic,apikey,digest,bearer}\n`);
    })
    .catch(err => {
      console.error('Failed to start Sample API server:', err);
      process.exit(1);
    });

  const shutdown = () => {
    instance.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return instance;
}

if (require.main === module || process.env.AWAPI_SAMPLE_API_CLI === '1') {
  startSampleApiCli();
}
