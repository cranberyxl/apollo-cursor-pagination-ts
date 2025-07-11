// based on Relay's Connection spec at
// https://facebook.github.io/relay/graphql/connections.htm#sec-Pagination-algorithm

export interface OrderArgs<C, N, PK> {
  orderColumn: string | string[];
  ascOrDesc: 'asc' | 'desc' | ('asc' | 'desc')[];
  isAggregateFn?: (column: string) => boolean;
  formatColumnFn?: (column: string) => C;
  formatPrimaryKeyFn?: (node: N) => PK;
  primaryKey: string;
}

export interface ExternalOrderArgs<C, N, PK> {
  isAggregateFn?: (column: string) => boolean;
  formatColumnFn?: (column: string) => C;
  formatPrimaryKeyFn?: (node: N) => PK;
  primaryKey?: string;
}

export interface GraphQLParams {
  before?: string;
  after?: string;
  first?: number;
  last?: number;
  orderDirection?: 'asc' | 'desc' | ('asc' | 'desc')[];
  orderBy?: string | string[];
}

export const encode = (str: string): string =>
  Buffer.from(str).toString('base64');
export const decode = (str: string): string =>
  Buffer.from(str, 'base64').toString();

export interface OperatorFunctions<N, NA, C, PK = string> {
  // apply* methods alter the nodeAccessor
  applyAfterCursor: (
    nodeAccessor: NA,
    cursor: string,
    opts: OrderArgs<C, N, PK>
  ) => NA;
  applyBeforeCursor: (
    nodeAccessor: NA,
    cursor: string,
    opts: OrderArgs<C, N, PK>
  ) => NA;
  applyOrderBy: (nodeAccessor: NA, opts: OrderArgs<C, N, PK>) => NA;
  // return* methods talk to the datasource
  returnNodesForFirst: (
    nodeAccessor: NA,
    count: number,
    opts: OrderArgs<C, N, PK>
  ) => Promise<N[]>;
  returnNodesForLast: (
    nodeAccessor: NA,
    count: number,
    opts: OrderArgs<C, N, PK>
  ) => Promise<N[]>;
  // returnTotalCount ignores the nodeAccessor and returns the total count of the nodes
  // Can be skipped if you don't want to calculate the total count
  returnTotalCount: (nodeAccessor: NA) => Promise<number>;
  convertNodesToEdges: (
    nodes: N[],
    params: GraphQLParams | undefined,
    opts: OrderArgs<C, N, PK>
  ) => { cursor: string; node: N }[];
}

export interface BuilderOptions<C, N, PK>
  extends Partial<ExternalOrderArgs<C, N, PK>> {
  skipTotalCount?: boolean;
  modifyEdgeFn?: <T>(edge: { cursor: string; node: T }) => {
    cursor: string;
    node: T;
  };
}

export interface PageInfo {
  hasPreviousPage: boolean;
  hasNextPage: boolean;
  startCursor?: string;
  endCursor?: string;
}

export interface ConnectionResult<T> {
  pageInfo: PageInfo;
  totalCount?: number;
  edges: { cursor: string; node: T }[];
}

/**
 * Slices the nodes list according to the `before` and `after` graphql query params.
 */
const applyCursorsToNodes = <N, NA, C, PK>(
  allNodesAccessor: NA,
  { before, after }: Pick<GraphQLParams, 'before' | 'after'>,
  {
    applyAfterCursor,
    applyBeforeCursor,
  }: Pick<
    OperatorFunctions<N, NA, C, PK>,
    'applyAfterCursor' | 'applyBeforeCursor'
  >,
  opts: OrderArgs<C, N, PK>
): NA => {
  let nodesAccessor = allNodesAccessor;
  if (after) {
    nodesAccessor = applyAfterCursor(nodesAccessor, after, opts);
  }
  if (before) {
    nodesAccessor = applyBeforeCursor(nodesAccessor, before, opts);
  }
  return nodesAccessor;
};

/**
 * Slices a node list according to `before`, `after`, `first` and `last` graphql query params.
 */
const nodesToReturn = async <N, NA, C, PK>(
  allNodesAccessor: NA,
  operatorFunctions: Pick<
    OperatorFunctions<N, NA, C, PK>,
    | 'applyAfterCursor'
    | 'applyBeforeCursor'
    | 'returnNodesForFirst'
    | 'returnNodesForLast'
    | 'applyOrderBy'
  >,
  {
    before,
    after,
    first,
    last,
  }: Pick<GraphQLParams, 'before' | 'after' | 'first' | 'last'>,
  opts: OrderArgs<C, N, PK>
): Promise<{ nodes: N[]; hasNextPage: boolean; hasPreviousPage: boolean }> => {
  const orderedNodesAccessor = operatorFunctions.applyOrderBy(
    allNodesAccessor,
    opts
  );
  const nodesAccessor = applyCursorsToNodes(
    orderedNodesAccessor,
    { before, after },
    {
      applyAfterCursor: operatorFunctions.applyAfterCursor,
      applyBeforeCursor: operatorFunctions.applyBeforeCursor,
    },
    opts
  );
  let hasNextPage = !!before;
  let hasPreviousPage = !!after;
  let nodes: N[] = [];

  // Check if both first and last are provided
  if (first && last) {
    throw new Error('Cannot specify both `first` and `last` arguments');
  }

  if (first) {
    if (first < 0) throw new Error('`first` argument must not be less than 0');
    nodes = await operatorFunctions.returnNodesForFirst(
      nodesAccessor,
      first + 1,
      opts
    );
    if (nodes.length > first) {
      hasNextPage = true;
      nodes = nodes.slice(0, first);
    }
  } else if (last) {
    if (last < 0) throw new Error('`last` argument must not be less than 0');
    nodes = await operatorFunctions.returnNodesForLast(
      nodesAccessor,
      last + 1,
      opts
    );
    if (nodes.length > last) {
      hasPreviousPage = true;
      nodes = nodes.slice(1);
    }
  } else {
    throw new Error('`first` or `last` argument must be provided');
  }
  return { nodes, hasNextPage, hasPreviousPage };
};

/**
 * Returns a function that must be called to generate a Relay's Connection based page.
 */
const apolloCursorPaginationBuilder =
  <N, NA, C, PK>({
    applyAfterCursor,
    applyBeforeCursor,
    returnTotalCount,
    returnNodesForFirst,
    returnNodesForLast,
    convertNodesToEdges,
    applyOrderBy,
  }: OperatorFunctions<N, NA, C, PK>) =>
  async (
    allNodesAccessor: NA,
    args: GraphQLParams = {},
    opts: BuilderOptions<C, N, PK> = {}
  ): Promise<ConnectionResult<N>> => {
    const {
      isAggregateFn,
      formatColumnFn,
      formatPrimaryKeyFn,
      skipTotalCount = false,
      modifyEdgeFn,
      primaryKey = 'id',
    } = opts;
    const {
      before,
      after,
      first,
      last,
      orderDirection = 'asc',
      orderBy = primaryKey,
    } = args;

    const orderColumn = orderBy;
    const ascOrDesc = orderDirection;

    const { nodes, hasPreviousPage, hasNextPage } = await nodesToReturn(
      allNodesAccessor,
      {
        applyAfterCursor,
        applyBeforeCursor,
        returnNodesForFirst,
        returnNodesForLast,
        applyOrderBy,
      },
      {
        before,
        after,
        first,
        last,
      },
      {
        orderColumn,
        ascOrDesc,
        isAggregateFn,
        formatColumnFn,
        formatPrimaryKeyFn,
        primaryKey,
      }
    );

    const totalCount = !skipTotalCount
      ? await returnTotalCount(allNodesAccessor)
      : undefined;

    let edges = convertNodesToEdges(
      nodes,
      {
        before,
        after,
        first,
        last,
      },
      {
        orderColumn,
        ascOrDesc,
        isAggregateFn,
        formatColumnFn,
        formatPrimaryKeyFn,
        primaryKey,
      }
    );
    if (modifyEdgeFn) {
      edges = edges.map((edge) => modifyEdgeFn(edge));
    }

    const startCursor = edges[0]?.cursor;
    const endCursor = edges[edges.length - 1]?.cursor;

    return {
      pageInfo: {
        hasPreviousPage,
        hasNextPage,
        startCursor,
        endCursor,
      },
      totalCount,
      edges,
    };
  };

export default apolloCursorPaginationBuilder;
