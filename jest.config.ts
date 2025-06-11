import type { Config } from 'jest';

const config: Config = {
  testEnvironment: 'node',
  transform: {
    '^.+\\.(t|j)sx?$': '@swc/jest',
  },
  testPathIgnorePatterns: ['/node_modules/', '/dist/', '/cdk.out/', '/tests/'],
  modulePathIgnorePatterns: ['/dist/', '/cdk.out/'],
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
  coverageReporters: ['html-spa'],
  maxWorkers: 1,
};

export default config;
