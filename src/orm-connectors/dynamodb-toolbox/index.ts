import {
  type Entity,
  type FormattedItem,
  EntityParser,
  InputValue,
  Schema,
  EntityAccessPattern,
  PrimaryKey,
} from 'dynamodb-toolbox';
import apolloCursorPaginationBuilder, {
  encode,
  decode,
  GraphQLParams,
  BuilderOptions,
} from '../../builder';

export const cursorGenerator = <E extends Entity>(
  key: PrimaryKey<E['table']>
): string => encode(JSON.stringify(key));

export const getDataFromCursor = (cursor: string) => JSON.parse(decode(cursor));

export default function paginate<
  ENTITY extends Entity = Entity,
  SCHEMA extends Schema = Schema,
>(
  queryInput: InputValue<SCHEMA>,
  accessPattern: EntityAccessPattern<ENTITY, SCHEMA>,
  args?: GraphQLParams,
  opts?: BuilderOptions
) {
  return apolloCursorPaginationBuilder<
    FormattedItem<ENTITY>,
    EntityAccessPattern<ENTITY>,
    string
  >({
    applyAfterCursor: (nodeAccessor, cursor) => {
      const decodedCursor = getDataFromCursor(cursor);

      return nodeAccessor.options(
        { exclusiveStartKey: decodedCursor },
        { merge: true }
      );
    },
    applyBeforeCursor: (nodeAccessor, cursor) => {
      const decodedCursor = getDataFromCursor(cursor);

      return nodeAccessor.options(
        { exclusiveStartKey: decodedCursor },
        { merge: true }
      );
    },
    returnNodesForFirst: async (nodeAccessor, count, orderArgs) => {
      const result = await nodeAccessor
        .options(
          {
            limit: count,
            reverse: orderArgs.ascOrDesc === 'desc',
          },
          { merge: true }
        )
        .query(queryInput)
        .send();

      const items = (result.Items || []) as FormattedItem<ENTITY>[];
      return items;
    },
    returnNodesForLast: async (nodeAccessor, count, orderArgs) => {
      // For "last" parameter, we need to get the last N items from the end
      const result = await nodeAccessor
        .options(
          { limit: count, reverse: orderArgs.ascOrDesc === 'asc' },
          { merge: true }
        )
        .query(queryInput)
        .send();

      const items = (result.Items || []) as FormattedItem<ENTITY>[];

      return items.reverse();
    },
    returnTotalCount: async (nodeAccessor) => {
      const result = await nodeAccessor
        .options({ select: 'COUNT' })
        .query(queryInput)
        .send();
      return result.Count || 0;
    },
    convertNodesToEdges: (nodes) =>
      nodes.map((node) => {
        const nodePrimaryKey = accessPattern.entity
          .build(EntityParser)
          .parse(node, { mode: 'key' }).key;

        return {
          cursor: cursorGenerator(nodePrimaryKey),
          node,
        };
      }),
    applyOrderBy: (nodeAccessor) => nodeAccessor,
  })(accessPattern as any, args, opts);
}
