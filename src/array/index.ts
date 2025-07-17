import apolloCursorPaginationBuilder, {
  decode,
  encode,
  OperatorFunctions,
  OrderArgs,
} from '../builder';

const SEPARATION_TOKEN = '_*_';
const ARRAY_DATA_SEPARATION_TOKEN = '_%_';

type ArrayOperatorFunctions<T> = OperatorFunctions<T, T[], string>;

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

function buildRemoveNodesFromBeforeOrAfter<T>(
  beforeOrAfter: 'before' | 'after'
):
  | ArrayOperatorFunctions<T>['applyAfterCursor']
  | ArrayOperatorFunctions<T>['applyBeforeCursor'] {
  const getComparator = (orderDirection: string): string => {
    if (beforeOrAfter === 'after') return orderDirection === 'asc' ? '<' : '>';
    return orderDirection === 'asc' ? '>' : '<';
  };

  return (
    nodesAccessor: T[],
    cursorOfInitialNode: string,
    { orderColumn, ascOrDesc, primaryKey }: OrderArgs<string>
  ): T[] => {
    const data = getDataFromCursor(cursorOfInitialNode);
    const [id, columnValue] = data;

    const initialValue = [...nodesAccessor];
    const executeFilterQuery = (nodes: T[]) =>
      operateOverScalarOrArray(
        nodes,
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
            return prev.filter((node) => {
              const nodeValue = node[orderBy as keyof T];
              const prevNodeValue = node[orderColumn[index - 1] as keyof T];
              const prevValue = values[index - 1];

              if (prevNodeValue === prevValue) {
                if (currValue === null || currValue === undefined) {
                  return true;
                }
                return comparator === '<'
                  ? nodeValue < currValue
                  : nodeValue > currValue;
              }
              return false;
            });
          }

          if (currValue === null || currValue === undefined) {
            return prev;
          }

          return prev.filter((node) => {
            const nodeValue = node[orderBy as keyof T];
            return comparator === '<'
              ? nodeValue < currValue
              : nodeValue > currValue;
          });
        },
        (prev, isArray) => {
          // Result is sorted by primaryKey as the last column
          const lastOrderDirection = Array.isArray(ascOrDesc)
            ? ascOrDesc[ascOrDesc.length - 1]
            : ascOrDesc;
          const comparator = getComparator(lastOrderDirection);
          const lastOrderColumn = isArray
            ? orderColumn[orderColumn.length - 1]
            : (orderColumn as unknown as string);
          const lastValue = columnValue[columnValue.length - 1];

          return prev.filter((node) => {
            const nodeValue = node[lastOrderColumn as keyof T];
            const nodePrimaryKey = node[primaryKey as keyof T];

            if (lastValue === null || lastValue === undefined) {
              return comparator === '<'
                ? nodePrimaryKey < id
                : nodePrimaryKey > id;
            }

            if (nodeValue === lastValue) {
              return comparator === '<'
                ? nodePrimaryKey < id
                : nodePrimaryKey > id;
            }

            return comparator === '<'
              ? nodeValue < lastValue
              : nodeValue > lastValue;
          });
        }
      );

    return executeFilterQuery(initialValue);
  };
}

export const applyAfterCursor = buildRemoveNodesFromBeforeOrAfter(
  'before'
) as ArrayOperatorFunctions<any>['applyAfterCursor'];
export const applyBeforeCursor = buildRemoveNodesFromBeforeOrAfter(
  'after'
) as ArrayOperatorFunctions<any>['applyBeforeCursor'];

export const applyOrderBy = <T>(
  nodesAccessor: T[],
  {
    orderColumn = 'id',
    ascOrDesc = 'asc',
    primaryKey = 'id',
  }: OrderArgs<string>
): T[] => {
  const initialValue = [...nodesAccessor];
  const columns = Array.isArray(orderColumn) ? orderColumn : [orderColumn];
  const directions = Array.isArray(ascOrDesc) ? ascOrDesc : [ascOrDesc];

  // Decorate: attach original index for stability
  const decorated = initialValue.map((item, idx) => ({ item, idx }));

  decorated.sort((a, b) => {
    let i = 0;
    while (i < columns.length) {
      const col = columns[i];
      const dir = directions[i] || directions[0] || 'asc';
      const aValue = a.item[col as keyof T];
      const bValue = b.item[col as keyof T];
      if (aValue !== bValue) {
        if (aValue === null || aValue === undefined) return 1;
        if (bValue === null || bValue === undefined) return -1;
        if (typeof aValue === 'string' && typeof bValue === 'string') {
          const cmp = aValue.localeCompare(bValue);
          return dir === 'asc' ? cmp : -cmp;
        }
        if (dir === 'asc') {
          return aValue < bValue ? -1 : 1;
        }
        return aValue > bValue ? -1 : 1;
      }
      i += 1;
    }
    // Always break ties with primaryKey for deterministic order
    const aValue = a.item[primaryKey as keyof T];
    const bValue = b.item[primaryKey as keyof T];
    if (aValue !== bValue) {
      if (aValue === null || aValue === undefined) return 1;
      if (bValue === null || bValue === undefined) return -1;
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return aValue.localeCompare(bValue);
      }
      return aValue < bValue ? -1 : 1;
    }
    // Final fallback: original index for stability
    return a.idx - b.idx;
  });

  // Undecorate
  return decorated.map((d) => d.item);
};

export const returnNodesForFirst = async <T>(
  nodesAccessor: T[],
  count: number
): Promise<T[]> => nodesAccessor.slice(0, count);

export const returnNodesForLast = async <T>(
  nodesAccessor: T[],
  count: number,
  { orderColumn, ascOrDesc, primaryKey }: OrderArgs<string>
): Promise<T[]> => {
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

  // Sort in reverse order, take the first 'count' items, then reverse back to original order
  const sortedNodes = applyOrderBy(nodesAccessor, {
    orderColumn,
    ascOrDesc: order as 'asc' | 'desc',
    primaryKey,
  });

  const lastNodes = sortedNodes.slice(0, count);

  // Reverse back to original order
  return lastNodes.reverse();
};

export const returnTotalCount = async <T>(
  nodesAccessor: T[]
): Promise<number> => nodesAccessor.length;

export const convertNodesToEdges = <T>(
  nodes: T[],
  _: any,
  { orderColumn, primaryKey }: OrderArgs<string>
): { cursor: string; node: T }[] =>
  nodes.map((node) => {
    const dataValue = operateOverScalarOrArray(
      '',
      orderColumn,
      (orderBy, index, prev) => {
        const nodeValue = node[orderBy as keyof T];
        if (nodeValue === undefined) {
          return prev;
        }
        const result = `${prev}${index ? ARRAY_DATA_SEPARATION_TOKEN : ''}${JSON.stringify(nodeValue)}`;
        return result;
      }
    );

    const nodePrimaryKey: string | number | undefined = node[
      primaryKey as keyof T
    ] as string | number | undefined;
    if (nodePrimaryKey === undefined) {
      throw new Error(`Could not find primary key ${primaryKey} in node`);
    }

    return {
      cursor: cursorGenerator(nodePrimaryKey, dataValue),
      node,
    };
  });

export default function paginateArray<T>(
  array: T[],
  params: Parameters<
    ReturnType<typeof apolloCursorPaginationBuilder<T, T[], string>>
  >[1],
  opts?: Parameters<
    ReturnType<typeof apolloCursorPaginationBuilder<T, T[], string>>
  >[2]
) {
  return apolloCursorPaginationBuilder<T, T[], string>({
    applyAfterCursor,
    applyBeforeCursor,
    returnTotalCount,
    returnNodesForFirst,
    returnNodesForLast,
    convertNodesToEdges,
    applyOrderBy,
  })(array, params, opts);
}
