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
  ],
  BillingMode: 'PAY_PER_REQUEST',
});

// Table creation and deletion functions
export const createTable = async () => {
  await documentClient.send(new CreateTableCommand(tableConfig(testTableName)));
};

export const deleteTable = async () => {
  await documentClient.send(
    new DeleteTableCommand({ TableName: testTableName })
  );
};

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
