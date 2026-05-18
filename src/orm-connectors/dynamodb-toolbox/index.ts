import type {
  Entity,
  FormattedItem,
  InputValue,
  Schema,
  PrimaryKey,
  EntityAccessPattern,
  EntityParser as EntityParserType,
} from 'dynamodb-toolbox';
import apolloCursorPaginationBuilder, {
  encode,
  decode,
  GraphQLParams,
  BuilderOptions,
} from '../../builder';

// Lazy-load `dynamodb-toolbox` so it stays a true optional peer dep: importing
// this library's main entry never resolves the module. Consumers that never
// call the dynamodb paginator can omit the dependency entirely.
let cachedEntityParser: typeof EntityParserType | undefined;

async function loadEntityParser(): Promise<typeof EntityParserType> {
  if (cachedEntityParser) return cachedEntityParser;
  let mod: typeof import('dynamodb-toolbox');
  try {
    mod = await import('dynamodb-toolbox');
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Cannot find module 'dynamodb-toolbox'. Install it as a peer dependency to use the dynamodb paginator. (${reason})`
    );
  }
  cachedEntityParser = mod.EntityParser;
  return cachedEntityParser;
}

function getEntityParser(): typeof EntityParserType {
  if (!cachedEntityParser) {
    throw new Error(
      'dynamodb-toolbox has not been loaded yet. Use the `dynamodbPaginator` default export, which loads it on demand, before calling `convertNodesToEdges` directly.'
    );
  }
  return cachedEntityParser;
}

export const cursorGenerator = <E extends Entity>(
  key: PrimaryKey<E['table']>
): string => encode(JSON.stringify(key, Object.keys(key).sort()));

export const getDataFromCursor = (cursor: string) => JSON.parse(decode(cursor));

export const convertNodesToEdges =
  <N, ENTITY extends Entity = Entity, SCHEMA extends Schema = Schema>(
    queryInput: InputValue<SCHEMA>,
    accessPattern: EntityAccessPattern<ENTITY, SCHEMA>
  ) =>
  (nodes: N[]) => {
    const EntityParser = getEntityParser();
    return nodes.map((node) => {
      const parsed = accessPattern.entity.build(EntityParser).parse(node);

      // Use the index info in the query to find all the keys
      const nodePrimaryKey: Record<string, any> = parsed.key;
      const queryParms = accessPattern.query(queryInput).params();
      if (queryParms.IndexName) {
        const index = accessPattern.entity.table.indexes[queryParms.IndexName];
        if (index.partitionKey) {
          nodePrimaryKey[index.partitionKey.name] =
            parsed.item[index.partitionKey.name];
        }
        if (index.sortKey) {
          nodePrimaryKey[index.sortKey.name] = parsed.item[index.sortKey.name];
        }
      }

      return {
        cursor: cursorGenerator(nodePrimaryKey),

        node,
      };
    });
  };

export default async function paginate<
  ENTITY extends Entity = Entity,
  SCHEMA extends Schema = Schema,
>(
  queryInput: InputValue<SCHEMA>,
  accessPattern: EntityAccessPattern<ENTITY, SCHEMA>,
  args?: Omit<GraphQLParams, 'orderBy'>,
  builderOptions?: BuilderOptions<undefined, FormattedItem<ENTITY>> & {
    maxPages?: number;
  }
) {
  // Resolve the optional peer dep before constructing the operator graph so
  // sync `convertNodesToEdges` can read it from cache.
  await loadEntityParser();

  // Capture builderOptions in closure for access by operator functions
  const maxPages = builderOptions?.maxPages ?? 5;

  return apolloCursorPaginationBuilder<
    FormattedItem<ENTITY>,
    EntityAccessPattern<ENTITY, SCHEMA>,
    undefined
  >({
    applyAfterCursor: (nodeAccessor, afterCursor) => {
      const decodedCursor = getDataFromCursor(afterCursor);

      return nodeAccessor.options((previousOptions) => {
        if (previousOptions.exclusiveStartKey) {
          throw new Error(
            'exclusiveStartKey already set - cannot apply after cursor'
          );
        }

        return {
          ...previousOptions,
          exclusiveStartKey: decodedCursor,
        };
      });
    },
    applyBeforeCursor: (nodeAccessor, beforeCursor) => {
      const decodedCursor = getDataFromCursor(beforeCursor);

      return nodeAccessor.options((previousOptions) => {
        if (previousOptions.exclusiveStartKey) {
          throw new Error(
            'exclusiveStartKey already set - cannot apply before cursor'
          );
        }

        return {
          ...previousOptions,
          exclusiveStartKey: decodedCursor,
        };
      });
    },
    returnNodesForFirst: async (nodeAccessor, count, orderArgs) => {
      const result = await nodeAccessor
        .options((previousOptions) => {
          if ('limit' in previousOptions) {
            throw new Error('limit already set - cannot apply first');
          }

          if ('reverse' in previousOptions) {
            throw new Error(
              'reverse already set - cannot apply first, use orderDirection'
            );
          }

          return {
            ...previousOptions,
            limit: count,
            reverse: orderArgs.ascOrDesc === 'desc',
            maxPages,
          };
        })
        .query(queryInput)
        .send();

      const items = (result.Items || []) as FormattedItem<ENTITY>[];
      return items.slice(0, count);
    },
    returnNodesForLast: async (nodeAccessor, count, orderArgs) => {
      // For "last" parameter, we need to get the last N items from the end
      const result = await nodeAccessor
        .options((previousOptions) => {
          if ('limit' in previousOptions) {
            throw new Error('limit already set - cannot apply last');
          }

          if ('reverse' in previousOptions) {
            throw new Error(
              'reverse already set - cannot apply last, use orderDirection'
            );
          }

          return {
            ...previousOptions,
            limit: count,
            reverse: orderArgs.ascOrDesc === 'asc',
            maxPages,
          };
        })
        .query(queryInput)
        .send();

      const items = (result.Items || []) as FormattedItem<ENTITY>[];

      return items.slice(0, count).reverse();
    },
    returnTotalCount: async (nodeAccessor) => {
      const result = await nodeAccessor
        .options((previousOptions) => ({
          ...previousOptions,
          select: 'COUNT',
        }))
        .query(queryInput)
        .send();
      return result.Count || 0;
    },
    convertNodesToEdges: convertNodesToEdges(queryInput, accessPattern),
    applyOrderBy: (nodeAccessor) => nodeAccessor,
    defaultPrimaryKey: 'id',
  })(accessPattern as any, args, builderOptions ?? {});
}
