# Apollo Cursor Pagination

A TypeScript implementation of [Relay's GraphQL Connection specification](https://relay.dev/graphql/connections.htm) for Apollo Server. This library provides cursor-based pagination that follows the Relay Connection spec, allowing your GraphQL API to implement efficient, stable pagination.

This library was originally forked from [Pocket/apollo-cursor-pagination](https://github.com/Pocket/apollo-cursor-pagination) and has been converted to TypeScript with enhanced type safety and additional features.

## Features

- ✅ **Relay Connection Spec Compliant**: Implements the complete [Relay Connection specification](https://relay.dev/graphql/connections.htm)
- ✅ **TypeScript Support**: Full TypeScript support with comprehensive type definitions
- ✅ **Multiple Data Source Support**: Currently supports Knex.js, DynamoDB Toolbox, and JavaScript arrays with extensible architecture for other data sources
- ✅ **Primary Key Support**: Enhanced cursor generation with primary key support
- ✅ **Secondary Index Support**: Full support for DynamoDB GSIs and LSIs with custom cursor generation
- ✅ **Flexible Ordering**: Support for single and multiple column ordering
- ✅ **Custom Edge Modification**: Ability to add custom metadata to edges
- ✅ **Column Name Formatting**: Support for custom column name transformations
- ✅ **Array Pagination**: Built-in support for paginating JavaScript arrays with cursor-based pagination

## Installation

```bash
npm install apollo-cursor-pagination-ts
```

```bash
yarn add apollo-cursor-pagination-ts
```

## Peer Dependencies

This library requires the following peer dependencies:

- **knex**: `*` (any version) - Required for the Knex.js connector
- **dynamodb-toolbox**: `^2.6.5` - Required for the DynamoDB connector (if using)

Make sure to install these in your project:

```bash
npm install knex
# or if using DynamoDB
npm install dynamodb-toolbox@^2.6.5
```

## Quick Start

### Basic Usage with Knex.js

```typescript
import { knexPaginator } from 'apollo-cursor-pagination-ts';
import knex from 'knex';

// Your GraphQL resolver
const catsResolver = async (_, args) => {
  const { first, last, before, after, orderBy, orderDirection } = args;

  const baseQuery = knex('cats');

  const result = await knexPaginator(baseQuery, {
    first,
    last,
    before,
    after,
    orderBy,
    orderDirection,
  });

  return result;
};
```

### Basic Usage with DynamoDB Toolbox

```typescript
import { dynamodbPaginator } from 'apollo-cursor-pagination-ts';
import {
  Entity,
  EntityRepository,
  item,
  string,
  number,
  prefix,
  map,
  EntityAccessPattern,
} from 'dynamodb-toolbox';

// Define your entity using v2 syntax
const UserEntity = new Entity({
  name: 'User',
  schema: item({
    id: string().savedAs('pk').transform(prefix('USER')).key(),
    email: string().savedAs('sk').transform(prefix('EMAIL')).key(),
    name: string(),
    age: number(),
    category: string(),
  }),
  table: YourTable,
});

const userRepo = UserEntity.build(EntityRepository);

// Create an access pattern using EntityAccessPattern (required for pagination)
const usersByCategory = UserEntity.build(EntityAccessPattern)
  .schema(map({ category: string() }))
  .pattern(({ category }) => ({ partition: `CATEGORY#${category}` }))
  .meta({
    title: 'Users by Category',
    description: 'Query users filtered by category',
  });

// Your GraphQL resolver
const usersResolver = async (_, args) => {
  const { first, last, before, after, orderDirection } = args;

  const result = await dynamodbPaginator(
    { category: 'premium' }, // Query input
    usersByCategory, // Access pattern
    { first, last, before, after, orderDirection }
  );

  return result;
};
```

### Basic Usage with Arrays

```typescript
import { arrayPaginator } from 'apollo-cursor-pagination-ts';

// Your GraphQL resolver
const usersResolver = async (_, args) => {
  const { first, last, before, after, orderBy, orderDirection } = args;

  // Your array of users (could be from cache, memory, or pre-fetched data)
  const users = [
    { id: '1', name: 'Alice', email: 'alice@example.com' },
    { id: '2', name: 'Bob', email: 'bob@example.com' },
    // ... more users
  ];

  const result = await arrayPaginator(users, {
    first,
    last,
    before,
    after,
    orderBy,
    orderDirection,
  });

  return result;
};
```

### GraphQL Schema Example

```graphql
type Cat {
  id: ID!
  name: String!
  age: Int!
}

type CatEdge {
  cursor: String!
  node: Cat!
}

type CatConnection {
  edges: [CatEdge!]!
  pageInfo: PageInfo!
  totalCount: Int
}

type PageInfo {
  hasNextPage: Boolean!
  hasPreviousPage: Boolean!
  startCursor: String
  endCursor: String
}

type Query {
  cats(
    first: Int
    last: Int
    before: String
    after: String
    orderBy: String
    orderDirection: String
  ): CatConnection!
}
```

## Usage

### Using the Knex.js Connector

The `knexPaginator` function is the main entry point for Knex.js integration:

```typescript
import { knexPaginator } from 'apollo-cursor-pagination-ts';

const result = await knexPaginator(
  baseQuery, // Knex query builder
  paginationArgs, // GraphQL pagination arguments
  options // Optional configuration
);
```

#### Parameters

1. **`baseQuery`**: A Knex.js query builder instance
2. **`paginationArgs`**: GraphQL pagination arguments:
   - `first`: Number of items to fetch (forward pagination)
   - `last`: Number of items to fetch (backward pagination)
   - `before`: Cursor for backward pagination
   - `after`: Cursor for forward pagination
   - `orderBy`: Column(s) to order by
   - `orderDirection`: 'asc' or 'desc' (or array for multiple columns)
3. **`options`**: Optional configuration object

#### Return Value

The function returns a `ConnectionResult` object:

```typescript
interface ConnectionResult<T> {
  pageInfo: {
    hasPreviousPage: boolean;
    hasNextPage: boolean;
    startCursor?: string;
    endCursor?: string;
  };
  totalCount?: number;
  edges: Array<{
    cursor: string;
    node: T;
  }>;
}
```

### Advanced Configuration

#### Column Name Formatting

If you're using an ORM like Objection.js that maps column names, you can use the `formatColumnFn` option:

```typescript
const result = await knexPaginator(
  baseQuery,
  { first, last, before, after, orderBy, orderDirection },
  {
    formatColumnFn: (column) => {
      // Transform camelCase to snake_case
      return column.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
    },
  }
);
```

#### Custom Edge Modification

Add custom metadata to each edge:

```typescript
const result = await knexPaginator(
  baseQuery,
  { first, last, before, after, orderBy, orderDirection },
  {
    modifyEdgeFn: (edge) => ({
      ...edge,
      customField: 'custom value',
      timestamp: new Date().toISOString(),
    }),
  }
);
```

#### Skip Total Count

For performance optimization, you can skip the total count calculation:

```typescript
const result = await knexPaginator(
  baseQuery,
  { first, last, before, after, orderBy, orderDirection },
  {
    skipTotalCount: true,
  }
);
```

#### Custom Primary Key

Specify a custom primary key (defaults to 'id'):

```typescript
const result = await knexPaginator(
  baseQuery,
  { first, last, before, after, orderBy, orderDirection },
  {
    primaryKey: 'uuid',
  }
);
```

### Multiple Column Ordering

You can order by multiple columns:

```typescript
const result = await knexPaginator(baseQuery, {
  first: 10,
  orderBy: ['createdAt', 'id'],
  orderDirection: ['desc', 'asc'],
});
```

### Using the DynamoDB Toolbox Connector

The `dynamodbPaginator` function is the main entry point for DynamoDB Toolbox integration:

```typescript
import { dynamodbPaginator } from 'apollo-cursor-pagination-ts';

const result = await dynamodbPaginator(
  queryInput, // Query input parameters from AccessPattern
  accessPattern, // DynamoDB Toolbox access pattern
  paginationArgs, // GraphQL pagination arguments
  options // Optional configuration
);
```

#### DynamoDB Parameters

1. **`queryInput`**: The input parameters for your DynamoDB query (e.g., `{ category: 'premium' }`)
2. **`accessPattern`**: A `PagerEntityAccessPattern` that defines how to query your data (must use `PagerEntityAccessPattern`, not the standard `AccessPattern`)
3. **`paginationArgs`**: GraphQL pagination arguments (same as Knex.js)
4. **`options`**: Optional configuration object including `formatPrimaryKeyFn` for custom cursor generation

#### DynamoDB Access Patterns

Access patterns are the key concept in DynamoDB Toolbox. They define how to query your data based on your table's design. **Important**: For pagination to work correctly, you must use `EntityAccessPattern` from DynamoDB Toolbox.

```typescript
import { EntityAccessPattern } from 'dynamodb-toolbox';
import { map, string, number } from 'dynamodb-toolbox';

// Simple access pattern by partition key
const usersByCategory = UserEntity.build(EntityAccessPattern)
  .schema(map({ category: string() }))
  .pattern(({ category }) => ({ partition: `CATEGORY#${category}` }))
  .meta({
    title: 'Users by Category',
    description: 'Query users filtered by category',
  });

// Access pattern with sort key
const usersByCategoryAndDate = UserEntity.build(EntityAccessPattern)
  .schema(map({ category: string(), date: string() }))
  .pattern(({ category, date }) => ({
    partition: `CATEGORY#${category}`,
    range: { eq: `DATE#${date}` },
  }))
  .meta({
    title: 'Users by Category and Date',
    description: 'Query users by category and specific date',
  });

// Access pattern with GSI
const usersByEmail = UserEntity.build(EntityAccessPattern)
  .schema(map({ email: string() }))
  .pattern(({ email }) => ({
    index: 'email-index',
    partition: `EMAIL#${email}`,
  }))
  .meta({
    title: 'Users by Email',
    description: 'Query users by email using GSI',
  });

// Access pattern with range conditions
const usersByAgeRange = UserEntity.build(EntityAccessPattern)
  .schema(map({ category: string(), minAge: number(), maxAge: number() }))
  .pattern(({ category, minAge, maxAge }) => ({
    partition: `CATEGORY#${category}`,
    range: { gte: minAge, lte: maxAge },
  }))
  .meta({
    title: 'Users by Age Range',
    description: 'Query users in a specific age range',
  });
```

#### DynamoDB Ordering

DynamoDB ordering is handled through the `orderDirection` parameter:

```typescript
// Ascending order (default)
const result = await dynamodbPaginator(
  { category: 'premium' },
  usersByCategory,
  { first: 10, orderDirection: 'asc' }
);

// Descending order
const result = await dynamodbPaginator(
  { category: 'premium' },
  usersByCategory,
  { first: 10, orderDirection: 'desc' }
);
```

**Note**: DynamoDB ordering is based on the sort key of your table or GSI. The `orderDirection` parameter controls whether the query uses `reverse: true` or not.

#### Secondary Indexes (GSI/LSI)

DynamoDB pagination works seamlessly with both Global Secondary Indexes (GSI) and Local Secondary Indexes (LSI). When using secondary indexes, you need to specify the `index` property in your access pattern:

```typescript
// GSI access pattern
const usersByEmail = UserEntity.build(EntityAccessPattern)
  .schema(map({ email: string() }))
  .pattern(({ email }) => ({
    index: 'email-index', // Specify the GSI name
    partition: `EMAIL#${email}`,
  }));

// LSI access pattern
const usersByCategoryAndDate = UserEntity.build(EntityAccessPattern)
  .schema(map({ category: string(), date: string() }))
  .pattern(({ category, date }) => ({
    index: 'category-date-index', // Specify the LSI name
    partition: `CATEGORY#${category}`,
    range: { eq: `DATE#${date}` },
  }));
```

**Important**: When using secondary indexes, you may need to use the `formatPrimaryKeyFn` option to ensure proper cursor generation. This is especially important when:

1. **Using GSIs**: The cursor needs to include both the primary table keys and the GSI keys
2. **Complex key structures**: When your table has multiple key attributes that need to be included in the cursor

```typescript
// Example with formatPrimaryKeyFn for GSI pagination
const result = await dynamodbPaginator(
  { category: 'premium' },
  usersByCategory,
  { first: 10 },
  {
    formatPrimaryKeyFn: (node) => ({
      // Include primary table keys
      pk: `USER#${node.id}`,
      sk: `EMAIL#${node.email}`,
      // Include GSI keys
      pk2: `CATEGORY#${node.category}`,
      sk2: `DATE#${node.createdAt}`,
    }),
  }
);
```

#### The `formatPrimaryKeyFn` Parameter

The `formatPrimaryKeyFn` is a function that allows you to customize how the primary key is extracted from each node for cursor generation. This is particularly useful for:

- **Secondary Index Queries**: When querying GSIs or LSIs, you may need to include both the primary table keys and the index keys in the cursor
- **Complex Key Structures**: When your DynamoDB table has multiple key attributes that need to be preserved for pagination
- **Custom Key Formatting**: When you need to transform or combine multiple attributes into the cursor

```typescript
// Basic usage
const result = await dynamodbPaginator(
  { category: 'premium' },
  usersByCategory,
  { first: 10 },
  {
    formatPrimaryKeyFn: (node) => ({
      pk: `USER#${node.id}`,
      sk: `EMAIL#${node.email}`,
    }),
  }
);

// Advanced usage with GSI
const result = await dynamodbPaginator(
  { category: 'premium' },
  usersByCategory,
  { first: 10 },
  {
    formatPrimaryKeyFn: (node) => ({
      // Primary table keys
      pk: `USER#${node.id}`,
      sk: `EMAIL#${node.email}`,
      // GSI keys (if using GSI)
      pk2: `CATEGORY#${node.category}`,
      sk2: `AGE#${node.age}`,
    }),
  }
);
```

**When to use `formatPrimaryKeyFn`**:

1. **GSI Queries**: Always use this when querying GSIs to ensure the cursor includes all necessary key information
2. **Complex Tables**: When your table has multiple key attributes that need to be preserved
3. **Custom Cursor Logic**: When you need custom logic for cursor generation

**Note**: If you don't provide `formatPrimaryKeyFn`, the paginator will automatically extract the primary key from the node using DynamoDB Toolbox's entity parser. This works fine for simple primary table queries but may not be sufficient for GSI queries.

#### DynamoDB-Specific Considerations

**Cursor Generation**: DynamoDB cursors are based on the primary key (partition key + sort key) of your items. The cursor contains the encoded primary key information needed for pagination.

**Table Design**: Your DynamoDB table design should support the access patterns you want to paginate. Consider using:

- **GSIs (Global Secondary Indexes)** for different query patterns
- **Composite sort keys** for hierarchical data access
- **Sparse indexes** for filtering

**Performance**: DynamoDB pagination is very efficient as it uses the `ExclusiveStartKey` parameter, which provides O(1) performance for pagination operations.

**Example Table Design with Secondary Indexes**:

```typescript
// Example table structure for user posts using v2 syntax
import { Entity, item, string, number, prefix } from 'dynamodb-toolbox';

const PostEntity = new Entity({
  name: 'Post',
  schema: item({
    // Primary key
    userId: string().savedAs('pk').transform(prefix('USER')).key(),
    postId: string().savedAs('sk').transform(prefix('POST')).key(),

    // Attributes
    title: string(),
    content: string(),
    createdAt: string(),
    category: string(),
    status: string(),

    // GSI1 for category-based queries
    gsi1pk: string().savedAs('gsi1pk').transform(prefix('CATEGORY')),
    gsi1sk: string().savedAs('gsi1sk').transform(prefix('POST')),

    // GSI2 for status-based queries
    gsi2pk: string().savedAs('gsi2pk').transform(prefix('STATUS')),
    gsi2sk: string().savedAs('gsi2sk').transform(prefix('DATE')),
  }),
  table: YourTable,
  indexes: {
    gsi1: {
      partitionKey: 'gsi1pk',
      sortKey: 'gsi1sk',
    },
    gsi2: {
      partitionKey: 'gsi2pk',
      sortKey: 'gsi2sk',
    },
  },
});

// Access patterns for different query patterns
const postsByUser = PostEntity.build(EntityAccessPattern)
  .schema(map({ userId: string() }))
  .pattern(({ userId }) => ({ partition: `USER#${userId}` }));

const postsByCategory = PostEntity.build(EntityAccessPattern)
  .schema(map({ category: string() }))
  .pattern(({ category }) => ({
    index: 'gsi1',
    partition: `CATEGORY#${category}`,
  }));

const postsByStatus = PostEntity.build(EntityAccessPattern)
  .schema(map({ status: string() }))
  .pattern(({ status }) => ({
    index: 'gsi2',
    partition: `STATUS#${status}`,
  }));

// Usage with formatPrimaryKeyFn for GSI queries
const result = await dynamodbPaginator(
  { category: 'technology' },
  postsByCategory,
  { first: 10 },
  {
    formatPrimaryKeyFn: (node) => ({
      // Primary table keys
      pk: `USER#${node.userId}`,
      sk: `POST#${node.postId}`,
      // GSI1 keys
      pk2: `CATEGORY#${node.category}`,
      sk2: `POST#${node.postId}`,
    }),
  }
);
```

## Using the Array Connector

The `arrayPaginator` function provides cursor-based pagination for JavaScript arrays. This is useful when you have data in memory that you want to paginate, or when working with data that has already been fetched from a database.

```typescript
import { arrayPaginator } from 'apollo-cursor-pagination-ts';

const result = await arrayPaginator(
  array, // JavaScript array of objects
  paginationArgs, // GraphQL pagination arguments
  options // Optional configuration
);
```

### Basic Usage

```typescript
const users = [
  {
    id: '1',
    name: 'Alice',
    email: 'alice@example.com',
    createdAt: '2023-01-01',
  },
  { id: '2', name: 'Bob', email: 'bob@example.com', createdAt: '2023-01-02' },
  {
    id: '3',
    name: 'Charlie',
    email: 'charlie@example.com',
    createdAt: '2023-01-03',
  },
  // ... more users
];

// Forward pagination
const result = await arrayPaginator(users, {
  first: 10,
  orderBy: 'name',
  orderDirection: 'asc',
});

// Backward pagination
const result = await arrayPaginator(users, {
  last: 10,
  orderBy: 'createdAt',
  orderDirection: 'desc',
});

// Cursor-based pagination
const result = await arrayPaginator(users, {
  first: 5,
  after: 'some-cursor',
  orderBy: 'email',
  orderDirection: 'asc',
});
```

### Multiple Column Ordering

The array paginator supports ordering by multiple columns, just like the Knex.js connector:

```typescript
const result = await arrayPaginator(users, {
  first: 10,
  orderBy: ['name', 'email'],
  orderDirection: ['asc', 'desc'], // name ascending, email descending
});
```

### Custom Primary Key

By default, the array paginator uses `'id'` as the primary key. You can specify a custom primary key:

```typescript
const result = await arrayPaginator(
  users,
  {
    first: 10,
    orderBy: 'name',
  },
  {
    primaryKey: 'email', // Use email as the primary key
  }
);
```

### Skip Total Count

For performance optimization with large arrays, you can skip the total count calculation:

```typescript
const result = await arrayPaginator(
  users,
  {
    first: 10,
    orderBy: 'name',
  },
  {
    skipTotalCount: true,
  }
);
```

### Array Paginator Parameters

1. **`array`**: A JavaScript array of objects to paginate
2. **`paginationArgs`**: GraphQL pagination arguments:
   - `first`: Number of items to fetch (forward pagination)
   - `last`: Number of items to fetch (backward pagination)
   - `before`: Cursor for backward pagination
   - `after`: Cursor for forward pagination
   - `orderBy`: Column(s) to order by (string or array of strings)
   - `orderDirection`: 'asc' or 'desc' (or array for multiple columns)
3. **`options`**: Optional configuration object:
   - `primaryKey`: Custom primary key (defaults to 'id')
   - `skipTotalCount`: Skip total count calculation for performance

### Return Value

The array paginator returns the same `ConnectionResult` object as other connectors:

```typescript
interface ConnectionResult<T> {
  pageInfo: {
    hasPreviousPage: boolean;
    hasNextPage: boolean;
    startCursor?: string;
    endCursor?: string;
  };
  totalCount?: number;
  edges: Array<{
    cursor: string;
    node: T;
  }>;
}
```

### Use Cases

The array paginator is particularly useful for:

- **In-memory data**: When you have data already loaded in memory
- **Caching scenarios**: When working with cached data that needs pagination
- **Testing**: For testing pagination logic with mock data
- **Simple applications**: When you don't need database-level pagination
- **Data transformation**: When you need to paginate data after processing or filtering

### Example: GraphQL Resolver

```typescript
const usersResolver = async (_, args) => {
  const { first, last, before, after, orderBy, orderDirection } = args;

  // Fetch all users (in a real app, you might filter this first)
  const allUsers = await fetchAllUsers();

  // Apply pagination
  const result = await arrayPaginator(allUsers, {
    first,
    last,
    before,
    after,
    orderBy,
    orderDirection,
  });

  return result;
};
```

### Performance Considerations

- **Large arrays**: For very large arrays, consider using database-level pagination instead
- **Memory usage**: The array paginator loads all data into memory, so be mindful of memory usage
- **Sorting**: Multi-column sorting is performed in memory and may be slower than database sorting for large datasets

## Creating Custom Connectors

The library is designed to be extensible. You can create connectors for other ORMs by implementing the `OperatorFunctions` interface.

### Required Methods

To create a custom connector, you need to implement these methods:

```typescript
interface OperatorFunctions<N, NA, C> {
  // Apply cursor filtering for forward pagination
  applyAfterCursor: (
    nodeAccessor: NA,
    cursor: string,
    opts: OrderArgs<C>
  ) => NA;

  // Apply cursor filtering for backward pagination
  applyBeforeCursor: (
    nodeAccessor: NA,
    cursor: string,
    opts: OrderArgs<C>
  ) => NA;

  // Apply ordering to the query
  applyOrderBy: (nodeAccessor: NA, opts: OrderArgs<C>) => NA;

  // Return first N nodes for forward pagination
  returnNodesForFirst: (
    nodeAccessor: NA,
    count: number,
    opts: OrderArgs<C>
  ) => Promise<N[]>;

  // Return last N nodes for backward pagination
  returnNodesForLast: (
    nodeAccessor: NA,
    count: number,
    opts: OrderArgs<C>
  ) => Promise<N[]>;

  // Return total count of nodes
  returnTotalCount: (nodeAccessor: NA) => Promise<number>;

  // Convert nodes to edges with cursors
  convertNodesToEdges: (
    nodes: N[],
    params: GraphQLParams | undefined,
    opts: OrderArgs<C>
  ) => { cursor: string; node: N }[];
}
```

### Example: Custom Connector

```typescript
import apolloCursorPaginationBuilder from 'apollo-cursor-pagination-ts';

const myCustomConnector = apolloCursorPaginationBuilder({
  applyAfterCursor: (query, cursor, opts) => {
    // Implement cursor filtering logic
    return query;
  },

  applyBeforeCursor: (query, cursor, opts) => {
    // Implement cursor filtering logic
    return query;
  },

  applyOrderBy: (query, opts) => {
    // Implement ordering logic
    return query;
  },

  returnNodesForFirst: async (query, count, opts) => {
    // Return first N nodes
    return [];
  },

  returnNodesForLast: async (query, count, opts) => {
    // Return last N nodes
    return [];
  },

  returnTotalCount: async (query) => {
    // Calculate total count
    return 0;
  },

  convertNodesToEdges: (nodes, params, opts) => {
    // Convert nodes to edges with cursors
    return nodes.map((node) => ({
      cursor: 'encoded-cursor',
      node,
    }));
  },
});

export default myCustomConnector;
```

## Relay Connection Specification

This library implements the complete [Relay Connection specification](https://relay.dev/graphql/connections.htm). Key features include:

### Connection Types

- Must have `edges` and `pageInfo` fields
- `edges` returns a list of edge types
- `pageInfo` returns a non-null `PageInfo` object

### Edge Types

- Must have `node` and `cursor` fields
- `node` contains the actual data
- `cursor` is an opaque string for pagination

### Pagination Arguments

- **Forward pagination**: `first` and `after`
- **Backward pagination**: `last` and `before`
- Consistent ordering across both directions

### PageInfo

- `hasNextPage`: Boolean indicating if more edges exist
- `hasPreviousPage`: Boolean indicating if previous edges exist
- `startCursor`: Cursor of the first edge
- `endCursor`: Cursor of the last edge

## Testing

Run the test suite:

```bash
npm test
```

Run tests in watch mode:

```bash
npm run test:watch
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

### Development Setup

```bash
# Install dependencies
npm install

# Build the project
npm run build

# Run type checking
npm run typecheck

# Run linting
npm run lint

# Format code
npm run format
```

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

- Original implementation by [Pocket](https://github.com/Pocket/apollo-cursor-pagination)
- [Relay](https://relay.dev/) team for the Connection specification
- [Apollo GraphQL](https://www.apollographql.com/) for the excellent GraphQL server framework
