# Apollo Cursor Pagination

A TypeScript implementation of [Relay's GraphQL Connection specification](https://relay.dev/graphql/connections.htm) for Apollo Server. This library provides cursor-based pagination that follows the Relay Connection spec, allowing your GraphQL API to implement efficient, stable pagination.

This library was originally forked from [Pocket/apollo-cursor-pagination](https://github.com/Pocket/apollo-cursor-pagination) and has been converted to TypeScript with enhanced type safety and additional features.

## Features

- ✅ **Relay Connection Spec Compliant**: Implements the complete [Relay Connection specification](https://relay.dev/graphql/connections.htm)
- ✅ **TypeScript Support**: Full TypeScript support with comprehensive type definitions
- ✅ **Multiple ORM Support**: Currently supports Knex.js and DynamoDB Toolbox with extensible architecture for other ORMs
- ✅ **Primary Key Support**: Enhanced cursor generation with primary key support
- ✅ **Flexible Ordering**: Support for single and multiple column ordering
- ✅ **Custom Edge Modification**: Ability to add custom metadata to edges
- ✅ **Column Name Formatting**: Support for custom column name transformations

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
- **dynamodb-toolbox**: `^2.6.4` - Required for the DynamoDB connector (if using)

Make sure to install these in your project:

```bash
npm install knex
# or if using DynamoDB
npm install dynamodb-toolbox@^2.6.4
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
} from 'dynamodb-toolbox';
import { AccessPattern } from 'dynamodb-toolbox/entity/actions/accessPattern';

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
  table: YoutTable,
});

const userRepo = UserEntity.build(EntityRepository);

// Create an access pattern using the new v2 AccessPattern syntax
const usersByCategory = UserEntity.build(AccessPattern)
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
2. **`accessPattern`**: A DynamoDB Toolbox access pattern that defines how to query your data
3. **`paginationArgs`**: GraphQL pagination arguments (same as Knex.js)
4. **`options`**: Optional configuration object

#### DynamoDB Access Patterns

Access patterns are the key concept in DynamoDB Toolbox. They define how to query your data based on your table's design. Using the new v2 AccessPattern syntax:

```typescript
import { AccessPattern } from 'dynamodb-toolbox/entity/actions/accessPattern';
import { map, string, number } from 'dynamodb-toolbox';

// Simple access pattern by partition key
const usersByCategory = UserEntity.build(AccessPattern)
  .schema(map({ category: string() }))
  .pattern(({ category }) => ({ partition: `CATEGORY#${category}` }))
  .meta({
    title: 'Users by Category',
    description: 'Query users filtered by category',
  });

// Access pattern with sort key
const usersByCategoryAndDate = UserEntity.build(AccessPattern)
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
const usersByEmail = UserEntity.build(AccessPattern)
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
const usersByAgeRange = UserEntity.build(AccessPattern)
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

#### DynamoDB-Specific Considerations

**Cursor Generation**: DynamoDB cursors are based on the primary key (partition key + sort key) of your items. The cursor contains the encoded primary key information needed for pagination.

**Table Design**: Your DynamoDB table design should support the access patterns you want to paginate. Consider using:

- **GSIs (Global Secondary Indexes)** for different query patterns
- **Composite sort keys** for hierarchical data access
- **Sparse indexes** for filtering

**Performance**: DynamoDB pagination is very efficient as it uses the `ExclusiveStartKey` parameter, which provides O(1) performance for pagination operations.

**Example Table Design**:

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

    // GSI for category-based queries
    gsi1pk: string().savedAs('gsi1pk').transform(prefix('CATEGORY')),
    gsi1sk: string().savedAs('gsi1sk').transform(prefix('POST')),
  }),
  table: YourTable,
  indexes: {
    gsi1: {
      partitionKey: 'gsi1pk',
      sortKey: 'gsi1sk',
    },
  },
});
```

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
