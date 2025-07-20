import { Table } from 'dynamodb-toolbox';
import {
  CreateTableCommandInput,
  CreateTableCommand,
  DeleteTableCommand,
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

// Create DynamoDB client
const client = new DynamoDBClient({
  endpoint: 'http://localhost:8000',
  region: 'local-env',
  credentials: {
    accessKeyId: 'local',
    secretAccessKey: 'local',
  },
});

// Create document client for easier JSON handling
export const documentClient = DynamoDBDocumentClient.from(client);

// Export the raw client for table operations
export const dynamoClient = client;

const testTableName = 'test-table';
const filteredTestTableName = 'filtered-test-table';

// Table configuration
const tableConfig = (TableName: string): CreateTableCommandInput => ({
  TableName,
  KeySchema: [
    {
      KeyType: 'HASH',
      AttributeName: 'pk',
    },
    {
      KeyType: 'RANGE',
      AttributeName: 'sk',
    },
  ],
  AttributeDefinitions: [
    {
      AttributeName: 'pk',
      AttributeType: 'S',
    },
    {
      AttributeName: 'sk',
      AttributeType: 'S',
    },
    {
      AttributeName: 'pk2',
      AttributeType: 'S',
    },
    {
      AttributeName: 'sk2',
      AttributeType: 'S',
    },
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'inverse',
      KeySchema: [
        {
          KeyType: 'HASH',
          AttributeName: 'sk',
        },
        {
          KeyType: 'RANGE',
          AttributeName: 'pk',
        },
      ],
      Projection: {
        ProjectionType: 'ALL',
      },
    },
    {
      IndexName: 'gsi2',
      KeySchema: [
        {
          KeyType: 'HASH',
          AttributeName: 'pk2',
        },
        {
          KeyType: 'RANGE',
          AttributeName: 'sk2',
        },
      ],
      Projection: {
        ProjectionType: 'ALL',
      },
    },
    {
      IndexName: 'inverse2',
      KeySchema: [
        {
          KeyType: 'HASH',
          AttributeName: 'sk2',
        },
        {
          KeyType: 'RANGE',
          AttributeName: 'pk2',
        },
      ],
      Projection: {
        ProjectionType: 'ALL',
      },
    },
  ],
  BillingMode: 'PAY_PER_REQUEST',
});

// Table creation and deletion functions
export const createTable = async (tableName: string = testTableName) => {
  await documentClient.send(new CreateTableCommand(tableConfig(tableName)));
};

export const deleteTable = async (tableName: string = testTableName) => {
  await documentClient.send(new DeleteTableCommand({ TableName: tableName }));
};

// Convenience functions for different test suites
export const createMainTable = async () => createTable(testTableName);
export const deleteMainTable = async () => deleteTable(testTableName);
export const createFilteredTable = async () =>
  createTable(filteredTestTableName);
export const deleteFilteredTable = async () =>
  deleteTable(filteredTestTableName);

export const table = new Table({
  name: testTableName,
  partitionKey: { name: 'pk', type: 'string' },
  sortKey: { name: 'sk', type: 'string' },
  documentClient,
  indexes: {
    inverse: {
      type: 'global',
      partitionKey: { name: 'sk', type: 'string' },
      sortKey: { name: 'pk', type: 'string' },
    },
    gsi2: {
      type: 'global',
      partitionKey: { name: 'pk2', type: 'string' },
      sortKey: { name: 'sk2', type: 'string' },
    },
    inverse2: {
      type: 'global',
      partitionKey: { name: 'sk2', type: 'string' },
      sortKey: { name: 'pk2', type: 'string' },
    },
  },
});

// Create a table instance for filtered tests
export const filteredTable = new Table({
  name: filteredTestTableName,
  partitionKey: { name: 'pk', type: 'string' },
  sortKey: { name: 'sk', type: 'string' },
  documentClient,
  indexes: {
    inverse: {
      type: 'global',
      partitionKey: { name: 'sk', type: 'string' },
      sortKey: { name: 'pk', type: 'string' },
    },
    gsi2: {
      type: 'global',
      partitionKey: { name: 'pk2', type: 'string' },
      sortKey: { name: 'sk2', type: 'string' },
    },
    inverse2: {
      type: 'global',
      partitionKey: { name: 'sk2', type: 'string' },
      sortKey: { name: 'pk2', type: 'string' },
    },
  },
});
