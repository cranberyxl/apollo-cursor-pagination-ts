// based on Relay's Connection spec at
// https://facebook.github.io/relay/graphql/connections.htm#sec-Pagination-algorithm

export type OrderDirection = 'asc' | 'desc';

export interface OrderArgs<C, OC = string> {
  orderColumn: OC | OC[];
  ascOrDesc: OrderDirection | OrderDirection[];
  isAggregateFn?: (column: OC) => boolean;
  formatColumnFn?: (column: OC) => C;
  primaryKey: OC;
}

export interface ExternalOrderArgs<C, OC = string> {
  isAggregateFn?: (column: OC) => boolean;
  formatColumnFn?: (column: OC) => C;
  primaryKey?: OC;
}

export interface GraphQLParams<OC = string> {
  before?: string;
  after?: string;
  first?: number;
  last?: number;
  orderDirection?: OrderDirection | OrderDirection[];
  orderBy?: OC | OC[];
}

export const encode = (str: string): string =>
  Buffer.from(str).toString('base64');
export const decode = (str: string): string =>
  Buffer.from(str, 'base64').toString();

export interface OperatorFunctions<N, NA, C, OC = string> {
  // apply* methods alter the nodeAccessor
  applyAfterCursor: (
    nodeAccessor: NA,
    cursor: string,
    opts: OrderArgs<C, OC>
  ) => NA;
  applyBeforeCursor: (
    nodeAccessor: NA,
    cursor: string,
    opts: OrderArgs<C, OC>
  ) => NA;
  applyOrderBy: (nodeAccessor: NA, opts: OrderArgs<C, OC>) => NA;
  // return* methods talk to the datasource
  returnNodesForFirst: (
    nodeAccessor: NA,
    count: number,
    opts: OrderArgs<C, OC>
  ) => Promise<N[]>;
  returnNodesForLast: (
    nodeAccessor: NA,
    count: number,
    opts: OrderArgs<C, OC>
  ) => Promise<N[]>;
  // returnTotalCount ignores the nodeAccessor and returns the total count of the nodes
  // Can be skipped if you don't want to calculate the total count
  returnTotalCount: (nodeAccessor: NA) => Promise<number>;
  convertNodesToEdges: (
    nodes: N[],
    params: GraphQLParams<OC> | undefined,
    opts: OrderArgs<C, OC>
  ) => { cursor: string; node: N }[];
  defaultPrimaryKey: OC;
}
export interface BuilderOptions<C, N, OC = string>
  extends Partial<ExternalOrderArgs<C, OC>> {
  skipTotalCount?: boolean;
  modifyEdgeFn?: <NewNode>(edge: { cursor: string; node: N }) => {
    cursor: string;
    node: NewNode;
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
const applyCursorsToNodes = <N, NA, C, OC = string>(
  allNodesAccessor: NA,
  { before, after }: Pick<GraphQLParams<OC>, 'before' | 'after'>,
  {
    applyAfterCursor,
    applyBeforeCursor,
  }: Pick<
    OperatorFunctions<N, NA, C, OC>,
    'applyAfterCursor' | 'applyBeforeCursor'
  >,
  opts: OrderArgs<C, OC>
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
const nodesToReturn = async <N, NA, C, OC = string>(
  allNodesAccessor: NA,
  operatorFunctions: Pick<
    OperatorFunctions<N, NA, C, OC>,
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
  }: Pick<GraphQLParams<OC>, 'before' | 'after' | 'first' | 'last'>,
  opts: OrderArgs<C, OC>
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
  <N, NA, C, OC = string>({
    applyAfterCursor,
    applyBeforeCursor,
    returnTotalCount,
    returnNodesForFirst,
    returnNodesForLast,
    convertNodesToEdges,
    applyOrderBy,
    defaultPrimaryKey,
  }: OperatorFunctions<N, NA, C, OC>) =>
  async (
    allNodesAccessor: NA,
    args: GraphQLParams<OC> = {},
    opts: BuilderOptions<C, N, OC> = {}
  ): Promise<ConnectionResult<N>> => {
    const {
      isAggregateFn,
      formatColumnFn,
      skipTotalCount = false,
      modifyEdgeFn,
      primaryKey = defaultPrimaryKey,
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
