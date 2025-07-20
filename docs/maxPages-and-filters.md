# MaxPages Configuration and Filter Integration

## Overview

The `maxPages` configuration is a performance and safety feature in the Apollo Cursor Pagination library that limits the number of pages that can be fetched in a single pagination operation. This is particularly important when working with filters, as it prevents potentially expensive queries from consuming excessive resources.

## What is MaxPages?

`maxPages` is an optional configuration parameter that:

- **Limits the number of pages** that can be fetched in a single pagination operation
- **Prevents runaway queries** that could consume excessive database resources
- **Applies only to forward pagination** (`first` parameter), not backward pagination (`last` parameter)
- **Has a default value of 5** if not specified

## How MaxPages Works

### Basic Usage

```typescript
import { paginate } from 'apollo-cursor-pagination';

// With custom maxPages
const result = await paginate(
  queryInput,
  accessPattern,
  { first: 10 },
  { maxPages: 3 } // Limit to 3 pages maximum
);
```

### Default Behavior

```typescript
// Uses default maxPages of 5
const result = await paginate(
  queryInput,
  accessPattern,
  { first: 10 }
  // No maxPages specified - uses default of 5
);
```

## MaxPages with Filters

### DynamoDB Toolbox Filters

When using filters with DynamoDB Toolbox, `maxPages` works seamlessly with all filtering mechanisms:

#### 1. GSI-based Filtering

```typescript
const gsiFilteredPattern = TestEntity.build(EntityAccessPattern)
  .schema(map({ category: string() }))
  .pattern(({ category }) => ({
    index: 'gsi2',
    partition: `CATEGORY#${category}`,
  }));

const result = await paginate(
  { category: 'premium' },
  gsiFilteredPattern,
  { first: 5 },
  { maxPages: 2 } // Limit to 2 pages for premium category
);
```

#### 2. DynamoDB Toolbox Filter Options

```typescript
const filteredPattern = TestEntity.build(EntityAccessPattern)
  .schema(map({ name: string() }))
  .pattern(({ name }) => ({
    partition: `NAME#${name}`,
  }))
  .options({
    filters: {
      TestEntity: {
        attr: 'category',
        eq: 'premium',
      },
    },
  });

const result = await paginate(
  { name: 'filtered' },
  filteredPattern,
  { first: 3 },
  { maxPages: 4 } // Limit to 4 pages for filtered results
);
```

#### 3. Complex Filter Conditions

```typescript
const complexFilterPattern = TestEntity.build(EntityAccessPattern)
  .schema(map({ name: string() }))
  .pattern(({ name }) => ({
    partition: `NAME#${name}`,
  }))
  .options({
    filters: {
      TestEntity: {
        and: [
          { attr: 'category', eq: 'premium' },
          { attr: 'age', gte: 40 },
          { attr: 'color', eq: 'orange' },
        ],
      },
    },
  });

const result = await paginate(
  { name: 'filtered' },
  complexFilterPattern,
  { first: 10 },
  { maxPages: 3 } // Limit complex filtered queries to 3 pages
);
```

## Implementation Details

### How MaxPages is Applied

1. **Forward Pagination Only**: `maxPages` only applies to `first` parameter pagination
2. **Backward Pagination**: `last` parameter pagination ignores `maxPages` for performance reasons
3. **Internal Limit Calculation**: The actual limit sent to DynamoDB is `count * maxPages`

### Code Implementation

```typescript
// From src/orm-connectors/dynamodb-toolbox/index.ts
returnNodesForFirst: async (nodeAccessor, count, orderArgs) => {
  const result = await nodeAccessor
    .options((previousOptions) => ({
      ...previousOptions,
      limit: count,
      reverse: orderArgs.ascOrDesc === 'desc',
      maxPages, // Applied here
    }))
    .query(queryInput)
    .send();

  const items = (result.Items || []) as FormattedItem<ENTITY>[];
  return items.slice(0, count); // Return only requested count
},
```

### Backward Pagination Behavior

```typescript
returnNodesForLast: async (nodeAccessor, count, orderArgs) => {
  const result = await nodeAccessor
    .options((previousOptions) => ({
      ...previousOptions,
      limit: count,
      reverse: orderArgs.ascOrDesc === 'asc',
      maxPages, // Applied but less relevant for last pagination
    }))
    .query(queryInput)
    .send();

  const items = (result.Items || []) as FormattedItem<ENTITY>[];
  return items.slice(0, count).reverse();
},
```

## Best Practices

### 1. Choose Appropriate MaxPages Values

```typescript
// For high-cardinality filters (many results)
const result = await paginate(
  queryInput,
  accessPattern,
  { first: 10 },
  { maxPages: 10 } // Allow more pages for broad filters
);

// For low-cardinality filters (few results)
const result = await paginate(
  queryInput,
  accessPattern,
  { first: 10 },
  { maxPages: 2 } // Limit pages for narrow filters
);
```

### 2. Consider Filter Complexity

```typescript
// Simple filter - lower maxPages
const simpleFilter = TestEntity.build(EntityAccessPattern).options({
  filters: {
    TestEntity: { attr: 'category', eq: 'premium' },
  },
});

// Complex filter - higher maxPages
const complexFilter = TestEntity.build(EntityAccessPattern).options({
  filters: {
    TestEntity: {
      and: [
        { attr: 'category', eq: 'premium' },
        { attr: 'age', between: [30, 60] },
        { attr: 'color', ne: 'blue' },
      ],
    },
  },
});
```

### 3. Monitor Performance

```typescript
// Use lower maxPages for expensive queries
const expensiveFilter = TestEntity.build(EntityAccessPattern).options({
  filters: {
    TestEntity: {
      or: [
        { attr: 'category', eq: 'premium' },
        { attr: 'category', eq: 'basic' },
        { attr: 'age', gte: 18 },
      ],
    },
  },
});

const result = await paginate(
  queryInput,
  expensiveFilter,
  { first: 5 },
  { maxPages: 2 } // Conservative limit for expensive queries
);
```

## Testing MaxPages with Filters

### Test Examples

```typescript
describe('MaxPages with Filters', () => {
  it('should respect maxPages with category filtering', async () => {
    const filteredPattern = TestEntity.build(EntityAccessPattern).options({
      filters: {
        TestEntity: { attr: 'category', eq: 'premium' },
      },
    });

    const result = await paginate(
      { name: 'filtered' },
      filteredPattern,
      { first: 3 },
      { maxPages: 2 }
    );

    expect(result.edges).toHaveLength(3);
    expect(result.pageInfo.hasNextPage).toBe(true);
    expect(result.totalCount).toBe(7);
  });

  it('should handle maxPages with complex filters', async () => {
    const complexFilter = TestEntity.build(EntityAccessPattern).options({
      filters: {
        TestEntity: {
          and: [
            { attr: 'category', eq: 'premium' },
            { attr: 'age', gte: 40 },
          ],
        },
      },
    });

    const result = await paginate(
      { name: 'filtered' },
      complexFilter,
      { first: 5 },
      { maxPages: 3 }
    );

    // Verify all items meet filter criteria
    result.edges.forEach((edge) => {
      expect(edge.node.category).toBe('premium');
      expect(edge.node.age).toBeGreaterThanOrEqual(40);
    });
  });
});
```

## Common Use Cases

### 1. E-commerce Product Filtering

```typescript
const productFilter = ProductEntity.build(EntityAccessPattern).options({
  filters: {
    ProductEntity: {
      and: [
        { attr: 'category', eq: 'electronics' },
        { attr: 'price', between: [100, 500] },
        { attr: 'inStock', eq: true },
      ],
    },
  },
});

const products = await paginate(
  { category: 'electronics' },
  productFilter,
  { first: 20 },
  { maxPages: 5 } // Limit to 5 pages for performance
);
```

### 2. User Search with Multiple Criteria

```typescript
const userSearch = UserEntity.build(EntityAccessPattern).options({
  filters: {
    UserEntity: {
      and: [
        { attr: 'status', eq: 'active' },
        { attr: 'age', gte: 18 },
        { attr: 'location', eq: 'New York' },
      ],
    },
  },
});

const users = await paginate(
  { location: 'New York' },
  userSearch,
  { first: 10 },
  { maxPages: 3 } // Conservative limit for user searches
);
```

## Performance Considerations

### 1. DynamoDB Read Capacity

- Higher `maxPages` values increase DynamoDB read capacity consumption
- Consider your table's read capacity when setting `maxPages`
- Monitor DynamoDB metrics to optimize `maxPages` values

### 2. Network Latency

- More pages mean more network round trips
- Balance between user experience and performance
- Consider implementing caching for frequently accessed filtered results

### 3. Memory Usage

- Large `maxPages` values can increase memory usage
- Monitor application memory consumption
- Implement appropriate timeouts for long-running queries

## Troubleshooting

### Common Issues

1. **Unexpected Page Limits**: Check if `maxPages` is being applied correctly
2. **Performance Issues**: Reduce `maxPages` for expensive filters
3. **Incomplete Results**: Increase `maxPages` if legitimate results are being truncated

### Debugging

```typescript
// Add logging to understand maxPages behavior
const result = await paginate(
  queryInput,
  accessPattern,
  { first: 10 },
  {
    maxPages: 3,
    // Add custom logging if needed
  }
);

console.log('Total count:', result.totalCount);
console.log('Page info:', result.pageInfo);
console.log('Items returned:', result.edges.length);
```

## Summary

The `maxPages` configuration is a crucial feature for managing performance and resource consumption when using filters with Apollo Cursor Pagination. By understanding how it works and applying it appropriately to your use cases, you can ensure optimal performance while maintaining a good user experience.

Key takeaways:

- `maxPages` only applies to forward pagination (`first` parameter)
- Default value is 5 if not specified
- Works seamlessly with all DynamoDB Toolbox filtering mechanisms
- Should be tuned based on filter complexity and performance requirements
- Important for preventing runaway queries and managing resource consumption
