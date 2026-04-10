import {
  describe,
  expect,
  it,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
} from '@jest/globals';
import { Kysely, ReferenceExpression, SqliteDialect, sql } from 'kysely';
import { Factory } from 'rosie';
import { faker } from '@faker-js/faker';
import Database from 'better-sqlite3';
import paginate, {
  cursorGenerator,
  getDataFromCursor,
  applyOrderBy,
  convertNodesToEdges,
  returnTotalCount,
  formatColumnIfAvailable,
  applyAfterCursor,
  applyBeforeCursor,
  returnNodesForFirst,
  returnNodesForLast,
} from '..';
import { decode, encode } from '../../../builder';

interface TestNode {
  id: number;
  name: string | null;
  age: number;
}

interface OtherTableNode {
  id: number;
  test_table_id: number;
  label: string;
}

interface TestDatabase {
  test_table: TestNode;
  other_table: OtherTableNode;
}

type BetterSqliteInstance = InstanceType<typeof Database>;

interface Edge<T> {
  cursor: string;
  node: T;
}

const factory = Factory.define<TestNode>('test_node').attrs({
  name: faker.lorem.word,
  age: faker.number.int,
  id: faker.number.int,
});

describe('non-db functions', () => {
  it('cursorGenerator', () => {
    const id = '123';
    const customColumnValue = '{"test": "test"}';
    const cursor = cursorGenerator(id, customColumnValue);
    expect(cursor).toBe('MTIzXypfeyJ0ZXN0IjogInRlc3QifQ==');
  });

  it('getDataFromCursor', () => {
    const cursor = 'MTIzXypfeyJ0ZXN0IjogInRlc3QifQ==';
    const [decodedId, decodedValues] = getDataFromCursor(cursor);
    expect(decodedId).toBe('123');
    expect(decodedValues).toEqual([{ test: 'test' }]);
  });

  it('getDataFromCursor throws on bad cursor', () => {
    const cursor = 'not-a-cursor';
    expect(() => getDataFromCursor(cursor)).toThrow(
      `Could not find edge with cursor ${cursor}`
    );
  });

  it('default encode and decode is base64', () => {
    expect(encode('test')).toBe('dGVzdA==');
    expect(decode('dGVzdA==')).toBe('test');
    expect(decode(encode('test'))).toBe('test');
  });

  it('formatColumnIfAvailable', () => {
    expect(
      formatColumnIfAvailable<TestDatabase, 'test_table'>(
        'age',
        undefined,
        true
      )
    ).toBe('age');

    expect(
      formatColumnIfAvailable<TestDatabase, 'test_table'>(
        'age',
        () => `test_table.age`,
        true
      )
    ).toBe('test_table.age');
    expect(
      formatColumnIfAvailable<TestDatabase, 'test_table'>(
        'age',
        () => `test_table.age`,
        false
      )
    ).toBe('test_table.age');

    const mockFormatColumnFn = jest.fn().mockReturnValue('test');
    expect(
      formatColumnIfAvailable<TestDatabase, 'test_table'>(
        'age',
        mockFormatColumnFn,
        true
      )
    ).toBe('test');
    expect(mockFormatColumnFn).toHaveBeenCalledWith('age', true);
  });

  it('convertNodesToEdges', () => {
    const nodes = [{ id: 1, name: 'test', age: 1 }];
    const result = convertNodesToEdges<TestDatabase, 'test_table', TestNode>(
      nodes,
      undefined,
      {
        orderColumn: 'id',
        primaryKey: 'id',
        ascOrDesc: 'asc',
      }
    );
    expect(result).toEqual([
      { cursor: 'MV8qXzE=', node: { id: 1, name: 'test', age: 1 } },
    ]);
  });
});

describe('Kysely Custom Pagination with SQLite', () => {
  let db: Kysely<TestDatabase>;
  let sqliteDb: BetterSqliteInstance;

  beforeAll(() => {
    sqliteDb = new Database(':memory:');
    db = new Kysely<TestDatabase>({
      dialect: new SqliteDialect({
        database: sqliteDb,
      }),
    });
  });

  afterAll(async () => {
    await db.destroy();
    sqliteDb.close();
  });

  beforeEach(async () => {
    await db.schema
      .createTable('test_table')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('name', 'text')
      .addColumn('age', 'integer')
      .execute();
    await db.schema
      .createTable('other_table')
      .addColumn('id', 'integer', (col) => col.primaryKey().autoIncrement())
      .addColumn('test_table_id', 'integer', (col) => col.notNull())
      .addColumn('label', 'text', (col) => col.notNull())
      .execute();
  });

  afterEach(async () => {
    await db.schema.dropTable('other_table').execute();
    await db.schema.dropTable('test_table').execute();
  });

  describe('returnTotalCount', () => {
    it('returns the number of nodes in a query', async () => {
      await db.insertInto('test_table').values(factory.build()).execute();
      const result = await returnTotalCount(
        db.selectFrom('test_table').selectAll()
      );
      expect(result).toBe(1);
    });

    it('returns the number of nodes a query with a select', async () => {
      await db.insertInto('test_table').values(factory.build()).execute();
      const result = await returnTotalCount(
        db.selectFrom('test_table').select('age')
      );
      expect(result).toBe(1);
    });
  });

  describe('applyOrderBy', () => {
    it('defaults', async () => {
      const nodes = factory.buildList(10);
      await db.insertInto('test_table').values(nodes).execute();
      const result = await applyOrderBy(
        db.selectFrom('test_table').selectAll(),
        {
          orderColumn: 'id',
          ascOrDesc: 'asc',
          primaryKey: 'id',
          formatColumnFn: undefined,
        }
      ).execute();
      expect(result).toEqual(nodes.sort((a, b) => a.id - b.id));
    });

    it('formats column', async () => {
      const nodes = factory.buildList(10);
      await db.insertInto('test_table').values(nodes).execute();
      const result = await applyOrderBy(
        db.selectFrom('test_table').selectAll(),
        {
          orderColumn: 'age',
          ascOrDesc: 'asc',
          primaryKey: 'id',
          formatColumnFn: (c) => {
            if (c === 'age') return 'id';
            return c;
          },
        }
      ).execute();
      expect(result).toEqual(nodes.sort((a, b) => a.id - b.id));
    });

    it('orders the nodes by the given column', async () => {
      const nodes = factory.buildList(10);
      await db.insertInto('test_table').values(nodes).execute();
      const result = await applyOrderBy(
        db.selectFrom('test_table').selectAll(),
        {
          orderColumn: 'age',
          ascOrDesc: 'asc',
          primaryKey: 'id',
          formatColumnFn: undefined,
        }
      ).execute();
      expect(result).toEqual(nodes.sort((a, b) => a.age - b.age));
    });

    it('orders the nodes by the given column desc', async () => {
      const nodes = factory.buildList(10);
      await db.insertInto('test_table').values(nodes).execute();
      const result = await applyOrderBy(
        db.selectFrom('test_table').selectAll(),
        {
          orderColumn: 'age',
          ascOrDesc: 'desc',
          primaryKey: 'id',
          formatColumnFn: undefined,
        }
      ).execute();
      expect(result).toEqual(nodes.sort((a, b) => b.age - a.age));
    });
  });

  describe('applyAfterCursor', () => {
    // Used when `after` is included in the query
    // It must slice the result set from the element after the one with the given cursor until the end.
    // e.g. let [A, B, C, D] be the `resultSet`
    // removeNodesBeforeAndIncluding(resultSet, 'B') should return [C, D]
    it('id asc', async () => {
      const nodes = factory.buildList(10).sort((a, b) => a.id - b.id);
      const edges = convertNodesToEdges<TestDatabase, 'test_table', TestNode>(
        nodes,
        undefined,
        {
          orderColumn: 'id',
          primaryKey: 'id',
          ascOrDesc: 'asc',
        }
      );
      await db.insertInto('test_table').values(nodes).execute();
      const result = await applyAfterCursor(
        db.selectFrom('test_table').selectAll(),
        edges[5].cursor,
        {
          orderColumn: 'id',
          primaryKey: 'id',
          ascOrDesc: 'asc',
          isAggregateFn: undefined,
          formatColumnFn: undefined,
        }
      ).execute();
      expect(result).toEqual(nodes.slice(6));
    });

    it('id desc', async () => {
      const nodes = factory.buildList(10).sort((a, b) => a.id - b.id);
      const edges = convertNodesToEdges<TestDatabase, 'test_table', TestNode>(
        nodes,
        undefined,
        {
          orderColumn: 'id',
          primaryKey: 'id',
          ascOrDesc: 'desc',
        }
      );
      await db.insertInto('test_table').values(nodes).execute();
      const result = await applyAfterCursor(
        db.selectFrom('test_table').selectAll(),
        edges[5].cursor,
        {
          orderColumn: 'id',
          primaryKey: 'id',
          ascOrDesc: 'desc',
          isAggregateFn: undefined,
          formatColumnFn: undefined,
        }
      ).execute();

      expect(result).toEqual(nodes.slice(0, 5));
    });

    it('multi-column with null in last order column (after cursor)', async () => {
      // Exercises the branch where lastValue === null in buildRemoveNodesFromBeforeOrAfter:
      // (primaryKey comparator id) OR (lastOrderColumn is not null)
      const nodes: TestNode[] = [
        { id: 1, age: 10, name: 'a' },
        { id: 2, age: 10, name: null },
        { id: 3, age: 10, name: 'b' },
        { id: 4, age: 20, name: 'c' },
      ];
      await db.insertInto('test_table').values(nodes).execute();
      const edges = convertNodesToEdges<TestDatabase, 'test_table', TestNode>(
        nodes,
        undefined,
        {
          orderColumn: ['age', 'name'],
          primaryKey: 'id',
          ascOrDesc: ['asc', 'asc'],
        }
      );
      const cursorOfNullName = edges.find((e) => e.node.name === null)!.cursor;
      const result = await applyAfterCursor(
        db.selectFrom('test_table').selectAll(),
        cursorOfNullName,
        {
          orderColumn: ['age', 'name'],
          primaryKey: 'id',
          ascOrDesc: ['asc', 'asc'],
          isAggregateFn: undefined,
          formatColumnFn: undefined,
        }
      ).execute();
      // Connection order (age asc, name asc): null first, then 'a', 'b', then age 20. So after (2, 10, null) we want (1, 10, 'a'), (3, 10, 'b'), (4, 20, 'c').
      expect(result).toHaveLength(3);
      expect(new Set(result.map((r) => r.id))).toEqual(new Set([1, 3, 4]));
    });
  });

  describe('applyBeforeCursor', () => {
    // Used when `before` is included in the query
    // It must remove all nodes after and including the one with cursor `cursorOfInitialNode`
    // e.g. let [A, B, C, D] be the `resultSet`
    // removeNodesAfterAndIncluding(resultSet, 'C') should return [A, B]

    it('id asc', async () => {
      const nodes = factory.buildList(10).sort((a, b) => a.id - b.id);
      const edges = convertNodesToEdges<TestDatabase, 'test_table', TestNode>(
        nodes,
        undefined,
        {
          orderColumn: 'id',
          primaryKey: 'id',
          ascOrDesc: 'asc',
        }
      );
      await db.insertInto('test_table').values(nodes).execute();
      const result = await applyBeforeCursor(
        db.selectFrom('test_table').selectAll(),
        edges[5].cursor,
        {
          orderColumn: 'id',
          primaryKey: 'id',
          ascOrDesc: 'asc',
          isAggregateFn: undefined,
          formatColumnFn: undefined,
        }
      ).execute();
      expect(result).toEqual(nodes.slice(0, 5));
    });

    it('id desc', async () => {
      const nodes = factory.buildList(10).sort((a, b) => a.id - b.id);
      const edges = convertNodesToEdges<TestDatabase, 'test_table', TestNode>(
        nodes,
        undefined,
        {
          orderColumn: 'id',
          primaryKey: 'id',
          ascOrDesc: 'desc',
        }
      );
      await db.insertInto('test_table').values(nodes).execute();
      const result = await applyBeforeCursor(
        db.selectFrom('test_table').selectAll(),
        edges[5].cursor,
        {
          orderColumn: 'id',
          primaryKey: 'id',
          ascOrDesc: 'desc',
          isAggregateFn: undefined,
          formatColumnFn: undefined,
        }
      ).execute();

      expect(result).toEqual(nodes.slice(6));
    });

    it('multi-column with null in last order column (before cursor)', async () => {
      const nodes: TestNode[] = [
        { id: 1, age: 10, name: 'a' },
        { id: 2, age: 10, name: null },
        { id: 3, age: 10, name: 'b' },
        { id: 4, age: 20, name: 'c' },
      ];
      await db.insertInto('test_table').values(nodes).execute();
      const edges = convertNodesToEdges<TestDatabase, 'test_table', TestNode>(
        nodes,
        undefined,
        {
          orderColumn: ['age', 'name'],
          primaryKey: 'id',
          ascOrDesc: ['asc', 'asc'],
        }
      );
      const cursorOfNameB = edges.find((e) => e.node.name === 'b')!.cursor;
      const result = await applyBeforeCursor(
        db.selectFrom('test_table').selectAll(),
        cursorOfNameB,
        {
          orderColumn: ['age', 'name'],
          primaryKey: 'id',
          ascOrDesc: ['asc', 'asc'],
          isAggregateFn: undefined,
          formatColumnFn: undefined,
        }
      ).execute();
      // Before cursor of (3, 10, 'b'): rows with (age < 10), or (age=10 and name < 'b'),
      // or (name='b' and id < 3). SQL NULL < 'b' is NULL (falsy), so id=2 is excluded.
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe(1);
    });
  });

  it('returnNodesForFirst', async () => {
    const nodes = factory.buildList(10).sort((a, b) => a.id - b.id);
    await db.insertInto('test_table').values(nodes).execute();
    const result = await returnNodesForFirst(
      db.selectFrom('test_table').selectAll(),
      3
    );
    expect(result).toEqual(nodes.slice(0, 3));
  });

  describe('returnNodesForLast', () => {
    it('id asc', async () => {
      const nodes = factory.buildList(10).sort((a, b) => b.id - a.id);
      await db.insertInto('test_table').values(nodes).execute();
      const result = await returnNodesForLast(
        db.selectFrom('test_table').selectAll(),
        3,
        {
          orderColumn: 'id',
          primaryKey: 'id',
          ascOrDesc: 'asc',
        }
      );

      // Connection order: [extra, ...last N] in asc order, so 3 largest as [nodes[2], nodes[1], nodes[0]]
      expect(result).toEqual([nodes[2], nodes[1], nodes[0]]);
    });

    it('id desc', async () => {
      const nodes = factory.buildList(10).sort((a, b) => a.id - b.id);
      await db.insertInto('test_table').values(nodes).execute();
      const result = await returnNodesForLast(
        db.selectFrom('test_table').selectAll(),
        3,
        {
          orderColumn: 'id',
          primaryKey: 'id',
          ascOrDesc: 'desc',
        }
      );

      // Connection order desc: [largest...smallest]. Last 3 = 3 smallest = [nodes[2], nodes[1], nodes[0]]
      expect(result).toEqual([nodes[2], nodes[1], nodes[0]]);
    });
  });

  describe('paginate', () => {
    let nodes: TestNode[];
    let edges: Edge<TestNode>[];

    beforeEach(async () => {
      nodes = factory.buildList(10).sort((a, b) => a.id - b.id);
      edges = convertNodesToEdges<TestDatabase, 'test_table', TestNode>(
        nodes,
        undefined,
        {
          orderColumn: 'id',
          primaryKey: 'id',
          ascOrDesc: 'asc',
        }
      );
      await db.insertInto('test_table').values(nodes).execute();
    });

    describe('backwards pagination', () => {
      it('brings last 2 at the end', async () => {
        const result = await paginate(db.selectFrom('test_table').selectAll(), {
          last: 2,
        });
        expect(result).toEqual({
          totalCount: 10,
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: true,
            startCursor: edges[8].cursor,
            endCursor: edges[9].cursor,
          },
          edges: edges.slice(8, 10),
        });
      });

      it('brings last 2 in the middle', async () => {
        const result = await paginate(db.selectFrom('test_table').selectAll(), {
          last: 2,
          before: edges[8].cursor,
        });
        expect(result).toEqual({
          totalCount: 10,
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: true,
            startCursor: edges[6].cursor,
            endCursor: edges[7].cursor,
          },
          edges: edges.slice(6, 8),
        });
      });

      it('brings last 2 at the beginning', async () => {
        const result = await paginate(db.selectFrom('test_table').selectAll(), {
          last: 2,
          before: edges[2].cursor,
        });
        expect(result).toEqual({
          edges: edges.slice(0, 2),
          totalCount: 10,
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: false,
            startCursor: edges[0].cursor,
            endCursor: edges[1].cursor,
          },
        });
      });
    });

    describe('forward pagination', () => {
      it('brings first 2 at the beginning', async () => {
        const result = await paginate(db.selectFrom('test_table').selectAll(), {
          first: 2,
        });
        expect(result).toEqual({
          totalCount: 10,
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: false,
            startCursor: edges[0].cursor,
            endCursor: edges[1].cursor,
          },
          edges: edges.slice(0, 2),
        });
      });

      it('brings first 2 in the middle', async () => {
        const result = await paginate(db.selectFrom('test_table').selectAll(), {
          first: 2,
          after: edges[1].cursor,
        });
        expect(result).toEqual({
          totalCount: 10,
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: true,
            startCursor: edges[2].cursor,
            endCursor: edges[3].cursor,
          },
          edges: edges.slice(2, 4),
        });
      });

      it('brings first 2 at the end', async () => {
        const result = await paginate(db.selectFrom('test_table').selectAll(), {
          first: 2,
          after: edges[7].cursor,
        });
        expect(result).toEqual({
          edges: edges.slice(8, 10),
          totalCount: 10,
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: true,
            startCursor: edges[8].cursor,
            endCursor: edges[9].cursor,
          },
        });
      });
    });

    describe('cursor stability', () => {
      it('remains stable after adding an element to the list', async () => {
        const result = await paginate(db.selectFrom('test_table').selectAll(), {
          first: 3,
        });
        const { cursor } = result.edges[0];

        await db
          .insertInto('test_table')
          .values({ id: 0, name: null, age: 0 })
          .execute();

        const result2 = await paginate(
          db.selectFrom('test_table').selectAll(),
          {
            first: 3,
          }
        );
        const newCursor = result2.edges[1].cursor;
        expect(cursor).toEqual(newCursor);
      });
    });

    describe('sorting', () => {
      it('sorts asc and desc correctly by id', async () => {
        const result = await paginate(db.selectFrom('test_table').selectAll(), {
          first: 3,
          orderBy: 'id',
          orderDirection: 'asc',
        });

        expect(result).toEqual({
          totalCount: 10,
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: false,
            startCursor: edges[0].cursor,
            endCursor: edges[2].cursor,
          },
          edges: edges.slice(0, 3),
        });

        const result2 = await paginate(
          db.selectFrom('test_table').selectAll(),
          {
            first: 3,
            orderBy: 'id',
            orderDirection: 'desc',
          }
        );

        expect(result2).toEqual({
          totalCount: 10,
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: false,
            startCursor: edges[9].cursor,
            endCursor: edges[7].cursor,
          },
          edges: [edges[9], edges[8], edges[7]],
        });
      });

      it('sorts asc and desc correctly when result set is segmented', async () => {
        const result = await paginate(db.selectFrom('test_table').selectAll(), {
          first: 2,
          orderBy: 'id',
          orderDirection: 'desc',
        });

        expect(result).toEqual({
          totalCount: 10,
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: false,
            startCursor: edges[9].cursor,
            endCursor: edges[8].cursor,
          },
          edges: edges.reverse().slice(0, 2),
        });

        const result2 = await paginate(
          db.selectFrom('test_table').selectAll(),
          {
            first: 1,
            after: result.edges[1].cursor,
            orderBy: 'id',
            orderDirection: 'desc',
          }
        );

        expect(result2).toEqual({
          totalCount: 10,
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: true,
            startCursor: edges[2].cursor,
            endCursor: edges[2].cursor,
          },
          edges: edges.slice(2, 3),
        });
      });

      it('sorts correctly when sorting by a non unique column and it gets segmentated', async () => {
        const additionalNode = factory.build({
          name: nodes[0].name,
        });
        nodes.push(additionalNode);
        nodes = nodes.sort((a, b) =>
          a.name !== b.name
            ? (a.name ?? '').localeCompare(b.name ?? '')
            : a.id - b.id
        );
        edges = convertNodesToEdges<TestDatabase, 'test_table', TestNode>(
          nodes,
          undefined,
          {
            orderColumn: 'name',
            primaryKey: 'id',
            ascOrDesc: 'asc',
          }
        );
        await db.insertInto('test_table').values(additionalNode).execute();

        const result = await paginate(db.selectFrom('test_table').selectAll(), {
          first: 2,
          orderBy: 'name',
          orderDirection: 'asc',
        });

        expect(result).toEqual({
          totalCount: 11,
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: false,
            startCursor: edges[0].cursor,
            endCursor: edges[1].cursor,
          },
          edges: edges.slice(0, 2),
        });

        const result2 = await paginate(
          db.selectFrom('test_table').selectAll(),
          {
            first: 2,
            after: result.edges[1].cursor,
            orderBy: 'name',
            orderDirection: 'asc',
          }
        );

        expect(result2).toEqual({
          totalCount: 11,
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: true,
            startCursor: edges[2].cursor,
            endCursor: edges[3].cursor,
          },
          edges: edges.slice(2, 4),
        });
      });

      it('can sort by multiple columns', async () => {
        const additionalNode = factory.build({
          name: nodes[0].name,
        });
        nodes.push(additionalNode);
        nodes = nodes.sort((a, b) =>
          a.name !== b.name
            ? (a.name ?? '').localeCompare(b.name ?? '')
            : a.age - b.age
        );
        edges = convertNodesToEdges<TestDatabase, 'test_table', TestNode>(
          nodes,
          undefined,
          {
            orderColumn: ['name', 'age'],
            primaryKey: 'id',
            ascOrDesc: ['asc', 'asc'],
          }
        );
        await db.insertInto('test_table').values(additionalNode).execute();

        const result = await paginate(db.selectFrom('test_table').selectAll(), {
          first: 2,
          orderBy: ['name', 'age'],
          orderDirection: ['asc', 'asc'],
        });

        expect(result).toEqual({
          totalCount: 11,
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: false,
            startCursor: edges[0].cursor,
            endCursor: edges[1].cursor,
          },
          edges: edges.slice(0, 2),
        });

        const result2 = await paginate(
          db.selectFrom('test_table').selectAll(),
          {
            first: 2,
            after: result.edges[1].cursor,
            orderBy: ['name', 'age'],
            orderDirection: ['asc', 'asc'],
          }
        );

        expect(result2).toEqual({
          totalCount: 11,
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: true,
            startCursor: edges[2].cursor,
            endCursor: edges[3].cursor,
          },
          edges: edges.slice(2, 4),
        });
      });

      it('can sort by multiple columns using reverse pagination', async () => {
        const additionalNode = factory.build({
          name: nodes[0].name,
        });
        nodes.push(additionalNode);
        nodes = nodes.sort((a, b) =>
          a.name !== b.name
            ? (a.name ?? '').localeCompare(b.name ?? '')
            : a.age - b.age
        );
        edges = convertNodesToEdges<TestDatabase, 'test_table', TestNode>(
          nodes,
          undefined,
          {
            orderColumn: ['name', 'age'],
            primaryKey: 'id',
            ascOrDesc: 'asc',
          }
        );
        await db.insertInto('test_table').values(additionalNode).execute();

        const result = await paginate(db.selectFrom('test_table').selectAll(), {
          last: 2,
          orderBy: ['name', 'age'],
          orderDirection: ['asc', 'asc'],
        });

        expect(result).toEqual({
          totalCount: 11,
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: true,
            startCursor: edges[9].cursor,
            endCursor: edges[10].cursor,
          },
          edges: edges.slice(9, 11),
        });

        const result2 = await paginate(
          db.selectFrom('test_table').selectAll(),
          {
            last: 2,
            before: result.edges[0].cursor,
            orderBy: ['name', 'age'],
            orderDirection: ['asc', 'asc'],
          }
        );

        expect(result2).toEqual({
          totalCount: 11,
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: true,
            startCursor: edges[7].cursor,
            endCursor: edges[8].cursor,
          },
          edges: edges.slice(7, 9),
        });
      });

      it('returns correct last N when rows tie on sort column and differ only by primaryKey', async () => {
        await db.deleteFrom('test_table').execute();
        const tiedNodes: TestNode[] = [
          { id: 1, name: 'same', age: 10 },
          { id: 2, name: 'same', age: 20 },
          { id: 3, name: 'same', age: 30 },
          { id: 4, name: 'same', age: 40 },
        ];
        await db.insertInto('test_table').values(tiedNodes).execute();
        const tiedEdges = convertNodesToEdges<
          TestDatabase,
          'test_table',
          TestNode
        >(tiedNodes, undefined, {
          orderColumn: 'name',
          primaryKey: 'id',
          ascOrDesc: 'asc',
        });

        const result = await paginate(db.selectFrom('test_table').selectAll(), {
          last: 2,
          orderBy: 'name',
          orderDirection: 'asc',
        });

        expect(result).toEqual({
          totalCount: 4,
          pageInfo: {
            hasNextPage: false,
            hasPreviousPage: true,
            startCursor: tiedEdges[2].cursor,
            endCursor: tiedEdges[3].cursor,
          },
          edges: tiedEdges.slice(2, 4),
        });
      });

      it('can sort by aggregate value', async () => {
        const result = await paginate(
          db
            .selectFrom('test_table')
            .select(({ fn }) => [
              fn.sum<number>('id').as('idsum'),
              'test_table.id',
              'test_table.name',
              'test_table.age',
            ])
            .groupBy('test_table.id'),
          {
            first: 3,
            orderBy: 'idsum' as any,
            orderDirection: 'asc',
          },
          {
            isAggregateFn: (column: any) => column === 'idsum',
            formatColumnFn: (column: any) =>
              column === 'idsum' ? sql`sum(id)` : column,
          }
        );

        expect(result.edges).toHaveLength(3);
        expect(result.pageInfo.hasNextPage).toBe(true);
        expect(result.pageInfo.hasPreviousPage).toBe(false);
        expect(result.totalCount).toBe(10);

        // Verify ordering: sum(id) for each row equals the id itself (group of 1)
        expect(result.edges[0].node.id).toBe(nodes[0].id);
        expect(result.edges[1].node.id).toBe(nodes[1].id);
        expect(result.edges[2].node.id).toBe(nodes[2].id);

        const result2 = await paginate(
          db
            .selectFrom('test_table')
            .select(({ fn }) => [
              fn.sum<number>('id').as('idsum'),
              'test_table.id',
              'test_table.name',
              'test_table.age',
            ])
            .groupBy('test_table.id'),
          {
            first: 1,
            after: result.pageInfo.endCursor,
            orderBy: 'idsum' as any,
            orderDirection: 'asc',
          },
          {
            isAggregateFn: (column: any) => column === 'idsum',
            formatColumnFn: (column: any) =>
              column === 'idsum' ? sql`sum(id)` : column,
          }
        );

        expect(result2.edges).toHaveLength(1);
        expect(result2.edges[0].node.id).toBe(nodes[3].id);
        expect(result2.pageInfo.hasNextPage).toBe(true);
        expect(result2.pageInfo.hasPreviousPage).toBe(true);
      });
    });

    describe('totalCount', () => {
      it('brings the correct amount for a non-segmented query', async () => {
        const result = await paginate(db.selectFrom('test_table').selectAll(), {
          first: 2,
        });

        expect(result.totalCount).toEqual(10);
      });

      it('paginates segmentating by null values', async () => {
        nodes = nodes.sort((a, b) =>
          a.name === b.name
            ? a.id - b.id
            : (a.name ?? '').localeCompare(b.name ?? '')
        );

        await db
          .updateTable('test_table')
          .set({ name: null })
          .where('id', '=', nodes[0].id)
          .execute();

        nodes[0].name = null;

        edges = convertNodesToEdges<TestDatabase, 'test_table', TestNode>(
          nodes,
          undefined,
          {
            orderColumn: 'name',
            primaryKey: 'id',
            ascOrDesc: 'asc',
          }
        );

        const result = await paginate(db.selectFrom('test_table').selectAll(), {
          first: 2,
          orderBy: 'name',
          orderDirection: 'asc',
        });

        expect(result).toEqual({
          edges: edges.slice(0, 2),
          totalCount: 10,
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: false,
            startCursor: edges[0].cursor,
            endCursor: edges[1].cursor,
          },
        });

        const result2 = await paginate(
          db.selectFrom('test_table').selectAll(),
          {
            first: 2,
            after: result.edges[1].cursor,
            orderBy: 'name',
            orderDirection: 'asc',
          }
        );

        expect(result2).toEqual({
          edges: edges.slice(2, 4),
          totalCount: 10,
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: true,
            startCursor: edges[2].cursor,
            endCursor: edges[3].cursor,
          },
        });
      });

      it('paginates segmentating in the middle of null values', async () => {
        nodes = nodes.sort((a, b) =>
          a.name === b.name
            ? a.id - b.id
            : (a.name ?? '').localeCompare(b.name ?? '')
        );

        await db
          .updateTable('test_table')
          .set({ name: null })
          .where('id', '=', nodes[1].id)
          .execute();
        await db
          .updateTable('test_table')
          .set({ name: null })
          .where('id', '=', nodes[2].id)
          .execute();

        nodes[1].name = null;
        nodes[2].name = null;

        nodes = nodes.sort((a, b) =>
          a.name === b.name
            ? a.id - b.id
            : (a.name ?? '').localeCompare(b.name ?? '')
        );

        edges = convertNodesToEdges<TestDatabase, 'test_table', TestNode>(
          nodes,
          undefined,
          {
            orderColumn: 'name',
            primaryKey: 'id',
            ascOrDesc: 'asc',
          }
        );

        const result = await paginate(db.selectFrom('test_table').selectAll(), {
          first: 1,
          orderBy: 'name',
          orderDirection: 'asc',
        });

        expect(result).toEqual({
          edges: edges.slice(0, 1),
          totalCount: 10,
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: false,
            startCursor: edges[0].cursor,
            endCursor: edges[0].cursor,
          },
        });

        const result2 = await paginate(
          db.selectFrom('test_table').selectAll(),
          {
            first: 2,
            after: result.edges[0].cursor,
            orderBy: 'name',
            orderDirection: 'asc',
          }
        );

        expect(result2).toEqual({
          edges: edges.slice(1, 3),
          totalCount: 10,
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: true,
            startCursor: edges[1].cursor,
            endCursor: edges[2].cursor,
          },
        });
      });
    });

    describe('modifyEdgeFn', () => {
      it('modifies edges per the callback', async () => {
        const result = await paginate(
          db.selectFrom('test_table').selectAll(),
          {
            first: 2,
          },
          {
            modifyEdgeFn(edge) {
              return {
                cursor: edge.cursor,
                custom: 'test',
                node: edge.node as unknown as any,
              };
            },
          }
        );
        expect(result).toEqual({
          totalCount: 10,
          pageInfo: {
            hasNextPage: true,
            hasPreviousPage: false,
            startCursor: edges[0].cursor,
            endCursor: edges[1].cursor,
          },
          edges: edges.slice(0, 2).map((edge) => ({
            ...edge,
            custom: 'test',
          })),
        });
      });
    });
  });

  describe('paginate with joins', () => {
    const joinedQuery = () =>
      db
        .selectFrom('test_table')
        .innerJoin('other_table', 'test_table.id', 'other_table.test_table_id')
        .select([
          'test_table.id',
          'test_table.name',
          'test_table.age',
          'other_table.id as other_id',
          'other_table.test_table_id',
          'other_table.label',
        ]);

    const joinedPaginateOpts = {
      formatColumnFn: (
        col: ReferenceExpression<TestDatabase, 'test_table' | 'other_table'>
      ) =>
        `test_table.${String(col)}` as ReferenceExpression<
          TestDatabase,
          'test_table' | 'other_table'
        >,
    };

    it('paginates joined result forward with first and after', async () => {
      const nodes: TestNode[] = [
        { id: 1, name: 'a', age: 10 },
        { id: 2, name: 'b', age: 20 },
        { id: 3, name: 'c', age: 30 },
      ];
      await db.insertInto('test_table').values(nodes).execute();
      await db
        .insertInto('other_table')
        .values([
          { id: 1, test_table_id: 1, label: 'x' },
          { id: 2, test_table_id: 2, label: 'y' },
          { id: 3, test_table_id: 3, label: 'z' },
        ])
        .execute();

      const firstPage = await paginate(
        joinedQuery(),
        {
          first: 2,
          orderBy: 'id',
          orderDirection: 'asc',
        },
        joinedPaginateOpts
      );

      expect(firstPage.totalCount).toBe(3);
      expect(firstPage.edges).toHaveLength(2);
      expect(firstPage.edges[0].node.id).toBe(1);
      expect(firstPage.edges[0].node.label).toBe('x');
      expect(firstPage.edges[1].node.id).toBe(2);
      expect(firstPage.edges[1].node.label).toBe('y');
      expect(firstPage.pageInfo.hasNextPage).toBe(true);

      const secondPage = await paginate(
        joinedQuery(),
        {
          first: 2,
          after: firstPage.pageInfo.endCursor,
          orderBy: 'id',
          orderDirection: 'asc',
        },
        joinedPaginateOpts
      );
      expect(secondPage.edges).toHaveLength(1);
      expect(secondPage.edges[0].node.id).toBe(3);
      expect(secondPage.edges[0].node.label).toBe('z');
      expect(secondPage.pageInfo.hasNextPage).toBe(false);
    });

    it('paginates joined result with orderBy joined column', async () => {
      const nodes: TestNode[] = [
        { id: 1, name: 'a', age: 30 },
        { id: 2, name: 'b', age: 10 },
        { id: 3, name: 'c', age: 20 },
      ];
      await db.insertInto('test_table').values(nodes).execute();
      await db
        .insertInto('other_table')
        .values([
          { id: 1, test_table_id: 1, label: 'x' },
          { id: 2, test_table_id: 2, label: 'y' },
          { id: 3, test_table_id: 3, label: 'z' },
        ])
        .execute();

      const result = await paginate(
        joinedQuery(),
        {
          first: 2,
          orderBy: 'age',
          orderDirection: 'asc',
        },
        joinedPaginateOpts
      );
      expect(result.totalCount).toBe(3);
      expect(result.edges[0].node.age).toBe(10);
      expect(result.edges[0].node.label).toBe('y');
      expect(result.edges[1].node.age).toBe(20);
      expect(result.edges[1].node.label).toBe('z');
    });

    it('paginates joined result backwards with last and before', async () => {
      const nodes: TestNode[] = [
        { id: 1, name: 'a', age: 10 },
        { id: 2, name: 'b', age: 20 },
        { id: 3, name: 'c', age: 30 },
      ];
      await db.insertInto('test_table').values(nodes).execute();
      await db
        .insertInto('other_table')
        .values([
          { id: 1, test_table_id: 1, label: 'x' },
          { id: 2, test_table_id: 2, label: 'y' },
          { id: 3, test_table_id: 3, label: 'z' },
        ])
        .execute();

      const lastPage = await paginate(
        joinedQuery(),
        {
          last: 2,
          orderBy: 'id',
          orderDirection: 'asc',
        },
        joinedPaginateOpts
      );
      expect(lastPage.totalCount).toBe(3);
      expect(lastPage.edges).toHaveLength(2);
      expect(lastPage.edges[0].node.id).toBe(2);
      expect(lastPage.edges[1].node.id).toBe(3);
      expect(lastPage.pageInfo.hasPreviousPage).toBe(true);

      const prevPage = await paginate(
        joinedQuery(),
        {
          last: 2,
          before: lastPage.pageInfo.startCursor,
          orderBy: 'id',
          orderDirection: 'asc',
        },
        joinedPaginateOpts
      );
      // Connection order [1, 2, 3]; before cursor of 2 we have only row 1
      expect(prevPage.edges).toHaveLength(1);
      expect(prevPage.edges[0].node.id).toBe(1);
    });

    it('paginates one-to-many join without duplicating or skipping rows', async () => {
      const nodes: TestNode[] = [
        { id: 1, name: 'a', age: 10 },
        { id: 2, name: 'b', age: 20 },
        { id: 3, name: 'c', age: 30 },
      ];
      await db.insertInto('test_table').values(nodes).execute();
      await db
        .insertInto('other_table')
        .values([
          { id: 1, test_table_id: 1, label: 'x1' },
          { id: 2, test_table_id: 1, label: 'x2' },
          { id: 3, test_table_id: 2, label: 'y' },
          { id: 4, test_table_id: 3, label: 'z' },
        ])
        .execute();

      const firstPage = await paginate(
        joinedQuery(),
        {
          first: 2,
          orderBy: 'id',
          orderDirection: 'asc',
        },
        joinedPaginateOpts
      );

      // Row fan-out: id=1 appears twice due to two other_table rows
      expect(firstPage.totalCount).toBe(4);
      expect(firstPage.edges).toHaveLength(2);
      expect(firstPage.edges[0].node.id).toBe(1);
      expect(firstPage.edges[0].node.label).toBe('x1');
      expect(firstPage.edges[1].node.id).toBe(1);
      expect(firstPage.edges[1].node.label).toBe('x2');
      expect(firstPage.pageInfo.hasNextPage).toBe(true);

      const secondPage = await paginate(
        joinedQuery(),
        {
          first: 2,
          after: firstPage.pageInfo.endCursor,
          orderBy: 'id',
          orderDirection: 'asc',
        },
        joinedPaginateOpts
      );
      expect(secondPage.edges).toHaveLength(2);
      expect(secondPage.edges[0].node.id).toBe(2);
      expect(secondPage.edges[1].node.id).toBe(3);
      expect(secondPage.pageInfo.hasNextPage).toBe(false);
    });
  });
});
