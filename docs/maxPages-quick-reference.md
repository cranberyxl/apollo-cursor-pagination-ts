# MaxPages Quick Reference

## Basic Configuration

```typescript
// Default behavior (maxPages: 5)
const result = await paginate(queryInput, accessPattern, { first: 10 });

// Custom maxPages
const result = await paginate(
  queryInput,
  accessPattern,
  { first: 10 },
  { maxPages: 3 }
);
```

## Key Points

| Aspect                  | Details                                      |
| ----------------------- | -------------------------------------------- |
| **Default Value**       | 5                                            |
| **Applies To**          | Forward pagination (`first` parameter) only  |
| **Backward Pagination** | `last` parameter ignores maxPages            |
| **Purpose**             | Prevent runaway queries and manage resources |

## Filter Integration Examples

### Simple Filter

```typescript
const simpleFilter = TestEntity.build(EntityAccessPattern).options({
  filters: { TestEntity: { attr: 'category', eq: 'premium' } },
});

await paginate(queryInput, simpleFilter, { first: 5 }, { maxPages: 2 });
```

### Complex Filter

```typescript
const complexFilter = TestEntity.build(EntityAccessPattern).options({
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

await paginate(queryInput, complexFilter, { first: 10 }, { maxPages: 3 });
```

### GSI-based Filter

```typescript
const gsiFilter = TestEntity.build(EntityAccessPattern).pattern(
  ({ category }) => ({
    index: 'gsi2',
    partition: `CATEGORY#${category}`,
  })
);

await paginate(
  { category: 'premium' },
  gsiFilter,
  { first: 5 },
  { maxPages: 4 }
);
```

## Recommended Values

| Filter Type           | Recommended maxPages | Reasoning                               |
| --------------------- | -------------------- | --------------------------------------- |
| **Simple filters**    | 2-3                  | Low complexity, predictable performance |
| **Complex filters**   | 3-5                  | Higher computational cost               |
| **High-cardinality**  | 5-10                 | Many potential results                  |
| **Low-cardinality**   | 1-2                  | Few results expected                    |
| **Expensive queries** | 1-2                  | Conservative approach                   |

## Performance Impact

- **Higher maxPages** = More DynamoDB read capacity consumed
- **Higher maxPages** = More network round trips
- **Higher maxPages** = Increased memory usage

## Testing

```typescript
// Test maxPages behavior
const result = await paginate(
  queryInput,
  accessPattern,
  { first: 3 },
  { maxPages: 2 }
);

expect(result.edges).toHaveLength(3);
expect(result.pageInfo.hasNextPage).toBe(true);
expect(result.totalCount).toBeGreaterThan(3);
```

## Common Patterns

### E-commerce

```typescript
// Product filtering with reasonable limits
await paginate(
  { category: 'electronics' },
  productFilter,
  { first: 20 },
  { maxPages: 5 } // Balance UX and performance
);
```

### User Search

```typescript
// User search with conservative limits
await paginate(
  { location: 'New York' },
  userFilter,
  { first: 10 },
  { maxPages: 3 } // Prevent expensive queries
);
```

### Analytics

```typescript
// Analytics queries with strict limits
await paginate(
  { dateRange: 'last30days' },
  analyticsFilter,
  { first: 50 },
  { maxPages: 2 } // Very conservative for analytics
);
```
