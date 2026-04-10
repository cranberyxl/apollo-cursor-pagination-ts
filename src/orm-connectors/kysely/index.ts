import { ReferenceExpression, SelectQueryBuilder, sql } from 'kysely';
import apolloCursorPaginationBuilder, {
  decode,
  encode,
  OrderArgs,
} from '../../builder';

const SEPARATION_TOKEN = '_*_';
const ARRAY_DATA_SEPARATION_TOKEN = '_%_';

export const cursorGenerator = (
  id: string | number,
  customColumnValue: string
): string => encode(`${id}${SEPARATION_TOKEN}${customColumnValue}`);

export const getDataFromCursor = (cursor: string): [string, any[]] => {
  const decodedCursor = decode(cursor);
  const data = decodedCursor.split(SEPARATION_TOKEN);
  if (data[0] === undefined || data[1] === undefined) {
    throw new Error(`Could not find edge with cursor ${cursor}`);
  }
  const values = data[1]
    .split(ARRAY_DATA_SEPARATION_TOKEN)
    .map((v) => JSON.parse(v));
  return [data[0], values];
};

const operateOverScalarOrArray = <R, S>(
  initialValue: R,
  scalarOrArray: S | S[],
  operation: (scalar: S, index: number | null, prev: R) => R,
  operateResult?: (result: R, isArray: boolean) => R
): R => {
  let result = initialValue;
  const isArray = Array.isArray(scalarOrArray);
  if (isArray) {
    scalarOrArray.forEach((scalar, index) => {
      result = operation(scalar, index, result);
    });
  } else {
    result = operation(scalarOrArray, null, result);
  }
  if (operateResult) {
    result = operateResult(result, isArray);
  }

  return result;
};

const getComparator = (
  beforeOrAfter: 'before' | 'after',
  orderDirection: string
): '>' | '<' => {
  if (beforeOrAfter === 'after') return orderDirection === 'asc' ? '<' : '>';
  return orderDirection === 'asc' ? '>' : '<';
};

export const formatColumnIfAvailable = <DB, TB extends keyof DB>(
  column: ReferenceExpression<DB, TB>,
  formatColumnFn?: (
    column: ReferenceExpression<DB, TB>,
    isRaw?: boolean
  ) => ReferenceExpression<DB, TB>,
  isRaw = true
): ReferenceExpression<DB, TB> => {
  if (formatColumnFn) {
    return formatColumnFn(column, isRaw);
  }
  return column;
};

function buildRemoveNodesFromBeforeOrAfter<DB, TB extends keyof DB, TResult>(
  beforeOrAfter: 'before' | 'after'
) {
  return (
    nodesAccessor: SelectQueryBuilder<DB, TB, TResult>,
    cursorOfInitialNode: string,
    {
      orderColumn,
      ascOrDesc,
      isAggregateFn,
      formatColumnFn,
      primaryKey,
    }: OrderArgs<ReferenceExpression<DB, TB>, ReferenceExpression<DB, TB>>
  ): SelectQueryBuilder<DB, TB, TResult> => {
    const data = getDataFromCursor(cursorOfInitialNode);
    const [idRaw, columnValue] = data;
    // Coerce to number for integer PKs so SQLite compares numerically not lexicographically
    const id =
      idRaw !== '' && idRaw !== undefined && !Number.isNaN(Number(idRaw))
        ? Number(idRaw)
        : idRaw;

    const isArray = Array.isArray(orderColumn);
    if (
      (Array.isArray(ascOrDesc) && !isArray) ||
      (!Array.isArray(ascOrDesc) && isArray)
    ) {
      throw new Error('orderColumn must be an array if ascOrDesc is an array');
    }

    // Multi-column: Knex uses (cond0) OR (cond1) OR ... OR (compound). Build conditions and apply where(or([...])).
    if (isArray && Array.isArray(orderColumn)) {
      const orderCols = orderColumn;
      const values = columnValue;

      const operation =
        isAggregateFn && isAggregateFn(orderCols[orderCols.length - 1])
          ? 'having'
          : 'where';
      return nodesAccessor[operation](({ eb, and, or }) => {
        const conditions: ReturnType<typeof eb>[] = [];

        for (let index = 0; index < orderCols.length; index += 1) {
          const orderBy = orderCols[index];
          const orderDirection =
            Array.isArray(ascOrDesc) && ascOrDesc[index] !== undefined
              ? (ascOrDesc[index] as string).toLowerCase()
              : (typeof ascOrDesc === 'string'
                  ? ascOrDesc
                  : 'asc'
                ).toLowerCase();
          const comparator = getComparator(beforeOrAfter, orderDirection);
          const currValue = values[index];

          if (currValue !== null && currValue !== undefined) {
            if (index === 0) {
              conditions.push(
                eb(
                  formatColumnIfAvailable(orderBy, formatColumnFn),
                  comparator,
                  currValue
                )
              );
            } else {
              conditions.push(
                and([
                  eb(
                    formatColumnIfAvailable(
                      orderCols[index - 1],
                      formatColumnFn
                    ),
                    '=',
                    values[index - 1]
                  ),
                  eb(
                    formatColumnIfAvailable(orderBy, formatColumnFn),
                    comparator,
                    currValue
                  ),
                ])
              );
            }
          }
        }

        const lastOrderDirection = (
          Array.isArray(ascOrDesc) ? ascOrDesc[ascOrDesc.length - 1] : ascOrDesc
        ) as string;
        const lastComparator = getComparator(
          beforeOrAfter,
          lastOrderDirection.toLowerCase()
        );
        const lastOrderColumn = orderCols[orderCols.length - 1];
        const lastValue = values[values.length - 1];

        if (lastValue === null || lastValue === undefined) {
          conditions.push(
            or([
              eb(
                formatColumnIfAvailable(primaryKey, formatColumnFn),
                lastComparator,
                id
              ),
              eb(
                formatColumnIfAvailable(lastOrderColumn, formatColumnFn),
                'is not',
                null
              ),
            ])
          );
        } else {
          conditions.push(
            and([
              eb(
                formatColumnIfAvailable(lastOrderColumn, formatColumnFn),
                '=',
                lastValue
              ),
              eb(
                formatColumnIfAvailable(primaryKey, formatColumnFn),
                lastComparator,
                id
              ),
            ])
          );
        }

        return or(conditions);
      });
    }

    // Single column: iteration adds one where; skip compound in operateResult.
    const executeFilterQuery = (query: SelectQueryBuilder<DB, TB, TResult>) =>
      operateOverScalarOrArray(
        query,
        orderColumn,
        (orderBy, index, prev) => {
          const orderDirection =
            typeof ascOrDesc === 'string' ? ascOrDesc.toLowerCase() : 'asc';
          const [currValue] = columnValue;
          const comparator = getComparator(beforeOrAfter, orderDirection);

          const operation =
            isAggregateFn && isAggregateFn(orderBy) ? 'having' : 'where';

          if (currValue === null || currValue === undefined) {
            // Rows after cursor: (primaryKey > id) OR (orderColumn is not null)
            return prev[operation](({ eb, or }) =>
              or([
                eb(
                  formatColumnIfAvailable(primaryKey, formatColumnFn),
                  comparator,
                  id
                ),
                eb(
                  formatColumnIfAvailable(orderBy, formatColumnFn),
                  'is not',
                  sql`null`
                ),
              ])
            );
          }

          // (orderColumn > value) OR (orderColumn = value AND primaryKey > id) for tie-breaker
          return prev[operation](({ eb, or, and }) =>
            or([
              eb(
                formatColumnIfAvailable(orderBy, formatColumnFn),
                comparator,
                currValue
              ),
              and([
                eb(
                  formatColumnIfAvailable(orderBy, formatColumnFn),
                  '=',
                  currValue
                ),
                eb(
                  formatColumnIfAvailable(primaryKey, formatColumnFn),
                  comparator,
                  id
                ),
              ]),
            ])
          );
        },
        (prev) => prev
      );

    return executeFilterQuery(nodesAccessor);
  };
}

export const applyAfterCursor: <DB, TB extends keyof DB, TResult>(
  nodesAccessor: SelectQueryBuilder<DB, TB, TResult>,
  cursorOfInitialNode: string,
  opts: OrderArgs<ReferenceExpression<DB, TB>, ReferenceExpression<DB, TB>>
) => SelectQueryBuilder<DB, TB, TResult> =
  buildRemoveNodesFromBeforeOrAfter('before');

export const applyBeforeCursor: <DB, TB extends keyof DB, TResult>(
  nodesAccessor: SelectQueryBuilder<DB, TB, TResult>,
  cursorOfInitialNode: string,
  opts: OrderArgs<ReferenceExpression<DB, TB>, ReferenceExpression<DB, TB>>
) => SelectQueryBuilder<DB, TB, TResult> =
  buildRemoveNodesFromBeforeOrAfter('after');

export const returnTotalCount = async <DB, TB extends keyof DB, TResult>(
  nodesAccessor: SelectQueryBuilder<DB, TB, TResult>
): Promise<number> => {
  const counts = await nodesAccessor
    .clearSelect()
    .select(({ fn }) => [fn.countAll<number>().as('count')])
    .execute();

  const result = counts.reduce(
    (prev: number, curr: Record<string, unknown>) => {
      const currCount = (curr as { count: number }).count;
      if (!currCount) return prev;
      return Number(currCount) + prev;
    },
    0
  );
  return result;
};

export const returnNodesForFirst = async <DB, TB extends keyof DB, TResult>(
  nodesAccessor: SelectQueryBuilder<DB, TB, TResult>,
  count: number
): Promise<TResult[]> => {
  const result = await nodesAccessor.limit(count).execute();
  return result;
};

export const applyOrderBy = <DB, TB extends keyof DB, TResult>(
  nodesAccessor: SelectQueryBuilder<DB, TB, TResult>,
  {
    orderColumn,
    ascOrDesc,
    formatColumnFn,
    primaryKey,
    primaryKeyDirection = 'asc',
  }: OrderArgs<ReferenceExpression<DB, TB>, ReferenceExpression<DB, TB>> & {
    primaryKeyDirection?: 'asc' | 'desc';
  }
) => {
  const initialValue = nodesAccessor;
  const result = operateOverScalarOrArray(
    initialValue,
    orderColumn,
    (orderBy, index, prev) => {
      if (Array.isArray(ascOrDesc) && index !== null) {
        return prev.orderBy(
          formatColumnIfAvailable(
            orderBy,
            formatColumnFn,
            false
          ) as unknown as any,
          ascOrDesc[index]
        );
      }
      return prev.orderBy(
        formatColumnIfAvailable(
          orderBy,
          formatColumnFn,
          false
        ) as unknown as any,
        ascOrDesc as 'asc' | 'desc'
      );
    },
    (prev) =>
      prev.orderBy(
        formatColumnIfAvailable(
          primaryKey,
          formatColumnFn,
          false
        ) as unknown as any,
        primaryKeyDirection
      )
  );
  return result;
};

export const returnNodesForLast = async <DB, TB extends keyof DB, TResult>(
  nodesAccessor: SelectQueryBuilder<DB, TB, TResult>,
  count: number,
  {
    orderColumn,
    ascOrDesc,
    primaryKey,
    formatColumnFn,
  }: OrderArgs<ReferenceExpression<DB, TB>, ReferenceExpression<DB, TB>>
): Promise<TResult[]> => {
  const flipDir = (d: string) => (d === 'asc' ? 'desc' : 'asc');
  const invertedAscOrDesc = Array.isArray(ascOrDesc)
    ? ascOrDesc.map(flipDir)
    : flipDir(ascOrDesc as string);
  const orderedQuery = applyOrderBy(nodesAccessor.clearOrderBy(), {
    orderColumn,
    ascOrDesc: invertedAscOrDesc as 'asc' | 'desc' | ('asc' | 'desc')[],
    primaryKey,
    formatColumnFn,
    primaryKeyDirection: 'desc',
  }).limit(count);
  const result = await orderedQuery.execute();
  // The inverted query returns rows in reverse connection order. Always reverse
  // so result is [extra, ...last N] in connection order for the builder's slice(1).
  return result.reverse();
};

export const convertNodesToEdges = <DB, TB extends keyof DB, TResult>(
  nodes: TResult[],
  _: any,
  {
    orderColumn,
    primaryKey,
  }: OrderArgs<ReferenceExpression<DB, TB>, ReferenceExpression<DB, TB>>
): { cursor: string; node: TResult }[] =>
  nodes.map((node) => {
    const dataValue = operateOverScalarOrArray(
      '',
      orderColumn,
      (orderBy, index, prev) => {
        const nodeValue = node[orderBy as keyof TResult];
        if (nodeValue === undefined) {
          return prev;
        }
        const result = `${prev}${index ? ARRAY_DATA_SEPARATION_TOKEN : ''}${JSON.stringify(nodeValue)}`;
        return result;
      }
    );

    const nodePrimaryKey: string | number | undefined = node[
      primaryKey as keyof TResult
    ] as string | number | undefined;
    if (nodePrimaryKey === undefined) {
      throw new Error(`Could not find primary key ${primaryKey} in node`);
    }

    return {
      cursor: cursorGenerator(nodePrimaryKey, dataValue),
      node,
    };
  });

export default function paginate<DB, TB extends keyof DB, TResult>(
  query: SelectQueryBuilder<DB, TB, TResult>,
  params: Parameters<
    ReturnType<
      typeof apolloCursorPaginationBuilder<
        TResult,
        SelectQueryBuilder<DB, TB, TResult>,
        ReferenceExpression<DB, TB>,
        ReferenceExpression<DB, TB>
      >
    >
  >[1],
  opts?: Parameters<
    ReturnType<
      typeof apolloCursorPaginationBuilder<
        TResult,
        SelectQueryBuilder<DB, TB, TResult>,
        ReferenceExpression<DB, TB>,
        ReferenceExpression<DB, TB>
      >
    >
  >[2]
) {
  return apolloCursorPaginationBuilder<
    TResult,
    SelectQueryBuilder<DB, TB, TResult>,
    ReferenceExpression<DB, TB>,
    ReferenceExpression<DB, TB>
  >({
    applyAfterCursor: buildRemoveNodesFromBeforeOrAfter<DB, TB, TResult>(
      'before'
    ),
    applyBeforeCursor: buildRemoveNodesFromBeforeOrAfter<DB, TB, TResult>(
      'after'
    ),
    returnTotalCount,
    returnNodesForFirst,
    returnNodesForLast,
    convertNodesToEdges,
    applyOrderBy,
    defaultPrimaryKey: 'id' as any,
  })(query, params, opts);
}
