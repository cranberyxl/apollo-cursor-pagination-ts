import { describe, it, expect } from '@jest/globals';
import paginateArray from '..';

interface User {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

describe('Array Paginator', () => {
  const users: User[] = [
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
    {
      id: '4',
      name: 'Diana',
      email: 'diana@example.com',
      createdAt: '2023-01-04',
    },
    { id: '5', name: 'Eve', email: 'eve@example.com', createdAt: '2023-01-05' },
    {
      id: '6',
      name: 'Frank',
      email: 'frank@example.com',
      createdAt: '2023-01-06',
    },
    {
      id: '7',
      name: 'Grace',
      email: 'grace@example.com',
      createdAt: '2023-01-07',
    },
    {
      id: '8',
      name: 'Henry',
      email: 'henry@example.com',
      createdAt: '2023-01-08',
    },
  ];

  it('should paginate with first parameter', async () => {
    const result = await paginateArray(users, { first: 3 });

    expect(result.edges).toHaveLength(3);
    expect(result.pageInfo.hasNextPage).toBe(true);
    expect(result.pageInfo.hasPreviousPage).toBe(false);
    expect(result.totalCount).toBe(8);
    expect(result.edges[0].node.id).toBe('1');
    expect(result.edges[1].node.id).toBe('2');
    expect(result.edges[2].node.id).toBe('3');
  });

  it('should paginate with after cursor', async () => {
    const firstResult = await paginateArray(users, { first: 3 });
    const afterCursor = firstResult.edges[2].cursor;

    const result = await paginateArray(users, {
      first: 3,
      after: afterCursor,
    });

    expect(result.edges).toHaveLength(3);
    expect(result.pageInfo.hasNextPage).toBe(true);
    expect(result.pageInfo.hasPreviousPage).toBe(true);
    expect(result.edges[0].node.id).toBe('4');
    expect(result.edges[1].node.id).toBe('5');
    expect(result.edges[2].node.id).toBe('6');
  });

  it('should paginate with last parameter', async () => {
    const result = await paginateArray(users, { last: 3 });

    expect(result.edges).toHaveLength(3);
    expect(result.pageInfo.hasNextPage).toBe(false);
    expect(result.pageInfo.hasPreviousPage).toBe(true);
    expect(result.edges[0].node.id).toBe('6');
    expect(result.edges[1].node.id).toBe('7');
    expect(result.edges[2].node.id).toBe('8');
  });

  it('should paginate with before cursor', async () => {
    const firstResult = await paginateArray(users, { first: 6 });
    const beforeCursor = firstResult.edges[5].cursor;

    const result = await paginateArray(users, {
      last: 3,
      before: beforeCursor,
    });

    expect(result.edges).toHaveLength(3);
    expect(result.pageInfo.hasNextPage).toBe(true);
    expect(result.pageInfo.hasPreviousPage).toBe(true);
    expect(result.edges[0].node.id).toBe('3');
    expect(result.edges[1].node.id).toBe('4');
    expect(result.edges[2].node.id).toBe('5');
  });

  it('should sort by different columns', async () => {
    const result = await paginateArray(users, {
      first: 3,
      orderBy: 'name',
      orderDirection: 'desc',
    });

    expect(result.edges).toHaveLength(3);
    expect(result.edges[0].node.name).toBe('Henry');
    expect(result.edges[1].node.name).toBe('Grace');
    expect(result.edges[2].node.name).toBe('Frank');
  });

  it('should sort by multiple columns', async () => {
    const usersWithDupes = [
      {
        id: '1',
        name: 'Alice',
        email: 'alice@example.com',
        createdAt: '2023-01-01',
      },
      {
        id: '2',
        name: 'Bob',
        email: 'bob@example.com',
        createdAt: '2023-01-02',
      },
      {
        id: '3',
        name: 'Bob',
        email: 'bob2@example.com',
        createdAt: '2023-01-03',
      },
      {
        id: '4',
        name: 'Charlie',
        email: 'charlie@example.com',
        createdAt: '2023-01-04',
      },
      {
        id: '5',
        name: 'Diana',
        email: 'diana@example.com',
        createdAt: '2023-01-05',
      },
    ];
    // Sort by name ASC, then email DESC
    const result = await paginateArray(usersWithDupes, {
      first: 5,
      orderBy: ['name', 'email'],
      orderDirection: ['asc', 'desc'],
    });
    const ids = result.edges.map((e) => e.node.id);
    expect(ids).toEqual([
      '1', // Alice
      '3', // Bob, bob2@example.com (desc)
      '2', // Bob, bob@example.com (desc)
      '4', // Charlie
      '5', // Diana
    ]);
  });

  it('should handle custom primary key', async () => {
    const result = await paginateArray(
      users,
      {
        first: 3,
      },
      {
        primaryKey: 'email',
      }
    );

    expect(result.edges).toHaveLength(3);
    expect(result.edges[0].node.email).toBe('alice@example.com');
  });

  it('should skip total count when requested', async () => {
    const result = await paginateArray(
      users,
      { first: 3 },
      { skipTotalCount: true }
    );

    expect(result.edges).toHaveLength(3);
    expect(result.totalCount).toBeUndefined();
  });

  it('should handle empty array', async () => {
    const result = await paginateArray([], { first: 3 });

    expect(result.edges).toHaveLength(0);
    expect(result.pageInfo.hasNextPage).toBe(false);
    expect(result.pageInfo.hasPreviousPage).toBe(false);
    expect(result.totalCount).toBe(0);
  });

  it('should throw error when both first and last are provided', async () => {
    await expect(paginateArray(users, { first: 3, last: 3 })).rejects.toThrow(
      'Cannot specify both `first` and `last` arguments'
    );
  });

  it('should throw error when neither first nor last is provided', async () => {
    await expect(paginateArray(users, {})).rejects.toThrow(
      '`first` or `last` argument must be provided'
    );
  });

  it('should throw error when first is negative', async () => {
    await expect(paginateArray(users, { first: -1 })).rejects.toThrow(
      '`first` argument must not be less than 0'
    );
  });

  it('should throw error when last is negative', async () => {
    await expect(paginateArray(users, { last: -1 })).rejects.toThrow(
      '`last` argument must not be less than 0'
    );
  });
});
