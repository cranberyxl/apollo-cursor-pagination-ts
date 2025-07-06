/* eslint-disable @typescript-eslint/no-empty-object-type */
import { Knex } from 'knex';
import apolloCursorPaginationBuilder, {
  decode,
  encode,
  OperatorFunctions,
  OrderArgs,
} from '../../builder';

const SEPARATION_TOKEN = '_*_';
const ARRAY_DATA_SEPARATION_TOKEN = '_%_';

type KnexOrderByColumn<TResult extends {}> = string | Knex.Raw<TResult>;

type KnexOperatorFunctions<
  TResult extends {},
  TRecord extends {} = TResult,
> = OperatorFunctions<
  TResult,
  Knex.QueryBuilder<TRecord, TResult>,
  KnexOrderByColumn<TResult>
>;

const operateOverScalarOrArray = <R>(
  initialValue: R,
  scalarOrArray: string | string[],
  operation: (scalar: string, index: number | null, prev: R) => R,
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

export const formatColumnIfAvailable = <TResult extends {}>(
  column: string,
  formatColumnFn?: (
    column: string,
    isRaw?: boolean
  ) => KnexOrderByColumn<TResult>,
  isRaw = true
): KnexOrderByColumn<TResult> => {
  if (formatColumnFn) {
    return formatColumnFn(column, isRaw);
  }
  return column;
};

function buildRemoveNodesFromBeforeOrAfter<
  TResult extends {},
  TRecord extends {} = TResult,
>(
  beforeOrAfter: 'before'
): KnexOperatorFunctions<TResult, TRecord>['applyAfterCursor'];
function buildRemoveNodesFromBeforeOrAfter<
  TResult extends {},
  TRecord extends {} = TResult,
>(
  beforeOrAfter: 'after'
): KnexOperatorFunctions<TResult, TRecord>['applyBeforeCursor'];

function buildRemoveNodesFromBeforeOrAfter<
  TResult extends {},
  TRecord extends {} = TResult,
>(beforeOrAfter: unknown): unknown {
  const getComparator = (orderDirection: string): string => {
    if (beforeOrAfter === 'after') return orderDirection === 'asc' ? '<' : '>';
    return orderDirection === 'asc' ? '>' : '<';
  };
  return (
    nodesAccessor: Knex.QueryBuilder<TResult, TRecord>,
    cursorOfInitialNode: string,
    {
      orderColumn,
      ascOrDesc,
      isAggregateFn,
      formatColumnFn,
      primaryKey,
    }: OrderArgs<KnexOrderByColumn<TResult>>
  ): Knex.QueryBuilder<TResult, TRecord> => {
    const data = getDataFromCursor(cursorOfInitialNode);
    const [id, columnValue] = data;

    const initialValue = nodesAccessor.clone();
    const executeFilterQuery = (query: Knex.QueryBuilder<TResult, TRecord>) =>
      operateOverScalarOrArray(
        query,
        orderColumn,
        (orderBy, index, prev) => {
          let orderDirection: string;
          const values = columnValue;
          let currValue: any;
          if (Array.isArray(ascOrDesc) && index !== null) {
            orderDirection = ascOrDesc[index].toLowerCase();
            currValue = values[index];
          } else {
            orderDirection =
              typeof ascOrDesc === 'string' ? ascOrDesc.toLowerCase() : 'asc';
            [currValue] = values;
          }
          const comparator = getComparator(orderDirection);

          if (index !== null && index > 0) {
            const operation =
              isAggregateFn && isAggregateFn(orderColumn[index - 1])
                ? 'orHavingRaw'
                : 'orWhereRaw';
            const nested = prev[operation](`(?? = ? and ?? ${comparator} ?)`, [
              formatColumnIfAvailable(orderColumn[index - 1], formatColumnFn),
              values[index - 1],
              formatColumnIfAvailable(orderBy, formatColumnFn),
              values[index],
            ]);

            return nested;
          }

          if (currValue === null || currValue === undefined) {
            return prev;
          }

          const operation =
            isAggregateFn && isAggregateFn(orderBy) ? 'havingRaw' : 'whereRaw';
          return prev[operation](`(?? ${comparator} ?)`, [
            formatColumnIfAvailable(orderBy, formatColumnFn),
            currValue,
          ]);
        },
        (prev, isArray) => {
          // Result is sorted by primaryKey as the last column
          const lastOrderDirection = Array.isArray(ascOrDesc)
            ? ascOrDesc[ascOrDesc.length - 1]
            : ascOrDesc;
          const comparator = getComparator(lastOrderDirection);
          const lastOrderColumn = isArray
            ? orderColumn[orderColumn.length - 1]
            : (orderColumn as unknown as string); // TS doesn't know that isArray makes it an array
          const lastValue = columnValue[columnValue.length - 1]; // If value is null, we are forced to filter by id instead

          // If value is null, we are forced to filter by primaryKey instead
          const operation =
            isAggregateFn && isAggregateFn(lastOrderColumn)
              ? 'orHavingRaw'
              : 'orWhereRaw';
          if (lastValue === null || lastValue === undefined) {
            return prev[operation](`(?? ${comparator} ?) or (?? IS NOT NULL)`, [
              formatColumnIfAvailable(primaryKey, formatColumnFn),
              id,
              formatColumnIfAvailable(lastOrderColumn, formatColumnFn),
            ]);
          }

          return prev[operation](`(?? = ? and ?? ${comparator} ?)`, [
            formatColumnIfAvailable(lastOrderColumn, formatColumnFn),
            lastValue,
            formatColumnIfAvailable(primaryKey, formatColumnFn),
            id,
          ]);
        }
      );
    let result;

    if (
      (isAggregateFn &&
        Array.isArray(orderColumn) &&
        isAggregateFn(orderColumn[0])) ||
      (isAggregateFn &&
        !Array.isArray(orderColumn) &&
        isAggregateFn(orderColumn))
    ) {
      result = executeFilterQuery(initialValue);
    } else {
      result = initialValue.andWhere((query) => executeFilterQuery(query));
    }
    return result;
  };
}

export const applyOrderBy = <TResult extends {}, TRecord extends {} = TResult>(
  nodesAccessor: Parameters<
    KnexOperatorFunctions<TResult, TRecord>['applyOrderBy']
  >[0],
  {
    orderColumn = 'id',
    ascOrDesc = 'asc',
    formatColumnFn,
    primaryKey = 'id',
  }: Parameters<KnexOperatorFunctions<TResult, TRecord>['applyOrderBy']>[1]
): ReturnType<KnexOperatorFunctions<TResult, TRecord>['applyOrderBy']> => {
  const initialValue = nodesAccessor.clone();
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
    (prev, isArray) =>
      isArray
        ? prev.orderBy(
            formatColumnIfAvailable(
              primaryKey,
              formatColumnFn,
              false
            ) as unknown as any,
            ascOrDesc[0]
          )
        : prev.orderBy(
            formatColumnIfAvailable(
              primaryKey,
              formatColumnFn,
              false
            ) as unknown as any,
            ascOrDesc as 'asc' | 'desc'
          )
  );
  return result;
};

// Used when `after` is included in the query
// It must slice the result set from the element after the one with the given cursor until the end.
// e.g. let [A, B, C, D] be the `resultSet`
// applyAfterCursor(resultSet, 'B') should return [C, D]
export const applyAfterCursor = buildRemoveNodesFromBeforeOrAfter('before');

// Used when `first` is included in the query
// It must remove nodes from the result set starting from the end until it's of size `length`.
// e.g. let [A, B, C, D] be the `resultSet`
// removeNodesFromEnd(resultSet, 3) should return [A, B, C]
export const returnNodesForFirst = <
  TResult extends {},
  TRecord extends {} = TResult,
>(
  nodesAccessor: Parameters<
    KnexOperatorFunctions<TResult, TRecord>['returnNodesForFirst']
  >[0],
  first: Parameters<
    KnexOperatorFunctions<TResult, TRecord>['returnNodesForFirst']
  >[1]
): ReturnType<KnexOperatorFunctions<TResult, TRecord>['returnNodesForFirst']> =>
  nodesAccessor.clone().limit(first);

// Used when `before` is included in the query
// It must remove all nodes after and including the one with cursor `cursorOfInitialNode`
// e.g. let [A, B, C, D] be the `resultSet`
// applyBeforeCursor(resultSet, 'C') should return [A, B]
export const applyBeforeCursor = buildRemoveNodesFromBeforeOrAfter('after');

// Used when `last` is included in the query
// It must remove nodes from the result set starting from the beginning until it's of size `length`.
// e.g. let [A, B, C, D] be the `resultSet`
// removeNodesFromBeginning(resultSet, 3) should return [B, C, D]
export const returnNodesForLast = <
  TResult extends {},
  TRecord extends {} = TResult,
>(
  nodesAccessor: Parameters<
    KnexOperatorFunctions<TResult, TRecord>['returnNodesForLast']
  >[0],
  last: Parameters<
    KnexOperatorFunctions<TResult, TRecord>['returnNodesForLast']
  >[1],
  {
    orderColumn,
    ascOrDesc,
    primaryKey,
  }: Parameters<
    KnexOperatorFunctions<TResult, TRecord>['returnNodesForLast']
  >[2]
): ReturnType<
  KnexOperatorFunctions<TResult, TRecord>['returnNodesForLast']
> => {
  const invertedOrderArray = operateOverScalarOrArray(
    [] as string[],
    ascOrDesc,
    (orderDirection, index, prev) =>
      prev.concat(orderDirection === 'asc' ? 'desc' : 'asc')
  );

  const order =
    invertedOrderArray.length === 1
      ? invertedOrderArray[0]
      : invertedOrderArray;

  const subquery = applyOrderBy(nodesAccessor.clone().clearOrder(), {
    orderColumn,
    ascOrDesc: order as 'asc' | 'desc',
    primaryKey,
  }).limit(last);
  const result = nodesAccessor
    .clone()
    .from(subquery.as('last_subquery'))
    .clearSelect()
    .clearWhere();
  return result;
};

export const calculateTotalCount = async <
  TResult extends {},
  TRecord extends {} = TResult,
>(
  nodesAccessor: Parameters<
    KnexOperatorFunctions<TResult, TRecord>['calculateTotalCount']
  >[0]
): ReturnType<
  KnexOperatorFunctions<TResult, TRecord>['calculateTotalCount']
> => {
  const counts = await nodesAccessor.clone().clearSelect().count('*');
  const result = counts.reduce((prev: number, curr: any) => {
    const currCount = curr.count || curr['count(*)'];
    if (!currCount) return prev;
    return parseInt(currCount, 10) + prev;
  }, 0);
  return result;
};

// Receives a list of nodes and returns it in edge form:
// {
//   cursor
//   node
// }
export const convertNodesToEdges = <
  TResult extends {},
  TRecord extends {} = TResult,
>(
  nodes: Parameters<
    KnexOperatorFunctions<TResult, TRecord>['convertNodesToEdges']
  >[0],
  _: Parameters<
    KnexOperatorFunctions<TResult, TRecord>['convertNodesToEdges']
  >[1],
  {
    orderColumn,
    primaryKey,
  }: Parameters<
    KnexOperatorFunctions<TResult, TRecord>['convertNodesToEdges']
  >[2]
): ReturnType<KnexOperatorFunctions<TResult, TRecord>['convertNodesToEdges']> =>
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

export default function paginate<
  TResult extends {},
  TRecord extends {} = TResult,
>(
  query: Knex.QueryBuilder<TResult, TRecord>,
  params: Parameters<
    ReturnType<
      typeof apolloCursorPaginationBuilder<
        TResult,
        Knex.QueryBuilder<TResult, TRecord>,
        KnexOrderByColumn<TResult>
      >
    >
  >[1],
  opts?: Parameters<
    ReturnType<
      typeof apolloCursorPaginationBuilder<
        TResult,
        Knex.QueryBuilder<TResult, TRecord>,
        KnexOrderByColumn<TResult>
      >
    >
  >[2]
) {
  return apolloCursorPaginationBuilder<
    TResult,
    Knex.QueryBuilder<TResult, TRecord>,
    KnexOrderByColumn<TResult>
  >({
    applyAfterCursor: applyAfterCursor as unknown as (
      nodeAccessor: Knex.QueryBuilder<TResult, TRecord>,
      cursor: string,
      opts: OrderArgs<KnexOrderByColumn<TResult>>
    ) => Knex.QueryBuilder<TResult, TRecord>,
    applyBeforeCursor: applyBeforeCursor as unknown as (
      nodeAccessor: Knex.QueryBuilder<TResult, TRecord>,
      cursor: string,
      opts: OrderArgs<KnexOrderByColumn<TResult>>
    ) => Knex.QueryBuilder<TResult, TRecord>,
    calculateTotalCount: calculateTotalCount as unknown as (
      nodeAccessor: Knex.QueryBuilder<TResult, TRecord>
    ) => Promise<number>,
    returnNodesForFirst: returnNodesForFirst as unknown as (
      nodeAccessor: Knex.QueryBuilder<TResult, TRecord>,
      count: number,
      opts: OrderArgs<KnexOrderByColumn<TResult>>
    ) => Promise<TResult[]>,
    returnNodesForLast: returnNodesForLast as unknown as (
      nodeAccessor: Knex.QueryBuilder<TResult, TRecord>,
      count: number,
      opts: OrderArgs<KnexOrderByColumn<TResult>>
    ) => Promise<TResult[]>,
    convertNodesToEdges: convertNodesToEdges as unknown as (
      nodes: TResult[],
      params: any,
      opts: OrderArgs<KnexOrderByColumn<TResult>>
    ) => { cursor: string; node: TResult }[],
    applyOrderBy: applyOrderBy as unknown as (
      nodeAccessor: Knex.QueryBuilder<TResult, TRecord>,
      opts: OrderArgs<KnexOrderByColumn<TResult>>
    ) => Knex.QueryBuilder<TResult, TRecord>,
  })(query, params, opts);
}
