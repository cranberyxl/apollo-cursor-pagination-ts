/* eslint-disable @typescript-eslint/naming-convention */
import {
  DynamoDBToolboxError,
  Entity,
  EntityAccessPattern,
  InputValue,
  IQueryCommand,
  Parser,
  Query,
  QueryCommand,
  QueryOptions,
  Schema,
  TransformedValue,
} from 'dynamodb-toolbox';

export const $schema = Symbol('$schema');
export type $schema = typeof $schema;

export const $pattern = Symbol('$pattern');
export type $pattern = typeof $pattern;

export const $options = Symbol('$options');
export type $options = typeof $options;

export const $meta = Symbol('$meta');
export type $meta = typeof $meta;

interface AccessPatternMetadata {
  title?: string;
  description?: string;
}

export class PagerEntityAccessPattern<
  ENTITY extends Entity = Entity,
  SCHEMA extends Schema = Schema,
  QUERY extends Query<ENTITY['table']> = Query<ENTITY['table']>,
  OPTIONS extends QueryOptions<ENTITY['table'], [ENTITY], QUERY> = QueryOptions<
    ENTITY['table'],
    [ENTITY],
    QUERY
  >,
> extends EntityAccessPattern<ENTITY, SCHEMA, QUERY, OPTIONS> {
  [$schema]?: SCHEMA;

  // any is needed for contravariance
  [$pattern]?: (
    input: Schema extends SCHEMA ? any : TransformedValue<SCHEMA>
  ) => QUERY;

  [$options]: OPTIONS;

  [$meta]: AccessPatternMetadata;

  constructor(
    entity: ENTITY,
    schema?: SCHEMA,
    pattern?: (input: TransformedValue<SCHEMA>) => QUERY,
    options: OPTIONS = {} as OPTIONS,
    meta: AccessPatternMetadata = {}
  ) {
    super(entity, schema, pattern, options, meta);
    this[$schema] = schema;
    this[$pattern] = pattern;
    this[$options] = options;
    this[$meta] = meta;
  }

  schema<NEXT_SCHEMA extends Schema>(
    nextSchema: NEXT_SCHEMA
  ): PagerEntityAccessPattern<ENTITY, NEXT_SCHEMA, QUERY, OPTIONS> {
    return new PagerEntityAccessPattern(
      this.entity,
      nextSchema,
      this[$pattern] as (input: TransformedValue<NEXT_SCHEMA>) => QUERY,
      this[$options],
      this[$meta]
    );
  }

  pattern<NEXT_QUERY extends Query<ENTITY['table']>>(
    nextPattern: (input: TransformedValue<SCHEMA>) => NEXT_QUERY
  ): PagerEntityAccessPattern<ENTITY, SCHEMA, NEXT_QUERY, OPTIONS> {
    return new PagerEntityAccessPattern(
      this.entity,
      this[$schema],
      nextPattern,
      this[$options],
      this[$meta]
    );
  }

  getOptions(): OPTIONS {
    return this[$options];
  }

  options<NEXT_OPTIONS extends QueryOptions<ENTITY['table'], [ENTITY], QUERY>>(
    nextOptions: NEXT_OPTIONS,
    options?: { merge?: boolean }
  ): PagerEntityAccessPattern<ENTITY, SCHEMA, QUERY, NEXT_OPTIONS> {
    const potentiallyMergedOptions = options?.merge
      ? { ...this[$options], ...nextOptions }
      : nextOptions;

    return new PagerEntityAccessPattern(
      this.entity,
      this[$schema],
      this[$pattern],
      potentiallyMergedOptions,
      this[$meta]
    );
  }

  meta(
    nextMeta: AccessPatternMetadata
  ): PagerEntityAccessPattern<ENTITY, SCHEMA, QUERY, OPTIONS> {
    return new PagerEntityAccessPattern(
      this.entity,
      this[$schema],
      this[$pattern],
      this[$options],
      nextMeta
    );
  }

  getAdditonalIndexKeys(input: InputValue<SCHEMA>): string[] {
    const query = this.generateQuery(input);

    if (query.index === undefined) {
      return [];
    }

    const index = this.entity.table.indexes[query.index];

    if (!index) {
      throw new DynamoDBToolboxError('actions.incompleteAction', {
        message: 'AccessPattern error: Pattern index not found',
      });
    }

    const keys: string[] = [];
    if (index.partitionKey) {
      keys.push(index.partitionKey.name);
    }
    if (index.sortKey) {
      keys.push(index.sortKey.name);
    }

    return keys;
  }

  private generateQuery(input: InputValue<SCHEMA>) {
    const schema = this[$schema];
    if (schema === undefined) {
      throw new DynamoDBToolboxError('actions.incompleteAction', {
        message: 'AccessPattern incomplete: Missing "schema" property',
      });
    }

    const pattern = this[$pattern];
    if (pattern === undefined) {
      throw new DynamoDBToolboxError('actions.incompleteAction', {
        message: 'AccessPattern incomplete: Missing "pattern" property',
      });
    }

    const parser = new Parser(schema);
    const transformedInput = parser.parse(input);
    const query = pattern(transformedInput);

    return query;
  }

  query(
    input: InputValue<SCHEMA>
  ): Entity extends ENTITY
    ? IQueryCommand
    : QueryCommand<ENTITY['table'], [ENTITY], QUERY, OPTIONS> {
    type QUERY_COMMAND = Entity extends ENTITY
      ? IQueryCommand
      : QueryCommand<ENTITY['table'], [ENTITY], QUERY, OPTIONS>;

    const query = this.generateQuery(input);
    const options = this[$options];

    return new QueryCommand<ENTITY['table'], [ENTITY], QUERY, OPTIONS>(
      this.entity.table,
      [this.entity],
      query,
      options
    ) as QUERY_COMMAND;
  }
}
