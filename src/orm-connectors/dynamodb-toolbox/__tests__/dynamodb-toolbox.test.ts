import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { faker } from '@faker-js/faker';
import {
  Entity,
  EntityRepository,
  FormattedItem,
  item,
  map,
  number,
  prefix,
  string,
} from 'dynamodb-toolbox';
import { Factory } from 'rosie';

import paginate, { cursorGenerator, getDataFromCursor } from '..';
import { encode, decode } from '../../../builder';
import { createTable, deleteTable, table } from '../../../testUtil/ddb';
import { PagerEntityAccessPattern } from '../PagerEntityAccessPattern';

const TestEntity = new Entity({
  name: 'TestEntity',
  schema: item({
    test: string().savedAs('sk').transform(prefix('TEST')).key(),
    name: string().savedAs('pk').transform(prefix('NAME')).key(),
    age: number(),
    category: string().savedAs('pk2').transform(prefix('CATEGORY')),
    color: string().savedAs('sk2').transform(prefix('COLOR')),
  }),
  table,
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

const testAccessPattern = TestEntity.build(PagerEntityAccessPattern)
  .schema(
    map({
      name: string(),
    })
  )
  .pattern(({ name }) => ({
    partition: `NAME#${name}`,
  }));

const gsi2AccessPattern = TestEntity.build(PagerEntityAccessPattern)
  .schema(
    map({
      category: string(),
    })
  )
  .pattern(({ category }) => ({
    index: 'gsi2',
    partition: `CATEGORY#${category}`,
  }));

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

describe('DynamoDB Toolbox Pagination', () => {
  let testEntities: FormattedItem<typeof TestEntity>[];
  let reversedTestEntities: FormattedItem<typeof TestEntity>[];
  let gsi2TestEntities: FormattedItem<typeof TestEntity>[];

  beforeEach(async () => {
    await createTable();

    // Wait a bit for the table and indexes to be fully active
    await new Promise<void>((resolve) => {
      setTimeout(() => resolve(), 1000);
    });

    testEntities = Array.from({ length: 10 }, (_, i) => i)
      .map((v) =>
        factory.build({
          name: 'bob',
          test: v.toString(),
          category: 'premium',
        })
      )
      .sort((a, b) => a.test.localeCompare(b.test));

    reversedTestEntities = [...testEntities].reverse();

    gsi2TestEntities = [...testEntities].sort((a, b) =>
      a.color.localeCompare(b.color)
    );

    await Promise.all(testEntities.map((entity) => testRepo.put(entity)));
  });

  afterEach(async () => {
    await deleteTable();
  });

  describe('Utility Functions', () => {
    it('should encode and decode strings correctly', () => {
      const testString = 'test-string';
      const encoded = encode(testString);
      const decoded = decode(encoded);
      expect(decoded).toBe(testString);
    });

    it('should handle complex data in encoding', () => {
      const complexData = {
        id: 123,
        name: 'test',
        nested: { value: 'nested' },
      };
      const encoded = encode(JSON.stringify(complexData));
      const decoded = decode(encoded);
      expect(JSON.parse(decoded)).toEqual(complexData);
    });
  });

  describe('Setup Test', () => {
    it('query works', async () => {
      const testEntity = factory.build();
      await testRepo.put(testEntity);

      const q = await testRepo.query({
        partition: `NAME#${testEntity.name}`,
      });

      expect(q).toMatchObject({
        Count: 1,
        ScannedCount: 1,
        Items: [{ ...testEntity, entity: 'TestEntity' }],
      });
    });
    it('reverse query works', async () => {
      const q = await testRepo.query(
        {
          partition: `NAME#bob`,
        },
        { reverse: true }
      );

      expect(q).toMatchObject({
        Count: 10,
        ScannedCount: 10,
        Items: reversedTestEntities.map((entity) => ({
          ...entity,
          entity: 'TestEntity',
        })),
      });
    });
  });

  describe('Basic Pagination', () => {
    it('should return first N items when first is specified', async () => {
      const result = await paginate(
        { name: 'bob' },
        testAccessPattern,
        { first: 5 },
        { primaryKey: 'name' }
      );

      expect(result.totalCount).toBe(10);
      expect(result.pageInfo).toMatchObject({
        hasNextPage: true,
        hasPreviousPage: false,
        startCursor: result.edges[0].cursor,
        endCursor: result.edges[4].cursor,
      });

      expect(result.edges).toEqual(
        testEntities.slice(0, 5).map((entity) => ({
          cursor: cursorGenerator({
            pk: `NAME#${entity.name}`,
            sk: `TEST#${entity.test}`,
          }),
          node: {
            ...entity,
            entity: 'TestEntity',
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
          },
        }))
      );
    });
    it('should return first N items when first is specified and query is reversed', async () => {
      const result = await paginate({ name: 'bob' }, testAccessPattern, {
        first: 5,
        orderDirection: 'desc',
      });

      expect(result.totalCount).toBe(10);
      expect(result.pageInfo).toMatchObject({
        hasNextPage: true,
        hasPreviousPage: false,
        startCursor: result.edges[0].cursor,
        endCursor: result.edges[4].cursor,
      });

      expect(result.edges).toEqual(
        reversedTestEntities.slice(0, 5).map((entity) => ({
          cursor: cursorGenerator({
            pk: `NAME#${entity.name}`,
            sk: `TEST#${entity.test}`,
          }),
          node: {
            ...entity,
            entity: 'TestEntity',
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
          },
        }))
      );
    });

    it('should return last N items when last is specified', async () => {
      const result = await paginate(
        { name: 'bob' },
        testAccessPattern,
        { last: 5 },
        { primaryKey: 'name' }
      );

      expect(result.totalCount).toBe(10);
      expect(result.pageInfo).toMatchObject({
        hasNextPage: false,
        hasPreviousPage: true,
        startCursor: result.edges[0].cursor,
        endCursor: result.edges[4].cursor,
      });

      expect(result.edges).toEqual(
        testEntities.slice(5, 10).map((entity) => ({
          cursor: cursorGenerator({
            pk: `NAME#${entity.name}`,
            sk: `TEST#${entity.test}`,
          }),
          node: {
            ...entity,
            entity: 'TestEntity',
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
          },
        }))
      );
    });
    it('should return last N items when last is specified when order is reversed', async () => {
      const result = await paginate(
        { name: 'bob' },
        testAccessPattern,
        { last: 5, orderDirection: 'desc' },
        { primaryKey: 'name' }
      );

      expect(result.totalCount).toBe(10);
      expect(result.pageInfo).toMatchObject({
        hasNextPage: false,
        hasPreviousPage: true,
        startCursor: result.edges[0].cursor,
        endCursor: result.edges[4].cursor,
      });

      expect(result.edges).toEqual(
        reversedTestEntities.slice(5, 10).map((entity) => ({
          cursor: cursorGenerator({
            pk: `NAME#${entity.name}`,
            sk: `TEST#${entity.test}`,
          }),
          node: {
            ...entity,
            entity: 'TestEntity',
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
          },
        }))
      );
    });

    it('should handle empty results', async () => {
      const result = await paginate(
        { name: 'nonexistent' },
        testAccessPattern,
        { first: 10 },
        { primaryKey: 'name' }
      );

      expect(result.edges).toHaveLength(0);
      expect(result.pageInfo.hasNextPage).toBe(false);
      expect(result.pageInfo.hasPreviousPage).toBe(false);
      expect(result.totalCount).toBe(0);
    });
  });

  describe('Cursor-based Pagination', () => {
    it('should handle after cursor correctly', async () => {
      // Get first page
      const firstResult = await paginate({ name: 'bob' }, testAccessPattern, {
        first: 3,
      });

      expect(firstResult.edges).toHaveLength(3);
      const afterCursor = firstResult.pageInfo.endCursor;

      // Get second page using after cursor
      const secondResult = await paginate(
        { name: 'bob' },
        testAccessPattern,
        { first: 3, after: afterCursor },
        { primaryKey: 'name' }
      );

      expect(firstResult.totalCount).toBe(10);
      expect(firstResult.pageInfo).toMatchObject({
        hasNextPage: true,
        hasPreviousPage: false,
        startCursor: firstResult.edges[0].cursor,
        endCursor: firstResult.edges[2].cursor,
      });

      expect(firstResult.edges).toEqual(
        testEntities.slice(0, 3).map((entity) => ({
          cursor: cursorGenerator({
            pk: `NAME#${entity.name}`,
            sk: `TEST#${entity.test}`,
          }),
          node: {
            ...entity,
            entity: 'TestEntity',
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
          },
        }))
      );

      expect(secondResult.totalCount).toBe(10);
      expect(secondResult.pageInfo).toMatchObject({
        hasNextPage: true,
        hasPreviousPage: true,
        startCursor: secondResult.edges[0].cursor,
        endCursor: secondResult.edges[2].cursor,
      });

      expect(secondResult.edges).toEqual(
        testEntities.slice(3, 6).map((entity) => ({
          cursor: cursorGenerator({
            pk: `NAME#${entity.name}`,
            sk: `TEST#${entity.test}`,
          }),
          node: {
            ...entity,
            entity: 'TestEntity',
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
          },
        }))
      );
    });

    it('should handle before cursor correctly', async () => {
      // Get first page
      const firstResult = await paginate(
        { name: 'bob' },
        testAccessPattern,
        { first: 5 },
        { primaryKey: 'name' }
      );

      // Get second page
      const secondResult = await paginate(
        { name: 'bob' },
        testAccessPattern,
        { first: 5, after: firstResult.pageInfo.endCursor },
        { primaryKey: 'name' }
      );

      // Go back to first page using before cursor
      const backToFirstResult = await paginate(
        { name: 'bob' },
        testAccessPattern,
        { last: 5, before: secondResult.pageInfo.startCursor },
        { primaryKey: 'name' }
      );

      expect(backToFirstResult.edges).toHaveLength(5);
      expect(backToFirstResult.pageInfo.hasNextPage).toBe(true);
      expect(backToFirstResult.totalCount).toBe(10);
    });
  });

  describe('Ordering', () => {
    it('should order by createdAt in ascending order', async () => {
      const result = await paginate(
        { name: 'bob' },
        testAccessPattern,
        {
          first: 10,
          orderBy: 'createdAt',
          orderDirection: 'asc',
        },
        { primaryKey: 'name' }
      );

      expect(result.edges).toHaveLength(10);
      expect(result.totalCount).toBe(10);

      // Check if items are ordered by createdAt ascending
      const dates = result.edges.map((edge) => new Date(edge.node.createdAt));
      for (let i = 1; i < dates.length; i += 1) {
        expect(dates[i].getTime()).toBeGreaterThanOrEqual(
          dates[i - 1].getTime()
        );
      }
    });

    it('should order by age in descending order', async () => {
      const result = await paginate(
        { name: 'bob' },
        testAccessPattern,
        {
          first: 10,
          orderBy: 'test',
          orderDirection: 'desc',
        },
        { primaryKey: 'name' }
      );

      expect(result.edges).toHaveLength(10);
      expect(result.totalCount).toBe(10);

      // Check if items are ordered by test field descending
      const tests = result.edges.map((edge) => edge.node.test);
      for (let i = 1; i < tests.length; i += 1) {
        expect(tests[i].localeCompare(tests[i - 1])).toBeLessThanOrEqual(0);
      }
    });
  });

  describe('Edge Cases', () => {
    it('should handle negative first parameter', async () => {
      await expect(
        paginate(
          { name: 'bob' },
          testAccessPattern,
          { first: -1 },
          { primaryKey: 'name' }
        )
      ).rejects.toThrow('`first` argument must not be less than 0');
    });

    it('should handle negative last parameter', async () => {
      await expect(
        paginate(
          { name: 'bob' },
          testAccessPattern,
          { last: -1 },
          { primaryKey: 'name' }
        )
      ).rejects.toThrow('`last` argument must not be less than 0');
    });

    it('should handle invalid cursor', async () => {
      await expect(
        paginate(
          { name: 'bob' },
          testAccessPattern,
          { first: 5, after: 'invalid-cursor' },
          { primaryKey: 'name' }
        )
      ).rejects.toThrow();
    });

    it('both first and last should throw an error', async () => {
      // This should throw an error when both first and last are provided
      await expect(
        paginate(
          { name: 'bob' },
          testAccessPattern,
          { first: 3, last: 5 },
          { primaryKey: 'name' }
        )
      ).rejects.toThrow('Cannot specify both `first` and `last` arguments');
    });
  });

  describe('Total Count', () => {
    it('should return total count when not skipped', async () => {
      const result = await paginate(
        { name: 'bob' },
        testAccessPattern,
        { first: 5 },
        { primaryKey: 'name' }
      );

      expect(result.totalCount).toBeDefined();
      expect(result.totalCount).toBe(10);
    });

    it('should skip total count when specified', async () => {
      const result = await paginate(
        { name: 'bob' },
        testAccessPattern,
        { first: 5 },
        {
          primaryKey: 'name',
          skipTotalCount: true,
        }
      );

      expect(result.totalCount).toBeUndefined();
    });
  });

  describe('Real DynamoDB Table Structure', () => {
    it('should work with the provided table structure', async () => {
      const result = await paginate(
        { name: 'bob' },
        testAccessPattern,
        {
          first: 5,
          orderBy: 'createdAt',
          orderDirection: 'desc',
        },
        {
          primaryKey: 'name',
        }
      );

      expect(result.edges).toHaveLength(5);
      expect(result.pageInfo.hasNextPage).toBe(true);
      expect(result.totalCount).toBe(10);

      // Verify the cursor structure works with the table's primary key structure
      const firstCursor = result.edges[0].cursor;
      const decodedCursor = getDataFromCursor(firstCursor);
      expect(decodedCursor).toBeDefined();

      // The cursor should contain the primary key values
      expect(decodedCursor).toHaveProperty('pk');
      expect(decodedCursor).toHaveProperty('sk');
    });
  });

  describe('GSI2 Pagination', () => {
    it('should paginate using GSI2 partition key', async () => {
      const result = await paginate(
        { category: 'premium' },
        gsi2AccessPattern,
        { first: 5 },
        {
          formatPrimaryKeyFn: (node) => ({
            pk2: `CATEGORY#${node.category}`,
            sk2: `COLOR#${node.color}`,
          }),
        }
      );

      expect(result.totalCount).toBe(10);
      expect(result.pageInfo).toMatchObject({
        hasNextPage: true,
        hasPreviousPage: false,
        startCursor: result.edges[0].cursor,
        endCursor: result.edges[4].cursor,
      });

      expect(result.edges).toEqual(
        gsi2TestEntities.slice(0, 5).map((entity) => ({
          cursor: cursorGenerator({
            pk: `NAME#${entity.name}`,
            sk: `TEST#${entity.test}`,
            pk2: `CATEGORY#${entity.category}`,
            sk2: `COLOR#${entity.color}`,
          }),
          node: {
            ...entity,
            entity: 'TestEntity',
            createdAt: expect.any(String),
            updatedAt: expect.any(String),
          },
        }))
      );
    });

    it('should handle GSI2 pagination with after cursor', async () => {
      // Get first page
      const firstResult = await paginate(
        { category: 'premium' },
        gsi2AccessPattern,
        { first: 3 },
        {
          formatPrimaryKeyFn: (node) => ({
            pk2: `CATEGORY#${node.category}`,
            sk2: `COLOR#${node.color}`,
          }),
        }
      );

      expect(firstResult.edges).toHaveLength(3);
      const afterCursor = firstResult.pageInfo.endCursor;

      // Get second page using after cursor
      const secondResult = await paginate(
        { category: 'premium' },
        gsi2AccessPattern,
        { first: 3, after: afterCursor },
        {
          formatPrimaryKeyFn: (node) => ({
            pk2: `CATEGORY#${node.category}`,
            sk2: `COLOR#${node.color}`,
          }),
        }
      );

      expect(secondResult.edges).toHaveLength(3);
      expect(secondResult.pageInfo.hasPreviousPage).toBe(true);
      expect(secondResult.pageInfo.hasNextPage).toBe(true);

      // Verify no overlap between pages
      const firstPageIds = firstResult.edges.map((edge) => edge.node.test);
      const secondPageIds = secondResult.edges.map((edge) => edge.node.test);

      const intersection = firstPageIds.filter((id) =>
        secondPageIds.includes(id)
      );
      expect(intersection).toHaveLength(0);
    });

    it('should handle GSI2 pagination with before cursor', async () => {
      // Get first page
      const firstResult = await paginate(
        { category: 'premium' },
        gsi2AccessPattern,
        { first: 5 },
        {
          formatPrimaryKeyFn: (node) => ({
            pk2: `CATEGORY#${node.category}`,
            sk2: `COLOR#${node.color}`,
          }),
        }
      );

      // Get second page
      const secondResult = await paginate(
        { category: 'premium' },
        gsi2AccessPattern,
        { first: 5, after: firstResult.pageInfo.endCursor },
        {
          formatPrimaryKeyFn: (node) => ({
            pk2: `CATEGORY#${node.category}`,
            sk2: `COLOR#${node.color}`,
          }),
        }
      );

      // Go back to first page using before cursor
      const backToFirstResult = await paginate(
        { category: 'premium' },
        gsi2AccessPattern,
        { last: 5, before: secondResult.pageInfo.startCursor },
        {
          formatPrimaryKeyFn: (node) => ({
            pk2: `CATEGORY#${node.category}`,
            sk2: `COLOR#${node.color}`,
          }),
        }
      );

      expect(backToFirstResult.edges).toHaveLength(5);
      expect(backToFirstResult.pageInfo.hasNextPage).toBe(true);
      expect(backToFirstResult.totalCount).toBe(10);

      // Verify we got back to the first page
      const originalIds = firstResult.edges
        .map((edge) => edge.node.test)
        .sort();
      const backToFirstIds = backToFirstResult.edges
        .map((edge) => edge.node.test)
        .sort();
      expect(backToFirstIds).toEqual(originalIds);
    });

    it('should handle GSI2 pagination with descending order', async () => {
      const result = await paginate(
        { category: 'premium' },
        gsi2AccessPattern,
        { first: 10, orderDirection: 'desc' },
        {
          formatPrimaryKeyFn: (node) => ({
            pk2: `CATEGORY#${node.category}`,
            sk2: `COLOR#${node.color}`,
          }),
        }
      );

      expect(result.edges).toHaveLength(10);
      expect(result.totalCount).toBe(10);

      // Verify items are ordered by color descending (since sk2 is COLOR#)
      const colors = result.edges.map((edge) => edge.node.color);
      for (let i = 1; i < colors.length; i += 1) {
        expect(colors[i].localeCompare(colors[i - 1])).toBeLessThanOrEqual(0);
      }
    });

    it('should handle GSI2 pagination with last parameter', async () => {
      const result = await paginate(
        { category: 'premium' },
        gsi2AccessPattern,
        { last: 5 },
        {
          formatPrimaryKeyFn: (node) => ({
            pk2: `CATEGORY#${node.category}`,
            sk2: `COLOR#${node.color}`,
          }),
        }
      );

      expect(result.totalCount).toBe(10);
      expect(result.pageInfo).toMatchObject({
        hasNextPage: false,
        hasPreviousPage: true,
        startCursor: result.edges[0].cursor,
        endCursor: result.edges[4].cursor,
      });

      expect(result.edges).toHaveLength(5);
    });

    it('should handle empty GSI2 results', async () => {
      const result = await paginate(
        { category: 'nonexistent' },
        gsi2AccessPattern,
        { first: 10 },
        {
          formatPrimaryKeyFn: (node) => ({
            pk2: `CATEGORY#${node.category}`,
            sk2: `COLOR#${node.color}`,
          }),
        }
      );

      expect(result.edges).toHaveLength(0);
      expect(result.pageInfo.hasNextPage).toBe(false);
      expect(result.pageInfo.hasPreviousPage).toBe(false);
      expect(result.totalCount).toBe(0);
    });

    it('should generate correct cursors for GSI2 queries', async () => {
      const result = await paginate(
        { category: 'premium' },
        gsi2AccessPattern,
        { first: 3 },
        {
          formatPrimaryKeyFn: (node) => ({
            pk2: `CATEGORY#${node.category}`,
            sk2: `COLOR#${node.color}`,
          }),
        }
      );

      expect(result.edges).toHaveLength(3);

      // Verify cursor structure and content
      result.edges.forEach((edge) => {
        const decodedCursor = getDataFromCursor(edge.cursor);

        // Cursor should contain the GSI2 key values
        expect(decodedCursor).toHaveProperty('pk2');
        expect(decodedCursor).toHaveProperty('sk2');

        // The pk2 should be the CATEGORY# prefix
        expect(decodedCursor.pk2).toMatch(/^CATEGORY#/);

        // The sk2 should be the COLOR# prefix
        expect(decodedCursor.sk2).toMatch(/^COLOR#/);
      });

      // Verify cursor uniqueness
      const cursors = result.edges.map((edge) => edge.cursor);
      const uniqueCursors = new Set(cursors);
      expect(uniqueCursors.size).toBe(cursors.length);
    });
  });
});
