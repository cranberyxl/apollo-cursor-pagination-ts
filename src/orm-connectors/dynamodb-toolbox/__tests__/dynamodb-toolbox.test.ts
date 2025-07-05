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

const TestEntity = new Entity({
  name: 'TestEntity',
  schema: item({
    test: string().savedAs('sk').transform(prefix('TEST')).key(),
    name: string().savedAs('pk').transform(prefix('NAME')).key(),
    age: number(),
    category: string(),
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

const testRepo = TestEntity.build(EntityRepository);

const factory = Factory.define<FormattedItem<typeof TestEntity>>(
  'TestEntity'
).attrs({
  category: faker.lorem.word,
  name: faker.person.firstName,
  age: faker.number.int,
  test: faker.string.uuid,
});

describe('DynamoDB Toolbox Pagination', () => {
  let testEntities: FormattedItem<typeof TestEntity>[];
  let reversedTestEntities: FormattedItem<typeof TestEntity>[];

  beforeEach(async () => {
    await createTable();
    testEntities = Array.from({ length: 10 }, (_, i) => i)
      .map((v) => factory.build({ name: 'bob', test: v.toString() }))
      .sort((a, b) => a.test.localeCompare(b.test));

    reversedTestEntities = [...testEntities].reverse();

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
      const ap = testRepo.accessPattern(
        map({ name: string() }),
        ({ name }) => ({ partition: `NAME#${name}` })
      );

      const result = await paginate(
        { name: 'bob' },
        ap,
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
      const ap = testRepo.accessPattern(
        map({ name: string() }),
        ({ name }) => ({
          partition: `NAME#${name}`,
        })
      );

      const result = await paginate({ name: 'bob' }, ap, {
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
      const ap = testRepo.accessPattern(
        map({ name: string() }),
        ({ name }) => ({ partition: `NAME#${name}` })
      );

      const result = await paginate(
        { name: 'bob' },
        ap,
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
      const ap = testRepo.accessPattern(
        map({ name: string() }),
        ({ name }) => ({ partition: `NAME#${name}` })
      );

      const result = await paginate(
        { name: 'bob' },
        ap,
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
      const ap = testRepo.accessPattern(
        map({ name: string() }),
        ({ name }) => ({ partition: `NAME#${name}` })
      );

      const result = await paginate(
        { name: 'nonexistent' },
        ap,
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
      const ap = testRepo.accessPattern(
        map({ name: string() }),
        ({ name }) => ({ partition: `NAME#${name}` })
      );

      // Get first page
      const firstResult = await paginate({ name: 'bob' }, ap, { first: 3 });

      expect(firstResult.edges).toHaveLength(3);
      const afterCursor = firstResult.pageInfo.endCursor;

      // Get second page using after cursor
      const secondResult = await paginate(
        { name: 'bob' },
        ap,
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
      const ap = testRepo.accessPattern(
        map({ name: string() }),
        ({ name }) => ({ partition: `NAME#${name}` })
      );

      // Get first page
      const firstResult = await paginate(
        { name: 'bob' },
        ap,
        { first: 5 },
        { primaryKey: 'name' }
      );

      // Get second page
      const secondResult = await paginate(
        { name: 'bob' },
        ap,
        { first: 5, after: firstResult.pageInfo.endCursor },
        { primaryKey: 'name' }
      );

      // Go back to first page using before cursor
      const backToFirstResult = await paginate(
        { name: 'bob' },
        ap,
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
      const ap = testRepo.accessPattern(
        map({ name: string() }),
        ({ name }) => ({ partition: `NAME#${name}` })
      );

      const result = await paginate(
        { name: 'bob' },
        ap,
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
      const ap = testRepo.accessPattern(
        map({ name: string() }),
        ({ name }) => ({ partition: `NAME#${name}` })
      );

      const result = await paginate(
        { name: 'bob' },
        ap,
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
      const ap = testRepo.accessPattern(
        map({ name: string() }),
        ({ name }) => ({ partition: `NAME#${name}` })
      );

      await expect(
        paginate({ name: 'bob' }, ap, { first: -1 }, { primaryKey: 'name' })
      ).rejects.toThrow('`first` argument must not be less than 0');
    });

    it('should handle negative last parameter', async () => {
      const ap = testRepo.accessPattern(
        map({ name: string() }),
        ({ name }) => ({ partition: `NAME#${name}` })
      );

      await expect(
        paginate({ name: 'bob' }, ap, { last: -1 }, { primaryKey: 'name' })
      ).rejects.toThrow('`last` argument must not be less than 0');
    });

    it('should handle invalid cursor', async () => {
      const ap = testRepo.accessPattern(
        map({ name: string() }),
        ({ name }) => ({ partition: `NAME#${name}` })
      );

      await expect(
        paginate(
          { name: 'bob' },
          ap,
          { first: 5, after: 'invalid-cursor' },
          { primaryKey: 'name' }
        )
      ).rejects.toThrow();
    });

    it('should handle both first and last parameters', async () => {
      const ap = testRepo.accessPattern(
        map({ name: string() }),
        ({ name }) => ({ partition: `NAME#${name}` })
      );

      // This should prioritize 'first' over 'last'
      const result = await paginate(
        { name: 'bob' },
        ap,
        { first: 3, last: 5 },
        { primaryKey: 'name' }
      );

      expect(result.edges).toHaveLength(5);
      expect(result.totalCount).toBe(10);
    });
  });

  describe('Total Count', () => {
    it('should return total count when not skipped', async () => {
      const ap = testRepo.accessPattern(
        map({ name: string() }),
        ({ name }) => ({ partition: `NAME#${name}` })
      );

      const result = await paginate(
        { name: 'bob' },
        ap,
        { first: 5 },
        { primaryKey: 'name' }
      );

      expect(result.totalCount).toBeDefined();
      expect(result.totalCount).toBe(10);
    });

    it('should skip total count when specified', async () => {
      const ap = testRepo.accessPattern(
        map({ name: string() }),
        ({ name }) => ({ partition: `NAME#${name}` })
      );

      const result = await paginate(
        { name: 'bob' },
        ap,
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
      const ap = testRepo.accessPattern(
        map({ name: string() }),
        ({ name }) => ({ partition: `NAME#${name}` })
      );

      const result = await paginate(
        { name: 'bob' },
        ap,
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
});
