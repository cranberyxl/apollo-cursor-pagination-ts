# Apollo Cursor Pagination

A TypeScript implementation of [Relay's GraphQL Connection specification](https://relay.dev/graphql/connections.htm) for Apollo Server. This library provides cursor-based pagination that follows the Relay Connection spec, allowing your GraphQL API to implement efficient, stable pagination.

This library was originally forked from [Pocket/apollo-cursor-pagination](https://github.com/Pocket/apollo-cursor-pagination) and has been converted to TypeScript with enhanced type safety and additional features.

## Features

- ✅ **Relay Connection Spec Compliant**: Implements the complete [Relay Connection specification](https://relay.dev/graphql/connections.htm)
- ✅ **TypeScript Support**: Full TypeScript support with comprehensive type definitions
- ✅ **Multiple ORM Support**: Currently supports Knex.js with extensible architecture for other ORMs
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

Make sure to install these in your project:

```bash
npm install knex
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
