import {
  type Entity,
  type FormattedItem,
  EntityParser,
  InputValue,
  Schema,
  PrimaryKey,
} from 'dynamodb-toolbox';
import apolloCursorPaginationBuilder, {
  encode,
  decode,
  GraphQLParams,
  BuilderOptions,
} from '../../builder';
import { PagerEntityAccessPattern } from './PagerEntityAccessPattern';

export const cursorGenerator = <E extends Entity>(
  key: PrimaryKey<E['table']>
): string => encode(JSON.stringify(key, Object.keys(key).sort()));

export const getDataFromCursor = (cursor: string) => JSON.parse(decode(cursor));

export { PagerEntityAccessPattern };

export default function paginate<
  ENTITY extends Entity = Entity,
  SCHEMA extends Schema = Schema,
>(
  queryInput: InputValue<SCHEMA>,
  accessPattern: PagerEntityAccessPattern<ENTITY, SCHEMA>,
  args?: GraphQLParams,
  builderOptions?: BuilderOptions<
    undefined,
    FormattedItem<ENTITY>,
    Record<string, any>
  >
) {
  return apolloCursorPaginationBuilder<
    FormattedItem<ENTITY>,
    PagerEntityAccessPattern<ENTITY, SCHEMA>,
    undefined,
    Record<string, any>
  >({
    applyAfterCursor: (nodeAccessor, afterCursor) => {
      const decodedCursor = getDataFromCursor(afterCursor);

      return nodeAccessor.options(
        { exclusiveStartKey: decodedCursor },
        { merge: true }
      );
    },
    applyBeforeCursor: (nodeAccessor, beforeCursor) => {
      const decodedCursor = getDataFromCursor(beforeCursor);

      return nodeAccessor.options(
        { exclusiveStartKey: decodedCursor },
        { merge: true }
      );
    },
    returnNodesForFirst: async (nodeAccessor, count, orderArgs) => {
      const q = nodeAccessor
        .options(
          {
            limit: count,
            reverse: orderArgs.ascOrDesc === 'desc',
          },
          { merge: true }
        )
        .query(queryInput);

      const result = await q.send();

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
    convertNodesToEdges: (nodes, _, opts) =>
      nodes.map((node) => {
        let nodePrimaryKey: Record<string, any> = accessPattern.entity
          .build(EntityParser)
          .parse(node, { mode: 'key' }).key;

        if (opts.formatPrimaryKeyFn) {
          nodePrimaryKey = {
            ...nodePrimaryKey,
            ...opts.formatPrimaryKeyFn(node),
          };
        }

        return {
          cursor: cursorGenerator(nodePrimaryKey),
          node,
        };
      }),
    applyOrderBy: (nodeAccessor) => nodeAccessor,
  })(accessPattern as any, args, builderOptions ?? {});
}
