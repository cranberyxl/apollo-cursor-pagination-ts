import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { faker } from '@faker-js/faker';
import {
  Entity,
  EntityAccessPattern,
  EntityRepository,
  FormattedItem,
  item,
  map,
  number,
  prefix,
  string,
} from 'dynamodb-toolbox';
import { Factory } from 'rosie';

import paginate from '..';
import {
  createFilteredTable,
  deleteFilteredTable,
  filteredTable,
} from '../../../testUtil/ddb';

const TestEntity = new Entity({
  name: 'TestEntity',
  schema: item({
    test: string().savedAs('sk').transform(prefix('TEST')).key(),
    name: string().savedAs('pk').transform(prefix('NAME')).key(),
    age: number(),
    category: string().savedAs('pk2').transform(prefix('CATEGORY')),
    color: string().savedAs('sk2').transform(prefix('COLOR')),
  }),
  table: filteredTable,
  timestamps: {
    created: {
      name: 'createdAt',
    },
    modified: {
      name: 'updatedAt',
    },
  },
  entityAttribute: { hidden: false },
});

const testRepo = TestEntity.build(EntityRepository);

const factory = Factory.define<FormattedItem<typeof TestEntity>>(
  'TestEntity'
).attrs({
  category: faker.lorem.word,
  name: faker.person.firstName,
  age: faker.number.int,
  test: faker.string.uuid,
  color: faker.lorem.word,
});

describe('DynamoDB Toolbox Filtered Pagination', () => {
  let filteredTestEntities: FormattedItem<typeof TestEntity>[];

  beforeEach(async () => {
    await createFilteredTable();

    // Wait a bit for the table and indexes to be fully active
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 1000);
    });

    // Create test data with varied attributes for comprehensive filtering tests
    filteredTestEntities = [
      factory.build({
        name: 'filtered',
        test: '001',
        category: 'premium',
        age: 25,
        color: 'red',
      }),
      factory.build({
        name: 'filtered',
        test: '002',
        category: 'premium',
        age: 30,
        color: 'blue',
      }),
      factory.build({
        name: 'filtered',
        test: '003',
        category: 'basic',
        age: 35,
        color: 'green',
      }),
      factory.build({
        name: 'filtered',
        test: '004',
        category: 'premium',
        age: 40,
        color: 'yellow',
      }),
      factory.build({
        name: 'filtered',
        test: '005',
        category: 'basic',
        age: 45,
        color: 'purple',
      }),
      factory.build({
        name: 'filtered',
        test: '006',
        category: 'premium',
        age: 50,
        color: 'orange',
      }),
      factory.build({
        name: 'filtered',
        test: '007',
        category: 'premium',
        age: 55,
        color: 'pink',
      }),
      factory.build({
        name: 'filtered',
        test: '008',
        category: 'basic',
        age: 60,
        color: 'brown',
      }),
      factory.build({
        name: 'filtered',
        test: '009',
        category: 'premium',
        age: 65,
        color: 'gray',
      }),
      factory.build({
        name: 'filtered',
        test: '010',
        category: 'premium',
        age: 70,
        color: 'black',
      }),
    ].sort((a, b) => a.test.localeCompare(b.test));

    await Promise.all(
      filteredTestEntities.map((entity) => testRepo.put(entity))
    );
  });

  afterEach(async () => {
    await deleteFilteredTable();
  });

  describe('Category-based Filtering', () => {
    it('should filter by premium category using GSI2', async () => {
      const gsi2FilteredPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            category: string(),
          })
        )
        .pattern(({ category }) => ({
          index: 'gsi2',
          partition: `CATEGORY#${category}`,
        }));

      const result = await paginate(
        { category: 'premium' },
        gsi2FilteredPattern,
        { first: 10 }
      );

      result.edges.forEach((edge) => {
        expect(edge.node.category).toBe('premium');
      });
      expect(result.pageInfo).toMatchObject({
        hasNextPage: false,
        hasPreviousPage: false,
      });
      expect(result.totalCount).toBe(7);
      expect(result.edges).toHaveLength(7);

      // Verify all returned items are premium category
    });

    it('should filter by basic category using GSI2', async () => {
      const gsi2FilteredPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            category: string(),
          })
        )
        .pattern(({ category }) => ({
          index: 'gsi2',
          partition: `CATEGORY#${category}`,
        }));

      const result = await paginate(
        { category: 'basic' },
        gsi2FilteredPattern,
        { first: 10 }
      );

      expect(result.edges).toHaveLength(3);
      expect(result.totalCount).toBe(3);
      expect(result.pageInfo.hasNextPage).toBe(false);

      // Verify all returned items are basic category
      result.edges.forEach((edge) => {
        expect(edge.node.category).toBe('basic');
      });
    });

    it('should handle pagination with category filtering', async () => {
      const gsi2FilteredPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            category: string(),
          })
        )
        .pattern(({ category }) => ({
          index: 'gsi2',
          partition: `CATEGORY#${category}`,
        }));

      // Get first page
      const firstResult = await paginate(
        { category: 'premium' },
        gsi2FilteredPattern,
        { first: 3 }
      );

      expect(firstResult.edges).toHaveLength(3);
      expect(firstResult.pageInfo.hasNextPage).toBe(true);

      // Get second page
      const secondResult = await paginate(
        { category: 'premium' },
        gsi2FilteredPattern,
        { first: 3, after: firstResult.pageInfo.endCursor }
      );

      expect(secondResult.edges).toHaveLength(3);
      expect(secondResult.pageInfo.hasNextPage).toBe(true);

      // Get third page
      const thirdResult = await paginate(
        { category: 'premium' },
        gsi2FilteredPattern,
        { first: 3, after: secondResult.pageInfo.endCursor }
      );

      expect(thirdResult.edges).toHaveLength(1);
      expect(thirdResult.pageInfo.hasNextPage).toBe(false);

      // Verify no overlap between pages
      const allIds = [
        ...firstResult.edges.map((edge) => edge.node.test),
        ...secondResult.edges.map((edge) => edge.node.test),
        ...thirdResult.edges.map((edge) => edge.node.test),
      ];
      const uniqueIds = new Set(allIds);
      expect(uniqueIds.size).toBe(7);
    });
  });

  describe('Age-based Filtering', () => {
    it('should filter by age range using .options({filters})', async () => {
      const ageRangePattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            name: string(),
          })
        )
        .pattern(({ name }) => ({
          partition: `NAME#${name}`,
        }))
        .options({
          filters: {
            TestEntity: {
              and: [
                {
                  attr: 'category',
                  eq: 'premium',
                },
                {
                  attr: 'age',
                  between: [30, 60],
                },
              ],
            },
          },
        });

      const result = await paginate({ name: 'filtered' }, ageRangePattern, {
        first: 10,
      });

      expect(result.edges.length).toBeGreaterThan(0);
      expect(result.totalCount).toBeGreaterThan(0);

      // Verify all returned items are within the age range
      result.edges.forEach((edge) => {
        expect(edge.node.category).toBe('premium');
        expect(edge.node.age).toBeGreaterThanOrEqual(30);
        expect(edge.node.age).toBeLessThanOrEqual(60);
      });
    });

    it('should filter by minimum age using .options({filters})', async () => {
      const minAgePattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            name: string(),
          })
        )
        .pattern(({ name }) => ({
          partition: `NAME#${name}`,
        }))
        .options({
          filters: {
            TestEntity: {
              and: [
                {
                  attr: 'category',
                  eq: 'premium',
                },
                {
                  attr: 'age',
                  gte: 50,
                },
              ],
            },
          },
        });

      const result = await paginate({ name: 'filtered' }, minAgePattern, {
        first: 10,
      });

      expect(result.edges.length).toBeGreaterThan(0);

      // Verify all returned items meet the minimum age requirement
      result.edges.forEach((edge) => {
        expect(edge.node.category).toBe('premium');
        expect(edge.node.age).toBeGreaterThanOrEqual(50);
      });
    });
  });

  describe('Color-based Filtering', () => {
    it('should filter by specific colors', async () => {
      const colorPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            category: string(),
            color: string(),
          })
        )
        .pattern(({ category, color }) => ({
          index: 'gsi2',
          partition: `CATEGORY#${category}`,
          range: { eq: `COLOR#${color}` },
        }));

      const result = await paginate(
        { category: 'premium', color: 'red' },
        colorPattern,
        { first: 10 }
      );

      expect(result.edges.length).toBeGreaterThan(0);

      // Verify all returned items have the specified color
      result.edges.forEach((edge) => {
        expect(edge.node.category).toBe('premium');
        expect(edge.node.color).toBe('red');
      });
    });

    it('should filter by color prefix', async () => {
      const colorPrefixPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            category: string(),
            colorPrefix: string(),
          })
        )
        .pattern(({ category, colorPrefix }) => ({
          index: 'gsi2',
          partition: `CATEGORY#${category}`,
          range: { beginsWith: `COLOR#${colorPrefix}` },
        }));

      const result = await paginate(
        { category: 'premium', colorPrefix: 'r' },
        colorPrefixPattern,
        { first: 10 }
      );

      expect(result.edges.length).toBeGreaterThan(0);

      // Verify all returned items have colors starting with the prefix
      result.edges.forEach((edge) => {
        expect(edge.node.category).toBe('premium');
        expect(edge.node.color).toMatch(/^r/);
      });
    });
  });

  describe('Complex Filtering Scenarios', () => {
    it('should handle multiple filter conditions', async () => {
      const complexPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            category: string(),
            minAge: number(),
            color: string(),
          })
        )
        .pattern(({ category, minAge, color }) => ({
          index: 'gsi2',
          partition: `CATEGORY#${category}`,
          range: { gte: `COLOR#${minAge}`, eq: `COLOR#${color}` },
        }));

      const result = await paginate(
        { category: 'premium', minAge: 40, color: 'yellow' },
        complexPattern,
        { first: 10 }
      );

      expect(result.edges.length).toBeGreaterThan(0);

      // Verify all returned items meet all filter conditions
      result.edges.forEach((edge) => {
        expect(edge.node.category).toBe('premium');
        expect(edge.node.age).toBeGreaterThanOrEqual(40);
        expect(edge.node.color).toBe('yellow');
      });
    });

    it('should handle filtering with ordering', async () => {
      const orderedFilterPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            category: string(),
          })
        )
        .pattern(({ category }) => ({
          index: 'gsi2',
          partition: `CATEGORY#${category}`,
        }));

      const result = await paginate(
        { category: 'premium' },
        orderedFilterPattern,
        { first: 5, orderDirection: 'desc' }
      );

      expect(result.edges).toHaveLength(5);
      expect(result.pageInfo.hasNextPage).toBe(true);

      // Verify items are ordered by color descending
      const colors = result.edges.map((edge) => edge.node.color);
      for (let i = 1; i < colors.length; i += 1) {
        expect(colors[i].localeCompare(colors[i - 1])).toBeLessThanOrEqual(0);
      }

      // Verify all items are premium
      result.edges.forEach((edge) => {
        expect(edge.node.category).toBe('premium');
      });
    });

    it('should handle backward pagination with filters', async () => {
      const gsi2FilteredPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            category: string(),
          })
        )
        .pattern(({ category }) => ({
          index: 'gsi2',
          partition: `CATEGORY#${category}`,
        }));

      // Get first page
      const firstResult = await paginate(
        { category: 'premium' },
        gsi2FilteredPattern,
        { first: 3 }
      );

      // Get second page
      const secondResult = await paginate(
        { category: 'premium' },
        gsi2FilteredPattern,
        { first: 3, after: firstResult.pageInfo.endCursor }
      );

      // Go back to first page using before cursor
      const backToFirstResult = await paginate(
        { category: 'premium' },
        gsi2FilteredPattern,
        { last: 3, before: secondResult.pageInfo.startCursor }
      );

      expect(backToFirstResult.edges).toHaveLength(3);
      expect(backToFirstResult.pageInfo.hasNextPage).toBe(true);
      expect(backToFirstResult.pageInfo.hasPreviousPage).toBe(false);

      // Verify we got back to the first page
      const originalIds = firstResult.edges
        .map((edge) => edge.node.test)
        .sort();
      const backToFirstIds = backToFirstResult.edges
        .map((edge) => edge.node.test)
        .sort();
      expect(backToFirstIds).toEqual(originalIds);

      // Verify all items are premium category
      backToFirstResult.edges.forEach((edge) => {
        expect(edge.node.category).toBe('premium');
      });
    });
  });

  describe('Filter Edge Cases', () => {
    it('should handle empty filter results', async () => {
      const gsi2FilteredPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            category: string(),
          })
        )
        .pattern(({ category }) => ({
          index: 'gsi2',
          partition: `CATEGORY#${category}`,
        }));

      const result = await paginate(
        { category: 'nonexistent' },
        gsi2FilteredPattern,
        { first: 10 }
      );

      expect(result.edges).toHaveLength(0);
      expect(result.totalCount).toBe(0);
      expect(result.pageInfo.hasNextPage).toBe(false);
      expect(result.pageInfo.hasPreviousPage).toBe(false);
    });

    it('should handle filter with cursor pagination', async () => {
      const gsi2FilteredPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            category: string(),
          })
        )
        .pattern(({ category }) => ({
          index: 'gsi2',
          partition: `CATEGORY#${category}`,
        }));

      // Get first page
      const firstResult = await paginate(
        { category: 'premium' },
        gsi2FilteredPattern,
        { first: 2 }
      );

      expect(firstResult.edges).toHaveLength(2);
      const afterCursor = firstResult.pageInfo.endCursor;

      // Get second page using after cursor
      const secondResult = await paginate(
        { category: 'premium' },
        gsi2FilteredPattern,
        { first: 2, after: afterCursor }
      );

      expect(secondResult.edges).toHaveLength(2);
      expect(secondResult.pageInfo.hasPreviousPage).toBe(true);

      // Verify no overlap between pages
      const firstPageIds = firstResult.edges.map((edge) => edge.node.test);
      const secondPageIds = secondResult.edges.map((edge) => edge.node.test);
      const intersection = firstPageIds.filter((id) =>
        secondPageIds.includes(id)
      );
      expect(intersection).toHaveLength(0);

      // Verify all items in both pages are premium
      [...firstResult.edges, ...secondResult.edges].forEach((edge) => {
        expect(edge.node.category).toBe('premium');
      });
    });

    it('should handle filter with total count skipping', async () => {
      const gsi2FilteredPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            category: string(),
          })
        )
        .pattern(({ category }) => ({
          index: 'gsi2',
          partition: `CATEGORY#${category}`,
        }));

      const result = await paginate(
        { category: 'premium' },
        gsi2FilteredPattern,
        { first: 5 },
        { skipTotalCount: true }
      );

      expect(result.edges).toHaveLength(5);
      expect(result.totalCount).toBeUndefined();
      expect(result.pageInfo.hasNextPage).toBe(true);

      // Verify all items are premium
      result.edges.forEach((edge) => {
        expect(edge.node.category).toBe('premium');
      });
    });
  });

  describe('DynamoDB Toolbox Filter Options', () => {
    it('should filter by category using .options({filters})', async () => {
      const filteredAccessPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            name: string(),
          })
        )
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
        filteredAccessPattern,
        { first: 10 }
      );

      expect(result.edges).toHaveLength(7);
      expect(result.totalCount).toBe(7);

      // Verify all returned items are premium category
      result.edges.forEach((edge) => {
        expect(edge.node.category).toBe('premium');
      });
    });

    it('should filter by age using .options({filters})', async () => {
      const ageFilteredPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            name: string(),
          })
        )
        .pattern(({ name }) => ({
          partition: `NAME#${name}`,
        }))
        .options({
          filters: {
            TestEntity: {
              attr: 'age',
              gte: 50,
            },
          },
        });

      const result = await paginate({ name: 'filtered' }, ageFilteredPattern, {
        first: 10,
      });

      expect(result.edges.length).toBeGreaterThan(0);

      // Verify all returned items meet the age requirement
      result.edges.forEach((edge) => {
        expect(edge.node.age).toBeGreaterThanOrEqual(50);
      });
    });

    it('should filter by color using .options({filters})', async () => {
      const colorFilteredPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            name: string(),
          })
        )
        .pattern(({ name }) => ({
          partition: `NAME#${name}`,
        }))
        .options({
          filters: {
            TestEntity: {
              attr: 'color',
              eq: 'red',
            },
          },
        });

      const result = await paginate(
        { name: 'filtered' },
        colorFilteredPattern,
        { first: 10 }
      );

      expect(result.edges.length).toBeGreaterThan(0);

      // Verify all returned items have the specified color
      result.edges.forEach((edge) => {
        expect(edge.node.color).toBe('red');
      });
    });

    it('should handle multiple filters using .options({filters})', async () => {
      const multiFilteredPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            name: string(),
          })
        )
        .pattern(({ name }) => ({
          partition: `NAME#${name}`,
        }))
        .options({
          filters: {
            TestEntity: {
              and: [
                {
                  attr: 'category',
                  eq: 'premium',
                },
                {
                  attr: 'age',
                  gte: 40,
                },
              ],
            },
          },
        });

      const result = await paginate(
        { name: 'filtered' },
        multiFilteredPattern,
        { first: 10 }
      );

      expect(result.edges.length).toBeGreaterThan(0);

      // Verify all returned items meet both filter conditions
      result.edges.forEach((edge) => {
        expect(edge.node.category).toBe('premium');
        expect(edge.node.age).toBeGreaterThanOrEqual(40);
      });
    });

    it('should handle filter with pagination using .options({filters})', async () => {
      const paginatedFilterPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            name: string(),
          })
        )
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

      // Get first page
      const firstResult = await paginate(
        { name: 'filtered' },
        paginatedFilterPattern,
        { first: 3 }
      );

      expect(firstResult.totalCount).toBe(7);
      expect(firstResult.edges).toHaveLength(3);
      expect(firstResult.pageInfo).toMatchObject({
        hasNextPage: true,
        hasPreviousPage: false,
      });

      // Get second page
      const secondResult = await paginate(
        { name: 'filtered' },
        paginatedFilterPattern,
        { first: 3, after: firstResult.pageInfo.endCursor }
      );

      expect(secondResult.edges).toHaveLength(3);
      expect(secondResult.pageInfo.hasPreviousPage).toBe(true);

      // Verify no overlap between pages
      const firstPageIds = firstResult.edges.map((edge) => edge.node.test);
      const secondPageIds = secondResult.edges.map((edge) => edge.node.test);
      const intersection = firstPageIds.filter((id) =>
        secondPageIds.includes(id)
      );
      expect(intersection).toHaveLength(0);

      // Verify all items in both pages are premium
      [...firstResult.edges, ...secondResult.edges].forEach((edge) => {
        expect(edge.node.category).toBe('premium');
      });
    });

    it('should handle filter with ordering using .options({filters})', async () => {
      const orderedFilterPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            name: string(),
          })
        )
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
        orderedFilterPattern,
        { first: 5, orderDirection: 'desc' }
      );

      expect(result.edges).toHaveLength(5);
      expect(result.pageInfo.hasNextPage).toBe(true);

      // Verify items are ordered by test field descending
      const tests = result.edges.map((edge) => edge.node.test);
      for (let i = 1; i < tests.length; i += 1) {
        expect(tests[i].localeCompare(tests[i - 1])).toBeLessThanOrEqual(0);
      }

      // Verify all items are premium
      result.edges.forEach((edge) => {
        expect(edge.node.category).toBe('premium');
      });
    });

    it('should handle filter with cursor pagination using .options({filters})', async () => {
      const cursorFilterPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            name: string(),
          })
        )
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

      // Get first page
      const firstResult = await paginate(
        { name: 'filtered' },
        cursorFilterPattern,
        { first: 2 }
      );

      expect(firstResult.edges).toHaveLength(2);
      const afterCursor = firstResult.pageInfo.endCursor;

      // Get second page using after cursor
      const secondResult = await paginate(
        { name: 'filtered' },
        cursorFilterPattern,
        { first: 2, after: afterCursor }
      );

      expect(secondResult.edges).toHaveLength(2);
      expect(secondResult.pageInfo.hasPreviousPage).toBe(true);

      // Verify no overlap between pages
      const firstPageIds = firstResult.edges.map((edge) => edge.node.test);
      const secondPageIds = secondResult.edges.map((edge) => edge.node.test);
      const intersection = firstPageIds.filter((id) =>
        secondPageIds.includes(id)
      );
      expect(intersection).toHaveLength(0);

      // Verify all items in both pages are premium
      [...firstResult.edges, ...secondResult.edges].forEach((edge) => {
        expect(edge.node.category).toBe('premium');
      });
    });

    it('should handle filter with backward pagination using .options({filters})', async () => {
      const backwardFilterPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            name: string(),
          })
        )
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

      // Get first page
      const firstResult = await paginate(
        { name: 'filtered' },
        backwardFilterPattern,
        { first: 3 }
      );

      // Get second page
      const secondResult = await paginate(
        { name: 'filtered' },
        backwardFilterPattern,
        { first: 3, after: firstResult.pageInfo.endCursor }
      );

      // Go back to first page using before cursor
      const backToFirstResult = await paginate(
        { name: 'filtered' },
        backwardFilterPattern,
        { last: 3, before: secondResult.pageInfo.startCursor }
      );

      expect(backToFirstResult.edges).toHaveLength(3);
      expect(backToFirstResult.pageInfo.hasNextPage).toBe(true);
      expect(backToFirstResult.pageInfo.hasPreviousPage).toBe(false);

      // Verify we got back to the first page
      const originalIds = firstResult.edges
        .map((edge) => edge.node.test)
        .sort();
      const backToFirstIds = backToFirstResult.edges
        .map((edge) => edge.node.test)
        .sort();
      expect(backToFirstIds).toEqual(originalIds);

      // Verify all items are premium category
      backToFirstResult.edges.forEach((edge) => {
        expect(edge.node.category).toBe('premium');
      });
    });

    it('should handle filter with total count skipping using .options({filters})', async () => {
      const skipCountFilterPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            name: string(),
          })
        )
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
        skipCountFilterPattern,
        { first: 5 },
        { skipTotalCount: true }
      );

      expect(result.edges).toHaveLength(5);
      expect(result.totalCount).toBeUndefined();
      expect(result.pageInfo.hasNextPage).toBe(true);

      // Verify all items are premium
      result.edges.forEach((edge) => {
        expect(edge.node.category).toBe('premium');
      });
    });

    it('should handle empty filter results using .options({filters})', async () => {
      const emptyFilterPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            name: string(),
          })
        )
        .pattern(({ name }) => ({
          partition: `NAME#${name}`,
        }))
        .options({
          filters: {
            TestEntity: {
              attr: 'category',
              eq: 'nonexistent',
            },
          },
        });

      const result = await paginate({ name: 'filtered' }, emptyFilterPattern, {
        first: 10,
      });

      expect(result.edges).toHaveLength(0);
      expect(result.totalCount).toBe(0);
      expect(result.pageInfo.hasNextPage).toBe(false);
      expect(result.pageInfo.hasPreviousPage).toBe(false);
    });

    it('should handle complex filter conditions using .options({filters})', async () => {
      const complexFilterPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            name: string(),
          })
        )
        .pattern(({ name }) => ({
          partition: `NAME#${name}`,
        }))
        .options({
          filters: {
            TestEntity: {
              and: [
                {
                  attr: 'category',
                  eq: 'premium',
                },
                {
                  attr: 'age',
                  gte: 40,
                },
                {
                  attr: 'color',
                  eq: 'orange',
                },
              ],
            },
          },
        });

      const result = await paginate(
        { name: 'filtered' },
        complexFilterPattern,
        { first: 10 }
      );

      expect(result.edges.length).toBeGreaterThan(0);

      // Verify all returned items meet all filter conditions
      result.edges.forEach((edge) => {
        expect(edge.node.category).toBe('premium');
        expect(edge.node.age).toBeGreaterThanOrEqual(40);
        expect(edge.node.color).toBe('orange');
      });
    });

    it('should handle filter with different operators using .options({filters})', async () => {
      const operatorFilterPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            name: string(),
          })
        )
        .pattern(({ name }) => ({
          partition: `NAME#${name}`,
        }))
        .options({
          filters: {
            TestEntity: {
              and: [
                {
                  attr: 'age',
                  between: [30, 60],
                },
                {
                  attr: 'color',
                  ne: 'blue',
                },
              ],
            },
          },
        });

      const result = await paginate(
        { name: 'filtered' },
        operatorFilterPattern,
        { first: 10 }
      );

      expect(result.edges.length).toBeGreaterThan(0);

      // Verify all returned items meet all filter conditions
      result.edges.forEach((edge) => {
        expect(edge.node.age).toBeGreaterThanOrEqual(30);
        expect(edge.node.age).toBeLessThanOrEqual(60);
        expect(edge.node.color).not.toBe('blue');
      });
    });

    it('should verify filters, counts, and pagination work together', async () => {
      const comprehensiveFilterPattern = TestEntity.build(EntityAccessPattern)
        .schema(
          map({
            name: string(),
          })
        )
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

      // Test 1: Get first page with count
      const firstResult = await paginate(
        { name: 'filtered' },
        comprehensiveFilterPattern,
        { first: 3 }
      );

      expect(firstResult.edges.length).toBeGreaterThan(0);
      expect(firstResult.totalCount).toBeDefined();
      expect(firstResult.totalCount).toBeGreaterThan(0);

      // Test 2: Get second page
      const secondResult = await paginate(
        { name: 'filtered' },
        comprehensiveFilterPattern,
        { first: 3, after: firstResult.pageInfo.endCursor }
      );

      // Test 4: Verify with skipTotalCount
      const skipCountResult = await paginate(
        { name: 'filtered' },
        comprehensiveFilterPattern,
        { first: 3 },
        { skipTotalCount: true }
      );

      // Verify all items are premium
      [...firstResult.edges, ...secondResult.edges].forEach((edge) => {
        expect(edge.node.category).toBe('premium');
      });

      // Verify no overlap between pages
      const firstPageIds = firstResult.edges.map((edge) => edge.node.test);
      const secondPageIds = secondResult.edges.map((edge) => edge.node.test);
      const intersection = firstPageIds.filter((id) =>
        secondPageIds.includes(id)
      );
      expect(intersection).toHaveLength(0);

      // Verify skipTotalCount works
      expect(skipCountResult.totalCount).toBeUndefined();
    });
  });
});
